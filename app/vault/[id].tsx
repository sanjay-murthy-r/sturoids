import React, { useCallback, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, BackHandler, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import YoutubePlayer, { YoutubeIframeRef } from 'react-native-youtube-iframe';
import { C, F, S, T } from '../../src/theme';
import { useStore, TimedNote, Bookmark } from '../../src/store';
import { fmtMediaTime } from '../../src/utils';
import {
  ScreenBG, Card, SectionTitle, Sheet, Field, PillButton, EmptyText, Row, Chip, IconBtn, DotMenu, NeuHeader,
} from '../../src/components/UI';
import { Enter } from '../../src/components/Motion';

export default function Player() {
  const { id, t } = useLocalSearchParams<{ id: string; t?: string }>();
  const { width } = useWindowDimensions();
  const video = useStore((s) => s.vaultVideos.find((v) => v.id === id));
  const folders = useStore((s) => s.vaultFolders);
  const updateVideo = useStore((s) => s.updateVideo);
  const addTimedNote = useStore((s) => s.addTimedNote);
  const updateTimedNote = useStore((s) => s.updateTimedNote);
  const removeTimedNote = useStore((s) => s.removeTimedNote);
  const addBookmark = useStore((s) => s.addBookmark);
  const updateBookmark = useStore((s) => s.updateBookmark);
  const removeBookmark = useStore((s) => s.removeBookmark);
  const addVideoTag = useStore((s) => s.addVideoTag);
  const removeVideoTag = useStore((s) => s.removeVideoTag);
  const addNote = useStore((s) => s.addNote);

  const playerRef = useRef<YoutubeIframeRef>(null);
  const seekDone = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [noteSheet, setNoteSheet] = useState<{ time: number } | null>(null);
  const [bmSheet, setBmSheet] = useState<{ time: number } | null>(null);
  const [draft, setDraft] = useState('');
  const [tagDraft, setTagDraft] = useState('');
  const [folderSheet, setFolderSheet] = useState(false);
  const [tagSheet, setTagSheet] = useState(false);
  const [menu, setMenu] = useState<{ item: TimedNote | Bookmark; isBookmark: boolean } | null>(null);
  const [editSheet, setEditSheet] = useState<{ item: any; isBookmark: boolean } | null>(null);

  // layered back: fullscreen video is a native surface parented to the whole
  // activity, so popping this route out from under it strands a black overlay
  // and leaves the orientation unlocked — swallow back until the player exits
  const fullscreen = useRef(false);
  const blockBack = useCallback(() => fullscreen.current, []);
  useFocusEffect(useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', blockBack);
    return () => sub.remove();
  }, [blockBack]));

  if (!video) {
    return (
      <ScreenBG>
        <NeuHeader title="YT Vault" />
        <Text style={{ color: C.textDim, textAlign: 'center', marginTop: 60 }}>Video not found.</Text>
      </ScreenBG>
    );
  }

  const now = async () => {
    try { return Math.floor((await playerRef.current?.getCurrentTime()) || 0); }
    catch { return 0; }
  };

  const seek = (sec: number) => {
    playerRef.current?.seekTo(sec, true);
    setPlaying(true);
  };

  const onReady = () => {
    const start = parseInt(String(t || ''), 10);
    if (!seekDone.current && start > 0) {
      seekDone.current = true;
      playerRef.current?.seekTo(start, true);
      setPlaying(true);
    }
  };

  const exportToNotes = () => {
    const lines = [
      '# ' + video.title,
      video.url,
      video.tags.length ? video.tags.map((x) => '#' + x).join(' ') : '',
      '',
      '## Bookmarks',
      ...video.bookmarks.map((b) => '- [' + fmtMediaTime(b.time) + (b.endTime ? '-' + fmtMediaTime(b.endTime) : '') + '] ' + b.label),
      '',
      '## Timed notes',
      ...video.notes.map((n) => '- [' + fmtMediaTime(n.time) + '] ' + n.text),
    ];
    addNote({ title: 'Revision — ' + video.title, body: lines.join('\n'), folder: 'General' });
    Alert.alert('Exported', 'A revision sheet was created in Notes.');
  };

  const itemRow = (item: TimedNote | Bookmark, isBookmark: boolean, i: number) => (
    <Enter key={item.id} index={Math.min(i, 6)}>
      <Card pad={10} onPress={() => seek(item.time)}>
        <Row>
          <View style={[st.timePill, { borderColor: (isBookmark ? C.pink : C.green) + '66', backgroundColor: (isBookmark ? C.pink : C.green) + '14' }]}>
            <Text style={{ color: isBookmark ? C.pink : C.green, fontSize: 11, fontFamily: F.semi, fontVariant: ['tabular-nums'] }}>
              {fmtMediaTime(item.time)}
              {'endTime' in item && item.endTime ? '-' + fmtMediaTime(item.endTime) : ''}
            </Text>
          </View>
          <Text style={[T.body, { flex: 1, marginLeft: 10, fontSize: 14 }]}>
            {isBookmark ? (item as Bookmark).label : (item as TimedNote).text}
          </Text>
          <IconBtn name="ellipsis-vertical" size={16} onPress={() => setMenu({ item, isBookmark })} />
        </Row>
      </Card>
    </Enter>
  );

  return (
    <ScreenBG>
      <NeuHeader title={video.folderId ? folders.find((f) => f.id === video.folderId)?.name || 'YT Vault' : 'YT Vault'} />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <YoutubePlayer
          ref={playerRef}
          height={Math.round((width * 9) / 16)}
          play={playing}
          videoId={video.videoId}
          onReady={onReady}
          onFullScreenChange={(f: boolean) => { fullscreen.current = f; }}
          onChangeState={(s: string) => {
            if (s === 'playing') setPlaying(true);
            if (s === 'paused' || s === 'ended') setPlaying(false);
          }}
        />
        <View style={{ padding: S.pad }}>
          <Text style={T.title}>{video.title}</Text>

          <Row style={{ flexWrap: 'wrap', marginTop: 10 }}>
            {video.tags.map((x) => (
              <Chip key={x} small label={'#' + x} color={C.teal} active onPress={() => removeVideoTag(video.id, x)} />
            ))}
            <Chip small label="+ tag" onPress={() => { setTagDraft(''); setTagSheet(true); }} />
          </Row>

          <Row style={{ marginTop: 10, gap: 8, flexWrap: 'wrap' }}>
            <PillButton small label="Note @ now" icon="create-outline" color={C.green}
              onPress={async () => { setDraft(''); setNoteSheet({ time: await now() }); }} />
            <PillButton small label="Mark @ now" icon="bookmark-outline" color={C.pink}
              onPress={async () => { setDraft(''); setBmSheet({ time: await now() }); }} />
            <PillButton small label="→ Notes" icon="download-outline" color={C.accent} outline onPress={exportToNotes} />
            <PillButton small label="Move" icon="folder-outline" color={C.textDim} outline onPress={() => setFolderSheet(true)} />
          </Row>

          <SectionTitle>Bookmarks</SectionTitle>
          {video.bookmarks.length === 0 ? (
            <EmptyText>Mark key moments — tap one to jump there.</EmptyText>
          ) : (
            video.bookmarks.map((b, i) => itemRow(b, true, i))
          )}

          <SectionTitle>Timed notes</SectionTitle>
          {video.notes.length === 0 ? (
            <EmptyText>Notes pinned to timestamps — "why does this step work?" @ 12:34.</EmptyText>
          ) : (
            video.notes.map((n, i) => itemRow(n, false, i))
          )}
        </View>
      </ScrollView>

      <Sheet visible={!!noteSheet} onClose={() => setNoteSheet(null)} title={'Note @ ' + fmtMediaTime(noteSheet?.time || 0)}>
        <Field value={draft} onChangeText={setDraft} placeholder="What's worth remembering here?" autoFocus multiline style={{ minHeight: 70 }} />
        <PillButton label="Save note" color={C.green}
          onPress={() => { if (draft.trim() && noteSheet) { addTimedNote(video.id, noteSheet.time, draft.trim()); setNoteSheet(null); } }} />
      </Sheet>

      <Sheet visible={!!bmSheet} onClose={() => setBmSheet(null)} title={'Bookmark @ ' + fmtMediaTime(bmSheet?.time || 0)}>
        <Field value={draft} onChangeText={setDraft} placeholder="Label, e.g. 'Torque derivation'" autoFocus />
        <PillButton label="Save bookmark" color={C.pink}
          onPress={() => { if (bmSheet) { addBookmark(video.id, bmSheet.time, draft.trim() || 'Bookmark'); setBmSheet(null); } }} />
      </Sheet>

      <Sheet visible={tagSheet} onClose={() => setTagSheet(false)} title="Add hashtag">
        <Field value={tagDraft} onChangeText={setTagDraft} placeholder="e.g. rotation, organic, pyq" autoFocus autoCapitalize="none" />
        <PillButton label="Add" color={C.teal}
          onPress={() => { if (tagDraft.trim()) { addVideoTag(video.id, tagDraft); setTagSheet(false); } }} />
        <Text style={[T.caption, { marginTop: 8 }]}>Tap a tag on the video page to remove it. Search the library with #tag.</Text>
      </Sheet>

      <Sheet visible={folderSheet} onClose={() => setFolderSheet(false)} title="Move to folder">
        <Row style={{ flexWrap: 'wrap' }}>
          <Chip label="⌂ No folder" color={C.pink} active={video.folderId === null}
            onPress={() => { updateVideo(video.id, { folderId: null }); setFolderSheet(false); }} />
          {folders.map((f) => (
            <Chip key={f.id} label={f.parentId ? '· ' + f.name : f.name} color={C.pink} active={video.folderId === f.id}
              onPress={() => { updateVideo(video.id, { folderId: f.id }); setFolderSheet(false); }} />
          ))}
        </Row>
      </Sheet>

      <DotMenu
        visible={!!menu}
        onClose={() => setMenu(null)}
        items={menu ? [
          { label: 'Jump to moment', icon: 'play-outline', onPress: () => seek(menu.item.time) },
          {
            label: 'Edit', icon: 'create-outline',
            onPress: () => { setDraft(menu.isBookmark ? (menu.item as Bookmark).label : (menu.item as TimedNote).text); setEditSheet(menu); },
          },
          {
            label: 'Delete', icon: 'trash-outline', color: C.danger,
            onPress: () => {
              if (menu.isBookmark) removeBookmark(video.id, menu.item.id);
              else removeTimedNote(video.id, menu.item.id);
            },
          },
        ] : []}
      />

      <Sheet visible={!!editSheet} onClose={() => setEditSheet(null)} title={'Edit @ ' + fmtMediaTime(editSheet?.item?.time || 0)}>
        <Field value={draft} onChangeText={setDraft} autoFocus multiline style={{ minHeight: 60 }} />
        <PillButton
          label="Save"
          onPress={() => {
            if (!editSheet) return;
            if (editSheet.isBookmark) updateBookmark(video.id, editSheet.item.id, draft.trim());
            else updateTimedNote(video.id, editSheet.item.id, draft.trim());
            setEditSheet(null);
          }}
        />
      </Sheet>
    </ScreenBG>
  );
}

const st = StyleSheet.create({
  timePill: {
    borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4,
  },
});
