import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Extrapolation, interpolate, useAnimatedProps, useAnimatedStyle,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import Svg, { Circle, Defs, G, LinearGradient, Mask, Path, Rect, Stop } from 'react-native-svg';
import { C, darkSh, liteSh } from '../theme';
import { SIG } from '../signature';
import type { SigDot, SigLine, SigModel } from '../signature';
import { DATE_FIT, DATE_PLACE, DIGITS } from '../handDate';
import type { HandDot, HandLine } from '../handDate';
import {
  buildDigits, buildSigModel, clampPlace, dateBox, dateDigits, defaultPlace, fitDate, layoutDate as layDate,
} from '../sigModel';
import type { Box, Hand, PlacedDigit } from '../sigModel';
import { useStore } from '../store';
import type { OwnSignature } from '../store';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedRect = Animated.createAnimatedComponent(Rect);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** The creator's handwritten digits and where the date sits on his signature (src/handDate.ts). */
export const BUILT_IN_HAND: Hand = { digits: DIGITS, place: DATE_PLACE, fit: DATE_FIT };

/** A model's lines and dots, split once per model (the built-in one, or one recorded on this phone). */
interface Art {
  lines: readonly SigLine[];
  dots: readonly SigDot[];
}
const ARTS = new WeakMap<SigModel, Art>();
function artOf(model: SigModel): Art {
  let art = ARTS.get(model);
  if (!art) {
    art = {
      lines: model.strokes.filter((s): s is SigLine => s.type === 'line'),
      dots: model.strokes.filter((s): s is SigDot => s.type === 'dot'),
    };
    ARTS.set(model, art);
  }
  return art;
}

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
const shineSlant = (vh: number) => Math.tan((-SHINE_SKEW * Math.PI) / 180) * vh;

const CARVE_LIP = liteSh(0.55);
const CARVE_DARK = darkSh(0.85);

/* ------------------------------------------------------------------ the handwritten date */

/** the date is written a little quicker than the signature: its recorded timings run at 1 / DATE_SPEED */
export const DATE_SPEED = 1.45;

/**
 * The date's digits placed on the signature (src/sigModel.ts layoutDate): only the parts the placement writes, each
 * group at its own anchor. `date` is ddmmyy; `hand` is whose digits and placement (the creator's by default).
 */
export function layoutDate(date: string, hand: Hand = BUILT_IN_HAND): { digits: PlacedDigit[]; total: number } {
  return layDate(date, hand);
}

/**
 * Everything a signature and its date can cover, viewBox units [x0, y0, x1, y1], its own box included: what a frame
 * around it must leave room for (a date placed below the signature hangs out of its slot).
 */
export function inkExtent(model: SigModel, hand: Hand | null): Box {
  const b = hand ? dateBox(hand) : model.bbox;
  return [
    Math.min(0, model.bbox[0], b[0]), Math.min(0, model.bbox[1], b[1]),
    Math.max(model.vw, model.bbox[2], b[2]), Math.max(model.vh, model.bbox[3], b[3]),
  ];
}

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

