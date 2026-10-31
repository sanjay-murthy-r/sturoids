// Cheerful's companion: Sprout, a little plant who waves with its leaves, or Pip, a soft round friend with nub arms
// (src/mascot/art.ts draws them). It is mounted once over the whole app, so it stays with the user from tab to tab: it
// glances and scurries along when the tab changes, settles where the new screen has room, and when it must go further
// (or the keyboard comes up, or it is tucked away) it leaves by a small door at the side of the screen and comes back
// in by one. It perches at the edges only (on the floor by the tab bar, beside the header, peeking in at a side), never
// over what is read or tapped, and it can be dragged to another perch.
//
// Most of the time it just lives: it blinks, looks about, thinks (eyes up, dots rising, sometimes a bulb), stretches,
// ruffles its leaves or squishes, wanders a few steps, hums or waters itself, yawns late at night and naps. It takes
// part in what the user does (a hop for a tick, a cheer for a session or a day done) and, during Deep Work, it studies
// too: it settles on the floor with a book, reads and turns its pages, and says nothing until the session ends. It
// speaks by itself a few times a day at most (src/mascot/lines.ts keeps what it said, so lines rest for weeks), answers
// a tap with a reaction, and when held, opens a little card to talk to it. Only in Cheerful, with motion on.

import React from 'react';
import {
  AppState, Keyboard, Platform, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing, FadeIn, FadeOut, cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence,
  withSpring, withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Rect } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { create } from 'zustand';
import { router, usePathname } from 'expo-router';
import { useStore } from '../store';
import { useAnimLevel } from './Motion';
import { toast } from './Toast';
import { daysUntil, todayKey, todoDueOn } from '../utils';
import { WIDE_AT } from '../layout';
import { indexScores, upcoming } from '../scores';
import { pkey } from '../profiles';
import {
  COLS, Cell, DOOR, DOOR_PAL, FLIERS, Kind, NAMES, PROPS, Palette, Pose, REST, ROWS, colorSet, compose, runs,
} from '../mascot/art';
import {
  Ctx, Memory, Moment, Reply, choose, chooseIdle, dayNo, fill, freshMemory, maySpeak, newDay, poolFor, remember, reply,
} from '../mascot/lines';

/** the companion's own face for its words: Nunito, round and small (loaded with the app's faces) */
export const CUTE = 'Nunito_700Bold';
export const CUTE_BOLD = 'Nunito_800ExtraBold';

const PX = 3;
const SW = COLS * PX;
const SH = ROWS * PX;

/* ---------------------------------------------------------------- drawing */

/** Squares as rectangles, a run of one colour along a row at a time. */
const Pixels = React.memo(function Pixels({ cells, pal, px, cols, rows }: { cells: Cell[]; pal: Palette; px: number; cols: number; rows: number }) {
  const rects = runs(cells, pal, cols, rows);
  return (
    <Svg width={cols * px} height={rows * px}>
      {rects.map((r, i) => <Rect key={i} x={r.x * px} y={r.y * px} width={r.w * px + 0.4} height={px + 0.4} fill={r.fill} />)}
    </Svg>
  );
});

/** A little grid (a prop, a door) as squares. */
function gridCells(grid: string[]): Cell[] {
  const out: Cell[] = [];
  grid.forEach((line, r) => { for (let c = 0; c < line.length; c++) if (line[c] !== '.') out.push([c, r, line[c]]); });
  return out;
}
export function GridArt({ grid, pal, px }: { grid: string[]; pal: Palette; px: number }) {
  const cells = React.useMemo(() => gridCells(grid), [grid]);
  return <Pixels cells={cells} pal={pal} px={px} cols={grid[0].length} rows={grid.length} />;
}

/** The companion in a pose, at `px` to a square. */
export const Sprite = React.memo(function Sprite({ kind, pose, gear, bud, pal, px = PX }: {
  kind: Kind; pose: Pose; gear: string[]; bud: number; pal: Palette; px?: number;
}) {
  const cells = React.useMemo(() => compose(kind, pose, gear, bud), [kind, pose, gear, bud]);
  return <Pixels cells={cells} pal={pal} px={px} cols={COLS} rows={ROWS} />;
});

/* ---------------------------------------------------------------- what it hears */

export type MascotCue = 'tick' | 'add' | 'start' | 'done' | 'day' | 'streak' | 'makeover';
const useCue = create<{ n: number; cue: MascotCue | null }>(() => ({ n: 0, cue: null }));
/** Something happened the companion takes part in (src/cheerSound.ts sends every Cheerful moment here). */
export function mascotCue(cue: MascotCue) {
  useCue.setState((s) => ({ n: s.n + 1, cue }));
}

/* ---------------------------------------------------------------- its memory (this device only) */

let memory: Memory = freshMemory();
let memoryRead: Promise<void> | null = null;
let memoryTimer: ReturnType<typeof setTimeout> | null = null;
const MEMORY_KEY = () => pkey('sturoids-companion');
function readMemory(): Promise<void> {
  if (!memoryRead) {
    memoryRead = AsyncStorage.getItem(MEMORY_KEY()).then((raw) => {
      if (!raw) return;
      try {
        const m = JSON.parse(raw);
        if (m && typeof m === 'object' && m.seen && typeof m.seen === 'object') memory = { ...freshMemory(), ...m };
      } catch { /* a fresh memory */ }
    }).catch(() => {});
  }
  return memoryRead;
}
function keepMemory(next: Memory) {
  memory = next;
  if (memoryTimer) clearTimeout(memoryTimer);
  memoryTimer = setTimeout(() => { AsyncStorage.setItem(MEMORY_KEY(), JSON.stringify(memory)).catch(() => {}); }, 800);
}

/** What is true right now, for what it says. */
function context(kind: Kind, name: string, gear: string[]): Ctx {
  const s = useStore.getState();
  const today = todayKey();
  const now = new Date();
  const due = s.dailyTasks.filter((t) => todoDueOn(t, today));
  const open = due.filter((t) => t.doneOn !== today);
  let exam: Ctx['exam'] = null;
  try {
    const next = upcoming(indexScores(s.scores), null, today)[0];
    if (next?.date) exam = { title: next.title, days: daysUntil(next.date) };
  } catch { /* no exams to speak of */ }
  const focusMin = Math.round(s.sessions.filter((x) => x.dateKey === today).reduce((a, x) => a + (x.netSeconds || 0), 0) / 60);
  return {
    kind, name, hour: now.getHours(), weekday: now.getDay(), date: today.slice(5), year: now.getFullYear(),
    due: due.length, left: open.length, next: open[0]?.title ?? null, exam, focusMin,
    away: memory.lastDay && memory.lastDay !== today ? dayNo(today) - dayNo(memory.lastDay) : 0,
    run: memory.run, first: !memory.firstDay, gear,
  };
}

/** How far the day's ToDos are done, 0 to 1 (1 with none due, as nothing is left). */
function dayProgress(): number {
  const today = todayKey();
  const due = useStore.getState().dailyTasks.filter((t) => todoDueOn(t, today));
  if (!due.length) return 0.34;
  return due.filter((t) => t.doneOn === today).length / due.length;
}

/* ---------------------------------------------------------------- the host */

/** Mounted once, in the root layout, over the tabs and pages and under Sift and the sheets. */
export function MascotHost() {
  const s = useStore((st) => st.settings);
  const level = useAnimLevel();
  const on = s.mood === 'cheerful' && s.mascot !== 'off' && s.mascotAwayOn !== todayKey() && level !== 'none';
  if (!on) return null;
  const kind: Kind = s.mascot === 'pip' ? 'pip' : 'sprout';
  return <Companion key={kind} kind={kind} />;
}

/* ---------------------------------------------------------------- where it can be */

type Perch = 'floor' | 'header' | 'edgeR' | 'edgeL' | 'edgeTop';
type Spot = { x: number; y: number; face: 1 | -1 };
const TABS = ['/', '/slot1', '/slot2', '/slot3', '/more'];
const tabOf = (path: string) => {
  if (path === '/') return 0;
  const m = /^\/(slot[123]|more)(\/|$)/.exec(path);
  return m ? TABS.indexOf('/' + m[1]) : -1;
};
/** the perches a screen has room for: a tab, a full-screen tool (keys and canvases to the bottom), or another page */
function perchesFor(path: string): Perch[] {
  // on a tab its home is beside the header, where the title leaves room; the floor and the sides are for wandering
  if (tabOf(path) >= 0) return ['header', 'floor', 'edgeR', 'edgeL'];
  if (/^\/(calculator|desmos|signature)/.test(path)) return ['edgeTop'];
  if (/^\/focus(\/|$)/.test(path)) return ['floor', 'edgeR'];
  return ['floor', 'edgeR', 'edgeL'];
}
/** writing surfaces: it keeps still and quiet there */
const quietAt = (path: string) => /^\/(notes|journal)\/./.test(path);

