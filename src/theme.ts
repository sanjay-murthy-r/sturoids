import { TextStyle } from 'react-native';

// ============================================================================
// Sturoids v4 — dark soft-UI (dual-shadow neumorphism)
//
// Palette extracted from "Gray colour strip.svg" (exact, not guessed):
//   #F4F5F7  #DDE3ED  #808B9F  #5B6577  #39404E  #2C2D30
// Shadow system extracted from "Neumorphism UI Kit (Community).svg":
//   dual drop-shadows per surface — dark side rgb(174,174,192) @ 0.2/0.4/0.6,
//   light side rgb(255,255,255) @ 0.7/1.0, blur ≈ 1.4 × offset distance,
//   inner (pressed) variants use the same pair inverted.
// Overrides requested: distance = 6px for BOTH sides, light angle = 60°,
// dark side derived automatically as the exact opposite (240°).
// ============================================================================

export type ThemeMode = 'default' | 'minimal';
export type AnimLevel = 'none' | 'some' | 'full';

// ---- greys from the strip (g800 deepened one step per user request) ----
export const GREY = {
  g50: '#F4F5F7',
  g100: '#DDE3ED',
  g400: '#808B9F',
  g800: '#343A47',
  g900: '#2C2D30',
};

// ---- the one light angle everything derives from ----
export const NEU_ANGLE = 60; // degrees
export const NEU_DIST = 6; // px, both sides
const rad = (NEU_ANGLE * Math.PI) / 180;
/** highlight offset (toward the light) */
export const LX = +(NEU_DIST * Math.cos(rad)).toFixed(2); // 3
export const LY = +(-NEU_DIST * Math.sin(rad)).toFixed(2); // -5.2
// dark side is the exact opposite end of the same line: (-LX, -LY)

// dark theme shadow pair, colours from the strip (alpha tiers from the kit)
const darkSh = (a: number) => `rgba(24, 26, 30, ${a})`; // derived from #2C2D30 deepened for contrast on g800
const liteSh = (a: number) => `rgba(128, 139, 159, ${a})`; // #808B9F — the strip's light grey

/**
 * Raised surface: highlight toward the light, dark shadow opposite.
 * Asymmetric pair: tight, restrained highlight (~55% of the dark blur, low
 * alpha, natural gaussian falloff), softer wider dark side.
 */
export const neuRaised = (strength: 'low' | 'mid' | 'high' = 'mid') => {
  // light deliberately weaker AND tighter than the shadow (user-tuned);
  // the dark side keeps its intensity/radius — do not re-balance them.
  const [dA, lA, dBlur, lBlur] =
    strength === 'high' ? [0.48, 0.25, 15, 6] : strength === 'mid' ? [0.4, 0.22, 12, 5] : [0.32, 0.18, 9, 4];
  return {
    boxShadow:
      `${LX}px ${LY}px ${lBlur}px ${liteSh(lA)}, ` +
      `${-LX}px ${-LY}px ${dBlur}px ${darkSh(dA)}`,
  } as any;
};

/**
 * Carved-in valley. Physics: inside a pit, the wall NEAREST the light throws
 * its shadow across the floor (dark hugs the light-side edges — here top and
 * right, since the light sits at 60°), while the FAR lip catches the light
 * (light hugs the bottom-left edges). CSS inset offsets place a shadow on the
 * edge OPPOSITE the offset direction, so: dark = (-LX,-LY), light = (LX,LY) —
 * the exact mirror of the raised pair, matching the kit's pressed recipe.
 */
export const neuInset = (strength: 'low' | 'mid' = 'mid') => {
  const [dA, lA, dBlur, lBlur] = strength === 'mid' ? [0.5, 0.2, 10, 5] : [0.38, 0.16, 8, 4];
  return {
    boxShadow:
      `inset ${LX}px ${LY}px ${lBlur}px ${liteSh(lA)}, ` +
      `inset ${-LX}px ${-LY}px ${dBlur}px ${darkSh(dA)}`,
  } as any;
};

/**
 * Kit "pressed" state, dark adaptation — the inner panel that carves into a
 * control which keeps its own raised silhouette (and the kit's faint rim
 * border) from its call site. Goes on an overlay/panel inside the control,
 * never on the control surface itself.
 */
