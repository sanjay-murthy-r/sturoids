// Progress reports: the app's data for a range of days turned into sections (figures, tables, charts), then into a
// printable A4 page (HTML for expo-print) or a CSV text. Everything here is pure: no React Native, no storage, so the
// report page, every screen's Export and the Node test (scripts/test-report.js) all build from the same code.
//
// Privacy: a journal entry's words (its title and its text) go in only when the caller passes the bodies (the owner
// ticked "Include journal text" with the journal open); a locked journal or locked notes are left out entirely, with a
// line that says so.

import type { DailyTask, DayDone, FocusSession, Habit, JournalEntry, Mission, Note, PlannerWeek } from '../store';
import type { ScoreNode, ScoreTag } from '../scores';
import { indexScores, isTopExam, resultOf, rootExamOf, subjectKey, topExams, whenOf, fmtPct, fmtMark } from '../scores';
import { subjectStats } from '../analytics';
import { DAY_NAMES, habitDueOn, streaks, todayKey } from '../utils';
import { habitSince, keyToDate, moodSeries, shiftKey, MOODS } from '../journalCore';

// ---------- sections and ranges ----------

export type SectionKey =
  | 'overview' | 'tasks' | 'todos' | 'longterm' | 'habits' | 'focus' | 'planner' | 'journal' | 'scores' | 'notes';

/** The full report's sections, in the order they print. */
export const SECTION_ORDER: readonly SectionKey[] = ['overview', 'tasks', 'habits', 'focus', 'planner', 'journal', 'scores', 'notes'];
/**
 * Every section in print order, the single summaries' own among them: 'todos' and 'longterm' are the two halves of
 * 'tasks', for a ToDos summary or a long-term tasks summary on its own.
 */
export const BUILD_ORDER: readonly SectionKey[] = ['overview', 'tasks', 'todos', 'longterm', 'habits', 'focus', 'planner', 'journal', 'scores', 'notes'];
export const SECTION_LABEL: Record<SectionKey, string> = {
  overview: 'Overview',
  tasks: 'ToDos and long-term tasks',
  todos: 'ToDos',
  longterm: 'Long-term tasks',
  habits: 'Habits',
  focus: 'Deep Work',
  planner: 'Planner week',
  journal: 'Journal',
  scores: 'Scores',
  notes: 'Notes',
};
/** The tool each section is drawn from: an archived tool's section is left out. Overview draws from all of them. */
export const SECTION_TOOL: Record<SectionKey, string | null> = {
  overview: null, tasks: 'tasks', todos: 'tasks', longterm: 'tasks', habits: 'planner', focus: 'focus', planner: 'planner', journal: 'journal', scores: 'scores', notes: 'notes',
};

export type RangeKind = 'week' | 'lastweek' | 'month' | '30d' | 'custom' | 'all' | 'day';

export interface DateRange { from: string; to: string; label: string }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Monday 0 of a date key. */
const weekdayOf = (key: string) => (keyToDate(key).getDay() + 6) % 7;

/** "Mon 26 Oct", always the same in every locale (the Node test and the phone agree). */
export function fmtDay(key: string, withYear = false): string {
  if (!KEY_RE.test(key)) return key;
  const [y, m, d] = key.split('-').map(Number);
  return DAY_NAMES[weekdayOf(key)] + ' ' + d + ' ' + MONTHS[m - 1] + (withYear ? ' ' + y : '');
}

/** "26 Oct 2026". */
export function fmtDate(key: string): string {
  if (!KEY_RE.test(key)) return key;
  const [y, m, d] = key.split('-').map(Number);
  return d + ' ' + MONTHS[m - 1] + ' ' + y;
}

/** "1 to 26 Oct 2026", "28 Sep to 26 Oct 2026", "26 Oct 2026". */
export function fmtSpan(from: string, to: string): string {
  if (from === to) return fmtDate(from);
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  if (fy === ty && fm === tm) return fd + ' to ' + fmtDate(to);
  if (fy === ty) return fd + ' ' + MONTHS[fm - 1] + ' to ' + fmtDate(to);
  return fmtDate(from) + ' to ' + fmtDate(to);
}

/** 45 min, 2 h, 3 h 20 min. */
export function fmtMin(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? h + ' h ' + r + ' min' : h + ' h';
}

/**
 * The days a range covers. `custom` takes `from` and `to` (swapped when given the wrong way round, and never past
 * today); `all` starts on `earliest` (the first day anything was recorded); `day` is the one day `from` names.
 */
export function rangeOf(kind: RangeKind, today: string, opts: { from?: string; to?: string; earliest?: string } = {}): DateRange {
  const clamp = (k: string | undefined) => (k && KEY_RE.test(k) ? (k > today ? today : k) : today);
  if (kind === 'day') {
    const d = clamp(opts.from);
    return { from: d, to: d, label: fmtDay(d, true) };
  }
  if (kind === 'week') {
    const from = shiftKey(today, -weekdayOf(today));
    return { from, to: today, label: 'This week, ' + fmtSpan(from, today) };
  }
  if (kind === 'lastweek') {
    const to = shiftKey(today, -weekdayOf(today) - 1);
    const from = shiftKey(to, -6);
    return { from, to, label: 'Last week, ' + fmtSpan(from, to) };
  }
  if (kind === 'month') {
    const from = today.slice(0, 8) + '01';
    const [y, m] = today.split('-').map(Number);
    return { from, to: today, label: MONTHS_LONG[m - 1] + ' ' + y };
  }
  if (kind === '30d') {
    const from = shiftKey(today, -29);
    return { from, to: today, label: 'Last 30 days, ' + fmtSpan(from, today) };
  }
  if (kind === 'all') {
    const from = opts.earliest && KEY_RE.test(opts.earliest) && opts.earliest < today ? opts.earliest : today;
    return { from, to: today, label: 'Everything, ' + fmtSpan(from, today) };
  }
  let from = clamp(opts.from);
  let to = clamp(opts.to);
  if (from > to) [from, to] = [to, from];
  return { from, to, label: fmtSpan(from, to) };
}

/** A calendar month as a range, cut at today: "2026-10" is 1 to 26 Oct on the 26th. */
export function monthRange(ym: string, today: string): DateRange {
  const from = ym + '-01';
  const [y, m] = ym.split('-').map(Number);
  const last = todayKey(new Date(y, m, 0));
  const to = last > today ? today : last;
  return { from, to: to < from ? from : to, label: MONTHS_LONG[m - 1] + ' ' + y };
}

/** Every day of a range, oldest first (at most 800, so a damaged range can never run away). */
export function daysIn(r: DateRange): string[] {
  const out: string[] = [];
  for (let k = r.from; k <= r.to && out.length < 800; k = shiftKey(k, 1)) out.push(k);
  return out;
}

const inRange = (k: string | undefined, r: DateRange) => !!k && k >= r.from && k <= r.to;

// ---------- what a report is made of ----------

export interface Stat { label: string; value: string }

export type Block =
  | { t: 'stats'; items: Stat[] }
  | { t: 'table'; title: string; columns: string[]; rows: string[][]; right?: number[]; more?: number }
  | { t: 'bars'; title: string; labels: string[]; values: number[]; unit: 'min' | 'done' }
  | { t: 'line'; title: string; labels: string[]; values: number[] }
  | { t: 'grid'; title: string; days: string[]; rows: { label: string; cells: GridCell[] }[] }
  | { t: 'strip'; title: string; days: { key: string; mood: number | null; rating: number | null }[] }
  | { t: 'text'; title: string; sub?: string; body: string }
  | { t: 'note'; text: string };

