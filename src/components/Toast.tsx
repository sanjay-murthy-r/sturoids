import React from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, F, MIN, NEU, TRACK } from '../theme';
import { useTheme } from './UI';
import { EASE_OUT, useAnimLevel } from './Motion';
import { tick } from '../haptics';
import { WIDE_AT } from '../layout';

export interface ToastAction { label: string; onPress: () => void }
type Shown = { message: string; action?: ToastAction; key: number };

let show: ((message: string, action?: ToastAction) => void) | null = null;

/**
 * A short note that needs no answer, on a raised card above the tab bar for a little over two seconds. With an
 * action (such as Undo) it stays a little longer and the action sits at its end; while a screen reader is on, about
 * ten seconds, or until it is used or another toast takes its place, so there is time to reach the action. For
 * anything said from inside a sheet use an Alert: a sheet is its own window and would cover the card.
 */
export function toast(message: string, action?: ToastAction) {
  if (show) show(message, action);
}

/** the card rises in on an ease out and sinks away on a short ease in */
const IN = { duration: 240, easing: EASE_OUT };
const OUT_EASE = Easing.in(Easing.quad);
/** how long a toast stays: a plain note, one with an action, and one with an action while a screen reader is on */
const STAY_MS = 2200;
const STAY_ACTION_MS = 4200;
const STAY_ACTION_READER_MS = 10_000;

/** Mounted once, in the root layout. */
export function ToastHost() {
  const theme = useTheme();
  const level = useAnimLevel();
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  const [shownToast, setShownToast] = React.useState<Shown | null>(null);
  const shown = useSharedValue(0);
  // a toast that takes the place of one still showing: its words come up in the same card
  const swap = useSharedValue(1);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const counter = React.useRef(0);
  // what is on screen, and the motion level, read from `show`, which is set up once
  const current = React.useRef<Shown | null>(null);
  const still = React.useRef(level === 'none');
  still.current = level === 'none';
  // whether a screen reader is on, read once and kept current: it decides how long an action stays in reach
  const reader = React.useRef(false);
  React.useEffect(() => {
    let live = true;
    AccessibilityInfo.isScreenReaderEnabled().then((on) => { if (live) reader.current = on; }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', (on) => { reader.current = on; });
    return () => { live = false; sub.remove(); };
  }, []);

  const clear = React.useCallback(() => {
    current.current = null;
    setShownToast(null);
  }, []);

  const hide = React.useCallback((duration: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (still.current) {
      shown.value = 0;
      clear();
      return;
    }
    // a newer toast restarts the fade in, which cancels this fade out before it can clear the card
    shown.value = withTiming(0, { duration, easing: OUT_EASE }, (done) => { if (done) runOnJS(clear)(); });
  }, [clear]);

  React.useEffect(() => {
    show = (message, action) => {
      counter.current += 1;
      const next = { message, action, key: counter.current };
      const replacing = current.current != null;
      current.current = next;
      setShownToast(next);
      AccessibilityInfo.announceForAccessibility(action ? message + '. ' + action.label + ' is available.' : message);
      if (still.current) {
        shown.value = 1;
        swap.value = 1;
      } else {
        if (replacing) {
          swap.value = 0;
          swap.value = withTiming(1, { duration: 200, easing: EASE_OUT });
        }
        shown.value = withTiming(1, IN);
      }
      if (timer.current) clearTimeout(timer.current);
      const stay = !action ? STAY_MS : reader.current ? STAY_ACTION_READER_MS : STAY_ACTION_MS;
      timer.current = setTimeout(() => hide(200), stay);
    };
    return () => {
      show = null;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [hide]);

  const style = useAnimatedStyle(() => ({ opacity: shown.value, transform: [{ translateY: (1 - shown.value) * 10 }] }));
  const wordsStyle = useAnimatedStyle(() => ({ opacity: swap.value, transform: [{ translateY: (1 - swap.value) * 4 }] }));
  if (!shownToast) return null;
  const { message, action, key } = shownToast;

  return (
    // above the tab bar on a phone; a wide window keeps its tabs in a rail at the side, so the card sits low
    <Animated.View pointerEvents="box-none" style={[st.wrap, { bottom: insets.bottom + (winW >= WIDE_AT ? 24 : 96) }, style]}>
      <View
        pointerEvents={action ? 'auto' : 'none'}
        style={[
          st.card,
          theme === 'minimal'
            ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: MIN.border }
            : { backgroundColor: C.card, ...NEU.raisedMid },
        ]}
      >
        <Animated.View style={[action ? st.rowWithAction : null, wordsStyle]}>
          <Text style={[st.text, action && { textAlign: 'left', flexShrink: 1 }]} numberOfLines={action ? 2 : undefined}>{message}</Text>
          {action ? (
            <Pressable
              key={key}
              onPress={() => {
                tick();
                const said = counter.current;
                action.onPress();
                // an action that answers with a toast of its own ("Restore the video first.") leaves that one up for its
                // full time; otherwise the card goes once its action is used
                if (counter.current === said) hide(160);
              }}
              hitSlop={10}
              accessibilityRole="button"
              style={({ pressed }) => [st.action, pressed && st.actionPressed]}
            >
              <Text style={[st.actionText, { color: C.accent }]}>{action.label}</Text>
            </Pressable>
          ) : null}
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const st = StyleSheet.create({
  wrap: { position: 'absolute', left: 20, right: 20, alignItems: 'center' },
  card: { borderRadius: 16, paddingVertical: 12, paddingHorizontal: 18, maxWidth: 420 },
  rowWithAction: { flexDirection: 'row', alignItems: 'center', marginRight: -10 },
  text: { color: C.text, fontFamily: F.med, fontSize: 14, letterSpacing: TRACK.small, lineHeight: 19, textAlign: 'center' },
  action: { marginLeft: 14, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  actionPressed: { opacity: 0.55 },
  // the accent is applied at the call site: a StyleSheet would freeze it at import and miss a change of accent
  actionText: { fontFamily: F.semi, fontSize: 14, letterSpacing: TRACK.small, lineHeight: 19 },
});
