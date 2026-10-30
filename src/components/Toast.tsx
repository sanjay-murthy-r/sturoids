import React from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, F, MIN, NEU, TRACK } from '../theme';
import { useTheme } from './UI';
import { EASE_EXIT, EASE_OUT, useAnimLevel } from './Motion';
import { tick } from '../haptics';
import { useRail } from '../hooks/useRail';

export interface ToastAction { label: string; onPress: () => void }
/** More a toast can do: its words themselves can be a way somewhere (Recently deleted), said to a screen reader as `hint`. */
export interface ToastOptions { onMessage?: () => void; hint?: string }
type Shown = { message: string; action?: ToastAction; opts?: ToastOptions; key: number };

let show: ((message: string, action?: ToastAction, opts?: ToastOptions) => void) | null = null;

/**
 * A short note that needs no answer, on a raised card above the tab bar for a little over two seconds. With an
 * action (such as Undo) it stays a little longer and the action sits at its end; while a screen reader is on, about
 * ten seconds, or until it is used or another toast takes its place, so there is time to reach the action. For
 * anything said from inside a sheet use an Alert: a sheet is its own window and would cover the card.
 */
export function toast(message: string, action?: ToastAction, opts?: ToastOptions) {
  if (show) show(message, action, opts);
}

/** the card rises in on an ease out and sinks away on a short ease in */
const IN = { duration: 240, easing: EASE_OUT };
// the leaving curve every panel uses (a plain ease-in reached full speed in its last frame and read as snatched away)
const OUT_EASE = EASE_EXIT;
/** how long a toast stays: a plain note, one with an action, and one with an action while a screen reader is on */
const STAY_MS = 2200;
const STAY_ACTION_MS = 4200;
const STAY_ACTION_READER_MS = 10_000;

/** Mounted once, in the root layout. */
export function ToastHost() {
  const theme = useTheme();
  const level = useAnimLevel();
  const insets = useSafeAreaInsets();
  const rail = useRail();
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
    show = (message, action, opts) => {
      counter.current += 1;
      const next = { message, action, opts: opts?.onMessage ? opts : undefined, key: counter.current };
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
      const stay = !action && !next.opts ? STAY_MS : reader.current ? STAY_ACTION_READER_MS : STAY_ACTION_MS;
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
  const { message, action, opts, key } = shownToast;
  const onMessage = opts?.onMessage;
  const words = (
    <Text
      style={[st.text, action && { textAlign: 'left', flexShrink: 1 }, onMessage && st.textLink]}
      numberOfLines={action ? 2 : undefined}
    >
      {message}
    </Text>
  );

  return (
    // above the tab bar; a wide window with its tabs in the rail at the side has no bar below, so the card sits low
    <Animated.View pointerEvents="box-none" style={[st.wrap, { bottom: insets.bottom + (rail ? 24 : 96) }, style]}>
      <View
        pointerEvents={action || onMessage ? 'auto' : 'none'}
        style={[
          st.card,
          theme === 'minimal'
            ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: MIN.border }
            : { backgroundColor: C.card, ...NEU.raisedMid },
        ]}
      >
        <Animated.View style={[action ? st.rowWithAction : null, wordsStyle]}>
          {onMessage ? (
            // the words open where the thing went; the card goes as they are used
            <Pressable
              key={'m' + key}
              onPress={() => { tick(); hide(160); onMessage(); }}
              hitSlop={{ top: 12, bottom: 12, left: 8, right: 4 }}
              accessibilityRole="link" accessibilityHint={opts?.hint}
              style={({ pressed }) => [action ? { flexShrink: 1 } : null, pressed && st.actionPressed]}
            >
              {words}
            </Pressable>
          ) : words}
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
  // words that open something: a quiet underline, at the same weight
  textLink: { textDecorationLine: 'underline', textDecorationColor: C.textFaint },
  // the accent is applied at the call site: a StyleSheet would freeze it at import and miss a change of accent
  actionText: { fontFamily: F.semi, fontSize: 14, letterSpacing: TRACK.small, lineHeight: 19 },
});
