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
import { useStore, exportSnapshot, importSnapshot, flushSaves, Attachment } from './store';
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

export type CloudStatus = 'signed-out' | 'idle' | 'syncing' | 'error' | 'choice';

/** A copy in the cloud the phone did not write or has not seen: the user picks which to keep. */
export interface RemoteCopy { updatedAt: string; device: string | null; bytes: number; files: number }

interface Meta {
  /** this install, so the cloud can tell which phone wrote a copy */
  deviceId: string;
  userId: string | null;
  auto: boolean;
  /** when this phone last finished a backup or brought a copy down */
  lastSyncedAt: number | null;
  /** the cloud copy's updated_at as this phone last wrote or read it */
  lastRemoteAt: string | null;
  /** what the last backup held, so an unchanged app never uploads again */
  lastHash: string | null;
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
  /** there are changes the cloud has not got yet */
  pending: boolean;
}

export const useCloud = create<CloudState>(() => ({
  ready: false, status: 'signed-out', email: null, auto: true, lastSyncedAt: null, error: null, progress: null,
  note: null, usedBytes: null, remote: null, pending: false,
}));

let meta: Meta = { deviceId: '', userId: null, auto: true, lastSyncedAt: null, lastRemoteAt: null, lastHash: null };
let client: SupabaseClient | null = null;
let started = false;
let running: Promise<void> | null = null;
let changeTimer: ReturnType<typeof setTimeout> | null = null;
let unsubStore: (() => void) | null = null;
let authWatched = false;

async function saveMeta() {
  try { await AsyncStorage.setItem(META_KEY, JSON.stringify(meta)); } catch { /* the next run writes it again */ }
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

/** The snapshot as it goes up: the store with the journal's texts inline, like a backup file. */
async function buildSnapshot(): Promise<{ json: string; hash: string; attachments: Attachment[] }> {
  const snap = exportSnapshot();
  const payload = { ...snap, journal: await journalForBackup(snap.journal) };
  const json = JSON.stringify(payload);
  // the export time changes every run, so it is left out of the fingerprint
  const { _exportedAt, ...rest } = payload as any;
  return { json, hash: fingerprint(JSON.stringify(rest)), attachments: snap.notes.flatMap((n) => n.attachments || []) };
}

/** Words for an error from the cloud, for the screen. */
export function describe(e: unknown): string {
  const msg = String((e as any)?.message || e || '');
  const code = (e as any)?.code || (e as any)?.error_code || '';
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
  if (/JWT|session|not authenticated|401/i.test(msg)) return 'You were signed out. Sign in again to keep backing up.';
  return msg ? msg.slice(0, 160) : 'Something went wrong. Try again.';
}

// ---------------------------------------------------------------- start

/** Called once after the intro: picks up a saved session and keeps the cloud current from then on. */
export async function initCloud() {
  if (started) return;
  started = true;
  try {
    const raw = await AsyncStorage.getItem(META_KEY);
    if (raw) meta = { ...meta, ...JSON.parse(raw) };
  } catch { /* a fresh meta is fine */ }
  if (!meta.deviceId) {
    meta.deviceId = uid() + uid();
    await saveMeta();
  }
  patch({ auto: meta.auto, lastSyncedAt: meta.lastSyncedAt });
  // nothing is loaded for someone who never signed in: the client is made only when a session was saved
  const hasSession = await AsyncStorage.getAllKeys().then((ks) => ks.some((k) => k.startsWith('sb-') && k.endsWith('-auth-token'))).catch(() => false);
  if (!hasSession) {
    patch({ ready: true, status: 'signed-out' });
    return;
  }
  const { data } = await cloud().auth.getSession();
  watchAuth();
  await adopt(data.session);
  patch({ ready: true });
}

/** Follows sign-ins and sign-outs (a token refresh changes nothing the app shows). Registered once. */
function watchAuth() {
  if (authWatched) return;
  authWatched = true;
  cloud().auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') adopt(null);
    else if (event === 'SIGNED_IN' && session && session.user.id !== meta.userId) adopt(session);
  });
}

/**
 * Makes the app match a session: signed in starts watching for changes and compares the data with what was last sent
 * (changes made while offline or signed out left no mark); signed out stops.
 */
async function adopt(session: Session | null) {
  if (!session) {
    stopWatching();
    patch({ status: 'signed-out', email: null, remote: null, pending: false, usedBytes: null });
    return;
  }
  // another account on this phone starts its own record of what was synced
  if (meta.userId !== session.user.id) {
    meta = { ...meta, userId: session.user.id, lastRemoteAt: null, lastSyncedAt: null, lastHash: null };
    await saveMeta();
  }
  patch({ email: session.user.email ?? null, lastSyncedAt: meta.lastSyncedAt, status: useCloud.getState().status === 'choice' ? 'choice' : 'idle' });
  startWatching();
  // on the way in, see whether another phone wrote a newer copy, then send anything this phone has not sent
  check(true).catch(() => {});
}

