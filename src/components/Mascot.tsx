// Cheerful's companion: Sprout, a little plant who waves with its leaves, or Pip, a soft round friend with nub arms
// (src/mascot/art.ts draws them, src/mascot/lines.ts gives them their words).
//
// Where it lives: on the header of the screen in front, in the room the header leaves between its title and its buttons
// (each header measures and says so: src/mascot/room.ts). It never stands over content, a button or a title. On Today
// that is the date row, and it scrolls away with it. Switching tabs, it looks the way the screen went and steps or hops
// along the header to the new screen's room; a screen with no room (a full-screen tool) sees it leave by its door.
//
// Its doors: the screen's left and right edges are walls, and a door in a wall swings open into the room on its hinge,
// as a real one would, seen from the side. It comes and goes only by them. Held, it waves goodbye and goes out by one;
// then a small door sits flush with the right wall, and a knock on it (a soft knock and a doorbell) brings it back.
//
// What it does: mostly it lives in place, breathing, blinking, looking about, thinking (eyes up, dots rising, sometimes
// a bulb), stretching, ruffling its leaves or squishing, humming or watering itself; never yawning or dozing, in an
// app for getting things done. Dragged, Sprout flies on its leaves and Pip floats down under an umbrella from nowhere,
// to the nearest good place in the room.
// It joins in (a hop for a tick, a cheer for a session or a day done), and through Deep Work it reads at its place and
// says nothing until the session ends. A tap gets a reaction, and sometimes a word about the day. It speaks by itself
// only a few times a day (src/mascot/lines.ts rests every line it says for weeks). Only in Cheerful, with motion on.

import React from 'react';
import { AppState, PixelRatio, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing, FadeIn, FadeOut, cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence,
  withSpring, withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Rect } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { usePathname } from 'expo-router';
import { useStore } from '../store';
import { useAnimLevel } from './Motion';
import { daysUntil, todayKey, todoDueOn } from '../utils';
import { WIDE_AT } from '../layout';
import { indexScores, upcoming } from '../scores';
import { pkey } from '../profiles';
import { knock } from '../cheerSound';
import { useRoom } from '../mascot/room';
import { COLS, Cell, FLIERS, Kind, NAMES, PROPS, Palette, Pose, REST, ROWS, colorSet, compose, runs } from '../mascot/art';
import { Ctx, Memory, Moment, choose, chooseIdle, dayNo, fill, freshMemory, maySpeak, newDay, poolFor, remember } from '../mascot/lines';

/** the companion's own face for its words: Nunito, round and small (loaded with the app's faces) */
export const CUTE = 'Nunito_700Bold';
export const CUTE_BOLD = 'Nunito_800ExtraBold';

/** a square's size: about 2.25 points, snapped to whole device pixels so the squares stay crisp */
const PX = Math.max(2, Math.round(2.25 * PixelRatio.get()) / PixelRatio.get());
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

/** A little grid (a prop) as squares. */
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
  const todays = s.sessions.filter((x) => x.dateKey === today);
  const focusMin = Math.round(todays.reduce((a, x) => a + (x.netSeconds || 0), 0) / 60);
  return {
    kind, name, hour: now.getHours(), weekday: now.getDay(), date: today.slice(5), year: now.getFullYear(),
    due: due.length, left: open.length, next: open[0]?.title ?? null, exam, focusMin,
    subject: todays.length ? todays[todays.length - 1].subject ?? null : null,
    away: memory.lastDay && memory.lastDay !== today ? dayNo(today) - dayNo(memory.lastDay) : 0,
    run: memory.run, first: !memory.firstDay, gear,
  };
}

/** How far the day's ToDos are done, 0 to 1 (a third with none due). */
function dayProgress(): number {
  const today = todayKey();
  const due = useStore.getState().dailyTasks.filter((t) => todoDueOn(t, today));
  if (!due.length) return 0.34;
  return due.filter((t) => t.doneOn === today).length / due.length;
}
const budOf = () => Math.min(3, Math.floor(dayProgress() * 3.01));

/* ---------------------------------------------------------------- the host */

/** Mounted once, in the root layout, over the tabs and pages and under Sift and the sheets. */
export function MascotHost() {
  const s = useStore((st) => st.settings);
  const level = useAnimLevel();
  if (s.mood !== 'cheerful' || s.mascot === 'off' || level === 'none') return null;
  const kind: Kind = s.mascot === 'pip' ? 'pip' : 'sprout';
  return <Companion key={kind} kind={kind} />;
}

/* ---------------------------------------------------------------- the companion */

const CANCEL = { cancelled: true };
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
type Step = (ms: number) => Promise<void>;
type Side = 'left' | 'right';
type Spot = { x: number; y: number };
type Bubble = { text: string; key: number; size?: { w: number; h: number } };
type Fx = { dots: number; bulb: boolean; notes: boolean; cloud: boolean; heart: number; sparks: number; umbrella: boolean };
const NO_FX: Fx = { dots: 0, bulb: false, notes: false, cloud: false, heart: 0, sparks: 0, umbrella: false };
const TABS = ['/', '/slot1', '/slot2', '/slot3', '/more'];
const tabOf = (path: string) => {
  if (path === '/') return 0;
  const m = /^\/(slot[123]|more)(\/|$)/.exec(path);
  return m ? TABS.indexOf('/' + m[1]) : -1;
};

