import React from 'react';
import {
  View, Text, StyleSheet, Pressable, TextInput, Modal, ViewStyle, AccessibilityState, Keyboard,
  KeyboardAvoidingView, Platform, ScrollView, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Directions, Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Easing, Extrapolation, interpolate, runOnJS, useAnimatedReaction, useAnimatedScrollHandler, useAnimatedStyle,
  useDerivedValue, useSharedValue, withDelay, withSequence, withSpring, withTiming, LayoutAnimationConfig } from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import {
  AnimLevel, C, CHROME_FONT_MAX, F, MIN, S, SH, T, TRACK, ThemeMode, bgFor, darkSh, neuRaised, neuInset, neuPressedInner,
  oneLine, shownTheme,
} from '../theme';
import { useStore } from '../store';
import {
  ARRIVE, Bouncy, CHANGE, EASE_EXIT, EASE_OUT, FADE_IN, FADE_OUT, FadeSwap, LEAVE, PressRole, RISE_OUT, glide, rowIn,
  rowOut, useAnimLevel, useAppear, useBreath, useEntrance,
} from './Motion';
import { tap, tick } from '../haptics';
import { stepTab } from '../toolNav';
import { READ_MAX, WIDE_AT } from '../layout';
import { openSift, siftPull } from '../search/store';
import { TimeWheel, defaultTime, isTime, timeLabel } from './TimeWheel';

export { TimeWheel } from './TimeWheel';

export const useTheme = (): ThemeMode => {
  // subscribing to the accent here makes EVERY themed component repaint the
  // moment a new accent is picked — no remount required
  useStore((s) => s.settings.accent);
  // a phone that cannot draw shadows shows the default theme as Minimal (see shadowsSupported)
  return shownTheme(useStore((s) => s.settings.theme));
};

/**
 * Screen background.
 * `guard` marks a screen shown in the tab bar: it paints an opaque status-bar zone and lets a
 * left or right fling move to the neighbouring tab, in bar order. `fling={false}` keeps the guard
 * but leaves horizontal gestures to the screen (a pager, a web view).
 * On a wide window the screen sits in a centred column no wider than `maxWidth` (null: the whole width), so its
 * header, its content and its floating buttons line up; on a phone nothing changes.
 */
export function ScreenBG({ children, guard = false, fling = true, maxWidth = READ_MAX }: {
  children: React.ReactNode; guard?: boolean; fling?: boolean; maxWidth?: number | null;
}) {
  const theme = useTheme(); // subscribes to the accent too, so every screen repaints on a new accent
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const bg = bgFor(theme);
  const column = maxWidth != null && width >= WIDE_AT;

  const go = React.useCallback((dir: 1 | -1) => {
    if (stepTab(dir)) tick();
  }, []);

  const gesture = React.useMemo(() => Gesture.Race(
    Gesture.Fling().direction(Directions.LEFT).onEnd(() => { 'worklet'; runOnJS(go)(1); }),
    Gesture.Fling().direction(Directions.RIGHT).onEnd(() => { 'worklet'; runOnJS(go)(-1); }),
  ), [go]);

  const body = (
    <View style={{ flex: 1, backgroundColor: bg }}>
      {column ? <View style={{ flex: 1, width: '100%', maxWidth: maxWidth as number, alignSelf: 'center' }}>{children}</View> : children}
      {guard && (
        <View
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top, backgroundColor: bg }}
        />
      )}
    </View>
  );
  if (!guard || !fling) return body;
  return <GestureDetector gesture={gesture}>{body}</GestureDetector>;
}

/* ---------------------------------------------------------------- the tool header */

/** A piece of a context line: plain words, or words picked out in the brighter ink (the subject on now). */
export type ContextPart = string | { em: string };

/** One flat icon button of a header's tray. */
export interface ToolAction {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  /** what it does: read by a screen reader, and the row's name if the action lands in the overflow menu */
  label: string;
  onPress: () => void;
  /** the icon's colour; the dim text ink when left out */
  color?: string;
  /**
   * For an action that switches something on and off (the Planner's bell): whether it is on now. A screen reader then
   * hears a switch with its state, under one name that never changes.
   */
  on?: boolean;
}

export interface ToolHeaderOptions {
  /** the tool's name: the big title in tab mode, the compact one in the bar */
  title: string;
  /** `tab` is the root of a bar slot (no back), `page` a full page with a back button; page when left out */
  mode?: 'tab' | 'page';
  /** the one fact you open the tool for, built with contextLine; none, and no line renders at all */
  context?: string | ContextPart[] | null;
  /** something is happening at this very moment (a block, a session, a deadline within the hour): the breathing dot */
  live?: boolean;
  /** the screen is covered by something full-screen, so the dot's breath rests until it is seen again */
  covered?: boolean;
  /** at most two sit in the tray; with more, the first stays beside an overflow button that opens the rest in a menu */
  actions?: ToolAction[];
  /** free-form tray content, for the screens that have not moved to `actions` yet (a tab's big title leaves no room for it) */
  right?: React.ReactNode;
  onBack?: () => void;
  /**
   * An animated style for what the bar holds (the compact title and the tray) and not for its ground, so a screen whose
   * chrome stands back while the page is written in can fade and move it without the page showing through the ground.
   */
  contentStyle?: React.ComponentProps<typeof Animated.View>['style'];
  /**
   * Tab mode only: a one-finger drag down from inside the bar opens Sift (useHeaderPull). On by default in tab mode;
   * a screen that is not calm right now (Deep Work running, the journal's page, an edit mode) passes false.
   */
  pull?: boolean;
}

/** The compact title and the context line, set as the Header Lab drew them. */
const CTX_SIZE = 12.5; // the lab's size, which falls between the type scale's whole sizes, so it is named here
const CTX_EM_MAX = 26;
/** the bar: a 40 high row between 8 above (below the status bar) and 8 below, so 56 with the status bar's inset */
const BAR_ROW = 40;
const BAR_PAD = 8;
const BAR_SIDE = 12;
const BACK_W = 40;
const TITLE_GAP = 4;
/** the tray's pill: its buttons, the padding and gaps between them, and the space before it, which the big title leaves free */
const TRAY_BTN = 36;
const TRAY_PAD = 2;
const TRAY_GAP = 2;
const TRAY_LEAD = 12;
/** where a page's compact title starts, less the content's own side padding: its context line is indented to meet it */
const PAGE_INDENT = BAR_SIDE + BACK_W + TITLE_GAP - S.pad;
/** a tab's big title (the hero's first line) and the space above it inside the hero */
const DISPLAY_LINE = T.display.lineHeight as number;
const HERO_TOP = 4;
/** the scroll offsets over which the compact title takes the big title's place (the big title leaves the bar's row by its line) */
const TITLE_FROM = 12;
const TITLE_TO = DISPLAY_LINE;
const SHADE = [darkSh(0.3), darkSh(0)] as const;

/** How much of an edge shows at a scroll offset: none at the top, all of it once the content has moved 14; a step with no motion. */
export const edgeStrength = (y: number, level: AnimLevel) => {
  'worklet';
  return level === 'none' ? (y > 2 ? 1 : 0) : interpolate(y, [2, 14], [0, 1], Extrapolation.CLAMP);
};

/** How far the compact title has taken the big title's place: 0 at rest, 1 once the big title has scrolled away; a step with no motion. */
const swapProgress = (y: number, level: AnimLevel) => {
  'worklet';
  return level === 'none' ? (y > (TITLE_FROM + TITLE_TO) / 2 ? 1 : 0) : interpolate(y, [TITLE_FROM, TITLE_TO], [0, 1], Extrapolation.CLAMP);
};

const clipEm = (p: ContextPart): ContextPart => (
  typeof p === 'string' || p.em.length <= CTX_EM_MAX ? p : { em: p.em.slice(0, CTX_EM_MAX - 1).trimEnd() + '…' }
);
const textOf = (p: ContextPart) => (typeof p === 'string' ? p : p.em);

/**
 * Builds a context line from its facts, joined with " · ". Anything empty (null, false, '') is left out, so a fact with
 * nothing to say never leaves a stray separator; with no facts at all it returns null and no line renders. A fact is a
 * string, an `{ em }` for words picked out in the brighter ink, or a list of those. An `{ em }` longer than 26 characters
 * is cut with an ellipsis, so the rest of the line is never pushed off the end.
 *
 *   contextLine([{ em: 'Organic chem' }, ' until 11:30'], blocks > 0 && blocks + ' blocks today')
 */
export function contextLine(...facts: (ContextPart | ContextPart[] | null | false | undefined)[]): ContextPart[] | null {
  const out: ContextPart[] = [];
  for (const fact of facts) {
    if (!fact) continue;
    const parts = (Array.isArray(fact) ? fact : [fact]).map(clipEm).filter((p) => textOf(p) !== '');
    if (!parts.length) continue;
    if (out.length) out.push(' · ');
    out.push(...parts);
  }
  return out.length ? out : null;
}

const partsOf = (context: ToolHeaderOptions['context']): ContextPart[] | null => {
  if (!context) return null;
  const parts = typeof context === 'string' ? [context] : context;
  return parts.some((p) => textOf(p) !== '') ? parts : null;
};

/**
 * The tool header: one for every tool (the Header Lab's "Context line"). A screen calls it once and places the pieces:
 *
 *   const header = useToolHeader({ title: 'Planner', mode: tabMode ? 'tab' : 'page', context, live, actions });
 *   <ScreenBG guard={tabMode}>
 *     {header.bar}
 *     <Animated.ScrollView {...header.scrollProps} contentContainerStyle={{ padding: S.pad, paddingTop: header.padTop }}>
 *       <Enter index={0}>{header.hero}{firstBlock}</Enter>
 *
 * `bar` holds a flat back chevron (page mode), the compact title, and a carved tray of at most two icon actions. In page
 * mode it sits above the scroll, opaque in the screen's colour. In tab mode it is laid over the top of its parent (the
 * screen's area, or a wrapper at its top), so the big title sits level with the tray: its ground is clear at rest and
 * fills in with the screen's colour as the big title scrolls away, and touches in the clear parts reach the scroll
 * beneath (once the ground is more than half in, it takes them). Once the content has scrolled, a hairline and a soft shade fade in under it (in tab mode, with the ground).
 * `hero` is the first thing in the scroll and joins the screen's first entrance (put it inside that Enter, not in one
 * of its own): in tab mode the big title, with the compact one in the bar fading in as it scrolls away, and the context
 * line under it; in page mode only the context line, indented to start under the compact title. It is laid out inside
 * a scroll content that has S.pad on its sides. `scrollProps` goes on the Animated ScrollView or FlatList: the scroll
 * offset runs on the UI thread, and nothing is animated in height or layout. `padTop` is the content's top padding: in
 * tab mode it lifts the hero to the bar's row, in page mode it clears the bar above. `barH` is how much of the top the
 * bar covers (tab mode; 0 in page mode, where the bar has its own space), for a screen that sets something other than
 * the hero first. `scrollY` is the offset the bar follows, for a screen that sends its scroll back to the top without the
 * user's hand (a new level of Scores): it sets the offset to 0 with the scroll, so the bar never keeps the old page's.
 *
 * The title and the context line cross-fade when they change. `live` is for something happening this minute and
 * nothing else: it adds a 7 dp accent dot before the context line that breathes at full motion, while the screen is in
 * front and the app is open. A line that changes with the clock (a block ends, a deadline nears) needs its screen to
 * re-render on the minute: useNow does that, only while the screen is in front.
 */
