// The Journal's pure part: days, the day's record, prompts, moods, streaks, stats and search. Nothing here touches the
// store, the file system or React Native, so the phone widgets' task handler and the Node tests can load it on its own.
// src/journal.ts re-exports all of it.

import type { DayDone, DoneItem, FocusSession, Habit, JournalEntry } from './store';
import { habitDueOn, streaks, todayKey } from './utils';

const EXCERPT_LEN = 200;

export function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

export function excerptOf(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, EXCERPT_LEN);
}

// ---------- days ----------

export const keyToDate = (key: string) => new Date(key + 'T00:00:00');

export function shiftKey(key: string, days: number): string {
  const d = keyToDate(key);
  d.setDate(d.getDate() + days);
  return todayKey(d);
}

/** Before the cutoff hour the page is about yesterday (a morning looks back); from then on, about today. */
export function journalDayFor(now: Date, cutoffHour: number): string {
  const d = new Date(now);
  if (d.getHours() < cutoffHour) d.setDate(d.getDate() - 1);
  return todayKey(d);
}

export function formatJournalDate(key: string, now = new Date()): string {
  const d = keyToDate(key);
  if (isNaN(d.getTime())) return key;
  const opts: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-IN', opts);
}

/**
 * The page's date for a header too narrow for the whole line: `day` ('17 September', with the year when it is not
 * this year) is the large line, `weekday` ('Wednesday') sits under it.
 */
export function journalDateParts(key: string, now = new Date()): { day: string; weekday: string } {
  const d = keyToDate(key);
  if (isNaN(d.getTime())) return { day: key, weekday: '' };
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return {
    day: d.toLocaleDateString('en-IN', opts),
    weekday: d.toLocaleDateString('en-IN', { weekday: 'long' }),
  };
}

export function relativeDay(key: string, now = new Date()): string {
  if (key === todayKey(now)) return 'Today';
  if (key === shiftKey(todayKey(now), -1)) return 'Yesterday';
  return '';
}

/** True between midnight and the cutoff hour, while the journal's day is still the calendar's yesterday. */
export function journalDayIsYesterday(now: Date, cutoffHour: number): boolean {
  return journalDayFor(now, cutoffHour) !== todayKey(now);
}

// ---------- the day's record, beside the page ----------

/** the earliest a habit's id can date it from: ids the app made start with the time, in base 36 */
const HABIT_IDS_FROM = Date.UTC(2020, 0, 1);

/**
 * The day a habit was made, read from its id where the app made it (the first eight letters are the time in base 36),
 * or '' when the id says nothing: a day before a habit existed never counts it as due.
 */
export function habitSince(h: Pick<Habit, 'id'>): string {
  const m = /^[0-9a-z]{8}/.exec(h.id || '');
  if (!m) return '';
  const ms = parseInt(m[0], 36);
  if (!(ms >= HABIT_IDS_FROM && ms <= Date.now() + 86400000)) return '';
  return todayKey(new Date(ms));
}

/** Each habit's ticks as a set, made once per list of ticks (the store makes a new list on every change). */
const doneSets = new WeakMap<string[], Set<string>>();
function doneSetOf(dates: string[]): Set<string> {
  let set = doneSets.get(dates);
  if (!set) {
    set = new Set(dates);
    doneSets.set(dates, set);
  }
  return set;
}

/** One ToDo or long-term task ticked that day, as it was called then. */
export interface DoneLine extends DoneItem { long: boolean }
export interface DayHabit { habit: Habit; due: boolean; done: boolean }

/** What a calendar day holds outside the page: what was ticked, the habits, and the time focused. */
export interface DayRecord {
  done: DoneLine[];
  /** the habits due that day, ticked or not, then the ones ticked on a day they were not due */
  habits: DayHabit[];
  habitsDue: number;
  /** ticked that day: the due ones, and any ticked on a rest day */
  habitsDone: number;
  sessions: FocusSession[];
  focusMin: number;
}

