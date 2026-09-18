import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Extrapolation, interpolate, useAnimatedProps, useAnimatedStyle,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import Svg, { Circle, Defs, G, LinearGradient, Mask, Path, Rect, Stop } from 'react-native-svg';
import { C, darkSh, liteSh } from '../theme';
import { SIG } from '../signature';
import type { SigDot, SigLine } from '../signature';
import { DATE_PLACE, DIGITS, DIGIT_H } from '../handDate';
import type { HandDot, HandLine } from '../handDate';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedRect = Animated.createAnimatedComponent(Rect);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const LINES = SIG.strokes.filter((s): s is SigLine => s.type === 'line');
const DOTS = SIG.strokes.filter((s): s is SigDot => s.type === 'dot');

/** on-screen line width in the final slot, px (the hero draws it heroScale times wider) */
const LINE_PX = 1.7;
/** dot radii in the final slot, px: carve dots 1.0x and ink dots 1.1x the line width (as in the lab) */
const CARVE_DOT_R = LINE_PX;
const INK_DOT_R = LINE_PX * 1.1;
/** the carve's light lip sits toward the far side of the 60 degree light, px in the final slot */
const LIP_DX = -0.5;
const LIP_DY = 0.9;
/** dot pop, model ms */
const DOT_POP = 130;
/** the ink dash covers 1.02 len, so a native path a touch longer than our measure never leaves a tail */
const DASH = 1.02;
/** an undrawn line parks its offset inside the gap, clear of the dash edge, so no cap dot shows early */
const PARK = 1.03;
/**
 * accent shine: one soft band of light, gradual at both edges like the old sheen on the logo, swept once across the
 * carved signature at the sheen's angle (band width in the final slot, px; peak alpha at its centre; degrees)
 */
const SHINE_W = 58;
const SHINE_ALPHA = 0.3;
export const SHINE_SKEW = -18;
/** how far the skew moves the band's foot sideways, viewBox units: the sweep runs this much further to clear it */
const SHINE_SLANT = Math.tan((-SHINE_SKEW * Math.PI) / 180) * SIG.vh;

const CARVE_LIP = liteSh(0.55);
const CARVE_DARK = darkSh(0.85);

/* ------------------------------------------------------------------ the handwritten date */

/** pen lifts inside the date, model ms: between two digits of a group, and between day, month and year */
const DIGIT_GAP_MS = 90;
const GROUP_GAP_MS = 200;
/** the date is written a little quicker than the signature: its recorded timings run at 1 / DATE_SPEED */
export const DATE_SPEED = 1.45;
const GROUPS = ['dd', 'mm', 'yy'] as const;
const DATE_SCALE = DATE_PLACE.size / DIGIT_H;

interface PlacedDigit {
  key: string;
  ch: string;
  /** from the digit's own units into the signature's */
  transform: string;
  /** model ms, from the date's first pen-down, when this digit begins */
  t0: number;
}

/**
 * The date's six digits placed on the signature as the Handwriting Lab placed them: each group anchored at the left
 * end of its baseline, scaled and turned about that anchor, its two digits side by side. `date` is ddmmyy.
 */
export function layoutDate(date: string): { digits: PlacedDigit[]; total: number } {
  const digits: PlacedDigit[] = [];
  let t = 0;
  GROUPS.forEach((group, gi) => {
    const P = DATE_PLACE.groups[group];
    if (gi) t += GROUP_GAP_MS;
    let x = 0;
    for (let i = 0; i < 2; i++) {
      const ch = date[gi * 2 + i];
      const m = DIGITS[ch];
      if (!m) continue;
      if (i) t += DIGIT_GAP_MS;
      digits.push({
        key: group + i,
        ch,
        transform: `translate(${P.x} ${P.y}) rotate(${DATE_PLACE.tilt}) scale(${DATE_SCALE.toFixed(4)}) `
          + `translate(${(x - m.x0).toFixed(2)} ${-DIGIT_H})`,
        t0: t,
      });
      t += m.total;
      x += Math.max(14, m.x1 - m.x0) + (i === 0 ? DATE_PLACE.gap * DIGIT_H : 0);
    }
  });
  return { digits, total: t };
}

