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
