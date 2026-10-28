import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C, F, TRACK, oneLine } from '../theme';
import { useStore } from '../store';
import { DAY_NAMES, habitDueOn } from '../utils';
import { habitSince } from '../journal';
import { openTool } from '../toolNav';
import { Kicker, TILE_TEXT_MAX, Tile, TileNote, useBoardToday } from './kit';
import { lastSevenDays } from './logic';
import type { WidgetProps } from './types';

const ROWS = 3;

/**
 * Habit grid: up to three habits against the last seven days, a filled dot for a day done, a ring for one due and
 * missed, nothing for a rest day; today's dot ticks the habit in place.
 */
export function HabitGridWidget({ size, editing, preview }: WidgetProps) {
  const today = useBoardToday();
  const habits = useStore((s) => s.habits);
  const toggle = useStore((s) => s.toggleHabitToday);
  const days = React.useMemo(() => lastSevenDays(today), [today]);
  const rows = habits.slice(0, ROWS);
  if (!rows.length) {
    return (
      <Tile size={size} onPress={() => openTool('planner')} label="No habits yet" hint="Opens the Planner">
        <TileNote icon="repeat-outline" title="No habits yet" body="Habits you keep show here, a week at a time." />
      </Tile>
    );
  }
  const letters = days.map((k) => DAY_NAMES[(new Date(k + 'T00:00:00').getDay() + 6) % 7][0]);
  return (
    <Tile size={size} pad={16}>
      <Pressable onPress={() => openTool('planner')} accessibilityRole="button" accessibilityHint="Opens the Planner" hitSlop={8}>
        <Kicker color={C.green}>{'Habits · this week' + (habits.length > ROWS ? ' · ' + habits.length : '')}</Kicker>
      </Pressable>
      <View style={st.grid}>
        <View style={st.row}>
          <View style={st.title} />
          {letters.map((l, i) => (
            <Text key={i} style={[st.letter, i === 6 && { color: C.text }]} maxFontSizeMultiplier={TILE_TEXT_MAX}>{l}</Text>
          ))}
        </View>
        {rows.map((h) => {
          const since = habitSince(h);
          return (
            <View key={h.id} style={st.row}>
              <Text style={st.titleText} numberOfLines={1} maxFontSizeMultiplier={TILE_TEXT_MAX}>{h.title}</Text>
              {days.map((k, i) => {
                const done = h.doneDates.includes(k);
                const due = k >= since && habitDueOn(h, k);
                const isToday = i === 6;
                const dot = (
                  <View
                    style={[
                      st.dot,
                      done ? { backgroundColor: C.green, borderColor: C.green }
                        : due ? { borderColor: isToday ? C.green + 'AA' : C.borderBright } : { borderColor: 'transparent' },
                    ]}
                  >
                    {done && isToday ? <Ionicons name="checkmark" size={10} color={C.onAccent} /> : null}
                    {!done && !due ? <View style={st.rest} /> : null}
                  </View>
                );
                if (!isToday) return <View key={k} style={st.cell}>{dot}</View>;
                return (
                  <Pressable
                    key={k} style={st.cell} hitSlop={10} disabled={editing || preview}
                    onPress={() => toggle(h.id)}
                    accessibilityRole="checkbox" accessibilityState={{ checked: done }}
                    accessibilityLabel={h.title + ', today'}
                  >
                    {dot}
                  </Pressable>
                );
              })}
            </View>
          );
        })}
      </View>
    </Tile>
  );
}

const st = StyleSheet.create({
  grid: { flex: 1, justifyContent: 'space-evenly', marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 22 },
  title: { flex: 1 },
  titleText: { flex: 1, color: C.textDim, fontFamily: F.smMed, ...oneLine(12), letterSpacing: TRACK.fine, marginRight: 6 },
  letter: { width: 26, textAlign: 'center', color: C.textFaint, fontFamily: F.sm, ...oneLine(11), letterSpacing: TRACK.fine },
  cell: { width: 26, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  rest: { width: 4, height: 4, borderRadius: 2, backgroundColor: C.outline },
});