function startWatching() {
  if (unsubStore) return;
  unsubStore = useStore.subscribe((s, prev) => {
    if (s === prev) return;
    patch({ pending: true });
    if (!meta.auto) return;
    if (changeTimer) clearTimeout(changeTimer);
    changeTimer = setTimeout(() => { changeTimer = null; syncNow().catch(() => {}); }, AFTER_CHANGE_MS);
  });
  appStateSub = AppState.addEventListener('change', onAppState);
}

let appStateSub: { remove: () => void } | null = null;
function stopWatching() {
  unsubStore?.();
  unsubStore = null;
  appStateSub?.remove();
  appStateSub = null;
  if (changeTimer) { clearTimeout(changeTimer); changeTimer = null; }
}

function onAppState(next: string) {
  if (!client) return;
  if (next === 'active') {
    client.auth.startAutoRefresh();
    check(false).catch(() => {});
  } else {
    client.auth.stopAutoRefresh();
    // leaving the app sends what is waiting, while there is still time to
    if (meta.auto && useCloud.getState().pending) {
      if (changeTimer) { clearTimeout(changeTimer); changeTimer = null; }
      syncNow().catch(() => {});
    }
  }
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
  watchAuth();
  await adopt(session);
  patch({ ready: true });
}

/** Signs out on this phone. Its data stays here, and the cloud copy stays in the cloud. */
export async function signOut() {
  stopWatching();
  try { await cloud().auth.signOut(); } catch { /* the saved session is cleared below either way */ }
  meta = { ...meta, userId: null, lastRemoteAt: null, lastSyncedAt: null, lastHash: null };
  await saveMeta();
  patch({ status: 'signed-out', email: null, remote: null, pending: false, usedBytes: null, error: null, note: null, lastSyncedAt: null });
}

/** Deletes the account and everything it keeps in the cloud. This phone's data stays. */
export async function deleteAccount() {
  const c = cloud();
  const { data: u } = await c.auth.getUser();
  if (!u.user) throw new Error('Sign in first.');
  // files first: deleting the account removes its row, but files are only removed by a request like this
  await removeAllFiles(u.user.id);
  const { error } = await c.rpc('delete_my_account');
  if (error) throw error;
  await signOut();
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
  meta = { ...meta, auto: false, lastRemoteAt: null, lastSyncedAt: null, lastHash: null };
  await saveMeta();
  patch({ auto: false, lastSyncedAt: null, remote: null, pending: true, usedBytes: 0, status: 'idle', note: null, error: null });
}

export async function setAuto(on: boolean) {
  meta.auto = on;
  await saveMeta();
  patch({ auto: on });
  if (on && useCloud.getState().pending) syncNow().catch(() => {});
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
 * Looks at the cloud: a copy this phone has not seen (written by another phone, or found on first sign-in) waits for
 * the user's choice; otherwise anything waiting here goes up. `compare` also fingerprints the data against what was
 * last sent (at launch and sign-in); on a return to the app the change watcher already knows.
 */
export async function check(compare = false) {
  if (running) return;
  const s = await session().catch(() => null);
  if (!s) return;
  try {
    const remote = await readRemote(s.user.id);
    if (remote && remote.updatedAt !== meta.lastRemoteAt) {
      patch({ status: 'choice', remote, error: null });
      return;
    }
    patch({ remote: null, status: useCloud.getState().status === 'choice' ? 'idle' : useCloud.getState().status });
    refreshUsage().catch(() => {});
    if (compare) {
      await afterInteractions();
      const { hash } = await buildSnapshot();
      patch({ pending: hash !== meta.lastHash });
    }
    if (useCloud.getState().pending && meta.auto) await syncNow();
  } catch (e) {
    patch({ status: 'error', error: describe(e) });
  }
}

export async function refreshUsage() {
  const { data, error } = await cloud().rpc('my_storage_bytes');
  if (!error && typeof data === 'number') patch({ usedBytes: data });
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
    patch({ status: 'syncing', error: null, progress: null, note: null });
    try {
      const s = await session();
      const userId = s.user.id;
      if (!force) {
        const remote = await readRemote(userId);
        if (remote && remote.updatedAt !== meta.lastRemoteAt) {
          patch({ status: 'choice', remote });
          return;
        }
      }
      // what is waiting in the store's own save goes to this phone's storage first
      flushSaves();
      await afterInteractions();
      const { json, hash, attachments } = await buildSnapshot();
      // nothing changed since the last backup: nothing goes up
      if (hash === meta.lastHash && !force) {
        patch({ status: 'idle', pending: false, progress: null });
        return;
      }
      const skipped = await sendFiles(s, userId, attachments);
      const updatedAt = new Date().toISOString();
      const { data, error } = await cloud().from('backups').upsert({
        user_id: userId, snapshot: json, device: deviceName(), device_id: meta.deviceId, app_version: appVersion(),
        bytes: json.length, files: attachments.length - skipped, updated_at: updatedAt,
      }).select('updated_at').single();
      if (error) throw error;
      meta.lastRemoteAt = data?.updated_at ?? updatedAt;
      meta.lastHash = hash;
      meta.lastSyncedAt = Date.now();
      await saveMeta();
      patch({
        status: 'idle', lastSyncedAt: meta.lastSyncedAt, remote: null, pending: false, progress: null,
        note: skipped ? (skipped === 1 ? 'One attachment did not fit' : skipped + ' attachments did not fit') + ' (20 MB each, 120 MB in all).' : null,
      });
      refreshUsage().catch(() => {});
    } catch (e) {
      patch({ status: 'error', error: describe(e), progress: null });
    }
  })().finally(() => { running = null; });
  return running;
}

