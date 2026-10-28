import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '../theme';
import { useStore } from '../store';
import { runAction } from '../actions';
import { Kicker, TILE_TEXT_MAX, Tile, kit } from './kit';
import { noteTitleOf } from './logic';
import type { WidgetProps } from './types';

/** New note: one tap starts a note; under it, the last note's title (never while Notes or that note is locked). */
export function NewNoteWidget({ size }: WidgetProps) {
  const notesLocked = useStore((s) => s.settings.notesLocked === true);
  // the title alone, as a string, so an edit to a note's body never re-renders the tile
  const lastLine = useStore((s) => {
    if (s.settings.notesLocked === true) return '';
    let best: (typeof s.notes)[number] | null = null;
    for (const n of s.notes) if (!best || n.updatedAt > best.updatedAt) best = n;
    if (!best) return '';
    return best.locked ? 'Last: a locked note' : 'Last: ' + noteTitleOf(best);
  });
  return (
    <Tile size={size} onPress={() => runAction('new-note')} label="New note" hint="Starts a new note" pad={16}>
      <Kicker color={C.green}>Notes</Kicker>
      <View style={st.stage}>
        <View style={[st.plus, { borderColor: C.green + '88' }]}>
          <Ionicons name="add" size={26} color={C.green} />
        </View>
      </View>
      <Text style={kit.name} numberOfLines={1} maxFontSizeMultiplier={TILE_TEXT_MAX}>New note</Text>
      {lastLine && !notesLocked ? (
        <Text style={kit.sub} numberOfLines={1} maxFontSizeMultiplier={TILE_TEXT_MAX}>{lastLine}</Text>
      ) : null}
    </Tile>
  );
}

const st = StyleSheet.create({
  stage: { flex: 1, justifyContent: 'center' },
  plus: { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
