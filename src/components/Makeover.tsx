// Makeover: the switch between Elite and Cheerful, played full screen. The screen covers the app, the new mood is set
// under it, and the seconds it plays are put to use: the data is saved to the phone, the reminders are laid out again,
// the day is tidied, Sift's memory is read in, and anything waiting goes up to the cloud. Each job is ticked off on the
// screen as it is done, and the screen lifts once the motion has played and the jobs are through (or have had their
// time: a slow network never holds it).
//
// Elite arrives as calm precision: a hairline draws out from the middle, the word settles in from wide letter-spacing.
// Cheerful arrives as a burst: colour blooms out, the letters pop in one by one, confetti falls.

import React from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing, FadeIn, runOnJS, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { create } from 'zustand';
import { C, F, MIN, TRACK, bgFor } from '../theme';
import { Mood, flushSaves, useStore } from '../store';
import { useAnimLevel } from './Motion';
import { CHEER, celebrate } from './Cheer';
import { useTheme } from './UI';
import { tick } from '../haptics';

const useMakeover = create<{ to: Mood | null; n: number }>(() => ({ to: null, n: 0 }));

/** Switches the app's mood, with the full-screen makeover. */
export function startMakeover(to: Mood) {
  if (useStore.getState().settings.mood === to || useMakeover.getState().to) return;
  useMakeover.setState((s) => ({ to, n: s.n + 1 }));
}

/** the screen plays at least this long; the jobs get at most this much more before it lifts anyway */
const PLAY_MS = 2300;
const GRACE_MS = 1500;

interface Job { label: string; run: () => Promise<unknown> }

/** The work done behind the screen: real upkeep that would otherwise wait for a quiet moment. */
function jobs(): Job[] {
  return [
    { label: 'Your data saved on this device', run: () => flushSaves() },
    {
      label: 'Reminders laid out again',
      run: () => import('../notifications').then((m) => m.rescheduleAllReminders()),
    },
    { label: 'Today tidied', run: async () => { useStore.getState().settleDay(); } },
    { label: 'Sift warmed up', run: () => import('../search/store').then((m) => m.loadSiftMemory()) },
    {
      label: 'Synced with the cloud',
      run: () => import('../cloud').then(async (m) => {
        const c = m.useCloud.getState();
        if (c.status === 'signed-out' || c.status === 'choice') return 'skip';
        await m.syncNow();
        return undefined;
      }),
    },
  ];
}

/** Mounted once, over everything (the root layout). */
export function MakeoverHost() {
  const { to, n } = useMakeover();
  if (!to) return null;
  return <MakeoverScreen key={n} to={to} onDone={() => useMakeover.setState({ to: null })} />;
}

function MakeoverScreen({ to, onDone }: { to: Mood; onDone: () => void }) {
  const level = useAnimLevel();
  const theme = useTheme();
  const { width, height } = useWindowDimensions();
  const cheer = to === 'cheerful';
  const cover = useSharedValue(0);
  const [done, setDone] = React.useState<string[]>([]);
  const [list] = React.useState(jobs);

  React.useEffect(() => {
    tick();
    let live = true;
    const t0 = Date.now();
    const motion = level === 'none' ? 0 : 1;
    cover.value = motion ? withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) }) : 1;
    // the mood changes under the cover, once it is whole
    const swap = setTimeout(() => {
      useStore.getState().setSetting('mood', to);
      if (cheer) setTimeout(() => celebrate(true), 350);
    }, motion ? 360 : 0);
    // the jobs, one after another, each ticked off as it finishes; one that fails or is not for now is let go quietly
    const work = (async () => {
      for (const j of list) {
        try {
          const r = await Promise.race([j.run(), new Promise((res) => setTimeout(() => res('slow'), 2500))]);
          if (r === 'skip') continue;
        } catch {
          continue;
        }
        if (live) setDone((d) => [...d, j.label]);
      }
    })();
    const finish = () => {
      if (!live) return;
      const lift = () => onDone();
      if (!motion) { lift(); return; }
      cover.value = withTiming(0, { duration: 420, easing: Easing.inOut(Easing.cubic) }, (fin) => { if (fin) runOnJS(lift)(); });
    };
    const min = motion ? PLAY_MS : 900;
    Promise.race([work, new Promise((r) => setTimeout(r, min + GRACE_MS))]).then(() => {
      const left = Math.max(0, min - (Date.now() - t0));
      setTimeout(finish, left + 250);
    });
    return () => { live = false; clearTimeout(swap); };
  }, []);

  const coverStyle = useAnimatedStyle(() => ({ opacity: cover.value }));
  const bg = theme === 'minimal' ? MIN.bg : bgFor(theme);

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: bg, zIndex: 9999 }, coverStyle]} accessibilityViewIsModal accessibilityLabel={cheer ? 'Switching to Cheerful' : 'Switching to Elite'}>
      {cheer ? <CheerStage width={width} height={height} still={level !== 'full'} /> : <EliteStage width={width} still={level !== 'full'} />}
      <View style={st.jobs}>
        {list.map((j) => {
          const ok = done.includes(j.label);
          return ok ? (
            <Animated.View key={j.label} entering={level === 'none' ? undefined : FadeIn.duration(220)} style={st.job}>
              <Ionicons name="checkmark" size={13} color={cheer ? CHEER.mint : C.accent} />
              <Text style={st.jobText}>{j.label}</Text>
            </Animated.View>
          ) : null;
        })}
      </View>
    </Animated.View>
  );
}

/* ---------------------------------------------------------------- Elite */