export function useToolHeader({
  title, mode = 'page', context, live = false, covered = false, actions, right, onBack, contentStyle, pull = true,
}: ToolHeaderOptions) {
  const insets = useSafeAreaInsets();
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => { scrollY.value = e.contentOffset.y; });
  const scrollProps = React.useMemo(() => ({ onScroll, scrollEventThrottle: 16 }), [onScroll]);
  const parts = partsOf(context);
  const tab = mode === 'tab';
  // the big title shares the tray's row, so it leaves the tray's width free on its right (the overflow button takes the
  // second place when there are more than two actions)
  const slots = Math.min(2, (actions ?? []).length);
  const reserve = slots ? TRAY_LEAD + TRAY_PAD * 2 + TRAY_BTN * slots + TRAY_GAP * (slots - 1) : 0;
  return {
    bar: (
      <ToolBar
        title={title} back={!tab} onBack={onBack} actions={actions} right={right} scrollY={scrollY} overlay={tab}
        contentStyle={contentStyle} pull={tab && pull}
      />
    ),
    hero: <ToolHero title={title} tab={tab} parts={parts} live={live && parts != null} covered={covered} reserve={tab ? reserve : 0} />,
    scrollProps,
    scrollY,
    // tab: the big title's line is centred on the bar's row, beside the tray; the hero's own top padding is part of the lift
    padTop: tab ? insets.top + BAR_PAD + (BAR_ROW - DISPLAY_LINE) / 2 - HERO_TOP : parts ? 4 : 12,
    barH: tab ? insets.top + BAR_PAD * 2 + BAR_ROW : 0,
  };
}

/**
 * The older way in: just the bar, with the title always showing, for the screens that have not moved to
 * useToolHeader. Its title can change in place and cross-fades; `compact` no longer does anything, since the bar is one
 * line in every mode.
 */
export function NeuHeader({ title, right, onBack, variant = 'page' }: {
  title: string; right?: React.ReactNode; onBack?: () => void; variant?: 'page' | 'tab'; compact?: boolean;
}) {
  return <ToolBar title={title} back={variant === 'page'} onBack={onBack} right={right} />;
}

/** One flat icon button of the tray: it carves in while pressed. */
function TrayButton({ action }: { action: ToolAction }) {
  const toggles = action.on !== undefined;
  return (
    <Bouncy
      onPress={action.onPress} scaleTo={1} sink={false} radius={18} hitSlop={4}
      accessibilityLabel={action.label} accessibilityRole={toggles ? 'switch' : 'button'}
      accessibilityState={toggles ? { checked: action.on } : undefined} style={hdr.trayBtn}
    >
      <Ionicons name={action.icon} size={19} color={action.color || C.textDim} />
    </Bouncy>
  );
}

function ToolBar({ title, back, onBack, actions, right, scrollY, overlay = false, contentStyle, pull = false }: {
  title: string; back: boolean; onBack?: () => void; actions?: ToolAction[]; right?: React.ReactNode;
  /** the offset the edge follows; without it (the older NeuHeader) the bar has no hairline or shade */
  scrollY?: SharedValue<number>;
  /** the tab-mode bar: laid over the top of its parent with a ground that fills in as the big title scrolls away, and
      a compact title that waits for it, instead of an opaque bar above the scroll that always shows its title */
  overlay?: boolean;
  contentStyle?: ToolHeaderOptions['contentStyle'];
  /** a drag down from inside the bar opens Sift (tab mode, calm screens) */
  pull?: boolean;
}) {
  const theme = useTheme();
  const level = useAnimLevel();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const headerPull = useHeaderPull(pull && overlay);
  const pullRow = useAnimatedStyle(() => ({
    transform: [{ translateY: level === 'full' ? 6 * Math.min(1.3, headerPull.progress.value) : 0 }],
  }));
  const [overflow, setOverflow] = React.useState(false);
  const own = useSharedValue(0);
  const y = scrollY ?? own;
  const minimal = theme === 'minimal';

  // the compact title takes the big title's place as it scrolls up under the bar: it rises a few points and fills in
  // with full motion, only fills in with some, and is a step with none. The ground fills in over the same offsets, so
  // the big title leaves behind it, and the hairline and shade come with the ground, never before it. All on the UI thread
  const swap = useDerivedValue(() => (overlay ? swapProgress(y.value, level) : 0));
  // A page's bar always shows its title. A screen that turns from a tab into a page in place (Scores going down a
  // level from its root) fades the compact title in instead of showing it in one frame: it waits out the title's own
  // dip, so the tab's old name never flashes up first. Going back to the tab, it fades out the same way.
  const paged = useSharedValue(overlay ? 0 : 1);
  const pagedOnce = React.useRef(overlay);
  React.useEffect(() => {
    if (pagedOnce.current === overlay) return;
    pagedOnce.current = overlay;
    if (level === 'none') { paged.value = overlay ? 0 : 1; return; }
    paged.value = overlay
      ? withTiming(0, { duration: 160, easing: EASE_EXIT })
      : withDelay(110, withTiming(1, { duration: 220, easing: EASE_OUT }));
  }, [overlay, level]);
  const titleStyle = useAnimatedStyle(() => ({
    opacity: Math.max(swap.value, paged.value),
    transform: [{ translateY: overlay && level === 'full' ? 4 * (1 - swap.value) : 0 }],
  }));
  const groundStyle = useAnimatedStyle(() => ({ opacity: swap.value }));
  // a ground that is more than half in takes touches too, so a tap on a bar that looks solid never reaches what has
  // scrolled up behind it. Only the flip crosses to the JS thread, never the scroll itself
  const [solid, setSolid] = React.useState(false);
  useAnimatedReaction(() => swap.value > 0.5, (now, was) => { if (now !== was) runOnJS(setSolid)(now); });
  // the hairline and the shade under the bar, once the content has moved
  const edge = useDerivedValue(() => (overlay ? swap.value : edgeStrength(y.value, level)));

  const list = actions ?? [];
  const shown = list.length > 2 ? list.slice(0, 1) : list;
  const rest = list.length > 2 ? list.slice(1) : [];
  const hasTray = shown.length > 0 || rest.length > 0 || !!right;
  // an overlay lets touches through wherever it holds nothing (the tray is the one thing in it that takes them)
  const through = overlay ? 'box-none' : 'auto';

  return (
    <View
      pointerEvents={through}
      style={[
        hdr.bar, overlay && hdr.over,
        { paddingTop: insets.top + BAR_PAD, paddingLeft: back ? BAR_SIDE : S.pad },
        !overlay && { backgroundColor: bgFor(theme) },
      ]}
    >
      {overlay ? (
        <Animated.View
          pointerEvents={solid ? 'auto' : 'none'} style={[StyleSheet.absoluteFill, { backgroundColor: bgFor(theme) }, groundStyle]}
        />
      ) : null}
      {/* the header band takes a one-finger drag down (Sift): from under the status bar, which is the phone's shade, to
          the bar's lower rim; the tray's buttons sit above it and keep their taps */}
      {pull && overlay ? (
        <GestureDetector gesture={headerPull.gesture}>
          <Animated.View collapsable={false} style={[StyleSheet.absoluteFill, { top: insets.top }]} />
        </GestureDetector>
      ) : null}
      <Animated.View pointerEvents={through} style={[hdr.row, contentStyle, pull && overlay && !contentStyle ? pullRow : null]}>
        {back ? (
          <Bouncy
            onPress={onBack || (() => router.back())} scaleTo={1} sink={false} radius={BACK_W / 2} hitSlop={4}
            accessibilityLabel="Back" accessibilityRole="button" style={hdr.back}
          >
            <Ionicons name="chevron-back" size={24} color={C.text} />
          </Bouncy>
        ) : null}
        <Animated.View pointerEvents={overlay ? 'none' : 'auto'} style={[hdr.titleBox, { marginLeft: back ? TITLE_GAP : 0 }, titleStyle]}>
          {/* a title that changes in place (a tab's tool swapped, a page named differently) dips and comes back as
              the new words instead of snapping */}
          <FadeSwap swapKey={title}>
            {/* fixed chrome: the bar's row is 40 high, so its title grows with the phone's font size only a little */}
            <Text
              numberOfLines={1} style={hdr.title} maxFontSizeMultiplier={1.2}
              accessibilityRole={overlay ? undefined : 'header'}
              importantForAccessibility={overlay ? 'no' : 'auto'}
            >
              {title}
            </Text>
          </FadeSwap>
        </Animated.View>
        {hasTray ? (
          <View
            style={[
              hdr.tray,
              // the outline takes 1 of the pill's 2 padding, so both themes give the bar the same height
              minimal ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border, padding: 1 } : { backgroundColor: C.inset, ...neuInset('hairline') },
            ]}
          >
            {/* keyed by place, not by label or icon: an action whose look changes as it is used (a bell turned on)
                stays the same button, so a screen reader's focus stays on it */}
            {shown.map((a, i) => <TrayButton key={i} action={a} />)}
            {rest.length ? (
              <TrayButton action={{ icon: 'ellipsis-horizontal', label: 'More actions', onPress: () => setOverflow(true) }} />
            ) : null}
            {right}
          </View>
        ) : null}
      </Animated.View>
      {scrollY ? <ScrollEdge at={edge} style={hdr.under} /> : null}
      {pull && overlay ? <PullPill progress={headerPull.progress} /> : null}
      {rest.length ? <DotMenu visible={overflow} onClose={() => setOverflow(false)} items={rest} /> : null}
    </View>
  );
}

/**
 * The tool header's edge: a 1 px hairline and a soft 10 px shade, drawn at the top of its container, over whatever
 * scrolls there. `at` is 0 to 1 (edgeStrength) and runs on the UI thread. The bar draws its own just under itself; a
 * screen that holds more than one scroll under the same bar (Settings' list and its pages, the Vault's three lists)
 * draws it at the top of the scroll it belongs to, which starts right under the bar, so it falls where the bar's would.
 */
