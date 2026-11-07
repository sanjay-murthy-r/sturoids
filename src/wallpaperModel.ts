// What each look's wallpaper is, as the settings keep it: pure data and its checks, with nothing of React Native, so
// the store (and its tests in Node) can read and clean it. The photos themselves: src/wallpaper.ts.

export type Look = 'elite' | 'cheerful';

/** What a look shows: which photo, how dimmed (0 to 0.85), how blurred, which part of it (0 to 1 across and down). */
export interface WallpaperPick {
  id: string;
  dim: number;
  blur: 0 | 1 | 2;
  fx: number;
  fy: number;
  /** Cheerful only: its drifting glows keep moving over the photo */
  glows: boolean;
}
export type Wallpapers = { elite: WallpaperPick | null; cheerful: WallpaperPick | null };
export const NO_WALLPAPERS: Wallpapers = Object.freeze({ elite: null, cheerful: null }) as Wallpapers;

/** how many photos are kept to choose from again */
export const KEEP = 8;
export const DIM_DEFAULT = 0.42;
export const DIM_MAX = 0.85;
/** the blur each setting gives a page's copy (expo-image blurRadius), and the frosted bars' own */
export const BLUR_RADIUS = [0, 6, 16] as const;
export const BAR_BLUR = 22;

const clamp01 = (n: unknown, d: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : d);
const ID = /^[a-z0-9]{6,40}$/;

/** A look's pick as kept, or null: anything damaged or unknown is dropped. */
export function cleanPick(raw: any): WallpaperPick | null {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !ID.test(raw.id)) return null;
  return {
    id: raw.id,
    dim: Math.min(DIM_MAX, clamp01(raw.dim, DIM_DEFAULT)),
    blur: raw.blur === 1 || raw.blur === 2 ? raw.blur : 0,
    fx: clamp01(raw.fx, 0.5),
    fy: clamp01(raw.fy, 0.5),
    glows: raw.glows === true,
  };
}
export function cleanWallpapers(raw: any): Wallpapers {
  if (!raw || typeof raw !== 'object') return { elite: null, cheerful: null };
  return { elite: cleanPick(raw.elite), cheerful: cleanPick(raw.cheerful) };
}
