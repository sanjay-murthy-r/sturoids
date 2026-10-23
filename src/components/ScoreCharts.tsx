import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import { useIsFocused } from '@react-navigation/native';
import { TAG_COLORS } from '../scores';
import { C, F, MIN, NEU, TRACK, DEFAULT_ACCENT } from '../theme';
import { useTheme } from './UI';
import { EASE_OUT, useAnimLevel, useTabReturns } from './Motion';
import { useIntro } from '../intro';
import { chartScale, runsOf } from '../analytics';
import { tick } from '../haptics';

// The Analytics page's charts. Every chart is drawn to one scale with its labels inside its own box, fills are
// explicit, and nothing strokes itself on: a chart arrives with its section, and later changes glide or fade.

/** a selection moving between points */
const QUICK = { duration: 180, easing: EASE_OUT };

/**
 * How many times the page has come into view: 0 until it is really in view (focused, and past the intro), 1 from then,
 * and one more each time its tab is opened again from the bar. A bar that fills "on view" fills where someone sees it
 * (the rule every entrance follows), and fills again on every return, exactly as the first time: a chart restarts
 * when its round changes, never while the page is merely covered by another page above it.
 */
export function useSeen(): number {
  const level = useAnimLevel();
  const focused = useIsFocused();
  const introOver = useIntro((s) => s.phase !== 'playing');
  const returns = useTabReturns();
  const [seen, setSeen] = React.useState(level === 'none');
  React.useEffect(() => {
    if (!seen && (level === 'none' || (focused && introOver))) setSeen(true);
  }, [focused, introOver, level, seen]);
  return seen ? 1 + returns : 0;
}

/* ---------------------------------------------------------------- colour */

function rgbOf(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex) || /^#?([0-9a-f]{6})$/i.exec(DEFAULT_ACCENT);
  const n = parseInt((m as RegExpExecArray)[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const luminance = ([r, g, b]: [number, number, number]) => {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
};

const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** A colour laid over the card at a strength, as a hex with alpha. */
export const tint = (hex: string, alpha: number) =>
  '#' + rgbOf(hex).map((v) => v.toString(16).padStart(2, '0')).join('') + Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0');

/**
 * A series' colour: the tag pastels in order, and past eight each lap of them a step lighter, so no two subjects ever
 * share a line colour exactly.
 */
export function seriesColor(i: number): string {
  const base = TAG_COLORS[i % TAG_COLORS.length];
  const lap = Math.floor(i / TAG_COLORS.length);
  if (!lap) return base;
  const t = Math.min(0.75, lap * 0.3);
  return '#' + rgbOf(base).map((v) => Math.round(v + (255 - v) * t).toString(16).padStart(2, '0')).join('');
}

/** Whichever of the light and the dark text reads better on a colour laid over the card at a strength. */
export function readableOn(hex: string, alpha: number): string {
  const fg = rgbOf(hex);
  const bg = rgbOf(C.card);
  const mixed = fg.map((v, i) => v * alpha + bg[i] * (1 - alpha)) as [number, number, number];
  const l = luminance(mixed);
  return contrast(l, luminance(rgbOf(C.text))) >= contrast(l, luminance(rgbOf(C.onAccent))) ? C.text : C.onAccent;
}

/** A heatmap cell's strength: faint for a low result, rising with it (a curve, so the usual 40 to 95 spreads out). */
export const heatAlpha = (pct: number) => 0.1 + 0.62 * Math.pow(Math.max(0, Math.min(100, pct)) / 100, 1.4);

/* ---------------------------------------------------------------- bars */

/**
 * A carved track whose accent fill grows from the left: from nothing each time the page comes into view (`play`, and
 * `round` for each return to it), gliding to its new length after that. Only full motion grows it; with some it is simply
 * at its length and eases to a new one, and with none it changes at once. The fill is a full-length pill slid by a
 * transform, so no layout pass runs per frame.
 */
export function GrowBar({ value, color, height = 6, play = true, round = 0, delay = 0 }: {
  /** 0 to 1 */
  value: number; color?: string; height?: number;
  /** false holds it empty until the page is in view */
  play?: boolean;
  /** the page's round (see useSeen): a new one grows the bar again from nothing */
  round?: number;
  /** ms before each fill, to follow its section's entrance */
  delay?: number;
}) {
  const theme = useTheme();
  const level = useAnimLevel();
  const v = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const shown = useSharedValue(level === 'full' ? 0 : v);
  const trackW = useSharedValue(0);
  const first = React.useRef(true);
  const seenRound = React.useRef(round);
  React.useEffect(() => {
    if (!play) return;
    const again = seenRound.current !== round;
    seenRound.current = round;
    if (level !== 'full') {
      shown.value = level === 'none' ? v : withTiming(v, { duration: 200, easing: EASE_OUT });
      first.current = false;
      return;
    }
    // back on the tab: it starts from nothing again, while the section is still hidden at the screen's focus moment
    if (again && !first.current) shown.value = 0;
    const ease = { duration: 420, easing: EASE_OUT };
    shown.value = first.current || again ? withDelay(delay, withTiming(v, ease)) : withTiming(v, ease);
    first.current = false;
  }, [v, play, level, round]);
  const fill = useAnimatedStyle(() => ({
    opacity: trackW.value > 0 ? 1 : 0,
    transform: [{ translateX: (shown.value - 1) * trackW.value }],
  }));
  return (
    <View
      onLayout={(e) => { trackW.value = e.nativeEvent.layout.width; }}
      style={[
        { height, borderRadius: height / 2, overflow: 'hidden' },
        theme === 'minimal' ? { backgroundColor: MIN.inset } : { backgroundColor: C.inset, ...NEU.insetHairline },
      ]}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: height / 2, backgroundColor: color || C.accent }, fill]} />
    </View>
  );
}