export function ScrollEdge({ at, style }: { at: SharedValue<number>; style?: ViewStyle }) {
  const theme = useTheme();
  const fade = useAnimatedStyle(() => ({ opacity: at.value }));
  return (
    <Animated.View pointerEvents="none" style={[hdr.edge, style, fade]}>
      <View style={[hdr.hair, { backgroundColor: theme === 'minimal' ? MIN.border : C.border }]} />
      <LinearGradient colors={SHADE} style={hdr.shade} />
    </Animated.View>
  );
}

/** A scroll view and the edge at its top, for a layer that is one scroll: put it where the scroll view would go. */
export function EdgeScroll({ children, ...props }: React.ComponentProps<typeof Animated.ScrollView>) {
  const level = useAnimLevel();
  const y = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => { y.value = e.contentOffset.y; });
  const at = useDerivedValue(() => edgeStrength(y.value, level));
  return (
    <>
      <Animated.ScrollView {...props} onScroll={onScroll} scrollEventThrottle={16}>{children}</Animated.ScrollView>
      <ScrollEdge at={at} />
    </>
  );
}

/**
 * What a lock screen wears in place of a tool (and of its archive, or a note): the same bar and, on a tab, the same big
 * title, and no line of context, so nothing of what is locked (a count, a streak, a date) shows before the PIN is given.
 * Nothing scrolls under it, so the big title simply sits where it sits at the top of the open tool.
 */
export function GateHeader({ title, tab }: { title: string; tab: boolean }) {
  const header = useToolHeader({ title, mode: tab ? 'tab' : 'page' });
  return (
    <>
      {header.bar}
      <View style={{ paddingHorizontal: S.pad, paddingTop: tab ? header.padTop : 0 }}>{header.hero}</View>
    </>
  );
}

/** The first thing in the scroll: the big title in tab mode, and the context line, if there is one. */
function ToolHero({ title, tab, parts, live, covered, reserve }: {
  title: string; tab: boolean; parts: ContextPart[] | null; live: boolean; covered: boolean;
  /** the width the big title leaves free on its right, for the tray beside it */
  reserve: number;
}) {
  if (tab) {
    return (
      <View style={hdr.heroTab}>
        {/* the big title sits level with the bar's tray, so it is chrome too: it grows at most by 1.3 */}
        <FadeSwap swapKey={title} style={reserve ? { paddingRight: reserve } : undefined}>
          <Text numberOfLines={1} accessibilityRole="header" maxFontSizeMultiplier={CHROME_FONT_MAX} style={T.display}>{title}</Text>
        </FadeSwap>
        {parts ? <ContextLine parts={parts} live={live} covered={covered} style={{ marginTop: 2 }} /> : null}
      </View>
    );
  }
  if (!parts) return null;
  return (
    <View style={hdr.heroPage}>
      <ContextLine parts={parts} live={live} covered={covered} />
    </View>
  );
}

/** The context line: one line, the dot (if live) before it. A change of words or of the dot dips and comes back. */
function ContextLine({ parts, live, covered, style }: {
  parts: ContextPart[]; live: boolean; covered: boolean; style?: ViewStyle;
}) {
  return (
    <FadeSwap swapKey={(live ? '+' : '-') + parts.map(textOf).join('')} style={style}>
      <View style={hdr.ctxRow}>
        {live ? <LiveDot covered={covered} /> : null}
        <Text numberOfLines={1} style={hdr.ctx}>
          {parts.map((p, i) => (typeof p === 'string' ? p : <Text key={i} style={hdr.em}>{p.em}</Text>))}
        </Text>
      </View>
    </FadeSwap>
  );
}

/** The live dot: 7 dp of accent that breathes (opacity .35 to 1, scale .82 to 1) while it is seen; still otherwise. */
function LiveDot({ covered }: { covered: boolean }) {
  useTheme(); // the dot is the accent, so it follows a new one
  const breath = useBreath(!covered);
  const dotStyle = useAnimatedStyle(() => ({
    opacity: 0.35 + 0.65 * breath.value,
    transform: [{ scale: 0.82 + 0.18 * breath.value }],
  }));
  return <Animated.View importantForAccessibility="no" style={[hdr.dot, { backgroundColor: C.accent }, dotStyle]} />;
}

const hdr = StyleSheet.create({
  // above the scroll that follows it, so its shade falls over the content
  bar: { paddingRight: S.pad, paddingBottom: BAR_PAD, zIndex: 2 },
  // a tab's bar: over the top of its parent instead of above the scroll
  over: { position: 'absolute', top: 0, left: 0, right: 0 },
  row: { minHeight: BAR_ROW, flexDirection: 'row', alignItems: 'center' },
  back: { width: BACK_W, height: BACK_W, borderRadius: BACK_W / 2, alignItems: 'center', justifyContent: 'center' },
  titleBox: { flex: 1, minWidth: 0 },
  title: { color: C.text, fontFamily: F.semi, fontSize: 18, lineHeight: 24, letterSpacing: TRACK.title },
  // the carved pill the actions sit in; it clips each button's carve at its rim
  tray: {
    flexDirection: 'row', alignItems: 'center', padding: TRAY_PAD, gap: TRAY_GAP, borderRadius: 999, overflow: 'hidden', marginLeft: TRAY_LEAD,
  },
  trayBtn: { width: TRAY_BTN, height: TRAY_BTN, borderRadius: TRAY_BTN / 2, alignItems: 'center', justifyContent: 'center' },
  edge: { position: 'absolute', left: 0, right: 0, top: 0, height: 10 },
  // the bar's own edge falls from its lower rim
  under: { top: '100%' },
  hair: { position: 'absolute', left: 0, right: 0, top: 0, height: StyleSheet.hairlineWidth },
  shade: { position: 'absolute', left: 0, right: 0, top: 0, height: 10 },
  // the big title is level with the bar's row (padTop lifts the hero to it); 18 below the hero is the gap to the first block
  heroTab: { paddingTop: HERO_TOP, paddingBottom: 18 },
  heroPage: { paddingBottom: 18, paddingLeft: PAGE_INDENT },
  ctxRow: { flexDirection: 'row', alignItems: 'center' },
  ctx: { flexShrink: 1, color: C.textFaint, fontFamily: F.smMed, fontSize: CTX_SIZE, lineHeight: 17, letterSpacing: TRACK.fine },
  em: { color: C.textDim },
  dot: { width: 7, height: 7, borderRadius: 3.5, marginRight: 7 },
  // the pull's pill hangs just under the bar, centred
  pillRoom: { position: 'absolute', top: '100%', left: 0, right: 0, alignItems: 'center', marginTop: 6 },
  pill: { height: 34, paddingHorizontal: 16, borderRadius: 999, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  pillInk: { justifyContent: 'center' },
  pillLayer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  pillText: { fontFamily: F.smMed, ...oneLine(13), letterSpacing: TRACK.small },
});

/* ---------------------------------------------------------------- Sift: the header pull, the arrival pulse */

/** How far down a header pull must go to open Sift, in dp. */
export const PULL_OPEN = 64;

/**
 * The pull that opens Sift from a header band: one finger, dragged down 64 dp or more from inside the header, and let go.
 * An RNGH Pan that wakes only on a downward drag (10 dp) and gives way to a sideways one (16 dp) or an upward one, so a
 * fling between tabs and the scroll below are never taken. `progress` runs 0 to 1 up to the threshold (a little past
 * it with resistance) on the UI thread, for a pill under the header; a tick marks the threshold, and letting go past
 * it opens Sift with its field morphing out of the header. `enabled` false (an edit mode, a running session) turns
 * it off. Put the gesture on the header band's own view (a GestureDetector around it), never on scrolling content.
 */
export function useHeaderPull(enabled: boolean) {
  const progress = useSharedValue(0);
  const armed = useSharedValue(false);
  const gesture = React.useMemo(() => Gesture.Pan()
    .enabled(enabled)
    .maxPointers(1)
    .activeOffsetY(10)
    .failOffsetY(-10)
    .failOffsetX([-16, 16])
    .onStart(() => { armed.value = false; })
    .onUpdate((e) => {
      const ty = Math.max(0, e.translationY);
      // up to the threshold it follows the finger; past it, it gives a little, as a rubber band does
      const p = ty <= PULL_OPEN ? ty / PULL_OPEN : 1 + ((ty - PULL_OPEN) / PULL_OPEN) * 0.35;
      progress.value = p;
      siftPull.value = Math.min(1, p);
      const over = ty >= PULL_OPEN;
      if (over !== armed.value) {
        armed.value = over;
        if (over) runOnJS(tick)();
      }
    })
    .onEnd((e, success) => {
      // a cancelled drag (a call, the shade) never opens it
      if (success && e.translationY >= PULL_OPEN) {
        siftPull.value = 1;
        runOnJS(openSift)('pull');
        // the pill hands over to Sift's field, which takes its place
        progress.value = withTiming(0, { duration: 200, easing: EASE_OUT });
      } else {
        progress.value = withTiming(0, { duration: 180, easing: EASE_OUT });
        siftPull.value = withTiming(0, { duration: 180, easing: EASE_OUT });
      }
    })
    .onFinalize(() => {
      armed.value = false;
      if (progress.value > 0 && progress.value < 1) progress.value = withTiming(0, { duration: 180, easing: EASE_OUT });
      else if (progress.value > 1 && siftPull.value < 1) progress.value = withTiming(0, { duration: 180, easing: EASE_OUT });
    }), [enabled]);
  return { gesture, progress };
}

/**
 * The pill a header pull draws out from under the bar: a carved well with the search glyph and Sift's name, growing with
 * the pull; at the threshold its glyph and name take the accent ("let go to open"). Fades only with some motion; a
 * step with none.
 */
export function PullPill({ progress }: { progress: SharedValue<number> }) {
  const theme = useTheme();
  const level = useAnimLevel();
  const box = useAnimatedStyle(() => {
    const p = Math.min(1, progress.value);
    if (level === 'none') return { opacity: p > 0.15 ? 1 : 0 };
    const opacity = interpolate(p, [0.08, 0.45], [0, 1], Extrapolation.CLAMP);
    if (level === 'some') return { opacity };
    return {
      opacity,
      transform: [
        { translateY: -10 * (1 - p) + 4 * Math.max(0, progress.value - 1) },
        { scale: 0.7 + 0.3 * p },
      ] as const,
    };
  });
  const lit = useAnimatedStyle(() => ({ opacity: progress.value >= 1 ? 1 : 0 }));
  const unlit = useAnimatedStyle(() => ({ opacity: progress.value >= 1 ? 0 : 1 }));
  const well = theme === 'minimal'
    ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border }
    : { backgroundColor: C.inset, ...neuInset('hairline') };
  return (
    <View pointerEvents="none" style={hdr.pillRoom} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Animated.View style={[hdr.pill, well, box]}>
        <View style={hdr.pillInk}>
          <Animated.View style={[hdr.pillLayer, unlit]}>
            <Ionicons name="search" size={15} color={C.textDim} />
            <Text style={[hdr.pillText, { color: C.textDim }]} maxFontSizeMultiplier={CHROME_FONT_MAX}>Sift</Text>
          </Animated.View>
          <Animated.View style={[hdr.pillLayer, StyleSheet.absoluteFill, lit]}>
            <Ionicons name="search" size={15} color={C.accent} />
            <Text style={[hdr.pillText, { color: C.accent }]} maxFontSizeMultiplier={CHROME_FONT_MAX}>Sift</Text>
          </Animated.View>
        </View>
      </Animated.View>
    </View>
  );
}

