import { create } from 'zustand';
import * as FileSystem from 'expo-file-system';

// Profiles: separate people, or separate accounts, on one phone. Each profile has its own everything: the store's rows,
// the journal's texts, attachments, the PIN, the cloud account and its session, the backup record and the last export
// date. The first profile on a phone ('main') keeps the keys and folders the app always used, so nothing moves for it;
// another profile's keys carry its id as a suffix ('student-hub-v2__k3x9q2m1za:notes') and its folders sit under
// profiles/<id>/. Which profile is in use is read once, at launch: switching restarts the app into the other one, so
// every module's keys are constants for the life of the process and nothing can bleed from one profile to another.
//
// This module stays light: only zustand and the file system at load (the tests load it in Node), everything else is
// required where it is used.

export type ProfileId = string;

export interface ProfileInfo {
  id: ProfileId;
  name: string;
  /** the profile's accent, which tints its avatar */
  color: string;
  /** the cloud account signed in on it, or null */
  email: string | null;
  createdAt: number;
  /**
   * When the profile's photo was last written to its file (avatarFile), ms; absent while it has none. Only this travels
   * in the registry, so the first-frame read stays small: the photo itself is read from the file by whoever shows it.
   */
  avatarRev?: number;
}

export const MAX_PROFILES = 5;
/** a profile's name, as long as the greeting's */
export const PROFILE_NAME_MAX = 30;

/** which profile is in use (the keystore, read synchronously at launch) */
const ACTIVE_KEY = 'sturoids.profile.active';
/** every profile on the phone: global, never per profile */
const REGISTRY_KEY = 'sturoids-profiles';
/** set just before a switch restarts the app, so the launch it starts skips the intro and says where it is */
const SWITCHED_KEY = 'sturoids-switched';
/** how long a switch's note stays good: a launch long after it is an ordinary launch */
const SWITCHED_FRESH_MS = 60 * 1000;
/** the keystore's PIN and its wrong-guess count (lock.ts), per profile through pkey */
export const PIN_BASE = 'sturoids.pin.v2';
export const PIN_ATTEMPTS_BASE = 'sturoids.pinAttempts.v2';
/** the cloud session of a profile other than the first (cloud.ts); the first keeps Supabase's default key */
const SESSION_BASE = 'sb-sturoids-auth';
/** the store's base key (store.ts STORE_KEY): a profile with data has its meta row under it */
const STORE_BASE = 'student-hub-v2';
/** the default accent (theme.ts DEFAULT_ACCENT), for an entry whose colour was lost */
const FALLBACK_COLOR = '#9588F9';

export const isProfileId = (v: unknown): v is ProfileId =>
  typeof v === 'string' && (v === 'main' || /^[a-z0-9]{10}$/.test(v));

function secureStore(): typeof import('expo-secure-store') | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('expo-secure-store') as typeof import('expo-secure-store');
  } catch {
    return null;
  }
}

function readActive(): ProfileId {
  try {
    const v = secureStore()?.getItem(ACTIVE_KEY);
    return isProfileId(v) ? v : 'main';
  } catch {
    // an unreadable keystore opens the first profile, whose keys never change
    return 'main';
  }
}

/** The profile this launch runs. */
export const activeProfile: ProfileId = readActive();

/** A per-profile storage key: the first profile's is the key itself, another's carries its id ('key__id'). */
export function pkey(base: string, id: ProfileId = activeProfile): string {
  return id === 'main' ? base : base + '__' + id;
}

/** A per-profile folder in the documents directory (`sub` ends with '/'): another profile's sits under profiles/<id>/. */
export function pdir(sub: string, id: ProfileId = activeProfile): string {
  return (FileSystem.documentDirectory || '') + (id === 'main' ? sub : 'profiles/' + id + '/' + sub);
}

/** A profile's photo as a file of its own (a copy of its settings' avatar), so other profiles can show it too. */
export const avatarFile = (id: ProfileId = activeProfile): string => pdir('avatar.jpg', id);

/** The key the cloud keeps a profile's session under: null for the first profile, which keeps Supabase's default. */
export function sessionKey(id: ProfileId = activeProfile): string | null {
  return id === 'main' ? null : SESSION_BASE + '__' + id;
}

// ---------------------------------------------------------------- pure parts (scripts/test-profiles.js)

/**
 * The storage keys that belong to profile `id`: its suffix ends the key, or comes right before the ':' of a row or the
 * '-' of the session's own extras. Never the first profile's (its keys carry no suffix), and never another id's, since
 * every id is ten characters: '__abc' never matches '__abcd'.
 */
