import React from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { C, CHROME_FONT_MAX, F, MIN, TRACK, oneLine } from '../theme';
import { DAY_NAMES } from '../utils';
import { useTheme } from './UI';
import { CHANGE, useAnimLevel } from './Motion';

const FULL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** every weekday, Monday first (0) to Sunday (6), the order of DAY_NAMES */
export const ALL_DAYS: readonly number[] = [0, 1, 2, 3, 4, 5, 6];

/**
 * One weekday of a Repeat row, like an alarm clock's: a flat circle, outlined at rest and tinted in the accent when the
 * day is on. 36 across, reaching 44 with its slop.
 */
export function DayToggle({ index, on, onPress }: { index: number; on: boolean; onPress: () => void }) {
  const theme = useTheme();
  const level = useAnimLevel();
  const lit = useSharedValue(on ? 1 : 0);
  React.useEffect(() => {
    lit.value = level === 'none' ? (on ? 1 : 0) : withTiming(on ? 1 : 0, CHANGE);
  }, [on, level]);
  const litStyle = useAnimatedStyle(() => ({ opacity: lit.value }));
  const restStyle = useAnimatedStyle(() => ({ opacity: 1 - lit.value }));
  return (
    <Pressable
      onPress={onPress} hitSlop={4} style={({ pressed }) => [st.dayToggle, pressed && { opacity: 0.6 }]}
      accessibilityRole="switch" accessibilityState={{ checked: on }} accessibilityLabel={FULL_DAYS[index]}
    >
      <Animated.View pointerEvents="none" style={[st.edge, { borderColor: theme === 'minimal' ? MIN.border : C.outline }, restStyle]} />
      <Animated.View pointerEvents="none" style={[st.edge, { backgroundColor: C.accent + '1F', borderColor: C.accent + '66' }, litStyle]} />
      <Text style={[st.text, on && { color: C.accent, fontFamily: F.smSemi }]} maxFontSizeMultiplier={CHROME_FONT_MAX}>
        {DAY_NAMES[index][0]}
      </Text>
    </Pressable>
  );
}

/**
 * The seven weekdays in a row, spread across the sheet: a habit's Repeat, a ToDo's chosen days, a new block's Repeat on.
 * `value` holds the days that are on (0 Monday); a tap hands its day to `onToggle`, which decides (for instance that one
 * day always stays on).
 */
export function DayToggles({ value, onToggle, label = 'Repeat', style }: {
  value: readonly number[]; onToggle: (day: number) => void;
  /** what the row is called to a screen reader */
  label?: string;
  style?: ViewStyle;
}) {
  return (
    <View style={[st.row, style]} accessibilityLabel={label}>
      {ALL_DAYS.map((i) => (
        <DayToggle key={i} index={i} on={value.includes(i)} onPress={() => onToggle(i)} />
      ))}
    </View>
  );
}

/**
 * A day toggled in or out of a set, kept sorted. With `keepOne`, the last day on stays on: null is returned instead, so
 * the caller can say "At least one day".
 */
export function toggledDay(days: readonly number[], day: number, keepOne = true): number[] | null {
  if (days.includes(day)) {
    if (keepOne && days.length === 1) return null;
    return days.filter((d) => d !== day);
  }
  return [...days, day].sort((a, b) => a - b);
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  dayToggle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  edge: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 18, borderWidth: 1 },
  text: { color: C.textDim, fontFamily: F.smMed, ...oneLine(13), letterSpacing: TRACK.small },
});
