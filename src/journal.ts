import * as FileSystem from 'expo-file-system';
import { useStore, JournalEntry } from './store';
import { streaks, todayKey, uid } from './utils';

// The Journal's data layer. The store keeps a small index per entry; the text of every entry lives in its
// own file. The whole store is one AsyncStorage row, and Android cannot read a row over about 2 MB, which a
// daily journal would eventually reach.

const DIR = (FileSystem.documentDirectory || '') + 'journal/';
const EXCERPT_LEN = 200;
const pathFor = (id: string) => DIR + id + '.txt';

let dirReady: Promise<void> | null = null;
function ensureDir(): Promise<void> {
  if (!dirReady) dirReady = FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
  return dirReady;
}

const cache = new Map<string, string>();

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

async function writeBody(id: string, text: string): Promise<void> {
  await ensureDir();
  await FileSystem.writeAsStringAsync(pathFor(id), text);
  cache.set(id, text);
}

async function deleteBody(id: string): Promise<void> {
  cache.delete(id);
  try {
    await FileSystem.deleteAsync(pathFor(id), { idempotent: true });
  } catch {
    // already gone
  }
}

export function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

export function excerptOf(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, EXCERPT_LEN);
}

export interface EntryDraft {
  id?: string;
  dateKey: string;
  title: string;
  body: string;
  mood?: JournalEntry['mood'];
  tags?: string[];
  pinned?: boolean;
  promptId?: string;
}

/**
 * Saves an entry: its text to its file, then its index to the store, so the index never points at text that
 * was not written. Creates the entry when `id` is new. Returns the id.
 */
export async function saveEntry(d: EntryDraft): Promise<string> {
  const { journal, upsertJournalEntry } = useStore.getState();
  const existing = d.id ? journal.find((e) => e.id === d.id) : undefined;
  const id = d.id || uid();
  await writeBody(id, d.body);
  const now = Date.now();
  upsertJournalEntry({
    id,
    dateKey: d.dateKey,
    title: d.title.trim(),
    excerpt: excerptOf(d.body),
    wordCount: countWords(d.body),
    mood: d.mood ?? existing?.mood,
    tags: d.tags ?? existing?.tags ?? [],
    pinned: d.pinned ?? existing?.pinned ?? false,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    promptId: d.promptId ?? existing?.promptId,
  });
  return id;
}

export async function deleteEntry(id: string): Promise<void> {
  useStore.getState().removeJournalEntry(id);
  await deleteBody(id);
}

// ---------- days ----------

export const keyToDate = (key: string) => new Date(key + 'T00:00:00');

export function shiftKey(key: string, days: number): string {
  const d = keyToDate(key);
  d.setDate(d.getDate() + days);
  return todayKey(d);
}

/** Before the cutoff hour the page is about yesterday (a morning looks back); from then on, about today. */
export function journalDayFor(now: Date, cutoffHour: number): string {
  const d = new Date(now);
  if (d.getHours() < cutoffHour) d.setDate(d.getDate() - 1);
  return todayKey(d);
}

export function formatJournalDate(key: string, now = new Date()): string {
  const d = keyToDate(key);
  if (isNaN(d.getTime())) return key;
  const opts: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-IN', opts);
}

export function relativeDay(key: string, now = new Date()): string {
  if (key === todayKey(now)) return 'Today';
  if (key === shiftKey(todayKey(now), -1)) return 'Yesterday';
  return '';
}

// ---------- prompts, moods ----------

