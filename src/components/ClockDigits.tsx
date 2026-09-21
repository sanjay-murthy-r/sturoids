import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import Animated, { Easing, withTiming } from 'react-native-reanimated';
import { C, F, NUM_COLON_W, NUM_DIGIT_W } from '../theme';
import { useAnimLevel } from './Motion';

const ROLL = { duration: 420, easing: Easing.out(Easing.cubic) };

/** a digit arriving from above, and the one it replaces dropping away */
const rollIn = (h: number) => () => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ translateY: -h * 0.6 }] },
    animations: { opacity: withTiming(1, ROLL), transform: [{ translateY: withTiming(0, ROLL) }] },
  };
};
const rollOut = (h: number) => () => {
  'worklet';
  return {
    initialValues: { opacity: 1, transform: [{ translateY: 0 }] },
    animations: { opacity: withTiming(0, ROLL), transform: [{ translateY: withTiming(h * 0.6, ROLL) }] },
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
 * larger face would be cut by its cells.
 */
export function ClockDigits({ text, size, lineHeight, color = C.text, roll = true, style }: {
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
  const built = React.useRef(false);
  React.useEffect(() => { built.current = true; }, []);
  const animate = roll && level !== 'none';
  return (
    <View style={[st.row, { height: h }, style]} accessible accessibilityLabel={text}>
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
              entering={animate && built.current ? rollIn(h) : undefined}
              exiting={animate ? rollOut(h) : undefined}
              style={[st.glyph, { fontSize: size, lineHeight: h, color }]}
            >
              {ch}
            </Animated.Text>
          </View>
        );
      })}
    </View>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row' },
  glyph: { position: 'absolute', left: 0, right: 0, textAlign: 'center', fontFamily: F.num },
});
