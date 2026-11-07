// Wallpapers: a photo of the user's own behind the pages, one for each look (Elite and Cheerful each keep their own,
// or none). They live on this device only: the photos sit in the profile's own folder, and which one each look shows
// is a device setting (store.ts DEVICE_SETTINGS), so nothing about them syncs, goes into a backup file or is replaced
// by a restore. Each photo is kept three ways: screen-sized for the pages, small for the frosted bars, and a thumbnail.

import * as FileSystem from 'expo-file-system';
import { Dimensions, PixelRatio, Platform } from 'react-native';
import { pdir } from './profiles';
import type { ProfileId } from './profiles';

export * from './wallpaperModel';
import { KEEP } from './wallpaperModel';

type Variant = 'full' | 'bar' | 'thumb';
const dir = (id?: ProfileId) => pdir('wallpapers/', id);
/** A kept photo's file, in one of its three sizes. */
export const fileOf = (photo: string, v: Variant = 'full') => dir() + photo + (v === 'full' ? '' : v === 'bar' ? '@bar' : '@thumb') + '.jpg';

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** Writes a picture the manipulator made to `to`: moved on a phone; on the PC its bytes go into the files' store. */
async function keep(result: { uri: string; base64?: string }, to: string) {
  if (Platform.OS === 'web') {
    if (!result.base64) throw new Error('no picture data');
    await FileSystem.writeAsStringAsync(to, result.base64, { encoding: FileSystem.EncodingType.Base64 });
  } else {
    await FileSystem.moveAsync({ from: result.uri, to });
  }
}

/**
 * Lets the user pick a photo and keeps it, in its three sizes. Resolves with the new photo's id, null when the picker
 * was closed without one; throws when the photo could not be read or kept (the caller says so).
 */
export async function importWallpaper(): Promise<string | null> {
  // loaded here, so the store's tests and the app's start-up never load the picker or the manipulator
  const ImagePicker = require('expo-image-picker') as typeof import('expo-image-picker');
  const { manipulateAsync, SaveFormat } = require('expo-image-manipulator') as typeof import('expo-image-manipulator');
  const { expectAway } = require('./lock') as typeof import('./lock');
  const res = await expectAway(() => ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, exif: false }));
  if (res.canceled || !res.assets?.length) return null;
  const asset = res.assets[0];
  const screen = Dimensions.get('screen');
  // the long side of the screen in its real pixels (a PC window may grow: up to 2560), never past the photo's own
  const long = Math.min(2560, Math.round(Math.max(screen.width, screen.height) * PixelRatio.get()));
  const portrait = (asset.height ?? 1) >= (asset.width ?? 1);
  const fit = (px: number) => (portrait ? { height: Math.min(px, asset.height || px) } : { width: Math.min(px, asset.width || px) });
  const web = Platform.OS === 'web';
  await FileSystem.makeDirectoryAsync(dir(), { intermediates: true }).catch(() => {});
  const id = newId();
  const full = await manipulateAsync(asset.uri, [{ resize: fit(long) }], { compress: 0.86, format: SaveFormat.JPEG, base64: web });
  await keep(full, fileOf(id, 'full'));
  // the frosted bars blur it heavily, so a small copy is all they need (and cheap to blur)
  const bar = await manipulateAsync(full.uri, [{ resize: fit(Math.round(long / 4)) }], { compress: 0.8, format: SaveFormat.JPEG, base64: web });
  await keep(bar, fileOf(id, 'bar'));
  const thumb = await manipulateAsync(full.uri, [{ resize: fit(360) }], { compress: 0.8, format: SaveFormat.JPEG, base64: web });
  await keep(thumb, fileOf(id, 'thumb'));
  return id;
}

/** The photos kept on this device, newest first. */
export async function listWallpapers(): Promise<string[]> {
  try {
    const names = await FileSystem.readDirectoryAsync(dir());
    const ids = names.filter((n) => /^[a-z0-9]+\.jpg$/.test(n)).map((n) => n.slice(0, -4));
    // ids start with the time they were made (base 36), so sorting on it puts the newest first
    return ids.sort((a, b) => parseInt(b.slice(0, 8), 36) - parseInt(a.slice(0, 8), 36) || (a < b ? 1 : -1));
  } catch {
    return [];
  }
}

/** Forgets a kept photo, all three sizes. */
export async function removeWallpaper(photo: string) {
  await Promise.all((['full', 'bar', 'thumb'] as Variant[]).map((v) => FileSystem.deleteAsync(fileOf(photo, v), { idempotent: true }).catch(() => {})));
}

/** Keeps the newest KEEP photos, and always the ones a look shows. */
export async function trimWallpapers(inUse: string[]) {
  const all = await listWallpapers();
  const extra = all.filter((p) => !inUse.includes(p)).slice(Math.max(0, KEEP - inUse.length));
  await Promise.all(extra.map(removeWallpaper));
}

/** Every kept photo of a profile, gone (erasing the device, deleting the profile). */
export async function removeAllWallpapers(id?: ProfileId) {
  await FileSystem.deleteAsync(dir(id), { idempotent: true }).catch(() => {});
}

/** Whether a kept photo is still there (the device could have lost it). */
export async function wallpaperExists(photo: string): Promise<boolean> {
  try {
    return (await FileSystem.getInfoAsync(fileOf(photo, 'full'))).exists;
  } catch {
    return false;
  }
}

/** What an image can show for a kept file: the file itself on a phone, an address for it on the PC (null while loading). */
export function shownUri(path: string): string | null {
  if (Platform.OS !== 'web') return path;
  const FS = FileSystem as unknown as { displayUrl?: (u: string) => string | null };
  return FS.displayUrl ? FS.displayUrl(path) : path;
}
