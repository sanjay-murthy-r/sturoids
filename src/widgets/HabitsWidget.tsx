import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { C, CHROME_FONT_MAX, F, MIN, TRACK, oneLine } from '../theme';
import { useStore } from '../store';
import { habitDueOn, streaks } from '../utils';
import { SectionTitle, useTheme } from '../components/UI';
import { Bouncy, CHANGE, useAnimLevel, useLoop } from '../components/Motion';
import { FlowPlaceholder, useBoardToday } from './kit';
import { useTodaysHabits } from './data';
import type { WidgetProps } from './types';

/** Today's habits as flat chips, ticked in place. */
export function HabitsWidget({ editing }: WidgetProps) {
  const today = useBoardToday();
  const habits = useTodaysHabits();
  const toggle = useStore((s) => s.toggleHabitToday);
  // a run of two or more on a day it is due: the chip carries its flame, which flickers until the tick lands
  const onStreak = React.useMemo(() => new Set(
    habits.filter((h) => habitDueOn(h, today) && streaks(h.doneDates, h.days).current >= 2).map((h) => h.id),
  ), [habits, today]);
  if (!habits.length) return editing ? <FlowPlaceholder title="Habits" note="Today's habits, ticked in place." /> : null;
  return (
    <View>
      <SectionTitle>Habits</SectionTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {habits.map((h) => (
          <HabitChip
            key={h.id} id={h.id} title={h.title} done={h.doneDates.includes(today)} flame={onStreak.has(h.id)} onToggle={toggle}
          />
        ))}
      </View>
    </View>
  );
}

/**
 * One of today's habits: a flat chip, outlined until it is ticked and tinted green once it is. One on a streak of two or
 * more carries its flame in place of the empty circle; while the streak is at risk (not ticked yet) the flame flickers
 * very gently until the tick lands (useLoop: only with every animation on, Today in view and the app in front).
 * Memoised, so the minute turning never re-renders the chips.
 */
const HabitChip = React.memo(function HabitChip({ id, title, done, flame, onToggle }: {
  id: string; title: string; done: boolean; flame: boolean; onToggle: (id: string) => void;
}) {
  const atRisk = flame && !done;
  const theme = useTheme();
  const level = useAnimLevel();
  // the resting edge and the green tint cross over, and so do the two inks, as a chip's do
  const on = useSharedValue(done ? 1 : 0);
  React.useEffect(() => {
    on.value = level === 'none' ? (done ? 1 : 0) : withTiming(done ? 1 : 0, CHANGE);
  }, [done, level]);
  const litStyle = useAnimatedStyle(() => ({ opacity: on.value }));
  const restStyle = useAnimatedStyle(() => ({ opacity: 1 - on.value }));
  const flicker = useLoop(atRisk, 1800);
  const flameStyle = useAnimatedStyle(() => ({
    opacity: 1 - 0.4 * flicker.value,
    transform: [{ scale: 1 - 0.04 * flicker.value }],
  }));
  // both inks in one face, so the lit one lies exactly over the resting one
  const textStyle = [st.habitChipText, done && { fontFamily: F.smSemi }];
  return (
    <Bouncy
      onPress={() => onToggle(id)} scaleTo={0.94} radius={999} hitSlop={HABIT_CHIP_SLOP} style={st.habitChip}
      accessibilityRole="checkbox" accessibilityState={{ checked: done }}
      accessibilityLabel={title + (atRisk ? ', streak at risk' : '')}
    >
      <Animated.View pointerEvents="none" style={[st.habitChipEdge, { borderColor: theme === 'minimal' ? MIN.border : C.outline }, restStyle]} />
      <Animated.View pointerEvents="none" style={[st.habitChipEdge, { backgroundColor: C.green + '1F', borderColor: C.green + '66' }, litStyle]} />
      <View style={st.habitChipRow}>
        <View style={st.habitChipIcon}>
          <Animated.View style={restStyle}>
            <Animated.View style={flameStyle}>
              <Ionicons name={flame ? 'flame-outline' : 'ellipse-outline'} size={13} color={C.textFaint} />
            </Animated.View>
          </Animated.View>
          <Animated.View style={[st.ink, litStyle]}>
            <Ionicons name="checkmark-circle" size={13} color={C.green} />
          </Animated.View>
        </View>
        {/* fixed chrome: chips sit in rows, so their words grow with the phone's font size only up to 1.3 */}
        <View style={st.habitChipWords}>
          <Animated.Text style={[textStyle, restStyle]} numberOfLines={1} maxFontSizeMultiplier={CHROME_FONT_MAX}>{title}</Animated.Text>
          <Animated.Text
            style={[textStyle, st.ink, { color: C.green }, litStyle]} numberOfLines={1} maxFontSizeMultiplier={CHROME_FONT_MAX}
            importantForAccessibility="no" accessibilityElementsHidden
          >
            {title}
          </Animated.Text>
        </View>
      </View>
    </Bouncy>
  );
});

/** a habit chip reaches 44 dp tall with its slop */
const HABIT_CHIP_SLOP = { top: 10, bottom: 10, left: 5, right: 5 };

const st = StyleSheet.create({
  // a habit chip, as a small chip is: flat, its hairline edge drawn by its two layers
  habitChip: {
    paddingVertical: 5, paddingHorizontal: 11, borderRadius: 999,
    marginRight: 10, marginBottom: 10, overflow: 'hidden', maxWidth: '100%',
  },
  habitChipEdge: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 999, borderWidth: 1 },
  habitChipRow: { flexDirection: 'row', alignItems: 'center' },
  // a long title shortens with an ellipsis inside its chip instead of running past the edge of the board
  habitChipWords: { flexShrink: 1 },
  habitChipIcon: { marginRight: 6 },
  habitChipText: { color: C.textDim, fontFamily: F.smMed, ...oneLine(12), letterSpacing: TRACK.fine },
  /** a second ink laid exactly over the first, for colours that cross over */
  ink: { position: 'absolute', top: 0, left: 0, right: 0 },
});
