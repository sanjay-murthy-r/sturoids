import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeOut } from 'react-native-reanimated';
import { C, F, MIN, NEU, S } from '../theme';
import { JournalEntry } from '../store';
import { MOODS, journalDateParts, shiftKey } from '../journal';
import { todayKey } from '../utils';
import { Bouncy, riseIn, useAnimLevel } from './Motion';
import { useTheme } from './UI';
import { tick } from '../haptics';

type Scale = JournalEntry['mood'];

/**
 * The day's check-out: how it felt (five flat moods) and how it went (five stars). It sits above the journal's
 * footer, never over the page, and never insists: when it offers itself after writing it carries Skip, and once
 * anything is picked it says Done.
 */
export function DayCheckout({ dateKey, mood, rating, offered, onMood, onRating, onSkip, onDone }: {
  dateKey: string; mood: Scale; rating: Scale;
  /** shown by itself after writing, rather than opened from the day button */
  offered: boolean;
  onMood: (m: Scale) => void; onRating: (r: Scale) => void; onSkip: () => void; onDone: () => void;
}) {
  const theme = useTheme();
  const level = useAnimLevel();
  const today = todayKey();
  const title = dateKey === today ? 'How was today?'
    : dateKey === shiftKey(today, -1) ? 'How was yesterday?'
      : 'How was ' + journalDateParts(dateKey).day + '?';
  const skip = offered && !mood && !rating;
  const surface = theme === 'minimal'
    ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: MIN.border }
    : { backgroundColor: C.card, ...NEU.raisedMid };

  return (
    <Animated.View
      entering={level === 'none' ? undefined : riseIn}
      exiting={level === 'none' ? undefined : FadeOut.duration(160)}
      style={[st.card, surface]}
    >
      <View style={st.head}>
        <Text style={[st.title, { flex: 1, marginRight: 12 }]} numberOfLines={1}>{title}</Text>
        <Pressable onPress={skip ? onSkip : onDone} hitSlop={10} accessibilityRole="button">
          <Text style={[st.action, { color: skip ? C.textDim : C.gold }]}>{skip ? 'Skip' : 'Done'}</Text>
        </Pressable>
      </View>

      <View style={st.moods}>
        {MOODS.map((m) => {
          const on = mood === m.value;
          return (
            <Bouncy
              key={m.value}
              onPress={() => { tick(); onMood(on ? undefined : m.value); }}
              scaleTo={0.92}
              radius={14}
              style={[st.mood, on && { backgroundColor: C.gold + '24' }]}
              accessibilityRole="button"
              accessibilityLabel={m.label + (on ? ', picked' : '')}
            >
              <Ionicons name={m.icon as any} size={22} color={on ? C.gold : C.textDim} />
              <Text style={[st.moodLabel, on && { color: C.gold, fontFamily: F.semi }]}>{m.label}</Text>
            </Bouncy>
          );
        })}
      </View>

      <View style={st.rateRow}>
        <Text style={st.rateLabel}>Rate the day</Text>
        <View style={st.stars} accessibilityRole="adjustable" accessibilityLabel={rating ? rating + ' of 5 stars' : 'Not rated'}>
          {[1, 2, 3, 4, 5].map((n) => {
            const lit = !!rating && n <= rating;
            return (
              <Pressable
                key={n}
                hitSlop={4}
                onPress={() => { tick(); onRating(rating === n ? undefined : (n as Scale)); }}
                accessibilityLabel={n + (n === 1 ? ' star' : ' stars')}
                accessibilityRole="button"
                accessibilityState={{ selected: rating === n }}
                style={st.star}
              >
                <Ionicons name={lit ? 'star' : 'star-outline'} size={24} color={lit ? C.gold : C.textFaint} />
              </Pressable>
            );
          })}
        </View>
      </View>
    </Animated.View>
  );
}

const st = StyleSheet.create({
  card: { marginHorizontal: S.pad, marginBottom: 12, borderRadius: S.radius, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  title: { color: C.text, fontFamily: F.semi, fontSize: 16, letterSpacing: -0.1 },
  action: { fontFamily: F.semi, fontSize: 13 },
  moods: { flexDirection: 'row', justifyContent: 'space-between' },
  mood: { flex: 1, alignItems: 'center', paddingVertical: 8, marginHorizontal: 2 },
  moodLabel: { color: C.textFaint, fontFamily: F.med, fontSize: 11, marginTop: 5 },
  rateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.hairline },
  rateLabel: { color: C.textDim, fontFamily: F.med, fontSize: 13 },
  stars: { flexDirection: 'row' },
  star: { paddingHorizontal: 3 },
});
