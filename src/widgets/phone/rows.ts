// The saved rows the phone widgets are drawn from, read straight from storage for the widget task handler, which can
// run with the app closed. Never through the store (src/store.ts): loading it would start a load and saves of its own
// in a process that only wants to draw a picture, and a save from there could write over the app's next one. Reads
// only, never a write.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { isProfileId, pkey, ProfileId } from '../../profiles';
import { PHONE_ROWS, PhoneData, PhoneRow, cleanData } from './model';

/** which profile is in use (profiles.ts ACTIVE_KEY), read fresh each time: a switch restarts the app, not the widgets */
const ACTIVE_KEY = 'sturoids.profile.active';
/** the store's base key (store.ts STORE_KEY) and the single row of the first profile before 1.7 (LEGACY_KEY) */
const STORE_BASE = 'student-hub-v2';
const LEGACY_BASE = 'student-hub-v1';

/** The profile in use, from the keystore; the first profile when it cannot be read. */
export async function activeProfileId(): Promise<ProfileId> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const SecureStore = require('expo-secure-store') as typeof import('expo-secure-store');
    const v = await SecureStore.getItemAsync(ACTIVE_KEY);
    return isProfileId(v) ? v : 'main';
  } catch {
    return 'main';
  }
}

function parse(text: string | null | undefined): unknown {
  if (text == null) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The active profile's rows, as the widgets read them. Anything unreadable reads as empty. */
export async function readPhoneData(): Promise<PhoneData> {
  const id = await activeProfileId();
  const base = pkey(STORE_BASE, id);
  const rows: Partial<Record<PhoneRow, unknown>> = {};
  try {
    const pairs = await AsyncStorage.multiGet([base + ':meta', ...PHONE_ROWS.map((k) => base + ':' + k)]);
    const meta = parse(pairs[0]?.[1]);
    if (meta) {
      PHONE_ROWS.forEach((k, i) => {
        rows[k] = parse(pairs[i + 1]?.[1]);
      });
    } else {
      // before 1.7 everything sat in one row, under zustand's { state, version }
      const legacy = parse(await AsyncStorage.getItem(pkey(LEGACY_BASE, id))) as any;
      const state = legacy && typeof legacy === 'object' ? legacy.state : null;
      if (state && typeof state === 'object') for (const k of PHONE_ROWS) rows[k] = state[k];
    }
  } catch {
    // one row too large to read fails the whole read: each is read on its own, so the others still draw
    for (const k of PHONE_ROWS) {
      try {
        rows[k] = parse(await AsyncStorage.getItem(base + ':' + k));
      } catch {
        rows[k] = undefined;
      }
    }
  }
  return cleanData(rows);
}
