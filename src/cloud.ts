// Cloud sync with Supabase. Everything the app keeps (the store, the journal's texts) goes up as one snapshot in the
// user's own row of `public.backups`; the files attached to notes go up one by one into the private `backups` bucket
// under <user id>/att/<attachment id>, each only once, and ones no note uses any more are cleared. The phone stays the
// place the data lives: the cloud holds its latest copy, kept current a little after each change and whenever the app
// goes to the background, and brings it to another phone.
//
// Two phones on one account never overwrite each other silently: a phone remembers the copy it last saw. When the cloud
// holds a newer one written on another phone and this phone has changed nothing since, it follows quietly (keeping a
// copy of its own data for an Undo); when both changed, it stops and asks which to keep. See supabase/setup.sql.

import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, InteractionManager, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import Constants from 'expo-constants';
import { create } from 'zustand';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import {
  useStore, exportSnapshot, readSnapshot, applySnapshot, flushSaves, hasAnyUserData, localDataState, isDeviceOnlyChange,
  withoutDeviceSettings, Attachment, RECOVERY_KEY, trashedAttachments, savePending, SAVE_PAUSE_MS,
} from './store';
import { journalForBackup, restoreBodies } from './journal';
import { restoredPath } from './backup';
import { ATT_DIR } from './attachments';
import { toast } from './components/Toast';
import { uid } from './utils';
import { accountTakenBy, noteActiveEmail, pkey, sessionKey, takenMessage } from './profiles';

// A copy of this phone's data is kept while it follows the cloud quietly, so the toast's Undo can bring it back. It
// sits in the store's recovery row (Settings can share or restore it like a kept copy, and no file is cleared as
// unused while it is there), marked as this module's own so it is never taken for data that could not be opened.
const SAFETY_PREFIX = '{"_safety":';
/** how long the Undo of a quiet follow stands: the toast with its action, ten seconds with a screen reader, and a margin */
const FOLLOW_UNDO_MS = 20 * 1000;

export const SUPABASE_URL = 'https://imvydxgapirnkuvayimn.supabase.co';
/** the project's publishable key: safe in the app, since every row and file is guarded by the user's own id */
export const SUPABASE_KEY = 'sb_publishable_uWD9djNFLKH9uQ0uBeqP5g_rbk8cYJO';

const BUCKET = 'backups';
/** this phone's record of the cloud: each profile keeps its own, as it keeps its own account (profiles.ts) */
const META_KEY = pkey('sturoids-cloud');
/**
 * where a profile other than the first keeps its session; the first keeps Supabase's default key, so a session saved
 * before profiles existed still opens
 */
const SESSION_KEY = sessionKey();
/** each account's share of the free plan's 1 GB of files */
export const QUOTA_BYTES = 120 * 1024 * 1024;
/** the bucket takes files up to 20 MB (setup.sql) */
export const FILE_LIMIT = 20 * 1024 * 1024;
/** a backup follows a change after this long without another one */
const AFTER_CHANGE_MS = 45 * 1000;
/** a failed backup with changes waiting tries again after these waits, while the app is in front */
const RETRY_MS = [60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000];
/**
 * A phone holding nothing the user made never sends over a cloud copy larger than its own by more than this without
 * asking: that is an empty phone about to empty the cloud.
 */
const EMPTY_MARGIN = 4 * 1024;

export type CloudStatus = 'signed-out' | 'idle' | 'syncing' | 'error' | 'choice';

/**
 * Why a choice waits: 'newer', the cloud holds a copy this phone has not seen; 'empty', this phone holds nothing of
 * the user's and would empty the cloud copy; 'rescue', this phone could not open its data and the cloud copy can bring
 * it back.
 */
export type ChoiceReason = 'newer' | 'empty' | 'rescue';

/** A copy in the cloud the phone did not write or has not seen: the user picks which to keep. */
export interface RemoteCopy {
  updatedAt: string; device: string | null; bytes: number; files: number;
  /** the install that wrote it */
  deviceId?: string | null;
}

interface Meta {
  /** this install, so the cloud can tell which phone wrote a copy */
  deviceId: string;
  /**
   * the account last signed in on this phone. Kept through a sign-out with the record below, so signing back in to
   * the same account raises no false choice; another account starts its own record
   */
  userId: string | null;
  /** the signed-in account's email, shown while the app looks at the cloud after a launch */
  email?: string | null;
  auto: boolean;
  /** when this phone last finished a backup or brought a copy down */
  lastSyncedAt: number | null;
  /** the cloud copy's updated_at as this phone last wrote or read it */
  lastRemoteAt: string | null;
  /** what the last backup held, so an unchanged app never uploads again */
  lastHash: string | null;
  /**
   * something changed since the last backup, noted whether or not anyone is signed in, so a launch needs no compare.
   * Absent on a phone that synced before it was kept: then a launch compares once
   */
  dirty?: boolean;
  /** this phone could not open its data and the cloud holds a copy: nothing goes up until the user chooses */
  rescue?: boolean;
  /** the session ended without the user signing out here (revoked elsewhere): said until the next sign-in */
  lost?: boolean;
  /** attachments the last backup left for Wi-Fi: the next backup on Wi-Fi sends them, even with no data changed */
  filesWaiting?: boolean;
  /** a newer cloud copy this phone followed and the user undid: it is asked about, never followed again */
  declinedAt?: string | null;
}

/**
 * A time as the cloud writes it ("2026-10-09T15:56:08.222123+00:00"), in ms. Read by hand: microseconds and an offset
 * written with a colon are not something every engine's Date.parse takes. NaN when it is not such a time.
 */
export function isoTime(text: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}(?::?\d{2})?)?$/i.exec(String(text || '').trim());
  if (!m) return NaN;
  const ms = m[7] ? Number((m[7] + '00').slice(0, 3)) : 0;
  let t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], ms);
  const zone = m[8];
  if (zone && zone.toUpperCase() !== 'Z') {
    const sign = zone[0] === '-' ? -1 : 1;
    const digits = zone.slice(1).replace(':', '');
    t -= sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4) || 0)) * 60000;
  }
  return t;
}

/** What to do about a copy in the cloud this phone has not seen: bring it here quietly, or ask which to keep. */
export type NewerCopyAction = 'follow' | 'ask';

export interface NewerCopyFacts {
  /** the cloud copy's updated_at, and the install that wrote it */
  remoteAt: string;
  remoteDeviceId: string | null | undefined;
  /** the cloud copy this phone last wrote or read, and this install */
  lastRemoteAt: string | null;
  deviceId: string;
  /** the fingerprint of this phone's data now (null when not worked out), and of what it last sent or brought down */
  localHash: string | null;
  lastHash: string | null;
  /** a change here still waiting for its pause before it is saved */
  savePending: boolean;
  /** a copy this phone followed and the user undid */
  declinedAt?: string | null;
}

/**
 * Whether a copy in the cloud this phone has not seen can simply come here. Only when it is plainly newer than the copy
 * this phone last saw and was written by another install, while this phone has changed nothing since its last backup
 * (its data has the same fingerprint, and no save waits) and the user has not undone following this very copy: then
 * nothing of this phone's would be lost. Anything else (both changed, a first sign-in, a copy of unknown origin) is the
 * user's choice. Pure, so it is tested on its own.
 */
export function newerCopyAction(f: NewerCopyFacts): NewerCopyAction {
  if (!f.lastRemoteAt || !f.lastHash || !f.deviceId) return 'ask';
  const seen = isoTime(f.lastRemoteAt);
  const now = isoTime(f.remoteAt);
  if (!Number.isFinite(seen) || !Number.isFinite(now) || !(now > seen)) return 'ask';
  if (!f.remoteDeviceId || f.remoteDeviceId === f.deviceId) return 'ask';
  if (f.declinedAt && f.declinedAt === f.remoteAt) return 'ask';
  if (f.savePending || f.localHash == null || f.localHash !== f.lastHash) return 'ask';
  return 'follow';
}