/** The record of one day ('YYYY-MM-DD'), from the store's record of ticks, its habits and its sessions. */
export function dayRecord(key: string, log: DayDone | undefined, habits: Habit[], sessions: FocusSession[]): DayRecord {
  const done: DoneLine[] = [
    ...(log?.todos || []).map((i) => ({ ...i, long: false })),
    ...(log?.tasks || []).map((i) => ({ ...i, long: true })),
  ];
  const due: DayHabit[] = [];
  const extra: DayHabit[] = [];
  for (const h of habits) {
    const ticked = Array.isArray(h.doneDates) && doneSetOf(h.doneDates).has(key);
    const since = habitSince(h);
    const isDue = habitDueOn(h, key) && !(since && key < since);
    if (isDue) due.push({ habit: h, due: true, done: ticked });
    else if (ticked) extra.push({ habit: h, due: false, done: true });
  }
  const day = sessions.filter((x) => x.dateKey === key);
  const secs = day.reduce((a, x) => a + (Number(x.netSeconds) || 0), 0);
  return {
    done,
    habits: [...due, ...extra],
    habitsDue: due.length,
    habitsDone: due.filter((x) => x.done).length + extra.length,
    sessions: day,
    focusMin: Math.round(secs / 60),
  };
}

export interface DayFact { kind: 'done' | 'habits' | 'focus'; text: string }

/**
 * The day's facts in words, each only when there is something to say: "3 ToDos done", "2 of 3 habits", "45 min
 * focused". `compact` is the archive's row ("3 done", "2/3 habits", "45 min"), which leaves out habits none of which
 * were done. More ticked than were due (a rest day ticked too), or ticks on a day none were due, read as a count alone.
 */
export function dayFacts(r: DayRecord, compact = false): DayFact[] {
  const out: DayFact[] = [];
  const n = r.done.length;
  if (n) out.push({ kind: 'done', text: compact ? n + ' done' : n + (n === 1 ? ' ToDo done' : ' ToDos done') });
  const { habitsDue: due, habitsDone: got } = r;
  if (got > 0 || (due > 0 && !compact)) {
    const text = due > 0 && got <= due
      ? (compact ? got + '/' + due + ' habits' : got + ' of ' + due + (due === 1 ? ' habit' : ' habits'))
      : got + (got === 1 ? ' habit' : ' habits');
    out.push({ kind: 'habits', text });
  }
  if (r.focusMin > 0) out.push({ kind: 'focus', text: compact ? r.focusMin + ' min' : r.focusMin + ' min focused' });
  return out;
}

// ---------- prompts, moods ----------

export const PROMPTS = [
  'What took most of your energy today?',
  'One thing you understood better today.',
  'What would you do differently tomorrow?',
  'What are you quietly proud of?',
  'Where did your attention go today?',
  'What felt harder than it should have?',
  'Who made today better, and how?',
  'What did you learn outside a lesson?',
  'What is one thing you want to remember from today?',
  'What are you avoiding, and why?',
  'What small win deserves credit?',
  'What question is still on your mind?',
  'How did you look after yourself today?',
  'What surprised you today?',
  'Which moment would you replay?',
  'What drained you, and what restored you?',
  'What did you start that you want to finish?',
  'What worries you less than it did yesterday?',
  'What would make tomorrow a good day?',
  'What did you say yes to, and what did you say no to?',
  'Describe today in three words, then explain one.',
  'What helped you focus today?',
  'What are you grateful for right now?',
  'What idea keeps coming back to you?',
  'What did you notice that you usually miss?',
  'Which conversation stayed with you?',
  'Where did you feel most like yourself?',
  'What did you put off, and what would starting look like?',
  'What is one kind thing you did or saw?',
  'What would you tell yourself from a week ago?',
  'What made you laugh today?',
  'What progress did you make that nobody saw?',
  'What are you looking forward to?',
  'What did today teach you about how you work best?',
  'Which plan changed, and was that for the better?',
  'What do you need more of this week?',
  'What is one thing you can let go of?',
  'How did your body feel today?',
  'What would a great study session tomorrow look like?',
  'What are you curious to try next?',
];