export function keysOfProfile(all: readonly string[], id: ProfileId): string[] {
  if (id === 'main' || !isProfileId(id)) return [];
  const mine = new RegExp('__' + id + '(?:$|[:-])');
  return all.filter((k) => typeof k === 'string' && mine.test(k));
}

/** The profiles other than the first that have saved data on this phone, from the store's meta rows. */
export function profilesWithData(all: readonly string[]): ProfileId[] {
  const out: ProfileId[] = [];
  const meta = new RegExp('^' + STORE_BASE.replace(/[-]/g, '\\-') + '__([a-z0-9]{10}):meta$');
  for (const k of all) {
    const m = typeof k === 'string' ? meta.exec(k) : null;
    if (m && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

const isRecord = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const isColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

export function cleanName(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, PROFILE_NAME_MAX) : '';
}

/**
 * The registry as it can be trusted: entries with a valid id, once each, the first profile always there and first, the
 * others in the order they were made. A profile whose data is on the phone but whose entry was lost (`found`) comes
 * back with no name, so its data is never stranded. Nothing is dropped for being over MAX_PROFILES.
 */
export function cleanRegistry(raw: unknown, main: ProfileInfo, found: readonly string[] = []): ProfileInfo[] {
  const list = isRecord(raw) && Array.isArray(raw.list) ? raw.list : [];
  const seen = new Set<string>();
  let first: ProfileInfo | null = null;
  const rest: ProfileInfo[] = [];
  for (const p of list) {
    if (!isRecord(p) || !isProfileId(p.id) || seen.has(p.id)) continue;
    seen.add(p.id);
    const entry: ProfileInfo = {
      id: p.id,
      name: cleanName(p.name),
      color: isColor(p.color) ? p.color : FALLBACK_COLOR,
      email: typeof p.email === 'string' && p.email.trim() ? p.email.trim() : null,
      createdAt: typeof p.createdAt === 'number' && Number.isFinite(p.createdAt) ? p.createdAt : 0,
    };
    if (typeof p.avatarRev === 'number' && Number.isFinite(p.avatarRev) && p.avatarRev > 0) entry.avatarRev = p.avatarRev;
    if (entry.id === 'main') first = entry;
    else rest.push(entry);
  }
  for (const id of found) {
    if (!isProfileId(id) || id === 'main' || seen.has(id)) continue;
    seen.add(id);
    rest.push({ id, name: '', color: FALLBACK_COLOR, email: null, createdAt: Date.now() });
  }
  rest.sort((a, b) => a.createdAt - b.createdAt);
  return [first ?? { ...main, id: 'main', name: cleanName(main.name), color: isColor(main.color) ? main.color : FALLBACK_COLOR }, ...rest];
}

/** A new profile's id: ten lowercase letters and digits, never one already in `taken`. */
export function newProfileId(taken: readonly string[] = [], rand: () => number = Math.random): ProfileId {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  for (;;) {
    let id = '';
    for (let i = 0; i < 10; i++) id += abc[Math.floor(rand() * abc.length) % abc.length];
    if (!taken.includes(id)) return id;
  }
}

/** Whether a switch's note names profile `active` and was written just now (a launch it started). */
export function arrivalValid(raw: string | null, active: ProfileId, now = Date.now()): boolean {
  if (!raw) return false;
  try {
    const v = JSON.parse(raw);
    const at = Number(v?.at);
    return v?.to === active && Number.isFinite(at) && now - at < SWITCHED_FRESH_MS && at - now < 5000;
  } catch {
    return false;
  }
}

/** The other profile on this phone that already holds this cloud account, if any (emails compared without case). */
export function profileWithEmail(list: readonly ProfileInfo[], email: string, except: ProfileId = activeProfile): ProfileInfo | null {
  const e = email.trim().toLowerCase();
  if (!e) return null;
  return list.find((p) => p.id !== except && !!p.email && p.email.trim().toLowerCase() === e) ?? null;
}

/** A profile's name for the screen. */
export const profileName = (p: Pick<ProfileInfo, 'name'> | null | undefined): string => (p?.name.trim() || 'Unnamed profile');

/** Up to two initials, or one letter, for a profile's avatar. */
export function profileInitial(p: Pick<ProfileInfo, 'name' | 'email'>): string {
  const words = (p.name.trim() || (p.email || '').split('@')[0].replace(/[._-]+/g, ' ')).split(/\s+/).filter(Boolean);
  // by code point, so a name that opens with an emoji never leaves half of one
  return (Array.from(words[0] || '')[0] || '').toUpperCase();
}

// ---------------------------------------------------------------- the registry

export interface ProfilesState {
  list: ProfileInfo[];
  loaded: boolean;
  /** a switch on its way: the overlay covers the app. `stuck` when the app could not restart itself */
  switching: null | { to: ProfileInfo; stuck?: boolean };
}

export const useProfiles = create<ProfilesState>(() => ({ list: [], loaded: false, switching: null }));

function asyncStorage(): typeof import('@react-native-async-storage/async-storage').default {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return (require('@react-native-async-storage/async-storage') as typeof import('@react-native-async-storage/async-storage')).default;
}

function storeModule(): typeof import('./store') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('./store') as typeof import('./store');
}

/** The cloud module once something has loaded it (the app does after the intro); never loaded from here. */
function cloudModule(): typeof import('./cloud') | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('./cloud') as typeof import('./cloud');
  } catch {
    return null;
  }
}

