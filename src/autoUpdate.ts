// Updates without being asked to look: a little after launch, and on coming back to the app (at most every six hours),
// Sturoids reads its latest release on GitHub. A newer version is fetched in the background and then offered:
// - on the PC it installs itself quietly: at once with "Restart now", or else when Sturoids is next closed;
// - on a phone the app is fetched on Wi-Fi, and one tap hands it to Android's installer. Android always asks the owner
//   to confirm an app installed from outside a store (there is no way round that for an app like this), so the one tap
//   and Android's own "Update" are all that is left to do.
// Settings, Updates, still checks by hand, and turns this off.

import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { create } from 'zustand';
import { useStore } from './store';
import { Release, UpdateError, installKind, isNewer, latestRelease } from './updates';
import { toast } from './components/Toast';

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const LAST_KEY = 'sturoids-update-checked';
const APK_PATH = 'sturoids-update.apk';

/**
 * The version running: app.json's, bundled with the code itself, so it is always this build's. (The config a build
 * carries can come from a stale build cache, and an old number there would make every release look newer.)
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const BUNDLED_VERSION: string = (require('../app.json') as { expo: { version: string } }).expo.version;
export const appVersion = () => BUNDLED_VERSION || Constants.expoConfig?.version || '0.0.0';

interface Desktop {
  stageUpdate: (url: string, version: string) => Promise<boolean>;
  stagedVersion: () => Promise<string | null>;
  installNow: () => Promise<boolean>;
}
/** The desktop app's bridge (desktop/preload.js), or null in a browser or on a phone. */
export const desktop = (): Desktop | null =>
  (Platform.OS === 'web' && typeof window !== 'undefined' ? ((window as any).sturoidsDesktop as Desktop) ?? null : null);

/** A newer version, fetched and waiting to be installed (Settings shows it too). */
export const useUpdateReady = create<{ version: string | null; apk: string | null }>(() => ({ version: null, apk: null }));

let running = false;

async function onWifi(): Promise<boolean> {
  try {
    const Network = require('expo-network') as typeof import('expo-network');
    const st = await Network.getNetworkStateAsync();
    return st.type === Network.NetworkStateType.WIFI || st.type === Network.NetworkStateType.ETHERNET;
  } catch {
    return false;
  }
}

/** Fetches the release's APK into the cache; its file's address, or null. */
async function fetchApk(release: Release): Promise<string | null> {
  if (!release.apk) return null;
  const FileSystem = require('expo-file-system') as typeof import('expo-file-system');
  const target = (FileSystem.cacheDirectory || '') + APK_PATH;
  try {
    const have = await FileSystem.getInfoAsync(target);
    // the same version fetched before (its size matches) is not fetched again
    if (have.exists && (have as any).size === release.apk.size && useUpdateReady.getState().version === release.version) return target;
    await FileSystem.deleteAsync(target, { idempotent: true });
    const done = await FileSystem.downloadAsync(release.apk.url, target);
    if (!done || (done.status && done.status >= 400)) return null;
    return done.uri;
  } catch {
    return null;
  }
}

/** Hands a fetched APK to Android's installer. */
export async function installApk(uri: string) {
  const FileSystem = require('expo-file-system') as typeof import('expo-file-system');
  const IntentLauncher = require('expo-intent-launcher') as typeof import('expo-intent-launcher');
  const content = await FileSystem.getContentUriAsync(uri);
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: content, type: 'application/vnd.android.package-archive', flags: 1,
  });
}

function offer(version: string, apk: string | null) {
  useUpdateReady.setState({ version, apk });
  const pc = desktop();
  if (pc) {
    toast('Sturoids ' + version + ' is ready. It installs when you close the app.', {
      label: 'Restart now', onPress: () => { void pc.installNow(); },
    });
  } else if (apk) {
    toast('Sturoids ' + version + ' is ready to install.', { label: 'Install', onPress: () => { void installApk(apk); } });
  }
}

/** One look at GitHub, when it is due (or `force`), and what follows from it. */
export async function checkForUpdate(force = false) {
  const s = useStore.getState().settings;
  if (running || (!force && !s.autoUpdate)) return;
  if (Platform.OS === 'web' && !desktop()) return; // a browser tab updates itself on reload
  running = true;
  try {
    if (!force) {
      const last = Number(await AsyncStorage.getItem(LAST_KEY)) || 0;
      if (Date.now() - last < CHECK_EVERY_MS) return;
    }
    const rel = await latestRelease(s.githubRepo);
    // stamped only once GitHub has answered: a look that found no network is tried again at the next return
    await AsyncStorage.setItem(LAST_KEY, String(Date.now())).catch(() => {});
    if (!isNewer(rel, appVersion())) return;
    const kind = installKind(rel);
    if (kind === 'exe' && rel.exe) {
      const pc = desktop()!;
      if (await pc.stageUpdate(rel.exe.url, rel.version)) offer(rel.version, null);
    } else if (kind === 'apk') {
      // a phone fetches on Wi-Fi only; on mobile data it waits for the next look
      if (!(await onWifi())) return;
      const apk = await fetchApk(rel);
      if (apk) offer(rel.version, apk);
    }
  } catch (e) {
    // no network: the next return tries again. GitHub that answered with a refusal (busy, no releases) is left alone for
    // the usual wait, so a busy GitHub is not asked again at every return
    if (e instanceof UpdateError) await AsyncStorage.setItem(LAST_KEY, String(Date.now())).catch(() => {});
  } finally {
    running = false;
  }
}

let started = false;
/** Starts the quiet looks: once, a little after launch, then on each return to the app. */
export function startAutoUpdate() {
  if (started) return;
  started = true;
  setTimeout(() => { void checkForUpdate(); }, 25 * 1000);
  AppState.addEventListener('change', (st) => { if (st === 'active') void checkForUpdate(); });
}
