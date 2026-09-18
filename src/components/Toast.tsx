import React from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, F, MIN, NEU } from '../theme';
import { useTheme } from './UI';
import { tick } from '../haptics';

export interface ToastAction { label: string; onPress: () => void }
type Shown = { message: string; action?: ToastAction; key: number };

let show: ((message: string, action?: ToastAction) => void) | null = null;

/**
 * A short note that needs no answer, on a raised card above the tab bar for a little over two seconds. With an
 * action (such as Undo) it stays a little longer and the action sits at its end. For anything said from inside a
 * sheet use an Alert: a sheet is its own window and would cover the card.
 */
export function toast(message: string, action?: ToastAction) {
  if (show) show(message, action);
}

/** Mounted once, in the root layout. */
export function ToastHost() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [shownToast, setShownToast] = React.useState<Shown | null>(null);
  const shown = useSharedValue(0);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const counter = React.useRef(0);

  const hide = React.useCallback((duration: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    // a newer toast restarts the fade in, which cancels this fade out before it can clear the card
    shown.value = withTiming(0, { duration }, (done) => { if (done) runOnJS(setShownToast)(null); });
  }, []);

  React.useEffect(() => {
    show = (message, action) => {
      counter.current += 1;
      setShownToast({ message, action, key: counter.current });
      AccessibilityInfo.announceForAccessibility(action ? message + '. ' + action.label + ' is available.' : message);
      shown.value = withTiming(1, { duration: 180 });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => hide(220), action ? 4200 : 2200);
    };
    return () => {
      show = null;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [hide]);

  const style = useAnimatedStyle(() => ({ opacity: shown.value, transform: [{ translateY: (1 - shown.value) * 12 }] }));
  if (!shownToast) return null;
  const { message, action, key } = shownToast;

  return (
    <Animated.View pointerEvents="box-none" style={[st.wrap, { bottom: insets.bottom + 96 }, style]}>
      <View
        pointerEvents={action ? 'auto' : 'none'}
        style={[
          st.card,
          action && st.cardWithAction,
          theme === 'minimal'
            ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: MIN.border }
            : { backgroundColor: C.card, ...NEU.raisedMid },
        ]}
      >
        <Text style={[st.text, action && { textAlign: 'left', flexShrink: 1 }]} numberOfLines={action ? 2 : undefined}>{message}</Text>
        {action ? (
          <Pressable
            key={key}
            onPress={() => {
              tick();
              action.onPress();
              hide(160);
            }}
            hitSlop={10}
            accessibilityRole="button"
            style={st.action}
          >
            <Text style={st.actionText}>{action.label}</Text>
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  );
}

const st = StyleSheet.create({
  wrap: { position: 'absolute', left: 20, right: 20, alignItems: 'center' },
  card: { borderRadius: 16, paddingVertical: 12, paddingHorizontal: 18, maxWidth: 420 },
  cardWithAction: { flexDirection: 'row', alignItems: 'center', paddingRight: 8 },
  text: { color: C.text, fontFamily: F.med, fontSize: 14, lineHeight: 19, textAlign: 'center' },
  action: { marginLeft: 14, paddingHorizontal: 10, paddingVertical: 4 },
  actionText: { color: C.accent, fontFamily: F.semi, fontSize: 14, lineHeight: 19 },
});
