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

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedRect = Animated.createAnimatedComponent(Rect);

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
const SHINE_SKEW = -18;
/** how far the skew moves the band's foot sideways, viewBox units: the sweep runs this much further to clear it */
const SHINE_SLANT = Math.tan((-SHINE_SKEW * Math.PI) / 180) * SIG.vh;

const CARVE_LIP = liteSh(0.55);
const CARVE_DARK = darkSh(0.85);

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
  /** canvas padding so round caps, the lip and cubic overshoot are never clipped by the Svg bounds */
  padPx: number;
  viewBox: string;
  boxW: number;
  boxH: number;
}

function geometry(width: number): Geo {
  const k = width / SIG.vw;
  const height = SIG.vh * k;
  const lineW = LINE_PX / k;
  const [x0, y0, x1, y1] = SIG.bbox;
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

/* ------------------------------------------------------------------ carve (static) */

/** The signature debossed into the material: a light lip under a dark carve, fully drawn. */
function CarveArt({ g }: { g: Geo }) {
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
        {LINES.map((l, i) => (
          <Path
            key={`dark${i}`} d={l.d} fill="none" stroke={CARVE_DARK} strokeWidth={g.lineW}
            strokeLinecap="round" strokeLinejoin="round"
          />
        ))}
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

/**
 * react-native-svg rasterises each Svg at its layout size, so the ink (seen large for the whole
 * writing beat) lays out at hero size and is scaled down by 1/heroScale; the carve and glint lay
 * out at the final size, where they rest.
 */
function InkArt({ g, heroScale, tau }: { g: Geo; heroScale: number; tau: SharedValue<number> }) {
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
        </Svg>
      </View>
      {DOTS.map((d, i) => <InkDot key={i} dot={d} k={g.k} tau={tau} />)}
    </>
  );
}

/* ------------------------------------------------------------------ accent shine */

/**
 * One soft band of accent light, swept once across the carved signature. The band is a gradient, clear at both
 * edges and brightest in the middle, and it is masked to the signature's own strokes, so only the carve catches it.
 */
function Shine({ g, glint }: { g: Geo; glint: SharedValue<number> }) {
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
  /** 0 = hero, 1 = resting in the slot */
  travel: SharedValue<number>;
  /** ink and carve layer opacities (the sink from ink into the material) */
  ink: SharedValue<number>;
  carve: SharedValue<number>;
  /** 0..1 progress of the single accent glint */
  glint: SharedValue<number>;
}

/**
 * The handwritten signature: written in ink at hero size, travelling into its slot (transforms
 * only), sinking into a carve, with one soft accent catch of light along the carve.
 */
export function Signature({ width, heroScale, heroX, heroY, tau, travel, ink, carve, glint }: SignatureProps) {
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
        <CarveArt g={g} />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, inkStyle]}>
        <InkArt g={g} heroScale={heroScale} tau={tau} />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, glintStyle]}>
        <Shine g={g} glint={glint} />
      </Animated.View>
    </Animated.View>
  );
}

/** The composed end state: the carved signature at rest, nothing animated. */
export function SignatureStill({ width }: { width: number }) {
  const g = useMemo(() => geometry(width), [width]);
  return (
    <View style={{ width: g.width, height: g.height }}>
      <CarveArt g={g} />
    </View>
  );
}
