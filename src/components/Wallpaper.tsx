// The wallpaper as the pages draw it. Every page draws its own copy, lined up with the window, so pages stay opaque
// for their transitions while the photo looks like one picture behind them all; every copy shows the same decoded
// image from expo-image's memory cache. Bars (headers, the tab bar, Sift's ground) draw the small frosted copy, lined
// up the same way: a frosted bar on Android without any blur view.

import React from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../store';
import { bgFor, shownTheme } from '../theme';
import { BAR_BLUR, BLUR_RADIUS, WallpaperPick, cleanPick, fileOf, shownUri, wallpaperExists } from '../wallpaper';

/** photos found missing this launch: their looks show the plain material instead */
const missing = new Set<string>();
const checked = new Set<string>();
const listeners = new Set<() => void>();

/** The photo the look being drawn shows, or null. */
export function useWallpaper(): WallpaperPick | null {
  const mood = useStore((s) => s.settings.mood);
  const raw = useStore((s) => (s.settings as any).wallpapers?.[mood === 'cheerful' ? 'cheerful' : 'elite']);
  const pick = React.useMemo(() => cleanPick(raw), [raw]);
  const [, bump] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    listeners.add(bump);
    return () => { listeners.delete(bump); };
  }, []);
  React.useEffect(() => {
    if (!pick || checked.has(pick.id)) return;
    checked.add(pick.id);
    wallpaperExists(pick.id).then((ok) => {
      if (ok) return;
      missing.add(pick.id);
      listeners.forEach((l) => l());
      // said once, a moment later (the toast host may not be up yet at launch)
      setTimeout(() => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        (require('./Toast') as typeof import('./Toast')).toast('Your wallpaper photo is no longer on this device.');
      }, 1500);
    });
  }, [pick?.id]);
  return pick && !missing.has(pick.id) ? pick : null;
}

/** Whether a photo is behind the pages now: words drawn straight on the ground take a soft shadow then. */
export const useOnPhoto = () => useWallpaper() != null;

/** The soft shadow words drawn straight on the ground take over a photo. */
export const ON_PHOTO_TEXT = Object.freeze({
  textShadowColor: 'rgba(0, 0, 0, 0.55)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 4,
});

/**
 * The photo behind a page or a bar, filling its parent. `at` is where the parent stands from the window's top-left
 * corner, so every copy lines up with the window. `bar` draws the frosted copy, a little dimmer.
 */
export const WallpaperLayer = React.memo(function WallpaperLayer({ at, bar = false }: { at?: { x: number; y: number }; bar?: boolean }) {
  const pick = useWallpaper();
  const theme = useStore((s) => s.settings.theme);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  if (!pick) return null;
  const uri = shownUri(fileOf(pick.id, bar ? 'bar' : 'full'));
  if (!uri) return null;
  const bg = bgFor(shownTheme(theme));
  const dim = bar ? Math.min(0.92, pick.dim + 0.2) : pick.dim;
  const x = at?.x ?? 0;
  const y = at?.y ?? 0;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, st.clip, { backgroundColor: bg }]}>
      <Image
        source={{ uri }}
        style={{ position: 'absolute', left: -x, top: -y, width, height }}
        contentFit="cover"
        contentPosition={{ left: Math.round(pick.fx * 100) + '%', top: Math.round(pick.fy * 100) + '%' } as any}
        blurRadius={bar ? BAR_BLUR : BLUR_RADIUS[pick.blur]}
        transition={0}
        cachePolicy="memory-disk"
        allowDownscaling
        accessible={false}
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: bg, opacity: dim }]} />
      {/* a gentle shade behind the status bar and the page's title, so they read over any photo */}
      {bar || y > 0 ? null : (
        <LinearGradient
          colors={[bg + 'B3', bg + '00']}
          style={{ position: 'absolute', left: 0, right: 0, top: 0, height: insets.top + 72 }}
        />
      )}
    </View>
  );
});

const st = StyleSheet.create({ clip: { overflow: 'hidden' } });
