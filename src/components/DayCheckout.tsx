import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { Easing, FadeOut, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { C, F, MIN, S, TRACK, neuRaised } from '../theme';
import { JournalEntry } from '../store';
import { MOODS, journalDateParts, shiftKey } from '../journal';
import { todayKey } from '../utils';
import { Bouncy, CHANGE, FadeSwap, useAnimLevel } from './Motion';
import { swapIn } from './Swap';
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
    : { backgroundColor: C.card, ...neuRaised('mid') };

  return (
    <Animated.View
      entering={swapIn(level)}
      exiting={level === 'none' ? undefined : FadeOut.duration(160).easing(Easing.in(Easing.quad))}
      style={[st.card, surface]}
    >
      <View style={st.head}>
        <Text style={[st.title, { flex: 1, marginRight: 12 }]} numberOfLines={1}>{title}</Text>
        <Pressable onPress={skip ? onSkip : onDone} hitSlop={{ top: 14, bottom: 14, left: 10, right: 10 }} accessibilityRole="button">
          {/* Skip turns into Done as the first answer lands: the word dips over instead of swapping */}
          <FadeSwap swapKey={skip ? 'skip' : 'done'}>
            <Text style={[st.action, { color: skip ? C.textDim : C.gold }]}>{skip ? 'Skip' : 'Done'}</Text>
          </FadeSwap>
        </Pressable>
      </View>

      <View style={st.moods}>
        {MOODS.map((m) => (
          <MoodCell key={m.value} mood={m} on={mood === m.value} onPick={onMood} />
        ))}
      </View>

      <View style={st.rateRow}>
        <Text style={st.rateLabel} importantForAccessibility="no" accessibilityElementsHidden>Rate the day</Text>
        {/* a screen reader meets the stars as one control that swipes up and down through the rating */}
        <View
          style={st.stars}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Rate the day"
          accessibilityValue={{ text: rating ? rating + ' of 5 stars' : 'Not rated' }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => {
            const step = e.nativeEvent.actionName === 'increment' ? 1 : e.nativeEvent.actionName === 'decrement' ? -1 : 0;
            if (!step || (!rating && step < 0)) return;
            const next = Math.max(1, Math.min(5, (rating ?? 0) + step)) as Scale;
            if (next !== rating) { tick(); onRating(next); }
          }}
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <Star key={n} n={n} rating={rating} onRating={onRating} />
          ))}
        </View>
      </View>
    </Animated.View>
  );
}

/** One flat mood: picking it eases its gold tint and ink in, and the one it replaces eases out. */
function MoodCell({ mood: m, on, onPick }: {
  mood: (typeof MOODS)[number]; on: boolean; onPick: (m: Scale) => void;
}) {
  const level = useAnimLevel();
  const lit = useSharedValue(on ? 1 : 0);
  React.useEffect(() => {
    lit.value = level === 'none' ? (on ? 1 : 0) : withTiming(on ? 1 : 0, CHANGE);
  }, [on, level]);
  const litStyle = useAnimatedStyle(() => ({ opacity: lit.value }));
  const restStyle = useAnimatedStyle(() => ({ opacity: 1 - lit.value }));
  return (
    <Bouncy
      onPress={() => { tick(); onPick(on ? undefined : m.value); }}
      scaleTo={0.92}
      radius={14}
      style={st.mood}
      accessibilityRole="button"
      accessibilityLabel={m.label + (on ? ', picked' : '')}
    >
      <Animated.View pointerEvents="none" style={[st.moodTint, { backgroundColor: C.gold + '24' }, litStyle]} />
      <View>
        <Animated.View style={restStyle}><Ionicons name={m.icon as any} size={22} color={C.textDim} /></Animated.View>
        <Animated.View style={[st.ink, litStyle]}><Ionicons name={m.icon as any} size={22} color={C.gold} /></Animated.View>
      </View>
      <View>
        {/* both inks share the face, so the words keep one width as their colour crosses over */}
        <Animated.Text style={[st.moodLabel, on && st.moodOn, restStyle]}>{m.label}</Animated.Text>
        <Animated.Text
          style={[st.moodLabel, on && st.moodOn, st.ink, { color: C.gold, textAlign: 'center' }, litStyle]}
          importantForAccessibility="no"
          accessibilityElementsHidden
        >
          {m.label}
        </Animated.Text>
      </View>
    </Bouncy>
  );
}

/**
 * One star. A rating fills the stars from the left, each a moment after the one before it, and lowering it empties
 * them from the right; with motion off they simply change.
 */
function Star({ n, rating, onRating }: { n: number; rating: Scale; onRating: (r: Scale) => void }) {
  const level = useAnimLevel();
  const on = !!rating && n <= rating;
  const lit = useSharedValue(on ? 1 : 0);
  const was = React.useRef(on);
  React.useEffect(() => {
    if (level === 'none') { lit.value = on ? 1 : 0; was.current = on; return; }
    if (was.current === on) return;
    was.current = on;
    // the fill runs left to right (and back right to left) across the stars that change
    const lag = level === 'full' ? (on ? (n - 1) * 35 : (5 - n) * 25) : 0;
    lit.value = withDelay(lag, withTiming(on ? 1 : 0, { duration: on ? 200 : 150, easing: Easing.out(Easing.cubic) }));
  }, [on, level]);
  const litStyle = useAnimatedStyle(() => ({ opacity: lit.value, transform: [{ scale: 0.8 + 0.2 * lit.value }] }));
  const restStyle = useAnimatedStyle(() => ({ opacity: 1 - lit.value }));
  return (
    <Pressable
      hitSlop={4}
      onPress={() => { tick(); onRating(rating === n ? undefined : (n as Scale)); }}
      // the row speaks for the stars, so they are not met one by one
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={st.star}
    >
      <Animated.View style={restStyle}><Ionicons name="star-outline" size={24} color={C.textFaint} /></Animated.View>
      <Animated.View style={[st.starLit, litStyle]}><Ionicons name="star" size={24} color={C.gold} /></Animated.View>
    </Pressable>
  );
}

const st = StyleSheet.create({
  card: { marginHorizontal: S.pad, marginBottom: S.gap, borderRadius: S.radius, paddingHorizontal: S.cardPad, paddingVertical: 16 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  title: { color: C.text, fontFamily: F.semi, fontSize: 16, letterSpacing: TRACK.title },
  action: { fontFamily: F.semi, fontSize: 13, letterSpacing: TRACK.small },
  moods: { flexDirection: 'row', justifyContent: 'space-between' },
  mood: { flex: 1, alignItems: 'center', paddingVertical: 8, marginHorizontal: 2, borderRadius: 14 },
  /** the picked mood's tint, a layer that fades in under its icon */
  moodTint: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 14 },
  moodLabel: { color: C.textFaint, fontFamily: F.smMed, fontSize: 11, letterSpacing: TRACK.fine, marginTop: 5, textAlign: 'center' },
  moodOn: { fontFamily: F.smSemi },
  /** a second ink laid exactly over the first, for colours that cross over */
  ink: { position: 'absolute', top: 0, left: 0, right: 0 },
  // each star carries 10 above and below, so its target reaches 44 dp: they stand for the row's own top padding, and
  // the row gives the 10 below back to the card's, so the card still shows 16 under the stars
  rateRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, marginBottom: -10,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.hairline,
  },
  rateLabel: { color: C.textDim, fontFamily: F.smMed, fontSize: 13, letterSpacing: TRACK.small },
  stars: { flexDirection: 'row' },
  star: { paddingHorizontal: 3, paddingVertical: 10 },
  starLit: { position: 'absolute', top: 10, left: 3 },
});