/** A habit's day: ticked, due and not ticked, not due (a rest day, or before it existed), or still to come. */
export type GridCell = 'done' | 'missed' | 'rest' | 'ahead';

export interface Section {
  key: SectionKey;
  title: string;
  /** the section's headline figures: the preview card shows these */
  summary: Stat[];
  blocks: Block[];
  /** said in place of the blocks when the range holds nothing for it */
  empty?: string;
}

export interface Report {
  title: string;
  /** whose report: the profile's name, or the owner's own */
  profile: string;
  range: DateRange;
  generatedAt: Date;
  sections: Section[];
}

/** The store's collections a report reads. */
export interface ReportSource {
  dailyTasks: readonly DailyTask[];
  missions: readonly Mission[];
  doneLog: Readonly<Record<string, DayDone>>;
  habits: readonly Habit[];
  sessions: readonly FocusSession[];
  planner: PlannerWeek;
  journal: readonly JournalEntry[];
  scores: readonly ScoreNode[];
  scoreTags?: readonly ScoreTag[];
  notes: readonly Note[];
}

export interface ReportOptions {
  range: DateRange;
  sections: readonly SectionKey[];
  profile?: string;
  title?: string;
  generatedAt?: Date;
  /** today, for streaks and what is overdue; the day `generatedAt` falls on when left out */
  today?: string;
  /** false while the journal is locked and not unlocked: it is left out, with a line that says so */
  journalOpen: boolean;
  /** false while the Notes tool is locked and not unlocked */
  notesOpen: boolean;
  /** whether one locked note is open this session; a locked note is left out otherwise */
  noteOpen?: (id: string) => boolean;
  /** the entries' full texts by id: given only when the owner ticked "Include journal text" (and the journal is open) */
  journalText?: ReadonlyMap<string, string> | null;
  /** tools that are archived: their sections are left out */
  archived?: readonly string[];
  /** one subject only: Deep Work, the Planner, Scores and Notes keep just what is about it */
  subject?: string;
  /** Scores: these exams (oldest first), as Analytics has them in view */
  examIds?: readonly string[];
  /** Scores: one exam and its subjects */
  examId?: string;
  /** Scores: what the exams in view are, "Board mocks" */
  scopeLabel?: string;
}

/** The first day anything was recorded, for an "everything" range; today when there is nothing. */
export function earliestKey(src: ReportSource, today: string): string {
  let min = today;
  const see = (k: unknown) => { if (typeof k === 'string' && KEY_RE.test(k) && k < min) min = k; };
  for (const k of Object.keys(src.doneLog || {})) see(k);
  for (const s of src.sessions || []) see(s.dateKey);
  for (const e of src.journal || []) see(e.dateKey);
  for (const h of src.habits || []) for (const d of h.doneDates || []) see(d);
  for (const n of src.scores || []) if (n.kind === 'exam') see(whenOf(n));
  for (const n of src.notes || []) if (n.createdAt) see(todayKey(new Date(n.createdAt)));
  return min;
}

/** The sections a report can have with these tools archived, in order. */
export function availableSections(archived: readonly string[] = []): SectionKey[] {
  return SECTION_ORDER.filter((k) => !SECTION_TOOL[k] || !archived.includes(SECTION_TOOL[k] as string));
}

const plural = (n: number, one: string, many = one + 's') => n + ' ' + (n === 1 ? one : many);
const pctOf = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

/** A long range is charted by week (the Monday it starts on) so its bars stay readable. */
const CHART_DAYS = 62;
function bucket(days: string[], value: (k: string) => number): { labels: string[]; values: number[]; byWeek: boolean } {
  if (days.length <= CHART_DAYS) {
    return { labels: days.map((k) => fmtDay(k)), values: days.map(value), byWeek: false };
  }
  const labels: string[] = [];
  const values: number[] = [];
  for (const k of days) {
    const wd = weekdayOf(k);
    if (!labels.length || wd === 0) { labels.push('Week of ' + fmtDay(k)); values.push(0); }
    values[values.length - 1] += value(k);
  }
  return { labels, values, byWeek: true };
}

// ---------- the sections ----------

interface Ctx { src: ReportSource; o: ReportOptions; days: string[]; today: string; key: string | null }

function tasksSection({ src, o, days, today }: Ctx, part: 'both' | 'todos' | 'longterm' = 'both'): Section {
  const wantTodos = part !== 'longterm';
  const wantTasks = part !== 'todos';
  const done: string[][] = [];
  let todos = 0;
  let tasks = 0;
  let busiest = { key: '', n: 0 };
  for (const k of days) {
    const log = src.doneLog?.[k];
    const t = wantTodos ? log?.todos || [] : [];
    const l = wantTasks ? log?.tasks || [] : [];
    todos += t.length;
    tasks += l.length;
    if (t.length + l.length > busiest.n) busiest = { key: k, n: t.length + l.length };
    for (const i of t) done.push([fmtDay(k, true), i.title || 'Untitled', 'ToDo']);
    for (const i of l) done.push([fmtDay(k, true), i.title || 'Untitled', 'Long-term task']);
  }
  const missions = (wantTasks ? src.missions || [] : []).filter((m) => !m.done || inRange(m.doneOn, o.range) || inRange(m.deadline, o.range));
  const missionRows = [...missions]
    .sort((a, b) => (a.deadline || '').localeCompare(b.deadline || ''))
    .map((m) => {
      const steps = m.subtasks || [];
      const status = m.done ? 'Done' + (m.doneOn ? ' ' + fmtDay(m.doneOn) : '') : m.deadline && m.deadline < today ? 'Overdue' : 'Open';
      return [m.title || 'Untitled', m.deadline ? fmtDate(m.deadline) : '', steps.length ? steps.filter((s) => s.done).length + ' of ' + steps.length : '', status];
    });
  const openCount = wantTasks ? (src.missions || []).filter((m) => !m.done).length : 0;
  const overdue = wantTasks ? (src.missions || []).filter((m) => !m.done && m.deadline && m.deadline < today).length : 0;
  const summary: Stat[] = [];
  if (wantTodos) summary.push({ label: 'ToDos done', value: String(todos) });
  if (wantTasks) summary.push({ label: 'Long-term tasks done', value: String(tasks) });
  if (openCount) summary.push({ label: 'Long-term tasks open', value: String(openCount) + (overdue ? ' (' + overdue + ' overdue)' : '') });
  if (busiest.n > 1) summary.push({ label: 'Busiest day', value: fmtDay(busiest.key) + ', ' + busiest.n + ' done' });
  const blocks: Block[] = [{ t: 'stats', items: summary }];
  if (todos + tasks > 0 && days.length > 1) {
    const b = bucket(days, (k) => (wantTodos ? src.doneLog?.[k]?.todos?.length || 0 : 0) + (wantTasks ? src.doneLog?.[k]?.tasks?.length || 0 : 0));
    blocks.push({ t: 'bars', title: b.byWeek ? 'Done each week' : 'Done each day', labels: b.labels, values: b.values, unit: 'done' });
  }
  if (done.length) {
    blocks.push(part === 'both'
      ? { t: 'table', title: 'What was ticked', columns: ['Day', 'Item', 'Kind'], rows: done }
      : { t: 'table', title: 'What was ticked', columns: ['Day', 'Item'], rows: done.map((r) => r.slice(0, 2)) });
  }
  if (missionRows.length) blocks.push({ t: 'table', title: 'Long-term tasks', columns: ['Task', 'Deadline', 'Steps', 'Status'], rows: missionRows });
  const key: SectionKey = part === 'both' ? 'tasks' : part;
  return {
    key, title: SECTION_LABEL[key], summary, blocks,
    empty: todos + tasks + missionRows.length === 0
      ? (part === 'longterm' ? 'No long-term tasks were done or due in this range.' : 'Nothing was ticked in this range.')
      : undefined,
  };
}

