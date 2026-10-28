import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Image as CachedImage } from 'expo-image';
import { useShareIntent } from 'expo-share-intent';
import type { ShareIntentFile } from 'expo-share-intent';
import { C, F, T, TRACK } from './theme';
import { useStore } from './store';
import type { Attachment } from './store';
import { youTubeLinksIn } from './utils';
import { Chip, Hairline, PillButton, Row, Sheet } from './components/UI';
import { Appear, Sheen } from './components/Motion';
import { toast } from './components/Toast';
import { QuickTaskSheet } from './components/QuickTaskSheet';
import { useIntro } from './intro';
import { useHydrated } from './hooks/useHydrated';
import { NOT_KEPT, keepFile } from './attachments';
import { PLAYLIST_SAID, videosIn } from './toolLogic';

/**
 * Sharing to Sturoids. Text shared from another app (YouTube's Share, a browser, a chat) is looked through for YouTube
 * links: one video, or several, are offered to YT Vault in a folder of your choice; a playlist says it cannot be added
 * yet. Any other text is offered as a new note or a ToDo. Photos and PDFs, one or several, go into a new note as its
 * attachments. It never opens the player or the note by itself: the share is a quick stop on the way back to what you
 * were doing, and a toast offers to open what was made.
 */

/** The first YouTube video linked in `text`, as a clean link, or null. */
export function youTubeLinkIn(text: string): { url: string; videoId: string } | null {
  return youTubeLinksIn(text)[0] ?? null;
}

/** A shared file, as the intake keeps it. */
interface SharedFile { uri: string; name: string; mime: string }

type Shared =
  | { kind: 'videos'; list: { url: string; videoId: string }[] }
  | { kind: 'playlist' }
  | { kind: 'text'; text: string; title: string }
  | { kind: 'files'; files: SharedFile[]; text: string; title: string }
  | { kind: 'other' };

/** A file's uri as the file system reads it: a bare path gets its scheme. */
const uriOf = (f: ShareIntentFile) => {
  const p = String(f.path || '');
  return /^[a-z]+:\/\//i.test(p) ? p : 'file://' + p;
};

/** What a share holds, worked out once as it arrives. */
function readShare(intent: { text?: string | null; webUrl?: string | null; files?: ShareIntentFile[] | null; meta?: { title?: string } | null }): Shared {
  const text = [intent.webUrl, intent.text].filter(Boolean).join(' ').trim();
  const title = String(intent.meta?.title || '').trim();
  const files = (intent.files || []).filter((f) => f && f.path);
  if (files.length) {
    return {
      kind: 'files', text: String(intent.text || '').trim(), title,
      files: files.map((f, i) => ({ uri: uriOf(f), name: f.fileName || 'shared-' + (i + 1), mime: String(f.mimeType || '') })),
    };
  }
  if (!text) return { kind: 'other' };
  const links = youTubeLinksIn(text);
  if (links.length) return { kind: 'videos', list: links };
  if (videosIn(text, () => false).playlist) return { kind: 'playlist' };
  return { kind: 'text', text: String(intent.text || intent.webUrl || '').trim(), title };
}

/**
 * What was shared and is still to be offered. A share is taken from the native module as soon as it arrives (so it
 * never comes round twice), and handed on only once the intro is over and the saved data has loaded.
 */
export function useShareIntake(): { shared: Shared | null; done: () => void } {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent();
  const [shared, setShared] = React.useState<Shared | null>(null);
  React.useEffect(() => {
    if (!hasShareIntent) return;
    setShared(readShare(shareIntent));
    resetShareIntent();
  }, [hasShareIntent, shareIntent]);
  const introOver = useIntro((s) => s.phase === 'done');
  const loaded = useHydrated();
  const done = React.useCallback(() => setShared(null), []);
  return { shared: introOver && loaded ? shared : null, done };
}

/** A toast that offers to open the note just made. */
const toastNote = (message: string, id: string) =>
  toast(message, { label: 'Open', onPress: () => router.push({ pathname: '/notes/[id]', params: { id } }, { dangerouslySingular: true }) });

