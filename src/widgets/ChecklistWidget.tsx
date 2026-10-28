import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { C } from '../theme';
import { useStore } from '../store';
import { shortClock } from '../components/QuickTaskSheet';
import { openTool } from '../toolNav';
import { Kicker, MiniTick, TILE_TEXT_MAX, Tile, TileNote, kit } from './kit';
import { FadeSwap } from '../components/Motion';
import { useTodayItems } from './data';
import type { WidgetProps } from './types';

/** Checklist: four of today's ToDos and tasks, ticked in place; the done ones sink below the open ones. */
export function ChecklistWidget({ size }: WidgetProps) {
  const items = useTodayItems();
  const hour24 = useStore((s) => s.settings.hour24);
  const toggleDaily = useStore((s) => s.toggleDaily);
  const toggleMission = useStore((s) => s.toggleMission);
  const left = items.filter((t) => !t.done).length;
  const rows = [...items.filter((t) => !t.done), ...items.filter((t) => t.done)].slice(0, 4);
  if (!items.length) {
    return (
      <Tile size={size} onPress={() => openTool('tasks')} label="Nothing due today" hint="Opens Tasks">
        <TileNote icon="checkbox-outline" title="Nothing on the list yet" body="ToDos and tasks due today show here." />
      </Tile>
    );
  }
  return (
    <Tile size={size} pad={16}>
      <Pressable onPress={() => openTool('tasks')} accessibilityRole="button" accessibilityHint="Opens Tasks" hitSlop={8}>
        <FadeSwap swapKey={left ? 'ToDos · ' + left + ' left' : 'ToDos · all done'}>
          <Kicker>{left ? 'ToDos · ' + left + ' left' : 'ToDos · all done'}</Kicker>
        </FadeSwap>
      </Pressable>
      <View style={st.list}>
        {rows.map((t) => (
          <Pressable
            key={t.kind + t.id} style={st.row}
            onPress={() => (t.kind === 'daily' ? toggleDaily(t.id) : toggleMission(t.id))}
            accessibilityRole="checkbox" accessibilityState={{ checked: t.done }} accessibilityLabel={t.title}
          >
            <MiniTick done={t.done} color={t.kind === 'mission' ? C.amber : C.green} label={t.title} />
            <Text
              style={[kit.rowText, { marginLeft: 10 }, t.done && { color: C.textFaint, textDecorationLine: 'line-through' }]}
              numberOfLines={1} maxFontSizeMultiplier={TILE_TEXT_MAX}
            >
              {t.title}
            </Text>
            {t.overdue && !t.done ? <Text style={[kit.sub, { color: C.danger }]}>Late</Text>
              : t.time ? <Text style={kit.sub} maxFontSizeMultiplier={TILE_TEXT_MAX}>{shortClock(t.time, hour24)}</Text> : null}
          </Pressable>
        ))}
      </View>
    </Tile>
  );
}

const st = StyleSheet.create({
  list: { flex: 1, justifyContent: 'space-evenly', marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 26 },
});
