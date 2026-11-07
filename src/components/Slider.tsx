import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { C, MIN, neuInset, neuRaised } from '../theme';
import { tick } from '../haptics';
import { useTheme } from './UI';
import { useAnimLevel } from './Motion';

const TRACK_H = 10;
const KNOB = 26;
/** the knob's travel ends this far in from the track's ends, so its whole round body stays over the track */
const PAD = KNOB / 2;

/**
 * A slider in the material: a carved track, the accent filling it up to a raised knob. Drag the knob (or tap the track)
 * and it follows the finger on the UI thread; a small tick is felt at each step. `onChange` hears every new step while
 * it moves, `onDone` the value it was let go at. A screen reader hears an adjustable control and can step it.
 */
export function Slider({ value, onChange, onDone, min = 0, max = 1, step = 0.05, label, format, color }: {
  value: number; onChange?: (v: number) => void; onDone?: (v: number) => void;
  min?: number; max?: number; step?: number; label: string; format?: (v: number) => string; color?: string;
}) {
  const theme = useTheme();
  const level = useAnimLevel();
  const [w, setW] = React.useState(0);
  const span = Math.max(1, w - PAD * 2);
  const frac = (v: number) => (Math.min(max, Math.max(min, v)) - min) / (max - min || 1);
  const p = useSharedValue(frac(value));
  const press = useSharedValue(0);
  const lastStep = useSharedValue(Math.round(frac(value) / (step / (max - min || 1))));
  const dragging = React.useRef(false);
  // follows the value from outside, unless the finger is on it
  React.useEffect(() => {
    if (dragging.current) return;
    p.value = level === 'none' ? frac(value) : withTiming(frac(value), { duration: 180 });
  }, [value, min, max, level]);

  const stepOf = (f: number) => Math.round(f * (max - min) / step);
  const toValue = (f: number) => Math.min(max, Math.max(min, min + stepOf(f) * step));
  const moved = (f: number) => { tick(); onChange?.(toValue(f)); };
  const released = (f: number) => { dragging.current = false; onDone?.(toValue(f)); };
  const began = () => { dragging.current = true; };

  const gesture = React.useMemo(() => {
    const at = (x: number) => {
      'worklet';
      return Math.min(1, Math.max(0, (x - PAD) / span));
    };
    const follow = (x: number) => {
      'worklet';
      const f = at(x);
      p.value = f;
      const n = Math.round(f * (max - min) / step);
      if (n !== lastStep.value) { lastStep.value = n; runOnJS(moved)(f); }
    };
    const pan = Gesture.Pan()
      // a sideways drag only: an up or down one is the page's scroll
      .activeOffsetX([-6, 6]).failOffsetY([-12, 12])
      // it follows only once the drag is sideways (a page scroll that starts on it changes nothing)
      .onStart((e) => { press.value = withTiming(1, { duration: 90 }); runOnJS(began)(); follow(e.x); })
      .onUpdate((e) => follow(e.x))
      .onFinalize((_e, success) => {
        press.value = withSpring(0, { damping: 18, stiffness: 260 });
        if (success) runOnJS(released)(p.value);
      });
    const tap = Gesture.Tap().onEnd((e, ok) => {
      if (!ok) return;
      follow(e.x);
      runOnJS(released)(p.value);
    });
    return Gesture.Race(pan, tap);
  }, [span, min, max, step, onChange, onDone]);

  const c = color || C.accent;
  // the fill is the track's full width, slid in from the left: a transform, never a width animated per frame
  const fill = useAnimatedStyle(() => ({ width: w, transform: [{ translateX: PAD + p.value * span - w }] }));
  const knob = useAnimatedStyle(() => ({
    transform: [{ translateX: p.value * span }, { scale: 1 - 0.08 * press.value }] as const,
  }));
  const minimal = theme === 'minimal';
  const v = toValue(frac(value));
  const said = format ? format(v) : String(Math.round(v * 100) / 100);
  return (
    <GestureDetector gesture={gesture}>
      <View
        style={st.box} onLayout={(e) => setW(e.nativeEvent.layout.width)}
        accessible accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ text: said }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          const next = Math.min(max, Math.max(min, v + (e.nativeEvent.actionName === 'increment' ? step : -step)));
          onChange?.(next);
          onDone?.(next);
        }}
      >
        <View style={[st.track, minimal ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border } : { backgroundColor: C.inset, ...neuInset('hairline') }]}>
          <Animated.View style={[st.fill, { backgroundColor: c + (minimal ? 'CC' : 'B3') }, fill]} />
        </View>
        {w > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[st.knob, minimal ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: c } : { backgroundColor: C.card, ...neuRaised('low') }, knob]}
          >
            <View style={[st.dot, { backgroundColor: c }]} />
          </Animated.View>
        ) : null}
      </View>
    </GestureDetector>
  );
}

const st = StyleSheet.create({
  box: { height: 44, justifyContent: 'center' },
  track: { height: TRACK_H, borderRadius: TRACK_H / 2, overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: TRACK_H / 2 },
  knob: {
    position: 'absolute', left: 0, top: (44 - KNOB) / 2, width: KNOB, height: KNOB, borderRadius: KNOB / 2,
    alignItems: 'center', justifyContent: 'center',
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
