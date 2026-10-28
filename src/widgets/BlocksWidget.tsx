import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { C, F, TRACK, oneLine } from '../theme';
import { useStore } from '../store';
import { dayName, fmtClockTime, toMinutes } from '../utils';
import { openTool } from '../toolNav';
import { Kicker, TILE_TEXT_MAX, Tile, TileNote, kit, useBoardNow } from './kit';
import { dayWindow } from './logic';
import type { WidgetProps } from './types';

/** Today's blocks: the day's blocks on one line of time, with a mark at now. Opens the Planner. */
export function BlocksWidget({ size }: WidgetProps) {
  const now = useBoardNow();
  const hour24 = useStore((s) => s.settings.hour24);
  const today = dayName(now);
  const blocks = useStore((s) => s.planner[today]);
  const sorted = React.useMemo(
    () => [...(blocks || [])].sort((a, b) => toMinutes(a.start) - toMinutes(b.start)),
    [blocks],
  );
  if (!sorted.length) {
    return (
      <Tile size={size} onPress={() => openTool('planner')} label="No blocks today" hint="Opens the Planner">
        <TileNote icon="calendar-outline" title="No blocks today" body="Plan the day and it shows here as a line of time." />
      </Tile>
    );
  }
  const win = dayWindow(sorted);
  const span = win.end - win.start;
  const at = (m: number) => Math.max(0, Math.min(1, (m - win.start) / span)) * 100 + '%';
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const showNow = nowMin >= win.start && nowMin <= win.end;
  const label = sorted.length + (sorted.length === 1 ? ' block today: ' : ' blocks today: ')
    + sorted.map((b) => b.subject + ' at ' + fmtClockTime(toMinutes(b.start), hour24)).join(', ');
  return (
    <Tile size={size} onPress={() => openTool('planner')} label={label} hint="Opens the Planner" pad={16}>
      <Kicker>{"Today's blocks · " + sorted.length}</Kicker>
      <View style={st.stage}>
        <View style={st.track}>
          {sorted.map((b) => {
            const s = toMinutes(b.start);
            const e = Math.min(1440, toMinutes(b.end));
            return (
              <View
                key={b.id}
                style={[st.block, { left: at(s) as any, width: (Math.max(0.02, (e - s) / span) * 100 + '%') as any, backgroundColor: (b.color || C.accent) + 'CC' }]}
              />
            );
          })}
          {showNow ? <View style={[st.now, { left: at(nowMin) as any, backgroundColor: C.text }]} /> : null}
        </View>
        <View style={st.ends}>
          <Text style={kit.sub} maxFontSizeMultiplier={TILE_TEXT_MAX}>{fmtClockTime(win.start, hour24)}</Text>
          <Text style={kit.sub} maxFontSizeMultiplier={TILE_TEXT_MAX}>{win.end >= 1440 ? 'midnight' : fmtClockTime(win.end, hour24)}</Text>
        </View>
      </View>
      <View style={st.names}>
        {sorted.slice(0, 3).map((b) => (
          <View key={b.id} style={st.name}>
            <View style={[st.dot, { backgroundColor: b.color || C.accent }]} />
            <Text style={st.nameText} numberOfLines={1} maxFontSizeMultiplier={TILE_TEXT_MAX}>{b.subject}</Text>
          </View>
        ))}
        {sorted.length > 3 ? <Text style={kit.sub} maxFontSizeMultiplier={TILE_TEXT_MAX}>{'+' + (sorted.length - 3)}</Text> : null}
      </View>
    </Tile>
  );
}

const st = StyleSheet.create({
  stage: { flex: 1, justifyContent: 'center' },
  track: { height: 22, borderRadius: 6, backgroundColor: C.inset, overflow: 'hidden' },
  block: { position: 'absolute', top: 3, bottom: 3, borderRadius: 4 },
  now: { position: 'absolute', top: 0, bottom: 0, width: 2, marginLeft: -1, borderRadius: 1 },
  ends: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  names: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  dot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
  nameText: { color: C.textDim, fontFamily: F.smMed, ...oneLine(12), letterSpacing: TRACK.fine, flexShrink: 1 },
});