/**
 * Shares of one whole, side by side in one carved track, each in its own colour with a sliver of the track between
 * them. The whole row slides in from the left each time the page comes into view (`round` counts the returns to it);
 * with some motion it is simply there, and with none too.
 */
export function ShareBar({ parts, height = 12, play = true, round = 0, delay = 0 }: {
  parts: { key: string; color: string; share: number }[]; height?: number; play?: boolean; round?: number; delay?: number;
}) {
  const theme = useTheme();
  const level = useAnimLevel();
  const shown = useSharedValue(level === 'full' ? 0 : 1);
  const trackW = useSharedValue(0);
  const seenRound = React.useRef(round);
  React.useEffect(() => {
    if (!play) return;
    const again = seenRound.current !== round;
    seenRound.current = round;
    if (level !== 'full') {
      shown.value = 1;
      return;
    }
    // back on the tab: it starts from nothing again, while the section is still hidden at the screen's focus moment
    if (again) shown.value = 0;
    shown.value = withDelay(delay, withTiming(1, { duration: 480, easing: EASE_OUT }));
  }, [play, level, round]);
  const slide = useAnimatedStyle(() => ({
    opacity: trackW.value > 0 ? 1 : 0,
    transform: [{ translateX: (shown.value - 1) * trackW.value }],
  }));
  const kept = parts.filter((p) => p.share > 0);
  return (
    <View
      onLayout={(e) => { trackW.value = e.nativeEvent.layout.width; }}
      style={[
        { height, borderRadius: height / 2, overflow: 'hidden' },
        theme === 'minimal' ? { backgroundColor: MIN.inset } : { backgroundColor: C.inset, ...NEU.insetHairline },
      ]}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { flexDirection: 'row' }, slide]}>
        {kept.map((p, i) => (
          <View key={p.key} style={{ flex: p.share, marginLeft: i ? 2 : 0, backgroundColor: p.color }} />
        ))}
      </Animated.View>
    </View>
  );
}

/* ---------------------------------------------------------------- line charts */

