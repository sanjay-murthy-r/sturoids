import * as FileSystem from 'expo-file-system';
import * as Notifications from 'expo-notifications';
import {
  useStore, initialData, flushSaves, deleteRecoveryCopy, readRecoveryCopy, loadFailedThisLaunch, savingPaused,
} from './store';
import { JOURNAL_DIR } from './journal';
import { ATT_DIR } from './attachments';
import { removePin, closeLock, noteScope, ALL_NOTES } from './lock';
import { cancelCountdownEnd, rescheduleAllReminders } from './notifications';
import { FINISH_NOTIF_ID } from './deepWork';

/** Deletes the files inside a folder, keeping the folder: the modules that write there made it once and expect it. */
async function emptyFolder(dir: string) {
  const names = await FileSystem.readDirectoryAsync(dir).catch(() => [] as string[]);
  await Promise.all(names.map((n) => FileSystem.deleteAsync(dir + n, { idempotent: true }).catch(() => {})));
}

/**
 * What the app leaves in its cache that holds the user's data: exported backups and kept copies (every tool, the
 * locked journal included, in plain text), the pieces an export or an import works with, the picker's copies of
 * imported backups and of chosen photos, and the photos the profile picture was made from.
 */
const CACHE_PREFIXES = ['sturoids-', 'backup-src-', 'backup-data-'];
const CACHE_FOLDERS = ['DocumentPicker', 'ImagePicker', 'ImageManipulator'];

async function clearCache() {
  const dir = FileSystem.cacheDirectory;
  if (!dir) return;
  const names = await FileSystem.readDirectoryAsync(dir).catch(() => [] as string[]);
  await Promise.all(names
    .filter((n) => CACHE_PREFIXES.some((p) => n.startsWith(p)) || CACHE_FOLDERS.includes(n))
    .map((n) => FileSystem.deleteAsync(dir + n, { idempotent: true }).catch(() => {})));
  try {
    // the Vault's thumbnails and the profile photo, as the image loader keeps them
    const { Image } = require('expo-image') as typeof import('expo-image');
    await Promise.all([Image.clearDiskCache().catch(() => false), Image.clearMemoryCache().catch(() => false)]);
  } catch {
    // no image cache to clear
  }
}

/** Closes every lock that is open: after a replace, what stands behind a lock may be different pages. */
function closeAllLocks() {
  closeLock('journal');
  closeLock('notes');
  closeLock(ALL_NOTES);
  for (const n of useStore.getState().notes) closeLock(noteScope(n.id));
}

/**
 * Erases everything this app keeps on this phone: every tool's data and settings, the journal's texts, note
 * attachments, the PIN, reminders, a kept copy of unreadable data, and the copies in the cache. The cloud account is
 * signed out first and this phone's record of the cloud is forgotten, so nothing empty is ever sent over the copy in
 * the cloud: signing in again finds that copy and asks.
 */
export async function eraseThisPhone() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cloud = require('./cloud') as typeof import('./cloud');
    if (cloud.useCloud.getState().status !== 'signed-out') await cloud.signOut({ forget: true });
    else await cloud.forgetSyncRecord();
  } catch {
    // no cloud module loaded, or already signed out
  }
  cancelCountdownEnd();
  Notifications.cancelScheduledNotificationAsync(FINISH_NOTIF_ID).catch(() => {});
  await removePin();
  closeAllLocks();
  await Promise.all([emptyFolder(JOURNAL_DIR), emptyFolder(ATT_DIR), deleteRecoveryCopy().catch(() => {}), clearCache()]);
  useStore.getState().replaceAll(initialData());
  flushSaves();
  rescheduleAllReminders().catch(() => {});
}

/**
 * What every replace of all the data (an import, a cloud restore, a kept copy restored) must also do: the Deep Work
 * alerts of the session it ended are cancelled, open locks close, reminders follow the new data, and the cloud hears.
 * Called right after the data is replaced; once any files have been restored too, `sweepUnusedFiles` follows.
 */
export function afterReplace() {
  cancelCountdownEnd();
  Notifications.cancelScheduledNotificationAsync(FINISH_NOTIF_ID).catch(() => {});
  closeAllLocks();
  rescheduleAllReminders().catch(() => {});
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    (require('./cloud') as typeof import('./cloud')).afterLocalReplace();
  } catch {
    // no cloud module loaded
  }
}

/** a file written this long before a replace began may still be on its way into the data (a note being edited) */
const SWEEP_MARGIN_MS = 10 * 60 * 1000;

/**
 * After a replace, deletes the journal texts and attachment files that nothing in the data refers to any more: the
 * replaced journal's words and orphaned videos would otherwise stay on the phone unseen. Files written since the
 * replace began (or shortly before it) are left alone. Nothing is swept while data that could not be opened is
 * still waiting (a kept copy, a failed load this launch): its pages refer to files this data does not.
 */
export async function sweepUnusedFiles(replacedAt: number) {
  if (loadFailedThisLaunch() || savingPaused() || (await readRecoveryCopy()) != null) return;
  const { journal, notes } = useStore.getState();
  const texts = new Set(journal.map((e) => e.id + '.txt'));
  const files = new Set<string>();
  for (const n of notes) for (const a of n.attachments || []) if (a.uri.startsWith(ATT_DIR)) files.add(a.uri.slice(ATT_DIR.length));
  const sweep = async (dir: string, keep: Set<string>) => {
    const names = await FileSystem.readDirectoryAsync(dir).catch(() => [] as string[]);
    for (const name of names) {
      if (keep.has(name)) continue;
      const info: any = await FileSystem.getInfoAsync(dir + name).catch(() => null);
      if (!info?.exists || info.isDirectory) continue;
      // modificationTime is in seconds
      if (!(info.modificationTime * 1000 < replacedAt - SWEEP_MARGIN_MS)) continue;
      await FileSystem.deleteAsync(dir + name, { idempotent: true }).catch(() => {});
    }
  };
  await sweep(JOURNAL_DIR, texts);
  await sweep(ATT_DIR, files);
}
