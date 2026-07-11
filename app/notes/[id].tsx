import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, Alert, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { C, S, T } from '../../src/theme';
import { useStore } from '../../src/store';
import { todayKey } from '../../src/utils';
import { ScreenBG, Sheet, Chip, Row, IconBtn, PillButton } from '../../src/components/UI';

export default function NoteEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const note = useStore((s) => s.notes.find((n) => n.id === id));
  const updateNote = useStore((s) => s.updateNote);
  const deleteNote = useStore((s) => s.deleteNote);
  const folders = useStore((s) => s.noteFolders);
  const addDaily = useStore((s) => s.addDaily);
  const addMission = useStore((s) => s.addMission);

  const [lineSheet, setLineSheet] = useState(false);
  const [folderSheet, setFolderSheet] = useState(false);

  // hooks must run unconditionally — note can be undefined right after deletion
  const lines = useMemo(
    () => (note?.body || '').split('\n').map((l) => l.trim()).filter((l) => l.length > 2),
    [note?.body]
  );

  if (!note) {
    return (
      <ScreenBG>
        <Text style={{ color: C.textDim, textAlign: 'center', marginTop: 60 }}>Note not found.</Text>
      </ScreenBG>
    );
  }

  const promote = (line: string, kind: 'daily' | 'mission') => {
    if (kind === 'daily') addDaily(line);
    else addMission(line, todayKey());
    setLineSheet(false);
    Alert.alert('Added', `"${line.slice(0, 40)}" is now a ${kind === 'daily' ? 'daily task' : 'mission (due today — edit in Tasks)'}.`);
  };

  const voiceInfo = () =>
    Alert.alert(
      'Voice input',
      'On-device speech-to-text needs native code that Expo Go preview cannot load. It activates in the installed APK build. For now — type away.'
    );

  return (
    <ScreenBG>
      <Stack.Screen
        options={{
          title: note.folder,
          headerRight: () => (
            <Row>
              <IconBtn name={note.pinned ? 'pin' : 'pin-outline'} color={note.pinned ? C.amber : C.textDim}
                onPress={() => updateNote(note.id, { pinned: !note.pinned })} />
              <IconBtn name="folder-outline" onPress={() => setFolderSheet(true)} />
              <IconBtn name="checkbox-outline" onPress={() => setLineSheet(true)} />
              <IconBtn name="trash-outline" color={C.danger}
                onPress={() =>
                  Alert.alert('Delete note', 'This cannot be undone.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => { deleteNote(note.id); router.back(); } },
                  ])
                } />
            </Row>
          ),
        }}
      />
      <ScrollView contentContainerStyle={{ padding: S.pad, paddingBottom: 90 }} keyboardShouldPersistTaps="handled">
        <TextInput
          value={note.title}
          onChangeText={(v) => updateNote(note.id, { title: v })}
          placeholder="Title"
          placeholderTextColor={C.textFaint}
          style={st.title}
        />
        <Text style={[T.caption, { marginBottom: 12 }]}>
          created {new Date(note.createdAt).toLocaleString('en-IN')} · modified {new Date(note.updatedAt).toLocaleString('en-IN')}
        </Text>
        <TextInput
          value={note.body}
          onChangeText={(v) => updateNote(note.id, { body: v })}
          placeholder="Write… (tip: the ☑ button turns any line into a task)"
          placeholderTextColor={C.textFaint}
          multiline
          textAlignVertical="top"
          style={st.body}
        />
      </ScrollView>

      <Pressable style={({ pressed }) => [st.mic, pressed && { transform: [{ scale: 0.94 }] }]} onPress={voiceInfo}>
        <Ionicons name="mic-outline" size={26} color="#0A0F1E" />
      </Pressable>

      {/* line → task */}
      <Sheet visible={lineSheet} onClose={() => setLineSheet(false)} title="Promote a line to a task">
        {lines.length === 0 ? (
          <Text style={{ color: C.textFaint }}>Write a few lines first.</Text>
        ) : (
          lines.slice(0, 30).map((l, i) => (
            <View key={i} style={{ marginBottom: 12 }}>
              <Text style={[T.body, { marginBottom: 5 }]} numberOfLines={1}>{l}</Text>
              <Row>
                <PillButton small label="→ Daily task" color={C.green} onPress={() => promote(l, 'daily')} style={{ marginRight: 8 }} />
                <PillButton small label="→ Mission" color={C.amber} onPress={() => promote(l, 'mission')} />
              </Row>
            </View>
          ))
        )}
      </Sheet>

      {/* move folder */}
      <Sheet visible={folderSheet} onClose={() => setFolderSheet(false)} title="Move to folder">
        <Row style={{ flexWrap: 'wrap' }}>
          {folders.map((f) => (
            <Chip key={f} label={f} active={note.folder === f}
              onPress={() => { updateNote(note.id, { folder: f }); setFolderSheet(false); }} />
          ))}
        </Row>
      </Sheet>
    </ScreenBG>
  );
}

const st = StyleSheet.create({
  title: { color: C.text, fontSize: 23, fontWeight: '800', letterSpacing: -0.4, paddingVertical: 6 },
  body: { color: C.text, fontSize: 15, lineHeight: 24, minHeight: 320, paddingTop: 4 },
  mic: {
    position: 'absolute', right: 20, bottom: 24, width: 54, height: 54, borderRadius: 27,
    backgroundColor: C.green, alignItems: 'center', justifyContent: 'center', elevation: 10,
    shadowColor: C.green, shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
  },
});
