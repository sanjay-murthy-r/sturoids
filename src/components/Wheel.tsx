import React from 'react';
import {
  LayoutChangeEvent, NativeSyntheticEvent, StyleSheet, Text, TextLayoutEventData, TextStyle, View, useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation, cancelAnimation, interpolate, interpolateColor, runOnJS, useAnimatedReaction, useAnimatedStyle,
  useDerivedValue, useSharedValue, withSpring,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useAnimLevel } from './Motion';
import { tick } from '../haptics';
import { WIDE_AT } from '../layout';

/** critically damped: a glide settles without bouncing */
const SPRING = { mass: 1, stiffness: 180, damping: 27 };
/** labels drawn either side of the centre; the rest are too faint to see */
const WINDOW = 4;
/** a tap reaches the labels that can be seen: two either side of the centre */
const TAP_REACH = 2;
/** on a wide window the wheel keeps a phone's reach instead of stretching across the card */
const MAX_W = 480;
/** how far the system's font size may grow a label */
const MAX_FONT_SCALE = 1.15;
/** a label shows its full name only this close to the centre, and its short one beyond */
const FULL_FADE = 0.55;

// ---- the ring (depth on): the labels stand on a horizontal ring seen a little from above. The nearer a label, the
// tighter it sits; the deeper it turns, the more it rises, shrinks and softens, and the ends fade into the surface ----
/** the turn between neighbouring labels on the ring, 30 degrees */
const STEP = Math.PI / 6;
/** the furthest a label turns: it has faded away by then */
const TURN_MAX = (100 * Math.PI) / 180;
/** how far a label rises as it recedes, px: at the ring's side it stands this much above the centre */
const LIFT = 10;
/** how much a label shrinks with depth */
const PERSPECTIVE = 0.6;
/** a label's scale one step and three steps round */
const SCALE_1 = 1 / (1 + PERSPECTIVE * (1 - Math.cos(STEP)));
const SCALE_3 = 1 / (1 + PERSPECTIVE * (1 - Math.cos(3 * STEP)));
/** the clear space between the centre label and its first neighbour, px */
const RING_GAP = 12;
/** the room kept between the third label round and the wheel's edge, px */
const RING_EDGE = 4;
/** bright at the centre and softer outward; gone just past three steps, so the loop's wrap is never seen */
const RING_AT = [0, 1, 2, 3, 3.5];
const RING_OPACITY = [1, 0.8, 0.56, 0.34, 0];
/** a far label hands over from its sharp copy to its blurred one between these distances, like depth of field */
const SOFT_FROM = 1.4;
const SOFT_TO = 2.6;
const BLUR_RADIUS = 7;
/** the blurred copy's own box reaches this far past the label, so its glow is never cut at the text's edge */
const BLUR_PAD = 10;
/** a tap reaches the ring's labels up to three steps round, with a little slack around each */
const TAP_RING = 3.2;
const TAP_SLOP = 6;

const mod = (n: number, m: number) => ((n % m) + m) % m;
const wrapAt = (n: number, m: number) => {
  'worklet';
  return ((n % m) + m) % m;
};
/** how far a label has handed over from sharp to blurred, 0 to 1 */
const softAt = (ad: number) => {
  'worklet';
  return Math.min(1, Math.max(0, (ad - SOFT_FROM) / (SOFT_TO - SOFT_FROM)));
};

/** '#RRGGBB' at an alpha, as rgba; anything else as given */
const tint = (c: string, a: number) => {
  const m = /^#([0-9a-f]{6})$/i.exec(c);
  if (!m) return c;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};
/** a colour made clear, so a fade into it never dims through grey on the way */
const clear = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? tint(c, 0) : 'transparent');
/** the ends veil the far days, translucent rather than solid, so they stay readable through it (the owner's ask) */
const veil = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? tint(c, 0.72) : c);

type RingWidths = { full: number[]; short: number[] };
/**
 * The ring's measured label widths and wheel width, by its labels, text style and font size: a wheel built again (each
 * visit replays the screen's entrance) starts where it was instead of measuring again
 */
