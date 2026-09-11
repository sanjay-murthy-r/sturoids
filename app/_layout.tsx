import React, { useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  useFonts, Rubik_400Regular, Rubik_500Medium, Rubik_600SemiBold, Rubik_700Bold,
} from '@expo-google-fonts/rubik';
import { IBMPlexMono_600SemiBold } from '@expo-google-fonts/ibm-plex-mono';
import { bgFor, setAccent } from '../src/theme';
import { useStore } from '../src/store';
import { StartScreen } from '../src/components/StartScreen';

export default function RootLayout() {
  const theme = useStore((s) => s.settings.theme);
  const accent = useStore((s) => s.settings.accent);
  setAccent(accent); // runtime accent theme — applied before children render
  const bg = bgFor(theme);
  const [revealed, setRevealed] = useState(false);
  const [introDone, setIntroDone] = useState(false);
  const [fontsLoaded] = useFonts({
    Rubik_400Regular, Rubik_500Medium, Rubik_600SemiBold, Rubik_700Bold,
    IBMPlexMono_600SemiBold,
  });

  // The native splash still covers this frame; render bare material until
  // the faces are ready so the intro never flashes a fallback font.
  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: bg }} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: bg }}>
      <StatusBar style="light" />
      {revealed && (
        <Stack
          screenOptions={{
            // headers are app-owned (NeuHeader) — status-bar spacing is padded
            // explicitly inside each screen, consistent everywhere
            headerShown: false,
            contentStyle: { backgroundColor: bg },
            animation: 'fade_from_bottom',
            animationDuration: 220,
          }}
        />
      )}
      {!introDone && (
        <StartScreen onReveal={() => setRevealed(true)} onDone={() => setIntroDone(true)} />
      )}
    </GestureHandlerRootView>
  );
}
