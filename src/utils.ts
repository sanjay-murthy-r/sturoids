// Small shared helpers — dates, ids, streaks, youtube parsing.

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export type DayName = (typeof DAY_NAMES)[number];

export function todayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function yesterdayKey(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return todayKey(d);
}

export function dayName(d = new Date()): DayName {
  // JS: 0 = Sunday
  return DAY_NAMES[(d.getDay() + 6) % 7];
}

export function fmtDate(d = new Date()): string {
  return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function fmtShortDate(key: string): string {
  const d = new Date(key + 'T00:00:00');
  if (isNaN(d.getTime())) return key;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function daysUntil(dateKey: string): number {
  const now = new Date(todayKey() + 'T00:00:00').getTime();
  const then = new Date(dateKey + 'T00:00:00').getTime();
  return Math.round((then - now) / 86400000);
}

/** "HH:MM" -> minutes since midnight; returns -1 if invalid */
export function toMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm || '').trim());
  if (!m) return -1;
  const h = +m[1], min = +m[2];
  if (h > 23 || min > 59) return -1;
  return h * 60 + min;
}

export function fmtClockTime(mins: number, hour24: boolean): string {
  let h = Math.floor(mins / 60);
  const m = String(mins % 60).padStart(2, '0');
  if (hour24) return `${String(h).padStart(2, '0')}:${m}`;
  const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}:${m} ${ap}`;
}

export function fmtDuration(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtMediaTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** current + best streak from a set of YYYY-MM-DD keys */
export function streaks(doneDates: string[]): { current: number; best: number } {
  if (!doneDates || doneDates.length === 0) return { current: 0, best: 0 };
  const set = new Set(doneDates);
  // best: walk sorted dates
  const sorted = [...set].sort();
  let best = 1, run = 1;
  // calendar days, counted in UTC: a day the clocks change on is still one day after the one before
  const dayNo = (key: string) => {
    const [y, m, d] = key.split('-').map(Number);
    return Date.UTC(y, m - 1, d) / 86400000;
  };
  for (let i = 1; i < sorted.length; i++) {
    run = dayNo(sorted[i]) - dayNo(sorted[i - 1]) === 1 ? run + 1 : 1;
    if (run > best) best = run;
  }
  // current: count back from today (or yesterday if today not yet done)
  let current = 0;
  const cursor = new Date();
  if (!set.has(todayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (set.has(todayKey(cursor))) {
    current++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return { current, best };
}

/** Extract a YouTube video id from most url shapes; null if not found. */
export function parseYouTubeId(url: string): string | null {
  const u = (url || '').trim();
  const patterns = [
    /(?:youtube\.com\/watch\?(?:.*&)?v=)([\w-]{11})/,
    /(?:youtu\.be\/)([\w-]{11})/,
    /(?:youtube\.com\/embed\/)([\w-]{11})/,
    /(?:youtube\.com\/shorts\/)([\w-]{11})/,
    /(?:youtube\.com\/live\/)([\w-]{11})/,
  ];
  for (const p of patterns) {
    const m = p.exec(u);
    if (m) return m[1];
  }
  if (/^[\w-]{11}$/.test(u)) return u; // bare id
  return null;
}

export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split('.').map(Number);
  const pb = b.replace(/^v/i, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}
