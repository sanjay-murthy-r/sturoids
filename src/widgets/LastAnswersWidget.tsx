import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { C, F, TRACK, oneLine } from '../theme';
import { useStore } from '../store';
import { openTool } from '../toolNav';
import { Kicker, TILE_TEXT_MAX, Tile, TileNote } from './kit';
import type { WidgetProps } from './types';

/** Last answers: the Calculator's last three sums and answers; a tap on one opens the Calculator with it, to go on with. */
export function LastAnswersWidget({ size, editing, preview }: WidgetProps) {
  const history = useStore((s) => s.calcHistory);
  const rows = history.slice(0, 3);
  if (!rows.length) {
    return (
      <Tile size={size} onPress={() => openTool('calculator')} label="No answers yet" hint="Opens the Calculator">
        <TileNote icon="calculator-outline" title="No answers yet" body="Your last sums show here, a tap from use." />
      </Tile>
    );
  }
  return (
    <Tile size={size} pad={16}>
      <Pressable onPress={() => openTool('calculator')} accessibilityRole="button" accessibilityHint="Opens the Calculator" hitSlop={8}>
        <Kicker color={C.amber}>Last answers</Kicker>
      </Pressable>
      <View style={st.list}>
        {rows.map((r) => (
          <Pressable
            key={r.id} onPress={() => openTool('calculator', { expr: r.result })} disabled={editing || preview}
            style={({ pressed }) => [st.row, pressed && { opacity: 0.6 }]}
            accessibilityRole="button" accessibilityLabel={r.expr + ' equals ' + r.result} accessibilityHint="Uses this answer"
          >
            <Text style={st.expr} numberOfLines={1} maxFontSizeMultiplier={TILE_TEXT_MAX}>{r.expr}</Text>
            <Text style={st.result} numberOfLines={1} maxFontSizeMultiplier={TILE_TEXT_MAX}>{'= ' + r.result}</Text>
          </Pressable>
        ))}
      </View>
    </Tile>
  );
}

const st = StyleSheet.create({
  list: { flex: 1, justifyContent: 'space-evenly', marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 30 },
  // the sums and answers are figures that line up: Inter Tight, tabular
  expr: { flex: 1, color: C.textFaint, fontFamily: F.reg, ...oneLine(13), fontVariant: ['tabular-nums'], letterSpacing: TRACK.small },
  result: { color: C.text, fontFamily: F.med, ...oneLine(15), fontVariant: ['tabular-nums'], marginLeft: 10, maxWidth: '50%' },
});
