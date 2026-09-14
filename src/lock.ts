import React from 'react';
import { AppState } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { useStore } from './store';

// One lock for everything that can be locked (the Journal, locked notes). It hides content behind the device's
// own lock (fingerprint, face, screen lock) or an app PIN; it does not encrypt. One unlock opens a session that
// closes after `settings.lockGraceSec` in the background, or when the app is killed.

const PIN_KEY = 'sturoids.pin.v1';
const MAX_TRIES = 5;
const COOLDOWN_MS = 30_000;

// ---------- session ----------

let unlocked = false;
let leftAt: number | null = null;
let authInFlight = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

AppState.addEventListener('change', (next) => {
  // the device's credential screen backgrounds the app; that is not the user leaving
  if (authInFlight) return;
  if (next === 'active') {
    if (unlocked && leftAt != null) {
      const graceMs = useStore.getState().settings.lockGraceSec * 1000;
      if (Date.now() - leftAt >= graceMs) {
        unlocked = false;
        emit();
      }
    }
    leftAt = null;
  } else if (leftAt == null) {
    leftAt = Date.now();
  }
});

export function markUnlocked() {
  unlocked = true;
  leftAt = null;
  emit();
}

export function lockNow() {
  if (!unlocked) return;
  unlocked = false;
  emit();
}

export const isUnlocked = () => unlocked;

/** Re-renders when the session opens or closes. */
export function useUnlocked(): boolean {
  const [, bump] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => {
    listeners.add(bump);
    return () => {
      listeners.delete(bump);
    };
  }, []);
  return unlocked;
}

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

/** A lock can be turned on only when something can check it: the device's own lock or an app PIN. */
export async function lockProtectionAvailable(): Promise<boolean> {
  return (await deviceAuthAvailable()) || (await hasPin());
}

// ---------- app PIN ----------

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const digest = (pin: string, salt: string) =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, salt + ':' + pin);

export async function hasPin(): Promise<boolean> {
  try {
    return !!(await SecureStore.getItemAsync(PIN_KEY));
  } catch {
    return false;
  }
}

/** Stores a salted SHA-256 of the PIN in the device keystore; the PIN itself is never stored. */
export async function setPin(pin: string): Promise<void> {
  const salt = toHex(Crypto.getRandomBytes(16));
  await SecureStore.setItemAsync(PIN_KEY, JSON.stringify({ salt, hash: await digest(pin, salt) }));
}

export async function removePin(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(PIN_KEY);
  } catch {
    // nothing stored
  }
}

let failures = 0;
let coolUntil = 0;

export const pinCooldownMs = () => Math.max(0, coolUntil - Date.now());

export async function verifyPin(pin: string): Promise<'ok' | 'wrong' | 'cooldown'> {
  if (pinCooldownMs() > 0) return 'cooldown';
  try {
    const raw = await SecureStore.getItemAsync(PIN_KEY);
    if (raw) {
      const { salt, hash } = JSON.parse(raw);
      if ((await digest(pin, salt)) === hash) {
        failures = 0;
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
    return 'cooldown';
  }
  return 'wrong';
}
