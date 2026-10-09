// Cloud sync with Supabase. Everything the app keeps (the store, the journal's texts) goes up as one snapshot in the
// user's own row of `public.backups`; the files attached to notes go up one by one into the private `backups` bucket
// under <user id>/att/<attachment id>, each only once, and ones no note uses any more are cleared. The phone stays the
// place the data lives: the cloud holds its latest copy, kept current a little after each change and whenever the app
// goes to the background, and brings it to another phone.
//
// Two phones on one account never overwrite each other silently: a phone remembers the copy it last saw, and when the
// cloud holds a newer one written somewhere else, it stops and asks which to keep. See supabase/setup.sql.

import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, InteractionManager, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import Constants from 'expo-constants';
import { create } from 'zustand';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import {
  useStore, exportSnapshot, readSnapshot, applySnapshot, flushSaves, hasAnyUserData, localDataState, isDeviceOnlyChange,
  withoutDeviceSettings, Attachment,
} from './store';
import { journalForBackup, restoreBodies } from './journal';
import { restoredPath } from './backup';
import { ATT_DIR } from './attachments';
import { uid } from './utils';

export const SUPABASE_URL = 'https://imvydxgapirnkuvayimn.supabase.co';
/** the project's publishable key: safe in the app, since every row and file is guarded by the user's own id */
export const SUPABASE_KEY = 'sb_publishable_uWD9djNFLKH9uQ0uBeqP5g_rbk8cYJO';

const BUCKET = 'backups';
const META_KEY = 'sturoids-cloud';
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
export interface RemoteCopy { updatedAt: string; device: string | null; bytes: number; files: number }

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
  meta = { ...meta, userId: null, email: null, lastRemoteAt: null, lastSyncedAt: null, lastHash: null, rescue: false, dirty: true };
  await saveMeta();
}

function patch(p: Partial<CloudState>) { useCloud.setState(p); }

/** The client, made the first time the cloud is used, never at launch. */
export function cloud(): SupabaseClient {
  if (client) return client;
  // required here so the library stays off the startup path
  const { createClient } = require('@supabase/supabase-js') as typeof import('@supabase/supabase-js');
  client = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
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
  return {
    json, hash: fingerprint(body), attachments: snap.notes.flatMap((n) => n.attachments || []), hasUserData: hasAnyUserData(snap),
  };
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
  // a signed-in phone shows its account while it looks at the cloud, instead of looking signed out for a moment
  patch({ auto: meta.auto, lastSyncedAt: meta.lastSyncedAt, lost: !!meta.lost, email: meta.email ?? null });
  // nothing is loaded for someone who never signed in: the client is made only when a session was saved
  const hasSession = await AsyncStorage.getAllKeys().then((ks) => ks.some((k) => k.startsWith('sb-') && k.endsWith('-auth-token'))).catch(() => false);
  if (!hasSession) {
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
    meta = { ...meta, userId: session.user.id, lastRemoteAt: null, lastSyncedAt: null, lastHash: null, rescue: false };
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
    changeTimer = setTimeout(() => { changeTimer = null; syncNow().catch(() => {}); }, AFTER_CHANGE_MS);
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
}

let appStateSub: { remove: () => void } | null = null;
function stopWatching() {
  watching = false;
  appStateSub?.remove();
  appStateSub = null;
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
    if (useCloud.getState().status === 'error') syncNow().catch(() => {});
  }, wait);
}

// ---------------------------------------------------------------- account

export async function signUp(email: string, password: string): Promise<'signed-in' | 'confirm'> {
  const { data, error } = await cloud().auth.signUp({ email: email.trim(), password });
  if (error) throw error;
  if (!data.session) return 'confirm';
  await afterSignIn(data.session);
  return 'signed-in';
}

export async function signIn(email: string, password: string) {
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
  meta = { ...meta, auto: false, lastRemoteAt: null, lastSyncedAt: null, lastHash: null, rescue: false, dirty: true };
  await saveMeta();
  patch({
    auto: false, lastSyncedAt: null, remote: null, reason: null, hasCopy: false, pending: true, usedBytes: 0, status: 'idle',
    note: null, error: null,
  });
}

