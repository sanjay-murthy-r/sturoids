import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { C, F, MIN, SH, bgFor, neuInset } from '../theme';
import { useTheme } from './UI';
import { RISE_OUT, useAnimLevel } from './Motion';
import { useStore } from '../store';
import { tick } from '../haptics';

export const DEFAULT_TAB_SLOTS = ['tasks', 'focus', 'planner'];

/** Everything a middle tab slot can hold. No `route` = a native tab screen. */
export const TAB_SLOT_OPTIONS: { key: string; label: string; icon: any; iconOn: any; route?: string }[] = [
  { key: 'tasks', label: 'Tasks', icon: 'checkbox-outline', iconOn: 'checkbox' },
  { key: 'focus', label: 'Deep Work', icon: 'timer-outline', iconOn: 'timer' },
  { key: 'planner', label: 'Planner', icon: 'calendar-outline', iconOn: 'calendar' },
  { key: 'notes', label: 'Notes', icon: 'document-text-outline', iconOn: 'document-text', route: '/notes' },
  { key: 'calculator', label: 'Calc', icon: 'calculator-outline', iconOn: 'calculator', route: '/calculator' },
  { key: 'desmos', label: 'Desmos', icon: 'analytics-outline', iconOn: 'analytics', route: '/desmos' },
  { key: 'vault', label: 'Vault', icon: 'play-circle-outline', iconOn: 'play-circle', route: '/vault' },
  { key: 'ai', label: 'AI', icon: 'sparkles-outline', iconOn: 'sparkles', route: '/ai-links' },
];

const FIXED: Record<string, { label: string; icon: any; iconOn: any }> = {
  index: { label: 'Today', icon: 'sunny-outline', iconOn: 'sunny' },
  more: { label: 'More', icon: 'grid-outline', iconOn: 'grid' },
};

const PILL_H = 46;

/** Tab content: icon over label, lifting slightly while focused. */
function TabItem({ focused, icon, label, onPress, onLayoutSlot }: {
  focused: boolean; icon: { on: any; off: any }; label: string; onPress: () => void;
  onLayoutSlot: (x: number, width: number) => void;
}) {
  const level = useAnimLevel();
  const f = useSharedValue(focused ? 1 : 0);
  React.useEffect(() => {
    f.value = level === 'none' ? (focused ? 1 : 0) : withSpring(focused ? 1 : 0, RISE_OUT);
  }, [focused, level]);
  const lift = useAnimatedStyle(() => ({ transform: [{ translateY: f.value * -3 }] }));
  return (
    <Pressable
      onPress={onPress}
      onLayout={(e) => onLayoutSlot(e.nativeEvent.layout.x, e.nativeEvent.layout.width)}
      style={{ flex: 1, alignItems: 'center', height: PILL_H, justifyContent: 'center' }}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={label}
    >
      <Animated.View style={[{ alignItems: 'center' }, lift]}>
        <Ionicons name={focused ? icon.on : icon.off} size={20} color={focused ? C.accent : C.textFaint} />
        <Text
          numberOfLines={1}
          style={{
            marginTop: 2, fontFamily: F.med, fontSize: 10, letterSpacing: 0.1,
            color: focused ? C.accent : C.textFaint,
          }}
        >
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

/**
 * Custom neumorphic tab bar: ONE carved valley pill slides (springs) between
 * tabs, wrapping the active icon + label. Middle slots are customizable
 * (Settings → Tab bar); non-tab tools act as launcher shortcuts.
 */
export function NeuTabBar({ state, navigation }: BottomTabBarProps) {
  const theme = useTheme();
  const level = useAnimLevel();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const slots = useStore((s) => s.settings.tabSlots) || DEFAULT_TAB_SLOTS;
  const focusedKey = state.routes[state.index]?.name;
  // Set-dedupe defends against a corrupt persisted tabSlots (duplicate React
  // keys would collide and the pill could measure the wrong instance)
  const base = ['index', ...[...new Set(slots)], 'more'];
  // a native tab screen can be reached while holding no slot — Today's
  // "All tasks →" pushes /tasks even when Tasks was swapped out. With no item
  // for it nothing is focused, so the pill and every focused style go dead;
  // lend it a slot just before More until the user leaves it again.
  const stray = !!focusedKey && !base.includes(focusedKey)
    && TAB_SLOT_OPTIONS.some((o) => o.key === focusedKey && !o.route);
  const order = stray ? [...base.slice(0, -1), focusedKey, 'more'] : base;
  const layouts = React.useRef<Record<string, { x: number; width: number }>>({}).current;
  const px = useSharedValue(0);
  const pw = useSharedValue(0);
  const po = useSharedValue(0);

  const place = React.useCallback(() => {
    const l = focusedKey ? layouts[focusedKey] : undefined;
    const visible = !!l && order.includes(focusedKey);
    if (!l || !visible) { po.value = level === 'none' ? 0 : withSpring(0, RISE_OUT); return; }
    const w = Math.max(56, l.width - 10);
    const x = l.x + (l.width - w) / 2;
    if (pw.value === 0 || level === 'none') { px.value = x; pw.value = w; po.value = 1; }
    else {
      px.value = withSpring(x, RISE_OUT);
      pw.value = withSpring(w, RISE_OUT);
      po.value = withSpring(1, RISE_OUT);
    }
  }, [focusedKey, level, order.join(',')]);
  React.useEffect(() => { place(); }, [place]);

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: px.value }],
    width: pw.value,
    opacity: po.value,
  }));

  return (
    <View
      style={{
        backgroundColor: bgFor(theme),
        paddingTop: 9, paddingBottom: Math.max(insets.bottom, 6) + 5,
        ...(theme === 'minimal'
          ? { borderTopWidth: 1, borderTopColor: MIN.border }
          : { boxShadow: SH.barLift }),
      }}
    >
      <View style={{ flexDirection: 'row' }}>
        <Animated.View
          pointerEvents="none"
          style={[
            { position: 'absolute', top: 0, height: PILL_H, borderRadius: 17 },
            theme === 'minimal'
              ? { backgroundColor: MIN.inset }
              : { backgroundColor: C.inset, ...neuInset('low') },
            pillStyle,
          ]}
        />
        {order.map((key) => {
          const opt = FIXED[key] || TAB_SLOT_OPTIONS.find((o) => o.key === key);
          if (!opt) return null;
          const routeIndex = state.routes.findIndex((r) => r.name === key);
          const isNative = routeIndex >= 0 && !(opt as any).route;
          const focused = isNative && state.index === routeIndex;
          const onPress = () => {
            if (isNative) {
              const route = state.routes[routeIndex];
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) {
                tick();
                navigation.navigate(route.name as never);
              }
            } else if ((opt as any).route) {
              tick();
              router.push((opt as any).route);
            }
          };
          return (
            <TabItem
              key={key}
              focused={focused}
              icon={{ on: (opt as any).iconOn, off: (opt as any).icon }}
              label={opt.label}
              onPress={onPress}
              onLayoutSlot={(x, width) => { layouts[key] = { x, width }; if (key === focusedKey) place(); }}
            />
          );
        })}
      </View>
    </View>
  );
}
