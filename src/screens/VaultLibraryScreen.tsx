import React, { useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Alert, BackHandler, useWindowDimensions, FlatList } from 'react-native';
import Animated, {
  FadeIn, runOnJS, useAnimatedRef, useAnimatedScrollHandler, useSharedValue,
} from 'react-native-reanimated';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { C, F, S, T, NEU } from '../theme';
import { useStore, VaultVideo, VaultFolder } from '../store';
import { parseYouTubeId, fmtMediaTime } from '../utils';
import {
  ScreenBG, Card, Field, EmptyState, ListCard, ListRow, ListSlice, Row, Chip, Sheet, PillButton, IconBtn, NeuHeader,
  NeuIconBtn, DotMenu,
} from '../components/UI';
import { toast } from '../components/Toast';
import { SegmentedControl } from '../components/SegmentedControl';
import { Appear, EASE_OUT, shiftIn, useAnimLevel, useBuilt, useEntrance } from '../components/Motion';
import { useToolNav } from '../toolNav';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image as CachedImage } from 'expo-image';
import { columnWidth } from '../layout';
import { DraftSheet } from './VaultPlayerScreen';

const thumb = (videoId: string) => 'https://img.youtube.com/vi/' + videoId + '/mqdefault.jpg';

/** The video's title from YouTube, or a stand-in when it cannot be had (offline, private, deleted, not embeddable). */
async function fetchTitle(videoId: string): Promise<{ title: string; found: boolean }> {
  try {
    const r = await fetch('https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=' + videoId + '&format=json');
    if (!r.ok) throw new Error();
    const j = await r.json();
    return j.title ? { title: j.title, found: true } : { title: 'Video ' + videoId, found: false };
  } catch {
    return { title: 'Video ' + videoId, found: false };
  }
}

type ViewTab = 'library' | 'recent' | 'notes';
/** the pager's pages, in order */
const PAGES: ViewTab[] = ['library', 'recent', 'notes'];

/** A video's thumbnail, cached on the phone, with a carved play mark when it cannot load. */
function Thumb({ videoId }: { videoId: string }) {
  const [failed, setFailed] = React.useState(false);
  if (failed) {
    return (
      <View style={[st.thumb, { backgroundColor: C.inset, alignItems: 'center', justifyContent: 'center', ...NEU.insetLow }]}>
        <Ionicons name="play-outline" size={20} color={C.textFaint} />
      </View>
    );
  }
  return (
    <CachedImage
      source={{ uri: thumb(videoId) }} style={st.thumb} contentFit="cover" cachePolicy="memory-disk"
      transition={220}
      onError={() => setFailed(true)}
    />
  );
}

/** The last value that was not null, so a sheet or a menu keeps what it shows while it closes. */
function useHeld<T>(value: T | null): T | null {
  const held = useRef(value);
  if (value != null) held.current = value;
  return held.current;
}

/**
 * A folder's page, keyed on the folder by its caller, so it arrives as one piece from the side it was reached from.
 * `rise` tells its cards whether to rise in: with the screen's own first entrance (`fresh`), or when a card turns up
 * later in a page already shown (the first video in a folder). A page arriving from the side brings its cards with it.
 */
function FolderPage({ entering, fresh, children }: {
  entering: any; fresh: boolean; children: (rise: boolean) => React.ReactNode;
}) {
  const built = useBuilt();
  return <Animated.View entering={entering}>{children(fresh || built.current)}</Animated.View>;
}

/** A card's entrance, only when `on` holds as it mounts. */
function Rise({ index, on, children }: { index: number; on: boolean; children: React.ReactNode }) {
  const entrance = useEntrance(index, on);
  return <Animated.View style={entrance}>{children}</Animated.View>;
}

