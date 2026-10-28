import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { C, F, S, TRACK, oneLine } from '../theme';
import { useStore, Note } from '../store';
import { openTool } from '../toolNav';
import { Kicker, LockedNote, TILE_TEXT_MAX, Tile, TileNote, kit } from './kit';
import { noteExcerptOf, noteTitleOf } from './logic';
import type { WidgetProps } from './types';

const openNote = (id: string) => router.push({ pathname: '/notes/[id]', params: { id } }, { dangerouslySingular: true });

/** The notes a widget lists: the pinned ones, or all, most recently edited first, never more than `n`. */
function useNoteList(pinnedOnly: boolean, n: number): Note[] {
  const notes = useStore((s) => s.notes);
  return React.useMemo(() => {
    const list = pinnedOnly ? notes.filter((x) => x.pinned) : notes.slice();
    return list.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, n);
  }, [notes, pinnedOnly, n]);
}

function LockedTile({ size }: { size: WidgetProps['size'] }) {
  return (
    <Tile size={size} onPress={() => openTool('notes')} label="Notes locked" hint="Opens Notes">
      <LockedNote what="Notes" />
    </Tile>
  );
}

/** Pinned: up to three pinned notes as small cards, each opening its note. A locked note shows only that it is. */
export function PinnedNotesWidget({ size, editing, preview }: WidgetProps) {
  const locked = useStore((s) => s.settings.notesLocked === true);
  const list = useNoteList(true, 3);
  if (locked) return <LockedTile size={size} />;
  if (!list.length) {
    return (
      <Tile size={size} onPress={() => openTool('notes')} label="No pinned notes" hint="Opens Notes">
        <TileNote icon="pin-outline" title="No pinned notes" body="Pin a note and it stays here, a tap away." />
      </Tile>
    );
  }
  return (
    <Tile size={size} pad={16}>
      <Pressable onPress={() => openTool('notes')} accessibilityRole="button" accessibilityHint="Opens Notes" hitSlop={8}>
        <Kicker color={C.green}>Pinned</Kicker>
      </Pressable>
      <View style={st.cards}>
        {list.map((n) => (
          <Pressable
            key={n.id} onPress={() => openNote(n.id)} disabled={editing || preview}
            style={({ pressed }) => [st.card, { borderColor: C.outline }, pressed && { opacity: 0.6 }]}
            accessibilityRole="button" accessibilityLabel={n.locked ? 'A locked note' : noteTitleOf(n)}
          >
            {n.locked ? <Ionicons name="lock-closed-outline" size={14} color={C.textFaint} /> : null}
            <Text style={st.cardTitle} numberOfLines={2} maxFontSizeMultiplier={TILE_TEXT_MAX}>
              {n.locked ? 'Locked' : noteTitleOf(n)}
            </Text>
            {!n.locked ? (
              <Text style={st.cardBody} numberOfLines={2} maxFontSizeMultiplier={TILE_TEXT_MAX}>{noteExcerptOf(n)}</Text>
            ) : null}
          </Pressable>
        ))}
      </View>
    </Tile>
  );
}

/** Recent notes: the five notes edited last, each with a line of what it says and its folder. */
export function RecentNotesWidget({ size, editing, preview }: WidgetProps) {
  const locked = useStore((s) => s.settings.notesLocked === true);
  const list = useNoteList(false, 5);
  if (locked) return <LockedTile size={size} />;
  if (!list.length) {
    return (
      <Tile size={size} onPress={() => openTool('notes')} label="No notes yet" hint="Opens Notes">
        <TileNote icon="document-text-outline" title="No notes yet" body="Your latest notes show here." />
      </Tile>
    );
  }
  return (
    <Tile size={size} pad={16}>
      <Pressable onPress={() => openTool('notes')} accessibilityRole="button" accessibilityHint="Opens Notes" hitSlop={8}>
        <Kicker color={C.green}>Recent notes</Kicker>
      </Pressable>
      <View style={st.list}>
        {list.map((n, i) => (
          <Pressable
            key={n.id} onPress={() => openNote(n.id)} disabled={editing || preview}
            style={({ pressed }) => [
              st.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.hairline }, pressed && { opacity: 0.6 },
            ]}
            accessibilityRole="button" accessibilityLabel={n.locked ? 'A locked note' : noteTitleOf(n)}
          >
            <View style={st.rowHead}>
              {n.locked ? <Ionicons name="lock-closed-outline" size={13} color={C.textFaint} style={{ marginRight: 6 }} /> : null}
              <Text style={[kit.rowText, { fontFamily: F.med }]} numberOfLines={1} maxFontSizeMultiplier={TILE_TEXT_MAX}>
                {n.locked ? 'Locked note' : noteTitleOf(n)}
              </Text>
              {n.folder ? <Text style={st.folder} numberOfLines={1} maxFontSizeMultiplier={TILE_TEXT_MAX}>{n.folder}</Text> : null}
            </View>
            {!n.locked && noteExcerptOf(n) ? (
              <Text style={kit.sub} numberOfLines={1} maxFontSizeMultiplier={TILE_TEXT_MAX}>{noteExcerptOf(n)}</Text>
            ) : null}
          </Pressable>
        ))}
      </View>
    </Tile>
  );
}

const st = StyleSheet.create({
  cards: { flex: 1, flexDirection: 'row', gap: 10, marginTop: 10 },
  card: { flex: 1, borderWidth: 1, borderRadius: S.radiusSm, padding: 10, gap: 4, overflow: 'hidden' },
  cardTitle: { color: C.text, fontFamily: F.semi, fontSize: 13, lineHeight: 17, letterSpacing: TRACK.small },
  cardBody: { color: C.textFaint, fontFamily: F.sm, fontSize: 11, lineHeight: 15, letterSpacing: TRACK.fine },
  list: { flex: 1, justifyContent: 'space-between', marginTop: 6 },
  row: { flex: 1, justifyContent: 'center', minHeight: 44 },
  rowHead: { flexDirection: 'row', alignItems: 'center' },
  folder: { color: C.textFaint, fontFamily: F.sm, ...oneLine(11), letterSpacing: TRACK.fine, marginLeft: 8, maxWidth: 110 },
});