/** A habit's days in the grid: done, missed, a rest day, or still ahead of today. */
function habitCell(h: Habit, k: string, today: string, done: Set<string>): GridCell {
  if (k > today) return 'ahead';
  if (done.has(k)) return 'done';
  const since = habitSince(h);
  if ((since && k < since) || !habitDueOn(h, k)) return 'rest';
  // today is not missed until it is over
  if (k === today) return 'ahead';
  return 'missed';
}

const GRID_DAYS = 35;

function habitsSection({ src, days, today }: Ctx): Section {
  const habits = src.habits || [];
  const past = days.filter((k) => k <= today);
  let allDue = 0;
  let allDone = 0;
  let top: { title: string; n: number } | null = null;
  const rows = habits.map((h) => {
    const set = new Set(h.doneDates || []);
    let due = 0;
    let got = 0;
    let kept = 0;
    for (const k of past) {
      const c = habitCell(h, k, today, set);
      // a tick on a rest day is done, but only a tick on a due day is a day kept
      if (c === 'done') { got++; if (habitDueOn(h, k)) { kept++; due++; } }
      else if (c === 'missed') due++;
    }
    allDue += due;
    allDone += kept;
    const s = streaks(h.doneDates || [], h.days, keyToDate(today));
    if (s.current > 0 && (!top || s.current > top.n)) top = { title: h.title, n: s.current };
    return [h.title || 'Habit', String(got), String(due), due ? pctOf(kept, due) + '%' : '', String(s.current), String(s.best)];
  });
  const summary: Stat[] = habits.length ? [
    { label: 'Habits', value: String(habits.length) },
    { label: 'Kept', value: allDue ? pctOf(allDone, allDue) + '% of due days' : 'None due yet' },
  ] : [];
  const best = top as { title: string; n: number } | null;
  if (best) summary.push({ label: 'Longest run going', value: best.title + ', ' + plural(best.n, 'day') });
  const blocks: Block[] = [];
  if (habits.length) {
    blocks.push({ t: 'stats', items: summary });
    const gridDays = days.slice(-GRID_DAYS);
    blocks.push({
      t: 'grid',
      title: days.length > GRID_DAYS ? 'The last ' + GRID_DAYS + ' days of the range' : 'Day by day',
      days: gridDays,
      rows: habits.map((h) => {
        const set = new Set(h.doneDates || []);
        return { label: h.title || 'Habit', cells: gridDays.map((k) => habitCell(h, k, today, set)) };
      }),
    });
    blocks.push({ t: 'table', title: 'Each habit', columns: ['Habit', 'Done', 'Due', 'Kept', 'Streak', 'Best'], rows, right: [1, 2, 3, 4, 5] });
  }
  return { key: 'habits', title: SECTION_LABEL.habits, summary, blocks, empty: habits.length ? undefined : 'No habits yet.' };
}

const subjectOf = (s: { subject?: string }) => (s.subject || '').trim().replace(/\s+/g, ' ');

function focusSection({ src, o, days, key }: Ctx): Section {
  const list = (src.sessions || [])
    .filter((s) => inRange(s.dateKey, o.range) && (!key || subjectKey(subjectOf(s)) === key))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.endedAt - b.endedAt);
  const minOf = (s: FocusSession) => (Number(s.netSeconds) || 0) / 60;
  const total = list.reduce((a, s) => a + minOf(s), 0);
  const byDay = new Map<string, number>();
  const bySubject = new Map<string, { name: string; min: number; n: number }>();
  for (const s of list) {
    byDay.set(s.dateKey, (byDay.get(s.dateKey) || 0) + minOf(s));
    const name = subjectOf(s) || 'No subject';
    const k = subjectKey(name);
    const row = bySubject.get(k) || { name, min: 0, n: 0 };
    // the latest spelling names it (the list runs oldest first)
    row.name = name;
    row.min += minOf(s);
    row.n++;
    bySubject.set(k, row);
  }
  const subjects = [...bySubject.values()].sort((a, b) => b.min - a.min);
  // the tags (an exam coming up, or the student's own): a session counts once under each of its tags, matched without case
  const byTag = new Map<string, { name: string; min: number; n: number }>();
  for (const s of list) {
    for (const t of s.tags || []) {
      const k = t.toLowerCase();
      const row = byTag.get(k) || { name: t, min: 0, n: 0 };
      row.name = t;
      row.min += minOf(s);
      row.n++;
      byTag.set(k, row);
    }
  }
  const tags = [...byTag.values()].sort((a, b) => b.min - a.min);
  // how the sessions went, where it was said afterwards
  const rated = list.filter((s) => s.rating === 1 || s.rating === 2 || s.rating === 3);
  const deepMin = rated.filter((s) => s.rating === 3).reduce((a, s) => a + minOf(s), 0);
  const ratedMin = rated.reduce((a, s) => a + minOf(s), 0);
  const summary: Stat[] = list.length ? [
    { label: 'Focused', value: fmtMin(total) },
    { label: 'Sessions', value: String(list.length) },
    { label: 'Days with focus', value: byDay.size + ' of ' + days.length },
  ] : [];
  if (list.length > 1) summary.push({ label: 'Average session', value: fmtMin(total / list.length) });
  if (!key && subjects.length && subjects[0].name !== 'No subject') summary.push({ label: 'Most time on', value: subjects[0].name });
  if (tags.length) summary.push({ label: 'Most tagged', value: tags[0].name });
  if (rated.length) summary.push({ label: 'Deep focus', value: pctOf(deepMin, ratedMin) + '% of rated time' });
  const blocks: Block[] = [];
  if (list.length) {
    blocks.push({ t: 'stats', items: summary });
    if (days.length > 1) {
      const b = bucket(days, (k) => Math.round(byDay.get(k) || 0));
      blocks.push({ t: 'bars', title: b.byWeek ? 'Minutes each week' : 'Minutes each day', labels: b.labels, values: b.values, unit: 'min' });
    }
    if (!key) {
      blocks.push({
        t: 'table', title: 'By subject', columns: ['Subject', 'Time', 'Sessions', 'Share'], right: [1, 2, 3],
        rows: subjects.map((s) => [s.name, fmtMin(s.min), String(s.n), pctOf(s.min, total) + '%']),
      });
    }
    if (tags.length) {
      blocks.push({
        t: 'table', title: 'By tag', columns: ['Tag', 'Time', 'Sessions', 'Share'], right: [1, 2, 3],
        rows: tags.map((t) => [t.name, fmtMin(t.min), String(t.n), pctOf(t.min, total) + '%']),
      });
    }
    if (rated.length) {
      const how = (r: 1 | 2 | 3) => rated.filter((s) => s.rating === r);
      blocks.push({
        t: 'table', title: 'How it went', columns: ['Said', 'Time', 'Sessions'], right: [1, 2],
        rows: ([[3, 'Deep'], [2, 'Steady'], [1, 'Scattered']] as const)
          .filter(([r]) => how(r).length)
          .map(([r, label]) => [label, fmtMin(how(r).reduce((a, s) => a + minOf(s), 0)), String(how(r).length)]),
      });
    }
    const said = (s: FocusSession) => (s.rating === 3 ? 'Deep' : s.rating === 2 ? 'Steady' : s.rating === 1 ? 'Scattered' : '');
    blocks.push({
      t: 'table', title: 'Every session', columns: ['Day', 'Subject', 'Minutes', 'Tags', 'Tasks', 'Notes'], right: [2],
      rows: list.map((s) => [
        fmtDay(s.dateKey, true), subjectOf(s) || 'No subject', String(Math.round(minOf(s))) + (s.manual ? ' (logged)' : ''),
        (s.tags || []).join('; '),
        (s.taskTitles || []).filter(Boolean).join('; '),
        [said(s), s.note || ''].filter(Boolean).join(' · '),
      ]),
    });
  }
  return { key: 'focus', title: SECTION_LABEL.focus, summary, blocks, empty: list.length ? undefined : 'No Deep Work in this range.' };
}