export async function setAuto(on: boolean) {
  meta.auto = on;
  await saveMeta();
  patch({ auto: on });
  if (on && useCloud.getState().pending) syncNow().catch(() => {});
  if (!on) stopRetry();
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
  return { updatedAt: data.updated_at, device: data.device_id === meta.deviceId ? 'this phone' : data.device, bytes: data.bytes, files: data.files };
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
      patch({ status: 'choice', reason: 'newer', remote, error: null });
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
    if (useCloud.getState().pending && meta.auto) await syncNow();
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

/**
 * Sends this phone's data up: new attachments first, then the snapshot, then files no note uses any more are
 * cleared. `force` sends even when another phone wrote a newer copy (the user chose to keep this phone's data).
 */
export function syncNow(force = false): Promise<void> {
  if (running) return running;
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
          patch({ status: 'choice', reason: 'newer', remote, hasCopy: true });
          return;
        }
      }
      // what is waiting in the store's own save goes to this phone's storage first
      flushSaves();
      await afterInteractions();
      const atBuild = changes;
      const { json, hash, attachments, hasUserData } = await buildSnapshot();
      // nothing changed since the last backup: nothing goes up
      if (hash === meta.lastHash && !force) {
        settled(atBuild);
        await saveMeta();
        patch({ status: 'idle', progress: null });
        return;
      }
      // a phone holding nothing of the user's never empties a fuller cloud copy without asking
      if (!force && !hasUserData && remote && remote.bytes > json.length + EMPTY_MARGIN) {
        patch({ status: 'choice', reason: 'empty', remote, hasCopy: true, progress: null });
        return;
      }
      const { skipped, unused } = await sendFiles(s, userId, attachments);
      const updatedAt = new Date().toISOString();
      const { data, error } = await cloud().from('backups').upsert({
        user_id: userId, snapshot: json, device: deviceName(), device_id: meta.deviceId, app_version: appVersion(),
        bytes: json.length, files: attachments.length - skipped, updated_at: updatedAt,
      }).select('updated_at').single();
      if (error) throw error;
      meta.lastRemoteAt = data?.updated_at ?? updatedAt;
      meta.lastHash = hash;
      meta.lastSyncedAt = Date.now();
      meta.rescue = false;
      settled(atBuild);
      await saveMeta();
      retries = 0;
      patch({
        status: 'idle', lastSyncedAt: meta.lastSyncedAt, remote: null, reason: null, hasCopy: true, progress: null,
        note: skipped ? (skipped === 1 ? 'One attachment did not fit' : skipped + ' attachments did not fit') + ' (20 MB each, 120 MB in all).' : null,
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
 * Uploads the attachments the cloud lacks. Returns how many could not go up, and the files no note uses any more,
 * which are removed only once the snapshot is saved.
 */
async function sendFiles(s: Session, userId: string, attachments: Attachment[]): Promise<{ skipped: number; unused: string[] }> {
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
  const unused = [...have.keys()].filter((name) => !wanted.has(name)).map((name) => folder + '/' + name);
  return { skipped, unused };
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

/**
 * Brings the cloud copy to this phone, replacing what is here: the data, the journal's texts, then each attachment.
 * Returns how many attachments could not be brought down.
 */
export async function restoreFromCloud(): Promise<{ missing: number }> {
  if (running) await running.catch(() => {});
  let missing = 0;
  running = (async () => {
    patch({ status: 'syncing', error: null, progress: null, note: null });
    try {
      const s = await session();
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
      applySnapshot(read);
      try { await restoreBodies(parsed?.journal); } catch { /* the index is back either way */ }
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const wipe = require('./wipe') as typeof import('./wipe');
      const startedAt = Date.now();
      wipe.afterReplace();
      const attachments = useStore.getState().notes.flatMap((n) => n.attachments || []);
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
          // already on this phone, whole; or never sent up (too large) while this phone still has it
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
      meta.lastRemoteAt = data.updated_at;
      meta.lastHash = hash;
      meta.lastSyncedAt = Date.now();
      meta.rescue = false;
      meta.dirty = false;
      await saveMeta();
      patch({
        status: 'idle', remote: null, reason: null, hasCopy: true, pending: false, progress: null, lastSyncedAt: meta.lastSyncedAt,
      });
      // the old journal's texts and files no note uses any more go, now that every file the copy needs is here
      wipe.sweepUnusedFiles(startedAt).catch(() => {});
    } catch (e) {
      patch({ status: 'error', error: describe(e), progress: null });
      throw e;
    }
  })().finally(() => { running = null; });
  await running;
  return { missing };
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
