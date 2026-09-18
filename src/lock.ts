import React from 'react';
import { AppState } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { useStore } from './store';

// What guards what: a locked note hides behind the device's own lock (fingerprint, face, screen lock) with an app
// PIN as the fallback; the Journal has its own passcode and never opens with the phone's lock. Neither encrypts.
// An unlock opens a session that closes after `settings.lockGraceSec` in the background, or when the app is killed.

const PIN_KEY = 'sturoids.pin.v1';
const PIN_ATTEMPTS_KEY = 'sturoids.pinAttempts.v1';
const JOURNAL_KEY = 'sturoids.journalPass.v1';
const JOURNAL_ATTEMPTS_KEY = 'sturoids.journalAttempts.v1';
const MAX_TRIES = 5;
const COOLDOWN_MS = 30_000;

/** A journal passcode is four to eight digits. */
export const PASS_MIN = 4;
export const PASS_MAX = 8;

// ---------- sessions ----------

/** One open lock and the views following it. */
function session() {
  let open = false;
  let leftAt: number | null = null;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  return {
    isOpen: () => open,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    mark() { open = true; leftAt = null; emit(); },
    close() {
      if (!open) return;
      open = false;
      emit();
    },
    away() { if (leftAt == null) leftAt = Date.now(); },
    back(graceMs: number) {
      if (open && leftAt != null && Date.now() - leftAt >= graceMs) {
        open = false;
        emit();
      }
      leftAt = null;
    },
  };
}

const app = session();
const journal = session();
let authInFlight = false;

AppState.addEventListener('change', (next) => {
  // the device's credential screen backgrounds the app; that is not the user leaving
  if (authInFlight) return;
  if (next === 'active') {
    const graceMs = useStore.getState().settings.lockGraceSec * 1000;
    app.back(graceMs);
    journal.back(graceMs);
  } else {
    app.away();
    journal.away();
  }
});

function useSession(s: ReturnType<typeof session>): boolean {
  const [, bump] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => s.subscribe(bump), [s]);
  return s.isOpen();
}

export const markUnlocked = () => app.mark();
export const lockNow = () => app.close();
export const isUnlocked = () => app.isOpen();
/** Re-renders when the session opens or closes. */
export const useUnlocked = () => useSession(app);

export const markJournalUnlocked = () => journal.mark();
export const lockJournalNow = () => journal.close();
export const isJournalUnlocked = () => journal.isOpen();
export const useJournalUnlocked = () => useSession(journal);

// ---------- device ----------

export async function deviceAuthAvailable(): Promise<boolean> {
  try {
    return (await LocalAuthentication.getEnrolledLevelAsync()) !== LocalAuthentication.SecurityLevel.NONE;
  } catch {
    return false;
  }
}

export type UnlockResult = 'unlocked' | 'needs-pin' | 'cancelled';

/**
 * Tries the device's own lock first. When the device has none, the caller asks for the app PIN. With neither,
 * there is nothing to check against, so the content opens (Settings asks for a PIN before a lock is turned on).
 */
export async function unlockWithDevice(reason = 'Unlock Sturoids'): Promise<UnlockResult> {
  if (await deviceAuthAvailable()) {
    authInFlight = true;
    try {
      const r = await LocalAuthentication.authenticateAsync({
        promptMessage: reason, cancelLabel: 'Cancel', disableDeviceFallback: false,
      });
      if (r.success) {
        markUnlocked();
        return 'unlocked';
      }
      const error = String((r as { error?: string }).error || '');
      if (error !== 'not_enrolled' && error !== 'passcode_not_set' && error !== 'not_available') return 'cancelled';
    } finally {
      authInFlight = false;
    }
  }
  if (await hasPin()) return 'needs-pin';
  markUnlocked();
  return 'unlocked';
}

/** A note lock can be turned on only when something can check it: the device's own lock or an app PIN. */
export async function lockProtectionAvailable(): Promise<boolean> {
  return (await deviceAuthAvailable()) || (await hasPin());
}

// ---------- stored codes ----------

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const digest = (code: string, salt: string) =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, salt + ':' + code);

/**
 * A code kept as a salted SHA-256 in the device keystore, never as itself, with its own wrong-guess count and
 * cooldown kept there too, so closing the app does not reset them.
 */
function stored(key: string, attemptsKey: string) {
  let failures = 0;
  let coolUntil = 0;
  let loaded: Promise<void> | null = null;

  const load = () => {
    if (!loaded) {
      loaded = SecureStore.getItemAsync(attemptsKey)
        .then((raw) => {
          if (!raw) return;
          const a = JSON.parse(raw);
          failures = Math.max(failures, Number(a?.failures) || 0);
          coolUntil = Math.max(coolUntil, Number(a?.coolUntil) || 0);
        })
        .catch(() => {});
    }
    return loaded;
  };
  const save = () => { SecureStore.setItemAsync(attemptsKey, JSON.stringify({ failures, coolUntil })).catch(() => {}); };
  // read at launch, so a cooldown still running shows as soon as the keypad opens
  void load();

  /** 'unreadable' when the keystore could not be read. It counts as set, so a read failure never opens a lock. */
  const state = async (): Promise<'set' | 'none' | 'unreadable'> => {
    try {
      return (await SecureStore.getItemAsync(key)) ? 'set' : 'none';
    } catch {
      return 'unreadable';
    }
  };
  const cooldownMs = () => Math.max(0, coolUntil - Date.now());

  return {
    state,
    cooldownMs,
    has: async () => (await state()) !== 'none',
    set: async (code: string) => {
      const salt = toHex(Crypto.getRandomBytes(16));
      await SecureStore.setItemAsync(key, JSON.stringify({ salt, hash: await digest(code, salt) }));
      failures = 0;
      coolUntil = 0;
      save();
    },
    remove: async () => {
      try {
        await SecureStore.deleteItemAsync(key);
      } catch {
        // nothing stored
      }
      failures = 0;
      coolUntil = 0;
      save();
    },
    verify: async (code: string): Promise<'ok' | 'wrong' | 'cooldown'> => {
      await load();
      if (cooldownMs() > 0) return 'cooldown';
      try {
        const raw = await SecureStore.getItemAsync(key);
        if (raw) {
          const { salt, hash } = JSON.parse(raw);
          if ((await digest(code, salt)) === hash) {
            failures = 0;
            coolUntil = 0;
            save();
            return 'ok';
          }
        }
      } catch {
        // unreadable keystore entry counts as a miss
      }
      failures += 1;
      if (failures >= MAX_TRIES) {
        failures = 0;
        coolUntil = Date.now() + COOLDOWN_MS;
        save();
        return 'cooldown';
      }
      save();
      return 'wrong';
    },
  };
}

const pin = stored(PIN_KEY, PIN_ATTEMPTS_KEY);
const journalPass = stored(JOURNAL_KEY, JOURNAL_ATTEMPTS_KEY);

export const pinState = pin.state;
export const hasPin = pin.has;
export const setPin = pin.set;
export const removePin = pin.remove;
export const pinCooldownMs = pin.cooldownMs;
export const verifyPin = pin.verify;

export const hasJournalPass = journalPass.has;
export const setJournalPass = journalPass.set;
export const removeJournalPass = journalPass.remove;
export const journalPassCooldownMs = journalPass.cooldownMs;
export const verifyJournalPass = journalPass.verify;
