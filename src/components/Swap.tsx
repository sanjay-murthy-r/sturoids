import React from 'react';
import { FadeIn } from 'react-native-reanimated';
import { NavigationContext } from '@react-navigation/native';
import { useIntro } from '../intro';
import { AnimLevel } from '../theme';
import { FADE_IN, riseIn, shiftIn, useAnimLevel, useBuilt } from './Motion';

// How a view takes another's place inside a screen: a segment's view, a stage, a list where an empty note stood. One
// place decides it, so every switch in the app answers at the motion level the same way.

/**
 * A panel that replaces another in place. With full motion it rises a short way as it comes up; with some it is a quick
 * fade and nothing travels; with none it is simply there.
 */
export const swapIn = (level: AnimLevel) =>
  (level === 'none' ? undefined : level === 'full' ? riseIn : FadeIn.duration(FADE_IN.duration).easing(FADE_IN.easing));

/** The same for a view that sits beside the one it replaces (`dx` positive: from the right). */
export const slideIn = (level: AnimLevel, dx: number) =>
  (level === 'none' ? undefined : level === 'full' ? shiftIn(dx) : FadeIn.duration(FADE_IN.duration).easing(FADE_IN.easing));

/**
 * The entrance for a view keyed on `key`, which mounts anew when the key changes. `place` says where the view sits among
 * the others it can be swapped with (a segment's index): one further along comes in from the right, an earlier one from
 * the left, and one in the same place (a list that fills where an empty note stood) rises. Nothing plays for the view a
 * screen is built with (its own entrance brings that in), or while the screen is out of sight or the intro is playing.
 * Put the result on the keyed view as `entering`.
 */
export function useSwapIn(key: string, place = 0, travel = 16) {
  const level = useAnimLevel();
  const nav = React.useContext(NavigationContext);
  const built = useBuilt();
  const last = React.useRef({ key, place, dir: 0 });
  if (last.current.key !== key) {
    last.current = { key, place, dir: place > last.current.place ? 1 : place < last.current.place ? -1 : 0 };
  }
  if (!built.current || (nav && !nav.isFocused()) || useIntro.getState().phase === 'playing') return undefined;
  const dir = last.current.dir;
  return dir ? slideIn(level, dir * travel) : swapIn(level);
}