const CANCEL = { cancelled: true };
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const oneOf = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

type Bubble = { text: string; key: number; size?: { w: number; h: number } };
type Fx = { dots: number; bulb: boolean; zed: boolean; notes: boolean; cloud: boolean; heart: number; sparks: number };
const NO_FX: Fx = { dots: 0, bulb: false, zed: false, notes: false, cloud: false, heart: 0, sparks: 0 };
type DoorState = { side: 'left' | 'right'; y: number; frame: keyof typeof DOOR } | null;

function Companion({ kind }: { kind: Kind }) {
  const settings = useStore((s) => s.settings);
  const name = settings.mascotName || NAMES[kind];
  const pal = colorSet(kind, settings.mascotColors).pal;
  const gear = React.useMemo(() => (settings.mascotGear || []).filter((g) => g !== 'bloom' || kind === 'sprout'), [settings.mascotGear, kind]);
  const talk = settings.mascotTalk || 'some';
  const level = useAnimLevel();
  const full = level === 'full';
  const { width: W, height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const focusing = useStore((s) => !!s.deepWork?.running);
  const inSession = useStore((s) => !!s.deepWork);
  const path = usePathname();
  const tab = tabOf(path);
  const rail = W >= WIDE_AT && settings.tabNav === 'side' ? 88 : 0;
  const bottomBar = rail || tab < 0 ? Math.max(insets.bottom, 8) : 64 + Math.max(insets.bottom, 10);

  const spots = React.useMemo<Record<Perch, Spot>>(() => ({
    floor: { x: rail + 22 + SW / 2, y: H - bottomBar - 4, face: 1 },
    header: { x: W - 78, y: insets.top + 64, face: -1 },
    edgeR: { x: W - SW * 0.14, y: Math.round(H * 0.6), face: -1 },
    edgeL: { x: rail + SW * 0.14, y: Math.round(H * 0.44), face: 1 },
    edgeTop: { x: W - SW * 0.14, y: insets.top + 150, face: -1 },
  }), [W, H, insets.top, bottomBar, rail]);
  const allowed = perchesFor(path);

  /* ---------------- moving parts */
  const x = useSharedValue(-SW);
  const y = useSharedValue(spots.floor.y);
  const lift = useSharedValue(0);
  const sq = useSharedValue(1);
  const face = useSharedValue(1);
  const tilt = useSharedValue(0);
  const shown = useSharedValue(0);
  const breath = useSharedValue(0);
  const [pose, setPoseState] = React.useState<Pose>(REST);
  const poseRef = React.useRef<Pose>(REST);
  const setPose = React.useCallback((p: Partial<Pose>) => {
    poseRef.current = { ...poseRef.current, ...p };
    setPoseState(poseRef.current);
  }, []);
  const [fx, setFxState] = React.useState<Fx>(NO_FX);
  const setFx = (p: Partial<Fx>) => setFxState((f) => ({ ...f, ...p }));
  const [door, setDoor] = React.useState<DoorState>(null);
  const doorGrow = useSharedValue(0);
  const [bubble, setBubble] = React.useState<Bubble | null>(null);
  const [chat, setChat] = React.useState(false);
  const [bud, setBud] = React.useState(() => Math.min(3, Math.floor(dayProgress() * 3.01)));

  const spot = React.useRef<Perch>('floor');
  const alive = React.useRef(true);
  const away = React.useRef(true); // out of sight (behind a door): before it first comes in, and while the keyboard is up
  const reading = React.useRef(false);
  const napping = React.useRef(false);
  const dragging = React.useRef(false);
  const chatRef = React.useRef(false);
  const busy = React.useRef(false);
  const token = React.useRef(0);
  const bubbleTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyboardUp = React.useRef(false);
  const lastIdle = React.useRef<string[]>([]);
  const ctxNow = () => context(kind, name, gear);
  React.useEffect(() => () => { alive.current = false; token.current++; }, []);
  chatRef.current = chat;

  /** Runs one action at a time; a `force`d one (a celebration, a drag) stops the one under way. */
  const act = React.useCallback((fn: (step: (ms: number) => Promise<void>) => Promise<void>, force = false) => {
    if (busy.current && !force) return false;
    const my = ++token.current;
    busy.current = true;
    const step = (ms: number) => new Promise<void>((res, rej) => setTimeout(() => (alive.current && token.current === my ? res() : rej(CANCEL)), ms));
    fn(step).catch(() => {}).finally(() => {
      if (token.current !== my || !alive.current) return;
      busy.current = false;
      settle();
    });
    return true;
  }, []);

  /** the pose it rests in: reading through Deep Work, otherwise just standing */
  const settle = () => {
    tilt.value = withTiming(0, { duration: 200 });
    if (reading.current) setPose({ ...REST, book: 'open', eyes: 'read', phones: true });
    else if (napping.current) setPose({ ...REST, eyes: 'sleepy' });
    else setPose(REST);
  };

  /* ---------------- words */

  const sayText = React.useCallback((text: string) => {
    if (!alive.current || chatRef.current || keyboardUp.current) return;
    if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
    setBubble({ text, key: Date.now() });
    bubbleTimer.current = setTimeout(() => setBubble(null), Math.min(5200, 1700 + text.length * 55));
  }, []);
  /**
   * Says a line from a moment's pool, as Settings allows: by itself (`spontaneous`) only within the day's budget; a
   * moment's line (a tick, a session done) only when it talks at all. True if it spoke.
   */
  const say = React.useCallback((m: Moment, opts: { spontaneous?: boolean; extra?: { minutes?: number }; always?: boolean } = {}) => {
    if (!opts.always && talk === 'asked') return false;
    const now = Date.now();
    if (opts.spontaneous && !maySpeak(memory, talk, now)) return false;
    const ctx = ctxNow();
    const today = dayNo(todayKey());
    const line = m === 'idle' ? chooseIdle(ctx, memory, today) : choose(poolFor(m, ctx, opts.extra), ctx, memory, today);
    if (!line) return false;
    keepMemory(remember(memory, line.id, today, now, !!opts.spontaneous));
    sayText(fill(line.text, ctx));
    return true;
  }, [talk, kind, name, gear]);
  const hush = () => { if (bubbleTimer.current) clearTimeout(bubbleTimer.current); setBubble(null); };

  /* ---------------- moves */

  /** a hop: a crouch, a leap along an arc, a landing with a little squash */
  const hop = async (to: { x: number; y: number }, step: (ms: number) => Promise<void>, height = 22) => {
    const dist = Math.hypot(to.x - x.value, to.y - y.value);
    const d = Math.max(260, Math.min(620, dist * 1.3));
    if (Math.abs(to.x - x.value) > 2) face.value = to.x > x.value ? 1 : -1;
    setPose({ feet: 'stand' });
    sq.value = withSequence(withTiming(0.84, { duration: 110 }), withTiming(1.08, { duration: d * 0.5 }), withTiming(1, { duration: d * 0.5 }), withTiming(0.86, { duration: 80 }), withTiming(1, { duration: 150 }));
    x.value = withDelay(110, withTiming(to.x, { duration: d, easing: Easing.inOut(Easing.quad) }));
    y.value = withDelay(110, withTiming(to.y, { duration: d, easing: Easing.inOut(Easing.quad) }));
    lift.value = withDelay(110, withSequence(
      withTiming(height + Math.max(0, y.value - to.y) * 0.22, { duration: d / 2, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: d / 2, easing: Easing.in(Easing.quad) }),
    ));
    await step(110);
    setPose({ feet: 'tuck' });
    await step(d - 40);
    setPose({ feet: 'stand' });
    await step(260);
  };

  /** a walk: little steps, the feet shuffling and the body bobbing, along the row it stands on */
  const walk = async (toX: number, step: (ms: number) => Promise<void>) => {
    const dist = Math.abs(toX - x.value);
    if (dist < 2) return;
    face.value = toX > x.value ? 1 : -1;
    const steps = Math.max(2, Math.round(dist / 7));
    const per = 130;
    x.value = withTiming(toX, { duration: steps * per, easing: Easing.linear });
    for (let i = 0; i < steps; i++) {
      setPose({ feet: i % 2 ? 'stand' : 'step' });
      lift.value = withSequence(withTiming(1.6, { duration: per / 2 }), withTiming(0, { duration: per / 2 }));
      await step(per);
    }
    setPose({ feet: 'stand' });
  };

  /** the limb on the side it would wave from: toward the middle of the screen */
  const waveSide = (): 'l' | 'r' => (x.value < W / 2 ? 'r' : 'l');

  const wave = async (step: (ms: number) => Promise<void>, big = false) => {
    const side = waveSide();
    const other = side === 'l' ? 'r' : 'l';
    setPose({ eyes: 'happy', mouth: 'smile', [side]: 'out' });
    tilt.value = withTiming(side === 'r' ? 5 : -5, { duration: 180 });
    await step(110);
    setPose({ [side]: 'up' });
    await step(120);
    for (let i = 0; i < 4; i++) {
      setPose({ [side]: 'swing', ...(big ? { [other]: i % 2 ? 'up' : 'out' } : {}) });
      tilt.value = withTiming(side === 'r' ? 7 : -7, { duration: 140 });
      await step(150);
      setPose({ [side]: 'up', ...(big ? { [other]: i % 2 ? 'out' : 'up' } : {}) });
      tilt.value = withTiming(side === 'r' ? 4 : -4, { duration: 140 });
      await step(150);
    }
    setPose({ [side]: 'out', [other]: 'rest' });
    await step(100);
    setPose({ [side]: 'rest', mouth: 'none' });
    tilt.value = withTiming(0, { duration: 200 });
    await step(260);
  };

  const think = async (step: (ms: number) => Promise<void>) => {
    const side = waveSide();
    setPose({ eyes: 'up', mouth: 'flat', [side]: 'up' });
    tilt.value = withTiming(-6, { duration: 420, easing: Easing.inOut(Easing.quad) });
    await step(420);
    for (let i = 1; i <= 3; i++) { setFx({ dots: i }); await step(380); }
    setPose({ eyes: 'left' });
    await step(700);
    setPose({ eyes: 'up' });
    await step(500);
    if (Math.random() < 0.45) {
      setFx({ dots: 0, bulb: true });
      setPose({ eyes: 'wide', mouth: 'o', [side]: 'rest' });
      tilt.value = withTiming(0, { duration: 160 });
      lift.value = withSequence(withTiming(10, { duration: 160 }), withTiming(0, { duration: 180 }));
      await step(450);
      setPose({ eyes: 'happy', mouth: 'smile' });
      if (Math.random() < 0.25) say('idea', { spontaneous: true });
      await step(1100);
      setFx({ bulb: false });
    } else {
      setFx({ dots: 0 });
      setPose({ eyes: 'open', mouth: 'none', [side]: 'rest' });
      sq.value = withSequence(withTiming(0.95, { duration: 120 }), withTiming(1, { duration: 160 }));
      await step(400);
    }
  };

  const cheer = async (step: (ms: number) => Promise<void>, times = 2, spin = false) => {
    setPose({ eyes: 'happy', mouth: 'grin', l: 'up', r: 'up', book: 'none' });
    setFx({ sparks: Date.now() });
    for (let i = 0; i < times; i++) {
      sq.value = withSequence(withTiming(0.82, { duration: 100 }), withTiming(1.1, { duration: 210 }), withTiming(1, { duration: 210 }));
      lift.value = withDelay(100, withSequence(withTiming(spin && i === 1 ? 30 : 20, { duration: 210, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: 210, easing: Easing.in(Easing.quad) })));
      setPose({ feet: 'tuck', l: i % 2 ? 'swing' : 'up', r: i % 2 ? 'up' : 'swing' });
      if (spin && i === 1) face.value = withSequence(withTiming(-1, { duration: 180 }), withTiming(1, { duration: 180 }));
      await step(310);
      setPose({ feet: 'stand' });
      await step(220);
    }
  };

  const stretch = async (step: (ms: number) => Promise<void>) => {
    setPose({ l: 'up', r: 'up', eyes: 'blink', mouth: 'o' });
    sq.value = withTiming(1.12, { duration: 520, easing: Easing.out(Easing.quad) });
    await step(900);
    sq.value = withSequence(withTiming(0.94, { duration: 140 }), withTiming(1, { duration: 200 }));
    setPose({ l: 'out', r: 'out', mouth: 'none', eyes: 'happy' });
    await step(260);
    setPose({ l: 'rest', r: 'rest', eyes: 'open' });
    await step(200);
  };

  const wiggle = async (step: (ms: number) => Promise<void>) => {
    if (kind === 'sprout') {
      for (let i = 0; i < 3; i++) {
        setPose({ l: i % 2 ? 'rest' : 'out', r: i % 2 ? 'out' : 'rest' });
        tilt.value = withTiming(i % 2 ? 3 : -3, { duration: 110 });
        await step(140);
      }
      setPose({ l: 'rest', r: 'rest' });
    } else {
      setPose({ eyes: 'happy' });
      for (let i = 0; i < 2; i++) {
        sq.value = withSequence(withTiming(0.84, { duration: 140 }), withSpring(1, { damping: 6, stiffness: 240 }));
        await step(420);
      }
    }
    tilt.value = withTiming(0, { duration: 160 });
    await step(200);
  };

  const glance = async (step: (ms: number) => Promise<void>) => {
    const first = Math.random() < 0.5 ? 'left' : 'right';
    setPose({ eyes: first });
    await step(rnd(600, 900));
    setPose({ eyes: first === 'left' ? 'right' : 'left' });
    await step(rnd(500, 800));
    setPose({ eyes: 'open' });
  };

  const yawn = async (step: (ms: number) => Promise<void>) => {
    setPose({ eyes: 'blink', mouth: 'o', l: kind === 'pip' ? 'up' : 'rest' });
    sq.value = withTiming(1.06, { duration: 500 });
    await step(1000);
    sq.value = withTiming(1, { duration: 300 });
    setPose({ eyes: 'sleepy', mouth: 'none', l: 'rest' });
    await step(700);
  };

  const nap = async (step: (ms: number) => Promise<void>, ms: number) => {
    napping.current = true;
    setPose({ eyes: 'sleepy', l: 'down', r: 'down' });
    await step(500);
    setPose({ eyes: 'blink' });
    setFx({ zed: true });
    try { await step(ms); } finally { napping.current = false; setFx({ zed: false }); }
    setPose({ eyes: 'wide', l: 'rest', r: 'rest' });
    lift.value = withSequence(withTiming(9, { duration: 140 }), withTiming(0, { duration: 160 }));
    await step(500);
  };

  const droop = async (step: (ms: number) => Promise<void>) => {
    setPose({ l: 'down', r: 'down', eyes: 'sleepy', mouth: 'flat' });
    sq.value = withTiming(0.94, { duration: 400 });
    await step(2600);
    sq.value = withTiming(1, { duration: 300 });
  };

  const heart = async (step: (ms: number) => Promise<void>) => {
    setPose({ blush: true, eyes: 'happy', mouth: 'smile' });
    setFx({ heart: Date.now() });
    lift.value = withSequence(withTiming(8, { duration: 160 }), withTiming(0, { duration: 180 }));
    await step(1800);
    setPose({ blush: false });
  };

  const dance = async (step: (ms: number) => Promise<void>) => {
    setPose({ eyes: 'happy', mouth: 'grin' });
    for (let i = 0; i < 4; i++) {
      setPose({ l: i % 2 ? 'up' : 'out', r: i % 2 ? 'out' : 'up', feet: 'tuck' });
      lift.value = withSequence(withTiming(12, { duration: 150 }), withTiming(0, { duration: 150 }));
      face.value = withTiming(i % 2 ? 1 : -1, { duration: 160 });
      tilt.value = withTiming(i % 2 ? 6 : -6, { duration: 160 });
      await step(320);
      setPose({ feet: 'stand' });
    }
    face.value = withTiming(1, { duration: 160 });
  };

  const nod = async (step: (ms: number) => Promise<void>) => {
    setPose({ eyes: 'happy', mouth: 'smile' });
    for (let i = 0; i < 2; i++) { sq.value = withSequence(withTiming(0.93, { duration: 120 }), withTiming(1, { duration: 140 })); await step(280); }
    await step(500);
  };

  /** Sprout waters itself: a little cloud, a drizzle, the leaves perking up */
  const rain = async (step: (ms: number) => Promise<void>) => {
    setPose({ eyes: 'up' });
    setFx({ cloud: true });
    await step(2400);
    setFx({ cloud: false });
    setPose({ eyes: 'happy' });
    await wiggle(step);
  };

  /** Pip hums a little tune, swaying (headphones on, if it has them) */
  const hum = async (step: (ms: number) => Promise<void>) => {
    setPose({ eyes: 'happy', mouth: 'smile', phones: true });
    setFx({ notes: true });
    for (let i = 0; i < 5; i++) { tilt.value = withTiming(i % 2 ? 6 : -6, { duration: 380, easing: Easing.inOut(Easing.sin) }); await step(400); }
    setFx({ notes: false });
    setPose({ phones: false });
  };

  /** from an edge, it ducks out of sight and pops back in */
  const peek = async (step: (ms: number) => Promise<void>) => {
    const s = spots[spot.current];
    const out = s.x + (s.x > W / 2 ? SW * 0.5 : -SW * 0.5);
    x.value = withTiming(out, { duration: 380, easing: Easing.in(Easing.quad) });
    await step(rnd(1400, 2600));
    setPose({ eyes: 'wide' });
    x.value = withTiming(s.x, { duration: 300, easing: Easing.out(Easing.back(1.6)) });
    await step(500);
    setPose({ eyes: 'happy' });
    await step(600);
  };

  /* ---------------- doors and travel */

  const doorX = (side: 'left' | 'right') => (side === 'left' ? rail + 15 : W - 15);
  const openDoor = async (side: 'left' | 'right', atY: number, step: (ms: number) => Promise<void>) => {
    setDoor({ side, y: atY, frame: 'closed' });
    doorGrow.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.back(1.4)) });
    await step(260);
    setDoor({ side, y: atY, frame: 'ajar' });
    await step(90);
    setDoor({ side, y: atY, frame: 'open' });
    await step(80);
  };
  const closeDoor = async (side: 'left' | 'right', atY: number, step: (ms: number) => Promise<void>) => {
    setDoor({ side, y: atY, frame: 'ajar' });
    await step(80);
    setDoor({ side, y: atY, frame: 'closed' });
    await step(140);
    doorGrow.value = withTiming(0, { duration: 200, easing: Easing.in(Easing.quad) });
    await step(220);
    setDoor(null);
  };
  /** walks to a door at the side and through it */
  const exitBy = async (side: 'left' | 'right', step: (ms: number) => Promise<void>) => {
    hush();
    const atY = spot.current === 'floor' || spot.current === 'header' ? y.value : spots.floor.y;
    if (Math.abs(atY - y.value) > 2) await hop({ x: x.value, y: atY }, step, 10);
    await openDoor(side, atY, step);
    await walk(doorX(side), step);
    shown.value = withTiming(0, { duration: 170 });
    sq.value = withTiming(0.9, { duration: 170 });
    await step(190);
    sq.value = 1;
    away.current = true;
    await closeDoor(side, atY, step);
  };
  /** comes in by a door at the side and walks to a spot */
  const enterBy = async (side: 'left' | 'right', to: Perch, step: (ms: number) => Promise<void>) => {
    const s = spots[to];
    const edge = to === 'edgeR' || to === 'edgeL' || to === 'edgeTop';
    if (edge) {
      // an edge spot is reached by sliding in from beyond the side, as if it had been just out of sight
      x.value = s.x + (s.x > W / 2 ? SW : -SW);
      y.value = s.y;
      face.value = s.face;
      shown.value = 1;
      away.current = false;
      x.value = withTiming(s.x, { duration: 420, easing: Easing.out(Easing.back(1.3)) });
      await step(460);
    } else {
      const doorY = s.y;
      x.value = doorX(side);
      y.value = doorY;
      face.value = side === 'left' ? 1 : -1;
      await openDoor(side, doorY, step);
      shown.value = withTiming(1, { duration: 180 });
      away.current = false;
      await walk(s.x, step);
      await closeDoor(side, doorY, step);
    }
    spot.current = to;
    face.value = withTiming(s.face, { duration: 160 });
  };
  /** to another perch: a hop when it is near, or out by one door and in by another */
  const travel = async (to: Perch, step: (ms: number) => Promise<void>) => {
    const s = spots[to];
    const from = spots[spot.current];
    const dist = Math.hypot(s.x - x.value, s.y - y.value);
    const fromEdge = spot.current !== 'floor' && spot.current !== 'header';
    if (away.current) { await enterBy(s.x < W / 2 ? 'left' : 'right', to, step); return; }
    if (dist < 240 && !fromEdge && to !== 'edgeR' && to !== 'edgeL' && to !== 'edgeTop') {
      if (Math.abs(s.y - from.y) < 6) await walk(s.x, step);
      else await hop(s, step, 26);
      spot.current = to;
      face.value = withTiming(s.face, { duration: 160 });
      return;
    }
    if (fromEdge) {
      // off the side it peeked in from
      x.value = withTiming(x.value + (x.value > W / 2 ? SW : -SW), { duration: 320, easing: Easing.in(Easing.quad) });
      await step(340);
      away.current = true;
      shown.value = 0;
    } else {
      await exitBy(x.value < W / 2 ? 'left' : 'right', step);
    }
    await step(rnd(300, 700));
    shown.value = 0;
    await enterBy(s.x < W / 2 ? 'left' : 'right', to, step);
  };

  /* ---------------- arriving */

  React.useEffect(() => {
    let live = true;
    readMemory().then(() => {
      if (!live) return;
      const ctx = ctxNow();
      const today = todayKey();
      const firstToday = memory.hello !== today;
      keepMemory(newDay(memory, today));
      act(async (step) => {
        await step(900);
        await enterBy('left', allowed[0], step);
        if (firstToday && !focusing) {
          keepMemory({ ...memory, hello: today });
          if (say('hello', { spontaneous: false })) await wave(step);
        } else if (Math.random() < 0.4 && !focusing) {
          await wave(step);
        }
        void ctx;
      }, true);
    });
    return () => { live = false; };
  }, []);

  /* ---------------- the screen changing under it */

  const lastPath = React.useRef(path);
  React.useEffect(() => {
    const before = lastPath.current;
    lastPath.current = path;
    if (before === path || away.current && keyboardUp.current) return;
    const ok = perchesFor(path);
    const from = tabOf(before);
    const to = tabOf(path);
    if (!ok.includes(spot.current)) {
      act(async (step) => { await travel(ok[0], step); }, true);
      return;
    }
    const s = spots[spot.current];
    const moved = Math.abs(s.y - y.value) > 3 || Math.abs(s.x - x.value) > 3;
    if (busy.current || reading.current) {
      // in the middle of something (reading, mostly): it is carried along, without a fuss
      if (moved && !away.current) { x.value = withTiming(s.x, { duration: 320 }); y.value = withTiming(s.y, { duration: 320 }); }
      return;
    }
    act(async (step) => {
      if (moved) { await hop(s, step, 16); return; }
      if (from >= 0 && to >= 0 && from !== to && full) {
        // a tab over: it looks the way the screen went and scurries a step along with it
        const dir = to > from ? 1 : -1;
        setPose({ eyes: dir > 0 ? 'right' : 'left' });
        const base = s.x;
        if (spot.current === 'floor') {
          await walk(base + dir * 10, step);
          await step(160);
          await walk(base, step);
        } else {
          sq.value = withSequence(withTiming(0.9, { duration: 90 }), withTiming(1, { duration: 160 }));
          await step(500);
        }
        face.value = withTiming(s.face, { duration: 160 });
      }
    });
  }, [path]);

  // a turned or resized screen: it stays at its perch's new place
  React.useEffect(() => {
    if (away.current || dragging.current) return;
    const s = spots[spot.current];
    x.value = withTiming(s.x, { duration: 260 });
    y.value = withTiming(s.y, { duration: 260 });
  }, [spots]);

  /* ---------------- the keyboard: it steps out, and back once the keyboard goes */

  React.useEffect(() => {
    if (Platform.OS === 'web') return undefined;
    const show = Keyboard.addListener('keyboardDidShow', () => {
      keyboardUp.current = true;
      hush();
      if (chatRef.current || away.current) return;
      act(async (step) => { await exitBy(x.value < W / 2 ? 'left' : 'right', step); }, true);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      keyboardUp.current = false;
      if (!away.current || chatRef.current) return;
      act(async (step) => { await step(400); await enterBy('left', perchesFor(lastPath.current)[0], step); }, true);
    });
    return () => { show.remove(); hide.remove(); };
  }, [spots]);

  /* ---------------- breathing and blinking */

  React.useEffect(() => {
    if (!full) { cancelAnimation(breath); breath.value = 0; return undefined; }
    breath.value = withRepeat(withTiming(1, { duration: focusing ? 2600 : 1500, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => cancelAnimation(breath);
  }, [full, focusing]);
  React.useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const arm = () => {
      t = setTimeout(() => {
        const e = poseRef.current.eyes;
        if (!busy.current && (e === 'open' || e === 'focus')) {
          setPose({ eyes: 'blink' });
          setTimeout(() => { if (poseRef.current.eyes === 'blink' && !busy.current && !napping.current) setPose({ eyes: e }); }, 130);
        }
        arm();
      }, rnd(2600, 6200));
    };
    arm();
    return () => clearTimeout(t);
  }, []);

  /* ---------------- Deep Work: it studies too */

  React.useEffect(() => {
    if (focusing) {
      reading.current = true;
      act(async (step) => {
        hush();
        await step(1400);
        // it reads at home: beside the header on a tab, on the floor on a page
        const home = perchesFor(lastPath.current)[0];
        if (spot.current !== home) await travel(home, step);
        setPose({ eyes: 'focus' });
        await step(500);
        setPose({ book: 'open', eyes: 'read', phones: true, l: 'rest', r: 'rest' });
      }, true);
    } else if (reading.current) {
      reading.current = false;
      // paused or ended: the book goes down and it stretches; an end is cheered for when its moment comes
      act(async (step) => {
        setPose({ book: 'none', eyes: 'open', phones: false });
        await step(300);
        if (inSession) await stretch(step);
      }, true);
    }
  }, [focusing]);
  // while reading: a page turned now and then, and a look up at the user, rarely
  React.useEffect(() => {
    if (!focusing || !full) return undefined;
    const iv = setInterval(() => {
      if (busy.current || !reading.current || away.current) return;
      const r = Math.random();
      if (r < 0.08) {
        act(async (step) => {
          setPose({ book: 'turn' });
          await step(260);
          setPose({ book: 'open' });
          sq.value = withSequence(withTiming(0.97, { duration: 120 }), withTiming(1, { duration: 140 }));
          await step(200);
        });
      } else if (r < 0.095) {
        act(async (step) => {
          setPose({ eyes: 'open', book: 'open' });
          await step(1300);
          setPose({ eyes: 'happy' });
          await step(500);
        });
      }
    }, 4000);
    return () => clearInterval(iv);
  }, [focusing, full]);

  /* ---------------- living: something small every so often */

  React.useEffect(() => {
    if (!full || focusing) return undefined;
    let t: ReturnType<typeof setTimeout>;
    const arm = () => {
      t = setTimeout(() => {
        tickIdle();
        arm();
      }, rnd(14000, 36000));
    };
    arm();
    return () => clearTimeout(t);
  }, [full, focusing, path, spots]);

  const rainedOn = React.useRef('');
  const tickIdle = () => {
    if (busy.current || away.current || chatRef.current || dragging.current || AppState.currentState !== 'active') return;
    const quiet = quietAt(lastPath.current);
    const hour = new Date().getHours();
    const late = hour >= 23 || hour < 5;
    // now and then, a word: within the day's budget, never on a writing page
    if (!quiet && Math.random() < 0.3 && maySpeak(memory, talk, Date.now())) {
      act(async (step) => {
        if (Math.random() < 0.5) await think(step);
        say('idle', { spontaneous: true });
        await step(600);
      });
      return;
    }
    const at = spot.current;
    const onFloor = at === 'floor';
    const edge = at === 'edgeR' || at === 'edgeL' || at === 'edgeTop';
    const today = todayKey();
    const options: [string, number][] = [
      ['glance', 5], ['think', 3], ['stretch', 2], ['wiggle', 3],
      ['walk', onFloor && !quiet ? 3 : 0], ['perch', quiet ? 0 : 2], ['peek', edge ? 3 : 0],
      ['rain', kind === 'sprout' && rainedOn.current !== today && !late ? 1 : 0],
      ['hum', kind === 'pip' && !quiet ? 2 : 0],
      ['yawn', late ? 4 : 0.3], ['nap', late ? 2 : 0], ['wave', 0.6],
    ];
    const pool = options.filter(([k, w]) => w > 0 && !lastIdle.current.includes(k));
    const total = pool.reduce((a, [, w]) => a + w, 0);
    let r = Math.random() * total;
    let pick = pool[0]?.[0] ?? 'glance';
    for (const [k, w] of pool) { r -= w; if (r <= 0) { pick = k; break; } }
    lastIdle.current = [pick, ...lastIdle.current].slice(0, 2);
    act(async (step) => {
      switch (pick) {
        case 'glance': await glance(step); break;
        case 'think': await think(step); break;
        case 'stretch': await stretch(step); break;
        case 'wiggle': await wiggle(step); break;
        case 'walk': {
          const base = spots.floor.x;
          await walk(base + rnd(24, 64), step);
          await step(rnd(1200, 2600));
          setPose({ eyes: Math.random() < 0.5 ? 'left' : 'right' });
          await step(500);
          await walk(base, step);
          face.value = withTiming(1, { duration: 160 });
          break;
        }
        case 'perch': {
          const others = perchesFor(lastPath.current).filter((k) => k !== at);
          if (others.length) await travel(oneOf(others), step);
          break;
        }
        case 'peek': await peek(step); break;
        case 'rain': rainedOn.current = today; await rain(step); break;
        case 'hum': await hum(step); break;
        case 'yawn': await yawn(step); break;
        case 'nap': await nap(step, rnd(18000, 40000)); break;
        case 'wave': await wave(step); break;
      }
    });
  };

  /* ---------------- coming back after a long time away */

  React.useEffect(() => {
    let left = 0;
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') { left = Date.now(); hush(); return; }
      const gone = left ? Date.now() - left : 0;
      left = 0;
      const today = todayKey();
      if (memory.day !== today) keepMemory(newDay(memory, today));
      if (gone < 3 * 60 * 60 * 1000 || reading.current || away.current) return;
      act(async (step) => {
        napping.current = true;
        setPose({ eyes: 'blink', l: 'down', r: 'down' });
        setFx({ zed: true });
        await step(2200);
        napping.current = false;
        setFx({ zed: false });
        setPose({ eyes: 'wide', l: 'rest', r: 'rest' });
        lift.value = withSequence(withTiming(10, { duration: 150 }), withTiming(0, { duration: 170 }));
        await step(400);
        if (memory.hello !== today) {
          keepMemory({ ...memory, hello: today });
          say('hello');
        } else say('nap');
        await wave(step);
      }, true);
    });
    return () => sub.remove();
  }, []);

  /* ---------------- taking part */

  const cue = useCue();
  const firstCue = React.useRef(cue.n);
  React.useEffect(() => {
    if (cue.n === firstCue.current || !cue.cue) return;
    const c = cue.cue;
    if (c === 'day' || c === 'done' || c === 'streak') {
      setBud(Math.min(3, Math.floor(dayProgress() * 3.01)));
      act(async (step) => {
        if (away.current) return;
        if (c === 'day') {
          say('day');
          await cheer(step, 3, true);
          if (gear.includes('bloom')) { setBud(3); setPose({ eyes: 'up' }); await step(900); }
        } else if (c === 'done') {
          const s = useStore.getState().sessions;
          const last = s.reduce<typeof s[number] | null>((a, x) => (!a || x.endedAt > a.endedAt ? x : a), null);
          say('done', { extra: { minutes: last ? last.netSeconds / 60 : 25 } });
          await cheer(step, 2);
          await stretch(step);
        } else {
          say('streak');
          await wave(step, true);
        }
      }, true);
      return;
    }
    if (c === 'start') { if (!keyboardUp.current) say('start'); return; }
    if (reading.current || away.current) return;
    if (c === 'tick') {
      setBud(Math.min(3, Math.floor(dayProgress() * 3.01)));
      act(async (step) => {
        setPose({ eyes: 'happy' });
        lift.value = withSequence(withTiming(12, { duration: 150, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: 160, easing: Easing.in(Easing.quad) }));
        sq.value = withSequence(withTiming(0.9, { duration: 80 }), withTiming(1.05, { duration: 150 }), withTiming(1, { duration: 160 }));
        const now = Date.now();
        if (Math.random() < 0.22 && now - memory.lastTickAt > 10 * 60 * 1000 && say('tick')) keepMemory({ ...memory, lastTickAt: now });
        await step(700);
      });
    } else if (c === 'add') {
      act(async (step) => { await nod(step); });
    }
  }, [cue.n]);

  // the bud and the balloon follow the day's ToDos
  React.useEffect(() => useStore.subscribe((s, prev) => {
    if (s.dailyTasks !== prev.dailyTasks) setBud(Math.min(3, Math.floor(dayProgress() * 3.01)));
  }), []);

  /* ---------------- touch */

  const taps = React.useRef<number[]>([]);
  const onTap = () => {
    if (away.current) return;
    hush();
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < 2600), now];
    const n = taps.current.length;
    if (napping.current) {
      token.current++;
      busy.current = false;
      napping.current = false;
      setFx({ zed: false });
      act(async (step) => {
        setPose({ eyes: 'wide', l: 'rest', r: 'rest' });
        lift.value = withSequence(withTiming(12, { duration: 150 }), withTiming(0, { duration: 170 }));
        await step(400);
        say('nap', { always: true });
        await step(600);
      }, true);
      return;
    }
    if (reading.current) {
      // looks up from its book for a moment
      act(async (step) => {
        setPose({ eyes: 'open', book: 'open' });
        await step(900);
        setPose({ eyes: 'happy' });
        await step(500);
      }, true);
      return;
    }
    act(async (step) => {
      if (n >= 6) {
        taps.current = [];
        setPose({ eyes: 'wide', mouth: 'o' });
        for (let i = 0; i < 3; i++) { face.value = withSequence(withTiming(-1, { duration: 110 }), withTiming(1, { duration: 110 })); await step(230); }
        setPose({ eyes: 'sleepy', mouth: 'flat' });
        tilt.value = withSequence(withTiming(-8, { duration: 220 }), withTiming(8, { duration: 300 }), withTiming(-5, { duration: 260 }), withTiming(0, { duration: 260 }));
        say('dizzy', { always: true });
        await step(1300);
        return;
      }
      if (n >= 3) {
        say('taps', { always: true });
        await wiggle(step);
        return;
      }
      const r = Math.random();
      if (r < 0.3) {
        setPose({ eyes: 'happy', mouth: 'smile' });
        sq.value = withSequence(withTiming(0.8, { duration: 90 }), withTiming(1.1, { duration: 160 }), withTiming(1, { duration: 160 }));
        lift.value = withDelay(90, withSequence(withTiming(14, { duration: 160 }), withTiming(0, { duration: 160 })));
        if (Math.random() < 0.55) say('tap', { always: true });
        await step(700);
      } else if (r < 0.52) {
        await wave(step);
      } else if (r < 0.7) {
        await heart(step);
      } else if (r < 0.85) {
        setPose({ eyes: 'happy' });
        face.value = withSequence(withTiming(-1, { duration: 160 }), withTiming(1, { duration: 160 }));
        lift.value = withSequence(withTiming(16, { duration: 160 }), withTiming(0, { duration: 160 }));
        await step(600);
      } else {
        setPose({ eyes: 'wide', mouth: 'o' });
        await step(500);
        setPose({ eyes: 'happy', mouth: 'smile' });
        if (Math.random() < 0.5) say('tap', { always: true });
        await step(700);
      }
    }, true);
  };

  const onHold = () => {
    if (away.current) return;
    hush();
    setChat(true);
    act(async (step) => { setPose({ eyes: 'up', mouth: 'smile' }); await step(500); setPose({ eyes: 'open' }); }, true);
  };

  const dragFrom = React.useRef({ x: 0, y: 0 });
  const onDragStart = () => {
    if (away.current) return;
    token.current++;
    busy.current = true;
    dragging.current = true;
    hush();
    cancelAnimation(x); cancelAnimation(y);
    lift.value = withTiming(0, { duration: 100 });
    dragFrom.current = { x: x.value, y: y.value };
    setPose({ ...REST, eyes: 'wide', mouth: 'o', feet: 'tuck', l: 'out', r: 'out' });
  };
  const onDrag = (dx: number, dy: number) => {
    if (!dragging.current) return;
    x.value = Math.max(8, Math.min(W - 8, dragFrom.current.x + dx));
    y.value = Math.max(insets.top + SH, Math.min(H - 4, dragFrom.current.y + dy));
    tilt.value = Math.max(-12, Math.min(12, dx * 0.05));
  };
  const onDragEnd = () => {
    if (!dragging.current) return;
    dragging.current = false;
    busy.current = false;
    // set down at the nearest perch this screen has
    const ok = perchesFor(lastPath.current);
    let best = ok[0];
    let bestD = Infinity;
    for (const k of ok) {
      const d = Math.hypot(spots[k].x - x.value, spots[k].y - y.value);
      if (d < bestD) { bestD = d; best = k; }
    }
    act(async (step) => {
      tilt.value = withTiming(0, { duration: 160 });
      await hop(spots[best], step, 10);
      spot.current = best;
      face.value = withTiming(spots[best].face, { duration: 160 });
      setPose({ eyes: 'happy', mouth: 'smile' });
      await step(600);
    }, true);
  };

  const gesture = React.useMemo(() => Gesture.Race(
    Gesture.Pan().minDistance(8).runOnJS(true)
      .onStart(onDragStart).onUpdate((e) => onDrag(e.translationX, e.translationY)).onEnd(onDragEnd).onFinalize(onDragEnd),
    Gesture.LongPress().minDuration(480).runOnJS(true).onStart(onHold),
    Gesture.Tap().maxDuration(400).runOnJS(true).onEnd((_e, ok) => { if (ok) onTap(); }),
  ), [spots, W, H, path]);

  /* ---------------- talking to it */

  const answer = (msg: string): Reply => {
    const r = reply(msg, ctxNow());
    const run = r.act;
    if (run) {
      act(async (step) => {
        if (run === 'wave') await wave(step);
        else if (run === 'cheer') await cheer(step, 2);
        else if (run === 'nap') await nap(step, 6000);
        else if (run === 'droop') await droop(step);
        else if (run === 'heart') await heart(step);
        else if (run === 'think') await think(step);
        else if (run === 'dance') await dance(step);
        else if (run === 'blush') { setPose({ blush: true, eyes: 'happy' }); await step(1600); setPose({ blush: false }); }
        else if (run === 'yawn') await yawn(step);
        else await nod(step);
      }, true);
    }
    return r;
  };
  const tuckAway = () => {
    setChat(false);
    act(async (step) => {
      say('bye', { always: true });
      await wave(step);
      await exitBy(x.value < W / 2 ? 'left' : 'right', step);
      useStore.getState().setSetting('mascotAwayOn', todayKey());
      toast(name + ' will be back tomorrow', { label: 'Undo', onPress: () => useStore.getState().setSetting('mascotAwayOn', '') });
    }, true);
  };

  /* ---------------- styles on the UI thread */

  const anchor = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateX: x.value - SW / 2 }, { translateY: y.value - SH - lift.value }] as const,
  }));
  const body = useAnimatedStyle(() => {
    const s = sq.value * (1 + 0.025 * breath.value);
    return {
      transform: [
        { translateY: SH * (1 - s) / 2 },
        { rotate: tilt.value + 'deg' },
        { scaleX: face.value / Math.sqrt(s) },
        { scaleY: s },
      ] as const,
    };
  });
  const shadow = useAnimatedStyle(() => ({
    opacity: 0.22 * shown.value * (1 - Math.min(1, lift.value / 40)),
    transform: [{ translateX: x.value - SW * 0.3 }, { translateY: y.value - 3 }, { scaleX: 1 - Math.min(0.5, lift.value / 60) }] as const,
  }));
  const doorStyle = useAnimatedStyle(() => ({ transform: [{ translateY: 21 * (1 - doorGrow.value) }, { scaleY: doorGrow.value }] as const, opacity: doorGrow.value }));

  /* ---------------- the bubble's place: above, or beside, or below, wherever it fits */

  const bubbleAt = (b: Bubble) => {
    if (!b.size) return null;
    const { w, h } = b.size;
    const mx = x.value;
    const top = y.value - SH - lift.value;
    const visL = Math.max(0, mx - SW / 2);
    const visR = Math.min(W, mx + SW / 2);
    const clampX = (v: number) => Math.max(10, Math.min(W - w - 10, v));
    if (top - h - 10 >= insets.top + 6) {
      const left = clampX(mx - w / 2);
      return { left, top: top - h - 8, tail: 'down' as const, tailAt: Math.max(14, Math.min(w - 14, (visL + visR) / 2 - left)) };
    }
    const mid = Math.max(insets.top + 6, top + SH / 2 - h / 2);
    if (visL - w - 12 >= 10) return { left: visL - w - 8, top: mid, tail: 'right' as const, tailAt: Math.min(h - 10, top + SH / 2 - mid) };
    if (visR + w + 12 <= W - 10) return { left: visR + 8, top: mid, tail: 'left' as const, tailAt: Math.min(h - 10, top + SH / 2 - mid) };
    const left = clampX(mx - w / 2);
    return { left, top: y.value + 8, tail: 'up' as const, tailAt: Math.max(14, Math.min(w - 14, mx - left)) };
  };
  const place = bubble ? bubbleAt(bubble) : null;

  const flier = gear.find((g) => FLIERS.includes(g));
  const hasBalloon = kind === 'pip' && gear.includes('balloon');

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {door ? (
        <Animated.View pointerEvents="none" style={[st.door, { left: door.side === 'left' ? rail : W - 30, top: door.y - 42 }, doorStyle]}>
          <GridArt grid={door.side === 'left' ? DOOR[door.frame] : DOOR[door.frame].map((r) => r.split('').reverse().join(''))} pal={DOOR_PAL} px={3} />
        </Animated.View>
      ) : null}
      <Animated.View pointerEvents="none" style={[st.shadow, { width: SW * 0.6 }, shadow]} />
      <Animated.View pointerEvents="box-none" style={[st.anchor, anchor]}>
        <Effects fx={fx} />
        {hasBalloon ? <Balloon pal={pal} rise={bud / 3} /> : null}
        <GestureDetector gesture={gesture}>
          <Animated.View
            style={body} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            accessible accessibilityRole="button" accessibilityLabel={name + ', your companion'}
            accessibilityHint="Tap to say hi, hold to talk to it, drag to move it"
            accessibilityActions={[{ name: 'activate' }, { name: 'longpress' }]}
            onAccessibilityAction={(e) => (e.nativeEvent.actionName === 'longpress' ? onHold() : onTap())}
          >
            <Sprite kind={kind} pose={pose} gear={gear} bud={bud} pal={pal} />
          </Animated.View>
        </GestureDetector>
        {flier === 'ladybug' ? <Ladybug resting={focusing || napping.current} full={full} /> : null}
        {flier === 'firefly' ? <Firefly full={full} /> : null}
      </Animated.View>
      {bubble ? (
        <View
          key={bubble.key} pointerEvents="box-none"
          style={[st.bubbleWrap, place ? { left: place.left, top: place.top } : { left: -999, top: -999, opacity: 0 }]}
          onLayout={(e) => { if (!bubble.size) { const { width, height } = e.nativeEvent.layout; setBubble({ ...bubble, size: { w: width, h: height } }); } }}
        >
          {place ? (
            <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(160)}>
              <Pressable onPress={hush} accessibilityRole="text" accessibilityLabel={name + ' says: ' + bubble.text} style={st.bubble}>
                <Text style={st.bubbleText}>{bubble.text}</Text>
              </Pressable>
              <View pointerEvents="none" style={[st.tail, tailStyle(place.tail, place.tailAt)]} />
            </Animated.View>
          ) : (
            <View style={st.bubble}><Text style={st.bubbleText}>{bubble.text}</Text></View>
          )}
        </View>
      ) : null}
      {chat ? (
        <ChatCard
          name={name} kind={kind} topInset={insets.top} width={W}
          onClose={() => setChat(false)} onSend={answer} onAway={tuckAway}
          onCustomise={() => { setChat(false); router.push('/companion'); }}
          onFocus={() => { setChat(false); router.push('/focus'); }}
        />
      ) : null}
    </View>
  );
}

