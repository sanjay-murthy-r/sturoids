import React from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { StackActions } from '@react-navigation/native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { C, F, MIN, NEU, bgFor } from '../theme';
import { useTheme } from './UI';
import { RISE_OUT, SINK_IN, useAnimLevel } from './Motion';
import { useStore } from '../store';
import { normaliseSlots, toolByKey } from '../tools';
import { TAB_ROUTES } from '../toolNav';
import { tick } from '../haptics';

interface ItemMeta {
  /** full name, read by screen readers */
  label: string;
  /** what the bar shows; fits a 64dp slot at 11px */
  shortLabel: string;
  icon: string;
}

const TODAY: ItemMeta = { label: 'Today', shortLabel: 'Today', icon: 'sunny-outline' };
const MORE: ItemMeta = { label: 'More', shortLabel: 'More', icon: 'grid-outline' };

/** the carved trough the bar is made of, and the raised key that marks the current tab inside it */
const TROUGH_H = 58;
const TROUGH_R = 20;
const KEY_INSET = 4;
const KEY_H = TROUGH_H - KEY_INSET * 2;
const KEY_R = 16;

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

/** Icon over label. The same outline glyph in both states, so the row's optical weight never jumps. */
function TabItem({ meta, focused, onPress }: { meta: ItemMeta; focused: boolean; onPress: () => void }) {
  const level = useAnimLevel();
  const press = useSharedValue(0);
  const sink = useAnimatedStyle(() => ({ transform: [{ scale: 1 - 0.06 * press.value }] }));
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
      <Animated.View style={[st.itemInner, sink]}>
        <Ionicons name={meta.icon as any} size={22} color={focused ? C.accent : C.textDim} />
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={1.2}
          style={[st.label, focused && { color: C.accent, fontFamily: F.semi }]}
        >
          {meta.shortLabel}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

/**
 * The neumorphic tab bar: one carved trough holding five fixed routes (Today, three slots, More), with a raised
 * key that slides to the current one. A slot's icon and name follow whichever tool Settings put in it, so a
 * swap can never add, drop or reflow a tab.
 */
export function NeuTabBar({ state, navigation }: BottomTabBarProps) {
  const theme = useTheme();
  const level = useAnimLevel();
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  const [rowW, setRowW] = React.useState(winW);
  const rawSlots = useStore((s) => s.settings.tabSlots);
  const slots = React.useMemo(() => normaliseSlots(rawSlots), [rawSlots]);
  const keyboardOpen = useKeyboardOpen();

  const routeNames = TAB_ROUTES as readonly string[];
  const focusedName = state.routes[state.index]?.name;
  const focusedAt = Math.max(0, routeNames.indexOf(focusedName));
  const slotW = rowW / TAB_ROUTES.length;
  // the key fills its slot less a small inset on each side; only its position ever animates
  const keyW = Math.max(0, slotW - KEY_INSET * 2);
  const targetX = slotW * focusedAt + KEY_INSET;

  const px = useSharedValue(targetX);
  const placed = React.useRef(false);
  React.useEffect(() => {
    if (!placed.current || level === 'none') {
      placed.current = true;
      px.value = targetX;
      return;
    }
    px.value = withSpring(targetX, RISE_OUT);
  }, [targetX, level]);
  const pillStyle = useAnimatedStyle(() => ({ transform: [{ translateX: px.value }] }));

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
  // past its own height by the reach of the raised highlight, so no line of light is left at the edge
  const slideStyle = useAnimatedStyle(() => ({ transform: [{ translateY: hide.value * (barH.value + 16) }] }));

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
        { paddingBottom: Math.max(insets.bottom, 12), backgroundColor: bgFor(theme) },
        theme === 'minimal' ? { borderTopWidth: 1, borderTopColor: MIN.hairline } : null,
        keyboardOpen && st.lifted,
        slideStyle,
      ]}
    >
      <View
        style={[
          st.row,
          theme === 'minimal'
            ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border }
            : { backgroundColor: C.inset, ...NEU.insetLow },
        ]}
        onLayout={(e) => setRowW(e.nativeEvent.layout.width)}
      >
        <Animated.View
          pointerEvents="none"
          style={[
            st.key,
            { width: keyW },
            theme === 'minimal'
              ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: C.accent }
              : { backgroundColor: C.card, ...NEU.raisedLow },
            pillStyle,
          ]}
        />
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
      </View>
    </Animated.View>
  );
}

const st = StyleSheet.create({
  bar: { paddingTop: 10, paddingHorizontal: 14 },
  lifted: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  row: { flexDirection: 'row', height: TROUGH_H, borderRadius: TROUGH_R },
  key: { position: 'absolute', top: KEY_INSET, left: 0, height: KEY_H, borderRadius: KEY_R },
  item: { flex: 1, height: TROUGH_H, alignItems: 'center', justifyContent: 'center' },
  itemInner: { alignItems: 'center' },
  label: {
    marginTop: 4, color: C.textFaint, fontFamily: F.med, fontSize: 11, lineHeight: 13, letterSpacing: 0.2,
  },
});