function say(message: string) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    (require('./components/Toast') as typeof import('./components/Toast')).toast(message);
  } catch {
    // no toast host
  }
}

/** set once the registry has been read cleanly: a registry that could not be read is never written over */
let registryReadOk = false;

/** What the first profile's entry is when there is no registry yet: the store's name and accent when it is in use. */
function mainFallback(): ProfileInfo {
  if (activeProfile !== 'main') return { id: 'main', name: '', color: FALLBACK_COLOR, email: null, createdAt: 0 };
  const { settings } = storeModule().useStore.getState();
  return { id: 'main', name: cleanName(settings.name), color: settings.accent || FALLBACK_COLOR, email: null, createdAt: 0 };
}

/** Reads the registry: null when storage could not be read at all. `same` when what was read needs no writing back. */
async function readRegistry(): Promise<{ list: ProfileInfo[]; same: boolean } | null> {
  const AS = asyncStorage();
  let text: string | null;
  try {
    text = await AS.getItem(REGISTRY_KEY);
  } catch {
    return null;
  }
  let raw: unknown = null;
  if (text != null) {
    try {
      raw = JSON.parse(text);
    } catch {
      raw = null;
    }
  }
  let found: string[] = [];
  try {
    found = profilesWithData(await AS.getAllKeys());
  } catch {
    // the profiles named in the registry are still there
  }
  const list = cleanRegistry(raw, mainFallback(), found);
  return { list, same: text === JSON.stringify({ v: 1, list }) };
}

/**
 * Makes sure the registry has been read: one that could not be read at launch is read again now. What was on disk is
 * kept, with this profile's own entry as the app knows it. False while it still cannot be read.
 */
async function ensureRegistry(): Promise<boolean> {
  if (registryReadOk) return true;
  const read = await readRegistry();
  if (!read) return false;
  registryReadOk = true;
  const mine = useProfiles.getState().list.find((p) => p.id === activeProfile);
  let next = read.list.map((p) => (mine && p.id === mine.id ? mine : p));
  if (mine && !next.some((p) => p.id === mine.id)) next = [...next, mine];
  useProfiles.setState({ list: next });
  return true;
}

/** writes run one after another, so an older list never lands after a newer one */
let writing: Promise<boolean> = Promise.resolve(true);

/** Saves the list. A registry that could not be read is read again first, and never written over while it fails. */
function writeRegistry(list: ProfileInfo[]): Promise<boolean> {
  writing = writing.then(async () => {
    let next = list;
    if (!registryReadOk) {
      if (!(await ensureRegistry())) return false;
      // the list as it was on disk, with this profile's entry as the app knows it
      next = useProfiles.getState().list;
    }
    try {
      await asyncStorage().setItem(REGISTRY_KEY, JSON.stringify({ v: 1, list: next }));
      return true;
    } catch {
      return false;
    }
  });
  return writing;
}

let syncTimer: ReturnType<typeof setTimeout> | null = null;
/** set once the active profile's entry follows its settings (see startSync) */
let syncing = false;

/** Writes the registry now if the active profile's entry is waiting for its pause. */
function flushRegistry(): Promise<boolean> {
  if (!syncTimer) return writing;
  clearTimeout(syncTimer);
  syncTimer = null;
  return writeRegistry(useProfiles.getState().list);
}

