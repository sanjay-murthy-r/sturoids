import { Platform, TextStyle } from 'react-native';

// ============================================================================
// Sturoids 3.6 — lit material
//
// Palette: Claude's dark theme greys, "Claude Surface" in the Palette Lab (picked 2026-09-15):
//   surface #30302E (the material)  canvas #262624  sidebar #1F1E1D  text #FAF9F5 / #C2C0B6 / #9C9A92
// Surfaces are lit material, in both looks: a tight contact shadow where a surface meets the ground, a softer key
// shadow thrown away from the light, and a one-pixel rim on the edge that faces it; a carved well shades the walls
// nearest the light and catches a faint lip on the far edge. It reads over any ground (Cheerful's drifting colour, a
// wallpaper), where the old dual-shadow recipe's pale highlight turned into a grey smudge. Each look has its own light:
// Elite the brand's studio light at 60° from the upper right (the icon's and the start screen's), Cheerful a warm
// daylight from straight above.
//
// Every shadow string is computed ONCE at load (see SKINS), so no render allocates a fresh one.
// ============================================================================

export type ThemeMode = 'default' | 'minimal';
export type AnimLevel = 'none' | 'some' | 'full';

// ---- Claude's dark greys: the material is Claude's raised surface ----
export const GREY = {
  g50: '#FAF9F5', // text
  g100: '#C2C0B6', // secondary text
  g400: '#9C9A92', // muted text
  g800: '#30302E', // surface: the material
  g900: '#262624', // canvas: the minimal theme's ground
};

// ---- the one light angle everything derives from ----
export const NEU_ANGLE = 60; // degrees
export const NEU_DIST = 6; // px, both sides
const rad = (NEU_ANGLE * Math.PI) / 180;
/** highlight offset (toward the light) */
export const LX = +(NEU_DIST * Math.cos(rad)).toFixed(2); // 3
export const LY = +(-NEU_DIST * Math.sin(rad)).toFixed(2); // -5.2
// dark side is the exact opposite end of the same line: (-LX, -LY)

// the two shadow sources — the ONLY colours the neumorphic recipe reads
// derived in CIELAB from the surface with the recipe's own lightness offsets (highlight L* +34, shadow L* -14.7)
const DARK_RGB = '17, 17, 15';
const LITE_RGB = '129, 129, 125';
export const darkSh = (a: number) => `rgba(${DARK_RGB}, ${a})`;
export const liteSh = (a: number) => `rgba(${LITE_RGB}, ${a})`;

/**
 * The start screen's plate keeps the brand's own dual-shadow look exactly as it was designed (the kit's pair at 90% of
 * its light), so the intro never changes with the app's surfaces. Only StartScreen reads these.
 */
const LIGHT = 0.9;
const raisedPair = (dA: number, lA0: number, dBlur: number, lBlur: number, k = 1, lA = lA0 * LIGHT) =>
  `${+(LX * k).toFixed(2)}px ${+(LY * k).toFixed(2)}px ${lBlur}px ${liteSh(lA)}, ` +
  `${+(-LX * k).toFixed(2)}px ${+(-LY * k).toFixed(2)}px ${dBlur}px ${darkSh(dA)}`;
export const BRAND_PLATE = Object.freeze({ boxShadow: raisedPair(0.48, 0.25, 15, 6) });

/* ---------------------------------------------------------------- lit material */

