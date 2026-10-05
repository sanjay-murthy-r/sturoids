import React, { useEffect, useRef, useState } from 'react';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Alert, Dimensions, InteractionManager, Platform, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as SplashScreen from 'expo-splash-screen';
import * as NavigationBar from 'expo-navigation-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
// each face from its own file: a package's index would carry every one of its files into the app. Geist speaks,
// Newsreader titles the big screens, Rubik Light counts, and the intro keeps Rubik (the Font Lab v2 pick)
import { useFonts } from '@expo-google-fonts/rubik/useFonts';
import { Rubik_300Light } from '@expo-google-fonts/rubik/300Light';
import { Rubik_500Medium } from '@expo-google-fonts/rubik/500Medium';
import { Rubik_600SemiBold } from '@expo-google-fonts/rubik/600SemiBold';
import { Geist_400Regular } from '@expo-google-fonts/geist/400Regular';
import { Geist_500Medium } from '@expo-google-fonts/geist/500Medium';
import { Geist_600SemiBold } from '@expo-google-fonts/geist/600SemiBold';
import { Geist_700Bold } from '@expo-google-fonts/geist/700Bold';
import { Newsreader_500Medium } from '@expo-google-fonts/newsreader/500Medium';
import { bgFor } from '../src/theme';
import { useStore, subscribeLoadNotices } from '../src/store';
import { useHydrated } from '../src/hooks/useHydrated';
import { setIntroPhase } from '../src/intro';
import { StartScreen } from '../src/components/StartScreen';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { ToastHost } from '../src/components/Toast';
import { noteTransitionStart, pageTransition, useAnimLevel } from '../src/components/Motion';

// the native splash stays up until the intro (or the app) has painted its first
// frame — no bare-material gap between the splash icon and the first real frame
SplashScreen.preventAutoHideAsync().catch(() => {});
SplashScreen.setOptions({ duration: 180, fade: true });

// A phone stays upright, as it always was: app.json locks the manifest to portrait, so not even the splash can
// turn. A tablet unlocks itself here. Decided by the screen, not the window, so splitting a tablet's screen never
// makes it count as a phone.
{
  const screen = Dimensions.get('screen');
  if (Math.min(screen.width, screen.height) >= 600) {
    ScreenOrientation.unlockAsync().catch(() => {});
  }
}

export default function RootLayout() {
  const hydrated = useHydrated();
  const theme = useStore((s) => s.settings.theme);
  const level = useAnimLevel();
  const bg = bgFor(theme);
  const [revealed, setRevealed] = useState(false);
  const [introDone, setIntroDone] = useState(false);
  // the intro renders only these two faces, so only they gate its first frame. A face that fails
  // to load falls back to the system font instead of holding the app on its splash forever.
  const [introLoaded, introError] = useFonts({ Rubik_500Medium, Rubik_600SemiBold });
  const [appLoaded, appError] = useFonts({
    Rubik_300Light, Geist_400Regular, Geist_500Medium, Geist_600SemiBold, Geist_700Bold, Newsreader_500Medium,
  });
  const introFonts = introLoaded || !!introError;
  const appFonts = appLoaded || !!appError;
  const splashHidden = useRef(false);

  // notifications and reminder rescheduling never compete with the intro
  useEffect(() => {
    if (!revealed) return;
    const task = InteractionManager.runAfterInteractions(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('../src/notifications').initNotifications().catch(() => {});
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('../src/cloud').initCloud().catch(() => {});
    });
    return () => task.cancel();
  }, [revealed]);

  // a load that failed or finished late is never silent: once the intro is gone, say what happened and what is
  // safe, including a notice raised long after the app opened
  useEffect(() => {
    if (!introDone) return;
    return subscribeLoadNotices((notice) => {
      if (notice === 'late-load') {
        Alert.alert('Your saved data has loaded', 'Changes made while it was loading were replaced by it.');
      } else if (notice === 'failed-paused') {
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
    });
  }, [introDone]);

  // however the intro ended, the app's entrance never waits on it
  useEffect(() => {
    if (introDone) setIntroPhase('done');
  }, [introDone]);

  // the system navigation bar follows the theme's material (app.json only sets the launch colour)
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    NavigationBar.setBackgroundColorAsync(bg).catch(() => {});
    NavigationBar.setButtonStyleAsync('light').catch(() => {});
  }, [bg]);

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
        <ErrorBoundary>
        <Stack
          screenListeners={noteTransitionStart}
          screenOptions={{
            // headers are app-owned (NeuHeader) — status-bar spacing is padded
            // explicitly inside each screen, consistent everywhere
            headerShown: false,
            contentStyle: { backgroundColor: bg },
            // a page dissolves in while its own content rises; with motion off it simply appears (see pageTransition)
            ...pageTransition(level),
          }}
        />
        </ErrorBoundary>
      )}
      {revealed && appFonts && <ToastHost />}
      {!introDone && (
        <StartScreen onReveal={() => setRevealed(true)} onDone={() => setIntroDone(true)} />
      )}
    </GestureHandlerRootView>
  );
}
