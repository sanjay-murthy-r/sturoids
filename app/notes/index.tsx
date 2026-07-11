import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { C, S } from '../../src/theme';
import { useStore } from '../../src/store';
import { ScreenBG, GlassCard, Field, EmptyText, Row, Chip, Sheet, PillButton } from '../../src/components/UI';

export default function NotesList() {
  const router = useRouter();
  const notes = useStore((s) => s.notes);
  const folders = useStore((s) => s.noteFolders);
  const addNote = useStore((s) => s.addNote);
  const addNoteFolder = useStore((s) => s.addNoteFolder);

  const [q, setQ] = useState('');
  const [folder, setFolder] = useState<string | null>(null);
  const [folderSheet, setFolderSheet] = useState(false);
  const [newFolder, setNewFolder] = useState('');

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
      <ScrollView contentContainerStyle={{ padding: S.pad, paddingBottom: 110 }} keyboardShouldPersistTaps="handled">
        <Field value={q} onChangeText={setQ} placeholder="Search titles & bodies…" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
          <Chip label="All" active={!folder} onPress={() => setFolder(null)} />
          {folders.map((f) => (
            <Chip key={f} label={f} active={folder === f} onPress={() => setFolder(f)} />
          ))}
          <Chip label="+ folder" onPress={() => setFolderSheet(true)} />
        </ScrollView>

        {filtered.length === 0 ? (
          <EmptyText>No notes here yet.{'\n'}Notes support folders, pinning and search — voice input arrives in the installed APK.</EmptyText>
        ) : (
          filtered.map((n) => (
            <GlassCard key={n.id} pad={14} onPress={() => router.push(`/notes/${n.id}`)}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text style={{ color: C.text, fontSize: 16, fontWeight: '700', flex: 1 }} numberOfLines={1}>
                  {n.title || 'Untitled'}
                </Text>
                {n.pinned && <Ionicons name="pin" size={14} color={C.amber} />}
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
          ))
        )}
      </ScrollView>

      <Pressable style={st.fab} onPress={newNote}>
        <Ionicons name="add" size={30} color="#0A0F1E" />
      </Pressable>

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
    backgroundColor: C.green, alignItems: 'center', justifyContent: 'center',
    elevation: 8, shadowColor: C.green, shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
  },
});
