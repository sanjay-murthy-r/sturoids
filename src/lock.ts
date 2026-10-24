import React from 'react';
import { AppState } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { useStore } from './store';
import { PIN_ATTEMPTS_BASE, PIN_BASE, activeProfile, pkey } from './profiles';

// What locks, and what opens it. One app PIN of four digits opens everything that locks: the journal, the Notes tool
// and single locked notes. The journal and Notes can also open with the phone's own screen lock, each only if the
// owner turns that on in Settings; a single locked note always asks for the PIN. There is no lock on the whole app.
// Nothing here encrypts. An unlock opens a session that closes after `settings.lockGraceSec` in the background, or
// when the app is killed. Each locked note has its own session, so opening one never opens another.

/** the journal, the Notes tool, one locked note (`note:<id>`), or every locked note at once (`note:*`) */
export type LockScope = 'journal' | 'notes' | `note:${string}`;

/** The session of one locked note. */
export const noteScope = (id: string): LockScope => `note:${id}`;
/** Opened only by the PIN given at the Notes tool's own lock: that owner has just proved they know it. */
export const ALL_NOTES: LockScope = 'note:*';

export const PIN_LEN = 4;
/** codes from before the PIN became four digits: a 4 to 8 digit journal passcode, or a 6 digit PIN */
export const LEGACY_MIN = 4;
export const LEGACY_MAX = 8;

// each profile has its own PIN and its own count of wrong guesses (profiles.ts); only the first profile can hold a code
// from before the PIN became four digits
const PIN_KEY = pkey(PIN_BASE);
const LEGACY_KEYS = activeProfile === 'main' ? ['sturoids.pin.v1', 'sturoids.journalPass.v1'] : [];
const ATTEMPTS_KEY = pkey(PIN_ATTEMPTS_BASE);
const MAX_TRIES = 5;
/** the wait after each run of five wrong PINs, longer each time until a right one; the last repeats */
const COOLDOWNS_MS = [30_000, 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

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
    away(at = Date.now()) { if (leftAt == null) leftAt = at; },
    back(graceMs: number) {
      if (open && leftAt != null && Date.now() - leftAt >= graceMs) {
        open = false;
        emit();
      }
      leftAt = null;
    },
  };
}

const sessions = new Map<LockScope, ReturnType<typeof session>>();
/** A scope's session, made the first time anything asks about it. */
function sessionOf(scope: LockScope) {
  let s = sessions.get(scope);
  if (!s) {
    s = session();
    sessions.set(scope, s);
  }
  return s;
}
// Trips out of the app that the app itself started: a photo or file picker, a share sheet, a permission dialog, the
// phone's own lock screen. Each backgrounds the app on Android, and none of them is the owner leaving, so they never
// start the grace clock. A trip that runs on far longer than any pick or share counts as leaving after all, timed
// from when the app went.
let expected = 0;
let expectedLeftAt: number | null = null;
const TRIP_CAP_MS = 10 * 60_000;
/** how long the app stays in front after a call settles before its trip is over (a share sheet is still opening) */
const SETTLE_MS = 800;

AppState.addEventListener('change', (next) => {
  const graceMs = useStore.getState().settings.lockGraceSec * 1000;
  if (expected > 0) {
    if (next !== 'active') {
      if (expectedLeftAt == null) expectedLeftAt = Date.now();
    } else if (expectedLeftAt != null) {
      const leftAt = expectedLeftAt;
      expectedLeftAt = null;
      if (Date.now() - leftAt > TRIP_CAP_MS) sessions.forEach((s) => { s.away(leftAt); s.back(graceMs); });
    }
    return;
  }
  if (next === 'active') {
    sessions.forEach((s) => s.back(graceMs));
  } else {
    sessions.forEach((s) => s.away());
  }
});

/** Ends one expected trip once the app is back in front and stays there a moment. */
function releaseWhenBack() {
  const done = () => { expected = Math.max(0, expected - 1); };
  const settle = () => {
    // Android's share sheet settles as soon as it is shown, before the app has gone: wait to see the app stay
    setTimeout(() => { if (AppState.currentState === 'active') done(); else waitForActive(); }, SETTLE_MS);
  };
  // registered after the listener above, so that one still sees the trip when the app comes back
  const waitForActive = () => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      sub.remove();
      settle();
    });
  };
  if (AppState.currentState === 'active') settle();
  else waitForActive();
}

