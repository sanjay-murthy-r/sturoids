import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { makeMutable, withTiming } from 'react-native-reanimated';
import { pkey } from '../profiles';

// Sift's state: whether it is open, its scope and query, and where it was opened from (the morph starts there). Its
// memory (recent searches, recently opened results, how often each result was opened) is kept per profile.

export type SiftScope = 'all' | 'todos' | 'notes' | 'journal' | 'vault' | 'scores' | 'settings';

/** Where Sift was opened from: the header pull (the field morphs out of the header), a tab, More, Today, a shortcut. */
export type SiftOrigin = 'pull' | 'tab' | 'more' | 'today' | 'shortcut' | 'other';

export interface SiftState {
  open: boolean;
  scope: SiftScope;
  query: string;
  origin: SiftOrigin;
}

export const useSearch = create<SiftState>(() => ({ open: false, scope: 'all', query: '', origin: 'other' }));

/**
 * How far Sift is open, 0 to 1, on the UI thread: the overlay drives it, and the app behind (AppFrame) scales and dims
 * with it. A module-level shared value, so the root layout's frame and the overlay read one value without a context.
 */
export const siftShown = makeMutable(0);

/**
 * How far a header pull has gone toward opening Sift, 0 to 1 (1 is the 64 dp threshold): the bar's pill grows with it,
 * and the overlay's field starts from where it left off.
 */
export const siftPull = makeMutable(0);

/** Opens Sift. A query and a scope can come with it (a shortcut, Settings). */
export function openSift(origin: SiftOrigin = 'other', opts: { scope?: SiftScope; query?: string } = {}) {
  const s = useSearch.getState();
  if (s.open) return;
  useSearch.setState({ open: true, origin, scope: opts.scope ?? 'all', query: opts.query ?? '' });
}

/** Closes Sift; the overlay plays its way out. */
export function closeSift() {
  if (!useSearch.getState().open) return;
  useSearch.setState({ open: false });
  siftPull.value = withTiming(0, { duration: 180 });
}

/** The same, under the plan's names. */
export const openSearch = openSift;
export const closeSearch = closeSift;

/* ---------------------------------------------------------------- memory */

/** A result opened from Sift, as it was shown, so the empty state can list it again. */
export interface OpenedRef {
  key: string;
  title: string;
  subtitle?: string;
  icon: string;
  color?: string;
  section: string;
  at: number;
}

/** Something kept at the top of Sift: a search to run again, or a result (a tool, a note, a setting) to open. */
export type PinnedRef =
  | { kind: 'query'; key: string; query: string }
  | { kind: 'doc'; key: string; title: string; subtitle?: string; icon: string; color?: string; section: string };

export interface SiftMemory {
  loaded: boolean;
  /** what was pinned, in the order it was pinned */
  pinned: PinnedRef[];
  /** when Sift was first used on this profile (ms), for the first week's hint that Enter opens the top result; 0 unknown */
  firstUsedAt: number;
  /** the last searches, newest first */
  recent: string[];
  /** the last results opened, newest first */
  opened: OpenedRef[];
  /** result key → times opened from Sift */
  uses: Record<string, number>;
}

const MEMORY_KEY = pkey('sturoids-search');
const RECENT_MAX = 8;
const OPENED_MAX = 6;
const USES_MAX = 300;
const PINNED_MAX = 12;
/** how long Sift says that Enter opens the top result: its first week */
export const ENTER_HINT_MS = 7 * 24 * 60 * 60 * 1000;

export const useSiftMemory = create<SiftMemory>(() => ({ loaded: false, pinned: [], firstUsedAt: 0, recent: [], opened: [], uses: {} }));

/** A pin as kept, checked: anything else is dropped. */
function cleanPin(p: any): PinnedRef | null {
  if (!p || typeof p !== 'object' || typeof p.key !== 'string' || !p.key) return null;
  if (p.kind === 'query' && typeof p.query === 'string' && p.query.trim()) return { kind: 'query', key: p.key, query: p.query };
  if (p.kind === 'doc' && typeof p.title === 'string' && typeof p.icon === 'string') {
    return {
      kind: 'doc', key: p.key, title: p.title, icon: p.icon, section: typeof p.section === 'string' ? p.section : '',
      ...(typeof p.subtitle === 'string' ? { subtitle: p.subtitle } : null), ...(typeof p.color === 'string' ? { color: p.color } : null),
    };
  }
  return null;
}