export interface CloudState {
  ready: boolean;
  status: CloudStatus;
  email: string | null;
  auto: boolean;
  lastSyncedAt: number | null;
  /** what went wrong last, in words for the screen */
  error: string | null;
  /** 0 to 1 while files move, else null */
  progress: number | null;
  /** what the last run did, in words: "3 attachments did not fit" */
  note: string | null;
  usedBytes: number | null;
  remote: RemoteCopy | null;
  /** why the choice waits, while status is 'choice' */
  reason: ChoiceReason | null;
  /** whether the last look found a copy in the cloud (null before the first look) */
  hasCopy: boolean | null;
  /** there are changes the cloud has not got yet */
  pending: boolean;
  /** signed out without asking to be (the session was ended elsewhere) */
  lost: boolean;
}

export const useCloud = create<CloudState>(() => ({
  ready: false, status: 'signed-out', email: null, auto: true, lastSyncedAt: null, error: null, progress: null,
  note: null, usedBytes: null, remote: null, reason: null, hasCopy: null, pending: false, lost: false,
}));

// the profiles' registry learns which account this profile is signed in to, once the cloud has looked, so another
// profile on the phone can refuse the same account
useCloud.subscribe((s, prev) => {
  if (s.ready && (!prev.ready || s.email !== prev.email)) noteActiveEmail(s.status === 'signed-out' ? null : s.email);
});

let meta: Meta = { deviceId: '', userId: null, auto: true, lastSyncedAt: null, lastRemoteAt: null, lastHash: null };
let client: SupabaseClient | null = null;
let started = false;
let running: Promise<void> | null = null;
let changeTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retries = 0;
/** whether a signed-in account is being kept current (the change timer, leaving the app) */
let watching = false;
/** counts data changes, so a backup knows whether anything changed while it was being sent */
let changes = 0;
let changesWatched = false;
let authWatched = false;
/** set by a sign-out the user asked for, so the session ending is not taken for one ended elsewhere */
let intentional = false;
/** the user chose this phone's data over the cloud copy this launch, even though this phone could not open its own */
let keptThisLaunch = false;

async function saveMeta() {
  try { await AsyncStorage.setItem(META_KEY, JSON.stringify(meta)); } catch { /* the next run writes it again */ }
}

let metaLoaded: Promise<void> | null = null;
/** Reads the saved record once; later calls wait for that read. */
function loadMeta(): Promise<void> {
  if (!metaLoaded) {
    metaLoaded = AsyncStorage.getItem(META_KEY)
      .then((raw) => { if (raw) meta = { ...meta, ...JSON.parse(raw) }; })
      .catch(() => { /* a fresh meta is fine */ });
  }
  return metaLoaded;
}

/**
 * Forgets what this phone last synced, for any account (its data is about to be erased): the next sign-in finds the
 * cloud copy unseen and asks, instead of taking the erased phone's changes for news.
 */
export async function forgetSyncRecord() {
  await loadMeta();
  meta = {
    ...meta, userId: null, email: null, lastRemoteAt: null, lastSyncedAt: null, lastHash: null, rescue: false, dirty: true,
    filesWaiting: false, declinedAt: null,
  };
  await saveMeta();
}

function patch(p: Partial<CloudState>) { useCloud.setState(p); }

/** The client, made the first time the cloud is used, never at launch. */
export function cloud(): SupabaseClient {
  if (client) return client;
  // required here so the library stays off the startup path
  const { createClient } = require('@supabase/supabase-js') as typeof import('@supabase/supabase-js');
  client = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false,
      ...(SESSION_KEY ? { storageKey: SESSION_KEY } : {}),
    },
  });
  return client;
}

const deviceName = () => (Constants.deviceName || (Platform.OS === 'android' ? 'Android phone' : 'Phone')).slice(0, 60);
const appVersion = () => Constants.expoConfig?.version || '';

/** A short fingerprint of a text (FNV-1a, two lanes), enough to tell whether anything changed. */
function fingerprint(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
  }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36) + text.length.toString(36);
}

/**
 * The snapshot as it goes up: the store with the journal's texts inline, like a backup file, without this phone's own
 * settings (see DEVICE_SETTINGS), which say nothing about the data and change on every visit.
 */
async function buildSnapshot(): Promise<{ json: string; hash: string; attachments: Attachment[]; hasUserData: boolean }> {
  const { _exportedAt, ...snap } = exportSnapshot();
  const data = { ...snap, settings: withoutDeviceSettings(snap.settings), journal: await journalForBackup(snap.journal) };
  // stringified once: the fingerprint is taken before the export time goes in, since that changes every run
  const body = JSON.stringify(data);
  const json = '{"_exportedAt":' + JSON.stringify(_exportedAt) + ',' + body.slice(1);
  return { json, hash: fingerprint(body), attachments: attachmentsOf(snap), hasUserData: hasAnyUserData(snap) };
}

/** Every attachment the data keeps, once: the notes', and those of notes and files in Recently deleted. */
function attachmentsOf(snap: { notes: { attachments?: Attachment[] }[]; trash: Parameters<typeof trashedAttachments>[0] }): Attachment[] {
  const seen = new Set<string>();
  const out: Attachment[] = [];
  for (const a of [...snap.notes.flatMap((n) => n.attachments || []), ...trashedAttachments(snap.trash || [])]) {
    if (!a || typeof a.id !== 'string' || seen.has(a.id)) continue;
    seen.add(a.id);
    out.push(a);
  }
  return out;
}

/** Words for an error from the cloud, for the screen. Raw server text never reaches it. */
export function describe(e: unknown): string {
  const msg = String((e as any)?.message || e || '');
  const code = String((e as any)?.code || (e as any)?.error_code || '');
  const status = Number((e as any)?.status ?? (e as any)?.statusCode) || 0;
  if (/Network request failed|fetch failed|network|timed out|timeout/i.test(msg)) return 'No connection. It will try again when you are online.';
  if (/Invalid login credentials|invalid_credentials/i.test(msg + code)) return 'That email and password do not match.';
  if (/Email not confirmed|email_not_confirmed/i.test(msg + code)) return 'Confirm your email first: open the link we sent, then sign in.';
  if (/User already registered|already been registered|user_already_exists/i.test(msg + code)) return 'An account with that email exists. Sign in instead.';
  if (/Database error saving new user|accounts are full/i.test(msg)) return 'Sign-ups are full: this app keeps to eight accounts.';
  if (/Password should be at least|weak_password/i.test(msg + code)) return 'Use a password of at least 6 characters.';
  if (/should be different|same_password/i.test(msg + code)) return 'The new password must differ from the one you use now.';
  if (/reauthentication|reauthentication_needed/i.test(msg + code)) return 'Sign out and in again, then change the password.';
  if (/rate limit|over_email_send_rate_limit|too many/i.test(msg + code)) return 'Too many tries just now. Wait a minute and try again.';
  if (/valid email|email_address_invalid|invalid email/i.test(msg + code)) return 'That does not look like an email address.';
  if ((e as any)?.shown && msg) return msg;
  if (/JWT|session|not authenticated|401/i.test(msg) || status === 401) return 'You were signed out. Sign in again to keep backing up.';
  if (status === 413 || /too large|maximum allowed size|payload/i.test(msg)) return 'Too large for the cloud: attachments go up to 20 MB each, 120 MB in all.';
  if (status === 403 || code === '42501' || /row-level security|row level security|permission denied|unauthorized/i.test(msg)) {
    return 'The cloud turned this down. Sign out and in again, then try once more.';
  }
  if (status >= 500) return 'The cloud is not answering just now. It will try again later.';
  return 'Something went wrong. Try again.';
}

