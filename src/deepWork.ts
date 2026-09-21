import { useEffect, useState } from 'react';

/** What a running Deep Work session needs to show its time, shared by the Focus screen and the ambient view. */
export interface TimerState {
  mode: 'stopwatch' | 'countdown'; targetMin: number; running: boolean; startTs: number | null; accumSec: number;
}

export const elapsedOf = (t: TimerState) => t.accumSec + (t.running && t.startTs ? (Date.now() - t.startTs) / 1000 : 0);

/** Seconds to show: time left on a countdown, time spent on a stopwatch. */
export const displayOf = (t: TimerState) => (t.mode === 'countdown' ? Math.max(0, t.targetMin * 60 - elapsedOf(t)) : elapsedOf(t));

/**
 * The whole seconds every clock shows. A countdown rounds up, so it starts on its full length (50:00) and reads 0:00
 * only as it ends; a stopwatch rounds down. The Deep Work clock and the ambient clock both read this, so they agree.
 */
export const shownSecondsOf = (t: TimerState) => (t.mode === 'countdown' ? Math.ceil(displayOf(t)) : Math.floor(displayOf(t)));

/** The one-off notifications a session posts, each under a fixed id so a later launch can still replace or cancel it. */
export const COUNTDOWN_NOTIF_ID = 'sturoids-countdown-end';
export const FINISH_NOTIF_ID = 'sturoids-finish-line';

/** Re-renders its caller once per displayed second, aligned to the session's own second boundary. */
export function useSessionTick(t: TimerState) {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!t.running || !t.startTs) return undefined;
    const anchor = t.startTs - t.accumSec * 1000;
    let iv: ReturnType<typeof setInterval> | undefined;
    const first = setTimeout(() => {
      setN((x) => x + 1);
      iv = setInterval(() => setN((x) => x + 1), 1000);
    }, 1000 - ((Date.now() - anchor) % 1000) + 8);
    return () => {
      clearTimeout(first);
      if (iv) clearInterval(iv);
    };
  }, [t.running, t.startTs, t.accumSec]);
}
