import React from 'react';
import { Pressable, Text, ViewStyle } from 'react-native';
import Animated, {
  FadeIn, FadeOut, LinearTransition, runOnJS,
  useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSpring, withTiming, Easing,
} from 'react-native-reanimated';
import { NavigationContext, useIsFocused } from '@react-navigation/native';
import { useStore } from '../store';
import { useIntro } from '../intro';
import { AnimLevel, C, neuPressedInner } from '../theme';

/**
 * The key for a screen's content container. Entrances play once, when a screen first mounts: every tab is
 * built after the intro, and coming back to a tab shows it as it was instead of replaying its entrance.
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

const ENTER = { duration: 540, easing: Easing.out(Easing.cubic) };

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
  (level === 'none' ? undefined : FadeOut.duration(160).easing(Easing.in(Easing.quad)));

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
    o.value = withTiming(0, { duration: 110, easing: Easing.in(Easing.quad) }, (fin) => {
      if (fin) runOnJS(land)(swapKey);
    });
  }, [swapKey]);
  const aStyle = useAnimatedStyle(() => ({ opacity: o.value }));
  // the held words stay up while they dip out; once the new key has landed, the children render live again
  return <Animated.View style={[style as any, aStyle]}>{swapKey === held.key ? children : held.node}</Animated.View>;
}

/**
 * A surface's entrance: it rises a short way out of the material and comes up to full strength, once, the first time
 * its screen is really in view. That is after the intro has left, and for a tab the first time it is opened, not
 * while it is being built out of sight. Returns the style to put on the surface.
 */
export function useEntrance(index = 0, enabled = true) {
  const level = useAnimLevel();
  const focused = useIsFocused();
  const introOver = useIntro((s) => s.phase !== 'playing');
  const still = level === 'none' || !enabled;
  const shown = useSharedValue(still ? 1 : 0);
  const played = React.useRef(still);
  React.useEffect(() => {
    if (played.current || !focused || !introOver) return;
    played.current = true;
    shown.value = level === 'full'
      ? withDelay(Math.min(index * 60, 360), withTiming(1, ENTER))
      : withDelay(Math.min(index * 30, 150), withTiming(1, { duration: 200 }));
  }, [focused, introOver, level]);
  const rise = level === 'full' ? 14 : 0;
  return useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateY: rise * (1 - shown.value) }],
  }));
}

/** Soft entrance: the surface rises out of the material, no overshoot, the first time its screen is in view. */
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
