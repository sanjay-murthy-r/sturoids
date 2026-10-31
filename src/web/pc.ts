// The PC version's pure parts: which key does what, and how a confirmation's buttons are read. Nothing here touches the
// page or React Native, so the Node tests can load it (scripts/test-pc.js).

/** What a key on the PC does, beyond typing. */
export type ShortcutId =
  | 'sift' | 'tab1' | 'tab2' | 'tab3' | 'tab4' | 'tab5' | 'add-todo' | 'new-note' | 'start-focus' | 'settings' | 'help';

/** A key as the keyboard reports it: its `key`, the modifiers held, and whether a text field has the caret. */
export interface KeyPress {
  key: string; ctrl: boolean; meta: boolean; shift: boolean; alt: boolean; typing: boolean;
}

/**
 * The shortcut a key press asks for, or null. Ctrl (or Cmd) combinations work anywhere, a text field included, as an
 * app's own shortcuts do; a bare key (/ for Sift, ? for this list) only away from a field, where it would be typed.
 * Escape is not here: it closes or goes back, and is read where that is known.
 */
export function shortcutOf(e: KeyPress): ShortcutId | null {
  const mod = e.ctrl || e.meta;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (mod && !e.alt) {
    if (k === 'k' && !e.shift) return 'sift';
    // the five places of the bar, left to right; Shift held turns the digits into signs on most layouts, so it is left
    if (!e.shift && k >= '1' && k <= '5' && k.length === 1) return ('tab' + k) as ShortcutId;
    if (k === 'n') return e.shift ? 'new-note' : 'add-todo';
    if (k === 'f' && e.shift) return 'start-focus';
    if (k === ',' && !e.shift) return 'settings';
    if (k === '/' || k === '?') return 'help';
    return null;
  }
  if (mod || e.alt || e.typing) return null;
  if (k === '/') return 'sift';
  if (k === '?') return 'help';
  return null;
}

/** The list the shortcuts sheet shows, in the order it shows them: the keys as they are pressed, and what they do. */
export const SHORTCUT_LIST: readonly { keys: string[]; what: string }[] = [
  { keys: ['Ctrl', 'K'], what: 'Search with Sift (or / away from a field)' },
  { keys: ['Ctrl', '1'], what: 'Today' },
  { keys: ['Ctrl', '2 to 4'], what: 'The three tools in the bar' },
  { keys: ['Ctrl', '5'], what: 'More' },
  { keys: ['Ctrl', 'N'], what: 'Add a ToDo' },
  { keys: ['Ctrl', 'Shift', 'N'], what: 'New note' },
  { keys: ['Ctrl', 'Shift', 'F'], what: 'Start Deep Work' },
  { keys: ['Ctrl', ','], what: 'Settings' },
  { keys: ['Esc'], what: 'Close a sheet or Sift, or go back a page' },
  { keys: ['?'], what: 'These shortcuts' },
];

/** One of a confirmation's buttons, as React Native's Alert takes it. */
export interface AlertButtonLike { text?: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: (value?: string) => void }

/**
 * A confirmation's buttons as the PC shows them: none given is one OK, as on a phone. `dismiss` is the button closing
 * the sheet without a choice counts as (the backdrop, Escape): the Cancel, or the only button there is; -1 when it is
 * neither, and closing it chooses nothing. The buttons keep the order they were given, which is the order a phone
 * shows them in, so Cancel sits where it always has.
 */
export function alertButtons<B extends AlertButtonLike>(buttons?: readonly B[] | null): { list: (B | AlertButtonLike)[]; dismiss: number } {
  const list: (B | AlertButtonLike)[] = buttons && buttons.length ? [...buttons] : [{ text: 'OK' }];
  const cancel = list.findIndex((b) => b.style === 'cancel');
  return { list, dismiss: cancel >= 0 ? cancel : list.length === 1 ? 0 : -1 };
}