function Companion({ kind }: { kind: Kind }) {
  const settings = useStore((s) => s.settings);
  const name = settings.mascotName || NAMES[kind];
  const look = settings.mascotLooks[kind];
  const pal = colorSet(kind, look.colors).pal;
  const gear = look.gear;
  const hideUntil = settings.mascotHideUntil;
  // hidden for a while from Sift: gone like sent off, back by itself when the time is up (or at a knock)
  const [hidden, setHidden] = React.useState(() => hideUntil > Date.now());
  React.useEffect(() => {
    const left = hideUntil - Date.now();
    setHidden(left > 0);
    if (left <= 0) return undefined;
    const t = setTimeout(() => { setHidden(false); useStore.getState().setSetting('mascotHideUntil', 0); }, left);
    return () => clearTimeout(t);
  }, [hideUntil]);
  const out = settings.mascotOut || hidden;
  const talk = settings.mascotTalk || 'some';
  const level = useAnimLevel();
  const full = level === 'full';
  const { width: W, height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const focusing = useStore((s) => !!s.deepWork?.running);
  const inSession = useStore((s) => !!s.deepWork);
  const path = usePathname();
  const { room, n: roomN } = useRoom();
  const scroll = room?.scroll;
  const rail = W >= WIDE_AT && settings.tabNav === 'side' ? 88 : 0;

  /* ---------------- moving parts */
  const x = useSharedValue(W + SW);
  const y = useSharedValue(insets.top + 48);
  const lift = useSharedValue(0);
  const sq = useSharedValue(1);
  const face = useSharedValue(-1);
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
  const [door, setDoor] = React.useState<{ side: Side; y: number } | null>(null);
  const doorOpen = useSharedValue(0);
  const [bubble, setBubble] = React.useState<Bubble | null>(null);
  const [bud, setBud] = React.useState(budOf);

  const alive = React.useRef(true);
  const away = React.useRef(true); // behind a wall: before it first comes in, when sent off, on a screen with no room
  const reading = React.useRef(false);
  const busy = React.useRef(false);
  const token = React.useRef(0);
  const bubbleTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastIdle = React.useRef<string[]>([]);
  const roomRef = React.useRef(room);
  roomRef.current = room;
  const outRef = React.useRef(out);
  outRef.current = out;
  const ctxNow = () => context(kind, name, gear);
  React.useEffect(() => () => { alive.current = false; token.current++; }, []);

  /** its place in the room in front: at the room's right end, by the header's buttons; null with no room fit for it */
  const home = (r = roomRef.current): Spot | null => {
    if (!r || r.right - r.left < SW * 0.8) return null;
    const lo = r.left + SW / 2;
    const hi = Math.max(lo, r.right - SW / 2);
    // where it was set down on this screen, if it was carried; else the room's right end, by the buttons
    const f = placed.current.get(useRoom.getState().key ?? '');
    return { x: f == null ? hi : lo + (hi - lo) * f, y: r.y };
  };
  const placed = React.useRef(new Map<string, number>());
  const nearWall = (atX: number): Side => (atX < (W + rail) / 2 ? 'left' : 'right');

  /** Runs one action at a time; a `force`d one stops the one under way and cleans up after it. */
  const act = React.useCallback((fn: (step: Step) => Promise<void>, force = false) => {
    if (busy.current && !force) return false;
    if (busy.current) tidy();
    const my = ++token.current;
    busy.current = true;
    const step: Step = (ms) => new Promise<void>((res, rej) => setTimeout(() => (alive.current && token.current === my ? res() : rej(CANCEL)), ms));
    fn(step).catch(() => {}).finally(() => {
      if (token.current !== my || !alive.current) return;
      busy.current = false;
      settle();
    });
    return true;
  }, []);

  /**
   * An action cut short leaves nothing behind: a door half open closes, the little effects go, and if it was caught in
   * a doorway it is simply back at its place (or, sent off, behind its wall).
   */
  const tidy = () => {
    setDoor(null);
    doorOpen.value = 0;
    setFxState(NO_FX);
    sq.value = withTiming(1, { duration: 120 });
    lift.value = withTiming(0, { duration: 120 });
    tilt.value = withTiming(0, { duration: 120 });
    const h = home();
    if (outRef.current || !h) { shown.value = 0; away.current = true; return; }
    if (away.current || shown.value < 1) {
      x.value = h.x;
      y.value = h.y;
      away.current = false;
      shown.value = withTiming(1, { duration: 160 });
    }
  };

  /** the pose it rests in: reading through Deep Work, otherwise just standing */
  const settle = () => {
    tilt.value = withTiming(0, { duration: 200 });
    if (reading.current) setPose({ ...REST, book: 'open', eyes: 'read', phones: true });
    else setPose(REST);
  };

  /* ---------------- words */

  const sayText = (text: string) => {
    if (!alive.current || away.current) return;
    if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
    setBubble({ text, key: Date.now() });
    bubbleTimer.current = setTimeout(() => setBubble(null), Math.min(5400, 1800 + text.length * 55));
  };
  /**
   * Says a line from a moment's pool, as Settings allows: by itself (`spontaneous`) only within the day's budget; a
   * moment's line only when it talks at all (`always` for an answer to a tap). True if it spoke.
   */
  const say = (m: Moment, opts: { spontaneous?: boolean; extra?: { minutes?: number }; always?: boolean } = {}) => {
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
  };
  const hush = () => { if (bubbleTimer.current) clearTimeout(bubbleTimer.current); setBubble(null); };

  /* ---------------- moves */

  /** a hop: a crouch, a leap along an arc, a landing with a little squash */
  const hop = async (to: Spot, step: Step, height = 18) => {
    const dist = Math.hypot(to.x - x.value, to.y - y.value);
    const d = Math.max(260, Math.min(640, 220 + dist * 0.9));
    if (Math.abs(to.x - x.value) > 2) face.value = to.x > x.value ? 1 : -1;
    sq.value = withSequence(withTiming(0.84, { duration: 110 }), withTiming(1.08, { duration: d * 0.5 }), withTiming(1, { duration: d * 0.5 }), withTiming(0.86, { duration: 80 }), withTiming(1, { duration: 150 }));
    x.value = withDelay(110, withTiming(to.x, { duration: d, easing: Easing.inOut(Easing.quad) }));
    y.value = withDelay(110, withTiming(to.y, { duration: d, easing: Easing.inOut(Easing.quad) }));
    lift.value = withDelay(110, withSequence(
      withTiming(height + Math.min(30, dist * 0.06), { duration: d / 2, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: d / 2, easing: Easing.in(Easing.quad) }),
    ));
    await step(110);
    setPose({ feet: 'tuck' });
    await step(d - 40);
    setPose({ feet: 'stand' });
    await step(240);
  };

  /** a walk: little quick steps, the feet shuffling and the body bobbing, along the row it stands on */
  const walk = async (toX: number, step: Step) => {
    const dist = Math.abs(toX - x.value);
    if (dist < 2) return;
    face.value = toX > x.value ? 1 : -1;
    const steps = Math.max(2, Math.min(14, Math.round(dist / 6)));
    const total = Math.min(1100, Math.max(260, dist * 4.2));
    const per = total / steps;
    x.value = withTiming(toX, { duration: total, easing: Easing.linear });
    for (let i = 0; i < steps; i++) {
      setPose({ feet: i % 2 ? 'stand' : 'step' });
      lift.value = withSequence(withTiming(1.5, { duration: per / 2 }), withTiming(0, { duration: per / 2 }));
      await step(per);
    }
    setPose({ feet: 'stand' });
  };

  /** to a spot on the same row: steps; anywhere else, a hop */
  const goTo = async (to: Spot, step: Step) => {
    if (Math.abs(to.y - y.value) < 4 && Math.abs(to.x - x.value) < 200) await walk(to.x, step);
    else await hop(to, step, 16);
  };

  /** the limb on the side it would wave from: toward the middle of the screen */
  const waveSide = (): 'l' | 'r' => (x.value < W / 2 ? 'r' : 'l');

  const wave = async (step: Step, big = false) => {
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
    await step(240);
  };

  const think = async (step: Step) => {
    const side = waveSide();
    setPose({ eyes: 'up', mouth: 'flat', [side]: 'up' });
    tilt.value = withTiming(-6, { duration: 420, easing: Easing.inOut(Easing.quad) });
    await step(420);
    for (let i = 1; i <= 3; i++) { setFx({ dots: i }); await step(380); }
    setPose({ eyes: 'left' });
    await step(650);
    setPose({ eyes: 'up' });
    await step(450);
    if (Math.random() < 0.45) {
      setFx({ dots: 0, bulb: true });
      setPose({ eyes: 'wide', mouth: 'o', [side]: 'rest' });
      tilt.value = withTiming(0, { duration: 160 });
      lift.value = withSequence(withTiming(8, { duration: 160 }), withTiming(0, { duration: 180 }));
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

  const cheer = async (step: Step, times = 2, spin = false) => {
    setPose({ eyes: 'happy', mouth: 'grin', l: 'up', r: 'up', book: 'none' });
    setFx({ sparks: Date.now() });
    for (let i = 0; i < times; i++) {
      sq.value = withSequence(withTiming(0.82, { duration: 100 }), withTiming(1.1, { duration: 210 }), withTiming(1, { duration: 210 }));
      lift.value = withDelay(100, withSequence(withTiming(spin && i === 1 ? 24 : 16, { duration: 210, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: 210, easing: Easing.in(Easing.quad) })));
      setPose({ feet: 'tuck', l: i % 2 ? 'swing' : 'up', r: i % 2 ? 'up' : 'swing' });
      if (spin && i === 1) face.value = withSequence(withTiming(-face.value, { duration: 180 }), withTiming(face.value, { duration: 180 }));
      await step(310);
      setPose({ feet: 'stand' });
      await step(220);
    }
  };

  const stretch = async (step: Step) => {
    setPose({ l: 'up', r: 'up', eyes: 'happy', mouth: 'smile' });
    sq.value = withTiming(1.12, { duration: 520, easing: Easing.out(Easing.quad) });
    await step(900);
    sq.value = withSequence(withTiming(0.94, { duration: 140 }), withTiming(1, { duration: 200 }));
    setPose({ l: 'out', r: 'out', mouth: 'none', eyes: 'happy' });
    await step(260);
    setPose({ l: 'rest', r: 'rest', eyes: 'open' });
    await step(200);
  };

  const wiggle = async (step: Step) => {
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

  const glance = async (step: Step) => {
    const first = Math.random() < 0.5 ? 'left' : 'right';
    setPose({ eyes: first });
    await step(rnd(600, 900));
    setPose({ eyes: first === 'left' ? 'right' : 'left' });
    await step(rnd(500, 800));
    setPose({ eyes: 'open' });
  };

  const heart = async (step: Step) => {
    setPose({ blush: true, eyes: 'happy', mouth: 'smile' });
    setFx({ heart: Date.now() });
    lift.value = withSequence(withTiming(7, { duration: 160 }), withTiming(0, { duration: 180 }));
    await step(1800);
    setPose({ blush: false });
  };

  /** Sprout waters itself: a little cloud, a drizzle, the leaves perking up */
  const rain = async (step: Step) => {
    setPose({ eyes: 'up' });
    setFx({ cloud: true });
    await step(2400);
    setFx({ cloud: false });
    setPose({ eyes: 'happy' });
    await wiggle(step);
  };

  /** Pip hums a little tune, swaying (headphones on, if it has them) */
  const hum = async (step: Step) => {
    setPose({ eyes: 'happy', mouth: 'smile', phones: true });
    setFx({ notes: true });
    for (let i = 0; i < 5; i++) { tilt.value = withTiming(i % 2 ? 6 : -6, { duration: 380, easing: Easing.inOut(Easing.sin) }); await step(400); }
    setFx({ notes: false });
    setPose({ phones: false });
  };

  /* ---------------- doors */

  /** where the wall is, for a door (the rail's edge on the PC with the side bar) */
  const wallX = (side: Side) => (side === 'left' ? rail : W);
  const openDoor = async (side: Side, atY: number, step: Step) => {
    setDoor({ side, y: atY });
    doorOpen.value = withTiming(1, { duration: 360, easing: Easing.out(Easing.back(1.2)) });
    await step(330);
  };
  const closeDoor = async (step: Step) => {
    doorOpen.value = withTiming(0, { duration: 300, easing: Easing.in(Easing.quad) });
    await step(320);
    setDoor(null);
  };
  /** walks to the wall on `side`, through its door, and is gone behind it */
  const exitBy = async (side: Side, step: Step) => {
    hush();
    const atY = y.value;
    const inside = side === 'left' ? wallX(side) + SW * 0.75 : wallX(side) - SW * 0.75;
    // across the header's buttons it hops; along an empty row it walks
    if (Math.abs(inside - x.value) > 70) await hop({ x: inside, y: atY }, step, 18);
    else await walk(inside, step);
    await openDoor(side, atY, step);
    face.value = side === 'left' ? -1 : 1;
    await walk(side === 'left' ? wallX(side) - SW * 0.6 : wallX(side) + SW * 0.6, step);
    shown.value = 0;
    away.current = true;
    await closeDoor(step);
  };
  /** comes out of the wall on `side` by its door, then goes to `to` */
  const enterBy = async (side: Side, to: Spot, step: Step) => {
    x.value = side === 'left' ? wallX(side) - SW * 0.6 : wallX(side) + SW * 0.6;
    y.value = to.y;
    face.value = side === 'left' ? 1 : -1;
    setPose(REST);
    await openDoor(side, to.y, step);
    shown.value = 1;
    away.current = false;
    await walk(side === 'left' ? wallX(side) + SW * 0.75 : wallX(side) - SW * 0.75, step);
    await closeDoor(step);
    if (Math.abs(to.x - x.value) > 4) await goTo(to, step);
    face.value = withTiming(to.x > W / 2 ? -1 : 1, { duration: 160 });
  };

  /* ---------------- coming in, and following the screen in front */

  const started = React.useRef(false);
  const lastPath = React.useRef(path);
  const noRoomTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    const h = home(room);
    const before = lastPath.current;
    lastPath.current = path;
    if (noRoomTimer.current) { clearTimeout(noRoomTimer.current); noRoomTimer.current = null; }
    // sent off or hidden: coming back is the knock's (or the timer's) to start, below
    if (outRef.current) return;
    if (!h) {
      // no room on this screen (or not measured yet): it waits a moment, then steps out until there is one
      if (!away.current) {
        noRoomTimer.current = setTimeout(() => {
          if (!home() && !away.current) act(async (step) => { await exitBy(nearWall(x.value), step); }, true);
        }, 700);
      }
      return;
    }
    if (!started.current) {
      started.current = true;
      void readMemory().then(() => {
        const today = todayKey();
        const firstToday = memory.hello !== today;
        keepMemory(newDay(memory, today));
        act(async (step) => {
          await step(700);
          const at = home();
          if (!at) return;
          await enterBy(nearWall(at.x), at, step);
          if (firstToday && !focusing) {
            keepMemory({ ...memory, hello: today });
            if (say('hello')) await wave(step);
          } else if (Math.random() < 0.3 && !focusing) {
            await wave(step);
          }
        }, true);
      });
      return;
    }
    if (away.current) {
      act(async (step) => { const at = home(); if (at) await enterBy(nearWall(at.x), at, step); }, true);
      return;
    }
    const moved = Math.abs(h.x - x.value) > 3 || Math.abs(h.y - y.value) > 3;
    if (!moved) return;
    const from = tabOf(before);
    const to = tabOf(path);
    act(async (step) => {
      hush();
      if (from >= 0 && to >= 0 && from !== to && full) {
        // a tab over: it looks the way the screen went, then goes along to its new place
        setPose({ eyes: to > from ? 'right' : 'left' });
        await step(160);
      }
      const at = home();
      if (at) await goTo(at, step);
      face.value = withTiming(-1, { duration: 160 });
      if (reading.current) setPose({ book: 'open', eyes: 'read' });
    }, true);
  }, [roomN]);

  /* ---------------- sent off, and knocked for */

  const sendOff = () => {
    if (away.current) return;
    act(async (step) => {
      say('bye', { always: true });
      await wave(step);
      await step(300);
      await exitBy(nearWall(x.value), step);
      useStore.getState().setSetting('mascotOut', true);
    }, true);
  };
  // the knock: it heard, and comes back in by its door
  const wasOut = React.useRef(out);
  React.useEffect(() => {
    const was = wasOut.current;
    wasOut.current = out;
    // hidden from Sift while here: it leaves by its door
    if (!was && out) {
      if (!away.current) act(async (step) => { await exitBy(nearWall(x.value), step); }, true);
      return;
    }
    if (!was || out) return;
    started.current = true;
    act(async (step) => {
      await step(900);
      const at = home();
      if (!at) return;
      await enterBy(nearWall(at.x), at, step);
      setPose({ eyes: 'happy', mouth: 'grin' });
      say('back', { always: true });
      await wave(step);
    }, true);
  }, [out]);

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
          setTimeout(() => { if (alive.current && poseRef.current.eyes === 'blink' && !busy.current) setPose({ eyes: e }); }, 130);
        }
        arm();
      }, rnd(2600, 6200));
    };
    arm();
    return () => clearTimeout(t);
  }, []);

  /* ---------------- Deep Work: it reads at its place */

  React.useEffect(() => {
    if (focusing) {
      reading.current = true;
      act(async (step) => {
        hush();
        if (away.current) return;
        await step(900);
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
        if (inSession && !away.current) await stretch(step);
      }, true);
    }
  }, [focusing]);
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

  /* ---------------- living in place: something small every so often */

  const rainedOn = React.useRef('');
  React.useEffect(() => {
    if (!full || focusing) return undefined;
    let t: ReturnType<typeof setTimeout>;
    const arm = () => { t = setTimeout(() => { tickIdle(); arm(); }, rnd(15000, 38000)); };
    arm();
    return () => clearTimeout(t);
  }, [full, focusing]);

  const tickIdle = () => {
    if (busy.current || away.current || AppState.currentState !== 'active') return;
    const hour = new Date().getHours();
    const late = hour >= 23 || hour < 5;
    // now and then, a word: within the day's budget
    if (Math.random() < 0.3 && maySpeak(memory, talk, Date.now())) {
      act(async (step) => {
        if (Math.random() < 0.5) await think(step);
        say('idle', { spontaneous: true });
        await step(600);
      });
      return;
    }
    const r = roomRef.current;
    const h = home();
    const roomy = !!r && !!h && r.right - r.left > SW * 2.2;
    const today = todayKey();
    const options: [string, number][] = [
      ['glance', 5], ['think', 3], ['stretch', 2], ['wiggle', 3], ['wander', roomy ? 3 : 0],
      ['rain', kind === 'sprout' && rainedOn.current !== today && !late ? 1 : 0],
      ['hum', kind === 'pip' ? 2 : 0], ['wave', late ? 0.2 : 0.5],
    ];
    const pool = options.filter(([k, w]) => w > 0 && !lastIdle.current.includes(k));
    const total = pool.reduce((a, [, w]) => a + w, 0);
    let pickAt = Math.random() * total;
    let pick = pool[0]?.[0] ?? 'glance';
    for (const [k, w] of pool) { pickAt -= w; if (pickAt <= 0) { pick = k; break; } }
    lastIdle.current = [pick, ...lastIdle.current].slice(0, 2);
    act(async (step) => {
      switch (pick) {
        case 'glance': await glance(step); break;
        case 'think': await think(step); break;
        case 'stretch': await stretch(step); break;
        case 'wiggle': await wiggle(step); break;
        case 'wander': {
          // a few steps along its row and back, never past the room's ends
          if (!r || !h) break;
          const to = Math.max(r.left + SW / 2, h.x - rnd(SW * 0.6, Math.min(SW * 2, r.right - r.left - SW)));
          await walk(to, step);
          await step(rnd(1200, 2600));
          setPose({ eyes: Math.random() < 0.5 ? 'left' : 'right' });
          await step(500);
          const back = home();
          if (back) await walk(back.x, step);
          face.value = withTiming(-1, { duration: 160 });
          break;
        }
        case 'rain': rainedOn.current = today; await rain(step); break;
        case 'hum': await hum(step); break;
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
      // a long time away: it perks up, glad to see the user
      act(async (step) => {
        setPose({ eyes: 'wide' });
        lift.value = withSequence(withTiming(10, { duration: 150 }), withTiming(0, { duration: 170 }));
        await step(400);
        if (memory.hello !== today) {
          keepMemory({ ...memory, hello: today });
          say('hello');
        }
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
    setBud(budOf());
    if (away.current) return;
    if (c === 'day' || c === 'done' || c === 'streak') {
      act(async (step) => {
        if (c === 'day') {
          say('day');
          await cheer(step, 3, true);
          if (gear.includes('bloom')) { setBud(3); setPose({ eyes: 'up' }); await step(900); }
        } else if (c === 'done') {
          const s = useStore.getState().sessions;
          const last = s.reduce<typeof s[number] | null>((a, v) => (!a || v.endedAt > a.endedAt ? v : a), null);
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
    if (c === 'start') { say('start'); return; }
    if (reading.current) return;
    if (c === 'tick') {
      act(async (step) => {
        setPose({ eyes: 'happy' });
        lift.value = withSequence(withTiming(10, { duration: 150, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: 160, easing: Easing.in(Easing.quad) }));
        sq.value = withSequence(withTiming(0.9, { duration: 80 }), withTiming(1.05, { duration: 150 }), withTiming(1, { duration: 160 }));
        const now = Date.now();
        if (Math.random() < 0.22 && now - memory.lastTickAt > 10 * 60 * 1000 && say('tick')) keepMemory({ ...memory, lastTickAt: now });
        await step(700);
      });
    } else if (c === 'add') {
      act(async (step) => {
        setPose({ eyes: 'happy' });
        sq.value = withSequence(withTiming(0.93, { duration: 120 }), withTiming(1, { duration: 140 }));
        await step(500);
      });
    }
  }, [cue.n]);

  React.useEffect(() => useStore.subscribe((s, prev) => { if (s.dailyTasks !== prev.dailyTasks) setBud(budOf()); }), []);

  /* ---------------- touch: a tap for a reaction, a hold to send it off */

  const taps = React.useRef<number[]>([]);
  const onTap = () => {
    if (away.current) return;
    hush();
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < 2600), now];
    const n = taps.current.length;
    if (reading.current) {
      // looks up from its book, and puts a finger to its lips, in its way
      act(async (step) => {
        setPose({ eyes: 'open', book: 'open' });
        await step(700);
        if (Math.random() < 0.5) say('shh', { always: true });
        setPose({ eyes: 'happy' });
        await step(700);
      }, true);
      return;
    }
    act(async (step) => {
      if (n >= 6) {
        taps.current = [];
        setPose({ eyes: 'wide', mouth: 'o' });
        for (let i = 0; i < 3; i++) { face.value = withSequence(withTiming(-face.value, { duration: 110 }), withTiming(face.value, { duration: 110 })); await step(230); }
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
      // about a third of taps get a word: often something about the day
      const word = () => { if (Math.random() < 0.38) say('tap', { always: true }); };
      if (r < 0.3) {
        setPose({ eyes: 'happy', mouth: 'smile' });
        sq.value = withSequence(withTiming(0.8, { duration: 90 }), withTiming(1.1, { duration: 160 }), withTiming(1, { duration: 160 }));
        lift.value = withDelay(90, withSequence(withTiming(12, { duration: 160 }), withTiming(0, { duration: 160 })));
        word();
        await step(800);
      } else if (r < 0.5) {
        word();
        await wave(step);
      } else if (r < 0.68) {
        await heart(step);
      } else if (r < 0.84) {
        setPose({ eyes: 'happy' });
        face.value = withSequence(withTiming(-face.value, { duration: 160 }), withTiming(face.value, { duration: 160 }));
        lift.value = withSequence(withTiming(14, { duration: 160 }), withTiming(0, { duration: 160 }));
        word();
        await step(700);
      } else {
        setPose({ eyes: 'wide', mouth: 'o' });
        await step(450);
        setPose({ eyes: 'happy', mouth: 'smile' });
        word();
        await step(800);
      }
    }, true);
  };

  /* ---------------- carried: picked up and let go, it makes its own way to the nearest good place */

  const drag = React.useRef<{ x: number; y: number; flap: ReturnType<typeof setInterval> | null } | null>(null);
  const flapStart = () => {
    let i = 0;
    return setInterval(() => {
      i++;
      // Sprout beats its leaves like wings; Pip holds its umbrella's handle up
      if (kind === 'sprout') setPose({ l: i % 2 ? 'up' : 'swing', r: i % 2 ? 'swing' : 'up' });
    }, 90);
  };
  const onLift = () => {
    if (away.current) return;
    token.current++;
    busy.current = true;
    hush();
    setFxState({ ...NO_FX, umbrella: kind === 'pip' });
    cancelAnimation(x); cancelAnimation(y); cancelAnimation(lift);
    lift.value = 0;
    setPose({ ...REST, eyes: 'wide', mouth: 'o', feet: 'tuck', l: kind === 'pip' ? 'up' : 'out', r: kind === 'pip' ? 'rest' : 'out' });
    drag.current = { x: x.value, y: y.value, flap: flapStart() };
  };
  const onCarry = (dx: number, dy: number) => {
    const d = drag.current;
    if (!d) return;
    const sy = scroll ? scroll.value : 0;
    x.value = Math.max(SW / 2, Math.min(W - SW / 2, d.x + dx));
    y.value = Math.max(insets.top + SH + sy, Math.min(H - 8 + sy, d.y + dy));
    tilt.value = Math.max(-14, Math.min(14, dx * 0.04));
  };
  const onDrop = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    const r = roomRef.current;
    const my = ++token.current;
    busy.current = true;
    const step: Step = (ms) => new Promise<void>((res, rej) => setTimeout(() => (alive.current && token.current === my ? res() : rej(CANCEL)), ms));
    const flight = async () => {
      if (!r || r.right - r.left < SW * 0.8) {
        if (d.flap) clearInterval(d.flap);
        setFx({ umbrella: false });
        await exitBy(nearWall(x.value), step);
        return;
      }
      // the nearest place along the room's row
      const lo = r.left + SW / 2;
      const hi = Math.max(lo, r.right - SW / 2);
      const tx = Math.max(lo, Math.min(hi, x.value));
      placed.current.set(useRoom.getState().key ?? '', hi > lo ? (tx - lo) / (hi - lo) : 1);
      const dist = Math.hypot(tx - x.value, r.y - y.value);
      if (kind === 'sprout') {
        // it flies: a gentle rise and glide, leaves beating, then a soft landing
        setPose({ eyes: 'happy', mouth: 'smile' });
        const ms = Math.max(450, Math.min(1300, dist * 1.8));
        face.value = tx > x.value ? 1 : -1;
        x.value = withTiming(tx, { duration: ms, easing: Easing.inOut(Easing.quad) });
        y.value = withTiming(r.y, { duration: ms, easing: Easing.inOut(Easing.quad) });
        lift.value = withSequence(withTiming(10, { duration: ms * 0.4, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: ms * 0.6, easing: Easing.in(Easing.quad) }));
        tilt.value = withTiming(tx > x.value ? 8 : -8, { duration: 200 });
        await step(ms);
      } else {
        // Pip floats down under its umbrella, swaying
        setPose({ eyes: 'happy', mouth: 'smile', l: 'up' });
        const ms = Math.max(700, Math.min(1700, dist * 2.4));
        x.value = withTiming(tx, { duration: ms, easing: Easing.out(Easing.sin) });
        y.value = withTiming(r.y, { duration: ms, easing: Easing.out(Easing.quad) });
        tilt.value = withRepeat(withSequence(withTiming(7, { duration: 300, easing: Easing.inOut(Easing.sin) }), withTiming(-7, { duration: 300, easing: Easing.inOut(Easing.sin) })), Math.max(1, Math.round(ms / 600)), false);
        await step(ms);
      }
      if (d.flap) clearInterval(d.flap);
      setFx({ umbrella: false });
      tilt.value = withTiming(0, { duration: 160 });
      setPose({ ...REST, eyes: 'happy', mouth: 'smile', feet: 'stand' });
      sq.value = withSequence(withTiming(0.86, { duration: 90 }), withTiming(1, { duration: 160 }));
      face.value = withTiming(-1, { duration: 160 });
      await step(500);
    };
    flight().catch(() => { if (d.flap) clearInterval(d.flap); }).finally(() => {
      if (token.current !== my || !alive.current) return;
      busy.current = false;
      settle();
    });
  };

  const gesture = React.useMemo(() => Gesture.Race(
    Gesture.Pan().minDistance(8).runOnJS(true)
      .onStart(onLift).onUpdate((e) => onCarry(e.translationX, e.translationY)).onEnd(onDrop).onFinalize(onDrop),
    Gesture.LongPress().minDuration(520).runOnJS(true).onStart(() => sendOff()),
    Gesture.Tap().maxDuration(450).runOnJS(true).onEnd((_e, ok) => { if (ok) onTap(); }),
  ), [W, H, rail, scroll]);

  /* ---------------- styles on the UI thread */

  const topLimit = insets.top;
  const anchor = useAnimatedStyle(() => {
    const sy = scroll ? scroll.value : 0;
    const feet = y.value - sy;
    // scrolling away with its row (Today's), it fades as it reaches the top of the screen
    const fade = scroll ? Math.max(0, Math.min(1, (feet - SH * 0.5 - topLimit) / (SH * 0.6))) : 1;
    return {
      opacity: shown.value * fade,
      transform: [{ translateX: x.value - SW / 2 }, { translateY: feet - SH - lift.value }] as const,
    };
  }, [scroll, topLimit]);
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

  /*
   * ---------------- the bubble's place: beside it, on its own row (to its left, toward the title, or to its right when
   * it stands near the left), so a word never covers the page's heading or its first card
   */

  const bubbleAt = (b: Bubble) => {
    if (!b.size) return null;
    const { w, h } = b.size;
    const sy = scroll ? scroll.value : 0;
    const mx = x.value;
    const mid = y.value - sy - SH / 2;
    const top = Math.max(insets.top + 2, mid - h / 2);
    const tailAt = Math.max(8, Math.min(h - 8, mid - top));
    const leftOf = mx - SW / 2 - 9 - w;
    if (leftOf >= 8) return { left: leftOf, top, side: 'right' as const, tailAt };
    return { left: Math.min(W - w - 8, mx + SW / 2 + 9), top, side: 'left' as const, tailAt };
  };
  const place = bubble ? bubbleAt(bubble) : null;

  const flier = gear.find((g) => FLIERS.includes(g));
  const hasBalloon = kind === 'pip' && gear.includes('balloon');

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {door ? <WallDoor side={door.side} wall={wallX(door.side)} y={door.y - (scroll ? scroll.value : 0)} open={doorOpen} /> : null}
      <Animated.View pointerEvents="box-none" style={[st.anchor, anchor]}>
        <Effects fx={fx} />
        {hasBalloon ? <Balloon pal={pal} rise={bud / 3} /> : null}
        <GestureDetector gesture={gesture}>
          <Animated.View
            style={body} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessible accessibilityRole="button" accessibilityLabel={name + ', your companion'}
            accessibilityHint="Tap to say hi. Drag to move it. Hold to send it off; knock on its door to bring it back"
            accessibilityActions={[{ name: 'activate' }, { name: 'longpress' }]}
            onAccessibilityAction={(e) => (e.nativeEvent.actionName === 'longpress' ? sendOff() : onTap())}
          >
            <Sprite kind={kind} pose={pose} gear={gear} bud={bud} pal={pal} />
          </Animated.View>
        </GestureDetector>
        {flier === 'ladybug' ? <Ladybug resting={focusing} full={full} /> : null}
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
              <View pointerEvents="none" style={[st.tail, place.side === 'right' ? { right: -4 } : { left: -4 }, { top: place.tailAt - 5 }]} />
              <Pressable onPress={hush} accessibilityRole="text" accessibilityLabel={name + ' says: ' + bubble.text} style={st.bubble}>
                <Text style={st.bubbleText}>{bubble.text}</Text>
              </Pressable>
            </Animated.View>
          ) : (
            <View style={st.bubble}><Text style={st.bubbleText}>{bubble.text}</Text></View>
          )}
        </View>
      ) : null}
      {out ? <KnockDoor name={name} bottom={rail ? 24 : 64 + Math.max(insets.bottom, 10)} /> : null}
    </View>
  );
}