/** An error whose words are already right for the screen. */
const said = (text: string) => Object.assign(new Error(text), { shown: true });

// ---------------------------------------------------------------- start

/** Called once after the intro: picks up a saved session and keeps the cloud current from then on. */
export async function initCloud() {
  if (started) return;
  started = true;
  await loadMeta();
  if (!meta.deviceId) {
    meta.deviceId = uid() + uid();
    await saveMeta();
  }
  watchChanges();
  // a copy of this phone's data kept while it followed the cloud outlives its Undo only when the app was closed in that
  // time: it goes now, before any look at the cloud could keep a new one
  if (await dropSafetyCopy(null)) sweepAfterReplace(Date.now());
  // a signed-in phone shows its account while it looks at the cloud, instead of looking signed out for a moment
  patch({ auto: meta.auto, lastSyncedAt: meta.lastSyncedAt, lost: !!meta.lost, email: meta.email ?? null });
  // nothing is loaded for someone who never signed in: the client is made only when a session was saved
  if (!(await hasSavedSession())) {
    patch({ ready: true, status: 'signed-out', email: null });
    return;
  }
  const { data } = await cloud().auth.getSession();
  watchAuth();
  // a saved session the cloud no longer accepts (the password changed elsewhere, the account was deleted) was dropped
  // while the app was closed: that is said too
  if (!data.session && meta.email) {
    meta.lost = true;
    meta.email = null;
    await saveMeta();
    patch({ lost: true });
  }
  await adopt(data.session);
  patch({ ready: true });
}

/** Follows sign-ins and sign-outs (a token refresh changes nothing the app shows). Registered once. */
function watchAuth() {
  if (authWatched) return;
  authWatched = true;
  cloud().auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      // a sign-out nobody asked for here (the password changed elsewhere, the account was deleted) is said, not silent
      if (!intentional && useCloud.getState().status !== 'signed-out') {
        meta.lost = true;
        meta.email = null;
        saveMeta();
        patch({ lost: true });
      }
      intentional = false;
      adopt(null);
    } else if (event === 'SIGNED_IN' && session && session.user.id !== adoptedUser) {
      adopt(session);
    }
  });
}

/** the account this phone is following now, so a sign-in's own event and its own call adopt it once */
let adoptedUser: string | null = null;

/**
 * Makes the app match a session: signed in starts watching for changes and compares the data with what was last sent
 * (changes made while offline or signed out are noted too, see watchChanges); signed out stops.
 */
async function adopt(session: Session | null) {
  if (!session) {
    adoptedUser = null;
    stopWatching();
    patch({ status: 'signed-out', email: null, remote: null, reason: null, hasCopy: null, pending: false, usedBytes: null });
    return;
  }
  if (adoptedUser === session.user.id) return;
  adoptedUser = session.user.id;
  // another account on this phone starts its own record of what was synced; the same one picks up where it left off
  if (meta.userId !== session.user.id) {
    meta = {
      ...meta, userId: session.user.id, lastRemoteAt: null, lastSyncedAt: null, lastHash: null, rescue: false,
      filesWaiting: false, declinedAt: null,
    };
  }
  meta.email = session.user.email ?? null;
  meta.lost = false;
  await saveMeta();
  patch({
    email: meta.email, lastSyncedAt: meta.lastSyncedAt, lost: false,
    status: useCloud.getState().status === 'choice' ? 'choice' : 'idle',
  });
  startWatching();
  // on the way in, see whether another phone wrote a newer copy, then send anything this phone has not sent
  check(true).catch(() => {});
}

/**
 * Notes every change to the data, signed in or not, so a launch or a sign-in knows whether anything waits without
 * building a snapshot to compare. Changes to this phone's own settings (when it was opened) are not data. Signed in,
 * a change also starts the wait before a backup.
 */
function watchChanges() {
  if (changesWatched) return;
  changesWatched = true;
  useStore.subscribe((s, prev) => {
    if (s === prev || isDeviceOnlyChange(s, prev)) return;
    changes++;
    if (!meta.dirty) {
      meta.dirty = true;
      saveMeta();
    }
    if (!watching) return;
    if (!useCloud.getState().pending) patch({ pending: true });
    if (!meta.auto) return;
    if (changeTimer) clearTimeout(changeTimer);
    // automatic backing up may have been turned off while the wait ran
    changeTimer = setTimeout(() => { changeTimer = null; if (meta.auto) syncNow().catch(() => {}); }, AFTER_CHANGE_MS);
  });
  // data that loaded after the app gave up waiting for it can go up now
  useStore.persist.onFinishHydration(() => {
    if (watching) check(true).catch(() => {});
  });
}

function startWatching() {
  if (watching) return;
  watching = true;
  appStateSub = AppState.addEventListener('change', onAppState);
  // attachments left for Wi-Fi go up as soon as the phone is on it
  try {
    const Network = require('expo-network') as typeof import('expo-network');
    networkSub = Network.addNetworkStateListener((st) => {
      if (!isUnmetered(st.type) || !meta.filesWaiting || !meta.auto || AppState.currentState !== 'active') return;
      if (running || useCloud.getState().status === 'choice') return;
      syncNow().catch(() => {});
    });
  } catch {
    // no network module: the next backup on Wi-Fi sends them
  }
}

let appStateSub: { remove: () => void } | null = null;
let networkSub: { remove: () => void } | null = null;
function stopWatching() {
  watching = false;
  appStateSub?.remove();
  appStateSub = null;
  networkSub?.remove();
  networkSub = null;
  if (changeTimer) { clearTimeout(changeTimer); changeTimer = null; }
  stopRetry();
}

function onAppState(next: string) {
  if (!client) return;
  if (next === 'active') {
    client.auth.startAutoRefresh();
    check(false).catch(() => {});
  } else {
    client.auth.stopAutoRefresh();
    // a retry waits for the app to come back, where the return's own check does it
    stopRetry();
    // leaving the app sends what is waiting, while there is still time to
    if (meta.auto && useCloud.getState().pending) {
      if (changeTimer) { clearTimeout(changeTimer); changeTimer = null; }
      syncNow().catch(() => {});
    }
  }
}

// ---------------------------------------------------------------- Wi-Fi only

const isUnmetered = (type: unknown) => type === 'WIFI' || type === 'ETHERNET';

/**
 * Whether the phone is on Wi-Fi (or a cable) now. Without the network module there is no telling, and files go as they
 * always did.
 */
async function onWifi(): Promise<boolean> {
  try {
    const Network = require('expo-network') as typeof import('expo-network');
    return isUnmetered((await Network.getNetworkStateAsync()).type);
  } catch {
    return true;
  }
}

/** Whether attachments may go up on this run: always, unless the user keeps them to Wi-Fi and the phone is not on it. */
async function filesMayGo(overMobileData: boolean): Promise<boolean> {
  if (overMobileData || !useStore.getState().settings.attachmentsWifiOnly) return true;
  return onWifi();
}

/**
 * What a backup would do with the attachments: the ones the cloud lacks and that fit (each up to 20 MB, the account's
 * 120 MB in all), how many do not fit, and the files in the cloud no attachment uses any more.
 */
async function planFiles(userId: string, attachments: Attachment[]) {
  const folder = userId + '/att';
  const have = await listFiles(folder);
  const wanted = new Set(attachments.map((a) => a.id));
  let used = 0;
  have.forEach((size, name) => { if (wanted.has(name)) used += size; });
  const todo: { a: Attachment; size: number }[] = [];
  let skipped = 0;
  for (const a of attachments) {
    if (have.has(a.id)) continue;
    const info = await FileSystem.getInfoAsync(a.uri).catch(() => null);
    if (!info || !info.exists || (info as any).isDirectory) continue;
    const size = (info as any).size || 0;
    if (size > FILE_LIMIT || used + size > QUOTA_BYTES) { skipped++; continue; }
    used += size;
    todo.push({ a, size });
  }
  const unused = [...have.keys()].filter((name) => !wanted.has(name)).map((name) => folder + '/' + name);
  return { folder, todo, skipped, unused };
}

