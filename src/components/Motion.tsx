import React from 'react';
import { Pressable, Text, ViewStyle } from 'react-native';
import Animated, {
  FadeIn, FadeOut, LinearTransition, runOnJS,
  useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSpring, withTiming, Easing,
} from 'react-native-reanimated';
import { NavigationContext, NavigationRouteContext, useIsFocused } from '@react-navigation/native';
import { useStore } from '../store';
import { useIntro } from '../intro';
import { AnimLevel, C, neuPressedInner } from '../theme';

/**
 * The key for a screen's content container. It stays 0 so the content is never rebuilt: a tab's entrance replays
 * through useEntrance each time the tab is opened from the bar (see useTabReturns), not by remounting.
 */
export function useFocusKey() {
  return 0;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * The motion level every animated component obeys. The OS "reduce motion" /
 * "remove animations" setting wins over the in-app dial.
 */
export const useAnimLevel = () => {
  const reduced = useReducedMotion();
  const level = useStore((s) => s.settings.animLevel);
  return reduced ? 'none' : level;
};

/** Neumorphic motion: presses SINK into the material, releases ease back out. */
export const SINK_IN = { duration: 90, easing: Easing.out(Easing.quad) };
export const RISE_OUT = { damping: 20, stiffness: 240, mass: 0.8 };

/** The curve every state change eases out on: quick to answer, soft to land. */
export const EASE_OUT = Easing.out(Easing.cubic);
/** A state change in place: a tint, a fill, a colour crossing over. */
export const CHANGE = { duration: 200, easing: EASE_OUT };

/*
 * Motion tokens for things that travel as a whole (a sheet, a bar, a page): an arrival is quick off the mark and long
 * to settle, a leaving takes about two thirds as long and gathers speed, so a closing never lingers. A surface's own
 * entrance (useEntrance below) keeps its own timing and is not built from these.
 */
/** Emphasised out: most of the way there in the first third, then a long soft landing. */
export const EASE_EMPHASISED = Easing.bezier(0.16, 1, 0.3, 1);
/** The leaving curve: a gentle start that gathers speed. */
export const EASE_EXIT = Easing.in(Easing.quad);
/** A panel arriving (a sheet rising) and leaving again. */
export const ARRIVE = { duration: 360, easing: EASE_EMPHASISED };
export const LEAVE = { duration: 220, easing: EASE_EXIT };
/** With only some motion a panel fades in place instead of travelling: short, and a little shorter out. */
export const FADE_IN = { duration: 200, easing: EASE_OUT };
export const FADE_OUT = { duration: 150, easing: EASE_EXIT };
/**
 * The bar's shift from one tab to the next, and with it everything in the bar that follows the current tab (its
 * colour, its name, its dot), so the bar and the scene arrive together. With only some motion the scene change is a
 * short fade and the bar keeps pace with that instead.
 */
export const TAB_SHIFT = { duration: 260, easing: EASE_OUT };
export const TAB_FADE = { duration: 200, easing: EASE_OUT };

const ENTER = { duration: 540, easing: Easing.out(Easing.cubic) };

/**
 * How a page pushed onto a native stack comes and goes. Android plays fixed animations from react-native-screens' own
 * XML: `animationDuration` is read on iOS only, and 'default' is a sideways slide on Android 13 and up but a zoom
 * below, so neither the length nor the look can be tuned or trusted there. A pushed page's content already rises on
 * its own entrance, which the user likes and wants every time, so a stack animation that rises too ('fade_from_bottom',
 * 'slide_from_bottom') doubles that motion and one that slides sideways fights it. 'fade' adds none: the page
 * dissolves in over 150 ms while its content rises exactly as a tab's does on a visit, and back dissolves out again.
 * The window behind both screens is the material's own colour, so the cross-dissolve shows no seam. With motion off a
 * page simply appears, and some motion is a short fade already. To try a rising page again, 'fade_from_bottom' (350 ms
 * in, 250 out) is the one to return to; it is set here once for every stack.
 */
export const pageTransition = (level: AnimLevel) => ({
  animation: (level === 'none' ? 'none' : 'fade') as 'none' | 'fade',
});

/** A panel that takes another's place rises a short way into it as it comes up to full strength. */
export const riseIn = () => {
  'worklet';
  const ease = { duration: 240, easing: Easing.out(Easing.cubic) };
  return {
    initialValues: { opacity: 0, transform: [{ translateY: 8 }] },
    animations: { opacity: withTiming(1, ease), transform: [{ translateY: withTiming(0, ease) }] },
  };
};

/**
 * A panel that replaces another from one side (the next day after a day) comes in from that side, a short way, and
 * up from a faint start. `dx` is where it starts: positive from the right.
 */
export const shiftIn = (dx: number) => () => {
  'worklet';
  const ease = { duration: 280, easing: Easing.out(Easing.cubic) };
  return {
    initialValues: { opacity: 0.25, transform: [{ translateX: dx }] },
    animations: { opacity: withTiming(1, ease), transform: [{ translateX: withTiming(0, ease) }] },
  };
};

/** A row arriving in a list after the list was built: it fades in where it stands. Nothing with motion off. */
export const rowIn = (level: AnimLevel) =>
  (level === 'none' ? undefined : FadeIn.duration(level === 'full' ? 240 : 180).easing(EASE_OUT));

/** A row leaving a list: it fades as it goes, a little quicker than one arrives. */
export const rowOut = (level: AnimLevel) =>
  (level === 'none' ? undefined : FadeOut.duration(160).easing(EASE_EXIT));

/**
 * The rows a fold moves glide to their new places: an eased timing, never a spring (springs across siblings
 * overshoot against each other and read as a wobble), and only with every animation on.
 */
export const glide = (level: AnimLevel) =>
  (level === 'full' ? LinearTransition.duration(260).easing(EASE_OUT) : undefined);

/**
 * False while a component paints for the first time, true after: what arrives later animates, what it was built
 * with is simply there.
 */
export function useBuilt() {
  const built = React.useRef(false);
  React.useEffect(() => { built.current = true; }, []);
  return built;
}

/**
 * A part that turns up on a state change (an empty list's note, a section that opens) fades in where it stands. It
 * plays only when it arrives on a screen already in view; one built with its screen, or out of sight, arrives with
 * the screen's own entrance instead. Opacity only, so it never adds a second rise to an entrance around it. Returns
 * the style to put on the part.
 */
export function useAppear() {
  const level = useAnimLevel();
  const nav = React.useContext(NavigationContext);
  const [live] = React.useState(
    () => level !== 'none' && (nav ? nav.isFocused() : true) && useIntro.getState().phase !== 'playing'
  );
  const shown = useSharedValue(live ? 0 : 1);
  React.useEffect(() => {
    if (live) shown.value = withTiming(1, { duration: level === 'full' ? 280 : 200, easing: EASE_OUT });
  }, []);
  return useAnimatedStyle(() => ({ opacity: shown.value }));
}

/** A wrapper for a part that turns up on a state change: see useAppear. */
export function Appear({ children, style }: { children: React.ReactNode; style?: ViewStyle | ViewStyle[] }) {
  const appear = useAppear();
  return <Animated.View style={[style as any, appear]}>{children}</Animated.View>;
}

/**
 * Words that change in place (a greeting, a title, a line of help) dip out and come back as the new words, instead
 * of swapping in one frame. `swapKey` names what is shown; while it stays the same the children update directly. The
 * first paint is never animated, and with motion off the words simply change.
 */
export function FadeSwap({ swapKey, children, style }: {
  swapKey: string; children: React.ReactNode; style?: ViewStyle | ViewStyle[];
}) {
  const level = useAnimLevel();
  const [held, setHeld] = React.useState<{ key: string; node: React.ReactNode }>({ key: swapKey, node: children });
  const latest = React.useRef(children);
  latest.current = children;
  const o = useSharedValue(1);
  const land = React.useCallback((key: string) => {
    setHeld({ key, node: latest.current });
    o.value = withTiming(1, { duration: 220, easing: EASE_OUT });
  }, []);
  React.useEffect(() => {
    if (swapKey === held.key) {
      // back to the words already held (a change undone mid-dip): they come back up
      if (o.value < 1) o.value = withTiming(1, { duration: 160, easing: EASE_OUT });
      return;
    }
    if (level === 'none') {
      setHeld({ key: swapKey, node: latest.current });
      o.value = 1;
      return;
    }
    o.value = withTiming(0, { duration: 110, easing: EASE_EXIT }, (fin) => {
      if (fin) runOnJS(land)(swapKey);
    });
  }, [swapKey]);
  const aStyle = useAnimatedStyle(() => ({ opacity: o.value }));
  // the held words stay up while they dip out; once the new key has landed, the children render live again
  return <Animated.View style={[style as any, aStyle]}>{swapKey === held.key ? children : held.node}</Animated.View>;
}

/** The tab navigator a screen sits in, if any: the nearest navigator up the tree whose state is a tab bar's. */
function tabNavigatorOf(nav: any) {
  for (let n = nav; n; n = n.getParent?.()) {
    if (n.getState?.()?.type === 'tab') return n;
  }
  return null;
}

/**
 * Counts the times this screen's tab is opened again from the bar after another tab was shown. A page pushed over the
 * tab and closed again does not count: the tab stayed in view beneath it, so nothing should replay there. `onGone`
 * runs once a tab that was left has slid out of sight (the bar's shift is over), the moment to ready it unseen for its
 * next entrance. With `active` false nothing is listened to, for the many parts that never replay.
 *
 * A tab's screens get the bar's focus and blur from the navigators between: a slot's stack hands its parent's focus and
 * blur on to the page it shows, so a tool in a slot counts exactly like Today does.
 */
export function useTabReturns(onGone?: () => void, active = true) {
  const nav = React.useContext(NavigationContext);
  const [returns, setReturns] = React.useState(0);
  const gone = React.useRef(onGone);
  gone.current = onGone;
  React.useEffect(() => {
    if (!nav || !active) return;
    let shownAt = -1; // the bar's index while this tab was in view
    let left = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const barIndex = () => tabNavigatorOf(nav)?.getState()?.index ?? -1;
    if (nav.isFocused()) shownAt = barIndex();
    const offFocus = nav.addListener('focus', () => {
      clearTimeout(timer);
      if (left) {
        left = false;
        setReturns((n) => n + 1);
      }
      shownAt = barIndex();
    });
    const offBlur = nav.addListener('blur', () => {
      const now = barIndex();
      if (now === -1 || now === shownAt) return;
      left = true;
      clearTimeout(timer);
      timer = setTimeout(() => gone.current?.(), TAB_SHIFT.duration + 40);
    });
    return () => { clearTimeout(timer); offFocus(); offBlur(); };
  }, [nav, active]);
  return returns;
}

/** How long a page waits for its stack to start the transition before it plays its entrance regardless. */
const START_WAIT = 320;
/** When each pushed page was first built, by route key, so a part that turns up later has no transition to wait for. */
const BUILT = new Map<string, number>();
/** The pages whose stack has started their transition (see noteTransitionStart). */
const STARTED = new Set<string>();

/**
 * Give a stack these as its `screenListeners`. It notes when each page's transition starts, so a part that first turns up
 * in a page long after that (the content of a page behind a lock, once the lock is opened) finds nothing to wait for
 * instead of sitting unseen until the fallback.
 */
export const noteTransitionStart = {
  transitionStart: (e: any) => {
    if (e?.data?.closing || !e?.target) return;
    STARTED.add(e.target);
    if (STARTED.size > 64) STARTED.delete(STARTED.values().next().value as string);
  },
};

/**
 * False while a page pushed onto a stack is still being set down, true once the stack starts its transition. A page is
 * built a little before it can be seen; an entrance that began at once would spend its first frames unseen and arrive
 * partly played. Anything not pushed (a tab, a stack's first page) is ready at once, and so is a part that turns up in a
 * page that has been up for a while. If the stack's cue never comes, a short wait stands in for it.
 */
function useReadyToShow(active: boolean) {
  const nav = React.useContext(NavigationContext);
  const route = React.useContext(NavigationRouteContext);
  const [wait] = React.useState(() => {
    if (!active || !nav || !route) return 0;
    const state: any = nav.getState?.();
    if (state?.type !== 'stack' || !(state.routes.findIndex((r: any) => r.key === route.key) > 0)) return 0;
    if (STARTED.has(route.key)) return 0;
    const now = Date.now();
    const since = BUILT.get(route.key);
    if (since == null) {
      BUILT.set(route.key, now);
      if (BUILT.size > 64) BUILT.delete(BUILT.keys().next().value as string);
    }
    return Math.max(0, START_WAIT - (since == null ? 0 : now - since));
  });
  const [ready, setReady] = React.useState(wait === 0);
  React.useEffect(() => {
    if (ready) return;
    const off = (nav as any).addListener('transitionStart', (e: any) => { if (!e?.data?.closing) setReady(true); });
    const fallback = setTimeout(() => setReady(true), wait);
    return () => { off(); clearTimeout(fallback); };
  }, []);
  return ready;
}

/**
 * A surface's entrance: it rises a short way out of the material and comes up to full strength when its screen is
 * really in view. That is after the intro has left, for a page pushed onto a stack when its transition has started, and
 * for a tab when it is opened, not while it is being built out of sight. A tab plays it again every time it is opened
 * from the bar, exactly as the first time; coming back from a page pushed over it does not, since the tab stayed in
 * view beneath. Returns the style to put on the surface.
 */
export function useEntrance(index = 0, enabled = true) {
  const level = useAnimLevel();
  const focused = useIsFocused();
  const introOver = useIntro((s) => s.phase !== 'playing');
  const still = level === 'none' || !enabled;
  const shown = useSharedValue(still ? 1 : 0);
  // A tab that was left goes back to the material once it has slid out of sight, so its next entrance starts from
  // nothing and no frame of it can show the old state. Back on the tab within the shift, the effect below does it.
  const returns = useTabReturns(() => { shown.value = 0; }, !still);
  const ready = useReadyToShow(!still);
  const played = React.useRef(still);
  const playedFor = React.useRef(0);
  React.useEffect(() => {
    if (!focused || !introOver || !ready) return;
    // nothing to play: the surface is simply there, whatever the tab put it back to while it was away
    if (still) { shown.value = 1; return; }
    if (played.current && returns === playedFor.current) return;
    const again = played.current;
    played.current = true;
    playedFor.current = returns;
    if (again) shown.value = 0;
    shown.value = level === 'full'
      ? withDelay(Math.min(index * 60, 360), withTiming(1, ENTER))
      : withDelay(Math.min(index * 30, 150), withTiming(1, { duration: 200 }));
  }, [focused, introOver, ready, level, returns]);
  const rise = level === 'full' ? 14 : 0;
  return useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateY: rise * (1 - shown.value) }],
  }));
}

