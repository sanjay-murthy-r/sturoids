import React from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { StackActions } from '@react-navigation/native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { C, CHROME_FONT_MAX, F, MIN, TRACK, bgFor } from '../theme';
import { useTheme } from './UI';
import { EASE_EXIT, EASE_OUT, FADE_IN, FADE_OUT, RISE_OUT, SINK_IN, TAB_FADE, TAB_SHIFT, useAnimLevel } from './Motion';
import { useStore } from '../store';
import { normaliseSlots, toolByKey } from '../tools';
import { TAB_ROUTES } from '../toolNav';
import { useIntro } from '../intro';
import { tick } from '../haptics';
import { useKeyboardOpen } from '../hooks/useKeyboard';
import { RAIL_W } from '../layout';
import { openSift } from '../search/store';
import { useBackupAttention } from '../cloud';
import { Lift } from './Cheer';

/** a second tap on the tab you are on within this many ms opens Sift (the first still does what it always did) */
const DOUBLE_TAP_MS = 280;

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
/**
 * every tab keeps room for a name and a dot under its icon, so no icon moves when the current tab changes. The name's
 * line is 14 at the phone's normal font size; it grows with a larger one up to the chrome's cap, and its room with it
 */
const LABEL_H = 14;
const DOT = 4;
const BAR_PAD_TOP = 10;
const BAR_PAD_X = 8;
const ITEM_PAD = 2;
const GAP = 3;
/** where the dot's row sits: under the icon and the name of every tab */
const dotTop = (labelH: number) => BAR_PAD_TOP + ITEM_PAD + ICON + GAP + labelH + GAP;

// the rail: the same tabs standing in a column on the left of a wide window
const RAIL_PAD_TOP = 18;
const RAIL_ITEM_H = 64;
const RAIL_GAP = 8;
const RAIL_PITCH = RAIL_ITEM_H + RAIL_GAP;
/** a rail tab centres its icon, name and dot room in its height; the dot's room starts this far down */
const railDotInItem = (labelH: number) => (RAIL_ITEM_H - (ICON + GAP + labelH + GAP + DOT)) / 2 + ICON + GAP + labelH + GAP;

/**
 * One tab of the rail: an outline icon that takes the accent when it is the current tab, with the tab's name arriving
 * beneath it. The two icon colours crossfade, so nothing snaps. The dot under the name belongs to the bar, which
 * glides it from tab to tab; each tab keeps the dot's room so nothing moves.
 */
function TabItem({ meta, focused, onPress, vertical, labelH, badge = false }: {
  meta: ItemMeta; focused: boolean; onPress: () => void; vertical: boolean;
  /** the name's room at the phone's font size (see LABEL_H) */
  labelH: number;
  /** a small amber dot on the icon: something behind this tab needs a look (the backup, on More) */
  badge?: boolean;
}) {
  const level = useAnimLevel();
  const press = useSharedValue(0);
  const on = useSharedValue(focused ? 1 : 0);
  // the colour and the name change on the scene's own timing, so the tab you open lights up as its scene arrives
  React.useEffect(() => {
    on.value = level === 'none' ? (focused ? 1 : 0) : withTiming(focused ? 1 : 0, level === 'full' ? TAB_SHIFT : TAB_FADE);
  }, [focused, level]);
  const rises = level === 'full';
  const sink = useAnimatedStyle(() => ({ transform: [{ scale: 1 - 0.08 * press.value }] }));
  const lit = useAnimatedStyle(() => ({ opacity: on.value }));
  const unlit = useAnimatedStyle(() => ({ opacity: 1 - on.value }));
  const nameStyle = useAnimatedStyle(() => ({
    opacity: on.value,
    transform: [{ translateY: rises ? 3 * (1 - on.value) : 0 }],
  }));
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => { if (level !== 'none') press.value = withTiming(1, SINK_IN); }}
      onPressOut={() => { if (level !== 'none') press.value = withSpring(0, RISE_OUT); }}
      style={vertical ? st.railItem : st.item}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={badge ? meta.label + ', backup needs attention' : meta.label}
    >
      <Animated.View style={[st.icon, sink]}>
        <Animated.View style={[st.glyph, unlit]}>
          <Ionicons name={meta.icon as any} size={ICON} color={C.textFaint} />
        </Animated.View>
        <Animated.View style={[st.glyph, lit]}>
          {/* Cheerful: the tab chosen gives a small lift as it lights */}
          <Lift value={focused ? 1 : 0} when={focused}>
            <Ionicons name={meta.icon as any} size={ICON} color={C.accent} />
          </Lift>
        </Animated.View>
        {badge ? <View style={[st.badge, { backgroundColor: C.amber }]} /> : null}
      </Animated.View>
      <Animated.Text
        numberOfLines={1} maxFontSizeMultiplier={CHROME_FONT_MAX} style={[st.label, { height: labelH, color: C.accent }, nameStyle]}
      >
        {meta.shortLabel}
      </Animated.Text>
      <View style={st.dotRoom} />
    </Pressable>
  );
}

