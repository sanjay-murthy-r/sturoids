import React from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, F, MIN, NEU } from '../theme';
import { useTheme } from './UI';

let show: ((message: string) => void) | null = null;

/**
 * A short note that needs no answer, on a raised card above the tab bar for a little over two seconds. For
 * anything said from inside a sheet use an Alert: a sheet is its own window and would cover the card.
 */
export function toast(message: string) {
  if (show) show(message);
}

/** Mounted once, in the root layout. */
export function ToastHost() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [message, setMessage] = React.useState<string | null>(null);
  const shown = useSharedValue(0);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    show = (m) => {
      setMessage(m);
      AccessibilityInfo.announceForAccessibility(m);
      shown.value = withTiming(1, { duration: 180 });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        // a newer toast restarts the fade in, which cancels this fade out before it can clear the card
        shown.value = withTiming(0, { duration: 220 }, (done) => { if (done) runOnJS(setMessage)(null); });
      }, 2200);
    };
    return () => {
      show = null;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const style = useAnimatedStyle(() => ({ opacity: shown.value, transform: [{ translateY: (1 - shown.value) * 12 }] }));
  if (!message) return null;

  return (
    <Animated.View pointerEvents="none" style={[st.wrap, { bottom: insets.bottom + 96 }, style]}>
      <View
        style={[
          st.card,
          theme === 'minimal'
            ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: MIN.border }
            : { backgroundColor: C.card, ...NEU.raisedMid },
        ]}
      >
        <Text style={st.text}>{message}</Text>
      </View>
    </Animated.View>
  );
}

const st = StyleSheet.create({
  wrap: { position: 'absolute', left: 20, right: 20, alignItems: 'center' },
  card: { borderRadius: 16, paddingVertical: 12, paddingHorizontal: 18, maxWidth: 420 },
  text: { color: C.text, fontFamily: F.med, fontSize: 14, lineHeight: 19, textAlign: 'center' },
});