/** Uploads the attachments the cloud lacks and clears the ones no note uses. Returns how many could not go up. */
async function sendFiles(s: Session, userId: string, attachments: Attachment[]): Promise<number> {
  const folder = userId + '/att';
  const have = new Map<string, number>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await cloud().storage.from(BUCKET).list(folder, { limit: 1000, offset });
    if (error) throw error;
    for (const f of data || []) have.set(f.name, Number((f.metadata as any)?.size) || 0);
    if (!data || data.length < 1000) break;
  }
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
    if (res.status >= 300) throw new Error('Upload failed (' + res.status + '): ' + (res.body || '').slice(0, 120));
    done += size;
  }
  patch({ progress: todo.length ? 1 : null });
  // files no note uses any more leave the cloud too
  const gone = [...have.keys()].filter((name) => !wanted.has(name)).map((name) => folder + '/' + name);
  for (let i = 0; i < gone.length; i += 100) {
    const { error } = await cloud().storage.from(BUCKET).remove(gone.slice(i, i + 100));
    if (error) throw error;
  }
  return skipped;
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
      if (!data) throw new Error('There is no copy in the cloud yet.');
      // the copy comes down whole before anything here is replaced
      if (!importSnapshot(data.snapshot)) throw new Error('The cloud copy could not be read by this version of the app.');
      try { await restoreBodies(JSON.parse(data.snapshot)?.journal); } catch { /* the index is back either way */ }
      const attachments = useStore.getState().notes.flatMap((n) => n.attachments || []);
      const folder = s.user.id + '/att';
      const relinked: Record<string, string> = {};
      await FileSystem.makeDirectoryAsync(ATT_DIR, { intermediates: true }).catch(() => {});
      for (let i = 0; i < attachments.length; i++) {
        const a = attachments[i];
        patch({ progress: attachments.length ? i / attachments.length : null });
        const dest = restoredPath(a);
        try {
          const res = await FileSystem.downloadAsync(`${SUPABASE_URL}/storage/v1/object/authenticated/${BUCKET}/${folder}/${a.id}`, dest, {
            headers: { Authorization: 'Bearer ' + s.access_token, apikey: SUPABASE_KEY },
          });
          if (res.status >= 300) { missing++; await FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => {}); continue; }
          relinked[a.id] = dest;
        } catch {
          missing++;
        }
      }
      useStore.getState().relinkAttachments(relinked);
      flushSaves();
      const { hash } = await buildSnapshot();
      meta.lastRemoteAt = data.updated_at;
      meta.lastHash = hash;
      meta.lastSyncedAt = Date.now();
      await saveMeta();
      patch({ status: 'idle', remote: null, pending: false, progress: null, lastSyncedAt: meta.lastSyncedAt });
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require('./notifications').rescheduleAllReminders();
      } catch { /* reminders follow on the next launch */ }
    } catch (e) {
      patch({ status: 'error', error: describe(e), progress: null });
      throw e;
    }
  })().finally(() => { running = null; });
  await running;
  return { missing };
}

/** The user chose this phone's data over a newer cloud copy: it goes up and replaces that copy. */
export async function keepThisPhone() {
  patch({ remote: null });
  await syncNow(true);
}
