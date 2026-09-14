import React from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';

/**
 * The current time for a screen that shows it to the minute. It refreshes every `intervalMs` only while the
 * screen is in front and the app is open, and at once on coming back, so a tab left behind costs nothing.
 */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = React.useState(() => new Date());
  useFocusEffect(React.useCallback(() => {
    setNow(new Date());
    let timer: ReturnType<typeof setInterval> | null = setInterval(() => setNow(new Date()), intervalMs);
    const sub = AppState.addEventListener('change', (state) => {
      if (timer) clearInterval(timer);
      timer = null;
      if (state === 'active') {
        setNow(new Date());
        timer = setInterval(() => setNow(new Date()), intervalMs);
      }
    });
    return () => {
      if (timer) clearInterval(timer);
      sub.remove();
    };
  }, [intervalMs]));
  return now;
}
