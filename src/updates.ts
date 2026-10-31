// Updates from GitHub: the latest release of the repo Settings names (Sturoids' own unless another is typed in), and
// on a phone, its APK downloaded and handed to Android's installer. The desktop app fetches its installer and runs it
// quietly (desktop/main.js); in a plain browser the release's page opens. Looking by itself: src/autoUpdate.ts.

import { Linking, Platform } from 'react-native';
import { compareVersions } from './utils';

export interface ReleaseFile { name: string; url: string; size: number }

export interface Release {
  /** '2.1.0', from the tag ('v2.1.0') */
  version: string;
  tag: string;
  /** the release's own words, its first lines */
  notes: string;
  /** the release's page on GitHub */
  page: string;
  /** the Android app, when the release carries one */
  apk: ReleaseFile | null;
  /** the Windows installer, when it carries one */
  exe: ReleaseFile | null;
}

/** An owner/repo GitHub accepts. */
export const isRepo = (repo: string) => /^[\w.-]+\/[\w.-]+$/.test(repo.trim());

/** A problem worth saying as it is (the others say only that GitHub could not be reached). */
export class UpdateError extends Error {
  shown = true;
}

/** The repo's latest release, read from GitHub, with its files picked out. Gives up after 10 seconds. */
export async function latestRelease(repo: string): Promise<Release> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10 * 1000);
  try {
    const r = await fetch('https://api.github.com/repos/' + repo.trim() + '/releases/latest', {
      signal: ctrl.signal, headers: { Accept: 'application/vnd.github+json' },
    });
    if (r.status === 404) throw new UpdateError('That repo has no releases yet.');
    if (r.status === 403 || r.status === 429) throw new UpdateError('GitHub is busy. Try again in a few minutes.');
    if (!r.ok) throw new Error('status ' + r.status);
    const j = await r.json();
    const files: ReleaseFile[] = (Array.isArray(j.assets) ? j.assets : [])
      .filter((a: any) => a && typeof a.name === 'string' && typeof a.browser_download_url === 'string')
      .map((a: any) => ({ name: a.name, url: a.browser_download_url, size: Number(a.size) || 0 }));
    const tag = String(j.tag_name || '');
    return {
      version: tag.replace(/^v/i, ''),
      tag,
      notes: String(j.body || '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 6).join('\n'),
      page: String(j.html_url || 'https://github.com/' + repo.trim() + '/releases'),
      apk: files.find((f) => /\.apk$/i.test(f.name)) ?? null,
      exe: files.find((f) => /\.exe$/i.test(f.name)) ?? null,
    };
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new UpdateError('GitHub did not answer in time. Try again.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Whether a release is newer than the app running now. */
export const isNewer = (release: Release, current: string) => !!release.version && compareVersions(release.version, current) > 0;

/** What this device can do with a release: install it in place (a phone), open its installer (a PC), or only its page. */
export function installKind(release: Release): 'apk' | 'exe' | 'page' {
  if (Platform.OS === 'android' && release.apk) return 'apk';
  if (Platform.OS === 'web' && release.exe) return 'exe';
  return 'page';
}

const APK_PATH = 'sturoids-update.apk';

/**
 * Downloads the release's APK into the app's cache, telling `onProgress` how far it has got (0 to 1), and hands it to
 * Android's installer, which asks the user to confirm (and, the first time, to allow Sturoids to install apps). The
 * new version installs over this one, keeping everything: it is signed with the same key.
 */
export async function downloadAndInstall(release: Release, onProgress: (p: number) => void): Promise<void> {
  if (!release.apk) throw new UpdateError('This release has no Android app attached.');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const FileSystem = require('expo-file-system') as typeof import('expo-file-system');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const IntentLauncher = require('expo-intent-launcher') as typeof import('expo-intent-launcher');
  const target = (FileSystem.cacheDirectory || '') + APK_PATH;
  await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => {});
  const job = FileSystem.createDownloadResumable(release.apk.url, target, {}, (p) => {
    const total = p.totalBytesExpectedToWrite > 0 ? p.totalBytesExpectedToWrite : release.apk!.size;
    if (total > 0) onProgress(Math.min(1, p.totalBytesWritten / total));
  });
  const done = await job.downloadAsync();
  if (!done || (done.status && done.status >= 400)) throw new UpdateError('The download did not finish. Try again.');
  onProgress(1);
  const uri = await FileSystem.getContentUriAsync(done.uri);
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: uri,
    type: 'application/vnd.android.package-archive',
    // FLAG_GRANT_READ_URI_PERMISSION: the installer may read the file from the app's cache
    flags: 1,
  });
}

/** Opens the release's Windows installer (a PC) or its page in the browser. */
export function openRelease(release: Release) {
  const url = installKind(release) === 'exe' && release.exe ? release.exe.url : release.page;
  return Linking.openURL(url);
}