/** the y labels' column, and the room either side of the plot */
const AXIS_W = 30;
const TOP = 12;
const BOTTOM = 12;
const RIGHT = 12;
/** the selection ring's radius */
const RING = 8;

type Scale = ReturnType<typeof chartScale>;

function plot(w: number, height: number, n: number, scale: Scale, left: number) {
  const plotW = Math.max(1, w - left - RIGHT);
  const plotH = height - TOP - BOTTOM;
  const x = (i: number) => (n < 2 ? left + plotW / 2 : left + (i * plotW) / (n - 1));
  const y = (v: number) => TOP + ((scale.hi - v) / (scale.hi - scale.lo)) * plotH;
  return { plotW, plotH, x, y, left };
}

const pathOf = (vals: number[], start: number, x: (i: number) => number, y: (v: number) => number) =>
  vals.map((v, k) => (k ? 'L' : 'M') + x(start + k).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');

/** Round gridlines across the plot, with their values in the label column. */
function Grid({ scale, w, y }: { scale: Scale; w: number; y: (v: number) => number }) {
  const theme = useTheme();
  const stroke = theme === 'minimal' ? MIN.hairline : C.outline;
  return (
    <>
      {scale.ticks.map((t) => (
        <React.Fragment key={t}>
          <Line x1={AXIS_W + 6} x2={w} y1={y(t)} y2={y(t)} stroke={stroke} strokeWidth={1} />
          <SvgText x={AXIS_W} y={y(t) + 4} fill={C.textFaint} fontFamily={F.reg} fontSize={11} textAnchor="end">
            {t + '%'}
          </SvgText>
        </React.Fragment>
      ))}
    </>
  );
}

/** A soft refresh: when what a chart shows changes, it comes back up from faint instead of jumping. */
function useRefresh(sig: string) {
  const level = useAnimLevel();
  const fade = useSharedValue(1);
  const last = React.useRef(sig);
  React.useEffect(() => {
    if (last.current === sig) return;
    last.current = sig;
    if (level === 'none') return;
    fade.value = 0.2;
    fade.value = withTiming(1, { duration: level === 'full' ? 260 : 200, easing: EASE_OUT });
  }, [sig, level]);
  return useAnimatedStyle(() => ({ opacity: fade.value }));
}

/** Measures a chart's width once per layout, never per frame. */
function useWidth(): [number, (e: any) => void] {
  const [w, setW] = React.useState(0);
  const onLayout = React.useCallback((e: any) => {
    const next = Math.round(e.nativeEvent.layout.width);
    setW((cur) => (cur === next ? cur : next));
  }, []);
  return [w, onLayout];
}

export interface TrendPoint { id: string; pct: number }

/**
 * Results over time, oldest on the left: the accent line with a small dot per exam and a larger one for the latest,
 * the three-exam moving average as a faint dashed line, and the target as a dotted one. A tap picks the nearest exam:
 * a hairline drops through it and a ring settles on its point. Screen readers step through the exams by swiping, and
 * hear `valueText` (the exam picked) at each step.
 */
export function TrendChart({ points, moving, target, selected, onSelect, height = 180, accessibilityLabel, valueText }: {
  points: TrendPoint[];
  /** aligned with the points; null where there is no full window yet */
  moving?: (number | null)[];
  target?: number | null;
  /** the index picked, or null */
  selected: number | null;
  onSelect: (index: number | null) => void;
  height?: number;
  accessibilityLabel?: string;
  /** what is picked, said as the chart's value: the exam and its result, or that none is */
  valueText?: string;
}) {
  useTheme();
  const level = useAnimLevel();
  const [w, onLayout] = useWidth();
  const n = points.length;
  const left = AXIS_W + 6 + RING;
  const geo = React.useMemo(() => {
    const ys = points.map((p) => p.pct);
    const scale = chartScale(target != null ? [...ys, target] : ys);
    const g = plot(w, height, n, scale, left);
    const line = n > 1 ? pathOf(ys, 0, g.x, g.y) : '';
    const avg = runsOf(moving || []).filter((r) => r.values.length > 1).map((r) => pathOf(r.values, r.start, g.x, g.y)).join(' ');
    return { ...g, scale, line, avg };
  }, [points, moving, target, w, height, n, left]);

  const sel = selected != null && selected >= 0 && selected < n ? selected : null;
  const sx = useSharedValue(0);
  const sy = useSharedValue(0);
  const on = useSharedValue(0);
  const showing = React.useRef(false);
  React.useEffect(() => {
    if (!w) return;
    if (sel == null) {
      showing.current = false;
      on.value = level === 'none' ? 0 : withTiming(0, { duration: 140, easing: EASE_OUT });
      return;
    }
    const tx = geo.x(sel);
    const ty = geo.y(points[sel].pct);
    if (level === 'none' || !showing.current) {
      sx.value = tx;
      sy.value = ty;
    } else {
      sx.value = withTiming(tx, QUICK);
      sy.value = withTiming(ty, QUICK);
    }
    on.value = level === 'none' ? 1 : withTiming(1, QUICK);
    showing.current = true;
  }, [sel, geo, level]);
  const ringStyle = useAnimatedStyle(() => ({
    opacity: on.value,
    transform: [{ translateX: sx.value - RING }, { translateY: sy.value - RING }, { scale: 0.5 + 0.5 * on.value }] as const,
  }));
  const hairStyle = useAnimatedStyle(() => ({ opacity: on.value * 0.5, transform: [{ translateX: sx.value - 0.5 }] }));
  const refresh = useRefresh(points.map((p) => p.id).join(',') + '|' + (target ?? ''));

  const pick = (lx: number) => {
    if (!n || !w) return;
    const i = n < 2 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((lx - left) / geo.plotW) * (n - 1))));
    tick();
    onSelect(i === sel ? null : i);
  };
  const step = (d: 1 | -1) => {
    if (!n) return;
    onSelect(sel == null ? (d > 0 ? 0 : n - 1) : Math.max(0, Math.min(n - 1, sel + d)));
  };
  const dots = n <= 30;

  return (
    <View style={{ height }} onLayout={onLayout}>
      {w > 0 ? (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, refresh]}>
          <Animated.View style={[cs.hair, { top: TOP - 4, height: geo.plotH + 8, backgroundColor: C.textFaint }, hairStyle]} />
          <Svg width={w} height={height}>
            <Grid scale={geo.scale} w={w} y={geo.y} />
            {target != null ? (
              <Line
                x1={AXIS_W + 6} x2={w} y1={geo.y(target)} y2={geo.y(target)}
                stroke={C.textFaint} strokeOpacity={0.7} strokeWidth={1} strokeDasharray="2 4"
              />
            ) : null}
            {geo.avg ? (
              <Path d={geo.avg} fill="none" stroke={C.textDim} strokeOpacity={0.5} strokeWidth={1.5} strokeDasharray="6 4" />
            ) : null}
            {geo.line ? (
              <Path d={geo.line} fill="none" stroke={C.accent} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            ) : null}
            {dots ? points.map((p, i) => (i === n - 1 ? null : (
              <Circle key={p.id} cx={geo.x(i)} cy={geo.y(p.pct)} r={2.5} fill={C.accent} />
            ))) : null}
            {n ? <Circle cx={geo.x(n - 1)} cy={geo.y(points[n - 1].pct)} r={4} fill={C.accent} /> : null}
          </Svg>
          <Animated.View style={[cs.ring, { borderColor: C.accent }, ringStyle]} />
        </Animated.View>
      ) : null}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={(e) => pick(e.nativeEvent.locationX)}
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={valueText ? { text: valueText } : undefined}
        accessibilityHint="Swipe up or down to step through the exams"
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => step(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
      />
    </View>
  );
}

