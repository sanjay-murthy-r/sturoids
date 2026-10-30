// Makeover's Cheerful side: the same app, a little more alive. Never loud and never in the way: soft colour drifting
// slowly behind the pages, a few sparks when something is ticked, confetti when a session or a day is done, a gentle
// bob on an empty page's picture, and a friendlier word here and there. Elite (the default) has none of it. Everything
// here stands still with motion off, and only moves at full motion.

import React from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { create } from 'zustand';
import { C } from '../theme';
import { useStore } from '../store';
import { useAnimLevel } from './Motion';
import { toast } from './Toast';
import { todayKey, todoDueOn } from '../utils';
import { NavigationContext } from '@react-navigation/native';

/** Whether the app is in its Cheerful makeover. */
export function useCheerful(): boolean {
  return useStore((s) => s.settings.mood === 'cheerful');
}
export const isCheerful = () => useStore.getState().settings.mood === 'cheerful';

/** Cheerful's own colours beside the accent: warm and bright, used only in light touches */
export const CHEER = { pink: '#FF8FB1', sun: '#FFC86B', mint: '#7EE0C3', sky: '#8CC8FF' };
const PARTY = () => [C.accent, CHEER.pink, CHEER.sun, CHEER.mint, CHEER.sky];

/* ---------------------------------------------------------------- the backdrop */

/** Whether the screen is in front, or true outside a navigator. */
function useMaybeFocused(): boolean {
  const nav = React.useContext(NavigationContext);
  const [focused, setFocused] = React.useState(() => (nav ? nav.isFocused() : true));
  React.useEffect(() => {
    if (!nav) return undefined;
    const a = nav.addListener('focus', () => setFocused(true));
    const b = nav.addListener('blur', () => setFocused(false));
    return () => { a(); b(); };
  }, [nav]);
  return focused;
}

/** One soft glow: a radial fade of a colour, drifting on a long loop. */
function Glow({ color, size, from, to, ms, delay, strength, still }: {
  color: string; size: number; from: [number, number]; to: [number, number]; ms: number; delay: number; strength: number; still: boolean;
}) {
  const t = useSharedValue(0);
  React.useEffect(() => {
    if (still) { t.value = 0.5; return undefined; }
    t.value = withDelay(delay, withRepeat(withTiming(1, { duration: ms, easing: Easing.inOut(Easing.sin) }), -1, true));
    return () => cancelAnimation(t);
  }, [still]);
  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: from[0] + (to[0] - from[0]) * t.value - size / 2 },
      { translateY: from[1] + (to[1] - from[1]) * t.value - size / 2 },
      { scale: 0.9 + 0.2 * t.value },
    ] as const,
  }));
  const id = 'g' + color.replace('#', '');
  return (
    <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: size, height: size }, style]}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={color} stopOpacity={strength} />
            <Stop offset="0.55" stopColor={color} stopOpacity={strength * 0.35} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width={size} height={size} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

/**
 * The page's backdrop in Cheerful: three soft glows of colour drifting slowly behind everything, seen between the
 * cards. Fainter on the minimal look. Nothing in Elite.
 */
export function Backdrop({ minimal }: { minimal: boolean }) {
  const cheerful = useCheerful();
  const level = useAnimLevel();
  const { width, height } = useWindowDimensions();
  // only the page in front drifts: the tabs behind it hold still
  const focused = useMaybeFocused();
  if (!cheerful) return null;
  const still = level !== 'full' || !focused;
  const s = Math.max(width, height) * 0.75;
  const k = minimal ? 0.1 : 0.16;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
      <Glow color={C.accent} size={s} from={[width * 0.1, height * 0.12]} to={[width * 0.45, height * 0.3]} ms={17000} delay={0} strength={k} still={still} />
      <Glow color={CHEER.pink} size={s * 0.9} from={[width * 0.95, height * 0.55]} to={[width * 0.6, height * 0.75]} ms={21000} delay={1200} strength={k * 0.85} still={still} />
      <Glow color={CHEER.mint} size={s * 0.8} from={[width * 0.2, height * 0.95]} to={[width * 0.5, height * 0.7]} ms={19000} delay={2400} strength={k * 0.7} still={still} />
    </View>
  );
}

/* ---------------------------------------------------------------- sparks: a small burst where something was ticked */

function Spark({ angle, color, dist, size, delay }: { angle: number; color: string; dist: number; size: number; delay: number }) {
  const p = useSharedValue(0);
  React.useEffect(() => {
    p.value = withDelay(delay, withTiming(1, { duration: 560, easing: Easing.out(Easing.cubic) }));
  }, []);
  const style = useAnimatedStyle(() => ({
    opacity: p.value < 0.6 ? 1 : 1 - (p.value - 0.6) / 0.4,
    transform: [
      { translateX: Math.cos(angle) * dist * p.value },
      { translateY: Math.sin(angle) * dist * p.value },
      { scale: 1 - 0.5 * p.value },
    ] as const,
  }));
  return <Animated.View style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: color, left: -size / 2, top: -size / 2 }, style]} />;
}

/**
 * Sparks flying out of a point (the middle of what holds it) whenever `fire` changes to a new truthy value: a tick's
 * little celebration. Cheerful, at full motion, only.
 */
export function Sparks({ fire, size = 26 }: { fire: number; size?: number }) {
  const cheerful = useCheerful();
  const level = useAnimLevel();
  if (!cheerful || level !== 'full' || !fire) return null;
  const colors = PARTY();
  return (
    <View key={fire} pointerEvents="none" style={{ position: 'absolute', left: '50%', top: '50%', width: 0, height: 0 }}>
      {Array.from({ length: 9 }, (_, i) => (
        <Spark key={i} angle={(i / 9) * Math.PI * 2 + 0.3} color={colors[i % colors.length]} dist={size * (0.85 + (i % 3) * 0.18)} size={i % 2 ? 4 : 5} delay={i % 3 * 18} />
      ))}
    </View>
  );
}