/** Changes the active profile's entry, and saves the registry after a short pause. */
function patchActive(p: Partial<Omit<ProfileInfo, 'id'>>) {
  const { list } = useProfiles.getState();
  const at = list.findIndex((x) => x.id === activeProfile);
  if (at < 0) return;
  const cur = list[at];
  const next = { ...cur, ...p };
  if (next.name === cur.name && next.color === cur.color && next.email === cur.email && next.avatarRev === cur.avatarRev) return;
  if (!next.avatarRev) delete next.avatarRev;
  useProfiles.setState({ list: list.map((x, i) => (i === at ? next : x)) });
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void writeRegistry(useProfiles.getState().list);
  }, 500);
}

/** an account the cloud named before the registry had loaded */
let pendingEmail: { email: string | null } | null = null;

/**
 * The cloud tells the registry which account the profile in use is signed in to (null when signed out), so another
 * profile can refuse the same account. Called by cloud.ts once it has looked at its session.
 */
export function noteActiveEmail(email: string | null) {
  const clean = email ? email.trim() : null;
  // heard before the registry has loaded: kept for it
  if (!syncing) {
    pendingEmail = { email: clean };
    return;
  }
  patchActive({ email: clean });
}

let loading: Promise<void> | null = null;

/**
 * Reads the registry once the store has loaded (the root layout calls it), makes sure this profile is in it, lets a
 * fresh profile take the name and colour it was made with, and keeps this profile's entry in step from then on.
 * Always ends loaded, so the app never waits on it.
 */
export function loadProfiles(): Promise<void> {
  if (!loading) loading = doLoad();
  return loading;
}

async function doLoad() {
  try {
    const store = storeModule();
    const read = await readRegistry();
    let list = read ? read.list : cleanRegistry(null, mainFallback());
    registryReadOk = !!read;
    const { settings, setSetting } = store.useStore.getState();
    let me = list.find((p) => p.id === activeProfile);
    if (!me) {
      // the registry lost this profile's entry (or never had it): it comes back from the profile's own settings
      me = { id: activeProfile, name: cleanName(settings.name), color: settings.accent || FALLBACK_COLOR, email: null, createdAt: Date.now() };
      list = [...list, me];
    }
    // only data that loaded cleanly speaks for the profile: defaults standing in for unreadable settings never would
    const trusted = store.localDataState() === 'ok';
    if (trusted && activeProfile !== 'main' && store.loadedFresh()) {
      // a profile on its first launch takes the name and colour it was made with
      if (me.name && !settings.name.trim()) setSetting('name', me.name);
      if (isColor(me.color) && settings.accent !== me.color) setSetting('accent', me.color);
    } else if (trusted && me.name && me.name !== settings.name) {
      // renamed from another profile: the registry's name wins once, and from here the two stay in step
      setSetting('name', me.name);
    }
    useProfiles.setState({ list, loaded: true });
    // written back once it has been read cleanly, when cleaning it (or adding this profile) changed it
    if (read && (!read.same || list !== read.list)) void writeRegistry(list);
    startSync(trusted);
  } catch {
    useProfiles.setState({ loaded: true });
  }
}

function startSync(trusted: boolean) {
  if (syncing) return;
  syncing = true;
  const store = storeModule();
  const follow = () => {
    // a launch whose data did not load runs on defaults, which are not this profile's name or colour
    if (store.localDataState() !== 'ok') return;
    const { name, accent } = store.useStore.getState().settings;
    patchActive({ name: cleanName(name), color: isColor(accent) ? accent : FALLBACK_COLOR });
  };
  if (trusted) follow();
  store.useStore.subscribe((s, prev) => {
    if (s.settings.name !== prev.settings.name || s.settings.accent !== prev.settings.accent) follow();
    if (s.settings.avatar !== prev.settings.avatar) mirrorAvatarSoon();
  });
  // the photo's file is made at launch when it is missing (a photo set before files were kept, or restored with a backup)
  if (trusted) void mirrorAvatar(true);
  if (pendingEmail) {
    const { email } = pendingEmail;
    pendingEmail = null;
    patchActive({ email });
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AppState } = require('react-native') as typeof import('react-native');
    AppState.addEventListener('change', (next) => { if (next !== 'active') void flushRegistry(); });
  } catch {
    // no app lifecycle here
  }
}

let avatarTimer: ReturnType<typeof setTimeout> | null = null;
/** mirrors run one after another, so an older photo never lands after a newer one */
let mirroring: Promise<void> = Promise.resolve();

