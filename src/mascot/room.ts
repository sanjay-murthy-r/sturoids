// Where the companion can stand on the screen in front: the room a header leaves free on its own row, between its
// title and its buttons. Each header measures itself and says so here (a tool's bar, Today's date row); only the one on
// the screen in front is used. With no room on the screen in front (a full-screen tool, nothing measured yet), the
// companion steps out by its door until there is one.

import React from 'react';
import { create } from 'zustand';
import { NavigationContext } from '@react-navigation/native';
import { View } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

export interface Room {
  /** the free stretch along the row, in window points */
  left: number;
  right: number;
  /** the row's floor (where feet stand), in window points, with the page at the top of its scroll */
  y: number;
  /** for a row that scrolls with its page (Today's header): how far the page has scrolled */
  scroll?: SharedValue<number>;
  /**
   * y is a window position straight from measureInWindow (left and right always are). Android leaves the status bar
   * out of those, though the page is drawn under it, so such a y is taken against where the companion's own layer
   * measures itself, the same way (see setWindowTop)
   */
  win?: boolean;
}

/**
 * Perches on the tab bar: points where the companion may stand on the bar's top edge, between two tabs, in window
 * points (y the bar's top, as seen by a screen-filling layer). The bar publishes them while it shows and takes them
 * back while it steps aside (the keyboard) or is not drawn; the companion uses them only while a tab is in front.
 */
export interface Perch { x: number; y: number; kind: 'bar' | 'rail' }
export const useBarPerches = create<{ perches: Perch[] | null }>(() => ({ perches: null }));
export function setBarPerches(perches: Perch[] | null) {
  const was = useBarPerches.getState().perches;
  const same = was && perches && was.length === perches.length
    && was.every((p, i) => Math.abs(p.x - perches[i].x) < 1 && Math.abs(p.y - perches[i].y) < 1 && p.kind === perches[i].kind);
  if (same || (!was && !perches)) return;
  useBarPerches.setState({ perches });
}

const rooms = new Map<string, Room>();
export const useRoom = create<{ key: string | null; room: Room | null; n: number }>(() => ({ key: null, room: null, n: 0 }));

/** where the companion's layer (the screen's top) measures itself by measureInWindow: 0, or minus the status bar */
let windowTop = 0;
/** a room as the companion's layer sees it */
const local = (r: Room | null | undefined): Room | null => (r ? (r.win ? { ...r, y: r.y - windowTop, win: false } : r) : null);
/**
 * Where measureInWindow puts the top of the screen (0, or minus the status bar on Android): take it off a y that
 * measureInWindow gave to place something in a layer that fills the screen (a modal, an overlay, the companion's).
 */
export const getWindowTop = () => windowTop;
/** A y from measureInWindow, as a layer filling the whole screen sees it. */
export const screenY = (y: number) => y - windowTop;

/**
 * Measures where measureInWindow puts the screen's top, once and whenever the window changes: mount it once, filling
 * the root (the root layout does), so every screen-filling layer can place what was measured (see screenY).
 */
export function WindowTopProbe() {
  const ref = React.useRef<any>(null);
  return React.createElement(View, {
    ref, pointerEvents: 'none', collapsable: false, style: PROBE,
    onLayout: () => ref.current?.measureInWindow((_x: number, top: number) => setWindowTop(top)),
  });
}
const PROBE = { position: 'absolute' as const, top: 0, left: 0, width: 1, height: 1, opacity: 0 };

/** The companion's layer says where measureInWindow puts the top of the screen; a room measured that way follows. */
export function setWindowTop(top: number) {
  if (Math.abs(top - windowTop) < 0.5) return;
  windowTop = top;
  const s = useRoom.getState();
  if (s.key != null) useRoom.setState({ room: local(rooms.get(s.key)), n: s.n + 1 });
}

const same = (a: Room | null | undefined, b: Room | null | undefined) =>
  !!a && !!b && Math.abs(a.left - b.left) < 1 && Math.abs(a.right - b.right) < 1 && Math.abs(a.y - b.y) < 1 && a.scroll === b.scroll && !!a.win === !!b.win;

function setRoom(key: string, room: Room | null) {
  const had = rooms.get(key);
  if (room) rooms.set(key, room); else rooms.delete(key);
  const s = useRoom.getState();
  if (s.key === key && !same(had, room)) useRoom.setState({ room: local(room), n: s.n + 1 });
}
function focusRoom(key: string) {
  const s = useRoom.getState();
  if (s.key === key) return;
  useRoom.setState({ key, room: local(rooms.get(key)), n: s.n + 1 });
}
function blurRoom(key: string) {
  const s = useRoom.getState();
  if (s.key === key) useRoom.setState({ key: null, room: null, n: s.n + 1 });
}

/**
 * Says where a header's room is, while its screen is in front. `measure` works the room out (from measureInWindow
 * calls) and hands it to `done`, or null when there is none; call the returned `remeasure` whenever the header's layout
 * may have changed (its own onLayout, a title's onTextLayout).
 */
export function useRoomPublisher(measure: (done: (room: Room | null) => void) => void): () => void {
  const key = React.useId();
  const nav = React.useContext(NavigationContext);
  const measureRef = React.useRef(measure);
  measureRef.current = measure;
  const focused = React.useRef(nav ? nav.isFocused() : true);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const remeasure = React.useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    // a beat later, once the frame has laid out (a title swapping, a screen sliding in)
    timer.current = setTimeout(() => { measureRef.current((room) => setRoom(key, room)); }, 60);
  }, [key]);
  React.useEffect(() => {
    if (focused.current) { focusRoom(key); remeasure(); }
    if (!nav) return () => { if (timer.current) clearTimeout(timer.current); setRoom(key, null); blurRoom(key); };
    const a = nav.addListener('focus', () => { focused.current = true; focusRoom(key); remeasure(); });
    const b = nav.addListener('blur', () => { focused.current = false; blurRoom(key); });
    // a screen sliding in is measured again once it has arrived
    const c = nav.addListener('transitionEnd' as any, () => { if (focused.current) remeasure(); });
    return () => { a(); b(); c(); if (timer.current) clearTimeout(timer.current); setRoom(key, null); blurRoom(key); };
  }, [nav, key]);
  return remeasure;
}
