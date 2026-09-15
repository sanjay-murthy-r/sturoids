import React from 'react';
import { Pressable, View, ViewStyle } from 'react-native';
import Animated, {
  FadeIn, FadeInDown, LinearTransition,
  useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming, Easing,
} from 'react-native-reanimated';
import { useStore } from '../store';
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

/** Soft entrance — surfaces rise out of the material, no overshoot. */
export function Enter({
  index = 0, children, style,
}: { index?: number; children: React.ReactNode; style?: ViewStyle | ViewStyle[] }) {
  const level = useAnimLevel();
  if (level === 'none') return <View style={style}>{children}</View>;
  const entering =
    level === 'full'
      ? FadeInDown.duration(360).delay(Math.min(index * 50, 350)).springify().damping(22).stiffness(180)
      : FadeIn.duration(140);
  return (
    <Animated.View
      entering={entering}
      layout={level === 'full' ? LinearTransition.springify().damping(22) : undefined}
      style={style}
    >
      {children}
    </Animated.View>
  );
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
