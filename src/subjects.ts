// One list of subjects across the app: the ones focused on, written about in notes, planned in the Planner and sat in
// exams. "  Physics " and "physics" are one subject (scores.subjectKey). Everything here but useSubjects is pure and
// never loads the store, so the phone widgets' task handler and the Node tests can use it on rows they read themselves.

import { useMemo } from 'react';
import type { FocusSession, Note, PlannerBlock, PlannerWeek } from './store';
import { ScoreNode, indexScores, isTopExam, resultOf, rootExamOf, subjectKey, whenOf } from './scores';
import { DAY_NAMES, DayName, dayName, todayKey, toMinutes } from './utils';

export { subjectKey };

/** What the subject list is built from: the store's collections, or the same rows read straight from storage. */
export interface SubjectData {
  sessions: readonly FocusSession[];
  notes: readonly Note[];
  planner: PlannerWeek;
  scores: readonly ScoreNode[];
  /** when the Notes tool is locked, a subject's notes are left out */
  settings?: { notesLocked?: boolean };
}

export type SubjectSource = 'focus' | 'notes' | 'planner' | 'scores';

export interface Subject {
  key: string;
  /** as it is most often written */
  name: string;
  /** how many sessions, notes, blocks and exam subjects carry it */
  uses: number;
  from: SubjectSource[];
}

/** An exam subject: an exam-kind node inside another exam. */
const isExamSubject = (byId: Map<string, ScoreNode>, n: ScoreNode) =>
  n.kind === 'exam' && !!n.parentId && byId.get(n.parentId)?.kind === 'exam';

/** Every subject, most used first (then by name), each once. */
export function subjectsOf(data: SubjectData): Subject[] {
  const by = new Map<string, { names: Map<string, number>; uses: number; from: Set<SubjectSource> }>();
  const add = (raw: unknown, from: SubjectSource) => {
    if (typeof raw !== 'string') return;
    const name = raw.trim().replace(/\s+/g, ' ');
    if (!name) return;
    const key = subjectKey(name);
    let s = by.get(key);
    if (!s) {
      s = { names: new Map(), uses: 0, from: new Set() };
      by.set(key, s);
    }
    s.uses++;
    s.from.add(from);
    s.names.set(name, (s.names.get(name) || 0) + 1);
  };
  for (const x of data.sessions || []) add(x?.subject, 'focus');
  for (const n of data.notes || []) add(n?.subject, 'notes');
  for (const d of DAY_NAMES) for (const b of data.planner?.[d] || []) add(b?.subject, 'planner');
  const byId = new Map((data.scores || []).map((n) => [n.id, n]));
  for (const n of data.scores || []) if (isExamSubject(byId, n)) add(n.title, 'scores');
  const out: Subject[] = [];
  for (const [key, s] of by) {
    let name = '';
    let most = -1;
    for (const [n, c] of s.names) if (c > most) { name = n; most = c; }
    const order: SubjectSource[] = ['focus', 'notes', 'planner', 'scores'];
    out.push({ key, name, uses: s.uses, from: order.filter((o) => s.from.has(o)) });
  }
  return out.sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name));
}

/**
 * The subjects' names, most used first: for the suggestions in the note editor, Focus, the block sheet and the exam form.
 * The store is loaded only when this hook runs, so the rest of this file stays free of it.
 */
export function useSubjects(): string[] {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { useStore } = require('./store') as typeof import('./store');
  const sessions = useStore((s) => s.sessions);
  const notes = useStore((s) => s.notes);
  const planner = useStore((s) => s.planner);
  const scores = useStore((s) => s.scores);
  return useMemo(() => subjectsOf({ sessions, notes, planner, scores }).map((s) => s.name), [sessions, notes, planner, scores]);
}

/** A day key `days` from `key`. */
function shift(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return todayKey(new Date(y, m - 1, d + days));
}

export interface SubjectResult {
  /** the subject's own node (an exam's subject, or an exam named for the subject) */
  id: string;
  /** the exam it was sat in */
  examId: string;
  examTitle: string;
  /** when, as the exam's date (or the day it was added) */
  date: string;
  pct: number;
}

