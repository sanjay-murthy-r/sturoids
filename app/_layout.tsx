import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Alert, Dimensions, InteractionManager, Platform, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ReduceMotion, ReducedMotionConfig, useReducedMotion } from 'react-native-reanimated';
import * as SplashScreen from 'expo-splash-screen';
import * as NavigationBar from 'expo-navigation-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import { Ionicons } from '@expo/vector-icons';
// each face from its own file: a package's index would carry every one of its files into the app. Inter Tight speaks
// and counts, Schibsted Grotesk sets the small words, Source Serif 4 titles the big screens and the writing, and the
// intro keeps Rubik (the 1.8 pick)
import { useFonts } from '@expo-google-fonts/rubik/useFonts';
import { Rubik_500Medium } from '@expo-google-fonts/rubik/500Medium';
import { Rubik_600SemiBold } from '@expo-google-fonts/rubik/600SemiBold';
import { InterTight_300Light } from '@expo-google-fonts/inter-tight/300Light';
import { InterTight_400Regular } from '@expo-google-fonts/inter-tight/400Regular';
import { InterTight_500Medium } from '@expo-google-fonts/inter-tight/500Medium';
import { InterTight_600SemiBold } from '@expo-google-fonts/inter-tight/600SemiBold';
import { InterTight_700Bold } from '@expo-google-fonts/inter-tight/700Bold';
import { SchibstedGrotesk_400Regular } from '@expo-google-fonts/schibsted-grotesk/400Regular';
import { SchibstedGrotesk_500Medium } from '@expo-google-fonts/schibsted-grotesk/500Medium';
import { SchibstedGrotesk_600SemiBold } from '@expo-google-fonts/schibsted-grotesk/600SemiBold';
import { SourceSerif4_400Regular } from '@expo-google-fonts/source-serif-4/400Regular';
import { SourceSerif4_500Medium } from '@expo-google-fonts/source-serif-4/500Medium';
import { bgFor } from '../src/theme';
import {
  useStore, subscribeLoadNotices, subscribeSaveProblems, savesFailing, savedRowUnreadable,
} from '../src/store';
import type { LoadNotice } from '../src/store';
import { useHydrated } from '../src/hooks/useHydrated';
import { markAppDrawn, noteAppFonts, setIntroPhase } from '../src/intro';
import { StartScreen } from '../src/components/StartScreen';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { ToastHost } from '../src/components/Toast';
import { loadProfiles, takeArrival, useProfiles } from '../src/profiles';
import { ArrivalMoment, SwitchingOverlay } from '../src/components/ProfileSwitcher';
import { AppFrame, SearchOverlay } from '../src/components/SearchOverlay';
import { QuickAddHost } from '../src/components/QuickAddHost';
import { appIsUp } from '../src/actions';
import { ShareIntake } from '../src/shareIntake';
import { noteTransitionStart, pageTransition, useAnimLevel, useOsReduceMotion } from '../src/components/Motion';

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

/**
 * Hands `then` whether a cloud account is signed in, once the cloud has looked at its saved session (or after a short
 * wait, if it has not by then). The cloud module is loaded here only on the way to telling the user something.
 */
function whenCloudKnown(then: (signedIn: boolean) => void) {
  const { useCloud } = require('../src/cloud') as typeof import('../src/cloud');
  const signedIn = () => !!useCloud.getState().email;
  if (useCloud.getState().ready) {
    then(signedIn());
    return;
  }
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    off();
    clearTimeout(timer);
    then(signedIn());
  };
  const off = useCloud.subscribe((s) => { if (s.ready) finish(); });
  const timer = setTimeout(finish, 3000);
}

const openBackup = { text: 'Open Settings', onPress: () => router.push('/settings?page=backup') };
const openAccount = { text: 'Open Settings', onPress: () => router.push('/settings?page=account') };

/** "Notes", "Notes and Journal", "Notes, Journal and Scores" */
const listOf = (names: string[]) =>
  (names.length < 2 ? names.join('') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]);

/**
 * What a load that failed or finished late means, and what is safe: said once the intro has gone. `lost` names the
 * collections that could not be opened when only some failed; it is empty when the whole load failed.
 */