/** The same day always gets the same prompt. */
export function promptFor(key: string): { id: string; text: string } {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const i = h % PROMPTS.length;
  return { id: 'p' + i, text: PROMPTS[i] };
}

// a filled sun for Great: stars mean the day's rating, and sparkles would read as an AI feature
export const MOODS: { value: 1 | 2 | 3 | 4 | 5; label: string; icon: string }[] = [
  { value: 1, label: 'Rough', icon: 'rainy-outline' },
  { value: 2, label: 'Low', icon: 'cloud-outline' },
  { value: 3, label: 'Okay', icon: 'partly-sunny-outline' },
  { value: 4, label: 'Good', icon: 'sunny-outline' },
  { value: 5, label: 'Great', icon: 'sunny' },
];

// ---------- archive ----------

/** The average rating of a day, averaged over days: a day with two rated entries counts once, at their mean. */
function averagePerDay(rated: JournalEntry[]): number | null {
  if (!rated.length) return null;
  const byDay = new Map<string, number[]>();
  for (const e of rated) {
    const list = byDay.get(e.dateKey);
    if (list) list.push(e.rating as number);
    else byDay.set(e.dateKey, [e.rating as number]);
  }
  let sum = 0;
  for (const list of byDay.values()) sum += list.reduce((a, r) => a + r, 0) / list.length;
  return sum / byDay.size;
}

/**
 * The run of days written (an entry with words) that ends on the journal day, or on the day before while that day is
 * still blank, and the longest run there has been. Counted from the journal's own day: before the cutoff hour the
 * calendar has already turned over and the journal has not, and a calendar count would lose the run in those small
 * hours. A mood alone is not writing, so it neither starts a run nor keeps one going.
 */
export function journalStreak(entries: JournalEntry[], cutoffHour: number, now = new Date()): { current: number; best: number } {
  const written = new Set(entries.filter((e) => e.wordCount > 0).map((e) => e.dateKey));
  const day = journalDayFor(now, cutoffHour);
  let current = 0;
  for (let key = written.has(day) ? day : shiftKey(day, -1); written.has(key); key = shiftKey(key, -1)) current++;
  return { current, best: Math.max(current, streaks([...written]).best) };
}

export function journalStats(entries: JournalEntry[], cutoffHour: number, now = new Date()) {
  const days = [...new Set(entries.map((e) => e.dateKey))];
  // the same run the Journal's own header counts
  const { current, best } = journalStreak(entries, cutoffHour, now);
  const rated = entries.filter((e) => e.rating);
  return {
    entries: entries.length,
    days: days.length,
    words: entries.reduce((a, e) => a + e.wordCount, 0),
    current,
    best,
    /** days with at least one rated entry */
    ratedDays: new Set(rated.map((e) => e.dateKey)).size,
    avgRating: averagePerDay(rated),
  };
}

/** Entries about the same calendar day in earlier years, and about the same day a month earlier. */
export function onThisDay(entries: JournalEntry[], key: string): JournalEntry[] {
  const monthAgo = shiftMonth(key, -1);
  return entries
    .filter((e) => (e.dateKey.slice(5) === key.slice(5) && e.dateKey < key) || e.dateKey === monthAgo)
    .sort((a, b) => b.dateKey.localeCompare(a.dateKey));
}

function shiftMonth(key: string, months: number): string {
  const d = keyToDate(key);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return todayKey(d);
}