/* ---------------------------------------------------------------- the door in the wall */

/**
 * A door in the left or right wall (the screen's edge), seen from inside the room: shut, it lies flat in the wall, so
 * nothing shows; opening, it swings out on its hinge at the wall toward the room, and warm light spills from the
 * doorway behind it. Drawn as a real panel turned in 3D about its hinge.
 */
function WallDoor({ side, wall, y, open }: { side: Side; wall: number; y: number; open: { value: number } }) {
  const DW = 22;
  const DH = SH + 8;
  const right = side === 'right';
  const panel = useAnimatedStyle(() => {
    const p = open.value;
    // 88 degrees: edge-on in the wall; 28: swung most of the way open into the room
    const ang = 88 - 60 * p;
    return {
      opacity: Math.min(1, p * 3),
      transform: [{ perspective: 260 }, { rotateY: (right ? -ang : ang) + 'deg' }] as const,
    };
  });
  const glow = useAnimatedStyle(() => ({ opacity: open.value * 0.9 }));
  return (
    <View pointerEvents="none" style={[st.doorBox, { top: y - DH, height: DH, width: DW * 2, left: right ? wall - DW * 2 : wall }]}>
      <Animated.View style={[StyleSheet.absoluteFill, glow]}>
        <LinearGradient
          colors={['rgba(255,214,150,0.55)', 'rgba(255,214,150,0)']}
          start={{ x: right ? 1 : 0, y: 0.5 }} end={{ x: right ? 0 : 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
        {/* the doorway, a dark slot in the wall */}
        <View style={[st.doorway, right ? { right: 0 } : { left: 0 }]} />
      </Animated.View>
      <Animated.View style={[st.doorPanel, { width: DW, height: DH, transformOrigin: right ? 'right' : 'left' } as any, right ? { right: 0 } : { left: 0 }, panel]}>
        <View style={[st.doorInset, { top: 4 }]} />
        <View style={[st.doorInset, { bottom: 4, top: DH * 0.52 }]} />
        <View style={[st.doorKnob, right ? { left: 3 } : { right: 3 }]} />
      </Animated.View>
    </View>
  );
}

/**
 * While the companion is sent off: its door, very small, flush with the right wall near the bottom. A tap knocks: the
 * door shivers twice with a soft knock and a doorbell, and the companion comes back.
 */
function KnockDoor({ name, bottom }: { name: string; bottom: number }) {
  const wob = useSharedValue(0);
  const [knocked, setKnocked] = React.useState(false);
  const onKnock = () => {
    if (knocked) return;
    setKnocked(true);
    knock();
    wob.value = withSequence(
      withTiming(1, { duration: 60 }), withTiming(0, { duration: 90 }), withDelay(60, withTiming(1, { duration: 60 })), withTiming(0, { duration: 120 }),
    );
    setTimeout(() => {
      const st = useStore.getState();
      st.setSetting('mascotOut', false);
      st.setSetting('mascotHideUntil', 0);
    }, 700);
  };
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: -2 * wob.value }, { rotate: -3 * wob.value + 'deg' }] as const }));
  return (
    <Animated.View entering={FadeIn.duration(400)} exiting={FadeOut.duration(200)} style={[st.knockWrap, { bottom: bottom + 92 }]}>
      <Pressable
        onPress={onKnock} hitSlop={12} accessibilityRole="button" accessibilityLabel={'Knock: bring ' + name + ' back'}
        style={({ pressed }) => [pressed && { opacity: 0.75 }]}
      >
        <Animated.View style={[st.knock, style]}>
          <View style={st.knockInset} />
          <View style={st.knockKnob} />
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

/* ---------------------------------------------------------------- the little things around it */

/** thought dots and a bulb, z's, music notes, a raincloud, a heart, sparks: drawn over its head */
function Effects({ fx }: { fx: Fx }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {[0, 1, 2].map((i) => (fx.dots > i ? (
        <Animated.View key={i} entering={FadeIn.duration(160)} exiting={FadeOut.duration(140)}
          style={[st.dot, { width: 3 + i * 1.5, height: 3 + i * 1.5, left: -6 - i * 6, top: 4 - i * 7 }]} />
      ) : null))}
      {fx.bulb ? (
        <Animated.View entering={FadeIn.duration(140)} exiting={FadeOut.duration(200)} style={{ position: 'absolute', left: -16, top: -14 }}>
          <GridArt grid={PROPS.bulb.grid} pal={PROPS.bulb.pal} px={2.5} />
        </Animated.View>
      ) : null}
      {fx.notes ? <Rising grid={PROPS.note.grid} pal={PROPS.note.pal} left={-10} top={4} every={900} /> : null}
      {fx.cloud ? <Cloud /> : null}
      {fx.umbrella ? <Umbrella /> : null}
      {fx.heart ? <Rising key={fx.heart} grid={PROPS.heart.grid} pal={PROPS.heart.pal} left={-12} top={0} every={1600} once /> : null}
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
    transform: [{ translateY: -14 * t.value }, { translateX: -4 * Math.sin(t.value * 6) }] as const,
  }));
  return (
    <Animated.View style={[{ position: 'absolute', left, top }, style]}>
      <GridArt grid={grid} pal={pal} px={2} />
    </Animated.View>
  );
}

