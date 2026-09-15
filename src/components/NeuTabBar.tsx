import React from 'react';
import { Keyboard, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { StackActions } from '@react-navigation/native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { C, F, MIN, bgFor } from '../theme';
import { useTheme } from './UI';
import { RISE_OUT, SINK_IN, useAnimLevel } from './Motion';
import { useStore } from '../store';
import { normaliseSlots, toolByKey } from '../tools';
import { TAB_ROUTES } from '../toolNav';
import { tick } from '../haptics';

interface ItemMeta {
  /** full name, read by screen readers */
  label: string;
  /** the name shown under the current tab; fits a 64dp slot at 11px */
  shortLabel: string;
  icon: string;
}

const TODAY: ItemMeta = { label: 'Today', shortLabel: 'Today', icon: 'home-outline' };
const MORE: ItemMeta = { label: 'More', shortLabel: 'More', icon: 'grid-outline' };

const ICON = 24;
/** every tab keeps room for a name and a dot under its icon, so no icon moves when the current tab changes */
const LABEL_H = 14;
const DOT = 4;
const SWITCH = { duration: 200, easing: Easing.out(Easing.cubic) };

/** The bar steps aside while the keyboard is up, so a text field never sits under a row of tabs. */
function useKeyboardOpen() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => setOpen(true));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setOpen(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  return open;
}

/**
 * One tab of the rail: an outline icon that takes the accent when it is the current tab, with the tab's name and a
 * small accent dot arriving beneath it. The two icon colours crossfade, so nothing snaps.
 */
function TabItem({ meta, focused, onPress }: { meta: ItemMeta; focused: boolean; onPress: () => void }) {
  const level = useAnimLevel();
  const press = useSharedValue(0);
  const on = useSharedValue(focused ? 1 : 0);
  React.useEffect(() => {
    on.value = level === 'none' ? (focused ? 1 : 0) : withTiming(focused ? 1 : 0, SWITCH);
  }, [focused, level]);
  const sink = useAnimatedStyle(() => ({ transform: [{ scale: 1 - 0.08 * press.value }] }));
  const lit = useAnimatedStyle(() => ({ opacity: on.value }));
  const unlit = useAnimatedStyle(() => ({ opacity: 1 - on.value }));
  const nameStyle = useAnimatedStyle(() => ({
    opacity: on.value,
    transform: [{ translateY: 3 * (1 - on.value) }],
  }));
  const dotStyle = useAnimatedStyle(() => ({
    opacity: on.value,
    transform: [{ scale: 0.4 + 0.6 * on.value }],
  }));
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => { if (level !== 'none') press.value = withTiming(1, SINK_IN); }}
      onPressOut={() => { if (level !== 'none') press.value = withSpring(0, RISE_OUT); }}
      style={st.item}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={meta.label}
    >
      <Animated.View style={[st.icon, sink]}>
        <Animated.View style={[st.glyph, unlit]}>
          <Ionicons name={meta.icon as any} size={ICON} color={C.textFaint} />
        </Animated.View>
        <Animated.View style={[st.glyph, lit]}>
          <Ionicons name={meta.icon as any} size={ICON} color={C.accent} />
        </Animated.View>
      </Animated.View>
      <Animated.Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={[st.label, { color: C.accent }, nameStyle]}>
        {meta.shortLabel}
      </Animated.Text>
      <Animated.View style={[st.dot, { backgroundColor: C.accent }, dotStyle]} />
    </Pressable>
  );
}

/**
 * The quiet rail: five fixed routes (Today, three slots, More) as outline icons on the material, under one hairline.
 * Only the current tab takes the accent, with its name and a small dot beneath: no pill, no well, no shadow. A slot's
 * icon and name follow whichever tool Settings put in it, so a swap can never add, drop or reflow a tab.
 */
export function NeuTabBar({ state, navigation }: BottomTabBarProps) {
  const theme = useTheme();
  const level = useAnimLevel();
  const insets = useSafeAreaInsets();
  const rawSlots = useStore((s) => s.settings.tabSlots);
  const slots = React.useMemo(() => normaliseSlots(rawSlots), [rawSlots]);
  const keyboardOpen = useKeyboardOpen();

  const routeNames = TAB_ROUTES as readonly string[];
  const focusedName = state.routes[state.index]?.name;

  // While the keyboard is up the bar leaves the layout at once, so the screen takes the room, and slides below
  // the edge. When the keyboard closes the bar takes its room back and slides up into it. It stays mounted
  // throughout, so a keyboard toggle never rebuilds the tabs.
  const barH = useSharedValue(0);
  const hide = useSharedValue(0);
  React.useEffect(() => {
    const to = keyboardOpen ? 1 : 0;
    hide.value = level === 'none'
      ? to
      : withTiming(to, keyboardOpen
        ? { duration: 180, easing: Easing.in(Easing.quad) }
        : { duration: 240, easing: Easing.out(Easing.cubic) });
  }, [keyboardOpen, level]);
  const slideStyle = useAnimatedStyle(() => ({ transform: [{ translateY: hide.value * (barH.value + 2) }] }));

  const metaFor = (name: string): ItemMeta => {
    if (name === 'index') return TODAY;
    if (name === 'more') return MORE;
    const tool = toolByKey(slots[routeNames.indexOf(name) - 1]);
    return tool ? { label: tool.label, shortLabel: tool.shortLabel, icon: tool.icon } : MORE;
  };

  return (
    <Animated.View
      pointerEvents={keyboardOpen ? 'none' : 'auto'}
      onLayout={(e) => { barH.value = e.nativeEvent.layout.height; }}
      style={[
        st.bar,
        {
          paddingBottom: Math.max(insets.bottom, 10) + 2,
          backgroundColor: bgFor(theme),
          borderTopColor: theme === 'minimal' ? MIN.hairline : C.hairline,
        },
        keyboardOpen && st.lifted,
        slideStyle,
      ]}
    >
      {TAB_ROUTES.map((name) => {
        const route = state.routes.find((r) => r.name === name);
        if (!route) return null;
        const focused = focusedName === name;
        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (event.defaultPrevented) return;
          if (!focused) {
            tick();
            navigation.navigate(route.name as never);
            return;
          }
          // already here: a slot with pages open (a note, a video) goes back to its tool
          const nested: any = route.state;
          if (nested?.key && (nested.index ?? 0) > 0) {
            tick();
            navigation.dispatch({ ...StackActions.popToTop(), target: nested.key });
          }
        };
        return <TabItem key={name} meta={metaFor(name)} focused={focused} onPress={onPress} />;
      })}
    </Animated.View>
  );
}

const st = StyleSheet.create({
  bar: { flexDirection: 'row', paddingTop: 10, paddingHorizontal: 8, borderTopWidth: 1 },
  lifted: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  item: { flex: 1, alignItems: 'center', paddingVertical: 2 },
  icon: { width: ICON, height: ICON },
  glyph: { position: 'absolute', top: 0, left: 0 },
  label: {
    height: LABEL_H, lineHeight: LABEL_H, marginTop: 3, textAlign: 'center',
    fontFamily: F.semi, fontSize: 11, letterSpacing: 0.2,
  },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2, marginTop: 3 },
});
