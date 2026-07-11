import React, { useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import YoutubePlayer, { YoutubeIframeRef } from 'react-native-youtube-iframe';
import { Ionicons } from '@expo/vector-icons';
import { C, S } from '../../src/theme';
import { useStore } from '../../src/store';
import { fmtMediaTime } from '../../src/utils';
import { ScreenBG, GlassCard, SectionTitle, Sheet, Field, PillButton, EmptyText, Row, Chip, IconBtn } from '../../src/components/UI';

export default function Player() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const video = useStore((s) => s.vaultVideos.find((v) => v.id === id));
  const folders = useStore((s) => s.vaultFolders);
  const updateVideo = useStore((s) => s.updateVideo);
  const addTimedNote = useStore((s) => s.addTimedNote);
  const removeTimedNote = useStore((s) => s.removeTimedNote);
  const addBookmark = useStore((s) => s.addBookmark);
  const removeBookmark = useStore((s) => s.removeBookmark);
  const addNote = useStore((s) => s.addNote);

  const playerRef = useRef<YoutubeIframeRef>(null);
  const [playing, setPlaying] = useState(false);
  const [noteSheet, setNoteSheet] = useState<{ time: number } | null>(null);
  const [bmSheet, setBmSheet] = useState<{ time: number } | null>(null);
  const [draft, setDraft] = useState('');
  const [folderSheet, setFolderSheet] = useState(false);

  if (!video) {
    return (
      <ScreenBG>
        <Text style={{ color: C.textDim, textAlign: 'center', marginTop: 60 }}>Video not found.</Text>
      </ScreenBG>
    );
  }

  const now = async () => {
    try { return Math.floor((await playerRef.current?.getCurrentTime()) || 0); }
    catch { return 0; }
  };

  const seek = (t: number) => {
    playerRef.current?.seekTo(t, true);
    setPlaying(true);
  };

  const exportToNotes = () => {
    const lines = [
      `# ${video.title}`,
      `${video.url}`,
      '',
      '## Bookmarks',
      ...video.bookmarks.map((b) => `- [${fmtMediaTime(b.time)}${b.endTime ? `–${fmtMediaTime(b.endTime)}` : ''}] ${b.label}`),
      '',
      '## Timed notes',
      ...video.notes.map((n) => `- [${fmtMediaTime(n.time)}] ${n.text}`),
    ];
    addNote({ title: `Revision — ${video.title}`, body: lines.join('\n'), folder: 'General' });
    Alert.alert('Exported', 'A revision sheet was created in Notes.');
  };

  return (
    <ScreenBG>
      <Stack.Screen options={{ title: video.folder }} />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <YoutubePlayer
          ref={playerRef}
          height={Math.round(((width) * 9) / 16)}
          play={playing}
          videoId={video.videoId}
          onChangeState={(s: string) => {
            if (s === 'playing') setPlaying(true);
            if (s === 'paused' || s === 'ended') setPlaying(false);
          }}
        />
        <View style={{ padding: S.pad }}>
          <Text style={{ color: C.text, fontSize: 16, fontWeight: '700' }}>{video.title}</Text>

          <Row style={{ marginTop: 12, gap: 8, flexWrap: 'wrap' }}>
            <PillButton small label="Note @ now" icon="create-outline" color={C.green}
              onPress={async () => { setDraft(''); setNoteSheet({ time: await now() }); }} />
            <PillButton small label="Bookmark @ now" icon="bookmark-outline" color={C.pink}
              onPress={async () => { setDraft(''); setBmSheet({ time: await now() }); }} />
            <PillButton small label="→ Notes" icon="download-outline" color={C.accent} outline onPress={exportToNotes} />
            <PillButton small label="Move" icon="folder-outline" color={C.textDim} outline onPress={() => setFolderSheet(true)} />
          </Row>

          <SectionTitle>Bookmarks</SectionTitle>
          {video.bookmarks.length === 0 ? (
            <EmptyText>Mark key moments — tap one to jump there.</EmptyText>
          ) : (
            video.bookmarks.map((b) => (
              <GlassCard key={b.id} pad={10} onPress={() => seek(b.time)}>
                <Row>
                  <Text style={st.time}>{fmtMediaTime(b.time)}{b.endTime ? `–${fmtMediaTime(b.endTime)}` : ''}</Text>
                  <Text style={{ color: C.text, flex: 1, marginLeft: 10, fontSize: 14 }} numberOfLines={2}>{b.label}</Text>
                  <IconBtn name="close" size={16} onPress={() => removeBookmark(video.id, b.id)} />
                </Row>
              </GlassCard>
            ))
          )}

          <SectionTitle>Timed notes</SectionTitle>
          {video.notes.length === 0 ? (
            <EmptyText>Notes pinned to timestamps — "why does this step work?" @ 12:34.</EmptyText>
          ) : (
            video.notes.map((n) => (
              <GlassCard key={n.id} pad={10} onPress={() => seek(n.time)}>
                <Row>
                  <Text style={[st.time, { color: C.green, borderColor: C.green + '66', backgroundColor: C.green + '14' }]}>
                    {fmtMediaTime(n.time)}
                  </Text>
                  <Text style={{ color: C.text, flex: 1, marginLeft: 10, fontSize: 14 }}>{n.text}</Text>
                  <IconBtn name="close" size={16} onPress={() => removeTimedNote(video.id, n.id)} />
                </Row>
              </GlassCard>
            ))
          )}
        </View>
      </ScrollView>

      {/* timed note */}
      <Sheet visible={!!noteSheet} onClose={() => setNoteSheet(null)} title={`Note @ ${fmtMediaTime(noteSheet?.time || 0)}`}>
        <Field value={draft} onChangeText={setDraft} placeholder="What's worth remembering here?" autoFocus multiline style={{ minHeight: 70 }} />
        <PillButton label="Save note" color={C.green}
          onPress={() => { if (draft.trim() && noteSheet) { addTimedNote(video.id, noteSheet.time, draft.trim()); setNoteSheet(null); } }} />
      </Sheet>

      {/* bookmark */}
      <Sheet visible={!!bmSheet} onClose={() => setBmSheet(null)} title={`Bookmark @ ${fmtMediaTime(bmSheet?.time || 0)}`}>
        <Field value={draft} onChangeText={setDraft} placeholder="Label, e.g. 'Torque derivation'" autoFocus />
        <PillButton label="Save bookmark" color={C.pink}
          onPress={() => { if (bmSheet) { addBookmark(video.id, bmSheet.time, draft.trim() || 'Bookmark'); setBmSheet(null); } }} />
      </Sheet>

      {/* move folder */}
      <Sheet visible={folderSheet} onClose={() => setFolderSheet(false)} title="Move to folder">
        <Row style={{ flexWrap: 'wrap' }}>
          {folders.map((f) => (
            <Chip key={f} label={f} color={C.pink} active={video.folder === f}
              onPress={() => { updateVideo(video.id, { folder: f }); setFolderSheet(false); }} />
          ))}
        </Row>
      </Sheet>
    </ScreenBG>
  );
}

const st = StyleSheet.create({
  time: {
    color: C.pink, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'],
    borderWidth: 1, borderColor: C.pink + '66', backgroundColor: C.pink + '14',
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden',
  },
});