/** One video in a list, memoised: typing a search or a link re-renders the rows whose video changed, not all of them. */
const VideoRow = React.memo(function VideoRow({ v, folderName, onOpen, onMenu }: {
  v: VaultVideo;
  /** the folder's name, shown where videos from every folder mix (Recent) */
  folderName?: string;
  onOpen: (id: string) => void; onMenu: (v: VaultVideo) => void;
}) {
  return (
    <ListRow onPress={() => onOpen(v.id)} onLongPress={() => onMenu(v)} style={{ paddingVertical: 10 }}>
      <Thumb videoId={v.videoId} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={[T.body, { fontFamily: F.semi, fontSize: 14, lineHeight: 19 }]} numberOfLines={2}>{v.title}</Text>
        <Text style={[T.caption, { marginTop: 3 }]} numberOfLines={1}>
          {folderName ? folderName + ' · ' : ''}
          {v.notes.length} {v.notes.length === 1 ? 'note' : 'notes'} · {v.bookmarks.length} {v.bookmarks.length === 1 ? 'mark' : 'marks'}
          {v.tags.length ? ' · ' + v.tags.map((t) => '#' + t).join(' ') : ''}
        </Text>
      </View>
      <IconBtn name="ellipsis-vertical" size={17} onPress={() => onMenu(v)} accessibilityLabel={'More for ' + v.title} />
    </ListRow>
  );
});

/**
 * The link field and its add key. It keeps the link being typed or pasted to itself, so a keystroke re-renders this
 * card and not the three pages under it.
 */