/** The kind of attachment a shared file makes. */
const kindOf = (mime: string): Attachment['kind'] => (mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : 'file');

/** Photos and files shared together: one new note holding them all, its text whatever came with them. */
async function noteFromFiles(s: { files: SharedFile[]; text: string; title: string }) {
  const st0 = useStore.getState();
  const pics = s.files.every((f) => f.mime.startsWith('image/'));
  const title = s.title || (pics ? (s.files.length === 1 ? 'Shared photo' : 'Shared photos') : s.files.length === 1 ? s.files[0].name : 'Shared files');
  const id = st0.addNote({ title, body: s.text, folder: 'General' });
  let lost = false;
  for (const f of s.files) {
    const kept = await keepFile(f.uri, f.name);
    if (!kept.kept) lost = true;
    useStore.getState().addAttachment(id, { kind: kindOf(f.mime), uri: kept.uri, name: f.name });
  }
  if (lost) toast(NOT_KEPT);
  else toastNote(s.files.length === 1 ? 'Saved in a new note' : 'Saved ' + s.files.length + ' files in a new note', id);
}

/** The share intake: mounted once, in the root layout. */
export function ShareIntake() {
  const { shared, done } = useShareIntake();
  const [videos, setVideos] = React.useState<{ url: string; videoId: string }[] | null>(null);
  const [text, setText] = React.useState<{ text: string; title: string } | null>(null);
  const heldText = React.useRef(text);
  if (text) heldText.current = text;
  // "Add as ToDo" opens the ToDo sheet once this one has gone (two sheets never stand together)
  const todoNext = React.useRef<string | null>(null);
  const [todo, setTodo] = React.useState<string | null>(null);
  const said = React.useRef<null | (() => void)>(null);

  React.useEffect(() => {
    if (!shared) return;
    done();
    if (shared.kind === 'other') { toast('That cannot be added to Sturoids'); return; }
    if (shared.kind === 'playlist') { toast(PLAYLIST_SAID); return; }
    if (shared.kind === 'files') { noteFromFiles(shared).catch(() => toast('Could not save what was shared')); return; }
    if (shared.kind === 'text') { setText({ text: shared.text, title: shared.title }); return; }
    const vault = useStore.getState().vaultVideos;
    const fresh = shared.list.filter((l) => !vault.some((v) => v.videoId === l.videoId));
    if (!fresh.length) { toast(shared.list.length === 1 ? 'That video is already in the Vault.' : 'Those videos are already in the Vault.'); return; }
    setVideos(fresh);
  }, [shared, done]);

  const shownText = heldText.current;
  return (
    <>
      <VideoOfferSheet videos={videos} onClose={() => setVideos(null)} />
      <Sheet
        visible={!!text}
        onClose={() => setText(null)}
        onClosed={() => {
          const s = said.current;
          said.current = null;
          s?.();
          const t = todoNext.current;
          todoNext.current = null;
          if (t != null) setTodo(t);
        }}
        title="Keep this"
      >
        {shownText ? (
          <View style={st.quote}>
            <Text style={st.quoteText} numberOfLines={6}>{shownText.text}</Text>
          </View>
        ) : null}
        <Row style={{ gap: 12, marginTop: 18 }}>
          <PillButton
            label="New note" icon="document-text-outline" color={C.green} style={{ flex: 1 }}
            onPress={() => {
              const t = text;
              if (!t) return;
              const id = useStore.getState().addNote({ title: t.title, body: t.text, folder: 'General' });
              said.current = () => toastNote('Saved as a new note', id);
              setText(null);
            }}
          />
          <PillButton
            label="Add as ToDo" icon="checkmark-circle-outline" color={C.accent} style={{ flex: 1 }}
            onPress={() => {
              const t = text;
              if (!t) return;
              // a ToDo is one line: the first one shared, cut to a length a row can show
              todoNext.current = (t.title || t.text.split('\n').find((l) => l.trim()) || '').trim().slice(0, 120);
              setText(null);
            }}
          />
        </Row>
      </Sheet>
      <QuickTaskSheet visible={todo != null} onClose={() => setTodo(null)} initialTitle={todo ?? ''} />
    </>
  );
}