type Shadow = Readonly<{ boxShadow: string }>;
interface Skin {
  /** a raised surface as it rests: contact shadow, key shadow and lit rim */
  raisedLow: Shadow; raisedMid: Shadow; raisedHigh: Shadow;
  /** only the contact shadow: what a raised control keeps while it is pressed into the material */
  base: Shadow;
  /** only the key shadow and the rim: the layer a press fades out (see Bouncy) */
  keyLow: Shadow; keyMid: Shadow; keyHigh: Shadow;
  /** a carved well; hairline for anything under ~20 px on its short axis, where a full inner shade collapses */
  insetHairline: Shadow; insetLow: Shadow; insetMid: Shadow;
  /** the inner shade a pressed raised control shows, on an overlay inside it */
  pressedInner: Shadow;
  /** a well while its field has the focus: a step deeper */
  focusInner: Shadow;
}
const s = (boxShadow: string): Shadow => Object.freeze({ boxShadow });
function litSkin(contact: string, key: [string, string, string], rim: [string, string, string], wells: {
  hairline: string; low: string; mid: string; pressed: string; focus: string;
}): Readonly<Skin> {
  return Object.freeze({
    raisedLow: s(`${contact}, ${key[0]}, ${rim[0]}`),
    raisedMid: s(`${contact}, ${key[1]}, ${rim[1]}`),
    raisedHigh: s(`${contact}, ${key[2]}, ${rim[2]}`),
    base: s(contact),
    keyLow: s(`${key[0]}, ${rim[0]}`),
    keyMid: s(`${key[1]}, ${rim[1]}`),
    keyHigh: s(`${key[2]}, ${rim[2]}`),
    insetHairline: s(wells.hairline),
    insetLow: s(wells.low),
    insetMid: s(wells.mid),
    pressedInner: s(wells.pressed),
    focusInner: s(wells.focus),
  });
}

/**
 * Elite: the brand's studio light, 60° from the upper right. A shadow falls `d` px away from it, down and to the left
 * (`away`); the rim lights the top and right edges. Inset offsets paint the edge OPPOSITE the offset, so a well's
 * shade thrown `away` lands on its top and right walls (the walls nearest the light throw their shadow across the
 * floor), and the far lip (bottom, left) catches the light.
 */
const away = (d: number) => `${+(-LX / NEU_DIST * d).toFixed(2)}px ${+(-LY / NEU_DIST * d).toFixed(2)}px`;
const SHEEN = (a: number) => `rgba(250, 249, 245, ${a})`;
const ELITE = litSkin(
  `${away(1.15)} 2px ${darkSh(0.5)}`,
  [
    `${away(3)} 7px ${darkSh(0.34)}`,
    `${away(6)} 13px ${darkSh(0.4)}`,
    `${away(9)} 19px ${darkSh(0.44)}, ${away(14)} 30px ${darkSh(0.18)}`,
  ],
  [`inset -1px 1px 0px ${SHEEN(0.07)}`, `inset -1px 1px 0px ${SHEEN(0.08)}`, `inset -1px 1px 0px ${SHEEN(0.09)}`],
  {
    hairline: `inset ${away(2)} 2px ${darkSh(0.4)}`,
    low: `inset ${away(3)} 5px ${darkSh(0.44)}, inset 1px -1px 0px ${SHEEN(0.04)}`,
    mid: `inset ${away(4)} 6px ${darkSh(0.48)}, inset 1px -1px 0px ${SHEEN(0.05)}`,
    pressed: `inset ${away(3)} 6px ${darkSh(0.5)}`,
    focus: `inset ${away(5)} 8px ${darkSh(0.56)}, inset 1px -1px 0px ${SHEEN(0.06)}`,
  },
);

/**
 * Cheerful: a warm daylight from straight above. Shadows fall straight down in a warm dark, the rim lights the top edge
 * in a warm cream, wells shade from the top and catch a faint warm lip at the bottom. No pale grey light anywhere, so
 * nothing smudges over the drifting colour behind the pages.
 */
const WARM = (a: number) => `rgba(8, 6, 4, ${a})`;
const RIM = (a: number) => `rgba(255, 236, 214, ${a})`;
const CHEERFUL = litSkin(
  `0px 1px 2px ${WARM(0.3)}`,
  [`0px 3px 8px ${WARM(0.22)}`, `0px 6px 14px ${WARM(0.26)}`, `0px 10px 22px ${WARM(0.28)}, 0px 18px 36px ${WARM(0.12)}`],
  [`inset 0px 1px 0px ${RIM(0.06)}`, `inset 0px 1px 0px ${RIM(0.07)}`, `inset 0px 1px 0px ${RIM(0.08)}`],
  {
    hairline: `inset 0px 1px 2px ${WARM(0.3)}`,
    low: `inset 0px 1px 4px ${WARM(0.32)}, inset 0px -1px 0px ${RIM(0.04)}`,
    mid: `inset 0px 2px 6px ${WARM(0.36)}, inset 0px -1px 0px ${RIM(0.05)}`,
    pressed: `inset 0px 2px 6px ${WARM(0.36)}`,
    focus: `inset 0px 3px 8px ${WARM(0.42)}, inset 0px -1px 0px ${RIM(0.06)}`,
  },
);

