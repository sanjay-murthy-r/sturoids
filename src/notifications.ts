import { Alert, AppState, Linking, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useStore } from './store';
import { dayName, fmtClockTime, habitDueOn, toMinutes, todayKey } from './utils';
import { COUNTDOWN_NOTIF_ID, FINISH_NOTIF_ID } from './deepWork';
import { openTool } from './toolNav';
import { ToolKey, toolByKey } from './tools';
import { categoryOf, indexScores, resultOf, topExams } from './scores';
import { toast } from './components/Toast';

type Data = ReturnType<typeof useStore.getState>;

/** The heads-up for a Deep Work break that ends while the phone is away, under a fixed id like the session's own. */
export const BREAK_NOTIF_ID = 'sturoids-break-end';

let handlerSet = false;
function ensureHandler() {
  if (handlerSet) return;
  handlerSet = true;
  Notifications.setNotificationHandler({
    handleNotification: async (n) => {
      // a session's own alerts are for when the app is away; in the app, the clock itself already says so
      const id = n.request.identifier;
      const quiet = AppState.currentState === 'active' && (id === COUNTDOWN_NOTIF_ID || id === FINISH_NOTIF_ID || id === BREAK_NOTIF_ID);
      return {
        shouldShowBanner: !quiet,
        shouldShowList: !quiet,
        shouldPlaySound: false,
        shouldSetBadge: false,
      };
    },
  });
}
ensureHandler();

/** whether the watchers below are in place: set up once, however often init runs */
let watching = false;

/** the pending reschedule after a change the reminders are built from */
let settle: ReturnType<typeof setTimeout> | null = null;

/** what the reminders were last laid out from (see reminderInputs) */
let lastInputs = '';

/** the day the reminders were last laid out on: today's are built from today's ticks and list, so a new day lays them out again */
let laidOutOn = '';

/**
 * Boot-time notification setup, run once after the app has revealed (never on
 * the startup path): the channel exists before anything posts to it, and
 * reminders a reboot or an OS alarm purge dropped are scheduled again.
 */
export async function initNotifications() {
  ensureHandler();
  await ensureChannel();
  if (!watching) {
    watching = true;
    lastInputs = reminderInputs(useStore.getState());
    // archiving a tool pauses its reminders, a habit ticked today stands its reminder down, a ToDo ticked changes the
    // count a check-in gives, a block moved moves its alert: whatever the reminders are built from lays them out again
    useStore.subscribe((s, prev) => {
      if (
        s.settings === prev.settings && s.habits === prev.habits && s.dailyTasks === prev.dailyTasks
        && s.todoReminders === prev.todoReminders && s.missions === prev.missions && s.planner === prev.planner
        && s.scores === prev.scores && s.scoreTags === prev.scoreTags
      ) return;
      const inputs = reminderInputs(s);
      if (inputs === lastInputs) return;
      lastInputs = inputs;
      // changes in a row (ticks, a delete and its Undo, several tools archived) settle into one pass
      if (settle) clearTimeout(settle);
      settle = setTimeout(() => { settle = null; void rescheduleAllReminders(); }, 400);
    });
    AppState.addEventListener('change', (state) => {
      if (state === 'active' && laidOutOn !== '' && laidOutOn !== todayKey()) void rescheduleAllReminders();
    });
    // a reminder tapped while the app is open or in the background opens the tool it is about
    Notifications.addNotificationResponseReceivedListener(openFrom);
  }
  // and one tapped while the app was closed, which is what opened it
  try {
    const last = await Notifications.getLastNotificationResponseAsync();
    if (last) {
      openFrom(last);
      await Notifications.clearLastNotificationResponseAsync();
    }
  } catch {
    // no notification service in some environments
  }
  if (useStore.getState().settings.remindersEnabled) {
    await rescheduleAllReminders();
    await warnIfSilent();
  }
}

