import { Alert, Linking } from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';
import { QuickItem } from './store';

/** In-app destinations for the quick-access editor. */
export const ROUTE_CATALOG: Omit<QuickItem, 'id'>[] = [
  { label: 'Notes', icon: 'document-text-outline', color: '#8CD9A8', kind: 'route', target: '/notes' },
  { label: 'Calc', icon: 'calculator-outline', color: '#E9BC7A', kind: 'route', target: '/calculator' },
  { label: 'Desmos', icon: 'analytics-outline', color: '#7FD0D6', kind: 'route', target: '/desmos' },
  { label: 'YT Vault', icon: 'play-circle-outline', color: '#E895A5', kind: 'route', target: '/vault' },
  { label: 'AI', icon: 'sparkles-outline', color: '#B3A3E8', kind: 'route', target: '/ai-links' },
  { label: 'Settings', icon: 'settings-outline', color: '#9AA6C0', kind: 'route', target: '/settings' },
  { label: 'Tasks', icon: 'checkbox-outline', color: '#8FB6E8', kind: 'route', target: '/tasks' },
  { label: 'Deep Work', icon: 'timer-outline', color: '#B3A3E8', kind: 'route', target: '/focus' },
  { label: 'Planner', icon: 'calendar-outline', color: '#7FD0D6', kind: 'route', target: '/planner' },
];

/** Launch a quick item (apps + urls; routes are handled by the caller). */
export async function launchExternal(item: QuickItem) {
  try {
    if (item.kind === 'url') {
      await Linking.openURL(item.target);
      return;
    }
    if (item.kind === 'app') {
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
