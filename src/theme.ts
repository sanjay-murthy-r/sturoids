import { TextStyle } from 'react-native';

// Quiet Glass design language — single source of truth for colour, space, type.
export const C = {
  bg: '#0A0F1E',
  bgCard: '#121A30',
  bgCardSolid: '#141C33',
  border: 'rgba(255,255,255,0.09)',
  borderBright: 'rgba(255,255,255,0.18)',
  hairline: 'rgba(255,255,255,0.07)',
  text: '#EEF2FB',
  textDim: 'rgba(238,242,251,0.64)',
  textFaint: 'rgba(238,242,251,0.40)',
  accent: '#8FB4FF', // focus / primary
  green: '#5EE6A8', // done / habits
  amber: '#FFB46B', // deadlines / missions
  pink: '#FF8FB0', // vault / video
  violet: '#B49AFF',
  teal: '#5ED4E6',
  danger: '#FF7A7A',
};

// spacing rhythm: 4pt grid — screens 20, cards 16, gaps 12, sections 28
export const S = {
  pad: 20,
  cardPad: 16,
  gap: 12,
  section: 28,
  radius: 22,
  radiusSm: 14,
};

// type scale (≈1.25 ratio), tight tracking on display sizes, airy on micro-labels
export const T: Record<string, TextStyle> = {
  display: { color: C.text, fontSize: 30, fontWeight: '800', letterSpacing: -0.7 },
  h1: { color: C.text, fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  title: { color: C.text, fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
  body: { color: C.text, fontSize: 15, fontWeight: '400', lineHeight: 21 },
  label: { color: C.textDim, fontSize: 13, fontWeight: '600' },
  caption: { color: C.textFaint, fontSize: 12, fontWeight: '400', lineHeight: 17 },
  kicker: {
    color: C.textFaint, fontSize: 11, fontWeight: '700',
    letterSpacing: 2.2, textTransform: 'uppercase',
  },
  num: { fontVariant: ['tabular-nums'] as any },
};

export const BLOCK_COLORS = [C.accent, C.green, C.amber, C.pink, C.violet, C.teal];

export type GlassIntensity = 'off' | 'subtle' | 'full';
