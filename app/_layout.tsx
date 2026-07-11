import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { C } from '../src/theme';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: C.bg },
          headerTintColor: C.text,
          headerShadowVisible: false,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: C.bg },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="calculator" options={{ title: 'Calculator' }} />
        <Stack.Screen name="desmos" options={{ title: 'Desmos' }} />
        <Stack.Screen name="ai-links" options={{ title: 'AI Quick-Links' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="notes/index" options={{ title: 'Notes' }} />
        <Stack.Screen name="notes/[id]" options={{ title: 'Note' }} />
        <Stack.Screen name="vault/index" options={{ title: 'Vault' }} />
        <Stack.Screen name="vault/[id]" options={{ title: 'Player', headerBackTitle: 'Vault' }} />
      </Stack>
    </>
  );
}
