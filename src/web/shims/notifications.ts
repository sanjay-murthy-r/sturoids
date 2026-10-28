// expo-notifications on the PC version: reminders become the desktop's own notifications (the page's Notification
// API, which the desktop app shows as Windows notifications), timed while the app is open. A PC app that is closed
// cannot wake itself, so a reminder due then is shown the next time the app opens, if it is still today's.

export const SchedulableTriggerInputTypes = {
  CALENDAR: 'calendar', DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly', DATE: 'date',
  TIME_INTERVAL: 'timeInterval',
} as const;
export enum AndroidImportance { UNKNOWN = 0, UNSPECIFIED = 1, NONE = 2, MIN = 3, LOW = 4, DEFAULT = 5, HIGH = 6, MAX = 7 }
export const DEFAULT_ACTION_IDENTIFIER = 'expo.modules.notifications.actions.DEFAULT';
export const DEFAULT = 'default';
export type NotificationResponse = any;

interface Req { identifier: string; content: { title?: string; body?: string; data?: any }; trigger: any }

const KEY = 'sturoids.notifications';
const reqs = new Map<string, Req>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<(r: any) => void>();
let lastResponse: any = null;

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify([...reqs.values()]));
  } catch {
    // a full or blocked storage keeps the reminders for this session only
  }
}
function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (Array.isArray(raw)) for (const r of raw) if (r && typeof r.identifier === 'string') reqs.set(r.identifier, r);
  } catch {
    // nothing kept
  }
}

/** When a trigger next fires after `from`, or null when it never will again. */
function nextFire(t: any, from: Date): Date | null {
  if (!t) return null;
  if (t.type === 'date' || t.date) {
    const d = new Date(t.date);
    return isNaN(d.getTime()) ? null : d;
  }
  if (t.type === 'timeInterval') return new Date(from.getTime() + (Number(t.seconds) || 0) * 1000);
  const at = new Date(from);
  at.setSeconds(0, 0);
  at.setHours(Number(t.hour) || 0, Number(t.minute) || 0);
  if (t.type === 'daily') {
    if (at <= from) at.setDate(at.getDate() + 1);
    return at;
  }
  if (t.type === 'weekly') {
    // weekday: 1 Sunday to 7 Saturday, as on a phone
    const want = (Number(t.weekday) || 1) - 1;
    let add = (want - at.getDay() + 7) % 7;
    if (add === 0 && at <= from) add = 7;
    at.setDate(at.getDate() + add);
    return at;
  }
  return null;
}

function show(r: Req) {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const n = new Notification(r.content.title || 'Sturoids', { body: r.content.body || '', tag: r.identifier });
      n.onclick = () => {
        lastResponse = { actionIdentifier: DEFAULT_ACTION_IDENTIFIER, notification: { request: r, date: Date.now() } };
        listeners.forEach((l) => l(lastResponse));
        try { window.focus(); } catch { /* the window may not take focus */ }
      };
    }
  } catch {
    // a desktop that will not show it: the reminder is simply missed
  }
}

function arm(r: Req) {
  const old = timers.get(r.identifier);
  if (old) clearTimeout(old);
  timers.delete(r.identifier);
  const at = nextFire(r.trigger, new Date());
  if (!at) return;
  const wait = at.getTime() - Date.now();
  // a one-off already past: shown once now if it was due earlier today, then forgotten
  if (wait <= 0) {
    if (r.trigger?.type === 'date' || r.trigger?.date) {
      if (new Date().toDateString() === at.toDateString()) show(r);
      reqs.delete(r.identifier);
      save();
    }
    return;
  }
  // timers longer than about 24 days overflow: it is armed again closer to the time
  timers.set(r.identifier, setTimeout(() => {
    timers.delete(r.identifier);
    show(r);
    if (r.trigger?.type === 'date' || r.trigger?.date || r.trigger?.type === 'timeInterval') {
      reqs.delete(r.identifier);
      save();
    } else arm(r);
  }, Math.min(wait, 2 ** 31 - 1)));
}

if (typeof window !== 'undefined') {
  load();
  reqs.forEach(arm);
}

export async function scheduleNotificationAsync({ identifier, content, trigger }: { identifier?: string; content: any; trigger: any }) {
  const id = identifier || 'n-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const r: Req = { identifier: id, content: { title: content?.title, body: content?.body, data: content?.data }, trigger: trigger ?? null };
  if (!trigger || (!trigger.type && !trigger.date && !trigger.seconds)) {
    // no time: shown now
    show(r);
    return id;
  }
  reqs.set(id, r);
  save();
  arm(r);
  return id;
}
export async function cancelScheduledNotificationAsync(id: string) {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
  reqs.delete(id);
  save();
}
export async function cancelAllScheduledNotificationsAsync() {
  timers.forEach(clearTimeout);
  timers.clear();
  reqs.clear();
  save();
}
export async function getAllScheduledNotificationsAsync() {
  return [...reqs.values()].map((r) => ({ identifier: r.identifier, content: r.content, trigger: r.trigger }));
}
const perm = () => {
  const p = typeof Notification === 'undefined' ? 'denied' : Notification.permission;
  const granted = p === 'granted';
  return { granted, status: granted ? 'granted' : p === 'denied' ? 'denied' : 'undetermined', canAskAgain: p !== 'denied', expires: 'never' as const };
};
export async function getPermissionsAsync() { return perm(); }
export async function requestPermissionsAsync(_o?: any) {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') await Notification.requestPermission();
  } catch {
    // older pages answer by callback only; the state below says what it is now
  }
  return perm();
}
export async function setNotificationChannelAsync(_id: string, _c: any) { return null; }
export function setNotificationHandler(_h: any) {}
export async function getLastNotificationResponseAsync() { return lastResponse; }
export async function clearLastNotificationResponseAsync() { lastResponse = null; }
export function addNotificationResponseReceivedListener(l: (r: any) => void) {
  listeners.add(l);
  return { remove: () => listeners.delete(l) };
}
export function addNotificationReceivedListener(_l: any) { return { remove() {} }; }
export async function dismissAllNotificationsAsync() {}
export async function getPresentedNotificationsAsync() { return []; }
export async function setBadgeCountAsync(_n: number) { return false; }
