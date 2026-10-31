// Cheerful's companion: a small pixel friend (picked in the mascot study) living on whatever screen is open. It perches
// near the edges (beside the header, on the floor by the tab bar, peeking in from the side), never over what is read or
// tapped, and hops between them now and then. It takes part: a little hop for a tick, a cheer with sparks for a
// session or a day done, a proud wave for a streak, and a word in its bubble a few times a day. When Deep Work starts
// it goes still and quiet; after a long time away it is found napping and wakes up. A tap gets a reaction; a long press
// tucks it away until tomorrow. Only in Cheerful, with motion on; drawn square by square with react-native-svg, and
// moved on the UI thread.

import React from 'react';
import { AppState, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing, FadeIn, FadeOut, cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Rect } from 'react-native-svg';
import { create } from 'zustand';
import { F, TRACK } from '../theme';
import { useStore } from '../store';
import { useAnimLevel } from './Motion';
import { toast } from './Toast';
import { todayKey } from '../utils';
import { WIDE_AT } from '../layout';
import { usePathname } from 'expo-router';

export type MascotId = 'blok' | 'pip' | 'sprout' | 'hoot';

interface Sprite { name: string; pal: Record<string, string>; grid: string[] }

/** The four friends, as drawn in the study: '.' nothing, 'b' body, 's' shade, 'h' light, 'd' eye, 'p' cheek, 'a' detail,
 *  'w' white, 'l' leaf, 'm' mouth */
export const MASCOTS: Record<MascotId, Sprite> = {
  blok: {
    name: 'Blok',
    pal: { b: '#9588F9', s: '#7768E0', h: '#B9B0FF', d: '#1E1B33', p: '#FF9BB8', a: '#FFC86B' },
    grid: [
      '...bbbbbbbbbb...',
      '...bhbbbbbbbb...',
      '...bbdbbbbdbb...',
      'bbbbbdbbbbdbbbbb',
      '...bpbbbbbbpbs..',
      '...bbbbbbbbbbs..',
      '...sssssssssss..',
      '....b.b..b.b....',
      '....s.s..s.s....',
    ],
  },
  pip: {
    name: 'Pip',
    pal: { b: '#FF9BB8', s: '#E57898', h: '#FFC5D6', d: '#2A1820', p: '#FF6F96', a: '#FFFFFF', m: '#2A1820' },
    grid: [
      '.....bbbbbb.....',
      '...bbbbbbbbbb...',
      '..bhhbbbbbbbbb..',
      '.bbhbdbbbbdbbbb.',
      '.bbbbdbbbbdbbbs.',
      'bbbpbbbmmbbbpbbs',
      'bbbbbbbbbbbbbbbs',
      '.bbbbbbbbbbbbss.',
      '..sssssssssss...',
      '...bb......bb...',
    ],
  },
  sprout: {
    name: 'Sprout',
    pal: { b: '#7EE0C3', s: '#58BFA2', h: '#B6F2E0', d: '#14302A', p: '#FF9BB8', a: '#FFC86B', l: '#9CDB6E' },
    grid: [
      '.......ll.......',
      '......lll.ll....',
      '.......l.lll....',
      '.......l........',
      '....bbbbbbbb....',
      '...bhbbbbbbbb...',
      '...bbdbbbbdbb...',
      '...bbdbbbbdbbs..',
      '...bpbbbbbbpbs..',
      '...bbbbbbbbbbs..',
      '....sssssssss...',
      '....b.b..b.b....',
    ],
  },
  hoot: {
    name: 'Hoot',
    pal: { b: '#C9A27A', s: '#A9825C', h: '#E8CBA8', d: '#1D1712', p: '#FF9BB8', a: '#FFC86B', w: '#F7F4EE' },
    grid: [
      '...b........b...',
      '...bb......bb...',
      '...bbbbbbbbbb...',
      '..bwwwbbbbwwwb..',
      '..bwdwbbbbwdwb..',
      '..bwdwbaabwdwb..',
      '..bwwwbbaawwwb..',
      '.bbbhhhhhhhhbbb.',
      '.bbhhhhhhhhhhbs.',
      '..bhhhhhhhhhhs..',
      '...sssssssssss..',
      '....a.a..a.a....',
    ],
  },
};

type Eyes = 'open' | 'shut' | 'up';

