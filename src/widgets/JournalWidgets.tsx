import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C, F, TRACK } from '../theme';
import { todayKey } from '../utils';
import { useStore } from '../store';
import { MOODS, journalDayFor, journalStreak, moodSeries, promptFor } from '../journal';
import { openTool } from '../toolNav';
import { Kicker, LockedNote, TILE_TEXT_MAX, Tile, kit, useBoardNow } from './kit';
import type { WidgetProps } from './types';

/** Write today: today's page, its words or "Not yet", and the day's prompt. Opens the Journal. */
export function WriteTodayWidget({ size }: WidgetProps) {
  const now = useBoardNow();
  const locked = useStore((s) => s.settings.journalLocked);
  const cutoff = useStore((s) => s.settings.journalCutoffHour);
  const day = journalDayFor(now, cutoff);
  // one number, so a save in the Journal re-renders the tile only when the count moves
  const words = useStore((s) => {
    let n = 0;
    for (const e of s.journal) if (e.dateKey === day) n += e.wordCount || 0;
    return n;
  });
  if (locked) {
    return <Tile size={size} onPress={() => openTool('journal')} label="Journal locked" hint="Opens the Journal"><LockedNote what="Journal" /></Tile>;
  }
  const isToday = day === todayKey(now);
  const prompt = promptFor(day).text;
  const state = words ? words + (words === 1 ? ' word' : ' words') : 'Not yet';
  return (
    <Tile
      size={size} onPress={() => openTool('journal')} pad={16}
      label={(isToday ? "Today's page, " : "Yesterday's page, ") + state + '. ' + prompt} hint="Opens the Journal"
    >
      <Kicker color={C.gold}>{isToday ? "Today's page" : "Yesterday's page"}</Kicker>
      <View style={st.stage}>
        <Ionicons name={words ? 'checkmark-circle-outline' : 'create-outline'} size={22} color={C.gold} />
        <Text style={[kit.name, { marginTop: 6 }]} numberOfLines={1} maxFontSizeMultiplier={TILE_TEXT_MAX}>{state}</Text>
      </View>
      {!words ? <Text style={st.prompt} numberOfLines={2} maxFontSizeMultiplier={TILE_TEXT_MAX}>{prompt}</Text> : null}
    </Tile>
  );
}

const STRIP_DAYS = 14;

/** Mood strip: the last fourteen days' moods as a row of marks, the rating under each, and the writing streak. */
export function MoodStripWidget({ size }: WidgetProps) {
  const now = useBoardNow();
  const locked = useStore((s) => s.settings.journalLocked);
  const cutoff = useStore((s) => s.settings.journalCutoffHour);
  const journal = useStore((s) => s.journal);
  const end = journalDayFor(now, cutoff);
  const series = React.useMemo(() => moodSeries(journal, STRIP_DAYS, end), [journal, end]);
  const streak = React.useMemo(() => journalStreak(journal, cutoff, now).current, [journal, cutoff, end]);
  if (locked) {
    return <Tile size={size} onPress={() => openTool('journal')} label="Journal locked" hint="Opens the Journal"><LockedNote what="Journal" /></Tile>;
  }
  const moods = series.filter((d) => d.mood != null).length;
  const label = 'Mood, last ' + STRIP_DAYS + ' days: ' + (moods ? moods + ' days with a mood' : 'none set yet')
    + (streak ? ', writing streak ' + streak + (streak === 1 ? ' day' : ' days') : '');
  return (
    <Tile size={size} onPress={() => openTool('journal')} label={label} hint="Opens the Journal" pad={16}>
      <View style={st.head}>
        <Kicker color={C.gold}>Mood · 14 days</Kicker>
        {streak ? (
          <View style={st.streak}>
            <Ionicons name="flame-outline" size={13} color={C.gold} />
            <Text style={[kit.sub, { color: C.gold, marginLeft: 4 }]} maxFontSizeMultiplier={TILE_TEXT_MAX}>
              {streak + (streak === 1 ? ' day' : ' days')}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={st.strip}>
        {series.map((d, i) => {
          const mood = d.mood != null ? MOODS.find((m) => m.value === d.mood) : null;
          const last = i === series.length - 1;
          return (
            <View key={d.dateKey} style={st.day}>
              {mood ? (
                <Ionicons name={mood.icon as any} size={15} color={C.gold} style={{ opacity: 0.45 + 0.11 * (d.mood as number) }} />
              ) : (
                <View style={[st.empty, { backgroundColor: d.words ? C.gold + '55' : C.outline }]} />
              )}
              <View style={[st.bar, { height: d.rating ? 4 + (d.rating as number) * 5 : 2, backgroundColor: d.rating ? C.gold + 'AA' : C.outline }]} />
              <View style={[st.tick, last && { backgroundColor: C.text }]} />
            </View>
          );
        })}
      </View>
      {!moods ? <Text style={kit.sub} maxFontSizeMultiplier={TILE_TEXT_MAX}>Moods you pick on a page show here</Text> : null}
    </Tile>
  );
}

const st = StyleSheet.create({
  stage: { flex: 1, justifyContent: 'center' },
  prompt: { color: C.textFaint, fontFamily: F.serif, fontSize: 12, lineHeight: 16, letterSpacing: TRACK.fine },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  streak: { flexDirection: 'row', alignItems: 'center' },
  strip: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingBottom: 4 },
  day: { alignItems: 'center', width: 18, gap: 6 },
  empty: { width: 6, height: 6, borderRadius: 3, marginVertical: 4.5 },
  bar: { width: 4, borderRadius: 2 },
  tick: { width: 4, height: 2, borderRadius: 1, backgroundColor: 'transparent' },
});
