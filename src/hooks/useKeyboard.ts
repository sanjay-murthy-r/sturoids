import React from 'react';
import { Keyboard } from 'react-native';

/** Whether the on-screen keyboard is up. */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => setOpen(true));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setOpen(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  return open;
}