function mirrorAvatarSoon() {
  if (avatarTimer) clearTimeout(avatarTimer);
  avatarTimer = setTimeout(() => {
    avatarTimer = null;
    void mirrorAvatar(false);
  }, 500);
}

/**
 * Keeps the active profile's photo file in step with its settings' avatar: written (base64 JPEG) when there is one, and
 * deleted when it is cleared, then the registry's avatarRev says so. `onlyIfMissing` (at launch) writes it only when the
 * file is not there, or the registry has no revision for it.
 */
function mirrorAvatar(onlyIfMissing: boolean): Promise<void> {
  mirroring = mirroring.then(async () => {
    const store = storeModule();
    if (store.localDataState() !== 'ok') return;
    const avatar = store.useStore.getState().settings.avatar;
    const file = avatarFile();
    const me = useProfiles.getState().list.find((x) => x.id === activeProfile);
    try {
      const comma = typeof avatar === 'string' && avatar.startsWith('data:image/') ? avatar.indexOf(',') : -1;
      if (comma < 0) {
        if (onlyIfMissing && !me?.avatarRev) return;
        await FileSystem.deleteAsync(file, { idempotent: true });
        patchActive({ avatarRev: undefined });
        return;
      }
      if (onlyIfMissing && me?.avatarRev) {
        const info = await FileSystem.getInfoAsync(file);
        if (info.exists) return;
      }
      if (activeProfile !== 'main') await FileSystem.makeDirectoryAsync(pdir(''), { intermediates: true }).catch(() => {});
      await FileSystem.writeAsStringAsync(file, avatar.slice(comma + 1), { encoding: FileSystem.EncodingType.Base64 });
      patchActive({ avatarRev: Date.now() });
    } catch {
      // the photo still shows from the settings for this profile; others show the initial until the next try
    }
  });
  return mirroring;
}

/** Reads and clears a switch's note: true when this launch is the one a switch just started. */
export async function takeArrival(): Promise<boolean> {
  const AS = asyncStorage();
  let raw: string | null = null;
  try {
    raw = await AS.getItem(SWITCHED_KEY);
  } catch {
    return false;
  }
  if (raw == null) return false;
  AS.removeItem(SWITCHED_KEY).catch(() => {});
  return arrivalValid(raw, activeProfile);
}

/** The other profile that already holds this cloud account, if any. */
export function accountTakenBy(email: string): ProfileInfo | null {
  return profileWithEmail(useProfiles.getState().list, email);
}

/** What a sign-in into an account another profile holds is told. */
export const takenMessage = (p: ProfileInfo) =>
  'That account is already on this phone as ' + profileName(p) + '. Switch to that profile instead.';

// ---------------------------------------------------------------- changes

/** Adds a profile and switches to it. 'name' when the name is empty, 'full' at MAX_PROFILES, 'error' when it could not be saved. */
export async function addProfile(name: string, color: string): Promise<'ok' | 'full' | 'name' | 'error'> {
  const clean = cleanName(name);
  if (!clean) return 'name';
  await flushRegistry();
  if (!(await ensureRegistry())) return 'error';
  const { list } = useProfiles.getState();
  if (list.length >= MAX_PROFILES) return 'full';
  const entry: ProfileInfo = {
    id: newProfileId(list.map((p) => p.id)), name: clean, color: isColor(color) ? color : FALLBACK_COLOR, email: null,
    createdAt: Date.now(),
  };
  const next = [...list, entry];
  if (!(await writeRegistry(next))) return 'error';
  useProfiles.setState({ list: next });
  await switchProfile(entry.id);
  return 'ok';
}

/**
 * Renames a profile. The one in use takes the name in its settings at once (the greeting's name); another keeps it in
 * the registry and adopts it on its next launch.
 */
export async function renameProfile(id: ProfileId, name: string): Promise<'ok' | 'name' | 'error'> {
  const clean = cleanName(name);
  if (!clean) return 'name';
  if (id === activeProfile) {
    storeModule().useStore.getState().setSetting('name', clean);
    patchActive({ name: clean });
    return (await flushRegistry()) ? 'ok' : 'error';
  }
  await flushRegistry();
  if (!(await ensureRegistry())) return 'error';
  const next = useProfiles.getState().list.map((p) => (p.id === id ? { ...p, name: clean } : p));
  if (!(await writeRegistry(next))) return 'error';
  useProfiles.setState({ list: next });
  return 'ok';
}