export interface SubjectClass {
  block: PlannerBlock;
  day: DayName;
  dateKey: string;
  /** 0 today, 1 tomorrow… */
  inDays: number;
  /** going on right now */
  onNow: boolean;
}

export interface SubjectExam {
  id: string;
  title: string;
  date: string;
  inDays: number;
}

export interface SubjectSummary {
  key: string;
  name: string;
  /** minutes focused on it today and the six days before */
  weekMin: number;
  /** minutes focused on it each of the last 30 days, oldest first, today last */
  spark: number[];
  totalMin: number;
  sessions: number;
  /** its marked results, oldest first */
  trend: SubjectResult[];
  /** the change from the result before the last one, in points; null with fewer than two */
  lastDelta: number | null;
  nextClass: SubjectClass | null;
  /** its notes, most recently edited first; empty while the Notes tool is locked (notesHidden) */
  notes: Note[];
  notesHidden: boolean;
  nextExam: SubjectExam | null;
}

const daysBetween = (from: string, to: string) => {
  const a = from.split('-').map(Number);
  const b = to.split('-').map(Number);
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000);
};

/** Whether an exam (or any subject inside it, at any depth) is about the subject. */
function examTouches(children: Map<string | null, ScoreNode[]>, exam: ScoreNode, key: string): boolean {
  if (subjectKey(exam.title) === key) return true;
  const seen = new Set<string>([exam.id]);
  const stack = [...(children.get(exam.id) || [])];
  while (stack.length) {
    const n = stack.pop()!;
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    if (n.kind === 'exam' && subjectKey(n.title) === key) return true;
    stack.push(...(children.get(n.id) || []));
  }
  return false;
}

/**
 * Everything the app knows about one subject (its name, as written anywhere, or its key): the focus on it this week and
 * over 30 days, its results over time, its next class, its notes and its next exam. Pure: `now` sets the day and hour.
 */
export function subjectSummary(data: SubjectData, subject: string, now: Date = new Date()): SubjectSummary {
  const key = subjectKey(subject || '');
  const today = todayKey(now);
  const known = subjectsOf(data).find((s) => s.key === key);
  const name = known?.name || subject.trim().replace(/\s+/g, ' ');

  // focus
  const from30 = shift(today, -29);
  const from7 = shift(today, -6);
  const perDay = new Map<string, number>();
  let totalSec = 0;
  let count = 0;
  for (const x of data.sessions || []) {
    if (!x || typeof x.subject !== 'string' || subjectKey(x.subject) !== key) continue;
    const secs = Number(x.netSeconds) > 0 ? Number(x.netSeconds) : 0;
    totalSec += secs;
    count++;
    if (typeof x.dateKey === 'string' && x.dateKey >= from30 && x.dateKey <= today) {
      perDay.set(x.dateKey, (perDay.get(x.dateKey) || 0) + secs);
    }
  }
  const spark: number[] = [];
  let weekSec = 0;
  for (let i = 0; i < 30; i++) {
    const k = shift(from30, i);
    const secs = perDay.get(k) || 0;
    spark.push(Math.round(secs / 60));
    if (k >= from7) weekSec += secs;
  }

  // results and the next exam
  const ix = indexScores([...(data.scores || [])]);
  const trend: SubjectResult[] = [];
  let nextExam: SubjectExam | null = null;
  for (const n of ix.byId.values()) {
    if (n.kind !== 'exam') continue;
    const root = rootExamOf(ix, n.id) || n;
    if (subjectKey(n.title) === key) {
      const r = resultOf(n, ix);
      if (r && Number.isFinite(r.pct)) {
        trend.push({ id: n.id, examId: root.id, examTitle: root.title.trim() || 'Exam', date: whenOf(root), pct: r.pct });
      }
    }
    if (isTopExam(ix, n) && n.date && n.date >= today && !resultOf(n, ix) && examTouches(ix.children, n, key)) {
      if (!nextExam || n.date < nextExam.date) {
        nextExam = { id: n.id, title: n.title.trim() || 'Exam', date: n.date, inDays: daysBetween(today, n.date) };
      }
    }
  }
  // an exam named for the subject and a subject inside it are one result, counted once
  const seenExam = new Set<string>();
  const results = trend
    .sort((a, b) => a.date.localeCompare(b.date))
    .filter((r) => {
      if (seenExam.has(r.examId)) return false;
      seenExam.add(r.examId);
      return true;
    });
  const lastDelta = results.length >= 2 ? results[results.length - 1].pct - results[results.length - 2].pct : null;

  // the next class: one going on now, or the next to start, from today to the same weekday next week (a class held once
  // a week, already over today, is next week's)
  let nextClass: SubjectClass | null = null;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  for (let d = 0; d <= 7 && !nextClass; d++) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
    const day = dayName(date);
    let best: { b: PlannerBlock; start: number; on: boolean } | null = null;
    for (const b of data.planner?.[day] || []) {
      if (!b || typeof b.subject !== 'string' || subjectKey(b.subject) !== key) continue;
      const start = toMinutes(b.start);
      const end = toMinutes(b.end);
      if (start < 0) continue;
      const on = d === 0 && start <= nowMin && end > nowMin;
      if (d === 0 && !on && start <= nowMin) continue;
      if (!best || start < best.start) best = { b, start, on };
    }
    if (best) nextClass = { block: best.b, day, dateKey: todayKey(date), inDays: d, onNow: best.on };
  }

  const notesHidden = !!data.settings?.notesLocked;
  const notes = notesHidden ? [] : (data.notes || [])
    .filter((n) => n && typeof n.subject === 'string' && subjectKey(n.subject) === key)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  return {
    key,
    name,
    weekMin: Math.round(weekSec / 60),
    spark,
    totalMin: Math.round(totalSec / 60),
    sessions: count,
    trend: results,
    lastDelta,
    nextClass,
    notes,
    notesHidden,
    nextExam,
  };
}