/** Soft entrance: the surface rises out of the material, no overshoot, each time its screen comes into view. */
export function Enter({
  index = 0, children, style,
}: { index?: number; children: React.ReactNode; style?: ViewStyle | ViewStyle[] }) {
  const entrance = useEntrance(index);
  return <Animated.View style={[style, entrance]}>{children}</Animated.View>;
}

/**
 * Press-sink pressable. On press the element depresses into the surface
 * (scale + slight downward shift + shadow flattens via opacity of children's elevation
 * being simulated with a dim overlay), then eases back out.
 * Name kept as "Bouncy" so every screen keeps working.
 */
export function Bouncy({
  onPress, onLongPress, children, style, disabled, scaleTo = 0.975, radius = 22, hitSlop, sink = true,
  accessibilityLabel, accessibilityRole, accessibilityState,
}: {
  onPress?: () => void; onLongPress?: () => void; children: React.ReactNode;
  style?: any; disabled?: boolean; scaleTo?: number;
  /** border radius of the pressed-inset overlay (999 chips, 22 cards, 16 keys) */
  radius?: number;
  hitSlop?: number;
  /** false keeps the element in place while pressed (a row inside a card): only the carve shows */
  sink?: boolean;
  accessibilityLabel?: string;
  accessibilityRole?: 'button' | 'tab' | 'link' | 'checkbox' | 'switch';
  accessibilityState?: { checked?: boolean; selected?: boolean; disabled?: boolean };
}) {
  const level = useAnimLevel();
  const p = useSharedValue(0); // 0 = rest, 1 = pressed
  const aStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: 1 - (1 - scaleTo) * p.value },
      { translateY: sink ? p.value * 1.5 : 0 },
    ] as const,
  }));
  const dimStyle = useAnimatedStyle(() => ({ opacity: p.value }));

  if (level === 'none') {
    return (
      <Pressable
        onPress={onPress} onLongPress={onLongPress} disabled={disabled} style={style} hitSlop={hitSlop}
        accessibilityLabel={accessibilityLabel} accessibilityRole={accessibilityRole} accessibilityState={accessibilityState}
      >
        {children}
      </Pressable>
    );
  }
  return (
    <AnimatedPressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
      accessibilityState={accessibilityState}
      onPressIn={() => { p.value = withTiming(1, SINK_IN); }}
      onPressOut={() => { p.value = withSpring(0, RISE_OUT); }}
      style={[style, aStyle]}
    >
      {children}
      {/* pressed state = the kit's carved inner panel, not a flat dim */}
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: C.pressDim, borderRadius: radius,
            ...neuPressedInner(),
          },
          dimStyle,
        ]}
      />
    </AnimatedPressable>
  );
}

