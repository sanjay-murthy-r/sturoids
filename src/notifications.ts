import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { Habit } from './store';
import { toMinutes } from './utils';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

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

/** Cancel everything and re-schedule one daily reminder per habit that has a time. */
export async function rescheduleHabitReminders(habits: Habit[], enabled: boolean) {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
    if (!enabled) return;
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('reminders', {
        name: 'Habit reminders',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    for (const h of habits) {
      if (!h.remindTime) continue;
      const mins = toMinutes(h.remindTime);
      if (mins < 0) continue;
      await Notifications.scheduleNotificationAsync({
        content: { title: 'Streak check-in', body: h.title },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour: Math.floor(mins / 60),
          minute: mins % 60,
        },
      });
    }
  } catch {
    // Notifications can be unavailable (e.g. some Expo Go setups) — fail quietly.
  }
}
