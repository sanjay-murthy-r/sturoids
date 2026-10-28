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
import { fmtMediaTime } from '../utils';
import { PLAYLIST_SAID, videosIn } from '../toolLogic';
import { VideoOfferSheet } from '../shareIntake';
import {
  ScreenBG, Card, Field, EmptyState, ListCard, ListRow, ListSlice, Row, Chip, Sheet, PillButton, IconBtn, NeuIconBtn, DotMenu,
  ScrollEdge, edgeStrength, useToolHeader, contextLine,
} from '../components/UI';
import { toast } from '../components/Toast';
import { SegmentedControl } from '../components/SegmentedControl';
import { Appear, EASE_OUT, Enter, Sheen, glide, rowIn, shiftIn, useAnimLevel, useBuilt } from '../components/Motion';
import { useToolNav } from '../toolNav';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image as CachedImage } from 'expo-image';
import { WIDE_AT, columnWidth } from '../layout';
import { useKeyboardOpen } from '../hooks/useKeyboard';
import { DraftSheet, fetchTitle, removeVaultItem } from './VaultPlayerScreen';
import { toastTrashed } from '../trashToast';

const thumb = (videoId: string) => 'https://img.youtube.com/vi/' + videoId + '/mqdefault.jpg';

/** A second tap on a video while the first one's player is on its way is the same tap: never two players, two WebViews. */
const PUSH_GAP_MS = 600;

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

/**
 * A video's thumbnail, cached on the phone, with a carved play mark when it cannot load. While it loads, its carved
 * place carries the loading sheen. `style` sizes it (a row's 92 x 52 unless given) and `radius` rounds it.
 */