const ringMemo = new Map<string, { widths: RingWidths; w: number }>();

/**
 * The ring's step and the room each centre label asks for. The step is as tight as the labels allow: the widest full
 * name at the centre clears its nearer neighbour by RING_GAP. Where that would carry the third label round past the
 * wheel's edge (a narrow phone), the step tightens to fit, and a wide name at the centre pushes the ring's two halves
 * apart by just the room it needs, so it never touches its neighbours.
 */
function ringLayout(widths: RingWidths | null, w: number, fallback: number, loop: boolean, count: number) {
  if (!widths || w <= 0) return { spacing: fallback, room: [] as number[], hf: [] as number[], hs: [] as number[] };
  const hf = widths.full.map((x) => x / 2);
  const hs = widths.short.map((x) => x / 2);
  const need = hf.map((h, i) => {
    const prev = loop ? hs[mod(i - 1, count)] : i > 0 ? hs[i - 1] : 0;
    const next = loop ? hs[mod(i + 1, count)] : i < count - 1 ? hs[i + 1] : 0;
    return h + RING_GAP + Math.max(prev, next) * SCALE_1;
  });
  const most = Math.max(...need);
  const least = Math.min(...need);
  const fit = (w / 2 - Math.max(...hs) * SCALE_3 - RING_EDGE) / 2;
  const spacing = Math.max(least, Math.min(most, fit));
  return { spacing, room: need.map((n) => Math.max(0, n - spacing)), hf, hs };
}

export interface WheelLabel {
  full: string;
  /** shown instead of the full name away from the centre */
  short?: string;
  /** what a screen reader says for the value when the label alone says too little ("4 pm" for an hour's "4") */
  spoken?: string;
}

/**
 * A horizontal wheel for a day or a length. Its position is continuous: while you drag, every label keeps its place in
 * one smooth size gradient, large and bright at the centre, smaller and fainter outward. A release, or a tap on a
 * label beside the centre, glides to a value on a critically damped spring, with one light tick per value passed.
 * With `depth` the labels stand on a ring instead (the Planner's days): see ringLayout and RingItem.
 * Memoised: a screen that re-renders around it (a typed subject) leaves the wheel alone when its props hold still.
 */
