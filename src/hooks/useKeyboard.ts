import React from 'react';
import { Keyboard, Platform, TextInput } from 'react-native';

/** how long a field's focus is taken as the keyboard coming, before it is given up as one that brought none */
const EARLY_WAIT_MS = 800;
/** how often, on Android, the field in focus is looked at (a read of a variable: there is no focus event to hear) */
const FOCUS_POLL_MS = 100;

/**
 * Whether the on-screen keyboard is up. With `early` it says so as soon as the keyboard is on its way: on its
 * keyboardWillShow where the system sends one (iOS), and on Android, where only keyboardDidShow comes and only once the
 * window has been resized for it, as soon as a text field gains focus. A focus that brings no keyboard (a hardware one)
 * is let go after a moment.
 */
export function useKeyboardOpen(early = false): boolean {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    let up = false;
    let wait: ReturnType<typeof setTimeout> | null = null;
    const set = (on: boolean) => {
      up = on;
      if (wait) { clearTimeout(wait); wait = null; }
      setOpen(on);
    };
    const subs = [
      Keyboard.addListener('keyboardDidShow', () => set(true)),
      Keyboard.addListener('keyboardDidHide', () => set(false)),
    ];
    if (early) {
      subs.push(
        Keyboard.addListener('keyboardWillShow', () => set(true)),
        Keyboard.addListener('keyboardWillHide', () => set(false)),
      );
    }
    let poll: ReturnType<typeof setInterval> | null = null;
    if (early && Platform.OS === 'android') {
      // only a field newly in focus counts: one left in focus after Back put the keyboard away does not bring it back
      let last = TextInput.State.currentlyFocusedInput();
      poll = setInterval(() => {
        const cur = TextInput.State.currentlyFocusedInput();
        if (cur && cur !== last && !up) {
          set(true);
          wait = setTimeout(() => { wait = null; set(false); }, EARLY_WAIT_MS);
        }
        last = cur;
      }, FOCUS_POLL_MS);
    }
    return () => {
      subs.forEach((s) => s.remove());
      if (poll) clearInterval(poll);
      if (wait) clearTimeout(wait);
    };
  }, [early]);
  return open;
}