const tailStyle = (dir: 'down' | 'up' | 'left' | 'right', at: number) => {
  if (dir === 'down') return { left: at - 5, bottom: -4 };
  if (dir === 'up') return { left: at - 5, top: -4 };
  if (dir === 'right') return { right: -4, top: at - 5 };
  return { left: -4, top: at - 5 };
};

/* ---------------------------------------------------------------- the little things around it */

/** thought dots and a bulb, z's, music notes, a raincloud, a heart, sparks: drawn over its head */
function Effects({ fx }: { fx: Fx }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {[0, 1, 2].map((i) => (fx.dots > i ? (
        <Animated.View key={i} entering={FadeIn.duration(160)} exiting={FadeOut.duration(140)}
          style={[st.dot, { width: 3 + i * 1.5, height: 3 + i * 1.5, left: SW - 10 + i * 7, top: 10 - i * 9 }]} />
      ) : null))}
      {fx.bulb ? (
        <Animated.View entering={FadeIn.duration(120).springify()} exiting={FadeOut.duration(200)} style={{ position: 'absolute', left: SW - 8, top: -22 }}>
          <GridArt grid={PROPS.bulb.grid} pal={PROPS.bulb.pal} px={3} />
        </Animated.View>
      ) : null}
      {fx.zed ? <Rising grid={PROPS.zed.grid} pal={PROPS.zed.pal} left={SW - 14} top={4} every={1500} /> : null}
      {fx.notes ? <Rising grid={PROPS.note.grid} pal={PROPS.note.pal} left={SW - 10} top={8} every={900} /> : null}
      {fx.cloud ? <Cloud /> : null}
      {fx.heart ? <Rising key={fx.heart} grid={PROPS.heart.grid} pal={PROPS.heart.pal} left={SW / 2 - 7} top={-6} every={1600} once /> : null}
    </View>
  );
}

