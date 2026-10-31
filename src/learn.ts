import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { pkey } from './profiles';

// What the student has learnt by now: how many times each feature has been used, so the words that explain it in
// passing (a field's "Create a tag of your own, like Revision") can step down to a plain name ("Create tag") once it is
// familiar. Only the words in plain view step down; an info button always says it all. Kept per profile on the device:
// it is about this person's habits here, not data to sync.

const KEY = pkey('sturoids-learn');
/** after this many uses a feature is taken as known: enough repetitions to have seen what it does, not so many to nag */
export const KNOWN_AFTER = 8;

const useLearn = create<{ loaded: boolean; counts: Record<string, number> }>(() => ({ loaded: false, counts: {} }));

let loading: Promise<void> | null = null;
function load() {
  if (loading) return loading;
  loading = AsyncStorage.getItem(KEY).then((raw) => {
    const j = raw ? JSON.parse(raw) : null;
    const counts: Record<string, number> = {};
    if (j && typeof j === 'object') for (const [k, v] of Object.entries(j)) if (typeof v === 'number' && v > 0) counts[k] = Math.min(999, Math.floor(v));
    // uses counted before the saved counts arrived are added to them, never in place of them
    const merged = { ...counts };
    for (const [k, v] of Object.entries(useLearn.getState().counts)) merged[k] = Math.min(999, (merged[k] ?? 0) + v);
    useLearn.setState({ loaded: true, counts: merged });
  }).catch(() => { useLearn.setState({ loaded: true }); });
  return loading;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** Counts one use of a feature. */
export function noteUse(key: string, by = 1) {
  void load();
  const counts = useLearn.getState().counts;
  if ((counts[key] ?? 0) >= 999) return;
  useLearn.setState({ counts: { ...counts, [key]: (counts[key] ?? 0) + by } });
  if (saveTimer) clearTimeout(saveTimer);
  // written only once the saved counts are in, so a slow read never lets the new ones replace them
  saveTimer = setTimeout(() => {
    void load().then(() => AsyncStorage.setItem(KEY, JSON.stringify(useLearn.getState().counts))).catch(() => {});
  }, 600);
}

/** How many times a feature has been used. */
export function usesOf(key: string) {
  return useLearn.getState().counts[key] ?? 0;
}

/**
 * The words for a feature as it stands: the full explanation while it is new, the short name once it has been used
 * `after` times. Until the counts have loaded it says the short words only for a feature known before (none yet), so a
 * first frame never flips from short to long.
 */
export function useLearnt(key: string, full: string, short: string, after = KNOWN_AFTER): string {
  React.useEffect(() => { void load(); }, []);
  const n = useLearn((s) => s.counts[key] ?? 0);
  return n >= after ? short : full;
}

/** Whether a feature is known by now (for a hint that goes away entirely rather than shortening). */
export function useKnown(key: string, after = KNOWN_AFTER): boolean {
  React.useEffect(() => { void load(); }, []);
  return useLearn((s) => (s.counts[key] ?? 0) >= after);
}