export interface SubjectSeries { key: string; name: string; color: string; values: (number | null)[] }

/** how far a subject's line fades while others are picked out */
const DIM = 0.16;

/**
 * Each subject's results as its own line in its own colour, broken where it was not sat. Picking subjects out (`focus`)
 * fades the rest back; each line is its own layer, so the fade is one opacity on the UI thread.
 */
export function SubjectTrendChart({ series, focus, height = 170, accessibilityLabel }: {
  series: SubjectSeries[]; focus: string[]; height?: number; accessibilityLabel?: string;
}) {
  useTheme();
  const [w, onLayout] = useWidth();
  const n = series.reduce((a, s) => Math.max(a, s.values.length), 0);
  const geo = React.useMemo(() => {
    const all: number[] = [];
    for (const s of series) for (const v of s.values) if (v != null && Number.isFinite(v)) all.push(v);
    const scale = chartScale(all);
    return { ...plot(w, height, n, scale, AXIS_W + 12), scale };
  }, [series, w, height, n]);
  const refresh = useRefresh(series.map((s) => s.key + ':' + s.values.length).join(','));
  // lines picked out are drawn last, so they sit on top of the faded ones
  const order = focus.length
    ? [...series.filter((s) => !focus.includes(s.key)), ...series.filter((s) => focus.includes(s.key))]
    : series;
  return (
    <View style={{ height }} onLayout={onLayout} accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
      {w > 0 ? (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, refresh]}>
          <Svg width={w} height={height} style={StyleSheet.absoluteFill}>
            <Grid scale={geo.scale} w={w} y={geo.y} />
          </Svg>
          {order.map((s) => (
            <SubjectLayer key={s.key} s={s} x={geo.x} y={geo.y} w={w} height={height} dim={focus.length > 0 && !focus.includes(s.key)} />
          ))}
        </Animated.View>
      ) : null}
    </View>
  );
}