function AddCard({ cwd, folderName, onAdded }: {
  cwd: string | null; folderName?: string; onAdded: (id: string) => void;
}) {
  const addVideo = useStore((s) => s.addVideo);
  const [url, setUrl] = useState('');
  const [adding, setAdding] = useState(false);
  // one add at a time: Enter and the add key pressed together must not add the same video twice
  const addingRef = useRef(false);
  const submit = async (raw: string) => {
    if (addingRef.current) return;
    const id = parseYouTubeId(raw);
    if (!id) { toast('That is not a YouTube link. Paste the full video link.'); return; }
    if (useStore.getState().vaultVideos.some((v) => v.videoId === id)) { toast('That video is already in the Vault.'); return; }
    addingRef.current = true;
    setAdding(true);
    try {
      const { title, found } = await fetchTitle(id);
      // it may have been added from elsewhere while the title was on its way
      if (useStore.getState().vaultVideos.some((v) => v.videoId === id)) { toast('That video is already in the Vault.'); return; }
      const vid = addVideo({ url: raw.trim(), videoId: id, title, folderId: cwd });
      setUrl('');
      if (!found) toast('Added without its title: you may be offline, or the video is private or gone.');
      onAdded(vid);
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  };
  const paste = async () => {
    const t = await Clipboard.getStringAsync();
    if (t) submit(t);
    else toast('Copy a YouTube link first.');
  };
  return (
    <Card pad={14}>
      <Row>
        <Field
          value={url} onChangeText={setUrl} placeholder={folderName ? 'Add to ' + folderName + '…' : 'Paste a YouTube link…'}
          autoCapitalize="none" style={{ flex: 1, marginBottom: 0 }}
          onSubmitEditing={() => { if (!adding && url.trim()) submit(url); }}
        />
        <IconBtn name="clipboard-outline" color={C.pink} size={22} style={{ marginLeft: 4 }} onPress={paste} accessibilityLabel="Paste a link" />
        <NeuIconBtn name="add" color={adding ? C.textFaint : C.pink} dim={40} onPress={() => { if (!adding && url.trim()) submit(url); }} accessibilityLabel="Add video" />
      </Row>
      {adding && <Appear><Text style={[T.caption, { marginTop: 6 }]}>Fetching title…</Text></Appear>}
    </Card>
  );
}

export function VaultLibraryScreen({ mode }: { mode: 'tab' | 'stack' }) {
  const nav = useToolNav();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const level = useAnimLevel();
  const built = useBuilt();
  const videos = useStore((s) => s.vaultVideos);
  const folders = useStore((s) => s.vaultFolders);
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
  const [cwd, setCwdState] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [folderSheet, setFolderSheet] = useState<{ mode: 'new' | 'rename'; folder?: VaultFolder } | null>(null);
  const [videoMenu, setVideoMenu] = useState<VaultVideo | null>(null);
  const [folderMenu, setFolderMenu] = useState<VaultFolder | null>(null);
  const [moveSheet, setMoveSheet] = useState<VaultVideo | null>(null);
  const [noteMenu, setNoteMenu] = useState<any>(null);
  const [editSheet, setEditSheet] = useState<any>(null);
  const [previewSheet, setPreviewSheet] = useState<any>(null);
  // every sheet and menu keeps its title and rows while it closes, instead of emptying or changing on its way out
  const heldFolderSheet = useHeld(folderSheet);
  const heldFolderMenu = useHeld(folderMenu);
  const heldVideoMenu = useHeld(videoMenu);
  const heldMove = useHeld(moveSheet);
  const heldNoteMenu = useHeld(noteMenu);
  const heldEdit = useHeld(editSheet);
  const heldPreview = useHeld(previewSheet);
  const pagerRef = useAnimatedRef<Animated.ScrollView>();
  // a page is as wide as the pager: the window on a phone; on a wide window known ahead, then measured
  const [pageW, setPageW] = useState(() => columnWidth(width, mode === 'tab'));
  const tabRef = useRef(tab);
  tabRef.current = tab;
  // the segmented control follows a swipe as it passes the middle of a page, not once the pager has come to rest. The
  // pager is watched on the UI thread, and only a change of page crosses to JS. A tap on the control sends the pager
  // to its page; the pages passed on the way are not taken for choices
  const pageWv = useSharedValue(pageW);
  const shownIdx = useSharedValue(PAGES.indexOf(tab));
  const heading = useSharedValue(-1);
  React.useEffect(() => { pageWv.value = pageW; }, [pageW]);
  const pickIdx = React.useCallback((i: number) => setTab(PAGES[i] || 'library'), []);
  const onPager = useAnimatedScrollHandler({
    onBeginDrag: () => { heading.value = -1; },
    onScroll: (e) => {
      if (pageWv.value <= 0) return;
      const i = Math.round(e.contentOffset.x / pageWv.value);
      if (heading.value >= 0) {
        if (i === heading.value) heading.value = -1;
        return;
      }
      if (i !== shownIdx.value) {
        shownIdx.value = i;
        runOnJS(pickIdx)(i);
      }
    },
    onMomentumEnd: (e) => {
      heading.value = -1;
      if (pageWv.value <= 0) return;
      const i = Math.round(e.contentOffset.x / pageWv.value);
      if (i !== shownIdx.value) {
        shownIdx.value = i;
        runOnJS(pickIdx)(i);
      }
    },
  });

  // a rotation or a split screen changes the page width: the page in view is set back square in the pager, never
  // left showing parts of two pages
  React.useEffect(() => {
    // a frame later, once the pages have taken their new width
    const f = requestAnimationFrame(() => {
      pagerRef.current?.scrollTo({ x: PAGES.indexOf(tabRef.current) * pageW, animated: false });
    });
    return () => cancelAnimationFrame(f);
  }, [pageW]);

  const subFolders = useMemo(
    () => folders.filter((f) => f.parentId === cwd).sort((a, b) => a.name.localeCompare(b.name)),
    [folders, cwd]
  );
  const cwdFolder = folders.find((f) => f.id === cwd) || null;
  // what each folder holds, counted once per change instead of once per folder per render
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    const bump = (k: string | null | undefined) => { if (k) m.set(k, (m.get(k) || 0) + 1); };
    videos.forEach((v) => bump(v.folderId));
    folders.forEach((f) => bump(f.parentId));
    return m;
  }, [videos, folders]);
  const folderNames = useMemo(() => new Map(folders.map((f) => [f.id, f.name])), [folders]);

  // a folder opened comes in from the right, and climbing back up comes in from the left
  const depthOf = (id: string | null) => {
    let d = 0;
    for (let f = folders.find((x) => x.id === id); f; f = folders.find((x) => x.id === f!.parentId)) d++;
    return d;
  };
  const turn = useRef<0 | 1 | -1>(0);
  const setCwd = (next: string | null) => {
    const a = depthOf(cwd);
    const b = depthOf(next);
    turn.current = b > a ? 1 : b < a ? -1 : 0;
    setCwdState(next);
  };
  const folderIn = !built.current || level === 'none' ? undefined
    : level === 'full' && turn.current ? shiftIn(turn.current * 24) : FadeIn.duration(200).easing(EASE_OUT);

  // layered back: system back climbs sub-folder → folder → tool
  const cwdRef = useRef(cwdFolder); cwdRef.current = cwdFolder;
  const goUp = React.useCallback(() => {
    const cur = cwdRef.current;
    if (!cur) return false;
    turn.current = -1;
    setCwdState(cur.parentId ?? null);
    return true;
  }, []);
  useFocusEffect(React.useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', goUp);
    return () => sub.remove();
  }, [goUp]));

  // typing stays immediate; the filtering runs on the settled text
  const settledQ = React.useDeferredValue(q);
  const match = (v: VaultVideo) => {
    const ql = settledQ.trim().toLowerCase();
    if (!ql) return true;
    if (ql.startsWith('#')) return v.tags.some((t) => t.includes(ql.slice(1)));
    return v.title.toLowerCase().includes(ql) || v.tags.some((t) => t.includes(ql));
  };

  const hereVideos = useMemo(
    () => videos.filter((v) => v.folderId === cwd).filter(match).sort((a, b) => b.addedAt - a.addedAt),
    [videos, cwd, settledQ]
  );
  const recentVideos = useMemo(
    () => [...videos].filter(match).sort((a, b) => b.addedAt - a.addedAt),
    [videos, settledQ]
  );
  const allNotes = useMemo(() => {
    const ql = settledQ.trim().toLowerCase();
    const out: { video: VaultVideo; item: any; isBookmark: boolean }[] = [];
    for (const v of videos) {
      v.notes.forEach((n) => out.push({ video: v, item: n, isBookmark: false }));
      v.bookmarks.forEach((b) => out.push({ video: v, item: b, isBookmark: true }));
    }
    return out
      .filter((x) => !ql || (x.isBookmark ? x.item.label : x.item.text).toLowerCase().includes(ql) || x.video.title.toLowerCase().includes(ql))
      .sort((a, b) => b.video.addedAt - a.video.addedAt || a.item.time - b.item.time);
  }, [videos, settledQ]);

  const submitFolder = (name: string) => {
    const n = name.trim();
    if (!n || !folderSheet) return;
    if (folderSheet.mode === 'new') addVaultFolder(n, cwd);
    else if (folderSheet.folder) renameVaultFolder(folderSheet.folder.id, n);
    setFolderSheet(null);
  };

  const goTab = (t: ViewTab) => {
    const i = PAGES.indexOf(t);
    setTab(t);
    heading.value = i;
    shownIdx.value = i;
    pagerRef.current?.scrollTo({ x: i * pageW, animated: true });
  };

  const openAt = (videoDbId: string, time: number) =>
    nav.openVideo(videoDbId, time);
  const openVideo = React.useCallback((id: string) => nav.openVideo(id), [nav]);
  const recentCount = recentVideos.length;
  const renderRecent = React.useCallback(({ item, index }: { item: VaultVideo; index: number }) => (
    <ListSlice first={index === 0} last={index === recentCount - 1}>
      <VideoRow v={item} folderName={item.folderId ? folderNames.get(item.folderId) : undefined} onOpen={openVideo} onMenu={setVideoMenu} />
    </ListSlice>
  ), [recentCount, folderNames, openVideo]);

  const pageStyle = { padding: S.pad, paddingTop: 4, paddingBottom: 40 + (mode === 'tab' ? 0 : insets.bottom) };

  return (
    <ScreenBG guard={mode === 'tab'} fling={false}>
      <NeuHeader
        title={cwdFolder ? cwdFolder.name : 'YT Vault'}
        variant={mode === 'tab' && !cwdFolder ? 'tab' : 'page'}
        onBack={() => { if (!goUp()) router.back(); }}
      />
      <View style={{ flex: 1 }}>
        <View style={{ padding: S.pad, paddingBottom: 0 }}>
          <AddCard cwd={cwd} folderName={cwdFolder?.name} onAdded={openVideo} />

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

        <Animated.ScrollView
          ref={pagerRef}
          horizontal pagingEnabled showsHorizontalScrollIndicator={false}
          onLayout={(e) => {
            const w = Math.round(e.nativeEvent.layout.width);
            if (w > 0 && w !== pageW) setPageW(w);
          }}
          onScroll={onPager}
          scrollEventThrottle={16}
        >
          <ScrollView style={{ width: pageW }} contentContainerStyle={pageStyle}>
            {/* the header already names the folder: this row only moves between folders and adds one */}
            <Row style={{ marginBottom: 10, flexWrap: 'wrap' }}>
              <Chip small icon="home-outline" label="All" active={cwd === null} color={C.pink} onPress={() => setCwd(null)} />
              {cwdFolder && (
                <Chip small icon="arrow-up-outline" label="Up" onPress={() => setCwd(cwdFolder.parentId)} />
              )}
              <Chip small icon="add" label="Folder" onPress={() => setFolderSheet({ mode: 'new' })} />
            </Row>

            {/* a folder's contents are one piece, keyed on the folder: it arrives from the side it was reached from */}
            <FolderPage key={cwd ?? 'root'} entering={folderIn} fresh={!built.current}>
              {(rise) => (<>
              {subFolders.length > 0 && (
                <Rise index={0} on={rise}>
                  <ListCard>
                    {subFolders.map((f) => (
                      <ListRow key={f.id} onPress={() => setCwd(f.id)} onLongPress={() => setFolderMenu(f)} style={{ paddingVertical: 10 }}>
                        <Ionicons name="folder" size={22} color={C.amber} />
                        <Text style={[T.title, { flex: 1, marginLeft: 12, fontSize: 15 }]} numberOfLines={1}>{f.name}</Text>
                        {/* an empty folder states no count of nothing */}
                        {counts.get(f.id) ? <Text style={T.caption}>{counts.get(f.id)}</Text> : null}
                        <IconBtn name="ellipsis-vertical" size={16} onPress={() => setFolderMenu(f)} accessibilityLabel={'More for ' + f.name} />
                      </ListRow>
                    ))}
                  </ListCard>
                </Rise>
              )}

              {hereVideos.length > 0 && (
                <Rise index={1} on={rise}>
                  <ListCard>
                    {hereVideos.map((v) => <VideoRow key={v.id} v={v} onOpen={openVideo} onMenu={setVideoMenu} />)}
                  </ListCard>
                </Rise>
              )}
              {subFolders.length === 0 && hereVideos.length === 0 && (
                <EmptyState
                  icon={cwd ? 'folder-open-outline' : 'play-circle-outline'}
                  title={cwd ? 'This folder is empty' : 'Your study-video library'}
                  body={cwd ? undefined : 'Paste a lecture link above to start your library.'}
                />
              )}
              </>)}
            </FolderPage>
          </ScrollView>

          <FlatList
            style={{ width: pageW }}
            contentContainerStyle={pageStyle}
            data={recentVideos}
            keyExtractor={(v) => v.id}
            initialNumToRender={8}
            windowSize={7}
            renderItem={renderRecent}
            ListEmptyComponent={<EmptyState icon="time-outline" title="Nothing added yet" body="Recently added videos land here, newest first." />}
          />

          <FlatList
            style={{ width: pageW }}
            contentContainerStyle={pageStyle}
            data={allNotes}
            keyExtractor={(x) => (x.isBookmark ? 'b' : 'n') + x.item.id}
            initialNumToRender={10}
            windowSize={7}
            renderItem={({ item: x, index: i }) => (
              <ListSlice first={i === 0} last={i === allNotes.length - 1}>
                <ListRow onPress={() => openAt(x.video.id, x.item.time)} onLongPress={() => setNoteMenu(x)} style={{ paddingVertical: 11 }}>
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
                  <IconBtn name="ellipsis-vertical" size={17} onPress={() => setNoteMenu(x)} accessibilityLabel="More" />
                </ListRow>
              </ListSlice>
            )}
            ListEmptyComponent={
              <EmptyState icon="bookmark-outline" title="No notes or bookmarks yet" body="Timed notes and bookmarks from every video appear here. Tap one to jump to that moment." />
            }
          />
        </Animated.ScrollView>
      </View>

      <DraftSheet
        visible={!!folderSheet}
        onClose={() => setFolderSheet(null)}
        title={heldFolderSheet?.mode === 'new' ? (cwdFolder ? 'New subfolder in ' + cwdFolder.name : 'New folder') : 'Rename folder'}
        initial={heldFolderSheet?.mode === 'rename' ? heldFolderSheet.folder?.name ?? '' : ''}
        placeholder="Folder name, like Physics"
        label={heldFolderSheet?.mode === 'new' ? 'Create' : 'Rename'}
        color={C.pink}
        onSave={submitFolder}
      />

      <DotMenu
        visible={!!folderMenu}
        onClose={() => setFolderMenu(null)}
        items={heldFolderMenu ? [
          { label: 'Open', icon: 'folder-open-outline', onPress: () => setCwd(heldFolderMenu.id) },
          { label: 'Rename', icon: 'create-outline', onPress: () => setFolderSheet({ mode: 'rename', folder: heldFolderMenu }) },
          {
            label: 'Delete (contents move up)', icon: 'trash-outline', color: C.danger,
            onPress: () => {
              // deleting the folder in view climbs out of it first, so the page never shows a folder that is gone
              if (cwd === heldFolderMenu.id) setCwd(heldFolderMenu.parentId ?? null);
              deleteVaultFolder(heldFolderMenu.id);
            },
          },
        ] : []}
      />

      <DotMenu
        visible={!!videoMenu}
        onClose={() => setVideoMenu(null)}
        items={heldVideoMenu ? [
          { label: 'Open', icon: 'play-outline', onPress: () => nav.openVideo(heldVideoMenu.id) },
          { label: 'Move to folder', icon: 'folder-outline', onPress: () => setMoveSheet(heldVideoMenu) },
          {
            label: 'Remove from Vault', icon: 'trash-outline', color: C.danger,
            onPress: () =>
              Alert.alert('Remove video', 'Remove "' + heldVideoMenu.title + '" and its notes?', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Remove', style: 'destructive', onPress: () => deleteVideo(heldVideoMenu.id) },
              ]),
          },
        ] : []}
      />

      <Sheet visible={!!moveSheet} onClose={() => setMoveSheet(null)} title="Move to folder">
        <Row style={{ flexWrap: 'wrap' }}>
          <Chip icon="home-outline" label="No folder" color={C.pink} active={heldMove?.folderId === null}
            onPress={() => { if (moveSheet) updateVideo(moveSheet.id, { folderId: null }); setMoveSheet(null); }} />
          {folders.map((f) => (
            <Chip key={f.id} icon="folder-outline" color={C.pink} active={heldMove?.folderId === f.id}
              label={f.parentId ? (folderNames.get(f.parentId) || '') + ' / ' + f.name : f.name}
              onPress={() => { if (moveSheet) updateVideo(moveSheet.id, { folderId: f.id }); setMoveSheet(null); }} />
          ))}
        </Row>
      </Sheet>

      <DotMenu
        visible={!!noteMenu}
        onClose={() => setNoteMenu(null)}
        items={heldNoteMenu ? [
          { label: 'Jump to moment', icon: 'play-outline', onPress: () => openAt(heldNoteMenu.video.id, heldNoteMenu.item.time) },
          { label: 'Edit', icon: 'create-outline', onPress: () => setEditSheet(heldNoteMenu) },
          { label: 'Preview video', icon: 'image-outline', onPress: () => setPreviewSheet(heldNoteMenu) },
          {
            label: 'Delete', icon: 'trash-outline', color: C.danger,
            onPress: () => {
              if (heldNoteMenu.isBookmark) removeBookmark(heldNoteMenu.video.id, heldNoteMenu.item.id);
              else removeTimedNote(heldNoteMenu.video.id, heldNoteMenu.item.id);
            },
          },
        ] : []}
      />

      <DraftSheet
        visible={!!editSheet}
        onClose={() => setEditSheet(null)}
        title={'Edit @ ' + fmtMediaTime(heldEdit?.item?.time || 0)}
        initial={heldEdit ? (heldEdit.isBookmark ? heldEdit.item.label : heldEdit.item.text) : ''}
        multiline minHeight={60} label="Save"
        onSave={(text) => {
          if (!editSheet) return;
          if (editSheet.isBookmark) updateBookmark(editSheet.video.id, editSheet.item.id, text.trim());
          else updateTimedNote(editSheet.video.id, editSheet.item.id, text.trim());
          setEditSheet(null);
        }}
      />

      <Sheet visible={!!previewSheet} onClose={() => setPreviewSheet(null)}>
        {heldPreview && (
          <View>
            <CachedImage
              source={{ uri: thumb(heldPreview.video.videoId) }} contentFit="cover" cachePolicy="memory-disk"
              transition={220}
              style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 16, backgroundColor: C.inset }}
            />
            <Text style={[T.title, { marginTop: 12 }]}>{heldPreview.video.title}</Text>
            <Text style={[T.caption, { marginTop: 4 }]}>
              {heldPreview.isBookmark ? 'Bookmark' : 'Note'} @ {fmtMediaTime(heldPreview.item.time)}
            </Text>
            <PillButton
              label="Watch from here" color={C.pink} style={{ marginTop: 14 }}
              onPress={() => { const p = heldPreview; setPreviewSheet(null); openAt(p.video.id, p.item.time); }}
            />
          </View>
        )}
      </Sheet>
    </ScreenBG>
  );
}

const st = StyleSheet.create({
  thumb: { width: 92, height: 52, borderRadius: 10, backgroundColor: C.inset },
  timePill: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4,
  },
});