function Thumb({ videoId, style, radius = 10 }: { videoId: string; style?: any; radius?: number }) {
  const [failed, setFailed] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const box = [st.thumb, style, { borderRadius: radius }];
  if (failed) {
    return (
      <View style={[box, { alignItems: 'center', justifyContent: 'center', ...NEU.insetLow }]}>
        <Ionicons name="play-outline" size={20} color={C.textFaint} />
      </View>
    );
  }
  return (
    <View style={[box, { overflow: 'hidden' }]}>
      <CachedImage
        source={{ uri: thumb(videoId) }} style={[StyleSheet.absoluteFill, { borderRadius: radius }]} contentFit="cover"
        cachePolicy="memory-disk" transition={220}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
      {loaded ? null : <Sheen radius={radius} />}
    </View>
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

/**
 * One video of the Library page, a slice of the list's card. How it arrives is settled as it mounts: with its folder's
 * page as that page comes in from the side ('page'), fading in where it lands when it turns up in a page already shown
 * (a video added, a search that finds it), or simply there (a row scrolled into view, or the screen's first build).
 */
const LibraryRow = React.memo(function LibraryRow({ v, first, last, how, pageIn, folderName, onOpen, onMenu }: {
  v: VaultVideo; first: boolean; last: boolean; how: Arrival | 'page'; pageIn: any; folderName?: string;
  onOpen: (id: string) => void; onMenu: (v: VaultVideo) => void;
}) {
  const level = useAnimLevel();
  const [entering] = useState(() => (how === 'page' ? pageIn : how === 'appear' ? rowIn(level) : undefined));
  return (
    <Animated.View entering={entering}>
      <ListSlice first={first} last={last}>
        <VideoRow v={v} folderName={folderName} onOpen={onOpen} onMenu={onMenu} />
      </ListSlice>
    </Animated.View>
  );
});

/**
 * The parts of a video's caption that say something: no "0 notes", no "0 marks". Recently watched leads with where it
 * was left.
 */
function videoCaption(v: VaultVideo, folderName?: string, left?: boolean) {
  const parts: string[] = [];
  if (left && v.resumeAt) parts.push('Left at ' + fmtMediaTime(v.resumeAt));
  if (folderName) parts.push(folderName);
  if (v.notes.length) parts.push(v.notes.length + (v.notes.length === 1 ? ' note' : ' notes'));
  if (v.bookmarks.length) parts.push(v.bookmarks.length + (v.bookmarks.length === 1 ? ' mark' : ' marks'));
  if (v.tags.length) parts.push(v.tags.map((t) => '#' + t).join(' '));
  return parts.join(' · ');
}

/** One video in a list, memoised: a search or a link being typed re-renders the rows whose video changed, not all of them. */
const VideoRow = React.memo(function VideoRow({ v, folderName, left, onOpen, onMenu }: {
  v: VaultVideo;
  /** the folder's name, shown where videos from every folder mix (Recent) */
  folderName?: string;
  /** says where it was left ("Left at 12:34"), on Recently watched */
  left?: boolean;
  onOpen: (id: string) => void; onMenu: (v: VaultVideo) => void;
}) {
  const caption = videoCaption(v, folderName, left);
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
const AddCard = React.memo(function AddCard({ cwd, folderName, onAdded, onMany }: {
  cwd: string | null; folderName?: string; onAdded: (id: string) => void;
  /** a paste with several new videos in it: they are offered together, in a sheet */
  onMany: (list: { url: string; videoId: string }[]) => void;
}) {
  const addVideo = useStore((s) => s.addVideo);
  const [url, setUrl] = useState('');
  const [adding, setAdding] = useState(false);
  // one add at a time: Enter and the add key pressed together must not add the same video twice
  const addingRef = useRef(false);
  // Every YouTube link in what was pasted or typed: one new video is added at once, several are offered together, and
  // each is kept as its clean watch link rather than the text around it. A playlist says it cannot be added yet
  const submit = async (raw: string) => {
    if (addingRef.current) return;
    const found = videosIn(raw, (vid) => useStore.getState().vaultVideos.some((v) => v.videoId === vid));
    if (!found.fresh.length) {
      if (found.have) toast(found.have === 1 ? 'That video is already in the Vault.' : 'Those videos are already in the Vault.');
      else if (found.playlist) toast(PLAYLIST_SAID);
      else toast('That is not a YouTube link. Paste the full video link.');
      return;
    }
    if (found.fresh.length > 1) { setUrl(''); onMany(found.fresh); return; }
    const { videoId: id, url: clean } = found.fresh[0];
    addingRef.current = true;
    setAdding(true);
    try {
      const { title, found } = await fetchTitle(id);
      // it may have been added from elsewhere while the title was on its way
      if (useStore.getState().vaultVideos.some((v) => v.videoId === id)) { toast('That video is already in the Vault.'); return; }
      const vid = addVideo({ url: clean, videoId: id, title, folderId: cwd });
      setUrl('');
      // the player asks for the title again whenever the video is opened, and its menu can rename it
      if (!found) toast('Added without its title, as YouTube did not answer. Opening the video tries again.');
      onAdded(vid);
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  };
  const paste = async () => {
    // a clipboard the phone will not read counts as an empty one
    const t = await Clipboard.getStringAsync().catch(() => '');
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
  const updateVideo = useStore((s) => s.updateVideo);
  const addVaultFolder = useStore((s) => s.addVaultFolder);
  const renameVaultFolder = useStore((s) => s.renameVaultFolder);
  const deleteVaultFolder = useStore((s) => s.deleteVaultFolder);
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
  const [renameSheet, setRenameSheet] = useState<VaultVideo | null>(null);
  // every sheet and menu keeps its title and rows while it closes, instead of emptying or changing on its way out
  const heldFolderSheet = useHeld(folderSheet);
  const heldFolderMenu = useHeld(folderMenu);
  const heldVideoMenu = useHeld(videoMenu);
  const heldMove = useHeld(moveSheet);
  const heldNoteMenu = useHeld(noteMenu);
  const heldEdit = useHeld(editSheet);
  const heldPreview = useHeld(previewSheet);
  const heldRename = useHeld(renameSheet);
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
  // the folders at and under the level in view; null at the top, where that is the whole library
  const subtree = useMemo(() => {
    if (!cwd) return null;
    const under = new Set<string>([cwd]);
    for (let grew = true; grew;) {
      grew = false;
      for (const f of folders) {
        if (f.parentId && under.has(f.parentId) && !under.has(f.id)) { under.add(f.id); grew = true; }
      }
    }
    return under;
  }, [folders, cwd]);
  const inSubtree = (folderId: string | null) => !subtree || (folderId != null && subtree.has(folderId));
  // the videos at or under the level in view: the root counts the whole library, a folder its own and its subfolders'
  const levelCount = useMemo(
    () => (subtree ? videos.filter((v) => v.folderId != null && subtree.has(v.folderId)).length : videos.length),
    [videos, subtree],
  );

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

  // The Library page: the folder in view, or while a search is on, everything at and under it, with the folders whose
  // names match. A video found deeper down names its folder, as Recent does
  const libVideos = useMemo(
    () => videos
      .filter((v) => (ql ? inSubtree(v.folderId) : v.folderId === cwd))
      .filter(match)
      .sort((a, b) => b.addedAt - a.addedAt),
    [videos, cwd, subtree, ql]
  );
  const libFolders = useMemo(
    () => (!ql ? subFolders
      : ql.startsWith('#') ? []
        : folders
          .filter((f) => f.id !== cwd && inSubtree(f.id) && f.name.toLowerCase().includes(ql))
          .sort((a, b) => a.name.localeCompare(b.name))),
    [ql, subFolders, folders, cwd, subtree]
  );
  // Recently watched: the last opened first, then the ones never opened yet, newest added first
  const recentVideos = useMemo(
    () => [...videos].filter(match).sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0) || b.addedAt - a.addedAt),
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
  const levelEmpty = levelCount === 0 && subFolders.length === 0;
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

  const pushedAt = useRef(0);
  const once = useCallback((go: () => void) => {
    const now = Date.now();
    if (now - pushedAt.current < PUSH_GAP_MS) return;
    pushedAt.current = now;
    go();
  }, []);
  const openAt = useCallback((videoDbId: string, time: number) => once(() => nav.openVideo(videoDbId, time)), [nav, once]);
  const openVideo = useCallback((id: string) => once(() => nav.openVideo(id)), [nav, once]);
  // a paste of several links, offered in one sheet
  const [many, setMany] = useState<{ url: string; videoId: string }[] | null>(null);

  // the preview sheet is a window of its own: the video opens once it has gone, never under it
  const openAfterPreview = useRef<NoteHit | null>(null);
  const recentCount = recentVideos.length;
  const renderRecent = useCallback(({ item, index }: { item: VaultVideo; index: number }) => (
    <ListSlice first={index === 0} last={index === recentCount - 1}>
      <VideoRow v={item} folderName={item.folderId ? folderNames.get(item.folderId) : undefined} left onOpen={openVideo} onMenu={setVideoMenu} />
    </ListSlice>
  ), [recentCount, folderNames, openVideo]);
  const notesCount = allNotes.length;
  const renderNote = useCallback(({ item: x, index }: { item: NoteHit; index: number }) => (
    <ListSlice first={index === 0} last={index === notesCount - 1}>
      <NoteRow video={x.video} item={x.item} isBookmark={x.isBookmark} onOpen={openAt} onMenu={setNoteMenu} />
    </ListSlice>
  ), [notesCount, openAt]);

  // How the Library page's rows arrive. The rows mounted while a new folder's page comes in arrive with it; one that turns
  // up later in a page already shown fades in; one scrolled into view is simply there. Read when a row is made (the list
  // makes rows in batches after the render that brought the page), so these are refs, settled once the page is shown
  const pageKey = cwd ?? '';
  const shownPage = useRef<string | null>(null);
  const shownList = useRef('');
  const shownIds = useRef<Set<string>>(new Set());
  const arriving = useRef<{ anim: any } | null>(null);
  if (shownPage.current !== pageKey) arriving.current = { anim: folderIn };
  // a video removed or moved lets the rows under it glide up; a new folder or search is a different list, simply there
  const libKey = pageKey + '|' + ql;
  const sameLib = shownList.current === libKey;
  React.useEffect(() => {
    shownPage.current = pageKey;
    shownList.current = libKey;
    arriving.current = null;
    shownIds.current = new Set(libVideos.map((v) => v.id));
  });
  const libCount = libVideos.length;
  const renderLibrary = useCallback(({ item, index }: { item: VaultVideo; index: number }) => {
    const a = arriving.current;
    return (
      <LibraryRow
        v={item} first={index === 0} last={index === libCount - 1}
        how={a ? 'page' : shownIds.current.has(item.id) ? 'still' : 'appear'} pageIn={a?.anim}
        folderName={item.folderId && item.folderId !== cwd ? folderNames.get(item.folderId) : undefined}
        onOpen={openVideo} onMenu={setVideoMenu}
      />
    );
  }, [libCount, cwd, folderNames, openVideo]);

  const pageStyle = useMemo(
    () => ({ padding: S.pad, paddingTop: 4, paddingBottom: 40 + (mode === 'tab' ? 0 : insets.bottom) }),
    [mode, insets.bottom]
  );
  const pageBox = useMemo(() => ({ width: pageW }), [pageW]);
  const searching = ql.length > 0;
  const anyVideos = videos.length > 0;
  const recentEmpty = useMemo(() => (anyVideos
    ? <EmptyState key="match" icon="search-outline" title="No videos match" />
    : <EmptyState key="none" icon="time-outline" title="Nothing added yet" body="The videos you watch land here, the last one first, with where you left off." />
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
            <AddCard cwd={cwd} folderName={cwdFolder?.name} onAdded={openVideo} onMany={setMany} />

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
            {/* the folder in view as a list that makes only the rows near the screen, so a level of 150 lectures never
                mounts 150 rows and thumbnails at once */}
            <Animated.FlatList
              style={pageBox}
              contentContainerStyle={pageStyle}
              onScroll={onLibrary}
              scrollEventThrottle={16}
              data={libVideos}
              keyExtractor={(v) => v.id}
              initialNumToRender={8}
              windowSize={7}
              renderItem={renderLibrary}
              itemLayoutAnimation={sameLib ? glide(level) : undefined}
              ListHeaderComponent={
                <>
                  {/* the header already names the folder: this row only moves between folders and adds one */}
                  <Row style={{ marginBottom: 10, flexWrap: 'wrap' }}>
                    <Chip small icon="home-outline" label="All" active={cwd === null} color={C.pink} onPress={() => setCwd(null)} />
                    {cwdFolder && (
                      <Chip small icon="arrow-up-outline" label="Up" onPress={() => setCwd(cwdFolder.parentId)} />
                    )}
                    <Chip small icon="add" label="Folder" onPress={() => setFolderSheet({ mode: 'new' })} />
                  </Row>

                  {/* a folder's own card is one piece, keyed on the folder: it arrives from the side it was reached
                      from, and the rows under it come with it */}
                  <FolderPage key={cwd ?? 'root'} entering={folderIn}>
                    {(how) => (<>
                    {libFolders.length > 0 && (
                      <Arrive how={how}>
                        <ListCard>
                          {libFolders.map((f) => (
                            <FolderRow key={f.id} f={f} count={counts.get(f.id) || 0} onOpen={openFolder} onMenu={setFolderMenu} />
                          ))}
                        </ListCard>
                      </Arrive>
                    )}
                    {libFolders.length === 0 && libVideos.length === 0 && (
                      searching && !levelEmpty ? (
                        <EmptyState key="match" icon="search-outline" title="Nothing matches that search" />
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
                </>
              }
            />

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

      <VideoOfferSheet videos={many} onClose={() => setMany(null)} folderId={cwd} />
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
            label: 'Delete folder', icon: 'trash-outline', color: C.danger,
            onPress: () => {
              const f = heldFolderMenu;
              const go = () => {
                // deleting the folder in view climbs out of it first, so the page never shows a folder that is gone
                if (cwd === f.id) setCwd(f.parentId ?? null);
                deleteVaultFolder(f.id);
              };
              // an empty folder simply goes; one with something in it says where that goes, as Notes does
              const vids = videos.filter((v) => v.folderId === f.id).length;
              const subs = folders.filter((x) => x.parentId === f.id).length;
              if (!vids && !subs) { go(); return; }
              const what = vids + subs === 1
                ? (vids ? 'Its video moves' : 'Its folder moves')
                : 'Its ' + [vids ? plural(vids, 'video') : '', subs ? plural(subs, 'folder') : ''].filter(Boolean).join(' and ') + ' move';
              const to = f.parentId ? folderNames.get(f.parentId) || 'the folder above' : 'the top of the library';
              Alert.alert(
                'Delete ' + f.name + '?',
                what + ' up to ' + to + '. No video is deleted.',
                [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete folder', style: 'destructive', onPress: go }],
              );
            },
          },
        ] : []}
      />

      <DotMenu
        visible={!!videoMenu}
        onClose={() => setVideoMenu(null)}
        items={heldVideoMenu ? [
          { label: 'Open', icon: 'play-outline', onPress: () => openVideo(heldVideoMenu.id) },
          { label: 'Rename', icon: 'create-outline', onPress: () => setRenameSheet(heldVideoMenu) },
          { label: 'Move to folder', icon: 'folder-outline', onPress: () => setMoveSheet(heldVideoMenu) },
          {
            label: 'Remove from Vault', icon: 'trash-outline', color: C.danger,
            onPress: () =>
              Alert.alert('Remove video', 'Remove "' + heldVideoMenu.title + '" and its notes? You can restore it from Recently deleted for 30 days.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Remove', style: 'destructive', onPress: () => { toastTrashed(useStore.getState().trashVideo(heldVideoMenu.id)); } },
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
            onPress: () => removeVaultItem(heldNoteMenu.video.id, heldNoteMenu.item, heldNoteMenu.isBookmark),
          },
        ] : []}
      />

      <DraftSheet
        visible={!!renameSheet}
        onClose={() => setRenameSheet(null)}
        title="Rename video"
        initial={heldRename?.title ?? ''}
        placeholder="Video name"
        label="Rename"
        color={C.pink}
        onSave={(text) => {
          if (!renameSheet || !text.trim()) return;
          updateVideo(renameSheet.id, { title: text.trim() });
          setRenameSheet(null);
        }}
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
            <Thumb
              key={heldPreview.video.videoId} videoId={heldPreview.video.videoId} radius={16}
              style={{ width: '100%', height: undefined, aspectRatio: 16 / 9 }}
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
