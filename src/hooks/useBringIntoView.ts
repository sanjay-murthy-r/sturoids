import React from 'react';
import { View, useWindowDimensions } from 'react-native';

/**
 * Brings a row a link opened (Sift, a reminder) into view in a screen's scroll, and leaves it alone when it is already
 * in full view. The screen puts `topRef` on an empty View at the very top of its scroll's content (after the content's
 * top padding), and calls `bring(view)` with the row once it has laid out. Both are measured in the window, so it holds
 * for a tab's overlaid bar and a page's bar alike.
 */
export function useBringIntoView({ scrollTo, scrollY, padTop, barH, still }: {
  /** scrolls the screen's scroll to a y, animated or not */
  scrollTo: (y: number, animated: boolean) => void;
  /** the scroll's offset as it is now */
  scrollY: { value: number };
  /** the content's top padding, above the top marker */
  padTop: number;
  /** a tab's bar laid over the top of the scroll (0 for a page, whose bar stands above it) */
  barH: number;
  /** motion off: the scroll jumps */
  still: boolean;
}) {
  const topRef = React.useRef<View>(null);
  const { height: winH } = useWindowDimensions();
  // the latest values, for a measure that answers later
  const live = React.useRef({ scrollTo, scrollY, padTop, barH, still, winH });
  live.current = { scrollTo, scrollY, padTop, barH, still, winH };
  const bring = React.useCallback((view: View | null) => {
    const top = topRef.current;
    if (!view || !top) return;
    top.measureInWindow((_tx, ty) => {
      view.measureInWindow((_x, y, _w, h) => {
        const l = live.current;
        const y0 = l.scrollY.value;
        // the scroll's top edge in the window, and the band a row can be seen whole in (the tab bar covers the foot)
        const viewTop = ty - l.padTop + y0;
        const clearTop = viewTop + l.barH + 12;
        const clearBottom = l.winH - 120;
        if (y >= clearTop && y + h <= clearBottom) return;
        const contentY = l.padTop + (y - ty);
        l.scrollTo(Math.max(0, contentY - l.barH - 96), !l.still);
      });
    });
  }, []);
  return { topRef, bring };
}
