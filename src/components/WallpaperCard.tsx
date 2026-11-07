// Settings, Appearance, Wallpaper: each look's own photo behind the pages, or none. A live preview shows the look's
// material over the photo (drag it to choose which part shows), with its dim and blur; below it, the photos kept on
// this device to choose from again (hold one to remove it), and a new one from the phone's photos.

import React from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useStore } from '../store';
import { C, F, MIN, S, SKINS, T, TRACK, bgFor, shownTheme } from '../theme';
import {
  BLUR_RADIUS, DIM_DEFAULT, DIM_MAX, Look, WallpaperPick, Wallpapers, cleanWallpapers, fileOf, importWallpaper,
  listWallpapers, removeWallpaper, shownUri, trimWallpapers,
} from '../wallpaper';
import { Card, Toggle, useTheme } from './UI';
import { SegmentedControl } from './SegmentedControl';
import { Slider } from './Slider';
import { Bouncy, FadeSwap } from './Motion';
import { toast } from './Toast';
import { tap, tick } from '../haptics';

const LOOKS: { key: Look; label: string }[] = [{ key: 'elite', label: 'Elite' }, { key: 'cheerful', label: 'Cheerful' }];
const BLURS: { key: '0' | '1' | '2'; label: string }[] = [{ key: '0', label: 'Off' }, { key: '1', label: 'Soft' }, { key: '2', label: 'Strong' }];
const PREVIEW_W = 128;
const THUMB = 58;

/** The photos kept on this device, read again whenever one is added or removed. */
function usePhotos(): [string[], () => void] {
  const [list, setList] = React.useState<string[]>([]);
  const read = React.useCallback(() => { listWallpapers().then(setList).catch(() => setList([])); }, []);
  React.useEffect(read, [read]);
  return [list, read];
}

