import * as FileSystem from 'expo-file-system';
import { useStore, JournalEntry, trashedEntryIds } from './store';
import { uid } from './utils';
import { pdir } from './profiles';
import { countWords, excerptOf } from './journalCore';

// The Journal's data layer. The store keeps a small index per entry; the text of every entry lives in its
// own file. The journal's index is one AsyncStorage row, and Android cannot read a row over about 2 MB,
// which a daily journal's texts would eventually reach.

const DIR = pdir('journal/');
/** where each entry's text lives, one file per entry (erasing the phone empties it); each profile has its own */
export const JOURNAL_DIR = DIR;
const pathFor = (id: string) => DIR + id + '.txt';

let dirReady: Promise<void> | null = null;
function ensureDir(): Promise<void> {
  if (!dirReady) dirReady = FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
  return dirReady;
}

const cache = new Map<string, string>();

/** the saves and deletes on their way, so a profile switch can wait for a page's last words to be written */
const inFlight = new Set<Promise<unknown>>();
function track<R>(work: Promise<R>): Promise<R> {
  inFlight.add(work);
  work.finally(() => { inFlight.delete(work); }).catch(() => {});
  return work;
}

/** Resolves once every save and delete of a journal text on its way has finished (or failed). */
export async function journalSettled(): Promise<void> {
  while (inFlight.size) await Promise.all([...inFlight].map((w) => w.then(() => undefined, () => undefined)));
}

/** The text of an entry ('' when it has none yet). Cached after the first read. */
export async function readBody(id: string): Promise<string> {
  const hit = cache.get(id);
  if (hit !== undefined) return hit;
  try {
    const text = await FileSystem.readAsStringAsync(pathFor(id));
    cache.set(id, text);
    return text;
  } catch {
    return '';
  }
}

function writeBody(id: string, text: string): Promise<void> {
  return track((async () => {
    await ensureDir();
    await FileSystem.writeAsStringAsync(pathFor(id), text);
    cache.set(id, text);
  })());
}

async function deleteBody(id: string): Promise<void> {
  cache.delete(id);
  try {
    await FileSystem.deleteAsync(pathFor(id), { idempotent: true });
  } catch {
    // already gone
  }
}


export interface EntryDraft {
  id?: string;
  dateKey: string;
  title: string;
  body: string;
  /** mood, rating and skipped: a draft that carries the key decides, even when it clears the value */
  mood?: JournalEntry['mood'];
  rating?: JournalEntry['rating'];
  checkoutSkipped?: boolean;
  tags?: string[];
  pinned?: boolean;
  promptId?: string;
}

/**
 * Saves an entry: its text to its file, then its index to the store, so the index never points at text that
 * was not written. Creates the entry when `id` is new. Returns the id.
 */
export function saveEntry(d: EntryDraft): Promise<string> {
  return track(saveEntryNow(d));
}

