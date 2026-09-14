import { useEffect, useState } from 'react';
import { useStore } from '../store';

/**
 * True once zustand has finished reading the persisted state from AsyncStorage.
 * Anything that must reflect the user's saved settings on its FIRST frame (the
 * intro's animation level, the theme background, the accent) waits for this.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(() => useStore.persist.hasHydrated());
  useEffect(() => {
    if (useStore.persist.hasHydrated()) setHydrated(true);
    return useStore.persist.onFinishHydration(() => setHydrated(true));
  }, []);
  return hydrated;
}