/**
 * Gentle pop for a single thing a tap just chose (a radio dot): it springs up from a little smaller. With only some
 * motion it eases instead of springing.
 */
export function Pop({ children, dep }: { children: React.ReactNode; dep: any }) {
  const level = useAnimLevel();
  const scale = useSharedValue(1);
  React.useEffect(() => {
    if (level === 'none') return;
    if (level === 'some') {
      scale.value = 0.85;
      scale.value = withTiming(1, { duration: 180, easing: EASE_OUT });
      return;
    }
    scale.value = 0.7;
    scale.value = withSpring(1, { damping: 16, stiffness: 300, mass: 0.6 });
  }, [dep]);
  const aStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return <Animated.View style={aStyle}>{children}</Animated.View>;
}

/**
 * A number that counts to its new value instead of changing in place: quick for a small step, longer for a big jump,
 * and instant with animations off. Whole numbers by default; `decimals` counts in tenths or hundredths, and `format`
 * writes the figure (a percentage, say). With `from`, it counts up from there the first time it is drawn. Anything
 * after the number (a unit, a total) goes in as children.
 */
export function CountUp({ value, style, children, decimals = 0, format, from: start0 }: {
  value: number; style?: any; children?: React.ReactNode; decimals?: number; format?: (n: number) => string; from?: number;
}) {
  const level = useAnimLevel();
  const unit = Math.pow(10, decimals);
  const first = start0 != null && level !== 'none' ? start0 : value;
  const [shown, setShown] = React.useState(first);
  const shownRef = React.useRef(first);
  React.useEffect(() => {
    const from = shownRef.current;
    if (from === value) return;
    if (level === 'none') {
      shownRef.current = value;
      setShown(value);
      return;
    }
    const start = Date.now();
    const duration = Math.min(760, 260 + Math.abs(value - from) * 30);
    let frame = 0;
    const step = () => {
      const t = Math.min(1, (Date.now() - start) / duration);
      const n = t >= 1 ? Math.round(value * unit) / unit : Math.round((from + (value - from) * (1 - Math.pow(1 - t, 3))) * unit) / unit;
      if (n !== shownRef.current) {
        shownRef.current = n;
        setShown(n);
      }
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, level]);
  return <Text style={style}>{format ? format(shown) : shown}{children}</Text>;
}