/** The sprite, one square at a time. Re-drawn only when its eyes or arms change. */
const SpriteArt = React.memo(function SpriteArt({ sprite, px, eyes, arms }: { sprite: Sprite; px: number; eyes: Eyes; arms: boolean }) {
  const gw = sprite.grid[0].length;
  const gh = sprite.grid.length;
  const cells: React.ReactElement[] = [];
  const at = (r: number, c: number) => (sprite.grid[r] ? sprite.grid[r][c] : '.');
  for (let r = 0; r < gh; r++) {
    for (let c = 0; c < gw; c++) {
      const ch = at(r, c);
      if (ch === '.') continue;
      let fill = sprite.pal[ch] ?? sprite.pal.b;
      if (ch === 'd') {
        const below = at(r + 1, c) === 'd';
        const above = at(r - 1, c) === 'd';
        const around = at(r, c - 1) === 'w' ? sprite.pal.w : sprite.pal.b;
        // shut: only the lower square of each eye stays, a line; up: the upper square stays and one above it
        if (eyes === 'shut' && below) fill = around;
        if (eyes === 'up' && above && !below) fill = around;
      }
      cells.push(<Rect key={r + ':' + c} x={(c + 1) * px} y={(r + 2) * px} width={px + 0.4} height={px + 0.4} fill={fill} />);
    }
  }
  if (eyes === 'up') {
    for (let r = 1; r < gh; r++) for (let c = 0; c < gw; c++) {
      if (at(r, c) === 'd' && at(r - 1, c) !== 'd') cells.push(<Rect key={'u' + r + ':' + c} x={(c + 1) * px} y={(r + 1) * px} width={px} height={px} fill={sprite.pal.d} />);
    }
  }
  if (arms) {
    const sh = Math.floor(gh * 0.38);
    cells.push(<Rect key="al" x={0} y={sh * px} width={px} height={px} fill={sprite.pal.b} />);
    cells.push(<Rect key="ar" x={(gw + 1) * px} y={sh * px} width={px} height={px} fill={sprite.pal.b} />);
    cells.push(<Rect key="ar2" x={(gw + 1) * px} y={(sh - 1) * px} width={px} height={px} fill={sprite.pal.h ?? sprite.pal.b} />);
  }
  return (
    <Svg width={(gw + 2) * px} height={(gh + 2) * px}>
      {cells}
    </Svg>
  );
});

/* ---------------------------------------------------------------- what it hears */

export type MascotCue = 'tick' | 'add' | 'start' | 'done' | 'day' | 'streak' | 'makeover';
const useCue = create<{ n: number; cue: MascotCue | null }>(() => ({ n: 0, cue: null }));
/** Something happened the mascot takes part in (src/cheerSound.ts sends every Cheerful moment here). */
export function mascotCue(cue: MascotCue) {
  useCue.setState((s) => ({ n: s.n + 1, cue }));
}

const LINES = {
  hello: ["Morning! Let's make today count.", 'Hi again. Ready when you are.', 'Good to see you.'],
  tick: ['Nice one.', 'One less!', 'Tick!'],
  done: ['That was a proper session.', 'Focus, well spent.', 'Look at you go.'],
  day: ['Every ToDo, done. Proud of you.', 'Clean sweep today!', "That's the whole list. Brilliant."],
  streak: ['That streak keeps growing!', 'Day after day. Brilliant.'],
  start: ["Focus time. I'll be quiet."],
  tap: ['Hehe.', 'Hi there!', "I'm cheering for you.", 'Still here!'],
  back: ["Oh! You're back.", 'Mm? Oh, hello!'],
};
const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];

/* ---------------------------------------------------------------- the host */

/** Mounted once, in the root layout, over the tabs and pages and under Sift and the sheets. */
export function MascotHost() {
  const settings = useStore((s) => s.settings);
  const level = useAnimLevel();
  const on = settings.mood === 'cheerful' && settings.mascot !== 'off' && settings.mascotAwayOn !== todayKey() && level !== 'none';
  if (!on) return null;
  return <Companion id={settings.mascot as MascotId} />;
}

const PX = 3;
const SPOT_KEY = ['floor', 'header', 'edge'] as const;
type SpotKey = (typeof SPOT_KEY)[number];

