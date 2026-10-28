// The saved rows the phone widgets are drawn from, read straight from storage for the widget task handler, which can
// run with the app closed. Never through the store (src/store.ts): loading it would start a load and saves of its own
// in a process that only wants to draw a picture, and a save from there could write over the app's next one. Reads
// only, never a write to the app's rows (the Calculator widget keeps its sum under a key of its own).

import AsyncStorage from '@react-native-async-storage/async-storage';
import { isProfileId, pkey, ProfileId } from '../../profiles';
import { PHONE_ROWS, PhoneData, PhoneRow, cleanData } from './model';
import { CalcPad, EMPTY_PAD, cleanPad } from './calc';

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

/** The active profile's rows, as the widgets read them (only `only`, when given: the rest read as empty). Anything unreadable reads as empty. */
export async function readPhoneData(only?: readonly PhoneRow[]): Promise<PhoneData> {
  const id = await activeProfileId();
  const base = pkey(STORE_BASE, id);
  const rows: Partial<Record<PhoneRow, unknown>> = {};
  // a settings row that is there but cannot be read: the locks are taken as on, as the app itself does, so a locked
  // journal or notes never shows on the home screen because of a bad read
  let settingsUnread = false;
  try {
    const keys = only || PHONE_ROWS;
    const pairs = await AsyncStorage.multiGet([base + ':meta', ...keys.map((k) => base + ':' + k)]);
    const meta = parse(pairs[0]?.[1]);
    if (meta) {
      keys.forEach((k, i) => {
        const raw = pairs[i + 1]?.[1];
        rows[k] = parse(raw);
        if (k === 'settings' && raw != null && (rows[k] == null || typeof rows[k] !== 'object')) settingsUnread = true;
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
        const raw = await AsyncStorage.getItem(base + ':' + k);
        rows[k] = parse(raw);
        if (k === 'settings' && raw != null && (rows[k] == null || typeof rows[k] !== 'object')) settingsUnread = true;
      } catch {
        rows[k] = undefined;
        if (k === 'settings') settingsUnread = true;
      }
    }
  }
  const data = cleanData(rows);
  if (settingsUnread) {
    data.settings.journalLocked = true;
    data.settings.notesLocked = true;
  }
  return data;
}

/* ---------------------------------------------------------------- the Calculator widget's own sum */

const padKey = (widgetId: number) => 'sturoids.calcWidget.' + widgetId;

/** The sum one Calculator widget holds (each widget on the home screen keeps its own). */
export async function readPad(widgetId: number): Promise<CalcPad> {
  try {
    return cleanPad(parse(await AsyncStorage.getItem(padKey(widgetId))));
  } catch {
    return EMPTY_PAD;
  }
}

/**
 * Keeps a Calculator widget's sum. The one write the widgets make, to a key of their own that the app never reads, so
 * it can never race the app's saves.
 */
export async function writePad(widgetId: number, pad: CalcPad | null): Promise<void> {
  try {
    if (pad && pad.expr) await AsyncStorage.setItem(padKey(widgetId), JSON.stringify(pad));
    else await AsyncStorage.removeItem(padKey(widgetId));
  } catch {
    // the sum is lost with the next draw: nothing else depends on it
  }
}
