import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { C, S } from '../../src/theme';
import { useStore } from '../../src/store';
import { parseYouTubeId } from '../../src/utils';
import { ScreenBG, GlassCard, Field, EmptyText, Row, Chip, Sheet, PillButton, IconBtn } from '../../src/components/UI';

async function fetchTitle(videoId: string): Promise<string> {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
    if (!r.ok) throw new Error();
    const j = await r.json();
    return j.title || `Video ${videoId}`;
  } catch {
    return `Video ${videoId}`;
  }
}

export default function VaultLibrary() {
  const router = useRouter();
  const videos = useStore((s) => s.vaultVideos);
  const folders = useStore((s) => s.vaultFolders);
  const addVideo = useStore((s) => s.addVideo);
  const deleteVideo = useStore((s) => s.deleteVideo);
  const addVaultFolder = useStore((s) => s.addVaultFolder);

  const [url, setUrl] = useState('');
  const [folder, setFolder] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [folderSheet, setFolderSheet] = useState(false);
  const [newFolder, setNewFolder] = useState('');
  const [adding, setAdding] = useState(false);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return videos
      .filter((v) => (folder ? v.folder === folder : true))
      .filter((v) => !ql || v.title.toLowerCase().includes(ql) || v.tags.some((t) => t.toLowerCase().includes(ql)))
      .sort((a, b) => b.addedAt - a.addedAt);
  }, [videos, folder, q]);

  const submit = async (raw: string) => {
    const id = parseYouTubeId(raw);
    if (!id) { Alert.alert('Not a YouTube link', 'Paste a full YouTube URL (watch, youtu.be, shorts…).'); return; }
    if (videos.some((v) => v.videoId === id)) { Alert.alert('Already in Vault', 'That video is saved already.'); return; }
    setAdding(true);
    const title = await fetchTitle(id);
    const vid = addVideo({ url: raw.trim(), videoId: id, title, folder: folder || 'Inbox' });
    setAdding(false); setUrl('');
    router.push(`/vault/${vid}`);
  };

  const paste = async () => {
    const t = await Clipboard.getStringAsync();
    if (t) { setUrl(t); submit(t); }
    else Alert.alert('Clipboard empty', 'Copy a YouTube link first.');
  };

  return (
    <ScreenBG>
      <ScrollView contentContainerStyle={{ padding: S.pad, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {/* capture */}
        <GlassCard pad={12}>
          <Row>
            <Field
              value={url} onChangeText={setUrl} placeholder="Paste a YouTube link…"
              autoCapitalize="none" style={{ flex: 1, marginBottom: 0 }}
              onSubmitEditing={() => url.trim() && submit(url)}
            />
            <IconBtn name="clipboard-outline" color={C.pink} size={24} style={{ marginLeft: 8 }} onPress={paste} />
            <IconBtn name="add-circle" color={C.pink} size={30} onPress={() => url.trim() && submit(url)} />
          </Row>
          <Text style={{ color: C.textFaint, fontSize: 11, marginTop: 8 }}>
            {adding ? 'Fetching title…' : 'New videos land in the Inbox — organise later. Share-to-app arrives with the APK build.'}
          </Text>
        </GlassCard>

        <Field value={q} onChangeText={setQ} placeholder="Search library…" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
          <Chip label="All" active={!folder} onPress={() => setFolder(null)} />
          {folders.map((f) => (
            <Chip key={f} label={f} active={folder === f} color={C.pink} onPress={() => setFolder(f)} />
          ))}
          <Chip label="+ folder" onPress={() => setFolderSheet(true)} />
        </ScrollView>

        {filtered.length === 0 ? (
          <EmptyText>Your study-video library.{'\n'}Save lectures, add timed notes & bookmarks, revise fast.</EmptyText>
        ) : (
          filtered.map((v) => (
            <GlassCard key={v.id} pad={12} onPress={() => router.push(`/vault/${v.id}`)}>
              <Row>
                <Ionicons name="logo-youtube" size={22} color={C.pink} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={{ color: C.text, fontSize: 14, fontWeight: '600' }} numberOfLines={2}>{v.title}</Text>
                  <Text style={{ color: C.textFaint, fontSize: 11, marginTop: 3 }}>
                    {v.folder} · {v.notes.length} notes · {v.bookmarks.length} bookmarks
                  </Text>
                </View>
                <IconBtn
                  name="trash-outline" size={18}
                  onPress={() =>
                    Alert.alert('Remove video', `Remove "${v.title}" and its notes?`, [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Remove', style: 'destructive', onPress: () => deleteVideo(v.id) },
                    ])
                  }
                />
              </Row>
            </GlassCard>
          ))
        )}
      </ScrollView>

      <Sheet visible={folderSheet} onClose={() => setFolderSheet(false)} title="New Vault folder">
        <Field value={newFolder} onChangeText={setNewFolder} placeholder="e.g. Physics — Rotation" autoFocus />
        <PillButton
          label="Create" color={C.pink}
          onPress={() => { if (newFolder.trim()) { addVaultFolder(newFolder.trim()); setNewFolder(''); setFolderSheet(false); } }}
        />
      </Sheet>
    </ScreenBG>
  );
}
