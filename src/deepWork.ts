import { useEffect, useState } from 'react';

/** What a running Deep Work session needs to show its time, shared by the Focus screen and the ambient view. */
export interface TimerState {
  mode: 'stopwatch' | 'countdown'; targetMin: number; running: boolean; startTs: number | null; accumSec: number;
}

/** Seconds counted so far; never below zero, so a phone clock set back can never run a session backwards. */
export const elapsedOf = (t: TimerState) =>
  Math.max(0, t.accumSec + (t.running && t.startTs ? (Date.now() - t.startTs) / 1000 : 0));

/** Seconds to show: time left on a countdown, time spent on a stopwatch. */
export const displayOf = (t: TimerState) => (t.mode === 'countdown' ? Math.max(0, t.targetMin * 60 - elapsedOf(t)) : elapsedOf(t));

/**
 * The whole seconds every clock shows. A countdown rounds up, so it starts on its full length (50:00) and reads 0:00
 * only as it ends; a stopwatch rounds down. The Deep Work clock and the ambient clock both read this, so they agree.
 */
export const shownSecondsOf = (t: TimerState) => (t.mode === 'countdown' ? Math.ceil(displayOf(t)) : Math.floor(displayOf(t)));

const unit = (n: number, word: string) => n + ' ' + word + (n === 1 ? '' : 's');

/**
 * The clock said to the minute, for a screen reader: "41 minutes left", "1 hour 5 minutes so far". It rounds the way
 * the clock does, so it changes once a minute, together with the minutes on the clock.
 */
export function spokenTimeOf(t: TimerState): string {
  const countdown = t.mode === 'countdown';
  const secs = shownSecondsOf(t);
  const mins = countdown ? Math.ceil(secs / 60) : Math.floor(secs / 60);
  if (mins === 0) return countdown ? 'Block done' : 'Under a minute so far';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const words = [h > 0 ? unit(h, 'hour') : '', m > 0 ? unit(m, 'minute') : ''].filter(Boolean).join(' ');
  return words + (countdown ? ' left' : ' so far');
}

/** The one-off notifications a session posts, each under a fixed id so a later launch can still replace or cancel it. */
export const COUNTDOWN_NOTIF_ID = 'sturoids-countdown-end';
export const FINISH_NOTIF_ID = 'sturoids-finish-line';

/**
 * Re-renders its caller once per displayed second, aligned to the session's own second boundary, or once per `every`
 * seconds (60 for a caller that shows only minutes). `hold` stops it for a clock nobody can see (the plate under the
 * ambient screen, behind another tab, or with the app away); it shows the right time again the moment it is let go.
 */
export function useSessionTick(t: TimerState, hold = false, every = 1) {
  const [, setN] = useState(0);
  useEffect(() => {
    if (hold || !t.running || !t.startTs) return undefined;
    const anchor = t.startTs - t.accumSec * 1000;
    const step = every * 1000;
    let iv: ReturnType<typeof setInterval> | undefined;
    const first = setTimeout(() => {
      setN((x) => x + 1);
      iv = setInterval(() => setN((x) => x + 1), step);
    }, step - (((Date.now() - anchor) % step) + step) % step + 8);
    return () => {
      clearTimeout(first);
      if (iv) clearInterval(iv);
    };
  }, [t.running, t.startTs, t.accumSec, hold, every]);
}