function EliteStage({ width, still }: { width: number; still: boolean }) {
  const line = useSharedValue(still ? 1 : 0);
  const word = useSharedValue(still ? 1 : 0);
  React.useEffect(() => {
    if (still) return;
    line.value = withDelay(260, withTiming(1, { duration: 900, easing: Easing.bezier(0.2, 0, 0, 1) }));
    word.value = withDelay(520, withTiming(1, { duration: 1100, easing: Easing.bezier(0.2, 0, 0, 1) }));
  }, []);
  const lineStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: line.value }], opacity: 0.25 + 0.75 * line.value }));
  const wordStyle = useAnimatedStyle(() => ({
    opacity: word.value,
    letterSpacing: 18 * (1 - word.value) + 2,
    transform: [{ translateY: 6 * (1 - word.value) }],
  }));
  const subStyle = useAnimatedStyle(() => ({ opacity: Math.max(0, (word.value - 0.5) / 0.5) }));
  return (
    <View style={st.center}>
      <Animated.Text style={[st.eliteWord, wordStyle]}>Elite</Animated.Text>
      <Animated.View style={[st.rule, { width: Math.min(260, width * 0.6), backgroundColor: C.accent }, lineStyle]} />
      <Animated.Text style={[st.sub, subStyle]}>Calm. Precise. Yours.</Animated.Text>
    </View>
  );
}

/* ---------------------------------------------------------------- Cheerful */

function Bloom({ color, size, delay, still }: { color: string; size: number; delay: number; still: boolean }) {
  const p = useSharedValue(still ? 1 : 0);
  React.useEffect(() => {
    if (still) return;
    p.value = withDelay(delay, withTiming(1, { duration: 1300, easing: Easing.bezier(0.16, 1, 0.3, 1) }));
  }, []);
  const style = useAnimatedStyle(() => ({ opacity: p.value * 0.9, transform: [{ scale: 0.2 + 0.8 * p.value }] }));
  const id = 'bloom' + color.replace('#', '');
  return (
    <Animated.View style={[{ position: 'absolute', width: size, height: size, left: -size / 2, top: -size / 2 }, style]}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={color} stopOpacity={0.55} />
            <Stop offset="0.5" stopColor={color} stopOpacity={0.18} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width={size} height={size} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

function Letter({ ch, i, still, color }: { ch: string; i: number; still: boolean; color: string }) {
  const p = useSharedValue(still ? 1 : 0);
  React.useEffect(() => {
    if (still) return;
    p.value = withDelay(420 + i * 70, withSpring(1, { damping: 9, stiffness: 180, mass: 0.7 }));
  }, []);
  const style = useAnimatedStyle(() => ({
    opacity: Math.min(1, p.value * 1.6),
    transform: [{ translateY: 26 * (1 - p.value) }, { scale: 0.4 + 0.6 * p.value }, { rotate: (1 - p.value) * (i % 2 ? 14 : -14) + 'deg' }] as const,
  }));
  return <Animated.Text style={[st.cheerLetter, { color }, style]}>{ch}</Animated.Text>;
}

function CheerStage({ width, height, still }: { width: number; height: number; still: boolean }) {
  const s = Math.max(width, height) * 1.1;
  const colors = [C.accent, CHEER.pink, CHEER.sun, CHEER.mint, CHEER.sky];
  const sub = useSharedValue(still ? 1 : 0);
  const spin = useSharedValue(0);
  React.useEffect(() => {
    if (still) return;
    sub.value = withDelay(1150, withTiming(1, { duration: 500 }));
    spin.value = withSequence(withDelay(300, withTiming(1, { duration: 1800, easing: Easing.out(Easing.cubic) })));
  }, []);
  const subStyle = useAnimatedStyle(() => ({ opacity: sub.value, transform: [{ translateY: 8 * (1 - sub.value) }] }));
  const ringStyle = useAnimatedStyle(() => ({ transform: [{ rotate: spin.value * 120 + 'deg' }] }));
  return (
    <View style={st.center}>
      <Animated.View style={[{ position: 'absolute', left: width / 2, top: height / 2 }, ringStyle]}>
        <View style={{ position: 'absolute', left: -s * 0.18, top: -s * 0.12 }}><Bloom color={CHEER.pink} size={s * 0.7} delay={80} still={still} /></View>
        <View style={{ position: 'absolute', left: s * 0.16, top: -s * 0.06 }}><Bloom color={CHEER.sun} size={s * 0.6} delay={180} still={still} /></View>
        <View style={{ position: 'absolute', left: -s * 0.04, top: s * 0.16 }}><Bloom color={CHEER.mint} size={s * 0.62} delay={280} still={still} /></View>
        <View style={{ position: 'absolute', left: 0, top: 0 }}><Bloom color={C.accent} size={s * 0.75} delay={0} still={still} /></View>
      </Animated.View>
      <View style={{ flexDirection: 'row' }}>
        {'Cheerful'.split('').map((ch, i) => <Letter key={i} ch={ch} i={i} still={still} color={colors[i % colors.length]} />)}
      </View>
      <Animated.Text style={[st.sub, { color: '#F4F1EA' }, subStyle]}>Same app, a little more joy</Animated.Text>
    </View>
  );
}

const st = StyleSheet.create({
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  eliteWord: { color: C.text, fontFamily: F.head, fontSize: 52, lineHeight: 62 },
  rule: { height: 1.5, borderRadius: 1, marginTop: 18 },
  sub: { color: C.textDim, fontFamily: F.smMed, fontSize: 14, letterSpacing: TRACK.small, marginTop: 18 },
  cheerLetter: { fontFamily: F.brand, fontSize: 50, lineHeight: 62 },
  jobs: { position: 'absolute', left: 0, right: 0, bottom: 64, alignItems: 'center', gap: 6 },
  job: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  jobText: { color: C.textFaint, fontFamily: F.sm, fontSize: 12, letterSpacing: TRACK.fine },
});