/** Both looks' surfaces. Prefer neuRaised and the rest, which pick the look being drawn. */
export const SKINS = Object.freeze({ elite: ELITE, cheerful: CHEERFUL });
/** Elite's surfaces, for the few places drawn outside any look (prefer neuRaised and the rest). */
export const NEU = ELITE;

/**
 * No shadow at all, for a style that must take away one an earlier style gave (the minimal theme's flat controls). An
 * undefined value does not take it away everywhere (the PC's renderer keeps the earlier one), so it is said outright.
 */
export const NO_SHADOW: any = Platform?.OS === 'web' ? 'none' : [];

/** A carved well in either theme: the material's valley, or in the minimal theme a flat inset with a hairline. */
export const wellFor = (theme: ThemeMode, strength: 'hairline' | 'low' | 'mid' = 'low') =>
  (theme === 'minimal'
    ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border, boxShadow: NO_SHADOW }
    : { backgroundColor: C.inset, ...neuInset(strength) }) as any;

let cheerSkin = false;
/** Which look the surfaces wear: set from the mood by useTheme (src/components/UI.tsx), before anything is drawn. */
export function setSkin(cheerful: boolean) { cheerSkin = cheerful; }
export const cheerSkinOn = () => cheerSkin;
const skinNow = () => (cheerSkin ? CHEERFUL : ELITE);

/** Raised surface as it rests (frozen object — safe to spread in render). */
export const neuRaised = (strength: 'low' | 'mid' | 'high' = 'mid') => {
  const k = skinNow();
  return (strength === 'high' ? k.raisedHigh : strength === 'mid' ? k.raisedMid : k.raisedLow) as any;
};

/** Only a raised surface's contact shadow: what it keeps while pressed in. Pair it with neuKey on a layer inside. */
export const neuBase = () => skinNow().base as any;

/** Only a raised surface's key shadow and rim: the layer a press fades (neuBase stays on the surface itself). */
export const neuKey = (strength: 'low' | 'mid' | 'high' = 'mid') => {
  const k = skinNow();
  return (strength === 'high' ? k.keyHigh : strength === 'mid' ? k.keyMid : k.keyLow) as any;
};

/** Carved-in valley (frozen object — safe to spread in render). */
export const neuInset = (strength: 'hairline' | 'low' | 'mid' = 'mid') => {
  const k = skinNow();
  return (strength === 'mid' ? k.insetMid : strength === 'low' ? k.insetLow : k.insetHairline) as any;
};

/**
 * The inner shade a pressed raised control shows. Goes on an overlay inside the control, never on the control's own
 * surface, which keeps its silhouette.
 */
export const neuPressedInner = () => skinNow().pressedInner as any;

/** A well a step deeper, for a field while it has the focus: on an overlay inside the well. */
export const neuFocusInner = () => skinNow().focusInner as any;

/** Non-neumorphic lifts that still ride the same shadow source. */
export const SH = Object.freeze({
  /** a bottom sheet lifting off the material */
  sheetLift: `0 -8px 20px ${darkSh(0.45)}`,
  /**
   * The sheet's lifted panel with its lit top rim. The rim is an inset shadow, not a top border: Android draws a border
   * on one side of a rounded box as a straight band, which leaves square corners poking past the rounding.
   */
  sheetPanel: `0 -8px 20px ${darkSh(0.45)}, inset 0px 1.5px 0px ${liteSh(0.34)}`,
  /** Cheerful's sheet: the same lift in its warm shade, with its faint warm rim instead of the pale one (see CHEER_SKIN) */
  sheetPanelCheer: `0 -8px 20px ${WARM(0.4)}, inset 0px 1.5px 0px ${RIM(0.07)}`,
  /** the minimal theme's sheet: no lift, a hairline rim that follows the corners the same way */
  sheetPanelMin: `inset 0px 1px 0px ${liteSh(0.35)}`,
  /** the bar lifting off the screen edge */
  barLift: `0 -6px 14px ${darkSh(0.35)}`,
});