export function searchTokens(q: string): string[] {
  return q.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Every token must appear in the title, the text or a tag. */
export function entryMatches(e: JournalEntry, body: string | undefined, tokens: string[]): boolean {
  if (!tokens.length) return true;
  const hay = (e.title + '\n' + (body ?? e.excerpt) + '\n' + e.tags.join(' ')).toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

// ---------- moods over time ----------

type Scale = 1 | 2 | 3 | 4 | 5;

/** One calendar day of the journal, for a strip of moods and ratings. */
export interface MoodDay {
  dateKey: string;
  /** the day's mood, the mean of its entries' rounded to the nearest step; null when none was set */
  mood: Scale | null;
  /** the day's rating in stars, the same way */
  rating: Scale | null;
  /** words written that day, across its entries */
  words: number;
  entries: number;
}

const meanStep = (values: number[]): Scale | null =>
  (values.length ? (Math.min(5, Math.max(1, Math.round(values.reduce((a, v) => a + v, 0) / values.length))) as Scale) : null);

/**
 * The last `days` calendar days ending on `end` (today by default), oldest first, each with its mood, rating and words.
 * A day with no entry is there too, holding nothing, so a strip always has its full width.
 */
export function moodSeries(entries: readonly JournalEntry[], days = 30, end: string = todayKey()): MoodDay[] {
  const n = Math.max(1, Math.min(400, Math.floor(days) || 1));
  const from = shiftKey(end, -(n - 1));
  const byDay = new Map<string, JournalEntry[]>();
  for (const e of entries || []) {
    if (!e || typeof e.dateKey !== 'string' || e.dateKey < from || e.dateKey > end) continue;
    const list = byDay.get(e.dateKey);
    if (list) list.push(e);
    else byDay.set(e.dateKey, [e]);
  }
  const out: MoodDay[] = [];
  for (let i = 0; i < n; i++) {
    const key = shiftKey(from, i);
    const list = byDay.get(key) || [];
    out.push({
      dateKey: key,
      mood: meanStep(list.filter((e) => e.mood).map((e) => e.mood as number)),
      rating: meanStep(list.filter((e) => e.rating).map((e) => e.rating as number)),
      words: list.reduce((a, e) => a + (Number(e.wordCount) || 0), 0),
      entries: list.length,
    });
  }
  return out;
}

/** How focus went on good days against the rest, once there is enough to say (see moodFocusLink). */
export interface MoodFocusLink {
  /** days rated 4 or more stars (or with a mood of Good or Great when not rated) */
  goodDays: number;
  otherDays: number;
  /** the mean minutes focused on those days, and on the other days with a mood or a rating */
  goodMin: number;
  otherMin: number;
}

/** at least this many days on each side before the journal says anything about focus and good days */
export const MOOD_LINK_MIN_DAYS = 5;

/**
 * Whether good days come with more focus: over the last `days` days, the mean minutes focused on days rated well
 * against the other days that were rated or given a mood. Null until each side has MOOD_LINK_MIN_DAYS days, so a line
 * built on it never rests on two or three days.
 */
export function moodFocusLink(
  entries: readonly JournalEntry[],
  sessions: readonly { dateKey: string; netSeconds: number }[],
  days = 60,
  end: string = todayKey(),
): MoodFocusLink | null {
  const series = moodSeries(entries, days, end);
  const secs = new Map<string, number>();
  for (const s of sessions || []) {
    if (!s || typeof s.dateKey !== 'string') continue;
    const n = Number(s.netSeconds);
    if (n > 0) secs.set(s.dateKey, (secs.get(s.dateKey) || 0) + n);
  }
  const good: number[] = [];
  const other: number[] = [];
  for (const d of series) {
    const score = d.rating ?? d.mood;
    if (score == null) continue;
    (score >= 4 ? good : other).push((secs.get(d.dateKey) || 0) / 60);
  }
  if (good.length < MOOD_LINK_MIN_DAYS || other.length < MOOD_LINK_MIN_DAYS) return null;
  const mean = (a: number[]) => Math.round(a.reduce((x, v) => x + v, 0) / a.length);
  return { goodDays: good.length, otherDays: other.length, goodMin: mean(good), otherMin: mean(other) };
}
