// The PC version's keyboard: Ctrl+K (or / outside a text field) opens Sift, and Escape closes it, or else goes back a
// page, as Back does on a phone; Ctrl+1 to Ctrl+5 go to the bar's five places, Ctrl+N adds a ToDo, Ctrl+Shift+N writes a
// new note, Ctrl+Shift+F starts Deep Work, Ctrl+, opens Settings and ? lists them all (src/web/pc.ts says which key is
// which). Also sideways scrolling with a mouse. On a phone this does nothing.
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { router } from 'expo-router';
import { closeSift, openSift, useSearch } from '../search/store';
import { useStore } from '../store';
import { goTab, openPage } from '../toolNav';
import { runAction } from '../actions';
import { shortcutOf } from './pc';
import { openShortcuts, shortcutsOpen } from './shortcutsSheet';

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
};

/** Whether a sheet or another window of the app's is up (each is a modal dialog on the page): it has the keys first. */
const dialogUp = () => !!document.querySelector('[aria-modal="true"][role="dialog"]');

/**
 * The page's own styles a desktop window needs: text fields draw the app's accent line, not the browser's focus ring;
 * anything else reached with Tab shows a ring in the accent, so the keyboard always says where it is (a click shows
 * none); scrollbars are thin and dark, on the material; text selected is the accent's tint.
 */
const DESKTOP_CSS = `
input:focus, textarea:focus, [contenteditable]:focus { outline: none !important; }
:focus-visible { outline: 2px solid var(--sturoids-ring, rgba(149, 136, 249, 0.75)); outline-offset: 2px; }
input:focus-visible, textarea:focus-visible, [contenteditable]:focus-visible { outline: none; }
* { scrollbar-width: thin; scrollbar-color: #4a4a46 transparent; }
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-thumb { background: #4a4a46; border-radius: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::selection { background: var(--sturoids-tint, rgba(149, 136, 249, 0.35)); }
html, body { background: #262624; overscroll-behavior: none; }
`;

/** The accent as a ring and a selection tint, kept on the page's root so the styles above follow a new accent. */
function paintAccent(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return;
  const n = parseInt(m[1], 16);
  const rgb = (n >> 16) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255);
  document.documentElement.style.setProperty('--sturoids-ring', 'rgba(' + rgb + ', 0.75)');
  document.documentElement.style.setProperty('--sturoids-tint', 'rgba(' + rgb + ', 0.35)');
}

export function useDesktopKeys() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
    if (!document.getElementById('sturoids-desktop-css')) {
      const style = document.createElement('style');
      style.id = 'sturoids-desktop-css';
      style.textContent = DESKTOP_CSS;
      document.head.appendChild(style);
    }
    paintAccent(useStore.getState().settings.accent);
    const offAccent = useStore.subscribe((st, prev) => {
      if (st.settings.accent !== prev.settings.accent) paintAccent(st.settings.accent);
    });
    const on = (e: KeyboardEvent) => {
      const sift = useSearch.getState().open;
      if (e.key === 'Escape') {
        if (sift) {
          // heard first (capture), since Sift's own field would otherwise keep the key to itself
          e.preventDefault();
          e.stopPropagation();
          closeSift();
          return;
        }
        // a sheet closes itself on the key's release; the page behind it stays where it is. A field handles its own
        // Escape first; otherwise the page goes back, as Back would
        if (dialogUp() || typing(e.target) || e.defaultPrevented) return;
        if (router.canGoBack()) router.back();
        return;
      }
      if (e.repeat) return;
      const id = shortcutOf({ key: e.key, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey, alt: e.altKey, typing: typing(e.target) });
      if (!id) return;
      if (id === 'sift') {
        // Ctrl+K also closes Sift; a bare / never opens it over a sheet
        if (sift) {
          if (e.key !== '/') { e.preventDefault(); closeSift(); }
          return;
        }
        if (dialogUp() && e.key === '/') return;
        e.preventDefault();
        openSift('shortcut');
        return;
      }
      // the rest wait while Sift or a sheet is up: neither leaves the page behind it while it asks something
      if (sift || dialogUp() || shortcutsOpen()) return;
      e.preventDefault();
      if (id === 'help') openShortcuts();
      else if (id === 'settings') openPage('/settings');
      else if (id === 'add-todo') runAction('add-todo', 'shortcut');
      else if (id === 'new-note') runAction('new-note', 'shortcut');
      else if (id === 'start-focus') runAction('start-focus', 'shortcut');
      else goTab(Number(id.slice(3)) - 1);
    };
    window.addEventListener('keydown', on, true);
    const offSideways = sidewaysScrolling();
    const offDrags = dragsAreNotClicks();
    return () => {
      window.removeEventListener('keydown', on, true);
      offAccent();
      offSideways();
      offDrags();
    };
  }, []);
}