/** One day of the focus week: minutes in all, and by subject (most first; '' is time with no subject). */
export interface FocusDay {
  dateKey: string;
  min: number;
  bySubject: { key: string; name: string; min: number }[];
}

/**
 * The seven days ending on `end` (today by default), oldest first, with the minutes focused on each by subject, and the
 * best of them (null when nothing was focused). For the Focus week widget and the history.
 */
export function focusWeek(
  sessions: readonly FocusSession[],
  end: string = todayKey(),
): { days: FocusDay[]; totalMin: number; best: FocusDay | null } {
  const from = shift(end, -6);
  const secs = new Map<string, Map<string, { name: string; secs: number }>>();
  for (const x of sessions || []) {
    if (!x || typeof x.dateKey !== 'string' || x.dateKey < from || x.dateKey > end) continue;
    const n = Number(x.netSeconds);
    if (!(n > 0)) continue;
    const name = typeof x.subject === 'string' ? x.subject.trim().replace(/\s+/g, ' ') : '';
    const key = subjectKey(name);
    let day = secs.get(x.dateKey);
    if (!day) {
      day = new Map();
      secs.set(x.dateKey, day);
    }
    const was = day.get(key);
    if (was) was.secs += n;
    else day.set(key, { name, secs: n });
  }
  const days: FocusDay[] = [];
  let total = 0;
  for (let i = 0; i < 7; i++) {
    const k = shift(from, i);
    const day = secs.get(k);
    const bySubject = day
      ? [...day.entries()].map(([key, v]) => ({ key, name: v.name, min: Math.round(v.secs / 60) })).filter((v) => v.min > 0)
        .sort((a, b) => b.min - a.min)
      : [];
    const daySecs = day ? [...day.values()].reduce((a, v) => a + v.secs, 0) : 0;
    total += daySecs;
    days.push({ dateKey: k, min: Math.round(daySecs / 60), bySubject });
  }
  let best: FocusDay | null = null;
  for (const d of days) if (d.min > 0 && (!best || d.min >= best.min)) best = d;
  return { days, totalMin: Math.round(total / 60), best };
}
