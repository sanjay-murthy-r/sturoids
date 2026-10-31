import { todayKey, todoDueOn, toMinutes } from './utils';

/** What the ToDo list needs of a ToDo to order it. */
export interface TodoLike { id: string; doneOn: string | null; time?: string; repeat?: 'daily'; days?: number[] }

export interface TodoSlot<T> {
  task: T;
  /** ticked today */
  done: boolean;
  /** shows today: a ToDo repeating on chosen days is not due on the others */
  due: boolean;
}

/**
 * The ToDo list in the order Tasks shows it: the open ones first, those with a time by their time and the rest after
 * them in the order they were added; then the ones ticked today, sunk in the same order; then the weekly ones that are
 * not due today, dimmed, as added. A stable order, so rows only move when something about them changed.
 */
export function orderTodos<T extends TodoLike>(tasks: readonly T[], today: string): TodoSlot<T>[] {
  const slots = tasks.map((task, i) => {
    const t = toMinutes(task.time || '');
    return { task, done: task.doneOn === today, due: todoDueOn(task, today), i, t: t >= 0 ? t : Infinity };
  });
  const band = (x: { done: boolean; due: boolean }) => (!x.due ? 2 : x.done ? 1 : 0);
  slots.sort((a, b) => band(a) - band(b) || (band(a) < 2 ? a.t - b.t : 0) || a.i - b.i);
  return slots.map(({ task, done, due }) => ({ task, done, due }));
}

/**
 * The ToDos the triage card asks about: one-offs made before today, left open since before yesterday's end. A repeating
 * ToDo comes back on its own, so it is never a leftover.
 */
export function leftoverTodos<T extends TodoLike & { createdAt: number }>(
  tasks: readonly T[], today: string, yesterday: string, skip: readonly string[] = [],
): T[] {
  const start = new Date(today + 'T00:00:00').getTime();
  return tasks.filter((t) => (
    t.repeat !== 'daily' && t.createdAt < start && t.doneOn !== yesterday && t.doneOn !== today && !skip.includes(t.id)
  ));
}

/**
 * Where a long-term task's deadline can be moved with one tap from its pill: tomorrow, in three days, in a week, each
 * counted from `today` (a day key) and given as a day key. A move to the deadline it already has is left out.
 */
export function deadlineMoves(today: string, current?: string): { label: string; days: number; dateKey: string }[] {
  const base = new Date(today + 'T00:00:00');
  if (isNaN(base.getTime())) return [];
  const out: { label: string; days: number; dateKey: string }[] = [];
  for (const [label, days] of [['Tomorrow', 1], ['In 3 days', 3], ['In a week', 7]] as const) {
    const dateKey = todayKey(new Date(base.getFullYear(), base.getMonth(), base.getDate() + days));
    if (dateKey !== current) out.push({ label, days, dateKey });
  }
  return out;
}
