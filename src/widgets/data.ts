// What several of Today's widgets read, each as a hook over its own slice of the store, so a save elsewhere (a journal
// page being written) re-renders only the widgets that show it.

import React from 'react';
import { useStore } from '../store';
import { habitDueOn, todayKey } from '../utils';
import { useBoardNow } from './kit';
import { TodayItem, nextBlockOf, todayItems } from './logic';

/** Today's list: the ToDos due today and the long-term tasks due today or late. */
export function useTodayItems(): TodayItem[] {
  const now = useBoardNow();
  const today = todayKey(now);
  const dailies = useStore((s) => s.dailyTasks);
  const missions = useStore((s) => s.missions);
  return React.useMemo(() => todayItems(dailies, missions, today), [dailies, missions, today]);
}

/** Today's habits: those due today, and any ticked today on a rest day. */
export function useTodaysHabits() {
  const today = todayKey(useBoardNow());
  const habits = useStore((s) => s.habits);
  return React.useMemo(
    () => habits.filter((h) => habitDueOn(h, today) || h.doneDates.includes(today)),
    [habits, today],
  );
}

/**
 * The minutes focused today, with a session still going counted as it runs (from the day it began, as it will be once
 * it is logged), to the minute.
 */
export function useFocusToday(): number {
  const now = useBoardNow();
  const today = todayKey(now);
  const logged = useStore((s) => {
    let secs = 0;
    for (const x of s.sessions) if (x.dateKey === today) secs += x.netSeconds;
    return Math.round(secs / 60);
  });
  return logged + useLiveMin(now, today);
}

/** A Deep Work session in flight, counted to the minute for today (0 with none, or one begun another day). */
export function useLiveMin(now: Date, today: string): number {
  const on = useStore((s) => !!s.deepWork);
  const running = useStore((s) => !!s.deepWork?.running);
  const startTs = useStore((s) => s.deepWork?.startTs ?? null);
  const accum = useStore((s) => s.deepWork?.accumSec ?? 0);
  const startedAt = useStore((s) => s.deepWork?.startedAt ?? 0);
  const cap = useStore((s) => (s.deepWork?.mode === 'countdown' ? s.deepWork.targetMin * 60 : Infinity));
  if (!on || todayKey(new Date(startedAt)) !== today) return 0;
  return Math.round(Math.min(cap, accum + (running && startTs ? Math.max(0, now.getTime() - startTs) / 1000 : 0)) / 60);
}

/**
 * The block the plan shows (on now, next, or tomorrow's first). Worked out each minute, but it keeps its identity while
 * it is the same block with the same tag, so a new minute never re-renders what reads it.
 */
export function useNextBlock() {
  const now = useBoardNow();
  const planner = useStore((s) => s.planner);
  const fresh = React.useMemo(() => nextBlockOf(planner, now), [planner, now]);
  const key = fresh ? fresh.block.id + ':' + fresh.tag : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return React.useMemo(() => fresh, [key, planner]);
}
