import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { runOnJS, runOnUI, useAnimatedProps, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import Svg, { Line, Path } from 'react-native-svg';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { C, MIN, S, T, liteSh, neuInset } from '../theme';
import { useTheme } from './UI';

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** One recorded point: x and y in the pad's unit, t in ms from the recording's first touch. */
export type PadPoint = [number, number, number];
export interface PadStroke { pts: PadPoint[] }

/** the pen's line on the pad, px */
const INK_W = 2.6;
/** a sample closer than this to the last one kept (px) adds nothing a hand can see, so it is left out */
const MIN_STEP = 0.75;
/** a stroke added to a recording that was set down earlier starts this long after its last point, ms */
const RESUME_GAP = 250;
const GUIDE = liteSh(0.13);
const GUIDE_SIDE = 14;

/**
 * A smooth line through pad points (px, as x, y pairs): quadratic curves through the midpoints, the way a pen line
 * reads. One point is a dot. Runs on the UI thread for the live stroke and in JS for the strokes already down.
 */
export function inkPath(p: readonly number[]): string {
  'worklet';
  const n = Math.floor(p.length / 2);
  if (n === 0) return '';
  const f = (v: number) => v.toFixed(1);
  if (n === 1) return 'M' + f(p[0]) + ' ' + f(p[1]) + 'L' + f(p[0] + 0.1) + ' ' + f(p[1]);
  let d = 'M' + f(p[0]) + ' ' + f(p[1]);
  for (let i = 1; i < n - 1; i++) {
    const x = p[i * 2];
    const y = p[i * 2 + 1];
    d += 'Q' + f(x) + ' ' + f(y) + ' ' + f((x + p[i * 2 + 2]) / 2) + ' ' + f((y + p[i * 2 + 3]) / 2);
  }
  return d + 'L' + f(p[n * 2 - 2]) + ' ' + f(p[n * 2 - 1]);
}

const round4 = (v: number) => Math.round(v * 10000) / 10000;

export interface SignaturePadProps {
  width: number;
  height: number;
  /** px per recorded unit, and where the unit's origin sits in the pad (px): the pad's width for a signature, the
   * distance between the guide lines for a digit */
  unit: number;
  originX?: number;
  originY?: number;
  /** the strokes recorded so far, in the pad's unit; with none, the next touch starts a new recording at 0 ms */
  strokes: readonly PadStroke[];
  /** a finished stroke, called once per touch, never per move */
  onStroke: (stroke: PadStroke) => void;
  /** faint guide lines, px from the top; dashed ones are drawn lighter (a cap line) */
  guides?: number[];
  dashed?: number[];
  /** the most points the recording keeps; the pen stops adding once it is reached */
  maxPoints?: number;
  /** a word or two in the empty pad */
  hint?: string;
  accessibilityLabel?: string;
}

/**
 * A carved well to write in. One finger draws (a second one is ignored), a tap leaves a dot, and the page around it
 * never scrolls while a stroke is down: the stroke's own gesture holds the touch from the moment it lands.
 *
 * The stroke in progress lives on the UI thread and is drawn there, so the page (and the pad) never re-render while a
 * finger moves. A finished stroke goes to `onStroke` once; when it comes back in `strokes`, it is drawn with the rest
 * and the live line it was drawn on lets go.
 */
export const SignaturePad = React.memo(function SignaturePad({
  width, height, unit, originX = 0, originY = 0, strokes, onStroke, guides = [], dashed = [], maxPoints = 2000, hint,
  accessibilityLabel,
}: SignaturePadProps) {
  const theme = useTheme();
  /** the live stroke, pad px as x, y pairs */
  const live = useSharedValue<number[]>([]);
  /** strokes already finished but not yet back in `strokes` (a quick hand starts the next one first), by id */
  const held = useSharedValue<{ id: number; p: number[] }[]>([]);
  /** the live stroke, recorded: x, y in the unit and t in ms, as triples */
  const rec = useSharedValue<number[]>([]);
  const liveId = useSharedValue(0);
  const pointer = useSharedValue(-1);
  /** Date.now() at the recording's first touch; -1 until there is one */
  const start = useSharedValue(-1);
  const used = useSharedValue(0);
  const onStrokeRef = useRef(onStroke);
  onStrokeRef.current = onStroke;
  const pendingClear = useRef(0);

  const total = strokes.reduce((n, s) => n + s.pts.length, 0);
  const last = strokes.length ? strokes[strokes.length - 1].pts : null;
  const resumeAt = last && last.length ? last[last.length - 1][2] : 0;
  useEffect(() => {
    used.value = total;
    // an empty pad is a new recording: its clock starts again at the next touch
    if (!strokes.length) start.value = -1;
    const id = pendingClear.current;
    pendingClear.current = 0;
    // the stroke just finished is drawn with the rest now, so the line it was drawn on goes (unless another stroke has
    // begun on it since); a cleared pad lets go of everything that was waiting
    if (id || !strokes.length) {
      runOnUI((cid: number) => {
        'worklet';
        held.value = cid ? held.value.filter((h) => h.id > cid) : [];
        if (pointer.value === -1 && (cid === 0 || liveId.value === cid)) live.value = [];
      })(id);
    }
  }, [strokes]);

  const commit = (flat: number[], id: number) => {
    const pts: PadPoint[] = [];
    for (let i = 0; i + 2 < flat.length; i += 3) pts.push([round4(flat[i]), round4(flat[i + 1]), Math.max(0, Math.round(flat[i + 2]))]);
    pendingClear.current = id;
    if (pts.length) onStrokeRef.current({ pts });
  };

  const gesture = useMemo(() => Gesture.Manual()
    .onTouchesDown((e, manager) => {
      'worklet';
      // a second finger is ignored: the first one holds the pen until it lifts
      if (pointer.value !== -1) return;
      const t = e.changedTouches[0];
      if (!t) return;
      pointer.value = t.id;
      manager.activate();
      const now = Date.now();
      if (start.value < 0) start.value = now - (resumeAt > 0 ? resumeAt + RESUME_GAP : 0);
      // the last stroke may not be back as ink yet: it stays drawn until it is
      const prev = live.value;
      const prevId = liveId.value;
      if (prev.length) held.modify((v) => { 'worklet'; v.push({ id: prevId, p: prev }); return v; });
      liveId.value = prevId + 1;
      live.value = [t.x, t.y];
      rec.value = [(t.x - originX) / unit, (t.y - originY) / unit, now - start.value];
      used.value = used.value + 1;
    })
    .onTouchesMove((e) => {
      'worklet';
      if (pointer.value === -1 || used.value >= maxPoints) return;
      let x = NaN;
      let y = NaN;
      for (const c of e.allTouches) {
        if (c.id === pointer.value) { x = c.x; y = c.y; }
      }
      if (x !== x) return;
      const p = live.value;
      if (Math.hypot(x - p[p.length - 2], y - p[p.length - 1]) < MIN_STEP) return;
      const t = Date.now() - start.value;
      live.modify((v) => { 'worklet'; v.push(x, y); return v; });
      rec.modify((v) => { 'worklet'; v.push((x - originX) / unit, (y - originY) / unit, t); return v; });
      used.value = used.value + 1;
    })
    .onTouchesUp((e, manager) => {
      'worklet';
      let mine = false;
      for (const c of e.changedTouches) {
        if (c.id === pointer.value) mine = true;
      }
      if (!mine) return;
      pointer.value = -1;
      runOnJS(commit)(rec.value, liveId.value);
      manager.end();
    })
    .onTouchesCancelled((_e, manager) => {
      'worklet';
      if (pointer.value === -1) return;
      pointer.value = -1;
      runOnJS(commit)(rec.value, liveId.value);
      manager.end();
    })
    .onFinalize(() => {
      'worklet';
      // the system took the touch away mid-stroke: what was drawn is kept
      if (pointer.value === -1) return;
      pointer.value = -1;
      runOnJS(commit)(rec.value, liveId.value);
    }), [unit, originX, originY, maxPoints, resumeAt]);

  const liveProps = useAnimatedProps(() => ({ d: inkPath(live.value) }));
  const heldProps = useAnimatedProps(() => ({ d: held.value.map((h) => inkPath(h.p)).join('') }));
  const hintStyle = useAnimatedStyle(() => ({ opacity: live.value.length || held.value.length ? 0 : 1 }));
  const paths = useMemo(() => strokes.map((s) => {
    const px: number[] = [];
    for (const [x, y] of s.pts) px.push(x * unit + originX, y * unit + originY);
    return inkPath(px);
  }), [strokes, unit, originX, originY]);

  return (
    <View
      style={[
        st.well, { width, height },
        theme === 'minimal'
          ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border }
          : { backgroundColor: C.inset, ...neuInset('mid') },
      ]}
      accessible
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="Write with one finger"
    >
      <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
        {guides.map((y, i) => (
          <Line key={'g' + i} x1={GUIDE_SIDE} x2={width - GUIDE_SIDE} y1={y} y2={y} stroke={GUIDE} strokeWidth={1} />
        ))}
        {dashed.map((y, i) => (
          <Line
            key={'d' + i} x1={GUIDE_SIDE} x2={width - GUIDE_SIDE} y1={y} y2={y} stroke={GUIDE} strokeWidth={1}
            strokeDasharray={[4, 5]}
          />
        ))}
        {paths.map((d, i) => (
          <Path key={i} d={d} fill="none" stroke={C.text} strokeWidth={INK_W} strokeLinecap="round" strokeLinejoin="round" />
        ))}
        <AnimatedPath
          animatedProps={heldProps} fill="none" stroke={C.text} strokeWidth={INK_W} strokeLinecap="round" strokeLinejoin="round"
        />
        <AnimatedPath
          animatedProps={liveProps} fill="none" stroke={C.text} strokeWidth={INK_W} strokeLinecap="round" strokeLinejoin="round"
        />
      </Svg>
      {hint && !strokes.length ? (
        <Animated.View pointerEvents="none" style={[st.hintBox, hintStyle]}>
          <Text style={st.hint}>{hint}</Text>
        </Animated.View>
      ) : null}
      <GestureDetector gesture={gesture}>
        <View style={StyleSheet.absoluteFill} collapsable={false} />
      </GestureDetector>
    </View>
  );
});

const st = StyleSheet.create({
  // the ink stays inside the well, as anything raised or drawn inside a carve does
  well: { borderRadius: S.radiusSm, overflow: 'hidden' },
  hintBox: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  hint: { ...T.caption, color: C.textFaint },
});
