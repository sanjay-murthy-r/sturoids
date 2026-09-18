import React, { useMemo, useState } from 'react';
import { Alert, Text, ScrollView, StyleSheet, FlatList, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useToolNav } from '../toolNav';
import { Ionicons } from '@expo/vector-icons';
import { C, F, MIN, S, neuRaised } from '../theme';
import { useStore, Note } from '../store';
import { ScreenBG, Field, EmptyState, ListRow, ListSlice, Row, Chip, Sheet, PillButton, DotMenu, NeuHeader, useTheme } from '../components/UI';
import { Bouncy } from '../components/Motion';
import { tap } from '../haptics';
import { deleteAttachmentFiles } from '../attachments';
import { PinSheet } from '../components/LockGate';
import { isUnlocked, lockProtectionAvailable, markUnlocked, unlockWithDevice } from '../lock';

export function NotesListScreen({ mode }: { mode: 'tab' | 'stack' }) {
  const nav = useToolNav();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const notes = useStore((s) => s.notes);
  const folders = useStore((s) => s.noteFolders);
  const addNote = useStore((s) => s.addNote);
  const addNoteFolder = useStore((s) => s.addNoteFolder);
  const updateNote = useStore((s) => s.updateNote);
  const deleteNote = useStore((s) => s.deleteNote);

  const [q, setQ] = useState('');
  const [folder, setFolder] = useState<string | null>(null);
  const [folderSheet, setFolderSheet] = useState(false);
  const [newFolder, setNewFolder] = useState('');
  const [menuNote, setMenuNote] = useState<Note | null>(null);
  const [pinFor, setPinFor] = useState<{ note: Note; mode: 'enter' | 'set' } | null>(null);

  const toggleLock = async (n: Note) => {
    if (n.locked) {
      // taking a lock off needs the owner
      if (!isUnlocked()) {
        const r = await unlockWithDevice('Unlock the note');
        if (r === 'needs-pin') { setPinFor({ note: n, mode: 'enter' }); return; }
        if (r !== 'unlocked') return;
      }
      updateNote(n.id, { locked: false });
    } else if (await lockProtectionAvailable()) {
      updateNote(n.id, { locked: true });
    } else {
      setPinFor({ note: n, mode: 'set' });
    }
  };

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return notes
      .filter((n) => (folder ? n.folder === folder : true))
      // a locked note is found by its title only: its text never surfaces outside the note
      .filter((n) => !ql || n.title.toLowerCase().includes(ql) || (!n.locked && n.body.toLowerCase().includes(ql)))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
  }, [notes, q, folder]);

  // the first screenful rises as one card; rows that mount later (scrolling, searching) appear at once
  const firstPaint = React.useRef(true);
  React.useEffect(() => { firstPaint.current = false; }, []);

  const newNote = () => {
    const id = addNote({ folder: folder || 'General' });
    nav.openNote(id);
  };

  return (
    <ScreenBG guard={mode === 'tab'}>
      <NeuHeader title="Notes" variant={mode === 'tab' ? 'tab' : 'page'} />
      <FlatList
        data={filtered}
        keyExtractor={(n) => n.id}
        renderItem={({ item: n, index: i }) => (
          <ListSlice first={i === 0} last={i === filtered.length - 1} enter={firstPaint.current}>
            <ListRow onPress={() => nav.openNote(n.id)} onLongPress={() => { tap(); setMenuNote(n); }} style={st.note}>
              <View style={{ flex: 1 }}>
                <Row>
                  <Text style={st.noteTitle} numberOfLines={1}>{n.title || 'Untitled'}</Text>
                  {n.pinned && <Ionicons name="pin" size={14} color={C.amber} style={{ marginLeft: 6 }} />}
                  {n.locked && <Ionicons name="lock-closed" size={13} color={C.textFaint} style={{ marginLeft: 6 }} />}
                </Row>
                {!!n.body && !n.locked && <Text style={st.noteBody} numberOfLines={2}>{n.body}</Text>}
                <Text style={st.noteMeta} numberOfLines={1}>
                  {n.folder}{n.subject ? ` · ${n.subject}` : ''} · {new Date(n.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                </Text>
              </View>
            </ListRow>
          </ListSlice>
        )}
        contentContainerStyle={{ padding: S.pad, paddingTop: 8, paddingBottom: 110 + (mode === 'tab' ? 0 : insets.bottom) }}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={10}
        windowSize={9}
        ListHeaderComponent={
          <>
            <Field value={q} onChangeText={setQ} placeholder="Search titles & bodies…" />
            {/* the scroller runs to the screen edges, so chip shadows are never clipped at its bounds */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginBottom: 2, marginHorizontal: -S.pad }}
              contentContainerStyle={{ paddingVertical: 10, paddingHorizontal: S.pad }}
            >
              <Chip label="All" active={!folder} onPress={() => setFolder(null)} />
              {folders.map((f) => (
                <Chip key={f} label={f} active={folder === f} onPress={() => setFolder(f)} />
              ))}
              <Chip icon="add" label="Folder" onPress={() => setFolderSheet(true)} />
            </ScrollView>
          </>
        }
        ListEmptyComponent={
          <EmptyState icon="document-text-outline" title="No notes here yet" body="Folders, pins, search, voice, photos and files all live inside a note." actionLabel="New note" onAction={newNote} />
        }
      />

      <Bouncy
        radius={999}
        scaleTo={0.9}
        style={[
          st.fab,
          { bottom: mode === 'tab' ? 24 : insets.bottom + 20 },
          theme === 'minimal'
            ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: C.green }
            : { backgroundColor: C.card, ...neuRaised('high') },
        ]}
        onPress={() => { tap(); newNote(); }}
      >
        <Ionicons name="add" size={30} color={C.green} />
      </Bouncy>

      <DotMenu
        visible={!!menuNote}
        onClose={() => setMenuNote(null)}
        items={menuNote ? [
          {
            label: menuNote.locked ? 'Unlock note' : 'Lock note',
            icon: menuNote.locked ? 'lock-open-outline' : 'lock-closed-outline',
            onPress: () => toggleLock(menuNote),
          },
          {
            label: menuNote.pinned ? 'Unpin' : 'Pin to top',
            icon: menuNote.pinned ? 'pin' : 'pin-outline',
            onPress: () => updateNote(menuNote.id, { pinned: !menuNote.pinned }),
          },
          {
            label: 'Delete note',
            icon: 'trash-outline',
            color: C.danger,
            onPress: () =>
              Alert.alert('Delete note', 'This cannot be undone.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => deleteAttachmentFiles(deleteNote(menuNote.id)) },
              ]),
          },
        ] : []}
      />

      <PinSheet
        visible={!!pinFor}
        mode={pinFor?.mode ?? 'enter'}
        onClose={() => setPinFor(null)}
        onDone={() => {
          if (!pinFor) return;
          const { note, mode } = pinFor;
          setPinFor(null);
          if (mode === 'enter') { markUnlocked(); updateNote(note.id, { locked: false }); }
          else updateNote(note.id, { locked: true });
        }}
      />

      <Sheet visible={folderSheet} onClose={() => setFolderSheet(false)} title="New folder">
        <Field value={newFolder} onChangeText={setNewFolder} placeholder="Folder name" autoFocus />
        <PillButton
          label="Create"
          onPress={() => { if (newFolder.trim()) { addNoteFolder(newFolder.trim()); setNewFolder(''); setFolderSheet(false); } }}
        />
      </Sheet>
    </ScreenBG>
  );
}

const st = StyleSheet.create({
  fab: {
    position: 'absolute', right: 20, bottom: 24, width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
  },
  note: { alignItems: 'flex-start', paddingVertical: 14 },
  noteTitle: { flex: 1, color: C.text, fontFamily: F.semi, fontSize: 16 },
  noteBody: { color: C.textDim, fontFamily: F.reg, fontSize: 13, lineHeight: 18, marginTop: 4 },
  noteMeta: { color: C.textFaint, fontFamily: F.reg, fontSize: 11, marginTop: 6 },
});
