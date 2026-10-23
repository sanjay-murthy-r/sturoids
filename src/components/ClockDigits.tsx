import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import Animated, { Easing, withTiming } from 'react-native-reanimated';
import { C, F, NUM_COLON_W, NUM_DIGIT_W } from '../theme';
import { useAnimLevel, useBuilt } from './Motion';

const ROLL = { duration: 420, easing: Easing.out(Easing.cubic) };
/** with only some motion a digit does not travel: the new one simply comes up as the old one goes */
const SWAP_IN = { duration: 220, easing: Easing.out(Easing.cubic) };
const SWAP_OUT = { duration: 160, easing: Easing.in(Easing.quad) };

/** a digit arriving from above, and the one it replaces dropping away; `travel` 0 keeps both in place */
const rollIn = (h: number, travel: number) => () => {
  'worklet';
  const ease = travel ? ROLL : SWAP_IN;
  return {
    initialValues: { opacity: 0, transform: [{ translateY: -h * travel }] },
    animations: { opacity: withTiming(1, ease), transform: [{ translateY: withTiming(0, ease) }] },
  };
};
const rollOut = (h: number, travel: number) => () => {
  'worklet';
  const ease = travel ? ROLL : SWAP_OUT;
  return {
    initialValues: { opacity: 1, transform: [{ translateY: 0 }] },
    animations: { opacity: withTiming(0, ease), transform: [{ translateY: withTiming(h * travel, ease) }] },
  };
};

/** How wide a clock string is at `size`: every digit in a cell as wide as the widest figure, every colon in its own. */
export function clockWidth(text: string, size: number) {
  let em = 0;
  for (const ch of text) em += ch === ':' ? NUM_COLON_W : NUM_DIGIT_W;
  return em * size;
}

/**
 * Counting digits in fixed cells, so a count never shifts sideways, and a digit that changes rolls over: the new one
 * arrives from above as the old one drops away. Cells are keyed from the right, so the seconds keep their place when
 * the hours arrive. The digits never scale with the system font size: the clock is sized to fit its place, and a
 * larger face would be cut by its cells. Memoised: a clock re-rendering each second leaves its minutes alone. A screen
 * reader never hears the digits ("41", then ":06"): the clock around them says the time once, in words.
 */
export const ClockDigits = React.memo(function ClockDigits({ text, size, lineHeight, color = C.text, roll = true, style }: {
  text: string;
  size: number;
  /** the height of each cell, 1.25 times the size unless given */
  lineHeight?: number;
  color?: string;
  roll?: boolean;
  style?: ViewStyle;
}) {
  const level = useAnimLevel();
  const h = lineHeight ?? Math.round(size * 1.25);
  // the digits a clock is built with are simply there; only the ones that change afterwards roll
  const built = useBuilt();
  const animate = roll && level !== 'none';
  const travel = level === 'full' ? 0.6 : 0;
  return (
    <View style={[st.row, { height: h }, style]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {text.split('').map((ch, i) => {
        const colon = ch === ':';
        return (
          <View
            key={(colon ? 'c' : 'd') + (text.length - i)}
            style={{ width: (colon ? NUM_COLON_W : NUM_DIGIT_W) * size, height: h, overflow: 'hidden' }}
          >
            <Animated.Text
              key={ch}
              allowFontScaling={false}
              entering={animate && built.current ? rollIn(h, travel) : undefined}
              exiting={animate ? rollOut(h, travel) : undefined}
              style={[st.glyph, { fontSize: size, lineHeight: h, color }]}
            >
              {ch}
            </Animated.Text>
          </View>
        );
      })}
    </View>
  );
});

const st = StyleSheet.create({
  row: { flexDirection: 'row' },
  // Inter Tight Light with its tabular figures, centred in a cell as wide as the widest figure (NUM_DIGIT_W)
  glyph: { position: 'absolute', left: 0, right: 0, textAlign: 'center', fontFamily: F.num, fontVariant: ['tabular-nums'] },
});