/**
 * Videos offered to YT Vault: one with its thumbnail and title, or several in a list ("Add 3 videos"), into a folder of
 * your choice (`folderId` to start in). Titles are fetched while the sheet is open; Add waits for the ones still on
 * their way (each gives up by itself after a few seconds). A video added meanwhile from elsewhere is not added twice.
 * Used by the share intake and by a paste of several links in the Vault.
 */
export function VideoOfferSheet({ videos, onClose, folderId: startFolder = null, onAdded }: {
  videos: { url: string; videoId: string }[] | null; onClose: () => void; folderId?: string | null;
  /** after the sheet has gone: how many were added, and the first one's id */
  onAdded?: (count: number, firstId: string | null) => void;
}) {
  const folders = useStore((s) => s.vaultFolders);
  const [titles, setTitles] = React.useState<Record<string, string>>({});
  const [folderId, setFolderId] = React.useState<string | null>(startFolder);
  const [busy, setBusy] = React.useState(false);
  // the sheet keeps the videos it offers while it closes
  const held = React.useRef(videos);
  if (videos) held.current = videos;
  const waits = React.useRef(new Map<string, Promise<{ title: string; found: boolean }>>());
  const adding = React.useRef(false);
  const said = React.useRef<null | { message: string; count: number; first: string | null }>(null);

  React.useEffect(() => {
    if (!videos) return;
    adding.current = false;
    setBusy(false);
    setTitles({});
    setFolderId(startFolder && useStore.getState().vaultFolders.some((f) => f.id === startFolder) ? startFolder : null);
    // the Vault's own title lookup, loaded only once something is offered
    const { fetchTitle } = require('./screens/VaultPlayerScreen') as typeof import('./screens/VaultPlayerScreen');
    const map = new Map<string, Promise<{ title: string; found: boolean }>>();
    for (const v of videos) {
      const w = fetchTitle(v.videoId);
      map.set(v.videoId, w);
      w.then((r) => { if (waits.current === map) setTitles((t) => ({ ...t, [v.videoId]: r.title })); });
    }
    waits.current = map;
  }, [videos]);

  const add = async () => {
    const list = videos;
    if (!list || adding.current) return;
    adding.current = true;
    setBusy(true);
    const got = await Promise.all(list.map((v) => waits.current.get(v.videoId) ?? Promise.resolve(null)));
    const s = useStore.getState();
    const { placeholderTitle } = require('./screens/VaultPlayerScreen') as typeof import('./screens/VaultPlayerScreen');
    // a folder deleted while the sheet was open leaves the videos at the top of the library
    const folder = folderId && s.vaultFolders.some((f) => f.id === folderId) ? folderId : null;
    let added = 0;
    let first: string | null = null;
    let untitled = 0;
    list.forEach((v, i) => {
      if (useStore.getState().vaultVideos.some((x) => x.videoId === v.videoId)) return;
      const r = got[i];
      const id = s.addVideo({ url: v.url, videoId: v.videoId, title: r?.title || placeholderTitle(v.videoId), folderId: folder });
      if (!first) first = id;
      added++;
      if (r && !r.found) untitled++;
    });
    const message = !added
      ? (list.length === 1 ? 'That video is already in the Vault.' : 'Those videos are already in the Vault.')
      : untitled
        ? (added === 1 ? 'Added without its title, as YouTube did not answer. Opening the video tries again.' : 'Added ' + added + ' videos, some without their titles')
        : added === 1 ? 'Added to YT Vault' : 'Added ' + added + ' videos to YT Vault';
    said.current = { message, count: added, first };
    onClose();
  };

  const nameOf = (id: string | null) => folders.find((f) => f.id === id)?.name || '';
  const shown = held.current || [];
  const one = shown.length === 1 ? shown[0] : null;
  return (
    <Sheet
      visible={!!videos}
      onClose={onClose}
      onClosed={() => {
        const m = said.current;
        said.current = null;
        if (!m) return;
        toast(m.message);
        onAdded?.(m.count, m.first);
      }}
      title={shown.length > 1 ? 'Add ' + shown.length + ' videos' : 'Add to YT Vault'}
    >
      {one ? (
        <>
          <CachedImage
            source={{ uri: 'https://img.youtube.com/vi/' + one.videoId + '/mqdefault.jpg' }}
            contentFit="cover" cachePolicy="memory-disk" transition={220}
            style={[st.thumb, { backgroundColor: C.inset }]}
            accessible accessibilityLabel="The video's thumbnail"
          />
          {titles[one.videoId] != null ? (
            <Appear><Text style={[T.title, { marginTop: 12 }]} numberOfLines={3}>{titles[one.videoId]}</Text></Appear>
          ) : (
            // where the title will be while it is fetched: a faint line with the loading sheen, instead of a blank
            <View style={st.titleWait} accessible accessibilityLabel="Fetching the title">
              <Sheen radius={8} />
            </View>
          )}
        </>
      ) : (
        <ScrollView style={{ maxHeight: 280 }} nestedScrollEnabled>
          {shown.map((v, i) => (
            <View key={v.videoId}>
              {i > 0 ? <Hairline /> : null}
              <View style={st.row}>
                <CachedImage
                  source={{ uri: 'https://img.youtube.com/vi/' + v.videoId + '/mqdefault.jpg' }}
                  contentFit="cover" cachePolicy="memory-disk" transition={220}
                  style={[st.smallThumb, { backgroundColor: C.inset }]}
                />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  {titles[v.videoId] != null ? (
                    <Appear><Text style={st.rowTitle} numberOfLines={2}>{titles[v.videoId]}</Text></Appear>
                  ) : (
                    <View style={st.rowWait}><Sheen radius={6} /></View>
                  )}
                </View>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
      <Text style={st.label}>Folder</Text>
      <Row style={{ flexWrap: 'wrap' }}>
        <Chip icon="home-outline" label="No folder" color={C.pink} active={folderId === null} onPress={() => setFolderId(null)} />
        {folders.map((f) => (
          <Chip
            key={f.id} icon="folder-outline" color={C.pink} active={folderId === f.id}
            label={f.parentId ? nameOf(f.parentId) + ' / ' + f.name : f.name}
            onPress={() => setFolderId(f.id)}
          />
        ))}
      </Row>
      <PillButton
        label={busy ? 'Adding' : shown.length > 1 ? 'Add ' + shown.length + ' videos' : 'Add'} icon="add" color={C.pink}
        onPress={() => { add().catch(() => { adding.current = false; setBusy(false); }); }} style={{ marginTop: 8 }}
      />
    </Sheet>
  );
}

const st = StyleSheet.create({
  thumb: { width: '100%', aspectRatio: 16 / 9, borderRadius: 16 },
  // a title-sized line: about the height of T.title's line, so the title takes its place without a jump
  titleWait: { width: '72%', height: 20, marginTop: 13, marginBottom: 1, borderRadius: 8, backgroundColor: C.inset },
  label: { color: C.textFaint, fontFamily: F.smMed, fontSize: 12, letterSpacing: TRACK.fine, marginTop: 18, marginBottom: 10, marginLeft: 2 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  smallThumb: { width: 92, height: 52, borderRadius: 10 },
  rowTitle: { color: C.text, fontFamily: F.semi, fontSize: 14, lineHeight: 19, letterSpacing: TRACK.small },
  rowWait: { width: '80%', height: 14, borderRadius: 6, backgroundColor: C.inset, overflow: 'hidden' },
  quote: { borderLeftWidth: 2, borderLeftColor: C.hairline, paddingLeft: 12, paddingVertical: 2 },
  quoteText: { color: C.textDim, fontFamily: F.reg, fontSize: 15, lineHeight: 22, letterSpacing: TRACK.body },
});
