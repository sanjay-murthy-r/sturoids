import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '../theme';
import { useStore } from '../store';
import { shortClock } from '../components/QuickTaskSheet';
import { Bouncy } from '../components/Motion';
import { openTool } from '../toolNav';
import { Kicker, TILE_TEXT_MAX, Tile, TileNote, kit } from './kit';
import { useTodayItems } from './data';
import { nextUpOf } from './logic';
import type { WidgetProps } from './types';

/** Next up: the single most urgent thing left today, with a big tick; ticked, the next one steps up. */
export function NextUpWidget({ size }: WidgetProps) {
  const items = useTodayItems();
  const hour24 = useStore((s) => s.settings.hour24);
  const toggleDaily = useStore((s) => s.toggleDaily);
  const toggleMission = useStore((s) => s.toggleMission);
  const item = nextUpOf(items);
  if (!item) {
    return (
      <Tile size={size} onPress={() => openTool('tasks')} label={items.length ? 'All done today' : 'Nothing due today'} hint="Opens Tasks">
        <TileNote icon="checkmark-done-outline" color={C.green} title={items.length ? 'All done' : 'Nothing due'} body="Nothing left today" />
      </Tile>
    );
  }
  const when = item.overdue ? 'Overdue' : item.time ? 'By ' + shortClock(item.time, hour24) : 'Today';
  const tint = item.overdue ? C.danger : item.kind === 'mission' ? C.amber : C.accent;
  return (
    <Tile size={size} onPress={() => openTool('tasks', { item: item.id })} label={item.title + ', ' + when} hint="Opens it in Tasks">
      <Kicker>Next up</Kicker>
      <Text style={[kit.name, { marginTop: 8 }]} numberOfLines={2} maxFontSizeMultiplier={TILE_TEXT_MAX}>{item.title}</Text>
      <Text style={[kit.sub, { color: tint, marginTop: 2 }]} numberOfLines={1} maxFontSizeMultiplier={TILE_TEXT_MAX}>{when}</Text>
      <View style={st.foot}>
        <Bouncy
          onPress={() => (item.kind === 'daily' ? toggleDaily(item.id) : toggleMission(item.id))}
          radius={999} scaleTo={0.9} hitSlop={4}
          accessibilityRole="checkbox" accessibilityState={{ checked: false }} accessibilityLabel={'Tick ' + item.title}
          style={[st.tick, { borderColor: tint }]}
        >
          <Ionicons name="checkmark" size={20} color={tint} />
        </Bouncy>
      </View>
    </Tile>
  );
}

const st = StyleSheet.create({
  foot: { marginTop: 'auto', alignItems: 'flex-end' },
  tick: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
