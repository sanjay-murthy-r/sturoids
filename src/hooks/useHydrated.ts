import { useEffect, useState } from 'react';
import { giveUpWaitingForHydration, hydrationSettled, onHydrationSettled } from '../store';

/** How long the app waits for storage to answer at all before rendering on defaults. */
const HYDRATION_TIMEOUT_MS = 8000;

/**
 * True once zustand has read the persisted state from AsyncStorage, or once a failed or
 * unanswered load has been handled (see store.ts). Anything that must reflect the user's saved
 * settings on its FIRST frame (the intro's animation level, the theme background, the accent)
 * waits for this. It can never stay false: a load that throws settles as soon as the raw data
 * is set aside, and storage that never answers settles after HYDRATION_TIMEOUT_MS with saving
 * paused, so nothing on disk is overwritten.
 */
export function useHydrated(): boolean {
  const [ready, setReady] = useState(hydrationSettled);
  useEffect(() => {
    if (hydrationSettled()) {
      setReady(true);
      return undefined;
    }
    const unsubscribe = onHydrationSettled(() => setReady(true));
    const timer = setTimeout(giveUpWaitingForHydration, HYDRATION_TIMEOUT_MS);
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, []);
  return ready;
}