/**
 * The quiet rail: five fixed routes (Today, three slots, More) as outline icons on the material, under one hairline.
 * Only the current tab takes the accent, with its name and a small dot beneath: no pill, no well, no shadow. A slot's
 * icon and name follow whichever tool Settings put in it, so a swap can never add, drop or reflow a tab. On a wide
 * window (the navigator puts the bar on the left) the same tabs stand in a column, with a hairline on their right.
 */
export function NeuTabBar({ state, navigation, descriptors }: BottomTabBarProps) {
  const theme = useTheme();
  const level = useAnimLevel();
  const insets = useSafeAreaInsets();
  // the names grow with the phone's font size up to the chrome's cap; their line height grows the same way, so their
  // room does too, and the dot's row moves down with it
  const { fontScale } = useWindowDimensions();
  const labelH = Math.ceil(LABEL_H * Math.min(CHROME_FONT_MAX, Math.max(1, fontScale)));
  const rawSlots = useStore((s) => s.settings.tabSlots);
  const slots = React.useMemo(() => normaliseSlots(rawSlots), [rawSlots]);
  const vertical = descriptors[state.routes[state.index]?.key]?.options.tabBarPosition === 'left';
  // the bar steps aside while the keyboard is up, so a text field never sits under a row of tabs; the rail, beside
  // the screen rather than under it, stays
  const keyboardOpen = useKeyboardOpen();
  const stepAside = keyboardOpen && !vertical;

  const routeNames = TAB_ROUTES as readonly string[];
  const focusedName = state.routes[state.index]?.name;
  // the backup paused or lost puts a dot on More (its Settings row says what to do)
  const backupDot = useBackupAttention() !== 'ok';
  // the last tap on the tab already open, for the double tap that opens Sift
  const lastTap = React.useRef<{ name: string; at: number } | null>(null);

  // While the keyboard is up the bar leaves the layout at once, so the screen takes the room, and slides below
  // the edge. When the keyboard closes the bar takes its room back and slides up into it. It stays mounted
  // throughout, so a keyboard toggle never rebuilds the tabs. With only some motion it fades out and in instead.
  const travels = level === 'full';
  const barH = useSharedValue(0);
  const hide = useSharedValue(0);
  React.useEffect(() => {
    const to = stepAside ? 1 : 0;
    hide.value = level === 'none'
      ? to
      : withTiming(to, travels
        ? { duration: stepAside ? 180 : 240, easing: stepAside ? EASE_EXIT : EASE_OUT }
        : (stepAside ? FADE_OUT : FADE_IN));
  }, [stepAside, level]);
  // the bar arrives last, once the intro has left and the day has begun to rise into its place
  const introOver = useIntro((s) => s.phase !== 'playing');
  const arrive = useSharedValue(introOver || level === 'none' ? 1 : 0);
  React.useEffect(() => {
    if (!introOver) return;
    arrive.value = level === 'none'
      ? 1
      : travels
        ? withDelay(320, withTiming(1, { duration: 520, easing: EASE_OUT }))
        : withDelay(160, withTiming(1, FADE_IN));
  }, [introOver, level]);
  const slideStyle = useAnimatedStyle(() => (vertical
    ? { opacity: arrive.value, transform: [{ translateX: travels ? -18 * (1 - arrive.value) : 0 }] }
    : {
      opacity: arrive.value * (travels ? 1 : 1 - hide.value),
      transform: [{ translateY: travels ? hide.value * (barH.value + 2) + 18 * (1 - arrive.value) : 0 }],
    }), [vertical, travels]);

  // the one dot, under the current tab's name: it glides from tab to tab, on the scene's own shift, instead of
  // appearing at the new one. On the first paint it is already in place. With only some motion it does not travel: it
  // fades out where it was and back in at the new tab. With animations off it simply moves.
  const focusIndex = routeNames.indexOf(focusedName as string);
  const [slotW, setSlotW] = React.useState(0);
  const dotAt = useSharedValue(Math.max(0, focusIndex));
  const dotFade = useSharedValue(1);
  const lastIndex = React.useRef(focusIndex);
  React.useEffect(() => {
    if (focusIndex < 0) return;
    const moved = lastIndex.current !== focusIndex;
    lastIndex.current = focusIndex;
    if (level === 'none' || (!vertical && slotW === 0)) {
      dotAt.value = focusIndex;
    } else if (level === 'some') {
      if (!moved) return;
      dotFade.value = withSequence(withTiming(0, { duration: 80, easing: EASE_EXIT }), withTiming(1, { duration: 120, easing: EASE_OUT }));
      dotAt.value = withDelay(80, withTiming(focusIndex, { duration: 1 }));
    } else {
      dotAt.value = withTiming(focusIndex, TAB_SHIFT);
    }
  }, [focusIndex, level]);
  const dotStyle = useAnimatedStyle(() => (vertical
    ? { opacity: dotFade.value, transform: [{ translateY: dotAt.value * RAIL_PITCH }] }
    : { opacity: dotFade.value, transform: [{ translateX: dotAt.value * slotW }] }), [slotW, vertical]);

  const metaFor = (name: string): ItemMeta => {
    if (name === 'index') return TODAY;
    if (name === 'more') return MORE;
    const tool = toolByKey(slots[routeNames.indexOf(name) - 1]);
    return tool ? { label: tool.label, shortLabel: tool.shortLabel, icon: tool.icon } : MORE;
  };

  const hairline = theme === 'minimal' ? MIN.hairline : C.hairline;
  return (
    <Animated.View
      pointerEvents={stepAside ? 'none' : 'auto'}
      accessibilityRole="tablist"
      onLayout={vertical ? undefined : (e) => {
        barH.value = e.nativeEvent.layout.height;
        setSlotW((e.nativeEvent.layout.width - BAR_PAD_X * 2) / routeNames.length);
      }}
      style={vertical ? [
        st.rail,
        { paddingTop: insets.top + RAIL_PAD_TOP, backgroundColor: bgFor(theme), borderRightColor: hairline },
        slideStyle,
      ] : [
        st.bar,
        {
          paddingBottom: Math.max(insets.bottom, 10) + 2,
          backgroundColor: bgFor(theme),
          borderTopColor: hairline,
        },
        stepAside && st.lifted,
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
            lastTap.current = null;
            tick();
            navigation.navigate(route.name as never);
            return;
          }
          // a second tap on the tab you are on opens Sift (the quiet way in, beside the header pull)
          const now = Date.now();
          const prev = lastTap.current;
          if (prev && prev.name === name && now - prev.at <= DOUBLE_TAP_MS) {
            lastTap.current = null;
            tick();
            openSift('tab');
            return;
          }
          lastTap.current = { name, at: now };
          // already here: a slot with pages open (a note, a video) goes back to its tool
          const nested: any = route.state;
          if (nested?.key && (nested.index ?? 0) > 0) {
            tick();
            navigation.dispatch({ ...StackActions.popToTop(), target: nested.key });
          }
        };
        return (
          <TabItem
            key={name} meta={metaFor(name)} focused={focused} onPress={onPress} vertical={vertical} labelH={labelH}
            badge={name === 'more' && backupDot}
          />
        );
      })}
      {vertical && focusIndex >= 0 ? (
        <Animated.View pointerEvents="none" style={[st.railDot, { top: insets.top + RAIL_PAD_TOP + railDotInItem(labelH) }, dotStyle]}>
          <View style={[st.dot, { backgroundColor: C.accent }]} />
        </Animated.View>
      ) : null}
      {!vertical && slotW > 0 && focusIndex >= 0 ? (
        <Animated.View pointerEvents="none" style={[st.dotTrack, { top: dotTop(labelH), width: slotW }, dotStyle]}>
          <View style={[st.dot, { backgroundColor: C.accent }]} />
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

const st = StyleSheet.create({
  bar: { flexDirection: 'row', paddingTop: BAR_PAD_TOP, paddingHorizontal: BAR_PAD_X, borderTopWidth: 1 },
  lifted: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  item: { flex: 1, alignItems: 'center', paddingVertical: ITEM_PAD },
  icon: { width: ICON, height: ICON },
  glyph: { position: 'absolute', top: 0, left: 0 },
  // the height is set where it is drawn, from the font size (see LABEL_H); the line height here grows with it
  label: {
    lineHeight: LABEL_H, marginTop: GAP, textAlign: 'center', includeFontPadding: false, textAlignVertical: 'center',
    fontFamily: F.smSemi, fontSize: 11, letterSpacing: TRACK.fine,
  },
  dotRoom: { width: DOT, height: DOT, marginTop: GAP },
  dotTrack: { position: 'absolute', left: BAR_PAD_X, height: DOT, alignItems: 'center' },
  rail: { width: RAIL_W, paddingBottom: 12, borderRightWidth: 1 },
  railItem: { height: RAIL_ITEM_H, marginBottom: RAIL_GAP, alignItems: 'center', justifyContent: 'center' },
  railDot: { position: 'absolute', left: 0, width: RAIL_W, height: DOT, alignItems: 'center' },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
  badge: { position: 'absolute', top: -1, right: -3, width: 7, height: 7, borderRadius: 3.5 },
});