export const WallpaperCard = React.memo(function WallpaperCard() {
  const mood = useStore((s) => s.settings.mood);
  const raw = useStore((s) => (s.settings as any).wallpapers);
  const setSetting = useStore((s) => s.setSetting) as (k: any, v: any) => void;
  const all = React.useMemo<Wallpapers>(() => cleanWallpapers(raw), [raw]);
  const [look, setLook] = React.useState<Look>(mood === 'cheerful' ? 'cheerful' : 'elite');
  const pick = all[look];
  const [photos, reread] = usePhotos();
  const [busy, setBusy] = React.useState(false);

  const save = React.useCallback((next: WallpaperPick | null) => {
    const now = cleanWallpapers((useStore.getState().settings as any).wallpapers);
    setSetting('wallpapers', { ...now, [look]: next });
  }, [look, setSetting]);
  const patch = (p: Partial<WallpaperPick>) => { if (pick) save({ ...pick, ...p }); };
  const choose = (id: string | null) => {
    tick();
    save(id ? { id, dim: pick?.dim ?? DIM_DEFAULT, blur: pick?.blur ?? 0, fx: 0.5, fy: 0.5, glows: pick?.glows ?? false } : null);
  };

  const add = async () => {
    if (busy) return;
    tap();
    setBusy(true);
    try {
      const id = await importWallpaper();
      if (id) {
        choose(id);
        const now = cleanWallpapers((useStore.getState().settings as any).wallpapers);
        await trimWallpapers([now.elite?.id, now.cheerful?.id, id].filter(Boolean) as string[]);
        reread();
      }
    } catch {
      toast('That photo could not be used. Try another one.');
    } finally {
      setBusy(false);
    }
  };

  const remove = (id: string) => {
    const inUse = (['elite', 'cheerful'] as Look[]).filter((l) => all[l]?.id === id);
    const ask = (go: () => void) => {
      if (Platform.OS === 'web') { go(); return; }
      Alert.alert('Remove this photo?', inUse.length ? 'The look that shows it goes back to no wallpaper.' : 'It is removed from this device.', [
        { text: 'Keep', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: go },
      ]);
    };
    ask(() => {
      const now = cleanWallpapers((useStore.getState().settings as any).wallpapers);
      if (inUse.length) setSetting('wallpapers', { elite: now.elite?.id === id ? null : now.elite, cheerful: now.cheerful?.id === id ? null : now.cheerful });
      removeWallpaper(id).then(reread);
    });
  };

  return (
    <Card>
      <SegmentedControl stretch value={look} onChange={(k) => setLook(k)} options={LOOKS} />
      <View style={st.top}>
        <Preview look={look} pick={pick} onFocus={(fx, fy) => patch({ fx, fy })} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <FadeSwap swapKey={look + (pick ? 'p' : 'n')}>
            <Text style={T.body}>{pick ? 'Your photo' : 'No wallpaper'}</Text>
            <Text style={[T.caption, { marginTop: 4 }]}>
              {pick
                ? 'Drag the preview to choose which part shows. Kept on this device only.'
                : 'Choose a photo for ' + (look === 'elite' ? 'Elite' : 'Cheerful') + '. It stays on this device and never syncs.'}
            </Text>
          </FadeSwap>
        </View>
      </View>

      <View style={st.row}>
        <Choice label="None" active={!pick} onPress={() => choose(null)} onLongPress={undefined}>
          <Ionicons name="ban-outline" size={20} color={C.textFaint} />
        </Choice>
        <Choice label={busy ? 'Adding a photo' : 'Choose a photo'} active={false} onPress={add} onLongPress={undefined}>
          <Ionicons name={busy ? 'hourglass-outline' : 'add'} size={22} color={C.accent} />
        </Choice>
        {photos.map((id) => (
          <Choice key={id} label="A kept photo" active={pick?.id === id} onPress={() => choose(id)} onLongPress={() => remove(id)}>
            <Thumb id={id} />
          </Choice>
        ))}
      </View>

      {pick ? (
        <View style={{ marginTop: 6 }}>
          <View style={st.labelRow}>
            <Text style={st.label}>Dim</Text>
            <Text style={st.value}>{Math.round(pick.dim * 100) + '%'}</Text>
          </View>
          <Slider
            label="Dim the photo" value={pick.dim} min={0} max={DIM_MAX} step={0.05}
            format={(v) => Math.round(v * 100) + ' percent'} onDone={(v) => patch({ dim: v })}
          />
          <Text style={[st.label, { marginTop: 8, marginBottom: 8 }]}>Blur</Text>
          <SegmentedControl
            size="sm" stretch value={String(pick.blur) as '0' | '1' | '2'} options={BLURS}
            onChange={(k) => patch({ blur: Number(k) as 0 | 1 | 2 })}
          />
          {look === 'cheerful' ? (
            <View style={st.glowRow}>
              <View style={{ flex: 1 }}>
                <Text style={T.body}>Keep the drifting glows</Text>
                <Text style={[T.caption, { marginTop: 2 }]}>Cheerful's soft colour moving over the photo</Text>
              </View>
              <Toggle value={pick.glows} onChange={(v) => patch({ glows: v })} label="Keep the drifting glows" />
            </View>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
});

/** A square choice in the row: None, Choose a photo, or a kept photo. */
function Choice({ label, active, onPress, onLongPress, children }: {
  label: string; active: boolean; onPress: () => void; onLongPress: (() => void) | undefined; children: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <Bouncy
      onPress={onPress} onLongPress={onLongPress} scaleTo={0.94} radius={14} accessibilityLabel={label}
      accessibilityRole="button" accessibilityState={{ selected: active }}
      accessibilityHint={onLongPress ? 'Hold to remove it' : undefined}
      style={[st.choice, theme === 'minimal' ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border } : { backgroundColor: C.inset }]}
    >
      {children}
      {active ? <View pointerEvents="none" style={[st.ring, { borderColor: C.accent }]} /> : null}
    </Bouncy>
  );
}

function Thumb({ id }: { id: string }) {
  const uri = shownUri(fileOf(id, 'thumb'));
  if (!uri) return null;
  return <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={0} recyclingKey={id} accessible={false} />;
}

/**
 * The look's material over the photo, at the screen's proportions: a header line, a raised card, a carved well. A drag
 * moves which part of the photo shows (where it rests becomes the look's focus point).
 */
function Preview({ look, pick, onFocus }: { look: Look; pick: WallpaperPick | null; onFocus: (fx: number, fy: number) => void }) {
  const theme = useStore((s) => s.settings.theme);
  const { width, height } = useWindowDimensions();
  const pw = PREVIEW_W;
  const ph = Math.round(pw * Math.min(2.3, Math.max(1.2, height / width)));
  const bg = bgFor(shownTheme(theme));
  const skin = SKINS[look];
  const minimal = shownTheme(theme) === 'minimal';
  // the photo's own proportions (once it has loaded), to lay it out covering the preview
  const [ratio, setRatio] = React.useState(0);
  const coverW = ratio ? Math.max(pw, ph * ratio) : pw;
  const coverH = ratio ? Math.max(ph, pw / ratio) : ph;
  const fx = useSharedValue(pick?.fx ?? 0.5);
  const fy = useSharedValue(pick?.fy ?? 0.5);
  const start = useSharedValue({ x: 0.5, y: 0.5 });
  React.useEffect(() => { fx.value = pick?.fx ?? 0.5; fy.value = pick?.fy ?? 0.5; }, [pick?.id, pick?.fx, pick?.fy]);
  const extraX = coverW - pw;
  const extraY = coverH - ph;
  const pan = React.useMemo(() => Gesture.Pan().enabled(!!pick).minDistance(4)
    .onBegin(() => { start.value = { x: fx.value, y: fy.value }; })
    .onUpdate((e) => {
      // dragging the photo right shows more of its left: the focus moves the other way
      if (extraX > 0) fx.value = Math.min(1, Math.max(0, start.value.x - e.translationX / extraX));
      if (extraY > 0) fy.value = Math.min(1, Math.max(0, start.value.y - e.translationY / extraY));
    })
    .onEnd(() => { runOnJS(onFocus)(Math.round(fx.value * 100) / 100, Math.round(fy.value * 100) / 100); }), [pick?.id, extraX, extraY, onFocus]);
  const photoStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -extraX * fx.value }, { translateY: -extraY * fy.value }] as const,
  }));
  const uri = pick ? shownUri(fileOf(pick.id, 'full')) : null;
  return (
    <GestureDetector gesture={pan}>
      <View
        style={[st.preview, { width: pw, height: ph, backgroundColor: bg }]}
        accessible accessibilityLabel={pick ? 'Preview of the wallpaper. Drag to choose which part shows.' : 'Preview: no wallpaper'}
      >
        {uri ? (
          <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: coverW, height: coverH }, photoStyle]}>
            <Image
              source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={0}
              blurRadius={pick ? Math.round(BLUR_RADIUS[pick.blur] * pw / Math.max(1, width)) : 0}
              onLoad={(e) => { const { width: iw, height: ih } = e.source; if (iw && ih) setRatio(iw / ih); }}
              accessible={false}
            />
          </Animated.View>
        ) : null}
        {pick ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: bg, opacity: pick.dim }]} /> : null}
        <View pointerEvents="none" style={st.mock}>
          <View style={[st.mockTitle, { backgroundColor: C.text }]} />
          <View style={[st.mockCard, minimal ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: MIN.border } : { backgroundColor: C.card, ...skin.raisedMid }]}>
            <View style={[st.mockLine, { backgroundColor: C.textDim, width: '70%' }]} />
            <View style={[st.mockLine, { backgroundColor: C.textFaint, width: '45%', marginTop: 5 }]} />
          </View>
          <View style={[st.mockWell, minimal ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border } : { backgroundColor: C.inset, ...skin.insetLow }]} />
        </View>
      </View>
    </GestureDetector>
  );
}

const st = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: S.gap, marginTop: S.gap },
  preview: { borderRadius: 16, overflow: 'hidden' },
  mock: { flex: 1, padding: 10, paddingTop: 18 },
  mockTitle: { width: '52%', height: 7, borderRadius: 4, opacity: 0.9 },
  mockCard: { marginTop: 12, borderRadius: 9, padding: 8 },
  mockLine: { height: 4, borderRadius: 2 },
  mockWell: { marginTop: 10, height: 14, borderRadius: 7 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: S.gap, marginBottom: 4 },
  choice: { width: THUMB, height: THUMB, borderRadius: 14, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  ring: { ...StyleSheet.absoluteFillObject, borderRadius: 14, borderWidth: 2 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 8 },
  label: { color: C.textDim, fontFamily: F.smMed, fontSize: 13, letterSpacing: TRACK.small },
  value: { color: C.textFaint, fontFamily: F.med, fontSize: 13, fontVariant: ['tabular-nums'] },
  glowRow: { flexDirection: 'row', alignItems: 'center', gap: S.gap, marginTop: S.gap },
});
