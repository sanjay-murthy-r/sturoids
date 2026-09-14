import React, { useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Alert, BackHandler, Image, useWindowDimensions,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { C, F, S, T } from '../theme';
import { useStore, VaultVideo, VaultFolder } from '../store';
import { parseYouTubeId, fmtMediaTime } from '../utils';
import {
  ScreenBG, Card, Field, EmptyText, Row, Chip, Sheet, PillButton, IconBtn, NeuHeader, NeuIconBtn, DotMenu,
} from '../components/UI';
import { SegmentedControl } from '../components/SegmentedControl';
import { Enter } from '../components/Motion';
import { useToolNav } from '../toolNav';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const thumb = (videoId: string) => 'https://img.youtube.com/vi/' + videoId + '/mqdefault.jpg';

async function fetchTitle(videoId: string): Promise<string> {
  try {
    const r = await fetch('https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=' + videoId + '&format=json');
    if (!r.ok) throw new Error();
    const j = await r.json();
    return j.title || 'Video ' + videoId;
  } catch {
    return 'Video ' + videoId;
  }
}

type ViewTab = 'library' | 'recent' | 'notes';

export function VaultLibraryScreen({ mode }: { mode: 'tab' | 'stack' }) {
  const nav = useToolNav();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const videos = useStore((s) => s.vaultVideos);
  const folders = useStore((s) => s.vaultFolders);
  const addVideo = useStore((s) => s.addVideo);
  const deleteVideo = useStore((s) => s.deleteVideo);
  const updateVideo = useStore((s) => s.updateVideo);
  const addVaultFolder = useStore((s) => s.addVaultFolder);
  const renameVaultFolder = useStore((s) => s.renameVaultFolder);
  const deleteVaultFolder = useStore((s) => s.deleteVaultFolder);
  const removeTimedNote = useStore((s) => s.removeTimedNote);
  const removeBookmark = useStore((s) => s.removeBookmark);
  const updateTimedNote = useStore((s) => s.updateTimedNote);
  const updateBookmark = useStore((s) => s.updateBookmark);

  const [tab, setTab] = useState<ViewTab>('library');
  const [cwd, setCwd] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [folderSheet, setFolderSheet] = useState<{ mode: 'new' | 'rename'; folder?: VaultFolder } | null>(null);
  const [folderName, setFolderName] = useState('');
  const [videoMenu, setVideoMenu] = useState<VaultVideo | null>(null);
  const [folderMenu, setFolderMenu] = useState<VaultFolder | null>(null);
  const [moveSheet, setMoveSheet] = useState<VaultVideo | null>(null);
  const [noteMenu, setNoteMenu] = useState<any>(null);
  const [editSheet, setEditSheet] = useState<any>(null);
  const [editDraft, setEditDraft] = useState('');
  const [previewSheet, setPreviewSheet] = useState<any>(null);
  const pagerRef = useRef<ScrollView>(null);

  const subFolders = useMemo(
    () => folders.filter((f) => f.parentId === cwd).sort((a, b) => a.name.localeCompare(b.name)),
    [folders, cwd]
  );
  const cwdFolder = folders.find((f) => f.id === cwd) || null;

  // layered back: system back climbs sub-folder → folder → tool
  const cwdRef = useRef(cwdFolder); cwdRef.current = cwdFolder;
  const goUp = React.useCallback(() => {
    const cur = cwdRef.current;
    if (!cur) return false;
    setCwd(cur.parentId ?? null);
    return true;
  }, []);
  useFocusEffect(React.useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', goUp);
    return () => sub.remove();
  }, [goUp]));

  const match = (v: VaultVideo) => {
    const ql = q.trim().toLowerCase();
    if (!ql) return true;
    if (ql.startsWith('#')) return v.tags.some((t) => t.includes(ql.slice(1)));
    return v.title.toLowerCase().includes(ql) || v.tags.some((t) => t.includes(ql));
  };

  const hereVideos = useMemo(
    () => videos.filter((v) => v.folderId === cwd).filter(match).sort((a, b) => b.addedAt - a.addedAt),
    [videos, cwd, q]
  );
  const recentVideos = useMemo(
    () => [...videos].filter(match).sort((a, b) => b.addedAt - a.addedAt),
    [videos, q]
  );
  const allNotes = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const out: { video: VaultVideo; item: any; isBookmark: boolean }[] = [];
    for (const v of videos) {
      v.notes.forEach((n) => out.push({ video: v, item: n, isBookmark: false }));
      v.bookmarks.forEach((b) => out.push({ video: v, item: b, isBookmark: true }));
    }
    return out
      .filter((x) => !ql || (x.isBookmark ? x.item.label : x.item.text).toLowerCase().includes(ql) || x.video.title.toLowerCase().includes(ql))
      .sort((a, b) => b.video.addedAt - a.video.addedAt || a.item.time - b.item.time);
  }, [videos, q]);

  const submit = async (raw: string) => {
    const id = parseYouTubeId(raw);
    if (!id) { Alert.alert('Not a YouTube link', 'Paste a full YouTube URL (watch, youtu.be, shorts…).'); return; }
    if (videos.some((v) => v.videoId === id)) { Alert.alert('Already saved', 'That video is in the Vault.'); return; }
    setAdding(true);
    const title = await fetchTitle(id);
    const vid = addVideo({ url: raw.trim(), videoId: id, title, folderId: cwd });
    setAdding(false); setUrl('');
    nav.openVideo(vid);
  };

  const paste = async () => {
    const t = await Clipboard.getStringAsync();
    if (t) submit(t);
    else Alert.alert('Clipboard empty', 'Copy a YouTube link first.');
  };

  const submitFolder = () => {
    const n = folderName.trim();
    if (!n || !folderSheet) return;
    if (folderSheet.mode === 'new') addVaultFolder(n, cwd);
    else if (folderSheet.folder) renameVaultFolder(folderSheet.folder.id, n);
    setFolderName(''); setFolderSheet(null);
  };

  const goTab = (t: ViewTab) => {
    setTab(t);
    const idx = ['library', 'recent', 'notes'].indexOf(t);
    pagerRef.current?.scrollTo({ x: idx * width, animated: true });
  };

  const openAt = (videoDbId: string, time: number) =>
    nav.openVideo(videoDbId, time);

  const videoRow = (v: VaultVideo, i: number, showFolder = false) => (
    <Enter key={v.id} index={Math.min(i, 8)}>
      <Card pad={10} onPress={() => nav.openVideo(v.id)}>
        <Row>
          <Image source={{ uri: thumb(v.videoId) }} style={st.thumb} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={[T.body, { fontFamily: F.semi, fontSize: 14, lineHeight: 19 }]} numberOfLines={2}>{v.title}</Text>
            <Text style={[T.caption, { marginTop: 3 }]} numberOfLines={1}>
              {showFolder && v.folderId ? (folders.find((f) => f.id === v.folderId)?.name || '') + ' · ' : ''}
              {v.notes.length} notes · {v.bookmarks.length} marks
              {v.tags.length ? ' · ' + v.tags.map((t) => '#' + t).join(' ') : ''}
            </Text>
          </View>
          <IconBtn name="ellipsis-vertical" size={17} onPress={() => setVideoMenu(v)} />
        </Row>
      </Card>
    </Enter>
  );

  const pageW = width;

  return (
    <ScreenBG guard={mode === 'tab'} fling={false}>
      <NeuHeader
        title={cwdFolder ? cwdFolder.name : 'YT Vault'}
        variant={mode === 'tab' && !cwdFolder ? 'tab' : 'page'}
        onBack={() => { if (!goUp()) router.back(); }}
      />
      <View style={{ flex: 1 }}>
        <View style={{ padding: S.pad, paddingBottom: 0 }}>
          <Card pad={12}>
            <Row>
              <Field
                value={url} onChangeText={setUrl} placeholder={cwdFolder ? 'Add to ' + cwdFolder.name + '…' : 'Paste a YouTube link…'}
                autoCapitalize="none" style={{ flex: 1, marginBottom: 0 }}
                onSubmitEditing={() => url.trim() && submit(url)}
              />
              <IconBtn name="clipboard-outline" color={C.pink} size={22} style={{ marginLeft: 4 }} onPress={paste} />
              <NeuIconBtn name="add" color={C.pink} dim={40} onPress={() => url.trim() && submit(url)} />
            </Row>
            {adding && <Text style={[T.caption, { marginTop: 6 }]}>Fetching title…</Text>}
          </Card>

          <Field value={q} onChangeText={setQ} placeholder="Search titles, #tags, notes…" />

          <SegmentedControl
            color={C.pink}
            stretch
            style={{ marginBottom: 10 }}
            options={[
              { key: 'library', label: 'Library' },
              { key: 'recent', label: 'Recent' },
              { key: 'notes', label: 'All notes' },
            ]}
            value={tab}
            onChange={(k) => goTab(k as ViewTab)}
          />
        </View>

        <ScrollView
          ref={pagerRef}
          horizontal pagingEnabled showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => {
            const idx = Math.round(e.nativeEvent.contentOffset.x / pageW);
            setTab((['library', 'recent', 'notes'] as ViewTab[])[idx] || 'library');
          }}
        >
          <ScrollView style={{ width: pageW }} contentContainerStyle={{ padding: S.pad, paddingTop: 4, paddingBottom: 40 + (mode === 'tab' ? 0 : insets.bottom) }}>
            {/* the header already names the folder: this row only moves between folders and adds one */}
            <Row style={{ marginBottom: 10, flexWrap: 'wrap' }}>
              <Chip small icon="home-outline" label="All" active={cwd === null} color={C.pink} onPress={() => setCwd(null)} />
              {cwdFolder && (
                <Chip small icon="arrow-up-outline" label="Up" onPress={() => setCwd(cwdFolder.parentId)} />
              )}
              <Chip small icon="add" label="Folder" onPress={() => { setFolderName(''); setFolderSheet({ mode: 'new' }); }} />
            </Row>

            {subFolders.map((f, i) => {
              const count = videos.filter((v) => v.folderId === f.id).length + folders.filter((x) => x.parentId === f.id).length;
              return (
                <Enter key={f.id} index={i}>
                  <Card pad={12} onPress={() => setCwd(f.id)} onLongPress={() => setFolderMenu(f)}>
                    <Row>
                      <Ionicons name="folder" size={22} color={C.amber} />
                      <Text style={[T.title, { flex: 1, marginLeft: 12, fontSize: 15 }]} numberOfLines={1}>{f.name}</Text>
                      <Text style={T.caption}>{count}</Text>
                      <IconBtn name="ellipsis-vertical" size={16} onPress={() => setFolderMenu(f)} />
                    </Row>
                  </Card>
                </Enter>
              );
            })}

            {hereVideos.map((v, i) => videoRow(v, subFolders.length + i))}
            {subFolders.length === 0 && hereVideos.length === 0 && (
              <EmptyText>
                {cwd ? 'This folder is empty.' : 'Your study-video library.\nPaste a lecture link above — folders and subfolders keep it tidy.'}
              </EmptyText>
            )}
          </ScrollView>

          <ScrollView style={{ width: pageW }} contentContainerStyle={{ padding: S.pad, paddingTop: 4, paddingBottom: 40 + (mode === 'tab' ? 0 : insets.bottom) }}>
            {recentVideos.length === 0 ? (
              <EmptyText>Recently added videos land here, newest first.</EmptyText>
            ) : (
              recentVideos.map((v, i) => videoRow(v, i, true))
            )}
          </ScrollView>

          <ScrollView style={{ width: pageW }} contentContainerStyle={{ padding: S.pad, paddingTop: 4, paddingBottom: 40 + (mode === 'tab' ? 0 : insets.bottom) }}>
            {allNotes.length === 0 ? (
              <EmptyText>Every timed note and bookmark from every video, in one place.{'\n'}Tap one to jump straight into the video at that moment.</EmptyText>
            ) : (
              allNotes.map((x, i) => (
                <Enter key={(x.isBookmark ? 'b' : 'n') + x.item.id} index={Math.min(i, 8)}>
                  <Card pad={11} onPress={() => openAt(x.video.id, x.item.time)}>
                    <Row>
                      <View style={[st.timePill, { borderColor: (x.isBookmark ? C.pink : C.green) + '66', backgroundColor: (x.isBookmark ? C.pink : C.green) + '14' }]}>
                        <Ionicons name={x.isBookmark ? 'bookmark' : 'create-outline'} size={11} color={x.isBookmark ? C.pink : C.green} />
                        <Text style={{ color: x.isBookmark ? C.pink : C.green, fontSize: 11, fontFamily: F.semi, marginLeft: 4, fontVariant: ['tabular-nums'] }}>
                          {fmtMediaTime(x.item.time)}
                        </Text>
                      </View>
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={[T.body, { fontSize: 14 }]} numberOfLines={2}>
                          {x.isBookmark ? x.item.label : x.item.text}
                        </Text>
                        <Text style={[T.caption, { marginTop: 2 }]} numberOfLines={1}>{x.video.title}</Text>
                      </View>
                      <IconBtn name="ellipsis-vertical" size={17} onPress={() => setNoteMenu(x)} />
                    </Row>
                  </Card>
                </Enter>
              ))
            )}
          </ScrollView>
        </ScrollView>
      </View>

      <Sheet
        visible={!!folderSheet}
        onClose={() => setFolderSheet(null)}
        title={folderSheet?.mode === 'new' ? (cwdFolder ? 'New subfolder in ' + cwdFolder.name : 'New folder') : 'Rename folder'}
      >
        <Field value={folderName} onChangeText={setFolderName} placeholder="e.g. Physics — Rotation" autoFocus />
        <PillButton label={folderSheet?.mode === 'new' ? 'Create' : 'Rename'} color={C.pink} onPress={submitFolder} />
      </Sheet>

      <DotMenu
        visible={!!folderMenu}
        onClose={() => setFolderMenu(null)}
        items={folderMenu ? [
          { label: 'Open', icon: 'folder-open-outline', onPress: () => setCwd(folderMenu.id) },
          { label: 'Rename', icon: 'create-outline', onPress: () => { setFolderName(folderMenu.name); setFolderSheet({ mode: 'rename', folder: folderMenu }); } },
          {
            label: 'Delete (contents move up)', icon: 'trash-outline', color: C.danger,
            onPress: () => deleteVaultFolder(folderMenu.id),
          },
        ] : []}
      />

      <DotMenu
        visible={!!videoMenu}
        onClose={() => setVideoMenu(null)}
        items={videoMenu ? [
          { label: 'Open', icon: 'play-outline', onPress: () => nav.openVideo(videoMenu.id) },
          { label: 'Move to folder', icon: 'folder-outline', onPress: () => setMoveSheet(videoMenu) },
          {
            label: 'Remove from Vault', icon: 'trash-outline', color: C.danger,
            onPress: () =>
              Alert.alert('Remove video', 'Remove "' + videoMenu.title + '" and its notes?', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Remove', style: 'destructive', onPress: () => deleteVideo(videoMenu.id) },
              ]),
          },
        ] : []}
      />

      <Sheet visible={!!moveSheet} onClose={() => setMoveSheet(null)} title="Move to folder">
        <Row style={{ flexWrap: 'wrap' }}>
          <Chip label="⌂ No folder" color={C.pink} active={moveSheet?.folderId === null}
            onPress={() => { if (moveSheet) updateVideo(moveSheet.id, { folderId: null }); setMoveSheet(null); }} />
          {folders.map((f) => (
            <Chip key={f.id} label={f.parentId ? '· ' + f.name : f.name} color={C.pink} active={moveSheet?.folderId === f.id}
              onPress={() => { if (moveSheet) updateVideo(moveSheet.id, { folderId: f.id }); setMoveSheet(null); }} />
          ))}
        </Row>
      </Sheet>

      <DotMenu
        visible={!!noteMenu}
        onClose={() => setNoteMenu(null)}
        items={noteMenu ? [
          { label: 'Jump to moment', icon: 'play-outline', onPress: () => openAt(noteMenu.video.id, noteMenu.item.time) },
          { label: 'Edit', icon: 'create-outline', onPress: () => { setEditDraft(noteMenu.isBookmark ? noteMenu.item.label : noteMenu.item.text); setEditSheet(noteMenu); } },
          { label: 'Preview video', icon: 'image-outline', onPress: () => setPreviewSheet(noteMenu) },
          {
            label: 'Delete', icon: 'trash-outline', color: C.danger,
            onPress: () => {
              if (noteMenu.isBookmark) removeBookmark(noteMenu.video.id, noteMenu.item.id);
              else removeTimedNote(noteMenu.video.id, noteMenu.item.id);
            },
          },
        ] : []}
      />

      <Sheet visible={!!editSheet} onClose={() => setEditSheet(null)} title={'Edit @ ' + fmtMediaTime(editSheet?.item?.time || 0)}>
        <Field value={editDraft} onChangeText={setEditDraft} autoFocus multiline style={{ minHeight: 60 }} />
        <PillButton
          label="Save"
          onPress={() => {
            if (!editSheet) return;
            if (editSheet.isBookmark) updateBookmark(editSheet.video.id, editSheet.item.id, editDraft.trim());
            else updateTimedNote(editSheet.video.id, editSheet.item.id, editDraft.trim());
            setEditSheet(null);
          }}
        />
      </Sheet>

      <Sheet visible={!!previewSheet} onClose={() => setPreviewSheet(null)}>
        {previewSheet && (
          <View>
            <Image
              source={{ uri: thumb(previewSheet.video.videoId) }}
              style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 16 }}
            />
            <Text style={[T.title, { marginTop: 12 }]}>{previewSheet.video.title}</Text>
            <Text style={[T.caption, { marginTop: 4 }]}>
              {previewSheet.isBookmark ? 'Bookmark' : 'Note'} @ {fmtMediaTime(previewSheet.item.time)}
            </Text>
            <PillButton
              label="Watch from here" color={C.pink} style={{ marginTop: 14 }}
              onPress={() => { const p = previewSheet; setPreviewSheet(null); openAt(p.video.id, p.item.time); }}
            />
          </View>
        )}
      </Sheet>
    </ScreenBG>
  );
}

const st = StyleSheet.create({
  thumb: { width: 92, height: 52, borderRadius: 10, backgroundColor: '#000' },
  timePill: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4,
  },
});
