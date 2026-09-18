import React from 'react';
import { AppState } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { useStore } from './store';

// What locks, and what opens it. One app PIN of four digits opens everything that locks: the journal, the Notes tool
// and single locked notes. The journal and Notes can also open with the phone's own screen lock, each only if the
// owner turns that on in Settings; a single locked note always asks for the PIN. There is no lock on the whole app.
// Nothing here encrypts. An unlock opens a session that closes after `settings.lockGraceSec` in the background, or
// when the app is killed.

/** the journal, the Notes tool, and single locked notes */
export type LockScope = 'journal' | 'notes' | 'note';

export const PIN_LEN = 4;
/** codes from before the PIN became four digits: a 4 to 8 digit journal passcode, or a 6 digit PIN */
export const LEGACY_MIN = 4;
export const LEGACY_MAX = 8;

const PIN_KEY = 'sturoids.pin.v2';
const LEGACY_KEYS = ['sturoids.pin.v1', 'sturoids.journalPass.v1'];
const ATTEMPTS_KEY = 'sturoids.pinAttempts.v2';
const MAX_TRIES = 5;
const COOLDOWN_MS = 30_000;

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

const sessions: Record<LockScope, ReturnType<typeof session>> = {
  journal: session(),
  notes: session(),
  note: session(),
};
let authInFlight = false;

AppState.addEventListener('change', (next) => {
  // the phone's own lock screen backgrounds the app; that is not the owner leaving
  if (authInFlight) return;
  const all = Object.values(sessions);
  if (next === 'active') {
    const graceMs = useStore.getState().settings.lockGraceSec * 1000;
    all.forEach((s) => s.back(graceMs));
  } else {
    all.forEach((s) => s.away());
  }
});

export const markOpen = (scope: LockScope) => sessions[scope].mark();
export const isOpen = (scope: LockScope) => sessions[scope].isOpen();
export const closeLock = (scope: LockScope) => sessions[scope].close();

/** Re-renders when the scope's session opens or closes. */
export function useOpen(scope: LockScope): boolean {
  const s = sessions[scope];
  const [, bump] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => s.subscribe(bump), [s]);
  return s.isOpen();
}

// ---------- the phone's own lock ----------

export async function deviceAuthAvailable(): Promise<boolean> {
  try {
    return (await LocalAuthentication.getEnrolledLevelAsync()) !== LocalAuthentication.SecurityLevel.NONE;
  } catch {
    return false;
  }
}

/** The phone's fingerprint, face or screen lock, for a tool whose owner allowed it. True when it opened. */
export async function unlockWithScreenLock(reason: string): Promise<boolean> {
  if (!(await deviceAuthAvailable())) return false;
  authInFlight = true;
  try {
    const r = await LocalAuthentication.authenticateAsync({
      promptMessage: reason, cancelLabel: 'Use PIN', disableDeviceFallback: false,
    });
    return r.success;
  } catch {
    return false;
  } finally {
    authInFlight = false;
  }
}

// ---------- the app PIN ----------

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const digest = (code: string, salt: string) =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, salt + ':' + code);

type Stored = { salt: string; hash: string };
/** A stored code, null when there is none, 'unreadable' when the keystore could not be read. */
async function read(key: string): Promise<Stored | null | 'unreadable'> {
  try {
    const raw = await SecureStore.getItemAsync(key);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return v && typeof v.salt === 'string' && typeof v.hash === 'string' ? v : 'unreadable';
  } catch {
    return 'unreadable';
  }
}

/**
 * 'set': a four digit PIN exists (an unreadable keystore counts as set, so a read failure never opens a lock).
 * 'legacy': only a code from before four digits exists; it is asked for once, then a new PIN is chosen.
 * 'none': nothing to check against.
 */
export async function pinStatus(): Promise<'set' | 'legacy' | 'none'> {
  if (await read(PIN_KEY)) return 'set';
  for (const k of LEGACY_KEYS) if (await read(k)) return 'legacy';
  return 'none';
}

// Wrong guesses and the cooldown live in the keystore too, so closing the app does not reset them.
let failures = 0;
let coolUntil = 0;
let attemptsLoaded: Promise<void> | null = null;
function loadAttempts(): Promise<void> {
  if (!attemptsLoaded) {
    attemptsLoaded = SecureStore.getItemAsync(ATTEMPTS_KEY)
      .then((raw) => {
        if (!raw) return;
        const a = JSON.parse(raw);
        failures = Math.max(failures, Number(a?.failures) || 0);
        coolUntil = Math.max(coolUntil, Number(a?.coolUntil) || 0);
      })
      .catch(() => {});
  }
  return attemptsLoaded;
}
function saveAttempts() {
  SecureStore.setItemAsync(ATTEMPTS_KEY, JSON.stringify({ failures, coolUntil })).catch(() => {});
}
// read at launch, so a cooldown still running shows as soon as the keypad appears
void loadAttempts();

export const pinCooldownMs = () => Math.max(0, coolUntil - Date.now());

/** Checks a code against the PIN, or, before one exists, against the codes it replaces. */
export async function verifyPin(code: string): Promise<'ok' | 'wrong' | 'cooldown'> {
  await loadAttempts();
  if (pinCooldownMs() > 0) return 'cooldown';
  let ok = false;
  const current = await read(PIN_KEY);
  if (current && current !== 'unreadable') {
    ok = (await digest(code, current.salt)) === current.hash;
  } else if (!current) {
    for (const k of LEGACY_KEYS) {
      const old = await read(k);
      if (old && old !== 'unreadable' && (await digest(code, old.salt)) === old.hash) {
        ok = true;
        break;
      }
    }
  }
  if (ok) {
    failures = 0;
    coolUntil = 0;
    saveAttempts();
    return 'ok';
  }
  failures += 1;
  if (failures >= MAX_TRIES) {
    failures = 0;
    coolUntil = Date.now() + COOLDOWN_MS;
    saveAttempts();
    return 'cooldown';
  }
  saveAttempts();
  return 'wrong';
}

/** Stores a salted SHA-256 of the PIN in the keystore (never the PIN itself) and retires any older code. */
export async function setPin(code: string): Promise<void> {
  const salt = toHex(Crypto.getRandomBytes(16));
  await SecureStore.setItemAsync(PIN_KEY, JSON.stringify({ salt, hash: await digest(code, salt) }));
  await Promise.all(LEGACY_KEYS.map((k) => SecureStore.deleteItemAsync(k).catch(() => {})));
  failures = 0;
  coolUntil = 0;
  saveAttempts();
}

export async function removePin(): Promise<void> {
  await Promise.all([PIN_KEY, ...LEGACY_KEYS].map((k) => SecureStore.deleteItemAsync(k).catch(() => {})));
  failures = 0;
  coolUntil = 0;
  saveAttempts();
}
