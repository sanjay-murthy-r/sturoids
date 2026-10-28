import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { C, F, S, TRACK } from '../theme';
import { useStore, VaultVideo } from '../store';
import { fmtMediaTime } from '../utils';
import { openTool } from '../toolNav';
import { Kicker, TILE_TEXT_MAX, Tile, TileNote, kit } from './kit';
import { recentVideos } from './logic';
import type { WidgetProps } from './types';

const thumbOf = (videoId: string) => 'https://img.youtube.com/vi/' + videoId + '/mqdefault.jpg';
const openVideo = (v: VaultVideo) =>
  router.push({
    pathname: '/vault/[id]',
    params: v.resumeAt && v.resumeAt > 0 ? { id: v.id, t: String(Math.floor(v.resumeAt)) } : { id: v.id },
  }, { dangerouslySingular: true });

/** A video's thumbnail, with a carved play mark under it while it loads or when it cannot. */
function Thumb({ videoId, w, h }: { videoId: string; w: number | `${number}%`; h: number }) {
  const [failed, setFailed] = React.useState(false);
  return (
    <View style={[st.thumb, { width: w, height: h, backgroundColor: C.inset }]}>
      <Ionicons name="play-outline" size={18} color={C.textFaint} />
      {failed ? null : (
        <Image
          source={{ uri: thumbOf(videoId) }} style={StyleSheet.absoluteFill} contentFit="cover"
          cachePolicy="memory-disk" transition={200} onError={() => setFailed(true)}
        />
      )}
    </View>
  );
}

/** Continue watching: the video opened last, its thumbnail, and where it was left; a tap carries on from there. */
export function ContinueWatchingWidget({ size }: WidgetProps) {
  const videos = useStore((s) => s.vaultVideos);
  const v = React.useMemo(() => recentVideos(videos, 1)[0] ?? null, [videos]);
  if (!v) {
    return (
      <Tile size={size} onPress={() => openTool('vault')} label="No lectures yet" hint="Opens YT Vault">
        <TileNote icon="play-circle-outline" title="No lectures yet" body="Save a YouTube lecture and carry on from here." />
      </Tile>
    );
  }
  const left = v.resumeAt && v.resumeAt > 0 ? 'Left at ' + fmtMediaTime(v.resumeAt) : 'Not started';
  return (
    <Tile size={size} onPress={() => openVideo(v)} label={v.title + ', ' + left} hint="Plays it from there" pad={14}>
      <View style={st.cw}>
        <Thumb videoId={v.videoId} w={150} h={84} />
        <View style={st.cwText}>
          <Kicker color={C.pink}>Continue watching</Kicker>
          <Text style={st.cwTitle} numberOfLines={3} maxFontSizeMultiplier={TILE_TEXT_MAX}>
            {v.title}
          </Text>
          <View style={st.left}>
            <Ionicons name="play" size={11} color={C.pink} />
            <Text style={[kit.sub, { marginLeft: 5 }]} numberOfLines={1} maxFontSizeMultiplier={TILE_TEXT_MAX}>{left}</Text>
          </View>
        </View>
      </View>
    </Tile>
  );
}

/** Watch list: the three videos opened or added last, each a tap from playing. */
export function WatchListWidget({ size, editing, preview }: WidgetProps) {
  const videos = useStore((s) => s.vaultVideos);
  const list = React.useMemo(() => recentVideos(videos, 3), [videos]);
  if (!list.length) {
    return (
      <Tile size={size} onPress={() => openTool('vault')} label="No lectures yet" hint="Opens YT Vault">
        <TileNote icon="play-circle-outline" title="No lectures yet" body="Your latest lectures show here." />
      </Tile>
    );
  }
  return (
    <Tile size={size} pad={16}>
      <Pressable onPress={() => openTool('vault')} accessibilityRole="button" accessibilityHint="Opens YT Vault" hitSlop={8}>
        <Kicker color={C.pink}>Watch list</Kicker>
      </Pressable>
      <View style={st.list}>
        {list.map((v) => (
          <Pressable
            key={v.id} onPress={() => openVideo(v)} disabled={editing || preview}
            style={({ pressed }) => [st.row, pressed && { opacity: 0.6 }]}
            accessibilityRole="button" accessibilityLabel={v.title}
          >
            <Thumb videoId={v.videoId} w={112} h={63} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[kit.rowText, { fontFamily: F.med, lineHeight: 19 }]} numberOfLines={2} maxFontSizeMultiplier={TILE_TEXT_MAX}>{v.title}</Text>
              <Text style={kit.sub} numberOfLines={1} maxFontSizeMultiplier={TILE_TEXT_MAX}>
                {v.resumeAt && v.resumeAt > 0 ? 'Left at ' + fmtMediaTime(v.resumeAt) : 'Not started'}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
    </Tile>
  );
}

const st = StyleSheet.create({
  thumb: { borderRadius: 10, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  cwTitle: { color: C.text, fontFamily: F.semi, fontSize: 14, lineHeight: 19, letterSpacing: TRACK.small, marginTop: 6 },
  cw: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  cwText: { flex: 1, marginLeft: 14, minWidth: 0 },
  left: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  list: { flex: 1, justifyContent: 'space-evenly', marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 44, borderRadius: S.radiusSm },
});
