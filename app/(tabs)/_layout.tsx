import React from 'react';
import { Easing, useWindowDimensions } from 'react-native';
import { Tabs } from 'expo-router';
import type { BottomTabNavigationOptions } from '@react-navigation/bottom-tabs';
import { WIDE_AT } from '../../src/layout';
import { bgFor } from '../../src/theme';
import { useStore } from '../../src/store';
import { NeuTabBar } from '../../src/components/NeuTabBar';
import { TAB_FADE, TAB_SHIFT, useAnimLevel } from '../../src/components/Motion';
import { useRegisterNavigation } from '../../src/toolNav';

/**
 * A tab slides a short way in from its side of the bar. The tab you leave is gone within the first stretch of the
 * move while the one you open eases up behind it, so the two never sit over each other half faded (the stock shift
 * fades both evenly, and its midpoint showed two screens at once). The tab you open is hidden when the move begins, so
 * a screen that readies itself for its entrance at that moment (useEntrance) is never seen doing it. The length is the
 * bar's own token (TAB_SHIFT), so the bar's colour, name and dot change in step with the scene. This runs on React
 * Native's Animated, whose easing is its own, hence the cubic written out here.
 */
const SHIFT: Pick<BottomTabNavigationOptions, 'transitionSpec' | 'sceneStyleInterpolator'> = {
  transitionSpec: { animation: 'timing', config: { duration: TAB_SHIFT.duration, easing: Easing.out(Easing.cubic) } },
  sceneStyleInterpolator: ({ current }) => ({
    sceneStyle: {
      opacity: current.progress.interpolate({ inputRange: [-1, -0.6, 0, 0.6, 1], outputRange: [0, 0, 1, 0, 0] }),
      transform: [{ translateX: current.progress.interpolate({ inputRange: [-1, 0, 1], outputRange: [-28, 0, 28] }) }],
    },
  }),
};

/** With only some motion a tab is not slid but faded to: the same hand-over, in place and a little quicker. */
const FADE: Pick<BottomTabNavigationOptions, 'transitionSpec' | 'sceneStyleInterpolator'> = {
  transitionSpec: { animation: 'timing', config: { duration: TAB_FADE.duration, easing: Easing.out(Easing.cubic) } },
  sceneStyleInterpolator: ({ current }) => ({
    sceneStyle: {
      opacity: current.progress.interpolate({ inputRange: [-1, -0.6, 0, 0.6, 1], outputRange: [0, 0, 1, 0, 0] }),
    },
  }),
};

/**
 * The bar's five routes never change: Today, three slots, More. Each slot is a Stack whose root shows
 * whichever tool Settings put there, so a swap can never add, drop or rename a tab.
 */
export default function TabLayout() {
  useRegisterNavigation();
  const theme = useStore((s) => s.settings.theme);
  const level = useAnimLevel();
  const { width } = useWindowDimensions();
  return (
    <Tabs
      tabBar={(props) => <NeuTabBar {...props} />}
      backBehavior="initialRoute"
      screenOptions={{
        headerShown: false,
        // a wide window (a tablet, a wide split screen) keeps its tabs in a rail on the left, like a phone's bar
        // turned on its side; crossing the width keeps whichever tab is open
        tabBarPosition: width >= WIDE_AT ? 'left' : 'bottom',
        sceneStyle: { backgroundColor: bgFor(theme) },
        // a tab slides a short way in from its side of the bar; with only some motion it fades to instead
        animation: level === 'none' ? 'none' : level === 'some' ? 'fade' : 'shift',
        ...(level === 'none' ? null : level === 'some' ? FADE : SHIFT),
        // only Today is built with the app; Today prepares the other tabs one by one once the intro has gone and
        // the screen is still, so a first visit never waits and nothing is built out of sight during the intro.
        // Tabs are never frozen: catching up a frozen tab's missed updates is what made a switch stutter.
        lazy: true,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Today' }} />
      <Tabs.Screen name="slot1" />
      <Tabs.Screen name="slot2" />
      <Tabs.Screen name="slot3" />
      <Tabs.Screen name="more" options={{ title: 'More' }} />
    </Tabs>
  );
}
