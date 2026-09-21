import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useStore } from './store';
import { toMinutes } from './utils';

let handlerSet = false;
function ensureHandler() {
  if (handlerSet) return;
  handlerSet = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}
ensureHandler();

/**
 * Boot-time notification setup, run once after the app has revealed (never on
 * the startup path): the channel exists before anything posts to it, and
 * reminders a reboot or an OS alarm purge dropped are scheduled again.
 */
let archiveWatch: (() => void) | null = null;

export async function initNotifications() {
  ensureHandler();
  await ensureChannel();
  if (!archiveWatch) {
    // archiving a tool pauses its reminders; restoring it schedules them again
    archiveWatch = useStore.subscribe((s, prev) => {
      if ((s.settings.archivedTools || []).join() !== (prev.settings.archivedTools || []).join()) void rescheduleAllReminders();
    });
  }
  if (useStore.getState().settings.remindersEnabled) await rescheduleAllReminders();
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
 * Cancels only the reminders this module owns. Everything scheduled here is a
 * DAILY trigger, so the trigger check also sweeps reminders left behind by
 * builds that scheduled before the identifier prefix existed. One-off
 * notifications scheduled elsewhere — the Deep Work finish line, a DATE
 * trigger — are deliberately left alone.
 */
async function cancelOwnReminders() {
  const all = await Notifications.getAllScheduledNotificationsAsync();
  for (const req of all) {
    const isDaily = (req.trigger as any)?.type === 'daily';
    if (isDaily || req.identifier.startsWith(REMINDER_ID_PREFIX)) {
      await Notifications.cancelScheduledNotificationAsync(req.identifier);
    }
  }
}

async function scheduleDaily(id: string, hhmm: string, title: string, body: string) {
  const mins = toMinutes(hhmm);
  if (mins < 0) return;
  await Notifications.scheduleNotificationAsync({
    identifier: REMINDER_ID_PREFIX + id,
    content: { title, body },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      channelId: NOTIF_CHANNEL_ID,
      hour: Math.floor(mins / 60),
      minute: mins % 60,
    },
  });
}

/**
 * Single source of truth for every reminder this app schedules:
 * habit reminders, the daily "plan your ToDos" nudge, and custom day reminders.
 * Cancels the reminders it owns and re-schedules them from current store state —
 * one-off notifications scheduled elsewhere (Deep Work's finish line) survive.
 */
export async function rescheduleAllReminders() {
  try {
    // the channel must exist before anything is posted to it, and one-off
    // notifications use it too — so create it ahead of the enabled check
    await ensureChannel();
    await cancelOwnReminders();
    const s = useStore.getState();
    if (!s.settings.remindersEnabled) return;
    // an archived tool's reminders pause until it is restored: habits belong to the Planner, ToDos to Tasks
    const archived = new Set<string>(s.settings.archivedTools || []);
    if (!archived.has('planner')) {
      for (const h of s.habits) {
        if (h.remindTime) await scheduleDaily(`habit:${h.id}`, h.remindTime, 'Streak check-in', h.title);
      }
    }
    if (!archived.has('tasks')) {
      if (s.settings.todoReminderEnabled) {
        await scheduleDaily(
          'todo-daily',
          s.settings.todoReminderTime,
          "Plan today's ToDos",
          'Two minutes now saves the whole day. Set up your list.'
        );
      }
      for (const r of s.todoReminders) {
        await scheduleDaily(`todo:${r.id}`, r.time, 'ToDo check-in', r.label || 'How is the list going?');
      }
    }
    if (!archived.has('journal') && s.settings.journalReminderTime) {
      await scheduleDaily('journal-daily', s.settings.journalReminderTime, 'Journal', 'A few lines about your day?');
    }
  } catch {
    // notifications can be unavailable in some environments — fail quietly
  }
}
