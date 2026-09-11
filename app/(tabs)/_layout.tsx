import React from 'react';
import { Tabs } from 'expo-router';
import { useStore } from '../../src/store';
import { NeuTabBar } from '../../src/components/NeuTabBar';

export default function TabLayout() {
  const theme = useStore((s) => s.settings.theme);
  const accent = useStore((s) => s.settings.accent); // re-render tab bar on accent change
  void theme; void accent;
  return (
    <Tabs
      tabBar={(props) => <NeuTabBar {...props} />}
      backBehavior="initialRoute"
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index" options={{ title: 'Today' }} />
      <Tabs.Screen name="tasks" options={{ title: 'Tasks' }} />
      <Tabs.Screen name="focus" options={{ title: 'Deep Work' }} />
      <Tabs.Screen name="planner" options={{ title: 'Planner' }} />
      <Tabs.Screen name="more" options={{ title: 'More' }} />
    </Tabs>
  );
}