/**
 * With a mouse (or a finger on a touch screen), a press that moved on its way (a tile dragged, a card swiped, a row
 * scrolled) lets go over what it started on, and the browser calls that a click. A click after the pointer moved more
 * than a few pixels is not one here: nothing is opened or ticked by the end of a drag.
 */
function dragsAreNotClicks(): () => void {
  let start: { x: number; y: number } | null = null;
  let moved = false;
  const down = (e: PointerEvent) => { start = { x: e.clientX, y: e.clientY }; moved = false; };
  const move = (e: PointerEvent) => {
    if (!start || moved) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) moved = true;
  };
  const click = (e: MouseEvent) => {
    // a click from the keyboard (Enter, Space) has no pointer before it
    if (moved && e.detail > 0) { e.stopPropagation(); e.preventDefault(); }
    moved = false;
    start = null;
  };
  window.addEventListener('pointerdown', down, true);
  window.addEventListener('pointermove', move, true);
  window.addEventListener('click', click, true);
  return () => {
    window.removeEventListener('pointerdown', down, true);
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('click', click, true);
  };
}

/** The nearest element at or above `el` that scrolls sideways and not up and down (a row of chips, the Vault's pages). */
function sidewaysScroller(el: Element | null): HTMLElement | null {
  for (let n = el as HTMLElement | null; n && n !== document.body; n = n.parentElement) {
    if (n.scrollWidth <= n.clientWidth + 1) continue;
    const cs = getComputedStyle(n);
    if (cs.overflowX !== 'auto' && cs.overflowX !== 'scroll') continue;
    // a box that also scrolls up and down keeps the wheel for that
    const vertical = n.scrollHeight > n.clientHeight + 1 && (cs.overflowY === 'auto' || cs.overflowY === 'scroll');
    if (!vertical) return n;
  }
  return null;
}

/**
 * Sideways scrolling with a mouse, which has no sideways wheel: over anything that scrolls only sideways, the wheel
 * scrolls it sideways (smoothly, as the page itself scrolls), and it can be dragged along with the button held, as a
 * finger would. A trackpad's own sideways swipe is left as it is. A drag that moved never counts as a click on what it
 * started on.
 */
function sidewaysScrolling(): () => void {
  const wheel = (e: WheelEvent) => {
    if (e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
    const box = sidewaysScroller(e.target as Element);
    if (!box) return;
    const max = box.scrollWidth - box.clientWidth;
    const step = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
    // at its end it lets the wheel go on to the page, so the page never feels stuck under a row
    if ((step > 0 && box.scrollLeft >= max - 1) || (step < 0 && box.scrollLeft <= 0)) return;
    e.preventDefault();
    box.scrollBy({ left: step, behavior: Math.abs(step) > 60 ? 'smooth' : 'auto' });
  };
  let drag: { box: HTMLElement; x: number; left: number; moved: boolean } | null = null;
  const down = (e: MouseEvent) => {
    if (e.button !== 0 || typing(e.target)) return;
    const box = sidewaysScroller(e.target as Element);
    if (box) drag = { box, x: e.clientX, left: box.scrollLeft, moved: false };
  };
  const move = (e: MouseEvent) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 6) return;
    drag.moved = true;
    drag.box.style.scrollSnapType = 'none';
    drag.box.style.cursor = 'grabbing';
    drag.box.scrollLeft = drag.left - dx;
    e.preventDefault();
  };
  const up = () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    d.box.style.cursor = '';
    if (!d.moved) return;
    // a paged row (the Vault) settles on its nearest page again
    d.box.style.scrollSnapType = '';
    // the click that ends a drag is swallowed once
    const eat = (ev: MouseEvent) => { ev.stopPropagation(); ev.preventDefault(); };
    window.addEventListener('click', eat, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', eat, { capture: true }), 0);
  };
  window.addEventListener('wheel', wheel, { passive: false, capture: true });
  window.addEventListener('mousedown', down, true);
  window.addEventListener('mousemove', move, true);
  window.addEventListener('mouseup', up, true);
  return () => {
    window.removeEventListener('wheel', wheel, { capture: true } as any);
    window.removeEventListener('mousedown', down, true);
    window.removeEventListener('mousemove', move, true);
    window.removeEventListener('mouseup', up, true);
  };
}
