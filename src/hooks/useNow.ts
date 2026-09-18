import React from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { todayKey } from '../utils';

const sameMinute = (a: Date, b: Date) => Math.floor(a.getTime() / 60_000) === Math.floor(b.getTime() / 60_000);

/**
 * The current time for a screen that shows it to the minute. It changes as each minute begins, only while the
 * screen is in front and the app is open, and at once on coming back, so a tab left behind costs nothing and a
 * screen in front never re-renders for a minute it already shows.
 */
export function useNow(): Date {
  const [now, setNow] = React.useState(() => new Date());
  useFocusEffect(React.useCallback(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const update = () => {
      const next = new Date();
      setNow((prev) => (sameMinute(prev, next) ? prev : next));
    };
    const arm = () => {
      if (timer) clearTimeout(timer);
      const d = new Date();
      // a moment after the minute turns, so the new minute is the one read
      timer = setTimeout(() => { update(); arm(); }, 60_000 - (d.getSeconds() * 1000 + d.getMilliseconds()) + 40);
    };
    update();
    arm();
    const sub = AppState.addEventListener('change', (state) => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (state === 'active') {
        update();
        arm();
      }
    });
    return () => {
      if (timer) clearTimeout(timer);
      sub.remove();
    };
  }, []));
  return now;
}

/**
 * Today's date key for a screen with no clock of its own. It turns over at midnight, even on a tab left open, and
 * on coming back to the app.
 */
export function useToday(): string {
  const [key, setKey] = React.useState(() => todayKey());
  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const arm = () => {
      if (timer) clearTimeout(timer);
      const midnight = new Date();
      midnight.setHours(24, 0, 0, 200);
      timer = setTimeout(() => { setKey(todayKey()); arm(); }, midnight.getTime() - Date.now());
    };
    arm();
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      setKey(todayKey());
      arm();
    });
    return () => {
      if (timer) clearTimeout(timer);
      sub.remove();
    };
  }, []);
  return key;
}