/** a little prop that floats up and fades, over and over (or once) */
function Rising({ grid, pal, left, top, every, once = false }: { grid: string[]; pal: Palette; left: number; top: number; every: number; once?: boolean }) {
  const t = useSharedValue(0);
  React.useEffect(() => {
    t.value = once ? withTiming(1, { duration: every, easing: Easing.out(Easing.quad) }) : withRepeat(withTiming(1, { duration: every, easing: Easing.out(Easing.quad) }), -1, false);
    return () => cancelAnimation(t);
  }, []);
  const style = useAnimatedStyle(() => ({
    opacity: t.value < 0.15 ? t.value / 0.15 : 1 - (t.value - 0.15) / 0.85,
    transform: [{ translateY: -18 * t.value }, { translateX: 5 * Math.sin(t.value * 6) }] as const,
  }));
  return (
    <Animated.View style={[{ position: 'absolute', left, top }, style]}>
      <GridArt grid={grid} pal={pal} px={2} />
    </Animated.View>
  );
}

function Cloud() {
  const d = useSharedValue(0);
  React.useEffect(() => { d.value = withRepeat(withTiming(1, { duration: 520, easing: Easing.in(Easing.quad) }), -1, false); return () => cancelAnimation(d); }, []);
  const drops = useAnimatedStyle(() => ({ transform: [{ translateY: 14 * d.value }] as const, opacity: 1 - d.value * 0.7 }));
  return (
    <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(260)} style={{ position: 'absolute', left: SW / 2 - 10, top: -24 }}>
      <GridArt grid={PROPS.cloud.grid} pal={PROPS.cloud.pal} px={3} />
      <Animated.View style={[{ position: 'absolute', top: 12, left: 0, flexDirection: 'row', gap: 5 }, drops]}>
        {[0, 1, 2].map((i) => <View key={i} style={{ marginTop: i % 2 ? 4 : 0 }}><GridArt grid={PROPS.drop.grid} pal={PROPS.drop.pal} px={2} /></View>)}
      </Animated.View>
    </Animated.View>
  );
}

