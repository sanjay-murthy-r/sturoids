import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { Image as CachedImage } from 'expo-image';
import { useShareIntent } from 'expo-share-intent';
import { C, F, T, TRACK } from './theme';
import { useStore } from './store';
import { parseYouTubeId } from './utils';
import { Chip, PillButton, Row, Sheet } from './components/UI';
import { Appear } from './components/Motion';
import { toast } from './components/Toast';
import { useIntro } from './intro';
import { useHydrated } from './hooks/useHydrated';

/**
 * Sharing to Sturoids: text shared from another app (YouTube's Share, a browser, a chat) is looked through for a
 * YouTube link, and a sheet offers to add that video to YT Vault, in a folder of your choice. It never opens the
 * player: the share is a quick stop on the way back to what you were doing.
 */

/** A YouTube address in shared text: a watch page (YouTube, YouTube Music, the mobile site), youtu.be, a short or a live. */
const YT_LINK = /(?:https?:\/\/)?(?:[\w-]+\.)*(?:youtube\.com|youtu\.be)\/[^\s<>"']+/gi;

/** The first YouTube video linked in `text`, or null. */
export function youTubeLinkIn(text: string): { url: string; videoId: string } | null {
  for (const m of (text || '').matchAll(YT_LINK)) {
    const url = m[0].replace(/[.,;:!?)\]]+$/, '');
    const videoId = parseYouTubeId(url);
    if (videoId) return { url: /^https?:\/\//i.test(url) ? url : 'https://' + url, videoId };
  }
  return null;
}

type Shared = { kind: 'video'; url: string; videoId: string } | { kind: 'other' };

/**
 * What was shared and is still to be offered. A share is taken from the native module as soon as it arrives (so it
 * never comes round twice), and handed on only once the intro is over and the saved data has loaded.
 */
export function useShareIntake(): { shared: Shared | null; done: () => void } {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent();
  const [shared, setShared] = React.useState<Shared | null>(null);
  React.useEffect(() => {
    if (!hasShareIntent) return;
    const link = youTubeLinkIn([shareIntent.webUrl, shareIntent.text].filter(Boolean).join(' '));
    setShared(link ? { kind: 'video', ...link } : { kind: 'other' });
    resetShareIntent();
  }, [hasShareIntent, shareIntent]);
  const introOver = useIntro((s) => s.phase === 'done');
  const loaded = useHydrated();
  const done = React.useCallback(() => setShared(null), []);
  return { shared: introOver && loaded ? shared : null, done };
}

/** The share intake: mounted once, in the root layout. */
export function ShareIntake() {
  const { shared, done } = useShareIntake();
  const folders = useStore((s) => s.vaultFolders);
  const [offer, setOffer] = React.useState<{ url: string; videoId: string } | null>(null);
  const [title, setTitle] = React.useState<string | null>(null);
  const [folderId, setFolderId] = React.useState<string | null>(null);
  // the sheet keeps the video it offers while it closes
  const held = React.useRef(offer);
  if (offer) held.current = offer;
  // the offer on screen now, read after the title wait: the sheet may have been closed meanwhile, or show a newer share
  const showing = React.useRef(offer);
  showing.current = offer;
  const titleWait = React.useRef<Promise<{ title: string; found: boolean }> | null>(null);
  // what to say once the sheet has gone: a sheet is a window of its own and would cover the toast
  const said = React.useRef<string | null>(null);
  // the button still answers while the sheet slides away, and a second tap would add the video twice
  const adding = React.useRef(false);
  // and while it waits for a title still on its way (a few seconds at most), it says so, until the sheet has gone
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!shared) return;
    done();
    if (shared.kind === 'other') { toast('Only YouTube links can be added.'); return; }
    if (useStore.getState().vaultVideos.some((v) => v.videoId === shared.videoId)) {
      toast('That video is already in the Vault.');
      return;
    }
    // the Vault's own title lookup, loaded only once something is shared
    const { fetchTitle } = require('./screens/VaultPlayerScreen') as typeof import('./screens/VaultPlayerScreen');
    const wait = fetchTitle(shared.videoId);
    titleWait.current = wait;
    adding.current = false;
    setBusy(false);
    setTitle(null);
    setFolderId(null);
    setOffer({ url: shared.url, videoId: shared.videoId });
    wait.then((r) => { if (titleWait.current === wait) setTitle(r.title); });
  }, [shared, done]);

  const add = async () => {
    const o = offer;
    if (!o || adding.current) return;
    adding.current = true;
    setBusy(true);
    // a title still on its way is waited for (it gives up by itself after a few seconds)
    const got = await (titleWait.current ?? Promise.resolve(null));
    const s = useStore.getState();
    let message: string;
    if (s.vaultVideos.some((v) => v.videoId === o.videoId)) {
      message = 'That video is already in the Vault.';
    } else {
      const { placeholderTitle } = require('./screens/VaultPlayerScreen') as typeof import('./screens/VaultPlayerScreen');
      // a folder deleted while the sheet was open leaves the video at the top of the library
      const folder = folderId && s.vaultFolders.some((f) => f.id === folderId) ? folderId : null;
      s.addVideo({ url: o.url, videoId: o.videoId, title: got?.title || placeholderTitle(o.videoId), folderId: folder });
      message = got && !got.found
        ? 'Added without its title, as YouTube did not answer. Opening the video tries again.'
        : 'Added to YT Vault';
    }
    // still showing this video: it is said once the sheet has gone. Closed meanwhile (or showing a newer share, which
    // stays open), it is said now, and never held over for the next sheet to say
    if (showing.current === o) {
      said.current = message;
      setOffer(null);
    } else {
      toast(message);
    }
  };

  const nameOf = (id: string | null) => folders.find((f) => f.id === id)?.name || '';
  const shown = held.current;
  return (
    <Sheet
      visible={!!offer}
      onClose={() => setOffer(null)}
      onClosed={() => { const m = said.current; said.current = null; if (m) toast(m); }}
      title="Add to YT Vault"
    >
      {shown ? (
        <CachedImage
          source={{ uri: 'https://img.youtube.com/vi/' + shown.videoId + '/mqdefault.jpg' }}
          contentFit="cover" cachePolicy="memory-disk" transition={220}
          style={[st.thumb, { backgroundColor: C.inset }]}
          accessible accessibilityLabel="The video's thumbnail"
        />
      ) : null}
      {title != null ? (
        <Appear><Text style={[T.title, { marginTop: 12 }]} numberOfLines={3}>{title}</Text></Appear>
      ) : (
        <Text style={[T.caption, { marginTop: 12 }]}>Fetching title…</Text>
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
        label={busy ? 'Adding' : 'Add'} icon="add" color={C.pink}
        onPress={() => { add().catch(() => { adding.current = false; setBusy(false); }); }} style={{ marginTop: 8 }}
      />
    </Sheet>
  );
}

const st = StyleSheet.create({
  thumb: { width: '100%', aspectRatio: 16 / 9, borderRadius: 16 },
  label: { color: C.textFaint, fontFamily: F.med, fontSize: 12, letterSpacing: TRACK.fine, marginTop: 18, marginBottom: 10, marginLeft: 2 },
});