/**
 * The one pulse an item gives when something opens it (Sift, a link): a soft wash of the accent comes up over it and
 * fades away, once, each time `active` turns true. It waits `delay` ms (250) so a scroll that brings the item into view
 * has settled first. Returns the style for an overlay laid over the item:
 *
 *   const pulse = useArrivalPulse(id === params.item);
 *   <View>{row}<Animated.View pointerEvents="none" style={[pulse, { borderRadius: 14 }]} /></View>
 *
 * or use <ArrivalPulse active radius /> as the item's last child. With motion off the wash shows and goes in a step.
 */
export function useArrivalPulse(active: boolean, delay = 250) {
  useTheme(); // the wash is the accent, so it follows a new one
  const level = useAnimLevel();
  const a = useSharedValue(0);
  React.useEffect(() => {
    if (!active) return;
    a.value = 0;
    a.value = level === 'none'
      ? withDelay(delay, withSequence(withTiming(1, { duration: 0 }), withDelay(900, withTiming(0, { duration: 0 }))))
      : withDelay(delay, withSequence(
        withTiming(1, { duration: 200, easing: EASE_OUT }),
        withDelay(260, withTiming(0, { duration: 760, easing: Easing.inOut(Easing.quad) })),
      ));
  }, [active, level]);
  const fade = useAnimatedStyle(() => ({ opacity: 0.16 * a.value }));
  return [StyleSheet.absoluteFill, { backgroundColor: C.accent }, fade];
}

/** The arrival pulse as an overlay: put it last inside the item, which must not clip it away (radius matches the item). */
export function ArrivalPulse({ active, radius = 0, delay }: { active: boolean; radius?: number; delay?: number }) {
  const pulse = useArrivalPulse(active, delay);
  return <Animated.View pointerEvents="none" style={[pulse, { borderRadius: radius }]} />;
}

/** Small ⓘ that floats a short feature description in a raised dialog. */
export function InfoDot({ text, size = 15, label = 'About this' }: {
  text: string; size?: number;
  /** what the dot is called to a screen reader */
  label?: string;
}) {
  const theme = useTheme();
  const level = useAnimLevel();
  const { width: winW, height: winH } = useWindowDimensions();
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState({ x: 0, y: 0, top: 0 });
  // the bubble's own height, once it has laid out: near the foot of the screen it opens above the dot instead
  const [bubbleH, setBubbleH] = React.useState(0);
  const ref = React.useRef<View>(null);
  const show = () => {
    ref.current?.measureInWindow((x, y, w, h) => {
      setPos({ x, y: y + h, top: y });
      setBubbleH(0);
      setOpen(true);
    });
  };
  const below = pos.y + 8;
  const top = bubbleH > 0 && below + bubbleH > winH - 16 ? Math.max(16, pos.top - 8 - bubbleH) : below;
  return (
    <>
      <Pressable
        ref={ref} onPress={show} hitSlop={15} style={{ marginLeft: 6 }}
        accessibilityRole="button" accessibilityLabel={label}
      >
        <Ionicons name="information-circle-outline" size={size} color={C.textFaint} />
      </Pressable>
      {/* statusBarTranslucent keeps this modal's window in the SAME coordinate
          space measureInWindow reported from — without it the content view
          starts below the translucent status bar and the bubble lands a
          status-bar height too low */}
      <Modal
        visible={open} transparent statusBarTranslucent animationType={level === 'none' ? 'none' : 'fade'}
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={{ flex: 1 }} onPress={() => setOpen(false)}>
          <View
            onLayout={(e) => setBubbleH(e.nativeEvent.layout.height)}
            style={[
              {
                position: 'absolute', top,
                left: Math.min(Math.max(12, pos.x - 110), winW - 252),
                width: 240, borderRadius: 14, padding: 12,
                // hidden for the one frame before it knows whether it fits below the dot
                opacity: bubbleH > 0 ? 1 : 0,
              },
              theme === 'minimal'
                ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: MIN.border }
                : { backgroundColor: C.card, ...neuRaised('high') },
            ]}
          >
            <Text style={{ color: C.textDim, fontFamily: F.sm, fontSize: 12, letterSpacing: TRACK.fine, lineHeight: 17 }}>{text}</Text>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

/** What a pressable surface (a card, a row, a chip) can tell a screen reader beyond its own words. */
export interface A11yProps {
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: PressRole;
}

/**
 * Raised soft-UI surface: the kit's dual drop-shadow (light side toward the
 * 60° light, dark side at the exact opposite end), 6px distance both ways.
 */
export function Card({
  children, style, pad = S.cardPad, onPress, onLongPress, hero = false,
  accessibilityLabel, accessibilityHint, accessibilityRole,
}: {
  children: React.ReactNode; style?: ViewStyle | ViewStyle[]; pad?: number;
  onPress?: () => void; onLongPress?: () => void; hero?: boolean;
} & A11yProps) {
  const theme = useTheme();
  const surface: ViewStyle =
    theme === 'minimal'
      ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: MIN.border }
      : { backgroundColor: C.card, ...neuRaised(hero ? 'high' : 'mid') };

  const inner = <View style={{ padding: pad }}>{children}</View>;

  if (onPress || onLongPress) {
    return (
      <Bouncy
        onPress={onPress} onLongPress={onLongPress} radius={S.radius} style={[st.cardBase, surface, style as any]}
        accessibilityLabel={accessibilityLabel} accessibilityHint={accessibilityHint} accessibilityRole={accessibilityRole}
      >
        {inner}
      </Bouncy>
    );
  }
  // a card that cannot be pressed reads as one element only when it is given a name of its own
  return (
    <View
      style={[st.cardBase, surface, style as any]}
      accessible={accessibilityLabel ? true : undefined}
      accessibilityLabel={accessibilityLabel} accessibilityHint={accessibilityHint} accessibilityRole={accessibilityRole}
    >
      {inner}
    </View>
  );
}

export const GlassCard = Card;

/** Depressed well — carved into the material with true inner shadows. */
export function Inset({ children, style, pad = 0 }: { children?: React.ReactNode; style?: any; pad?: number }) {
  const theme = useTheme();
  return (
    <View
      style={[
        st.insetBase,
        theme === 'minimal'
          ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border }
          : { backgroundColor: C.inset, ...neuInset('mid') },
        { padding: pad },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={st.sectionRow}>
      <Text style={T.kicker} accessibilityRole="header">{children}</Text>
      {right}
    </View>
  );
}

/** a small chip is about 26 high: its reach grows to the rows' rhythm above and below, a little to the sides */
const CHIP_SLOP_SMALL = { top: 8, bottom: 8, left: 5, right: 5 };
const CHIP_SLOP = 5;

/**
 * Chips are flat: an outline at rest, a quiet tint of their colour when on. They come in rows, and a row of
 * raised pills reads as clutter, so the depth stays on the surfaces around them. A screen reader hears a button that
 * says whether it is chosen; a chip with nothing to do is disabled.
 */
export function Chip({
  label, active, color, onPress, onLongPress, small, icon, textFace, style,
  accessibilityLabel, accessibilityHint, accessibilityRole, accessibilityState,
}: {
  label: string; active?: boolean; color?: string; onPress?: () => void; onLongPress?: () => void; small?: boolean; icon?: any;
  /**
   * the label in the text face (Inter Tight) instead of Schibsted: for a label of figures or signs Schibsted lacks, such
   * as the calculator's ×10ⁿ. An empty label leaves the icon alone in the chip.
   */
  textFace?: boolean;
  /** for a chip that is not in a row of chips: its margins, or a fixed height to match the controls beside it */
  style?: ViewStyle;
  /** replaces the chosen state a chip reports by default (`selected` when active), e.g. `checked` for a checkbox */
  accessibilityState?: AccessibilityState;
} & A11yProps) {
  const theme = useTheme();
  const level = useAnimLevel();
  const c = color || C.accent;
  // the resting edge and the tint cross over, and so do the two inks, so a choice eases in and out instead of swapping
  const on = useSharedValue(active ? 1 : 0);
  React.useEffect(() => {
    on.value = level === 'none' ? (active ? 1 : 0) : withTiming(active ? 1 : 0, CHANGE);
  }, [active, level]);
  const litStyle = useAnimatedStyle(() => ({ opacity: on.value }));
  const restStyle = useAnimatedStyle(() => ({ opacity: 1 - on.value }));
  const textStyle = [
    st.chipText, small && st.chipTextSmall, active && st.chipTextOn,
    textFace && (active ? st.chipTextFaceOn : st.chipTextFace),
  ];
  const iconSize = small ? 13 : 15;
  const inert = !onPress && !onLongPress;
  return (
    <Bouncy
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={inert}
      scaleTo={0.94}
      radius={999}
      hitSlop={small ? CHIP_SLOP_SMALL : CHIP_SLOP}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityRole={accessibilityRole ?? 'button'}
      accessibilityState={accessibilityState ?? { selected: !!active }}
      style={[st.chip, small && st.chipSmall, style]}
    >
      <Animated.View pointerEvents="none" style={[st.chipEdge, { borderColor: theme === 'minimal' ? MIN.border : C.outline }, restStyle]} />
      <Animated.View pointerEvents="none" style={[st.chipEdge, { backgroundColor: c + '1F', borderColor: c + '66' }, litStyle]} />
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {icon ? (
          <View style={label ? { marginRight: 6 } : undefined}>
            <Animated.View style={restStyle}><Ionicons name={icon} size={iconSize} color={C.textFaint} /></Animated.View>
            <Animated.View style={[st.ink, litStyle]}><Ionicons name={icon} size={iconSize} color={c} /></Animated.View>
          </View>
        ) : null}
        {/* fixed chrome: chips sit in rows, so their words grow with the phone's font size only up to 1.3 */}
        {label ? (
          <View>
            <Animated.Text style={[textStyle, restStyle]} maxFontSizeMultiplier={CHROME_FONT_MAX}>{label}</Animated.Text>
            <Animated.Text
              style={[textStyle, st.ink, { color: c }, litStyle]} maxFontSizeMultiplier={CHROME_FONT_MAX}
              importantForAccessibility="no" accessibilityElementsHidden
            >
              {label}
            </Animated.Text>
          </View>
        ) : null}
      </View>
    </Bouncy>
  );
}

/** Slightly raised button; sinks on press. */
export function PillButton({
  label, onPress, color, icon, outline, style, small,
}: {
  label: string; onPress: () => void; color?: string; icon?: any; outline?: boolean;
  style?: ViewStyle; small?: boolean;
}) {
  const theme = useTheme();
  const c = color || C.accent;
  return (
    <Bouncy
      onPress={onPress}
      scaleTo={0.96}
      style={[
        st.pill,
        small && { paddingVertical: 8, paddingHorizontal: 14 },
        outline
          ? { borderColor: c + '88', borderWidth: 1.5, backgroundColor: 'transparent' }
          : theme === 'minimal'
            ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: c + '77' }
            : { backgroundColor: C.card, ...neuRaised('low') },
        style,
      ]}
    >
      {icon ? <Ionicons name={icon} size={small ? 14 : 16} color={c} style={{ marginRight: 7 }} /> : null}
      <Text style={[small ? st.pillTextSmall : st.pillText, { color: c }]}>{label}</Text>
    </Bouncy>
  );
}