export const Wheel = React.memo(function Wheel({
  count, index, onChange, label, spacing, minScale, loop = false, colorOn, colorOff, height, textStyle,
  accessibilityLabel, onPressCenter, depth = false, fade,
}: {
  count: number;
  index: number;
  onChange: (i: number) => void;
  label: (i: number) => WheelLabel;
  /** distance between neighbouring centres, px. With depth, only the first guess, until the labels are measured */
  spacing: number;
  /** a neighbour's scale; labels further out shrink a little more (not with depth: the ring sets the scale) */
  minScale: number;
  loop?: boolean;
  colorOn: string;
  colorOff: string;
  height: number;
  textStyle: TextStyle;
  accessibilityLabel: string;
  /** a tap on the value at the centre */
  onPressCenter?: () => void;
  /** the labels stand on a ring in depth, the far ones raised, smaller and soft */
  depth?: boolean;
  /** with depth: the surface behind the wheel, which its two ends fade into */
  fade?: string;
}) {
  const level = useAnimLevel();
  const still = level === 'none';
  // the width cap is for a wide window only: a phone's wheel spans its card exactly as it always has
  const { width: winW, fontScale } = useWindowDimensions();
  const wideWin = winW >= WIDE_AT;
  const pos = useSharedValue(index);
  const start = useSharedValue(index);
  const width = useSharedValue(0);
  const [center, setCenter] = React.useState(index);
  const settled = React.useRef(index);
  const wrap = React.useCallback((k: number) => (loop ? mod(k, count) : Math.min(count - 1, Math.max(0, k))), [loop, count]);

  // ---- the ring's measure: every label's width at the wheel's own text style, read once from hidden text ----
  const ringKey = React.useMemo(() => {
    if (!depth) return '';
    const labs = Array.from({ length: count }, (_, i) => label(i));
    return fontScale + '|' + JSON.stringify(StyleSheet.flatten(textStyle)) + '|'
      + labs.map((l) => l.full + '/' + (l.short ?? '')).join('|');
  }, [depth, count, label, textStyle, fontScale]);
  const memo = depth ? ringMemo.get(ringKey) : undefined;
  const [wheelW, setWheelW] = React.useState(memo?.w ?? 0);
  const [, remeasured] = React.useReducer((x: number) => x + 1, 0);
  const widths = memo?.widths ?? null;
  // the wheel's width goes with the measure, whichever of the two arrives first
  React.useEffect(() => { if (memo && wheelW > 0) memo.w = wheelW; }, [memo, wheelW]);
  const measuring = React.useRef<{ key: string; full?: number[]; short?: number[] }>({ key: '' });
  const ring = React.useMemo(
    () => ringLayout(widths, wheelW, spacing, loop, count),
    [widths, wheelW, spacing, loop, count],
  );
  const sp = depth ? ring.spacing : spacing;
  /** the ring's radius: the first neighbour stands exactly one step's spacing from the centre */
  const radius = sp / Math.sin(STEP);
  const fulls = React.useMemo(
    () => (depth && !widths ? Array.from({ length: count }, (_, i) => label(i).full) : []),
    [depth, widths, count, label],
  );
  const shorts = React.useMemo(
    () => (depth && !widths ? Array.from({ length: count }, (_, i) => label(i).short ?? label(i).full) : []),
    [depth, widths, count, label],
  );
  const measured = (kind: 'full' | 'short') => (e: NativeSyntheticEvent<TextLayoutEventData>) => {
    const lines = e.nativeEvent.lines.map((l) => l.width);
    // one line a label; should a label ever wrap, every label takes the widest line, which only spaces the ring wider
    const ws = lines.length === count ? lines : Array.from({ length: count }, () => Math.max(0, ...lines));
    // a half read for other labels or another font size is dropped
    if (measuring.current.key !== ringKey) measuring.current = { key: ringKey };
    measuring.current[kind] = ws;
    const { full, short } = measuring.current;
    if (!full || !short) return;
    measuring.current = { key: '' };
    ringMemo.set(ringKey, { widths: { full, short }, w: wheelW });
    remeasured();
  };

  // the room the label at the centre asks for, eased in as its full name shows and out as it turns to its short one
  const room = ring.room;
  const push = useDerivedValue(() => {
    if (!depth || room.length === 0) return 0;
    const p = pos.value;
    const r = Math.round(p);
    let out = 0;
    for (let k = r - 1; k <= r + 1; k++) {
      if (!loop && (k < 0 || k >= count)) continue;
      const f = 1 - Math.abs(k - p) / FULL_FADE;
      if (f > 0) out += room[loop ? wrapAt(k, count) : k] * f;
    }
    return out;
  }, [depth, room, loop, count]);

  // the screen behind re-renders on its own (a clock, a store change), so its callbacks go through refs: the
  // gesture is never rebuilt, and a drag under way is never handed a new recogniser
  const changeRef = React.useRef(onChange); changeRef.current = onChange;
  const centerRef = React.useRef(onPressCenter); centerRef.current = onPressCenter;

  const commit = React.useCallback((k: number) => {
    const i = loop ? mod(k, count) : Math.min(count - 1, Math.max(0, k));
    if (i === settled.current) return;
    settled.current = i;
    changeRef.current(i);
  }, [loop, count]);
  const pressCenter = React.useCallback(() => { centerRef.current?.(); }, []);

  // a value set from outside (today, a new custom length) glides there the short way round
  React.useEffect(() => {
    if (settled.current === index) return;
    settled.current = index;
    const r = Math.round(pos.value);
    const target = loop ? r + mod(index - mod(r, count) + Math.floor(count / 2), count) - Math.floor(count / 2) : index;
    cancelAnimation(pos);
    pos.value = still ? target : withSpring(target, SPRING);
  }, [index]);

  useAnimatedReaction(
    () => Math.round(pos.value),
    (r, prev) => {
      if (prev === null || r === prev) return;
      runOnJS(setCenter)(r);
      runOnJS(tick)();
    },
  );

  const { hf, hs } = ring;
  const gesture = React.useMemo(() => {
    const settle = (target: number, velocity: number) => {
      'worklet';
      const t = loop ? target : Math.min(count - 1, Math.max(0, target));
      if (still) {
        pos.value = t;
        runOnJS(commit)(t);
        return;
      }
      pos.value = withSpring(t, { ...SPRING, velocity }, (finished) => {
        if (finished) runOnJS(commit)(t);
      });
    };
    // a tap on the ring goes to the label under the finger where it stands on the ring, the nearer label first where
    // two overlap (as they are drawn), or else to the label standing nearest the tap
    const ringTap = (x: number) => {
      'worklet';
      const p = pos.value;
      const r = Math.round(p);
      const dx = x - width.value / 2;
      let hit = r;
      let found = false;
      let near = r;
      let gap = Infinity;
      for (let j = 0; j <= 6; j++) {
        const k = r + (j % 2 === 1 ? (j + 1) / 2 : -j / 2);
        if (!loop && (k < 0 || k >= count)) continue;
        const d = k - p;
        const ad = Math.abs(d);
        if (ad > TAP_RING) continue;
        const th = Math.max(-TURN_MAX, Math.min(TURN_MAX, d * STEP));
        const sc = 1 / (1 + PERSPECTIVE * (1 - Math.cos(th)));
        const cx = radius * Math.sin(th) + Math.max(-1, Math.min(1, d)) * push.value;
        const i = loop ? wrapAt(k, count) : k;
        const f = Math.min(1, ad / FULL_FADE);
        const half = hf.length ? (hf[i] + (hs[i] - hf[i]) * f) * sc + TAP_SLOP : 0;
        const g = Math.abs(cx - dx);
        if (!found && g <= half) { hit = k; found = true; }
        if (g < gap) { gap = g; near = k; }
      }
      return found ? hit : near;
    };
    const pan = Gesture.Pan()
      .activeOffsetX([-8, 8])
      .failOffsetY([-14, 14])
      .onStart(() => {
        cancelAnimation(pos);
        start.value = pos.value;
      })
      .onUpdate((e) => {
        let p = start.value - e.translationX / sp;
        if (!loop) {
          // past either end the wheel resists
          if (p < 0) p *= 0.35;
          else if (p > count - 1) p = count - 1 + (p - (count - 1)) * 0.35;
        }
        pos.value = p;
      })
      .onEnd((e) => {
        const base = Math.round(start.value);
        const t = Math.min(base + 3, Math.max(base - 3, Math.round(pos.value - (e.velocityX / sp) * 0.16)));
        settle(t, -e.velocityX / sp);
      });
    const tap = Gesture.Tap()
      .maxDuration(260)
      .onEnd((e) => {
        const r = Math.round(pos.value);
        const k = depth
          ? ringTap(e.x)
          : Math.min(r + TAP_REACH, Math.max(r - TAP_REACH, Math.round(pos.value + (e.x - width.value / 2) / sp)));
        if (k === r) {
          runOnJS(pressCenter)();
          return;
        }
        settle(k, 0);
      });
    return Gesture.Race(pan, tap);
  }, [sp, count, loop, still, commit, pressCenter, depth, radius, hf, hs]);

  const step = (by: 1 | -1) => {
    const t = Math.round(pos.value) + by;
    const target = loop ? t : Math.min(count - 1, Math.max(0, t));
    if (still) {
      pos.value = target;
      commit(target);
      return;
    }
    pos.value = withSpring(target, SPRING, (finished) => {
      'worklet';
      if (finished) runOnJS(commit)(target);
    });
  };

  const keys: number[] = [];
  for (let k = center - WINDOW; k <= center + WINDOW; k++) {
    if (loop || (k >= 0 && k < count)) keys.push(k);
  }

  // the blurred copy is drawn by its shadow alone. Android draws a text's shadow at the text's own alpha when the
  // shadow's colour is opaque, which for clear text is nothing, so the shadow's colour carries an alpha of its own
  const blur = React.useMemo(() => ({
    color: 'transparent',
    textShadowColor: tint(colorOff, 0.9),
    textShadowRadius: BLUR_RADIUS,
    textShadowOffset: { width: 0, height: 0 },
  }), [colorOff]);
  const fadeIn = React.useMemo(() => (fade ? ([veil(fade), clear(fade)] as const) : null), [fade]);
  const fadeOut = React.useMemo(() => (fade ? ([clear(fade), veil(fade)] as const) : null), [fade]);

  return (
    <GestureDetector gesture={gesture}>
      <View
        style={[{ height, overflow: 'hidden' }, wideWin && { width: '100%', maxWidth: MAX_W, alignSelf: 'center' }]}
        onLayout={(e: LayoutChangeEvent) => {
          const w = e.nativeEvent.layout.width;
          width.value = w;
          if (depth && w !== wheelW) setWheelW(w);
        }}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ text: label(wrap(index)).spoken ?? label(wrap(index)).full }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(ev) => step(ev.nativeEvent.actionName === 'increment' ? 1 : -1)}
      >
        {depth
          ? keys.map((k) => (
            <RingItem
              key={k} k={k} pos={pos} push={push} lab={label(wrap(k))} radius={radius} z={10 - Math.abs(k - center)}
              colorOn={colorOn} colorOff={colorOff} blur={blur} textStyle={textStyle}
            />
          ))
          : keys.map((k) => (
            <WheelItem
              key={k} k={k} pos={pos} lab={label(wrap(k))} spacing={spacing} minScale={minScale}
              colorOn={colorOn} colorOff={colorOff} textStyle={textStyle}
            />
          ))}
        {depth && fadeIn && fadeOut ? (
          <>
            <LinearGradient
              pointerEvents="none" colors={fadeIn} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
              style={[st.fade, st.fadeLeft]}
            />
            <LinearGradient
              pointerEvents="none" colors={fadeOut} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
              style={[st.fade, st.fadeRight]}
            />
          </>
        ) : null}
        {depth && !widths ? (
          // read once, never seen: one line a label, at the labels' own style and font cap
          <View pointerEvents="none" style={st.measure} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[st.label, textStyle]} onTextLayout={measured('full')}>
              {fulls.join('\n')}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[st.label, textStyle]} onTextLayout={measured('short')}>
              {shorts.join('\n')}
            </Text>
          </View>
        ) : null}
      </View>
    </GestureDetector>
  );
});