export async function ensurePermission(): Promise<boolean> {
  try {
    const cur = await Notifications.getPermissionsAsync();
    if (cur.granted) return true;
    const req = await Notifications.requestPermissionsAsync();
    return req.granted;
  } catch {
    return false;
  }
}

/**
 * The one way a reminder time switches reminders on: it asks for notification permission, turns reminders on once it is
 * given, and lays every reminder out again. Refused, it says so and offers the phone's settings, since Android stops
 * showing its own prompt after two refusals and asking again would do nothing. Resolves to whether reminders can ring.
 */
export async function turnOnReminders(): Promise<boolean> {
  const ok = await ensurePermission();
  if (ok) {
    if (!useStore.getState().settings.remindersEnabled) useStore.getState().setSetting('remindersEnabled', true);
  } else {
    Alert.alert(
      'Notifications are off',
      'Reminders cannot ring until Sturoids may send notifications. You can allow them in your phone settings.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open settings', onPress: () => { Linking.openSettings().catch(() => {}); } },
      ],
    );
  }
  await rescheduleAllReminders();
  return ok;
}

/** said once a launch: reminders are on (a restore onto a new phone brings that along) but this phone never allowed them */
let warned = false;
async function warnIfSilent() {
  if (warned) return;
  try {
    if ((await Notifications.getPermissionsAsync()).granted) return;
  } catch {
    return;
  }
  if (!anyReminderSet(useStore.getState())) return;
  warned = true;
  toast('Reminders need notification permission', { label: 'Allow', onPress: () => { void turnOnReminders(); } });
}

/** the tools whose reminders are paused, since they are archived */
const pausedTools = (s: Data) => new Set<string>(s.settings.archivedTools || []);

/** A time something happens at: a valid 'HH:MM' before midnight, in minutes, or -1. */
const minutesOf = (hhmm: string | undefined) => {
  const m = toMinutes(hhmm || '');
  return m >= 0 && m < 1440 ? m : -1;
};

/** When a task is due, in minutes: any valid time, the end of the day (24:00) included, or -1. */
const dueOf = (hhmm: string | undefined) => toMinutes(hhmm || '');

/** ToDos with a time and a reminder on it. */
const timedTasks = (s: Data) => s.dailyTasks.filter((t) => !!t.remind && dueOf(t.time) >= 0);

/** Long-term tasks still open with a reminder on their deadline day. */
const timedMissions = (s: Data) => s.missions.filter((m) => !m.done && !!m.remind && /^\d{4}-\d{2}-\d{2}$/.test(m.deadline || ''));

/** The day before a day, as a key. */
function dayBefore(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return todayKey(new Date(y, m - 1, d - 1));
}

/**
 * Exams to be reminded of the evening before: every dated exam still unmarked, from tomorrow on, with what the
 * reminder says under its name (its category, or the group it sits in).
 */
function examAlerts(s: Data, today: string): { id: string; title: string; body: string; eve: string }[] {
  const ix = indexScores(s.scores);
  const out: { id: string; title: string; body: string; eve: string }[] = [];
  for (const n of topExams(ix)) {
    if (!n.date || !/^\d{4}-\d{2}-\d{2}$/.test(n.date) || n.date <= today || resultOf(n, ix)) continue;
    const parent = n.parentId ? ix.byId.get(n.parentId) : undefined;
    const body = categoryOf(n, s.scoreTags)?.label || (parent?.kind === 'group' ? parent.title.trim() : '');
    out.push({ id: n.id, title: n.title.trim() || 'Exam', body, eve: dayBefore(n.date) });
  }
  return out;
}

function anyReminderSet(s: Data) {
  const paused = pausedTools(s);
  const st = s.settings;
  return (!paused.has('planner') && (s.habits.some((h) => !!h.remindTime) || (st.blockAlerts && Object.values(s.planner).some((d) => d.length > 0))))
    || (!paused.has('tasks') && (st.todoReminderEnabled || s.todoReminders.length > 0 || timedTasks(s).length > 0 || timedMissions(s).length > 0))
    || (!paused.has('journal') && !!st.journalReminderTime)
    || (!paused.has('scores') && st.examReminders && s.scores.some((n) => !!n.date));
}