/**
 * Dot the ladybug: flits about Sprout's head in little curves and, every so often, lands on top of its head with its
 * wings folded, then takes off again. During Deep Work (or a nap) it stays landed.
 */
function Ladybug({ resting, full }: { resting: boolean; full: boolean }) {
  const bx = useSharedValue(SW / 2 - 4);
  const by = useSharedValue(SH * 0.42);
  const flap = useSharedValue(0);
  const [landed, setLanded] = React.useState(true);
  React.useEffect(() => {
    if (!full || resting) {
      setLanded(true);
      bx.value = withTiming(SW / 2 - 4, { duration: 700 });
      by.value = withTiming(SH * 0.42, { duration: 700 });
      return undefined;
    }
    let live = true;
    let t: ReturnType<typeof setTimeout>;
    const fly = (n: number) => {
      if (!live) return;
      if (n <= 0) {
        // come in to land on the head
        bx.value = withTiming(SW / 2 - 4, { duration: 900, easing: Easing.inOut(Easing.quad) });
        by.value = withTiming(SH * 0.42, { duration: 900, easing: Easing.inOut(Easing.quad) });
        t = setTimeout(() => { if (!live) return; setLanded(true); t = setTimeout(() => { if (live) { setLanded(false); fly(Math.round(rnd(4, 9))); } }, rnd(6000, 16000)); }, 950);
        return;
      }
      const ms = rnd(900, 1500);
      bx.value = withTiming(rnd(-14, SW + 6), { duration: ms, easing: Easing.inOut(Easing.sin) });
      by.value = withTiming(rnd(-18, SH * 0.35), { duration: ms, easing: Easing.inOut(Easing.sin) });
      t = setTimeout(() => fly(n - 1), ms);
    };
    t = setTimeout(() => { setLanded(false); fly(Math.round(rnd(3, 7))); }, rnd(2500, 6000));
    return () => { live = false; clearTimeout(t); };
  }, [resting, full]);
  React.useEffect(() => {
    if (landed) { cancelAnimation(flap); flap.value = 0; return undefined; }
    flap.value = withRepeat(withTiming(1, { duration: 70 }), -1, true);
    return () => cancelAnimation(flap);
  }, [landed]);
  const pos = useAnimatedStyle(() => ({ transform: [{ translateX: bx.value }, { translateY: by.value }] as const }));
  const wings = useAnimatedStyle(() => ({ opacity: 0.25 + 0.45 * flap.value, transform: [{ scaleX: 0.6 + 0.4 * flap.value }] as const }));
  return (
    <Animated.View pointerEvents="none" style={[st.flier, pos]}>
      {!landed ? <Animated.View style={[st.wings, wings]} /> : null}
      <GridArt grid={PROPS.ladybug.grid} pal={PROPS.ladybug.pal} px={2} />
    </Animated.View>
  );
}