const minutesOf = (hhmm: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  return m ? +m[1] * 60 + +m[2] : NaN;
};

function plannerSection({ src, key }: Ctx): Section {
  const rows: string[][] = [];
  const hours = new Map<string, { name: string; min: number }>();
  let total = 0;
  let busiest = { day: '', min: 0 };
  for (const d of DAY_NAMES) {
    let dayMin = 0;
    const blocks = [...(src.planner?.[d] || [])]
      .filter((b) => !key || subjectKey(b.subject || '') === key)
      .sort((a, b) => (a.start || '').localeCompare(b.start || ''));
    for (const b of blocks) {
      const len = Math.max(0, minutesOf(b.end) - minutesOf(b.start)) || 0;
      dayMin += len;
      const name = (b.subject || '').trim() || 'Block';
      const k = subjectKey(name);
      const h = hours.get(k) || { name, min: 0 };
      h.min += len;
      hours.set(k, h);
      rows.push([d, b.start + ' to ' + b.end, name, fmtMin(len)]);
    }
    total += dayMin;
    if (dayMin > busiest.min) busiest = { day: d, min: dayMin };
  }
  const summary: Stat[] = rows.length ? [
    { label: 'Blocks a week', value: String(rows.length) },
    { label: 'Planned', value: fmtMin(total) + ' a week' },
  ] : [];
  if (busiest.min > 0 && !key) summary.push({ label: 'Fullest day', value: busiest.day + ', ' + fmtMin(busiest.min) });
  const blocks: Block[] = [];
  if (rows.length) {
    blocks.push({ t: 'stats', items: summary });
    blocks.push({ t: 'table', title: 'The week', columns: ['Day', 'Time', 'Subject', 'Length'], rows, right: [3] });
    if (!key && hours.size > 1) {
      blocks.push({
        t: 'table', title: 'Planned by subject', columns: ['Subject', 'Each week', 'Share'], right: [1, 2],
        rows: [...hours.values()].sort((a, b) => b.min - a.min).map((h) => [h.name, fmtMin(h.min), pctOf(h.min, total) + '%']),
      });
    }
  }
  return { key: 'planner', title: SECTION_LABEL.planner, summary, blocks, empty: rows.length ? undefined : 'No blocks planned.' };
}

const moodLabel = (v: number | null | undefined) => (v ? MOODS.find((m) => m.value === Math.round(v))?.label || '' : '');
const stars = (v: number | null | undefined) => (v ? '★'.repeat(Math.round(v)) + '☆'.repeat(5 - Math.round(v)) : '');

function journalSection({ src, o, days }: Ctx): Section {
  if (!o.journalOpen) {
    return {
      key: 'journal', title: SECTION_LABEL.journal, summary: [{ label: 'Journal', value: 'Locked' }],
      blocks: [{ t: 'note', text: 'The journal is locked, so it is left out. Unlock it to include its moods and stats.' }],
    };
  }
  const entries = (src.journal || []).filter((e) => inRange(e.dateKey, o.range))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.createdAt - b.createdAt);
  const words = entries.reduce((a, e) => a + (Number(e.wordCount) || 0), 0);
  const written = new Set(entries.filter((e) => e.wordCount > 0).map((e) => e.dateKey));
  const moods = entries.filter((e) => e.mood).map((e) => e.mood as number);
  const ratings = entries.filter((e) => e.rating).map((e) => e.rating as number);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : null);
  const summary: Stat[] = entries.length ? [
    { label: 'Entries', value: String(entries.length) },
    { label: 'Days written', value: written.size + ' of ' + days.length },
    { label: 'Words', value: words.toLocaleString('en-US') },
  ] : [];
  const am = avg(moods);
  const ar = avg(ratings);
  if (am != null) summary.push({ label: 'Usual mood', value: moodLabel(am) });
  if (ar != null) summary.push({ label: 'Average day', value: (Math.round(ar * 10) / 10) + ' of 5 stars' });
  const blocks: Block[] = [];
  if (entries.length) {
    blocks.push({ t: 'stats', items: summary });
    const stripDays = days.slice(-CHART_DAYS);
    const series = moodSeries(entries, stripDays.length, stripDays[stripDays.length - 1]);
    if (moods.length || ratings.length) {
      blocks.push({
        t: 'strip', title: days.length > CHART_DAYS ? 'Mood and rating, the last ' + CHART_DAYS + ' days' : 'Mood and rating',
        days: series.map((d) => ({ key: d.dateKey, mood: d.mood, rating: d.rating })),
      });
    }
    const withText = !!o.journalText;
    blocks.push({
      t: 'table', title: 'Each entry',
      columns: withText ? ['Day', 'Title', 'Mood', 'Rating', 'Words'] : ['Day', 'Mood', 'Rating', 'Words'],
      right: withText ? [4] : [3],
      rows: entries.map((e) => {
        const base = [fmtDay(e.dateKey, true), moodLabel(e.mood), stars(e.rating), String(e.wordCount || 0)];
        return withText ? [base[0], e.title || '', ...base.slice(1)] : base;
      }),
    });
    if (o.journalText) {
      for (const e of entries) {
        const body = (o.journalText.get(e.id) ?? e.excerpt ?? '').trim();
        if (!body && !e.title) continue;
        blocks.push({ t: 'text', title: e.title?.trim() || fmtDay(e.dateKey, true), sub: e.title?.trim() ? fmtDay(e.dateKey, true) : undefined, body });
      }
    }
  }
  return { key: 'journal', title: SECTION_LABEL.journal, summary, blocks, empty: entries.length ? undefined : 'No entries in this range.' };
}