function SubjectLayer({ s, x, y, w, height, dim }: {
  s: SubjectSeries; x: (i: number) => number; y: (v: number) => number; w: number; height: number; dim: boolean;
}) {
  const level = useAnimLevel();
  const o = useSharedValue(dim ? DIM : 1);
  React.useEffect(() => {
    o.value = level === 'none' ? (dim ? DIM : 1) : withTiming(dim ? DIM : 1, { duration: 200, easing: EASE_OUT });
  }, [dim, level]);
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  const runs = React.useMemo(() => runsOf(s.values), [s.values]);
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]}>
      <Svg width={w} height={height}>
        {runs.map((r) => (r.values.length > 1 ? (
          <Path
            key={r.start} d={pathOf(r.values, r.start, x, y)}
            fill="none" stroke={s.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
          />
        ) : null))}
        {/* past thirty exams the dots crowd into the line, and cost a node each */}
          {s.values.length <= 30 ? s.values.map((v, i) => (v == null ? null : <Circle key={i} cx={x(i)} cy={y(v)} r={2.5} fill={s.color} />)) : null}
      </Svg>
    </Animated.View>
  );
}

/** A chart's key: a short sample of each line and what it stands for. */
export function ChartKey({ items, style }: {
  items: { label: string; color: string; dash?: string; opacity?: number; width?: number }[]; style?: any;
}) {
  return (
    <View style={[cs.keyRow, style]}>
      {items.map((it) => (
        <View key={it.label} style={cs.keyItem}>
          <Svg width={18} height={6}>
            <Line
              x1={1} x2={17} y1={3} y2={3} stroke={it.color} strokeOpacity={it.opacity ?? 1} strokeWidth={it.width ?? 2}
              strokeDasharray={it.dash} strokeLinecap={it.dash ? 'butt' : 'round'}
            />
          </Svg>
          <Text style={[cs.keyText, { color: C.textFaint }]}>{it.label}</Text>
        </View>
      ))}
    </View>
  );
}

/* ---------------------------------------------------------------- heatmap */

const NAME_W = 92;
const CELL_H = 34;
const CELL_MIN = 42;
const CELL_MAX = 64;
const GAP = 4;
const HEAD_H = 20;