function tellLoadNotice(notice: LoadNotice, lost: string[], signedIn: boolean) {
  if (notice === 'late-load') {
    Alert.alert('Your saved data has loaded', 'Changes made while it was loading were replaced by it.');
    return;
  }
  // only some collections could not be opened: everything else loaded, and the cloud copy or a backup file can bring
  // the rest back (a restart reads the same rows again)
  if (lost.length) {
    const one = lost.length === 1;
    Alert.alert(
      'Some of your saved data could not be opened',
      (one ? 'This could not be opened, and shows as empty for now: ' : 'These could not be opened, and show as empty for now: ')
        + listOf(lost) + '. Everything else loaded. '
        + (signedIn
          ? 'Your cloud copy can bring ' + (one ? 'it' : 'them') + ' back, from Settings, Account.'
          : 'If you have a backup file, it can bring ' + (one ? 'it' : 'them') + ' back, from Settings, Backup.'),
      [{ text: 'Later', style: 'cancel' }, signedIn ? openAccount : openBackup],
    );
    return;
  }
  const title = 'Your saved data could not be opened';
  if (notice === 'failed-paused') {
    if (savedRowUnreadable()) {
      // the row cannot even be read back, so a restart cannot help: a copy kept elsewhere can
      Alert.alert(
        title,
        'Nothing on this phone was changed, but changes you make now will not be saved, and restarting will not open it. '
          + (signedIn
            ? 'Your cloud copy can bring your data back, from Settings, Account.'
            : 'If you have a backup file, import it from Settings, Backup.'),
        [{ text: 'Later', style: 'cancel' }, signedIn ? openAccount : openBackup],
      );
      return;
    }
    Alert.alert(
      title,
      'Nothing on this phone was changed, but changes you make now will not be saved. Restart the app to try again.'
        + (signedIn ? ' Your cloud copy is safe too.' : ''),
    );
    return;
  }
  Alert.alert(
    title,
    'A copy was kept on this phone and the app started fresh. You can share the copy or restore it from Settings, Backup.'
      + (signedIn ? ' Your cloud copy is safe too, under Account.' : ''),
    [{ text: 'Later', style: 'cancel' }, openBackup],
  );
}

// a launch a profile switch started skips the intro: read as early as the store, so the first frame already knows
const arrivalRead = takeArrival();

/** how long the app waits for the profiles' registry before it shows anyway (it is a small read, and never needed) */
const PROFILES_WAIT_MS = 1500;

/** Said once a launch, the first time a save fails: the changes are still in the app, but not yet on the phone. */
let saveTroubleTold = false;
function tellSaveTrouble() {
  if (saveTroubleTold) return;
  saveTroubleTold = true;
  Alert.alert(
    'Your latest changes could not be saved',
    'This phone could not store them. Export a backup file now, so nothing is lost.',
    [{ text: 'Later', style: 'cancel' }, openBackup],
  );
}

/**
 * Keeps Reanimated's own reduce-motion switch with the phone's live one. Reanimated reads the switch once, at launch,
 * and finishes every animation at once while it was on; when the user changes it while the app runs, this overrides
 * Reanimated to match, and stands down once the two agree again.
 */