/** Where any date could reach, signature units, so the canvas never clips a wide digit. */
const DATE_BOX = (() => {
  const rad = (DATE_PLACE.tilt * Math.PI) / 180;
  const widest = Math.max(...Object.values(DIGITS).map((d) => Math.max(14, d.x1 - d.x0)));
  const w = (2 * widest + DATE_PLACE.gap * DIGIT_H) * DATE_SCALE;
  const top = -1.15 * DATE_PLACE.size;
  const foot = 0.2 * DATE_PLACE.size;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  GROUPS.forEach((g) => {
    const P = DATE_PLACE.groups[g];
    [[0, top], [w, top], [0, foot], [w, foot]].forEach(([x, y]) => {
      const X = P.x + x * Math.cos(rad) - y * Math.sin(rad);
      const Y = P.y + x * Math.sin(rad) + y * Math.cos(rad);
      x0 = Math.min(x0, X); y0 = Math.min(y0, Y); x1 = Math.max(x1, X); y1 = Math.max(y1, Y);
    });
  });
  return [x0, y0, x1, y1] as const;
})();

/**
 * Fraction of a line drawn at model time `tau`: binary search over the recorded sample times,
 * linear between samples, so the pen keeps the recorded speed changes inside the stroke.
 */
export function lineProgress(s: readonly number[], ts: readonly number[], tau: number): number {
  'worklet';
  const n = ts.length;
  if (tau <= ts[0]) return 0;
  if (tau >= ts[n - 1]) return 1;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (ts[m] <= tau) lo = m;
    else hi = m;
  }
  const span = ts[hi] - ts[lo];
  return s[lo] + (s[hi] - s[lo]) * (span > 0 ? (tau - ts[lo]) / span : 1);
}

interface Geo {
  /** px per viewBox unit in the final slot */
  k: number;
  width: number;
  height: number;
  /** line width, viewBox units */
  lineW: number;
  /** canvas padding so round caps, the lip, cubic overshoot and the date are never clipped by the Svg bounds */
  padPx: number;
  viewBox: string;
  boxW: number;
  boxH: number;
}

function geometry(width: number): Geo {
  const k = width / SIG.vw;
  const height = SIG.vh * k;
  const lineW = LINE_PX / k;
  const x0 = Math.min(SIG.bbox[0], DATE_BOX[0]);
  const y0 = Math.min(SIG.bbox[1], DATE_BOX[1]);
  const x1 = Math.max(SIG.bbox[2], DATE_BOX[2]);
  const y1 = Math.max(SIG.bbox[3], DATE_BOX[3]);
  const overshoot = Math.max(0, -x0, -y0, x1 - SIG.vw, y1 - SIG.vh);
  // half a line past the geometry for the caps, plus 2px for the lip offset and anti-aliasing
  const padU = Math.ceil(overshoot + lineW / 2 + 2 / k);
  const padPx = padU * k;
  return {
    k, width, height, lineW, padPx,
    viewBox: `${-padU} ${-padU} ${SIG.vw + 2 * padU} ${SIG.vh + 2 * padU}`,
    boxW: width + 2 * padPx,
    boxH: height + 2 * padPx,
  };
}

const disc = (cx: number, cy: number, r: number, color: string) => ({
  position: 'absolute' as const,
  left: cx - r, top: cy - r, width: 2 * r, height: 2 * r, borderRadius: r,
  backgroundColor: color,
});