/** Bare icon button — padded + hit-slopped to a ≥44px effective target. */
export function IconBtn({ name, onPress, color = C.textDim, size = 22, style, pad = 8, accessibilityLabel }: {
  name: any; onPress?: () => void; color?: string; size?: number; style?: ViewStyle; pad?: number;
  /** what the button does, for a screen reader: an icon alone says nothing */
  accessibilityLabel?: string;
}) {
  return (
    <Bouncy
      onPress={onPress} scaleTo={0.85} hitSlop={6} radius={999} style={[{ padding: pad }, style]}
      accessibilityLabel={accessibilityLabel} accessibilityRole={accessibilityLabel ? 'button' : undefined}
    >
      <Ionicons name={name} size={size} color={color} />
    </Bouncy>
  );
}

/** Raised circular action button (kit button geometry). `active` carves in. */
export function NeuIconBtn({ name, onPress, color, size = 20, dim = 44, active, style, accessibilityLabel }: {
  name: any; onPress?: () => void; color?: string; size?: number; dim?: number;
  active?: boolean; style?: ViewStyle; accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const level = useAnimLevel();
  const c = color || C.accent;
  // turning on carves the button in over a moment, and turning off lets it rise back, instead of a one-frame swap
  const carve = useSharedValue(active ? 1 : 0);
  React.useEffect(() => {
    carve.value = level === 'none' ? (active ? 1 : 0) : withTiming(active ? 1 : 0, CHANGE);
  }, [active, level]);
  const carveStyle = useAnimatedStyle(() => ({ opacity: carve.value }));
  return (
    <Bouncy
      onPress={onPress}
      scaleTo={0.9}
      radius={dim / 2}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityLabel ? 'button' : undefined}
      style={[
        { width: dim, height: dim, borderRadius: dim / 2, alignItems: 'center', justifyContent: 'center' },
        theme === 'minimal'
          ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: active ? c : MIN.border }
          : { backgroundColor: C.card, ...neuRaised('low') },
        style,
      ]}
    >
      {theme !== 'minimal' && active !== undefined ? (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
              borderRadius: dim / 2, backgroundColor: C.inset, ...neuPressedInner(),
            },
            carveStyle,
          ]}
        />
      ) : null}
      <Ionicons name={name} size={size} color={c} />
    </Bouncy>
  );
}

/**
 * A tick: ticking fills the ring with its colour, which grows out of the centre and settles; unticking lets the fill
 * fade back into the ring. It is drawn in its state on its first paint, so a list never pops every check as it arrives.
 */
export function CheckCircle({ done, onPress, color = C.green, size = 26, label }: {
  done: boolean; onPress: () => void; color?: string; size?: number;
  /** what is being ticked, for a screen reader */
  label?: string;
}) {
  const level = useAnimLevel();
  const fill = useSharedValue(done ? 1 : 0);
  const settle = useSharedValue(1);
  const was = React.useRef(done);
  React.useEffect(() => {
    if (was.current === done) return;
    was.current = done;
    if (level === 'none') {
      fill.value = done ? 1 : 0;
      settle.value = 1;
      return;
    }
    if (done) {
      fill.value = withTiming(1, { duration: 200, easing: EASE_OUT });
      // a small settle past full size and back, eased both ways: never a spring's wobble
      settle.value = level === 'full'
        ? withSequence(withTiming(1.1, { duration: 140, easing: EASE_OUT }), withTiming(1, { duration: 180, easing: Easing.inOut(Easing.quad) }))
        : 1;
    } else {
      fill.value = withTiming(0, { duration: 150, easing: EASE_OUT });
      settle.value = 1;
    }
  }, [done, level]);
  const ringStyle = useAnimatedStyle(() => ({ opacity: 1 - fill.value }));
  const fillStyle = useAnimatedStyle(() => ({
    opacity: fill.value,
    transform: [{ scale: (0.6 + 0.4 * fill.value) * settle.value }],
  }));
  return (
    // 30 across, so its reach grows by 10 all round: a tick is the only target on many rows
    <Bouncy
      onPress={onPress} scaleTo={0.82} style={{ padding: 2 }} hitSlop={10}
      accessibilityRole="checkbox" accessibilityState={{ checked: done }} accessibilityLabel={label}
    >
      <View>
        <Animated.View style={ringStyle}>
          <Ionicons name="ellipse-outline" size={size} color={C.textFaint} />
        </Animated.View>
        <Animated.View style={[st.ink, fillStyle]}>
          <Ionicons name="checkmark-circle" size={size} color={color} />
        </Animated.View>
      </View>
    </Bouncy>
  );
}

/**
 * Kit switch. Raised outer ring (the kit's pill border) → carved inner track
 * (overflow hidden — the knob's light and shadow are CLIPPED at the track's
 * rim, the rule for every raised part inside a carved well) → raised knob,
 * filled with the accent when on.
 */
const RING_W = 56;
const RING_H = 32;
const TRACK_W = 50;
const TRACK_H = 26;
const KNOB = 20;
const KNOB_TRAVEL = TRACK_W - KNOB - 6; // 24

export function Toggle({ value, onChange, color, label }: {
  value: boolean; onChange: (v: boolean) => void; color?: string;
  /** what the switch turns on, for a screen reader (the row's own text) */
  label?: string;
}) {
  const theme = useTheme();
  const level = useAnimLevel();
  const c = color || C.accent;
  const x = useSharedValue(value ? 1 : 0);
  React.useEffect(() => {
    x.value = level === 'none' ? (value ? 1 : 0) : withSpring(value ? 1 : 0, RISE_OUT);
  }, [value, level]);
  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value * KNOB_TRAVEL }] }));
  // the accent fills the knob as it travels, instead of flipping colour the moment it is tapped
  const knobFill = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.max(0, x.value)) }));
  return (
    <Pressable
      onPress={() => { tick(); onChange(!value); }} hitSlop={8}
      accessibilityRole="switch" accessibilityState={{ checked: value }} accessibilityLabel={label}
    >
      <View
        style={[
          st.ring,
          theme === 'minimal' && {
            backgroundColor: MIN.card, borderWidth: 1,
            borderColor: value ? c : MIN.border, boxShadow: undefined,
          },
        ]}
      >
        <View style={[st.track, theme === 'minimal' && { backgroundColor: MIN.inset, boxShadow: undefined }]}>
          <Animated.View
            style={[
              st.thumb,
              { backgroundColor: C.knob },
              theme === 'minimal' && { boxShadow: undefined },
              thumbStyle,
            ]}
          >
            <Animated.View pointerEvents="none" style={[st.knobFill, { backgroundColor: c }, knobFill]} />
          </Animated.View>
        </View>
      </View>
    </Pressable>
  );
}

export type FieldProps = React.ComponentProps<typeof TextInput> & { style?: any; label?: string };

/**
 * A text field drawn as a line: an optional label above, the text, and a hairline underneath. While you type, an
 * accent line grows over the hairline from the left. Layout props go to the wrapper. The label is also what a screen
 * reader calls the field, and a ref reaches the TextInput itself (to focus it once a sheet has risen, say).
 */
export const Field = React.forwardRef<TextInput, FieldProps>(function Field({ label, ...props }, ref) {
  const theme = useTheme();
  const level = useAnimLevel();
  const [focused, setFocused] = React.useState(false);
  const on = useSharedValue(0);
  React.useEffect(() => {
    on.value = level === 'none' ? (focused ? 1 : 0) : withTiming(focused ? 1 : 0, { duration: focused ? 220 : 160 });
  }, [focused, level]);
  const lineStyle = useAnimatedStyle(() => ({ opacity: on.value, transform: [{ scaleX: on.value }] }));
  const flat = StyleSheet.flatten(props.style) || {};
  const {
    flex, width, minWidth, maxWidth, alignSelf,
    margin, marginBottom, marginTop, marginLeft, marginRight, marginHorizontal, marginVertical,
    ...innerStyle
  } = flat as any;
  const wrapStyle: any = {
    flex, width, minWidth, maxWidth, alignSelf, margin, marginTop, marginLeft, marginRight, marginHorizontal, marginVertical,
    marginBottom: marginBottom !== undefined ? marginBottom : 14,
  };
  return (
    <View style={wrapStyle}>
      {label ? <Text style={st.fieldLabel} importantForAccessibility="no">{label}</Text> : null}
      <TextInput
        ref={ref}
        placeholderTextColor={C.textFaint}
        selectionColor={C.accent}
        {...props}
        accessibilityLabel={props.accessibilityLabel ?? label}
        onFocus={(e) => { setFocused(true); props.onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); props.onBlur?.(e); }}
        style={[st.fieldInner, innerStyle]}
      />
      <View style={[st.fieldLine, { backgroundColor: theme === 'minimal' ? MIN.border : C.borderBright }]}>
        <Animated.View pointerEvents="none" style={[st.fieldLineOn, { backgroundColor: C.accent }, lineStyle]} />
      </View>
    </View>
  );
});