/**
 * For "Back up now" pressed by hand: what the attachments waiting for Wi-Fi would cost over mobile data, so the screen
 * can ask once before sending them ("Send 12 MB of attachments over mobile data?"). Null when there is nothing to ask:
 * the phone is on Wi-Fi, the setting is off, no attachment is waiting, or the cloud cannot be asked. Then
 * syncNow(false, { mobileData: true }) sends them, and plain syncNow() backs up the data and leaves them for Wi-Fi.
 */
export async function mobileDataCost(): Promise<{ bytes: number; files: number } | null> {
  if (!useStore.getState().settings.attachmentsWifiOnly || (await onWifi())) return null;
  const s = await session().catch(() => null);
  if (!s) return null;
  try {
    const { attachments } = await buildSnapshot();
    const { todo } = await planFiles(s.user.id, attachments);
    return todo.length ? { bytes: todo.reduce((n, t) => n + t.size, 0), files: todo.length } : null;
  } catch {
    return null;
  }
}

function stopRetry() {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
}

/**
 * After a backup failed with changes waiting, tries again on a lengthening wait (1, 5, then every 15 minutes) while
 * the app is in front, so "it will try again" holds without the user doing anything.
 */
function scheduleRetry() {
  stopRetry();
  const st = useCloud.getState();
  if (!watching || !meta.auto || !st.pending || st.status !== 'error' || AppState.currentState !== 'active') return;
  const wait = RETRY_MS[Math.min(retries, RETRY_MS.length - 1)];
  retries++;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (meta.auto && useCloud.getState().status === 'error') syncNow().catch(() => {});
  }, wait);
}

// ---------------------------------------------------------------- account

/** One cloud account per profile: an account another profile on this phone holds is refused before signing in. */
function refuseTaken(email: string) {
  const other = accountTakenBy(email);
  if (other) throw said(takenMessage(other));
}

export async function signUp(email: string, password: string): Promise<'signed-in' | 'confirm'> {
  refuseTaken(email);
  const { data, error } = await cloud().auth.signUp({ email: email.trim(), password });
  if (error) throw error;
  if (!data.session) return 'confirm';
  await afterSignIn(data.session);
  return 'signed-in';
}

export async function signIn(email: string, password: string) {
  refuseTaken(email);
  const { data, error } = await cloud().auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
  await afterSignIn(data.session);
}

async function afterSignIn(session: Session) {
  // the record is read first, so a sign-in made before the launch's own read finished never starts it over
  await loadMeta();
  if (!meta.deviceId) meta.deviceId = uid() + uid();
  watchChanges();
  watchAuth();
  await adopt(session);
  patch({ ready: true });
}

/**
 * Signs out on this phone only (the account's other phones stay signed in). Its data stays here, and the cloud copy
 * stays in the cloud. The record of what was synced is kept for this account, so signing back in to it raises no
 * false choice; `forget` drops it too, for a phone whose data is about to be erased. `scope` 'global' ends every
 * session the account has, for an account that is being deleted.
 */
export async function signOut({ forget = false, scope = 'local' }: { forget?: boolean; scope?: 'local' | 'global' } = {}) {
  stopWatching();
  intentional = true;
  try { await cloud().auth.signOut({ scope }); } catch { /* the saved session is cleared below either way */ } finally { intentional = false; }
  adoptedUser = null;
  meta = { ...meta, email: null, lost: false };
  if (forget) meta = { ...meta, userId: null, lastRemoteAt: null, lastSyncedAt: null, lastHash: null, rescue: false, dirty: true };
  await saveMeta();
  patch({
    status: 'signed-out', email: null, remote: null, reason: null, hasCopy: null, pending: false, usedBytes: null, error: null,
    note: null, lastSyncedAt: null, lost: false,
  });
}

/** Deletes the account and everything it keeps in the cloud. This phone's data stays. */
export async function deleteAccount() {
  const c = cloud();
  const { data: u, error: userError } = await c.auth.getUser();
  if (userError) throw userError;
  if (!u.user) throw said('Sign in first.');
  // files first: deleting the account removes its row, but files are only removed by a request like this
  await removeAllFiles(u.user.id);
  const { error } = await c.rpc('delete_my_account');
  if (error) throw error;
  // the account is gone, so every session it had goes with it, and so does this phone's record of it
  await signOut({ forget: true, scope: 'global' });
}

/** Changes the account's password (the account stays signed in on this phone). */
export async function changePassword(password: string) {
  const { error } = await cloud().auth.updateUser({ password });
  if (error) throw error;
}

/** An error that means the request never reached the cloud (or its answer never came back). */
function isOffline(e: unknown): boolean {
  const msg = String((e as any)?.message || e || '');
  const name = String((e as any)?.name || '');
  return /AuthRetryableFetchError/.test(name) || /Network request failed|fetch failed|network|timed out|timeout/i.test(msg);
}

/**
 * Forgot password, step one: the cloud emails a 6-digit code to the address (the "Reset password" email template must
 * show the code, {{ .Token }}). An address with no account is told nothing different, so nobody can test addresses.
 */
export async function sendResetCode(email: string): Promise<'sent' | 'offline' | 'error'> {
  try {
    const { error } = await cloud().auth.resetPasswordForEmail(email.trim());
    if (error) return isOffline(error) ? 'offline' : 'error';
    return 'sent';
  } catch (e) {
    return isOffline(e) ? 'offline' : 'error';
  }
}

/** the account a code was already accepted for this launch, so choosing a password again never asks for a new code */
let recoveredEmail: string | null = null;

/**
 * Forgot password, step two: the code from the email and a new password. The code signs this phone in, the password
 * is set, and the phone stays signed in. A password the cloud turns down ('weak') can be chosen again without a new
 * code. 'wrong-code' covers a mistyped code and an expired one.
 */
export async function resetPasswordWithCode(
  email: string, code: string, newPassword: string,
): Promise<'ok' | 'wrong-code' | 'weak' | 'offline' | 'error'> {
  const address = email.trim().toLowerCase();
  // checked before the code is spent: the cloud asks for at least 6 characters
  if (newPassword.length < 6) return 'weak';
  try {
    const c = cloud();
    let current = (await c.auth.getSession()).data.session;
    if (!(recoveredEmail === address && current?.user.email?.toLowerCase() === address)) {
      const token = code.replace(/\s+/g, '');
      if (!/^\d{6}$/.test(token)) return 'wrong-code';
      const { data, error } = await c.auth.verifyOtp({ email: address, token, type: 'recovery' });
      if (error || !data.session) {
        if (error && isOffline(error)) return 'offline';
        // too many tries, or the cloud failing, is not the code's fault
        const status = Number((error as any)?.status) || 0;
        return status >= 500 || status === 429 ? 'error' : 'wrong-code';
      }
      recoveredEmail = address;
      current = data.session;
    }
    const { error: setError } = await c.auth.updateUser({ password: newPassword });
    if (setError) {
      const text = String(setError.message || '') + String((setError as any).code || '');
      if (isOffline(setError)) return 'offline';
      // the password it already has: nothing to change, and the phone is signed in
      if (!/should be different|same_password/i.test(text)) {
        return /weak|at least|characters|password/i.test(text) ? 'weak' : 'error';
      }
    }
    recoveredEmail = null;
    if (current) await afterSignIn(current);
    return 'ok';
  } catch (e) {
    return isOffline(e) ? 'offline' : 'error';
  }
}