function ReduceMotionSync() {
  const atLaunch = useReducedMotion();
  const live = useOsReduceMotion((s) => s.on);
  if (live == null || live === atLaunch) return null;
  return <ReducedMotionConfig mode={live ? ReduceMotion.Always : ReduceMotion.Never} />;
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
  // the icons' font loads with the app's faces, so no icon draws an empty box for a frame and then pops in
  const [appLoaded, appError] = useFonts({
    ...Ionicons.font,
    InterTight_300Light, InterTight_400Regular, InterTight_500Medium, InterTight_600SemiBold, InterTight_700Bold,
    SchibstedGrotesk_400Regular, SchibstedGrotesk_500Medium, SchibstedGrotesk_600SemiBold,
    SourceSerif4_400Regular, SourceSerif4_500Medium,
  });
  const introFonts = introLoaded || !!introError;
  const appFonts = appLoaded || !!appError;
  // a skipped intro may wait a little longer for the app to draw while its faces are still loading (src/intro.ts)
  useEffect(() => { if (appFonts) noteAppFonts(); }, [appFonts]);
  const splashHidden = useRef(false);
  // whether this launch is the one a profile switch started (null until the note has been read)
  const [arrived, setArrived] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    arrivalRead.then((v) => { if (live) setArrived(v); }, () => { if (live) setArrived(false); });
    return () => { live = false; };
  }, []);
  // the profiles' registry, read once the data is in: a fresh profile takes its name and colour before the first frame
  const profilesLoaded = useProfiles((p) => p.loaded);
  const [profilesLate, setProfilesLate] = useState(false);
  useEffect(() => {
    if (!hydrated) return undefined;
    loadProfiles().catch(() => {});
    const t = setTimeout(() => setProfilesLate(true), PROFILES_WAIT_MS);
    return () => clearTimeout(t);
  }, [hydrated]);
  // With motion off there is no intro to paint first: the app is built as soon as the data and its fonts are in, and the
  // splash stays up until the app's own first frame, so it never fades onto empty material. A launch a switch started
  // skips the intro the same way, straight to the app.
  const instant = level === 'none' || arrived === true;
  const showApp = (revealed || instant) && appFonts;

  // arriving from a switch: no intro, the app is built at once beneath the arrival moment (the profile's photo and
  // name), which then fades into Today's entrance and ends the intro
  useEffect(() => {
    if (arrived !== true) return;
    setRevealed(true);
  }, [arrived]);

  // stable, so a root re-render (fonts, revealed, profiles) never re-renders the intro while it plays or skips
  const onReveal = useCallback(() => setRevealed(true), []);
  const onIntroDone = useCallback(() => setIntroDone(true), []);

  // The app has drawn once its navigator's container has laid out and two frames have painted: a skipped intro (and
  // the arrival moment) waits for this before it clears, so it never fades onto a page still being built. With motion
  // off (or after a switch) the splash goes from this first layout too.
  const instantRef = useRef(false);
  const hideSplashRef = useRef<() => void>(() => {});
  const drawnAsked = useRef(false);
  const onAppLayout = useCallback(() => {
    if (instantRef.current) hideSplashRef.current();
    if (drawnAsked.current) return;
    drawnAsked.current = true;
    requestAnimationFrame(() => requestAnimationFrame(() => markAppDrawn()));
  }, []);

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
  // safe, including a notice raised long after the app opened. A save that fails is said once too.
  useEffect(() => {
    if (!introDone) return undefined;
    const offLoad = subscribeLoadNotices((notice, lost) => whenCloudKnown((signedIn) => tellLoadNotice(notice, lost, signedIn)));
    const offSave = subscribeSaveProblems((failing) => { if (failing) tellSaveTrouble(); });
    if (savesFailing()) tellSaveTrouble();
    return () => { offLoad(); offSave(); };
  }, [introDone]);

  // however the intro ended, the app's entrance never waits on it; and a link that opened the app (an app shortcut, a
  // phone widget) is carried out now
  useEffect(() => {
    if (!introDone) return;
    setIntroPhase('done');
    appIsUp();
  }, [introDone]);

  // the system navigation bar follows the theme's material (app.json only sets the launch colour)
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    NavigationBar.setBackgroundColorAsync(bg).catch(() => {});
    NavigationBar.setButtonStyleAsync('light').catch(() => {});
  }, [bg]);

  // wait for the persisted settings too: the intro's animation level, the theme
  // background and the accent must all be the user's on the very first frame
  if (!hydrated || !introFonts || arrived === null || !(profilesLoaded || profilesLate)) {
    return <View style={{ flex: 1, backgroundColor: bg }} />;
  }

  const hideSplash = () => {
    if (splashHidden.current) return;
    splashHidden.current = true;
    SplashScreen.hideAsync().catch(() => {});
  };
  instantRef.current = instant;
  hideSplashRef.current = hideSplash;

  // the splash goes from the first real frame: the intro's (it paints with the root), or with motion off the app's own
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: bg }} onLayout={instant ? undefined : hideSplash}>
      <StatusBar style="light" />
      <ReduceMotionSync />
      {showApp && (
        <AppFrame>
        <View style={{ flex: 1 }} onLayout={onAppLayout}>
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
        </View>
        </AppFrame>
      )}
      {/* Sift, the app-wide search, over the tabs and every page; and the app-wide "Add a task" sheet */}
      {showApp && <SearchOverlay />}
      {showApp && <QuickAddHost />}
      {showApp && <ToastHost />}
      {/* covers everything while the app restarts into another profile */}
      <SwitchingOverlay />
      {/* a YouTube link shared to the app is offered to YT Vault, once the intro is over */}
      {showApp && <ShareIntake />}
      {/* after a switch's restart: who the app opened as, held a moment, then into Today */}
      {showApp && arrived === true && !introDone && <ArrivalMoment onDone={onIntroDone} />}
      {!introDone && !arrived && <StartScreen onReveal={onReveal} onDone={onIntroDone} />}
    </GestureHandlerRootView>
  );
}