export const PROMPTS = [
  'What took most of your energy today?',
  'One thing you understood better today.',
  'What would you do differently tomorrow?',
  'What are you quietly proud of?',
  'Where did your attention go today?',
  'What felt harder than it should have?',
  'Who made today better, and how?',
  'What did you learn outside a lesson?',
  'What is one thing you want to remember from today?',
  'What are you avoiding, and why?',
  'What small win deserves credit?',
  'What question is still on your mind?',
  'How did you look after yourself today?',
  'What surprised you today?',
  'Which moment would you replay?',
  'What drained you, and what restored you?',
  'What did you start that you want to finish?',
  'What worries you less than it did yesterday?',
  'What would make tomorrow a good day?',
  'What did you say yes to, and what did you say no to?',
  'Describe today in three words, then explain one.',
  'What helped you focus today?',
  'What are you grateful for right now?',
  'What idea keeps coming back to you?',
  'What did you notice that you usually miss?',
  'Which conversation stayed with you?',
  'Where did you feel most like yourself?',
  'What did you put off, and what would starting look like?',
  'What is one kind thing you did or saw?',
  'What would you tell yourself from a week ago?',
  'What made you laugh today?',
  'What progress did you make that nobody saw?',
  'What are you looking forward to?',
  'What did today teach you about how you work best?',
  'Which plan changed, and was that for the better?',
  'What do you need more of this week?',
  'What is one thing you can let go of?',
  'How did your body feel today?',
  'What would a great study session tomorrow look like?',
  'What are you curious to try next?',
];

/** The same day always gets the same prompt. */
export function promptFor(key: string): { id: string; text: string } {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const i = h % PROMPTS.length;
  return { id: 'p' + i, text: PROMPTS[i] };
}

export const MOODS: { value: 1 | 2 | 3 | 4 | 5; label: string; icon: string }[] = [
  { value: 1, label: 'Rough', icon: 'rainy-outline' },
  { value: 2, label: 'Low', icon: 'cloud-outline' },
  { value: 3, label: 'Okay', icon: 'partly-sunny-outline' },
  { value: 4, label: 'Good', icon: 'sunny-outline' },
  { value: 5, label: 'Great', icon: 'star-outline' },
];

// ---------- archive ----------

export function journalStats(entries: JournalEntry[]) {
  const days = [...new Set(entries.map((e) => e.dateKey))];
  const { current, best } = streaks(days);
  return {
    entries: entries.length,
    days: days.length,
    words: entries.reduce((a, e) => a + e.wordCount, 0),
    current,
    best,
  };
}

/** Entries about the same calendar day in earlier years, and about the same day a month earlier. */
export function onThisDay(entries: JournalEntry[], key: string): JournalEntry[] {
  const monthAgo = shiftMonth(key, -1);
  return entries
    .filter((e) => (e.dateKey.slice(5) === key.slice(5) && e.dateKey < key) || e.dateKey === monthAgo)
    .sort((a, b) => b.dateKey.localeCompare(a.dateKey));
}

function shiftMonth(key: string, months: number): string {
  const d = keyToDate(key);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return todayKey(d);
}

export function searchTokens(q: string): string[] {
  return q.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Every token must appear in the title, the text or a tag. */
export function entryMatches(e: JournalEntry, body: string | undefined, tokens: string[]): boolean {
  if (!tokens.length) return true;
  const hay = (e.title + '\n' + (body ?? e.excerpt) + '\n' + e.tags.join(' ')).toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

/** Loads the text of every entry (for full-text search), reading only what is not cached yet. */
export async function loadBodies(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await Promise.all(ids.map(async (id) => out.set(id, await readBody(id))));
  return out;
}

// ---------- backups ----------

/** The journal index with every entry's text, for a backup file. */
export async function journalForBackup(entries: JournalEntry[]) {
  return Promise.all(entries.map(async (e) => ({ ...e, body: await readBody(e.id) })));
}

/** Writes the text carried by a restored backup's entries to their files. */
export async function restoreBodies(items: unknown): Promise<void> {
  if (!Array.isArray(items)) return;
  for (const it of items as any[]) {
    if (it && typeof it.id === 'string' && typeof it.body === 'string') await writeBody(it.id, it.body);
  }
}

// ---------- opening a chosen entry ----------
// The archive picks an entry, then returns to the writing space, which takes the request on focus. The same
// path works in a tab slot and on a full page.

let pendingOpen: { dateKey: string; entryId?: string } | null = null;

export function requestJournalOpen(dateKey: string, entryId?: string) {
  pendingOpen = { dateKey, entryId };
}

export function takeJournalOpenRequest() {
  const p = pendingOpen;
  pendingOpen = null;
  return p;
}