/** Pip's umbrella, popped out of nowhere: it opens above Pip's raised hand, and folds away on landing */
function Umbrella() {
  const pal = useStore((s) => colorSet('pip', s.settings.mascotLooks.pip.colors).pal);
  return (
    <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(180)} style={{ position: 'absolute', left: SW / 2 - 9 * 1.25 - PX * 3, top: -8 * 2.5 + PX * 4 }}>
      <GridArt grid={PROPS.umbrella.grid} pal={{ ...PROPS.umbrella.pal, a: pal.a, A: pal.A }} px={2.5} />
    </Animated.View>
  );
}

function Cloud() {
  const d = useSharedValue(0);
  React.useEffect(() => { d.value = withRepeat(withTiming(1, { duration: 520, easing: Easing.in(Easing.quad) }), -1, false); return () => cancelAnimation(d); }, []);
  const drops = useAnimatedStyle(() => ({ transform: [{ translateY: 10 * d.value }] as const, opacity: 1 - d.value * 0.7 }));
  return (
    <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(260)} style={{ position: 'absolute', left: SW / 2 - 9, top: -14 }}>
      <GridArt grid={PROPS.cloud.grid} pal={PROPS.cloud.pal} px={2.5} />
      <Animated.View style={[{ position: 'absolute', top: 10, left: 1, flexDirection: 'row', gap: 4 }, drops]}>
        {[0, 1, 2].map((i) => <View key={i} style={{ marginTop: i % 2 ? 3 : 0 }}><GridArt grid={PROPS.drop.grid} pal={PROPS.drop.pal} px={1.5} /></View>)}
      </Animated.View>
    </Animated.View>
  );
}

