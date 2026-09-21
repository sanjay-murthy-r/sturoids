import { useWindowDimensions, ViewStyle } from 'react-native';

// Window sizes. Everything narrower than WIDE_AT is a phone and is laid out exactly as it always was: every helper
// here either returns today's values there, or caps at a width no phone reaches.

/** From this window width the app lays out for a tablet: the side rail, capped columns, wider grids. */
export const WIDE_AT = 600;
/** Lists, settings and editors: no wider than a comfortable reading measure. */
export const READ_MAX = 720;
/** Dashboards and grids. */
export const WIDE_MAX = 1040;
/** The left tab rail on a wide window, its hairline included. */
export const RAIL_W = 88;
/** From this width of a screen's area (a sideways tablet), a screen may set two columns side by side. */
export const TWO_COL_AT = 900;

export interface Layout {
  width: number;
  height: number;
  /** 600 dp or wider */
  wide: boolean;
  landscape: boolean;
}

export function useLayout(): Layout {
  const { width, height } = useWindowDimensions();
  return { width, height, wide: width >= WIDE_AT, landscape: width > height };
}

/** A centred column no wider than `max`. A phone is narrower than any cap, so there it changes nothing. */
export function frame(max: number = READ_MAX): ViewStyle {
  return { width: '100%', maxWidth: max, alignSelf: 'center' };
}

/**
 * The width a screen's centred column will have, known before it lays out: the window, less the rail when the screen
 * sits in a tab, capped at `max`. On a phone it is the window's width.
 */
export function columnWidth(windowW: number, inTab: boolean, max: number = READ_MAX): number {
  if (windowW < WIDE_AT) return windowW;
  return Math.min(max, windowW - (inTab ? RAIL_W : 0));
}

/** How many columns at least `minW` wide fit in `width`, never fewer than `min`. */
export function columnsFor(width: number, minW: number, min: number): number {
  return Math.max(min, Math.floor(width / minW));
}
