import { toMinutes } from './utils';

/** What a Planner block needs to open Deep Work: its subject and start, end. */
export interface BlockLike { subject: string; start: string; end: string }

/**
 * The Deep Work a block opens: on its subject, set to the block's length, or, while the block is on now (`onNow`, the
 * block is today's and the clock is inside it), to what is left of it. Shared by the Planner and Today's Start pill.
 * At least one minute.
 */
export function blockFocusParams(b: BlockLike, onNow: boolean, now: Date = new Date()): { subject: string; minutes: number } {
  const m = now.getHours() * 60 + now.getMinutes();
  const start = toMinutes(b.start);
  const end = toMinutes(b.end);
  const length = end > start && start >= 0 ? end - start : 0;
  const minutes = onNow && m >= start && m < end ? end - m : length;
  return { subject: b.subject, minutes: Math.max(1, minutes) };
}

/** Whether a block is on at a minute of the day: from its start, up to (not at) its end. */
export function blockIsOn(b: BlockLike, minuteOfDay: number): boolean {
  const start = toMinutes(b.start);
  const end = toMinutes(b.end);
  return start >= 0 && start <= minuteOfDay && minuteOfDay < end;
}

/** A block as the week keeps it. */
export interface WeekBlock extends BlockLike { id: string; color: string }
/** The week's blocks by day name ('Mon' … 'Sun'). */
export type WeekLike = Record<string, readonly WeekBlock[] | undefined>;

/** "  Physics " and "physics" are one subject. */
const keyOf = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** The days in the order the week is read. */
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * The colour a new block of `subject` takes: that of a block with the same subject already in the week, `prefer`'s day
 * first, then Monday on. Null when the subject is new.
 */
export function colorForSubject(week: WeekLike, subject: string, prefer?: string): string | null {
  const k = keyOf(subject);
  if (!k) return null;
  const days = prefer ? [prefer, ...WEEK.filter((d) => d !== prefer)] : WEEK;
  for (const d of days) {
    const hit = (week[d] || []).find((b) => keyOf(b.subject) === k && !!b.color);
    if (hit) return hit.color;
  }
  return null;
}

/**
 * The same block on other days: a block with the same subject, start and end on any day but `day`. These are what
 * "Change it on every day it repeats" changes along with it.
 */
export function repeatsOf(week: WeekLike, day: string, b: BlockLike): { day: string; id: string }[] {
  const k = keyOf(b.subject);
  const out: { day: string; id: string }[] = [];
  for (const d of WEEK) {
    if (d === day) continue;
    for (const x of week[d] || []) {
      if (keyOf(x.subject) === k && x.start === b.start && x.end === b.end) out.push({ day: d, id: x.id });
    }
  }
  return out;
}

/** The first block of `list` that overlaps start–end (ignoring `ignore` ids), or null. */
export function clashIn(list: readonly WeekBlock[] | undefined, start: string, end: string, ignore: readonly string[] = []): WeekBlock | null {
  const s = toMinutes(start);
  const e = toMinutes(end);
  for (const b of list || []) {
    if (ignore.includes(b.id)) continue;
    if (toMinutes(b.start) < e && s < toMinutes(b.end)) return b;
  }
  return null;
}

/** The next date that falls on weekday `dayIdx` (0 Monday): today itself when today is that day. */
export function nextDateOf(dayIdx: number, from: Date = new Date()): Date {
  const today = (from.getDay() + 6) % 7;
  const ahead = (dayIdx - today + 7) % 7;
  return new Date(from.getFullYear(), from.getMonth(), from.getDate() + ahead);
}

/** "Fri 31 Oct": a date short, as the Planner's line under the wheel says it. */
export function fmtDayShort(d: Date): string {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return WEEK[(d.getDay() + 6) % 7] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
}