export const neuPressedInner = () => ({
  boxShadow:
    `inset ${LX}px ${LY}px 5px rgba(128,139,159,0.14), ` +
    `inset ${-LX}px ${-LY}px 8px rgba(24,26,30,0.50)`,
} as any);

// ---- accent themes (complementary colour, user-selectable) ----
// six curated accents — distinct hues, saturated enough to strike on #343A47
export const ACCENT_CHOICES: { key: string; label: string; color: string }[] = [
  { key: 'iris', label: 'Iris', color: '#8B7CF8' },
  { key: 'aqua', label: 'Aqua', color: '#4FC4B8' },
  { key: 'sky', label: 'Sky', color: '#5CA8F5' },
  { key: 'rose', label: 'Rose', color: '#F07E98' },
  { key: 'amber', label: 'Amber', color: '#EDAE49' },
  { key: 'mint', label: 'Mint', color: '#66D28F' },
];
export const DEFAULT_ACCENT = '#8B7CF8';

// ---- tokens ----
export const C = {
  bg: GREY.g800,          // #343A47 — the material
  card: GREY.g800,        // classic soft-UI: same colour, depth from shadows
  inset: '#2F3541',       // g800 dimmed ~2% (kit's #EEEEEE-vs-#F0F0F3 ratio)
  lite: 'rgba(128,139,159,0.34)',
  border: 'rgba(128,139,159,0.16)',
  borderBright: 'rgba(221,227,237,0.28)',
  hairline: 'rgba(128,139,159,0.20)',
  text: GREY.g50,          // #F4F5F7
  textDim: GREY.g100 + 'C9', // #DDE3ED at ~79%
  textFaint: GREY.g400,    // #808B9F
  // functional palette (accent is runtime-mutable via setAccent) — kit pastel family
  accent: DEFAULT_ACCENT,
  green: '#9AD6B0',
  amber: '#E3C08D',
  pink: '#E39EAC',
  violet: '#745FF2',
  teal: '#83DBD6',
  danger: '#E0958A',
  gold: '#D5C68E',
  slate: '#728AB7',
};

/** Runtime accent swap — the whole tree re-renders from the root when it changes. */
export function setAccent(hex: string) {
  (C as any).accent = hex || DEFAULT_ACCENT;
}

// high-contrast minimal variant (from the strip's dark end)
export const MIN = {
  bg: GREY.g900,     // #2C2D30
  card: GREY.g800,   // #343A47
  inset: '#232427',
  text: '#FFFFFF',
  border: 'rgba(128,139,159,0.35)',
};

export const bgFor = (theme: ThemeMode) => (theme === 'minimal' ? MIN.bg : C.bg);

// spacing rhythm: 4pt grid
export const S = {
  pad: 20,
  cardPad: 16,
  gap: 12,
  section: 28,
  radius: 22,
  radiusSm: 14,
};

// ---- Rubik (the kit's face). Where fontFamily is set, fontWeight must NOT
// be — Android fake-bolds any family+weight combo. ----
export const F = {
  reg: 'Rubik_400Regular',
  med: 'Rubik_500Medium',
  semi: 'Rubik_600SemiBold',
  bold: 'Rubik_700Bold',
  /** timers / counters — clean mono digits, naturally stable width */
  mono: 'IBMPlexMono_600SemiBold',
};

// type scale (~1.25 ratio)
export const T: Record<string, TextStyle> = {
  display: { color: C.text, fontFamily: F.bold, fontSize: 30, letterSpacing: -0.5 },
  h1: { color: C.text, fontFamily: F.bold, fontSize: 24, letterSpacing: -0.3 },
  title: { color: C.text, fontFamily: F.semi, fontSize: 17, letterSpacing: -0.1 },
  body: { color: C.text, fontFamily: F.reg, fontSize: 15, lineHeight: 21 },
  label: { color: C.textDim, fontFamily: F.med, fontSize: 13, letterSpacing: 0.1 },
  caption: { color: C.textFaint, fontFamily: F.reg, fontSize: 12, lineHeight: 17 },
  kicker: {
    color: C.textFaint, fontFamily: F.semi, fontSize: 11,
    letterSpacing: 2.2, textTransform: 'uppercase',
  },
};

export const BLOCK_COLORS = ['#9DBCE3', '#9AD6B0', '#E3C08D', '#E39EAC', '#745FF2', '#83DBD6', '#C2D392', '#D5C68E'];