/**
 * Everything the reminders are built from, as one string: the watcher lays them out again only when it changes, so a
 * keystroke in a note or a tick on a habit with no time never reaches the scheduler.
 */
function reminderInputs(s: Data) {
  const today = todayKey();
  const st = s.settings;
  // its weekdays too: a habit moved to other days rings on those
  const timed = s.habits.filter((h) => h.remindTime)
    .map((h) => [h.id, h.title, h.remindTime, h.doneDates.includes(today) ? 1 : 0, (h.days || []).join('.')].join('|'));
  // a check-in's count only matters while there are check-ins
  const open = s.todoReminders.length ? s.dailyTasks.filter((t) => t.doneOn !== today).length + '/' + s.dailyTasks.length : '';
  const tasks = timedTasks(s).map((t) => [t.id, t.title, t.time, t.remind, t.repeat || '', t.doneOn === today ? 1 : 0].join('|'));
  const missions = timedMissions(s).map((m) => [m.id, m.title, m.deadline, m.time || '', m.remind].join('|'));
  // only while the alerts are on: a block edited with them off lays nothing out
  const blocks = st.blockAlerts
    ? Object.entries(s.planner).map(([d, list]) => d + ':' + list.map((b) => [b.id, b.subject, b.start, b.end].join('|')).join(',')).join(';')
    : '';
  const exams = st.examReminders ? examAlerts(s, today).map((e) => [e.id, e.title, e.body, e.eve].join('|')).join() : '';
  return [
    st.remindersEnabled, st.todoReminderEnabled, st.todoReminderTime, st.journalReminderTime, (st.archivedTools || []).join(),
    timed.join(), s.todoReminders.map((r) => r.id + r.time + r.label).join(), open,
    st.hour24, st.blockAlerts, st.examReminders, tasks.join(), missions.join(), blocks, exams,
  ].join('#');
}

/** the last reminder tap acted on, so the same tap is never answered twice (by the listener and the cold start read) */
let lastTap = '';

