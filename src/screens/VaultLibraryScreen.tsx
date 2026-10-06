import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Alert, BackHandler, useWindowDimensions } from 'react-native';
import Animated, {
  Extrapolation, FadeIn, interpolate, runOnJS, useAnimatedRef, useAnimatedScrollHandler, useDerivedValue, useSharedValue,
} from 'react-native-reanimated';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { C, F, S, T, TRACK, NEU } from '../theme';
import { useStore, VaultVideo, VaultFolder, TimedNote, Bookmark } from '../store';
import { parseYouTubeId, fmtMediaTime } from '../utils';
import {
  ScreenBG, Card, Field, EmptyState, ListCard, ListRow, ListSlice, Row, Chip, Sheet, PillButton, IconBtn, NeuIconBtn, DotMenu,
  ScrollEdge, edgeStrength, useToolHeader, contextLine,
} from '../components/UI';
import { toast } from '../components/Toast';
import { SegmentedControl } from '../components/SegmentedControl';
import { Appear, EASE_OUT, Enter, rowIn, shiftIn, useAnimLevel, useBuilt } from '../components/Motion';
import { useToolNav } from '../toolNav';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image as CachedImage } from 'expo-image';
import { WIDE_AT, columnWidth } from '../layout';
import { useKeyboardOpen } from '../hooks/useKeyboard';
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
const PAGE_OPTIONS: { key: ViewTab; label: string }[] = [
  { key: 'library', label: 'Library' },
  { key: 'recent', label: 'Recent' },
  { key: 'notes', label: 'All notes' },
];

const plural = (n: number, one: string) => n + ' ' + (n === 1 ? one : one + 's');

/** A timed note or a bookmark, with the video it belongs to: a row of All notes, and what its menu and sheets act on. */
type NoteHit = { video: VaultVideo; item: TimedNote | Bookmark; isBookmark: boolean };
const hitText = (x: NoteHit) => (x.isBookmark ? (x.item as Bookmark).label : (x.item as TimedNote).text);

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

/** How a card of a folder's page arrives: fading in where it stands once the page is shown, or simply there. */
type Arrival = 'appear' | 'still';

/**
 * A folder's page, keyed on the folder by its caller, so it arrives as one piece from the side it was reached from. A
 * page arriving from the side brings its cards with it, and a card that turns up later in a page already shown (the
 * first video in a folder, a search that finds some) fades in where it stands. The screen's own entrance, which rises
 * the whole pager on every visit, brings in the page it is opened on.
 */
function FolderPage({ entering, children }: {
  entering: any; children: (how: Arrival) => React.ReactNode;
}) {
  const built = useBuilt();
  return <Animated.View entering={entering}>{children(built.current ? 'appear' : 'still')}</Animated.View>;
}

/** One card of a folder's page. How it arrives is settled as it mounts (the props of later renders never replay it). */
function Arrive({ how, children }: { how: Arrival; children: React.ReactNode }) {
  const level = useAnimLevel();
  return <Animated.View entering={how === 'appear' ? rowIn(level) : undefined}>{children}</Animated.View>;
}

/** The parts of a video's caption that say something: no "0 notes", no "0 marks". */
function videoCaption(v: VaultVideo, folderName?: string) {
  const parts: string[] = [];
  if (folderName) parts.push(folderName);
  if (v.notes.length) parts.push(v.notes.length + (v.notes.length === 1 ? ' note' : ' notes'));
  if (v.bookmarks.length) parts.push(v.bookmarks.length + (v.bookmarks.length === 1 ? ' mark' : ' marks'));
  if (v.tags.length) parts.push(v.tags.map((t) => '#' + t).join(' '));
  return parts.join(' · ');
}

