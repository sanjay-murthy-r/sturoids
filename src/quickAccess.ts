import { Alert, Linking } from 'react-native';
import { QuickItem, SETTINGS_QUICK } from './store';
import { TOOLS } from './tools';

/** In-app destinations for the quick-access editor: every tool, then Settings. */
export const ROUTE_CATALOG: Omit<QuickItem, 'id'>[] = [
  ...TOOLS.map((t) => ({ label: t.shortLabel, icon: t.icon, color: t.colorKey, kind: 'tool' as const, target: t.key })),
  SETTINGS_QUICK,
];

/**
 * A typed address as a link the browser can open: "wikipedia.org" and "www.khanacademy.org/math" gain https://, an
 * http(s) link stays as it is. Null when it is not a web address (no dot in the host, spaces, another scheme).
 */
export function siteUrl(input: string): string | null {
  let u = input.trim();
  if (!u || /\s/.test(u)) return null;
  if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(u) && !/^https?:\/\//i.test(u)) return null;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u.replace(/^\/+/, '');
  const host = siteHost(u);
  if (!host || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host) || /^[.-]|[.-]$/.test(host)) return null;
  return u;
}

/** "www.khanacademy.org" from a link, without the www. Empty when there is no host. */
export function siteHost(url: string): string {
  const m = /^https?:\/\/([^/?#:]+)/i.exec(url);
  return m ? m[1].toLowerCase().replace(/^www\./, '') : '';
}

/** Whether two links are the same page: scheme, case, www. and a trailing slash aside. */
export function sameSite(a: string, b: string): boolean {
  const key = (u: string) => u.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '').toLowerCase();
  return key(a) === key(b);
}

/** A short name for a site from its address: "khanacademy.org" becomes "Khanacademy". */
export function siteName(url: string): string {
  const host = siteHost(url);
  const parts = host.split('.');
  const core = parts.length > 2 && parts[parts.length - 2].length <= 3 ? parts[parts.length - 3] : parts[parts.length - 2] || host;
  return core ? core.charAt(0).toUpperCase() + core.slice(1) : 'Website';
}

/** Open a website shortcut in the phone's default browser (tools and routes are handled by the caller). */
export async function launchExternal(item: QuickItem) {
  if (item.kind !== 'url') return;
  try {
    await Linking.openURL(item.target);
  } catch {
    Alert.alert('Could not open the site', 'No browser could open ' + item.target + '. Check the address.');
  }
}
