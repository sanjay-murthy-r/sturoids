import React from 'react';
import { LayoutChangeEvent, StyleSheet, TextStyle, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation, interpolateColor, runOnJS, useAnimatedReaction, useAnimatedStyle, useSharedValue, withSpring,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
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

const mod = (n: number, m: number) => ((n % m) + m) % m;

export interface WheelLabel {
  full: string;
  /** shown instead of the full name away from the centre */
  short?: string;
}

/**
 * A horizontal wheel for a day or a length. Its position is continuous: while you drag, every label keeps its place in
 * one smooth size gradient, large and bright at the centre, smaller and fainter outward. A release, or a tap on a
 * label beside the centre, glides to a value on a critically damped spring, with one light tick per value passed.
 * Memoised: a screen that re-renders around it (a typed subject) leaves the wheel alone when its props hold still.
 */
export const Wheel = React.memo(function Wheel({
  count, index, onChange, label, spacing, minScale, loop = false, colorOn, colorOff, height, textStyle,
  accessibilityLabel, onPressCenter,
}: {
  count: number;
  index: number;
  onChange: (i: number) => void;
  label: (i: number) => WheelLabel;
  /** distance between neighbouring centres, px */
  spacing: number;
  /** a neighbour's scale; labels further out shrink a little more */
  minScale: number;
  loop?: boolean;
  colorOn: string;
  colorOff: string;
  height: number;
  textStyle: TextStyle;
  accessibilityLabel: string;
  /** a tap on the value at the centre */
  onPressCenter?: () => void;
}) {
  const level = useAnimLevel();
  const still = level === 'none';
  // the width cap is for a wide window only: a phone's wheel spans its card exactly as it always has
  const wideWin = useWindowDimensions().width >= WIDE_AT;
  const pos = useSharedValue(index);
  const start = useSharedValue(index);
  const width = useSharedValue(0);
  const [center, setCenter] = React.useState(index);
  const settled = React.useRef(index);
  const wrap = React.useCallback((k: number) => (loop ? mod(k, count) : Math.min(count - 1, Math.max(0, k))), [loop, count]);

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
    const pan = Gesture.Pan()
      .activeOffsetX([-8, 8])
      .failOffsetY([-14, 14])
      .onStart(() => {
        cancelAnimation(pos);
        start.value = pos.value;
      })
      .onUpdate((e) => {
        let p = start.value - e.translationX / spacing;
        if (!loop) {
          // past either end the wheel resists
          if (p < 0) p *= 0.35;
          else if (p > count - 1) p = count - 1 + (p - (count - 1)) * 0.35;
        }
        pos.value = p;
      })
      .onEnd((e) => {
        const base = Math.round(start.value);
        const t = Math.min(base + 3, Math.max(base - 3, Math.round(pos.value - (e.velocityX / spacing) * 0.16)));
        settle(t, -e.velocityX / spacing);
      });
    const tap = Gesture.Tap()
      .maxDuration(260)
      .onEnd((e) => {
        const r = Math.round(pos.value);
        const k = Math.min(r + TAP_REACH, Math.max(r - TAP_REACH, Math.round(pos.value + (e.x - width.value / 2) / spacing)));
        if (k === r) {
          runOnJS(pressCenter)();
          return;
        }
        settle(k, 0);
      });
    return Gesture.Race(pan, tap);
  }, [spacing, count, loop, still, commit, pressCenter]);

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

  return (
    <GestureDetector gesture={gesture}>
      <View
        style={[{ height, overflow: 'hidden' }, wideWin && { width: '100%', maxWidth: MAX_W, alignSelf: 'center' }]}
        onLayout={(e: LayoutChangeEvent) => { width.value = e.nativeEvent.layout.width; }}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ text: label(wrap(index)).full }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(ev) => step(ev.nativeEvent.actionName === 'increment' ? 1 : -1)}
      >
        {keys.map((k) => (
          <WheelItem
            key={k} k={k} pos={pos} lab={label(wrap(k))} spacing={spacing} minScale={minScale}
            colorOn={colorOn} colorOff={colorOff} textStyle={textStyle}
          />
        ))}
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
      opacity: hasShort ? Math.max(0, 1 - ad / 0.55) : 1,
    };
  });
  const shortStyle = useAnimatedStyle(() => {
    const ad = Math.abs(k - pos.value);
    return {
      color: interpolateColor(Math.min(ad, 0.7), [0, 0.7], [colorOn, colorOff]),
      opacity: Math.min(1, ad / 0.55),
    };
  });
  // the labels sit a fixed spacing apart, so a large system font may grow them only a little before neighbours collide
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, st.centre, box]}>
      <View style={st.stack}>
        <Animated.Text numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[textStyle, fullStyle]}>{lab.full}</Animated.Text>
        {hasShort ? (
          <Animated.Text numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[textStyle, st.short, shortStyle]}>{lab.short}</Animated.Text>
        ) : null}
      </View>
    </Animated.View>
  );
}

const st = StyleSheet.create({
  centre: { alignItems: 'center', justifyContent: 'center' },
  stack: { alignItems: 'center' },
  short: { position: 'absolute', left: 0, right: 0, textAlign: 'center' },
});
