import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '../theme';
import { useStore } from '../store';
import { fmtClockTime, toMinutes } from '../utils';
import { openTool } from '../toolNav';
import { Kicker, Ring, TILE_TEXT_MAX, Tile, TileNote, kit, spokenMinutes, useBoardNow } from './kit';
import { useNextBlock } from './data';
import { blockProgress, minutesLeft } from './logic';
import type { WidgetProps } from './types';

/**
 * Now / Next: the block on now with a ring of how far through it is and the time left; else the next one and when it
 * starts. Opens the Planner.
 */
export function NowNextWidget({ size }: WidgetProps) {
  const now = useBoardNow();
  const hour24 = useStore((s) => s.settings.hour24);
  const next = useNextBlock();
  if (!next) {
    return (
      <Tile size={size} onPress={() => openTool('planner')} label="Nothing planned" hint="Opens the Planner">
        <TileNote icon="calendar-outline" title="Nothing planned" body="Blocks you plan show here." />
      </Tile>
    );
  }
  const b = next.block;
  const onNow = next.tag === 'NOW';
  const left = onNow ? minutesLeft(b, now) : 0;
  const starts = fmtClockTime(toMinutes(b.start), hour24);
  const line = onNow ? (left >= 60 ? Math.floor(left / 60) + ' h ' + (left % 60) + ' min left' : left + ' min left')
    : next.tag === 'TOMORROW' ? 'Tomorrow, ' + starts : 'At ' + starts;
  const label = (onNow ? 'Now, ' : next.tag === 'TOMORROW' ? 'Tomorrow, ' : 'Next, ') + b.subject + ', '
    + (onNow ? spokenMinutes(left) + ' left' : 'at ' + starts);
  return (
    <Tile size={size} onPress={() => openTool('planner')} label={label} hint="Opens the Planner" pad={16}>
      <Kicker color={onNow ? C.accent : undefined}>{onNow ? 'Now' : next.tag === 'TOMORROW' ? 'Tomorrow' : 'Next'}</Kicker>
      <View style={st.stage}>
        <View style={st.ring}>
          <Ring size={58} stroke={6} value={onNow ? blockProgress(b, now) : 0} color={b.color || C.accent} />
          <View style={st.mark}>
            <Ionicons name={onNow ? 'time-outline' : 'arrow-forward'} size={18} color={b.color || C.accent} />
          </View>
        </View>
      </View>
      <Text style={kit.name} numberOfLines={1} maxFontSizeMultiplier={TILE_TEXT_MAX}>{b.subject}</Text>
      <Text style={kit.sub} numberOfLines={1} maxFontSizeMultiplier={TILE_TEXT_MAX}>{line}</Text>
    </Tile>
  );
}

const st = StyleSheet.create({
  stage: { flex: 1, justifyContent: 'center' },
  ring: { width: 58, height: 58 },
  mark: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
});
