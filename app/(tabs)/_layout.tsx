import React from 'react';
import { Tabs } from 'expo-router';
import { bgFor } from '../../src/theme';
import { useStore } from '../../src/store';
import { NeuTabBar } from '../../src/components/NeuTabBar';
import { useAnimLevel } from '../../src/components/Motion';
import { useRegisterNavigation } from '../../src/toolNav';

/**
 * The bar's five routes never change: Today, three slots, More. Each slot is a Stack whose root shows
 * whichever tool Settings put there, so a swap can never add, drop or rename a tab.
 */
export default function TabLayout() {
  useRegisterNavigation();
  const theme = useStore((s) => s.settings.theme);
  const level = useAnimLevel();
  return (
    <Tabs
      tabBar={(props) => <NeuTabBar {...props} />}
      backBehavior="initialRoute"
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: bgFor(theme) },
        // a tab slides a short way in from its side of the bar
        animation: level === 'none' ? 'none' : 'shift',
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