/**
 * Dot the ladybug: flits about Sprout in little curves and, every so often, lands on top of its head with its wings
 * folded, then takes off again. During Deep Work (or a nap) it stays landed.
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
        bx.value = withTiming(SW / 2 - 4, { duration: 900, easing: Easing.inOut(Easing.quad) });
        by.value = withTiming(SH * 0.42, { duration: 900, easing: Easing.inOut(Easing.quad) });
        t = setTimeout(() => { if (!live) return; setLanded(true); t = setTimeout(() => { if (live) { setLanded(false); fly(Math.round(rnd(4, 9))); } }, rnd(6000, 16000)); }, 950);
        return;
      }
      const ms = rnd(900, 1500);
      // it keeps below the header's top and in front of its companion's face, never over the buttons
      bx.value = withTiming(rnd(-SW * 0.5, SW * 0.4), { duration: ms, easing: Easing.inOut(Easing.sin) });
      by.value = withTiming(rnd(SH * 0.05, SH * 0.6), { duration: ms, easing: Easing.inOut(Easing.sin) });
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
      <GridArt grid={PROPS.ladybug.grid} pal={PROPS.ladybug.pal} px={1.75} />
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
  const fx = useSharedValue(-10);
  const fy = useSharedValue(SH * 0.3);
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
      fx.value = withTiming(rnd(-SW * 0.8, SW * 0.2), { duration: ms, easing: Easing.inOut(Easing.sin) });
      fy.value = withTiming(rnd(0, SH * 0.8), { duration: ms, easing: Easing.inOut(Easing.sin) });
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
  const len = 8 + Math.round(rise * 8);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: -2 * bob.value }, { rotate: (bob.value - 0.5) * 9 + 'deg' }] as const }));
  return (
    // on Pip's left (it lives at the right end of the header, by the buttons), clear of them
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: -6, top: 11 * PX - len - 15, width: 13, height: len + 15, alignItems: 'center', transformOrigin: 'bottom' } as any, style]}>
      <GridArt grid={PROPS.balloon.grid} pal={{ a: pal.a, A: pal.A, h: '#FFFFFF' }} px={2.5} />
      <View style={{ width: 1, height: len, backgroundColor: 'rgba(120,110,100,0.7)' }} />
    </Animated.View>
  );
}

const INK = '#3D2F28';
const PAPER = '#FFF8EE';
const WOOD = '#B9814F';
const st = StyleSheet.create({
  anchor: { position: 'absolute', left: 0, top: 0, width: SW, height: SH },
  bubbleWrap: { position: 'absolute', maxWidth: 210 },
  bubble: {
    backgroundColor: PAPER, borderRadius: 13, paddingHorizontal: 11, paddingVertical: 7,
    shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4,
  },
  bubbleText: { color: INK, fontFamily: CUTE, fontSize: 12.5, lineHeight: 17 },
  tail: { position: 'absolute', width: 10, height: 10, backgroundColor: PAPER, transform: [{ rotate: '45deg' }], borderRadius: 2 },
  dot: { position: 'absolute', borderRadius: 1, backgroundColor: '#FFF8EE', opacity: 0.9 },
  flier: { position: 'absolute', left: 0, top: 0 },
  wings: { position: 'absolute', left: 1, top: -3, width: 6, height: 3, borderRadius: 3, backgroundColor: '#FFFFFF' },
  halo: { position: 'absolute', left: -5, top: -5, width: 13, height: 13, borderRadius: 7, backgroundColor: '#FFE68A' },
  firefly: { width: 3.5, height: 3.5, backgroundColor: '#FFF2B0' },
  doorBox: { position: 'absolute', overflow: 'visible' },
  doorway: { position: 'absolute', top: 0, bottom: 0, width: 3, backgroundColor: '#2B211C', borderRadius: 1 },
  doorPanel: { position: 'absolute', top: 0, backgroundColor: WOOD, borderRadius: 3, borderWidth: 1, borderColor: '#8E5E36' },
  doorInset: { position: 'absolute', left: 4, right: 4, height: '38%', borderRadius: 2, borderWidth: 1, borderColor: 'rgba(80,48,24,0.45)' },
  doorKnob: { position: 'absolute', top: '52%', width: 3.5, height: 3.5, borderRadius: 2, backgroundColor: '#FFD27A' },
  knockWrap: { position: 'absolute', right: 0 },
  knock: {
    width: 13, height: 21, backgroundColor: WOOD, borderTopLeftRadius: 4, borderBottomLeftRadius: 2,
    borderWidth: 1, borderRightWidth: 0, borderColor: '#8E5E36',
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 3, shadowOffset: { width: -1, height: 1 }, elevation: 3,
  },
  knockInset: { position: 'absolute', left: 2.5, right: 2, top: 3, height: 6, borderRadius: 1.5, borderWidth: 1, borderColor: 'rgba(80,48,24,0.45)' },
  knockKnob: { position: 'absolute', left: 2.5, top: 11, width: 2.5, height: 2.5, borderRadius: 1.5, backgroundColor: '#FFD27A' },
});