function WheelItem({ k, pos, lab, spacing, minScale, colorOn, colorOff, textStyle }: {
  k: number; pos: SharedValue<number>; lab: WheelLabel; spacing: number; minScale: number;
  colorOn: string; colorOff: string; textStyle: TextStyle;
}) {
  const hasShort = !!lab.short;
  const box = useAnimatedStyle(() => {
    const d = k - pos.value;
    const ad = Math.abs(d);
    const scale = ad <= 1 ? 1 - (1 - minScale) * ad : Math.max(minScale - 0.12, minScale - 0.08 * (ad - 1));
    return {
      opacity: ad <= 1 ? 1 - 0.45 * ad : Math.max(0, 0.55 - 0.42 * (ad - 1)),
      transform: [{ translateX: spacing * d * (1 - 0.07 * Math.min(ad, 3)) }, { scale }] as const,
    };
  });
  const fullStyle = useAnimatedStyle(() => {
    const ad = Math.abs(k - pos.value);
    return {
      color: interpolateColor(Math.min(ad, 0.7), [0, 0.7], [colorOn, colorOff]),
      opacity: hasShort ? Math.max(0, 1 - ad / FULL_FADE) : 1,
    };
  });
  const shortStyle = useAnimatedStyle(() => {
    const ad = Math.abs(k - pos.value);
    return {
      color: interpolateColor(Math.min(ad, 0.7), [0, 0.7], [colorOn, colorOff]),
      opacity: Math.min(1, ad / FULL_FADE),
    };
  });
  // the labels sit a fixed spacing apart, so a large system font may grow them only a little before neighbours collide
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, st.centre, box]}>
      <View style={st.stack}>
        <Animated.Text numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[st.label, textStyle, fullStyle]}>{lab.full}</Animated.Text>
        {hasShort ? (
          <Animated.Text numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[st.label, textStyle, st.short, shortStyle]}>{lab.short}</Animated.Text>
        ) : null}
      </View>
    </Animated.View>
  );
}

