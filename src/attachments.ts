import * as FileSystem from 'expo-file-system';
import type { Attachment } from './store';

/** Where the notes editor keeps its own copies of attached media and files. */
export const ATT_DIR = FileSystem.documentDirectory + 'attachments/';

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
