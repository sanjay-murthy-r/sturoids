// Where the companion can stand on the screen in front: the room a header leaves free on its own row, between its
// title and its buttons. Each header measures itself and says so here (a tool's bar, Today's date row); only the one on
// the screen in front is used. With no room on the screen in front (a full-screen tool, nothing measured yet), the
// companion steps out by its door until there is one.

import React from 'react';
import { create } from 'zustand';
import { NavigationContext } from '@react-navigation/native';
import type { SharedValue } from 'react-native-reanimated';

export interface Room {
  /** the free stretch along the row, in window points */
  left: number;
  right: number;
  /** the row's floor (where feet stand), in window points, with the page at the top of its scroll */
  y: number;
  /** for a row that scrolls with its page (Today's header): how far the page has scrolled */
  scroll?: SharedValue<number>;
}

const rooms = new Map<string, Room>();
export const useRoom = create<{ key: string | null; room: Room | null; n: number }>(() => ({ key: null, room: null, n: 0 }));

const same = (a: Room | null | undefined, b: Room | null | undefined) =>
  !!a && !!b && Math.abs(a.left - b.left) < 1 && Math.abs(a.right - b.right) < 1 && Math.abs(a.y - b.y) < 1 && a.scroll === b.scroll;

function setRoom(key: string, room: Room | null) {
  const had = rooms.get(key);
  if (room) rooms.set(key, room); else rooms.delete(key);
  const s = useRoom.getState();
  if (s.key === key && !same(had, room)) useRoom.setState({ room, n: s.n + 1 });
}
function focusRoom(key: string) {
  const s = useRoom.getState();
  if (s.key === key) return;
  useRoom.setState({ key, room: rooms.get(key) ?? null, n: s.n + 1 });
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