/**
 * Deletes a profile other than the one in use and the first one (whose keys carry no suffix: Delete everything is for
 * that): its rows, its folder, its PIN and its cloud session on this phone, then its entry. Its cloud copy stays.
 */
export async function removeProfile(id: ProfileId): Promise<'ok' | 'refused' | 'error'> {
  if (id === activeProfile || id === 'main' || !isProfileId(id)) return 'refused';
  try {
    const AS = asyncStorage();
    const keys = keysOfProfile(await AS.getAllKeys(), id);
    if (keys.length) await AS.multiRemove(keys);
    await FileSystem.deleteAsync(pdir('', id), { idempotent: true });
    const SS = secureStore();
    if (SS) await Promise.all([pkey(PIN_BASE, id), pkey(PIN_ATTEMPTS_BASE, id)].map((k) => SS.deleteItemAsync(k).catch(() => {})));
  } catch {
    // the entry stays, so the delete can be asked for again
    return 'error';
  }
  await flushRegistry();
  if (!(await ensureRegistry())) return 'error';
  const next = useProfiles.getState().list.filter((p) => p.id !== id);
  if (!(await writeRegistry(next))) return 'error';
  useProfiles.setState({ list: next });
  return 'ok';
}

const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Lays the reminders out again after a switch that did not happen (they were all cancelled on the way). */
function restoreReminders() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    (require('./notifications') as typeof import('./notifications')).rescheduleAllReminders().catch(() => {});
  } catch {
    // no reminders module
  }
}

/** The switch did not happen: this profile stays in use, as it was. */
export function cancelSwitch() {
  try {
    secureStore()?.setItem(ACTIVE_KEY, activeProfile);
  } catch {
    // the keystore still names the other profile: the next launch opens it, which is what was asked for
  }
  asyncStorage().removeItem(SWITCHED_KEY).catch(() => {});
  useProfiles.setState({ switching: null });
  restoreReminders();
}

/** Closes the app, for a switch the app could not restart itself into: opening it again finishes the switch. */
export function closeToFinish() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { BackHandler } = require('react-native') as typeof import('react-native');
  BackHandler.exitApp();
}

/**
 * Switches to another profile: everything waiting is saved, every reminder is cancelled (the other profile lays out its
 * own as it starts), the keystore names the new profile, and the app restarts into it. Refused while a Deep Work
 * session runs or a backup is being sent.
 */
export async function switchProfile(id: ProfileId): Promise<'ok' | 'same' | 'refused'> {
  if (id === activeProfile) return 'same';
  const state = useProfiles.getState();
  const to = state.list.find((p) => p.id === id);
  if (!to || state.switching) return 'refused';
  const store = storeModule();
  if (store.useStore.getState().deepWork) {
    say('End the Deep Work session first');
    return 'refused';
  }
  if (cloudModule()?.useCloud.getState().status === 'syncing') {
    say('Wait for the backup to finish');
    return 'refused';
  }
  useProfiles.setState({ switching: { to } });
  try {
    // a journal page's last words, then every row the store has waiting, written to the disk
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      await (require('./journal') as typeof import('./journal')).journalSettled();
    } catch {
      // no journal write in flight
    }
    await store.flushSaves();
    if (store.savesFailing()) await store.flushSaves();
    if (store.savesFailing()) {
      // the changes are still only in the app: leaving now would lose them
      useProfiles.setState({ switching: null });
      say('Your changes could not be saved yet. Try again');
      return 'refused';
    }
    await flushRegistry();
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      await (require('expo-notifications') as typeof import('expo-notifications')).cancelAllScheduledNotificationsAsync();
    } catch {
      // no notification service
    }
    const SS = secureStore();
    if (!SS) throw new Error('no keystore');
    SS.setItem(ACTIVE_KEY, id);
    await asyncStorage().setItem(SWITCHED_KEY, JSON.stringify({ to: id, at: Date.now() })).catch(() => {});
  } catch {
    cancelSwitch();
    say('Could not switch profiles. Try again');
    return 'refused';
  }
  // the overlay has covered the app before it goes
  await pause(240);
  let restarted = false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    restarted = (require('../modules/app-restart') as typeof import('../modules/app-restart')).restartApp();
  } catch {
    restarted = false;
  }
  if (restarted) return 'ok';
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      (require('react-native') as typeof import('react-native')).DevSettings.reload();
      return 'ok';
    } catch {
      // no dev reload: ask to reopen
    }
  }
  useProfiles.setState({ switching: { to, stuck: true } });
  return 'ok';
}