/** a firefly that drifts about softly glowing, only after dark (6 pm to 6 am); by day it is asleep and not seen */
function Firefly({ full }: { full: boolean }) {
  const [dark, setDark] = React.useState(() => { const h = new Date().getHours(); return h >= 18 || h < 6; });
  React.useEffect(() => {
    const iv = setInterval(() => { const h = new Date().getHours(); setDark(h >= 18 || h < 6); }, 60000);
    return () => clearInterval(iv);
  }, []);
  const fx = useSharedValue(SW + 4);
  const fy = useSharedValue(4);
  const glow = useSharedValue(0.4);
  React.useEffect(() => {
    if (!dark) return undefined;
    glow.value = withRepeat(withTiming(1, { duration: 1300, easing: Easing.inOut(Easing.sin) }), -1, true);
    if (!full) return () => cancelAnimation(glow);
    let live = true;
    let t: ReturnType<typeof setTimeout>;
    const go = () => {
      if (!live) return;
      const ms = rnd(2200, 3600);
      fx.value = withTiming(rnd(-24, SW + 18), { duration: ms, easing: Easing.inOut(Easing.sin) });
      fy.value = withTiming(rnd(-30, SH * 0.5), { duration: ms, easing: Easing.inOut(Easing.sin) });
      t = setTimeout(go, ms);
    };
    go();
    return () => { live = false; clearTimeout(t); cancelAnimation(glow); };
  }, [dark, full]);
  const pos = useAnimatedStyle(() => ({ transform: [{ translateX: fx.value }, { translateY: fy.value }] as const }));
  const halo = useAnimatedStyle(() => ({ opacity: 0.18 + 0.4 * glow.value, transform: [{ scale: 0.8 + 0.5 * glow.value }] as const }));
  if (!dark) return null;
  return (
    <Animated.View pointerEvents="none" style={[st.flier, pos]}>
      <Animated.View style={[st.halo, halo]} />
      <View style={st.firefly} />
    </Animated.View>
  );
}