/**
 * Whether a session was saved in this profile (an account signed in here), without loading the cloud library. Another
 * profile's session never counts: theirs sit under their own key, which never ends in '-auth-token'.
 */
async function hasSavedSession(): Promise<boolean> {
  return AsyncStorage.getAllKeys()
    .then((ks) => ks.some((k) => (SESSION_KEY ? k === SESSION_KEY : k.startsWith('sb-') && k.endsWith('-auth-token'))))
    .catch(() => false);
}

/**
 * Checks the account's password by signing in again with the signed-in account's email (Forgot PIN). The session
 * simply renews. 'offline' covers anything that kept the check from being made (no connection, the cloud busy).
 */
export async function verifyAccountPassword(password: string): Promise<'ok' | 'wrong' | 'signed-out' | 'offline'> {
  if (!(await hasSavedSession())) return 'signed-out';
  let email: string | null = null;
  try {
    email = (await cloud().auth.getSession()).data.session?.user.email ?? null;
  } catch {
    email = null;
  }
  if (!email) return 'signed-out';
  if (!password) return 'wrong';
  try {
    const { error } = await cloud().auth.signInWithPassword({ email, password });
    if (!error) return 'ok';
    if (isOffline(error)) return 'offline';
    const text = String(error.message || '') + String((error as any).code || '');
    return /Invalid login credentials|invalid_credentials/i.test(text) ? 'wrong' : 'offline';
  } catch {
    return 'offline';
  }
}

/** Removes every attachment the account keeps in the cloud. */
async function removeAllFiles(userId: string) {
  const c = cloud();
  const folder = userId + '/att';
  for (;;) {
    const { data: files, error } = await c.storage.from(BUCKET).list(folder, { limit: 100 });
    if (error) throw error;
    if (!files || !files.length) break;
    const { error: rm } = await c.storage.from(BUCKET).remove(files.map((f) => folder + '/' + f.name));
    if (rm) throw rm;
    if (files.length < 100) break;
  }
}

/**
 * Deletes the copy in the cloud (data and attachments) and keeps the account. Automatic backing up turns off, so the
 * cloud stays empty until the user backs up again.
 */
export async function deleteCloudCopy() {
  if (running) await running.catch(() => {});
  const s = await session();
  await removeAllFiles(s.user.id);
  const { error } = await cloud().from('backups').delete().eq('user_id', s.user.id);
  if (error) throw error;
  meta = {
    ...meta, auto: false, lastRemoteAt: null, lastSyncedAt: null, lastHash: null, rescue: false, dirty: true,
    filesWaiting: false, declinedAt: null,
  };
  await saveMeta();
  patch({
    auto: false, lastSyncedAt: null, remote: null, reason: null, hasCopy: false, pending: true, usedBytes: 0, status: 'idle',
    note: null, error: null,
  });
  // a backup already waiting for its pause must not put the data back
  if (changeTimer) { clearTimeout(changeTimer); changeTimer = null; }
  stopRetry();
}

export async function setAuto(on: boolean) {
  meta.auto = on;
  await saveMeta();
  patch({ auto: on });
  if (on && useCloud.getState().pending) syncNow().catch(() => {});
  if (!on) {
    // a backup already waiting for its pause is cancelled with the switch
    if (changeTimer) { clearTimeout(changeTimer); changeTimer = null; }
    stopRetry();
  }
}

// ---------------------------------------------------------------- the copy in the cloud

async function session(): Promise<Session> {
  const { data } = await cloud().auth.getSession();
  if (!data.session) throw new Error('not authenticated');
  return data.session;
}

async function readRemote(userId: string): Promise<RemoteCopy | null> {
  const { data, error } = await cloud().from('backups').select('updated_at, device, device_id, bytes, files').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    updatedAt: data.updated_at, device: data.device_id === meta.deviceId ? 'this phone' : data.device, bytes: data.bytes,
    files: data.files, deviceId: data.device_id ?? null,
  };
}

/**
 * True when this phone's data must not go up now: it has not loaded yet, or it could not be opened, where an upload
 * would replace the good copy in the cloud with an empty one. A phone that could not open its data is offered the
 * cloud copy instead (a choice that waits, across launches, until the user makes it).
 */
async function heldBack(userId: string): Promise<boolean> {
  const local = localDataState();
  if (local === 'waiting') return true;
  // the user was offered the cloud copy and chose this phone's data: what they do from here goes up as usual
  if (local === 'failed' && keptThisLaunch) return false;
  if (local === 'failed' && !meta.rescue) {
    meta.rescue = true;
    await saveMeta();
  }
  if (!meta.rescue) return false;
  const remote = await readRemote(userId);
  if (!remote) {
    // nothing in the cloud to bring back: this launch still sends nothing, the next one carries on as usual
    meta.rescue = false;
    await saveMeta();
    patch({ hasCopy: false });
    return local === 'failed';
  }
  patch({ status: 'choice', reason: 'rescue', remote, hasCopy: true, error: null, progress: null });
  return true;
}

/**
 * Looks at the cloud: a copy this phone has not seen (written by another phone, or found on first sign-in) waits for
 * the user's choice; otherwise anything waiting here goes up. `compare` also settles whether anything is waiting (at
 * launch and sign-in); on a return to the app the change watcher already knows.
 */
export async function check(compare = false) {
  if (running) return;
  const s = await session().catch(() => null);
  if (!s) return;
  try {
    if (await heldBack(s.user.id)) return;
    const st = useCloud.getState();
    // an empty phone's choice stands until the user makes it, or the phone holds something of theirs again
    if (st.status === 'choice' && st.reason === 'empty' && !hasAnyUserData(exportSnapshot())) return;
    const remote = await readRemote(s.user.id);
    patch({ hasCopy: !!remote });
    if (remote && remote.updatedAt !== meta.lastRemoteAt) {
      // a run that started meanwhile looks at the cloud copy itself
      if (running) return;
      running = meetNewer(s, remote).finally(() => { running = null; });
      await running;
      return;
    }
    patch({ remote: null, reason: null, status: useCloud.getState().status === 'choice' ? 'idle' : useCloud.getState().status });
    refreshUsage().catch(() => {});
    if (compare) {
      if (meta.dirty === undefined) {
        // a phone that synced before changes were noted compares once; from then on the note says
        await afterInteractions();
        const { hash } = await buildSnapshot();
        meta.dirty = hash !== meta.lastHash;
        await saveMeta();
      }
      patch({ pending: !!meta.dirty });
    }
    // attachments left for Wi-Fi go up once the phone is on it, even with nothing else to send
    if (meta.auto && (useCloud.getState().pending || (meta.filesWaiting && (await filesMayGo(false))))) await syncNow();
  } catch (e) {
    patch({ status: 'error', error: describe(e) });
    scheduleRetry();
  }
}

export async function refreshUsage() {
  const { data, error } = await cloud().rpc('my_storage_bytes');
  if (!error && typeof data === 'number') patch({ usedBytes: data });
}

/** Marks the data as sent, unless it changed again while it was on its way. */
function settled(changesAtBuild: number) {
  if (changes !== changesAtBuild) return;
  meta.dirty = false;
  patch({ pending: false });
}

/** What a backup says about its attachments: those that did not fit, and those left for Wi-Fi. */
function filesNote(skipped: number, waiting: number): string | null {
  const fit = skipped ? (skipped === 1 ? 'One attachment did not fit' : skipped + ' attachments did not fit') + ' (20 MB each, 120 MB in all).' : '';
  if (!waiting) return fit || null;
  return fit ? fit + ' The others wait for Wi-Fi.' : 'Attachments wait for Wi-Fi';
}

