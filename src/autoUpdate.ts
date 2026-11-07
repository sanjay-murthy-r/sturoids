// Updates without being asked to look, on a phone: a little after launch, and on coming back to the app (at most every
// six hours), Sturoids reads its latest release on GitHub. A newer version is fetched on Wi-Fi, and one tap hands it to
// Android's installer. Android always asks the owner to confirm an app installed from outside a store (there is no way
// round that for an app like this), so the one tap and Android's own "Update" are all that is left to do.
// The PC does not update by itself: Settings, Updates, checks by hand and opens the installer's download (a quiet
// install could not be made reliable). Settings also turns this off.

import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { create } from 'zustand';
import { useStore } from './store';
import { APK_PATH, Release, UpdateError, apkDownloadInFlight, downloadApk, installKind, isNewer, latestRelease, useApkDownload } from './updates';
import { toast } from './components/Toast';

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const LAST_KEY = 'sturoids-update-checked';

/**
 * The version running: app.json's, bundled with the code itself, so it is always this build's. (The config a build
 * carries can come from a stale build cache, and an old number there would make every release look newer.)
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const BUNDLED_VERSION: string = (require('../app.json') as { expo: { version: string } }).expo.version;
export const appVersion = () => BUNDLED_VERSION || Constants.expoConfig?.version || '0.0.0';

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
    // an install from Settings may be writing the same file now: wait for it rather than delete it from under it, and
    // take its file when it is this version (Android's installer may be reading it)
    const busy = apkDownloadInFlight();
    if (busy) {
      const same = useApkDownload.getState().rel?.version === release.version;
      const got = await busy.catch(() => null);
      if (same && got) return got;
    }
    const have = await FileSystem.getInfoAsync(target);
    // the same version fetched before (its size matches) is not fetched again
    if (have.exists && (have as any).size === release.apk.size && useUpdateReady.getState().version === release.version) return target;
    return await downloadApk(release);
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

function offer(version: string, apk: string) {
  useUpdateReady.setState({ version, apk });
  toast('Sturoids ' + version + ' is ready to install.', {
    label: 'Install', onPress: () => { installApk(apk).catch(() => toast("Android's installer didn't open. Try from Settings, Updates.")); },
  });
}

/** One look at GitHub, when it is due (or `force`), and what follows from it. */
export async function checkForUpdate(force = false) {
  const s = useStore.getState().settings;
  if (running || (!force && !s.autoUpdate)) return;
  // only a phone updates by itself (a browser tab updates on reload; the PC from Settings, Updates)
  if (Platform.OS !== 'android') return;
  running = true;
  try {
    if (!force) {
      const last = Number(await AsyncStorage.getItem(LAST_KEY)) || 0;
      if (Date.now() - last < CHECK_EVERY_MS) return;
    }
    const rel = await latestRelease(s.githubRepo);
    if (!isNewer(rel, appVersion()) || installKind(rel) !== 'apk') {
      await AsyncStorage.setItem(LAST_KEY, String(Date.now())).catch(() => {});
      return;
    }
    // a phone fetches on Wi-Fi only; on mobile data it waits for the next look (unstamped, so that comes soon)
    if (!(await onWifi())) return;
    const apk = await fetchApk(rel);
    // stamped only once the new version is in hand: a fetch that failed is tried again at the next return
    if (apk) {
      await AsyncStorage.setItem(LAST_KEY, String(Date.now())).catch(() => {});
      offer(rel.version, apk);
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
