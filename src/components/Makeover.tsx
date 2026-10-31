// Makeover: the switch between Elite and Cheerful, played full screen. The screen covers the app, the new mood is set
// under it, and the seconds it plays are put to use: the data is saved to the phone, the reminders are laid out again,
// the day is tidied, Sift's memory is read in, and anything waiting goes up to the cloud. Each job is ticked off on the
// screen as it is done, and the screen lifts once the motion has played and the jobs are through (or have had their
// time: a slow network never holds it).
//
// Elite arrives as calm precision: a hairline draws out from the middle, the word settles in from wide letter-spacing.
// Cheerful arrives as warmth: morning light rises from below, motes drift up, the letters lift in on a gentle wave.

import React from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing, FadeIn, runOnJS, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { create } from 'zustand';
import { C, F, MIN, TRACK, bgFor } from '../theme';
import { Mood, flushSaves, useStore } from '../store';
import { useAnimLevel } from './Motion';
import { CHEER } from './Cheer';
import { cheer as playCheer } from '../cheerSound';
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
      // its little run plays as the letters lift in
      if (cheer) setTimeout(() => playCheer('makeover'), 420);
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

// Warm, not loud: the cover stays the app's own dark, a soft warmth rises from below like morning light, a few motes of
// light drift up through it, and the word lifts in letter by letter in a gentle wave, in the app's ink, with a line
// drawing out under it in the accent. The colour is in the light, never on the letters, so every letter reads.

const MOTES = 12;

function Mote({ i, width, height, still }: { i: number; width: number; height: number; still: boolean }) {
  const p = useSharedValue(still ? 0.5 : 0);
  // a seeded spread: each mote its own place, size, pace and colour
  const r = (k: number) => ((Math.sin(i * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1;
  const x = width * (0.12 + 0.76 * r(1));
  const size = 3 + 4 * r(2);
  const rise = height * (0.22 + 0.2 * r(3));
  const color = [C.accent, CHEER.sun, '#FFFFFF', CHEER.pink][i % 4];
  React.useEffect(() => {
    if (still) return;
    p.value = withDelay(200 + r(4) * 700, withTiming(1, { duration: 2200 + r(5) * 800, easing: Easing.out(Easing.quad) }));
  }, []);
  const style = useAnimatedStyle(() => ({
    opacity: p.value < 0.2 ? p.value / 0.2 * 0.7 : 0.7 * (1 - (p.value - 0.2) / 0.8),
    transform: [{ translateX: x + Math.sin(p.value * 5 + i) * 8 }, { translateY: height * 0.78 - rise * p.value }] as const,
  }));
  return <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style]} />;
}

function Letter({ ch, i, still }: { ch: string; i: number; still: boolean }) {
  const p = useSharedValue(still ? 1 : 0);
  React.useEffect(() => {
    if (still) return;
    // a soft spring: a little lift past its place and back, never a wobble
    p.value = withDelay(380 + i * 55, withSpring(1, { damping: 13, stiffness: 160, mass: 0.8 }));
  }, []);
  const style = useAnimatedStyle(() => ({
    opacity: Math.min(1, p.value * 1.4),
    transform: [{ translateY: 18 * (1 - p.value) }, { scale: 0.92 + 0.08 * p.value }] as const,
  }));
  return <Animated.Text style={[st.cheerLetter, style]}>{ch}</Animated.Text>;
}

function CheerStage({ width, height, still }: { width: number; height: number; still: boolean }) {
  const warm = useSharedValue(still ? 1 : 0);
  const line = useSharedValue(still ? 1 : 0);
  const sub = useSharedValue(still ? 1 : 0);
  React.useEffect(() => {
    if (still) return;
    warm.value = withTiming(1, { duration: 1600, easing: Easing.out(Easing.cubic) });
    line.value = withDelay(820, withTiming(1, { duration: 800, easing: Easing.bezier(0.2, 0, 0, 1) }));
    sub.value = withDelay(1150, withTiming(1, { duration: 500 }));
  }, []);
  const warmStyle = useAnimatedStyle(() => ({ opacity: warm.value, transform: [{ translateY: 60 * (1 - warm.value) }] }));
  const lineStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: line.value }], opacity: line.value }));
  const subStyle = useAnimatedStyle(() => ({ opacity: sub.value, transform: [{ translateY: 6 * (1 - sub.value) }] }));
  const s = Math.max(width, height);
  return (
    <View style={st.center}>
      {/* morning light from below: warm, then the accent, both soft */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, warmStyle]}>
        <Svg width={width} height={height}>
          <Defs>
            <RadialGradient id="mkwarm" cx="50%" cy="100%" r="75%">
              <Stop offset="0" stopColor={CHEER.sun} stopOpacity={0.26} />
              <Stop offset="0.45" stopColor={CHEER.pink} stopOpacity={0.12} />
              <Stop offset="1" stopColor={CHEER.pink} stopOpacity={0} />
            </RadialGradient>
            <RadialGradient id="mkacc" cx="50%" cy="48%" r="45%">
              <Stop offset="0" stopColor={C.accent} stopOpacity={0.16} />
              <Stop offset="1" stopColor={C.accent} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width={width} height={height} fill="url(#mkwarm)" />
          <Rect x="0" y="0" width={width} height={height} fill="url(#mkacc)" />
        </Svg>
      </Animated.View>
      {Array.from({ length: still ? 0 : MOTES }, (_, i) => <Mote key={i} i={i} width={width} height={height} still={still} />)}
      <View style={{ flexDirection: 'row' }}>
        {'Cheerful'.split('').map((ch, i) => <Letter key={i} ch={ch} i={i} still={still} />)}
      </View>
      <Animated.View style={[st.rule, { width: Math.min(220, s * 0.4), backgroundColor: C.accent }, lineStyle]} />
      <Animated.Text style={[st.sub, subStyle]}>Same app, a little more joy</Animated.Text>
    </View>
  );
}

const st = StyleSheet.create({
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  eliteWord: { color: C.text, fontFamily: F.head, fontSize: 52, lineHeight: 62 },
  rule: { height: 1.5, borderRadius: 1, marginTop: 18 },
  sub: { color: C.textDim, fontFamily: F.smMed, fontSize: 14, letterSpacing: TRACK.small, marginTop: 18 },
  cheerLetter: { color: '#F7F4EE', fontFamily: F.brand, fontSize: 48, lineHeight: 60, letterSpacing: 0.5 },
  jobs: { position: 'absolute', left: 0, right: 0, bottom: 64, alignItems: 'center', gap: 6 },
  job: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  jobText: { color: C.textFaint, fontFamily: F.sm, fontSize: 12, letterSpacing: TRACK.fine },
});