/**
 * A label on the ring. It turns STEP per value from the centre: it stands at R·sin θ across, rises by LIFT as it
 * recedes (depth 1 − cos θ) and shrinks with depth, and the nearer labels are drawn over the farther ones. Its sharp
 * copy hands over to a blurred one as it goes deep. A wide name at the centre parts the ring by `push`.
 */
function RingItem({ k, pos, push, lab, radius, z, colorOn, colorOff, blur, textStyle }: {
  k: number; pos: SharedValue<number>; push: SharedValue<number>; lab: WheelLabel; radius: number; z: number;
  colorOn: string; colorOff: string; blur: TextStyle; textStyle: TextStyle;
}) {
  const hasShort = !!lab.short;
  const box = useAnimatedStyle(() => {
    const d = k - pos.value;
    const th = Math.max(-TURN_MAX, Math.min(TURN_MAX, d * STEP));
    const deep = 1 - Math.cos(th);
    return {
      opacity: interpolate(Math.abs(d), RING_AT, RING_OPACITY, Extrapolation.CLAMP),
      transform: [
        { translateX: radius * Math.sin(th) + Math.max(-1, Math.min(1, d)) * push.value },
        { translateY: -LIFT * deep },
        { scale: 1 / (1 + PERSPECTIVE * deep) },
      ] as const,
    };
  });
  const fullStyle = useAnimatedStyle(() => {
    const ad = Math.abs(k - pos.value);
    return {
      color: interpolateColor(Math.min(ad, 0.7), [0, 0.7], [colorOn, colorOff]),
      opacity: hasShort ? Math.max(0, 1 - ad / FULL_FADE) : 1 - softAt(ad),
    };
  });
  const shortStyle = useAnimatedStyle(() => {
    const ad = Math.abs(k - pos.value);
    return {
      color: interpolateColor(Math.min(ad, 0.7), [0, 0.7], [colorOn, colorOff]),
      opacity: Math.min(1, ad / FULL_FADE) * (1 - softAt(ad)),
    };
  });
  const blurStyle = useAnimatedStyle(() => ({ opacity: softAt(Math.abs(k - pos.value)) }));
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, st.centre, { zIndex: z }, box]}>
      <View style={st.stack}>
        <Animated.Text numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[st.label, textStyle, fullStyle]}>{lab.full}</Animated.Text>
        {hasShort ? (
          <Animated.Text numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[st.label, textStyle, st.short, shortStyle]}>{lab.short}</Animated.Text>
        ) : null}
        <Animated.Text numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[st.label, textStyle, st.blur, blur, blurStyle]}>
          {lab.short ?? lab.full}
        </Animated.Text>
      </View>
    </Animated.View>
  );
}

const st = StyleSheet.create({
  centre: { alignItems: 'center', justifyContent: 'center' },
  stack: { alignItems: 'center' },
  // a label in a wheel of fixed height: no font padding, centred in its line (the caller's style sets the line)
  label: { includeFontPadding: false, textAlignVertical: 'center' },
  short: { position: 'absolute', left: 0, right: 0, textAlign: 'center' },
  // the blurred copy: a box BLUR_PAD larger all round, padded back, so its text lands exactly on the sharp copy's
  blur: {
    position: 'absolute', left: -BLUR_PAD, right: -BLUR_PAD, top: -BLUR_PAD,
    paddingHorizontal: BLUR_PAD, paddingVertical: BLUR_PAD, textAlign: 'center',
  },
  // the ring's ends fade into the surface behind, over the labels
  fade: { position: 'absolute', top: 0, bottom: 0, width: '18%', zIndex: 20 },
  fadeLeft: { left: 0 },
  fadeRight: { right: 0 },
  measure: { position: 'absolute', left: 0, top: 0, width: 4000, opacity: 0, alignItems: 'flex-start' },
});