/** A tapped reminder opens the tool it is about; a tool archived since it was set leaves the app where it was. */
function openFrom(r: Notifications.NotificationResponse) {
  if (r.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
  const tap = r.notification.request.identifier + '@' + r.notification.date;
  if (tap === lastTap) return;
  lastTap = tap;
  const tool = r.notification.request.content.data?.tool;
  if (typeof tool !== 'string' || !toolByKey(tool)) return;
  if (pausedTools(useStore.getState()).has(tool)) return;
  openTool(tool as ToolKey);
}

/**
 * Every reminder this module schedules carries this identifier prefix, so a
 * reschedule can cancel exactly its own notifications and nothing else.
 */
const REMINDER_ID_PREFIX = 'sturoids-reminder:';

/** The android channel every notification in this app is posted to. */
export const NOTIF_CHANNEL_ID = 'reminders';

/**
 * The end of a Deep Work block or break, away from the app: the soft chime with the buzz, or the buzz alone when the
 * chime is off. Two channels, since Android fixes a channel's sound once it exists; new ids, for the same reason.
 */
export const SESSION_END_CHIME_CHANNEL = 'session-end-chime';
export const SESSION_END_QUIET_CHANNEL = 'session-end-quiet';
/** the buzz the app plays itself at the end of a block (chime.ts), so both feel the same */
const SESSION_END_VIBRATION = [0, 180, 120, 180];

/** The channel the end of a block or a break is posted to, as the chime setting stands now. */
const sessionEndChannel = () =>
  (useStore.getState().settings.focusChime ? SESSION_END_CHIME_CHANNEL : SESSION_END_QUIET_CHANNEL);

/**
 * Creates the android notification channels. Android silently drops anything
 * posted to a channel id that does not exist, so this has to run before ANY
 * scheduling — including the Deep Work finish line, which focus.tsx schedules
 * even when reminders are switched off. Idempotent: the native call upserts.
 */
export async function ensureChannel() {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(NOTIF_CHANNEL_ID, {
      name: 'Reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
    await Notifications.setNotificationChannelAsync(SESSION_END_CHIME_CHANNEL, {
      name: 'End of a block, with chime',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'chime.wav',
      enableVibrate: true,
      vibrationPattern: SESSION_END_VIBRATION,
    });
    await Notifications.setNotificationChannelAsync(SESSION_END_QUIET_CHANNEL, {
      name: 'End of a block, vibration only',
      importance: Notifications.AndroidImportance.HIGH,
      sound: null,
      enableVibrate: true,
      vibrationPattern: SESSION_END_VIBRATION,
    });
  } catch {
    // no notification service in some environments — fail quietly
  }
}

const minutesWord = (n: number) => n + (n === 1 ? ' minute' : ' minutes');

/** One-off Deep Work alerts are set only when notifications are already allowed, so starting never stops to ask. */
async function scheduleSessionAlert(id: string, endAt: number, title: string, body: string) {
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return;
    await ensureChannel();
    await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
    if (endAt <= Date.now()) return;
    const channelId = sessionEndChannel();
    await Notifications.scheduleNotificationAsync({
      identifier: id,
      content: { title, body, data: { tool: 'focus' }, sound: channelId === SESSION_END_CHIME_CHANNEL ? 'chime.wav' : false },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(endAt), channelId } as any,
    });
  } catch {
    // no notification service in some environments: the in-app wrap-up still happens
  }
}

/**
 * The heads-up for a countdown that ends while the phone is away, with the chime when it is on and the buzz either way.
 * Replacing it under its fixed id keeps exactly one.
 */
export async function scheduleCountdownEnd(endAt: number, minutes: number, subject: string) {
  const what = subject.trim();
  await scheduleSessionAlert(
    COUNTDOWN_NOTIF_ID, endAt, 'Session complete',
    what ? minutesWord(minutes) + ' of ' + what + ', done.' : 'Your ' + minutes + '-minute block is done.',
  );
}

export function cancelCountdownEnd() {
  Notifications.cancelScheduledNotificationAsync(COUNTDOWN_NOTIF_ID).catch(() => {});
}

/** The heads-up for a break that ends while the phone is away; one at a time, under its fixed id. */
export async function scheduleBreakEnd(endAt: number, minutes: number) {
  await scheduleSessionAlert(BREAK_NOTIF_ID, endAt, 'Break over', 'Your ' + minutes + '-minute break is done.');
}

export function cancelBreakEnd() {
  Notifications.cancelScheduledNotificationAsync(BREAK_NOTIF_ID).catch(() => {});
}

/**
 * Cancels only the reminders this module owns: everything it schedules carries the identifier prefix, and the DAILY
 * check also sweeps reminders left behind by builds that scheduled before the prefix existed. One-off notifications
 * scheduled elsewhere (the Deep Work finish line and countdown) are deliberately left alone.
 */
async function cancelOwnReminders() {
  const all = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(all
    .filter((req) => (req.trigger as any)?.type === 'daily' || req.identifier.startsWith(REMINDER_ID_PREFIX))
    .map((req) => Notifications.cancelScheduledNotificationAsync(req.identifier)));
}

async function scheduleDaily(id: string, hhmm: string, title: string, body: string, tool: ToolKey) {
  const mins = minutesOf(hhmm);
  if (mins < 0) return;
  await Notifications.scheduleNotificationAsync({
    identifier: REMINDER_ID_PREFIX + id,
    content: { title, body, data: { tool } },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      channelId: NOTIF_CHANNEL_ID,
      hour: Math.floor(mins / 60),
      minute: mins % 60,
    },
  });
}