/**
 * A time, set on the time wheel: a row drawn as a Field is (the label above, the time or the placeholder, a hairline
 * under it) that opens a sheet holding a TimeWheel, with Done and, when `clearable` and a time is set, Clear. Values are
 * 'HH:MM' and '' means no time; the clock (12 or 24 hours) is the user's setting. A field with no time opens on the next
 * whole hour, and Done keeps it. Closing the sheet any other way changes nothing, and so does Done when no wheel was
 * turned: a saved time off the wheels' five-minute steps stays exactly as it was. `allowEndOfDay` offers Midnight
 * ('24:00'), for an end time. Layout props (flex, width, margins) go in `style`, as a Field's do.
 */
export function TimeField({
  label, value, onChange, placeholder = 'Add a time', clearable = false, allowEndOfDay = false, style,
}: {
  label?: string; value: string; onChange: (value: string) => void; placeholder?: string; clearable?: boolean;
  allowEndOfDay?: boolean; style?: ViewStyle | ViewStyle[];
}) {
  const theme = useTheme();
  const hour24 = useStore((s) => s.settings.hour24);
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  // whether a wheel was turned since the sheet opened: if not, Done keeps the time exactly as it was
  const turned = React.useRef(false);
  const has = isTime(value, allowEndOfDay);
  const shown = has ? timeLabel(value, hour24) : placeholder;
  const show = () => {
    Keyboard.dismiss();
    turned.current = false;
    setDraft(has ? value : defaultTime());
    setOpen(true);
  };
  const done = () => {
    if (turned.current || !has) onChange(draft);
    setOpen(false);
  };
  const turn = React.useCallback((v: string) => { turned.current = true; setDraft(v); }, []);
  return (
    <View style={[st.timeWrap, style as any]}>
      {label ? <Text style={st.fieldLabel} importantForAccessibility="no">{label}</Text> : null}
      <Pressable
        onPress={show}
        accessibilityRole="button"
        accessibilityLabel={label ? label + ', ' + shown : shown}
        accessibilityHint="Opens a time wheel"
        style={({ pressed }) => [st.timeRow, pressed && st.timeRowPressed]}
      >
        <Text numberOfLines={1} style={[st.fieldInner, st.timeText, !has && { color: C.textFaint }]}>{shown}</Text>
        <Ionicons name="time-outline" size={16} color={C.textFaint} />
      </Pressable>
      <View style={[st.fieldLine, { backgroundColor: theme === 'minimal' ? MIN.border : C.borderBright }]} />
      <Sheet visible={open} onClose={() => setOpen(false)} title={label || 'Choose a time'}>
        <TimeWheel value={draft} onChange={turn} hour24={hour24} allowEndOfDay={allowEndOfDay} />
        <Row style={st.timeActions}>
          {clearable && has ? (
            <PillButton label="Clear" outline color={C.textDim} onPress={() => { onChange(''); setOpen(false); }} style={{ flex: 1 }} />
          ) : null}
          <PillButton label="Done" onPress={done} style={{ flex: 1 }} />
        </Row>
      </Sheet>
    </View>
  );
}

/**
 * What an empty list says: a carved icon well, one line in the text colour, an optional quieter line, and at
 * most one way forward. `compact` sits inside a card.
 */
export function EmptyState({ icon, title, body, actionLabel, onAction, compact }: {
  icon: any; title: string; body?: string; actionLabel?: string; onAction?: () => void; compact?: boolean;
}) {
  const theme = useTheme();
  // a list that empties while you look at it fades its note in; one that is empty when its screen is built needs no more
  const appear = useAppear();
  return (
    <Animated.View style={[st.emptyWrap, compact && { marginVertical: 14 }, appear]}>
      <View
        style={[
          st.emptyWell,
          theme === 'minimal'
            ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border }
            : { backgroundColor: C.inset, ...neuInset('low') },
        ]}
      >
        <Ionicons name={icon} size={22} color={C.textFaint} />
      </View>
      <Text style={st.emptyTitle}>{title}</Text>
      {body ? <Text style={st.emptyBody}>{body}</Text> : null}
      {actionLabel && onAction ? <PillButton small outline label={actionLabel} onPress={onAction} style={{ marginTop: 14 }} /> : null}
    </Animated.View>
  );
}

/** A carved hairline track with an eased accent fill. No glow: one accent, lit by the material. */
export function ProgressBar({ value, color, height = 8 }: { value: number; color?: string; height?: number }) {
  const theme = useTheme();
  const level = useAnimLevel();
  const c = color || C.accent;
  const v = Math.min(1, Math.max(0, value));
  const w = useSharedValue(v);
  React.useEffect(() => {
    // an ease, not a spring: a bar that moves every second (Deep Work) must step, never bounce
    w.value = level === 'none' ? v : withTiming(v, { duration: 280, easing: Easing.out(Easing.cubic) });
  }, [v, level]);
  const trackW = useSharedValue(0);
  // a full-width fill slides in from the left: a transform, so no layout pass per frame. Hidden until the track
  // has measured, so it never flashes full on its first frame
  const fillStyle = useAnimatedStyle(() => ({
    opacity: trackW.value > 0 ? 1 : 0,
    transform: [{ translateX: (w.value - 1) * trackW.value }],
  }));
  return (
    <View
      onLayout={(e) => { trackW.value = e.nativeEvent.layout.width; }}
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(v * 100) }}
      style={[
        { height, borderRadius: height / 2, overflow: 'hidden' },
        theme === 'minimal' ? { backgroundColor: MIN.inset } : { backgroundColor: C.inset, ...neuInset('hairline') },
      ]}
    >
      <Animated.View
        style={[
          {
            height: height - 2, borderRadius: height / 2, backgroundColor: c, margin: 1,
          },
          fillStyle,
        ]}
      />
    </View>
  );
}

export function Hairline() {
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: C.hairline, marginVertical: 2 }} />;
}

/** a sheet's motion at each level: what it arrives and leaves on (see Sheet) */
const SLIDE = { arrive: ARRIVE, leave: LEAVE };
const FADE = { arrive: FADE_IN, leave: FADE_OUT };

/**
 * Bottom sheet: the backdrop fades while the panel rises from below the screen's edge, its whole height. It rises on the
 * emphasised out-curve, quick off the mark and long to settle, and leaves in about two thirds of the time on an
 * accelerating one. With only some motion nothing travels: the panel fades in place, a little quicker out than in.
 * While it leaves, neither the panel nor the backdrop takes a tap, so nothing in it can run twice on the way out.
 */
