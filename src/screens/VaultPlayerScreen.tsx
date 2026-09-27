import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, BackHandler, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import YoutubePlayer, { YoutubeIframeRef } from 'react-native-youtube-iframe';
import Animated from 'react-native-reanimated';
import { C, F, S, T } from '../theme';
import { useStore, TimedNote, Bookmark } from '../store';
import { fmtMediaTime } from '../utils';
import {
  ScreenBG, Card, SectionTitle, Sheet, Field, PillButton, EmptyState, Row, Chip, IconBtn, DotMenu, NeuHeader,
} from '../components/UI';
import { toast } from '../components/Toast';
import { glide, rowIn, rowOut, useAnimLevel, useBuilt, useEntrance } from '../components/Motion';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { READ_MAX, TWO_COL_AT, WIDE_AT, WIDE_MAX, columnWidth, frame } from '../layout';

/** on a wide window the video never takes more than this share of the window's height */
const PLAYER_MAX_H = 0.55;
/** between the video's column and the notes' column on a sideways tablet */
const COL_GAP = 28;

/** The last value that was not null, so a sheet keeps its title and its rows while it closes. */
function useHeld<T>(value: T | null): T | null {
  const held = useRef(value);
  if (value != null) held.current = value;
  return held.current;
}

/**
 * A sheet with one field and one button. It keeps its own draft, so typing re-renders the sheet and not the page under
 * it (here, a playing video). Each opening starts from `initial`.
 */
export function DraftSheet({
  visible, onClose, title, initial = '', placeholder, multiline, minHeight, autoCapitalize, label, color, hint, onSave,
}: {
  visible: boolean; onClose: () => void; title: string; initial?: string; placeholder?: string; multiline?: boolean;
  minHeight?: number; autoCapitalize?: 'none' | 'sentences'; label: string; color?: string;
  /** a quiet line under the button */
  hint?: string;
  onSave: (text: string) => void;
}) {
  const [draft, setDraft] = useState(initial);
  // each opening starts from `initial`, set in the same render that opens the sheet, so the field never shows the
  // last opening's words for a frame
  const [open, setOpen] = useState(visible);
  if (open !== visible) {
    setOpen(visible);
    if (visible) setDraft(initial);
  }
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <Field
        value={draft} onChangeText={setDraft} placeholder={placeholder} autoFocus multiline={multiline}
        autoCapitalize={autoCapitalize} style={minHeight ? { minHeight } : undefined}
      />
      <PillButton label={label} color={color} onPress={() => onSave(draft)} />
      {hint ? <Text style={[T.caption, { marginTop: 8 }]}>{hint}</Text> : null}
    </Sheet>
  );
}

/**
 * A bookmark or a timed note. The rows the page is built with rise in with it, the first time it is seen; one saved
 * later fades in where it lands, and one removed fades as it goes, while the rest glide into their places. The glide
 * and the fades sit on the outer layer and the entrance on the inner, so the two never fight.
 */
const ItemRow = React.memo(function ItemRow({ item, isBookmark, index, live, onSeek, onMenu }: {
  item: TimedNote | Bookmark; isBookmark: boolean; index: number;
  /** true for a row that arrives after the page was built: it fades in instead of rising with the page */
  live: boolean;
  onSeek: (sec: number) => void; onMenu: (m: { item: TimedNote | Bookmark; isBookmark: boolean }) => void;
}) {
  const level = useAnimLevel();
  const entrance = useEntrance(Math.min(index, 6), !live);
  const tint = isBookmark ? C.pink : C.green;
  return (
    <Animated.View entering={live ? rowIn(level) : undefined} exiting={rowOut(level)} layout={glide(level)}>
      <Animated.View style={entrance}>
        <Card pad={12} onPress={() => onSeek(item.time)}>
          <Row>
            <View style={[st.timePill, { borderColor: tint + '66', backgroundColor: tint + '14' }]}>
              <Text style={{ color: tint, fontSize: 11, fontFamily: F.semi, fontVariant: ['tabular-nums'] }}>
                {fmtMediaTime(item.time)}
                {'endTime' in item && item.endTime ? '-' + fmtMediaTime(item.endTime) : ''}
              </Text>
            </View>
            <Text style={[T.body, { flex: 1, marginLeft: 10, fontSize: 14 }]}>
              {isBookmark ? (item as Bookmark).label : (item as TimedNote).text}
            </Text>
            <IconBtn name="ellipsis-vertical" size={16} onPress={() => onMenu({ item, isBookmark })} accessibilityLabel="More" />
          </Row>
        </Card>
      </Animated.View>
    </Animated.View>
  );
});