function geometry(width: number, model: SigModel, hand: Hand | null): Geo {
  const k = width / model.vw;
  const height = model.vh * k;
  const lineW = LINE_PX / k;
  // a signature without a date pads for its own strokes alone
  const box = hand ? dateBox(hand) : model.bbox;
  const x0 = Math.min(model.bbox[0], box[0]);
  const y0 = Math.min(model.bbox[1], box[1]);
  const x1 = Math.max(model.bbox[2], box[2]);
  const y1 = Math.max(model.bbox[3], box[3]);
  const overshoot = Math.max(0, -x0, -y0, x1 - model.vw, y1 - model.vh);
  // half a line past the geometry for the caps, plus 2px for the lip offset and anti-aliasing
  const padU = Math.ceil(overshoot + lineW / 2 + 2 / k);
  const padPx = padU * k;
  return {
    k, width, height, lineW, padPx,
    viewBox: `${-padU} ${-padU} ${model.vw + 2 * padU} ${model.vh + 2 * padU}`,
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
function DateStrokes({ date, hand, lineW, color }: { date: string; hand: Hand; lineW: number; color: string }) {
  const { digits } = useMemo(() => layoutDate(date, hand), [date, hand]);
  return (
    <>
      {digits.map((p) => {
        const w = lineW / p.scale;
        return (
          <G key={p.key} transform={p.transform}>
            {hand.digits[p.ch].strokes.map((st, i) => (st.type === 'line' ? (
              <Path
                key={i} d={st.d} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"
              />
            ) : (
              <Circle key={i} cx={st.cx} cy={st.cy} r={w} fill={color} />
            )))}
          </G>
        );
      })}
    </>
  );
}

/* ------------------------------------------------------------------ carve (static) */

/**
 * The signature, and the date when there is one, debossed into the material: a light lip under a dark carve. With
 * `engrave`, the date is not there yet: its own pen cuts it in as `engrave` runs, for a date written at the end.
 */
function CarveArt({ g, art, hand, date, engrave }: {
  g: Geo; art: Art; hand: Hand | null; date?: string; engrave?: SharedValue<number>;
}) {
  const lipX = LIP_DX / g.k;
  const lipY = LIP_DY / g.k;
  const dated = hand && date ? hand : null;
  return (
    <>
      <Svg
        width={g.boxW} height={g.boxH} viewBox={g.viewBox}
        style={{ position: 'absolute', left: -g.padPx, top: -g.padPx }}
      >
        {art.lines.map((l, i) => (
          <Path
            key={`lip${i}`} d={l.d} fill="none" stroke={CARVE_LIP} strokeWidth={g.lineW}
            strokeLinecap="round" strokeLinejoin="round" translateX={lipX} translateY={lipY}
          />
        ))}
        {dated && date ? (
          <G transform={`translate(${lipX.toFixed(3)} ${lipY.toFixed(3)})`}>
            {engrave
              ? <DateInk date={date} hand={dated} lineW={g.lineW} dateTau={engrave} color={CARVE_LIP} dotScale={1} />
              : <DateStrokes date={date} hand={dated} lineW={g.lineW} color={CARVE_LIP} />}
          </G>
        ) : null}
        {art.lines.map((l, i) => (
          <Path
            key={`dark${i}`} d={l.d} fill="none" stroke={CARVE_DARK} strokeWidth={g.lineW}
            strokeLinecap="round" strokeLinejoin="round"
          />
        ))}
        {dated && date ? (engrave
          ? <DateInk date={date} hand={dated} lineW={g.lineW} dateTau={engrave} color={CARVE_DARK} dotScale={1} />
          : <DateStrokes date={date} hand={dated} lineW={g.lineW} color={CARVE_DARK} />) : null}
      </Svg>
      {art.dots.map((d, i) => (
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
function DateInk({ date, hand, lineW, dateTau, color = C.text, dotScale = 1.1 }: {
  date: string; hand: Hand; lineW: number; dateTau: SharedValue<number>; color?: string; dotScale?: number;
}) {
  const { digits } = useMemo(() => layoutDate(date, hand), [date, hand]);
  return (
    <>
      {digits.map((p) => {
        const w = lineW / p.scale;
        return (
          <G key={p.key + p.ch} transform={p.transform}>
            {hand.digits[p.ch].strokes.map((st, i) => (st.type === 'line' ? (
              <DateInkLine key={i} line={st} width={w} dateTau={dateTau} t0={p.t0} color={color} />
            ) : (
              <DateInkDot key={i} dot={st} r={w * dotScale} dateTau={dateTau} t0={p.t0} color={color} />
            )))}
          </G>
        );
      })}
    </>
  );
}

/**
 * react-native-svg rasterises each Svg at its layout size, so the ink (seen large for the whole
 * writing beat) lays out at hero size and is scaled down by 1/heroScale; the carve and glint lay
 * out at the final size, where they rest.
 */
function InkArt({ g, art, hand, heroScale, tau, date, dateTau }: {
  g: Geo; art: Art; hand: Hand | null; heroScale: number; tau: SharedValue<number>; date?: string; dateTau?: SharedValue<number>;
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
          {art.lines.map((l, i) => <InkLine key={i} line={l} lineW={g.lineW} tau={tau} />)}
          {hand && date && dateTau ? <DateInk date={date} hand={hand} lineW={g.lineW} dateTau={dateTau} /> : null}
        </Svg>
      </View>
      {art.dots.map((d, i) => <InkDot key={i} dot={d} k={g.k} tau={tau} />)}
    </>
  );
}

/* ------------------------------------------------------------------ accent shine */

/**
 * One soft band of accent light, swept once across the carved signature and its date. The band is a gradient, clear
 * at both edges and brightest in the middle, and it is masked to the strokes themselves, so only the carve catches it.
 */
function Shine({ g, model, art, hand, glint, date }: {
  g: Geo; model: SigModel; art: Art; hand: Hand | null; glint: SharedValue<number>; date?: string;
}) {
  const padU = g.padPx / g.k;
  const band = SHINE_W / g.k;
  const tall = model.vh + 2 * padU;
  const reach = model.vw + band + shineSlant(model.vh);
  const animatedProps = useAnimatedProps(() => ({
    x: -band + glint.value * reach,
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
        <Mask id="sigShineMask" maskUnits="userSpaceOnUse" x={-padU} y={-padU} width={model.vw + 2 * padU} height={tall}>
          {art.lines.map((l, i) => (
            <Path
              key={i} d={l.d} fill="none" stroke="#fff" strokeWidth={g.lineW * 1.3}
              strokeLinecap="round" strokeLinejoin="round"
            />
          ))}
          {art.dots.map((d, i) => <Circle key={'dot' + i} cx={d.cx} cy={d.cy} r={g.lineW * 0.9} fill="#fff" />)}
          {hand && date ? <DateStrokes date={date} hand={hand} lineW={g.lineW * 1.3} color="#fff" /> : null}
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
  /** whose signature: the creator's (SIG) when left out, or one recorded on this phone (src/sigModel.ts) */
  model?: SigModel;
  /** whose digits and where the date goes: the creator's when left out; null writes no date at all */
  hand?: Hand | null;
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
  width, model = SIG, hand = BUILT_IN_HAND, heroScale, heroX, heroY, tau, date, dateTau, dateLate, travel, ink, carve, glint,
}: SignatureProps) {
  const g = useMemo(() => geometry(width, model, hand), [width, model, hand]);
  const art = artOf(model);
  const shown = hand ? date : undefined;

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
        <CarveArt g={g} art={art} hand={hand} date={shown} engrave={dateLate ? dateTau : undefined} />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, inkStyle]}>
        <InkArt
          g={g} art={art} hand={hand} heroScale={heroScale} tau={tau} date={dateLate ? undefined : shown} dateTau={dateTau}
        />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, glintStyle]}>
        <Shine g={g} model={model} art={art} hand={hand} glint={glint} date={dateLate ? undefined : shown} />
      </Animated.View>
    </Animated.View>
  );
}

/** The composed end state: the carved signature, and the date when there is one, at rest, nothing animated. */
export function SignatureStill({ width, date, model = SIG, hand = BUILT_IN_HAND }: {
  width: number; date?: string; model?: SigModel; hand?: Hand | null;
}) {
  const g = useMemo(() => geometry(width, model, hand), [width, model, hand]);
  return (
    <View style={{ width: g.width, height: g.height }}>
      <CarveArt g={g} art={artOf(model)} hand={hand} date={hand ? date : undefined} />
    </View>
  );
}

/* ------------------------------------------------------------------ the signature the intro plays */

export interface IntroSignature {
  model: SigModel;
  /** null: a signature recorded without digits, which plays with no date */
  hand: Hand | null;
  /** the signature is one recorded on this phone */
  own: boolean;
}

const CREATOR: IntroSignature = { model: SIG, hand: BUILT_IN_HAND, own: false };

/**
 * The signature the intro plays for these settings: the creator's, or the one recorded on this phone with its digits
 * and their placement (a date placed automatically when the digits were never placed). Anything unusable falls back to
 * the creator's; digits that do not build leave the recorded signature dateless. `dates` (ddmmyy) are the days the date
 * may be written on, the only pairs whose room is worked out.
 */
export function resolveSignature(source: 'creator' | 'own', own: OwnSignature | null, dates: readonly string[]): IntroSignature {
  if (source !== 'own' || !own) return CREATOR;
  try {
    const model = buildSigModel(own);
    if (!model) return CREATOR;
    const digits = own.digits ? buildDigits(own.digits) : null;
    if (!digits) return { model, hand: null, own: true };
    const place = own.date ? clampPlace(own.date) : defaultPlace(model, digits);
    return { model, hand: { digits, place, fit: fitDate(model, digits, place, dates) }, own: true };
  } catch {
    return CREATOR;
  }
}

let introCache: { source: string; own: OwnSignature | null; day: string; value: IntroSignature } | null = null;

/**
 * The active signature for the intro, built once: the models are worked out from the recording the first time they are
 * asked for (on the launch frame, from the hydrated settings) and kept for as long as the settings and the day stay.
 * The room the date makes is worked out for today and tomorrow, so an intro that runs over midnight writes either.
 */
export function useIntroSignature(): IntroSignature {
  const source = useStore((s) => s.settings.signatureSource);
  const own = useStore((s) => s.settings.ownSignature);
  return useMemo(() => {
    const now = new Date();
    const day = dateDigits(now);
    if (introCache && introCache.source === source && introCache.own === own && introCache.day === day) return introCache.value;
    const tomorrow = dateDigits(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
    const value = resolveSignature(source, own, [day, tomorrow]);
    introCache = { source, own, day, value };
    return value;
  }, [source, own]);
}
