// Scroll memory, as a phone's own apps keep it: back on a page within 15 seconds of leaving it, it is where it was left;
// away longer, it starts again from the top. This holds for a page that stays mounted while it is away (a tab, a list
// under the page opened from it) and for one that is closed and opened again (a tool's page left with back and opened
// once more). Pages that are written in (a note, the journal's page, a form) keep their place whatever the time: a
// half-written page is never sent back to its top.

import React from 'react';
import { useFocusEffect, usePathname } from 'expo-router';
import type { SharedValue } from 'react-native-reanimated';

/** how long a page keeps its place once left */
export const SCROLL_KEEP_MS = 15 * 1000;

/** each page's offset when it was last left, and when: kept across mounts, so a page closed and opened again finds it */
const kept = new Map<string, { y: number; at: number }>();

type Scrollable = {
  scrollTo?: (o: { x?: number; y: number; animated?: boolean }) => void;
  scrollToOffset?: (o: { offset: number; animated?: boolean }) => void;
};

function scrollNode(node: Scrollable | null, y: number) {
  if (!node) return;
  try {
    if (typeof node.scrollToOffset === 'function') node.scrollToOffset({ offset: y, animated: false });
    else if (typeof node.scrollTo === 'function') node.scrollTo({ x: 0, y, animated: false });
  } catch {
    // a list torn down mid-way: nothing to move
  }
}

export type ScrollMemoryMode = 'timed' | 'keep';

/**
 * Props for the page's one scroll view (`ref`, `onContentSizeChange`), given the offset the page already follows
 * (`scrollY`, kept on the UI thread by its scroll handler) and the screen's own ref to that view, if it keeps one.
 */
export function useScrollMemory(scrollY: SharedValue<number>, opts: { mode?: ScrollMemoryMode; ref?: any } = {}) {
  const mode = opts.mode ?? 'timed';
  const path = usePathname();
  const node = React.useRef<Scrollable | null>(null);
  const ext = React.useRef(opts.ref);
  ext.current = opts.ref;
  // set at mount when this page was left a moment ago: the offset to go back to once there is enough content for it
  const pending = React.useRef<number | null>(null);
  const leftAt = React.useRef<number | null>(null);
  const first = React.useRef(true);
  if (first.current) {
    // read once, as the page mounts: a later render never restores again
    first.current = false;
    const k = kept.get(path);
    if (mode === 'timed' && k && Date.now() - k.at < SCROLL_KEEP_MS && k.y > 0) pending.current = k.y;
  }

  const ref = React.useCallback((n: any) => {
    node.current = n;
    const e = ext.current;
    if (typeof e === 'function') e(n);
    else if (e && typeof e === 'object') e.current = n;
  }, []);

  // the content has grown: once it is tall enough, the page goes back to where it was (given a second at most, as
  // a list that never grows that far would otherwise jump long after it had been looked at)
  const born = React.useRef(Date.now());
  const onContentSizeChange = React.useCallback((_w: number, h: number) => {
    const y = pending.current;
    if (y == null) return;
    if (Date.now() - born.current > 1000) { pending.current = null; return; }
    if (h <= y) return;
    pending.current = null;
    scrollNode(node.current, y);
    scrollY.value = y;
  }, [scrollY]);

  useFocusEffect(React.useCallback(() => {
    // back on a page that stayed mounted: after the time is up it starts from the top again
    if (mode === 'timed' && leftAt.current != null && Date.now() - leftAt.current >= SCROLL_KEEP_MS && scrollY.value > 0) {
      scrollNode(node.current, 0);
      scrollY.value = 0;
    }
    leftAt.current = null;
    return () => {
      leftAt.current = Date.now();
      kept.set(path, { y: scrollY.value, at: Date.now() });
    };
  }, [mode, path, scrollY]));

  // a page closed for good leaves its place behind too (its blur may not run as it unmounts)
  React.useEffect(() => () => { kept.set(path, { y: scrollY.value, at: Date.now() }); }, [path, scrollY]);

  return { ref, onContentSizeChange };
}