async function saveEntryNow(d: EntryDraft): Promise<string> {
  const id = d.id || uid();
  await writeBody(id, d.body);
  // read after the write, so a pin or a change of day made while the file was being written is kept
  const { journal, upsertJournalEntry } = useStore.getState();
  const existing = d.id ? journal.find((e) => e.id === d.id) : undefined;
  const carries = (k: keyof EntryDraft) => Object.prototype.hasOwnProperty.call(d, k);
  const now = Date.now();
  const entry: JournalEntry = {
    id,
    // an entry that already exists keeps the store's day, so a move made in the archive is never written back
    dateKey: existing?.dateKey ?? d.dateKey,
    title: d.title.trim(),
    excerpt: excerptOf(d.body),
    wordCount: countWords(d.body),
    tags: d.tags ?? existing?.tags ?? [],
    pinned: d.pinned ?? existing?.pinned ?? false,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const mood = carries('mood') ? d.mood : existing?.mood;
  const rating = carries('rating') ? d.rating : existing?.rating;
  const skipped = carries('checkoutSkipped') ? d.checkoutSkipped : existing?.checkoutSkipped;
  const promptId = d.promptId ?? existing?.promptId;
  if (mood) entry.mood = mood;
  if (rating) entry.rating = rating;
  if (skipped) entry.checkoutSkipped = true;
  if (promptId) entry.promptId = promptId;
  upsertJournalEntry(entry);
  return id;
}

export function deleteEntry(id: string): Promise<void> {
  useStore.getState().removeJournalEntry(id);
  return track(deleteBody(id));
}

/** Deletes the texts of entries gone for good (from Recently deleted). */
export async function deleteBodies(ids: string[]): Promise<void> {
  await Promise.all(ids.map((id) => deleteBody(id)));
}

// ---------- the pure part (days, records, prompts, moods, stats, search) lives in journalCore.ts ----------

export * from './journalCore';

/** Loads the text of every entry (for full-text search), reading only what is not cached yet. */
export async function loadBodies(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await Promise.all(ids.map(async (id) => out.set(id, await readBody(id))));
  return out;
}

// ---------- backups ----------

/**
 * The journal index with every entry's text, for a backup file or the cloud copy. The texts of entries in Recently
 * deleted follow, as `{ id, body, inTrash }` with no day: their index travels in the trash, an import writes their
 * texts back with the others (restoreBodies), and no version of the app takes them for entries.
 */
export async function journalForBackup(entries: JournalEntry[]) {
  const live = await Promise.all(entries.map(async (e) => ({ ...e, body: await readBody(e.id) })));
  const here = new Set(entries.map((e) => e.id));
  const trashed = trashedEntryIds(useStore.getState().trash).filter((id) => !here.has(id));
  const kept = await Promise.all(trashed.map(async (id) => ({ id, body: await readBody(id), inTrash: true as const })));
  return [...live, ...kept];
}

/** Writes the text carried by a restored backup's entries to their files. */
// A restore writes the index first and the texts after it, so a page open meanwhile hears when the texts are in.
const restoredListeners = new Set<() => void>();

/** Called once a restore has written its texts; returns the unsubscribe. */
export function onBodiesRestored(fn: () => void): () => void {
  restoredListeners.add(fn);
  return () => { restoredListeners.delete(fn); };
}

export async function restoreBodies(items: unknown): Promise<void> {
  if (!Array.isArray(items)) return;
  try {
    for (const it of items as any[]) {
      if (it && typeof it.id === 'string' && typeof it.body === 'string') await writeBody(it.id, it.body);
    }
  } finally {
    restoredListeners.forEach((fn) => fn());
  }
}

// ---------- opening a chosen entry ----------
// The archive picks an entry, then returns to the writing space, which takes the request on focus. The same
// path works in a tab slot and on a full page.

type OpenRequest = { dateKey: string; entryId?: string; at: number };
let pendingOpen: OpenRequest | null = null;
const openListeners = new Set<() => void>();

/** A request older than this was never taken and is no longer wanted. */
const OPEN_REQUEST_TTL_MS = 10_000;

export function requestJournalOpen(dateKey: string, entryId?: string): OpenRequest {
  pendingOpen = { dateKey, entryId, at: Date.now() };
  openListeners.forEach((fn) => fn());
  return pendingOpen;
}

export function takeJournalOpenRequest() {
  const p = pendingOpen;
  pendingOpen = null;
  // a request nobody took long ago must not take over the Journal now
  return p && Date.now() - p.at <= OPEN_REQUEST_TTL_MS ? p : null;
}

/**
 * Called when a request is made, so a Journal that is already in front (no focus event to take it) follows it at once.
 * Returns the unsubscribe.
 */
export function onJournalOpenRequest(fn: () => void): () => void {
  openListeners.add(fn);
  return () => { openListeners.delete(fn); };
}

/** Drops a request if nothing took it, so it never takes over the Journal the next time it is opened, days later. */
export function clearJournalOpenRequest(req: OpenRequest) {
  if (pendingOpen === req) pendingOpen = null;
}