/**
 * Sends this phone's data up: new attachments first, then the snapshot, then files no note uses any more are
 * cleared. `force` sends even when another phone wrote a newer copy (the user chose to keep this phone's data). With
 * attachments kept to Wi-Fi and the phone on mobile data, the data still goes and the attachments wait for Wi-Fi, unless
 * `mobileData` says the user agreed to send them now (see mobileDataCost).
 */
export function syncNow(force = false, opts: { mobileData?: boolean } = {}): Promise<void> {
  // the user's own ask (keep this phone's data, send the attachments over mobile data) runs once the run under way ends,
  // rather than being folded into it and lost
  if (running) return force || opts.mobileData ? running.catch(() => {}).then(() => syncNow(force, opts)) : running;
  running = (async () => {
    const st = useCloud.getState();
    if (st.status === 'choice' && !force) return;
    stopRetry();
    try {
      const s = await session();
      const userId = s.user.id;
      if (!force && (await heldBack(userId))) return;
      patch({ status: 'syncing', error: null, progress: null, note: null });
      let remote: RemoteCopy | null = null;
      if (!force) {
        remote = await readRemote(userId);
        if (remote && remote.updatedAt !== meta.lastRemoteAt) {
          await meetNewer(s, remote);
          return;
        }
      }
      // what is waiting in the store's own save goes to this phone's storage first
      flushSaves();
      await afterInteractions();
      const atBuild = changes;
      const { json, hash, attachments, hasUserData } = await buildSnapshot();
      const filesGo = await filesMayGo(!!opts.mobileData);
      // nothing changed since the last backup, and no attachment waits for this run: nothing goes up
      if (hash === meta.lastHash && !force && !(meta.filesWaiting && filesGo)) {
        settled(atBuild);
        await saveMeta();
        patch({ status: 'idle', progress: null, note: meta.filesWaiting ? filesNote(0, 1) : null });
        return;
      }
      // a phone holding nothing of the user's never empties a fuller cloud copy without asking
      if (!force && !hasUserData && remote && remote.bytes > json.length + EMPTY_MARGIN) {
        patch({ status: 'choice', reason: 'empty', remote, hasCopy: true, progress: null });
        return;
      }
      const { skipped, waiting, unused } = await sendFiles(s, userId, attachments, filesGo);
      const row = {
        user_id: userId, snapshot: json, device: deviceName(), device_id: meta.deviceId, app_version: appVersion(),
        bytes: json.length, files: Math.max(0, attachments.length - skipped - waiting), updated_at: new Date().toISOString(),
      };
      // The copy is written only if it is still the one this phone saw at the top of the run: attachments can take
      // minutes to send, and another phone may have written meanwhile. Its copy is then asked about, never replaced,
      // and the files it uploaded are left alone. Keeping this phone's data on purpose (`force`) replaces it.
      let data: { updated_at: string } | null = null;
      if (force) {
        const r = await cloud().from('backups').upsert(row).select('updated_at').single();
        if (r.error) throw r.error;
        data = r.data;
      } else {
        if (remote) {
          const r = await cloud().from('backups').update(row).eq('user_id', userId).eq('updated_at', meta.lastRemoteAt)
            .select('updated_at').maybeSingle();
          if (r.error) throw r.error;
          data = r.data;
        }
        if (!data) {
          // no row to update, or it is no longer the copy seen: a row that is there now is another phone's
          const now = remote ? await readRemote(userId) : null;
          if (now) {
            await meetNewer(s, now);
            return;
          }
          const r = await cloud().from('backups').insert(row).select('updated_at').single();
          if (r.error) {
            if ((r.error as any).code !== '23505') throw r.error;
            // another phone wrote the first copy just now
            const other = await readRemote(userId);
            if (other) {
              await meetNewer(s, other);
              return;
            }
            throw r.error;
          }
          data = r.data;
        }
      }
      meta.lastRemoteAt = data!.updated_at;
      meta.lastHash = hash;
      meta.lastSyncedAt = Date.now();
      meta.rescue = false;
      meta.filesWaiting = waiting > 0;
      settled(atBuild);
      await saveMeta();
      retries = 0;
      patch({
        status: 'idle', lastSyncedAt: meta.lastSyncedAt, remote: null, reason: null, hasCopy: true, progress: null,
        note: filesNote(skipped, waiting),
      });
      // files no note uses any more leave only now that the copy naming the rest is saved; if this fails, the next
      // backup clears them
      await removeFiles(unused).catch(() => {});
      refreshUsage().catch(() => {});
    } catch (e) {
      patch({ status: 'error', error: describe(e), progress: null });
    }
  })().finally(() => {
    running = null;
    scheduleRetry();
  });
  return running;
}

/** The attachments the account keeps in the cloud, by name, with their sizes. */
async function listFiles(folder: string): Promise<Map<string, number>> {
  const have = new Map<string, number>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await cloud().storage.from(BUCKET).list(folder, { limit: 1000, offset });
    if (error) throw error;
    for (const f of data || []) have.set(f.name, Number((f.metadata as any)?.size) || 0);
    if (!data || data.length < 1000) break;
  }
  return have;
}

async function removeFiles(paths: string[]) {
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await cloud().storage.from(BUCKET).remove(paths.slice(i, i + 100));
    if (error) throw error;
  }
}

/**
 * Uploads the attachments the cloud lacks, unless `upload` is false (they wait for Wi-Fi). Returns how many could not
 * go up, how many wait, and the files no note uses any more, which are removed only once the snapshot is saved.
 */