/**
 * Subjects down the side, exams across (oldest on the left), each cell the subject's result in that exam: the accent
 * laid over the card, stronger for a higher result, with the rounded figure inside. A subject not sat is a faint dash.
 * When the columns do not fit, they scroll sideways and open on the latest: a gesture-handler scroll, so a sideways drag
 * along it scrolls the cells and never reaches the tab bar's fling around the page.
 */
export function Heatmap({ rows, columns, accessibilityLabel }: {
  rows: { key: string; name: string; cells: (number | null)[] }[];
  columns: { id: string; label: string }[];
  accessibilityLabel?: string;
}) {
  useTheme();
  const [w, onLayout] = useWidth();
  const scroller = React.useRef<React.ElementRef<typeof ScrollView>>(null);
  const cols = columns.length;
  const avail = Math.max(0, w - NAME_W);
  const cellW = cols ? Math.max(CELL_MIN, Math.min(CELL_MAX, Math.floor((avail - (cols - 1) * GAP) / cols))) : CELL_MIN;
  const gridW = cols * cellW + Math.max(0, cols - 1) * GAP;
  const scroll = gridW > avail;
  const accent = C.accent;
  const grid = (
    <View>
      <View style={{ flexDirection: 'row', height: HEAD_H }}>
        {columns.map((c, i) => (
          <Text key={c.id} numberOfLines={1} style={[cs.colLabel, { width: cellW, marginLeft: i ? GAP : 0, color: C.textFaint }]}>
            {c.label}
          </Text>
        ))}
      </View>
      {rows.map((r) => (
        <View key={r.key} style={{ flexDirection: 'row', marginTop: GAP }}>
          {r.cells.map((v, i) => {
            const a = v == null ? 0 : heatAlpha(v);
            return (
              <View
                key={i}
                style={[cs.cell, { width: cellW, marginLeft: i ? GAP : 0 }, v == null ? null : { backgroundColor: tint(accent, a) }]}
              >
                {v == null ? (
                  <View style={[cs.dash, { backgroundColor: C.textFaint }]} />
                ) : (
                  <Text style={[cs.cellText, { color: readableOn(accent, a) }]}>{Math.round(v)}</Text>
                )}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
  return (
    <View onLayout={onLayout} accessible accessibilityLabel={accessibilityLabel}>
      {w > 0 ? (
        <View style={{ flexDirection: 'row' }}>
          <View style={{ width: NAME_W }}>
            <View style={{ height: HEAD_H }} />
            {rows.map((r) => (
              <View key={r.key} style={{ height: CELL_H, marginTop: GAP, justifyContent: 'center', paddingRight: 10 }}>
                <Text numberOfLines={1} style={[cs.rowName, { color: C.textDim }]}>{r.name}</Text>
              </View>
            ))}
          </View>
          {scroll ? (
            <ScrollView
              ref={scroller} horizontal showsHorizontalScrollIndicator={false}
              onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}
            >
              {grid}
            </ScrollView>
          ) : grid}
        </View>
      ) : null}
    </View>
  );
}

const cs = StyleSheet.create({
  hair: { position: 'absolute', left: 0, width: 1 },
  ring: { position: 'absolute', left: 0, top: 0, width: RING * 2, height: RING * 2, borderRadius: RING, borderWidth: 1.5 },
  keyRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 6 },
  keyItem: { flexDirection: 'row', alignItems: 'center' },
  keyText: { fontFamily: F.sm, fontSize: 12, letterSpacing: TRACK.fine, marginLeft: 6 },
  // a column's label has only the cell's width, so it takes the smaller value
  colLabel: { fontFamily: F.sm, fontSize: 11, letterSpacing: TRACK.fine, textAlign: 'center' },
  rowName: { fontFamily: F.med, fontSize: 13, letterSpacing: TRACK.small },
  cell: { height: CELL_H, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  cellText: { fontFamily: F.med, fontSize: 13, letterSpacing: TRACK.small, fontVariant: ['tabular-nums'] },
  dash: { width: 10, height: 1.5, borderRadius: 1, opacity: 0.6 },
});