// ---- accent themes (complementary colour, user-selectable) ----
// seven curated accents, each distinct on the Claude surface. Iris and Terracotta (Claude's own orange, a shade lighter)
// were lifted in 1.7 so small text in them reads at 4.5:1 there; the store moves a saved accent to the new hexes
export const ACCENT_CHOICES: { key: string; label: string; color: string }[] = [
  { key: 'iris', label: 'Iris', color: '#9588F9' },
  { key: 'aqua', label: 'Aqua', color: '#4FC4B8' },
  { key: 'sky', label: 'Sky', color: '#5CA8F5' },
  { key: 'rose', label: 'Rose', color: '#F07E98' },
  { key: 'amber', label: 'Amber', color: '#EDAE49' },
  { key: 'mint', label: 'Mint', color: '#66D28F' },
  { key: 'terracotta', label: 'Terracotta', color: '#DB7E5F' },
];
export const DEFAULT_ACCENT = '#9588F9';

// ---- tokens ----
export const C = {
  bg: GREY.g800,          // #30302E, the material
  /** a hair lighter than the ground, as a surface that faces the light reads */
  card: '#333331',
  inset: '#2B2B29',       // a step below the surface: the carved floor
  lite: liteSh(0.34),
  border: liteSh(0.16),
  borderBright: 'rgba(222,220,209,0.28)',
  /** the resting edge of a flat control, such as a chip: Claude's own border tone */
  outline: 'rgba(222,220,209,0.16)',
  hairline: liteSh(0.2),
  text: GREY.g50,          // #FAF9F5
  textDim: GREY.g100,      // #C2C0B6
  textFaint: GREY.g400,    // #9C9A92, 4.69:1 on the surface
  // functional palette (accent is runtime-mutable via setAccent) — kit pastel family
  accent: DEFAULT_ACCENT,
  green: '#9AD6B0',
  amber: '#E3C08D',
  pink: '#E39EAC',
  teal: '#83DBD6',
  danger: '#E0958A',
  gold: '#D5C68E',
  slate: '#728AB7',
  /** Deep Work's ambient screen: true black, like an always-on display, so the glass itself goes dark */
  ambient: '#000000',
  /** toggle knob when off */
  knob: '#414240',
  /** glyphs sitting ON an accent fill */
  onAccent: GREY.g900,
  /** sheet / dialog backdrop */
  scrim: 'rgba(12,12,11,0.6)',
  /** the faint dim laid under a pressed carve */
  pressDim: darkSh(0.1),
  /** the faint light a pointer resting over something lays on it (the PC) */
  hover: 'rgba(250, 249, 245, 0.045)',
};

/** Runtime accent swap — the store keeps this in step with settings.accent. */
export function setAccent(hex: string) {
  (C as any).accent = hex || DEFAULT_ACCENT;
}

// high-contrast minimal variant (from the strip's dark end)
export const MIN = {
  bg: GREY.g900,     // #262624, Claude's canvas
  card: GREY.g800,   // #30302E, Claude's raised surface
  inset: '#1F1E1D',  // Claude's sidebar
  text: GREY.g50,
  textDim: C.textDim,
  textFaint: C.textFaint,
  hairline: liteSh(0.35),
  border: liteSh(0.35),
};

/**
 * Whether this phone can draw the default theme's depth. Android draws box shadows only from 9 (API 28): below it every
 * raised and carved surface would be the ground's own colour with no edge, so the default theme shows as Minimal there
 * (Settings says why). Platform is read defensively: the store's tests load this file without React Native.
 */
export const shadowsSupported = !(
  Platform?.OS === 'android' && typeof Platform.Version === 'number' && Platform.Version < 28
);

/** The theme as this phone shows it: the chosen one, or Minimal where shadows cannot be drawn. */
export const shownTheme = (theme: ThemeMode): ThemeMode => (shadowsSupported ? theme : 'minimal');

export const bgFor = (theme: ThemeMode) => (shownTheme(theme) === 'minimal' ? MIN.bg : C.bg);

// spacing rhythm on a 2pt grid, set generously: sections breathe and stacked controls never touch
export const S = {
  pad: 20,
  cardPad: 18,
  gap: 14,
  section: 34,
  radius: 22,
  radiusSm: 14,
};