/** One video in a list, memoised: a search or a link being typed re-renders the rows whose video changed, not all of them. */
const VideoRow = React.memo(function VideoRow({ v, folderName, onOpen, onMenu }: {
  v: VaultVideo;
  /** the folder's name, shown where videos from every folder mix (Recent) */
  folderName?: string;
  onOpen: (id: string) => void; onMenu: (v: VaultVideo) => void;
}) {
  const caption = videoCaption(v, folderName);
  return (
    <ListRow onPress={() => onOpen(v.id)} onLongPress={() => onMenu(v)} style={{ paddingVertical: 10 }}>
      <Thumb videoId={v.videoId} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={[T.body, { fontFamily: F.semi, fontSize: 14, letterSpacing: TRACK.small, lineHeight: 19 }]} numberOfLines={2}>{v.title}</Text>
        {caption ? <Text style={[T.caption, { marginTop: 3 }]} numberOfLines={1}>{caption}</Text> : null}
      </View>
      <IconBtn name="ellipsis-vertical" size={17} onPress={() => onMenu(v)} accessibilityLabel={'More for ' + v.title} />
    </ListRow>
  );
});

/** One folder of the page in view, memoised: it re-renders when its name or its count changes. */
const FolderRow = React.memo(function FolderRow({ f, count, onOpen, onMenu }: {
  f: VaultFolder; count: number; onOpen: (id: string) => void; onMenu: (f: VaultFolder) => void;
}) {
  return (
    <ListRow onPress={() => onOpen(f.id)} onLongPress={() => onMenu(f)} style={{ paddingVertical: 10 }}>
      <Ionicons name="folder" size={22} color={C.amber} />
      <Text style={[T.title, { flex: 1, marginLeft: 12, fontSize: 15, letterSpacing: TRACK.body }]} numberOfLines={1}>{f.name}</Text>
      {/* an empty folder states no count of nothing */}
      {count ? <Text style={T.caption}>{count}</Text> : null}
      <IconBtn name="ellipsis-vertical" size={16} onPress={() => onMenu(f)} accessibilityLabel={'More for ' + f.name} />
    </ListRow>
  );
});

/**
 * One timed note or bookmark of All notes, memoised on the note itself: a search re-renders the rows that change, not
 * every row it keeps.
 */
const NoteRow = React.memo(function NoteRow({ video, item, isBookmark, onOpen, onMenu }: {
  video: VaultVideo; item: TimedNote | Bookmark; isBookmark: boolean;
  onOpen: (videoDbId: string, time: number) => void; onMenu: (x: NoteHit) => void;
}) {
  const tint = isBookmark ? C.pink : C.green;
  return (
    <ListRow onPress={() => onOpen(video.id, item.time)} onLongPress={() => onMenu({ video, item, isBookmark })} style={{ paddingVertical: 11 }}>
      <View style={[st.timePill, { borderColor: tint + '66', backgroundColor: tint + '14' }]}>
        <Ionicons name={isBookmark ? 'bookmark' : 'create-outline'} size={11} color={tint} />
        <Text style={{ color: tint, fontSize: 11, letterSpacing: TRACK.fine, fontFamily: F.semi, marginLeft: 4, fontVariant: ['tabular-nums'] }}>
          {fmtMediaTime(item.time)}
        </Text>
      </View>
      <View style={{ flex: 1, marginLeft: 10 }}>
        <Text style={[T.body, { fontSize: 14, letterSpacing: TRACK.small }]} numberOfLines={2}>
          {isBookmark ? (item as Bookmark).label : (item as TimedNote).text}
        </Text>
        <Text style={[T.caption, { marginTop: 2 }]} numberOfLines={1}>{video.title}</Text>
      </View>
      <IconBtn name="ellipsis-vertical" size={17} onPress={() => onMenu({ video, item, isBookmark })} accessibilityLabel="More" />
    </ListRow>
  );
});

/**
 * The link field and its add key. It keeps the link being typed or pasted to itself, so a keystroke re-renders this
 * card and not the three pages under it.
 */
