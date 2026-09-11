import React, { useMemo, useState } from 'react';
import { Alert, Text, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { C, F, MIN, S, neuRaised } from '../../src/theme';
import { useStore, Note } from '../../src/store';
import { ScreenBG, GlassCard, Field, EmptyText, Row, Chip, Sheet, PillButton, DotMenu, NeuHeader, useTheme } from '../../src/components/UI';
import { Bouncy, Enter } from '../../src/components/Motion';
import { tap } from '../../src/haptics';

export default function NotesList() {
  const router = useRouter();
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

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return notes
      .filter((n) => (folder ? n.folder === folder : true))
      .filter((n) => !ql || n.title.toLowerCase().includes(ql) || n.body.toLowerCase().includes(ql))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
  }, [notes, q, folder]);

  const newNote = () => {
    const id = addNote({ folder: folder || 'General' });
    router.push(`/notes/${id}`);
  };

  return (
    <ScreenBG>
      <NeuHeader title="Notes" />
      <ScrollView contentContainerStyle={{ padding: S.pad, paddingTop: 8, paddingBottom: 110 }} keyboardShouldPersistTaps="handled">
        <Field value={q} onChangeText={setQ} placeholder="Search titles & bodies…" />
        {/* padded content box so chip shadows aren't clipped by the scroller */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginBottom: 2, marginHorizontal: -6 }}
          contentContainerStyle={{ paddingVertical: 10, paddingHorizontal: 6 }}
        >
          <Chip label="All" active={!folder} onPress={() => setFolder(null)} />
          {folders.map((f) => (
            <Chip key={f} label={f} active={folder === f} onPress={() => setFolder(f)} />
          ))}
          <Chip label="+ folder" onPress={() => setFolderSheet(true)} />
        </ScrollView>

        {filtered.length === 0 ? (
          <EmptyText>No notes here yet.{'\n'}Folders, pinning, search, voice input, photos, videos & file attachments — all inside.</EmptyText>
        ) : (
          filtered.map((n, i) => (
            <Enter key={n.id} index={Math.min(i, 8)}>
              <GlassCard pad={14} onPress={() => router.push(`/notes/${n.id}`)} onLongPress={() => { tap(); setMenuNote(n); }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text style={{ color: C.text, fontSize: 16, fontFamily: F.semi, flex: 1 }} numberOfLines={1}>
                  {n.title || 'Untitled'}
                </Text>
                {n.pinned && <Ionicons name="pin" size={15} color={C.amber} />}
              </Row>
              {!!n.body && (
                <Text style={{ color: C.textDim, fontSize: 13, marginTop: 4, lineHeight: 18 }} numberOfLines={2}>
                  {n.body}
                </Text>
              )}
              <Text style={{ color: C.textFaint, fontSize: 11, marginTop: 6 }}>
                {n.folder}{n.subject ? ` · ${n.subject}` : ''} · {new Date(n.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
              </Text>
              </GlassCard>
            </Enter>
          ))
        )}
      </ScrollView>

      <Bouncy
        radius={999}
        scaleTo={0.9}
        style={[
          st.fab,
          theme === 'minimal'
            ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: C.green }
            : { backgroundColor: C.card, boxShadow: neuRaised('high').boxShadow + ', 0 0 14px ' + C.green + '55' },
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
                { text: 'Delete', style: 'destructive', onPress: () => deleteNote(menuNote.id) },
              ]),
          },
        ] : []}
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
});
