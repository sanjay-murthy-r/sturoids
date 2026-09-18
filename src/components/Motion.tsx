import React from 'react';
import { Pressable, Text, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSpring, withTiming, Easing,
} from 'react-native-reanimated';
import { useIsFocused } from '@react-navigation/native';
import { useStore } from '../store';
import { useIntro } from '../intro';
import { C, neuPressedInner } from '../theme';

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

const ENTER = { duration: 540, easing: Easing.out(Easing.cubic) };

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
}: {
  onPress?: () => void; onLongPress?: () => void; children: React.ReactNode;
  style?: any; disabled?: boolean; scaleTo?: number;
  /** border radius of the pressed-inset overlay (999 chips, 22 cards, 16 keys) */
  radius?: number;
  hitSlop?: number;
  /** false keeps the element in place while pressed (a row inside a card): only the carve shows */
  sink?: boolean;
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
      <Pressable onPress={onPress} onLongPress={onLongPress} disabled={disabled} style={style} hitSlop={hitSlop}>
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

/** Gentle pop for state changes (checkmarks etc.) — eases, doesn't bounce hard. */
export function Pop({ children, dep }: { children: React.ReactNode; dep: any }) {
  const level = useAnimLevel();
  const scale = useSharedValue(1);
  React.useEffect(() => {
    if (level === 'none') return;
    scale.value = 0.7;
    scale.value = withSpring(1, { damping: 16, stiffness: 300, mass: 0.6 });
  }, [dep]);
  const aStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return <Animated.View style={aStyle}>{children}</Animated.View>;
}

/**
 * A whole number that counts to its new value instead of changing in place: quick for a step of one, longer for a
 * big jump, and instant with animations off. Anything after the number (a unit, a total) goes in as children.
 */
export function CountUp({ value, style, children }: { value: number; style?: any; children?: React.ReactNode }) {
  const level = useAnimLevel();
  const [shown, setShown] = React.useState(value);
  const shownRef = React.useRef(value);
  React.useEffect(() => {
    const from = shownRef.current;
    if (from === value) return;
    if (level === 'none') {
      shownRef.current = value;
      setShown(value);
      return;
    }
    const start = Date.now();
    const duration = Math.min(700, 260 + Math.abs(value - from) * 30);
    let frame = 0;
    const step = () => {
      const t = Math.min(1, (Date.now() - start) / duration);
      const n = Math.round(from + (value - from) * (1 - Math.pow(1 - t, 3)));
      if (n !== shownRef.current) {
        shownRef.current = n;
        setShown(n);
      }
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, level]);
  return <Text style={style}>{shown}{children}</Text>;
}
