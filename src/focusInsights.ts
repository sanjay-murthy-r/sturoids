// What the Deep Work history can say about the sessions beyond their totals: how this week is going against the last by
// the same day, the subjects that have gone quiet, and the time of day the focus (and the deep focus) comes at. Pure,
// with no store, so the Node tests read it as it is (scripts/test-focus.js).

import { subjectKey } from './scores';
import { todayKey } from './utils';

/** The parts of a session these read. */
export interface SessionLike {
  dateKey: string; endedAt: number; netSeconds: number; subject?: string; manual?: boolean; rating?: 1 | 2 | 3;
}

/** `key` moved by `days` (negative is back), as a day key. */
const shiftDay = (key: string, days: number) => {
  const d = new Date(key + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return todayKey(d);
};

/** Days from `from` to `to`, both day keys; worked from noon so a change of clocks never makes a day short. */
const daysBetween = (from: string, to: string) =>
  Math.round((new Date(to + 'T12:00:00').getTime() - new Date(from + 'T12:00:00').getTime()) / 86400000);

/** The Monday that starts the week of `today`: weeks run Monday to Sunday, as the Planner's do. */
export function mondayOf(today: string): string {
  const d = new Date(today + 'T00:00:00');
  return shiftDay(today, -((d.getDay() + 6) % 7));
}

const secsOf = (s: SessionLike) => {
  const n = Number(s?.netSeconds);
  return n > 0 ? n : 0;
};

/* ---------------------------------------------------------------- the week against the last */

export interface WeekPace {
  /** whole minutes this week, Monday to today */
  thisMin: number;
  /** whole minutes last week from its Monday to the same day of the week as today */
  lastSoFarMin: number;
  /** whole minutes in all of last week */
  lastMin: number;
  /** this week less last week by the same day, in minutes; within five minutes either way is called level (0) */
  aheadMin: number;
}

/**
 * This week against last week, day for day: on a Wednesday, Monday to Wednesday of each. Null when last week had no
 * focus at all, since there is nothing to be ahead of or behind.
 */
export function weekPace(sessions: readonly SessionLike[], today: string = todayKey()): WeekPace | null {
  const mon = mondayOf(today);
  const lastMon = shiftDay(mon, -7);
  const lastSame = shiftDay(today, -7);
  const lastSun = shiftDay(mon, -1);
  let thisSec = 0;
  let soFar = 0;
  let last = 0;
  for (const s of sessions || []) {
    const k = s?.dateKey;
    if (typeof k !== 'string') continue;
    const n = secsOf(s);
    if (k >= mon && k <= today) thisSec += n;
    if (k >= lastMon && k <= lastSun) {
      last += n;
      if (k <= lastSame) soFar += n;
    }
  }
  if (last <= 0) return null;
  const thisMin = Math.round(thisSec / 60);
  const lastSoFarMin = Math.round(soFar / 60);
  const diff = thisMin - lastSoFarMin;
  return { thisMin, lastSoFarMin, lastMin: Math.round(last / 60), aheadMin: Math.abs(diff) < 5 ? 0 : diff };
}

/* ---------------------------------------------------------------- subjects gone quiet */

export interface QuietSubject {
  key: string;
  /** as it was last written */
  name: string;
  /** days since its last session */
  daysSince: number;
  /** whole minutes on it over the days looked back over */
  min: number;
}

/**
 * The subjects focused on within the last `within` days (28 by default) and not at all in the last `quiet` (7): the
 * ones a week of other work has let slip. The most worked on first, since those are the ones most missed; at most
 * `max`. A subject needs at least 20 minutes over the stretch to count, so one stray session is never nagged about.
 */
export function quietSubjects(
  sessions: readonly SessionLike[],
  today: string = todayKey(),
  opts: { within?: number; quiet?: number; max?: number } = {},
): QuietSubject[] {
  const within = opts.within ?? 28;
  const quiet = opts.quiet ?? 7;
  const max = opts.max ?? 3;
  const from = shiftDay(today, -within);
  const by = new Map<string, { name: string; last: string; lastAt: number; secs: number }>();
  for (const s of sessions || []) {
    const k = s?.dateKey;
    if (typeof k !== 'string' || k < from || k > today) continue;
    const raw = typeof s.subject === 'string' ? s.subject.trim().replace(/\s+/g, ' ') : '';
    if (!raw) continue;
    const key = subjectKey(raw);
    const had = by.get(key);
    const at = Number(s.endedAt) || 0;
    if (!had) by.set(key, { name: raw, last: k, lastAt: at, secs: secsOf(s) });
    else {
      had.secs += secsOf(s);
      if (k > had.last || (k === had.last && at > had.lastAt)) { had.last = k; had.lastAt = at; had.name = raw; }
    }
  }
  const out: QuietSubject[] = [];
  for (const [key, v] of by) {
    const daysSince = daysBetween(v.last, today);
    const min = Math.round(v.secs / 60);
    if (daysSince >= quiet && min >= 20) out.push({ key, name: v.name, daysSince, min });
  }
  return out.sort((a, b) => b.min - a.min || a.daysSince - b.daysSince || a.name.localeCompare(b.name)).slice(0, max);
}

/* ---------------------------------------------------------------- the time of day */

export type DayPart = 'morning' | 'afternoon' | 'evening' | 'night';

/** The day's four parts, in the order a day runs: morning from 5, afternoon from 12, evening from 17, night from 21. */
export const DAY_PARTS: readonly { key: DayPart; label: string; from: number }[] = [
  { key: 'morning', label: 'Morning', from: 5 },
  { key: 'afternoon', label: 'Afternoon', from: 12 },
  { key: 'evening', label: 'Evening', from: 17 },
  { key: 'night', label: 'Night', from: 21 },
];

/** The part of the day an hour (0 to 23) falls in; the small hours before 5 are the night before's. */
export function partOfHour(hour: number): DayPart {
  if (hour >= 21 || hour < 5) return 'night';
  if (hour >= 17) return 'evening';
  if (hour >= 12) return 'afternoon';
  return 'morning';
}

export interface FocusHours {
  /** each part of the day, in order: whole minutes begun in it, and the minutes of sessions rated deep */
  parts: { key: DayPart; label: string; min: number; deepMin: number }[];
  /** the part with the most focus, or null with none */
  best: DayPart | null;
  /**
   * the part the sessions rated deep come at most, when at least three sessions were rated and it is not simply the
   * busiest part; null otherwise
   */
  deepest: DayPart | null;
  /** whole minutes in all */
  totalMin: number;
}

/**
 * When the focus of the last `days` days (30 by default) came, by the part of the day each session began in. A session
 * logged by hand has no real time of day, so it is left out.
 */
export function focusHours(sessions: readonly SessionLike[], today: string = todayKey(), days = 30): FocusHours {
  const from = shiftDay(today, -(days - 1));
  const secs = new Map<DayPart, number>();
  const deep = new Map<DayPart, number>();
  let rated = 0;
  for (const s of sessions || []) {
    const k = s?.dateKey;
    if (typeof k !== 'string' || k < from || k > today || s.manual) continue;
    const n = secsOf(s);
    const end = Number(s.endedAt);
    if (!n || !(end > 0)) continue;
    const part = partOfHour(new Date(end - n * 1000).getHours());
    secs.set(part, (secs.get(part) || 0) + n);
    if (s.rating) rated++;
    if (s.rating === 3) deep.set(part, (deep.get(part) || 0) + n);
  }
  const parts = DAY_PARTS.map((p) => ({
    key: p.key, label: p.label, min: Math.round((secs.get(p.key) || 0) / 60), deepMin: Math.round((deep.get(p.key) || 0) / 60),
  }));
  const most = (pick: (p: (typeof parts)[number]) => number) => {
    let top: (typeof parts)[number] | null = null;
    for (const p of parts) if (pick(p) > 0 && (!top || pick(p) > pick(top))) top = p;
    return top?.key ?? null;
  };
  const best = most((p) => p.min);
  const deepTop = rated >= 3 ? most((p) => p.deepMin) : null;
  return { parts, best, deepest: deepTop && deepTop !== best ? deepTop : null, totalMin: parts.reduce((a, p) => a + p.min, 0) };
}
