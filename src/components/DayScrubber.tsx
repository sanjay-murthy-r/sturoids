import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing, runOnJS, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming,
} from 'react-native-reanimated';
import { C, F, T } from '../theme';
import { DAY_NAMES, DayName } from '../utils';
import { useTheme } from './UI';
import { RISE_OUT, useAnimLevel } from './Motion';
import { tick } from '../haptics';

const FULL: Record<DayName, string> = {
  Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday',
};
/** a swipe moves a day once it travels this far, or this fast */
const SWIPE_DIST = 44;
const SWIPE_VEL = 600;
/** the row follows the finger at this fraction of its travel, so the day feels held rather than loose */
const DRAG = 0.3;
/** how far the old day leaves, and the new day arrives from, to the side, points */
const SLIDE_X = 22;
const EXIT = { duration: 120, easing: Easing.in(Easing.quad) };
const ENTER = { duration: 240, easing: Easing.out(Easing.cubic) };
const HIT = { top: 16, bottom: 16, left: 10, right: 10 };

const around = (d: DayName, by: number) => DAY_NAMES[(DAY_NAMES.indexOf(d) + by + 7) % 7];

/**
 * The planner's day, today first: the chosen day large in the accent, its neighbours small and faded either side.
 * Tap a neighbour or swipe to move a day, and the week wraps; away from today a Today link comes back. Flat on
 * purpose: one control, with no raised or carved parts.
 *
 * A change carries the row on the way it is going and fades it out; the day swaps while nothing can be seen, and the
 * new day slides in from the other side. A released swipe continues its own motion, so the row never jumps.
 */
export function DayScrubber({ value, today, onChange }: {
  value: DayName; today: DayName; onChange: (d: DayName) => void;
}) {
  useTheme(); // repaints on a new accent
  const level = useAnimLevel();
  const drag = useSharedValue(0);
  const shift = useSharedValue(0);
  const fade = useSharedValue(1);
  /** the side the new day arrives from: 1 after moving forward, -1 back, 0 for a jump to today */
  const from = React.useRef(0);
  const mounted = React.useRef(false);
  // the swap runs when the exit animation ends, so it reads the props live
  const live = React.useRef({ value, today, onChange });
  live.current = { value, today, onChange };

  const commit = React.useCallback((by: number) => {
    const { value: v, today: t, onChange: set } = live.current;
    from.current = by;
    set(by === 0 ? t : around(v, by));
  }, []);

  /** `by` steps a day forward (1) or back (-1); 0 goes to today */
  const go = React.useCallback((by: number) => {
    tick();
    if (level === 'none') {
      drag.value = 0;
      commit(by);
      return;
    }
    fade.value = withTiming(0, EXIT);
    drag.value = withTiming(-by * SLIDE_X, EXIT, (done) => {
      'worklet';
      if (done) runOnJS(commit)(by);
    });
  }, [level, commit]);

  React.useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const by = from.current;
    from.current = 0;
    if (level === 'none') {
      drag.value = 0;
      shift.value = 0;
      fade.value = 1;
      return;
    }
    // the old day has faded out, so moving the row to the side the new day comes from never shows
    drag.value = 0;
    shift.value = withSequence(withTiming(by * SLIDE_X, { duration: 0 }), withTiming(0, ENTER));
    fade.value = withTiming(1, ENTER);
  }, [value]);

  // horizontal only, and it claims the touch early, so a deliberate swipe here moves the day rather than the tab
  const pan = React.useMemo(() => Gesture.Pan()
    .activeOffsetX([-8, 8])
    .failOffsetY([-14, 14])
    .onUpdate((e) => { drag.value = e.translationX * DRAG; })
    .onEnd((e) => {
      const by = e.translationX < -SWIPE_DIST || e.velocityX < -SWIPE_VEL ? 1
        : e.translationX > SWIPE_DIST || e.velocityX > SWIPE_VEL ? -1 : 0;
      if (by === 0) drag.value = withSpring(0, RISE_OUT);
      else runOnJS(go)(by);
    }), [go]);

  const rowStyle = useAnimatedStyle(() => ({
    opacity: fade.value,
    transform: [{ translateX: drag.value + shift.value }],
  }));

  const away = value !== today;
  return (
    <View style={st.wrap}>
      <GestureDetector gesture={pan}>
        <Animated.View
          style={[st.row, rowStyle]}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Day"
          accessibilityValue={{ text: FULL[value] + (away ? '' : ', today') }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => go(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
        >
          <Pressable onPress={() => go(-1)} hitSlop={HIT}>
            <Text style={st.side}>{around(value, -1)}</Text>
          </Pressable>
          <Text style={[T.h1, { color: C.accent }]} numberOfLines={1}>{FULL[value]}</Text>
          <Pressable onPress={() => go(1)} hitSlop={HIT}>
            <Text style={st.side}>{around(value, 1)}</Text>
          </Pressable>
        </Animated.View>
      </GestureDetector>
      {away ? (
        <Pressable onPress={() => go(0)} hitSlop={12}>
          <Text style={[st.today, { color: C.accent }]}>Today</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, marginBottom: 22 },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: 16, paddingVertical: 6 },
  side: { color: C.textFaint, fontFamily: F.med, fontSize: 13, letterSpacing: 0.1 },
  today: { fontFamily: F.semi, fontSize: 13 },
});