function scoresSection({ src, o, key }: Ctx): Section {
  const ix = indexScores([...(src.scores || [])]);
  const blocks: Block[] = [];
  const summary: Stat[] = [];

  // one exam and its subjects
  if (o.examId) {
    const exam = ix.byId.get(o.examId);
    if (!exam) return { key: 'scores', title: SECTION_LABEL.scores, summary, blocks, empty: 'That exam is no longer there.' };
    const r = resultOf(exam, ix);
    summary.push({ label: 'Exam', value: exam.title || 'Untitled exam' });
    if (exam.date) summary.push({ label: 'Sat', value: fmtDate(exam.date) });
    if (r) summary.push({ label: 'Result', value: fmtPct(r.pct) + (typeof r.score === 'number' && typeof r.outOf === 'number' ? ' (' + fmtMark(r.score) + ' of ' + fmtMark(r.outOf) + ')' : '') });
    if (typeof exam.rank === 'number') summary.push({ label: 'Rank', value: String(exam.rank) });
    if (typeof exam.target === 'number') summary.push({ label: 'Target', value: fmtPct(exam.target) });
    blocks.push({ t: 'stats', items: [...summary] });
    const kids = (ix.children.get(exam.id) || []).filter((n) => n.kind === 'exam');
    if (kids.length) {
      blocks.push({
        t: 'table', title: 'Subjects', columns: ['Subject', 'Marks', 'Result'], right: [1, 2],
        rows: kids.map((n) => {
          const kr = resultOf(n, ix);
          return [n.title || 'Subject', kr && typeof kr.score === 'number' && typeof kr.outOf === 'number' ? fmtMark(kr.score) + ' / ' + fmtMark(kr.outOf) : '', kr ? fmtPct(kr.pct) : ''];
        }),
      });
    }
    if (exam.note?.trim()) blocks.push({ t: 'text', title: 'Note', body: exam.note.trim() });
    return { key: 'scores', title: exam.title || SECTION_LABEL.scores, summary, blocks };
  }

  // one subject across exams
  if (key) {
    const rows: { when: string; exam: string; pct: number; marks: string }[] = [];
    for (const n of ix.byId.values()) {
      if (n.kind !== 'exam' || subjectKey(n.title || '') !== key) continue;
      const root = rootExamOf(ix, n.id);
      if (!root) continue;
      const r = resultOf(n, ix);
      if (!r || !inRange(whenOf(root), o.range)) continue;
      rows.push({
        when: whenOf(root), exam: root.id === n.id ? n.title : root.title, pct: r.pct,
        marks: typeof r.score === 'number' && typeof r.outOf === 'number' ? fmtMark(r.score) + ' / ' + fmtMark(r.outOf) : '',
      });
    }
    rows.sort((a, b) => a.when.localeCompare(b.when));
    if (rows.length) {
      const pcts = rows.map((r) => r.pct);
      summary.push({ label: 'Results', value: String(rows.length) });
      summary.push({ label: 'Average', value: fmtPct(pcts.reduce((a, p) => a + p, 0) / pcts.length) });
      summary.push({ label: 'Latest', value: fmtPct(pcts[pcts.length - 1]) });
      blocks.push({ t: 'stats', items: [...summary] });
      if (rows.length >= 2) blocks.push({ t: 'line', title: 'Results over time', labels: rows.map((r) => fmtDay(r.when)), values: pcts });
      blocks.push({ t: 'table', title: 'Each result', columns: ['Day', 'Exam', 'Marks', 'Result'], right: [2, 3], rows: rows.map((r) => [fmtDate(r.when), r.exam || 'Exam', r.marks, fmtPct(r.pct)]) });
    }
    return { key: 'scores', title: SECTION_LABEL.scores, summary, blocks, empty: rows.length ? undefined : 'No marked results in this range.' };
  }

  // the exams in view (Analytics), or every exam sat in the range
  const exams = (o.examIds
    ? o.examIds.map((id) => ix.byId.get(id)).filter((n): n is ScoreNode => !!n && isTopExam(ix, n))
    : topExams(ix).filter((n) => inRange(whenOf(n), o.range))
  ).sort((a, b) => whenOf(a).localeCompare(whenOf(b)) || a.createdAt - b.createdAt);
  const marked = exams.map((n) => ({ n, r: resultOf(n, ix) })).filter((x) => x.r && Number.isFinite(x.r.pct));
  const pcts = marked.map((x) => x.r!.pct);
  if (o.scopeLabel) summary.push({ label: 'Exams in view', value: o.scopeLabel });
  if (exams.length) summary.push({ label: 'Exams', value: String(exams.length) + (marked.length < exams.length ? ' (' + marked.length + ' marked)' : '') });
  if (pcts.length) {
    summary.push({ label: 'Average', value: fmtPct(pcts.reduce((a, p) => a + p, 0) / pcts.length) });
    summary.push({ label: 'Best', value: fmtPct(Math.max(...pcts)) });
    summary.push({ label: 'Latest', value: fmtPct(pcts[pcts.length - 1]) });
  }
  if (exams.length) {
    blocks.push({ t: 'stats', items: [...summary] });
    if (marked.length >= 2) blocks.push({ t: 'line', title: 'Results over time', labels: marked.map((x) => fmtDay(whenOf(x.n))), values: pcts });
    let prev: number | null = null;
    blocks.push({
      t: 'table', title: 'Each exam', columns: ['Day', 'Exam', 'Marks', 'Result', 'Change'], right: [2, 3, 4],
      rows: exams.map((n) => {
        const r = resultOf(n, ix);
        const change = r && prev != null ? r.pct - prev : null;
        if (r) prev = r.pct;
        return [
          fmtDate(whenOf(n)), n.title || 'Untitled exam',
          r && typeof r.score === 'number' && typeof r.outOf === 'number' ? fmtMark(r.score) + ' / ' + fmtMark(r.outOf) : '',
          r ? fmtPct(r.pct) : 'Not marked',
          change == null || Math.round(change * 10) === 0 ? '' : (change > 0 ? '+' : '−') + Math.abs(Math.round(change * 10) / 10),
        ];
      }),
    });
    const stats = subjectStats(ix, marked.map((x) => x.n.id));
    if (stats.length) {
      blocks.push({
        t: 'table', title: 'By subject', columns: ['Subject', 'Sat', 'Average', 'Latest', 'Best', 'Lowest'], right: [1, 2, 3, 4, 5],
        rows: stats.map((s) => [s.name, String(s.n), fmtPct(s.mean), fmtPct(s.latest), fmtPct(s.best), fmtPct(s.worst)]),
      });
    }
  }
  return { key: 'scores', title: SECTION_LABEL.scores, summary, blocks, empty: exams.length ? undefined : 'No exams in this range.' };
}

const NOTE_ROWS = 40;

