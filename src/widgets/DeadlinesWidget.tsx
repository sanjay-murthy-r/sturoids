import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { C, F, TRACK } from '../theme';
import { useStore } from '../store';
import { openTool } from '../toolNav';
import { DayPill, Kicker, TILE_TEXT_MAX, Tile, TileNote, Track, kit, useBoardToday } from './kit';
import { daysBetween, dPill } from './logic';
import type { WidgetProps } from './types';

/** Deadlines: the open long-term tasks, soonest first, each with the days left and its steps done. */
export function DeadlinesWidget({ size }: WidgetProps) {
  const today = useBoardToday();
  const missions = useStore((s) => s.missions);
  const rows = React.useMemo(
    () => missions.filter((m) => !m.done).sort((a, b) => (a.deadline < b.deadline ? -1 : a.deadline > b.deadline ? 1 : 0)).slice(0, 3),
    [missions],
  );
  if (!rows.length) {
    return (
      <Tile size={size} onPress={() => openTool('tasks', { list: 'missions' })} label="No deadlines" hint="Opens your long-term tasks">
        <TileNote icon="flag-outline" title="No deadlines ahead" body="Long-term tasks show here with the days left." />
      </Tile>
    );
  }
  return (
    <Tile size={size} pad={16}>
      <Kicker>Deadlines</Kicker>
      <View style={st.list}>
        {rows.map((m) => {
          const d = daysBetween(today, m.deadline);
          const steps = m.subtasks.length;
          const done = m.subtasks.filter((x) => x.done).length;
          const tint = d < 0 ? C.danger : d <= 1 ? C.amber : d <= 4 ? C.accent : C.textFaint;
          return (
            <Pressable
              key={m.id} onPress={() => openTool('tasks', { item: m.id })} style={st.row}
              accessibilityRole="button"
              accessibilityLabel={m.title + ', ' + (d < 0 ? 'overdue' : d === 0 ? 'due today' : 'due in ' + d + (d === 1 ? ' day' : ' days'))
                + (steps ? ', ' + done + ' of ' + steps + ' steps done' : '')}
            >
              <View style={st.line}>
                <Text style={kit.rowText} numberOfLines={1} maxFontSizeMultiplier={TILE_TEXT_MAX}>{m.title}</Text>
                {steps ? <Text style={[kit.fig, st.steps]} maxFontSizeMultiplier={TILE_TEXT_MAX}>{done}/{steps}</Text> : null}
                <DayPill label={d < 0 ? 'Late' : dPill(d)} color={tint} />
              </View>
              {steps ? <View style={{ marginTop: 5 }}><Track value={done / steps} color={tint} height={4} /></View> : null}
            </Pressable>
          );
        })}
      </View>
    </Tile>
  );
}

const st = StyleSheet.create({
  list: { flex: 1, justifyContent: 'space-evenly', marginTop: 2 },
  row: { minHeight: 30, justifyContent: 'center' },
  line: { flexDirection: 'row', alignItems: 'center' },
  steps: { marginLeft: 8, color: C.textFaint, fontFamily: F.sm, fontSize: 12, letterSpacing: TRACK.fine },
});