/** One reminder at one moment. */
interface Dated { id: string; at: Date; title: string; body: string; tool: ToolKey }

async function scheduleAt(r: Dated) {
  await Notifications.scheduleNotificationAsync({
    identifier: REMINDER_ID_PREFIX + r.id,
    content: { title: r.title, ...(r.body ? { body: r.body } : {}), data: { tool: r.tool } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: r.at, channelId: NOTIF_CHANNEL_ID },
  });
}

/**
 * Habits, check-ins, block alerts and task and exam reminders are set day by day over this many days ahead, not as
 * repeating alarms, so today's can stand down once its work is done and can say how much is left. The days are laid
 * out again on every launch, on a new day and on every change, so the window never runs out while the app is in use.
 */
const WINDOW_DAYS = 14;
/** at most this many of those at once, well under Android's 500 alarms for one app: the window shortens to fit */
const DATED_MAX = 280;
/** the morning reminder of a task's day */
const MORNING_MIN = 8 * 60;
/** an exam's reminder, the evening before */
const EXAM_EVE_MIN = 19 * 60;
/** a long-term task with a reminder and no time is due by the end of its day */
const END_OF_DAY_MIN = 23 * 60 + 59;

/** the pass under way, and whether something changed while it ran */
let running: Promise<void> | null = null;
let dirty = false;

/**
 * Single source of truth for every reminder this app schedules: habit reminders, the daily "plan your ToDos" nudge,
 * the ToDo check-ins, the journal's, block alerts, ToDo and long-term task times, and exam evenings. Cancels the
 * reminders it owns and schedules them again from the store.
 * One pass at a time: a call while one runs marks it to run once more when it ends and shares its promise, since two
 * passes side by side could cancel a reminder the other had just set (the ids are fixed).
 */
export function rescheduleAllReminders(): Promise<void> {
  if (running) {
    dirty = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        dirty = false;
        await layOutReminders();
      } while (dirty);
    } finally {
      running = null;
    }
  })();
  return running;
}