function notesSection({ src, o, key }: Ctx): Section {
  if (!o.notesOpen) {
    return {
      key: 'notes', title: SECTION_LABEL.notes, summary: [{ label: 'Notes', value: 'Locked' }],
      blocks: [{ t: 'note', text: 'Notes are locked, so they are left out. Unlock them to include them.' }],
    };
  }
  const all = (src.notes || []).filter((n) => !key || subjectKey(n.subject || '') === key);
  const shown = all.filter((n) => !n.locked || !!o.noteOpen?.(n.id));
  const hidden = all.length - shown.length;
  const dayOf = (ms: number) => (ms ? todayKey(new Date(ms)) : '');
  const made = shown.filter((n) => inRange(dayOf(n.createdAt), o.range));
  const edited = shown.filter((n) => inRange(dayOf(n.updatedAt), o.range)).sort((a, b) => b.updatedAt - a.updatedAt);
  const folders = new Map<string, number>();
  for (const n of shown) folders.set(n.folder || 'Notes', (folders.get(n.folder || 'Notes') || 0) + 1);
  const summary: Stat[] = shown.length ? [
    { label: 'Notes', value: String(shown.length) },
    { label: 'Written in range', value: String(made.length) },
    { label: 'Edited in range', value: String(edited.length) },
  ] : [];
  const blocks: Block[] = [];
  if (shown.length) {
    blocks.push({ t: 'stats', items: summary });
    if (folders.size > 1) {
      blocks.push({
        t: 'table', title: 'By folder', columns: ['Folder', 'Notes'], right: [1],
        rows: [...folders.entries()].sort((a, b) => b[1] - a[1]).map(([f, n]) => [f, String(n)]),
      });
    }
    if (edited.length) {
      blocks.push({
        t: 'table', title: 'Edited in this range', columns: ['Note', 'Folder', 'Edited'],
        rows: edited.slice(0, NOTE_ROWS).map((n) => [n.title?.trim() || 'Untitled note', n.folder || '', fmtDate(dayOf(n.updatedAt))]),
        more: edited.length > NOTE_ROWS ? edited.length - NOTE_ROWS : undefined,
      });
    }
  }
  if (hidden > 0) blocks.push({ t: 'note', text: plural(hidden, 'locked note') + ' left out.' });
  return { key: 'notes', title: SECTION_LABEL.notes, summary, blocks, empty: shown.length ? undefined : hidden ? undefined : 'No notes yet.' };
}

/** The headline of every other section, with the tools that are not archived (and the journal only when open). */
function overviewSection(built: Section[], ctx: Ctx): Section {
  const items: Stat[] = [{ label: 'Days', value: String(ctx.days.length) }];
  const pick = (k: SectionKey, label: string, which: string) => {
    const s = built.find((x) => x.key === k);
    const v = s?.summary.find((x) => x.label === which)?.value;
    if (v && v !== 'Locked') items.push({ label, value: v });
  };
  pick('tasks', 'ToDos done', 'ToDos done');
  pick('tasks', 'Long-term tasks done', 'Long-term tasks done');
  pick('habits', 'Habits kept', 'Kept');
  pick('focus', 'Deep Work', 'Focused');
  pick('journal', 'Journal entries', 'Entries');
  pick('journal', 'Usual mood', 'Usual mood');
  pick('scores', 'Exams', 'Exams');
  pick('scores', 'Exam average', 'Average');
  pick('notes', 'Notes written', 'Written in range');
  return { key: 'overview', title: SECTION_LABEL.overview, summary: items, blocks: [{ t: 'stats', items }] };
}

/** The report: each section asked for (an archived tool's left out), in the print order. */
export function buildReport(src: ReportSource, o: ReportOptions): Report {
  const generatedAt = o.generatedAt ?? new Date();
  const today = o.today ?? todayKey(generatedAt);
  const ctx: Ctx = { src, o, days: daysIn(o.range), today, key: o.subject ? subjectKey(o.subject) : null };
  const archived = o.archived || [];
  const allowed = new Set(BUILD_ORDER.filter((k) => !SECTION_TOOL[k] || !archived.includes(SECTION_TOOL[k] as string)));
  const wanted = BUILD_ORDER.filter((k) => o.sections.includes(k) && allowed.has(k));
  const make: Record<Exclude<SectionKey, 'overview'>, (c: Ctx) => Section> = {
    tasks: (c) => tasksSection(c), todos: (c) => tasksSection(c, 'todos'), longterm: (c) => tasksSection(c, 'longterm'),
    habits: habitsSection, focus: focusSection, planner: plannerSection,
    journal: journalSection, scores: scoresSection, notes: notesSection,
  };
  const built: Section[] = [];
  // the overview reads the others' figures, so every section it can draw from is built, then only those asked for kept
  const needAll = wanted.includes('overview');
  for (const k of BUILD_ORDER) {
    if (k === 'overview' || !allowed.has(k)) continue;
    // the overview's figures come from the full report's sections; the halves of 'tasks' are built only when asked
    if (!wanted.includes(k) && !SECTION_ORDER.includes(k)) continue;
    if (wanted.includes(k) || needAll) built.push(make[k](ctx));
  }
  const sections: Section[] = [];
  for (const k of wanted) {
    if (k === 'overview') sections.push(overviewSection(built, ctx));
    else { const s = built.find((x) => x.key === k); if (s) sections.push(s); }
  }
  return {
    title: o.title || 'Progress report',
    profile: (o.profile || '').trim(),
    range: o.range,
    generatedAt,
    sections,
  };
}

// ---------- CSV ----------

/** One CSV cell: quoted when it holds a comma, a quote or a line break; a formula's first sign is defused. */
export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^[-+]?\d/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

const csvRow = (cells: unknown[]) => cells.map(csvCell).join(',');

/**
 * The report as one CSV text: a heading row, then each section's tables one after the other, each with its name
 * above and a blank line after, so a spreadsheet opens it as a run of small tables. Starts with a byte-order mark so
 * Excel reads it as UTF-8.
 */
export function reportCsv(r: Report): string {
  const out: string[] = [];
  out.push(csvRow(['Sturoids', r.title]));
  if (r.profile) out.push(csvRow(['Profile', r.profile]));
  out.push(csvRow(['Range', r.range.from + ' to ' + r.range.to]));
  out.push(csvRow(['Made', todayKey(r.generatedAt)]));
  out.push('');
  for (const s of r.sections) {
    let wrote = false;
    for (const b of s.blocks) {
      if (b.t === 'stats') {
        out.push(csvRow([s.title]));
        out.push(csvRow(['Measure', 'Value']));
        for (const it of b.items) out.push(csvRow([it.label, it.value]));
      } else if (b.t === 'table') {
        out.push(csvRow([s.title + ': ' + b.title]));
        out.push(csvRow(b.columns));
        for (const row of b.rows) out.push(csvRow(row));
      } else if (b.t === 'grid') {
        out.push(csvRow([s.title + ': ' + b.title]));
        out.push(csvRow(['Habit', ...b.days]));
        for (const row of b.rows) out.push(csvRow([row.label, ...row.cells.map((c) => (c === 'done' ? 'done' : c === 'missed' ? 'missed' : c === 'rest' ? 'rest' : ''))]));
      } else if (b.t === 'strip') {
        out.push(csvRow([s.title + ': ' + b.title]));
        out.push(csvRow(['Day', 'Mood', 'Rating']));
        for (const d of b.days) if (d.mood || d.rating) out.push(csvRow([d.key, moodLabel(d.mood), d.rating ?? '']));
      } else if (b.t === 'text') {
        out.push(csvRow([s.title + ': ' + b.title, b.sub || '', b.body]));
      } else if (b.t === 'note') {
        out.push(csvRow([s.title, b.text]));
      } else continue;
      out.push('');
      wrote = true;
    }
    if (!wrote && s.empty) { out.push(csvRow([s.title, s.empty])); out.push(''); }
  }
  return '﻿' + out.join('\r\n');
}

// ---------- the printed page ----------

/** Text made safe for HTML. */
export function esc(v: unknown): string {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** A file name the phone and every share target accept. */
export function fileSafe(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90) || 'Sturoids report';
}

/** The print's colours: dark ink on paper, one warm accent, the habit grid's greys. */
const INK = '#1F1E1D';
const DIM = '#5E5D59';
const FAINT = '#8A8880';
const RULE = '#E4E2DA';
const ACCENT = '#C6613F';
const ACCENT_SOFT = '#F1D9CE';
const PAPER_ALT = '#F7F6F2';