function Companion({ id }: { id: MascotId }) {
  const sprite = MASCOTS[id] ?? MASCOTS.blok;
  const level = useAnimLevel();
  const full = level === 'full';
  const { width: W, height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const tabNav = useStore((s) => s.settings.tabNav);
  const focusing = useStore((s) => !!s.deepWork?.running);
  // the tab bar is there on the tabs, not on a page opened over them
  const path = usePathname();
  const onTab = path === '/' || /^\/(slot[123]|more)(\/|$)/.test(path);
  const rail = W >= WIDE_AT && tabNav === 'side' ? 88 : 0;
  const bottomBar = rail || !onTab ? Math.max(insets.bottom, 8) : 64 + Math.max(insets.bottom, 10);
  const gw = sprite.grid[0].length + 2;
  const gh = sprite.grid.length + 2;
  const w = gw * PX;
  const h = gh * PX;

  // where it can be, its feet's place: on the floor by the tab bar, beside the header's title row, peeking in at the side
  const spots = React.useMemo<Record<SpotKey, { x: number; y: number }>>(() => ({
    floor: { x: rail + 30 + w / 2, y: H - bottomBar - 6 },
    header: { x: W - 118, y: insets.top + 66 },
    edge: { x: W - w * 0.32, y: Math.round(H * 0.62) },
  }), [W, H, insets.top, bottomBar, rail, w]);

  const [spot, setSpot] = React.useState<SpotKey>('floor');
  const x = useSharedValue(spots.floor.x);
  const y = useSharedValue(spots.floor.y);
  const lift = useSharedValue(0);
  const sq = useSharedValue(1);
  const face = useSharedValue(1);
  const breath = useSharedValue(0);
  const shown = useSharedValue(0);
  const [eyes, setEyes] = React.useState<Eyes>('open');
  const [arms, setArms] = React.useState(false);
  const [line, setLine] = React.useState<string | null>(null);
  const busy = React.useRef(false);
  const lineTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // arrives softly; follows a turned screen to its new place
  React.useEffect(() => { shown.value = withTiming(1, { duration: 500 }); }, []);
  React.useEffect(() => { x.value = spots[spot].x; y.value = spots[spot].y; }, [spots]);
  // breathing, and blinking every few seconds
  React.useEffect(() => {
    if (!full || focusing) { cancelAnimation(breath); breath.value = 0; return undefined; }
    breath.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => cancelAnimation(breath);
  }, [full, focusing]);
  React.useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const arm = () => {
      t = setTimeout(() => {
        setEyes((e) => (e === 'open' ? 'shut' : e));
        setTimeout(() => setEyes((e) => (e === 'shut' && !busy.current ? 'open' : e)), 140);
        arm();
      }, 2800 + Math.random() * 3200);
    };
    arm();
    return () => clearTimeout(t);
  }, []);

  const say = React.useCallback((text: string, ms = 2600) => {
    if (lineTimer.current) clearTimeout(lineTimer.current);
    setLine(text);
    lineTimer.current = setTimeout(() => setLine(null), ms);
  }, []);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /** a hop: a crouch, a leap along an arc, a landing with a little squash */
  const hop = React.useCallback(async (to: { x: number; y: number }, height = 22) => {
    const dist = Math.hypot(to.x - x.value, to.y - y.value);
    const d = Math.max(260, Math.min(560, dist * 1.4));
    face.value = to.x >= x.value ? 1 : -1;
    sq.value = withSequence(withTiming(0.84, { duration: 110 }), withTiming(1.08, { duration: d * 0.5 }), withTiming(1, { duration: d * 0.5 }), withTiming(0.86, { duration: 80 }), withTiming(1, { duration: 140 }));
    x.value = withDelay(110, withTiming(to.x, { duration: d, easing: Easing.inOut(Easing.quad) }));
    y.value = withDelay(110, withTiming(to.y, { duration: d, easing: Easing.inOut(Easing.quad) }));
    lift.value = withDelay(110, withSequence(
      withTiming(height + Math.max(0, y.value - to.y) * 0.25, { duration: d / 2, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: d / 2, easing: Easing.in(Easing.quad) }),
    ));
    await wait(110 + d + 220);
  }, []);

  /** jumps on the spot, arms up, a few times */
  const cheerUp = React.useCallback(async (times = 2) => {
    setArms(true);
    for (let i = 0; i < times; i++) {
      sq.value = withSequence(withTiming(0.82, { duration: 100 }), withTiming(1.1, { duration: 200 }), withTiming(1, { duration: 200 }));
      lift.value = withDelay(100, withSequence(withTiming(20, { duration: 200, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: 200, easing: Easing.in(Easing.quad) })));
      await wait(520);
    }
    setArms(false);
  }, []);

  const act = React.useCallback(async (fn: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    try { await fn(); } finally { busy.current = false; }
  }, []);

  // roaming: now and then, a hop to another of its places (never while Deep Work runs)
  React.useEffect(() => {
    if (!full || focusing) return undefined;
    let t: ReturnType<typeof setTimeout>;
    const arm = () => {
      t = setTimeout(() => {
        if (AppState.currentState === 'active' && !busy.current) {
          const others = SPOT_KEY.filter((k) => k !== spot);
          const next = others[Math.floor(Math.random() * others.length)];
          void act(async () => { await hop(spots[next], next === 'header' ? 30 : 22); setSpot(next); });
        }
        arm();
      }, 24000 + Math.random() * 26000);
    };
    arm();
    return () => clearTimeout(t);
  }, [full, focusing, spot, spots]);

  // a hello on arrival, once a day; and found napping after a long time away
  React.useEffect(() => {
    const t = setTimeout(() => { if (!focusing) say(pick(LINES.hello)); }, 1600);
    let away = 0;
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') { away = Date.now(); return; }
      if (away && Date.now() - away > 3 * 60 * 60 * 1000 && !focusing) {
        void act(async () => {
          setEyes('shut');
          await wait(1800);
          setEyes('open');
          await hop({ x: x.value, y: y.value }, 12);
          say(pick(LINES.back), 1800);
        });
      }
    });
    return () => { clearTimeout(t); sub.remove(); };
  }, []);

  // taking part
  const cue = useCue();
  const firstCue = React.useRef(cue.n);
  React.useEffect(() => {
    if (cue.n === firstCue.current || !cue.cue) return;
    const c = cue.cue;
    if (c === 'tick') void act(async () => { await hop({ x: x.value, y: y.value }, 12); if (Math.random() < 0.25) say(pick(LINES.tick), 1400); });
    else if (c === 'add') void act(async () => { sq.value = withSequence(withTiming(0.9, { duration: 90 }), withTiming(1, { duration: 180 })); });
    else if (c === 'start') { say(pick(LINES.start), 2000); }
    else if (c === 'done' || c === 'day') void act(async () => { say(pick(c === 'day' ? LINES.day : LINES.done), 3000); await cheerUp(c === 'day' ? 3 : 2); });
    else if (c === 'streak') void act(async () => { setArms(true); say(pick(LINES.streak), 2600); await wait(1400); setArms(false); });
    else if (c === 'makeover') void act(async () => { await wait(2600); await cheerUp(2); say(pick(LINES.hello)); });
  }, [cue.n]);

  // looking up now and then, as if thinking
  React.useEffect(() => {
    if (!full || focusing) return undefined;
    const iv = setInterval(() => {
      if (busy.current) return;
      setEyes('up');
      setTimeout(() => setEyes((e) => (e === 'up' ? 'open' : e)), 1300);
    }, 41000);
    return () => clearInterval(iv);
  }, [full, focusing]);

  const body = useAnimatedStyle(() => {
    const b = 1 + 0.03 * breath.value;
    const s = sq.value * b;
    return {
      opacity: shown.value,
      transform: [
        { translateX: x.value - w / 2 },
        { translateY: y.value - h - lift.value + h * (1 - s) },
        { scaleX: face.value / Math.sqrt(s) },
        { scaleY: s },
      ] as const,
    };
  });
  const shadow = useAnimatedStyle(() => ({
    opacity: 0.3 * shown.value * (1 - Math.min(1, lift.value / 40)),
    transform: [{ translateX: x.value - w * 0.35 }, { translateY: y.value - 3 }, { scaleX: 1 - Math.min(0.5, lift.value / 60) }] as const,
  }));
  const bubbleAt = useAnimatedStyle(() => ({
    transform: [
      { translateX: Math.max(10, Math.min(W - 190, x.value - 90)) },
      { translateY: y.value - h - lift.value - 52 },
    ] as const,
  }));

  const onTap = () => void act(async () => {
    sq.value = withSequence(withTiming(0.8, { duration: 90 }), withTiming(1.1, { duration: 160 }), withTiming(1, { duration: 160 }));
    lift.value = withDelay(90, withSequence(withTiming(14, { duration: 160 }), withTiming(0, { duration: 160 })));
    say(pick(LINES.tap), 1400);
    await wait(420);
  });
  const onAway = () => {
    const today = todayKey();
    useStore.getState().setSetting('mascotAwayOn', today);
    toast(sprite.name + ' will be back tomorrow', { label: 'Undo', onPress: () => useStore.getState().setSetting('mascotAwayOn', '') });
  };

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Animated.View pointerEvents="none" style={[st.shadow, { width: w * 0.7 }, shadow]} />
      <Animated.View style={[st.body, body]}>
        <Pressable onPress={onTap} onLongPress={onAway} delayLongPress={600} hitSlop={8} accessibilityRole="button" accessibilityLabel={sprite.name + ', your companion'} accessibilityHint="Hold to tuck it away until tomorrow">
          <SpriteArt sprite={sprite} px={PX} eyes={eyes} arms={arms} />
        </Pressable>
      </Animated.View>
      {line ? (
        <Animated.View pointerEvents="none" entering={FadeIn.duration(160)} exiting={FadeOut.duration(160)} style={[st.bubbleWrap, bubbleAt]}>
          <View style={st.bubble}>
            <Text style={st.bubbleText} numberOfLines={2}>{line}</Text>
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  body: { position: 'absolute', left: 0, top: 0 },
  shadow: { position: 'absolute', left: 0, top: 0, height: 5, borderRadius: 3, backgroundColor: '#000' },
  bubbleWrap: { position: 'absolute', left: 0, top: 0, width: 180, alignItems: 'center' },
  bubble: { backgroundColor: '#F7F4EE', borderRadius: 12, paddingHorizontal: 11, paddingVertical: 7, maxWidth: 180, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  bubbleText: { color: '#24231F', fontFamily: F.smMed, fontSize: 12.5, lineHeight: 17, letterSpacing: TRACK.fine },
});
