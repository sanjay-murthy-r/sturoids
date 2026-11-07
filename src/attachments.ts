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

/** The PC version's stand-in for the file system (src/web/shims/fileSystem.ts); null on a phone. */
function webFiles(): { displayUrl?: (u: string) => string | null; fsReady?: Promise<unknown> } | null {
  // read here, not at the top: the backup tests load this file in Node, without React Native
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  if ((require('react-native') as typeof import('react-native')).Platform.OS !== 'web') return null;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('expo-file-system');
}

/**
 * An attachment's address as the screen can show it. On a phone that is its file; on the PC version files live in the
 * page's database (src/web/shims/fileSystem.ts), so it is a short-lived address made for it there. Null on the PC
 * while the files are still loading (see filesPending) or when the file is not there: the raw path would only fail.
 */
export function viewUri(uri: string): string | null {
  const FS = webFiles();
  if (!FS?.displayUrl) return uri;
  return FS.displayUrl(uri);
}

let filesIn = false;
/**
 * On the PC, a promise that settles once the page's files have loaded, while they are still loading; null once they
 * are (and always on a phone). Until then viewUri has no address for a kept file, which is not yet a missing one.
 */
export function filesPending(): Promise<void> | null {
  if (filesIn) return null;
  const ready = webFiles()?.fsReady;
  if (!ready) { filesIn = true; return null; }
  return ready.then(() => { filesIn = true; }, () => { filesIn = true; });
}

/** The kind of file an attachment is, from its name, for the app that opens it and the PC's download. */
export function mimeOf(a: Attachment): string {
  const ext = (a.name || a.uri).split('.').pop()?.toLowerCase() || '';
  const known: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic',
    mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', '3gp': 'video/3gpp',
    pdf: 'application/pdf', mp3: 'audio/mpeg', m4a: 'audio/mp4', txt: 'text/plain', csv: 'text/csv',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };
  return known[ext] || (a.kind === 'image' ? 'image/jpeg' : a.kind === 'video' ? 'video/mp4' : 'application/octet-stream');
}
