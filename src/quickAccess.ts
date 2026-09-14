import { Alert, Linking } from 'react-native';
import { QuickItem, SETTINGS_QUICK } from './store';
import { TOOLS } from './tools';

/** In-app destinations for the quick-access editor: every tool, then Settings. */
export const ROUTE_CATALOG: Omit<QuickItem, 'id'>[] = [
  ...TOOLS.map((t) => ({ label: t.shortLabel, icon: t.icon, color: t.colorKey, kind: 'tool' as const, target: t.key })),
  SETTINGS_QUICK,
];

/** Launch a quick item (apps + urls; tools and routes are handled by the caller). */
export async function launchExternal(item: QuickItem) {
  try {
    if (item.kind === 'url') {
      await Linking.openURL(item.target);
      return;
    }
    if (item.kind === 'app') {
      // required lazily: the launcher module stays off the startup path
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const IntentLauncher = require('expo-intent-launcher');
      // The proper way: PackageManager#getLaunchIntentForPackage under the hood.
      // Must be awaited — an un-awaited rejection (app uninstalled) would skip
      // the catch below and never show the "not installed" alert.
      await IntentLauncher.openApplication(item.target);
      return;
    }
  } catch {
    Alert.alert(
      'Could not launch',
      item.kind === 'app'
        ? '"' + item.label + '" (' + item.target + ") doesn't seem to be installed."
        : 'Could not open ' + item.target
    );
  }
}
