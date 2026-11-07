import { create } from 'zustand';

/**
 * Where the intro is. `playing`: it covers the app, which may already be built beneath it. `leaving`: its scene has
 * settled back into the material and the app makes its entrance in its place. `done`: it is gone.
 */
export type IntroPhase = 'playing' | 'leaving' | 'done';

const ORDER: Record<IntroPhase, number> = { playing: 0, leaving: 1, done: 2 };

export interface IntroState {
  phase: IntroPhase;
  /**
   * The app beneath the overlay has painted its first frames (markAppDrawn): a skipped intro waits for this before it
   * clears, so the overlay never fades onto a page still being built.
   */
  appDrawn: boolean;
  /** the app's faces have loaded (noteAppFonts): until then the app cannot draw, so a skip may wait longer for it */
  appFonts: boolean;
  /**
   * The intro's composed scene is holding still just before it hands over: a moment where building a screen out of
   * sight never shows as a stutter (Today prepares the other tabs then).
   */
  resting: boolean;
}

export const useIntro = create<IntroState>(() => ({ phase: 'playing', appDrawn: false, appFonts: false, resting: false }));

/** The intro says when its scene is holding still before the hand-over (StartScreen). */
export function setResting(on: boolean) {
  if (useIntro.getState().resting !== on) useIntro.setState({ resting: on });
}

/** How long after the intro is gone the app's entrance is left to play with nothing else scheduled. */
export const QUIET_MS = 900;

/**
 * Runs `fn` once the intro is gone and the app's entrance has had QUIET_MS to itself: the moment for work that writes
 * the store or builds out of sight (the cloud, reminders, screens made ahead), so none of it lands on the entrance.
 * Returns a cancel.
 */
export function afterEntrance(fn: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let off: (() => void) | null = null;
  const arm = () => { timer = setTimeout(fn, QUIET_MS); };
  if (useIntro.getState().phase === 'done') arm();
  else off = useIntro.subscribe((s) => { if (s.phase === 'done' && off) { off(); off = null; arm(); } });
  return () => { off?.(); if (timer) clearTimeout(timer); };
}

/** Moves the intro forward; it never goes back, so a late or repeated call is harmless. */
export function setIntroPhase(phase: IntroPhase) {
  if (ORDER[phase] > ORDER[useIntro.getState().phase]) useIntro.setState({ phase });
}

/**
 * Says the app has drawn: called once by the root layout, two frames after the navigator's container first lays out
 * (so the first screen's own first paint is on the screen). Repeated calls change nothing.
 */
export function markAppDrawn() {
  if (!useIntro.getState().appDrawn) useIntro.setState({ appDrawn: true });
}

/** Says the app's faces are in (the root layout, once they load or fail). */
export function noteAppFonts() {
  if (!useIntro.getState().appFonts) useIntro.setState({ appFonts: true });
}

/** How long a skip waits for the app to draw before it clears anyway: longer only while the app's faces are still loading. */
export const SKIP_WAIT_MS = 900;
export const SKIP_WAIT_NO_FONTS_MS = 2500;