/// ---- faces (the 1.8 pick, 2026-10-23): Inter Tight speaks in the usual case (titles, body, rows, buttons, fields),
// Schibsted Grotesk sets the small and secondary words (captions, sub-lines, labels, kickers, chips, the tab bar's
// names), Source Serif 4 titles the big screens and the writing surfaces, and Rubik stays only for the intro's wordmark
// and the colophon. Where fontFamily is set, fontWeight must NOT be: Android fake-bolds any family+weight combo. ----
export const F = {
  reg: 'InterTight_400Regular',
  med: 'InterTight_500Medium',
  semi: 'InterTight_600SemiBold',
  bold: 'InterTight_700Bold',
  /**
   * small and secondary text (Schibsted Grotesk): captions, sub-lines, labels, kickers, chip and pill text, helper
   * lines, the tab bar's names. Never with tabular figures (its tabular digits are wide and spaced): anything with
   * aligned or counting digits is set in Inter Tight instead.
   */
  sm: 'SchibstedGrotesk_400Regular',
  smMed: 'SchibstedGrotesk_500Medium',
  smSemi: 'SchibstedGrotesk_600SemiBold',
  /** the serif: a big screen title (T.display) and a writing surface's heading, a note's title and the journal's date */
  head: 'SourceSerif4_500Medium',
  /** the serif for long writing, when the Writing font is Serif (see writingFace) */
  serif: 'SourceSerif4_400Regular',
  /** counting numbers: timers, clocks and big figures, always with tabular figures (Inter Tight Light) */
  num: 'InterTight_300Light',
  /** the intro's wordmark and caption keep Rubik, the face its timing and shine were set to, and so does the colophon */
  brand: 'Rubik_600SemiBold',
  brandMed: 'Rubik_500Medium',
  /** Cheerful's round face (Nunito): its big titles and the bar's title, and the companion's words */
  cute: 'Nunito_700Bold',
  cuteBold: 'Nunito_800ExtraBold',
};

/**
 * Inter Tight Light's figure cell and its colon, as shares of the font size: the cells a rolling clock sets each digit
 * in, so a count never shifts sideways. Measured from InterTight_300Light.ttf with fontTools (2048 units to the em):
 * the proportional figures run 0.359 ('1') to 0.598 ('3'), and the GSUB 'tnum' lookup maps every figure to a glyph
 * 1222 units wide (0.597). The cell takes the larger of the two, 0.598, so a digit fits whether or not the tabular
 * feature is applied. The colon is 0.249 proportional and 0.237 tabular; the cell takes 0.249.
 */
export const NUM_DIGIT_W = 0.598;
export const NUM_COLON_W = 0.249;

// ---- tracking: Inter Tight is narrow and tight by design, so it opens a little at reading sizes and closes a little as
// it grows; Schibsted takes the small sizes and the caps. Styles take their value from here instead of a bare number. ----
export const TRACK = {
  /** Source Serif display titles, 30 px */
  display: -0.4,
  /** Inter Tight semibold, 20 to 22 px */
  large: -0.3,
  /** Inter Tight semibold, 16 to 18 px */
  title: -0.1,
  /** 15 px and the 16 px reading size */
  body: 0.15,
  /** 13 to 14 px (Schibsted) */
  small: 0.1,
  /** 11 to 12 px in mixed case (Schibsted) */
  fine: 0.2,
  /** small UPPERCASE labels in Schibsted: kickers, section caps, pills */
  caps: 1.1,
};

/**
 * How far the phone's font size may grow fixed chrome (maxFontSizeMultiplier): chips, segmented controls, the tab bar's
 * names, the PIN keypad, the time wheel. The tool header's compact title stops at 1.2. Reading text is never capped.
 */
export const CHROME_FONT_MAX = 1.3;

/**
 * A single-line label in a control of fixed height (a chip, a pill, a segment, a key, a wheel's number): Android's font
 * padding is dropped and the line box set to 1.2 times the size, so the face centres truly in its control. For a
 * StyleSheet (it builds a new object).
 */
export const oneLine = (size: number) => ({
  fontSize: size,
  lineHeight: Math.round(size * 1.2),
  includeFontPadding: false,
  textAlignVertical: 'center' as const,
});

