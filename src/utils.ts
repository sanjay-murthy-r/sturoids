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

/**
 * "HH:MM" -> minutes since midnight; returns -1 if invalid. "24:00" is the end of the day (1440), so a block can run
 * until midnight; a time something happens at (a reminder) stays below it.
 */
export function toMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm || '').trim());
  if (!m) return -1;
  const h = +m[1], min = +m[2];
  if (h === 24 && min === 0) return 1440;
  if (h > 23 || min > 59) return -1;
  return h * 60 + min;
}

/** Of the blocks going on at `nowMin`, the one that ends first (the one to say), or null. */
export function blockOnNow<B extends { start: string; end: string }>(blocks: readonly B[], nowMin: number): B | null {
  let on: B | null = null;
  let onEnd = Infinity;
  for (const b of blocks) {
    const start = toMinutes(b.start);
    const end = toMinutes(b.end);
    if (start < 0 || end <= start || nowMin < start || nowMin >= end) continue;
    if (end < onEnd) {
      on = b;
      onEnd = end;
    }
  }
  return on;
}

export function fmtClockTime(mins: number, hour24: boolean): string {
  // the end of the day reads as midnight on either clock
  if (mins >= 1440) return hour24 ? '24:00' : '12:00 am';
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

/**
 * Where an item goes back into a list on Undo: straight after the nearest of the items that stood before it (when it
 * was removed) that is still there, or at the start. A plain index would drift when the list changed in between.
 */
export function indexAfterNeighbours(beforeIds: readonly string[], currentIds: readonly string[]): number {
  for (let i = beforeIds.length - 1; i >= 0; i--) {
    const at = currentIds.indexOf(beforeIds[i]);
    if (at >= 0) return at + 1;
  }
  return 0;
}

/** A date's weekday, Monday 0 to Sunday 6: the order of DAY_NAMES. */
export function weekdayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

/**
 * The weekdays a habit is due on, as kept: sorted, unique, whole numbers 0 (Monday) to 6 (Sunday). Undefined when every
 * day is meant: nothing given, nothing valid, none chosen, or all seven.
 */
export function cleanDays(days: unknown): number[] | undefined {
  if (!Array.isArray(days)) return undefined;
  const out = [...new Set(days.filter((n): n is number => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b);
  return out.length === 0 || out.length === 7 ? undefined : out;
}

/** A date key as the local calendar day it names. */
const dateOfKey = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** Whether a habit is due on a day (a date key or a date): every day unless it keeps its own weekdays. */
export function habitDueOn(h: { days?: number[] }, day: string | Date): boolean {
  const days = cleanDays(h.days);
  if (!days) return true;
  const d = typeof day === 'string' ? dateOfKey(day) : day;
  if (isNaN(d.getTime())) return true;
  return days.includes(weekdayIndex(d));
}

/** The weekdays a habit is due on, in words: "Every day", "Weekdays", "Weekends", or the short names ("Mon, Wed, Fri"). */
export function daysLabel(days?: number[]): string {
  const d = cleanDays(days);
  if (!d) return 'Every day';
  const key = d.join();
  if (key === '0,1,2,3,4') return 'Weekdays';
  if (key === '5,6') return 'Weekends';
  return d.map((i) => DAY_NAMES[i]).join(', ');
}

/** how far back a streak is walked, in days, for a habit kept on some weekdays only */
const STREAK_WALK_MAX = 3660;

/**
 * current + best streak from a set of YYYY-MM-DD keys. With `days` (the weekdays a habit is due on), a day it is not
 * due on and was not done is passed over, neither counting nor breaking the run; a day done counts whether it was due
 * or not; a due day not done ends it. Today never breaks a run: until it is done the count starts from yesterday.
 * Without `days` (every day due) the answer is the plain run of days, exactly as before weekdays came in.
 */
export function streaks(doneDates: string[], days?: number[]): { current: number; best: number } {
  if (!doneDates || doneDates.length === 0) return { current: 0, best: 0 };
  const due = cleanDays(days);
  if (due) return streaksOnDays(doneDates, due);
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

/** A calendar day as a whole number, counted in UTC so a day the clocks change on is still one day; NaN when unreadable. */
function dayNumber(key: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000;
}

/** The weekday (Monday 0) of a day number: day 0, 1 January 1970, was a Thursday. */
const weekdayOfNumber = (n: number) => (((n + 3) % 7) + 7) % 7;

/** streaks() for a habit due on some weekdays only (see there). */
function streaksOnDays(doneDates: string[], due: number[]): { current: number; best: number } {
  const done = new Set<number>();
  for (const k of doneDates) {
    const n = dayNumber(k);
    if (Number.isFinite(n)) done.add(n);
  }
  if (done.size === 0) return { current: 0, best: 0 };
  let first = Infinity;
  let last = -Infinity;
  for (const n of done) {
    if (n < first) first = n;
    if (n > last) last = n;
  }
  const isDue = (n: number) => due.includes(weekdayOfNumber(n));
  const today = dayNumber(todayKey());

  // current: back from today (from yesterday while today is not done), as far as the first day ever done
  let current = 0;
  let n = done.has(today) ? today : today - 1;
  for (let i = 0; i < STREAK_WALK_MAX && n >= first; i++, n--) {
    if (done.has(n)) current++;
    else if (isDue(n)) break;
  }

  // best: the same rule forward, from the first day done to today (or a later day done, should one have been ticked)
  const end = Math.max(today, last);
  let best = 0;
  let run = 0;
  for (let d = Math.max(first, end - STREAK_WALK_MAX + 1); d <= end; d++) {
    if (done.has(d)) {
      run++;
      if (run > best) best = run;
    } else if (isDue(d)) {
      run = 0;
    }
  }
  return { current, best: Math.max(best, current) };
}

/**
 * Whether a ToDo shows on a day (a date key or a date): a one-off and an every-day ToDo show every day; one that repeats
 * on chosen weekdays (`days`, Monday 0, with repeat 'daily') shows only on those.
 */
export function todoDueOn(t: { repeat?: 'daily'; days?: number[] }, day: string | Date = new Date()): boolean {
  if (t.repeat !== 'daily') return true;
  return habitDueOn(t, day);
}

/** The minutes focused on each day ('YYYY-MM-DD'), from the sessions. */
export function focusMinutesByDay(sessions: readonly { dateKey: string; netSeconds: number }[]): Map<string, number> {
  const secs = new Map<string, number>();
  for (const s of sessions || []) {
    if (!s || typeof s.dateKey !== 'string') continue;
    const n = Number(s.netSeconds);
    if (!(n > 0)) continue;
    secs.set(s.dateKey, (secs.get(s.dateKey) || 0) + n);
  }
  const out = new Map<string, number>();
  for (const [k, n] of secs) out.set(k, Math.round(n / 60));
  return out;
}

/**
 * The run of days with focus that ends today (or yesterday, while today has none yet), and the longest there has been.
 * A day counts once its sessions add up to `minMinutes` (at least one minute; the daily goal when one is passed).
 */
export function focusStreak(
  sessions: readonly { dateKey: string; netSeconds: number }[],
  minMinutes = 1,
): { current: number; best: number } {
  const need = Math.max(1, Math.round(minMinutes) || 1);
  const days: string[] = [];
  for (const [k, min] of focusMinutesByDay(sessions)) if (min >= need && /^\d{4}-\d{2}-\d{2}$/.test(k)) days.push(k);
  return streaks(days);
}

/** Every YouTube link in a text, as written (a fresh expression each time: a global one keeps its place between calls). */
function youTubeLinks(text: string): string[] {
  const re = /(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com|youtube-nocookie\.com|youtu\.be)\/[^\s<>"']*/gi;
  const out: string[] = [];
  for (let m = re.exec(text); m; m = re.exec(text)) out.push(m[0]);
  return out;
}

/** A link to a YouTube video, kept clean: the watch link alone, without what was shared around it or tracking bits. */
export const cleanYouTubeUrl = (videoId: string) => 'https://www.youtube.com/watch?v=' + videoId;

/**
 * Every YouTube video linked in a text (a share, a paste of several links), in the order they appear, once each, as its
 * id and a clean link. A playlist link without a video in it is left out (see isYouTubePlaylist).
 */
export function youTubeLinksIn(text: string): { videoId: string; url: string }[] {
  const out: { videoId: string; url: string }[] = [];
  const seen = new Set<string>();
  const src = String(text || '');
  for (const raw of youTubeLinks(src)) {
    // a link written at the end of a sentence keeps its full stop or bracket outside it
    const link = raw.replace(/[).,;:!?\]}]+$/, '');
    const id = parseYouTubeId(link);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ videoId: id, url: cleanYouTubeUrl(id) });
  }
  // a bare id on its own, as parseYouTubeId has always taken it
  if (!out.length) {
    const id = parseYouTubeId(src);
    if (id) out.push({ videoId: id, url: cleanYouTubeUrl(id) });
  }
  return out;
}

/**
 * Whether a text holds a YouTube playlist link and no video: "/playlist?list=…", or a link with a list and no video id.
 * A video watched inside a playlist ("watch?v=…&list=…") is a video, not a playlist.
 */
export function isYouTubePlaylist(text: string): boolean {
  const src = String(text || '');
  if (youTubeLinksIn(src).length) return false;
  return youTubeLinks(src).some((link) => /[?&]list=[\w-]+/.test(link));
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