async function layOutReminders() {
  try {
    // the channel must exist before anything is posted to it, and one-off
    // notifications use it too — so create it ahead of the enabled check
    await ensureChannel();
    await cancelOwnReminders();
    const s = useStore.getState();
    const now = new Date();
    const today = todayKey(now);
    laidOutOn = today;
    // this pass reads the store as it is now, so a change the watcher was still settling is already in it
    lastInputs = reminderInputs(s);
    if (settle) { clearTimeout(settle); settle = null; }
    if (!s.settings.remindersEnabled) return;
    // an archived tool's reminders pause until it is restored: habits and blocks belong to the Planner, ToDos and
    // long-term tasks to Tasks, exams to Scores
    const paused = pausedTools(s);
    const hour24 = s.settings.hour24;
    const habits = paused.has('planner') ? [] : s.habits.filter((h) => minutesOf(h.remindTime) >= 0);
    const checkIns = paused.has('tasks') ? [] : s.todoReminders.filter((r) => minutesOf(r.time) >= 0);
    const tasks = paused.has('tasks') ? [] : timedTasks(s);
    const missions = paused.has('tasks') ? [] : timedMissions(s);
    const blocksOn = s.settings.blockAlerts && !paused.has('planner');
    const exams = s.settings.examReminders && !paused.has('scores') ? examAlerts(s, today) : [];
    const open = s.dailyTasks.filter((t) => t.doneOn !== today).length;
    const listDone = s.dailyTasks.length > 0 && open === 0;
    // every dated reminder, day by day; a moment already gone is left out (a past date would ring at once)
    const days: Dated[][] = [];
    for (let d = 0; d < WINDOW_DAYS; d++) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
      const key = todayKey(day);
      const list: Dated[] = [];
      const add = (id: string, mins: number, title: string, body: string, tool: ToolKey) => {
        // minutes past midnight or before it fall on the next or the day before, as Date counts them
        const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, mins);
        if (at.getTime() > now.getTime() + 5000) list.push({ id, at, title, body, tool });
      };
      for (const h of habits) {
        // a habit kept on some weekdays rings only on those
        if (!habitDueOn(h, day)) continue;
        // ticked today, today's reminder has nothing left to ask
        if (d === 0 && h.doneDates.includes(today)) continue;
        add(`habit:${h.id}:${key}`, minutesOf(h.remindTime), 'Streak check-in', h.title, 'planner');
      }
      // every ToDo done, today's check-ins stand down; today's say how many are left, and never a zero
      if (!(d === 0 && listDone)) {
        const left = d === 0 && open > 0 ? open + (open === 1 ? ' ToDo open' : ' ToDos open') : '';
        for (const r of checkIns) {
          const body = [(r.label || '').trim(), left].filter(Boolean).join(' · ') || 'How is the list going?';
          add(`todo:${r.id}:${key}`, minutesOf(r.time), 'ToDo check-in', body, 'tasks');
        }
      }
      // five minutes before each block of that weekday, in the user's clock
      if (blocksOn) {
        for (const b of s.planner[dayName(day)] || []) {
          const start = minutesOf(b.start);
          if (start < 0) continue;
          const end = toMinutes(b.end);
          const body = 'Starts at ' + fmtClockTime(start, hour24) + (end > start ? ', until ' + (end >= 1440 ? 'midnight' : fmtClockTime(end, hour24)) : '');
          add(`block:${b.id}:${key}`, start - 5, String(b.subject || '').trim() || 'Planner block', body, 'planner');
        }
      }
      // an open ToDo comes back each day until it is ticked: a daily one ticked today rings again tomorrow, a one-off
      // ticked today is gone by then
      for (const t of tasks) {
        if (t.doneOn === today && (d === 0 || t.repeat !== 'daily')) continue;
        const due = dueOf(t.time);
        if (t.remind === 'morning' && !(MORNING_MIN < due)) continue;
        add(`task:${t.id}:${key}`, t.remind === 'hour' ? due - 60 : MORNING_MIN, String(t.title || '').trim() || 'ToDo', 'Due by ' + fmtClockTime(due, hour24), 'tasks');
      }
      for (const m of missions) {
        if (m.deadline !== key) continue;
        const due = dueOf(m.time) >= 0 ? dueOf(m.time) : END_OF_DAY_MIN;
        if (m.remind === 'morning' && !(MORNING_MIN < due)) continue;
        const body = m.time ? 'Due today by ' + fmtClockTime(due, hour24) : 'Due today';
        add(`mission:${m.id}:${key}`, m.remind === 'hour' ? due - 60 : MORNING_MIN, String(m.title || '').trim() || 'Long-term task', body, 'tasks');
      }
      for (const e of exams) {
        if (e.eve === key) add(`exam:${e.id}:${key}`, EXAM_EVE_MIN, 'Tomorrow: ' + e.title, e.body, 'scores');
      }
      days.push(list);
    }
    // whole days, nearest first, as many as the budget holds
    const jobs: Promise<void>[] = [];
    let room = DATED_MAX;
    for (const list of days) {
      if (list.length > room) break;
      room -= list.length;
      for (const r of list) jobs.push(scheduleAt(r));
    }
    if (!paused.has('tasks') && s.settings.todoReminderEnabled) {
      jobs.push(scheduleDaily('todo-daily', s.settings.todoReminderTime, "Plan today's ToDos", "What is on today's list?", 'tasks'));
    }
    if (!paused.has('journal') && s.settings.journalReminderTime) {
      jobs.push(scheduleDaily('journal-daily', s.settings.journalReminderTime, 'Journal', 'A few lines about your day?', 'journal'));
    }
    await Promise.all(jobs);
  } catch {
    // notifications can be unavailable in some environments — fail quietly
  }
}