/* ---------------------------------------------------------------- confetti: a session done, a day done */

const useCelebrate = create<{ n: number; big: boolean }>(() => ({ n: 0, big: false }));

/** Confetti over the app, in Cheerful (a quiet nothing in Elite or with motion off). */
export function celebrate(big = true) {
  if (!isCheerful()) return;
  useCelebrate.setState((s) => ({ n: s.n + 1, big }));
}

function Piece({ x, w, h, color, delay, drift, spin, fall, ms }: {
  x: number; w: number; h: number; color: string; delay: number; drift: number; spin: number; fall: number; ms: number;
}) {
  const p = useSharedValue(0);
  React.useEffect(() => {
    p.value = withDelay(delay, withTiming(1, { duration: ms, easing: Easing.bezier(0.2, 0.6, 0.4, 1) }));
  }, []);
  const style = useAnimatedStyle(() => ({
    opacity: p.value < 0.75 ? 1 : 1 - (p.value - 0.75) / 0.25,
    transform: [
      { translateX: x + Math.sin(p.value * Math.PI * 2) * drift },
      { translateY: -40 + fall * p.value },
      { rotate: spin * p.value + 'deg' },
    ] as const,
  }));
  return <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: w, height: h, borderRadius: 2, backgroundColor: color }, style]} />;
}

/** The open ToDos due today, and how many are due: a day is done when the first goes to none with some due. */
function dayLeft(): [number, number] {
  const today = todayKey();
  const due = useStore.getState().dailyTasks.filter((t) => todoDueOn(t, today));
  return [due.filter((t) => t.doneOn !== today).length, due.length];
}

/** Mounted once, over everything (the root layout). */
export function CelebrateHost() {
  const { n, big } = useCelebrate();
  // every ToDo due today ticked: the day is done, and Cheerful says so
  React.useEffect(() => {
    let [left] = dayLeft();
    return useStore.subscribe((s, prev) => {
      if (s.dailyTasks === prev.dailyTasks) return;
      const [now, due] = dayLeft();
      if (left > 0 && now === 0 && due > 0 && isCheerful()) {
        celebrate(true);
        setTimeout(() => toast('Every ToDo for today, done 🎉'), 500);
      }
      left = now;
    });
  }, []);
  const level = useAnimLevel();
  const { width, height } = useWindowDimensions();
  const [shown, setShown] = React.useState(0);
  React.useEffect(() => {
    if (!n || level !== 'full') return undefined;
    setShown(n);
    const t = setTimeout(() => setShown(0), 2600);
    return () => clearTimeout(t);
  }, [n]);
  if (!shown) return null;
  const colors = PARTY();
  const count = big ? 46 : 22;
  // a seeded spread, so a burst looks scattered without Math.random in render
  const r = (i: number, k: number) => ((Math.sin(i * 12.9898 + k * 78.233 + shown) * 43758.5453) % 1 + 1) % 1;
  return (
    <View key={shown} pointerEvents="none" style={StyleSheet.absoluteFill}>
      {Array.from({ length: count }, (_, i) => (
        <Piece
          key={i} x={r(i, 1) * width} w={6 + r(i, 2) * 5} h={9 + r(i, 3) * 7} color={colors[i % colors.length]}
          delay={r(i, 4) * 380} drift={10 + r(i, 5) * 26} spin={(r(i, 6) - 0.5) * 900}
          fall={height * (0.55 + r(i, 7) * 0.5)} ms={1500 + r(i, 8) * 700}
        />
      ))}
    </View>
  );
}

/* ---------------------------------------------------------------- looping touches */

/** A gentle float up and down, on a long loop: an empty page's picture, in Cheerful at full motion. */
export function Bob({ children, by = 4, ms = 2400 }: { children: React.ReactNode; by?: number; ms?: number }) {
  const cheerful = useCheerful();
  const level = useAnimLevel();
  const t = useSharedValue(0);
  const on = cheerful && level === 'full';
  React.useEffect(() => {
    if (!on) { cancelAnimation(t); t.value = 0; return undefined; }
    t.value = withRepeat(withSequence(
      withTiming(1, { duration: ms / 2, easing: Easing.inOut(Easing.sin) }),
      withTiming(0, { duration: ms / 2, easing: Easing.inOut(Easing.sin) }),
    ), -1);
    return () => cancelAnimation(t);
  }, [on]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: -by * t.value }] }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

/** A soft breathing glow behind something that is running (the Deep Work clock), in Cheerful at full motion. */
export function Breathe({ size, color }: { size: number; color?: string }) {
  const cheerful = useCheerful();
  const level = useAnimLevel();
  const t = useSharedValue(0);
  const on = cheerful && level === 'full';
  React.useEffect(() => {
    if (!on) return undefined;
    t.value = withRepeat(withTiming(1, { duration: 3200, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => cancelAnimation(t);
  }, [on]);
  const style = useAnimatedStyle(() => ({ opacity: 0.35 + 0.45 * t.value, transform: [{ scale: 0.92 + 0.1 * t.value }] }));
  if (!on) return null;
  const c = color ?? C.accent;
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', alignSelf: 'center', width: size, height: size }, style]}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id="breathe" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={c} stopOpacity={0.28} />
            <Stop offset="1" stopColor={c} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width={size} height={size} fill="url(#breathe)" />
      </Svg>
    </Animated.View>
  );
}
