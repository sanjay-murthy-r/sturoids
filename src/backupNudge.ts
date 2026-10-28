// The one-time "Your data only lives on this phone" card on Today: after a week of use with no account and no backup
// file in two weeks, asked once (Back up / Not now), never again once answered (settings.backupNudgeAt). The decision
// is pure; the time of the last backup file is the one Settings keeps when it exports.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { pkey } from './profiles';

const DAY = 24 * 60 * 60 * 1000;
/** the app has been in use this long before the card shows */
export const NUDGE_AFTER_MS = 7 * DAY;
/** and no backup file has been made in this long */
export const NUDGE_EXPORT_MS = 14 * DAY;

/** When Settings last made a backup file (ms, as text), per profile. Settings writes it on every export. */
export const LAST_EXPORT_KEY = pkey('sturoids-last-export');

export interface NudgeFacts {
  /** settings.firstOpenedAt: undefined until the app has been opened once */
  firstOpenedAt?: number;
  /** settings.backupNudgeAt: when the card was answered, 0 never */
  backupNudgeAt: number;
  /** signed in to an account (the cloud keeps a copy) */
  signedIn: boolean;
  /** when a backup file was last made, or null for never */
  lastExportAt: number | null;
  /** the app holds something the user made (store.hasAnyUserData): an empty app has nothing to lose */
  hasData: boolean;
  now?: number;
}

/** Whether Today shows the card now. */
export function shouldNudgeBackup(f: NudgeFacts): boolean {
  const now = f.now ?? Date.now();
  if (f.backupNudgeAt > 0 || f.signedIn || !f.hasData) return false;
  if (!(typeof f.firstOpenedAt === 'number' && f.firstOpenedAt > 0 && now - f.firstOpenedAt >= NUDGE_AFTER_MS)) return false;
  return !(f.lastExportAt != null && f.lastExportAt > 0 && now - f.lastExportAt < NUDGE_EXPORT_MS);
}

/** When a backup file was last made on this profile, or null for never (or when it cannot be read). */
export async function readLastExport(): Promise<number | null> {
  try {
    const v = Number(await AsyncStorage.getItem(LAST_EXPORT_KEY));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}