async function sendFiles(
  s: Session, userId: string, attachments: Attachment[], upload: boolean,
): Promise<{ skipped: number; waiting: number; unused: string[] }> {
  const { folder, todo, skipped, unused } = await planFiles(userId, attachments);
  if (!upload) return { skipped, waiting: todo.length, unused };
  const total = todo.reduce((n, t) => n + t.size, 0) || 1;
  let done = 0;
  for (const { a, size } of todo) {
    patch({ progress: done / total });
    // streamed from the file by the platform, so a video never has to fit in memory
    const res = await FileSystem.uploadAsync(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${folder}/${a.id}`, a.uri, {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { Authorization: 'Bearer ' + s.access_token, apikey: SUPABASE_KEY, 'x-upsert': 'true', 'Content-Type': mimeOf(a) },
    });
    if (res.status >= 300) throw Object.assign(new Error('Upload failed (' + res.status + ')'), { status: res.status });
    done += size;
  }
  patch({ progress: todo.length ? 1 : null });
  return { skipped, waiting: 0, unused };
}

/** Waits for touches and animations to finish, so building a snapshot never lands in the middle of one. */
function afterInteractions(): Promise<void> {
  return new Promise((resolve) => { InteractionManager.runAfterInteractions(() => resolve()); });
}

function mimeOf(a: Attachment): string {
  const ext = (a.name || a.uri).split('.').pop()?.toLowerCase() || '';
  const known: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic',
    mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', '3gp': 'video/3gpp',
    pdf: 'application/pdf', mp3: 'audio/mpeg', m4a: 'audio/mp4', txt: 'text/plain',
  };
  return known[ext] || (a.kind === 'image' ? 'image/jpeg' : a.kind === 'video' ? 'video/mp4' : 'application/octet-stream');
}

/** The wipe module, loaded when a replace needs it (it reaches back here, so never at the top). */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const wipeModule = () => require('./wipe') as typeof import('./wipe');

/** After a replace: the old journal's texts and files nothing uses any more go, now that every file needed is here. */
function sweepAfterReplace(startedAt: number) {
  try {
    wipeModule().sweepUnusedFiles(startedAt).catch(() => {});
  } catch {
    // the next replace sweeps
  }
}

/**
 * Brings the cloud copy here, replacing this phone's data: the data, the journal's texts, then each attachment (those
 * kept in Recently deleted too). Runs inside `running`. Throws only before anything here is replaced; `onReplaced`
 * hears the moment the data is, and `mayReplace`, asked once the copy is here and read, can still stop it then.
 * Returns how many attachments could not be brought down.
 */
async function bringDown(s: Session, onReplaced?: () => void, mayReplace?: () => boolean): Promise<{ missing: number }> {
  const { data, error } = await cloud().from('backups').select('snapshot, updated_at').eq('user_id', s.user.id).maybeSingle();
  if (error) throw error;
  if (!data) {
    patch({ hasCopy: false });
    throw said('There is no copy in the cloud yet.');
  }
  // the copy comes down whole and is read before anything here is replaced; it is parsed once for both steps
  let parsed: any = null;
  try { parsed = JSON.parse(data.snapshot); } catch { /* refused just below */ }
  const read = readSnapshot(parsed);
  if (!read) throw said('The cloud copy could not be read by this version of the app.');
  if (mayReplace && !mayReplace()) throw said('This phone changed while the cloud copy came down.');
  // the PC keeps its own arrangement of Today (its own columns): everything else follows the account
  const ownBoard = Platform.OS === 'web' ? pcColumns() : null;
  applySnapshot(read);
  if (ownBoard) for (const k of Object.keys(ownBoard)) useStore.getState().setTodayColumns(k, ownBoard[k]);
  onReplaced?.();
  let missing = 0;
  try {
    try { await restoreBodies(parsed?.journal); } catch { /* the index is back either way */ }
    wipeModule().afterReplace();
    const attachments = attachmentsOf(useStore.getState());
    const folder = s.user.id + '/att';
    // what the cloud holds, by size, so a file already here is never fetched again (a same-phone restore costs no
    // data); unknown if the listing fails, and then each file is simply asked for
    const listed = await listFiles(folder).catch(() => null);
    const relinked: Record<string, string> = {};
    await FileSystem.makeDirectoryAsync(ATT_DIR, { intermediates: true }).catch(() => {});
    for (let i = 0; i < attachments.length; i++) {
      const a = attachments[i];
      patch({ progress: attachments.length ? i / attachments.length : null });
      const dest = restoredPath(a);
      const here = await localSize(dest);
      const size = listed?.get(a.id);
      if (here != null && (size === here || (!!listed && size === undefined))) {
        // already on this phone, whole; or never sent up (too large, or waiting for Wi-Fi) while this phone has it
        relinked[a.id] = dest;
        continue;
      }
      if (!listed || size !== undefined) {
        // fetched beside the file, and moved over it only once it is whole: a failed or cut download never
        // touches the one this phone already has
        const part = dest + '.part';
        try {
          const res = await FileSystem.downloadAsync(`${SUPABASE_URL}/storage/v1/object/authenticated/${BUCKET}/${folder}/${a.id}`, part, {
            headers: { Authorization: 'Bearer ' + s.access_token, apikey: SUPABASE_KEY },
          });
          if (res.status >= 200 && res.status < 300) {
            await FileSystem.moveAsync({ from: part, to: dest });
            relinked[a.id] = dest;
            continue;
          }
        } catch {
          // counted below, unless this phone has the file
        }
        await FileSystem.deleteAsync(part, { idempotent: true }).catch(() => {});
      }
      if (here != null) relinked[a.id] = dest;
      else if (dest === a.uri || (await localSize(a.uri)) == null) missing++;
    }
    useStore.getState().relinkAttachments(relinked);
    flushSaves();
    const { hash } = await buildSnapshot();
    meta.lastHash = hash;
  } finally {
    // whatever happened after the replace, this phone now holds that copy and is never asked about it again
    meta.lastRemoteAt = data.updated_at;
    meta.lastSyncedAt = Date.now();
    meta.rescue = false;
    meta.dirty = false;
    meta.filesWaiting = false;
    meta.declinedAt = null;
    await saveMeta();
    patch({
      status: 'idle', remote: null, reason: null, hasCopy: true, pending: false, progress: null, lastSyncedAt: meta.lastSyncedAt,
      error: null, note: null,
    });
  }
  return { missing };
}

/**
 * Brings the cloud copy to this phone, replacing what is here: the data, the journal's texts, then each attachment.
 * Returns how many attachments could not be brought down.
 */
export async function restoreFromCloud(): Promise<{ missing: number }> {
  if (running) await running.catch(() => {});
  if (followTimer) {
    // a quiet follow's Undo stands down: this replace is the user's own choice
    clearTimeout(followTimer);
    followTimer = null;
    await dropSafetyCopy(null);
  }
  let missing = 0;
  running = (async () => {
    patch({ status: 'syncing', error: null, progress: null, note: null });
    try {
      const s = await session();
      const startedAt = Date.now();
      ({ missing } = await bringDown(s));
      sweepAfterReplace(startedAt);
    } catch (e) {
      patch({ status: 'error', error: describe(e), progress: null });
      throw e;
    }
  })().finally(() => { running = null; });
  await running;
  return { missing };
}

// ---------------------------------------------------------------- following the cloud

/** the wait before a quiet follow's kept copy goes, while its Undo stands */
let followTimer: ReturnType<typeof setTimeout> | null = null;

/** Whether the recovery row holds a copy this module kept (the one with `id`, or any when id is null). */
function isSafetyCopy(raw: string | null, id: string | null): boolean {
  if (raw == null || !raw.startsWith(SAFETY_PREFIX)) return false;
  return id == null || raw.startsWith(SAFETY_PREFIX + JSON.stringify(id) + ',');
}

/**
 * Whether what the recovery row holds is only the copy kept for a quiet follow's Undo: it is no copy of data that
 * could not be opened, so Settings never offers it as one (restoring it later would undo the follow unasked).
 */
export const isFollowCopy = (raw: string | null) => isSafetyCopy(raw, null);

/** Removes the copy this module kept for an Undo (never a kept copy of data that could not be opened). True if it went. */
async function dropSafetyCopy(id: string | null): Promise<boolean> {
  try {
    if (!isSafetyCopy(await AsyncStorage.getItem(RECOVERY_KEY), id)) return false;
    await AsyncStorage.removeItem(RECOVERY_KEY);
    return true;
  } catch {
    return false;
  }
}

/** A copy in the cloud this phone has not seen: it comes here quietly when it may (newerCopyAction), else it is asked about. */
/** The PC's own arrangements of Today (keys 'pc2', 'pc3'), as they stand here. */
function pcColumns(): Record<string, string[][]> | null {
  const cols = useStore.getState().todayColumns || {};
  const out: Record<string, string[][]> = {};
  for (const k of Object.keys(cols)) if (k.startsWith('pc') && cols[k]) out[k] = cols[k];
  return Object.keys(out).length ? out : null;
}

async function meetNewer(s: Session, remote: RemoteCopy): Promise<void> {
  if (await follow(s, remote)) return;
  patch({ status: 'choice', reason: 'newer', remote, hasCopy: true, error: null, progress: null });
}

/**
 * Follows a newer cloud copy written on another phone while this one has changed nothing: a copy of this phone's data
 * is kept first, then the cloud copy comes here, and a toast offers the Undo. False (nothing changed) when it may not:
 * then the user chooses. Runs inside `running`.
 */
async function follow(s: Session, remote: RemoteCopy): Promise<boolean> {
  if (localDataState() !== 'ok' || meta.rescue) return false;
  // a choice still waiting (a follow the user undid) is never made for them by following a later copy quietly
  if (useCloud.getState().status === 'choice') return false;
  // a Deep Work session under way here is in no copy, and a replace ends it: the user chooses
  if (useStore.getState().deepWork) return false;
  const facts = (localHash: string | null): NewerCopyFacts => ({
    remoteAt: remote.updatedAt, remoteDeviceId: remote.deviceId, lastRemoteAt: meta.lastRemoteAt, deviceId: meta.deviceId,
    localHash, lastHash: meta.lastHash, savePending: savePending(), declinedAt: meta.declinedAt,
  });
  // The PC starts from the account's data: signed in there for the first time, the cloud copy comes down at once (with
  // an Undo, and the PC's own Today arrangement kept), instead of asking which side to keep. After that it follows the
  // cloud as a phone does.
  const firstOnPc = Platform.OS === 'web' && !meta.lastRemoteAt;
  // everything that needs no snapshot is asked first: most newer copies are a choice
  if (!firstOnPc && newerCopyAction({ ...facts(meta.lastHash), savePending: false }) !== 'follow') return false;
  // a save still in its pause is let through first: on a return to the app it is often only this phone's open time,
  // stamped just as this look at the cloud began. A change to the data still shows in the fingerprint below
  if (savePending()) await new Promise((r) => setTimeout(r, SAVE_PAUSE_MS + 50));
  await afterInteractions();
  const atBuild = changes;
  const mine = await buildSnapshot();
  if (!firstOnPc && newerCopyAction(facts(mine.hash)) !== 'follow') return false;
  // a kept copy of data that could not be opened is never replaced, and without a copy of its own there is no Undo
  let kept: string | null;
  try { kept = await AsyncStorage.getItem(RECOVERY_KEY); } catch { return false; }
  if (kept != null) return false;
  const safetyId = uid();
  try {
    await AsyncStorage.setItem(RECOVERY_KEY, SAFETY_PREFIX + JSON.stringify(safetyId) + ',' + mine.json.slice(1));
  } catch {
    return false;
  }
  // something changed while the copy was made: this phone is no longer idle, and the user chooses
  if (changes !== atBuild || savePending()) {
    await dropSafetyCopy(safetyId);
    return false;
  }
  const before = { lastRemoteAt: meta.lastRemoteAt, lastHash: meta.lastHash, lastSyncedAt: meta.lastSyncedAt, filesWaiting: !!meta.filesWaiting };
  const startedAt = Date.now();
  let replaced = false;
  // something done here while the copy was on its way down (a tick, a note saved) is a change of this phone's own: then
  // both sides changed, nothing is replaced, and the user chooses
  let moved = false;
  patch({ status: 'syncing', error: null, progress: null, note: null });
  try {
    await bringDown(s, () => { replaced = true; }, () => {
      moved = changes !== atBuild || savePending();
      return !moved;
    });
  } catch (e) {
    if (!replaced) {
      await dropSafetyCopy(safetyId);
      if (moved) return false;
      throw e;
    }
  }
  const from = remote.device && remote.device !== 'this phone' ? remote.device : 'another phone';
  toast(firstOnPc ? 'Your data is here from the cloud' : 'Updated from ' + from, { label: 'Undo', onPress: () => { undoFollow(safetyId, remote.updatedAt, before).catch(() => {}); } });
  if (followTimer) clearTimeout(followTimer);
  followTimer = setTimeout(() => {
    followTimer = null;
    dropSafetyCopy(safetyId).then((gone) => { if (gone) sweepAfterReplace(startedAt); }).catch(() => {});
  }, FOLLOW_UNDO_MS);
  return true;
}

/**
 * The toast's Undo: this phone's own data comes back from the copy kept before following, and the cloud copy it
 * followed is asked about from now on (keep this phone's data, or bring that copy here), never followed again.
 */
async function undoFollow(
  safetyId: string, remoteAt: string,
  before: { lastRemoteAt: string | null; lastHash: string | null; lastSyncedAt: number | null; filesWaiting: boolean },
) {
  if (followTimer) { clearTimeout(followTimer); followTimer = null; }
  if (running) await running.catch(() => {});
  let raw: string | null = null;
  try { raw = await AsyncStorage.getItem(RECOVERY_KEY); } catch { raw = null; }
  let parsed: any = null;
  if (isSafetyCopy(raw, safetyId)) {
    try { parsed = JSON.parse(raw as string); } catch { parsed = null; }
  }
  const read = parsed ? readSnapshot(parsed) : null;
  if (!read) {
    toast('Too late to undo');
    return;
  }
  running = (async () => {
    applySnapshot(read);
    try { await restoreBodies(parsed.journal); } catch { /* the index is back either way */ }
    wipeModule().afterReplace();
    flushSaves();
    meta.lastRemoteAt = before.lastRemoteAt;
    meta.lastHash = before.lastHash;
    meta.lastSyncedAt = before.lastSyncedAt;
    meta.filesWaiting = before.filesWaiting;
    meta.declinedAt = remoteAt;
    await saveMeta();
    await dropSafetyCopy(safetyId);
    patch({ lastSyncedAt: meta.lastSyncedAt, status: 'idle', note: null });
  })().finally(() => { running = null; });
  await running;
  // the other phone's copy waits in the cloud for the user's choice
  check(false).catch(() => {});
}

/** The size of a file on this phone, or null when there is none. */
async function localSize(uri: string): Promise<number | null> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists && !info.isDirectory ? (info as any).size ?? 0 : null;
  } catch {
    return null;
  }
}

/** The user chose this phone's data over the cloud copy: it goes up and replaces that copy. */
export async function keepThisPhone() {
  keptThisLaunch = true;
  meta.rescue = false;
  await saveMeta();
  patch({ remote: null, reason: null });
  await syncNow(true);
}

/**
 * Everything on this phone was just replaced by the user (an import, a kept copy restored): a choice offered because
 * this phone could not open its data, or held none, no longer stands. The new data goes up as any change does, after
 * the usual wait, by which time its attachments are back in place too.
 */
export function afterLocalReplace() {
  if (running) return;
  const reason = useCloud.getState().reason;
  if (meta.rescue || reason === 'rescue' || reason === 'empty') {
    meta.rescue = false;
    saveMeta();
    if (useCloud.getState().status === 'choice') patch({ status: 'idle', reason: null, remote: null });
  }
}

// ---------- whether the backup needs the user ----------

/**
 * What the More tab and Today say about the backup: 'lost' when the account was signed out elsewhere (nothing backs up
 * until the user signs in again), 'paused' when backups wait on the user (a choice between copies, automatic backups
 * off with changes waiting, or failing for over a day), 'ok' otherwise, and always while the cloud has not looked yet.
 */
export type BackupAttention = 'ok' | 'paused' | 'lost';

/** how long backups may keep failing (offline, say) before the user is told */
const FAILING_FOR_MS = 24 * 60 * 60 * 1000;

/** The words beside the More tab's Settings row, and on Today's slim banner. */
export const BACKUP_ATTENTION_TEXT: Record<Exclude<BackupAttention, 'ok'>, string> = {
  paused: 'Backup paused · tap to fix',
  lost: 'Signed out · tap to back up again',
};

/** Pure, so it is tested on its own. */
export function backupAttention(
  s: Pick<CloudState, 'ready' | 'status' | 'auto' | 'pending' | 'lost' | 'lastSyncedAt'>,
  now = Date.now(),
): BackupAttention {
  if (!s.ready) return 'ok';
  if (s.lost) return 'lost';
  if (s.status === 'signed-out') return 'ok';
  if (s.status === 'choice') return 'paused';
  if (!s.auto && s.pending) return 'paused';
  if (s.status === 'error' && (s.lastSyncedAt == null || now - s.lastSyncedAt > FAILING_FOR_MS)) return 'paused';
  return 'ok';
}

/** The backup's attention for the screens: re-renders only when it changes. */
export function useBackupAttention(): BackupAttention {
  return useCloud((s) => backupAttention(s));
}