const AddCard = React.memo(function AddCard({ cwd, folderName, onAdded }: {
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
});

/**
 * The search field. The words being typed stay here, so a keystroke re-renders the field at once; the three pages
 * filter in a transition behind it, which a faster keystroke interrupts.
 */
const SearchField = React.memo(function SearchField({ onQuery }: { onQuery: (q: string) => void }) {
  const [text, setText] = useState('');
  return (
    <Field
      value={text}
      onChangeText={(v) => {
        setText(v);
        React.startTransition(() => onQuery(v));
      }}
      placeholder="Search titles, #tags, notes…"
    />
  );
});

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
  // the settled search: set in a transition by the field, which keeps the words being typed
  const [q, setQ] = useState('');
  const [folderSheet, setFolderSheet] = useState<{ mode: 'new' | 'rename'; folder?: VaultFolder } | null>(null);
  const [videoMenu, setVideoMenu] = useState<VaultVideo | null>(null);
  const [folderMenu, setFolderMenu] = useState<VaultFolder | null>(null);
  const [moveSheet, setMoveSheet] = useState<VaultVideo | null>(null);
  const [noteMenu, setNoteMenu] = useState<NoteHit | null>(null);
  const [editSheet, setEditSheet] = useState<NoteHit | null>(null);
  const [previewSheet, setPreviewSheet] = useState<NoteHit | null>(null);
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
  const pagerX = useSharedValue(0);
  React.useEffect(() => { pageWv.value = pageW; }, [pageW]);
  const pickIdx = React.useCallback((i: number) => setTab(PAGES[i] || 'library'), []);
  const onPager = useAnimatedScrollHandler({
    onBeginDrag: () => { heading.value = -1; },
    onScroll: (e) => {
      pagerX.value = e.contentOffset.x;
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

  // The bar sits over fixed controls, so no list ever scrolls under the bar itself: the header's edge is drawn where the
  // lists do slide under something, the top of the pager. It shows only for the list in view, and eases from one list's
  // state to the next's as the pager passes between them, so swiping to a list that is at its top never leaves an edge up
  const y0 = useSharedValue(0);
  const y1 = useSharedValue(0);
  const y2 = useSharedValue(0);
  const onLibrary = useAnimatedScrollHandler((e) => { y0.value = e.contentOffset.y; });
  const onRecent = useAnimatedScrollHandler((e) => { y1.value = e.contentOffset.y; });
  const onNotes = useAnimatedScrollHandler((e) => { y2.value = e.contentOffset.y; });
  const edgeAt = useDerivedValue(() => {
    const a = edgeStrength(y0.value, level);
    if (pageWv.value <= 0) return a;
    return interpolate(
      pagerX.value / pageWv.value, [0, 1, 2], [a, edgeStrength(y1.value, level), edgeStrength(y2.value, level)],
      Extrapolation.CLAMP,
    );
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
  // the videos at or under the level in view: the root counts the whole library, a folder its own and its subfolders'
  const levelCount = useMemo(() => {
    if (!cwd) return videos.length;
    const under = new Set<string>([cwd]);
    for (let grew = true; grew;) {
      grew = false;
      for (const f of folders) {
        if (f.parentId && under.has(f.parentId) && !under.has(f.id)) { under.add(f.id); grew = true; }
      }
    }
    return videos.filter((v) => v.folderId != null && under.has(v.folderId)).length;
  }, [videos, folders, cwd]);

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
  // rows and menus call the latest setCwd through one stable function, so the memoised rows never re-render for it
  const setCwdRef = useRef(setCwd);
  setCwdRef.current = setCwd;
  const openFolder = useCallback((id: string | null) => setCwdRef.current(id), []);
  const folderIn = !built.current || level === 'none' ? undefined
    : level === 'full' && turn.current ? shiftIn(turn.current * 24) : FadeIn.duration(200).easing(EASE_OUT);

  // a folder that is gone (a restored backup, say) is left for the top of the library, never shown as an empty page
  // with no way up
  React.useEffect(() => {
    if (cwd && !folders.some((f) => f.id === cwd)) {
      turn.current = 0;
      setCwdState(null);
    }
  }, [cwd, folders]);

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

  const ql = q.trim().toLowerCase();
  const match = (v: VaultVideo) => {
    if (!ql) return true;
    if (ql.startsWith('#')) return v.tags.some((t) => t.includes(ql.slice(1)));
    return v.title.toLowerCase().includes(ql) || v.tags.some((t) => t.includes(ql));
  };

  const hereVideos = useMemo(
    () => videos.filter((v) => v.folderId === cwd).filter(match).sort((a, b) => b.addedAt - a.addedAt),
    [videos, cwd, ql]
  );
  const recentVideos = useMemo(
    () => [...videos].filter(match).sort((a, b) => b.addedAt - a.addedAt),
    [videos, ql]
  );
  const allNotes = useMemo(() => {
    const out: NoteHit[] = [];
    for (const v of videos) {
      v.notes.forEach((n) => out.push({ video: v, item: n, isBookmark: false }));
      v.bookmarks.forEach((b) => out.push({ video: v, item: b, isBookmark: true }));
    }
    return out
      .filter((x) => !ql || hitText(x).toLowerCase().includes(ql) || x.video.title.toLowerCase().includes(ql))
      .sort((a, b) => b.video.addedAt - a.video.addedAt || a.item.time - b.item.time);
  }, [videos, ql]);
  // an empty page says whether the search found nothing or there is nothing yet
  const folderHasVideos = useMemo(() => videos.some((v) => v.folderId === cwd), [videos, cwd]);
  const anyNotes = useMemo(() => videos.some((v) => v.notes.length > 0 || v.bookmarks.length > 0), [videos]);

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

  const openAt = useCallback((videoDbId: string, time: number) => nav.openVideo(videoDbId, time), [nav]);
  const openVideo = useCallback((id: string) => nav.openVideo(id), [nav]);
  // the preview sheet is a window of its own: the video opens once it has gone, never under it
  const openAfterPreview = useRef<NoteHit | null>(null);
  const recentCount = recentVideos.length;
  const renderRecent = useCallback(({ item, index }: { item: VaultVideo; index: number }) => (
    <ListSlice first={index === 0} last={index === recentCount - 1}>
      <VideoRow v={item} folderName={item.folderId ? folderNames.get(item.folderId) : undefined} onOpen={openVideo} onMenu={setVideoMenu} />
    </ListSlice>
  ), [recentCount, folderNames, openVideo]);
  const notesCount = allNotes.length;
  const renderNote = useCallback(({ item: x, index }: { item: NoteHit; index: number }) => (
    <ListSlice first={index === 0} last={index === notesCount - 1}>
      <NoteRow video={x.video} item={x.item} isBookmark={x.isBookmark} onOpen={openAt} onMenu={setNoteMenu} />
    </ListSlice>
  ), [notesCount, openAt]);

  const pageStyle = useMemo(
    () => ({ padding: S.pad, paddingTop: 4, paddingBottom: 40 + (mode === 'tab' ? 0 : insets.bottom) }),
    [mode, insets.bottom]
  );
  const pageBox = useMemo(() => ({ width: pageW }), [pageW]);
  const searching = ql.length > 0;
  const anyVideos = videos.length > 0;
  const recentEmpty = useMemo(() => (anyVideos
    ? <EmptyState key="match" icon="search-outline" title="No videos match" />
    : <EmptyState key="none" icon="time-outline" title="Nothing added yet" body="Recently added videos land here, newest first." />
  ), [anyVideos]);
  const notesEmpty = useMemo(() => (anyNotes
    ? <EmptyState key="match" icon="search-outline" title="No notes or bookmarks match" />
    : <EmptyState key="none" icon="bookmark-outline" title="No notes or bookmarks yet" body="Timed notes and bookmarks from every video appear here. Tap one to jump to that moment." />
  ), [anyNotes]);

  // the root of the Vault is the only page with the big title; a folder, and the root opened from More, have an arrow. The
  // context line is the count of videos, none when there are none. The hero sits above the controls: they are fixed
  // above three lists, so the big title never scrolls away and the bar's own title stays out of the way. On a phone the
  // hero steps aside while the keyboard is up: the fixed controls take most of a short screen, and a search would be left
  // a sliver of results to show. They then start below the bar (barH: a tab's bar lies over the top, a page's has its own space)
  const typing = useKeyboardOpen() && width < WIDE_AT;
  const header = useToolHeader({
    title: cwdFolder ? cwdFolder.name : 'YT Vault',
    mode: mode === 'tab' && !cwdFolder ? 'tab' : 'page',
    context: contextLine(levelCount > 0 && plural(levelCount, 'video')),
    onBack: () => { if (!goUp()) router.back(); },
  });

  return (
    <ScreenBG guard={mode === 'tab'} fling={false}>
      {header.bar}
      <View style={{ flex: 1 }}>
        <Enter index={0}>
          <View style={{ paddingHorizontal: S.pad, paddingTop: typing ? header.barH + 12 : header.padTop }}>
            {typing ? null : header.hero}
            <AddCard cwd={cwd} folderName={cwdFolder?.name} onAdded={openVideo} />

            <SearchField onQuery={setQ} />

            <SegmentedControl
              color={C.pink}
              stretch
              style={{ marginBottom: 10 }}
              options={PAGE_OPTIONS}
              value={tab}
              onChange={(k) => goTab(k as ViewTab)}
            />
          </View>
        </Enter>

        {/* the three pages rise as one surface on every visit; a folder's page arriving from the side is its own entrance */}
        <Enter index={1} style={{ flex: 1 }}>
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
            <Animated.ScrollView style={pageBox} contentContainerStyle={pageStyle} onScroll={onLibrary} scrollEventThrottle={16}>
              {/* the header already names the folder: this row only moves between folders and adds one */}
              <Row style={{ marginBottom: 10, flexWrap: 'wrap' }}>
                <Chip small icon="home-outline" label="All" active={cwd === null} color={C.pink} onPress={() => setCwd(null)} />
                {cwdFolder && (
                  <Chip small icon="arrow-up-outline" label="Up" onPress={() => setCwd(cwdFolder.parentId)} />
                )}
                <Chip small icon="add" label="Folder" onPress={() => setFolderSheet({ mode: 'new' })} />
              </Row>

              {/* a folder's contents are one piece, keyed on the folder: it arrives from the side it was reached from */}
              <FolderPage key={cwd ?? 'root'} entering={folderIn}>
                {(how) => (<>
                {subFolders.length > 0 && (
                  <Arrive how={how}>
                    <ListCard>
                      {subFolders.map((f) => (
                        <FolderRow key={f.id} f={f} count={counts.get(f.id) || 0} onOpen={openFolder} onMenu={setFolderMenu} />
                      ))}
                    </ListCard>
                  </Arrive>
                )}

                {hereVideos.length > 0 && (
                  <Arrive how={how}>
                    <ListCard>
                      {hereVideos.map((v) => <VideoRow key={v.id} v={v} onOpen={openVideo} onMenu={setVideoMenu} />)}
                    </ListCard>
                  </Arrive>
                )}
                {subFolders.length === 0 && hereVideos.length === 0 && (
                  searching && folderHasVideos ? (
                    <EmptyState key="match" icon="search-outline" title="No videos match" />
                  ) : (
                    <EmptyState
                      key="none"
                      icon={cwd ? 'folder-open-outline' : 'play-circle-outline'}
                      title={cwd ? 'This folder is empty' : 'Your study-video library'}
                      body={cwd ? undefined : 'Paste a lecture link above to start your library.'}
                    />
                  )
                )}
                </>)}
              </FolderPage>
            </Animated.ScrollView>

            <Animated.FlatList
              style={pageBox}
              contentContainerStyle={pageStyle}
              onScroll={onRecent}
              scrollEventThrottle={16}
              data={recentVideos}
              keyExtractor={(v) => v.id}
              initialNumToRender={8}
              windowSize={7}
              renderItem={renderRecent}
              ListEmptyComponent={recentEmpty}
            />

            <Animated.FlatList
              style={pageBox}
              contentContainerStyle={pageStyle}
              onScroll={onNotes}
              scrollEventThrottle={16}
              data={allNotes}
              keyExtractor={(x) => (x.isBookmark ? 'b' : 'n') + x.item.id}
              initialNumToRender={10}
              windowSize={7}
              renderItem={renderNote}
              ListEmptyComponent={notesEmpty}
            />
          </Animated.ScrollView>
          <ScrollEdge at={edgeAt} />
        </Enter>
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
        initial={heldEdit ? hitText(heldEdit) : ''}
        multiline minHeight={60} label="Save"
        onSave={(text) => {
          if (!editSheet) return;
          if (editSheet.isBookmark) updateBookmark(editSheet.video.id, editSheet.item.id, text.trim());
          else updateTimedNote(editSheet.video.id, editSheet.item.id, text.trim());
          setEditSheet(null);
        }}
      />

      <Sheet
        visible={!!previewSheet}
        onClose={() => setPreviewSheet(null)}
        onClosed={() => {
          const p = openAfterPreview.current;
          openAfterPreview.current = null;
          if (p) openAt(p.video.id, p.item.time);
        }}
      >
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
              onPress={() => { openAfterPreview.current = heldPreview; setPreviewSheet(null); }}
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
