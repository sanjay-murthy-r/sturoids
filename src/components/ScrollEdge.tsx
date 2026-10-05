import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Extrapolation, interpolate, useAnimatedScrollHandler, useAnimatedStyle, useDerivedValue, useSharedValue,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { AnimLevel, C, MIN, darkSh } from '../theme';
import { useTheme } from './UI';
import { useAnimLevel } from './Motion';

/**
 * The tool header's edge (a 1 px hairline and a soft 10 px shade) for a scroll the header's own scroll link cannot follow:
 * a screen that holds more than one scroll under the same bar (Settings' list and its pages, the Vault's three lists).
 * It sits at the top of the scroll it belongs to, which starts right under the bar, so it falls exactly where the bar's
 * own edge would, and it travels with the layer it is in.
 */
const SHADE = [darkSh(0.3), darkSh(0)] as const;

/** How much of the edge shows at a scroll offset: none at the top, all of it once the content has moved 14; a step with no motion. */
export const edgeStrength = (y: number, level: AnimLevel) => {
  'worklet';
  return level === 'none' ? (y > 2 ? 1 : 0) : interpolate(y, [2, 14], [0, 1], Extrapolation.CLAMP);
};

/** The edge itself, drawn at the top of its container, over whatever scrolls there. `at` is 0 to 1 and runs on the UI thread. */
export function ScrollEdge({ at }: { at: SharedValue<number> }) {
  const theme = useTheme();
  const style = useAnimatedStyle(() => ({ opacity: at.value }));
  return (
    <Animated.View pointerEvents="none" style={[st.edge, style]}>
      <View style={[st.hair, { backgroundColor: theme === 'minimal' ? MIN.border : C.border }]} />
      <LinearGradient colors={SHADE} style={st.shade} />
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

const st = StyleSheet.create({
  edge: { position: 'absolute', left: 0, right: 0, top: 0, height: 10 },
  hair: { position: 'absolute', left: 0, right: 0, top: 0, height: StyleSheet.hairlineWidth },
  shade: { position: 'absolute', left: 0, right: 0, top: 0, height: 10 },
});