/** Pip's balloon, on its string from Pip's hand, bobbing; it floats higher as the day's ToDos get done */
function Balloon({ pal, rise }: { pal: Palette; rise: number }) {
  const bob = useSharedValue(0);
  React.useEffect(() => { bob.value = withRepeat(withTiming(1, { duration: 1700, easing: Easing.inOut(Easing.sin) }), -1, true); return () => cancelAnimation(bob); }, []);
  const len = 18 + Math.round(rise * 16);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: -3 * bob.value }, { rotate: (bob.value - 0.5) * 9 + 'deg' }] as const }));
  const bal = { ...pal, a: pal.a, h: '#FFFFFF', A: pal.A };
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 16 * PX - 3, top: 12 * PX - len - 18, width: 15, height: len + 18, alignItems: 'center', transformOrigin: 'bottom' }, style]}>
      <GridArt grid={PROPS.balloon.grid} pal={bal} px={3} />
      <View style={{ width: 1, height: len, backgroundColor: 'rgba(120,110,100,0.7)' }} />
    </Animated.View>
  );
}

/* ---------------------------------------------------------------- the talking card */

function ChatCard({ name, kind, topInset, width, onClose, onSend, onAway, onCustomise, onFocus }: {
  name: string; kind: Kind; topInset: number; width: number;
  onClose: () => void; onSend: (msg: string) => Reply; onAway: () => void; onCustomise: () => void; onFocus: () => void;
}) {
  const [text, setText] = React.useState('');
  const [said, setSaid] = React.useState<{ me: string; it: Reply } | null>(null);
  const send = () => {
    const m = text.trim();
    if (!m) return;
    setSaid({ me: m, it: onSend(m) });
    setText('');
  };
  const cardW = Math.min(420, width - 32);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(150)} style={[st.card, { top: topInset + 56, width: cardW, left: (width - cardW) / 2 }]}>
        <View style={st.cardHead}>
          <Text style={st.cardName}>{name}</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={18} color="#8A7B70" />
          </Pressable>
        </View>
        {said ? (
          <View style={{ marginTop: 6 }}>
            <Text style={st.me} numberOfLines={2}>{said.me}</Text>
            <Text style={st.it}>{said.it.text}</Text>
            {said.it.focus ? (
              <Pressable onPress={onFocus} style={st.action} accessibilityRole="button">
                <Text style={st.actionText}>Start Deep Work</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <Text style={[st.it, { marginTop: 4 }]}>{kind === 'sprout' ? 'Psst. Say anything. I am a good listener.' : 'Hi! Tell me something.'}</Text>
        )}
        <View style={st.inputRow}>
          <TextInput
            value={text} onChangeText={setText} onSubmitEditing={send} placeholder={'Say something to ' + name}
            placeholderTextColor="#A99A8E" style={st.input} returnKeyType="send" maxLength={160} autoFocus={Platform.OS === 'web'}
            blurOnSubmit={false} accessibilityLabel={'Say something to ' + name}
          />
          <Pressable onPress={send} disabled={!text.trim()} hitSlop={6} accessibilityRole="button" accessibilityLabel="Send" style={[st.send, !text.trim() && { opacity: 0.4 }]}>
            <Ionicons name="arrow-up" size={16} color="#FFF8EE" />
          </Pressable>
        </View>
        <View style={st.links}>
          <Pressable onPress={onCustomise} hitSlop={6} accessibilityRole="button"><Text style={st.link}>Customise</Text></Pressable>
          <Pressable onPress={onAway} hitSlop={6} accessibilityRole="button"><Text style={st.link}>Tuck away until tomorrow</Text></Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const INK = '#3D2F28';
const PAPER = '#FFF8EE';
const st = StyleSheet.create({
  anchor: { position: 'absolute', left: 0, top: 0, width: SW, height: SH },
  shadow: { position: 'absolute', left: 0, top: 0, height: 5, borderRadius: 3, backgroundColor: '#000' },
  door: { position: 'absolute', width: 30, height: 42 },
  bubbleWrap: { position: 'absolute', maxWidth: 210 },
  bubble: {
    backgroundColor: PAPER, borderRadius: 13, paddingHorizontal: 11, paddingVertical: 7,
    shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4,
  },
  bubbleText: { color: INK, fontFamily: CUTE, fontSize: 12.5, lineHeight: 17 },
  tail: { position: 'absolute', width: 10, height: 10, backgroundColor: PAPER, transform: [{ rotate: '45deg' }], borderRadius: 2 },
  dot: { position: 'absolute', borderRadius: 1, backgroundColor: '#FFF8EE', opacity: 0.9 },
  flier: { position: 'absolute', left: 0, top: 0 },
  wings: { position: 'absolute', left: 1, top: -3, width: 7, height: 4, borderRadius: 3, backgroundColor: '#FFFFFF' },
  halo: { position: 'absolute', left: -5, top: -5, width: 14, height: 14, borderRadius: 7, backgroundColor: '#FFE68A' },
  firefly: { width: 4, height: 4, backgroundColor: '#FFF2B0' },
  card: {
    position: 'absolute', backgroundColor: PAPER, borderRadius: 18, padding: 14,
    shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 10,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardName: { color: INK, fontFamily: CUTE_BOLD, fontSize: 15 },
  me: { color: '#8A7B70', fontFamily: CUTE, fontSize: 12.5, textAlign: 'right', marginBottom: 4 },
  it: { color: INK, fontFamily: CUTE, fontSize: 14, lineHeight: 20 },
  action: { alignSelf: 'flex-start', marginTop: 8, backgroundColor: '#F2E6D6', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  actionText: { color: INK, fontFamily: CUTE_BOLD, fontSize: 12.5 },
  inputRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, backgroundColor: '#F4EADC', borderRadius: 999, paddingLeft: 14, paddingRight: 5, height: 40 },
  input: { flex: 1, color: INK, fontFamily: CUTE, fontSize: 14, paddingVertical: 0, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
  send: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#C9805A', alignItems: 'center', justifyContent: 'center' },
  links: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, paddingHorizontal: 2 },
  link: { color: '#A0654A', fontFamily: CUTE_BOLD, fontSize: 12.5 },
});
