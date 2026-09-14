import React, { useEffect, useRef, useState } from 'react';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Alert, InteractionManager, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as SplashScreen from 'expo-splash-screen';
import {
  useFonts, Rubik_400Regular, Rubik_500Medium, Rubik_600SemiBold, Rubik_700Bold,
} from '@expo-google-fonts/rubik';
import { IBMPlexMono_600SemiBold } from '@expo-google-fonts/ibm-plex-mono';
import { bgFor } from '../src/theme';
import { useStore, loadFailedThisLaunch, savingPaused } from '../src/store';
import { useHydrated } from '../src/hooks/useHydrated';
import { StartScreen } from '../src/components/StartScreen';

// the native splash stays up until the intro (or the app) has painted its first
// frame — no bare-material gap between the splash icon and the first real frame
SplashScreen.preventAutoHideAsync().catch(() => {});
SplashScreen.setOptions({ duration: 180, fade: true });

export default function RootLayout() {
  const hydrated = useHydrated();
  const theme = useStore((s) => s.settings.theme);
  const bg = bgFor(theme);
  const [revealed, setRevealed] = useState(false);
  const [introDone, setIntroDone] = useState(false);
  // the intro renders only these two faces, so only they gate its first frame
  const [introFonts] = useFonts({ Rubik_500Medium, Rubik_600SemiBold });
  const [appFonts] = useFonts({ Rubik_400Regular, Rubik_700Bold, IBMPlexMono_600SemiBold });
  const splashHidden = useRef(false);

  // notifications and reminder rescheduling never compete with the intro
  useEffect(() => {
    if (!revealed) return;
    const task = InteractionManager.runAfterInteractions(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('../src/notifications').initNotifications().catch(() => {});
    });
    return () => task.cancel();
  }, [revealed]);

  // a load that failed is never silent: once the intro is gone, say what happened and what is safe
  useEffect(() => {
    if (!introDone || !loadFailedThisLaunch()) return;
    if (savingPaused()) {
      Alert.alert(
        'Your saved data could not be opened',
        'Nothing on this phone was changed, but changes you make now will not be saved. Restart the app to try again.',
      );
    } else {
      Alert.alert(
        'Your saved data could not be opened',
        'A copy was kept on this phone and the app started fresh. You can share the copy or restore it from Settings, under Data.',
        [
          { text: 'Later', style: 'cancel' },
          { text: 'Open Settings', onPress: () => router.push('/settings') },
        ],
      );
    }
  }, [introDone]);

  // wait for the persisted settings too: the intro's animation level, the theme
  // background and the accent must all be the user's on the very first frame
  if (!hydrated || !introFonts) {
    return <View style={{ flex: 1, backgroundColor: bg }} />;
  }

  const hideSplash = () => {
    if (splashHidden.current) return;
    splashHidden.current = true;
    SplashScreen.hideAsync().catch(() => {});
  };

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: bg }} onLayout={hideSplash}>
      <StatusBar style="light" />
      {revealed && appFonts && (
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
