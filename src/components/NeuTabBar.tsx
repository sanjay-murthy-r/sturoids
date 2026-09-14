import React from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
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

const PILL_H = 54;
const PILL_R = 18;

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
 * The neumorphic tab bar: a raised plate with one carved pill sliding between five fixed routes
 * (Today, three slots, More). A slot's icon and name follow whichever tool Settings put in it, so a
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
  // one constant width, never wider than its slot: only the pill's position ever animates
  const pillW = Math.max(Math.min(slotW - 14, 84), Math.min(58, slotW - 6));
  const targetX = slotW * focusedAt + (slotW - pillW) / 2;

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

  if (keyboardOpen) return <View style={st.hidden} />;

  const metaFor = (name: string): ItemMeta => {
    if (name === 'index') return TODAY;
    if (name === 'more') return MORE;
    const tool = toolByKey(slots[routeNames.indexOf(name) - 1]);
    return tool ? { label: tool.label, shortLabel: tool.shortLabel, icon: tool.icon } : MORE;
  };

  return (
    <View
      style={[
        st.bar,
        { paddingBottom: Math.max(insets.bottom, 10), backgroundColor: bgFor(theme) },
        theme === 'minimal' ? { borderTopWidth: 1, borderTopColor: MIN.hairline } : NEU.raisedMid,
      ]}
    >
      <View style={st.row} onLayout={(e) => setRowW(e.nativeEvent.layout.width)}>
        <Animated.View
          pointerEvents="none"
          style={[
            st.pill,
            { width: pillW },
            theme === 'minimal'
              ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: C.accent }
              : { backgroundColor: C.inset, ...NEU.insetLow },
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
    </View>
  );
}

const st = StyleSheet.create({
  bar: { paddingTop: 10 },
  hidden: { height: 0 },
  row: { flexDirection: 'row' },
  pill: { position: 'absolute', top: 0, left: 0, height: PILL_H, borderRadius: PILL_R },
  item: { flex: 1, height: PILL_H, alignItems: 'center', justifyContent: 'center' },
  itemInner: { alignItems: 'center' },
  label: {
    marginTop: 4, color: C.textFaint, fontFamily: F.med, fontSize: 11, lineHeight: 13, letterSpacing: 0.2,
  },
});