/** A date's digits drawn whole in one colour: the carve's lip or its dark cut, or the shine's mask. */
function DateStrokes({ date, lineW, color }: { date: string; lineW: number; color: string }) {
  const { digits } = useMemo(() => layoutDate(date), [date]);
  const w = lineW / DATE_SCALE;
  return (
    <>
      {digits.map((p) => (
        <G key={p.key} transform={p.transform}>
          {DIGITS[p.ch].strokes.map((st, i) => (st.type === 'line' ? (
            <Path
              key={i} d={st.d} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"
            />
          ) : (
            <Circle key={i} cx={st.cx} cy={st.cy} r={w} fill={color} />
          )))}
        </G>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ carve (static) */

/**
 * The signature, and the date when there is one, debossed into the material: a light lip under a dark carve. With
 * `engrave`, the date is not there yet: its own pen cuts it in as `engrave` runs, for a date written at the end.
 */
function CarveArt({ g, date, engrave }: { g: Geo; date?: string; engrave?: SharedValue<number> }) {
  const lipX = LIP_DX / g.k;
  const lipY = LIP_DY / g.k;
  return (
    <>
      <Svg
        width={g.boxW} height={g.boxH} viewBox={g.viewBox}
        style={{ position: 'absolute', left: -g.padPx, top: -g.padPx }}
      >
        {LINES.map((l, i) => (
          <Path
            key={`lip${i}`} d={l.d} fill="none" stroke={CARVE_LIP} strokeWidth={g.lineW}
            strokeLinecap="round" strokeLinejoin="round" translateX={lipX} translateY={lipY}
          />
        ))}
        {date ? (
          <G transform={`translate(${lipX.toFixed(3)} ${lipY.toFixed(3)})`}>
            {engrave
              ? <DateInk date={date} lineW={g.lineW} dateTau={engrave} color={CARVE_LIP} dotScale={1} />
              : <DateStrokes date={date} lineW={g.lineW} color={CARVE_LIP} />}
          </G>
        ) : null}
        {LINES.map((l, i) => (
          <Path
            key={`dark${i}`} d={l.d} fill="none" stroke={CARVE_DARK} strokeWidth={g.lineW}
            strokeLinecap="round" strokeLinejoin="round"
          />
        ))}
        {date ? (engrave
          ? <DateInk date={date} lineW={g.lineW} dateTau={engrave} color={CARVE_DARK} dotScale={1} />
          : <DateStrokes date={date} lineW={g.lineW} color={CARVE_DARK} />) : null}
      </Svg>
      {DOTS.map((d, i) => (
        <React.Fragment key={i}>
          <View style={disc(d.cx * g.k + LIP_DX, d.cy * g.k + LIP_DY, CARVE_DOT_R, CARVE_LIP)} />
          <View style={disc(d.cx * g.k, d.cy * g.k, CARVE_DOT_R, CARVE_DARK)} />
        </React.Fragment>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ ink (pen) */

function InkLine({ line, lineW, tau }: { line: SigLine; lineW: number; tau: SharedValue<number> }) {
  const { s, ts, len } = line;
  const park = len * PARK;
  // strokeDashoffset is the only animated SVG prop; the dash pattern stays static
  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: park * (1 - lineProgress(s, ts, tau.value)),
  }));
  return (
    <AnimatedPath
      d={line.d} fill="none" stroke={C.text} strokeWidth={lineW}
      strokeLinecap="round" strokeLinejoin="round"
      strokeDasharray={[len * DASH, len * DASH]}
      animatedProps={animatedProps}
    />
  );
}

function InkDot({ dot, k, tau }: { dot: SigDot; k: number; tau: SharedValue<number> }) {
  const { t0 } = dot;
  const style = useAnimatedStyle(() => {
    const p = Math.min(Math.max((tau.value - t0) / DOT_POP, 0), 1);
    const q = 1 - (1 - p) * (1 - p) * (1 - p);
    return { opacity: q, transform: [{ scale: 0.4 + 0.6 * q }] };
  });
  return <Animated.View style={[disc(dot.cx * k, dot.cy * k, INK_DOT_R, C.text), style]} />;
}

/** A stroke of the date, written by `dateTau` (model ms from the date's first pen-down) from its digit's start. */
function DateInkLine({ line, width, dateTau, t0, color }: {
  line: HandLine; width: number; dateTau: SharedValue<number>; t0: number; color: string;
}) {
  const { s, ts, len } = line;
  const park = len * PARK;
  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: park * (1 - lineProgress(s, ts, dateTau.value - t0)),
  }));
  return (
    <AnimatedPath
      d={line.d} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round"
      strokeDasharray={[len * DASH, len * DASH]}
      animatedProps={animatedProps}
    />
  );
}

function DateInkDot({ dot, r, dateTau, t0, color }: {
  dot: HandDot; r: number; dateTau: SharedValue<number>; t0: number; color: string;
}) {
  const start = t0 + dot.t0;
  const animatedProps = useAnimatedProps(() => {
    const p = Math.min(Math.max((dateTau.value - start) / DOT_POP, 0), 1);
    const q = 1 - (1 - p) * (1 - p) * (1 - p);
    return { r: p > 0 ? r * (0.4 + 0.6 * q) : 0 };
  });
  return <AnimatedCircle cx={dot.cx} cy={dot.cy} fill={color} animatedProps={animatedProps} />;
}

/** The date written stroke by stroke in one colour: ink over the page, or the lip or the cut of an engraving. */
function DateInk({ date, lineW, dateTau, color = C.text, dotScale = 1.1 }: {
  date: string; lineW: number; dateTau: SharedValue<number>; color?: string; dotScale?: number;
}) {
  const { digits } = useMemo(() => layoutDate(date), [date]);
  const w = lineW / DATE_SCALE;
  return (
    <>
      {digits.map((p) => (
        <G key={p.key + p.ch} transform={p.transform}>
          {DIGITS[p.ch].strokes.map((st, i) => (st.type === 'line' ? (
            <DateInkLine key={i} line={st} width={w} dateTau={dateTau} t0={p.t0} color={color} />
          ) : (
            <DateInkDot key={i} dot={st} r={w * dotScale} dateTau={dateTau} t0={p.t0} color={color} />
          )))}
        </G>
      ))}
    </>
  );
}

/**
 * react-native-svg rasterises each Svg at its layout size, so the ink (seen large for the whole
 * writing beat) lays out at hero size and is scaled down by 1/heroScale; the carve and glint lay
 * out at the final size, where they rest.
 */
function InkArt({ g, heroScale, tau, date, dateTau }: {
  g: Geo; heroScale: number; tau: SharedValue<number>; date?: string; dateTau?: SharedValue<number>;
}) {
  const w = g.boxW * heroScale;
  const h = g.boxH * heroScale;
  return (
    <>
      <View
        style={{
          position: 'absolute',
          left: (g.width - w) / 2, top: (g.height - h) / 2, width: w, height: h,
          transform: [{ scale: 1 / heroScale }],
        }}
      >
        <Svg width={w} height={h} viewBox={g.viewBox}>
          {LINES.map((l, i) => <InkLine key={i} line={l} lineW={g.lineW} tau={tau} />)}
          {date && dateTau ? <DateInk date={date} lineW={g.lineW} dateTau={dateTau} /> : null}
        </Svg>
      </View>
      {DOTS.map((d, i) => <InkDot key={i} dot={d} k={g.k} tau={tau} />)}
    </>
  );
}

/* ------------------------------------------------------------------ accent shine */

/**
 * One soft band of accent light, swept once across the carved signature and its date. The band is a gradient, clear
 * at both edges and brightest in the middle, and it is masked to the strokes themselves, so only the carve catches it.
 */
function Shine({ g, glint, date }: { g: Geo; glint: SharedValue<number>; date?: string }) {
  const padU = g.padPx / g.k;
  const band = SHINE_W / g.k;
  const tall = SIG.vh + 2 * padU;
  const animatedProps = useAnimatedProps(() => ({
    x: -band + glint.value * (SIG.vw + band + SHINE_SLANT),
  }));
  return (
    <Svg
      width={g.boxW} height={g.boxH} viewBox={g.viewBox}
      style={{ position: 'absolute', left: -g.padPx, top: -g.padPx }}
    >
      <Defs>
        <LinearGradient id="sigShineBand" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={C.accent} stopOpacity={0} />
          <Stop offset="0.5" stopColor={C.accent} stopOpacity={SHINE_ALPHA} />
          <Stop offset="1" stopColor={C.accent} stopOpacity={0} />
        </LinearGradient>
        <Mask id="sigShineMask" maskUnits="userSpaceOnUse" x={-padU} y={-padU} width={SIG.vw + 2 * padU} height={tall}>
          {LINES.map((l, i) => (
            <Path
              key={i} d={l.d} fill="none" stroke="#fff" strokeWidth={g.lineW * 1.3}
              strokeLinecap="round" strokeLinejoin="round"
            />
          ))}
          {DOTS.map((d, i) => <Circle key={'dot' + i} cx={d.cx} cy={d.cy} r={g.lineW * 0.9} fill="#fff" />)}
          {date ? <DateStrokes date={date} lineW={g.lineW * 1.3} color="#fff" /> : null}
        </Mask>
      </Defs>
      <G mask="url(#sigShineMask)">
        <AnimatedRect
          y={-padU} width={band} height={tall} fill="url(#sigShineBand)" skewX={SHINE_SKEW}
          animatedProps={animatedProps}
        />
      </G>
    </Svg>
  );
}

/* ------------------------------------------------------------------ public */

export interface SignatureProps {
  /** width of the final slot, px; the height follows the recording's aspect */
  width: number;
  /** hero size relative to the final slot */
  heroScale: number;
  /** hero centre offset from the slot centre, px */
  heroX: number;
  heroY: number;
  /** model ms (100% speed) driving the pen */
  tau: SharedValue<number>;
  /** today's date, ddmmyy, written after the signature; none leaves the signature alone */
  date?: string;
  /** model ms (100% speed, from the date's first pen-down) driving the date's pen */
  dateTau?: SharedValue<number>;
  /**
   * The date is written at the end, just before the hand-over, instead of straight after the signature: it is never
   * inked or shone on, its pen cuts it straight into the carve.
   */
  dateLate?: boolean;
  /** 0 = hero, 1 = resting in the slot */
  travel: SharedValue<number>;
  /** ink and carve layer opacities (the sink from ink into the material) */
  ink: SharedValue<number>;
  carve: SharedValue<number>;
  /** 0..1 progress of the single accent glint */
  glint: SharedValue<number>;
}

/**
 * The handwritten signature, and the date after it: written in ink at hero size, travelling into its slot
 * (transforms only), sinking into a carve, with one soft accent catch of light along the carve.
 */
export function Signature({
  width, heroScale, heroX, heroY, tau, date, dateTau, dateLate, travel, ink, carve, glint,
}: SignatureProps) {
  const g = useMemo(() => geometry(width), [width]);

  const travelStyle = useAnimatedStyle(() => {
    const p = travel.value;
    return {
      transform: [
        { translateX: heroX * (1 - p) },
        { translateY: heroY * (1 - p) },
        { scale: heroScale + (1 - heroScale) * p },
      ] as const,
    };
  });
  const carveStyle = useAnimatedStyle(() => ({ opacity: carve.value }));
  const inkStyle = useAnimatedStyle(() => ({ opacity: ink.value }));
  const glintStyle = useAnimatedStyle(() => ({
    opacity: interpolate(glint.value, [0, 0.1, 0.85, 1], [0, 1, 1, 0], Extrapolation.CLAMP),
  }));

  return (
    <Animated.View style={[{ width: g.width, height: g.height }, travelStyle]}>
      <Animated.View style={[StyleSheet.absoluteFill, carveStyle]}>
        <CarveArt g={g} date={date} engrave={dateLate ? dateTau : undefined} />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, inkStyle]}>
        <InkArt g={g} heroScale={heroScale} tau={tau} date={dateLate ? undefined : date} dateTau={dateTau} />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, glintStyle]}>
        <Shine g={g} glint={glint} date={dateLate ? undefined : date} />
      </Animated.View>
    </Animated.View>
  );
}

/** The composed end state: the carved signature, and the date when there is one, at rest, nothing animated. */
export function SignatureStill({ width, date }: { width: number; date?: string }) {
  const g = useMemo(() => geometry(width), [width]);
  return (
    <View style={{ width: g.width, height: g.height }}>
      <CarveArt g={g} date={date} />
    </View>
  );
}