const W = 640;

function barsSvg(b: Extract<Block, { t: 'bars' }>): string {
  const H = 120;
  const pad = 22;
  const max = Math.max(1, ...b.values);
  const n = b.values.length;
  const slot = W / n;
  const bw = Math.max(2, Math.min(28, slot * 0.66));
  const bars = b.values.map((v, i) => {
    const h = v > 0 ? Math.max(2, (v / max) * (H - pad - 8)) : 0;
    const x = i * slot + (slot - bw) / 2;
    return h > 0
      ? `<rect x="${x.toFixed(1)}" y="${(H - pad - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${ACCENT}"/>`
      : `<rect x="${x.toFixed(1)}" y="${H - pad - 1}" width="${bw.toFixed(1)}" height="1" fill="${RULE}"/>`;
  }).join('');
  // a few labels under the bars: the first, the last, and evenly between, never crowded
  const every = Math.max(1, Math.ceil(n / 7));
  const labels = b.labels.map((l, i) => (i % every === 0 || i === n - 1) && !(i !== n - 1 && n - 1 - i < every / 2)
    ? `<text x="${(i * slot + slot / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(l.replace(/^Week of /, ''))}</text>` : '').join('');
  const top = `<text x="0" y="10" class="axis">${esc(b.unit === 'min' ? fmtMin(max) : max + ' done')}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" class="chart" role="img" aria-label="${esc(b.title)}">`
    + `<line x1="0" y1="${H - pad}" x2="${W}" y2="${H - pad}" stroke="${RULE}"/>${top}${bars}<g class="lbl">${labels}</g></svg>`;
}

function lineSvg(b: Extract<Block, { t: 'line' }>): string {
  const H = 150;
  const padB = 22;
  const padL = 34;
  const lo = Math.max(0, Math.floor((Math.min(...b.values) - 5) / 10) * 10);
  const hi = Math.min(100, Math.max(lo + 10, Math.ceil((Math.max(...b.values) + 5) / 10) * 10));
  const n = b.values.length;
  const x = (i: number) => padL + (n === 1 ? (W - padL) / 2 : (i / (n - 1)) * (W - padL - 8));
  const y = (v: number) => 8 + (1 - (v - lo) / (hi - lo || 1)) * (H - padB - 16);
  const ticks = [lo, (lo + hi) / 2, hi].map((t) =>
    `<line x1="${padL}" y1="${y(t).toFixed(1)}" x2="${W}" y2="${y(t).toFixed(1)}" stroke="${RULE}"/>`
    + `<text x="${padL - 6}" y="${(y(t) + 3).toFixed(1)}" text-anchor="end" class="axis">${Math.round(t)}%</text>`).join('');
  const pts = b.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const dots = b.values.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3" fill="${ACCENT}"/>`).join('');
  const every = Math.max(1, Math.ceil(n / 6));
  const labels = b.labels.map((l, i) => (i % every === 0 || i === n - 1) && !(i !== n - 1 && n - 1 - i < every / 2)
    ? `<text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(l)}</text>` : '').join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" class="chart" role="img" aria-label="${esc(b.title)}">`
    + `${ticks}<polyline points="${pts}" fill="none" stroke="${ACCENT}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`
    + `${dots}<g class="lbl">${labels}</g></svg>`;
}

function gridSvg(b: Extract<Block, { t: 'grid' }>): string {
  const labelW = 150;
  const n = b.days.length;
  const cell = Math.min(14, Math.floor((W - labelW) / Math.max(1, n)) - 2);
  const gap = 2;
  const rowH = cell + 8;
  const H = b.rows.length * rowH + 18;
  const fill: Record<GridCell, string> = { done: ACCENT, missed: '#FFFFFF', rest: PAPER_ALT, ahead: '#FFFFFF' };
  const stroke: Record<GridCell, string> = { done: ACCENT, missed: '#CFCCC2', rest: PAPER_ALT, ahead: RULE };
  const rows = b.rows.map((r, ri) => {
    const y = ri * rowH;
    const cells = r.cells.map((c, i) =>
      `<rect x="${labelW + i * (cell + gap)}" y="${y + 2}" width="${cell}" height="${cell}" rx="3" fill="${fill[c]}" stroke="${stroke[c]}"/>`).join('');
    const name = r.label.length > 22 ? r.label.slice(0, 21) + '…' : r.label;
    return `<text x="0" y="${y + cell - 1}" class="row">${esc(name)}</text>${cells}`;
  }).join('');
  const every = Math.max(1, Math.ceil(n / 6));
  const labels = b.days.map((k, i) => (i % every === 0 || i === n - 1) && !(i !== n - 1 && n - 1 - i < every / 2)
    ? `<text x="${labelW + i * (cell + gap) + cell / 2}" y="${H - 4}" text-anchor="middle">${esc(fmtDay(k).slice(4))}</text>` : '').join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" class="chart" role="img" aria-label="${esc(b.title)}">${rows}<g class="lbl">${labels}</g></svg>`
    + `<div class="legend"><span><i style="background:${ACCENT}"></i>Done</span><span><i class="ring"></i>Missed</span><span><i style="background:${PAPER_ALT}"></i>Rest day</span></div>`;
}

function stripSvg(b: Extract<Block, { t: 'strip' }>): string {
  const labelW = 70;
  const n = b.days.length;
  const cell = Math.min(16, Math.floor((W - labelW) / Math.max(1, n)) - 2);
  const gap = 2;
  const H = 2 * (cell + 8) + 18;
  const tone = (v: number | null) => (v ? `fill="${ACCENT}" fill-opacity="${(0.18 + (v - 1) * 0.2).toFixed(2)}"` : `fill="#FFFFFF" stroke="${RULE}"`);
  const row = (label: string, y: number, key: 'mood' | 'rating') => `<text x="0" y="${y + cell - 2}" class="row">${label}</text>`
    + b.days.map((d, i) => `<rect x="${labelW + i * (cell + gap)}" y="${y}" width="${cell}" height="${cell}" rx="3" ${tone(d[key])}/>`).join('');
  const every = Math.max(1, Math.ceil(n / 6));
  const labels = b.days.map((d, i) => (i % every === 0 || i === n - 1) && !(i !== n - 1 && n - 1 - i < every / 2)
    ? `<text x="${labelW + i * (cell + gap) + cell / 2}" y="${H - 4}" text-anchor="middle">${esc(fmtDay(d.key).slice(4))}</text>` : '').join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" class="chart" role="img" aria-label="${esc(b.title)}">`
    + row('Mood', 0, 'mood') + row('Rating', cell + 8, 'rating') + `<g class="lbl">${labels}</g></svg>`
    + `<div class="legend"><span>Lighter is lower, deeper is higher</span></div>`;
}