/**
 * Runs a call that takes the app out of view on purpose (a picker, a share sheet, a permission dialog), so that coming
 * back from it never locks what was open. The grace rules hold for every other trip out of the app.
 */
export async function expectAway<T>(fn: () => Promise<T>): Promise<T> {
  expected += 1;
  try {
    return await fn();
  } finally {
    releaseWhenBack();
  }
}

export const markOpen = (scope: LockScope) => sessionOf(scope).mark();
export const isOpen = (scope: LockScope) => sessionOf(scope).isOpen();
export const closeLock = (scope: LockScope) => sessionOf(scope).close();

/** Re-renders when the scope's session opens or closes. */
export function useOpen(scope: LockScope): boolean {
  const s = sessionOf(scope);
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
  try {
    // the phone's own lock screen backgrounds the app; that is not the owner leaving
    const r = await expectAway(() => LocalAuthentication.authenticateAsync({
      promptMessage: reason, cancelLabel: 'Use PIN', disableDeviceFallback: false,
    }));
    return r.success;
  } catch {
    return false;
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

// Wrong guesses, the waits already served and the cooldown live in the keystore too, so closing the app resets none
// of them. Only a right PIN (or a new one) starts the count over.
let failures = 0;
let rounds = 0;
let coolUntil = 0;
let attemptsLoaded: Promise<void> | null = null;
function loadAttempts(): Promise<void> {
  if (!attemptsLoaded) {
    attemptsLoaded = SecureStore.getItemAsync(ATTEMPTS_KEY)
      .then((raw) => {
        if (!raw) return;
        const a = JSON.parse(raw);
        failures = Math.max(failures, Number(a?.failures) || 0);
        rounds = Math.max(rounds, Number(a?.rounds) || 0);
        coolUntil = Math.max(coolUntil, Number(a?.coolUntil) || 0);
      })
      .catch(() => {});
  }
  return attemptsLoaded;
}
function saveAttempts() {
  SecureStore.setItemAsync(ATTEMPTS_KEY, JSON.stringify({ failures, rounds, coolUntil })).catch(() => {});
}
function resetAttempts() {
  failures = 0;
  rounds = 0;
  coolUntil = 0;
  saveAttempts();
}
// read at launch, so a cooldown still running shows as soon as the keypad appears
void loadAttempts();

export const pinCooldownMs = () => Math.max(0, coolUntil - Date.now());

/** Checks a code against the PIN, or, before one exists, against the codes it replaces. */
export async function verifyPin(code: string): Promise<'ok' | 'wrong' | 'cooldown'> {
  return judge(async () => {
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
    return ok;
  });
}

/** Whether another profile on this phone keeps a PIN: its notes or journal may be locked (unreadable counts as yes). */
export async function profileHasPin(id: string): Promise<boolean> {
  return !!(await read(pkey(PIN_BASE, id)));
}

/**
 * Checks a code against another profile's PIN, before that profile is deleted from here. Wrong guesses count toward
 * this phone's own wait, as they do at any keypad, so the PIN cannot be guessed from the profile list.
 */
export async function verifyProfilePin(id: string, code: string): Promise<'ok' | 'wrong' | 'cooldown'> {
  return judge(async () => {
    const stored = await read(pkey(PIN_BASE, id));
    return !!stored && stored !== 'unreadable' && (await digest(code, stored.salt)) === stored.hash;
  });
}

/** Runs one check of a code, counting wrong guesses and serving the waits. */
async function judge(check: () => Promise<boolean>): Promise<'ok' | 'wrong' | 'cooldown'> {
  await loadAttempts();
  if (pinCooldownMs() > 0) return 'cooldown';
  const ok = await check();
  if (ok) {
    resetAttempts();
    return 'ok';
  }
  failures += 1;
  if (failures >= MAX_TRIES) {
    failures = 0;
    // 30 s, a minute, 5, 15, then an hour for every further five: trying all 10,000 PINs would take months
    coolUntil = Date.now() + COOLDOWNS_MS[Math.min(rounds, COOLDOWNS_MS.length - 1)];
    rounds += 1;
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
  resetAttempts();
}

export async function removePin(): Promise<void> {
  await Promise.all([PIN_KEY, ...LEGACY_KEYS].map((k) => SecureStore.deleteItemAsync(k).catch(() => {})));
  resetAttempts();
}
