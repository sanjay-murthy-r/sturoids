import { create } from 'zustand';

/**
 * Where the intro is. `playing`: it covers the app, which may already be built beneath it. `leaving`: its scene has
 * settled back into the material and the app makes its entrance in its place. `done`: it is gone.
 */
export type IntroPhase = 'playing' | 'leaving' | 'done';

const ORDER: Record<IntroPhase, number> = { playing: 0, leaving: 1, done: 2 };

export const useIntro = create<{ phase: IntroPhase }>(() => ({ phase: 'playing' }));

/** Moves the intro forward; it never goes back, so a late or repeated call is harmless. */
export function setIntroPhase(phase: IntroPhase) {
  if (ORDER[phase] > ORDER[useIntro.getState().phase]) useIntro.setState({ phase });
}