function blockHtml(b: Block): string {
  switch (b.t) {
    case 'stats':
      return `<div class="stats">${b.items.map((s) => `<div class="stat"><div class="v">${esc(s.value)}</div><div class="l">${esc(s.label)}</div></div>`).join('')}</div>`;
    case 'table': {
      const right = new Set(b.right || []);
      const th = b.columns.map((c, i) => `<th${right.has(i) ? ' class="r"' : ''}>${esc(c)}</th>`).join('');
      const rows = b.rows.map((r) => `<tr>${r.map((c, i) => `<td${right.has(i) ? ' class="r"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('');
      const more = b.more ? `<p class="fine">And ${b.more} more.</p>` : '';
      return `<h3>${esc(b.title)}</h3><table><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table>${more}`;
    }
    case 'bars': return `<h3>${esc(b.title)}</h3>${barsSvg(b)}`;
    case 'line': return `<h3>${esc(b.title)}</h3>${lineSvg(b)}`;
    case 'grid': return `<h3>${esc(b.title)}</h3>${gridSvg(b)}`;
    case 'strip': return `<h3>${esc(b.title)}</h3>${stripSvg(b)}`;
    case 'text':
      return `<div class="entry"><h4>${esc(b.title)}</h4>${b.sub ? `<div class="fine">${esc(b.sub)}</div>` : ''}`
        + b.body.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('') + '</div>';
    case 'note': return `<p class="note">${esc(b.text)}</p>`;
    default: return '';
  }
}

const FONTS = 'https://fonts.googleapis.com/css2?family=Inter+Tight:wght@300;400;500;600&family=Schibsted+Grotesk:wght@400;500;600&family=Source+Serif+4:opsz,wght@8..60,400;8..60,500&family=Rubik:wght@600&display=swap';

/**
 * The report as a printable A4 page: the Sturoids wordmark, the title in the serif, whose it is, the range and the day
 * it was made; then each section on a page of its own, its figures, inline SVG charts and tables. The fonts are the
 * app's own from Google Fonts, falling back to the phone's when offline.
 */
export function reportHtml(r: Report): string {
  const made = fmtDate(todayKey(r.generatedAt));
  const sections = r.sections.map((s, i) => `
    <section class="${i === 0 ? 'first' : 'next'}">
      ${r.sections.length > 1 ? `<div class="kicker">${esc(String(i + 1).padStart(2, '0'))}</div>
      <h2>${esc(s.title)}</h2>` : ''}
      ${s.blocks.length ? s.blocks.map(blockHtml).join('\n') : ''}
      ${s.empty && !s.blocks.some((b) => b.t !== 'note') ? `<p class="note">${esc(s.empty)}</p>` : ''}
    </section>`).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(r.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${FONTS}" rel="stylesheet">
<style>
  @page { size: A4; margin: 18mm 16mm 20mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #FFFFFF; color: ${INK}; }
  body { font-family: 'Inter Tight', -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 10.5pt; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .mast { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid ${RULE}; padding-bottom: 10px; margin-bottom: 28px; }
  .brand { font-family: 'Rubik', 'Inter Tight', sans-serif; font-weight: 600; font-size: 13pt; letter-spacing: 0.02em; color: ${INK}; }
  .brand b { color: ${ACCENT}; font-weight: 600; }
  .made { font-family: 'Schibsted Grotesk', 'Inter Tight', sans-serif; font-size: 8.5pt; color: ${FAINT}; letter-spacing: 0.02em; }
  h1 { font-family: 'Source Serif 4', Georgia, 'Times New Roman', serif; font-weight: 500; font-size: 28pt; line-height: 1.15; letter-spacing: -0.01em; margin: 0 0 6px; }
  .who { font-family: 'Schibsted Grotesk', 'Inter Tight', sans-serif; color: ${DIM}; font-size: 10.5pt; margin-bottom: 30px; }
  .who span + span::before { content: '·'; margin: 0 8px; color: ${FAINT}; }
  section.next { page-break-before: always; break-before: page; }
  .kicker { font-family: 'Schibsted Grotesk', 'Inter Tight', sans-serif; font-size: 8pt; letter-spacing: 0.14em; color: ${ACCENT}; font-weight: 600; margin-bottom: 4px; }
  h2 { font-family: 'Source Serif 4', Georgia, serif; font-weight: 500; font-size: 18pt; margin: 0 0 16px; letter-spacing: -0.005em; }
  h3 { font-family: 'Schibsted Grotesk', 'Inter Tight', sans-serif; font-weight: 600; font-size: 8.5pt; letter-spacing: 0.1em; text-transform: uppercase; color: ${DIM}; margin: 26px 0 10px; page-break-after: avoid; break-after: avoid; }
  h4 { font-family: 'Source Serif 4', Georgia, serif; font-weight: 500; font-size: 12pt; margin: 0; }
  .stats { display: flex; flex-wrap: wrap; gap: 10px; }
  .stat { flex: 1 1 140px; background: ${PAPER_ALT}; border-radius: 10px; padding: 12px 14px; page-break-inside: avoid; break-inside: avoid; }
  .stat .v { font-size: 14pt; font-weight: 500; font-variant-numeric: tabular-nums; line-height: 1.25; }
  .stat .l { font-family: 'Schibsted Grotesk', 'Inter Tight', sans-serif; font-size: 8.5pt; color: ${DIM}; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  thead { display: table-header-group; }
  th { font-family: 'Schibsted Grotesk', 'Inter Tight', sans-serif; font-weight: 500; font-size: 8.5pt; color: ${FAINT}; text-align: left; padding: 0 8px 6px 0; border-bottom: 1px solid ${RULE}; }
  td { padding: 6px 8px 6px 0; border-bottom: 1px solid ${RULE}; vertical-align: top; }
  tr { page-break-inside: avoid; break-inside: avoid; }
  .r { text-align: right; font-variant-numeric: tabular-nums; }
  .chart { display: block; margin: 4px 0 2px; page-break-inside: avoid; break-inside: avoid; }
  .chart text { font-family: 'Schibsted Grotesk', 'Inter Tight', sans-serif; font-size: 10px; fill: ${FAINT}; }
  .chart text.row { font-family: 'Inter Tight', sans-serif; font-size: 11px; fill: ${INK}; }
  .legend { display: flex; gap: 16px; font-family: 'Schibsted Grotesk', 'Inter Tight', sans-serif; font-size: 8pt; color: ${FAINT}; margin-top: 4px; }
  .legend i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }
  .legend i.ring { border: 1px solid #CFCCC2; background: #FFFFFF; }
  .note { color: ${DIM}; font-style: italic; }
  .fine { font-family: 'Schibsted Grotesk', 'Inter Tight', sans-serif; font-size: 8.5pt; color: ${FAINT}; }
  .entry { padding: 12px 0; border-bottom: 1px solid ${RULE}; page-break-inside: avoid; break-inside: avoid; }
  .entry p { font-family: 'Source Serif 4', Georgia, serif; font-size: 10.5pt; margin: 6px 0 0; }
  footer { margin-top: 40px; font-family: 'Schibsted Grotesk', 'Inter Tight', sans-serif; font-size: 8pt; color: ${FAINT}; }
</style></head>
<body>
  <div class="mast"><div class="brand">Sturoids<b>.</b></div><div class="made">Made ${esc(made)}</div></div>
  <h1>${esc(r.title)}</h1>
  <div class="who">${r.profile ? `<span>${esc(r.profile)}</span>` : ''}<span>${esc(r.range.label)}</span></div>
  ${sections}
  <footer>Made with Sturoids on ${esc(made)}. Everything here comes from the app on this phone.</footer>
</body></html>`;
}

/** The file's name: "Sturoids progress report 1 to 26 Oct 2026". */
export function reportFileName(r: Report): string {
  return fileSafe('Sturoids ' + r.title.toLowerCase() + ' ' + fmtSpan(r.range.from, r.range.to));
}