export function Sheet({
  visible, onClose, onClosed, onRisen, title, children,
}: {
  visible: boolean; onClose: () => void; title?: string; children: React.ReactNode;
  /** runs once the sheet has finished closing: the moment to open another sheet or show a toast */
  onClosed?: () => void;
  /** runs once the sheet has finished rising: the moment to focus a field, so the keyboard never rides the rise */
  onRisen?: () => void;
}) {
  const theme = useTheme();
  const level = useAnimLevel();
  const insets = useSafeAreaInsets();
  const { height: winH, width: winW } = useWindowDimensions();
  // on a wide window a sheet keeps a phone's proportions: at most 560 wide, centred, still rising from the bottom
  const narrowPanel = winW >= WIDE_AT ? st.sheetWide : null;
  const [render, setRender] = React.useState(visible);
  // the keyboard's height while the sheet is up: the window shrinks above it, and the panel must still fit there
  const [kb, setKb] = React.useState(0);
  React.useEffect(() => {
    if (!render) return undefined;
    // a keyboard already up as the sheet arrives counts too
    setKb(Keyboard.isVisible() ? Keyboard.metrics()?.height ?? 0 : 0);
    const shown = Keyboard.addListener('keyboardDidShow', (e) => setKb(e.endCoordinates.height));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setKb(0));
    return () => { shown.remove(); hidden.remove(); };
  }, [render]);
  // the panel's fixed chrome (padding 22 + paddingBottom 36 + handle 21 +
  // title 38, about 120dp) sits OUTSIDE this scroller, so the cap has to come
  // off the room left — a flat 540 pushed the primary button below a short display, and with the keyboard up a full
  // panel pushed its handle and title (the pull that closes it) off the top
  const room = Math.min(winH * 0.72, winH - kb - insets.top - 24);
  const scrollMax = Math.min(540, Math.max(160, room - 120));
  // set while the sheet leaves: it takes no taps until it is gone, or opened again
  const [closing, setClosing] = React.useState(false);
  // a sheet built already open still rises into view, so it starts below the edge unless motion is off
  const prog = useSharedValue(visible && level === 'none' ? 1 : 0);
  // the backdrop fades on its own value beside the panel's, so correcting where the panel is never makes it flicker
  const dim = useSharedValue(visible && level === 'none' ? 1 : 0);
  const drag = useSharedValue(0);
  // the motion this render's level calls for, read by the callbacks below (they are made once)
  const slides = level === 'full';
  const motion = React.useRef(slides ? SLIDE : FADE);
  motion.current = slides ? SLIDE : FADE;
  // the panel's own height, so it can start wholly below the edge; a screen's height until it has measured, so its
  // first frame is always out of sight
  const panelH = useSharedValue(winH);
  // set while a fresh panel waits for its first layout: the rise starts once its height is known
  const waiting = React.useRef(false);
  // set while the panel is on its way out, so opening it again turns it round instead of starting over
  const leaving = React.useRef(false);
  // whether the modal is (or is about to be) up: read in place of `render`, which can lag a quick open and close
  const mounted = React.useRef(visible);
  const closedRef = React.useRef(onClosed);
  closedRef.current = onClosed;
  const risenRef = React.useRef(onRisen);
  risenRef.current = onRisen;
  const risen = React.useCallback(() => { risenRef.current?.(); }, []);
  const finishClose = React.useCallback(() => {
    leaving.current = false;
    mounted.current = false;
    setRender(false);
    closedRef.current?.();
  }, []);
  const rise = React.useCallback(() => {
    waiting.current = false;
    dim.value = withTiming(1, motion.current.arrive);
    prog.value = withTiming(1, motion.current.arrive, (fin) => {
      if (fin) runOnJS(risen)();
    });
  }, []);
  React.useEffect(() => {
    if (visible) {
      tap();
      setClosing(false);
      if (level === 'none') {
        drag.value = 0;
        leaving.current = false;
        mounted.current = true;
        prog.value = 1;
        dim.value = 1;
        setRender(true);
        // nothing rises: the sheet is up once its window is on screen
        const up = setTimeout(risen, 50);
        return () => clearTimeout(up);
      }
      if (leaving.current) {
        // opened again while it was still leaving: it turns round from where it is, and a pull it had been taken
        // down by eases back with it instead of jumping
        leaving.current = false;
        drag.value = withTiming(0, motion.current.arrive);
        rise();
        return undefined;
      }
      drag.value = 0;
      prog.value = 0;
      dim.value = 0;
      panelH.value = winH;
      waiting.current = true;
      mounted.current = true;
      setRender(true);
      // a panel that never reports its layout (or reported it before this ran) still rises
      const fallback = setTimeout(() => { if (waiting.current) rise(); }, 120);
      return () => clearTimeout(fallback);
    }
    // closed before it had risen: it must not rise once its layout arrives
    waiting.current = false;
    if (mounted.current) {
      if (level === 'none') { prog.value = 0; dim.value = 0; finishClose(); }
      else {
        leaving.current = true;
        setClosing(true);
        dim.value = withTiming(0, motion.current.leave);
        prog.value = withTiming(0, motion.current.leave, (fin) => {
          if (fin) runOnJS(finishClose)();
        });
      }
    }
    return undefined;
  }, [visible]);
  const onPanelLayout = React.useCallback((e: { nativeEvent: { layout: { height: number } } }) => {
    const h = e.nativeEvent.layout.height;
    const p = prog.value;
    if (motion.current === SLIDE && !waiting.current && p > 0 && p < 1 && !leaving.current && Math.abs(h - panelH.value) > 1) {
      // the real height landed mid-rise (after the fallback or a turn-round started it on a guess): keep the panel
      // where it is on screen and rise the rest of the way, instead of jumping. The backdrop is not touched.
      const off = (1 - p) * (panelH.value + 24);
      panelH.value = h;
      prog.value = Math.max(0, Math.min(1, 1 - off / (h + 24)));
      prog.value = withTiming(1, ARRIVE, (fin) => {
        if (fin) runOnJS(risen)();
      });
      return;
    }
    panelH.value = h;
    if (waiting.current) rise();
  }, []);
  // the backdrop comes and goes with the panel, and thins a little as a pull takes the panel down
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, dim.value) * (1 - 0.5 * Math.min(1, drag.value / Math.max(1, panelH.value))),
  }));
  // NOTE: with full motion the panel keeps full opacity and only slides. (An animated opacity on top of the slide read
  // as a "transparent popup" bug on device.) With some motion nothing slides, so it fades in place instead.
  const panelStyle = useAnimatedStyle(() => (slides
    ? { opacity: 1, transform: [{ translateY: (1 - prog.value) * (panelH.value + 24) + drag.value }] }
    : { opacity: prog.value, transform: [{ translateY: drag.value }] }));
  // a pull on the handle or the title follows the finger; far enough, or flicked, it closes the sheet
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;
  const requestClose = React.useCallback(() => closeRef.current(), []);
  const pull = React.useMemo(() => Gesture.Pan()
    .activeOffsetY(8)
    .onUpdate((e) => { drag.value = Math.max(0, e.translationY); })
    .onEnd((e) => {
      if (e.translationY > 90 || e.velocityY > 900) runOnJS(requestClose)();
      // an ease back, not a spring: a spring's overshoot would lift the panel off the screen's edge
      else drag.value = withTiming(0, { duration: 220, easing: EASE_OUT });
    }), [requestClose]);
  if (!render) return null;
  // statusBarTranslucent: app.json runs a translucent status bar, so the modal's
  // own window has to span it too — without it the dialog content view starts
  // below the bar and the backdrop leaves an undimmed strip across the top
  return (
    <Modal visible transparent statusBarTranslucent animationType="none" onRequestClose={onClose}>
      {/* a modal is its own window: gestures inside it need their own root */}
      <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={{ flex: 1 }} pointerEvents={closing ? 'none' : 'box-none'}>
      <Animated.View style={[st.sheetOverlay, backdropStyle]}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
      </Animated.View>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Animated.View
          onLayout={onPanelLayout}
          style={[st.sheet, narrowPanel, theme === 'minimal' && { backgroundColor: MIN.card, boxShadow: SH.sheetPanelMin }, panelStyle]}
        >
          {/* minimal has no shadow to define the handle, so the FILL has to
              carry it — C.inset on MIN.card is all but invisible */}
          <GestureDetector gesture={pull}>
            <View collapsable={false} style={st.grab}>
              <View style={[st.sheetHandle, theme === 'minimal' ? { backgroundColor: MIN.border } : neuInset('hairline')]} />
              {title ? <Text style={st.sheetTitle} accessibilityRole="header">{title}</Text> : null}
            </View>
          </GestureDetector>
          {/* negative margin + matching padding: children's raised shadows get
              breathing room inside the ScrollView's clip bounds */}
          <ScrollView
            keyboardShouldPersistTaps="handled"
            style={{ maxHeight: scrollMax, marginHorizontal: -10, marginTop: -8 }}
            contentContainerStyle={{ paddingHorizontal: 10, paddingTop: 8, paddingBottom: 10 }}
          >
            {/* rows that fold out of a sheet never outlive it: when the modal goes, its content leaves at once (the
                ambient screen does the same), so no exit animation runs on in a window that is being torn down */}
            <LayoutAnimationConfig skipExiting>{children}</LayoutAnimationConfig>
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
      </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

export function DotMenu({
  visible, onClose, items, title,
}: {
  visible: boolean; onClose: () => void;
  items: { label: string; icon: any; color?: string; onPress: () => void }[];
  /** what the actions act on, above them (a note's name, say); none, and the menu is only its actions */
  title?: string;
}) {
  // the chosen action runs once the menu has closed, so a sheet it opens or a toast it shows is never behind it
  const pending = React.useRef<(() => void) | null>(null);
  return (
    <Sheet
      visible={visible} onClose={onClose} title={title}
      onClosed={() => { const run = pending.current; pending.current = null; run?.(); }}
    >
      {items.map((it, i) => (
        <MenuItem
          key={i} index={i} item={it} last={i === items.length - 1}
          onPick={() => { pending.current = it.onPress; onClose(); }}
        />
      ))}
    </Sheet>
  );
}

/**
 * One action of a menu: the actions come up in turn behind the rising sheet, a short way and quickly. A hairline parts
 * each from the next; the last has none, so nothing floats above the sheet's foot.
 */
function MenuItem({ index, item, last, onPick }: {
  index: number; item: { label: string; icon: any; color?: string }; last: boolean; onPick: () => void;
}) {
  const level = useAnimLevel();
  const shown = useSharedValue(level === 'full' ? 0 : 1);
  React.useEffect(() => {
    if (level === 'full') shown.value = withDelay(70 + Math.min(index, 6) * 35, withTiming(1, { duration: 240, easing: EASE_OUT }));
  }, []);
  const aStyle = useAnimatedStyle(() => ({ opacity: shown.value, transform: [{ translateY: 6 * (1 - shown.value) }] }));
  return (
    <Animated.View style={aStyle}>
      <Bouncy onPress={onPick} style={[st.menuRow, last && st.menuRowLast]}>
        <Ionicons name={item.icon} size={19} color={item.color || C.textDim} />
        <Text style={[T.body, { marginLeft: 14, color: item.color || C.text }]}>{item.label}</Text>
      </Bouncy>
    </Animated.View>
  );
}

export function Row({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center' }, style]}>{children}</View>;
}

/* ---------------------------------------------------------------- lists: one card per list */

/** room a list card's slices leave for its light (top) and shadow (bottom), and how far a slice runs past a seam */
const SLICE_TOP = 12;
const SLICE_BOTTOM = 20;
const SLICE_OVERLAP = 40;

/**
 * One raised card that holds a whole list, with hairlines between its rows, so a list reads as one object instead of
 * a stack of cards. Rows fold in and out, and the card follows their height.
 */
export function ListCard({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const theme = useTheme();
  const level = useAnimLevel();
  const rows = React.Children.toArray(children);
  // rows added or removed later fold in and out; the rows the card is built with are simply there
  const built = React.useRef(false);
  React.useEffect(() => { built.current = true; }, []);
  // an eased glide, not a spring: nested springs overshoot against each other and read as a wobble
  const layout = glide(level);
  const enter = built.current ? rowIn(level) : undefined;
  const exit = rowOut(level);
  return (
    <Animated.View
      layout={layout}
      style={[
        st.cardBase, lst.card,
        theme === 'minimal'
          ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: MIN.border }
          : { backgroundColor: C.card, ...neuRaised('mid') },
        style,
      ]}
    >
      {rows.map((row, i) => (
        <Animated.View
          key={(row as React.ReactElement).key ?? i}
          entering={enter}
          exiting={exit}
          layout={layout}
        >
          {i > 0 ? <View style={lst.hair} /> : null}
          {row}
        </Animated.View>
      ))}
    </Animated.View>
  );
}

/**
 * A row's slice of one list card, for lists that virtualise and so cannot wrap their rows in a card. The first slice
 * owns the top corners and the last the bottom ones; each slice clips its shadow where it meets the next, so the list
 * still reads as one card with no seams. The list's content keeps its usual side padding.
 */
export function ListSlice({ first, last, enter = false, children }: {
  first: boolean; last: boolean;
  /** rows of the first screenful rise together, so the card arrives as one object */
  enter?: boolean;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  const r = S.radius;
  // every slice of the first screenful rises on the same cue and the same curve, so the card arrives whole and no
  // seam opens between its slices
  const entrance = useEntrance(0, enter);
  return (
    <Animated.View style={[lst.clip, { paddingTop: first ? SLICE_TOP : 0, paddingBottom: last ? SLICE_BOTTOM : 0 }, entrance]}>
      <View
        pointerEvents="none"
        style={[
          lst.surface,
          {
            top: first ? SLICE_TOP : -SLICE_OVERLAP,
            bottom: last ? SLICE_BOTTOM : -SLICE_OVERLAP,
            borderTopLeftRadius: first ? r : 0, borderTopRightRadius: first ? r : 0,
            borderBottomLeftRadius: last ? r : 0, borderBottomRightRadius: last ? r : 0,
          },
          theme === 'minimal'
            ? {
              backgroundColor: MIN.card, borderColor: MIN.border, borderLeftWidth: 1, borderRightWidth: 1,
              borderTopWidth: first ? 1 : 0, borderBottomWidth: last ? 1 : 0,
            }
            : { backgroundColor: C.card, ...neuRaised('mid') },
        ]}
      />
      {first ? null : <View style={lst.hair} />}
      <View style={{ paddingTop: first ? 4 : 0, paddingBottom: last ? 4 : 0 }}>{children}</View>
    </Animated.View>
  );
}

/** the line a row's title is set on (T.body's), which a row's leading icon centres on */
const ROW_TITLE_LINE = 21;

/**
 * A row's leading icon, centred on the title's first line rather than on the middle of a title and a line under it.
 * The row takes alignItems 'flex-start'; a one-line row keeps its icon centred as it is, with no need of this.
 */
export function RowIcon({ name, size, color }: { name: any; size: number; color: string }) {
  // the title's line grows with the phone's font size, and the icon's box with it
  const { fontScale } = useWindowDimensions();
  return (
    <View style={{ height: Math.max(size, Math.round(ROW_TITLE_LINE * fontScale)), justifyContent: 'center' }}>
      <Ionicons name={name} size={size} color={color} />
    </View>
  );
}

/** A pressable row inside a list card: it stays in place and carves in while pressed. */
export function ListRow({
  children, onPress, onLongPress, style, accessibilityLabel, accessibilityHint, accessibilityRole,
}: {
  children: React.ReactNode; onPress?: () => void; onLongPress?: () => void; style?: ViewStyle | ViewStyle[];
} & A11yProps) {
  if (!onPress && !onLongPress) {
    // a row that cannot be pressed reads as one element only when it is given a name of its own
    return (
      <View
        style={[lst.row, style]}
        accessible={accessibilityLabel ? true : undefined}
        accessibilityLabel={accessibilityLabel} accessibilityHint={accessibilityHint} accessibilityRole={accessibilityRole}
      >
        {children}
      </View>
    );
  }
  return (
    <Bouncy
      onPress={onPress} onLongPress={onLongPress} scaleTo={1} sink={false} radius={14} style={[lst.row, style]}
      accessibilityLabel={accessibilityLabel} accessibilityHint={accessibilityHint} accessibilityRole={accessibilityRole}
    >
      {children}
    </Bouncy>
  );
}

/**
 * Text whose strike-through draws across it, line after line like one pen stroke, as the words fade to the muted
 * ink, when `done` turns on; turning it off lifts the line and the ink away together. Drawn in its state on its
 * first paint.
 */
export function StrikeText({ done, style, wrapStyle, numberOfLines, children }: {
  done: boolean; style?: any; wrapStyle?: ViewStyle; numberOfLines?: number; children: React.ReactNode;
}) {
  const level = useAnimLevel();
  const [lines, setLines] = React.useState<{ x: number; y: number; width: number; height: number }[]>([]);
  const count = Math.max(1, lines.length);
  // how far the pen has travelled, in lines: line i is drawn over [i, i + 1]
  const draw = useSharedValue(done ? count : 0);
  // the line's ink and the words' muted colour
  const ink = useSharedValue(done ? 1 : 0);
  const was = React.useRef(done);
  React.useEffect(() => {
    const changed = was.current !== done;
    was.current = done;
    if (level === 'none' || !changed) {
      // no motion, or only the wrapping changed: the finished state, at once
      draw.value = done ? count : 0;
      ink.value = done ? 1 : 0;
      return;
    }
    if (done) {
      draw.value = 0;
      draw.value = withTiming(count, { duration: Math.min(560, 300 + 110 * (count - 1)), easing: EASE_OUT });
      ink.value = withTiming(1, { duration: 300, easing: EASE_OUT });
    } else {
      ink.value = withTiming(0, { duration: 180, easing: EASE_OUT });
    }
  }, [done, level, count]);
  const plainStyle = useAnimatedStyle(() => ({ opacity: 1 - ink.value }));
  const mutedStyle = useAnimatedStyle(() => ({ opacity: ink.value }));
  return (
    <View style={wrapStyle}>
      <Animated.Text
        style={[style, plainStyle]}
        numberOfLines={numberOfLines}
        onTextLayout={(e) => {
          const next = e.nativeEvent.lines.map((l) => ({ x: l.x, y: l.y, width: l.width, height: l.height }));
          setLines((prev) => (prev.length === next.length && prev.every((l, i) => l.width === next[i].width && l.y === next[i].y) ? prev : next));
        }}
      >
        {children}
      </Animated.Text>
      {/* the same words in the muted ink, laid exactly over the first, crossing over as the task is ticked */}
      <Animated.Text
        style={[style, lst.overText, { color: C.textFaint }, mutedStyle]}
        numberOfLines={numberOfLines}
        importantForAccessibility="no"
        accessibilityElementsHidden
      >
        {children}
      </Animated.Text>
      {lines.map((l, i) => (
        <StrikeLine key={i} index={i} draw={draw} ink={ink} left={l.x} top={l.y + l.height * 0.54} width={l.width} />
      ))}
    </View>
  );
}

function StrikeLine({ index, draw, ink, left, top, width }: {
  index: number; draw: SharedValue<number>; ink: SharedValue<number>; left: number; top: number; width: number;
}) {
  const aStyle = useAnimatedStyle(() => {
    const p = Math.min(1, Math.max(0, draw.value - index));
    return { opacity: p > 0.001 ? ink.value : 0, transform: [{ scaleX: p }] };
  });
  return <Animated.View pointerEvents="none" style={[lst.strike, { left, top, width }, aStyle]} />;
}

const lst = StyleSheet.create({
  card: { paddingVertical: 4 },
  hair: { height: StyleSheet.hairlineWidth, backgroundColor: C.hairline, marginHorizontal: 12 },
  clip: { overflow: 'hidden', marginHorizontal: -S.pad, paddingHorizontal: S.pad },
  surface: { position: 'absolute', left: S.pad, right: S.pad },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 12, borderRadius: 14 },
  strike: { position: 'absolute', height: 1.5, borderRadius: 1, backgroundColor: C.textFaint, transformOrigin: 'left' },
  overText: { position: 'absolute', top: 0, left: 0, right: 0 },
});

const st = StyleSheet.create({
  cardBase: {
    borderRadius: S.radius,
    marginBottom: S.gap,
    // no overflow clip: it would cut the raised shadow; images inside round their own corners
  },
  insetBase: {
    borderRadius: S.radiusSm,
    overflow: 'hidden',
  },
  sectionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: S.section, marginBottom: 14, paddingHorizontal: 2,
  },
  // the chip's hairline edge is drawn by its two layers (see chipEdge), so the padding takes the edge's point
  chip: {
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999,
    marginRight: 10, marginBottom: 10,
    overflow: 'hidden',
  },
  chipSmall: { paddingVertical: 5, paddingHorizontal: 11 },
  /** the resting outline, or the chosen tint with its coloured edge: two layers that cross over */
  chipEdge: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 999, borderWidth: 1 },
  // a chip's words: Schibsted, with the font padding dropped and the line set, so they centre truly in the chip
  chipText: { ...oneLine(13), color: C.textDim, fontFamily: F.smMed, letterSpacing: TRACK.small },
  chipTextSmall: { ...oneLine(12), letterSpacing: TRACK.fine },
  chipTextOn: { fontFamily: F.smSemi },
  chipTextFace: { fontFamily: F.med },
  chipTextFaceOn: { fontFamily: F.semi },
  // a pill's label is its control's primary words: Inter Tight, centred the same way
  pillText: { ...oneLine(15), fontFamily: F.semi, letterSpacing: TRACK.body },
  pillTextSmall: { ...oneLine(13), fontFamily: F.semi, letterSpacing: TRACK.small },
  /** a second ink laid exactly over the first, for colours that cross over */
  ink: { position: 'absolute', top: 0, left: 0, right: 0 },
  pill: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 13, paddingHorizontal: 20, borderRadius: 999,
    overflow: 'hidden',
  },
  ring: {
    width: RING_W, height: RING_H, borderRadius: RING_H / 2,
    backgroundColor: C.card, alignItems: 'center', justifyContent: 'center',
    ...neuRaised('low'),
  },
  track: {
    width: TRACK_W, height: TRACK_H, borderRadius: TRACK_H / 2,
    backgroundColor: C.inset, justifyContent: 'center',
    overflow: 'hidden', // ← clips the knob's shadow rims to the track bounds (required)
    ...neuInset('mid'),
  },
  thumb: {
    width: KNOB, height: KNOB, borderRadius: KNOB / 2, marginLeft: 3,
    ...neuRaised('low'),
  },
  knobFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: KNOB / 2 },
  fieldLabel: { color: C.textFaint, fontFamily: F.smMed, fontSize: 12, letterSpacing: TRACK.fine, marginLeft: 2, marginBottom: 2 },
  fieldInner: {
    color: C.text, fontFamily: F.reg, paddingHorizontal: 2, paddingVertical: 10, fontSize: 15, letterSpacing: TRACK.body,
    marginBottom: 0,
  },
  fieldLine: { height: 1 },
  fieldLineOn: { position: 'absolute', left: 0, right: 0, top: -0.5, height: 2, transformOrigin: 'left' },
  // a TimeField keeps a Field's rhythm: the same label, text and line, and the same 14 below
  timeWrap: { marginBottom: 14 },
  timeRow: { flexDirection: 'row', alignItems: 'center', paddingRight: 2 },
  timeRowPressed: { opacity: 0.6 },
  timeText: { flex: 1 },
  timeActions: { gap: 12, marginTop: 20 },
  emptyWrap: { alignItems: 'center', marginVertical: 24, paddingHorizontal: 16 },
  emptyWell: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  emptyTitle: { color: C.text, fontFamily: F.semi, fontSize: 15, letterSpacing: TRACK.body, textAlign: 'center' },
  emptyBody: {
    color: C.textFaint, fontFamily: F.sm, fontSize: 13, letterSpacing: TRACK.small, lineHeight: 19, textAlign: 'center', marginTop: 4, maxWidth: 300,
  },
  sheetOverlay: { flex: 1, backgroundColor: C.scrim },
  /** the handle and title: a taller target for the pull that closes a sheet */
  grab: { marginTop: -12, paddingTop: 12 },
  sheet: {
    backgroundColor: C.card, borderTopLeftRadius: 30, borderTopRightRadius: 30,
    padding: 24, paddingBottom: 40,
    // the lit top rim rides the shadow, so it follows the rounded corners (see SH.sheetPanel)
    boxShadow: SH.sheetPanel,
  },
  sheetWide: { width: '100%', maxWidth: 560, alignSelf: 'center' },
  sheetHandle: {
    alignSelf: 'center', width: 44, height: 5, borderRadius: 3,
    backgroundColor: C.inset, marginBottom: 18,
    ...neuInset('hairline'),
  },
  sheetTitle: { color: C.text, fontFamily: F.semi, fontSize: 20, lineHeight: 26, letterSpacing: TRACK.large, marginBottom: 18 },
  menuRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 15, paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.hairline,
  },
  menuRowLast: { borderBottomWidth: 0 },
});