// type scale (~1.25 ratio)
export type TName =
  | 'display' | 'h1' | 'head' | 'title' | 'body' | 'bodyLong' | 'label' | 'caption' | 'kicker'
  | 'numHero' | 'numWheel' | 'numAmbient' | 'numStat' | 'numDisplay';

// faces carry the weight, so no token can hold a fontWeight (scripts/lint-type.js guards the call sites too)
export const T: Record<TName, Omit<TextStyle, 'fontWeight'>> = {
  /**
   * a big screen title: Today's greeting, More, Planner, Tasks, the Deep Work title (the one serif in the chrome). Source
   * Serif's line box is tall (1.036 / -0.335 em), so the line is 38 and an ascender never clips on Android
   */
  display: { color: C.text, fontFamily: F.head, fontSize: 30, lineHeight: 38, letterSpacing: TRACK.display },
  h1: { color: C.text, fontFamily: F.semi, fontSize: 22, lineHeight: 28, letterSpacing: TRACK.large },
  /** a page's name in its header, and a hero line such as the next planned block */
  head: { color: C.text, fontFamily: F.semi, fontSize: 20, lineHeight: 26, letterSpacing: TRACK.large },
  title: { color: C.text, fontFamily: F.semi, fontSize: 17, letterSpacing: TRACK.title },
  body: { color: C.text, fontFamily: F.reg, fontSize: 15, lineHeight: 21, letterSpacing: TRACK.body },
  /** long-form writing in the sans (a writing surface's body follows the Writing font: see writingFace) */
  bodyLong: { color: C.text, fontFamily: F.reg, fontSize: 16, lineHeight: 26, letterSpacing: TRACK.body },
  /** a small label or a row's sub-line (Schibsted Medium) */
  label: { color: C.textDim, fontFamily: F.smMed, fontSize: 13, letterSpacing: TRACK.small },
  /** helper text, captions and footers (Schibsted) */
  caption: { color: C.textFaint, fontFamily: F.sm, fontSize: 12, lineHeight: 17, letterSpacing: TRACK.fine },
  kicker: {
    color: C.textFaint, fontFamily: F.smSemi, fontSize: 11,
    letterSpacing: TRACK.caps, textTransform: 'uppercase',
  },
  // counting numbers: large figures in Inter Tight Light, small ones in Inter Tight Medium, always with tabular figures
  /** the Deep Work clock */
  numHero: { color: C.text, fontFamily: F.num, fontSize: 48, fontVariant: ['tabular-nums'] },
  /** the Deep Work minutes wheel */
  numWheel: { color: C.text, fontFamily: F.num, fontSize: 52, lineHeight: 64, fontVariant: ['tabular-nums'] },
  /** the ambient clock */
  numAmbient: { color: C.text, fontFamily: F.num, fontSize: 68, fontVariant: ['tabular-nums'] },
  /** big figures: an exam's result */
  numDisplay: { color: C.text, fontFamily: F.num, fontSize: 44, fontVariant: ['tabular-nums'] },
  /** glance figures: Today, the journal's stats, marks */
  numStat: { color: C.text, fontFamily: F.med, fontSize: 22, letterSpacing: TRACK.large, fontVariant: ['tabular-nums'] },
};

/** The face a writing surface's body is set in (Settings, Appearance, Writing font). */
export type WritingFont = 'sans' | 'serif';

const WRITING: Record<WritingFont, TextStyle> = {
  sans: Object.freeze({ fontFamily: F.reg, fontSize: 16, lineHeight: 26, letterSpacing: TRACK.body }) as TextStyle,
  serif: Object.freeze({ fontFamily: F.serif, fontSize: 17, lineHeight: 27, letterSpacing: 0 }) as TextStyle,
};

/**
 * The body style for long writing (a note's body, a journal page) in the Writing font picked in Settings, Appearance:
 * Inter Tight, or Source Serif 4 a size up and a line taller. Titles keep their own faces. Anything but 'serif' is the
 * sans. Frozen: safe to spread in render.
 */
export const writingFace = (kind: WritingFont | undefined | null): TextStyle => WRITING[kind === 'serif' ? 'serif' : 'sans'];

export const BLOCK_COLORS = ['#9DBCE3', '#9AD6B0', '#E3C08D', '#E39EAC', '#745FF2', '#83DBD6', '#C2D392', '#D5C68E'];
