import * as FileSystem from 'expo-file-system';
import type { Attachment } from './store';
import { pdir } from './profiles';

/** Where the notes editor keeps its own copies of attached media and files: each profile has its own folder. */
export const ATT_DIR = pdir('attachments/');

/**
 * Deletes the copies this app made. A note can also hold the picker's original uri (the fallback when copying
 * failed), and that file belongs to the user's gallery, so anything outside ATT_DIR is never touched.
 */
export function deleteAttachmentFiles(list: Attachment[] | Attachment | undefined) {
  const items = Array.isArray(list) ? list : [list];
  for (const a of items) {
    if (a && typeof a.uri === 'string' && a.uri.startsWith(ATT_DIR)) {
      FileSystem.deleteAsync(a.uri, { idempotent: true }).catch(() => {});
    }
  }
}

/** How long a removed attachment's file waits for an Undo: the toast that offers it, and its fade, with a margin. */
export const UNDO_WINDOW_MS = 4800;

/**
 * Deletes a removed attachment's file once its Undo has had its time, unless `cancel` (the Undo) runs first. A file
 * still on its way out when the app is killed stays behind in the folder, which costs space and never a picture.
 */
export function deleteAttachmentLater(a: Attachment): { cancel: () => void } {
  const timer = setTimeout(() => deleteAttachmentFiles(a), UNDO_WINDOW_MS);
  return { cancel: () => clearTimeout(timer) };
}

/**
 * Copies a picked or shared file into the app's own attachments folder, where Android never clears it. When the copy
 * fails (a full phone, usually) the note keeps the picker's copy for now and `kept` is false, so the user is told to
 * attach it again once there is room: the picker's copy lives in a cache Android may clear.
 */
export async function keepFile(uri: string, name: string): Promise<{ uri: string; kept: boolean }> {
  try {
    await FileSystem.makeDirectoryAsync(ATT_DIR, { intermediates: true }).catch(() => {});
    const dest = ATT_DIR + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + '-' + name.replace(/[^\w.\-]/g, '_');
    await FileSystem.copyAsync({ from: uri, to: dest });
    return { uri: dest, kept: true };
  } catch {
    return { uri, kept: false };
  }
}

/** What a note says when a file was attached but no copy of it could be kept. */
export const NOT_KEPT = 'Attached, but the phone is too full to keep a copy. Free some space and attach it again.';

/**
 * An attachment's address as the screen can show it. On a phone that is its file; on the PC version files live in the
 * page's database (src/web/shims/fileSystem.ts), so it is a short-lived address made for it there.
 */
export function viewUri(uri: string): string {
  // read here, not at the top: the backup tests load this file in Node, without React Native
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  if ((require('react-native') as typeof import('react-native')).Platform.OS !== 'web') return uri;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const FS = require('expo-file-system') as { displayUrl?: (u: string) => string | null };
  return FS.displayUrl?.(uri) ?? uri;
}