export function VaultPlayerScreen({ mode }: { mode: 'tab' | 'stack' }) {
  const insets = useSafeAreaInsets();
  const level = useAnimLevel();
  // what arrives after the first paint (a saved note, a new tag) fades in; what the page is built with is simply there
  const built = useBuilt();
  const { id, t } = useLocalSearchParams<{ id: string; t?: string }>();
  const { width, height } = useWindowDimensions();
  const wide = width >= WIDE_AT;
  // the screen's area: the window on a phone; on a wide window known ahead (less the rail in a tab), then measured
  const [areaW, setAreaW] = useState(() => columnWidth(width, mode === 'tab', WIDE_MAX));
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
  const [folderSheet, setFolderSheet] = useState(false);
  const [tagSheet, setTagSheet] = useState(false);
  const [menu, setMenu] = useState<{ item: TimedNote | Bookmark; isBookmark: boolean } | null>(null);
  const [editSheet, setEditSheet] = useState<{ item: any; isBookmark: boolean } | null>(null);
  // what each sheet shows stays while it closes, instead of turning to "@ 0:00" or an empty menu on its way out
  const heldNote = useHeld(noteSheet);
  const heldBm = useHeld(bmSheet);
  const heldMenu = useHeld(menu);
  const heldEdit = useHeld(editSheet);

  // layered back: fullscreen video is a native surface parented to the whole
  // activity, so popping this route out from under it strands a black overlay
  // and leaves the orientation unlocked — swallow back until the player exits
  const fullscreen = useRef(false);
  const blockBack = useCallback(() => fullscreen.current, []);
  useFocusEffect(useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', blockBack);
    return () => sub.remove();
  }, [blockBack]));

  const seek = useCallback((sec: number) => {
    playerRef.current?.seekTo(sec, true);
    setPlaying(true);
  }, []);
  const onReady = useCallback(() => {
    const start = parseInt(String(t || ''), 10);
    if (!seekDone.current && start > 0) {
      seekDone.current = true;
      playerRef.current?.seekTo(start, true);
      setPlaying(true);
    }
  }, [t]);
  const onError = useCallback((e: string) => toast(
    e === 'embed_not_allowed' || e === 'HTML5_error'
      ? 'This video cannot play inside the app. Your notes and bookmarks are still here.'
      : e === 'video_not_found'
        ? 'This video is private or no longer on YouTube. Your notes and bookmarks are still here.'
        : 'The video would not load. Check your connection and open it again.',
  ), []);
  const onFullScreen = useCallback((f: boolean) => { fullscreen.current = f; }, []);
  const onState = useCallback((s: string) => {
    if (s === 'playing') setPlaying(true);
    if (s === 'paused' || s === 'ended') setPlaying(false);
  }, []);

  // a sideways tablet sets the notes beside the video; otherwise one column, the video across its top
  const twoCol = wide && areaW >= TWO_COL_AT;
  const colW = twoCol ? ((areaW - S.pad * 2 - COL_GAP) * 3) / 5 : Math.min(areaW, READ_MAX);
  // 16:9 across the column. A phone's video is exactly as it always was; a wide window's never takes over the
  // height, and when it would, it narrows to keep its shape
  let playerH = Math.round((colW * 9) / 16);
  let playerW: number | undefined;
  if (wide) {
    playerH = Math.min(playerH, Math.round(height * PLAYER_MAX_H));
    playerW = Math.min(Math.round(colW), Math.round((playerH * 16) / 9));
  }

  // the player is built only when what it shows changes: a note being typed, a tag or a sheet never re-renders it
  const videoId = video?.videoId;
  const player = useMemo(() => (videoId ? (
    <YoutubePlayer
      ref={playerRef}
      width={playerW}
      height={playerH}
      play={playing}
      videoId={videoId}
      onReady={onReady}
      onError={onError}
      onFullScreenChange={onFullScreen}
      onChangeState={onState}
    />
  ) : null), [videoId, playerW, playerH, playing, onReady, onError, onFullScreen, onState]);

  const openMenu = useCallback((m: { item: TimedNote | Bookmark; isBookmark: boolean }) => setMenu(m), []);

  if (!video) {
    // the text face, like every other empty page (a bare Text fell back to the system font)
    return (
      <ScreenBG>
        <NeuHeader title="YT Vault" />
        <EmptyState icon="play-circle-outline" title="Video not found" body="It may have been removed from the Vault." />
      </ScreenBG>
    );
  }

  const now = async () => {
    try { return Math.floor((await playerRef.current?.getCurrentTime()) || 0); }
    catch { return 0; }
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
    addNote({ title: 'Revision: ' + video.title, body: lines.join('\n'), folder: 'General' });
    toast('Revision sheet added to Notes.');
  };

  const info = (
    <>
      <Text style={T.title}>{video.title}</Text>

      {/* a tag added fades in and one removed fades out, while the chips after it glide along the row */}
      <Row style={{ flexWrap: 'wrap', marginTop: 10 }}>
        {video.tags.map((x) => (
          <Animated.View key={x} entering={built.current ? rowIn(level) : undefined} exiting={rowOut(level)} layout={glide(level)}>
            <Chip small label={'#' + x} color={C.teal} active onPress={() => removeVideoTag(video.id, x)} />
          </Animated.View>
        ))}
        <Animated.View layout={glide(level)}>
          <Chip small label="+ tag" onPress={() => setTagSheet(true)} />
        </Animated.View>
      </Row>

      <Row style={{ marginTop: 10, gap: 8, flexWrap: 'wrap' }}>
        <PillButton small label="Note @ now" icon="create-outline" color={C.green}
          onPress={async () => { setNoteSheet({ time: await now() }); }} />
        <PillButton small label="Mark @ now" icon="bookmark-outline" color={C.pink}
          onPress={async () => { setBmSheet({ time: await now() }); }} />
        <PillButton small label="→ Notes" icon="download-outline" color={C.accent} outline onPress={exportToNotes} />
        <PillButton small label="Move" icon="folder-outline" color={C.textDim} outline onPress={() => setFolderSheet(true)} />
      </Row>
    </>
  );

  // the titles and the empty notes glide with the rows around them, so nothing jumps while a row folds away; an empty
  // note fades out as the first row fades in over its place
  const live = built.current;
  const lists = (
    <>
      <Animated.View layout={glide(level)}>
        <SectionTitle>Bookmarks</SectionTitle>
      </Animated.View>
      {video.bookmarks.length === 0 ? (
        <Animated.View layout={glide(level)} exiting={rowOut(level)}>
          <EmptyState compact icon="bookmark-outline" title="No bookmarks yet" body="Mark key moments, then tap one to jump there." />
        </Animated.View>
      ) : (
        video.bookmarks.map((b, i) => <ItemRow key={b.id} item={b} isBookmark index={i} live={live} onSeek={seek} onMenu={openMenu} />)
      )}

      <Animated.View layout={glide(level)}>
        <SectionTitle>Timed notes</SectionTitle>
      </Animated.View>
      {video.notes.length === 0 ? (
        <Animated.View layout={glide(level)} exiting={rowOut(level)}>
          <EmptyState compact icon="create-outline" title="No timed notes yet" body='Pin a note to a moment, like "why does this step work?" at 12:34.' />
        </Animated.View>
      ) : (
        video.notes.map((n, i) => <ItemRow key={n.id} item={n} isBookmark={false} index={i} live={live} onSeek={seek} onMenu={openMenu} />)
      )}
    </>
  );

  return (
    <ScreenBG maxWidth={WIDE_MAX}>
      <View style={frame(twoCol ? WIDE_MAX : READ_MAX)}>
        <NeuHeader title={video.folderId ? folders.find((f) => f.id === video.folderId)?.name || 'YT Vault' : 'YT Vault'} />
      </View>
      <ScrollView
        onLayout={(e) => { const w = e.nativeEvent.layout.width; if (Math.abs(w - areaW) > 0.5) setAreaW(w); }}
        contentContainerStyle={{ paddingBottom: 40 + (mode === 'tab' ? 0 : insets.bottom) }}
      >
        {twoCol ? (
          <View style={st.cols}>
            <View style={st.main}>
              <View style={{ alignItems: 'center' }}>{player}</View>
              <View style={{ paddingTop: S.pad }}>{info}</View>
            </View>
            <View style={st.side}>{lists}</View>
          </View>
        ) : (
          <View style={frame(READ_MAX)}>
            {wide ? <View style={{ alignItems: 'center' }}>{player}</View> : player}
            <View style={{ padding: S.pad }}>
              {info}
              {lists}
            </View>
          </View>
        )}
      </ScrollView>

      <DraftSheet
        visible={!!noteSheet} onClose={() => setNoteSheet(null)} title={'Note @ ' + fmtMediaTime(heldNote?.time || 0)}
        placeholder="What's worth remembering here?" multiline minHeight={70} label="Save note" color={C.green}
        onSave={(text) => { if (text.trim() && noteSheet) { addTimedNote(video.id, noteSheet.time, text.trim()); setNoteSheet(null); } }}
      />

      <DraftSheet
        visible={!!bmSheet} onClose={() => setBmSheet(null)} title={'Bookmark @ ' + fmtMediaTime(heldBm?.time || 0)}
        placeholder="Label, e.g. 'Torque derivation'" label="Save bookmark" color={C.pink}
        onSave={(text) => { if (bmSheet) { addBookmark(video.id, bmSheet.time, text.trim() || 'Bookmark'); setBmSheet(null); } }}
      />

      <DraftSheet
        visible={tagSheet} onClose={() => setTagSheet(false)} title="Add hashtag"
        placeholder="e.g. rotation, organic, pyq" autoCapitalize="none" label="Add" color={C.teal}
        hint="Tap a tag on the video page to remove it. Search the library with #tag."
        onSave={(text) => { if (text.trim()) { addVideoTag(video.id, text); setTagSheet(false); } }}
      />

      {/* the same chips as the library's own move sheet: an icon, not a text glyph, and a subfolder named with its parent */}
      <Sheet visible={folderSheet} onClose={() => setFolderSheet(false)} title="Move to folder">
        <Row style={{ flexWrap: 'wrap' }}>
          <Chip icon="home-outline" label="No folder" color={C.pink} active={video.folderId === null}
            onPress={() => { updateVideo(video.id, { folderId: null }); setFolderSheet(false); }} />
          {folders.map((f) => (
            <Chip key={f.id} icon="folder-outline" color={C.pink} active={video.folderId === f.id}
              label={f.parentId ? (folders.find((p) => p.id === f.parentId)?.name || '') + ' / ' + f.name : f.name}
              onPress={() => { updateVideo(video.id, { folderId: f.id }); setFolderSheet(false); }} />
          ))}
        </Row>
      </Sheet>

      <DotMenu
        visible={!!menu}
        onClose={() => setMenu(null)}
        items={heldMenu ? [
          { label: 'Jump to moment', icon: 'play-outline', onPress: () => seek(heldMenu.item.time) },
          { label: 'Edit', icon: 'create-outline', onPress: () => setEditSheet(heldMenu) },
          {
            label: 'Delete', icon: 'trash-outline', color: C.danger,
            onPress: () => {
              if (heldMenu.isBookmark) removeBookmark(video.id, heldMenu.item.id);
              else removeTimedNote(video.id, heldMenu.item.id);
            },
          },
        ] : []}
      />

      <DraftSheet
        visible={!!editSheet} onClose={() => setEditSheet(null)} title={'Edit @ ' + fmtMediaTime(heldEdit?.item?.time || 0)}
        initial={heldEdit ? (heldEdit.isBookmark ? (heldEdit.item as Bookmark).label : (heldEdit.item as TimedNote).text) : ''}
        multiline minHeight={60} label="Save"
        onSave={(text) => {
          if (!editSheet) return;
          if (editSheet.isBookmark) updateBookmark(video.id, editSheet.item.id, text.trim());
          else updateTimedNote(video.id, editSheet.item.id, text.trim());
          setEditSheet(null);
        }}
      />
    </ScreenBG>
  );
}

const st = StyleSheet.create({
  timePill: {
    borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4,
  },
  cols: { flexDirection: 'row', alignItems: 'flex-start', gap: COL_GAP, paddingHorizontal: S.pad, paddingTop: 8 },
  main: { flex: 3, minWidth: 0 },
  /** the side column's first title lines up with the top of the video instead of a section's gap below it */
  side: { flex: 2, minWidth: 0, marginTop: -S.section },
});