let loading: Promise<void> | null = null;

/** Reads the memory once (on the first open); a damaged row starts empty. */
export function loadSiftMemory(): Promise<void> {
  if (loading) return loading;
  loading = AsyncStorage.getItem(MEMORY_KEY).then((raw) => {
    const j = raw ? JSON.parse(raw) : null;
    const recent = Array.isArray(j?.recent) ? j.recent.filter((q: unknown) => typeof q === 'string' && q.trim()).slice(0, RECENT_MAX) : [];
    const opened = Array.isArray(j?.opened)
      ? j.opened.filter((o: any) => o && typeof o.key === 'string' && typeof o.title === 'string').slice(0, OPENED_MAX)
      : [];
    const uses: Record<string, number> = {};
    if (j?.uses && typeof j.uses === 'object') {
      for (const [k, v] of Object.entries(j.uses)) if (typeof v === 'number' && v > 0) uses[k] = Math.floor(v);
    }
    const pinned = (Array.isArray(j?.pinned) ? j.pinned : []).map(cleanPin).filter(Boolean).slice(0, PINNED_MAX) as PinnedRef[];
    const firstUsedAt = typeof j?.firstUsedAt === 'number' && j.firstUsedAt > 0 ? j.firstUsedAt : Date.now();
    useSiftMemory.setState({ loaded: true, recent, opened, uses, pinned, firstUsedAt });
    if (!j?.firstUsedAt) saveSoon();
  }).catch(() => {
    useSiftMemory.setState({ loaded: true, firstUsedAt: Date.now() });
  });
  return loading;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function saveSoon() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const { recent, opened, uses, pinned, firstUsedAt } = useSiftMemory.getState();
    AsyncStorage.setItem(MEMORY_KEY, JSON.stringify({ recent, opened, uses, pinned, firstUsedAt })).catch(() => {});
  }, 400);
}

/** Keeps a search in Recent searches (once, newest first). */
export function rememberQuery(q: string) {
  const t = q.trim().replace(/\s+/g, ' ');
  if (t.length < 2) return;
  const { recent } = useSiftMemory.getState();
  const next = [t, ...recent.filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, RECENT_MAX);
  useSiftMemory.setState({ recent: next });
  saveSoon();
}

export function forgetQuery(q: string) {
  useSiftMemory.setState((s) => ({ recent: s.recent.filter((x) => x !== q) }));
  saveSoon();
}

/** Counts an opened result and keeps it in Recently opened. */
export function rememberOpen(ref: Omit<OpenedRef, 'at'>) {
  const s = useSiftMemory.getState();
  const uses = { ...s.uses, [ref.key]: (s.uses[ref.key] || 0) + 1 };
  const keys = Object.keys(uses);
  if (keys.length > USES_MAX) {
    keys.sort((a, b) => uses[a] - uses[b]).slice(0, keys.length - USES_MAX).forEach((k) => { delete uses[k]; });
  }
  const opened = [{ ...ref, at: Date.now() }, ...s.opened.filter((o) => o.key !== ref.key)].slice(0, OPENED_MAX);
  useSiftMemory.setState({ uses, opened });
  saveSoon();
}

/** Drops a recently opened result that no longer exists. */
export function forgetOpened(key: string) {
  useSiftMemory.setState((s) => ({ opened: s.opened.filter((o) => o.key !== key) }));
  saveSoon();
}

/* ---------------------------------------------------------------- pins */

/** The key a search is pinned under. */
export const queryPinKey = (q: string) => 'query:' + q.trim().replace(/\s+/g, ' ').toLowerCase();

export const isPinned = (key: string) => useSiftMemory.getState().pinned.some((p) => p.key === key);

/** Pins something, or unpins it if it is pinned; says which. At most twelve: the oldest pin makes room. */
export function togglePin(ref: PinnedRef): boolean {
  const { pinned } = useSiftMemory.getState();
  if (pinned.some((p) => p.key === ref.key)) {
    useSiftMemory.setState({ pinned: pinned.filter((p) => p.key !== ref.key) });
    saveSoon();
    return false;
  }
  const clean = cleanPin(ref);
  if (!clean) return false;
  useSiftMemory.setState({ pinned: [...pinned, clean].slice(-PINNED_MAX) });
  saveSoon();
  return true;
}

export function unpin(key: string) {
  useSiftMemory.setState((s) => ({ pinned: s.pinned.filter((p) => p.key !== key) }));
  saveSoon();
}
