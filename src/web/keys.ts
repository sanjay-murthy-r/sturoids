// The PC version's keyboard: Ctrl+K (or / outside a text field) opens Sift, and Escape closes it, or else goes back a
// page, as Back does on a phone. On a phone this does nothing.
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { router } from 'expo-router';
import { closeSift, openSift, useSearch } from '../search/store';

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
};

/**
 * The page's own styles a desktop window needs: text fields draw the app's accent line, not the browser's focus ring;
 * scrollbars are thin and dark, on the material; text selected is the accent's tint.
 */
const DESKTOP_CSS = `
input:focus, textarea:focus, [contenteditable]:focus { outline: none !important; }
:focus-visible { outline: none; }
* { scrollbar-width: thin; scrollbar-color: #4a4a46 transparent; }
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-thumb { background: #4a4a46; border-radius: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::selection { background: rgba(149, 136, 249, 0.35); }
html, body { background: #262624; overscroll-behavior: none; }
`;

export function useDesktopKeys() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
    if (!document.getElementById('sturoids-desktop-css')) {
      const style = document.createElement('style');
      style.id = 'sturoids-desktop-css';
      style.textContent = DESKTOP_CSS;
      document.head.appendChild(style);
    }
    const on = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (useSearch.getState().open) closeSift();
        else openSift('shortcut');
        return;
      }
      if (e.key === '/' && !typing(e.target) && !useSearch.getState().open) {
        e.preventDefault();
        openSift('shortcut');
        return;
      }
      if (e.key === 'Escape') {
        if (useSearch.getState().open) {
          closeSift();
          return;
        }
        // a sheet or a field handles its own Escape first; otherwise the page goes back, as Back would
        if (typing(e.target) || e.defaultPrevented) return;
        if (router.canGoBack()) router.back();
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
}
