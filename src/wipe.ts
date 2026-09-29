import * as FileSystem from 'expo-file-system';
import { useStore, initialData, flushSaves, deleteRecoveryCopy } from './store';
import { JOURNAL_DIR } from './journal';
import { ATT_DIR } from './attachments';
import { removePin, closeLock, ALL_NOTES } from './lock';
import { cancelCountdownEnd, rescheduleAllReminders } from './notifications';

/** Deletes the files inside a folder, keeping the folder: the modules that write there made it once and expect it. */
async function emptyFolder(dir: string) {
  const names = await FileSystem.readDirectoryAsync(dir).catch(() => [] as string[]);
  await Promise.all(names.map((n) => FileSystem.deleteAsync(dir + n, { idempotent: true }).catch(() => {})));
}

/**
 * Erases everything this app keeps on this phone: every tool's data and settings, the journal's texts, note
 * attachments, the PIN, reminders, a kept copy of unreadable data. The cloud account is signed out first, so nothing
 * empty is ever sent over the copy in the cloud.
 */
export async function eraseThisPhone() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cloud = require('./cloud') as typeof import('./cloud');
    if (cloud.useCloud.getState().status !== 'signed-out') await cloud.signOut();
  } catch {
    // no cloud module loaded, or already signed out
  }
  cancelCountdownEnd();
  await removePin();
  closeLock('journal');
  closeLock('notes');
  closeLock(ALL_NOTES);
  await Promise.all([emptyFolder(JOURNAL_DIR), emptyFolder(ATT_DIR), deleteRecoveryCopy().catch(() => {})]);
  useStore.getState().replaceAll(initialData());
  flushSaves();
  rescheduleAllReminders().catch(() => {});
}
