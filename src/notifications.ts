import { Alert, AppState, Linking, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useStore } from './store';
import { toMinutes, todayKey } from './utils';
import { COUNTDOWN_NOTIF_ID, FINISH_NOTIF_ID } from './deepWork';
import { openTool } from './toolNav';
import { ToolKey, toolByKey } from './tools';
import { toast } from './components/Toast';

type Data = ReturnType<typeof useStore.getState>;

let handlerSet = false;
function ensureHandler() {
  if (handlerSet) return;
  handlerSet = true;
  Notifications.setNotificationHandler({
    handleNotification: async (n) => {
      // a session's own alerts are for when the app is away; in the app, the clock itself already says so
      const id = n.request.identifier;
      const quiet = AppState.currentState === 'active' && (id === COUNTDOWN_NOTIF_ID || id === FINISH_NOTIF_ID);
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
    // count a check-in gives: whatever the reminders are built from lays them out again
    useStore.subscribe((s, prev) => {
      if (s.settings === prev.settings && s.habits === prev.habits && s.dailyTasks === prev.dailyTasks && s.todoReminders === prev.todoReminders) return;
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

function anyReminderSet(s: Data) {
  const paused = pausedTools(s);
  return (!paused.has('planner') && s.habits.some((h) => !!h.remindTime))
    || (!paused.has('tasks') && (s.settings.todoReminderEnabled || s.todoReminders.length > 0))
    || (!paused.has('journal') && !!s.settings.journalReminderTime);
}

/**
 * Everything the reminders are built from, as one string: the watcher lays them out again only when it changes, so a
 * keystroke in a note or a tick on a habit with no time never reaches the scheduler.
 */
function reminderInputs(s: Data) {
  const today = todayKey();
  const st = s.settings;
  const timed = s.habits.filter((h) => h.remindTime).map((h) => [h.id, h.title, h.remindTime, h.doneDates.includes(today) ? 1 : 0].join('|'));
  // a check-in's count only matters while there are check-ins
  const open = s.todoReminders.length ? s.dailyTasks.filter((t) => t.doneOn !== today).length + '/' + s.dailyTasks.length : '';
  return [
    st.remindersEnabled, st.todoReminderEnabled, st.todoReminderTime, st.journalReminderTime, (st.archivedTools || []).join(),
    timed.join(), s.todoReminders.map((r) => r.id + r.time + r.label).join(), open,
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
 * Creates the android notification channel. Android silently drops anything
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
  } catch {
    // no notification service in some environments — fail quietly
  }
}

/**
 * The heads-up for a countdown that ends while the phone is away. Scheduled only when notifications are already
 * allowed, so starting a session never stops to ask; replacing it under its fixed id keeps exactly one.
 */
export async function scheduleCountdownEnd(endAt: number, minutes: number, subject: string) {
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return;
    await ensureChannel();
    await Notifications.cancelScheduledNotificationAsync(COUNTDOWN_NOTIF_ID).catch(() => {});
    if (endAt <= Date.now()) return;
    await Notifications.scheduleNotificationAsync({
      identifier: COUNTDOWN_NOTIF_ID,
      content: {
        title: 'Session complete',
        body: subject.trim() ? minutes + ' minutes of ' + subject.trim() + ', done.' : 'Your ' + minutes + '-minute block is done.',
        data: { tool: 'focus' },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(endAt), channelId: NOTIF_CHANNEL_ID } as any,
    });
  } catch {
    // no notification service in some environments: the in-app wrap-up still happens
  }
}

export function cancelCountdownEnd() {
  Notifications.cancelScheduledNotificationAsync(COUNTDOWN_NOTIF_ID).catch(() => {});
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
  const mins = toMinutes(hhmm);
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

/** One reminder on one day at a time of day; a time already gone is not set (a past date would ring at once). */
async function scheduleOn(id: string, day: Date, hhmm: string, title: string, body: string, tool: ToolKey, now: Date) {
  const mins = toMinutes(hhmm);
  if (mins < 0) return;
  const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(mins / 60), mins % 60);
  if (at.getTime() <= now.getTime() + 5000) return;
  await Notifications.scheduleNotificationAsync({
    identifier: REMINDER_ID_PREFIX + id,
    content: { title, body, data: { tool } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: NOTIF_CHANNEL_ID },
  });
}

/**
 * Habits and check-ins are set day by day over this many days ahead, not as one repeating alarm, so today's can stand
 * down once its work is done and can say how much is left. The days are laid out again on every launch, on a new day
 * and on every change, so the window never runs out while the app is in use.
 */
const WINDOW_DAYS = 14;
/** at most this many of those at once, well under Android's 500 alarms for one app */
const DATED_MAX = 280;

/** the pass under way, and whether something changed while it ran */
let running: Promise<void> | null = null;
let dirty = false;

/**
 * Single source of truth for every reminder this app schedules: habit reminders, the daily "plan your ToDos" nudge,
 * the ToDo check-ins and the journal's. Cancels the reminders it owns and schedules them again from the store.
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
    // an archived tool's reminders pause until it is restored: habits belong to the Planner, ToDos to Tasks
    const paused = pausedTools(s);
    const habits = paused.has('planner') ? [] : s.habits.filter((h) => h.remindTime && toMinutes(h.remindTime) >= 0);
    const checkIns = paused.has('tasks') ? [] : s.todoReminders.filter((r) => toMinutes(r.time) >= 0);
    const perDay = habits.length + checkIns.length;
    const days = perDay ? Math.max(1, Math.min(WINDOW_DAYS, Math.floor(DATED_MAX / perDay))) : 0;
    const open = s.dailyTasks.filter((t) => t.doneOn !== today).length;
    const listDone = s.dailyTasks.length > 0 && open === 0;
    const jobs: Promise<void>[] = [];
    for (let d = 0; d < days; d++) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
      const key = todayKey(day);
      for (const h of habits) {
        // ticked today, today's reminder has nothing left to ask
        if (d === 0 && h.doneDates.includes(today)) continue;
        jobs.push(scheduleOn(`habit:${h.id}:${key}`, day, h.remindTime!, 'Streak check-in', h.title, 'planner', now));
      }
      // every ToDo done, today's check-ins stand down; today's say how many are left, and never a zero
      if (d === 0 && listDone) continue;
      const left = d === 0 && open > 0 ? open + (open === 1 ? ' ToDo open' : ' ToDos open') : '';
      for (const r of checkIns) {
        const body = [(r.label || '').trim(), left].filter(Boolean).join(' · ') || 'How is the list going?';
        jobs.push(scheduleOn(`todo:${r.id}:${key}`, day, r.time, 'ToDo check-in', body, 'tasks', now));
      }
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
