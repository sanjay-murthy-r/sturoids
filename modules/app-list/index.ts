// Local Expo module: lists the launchable apps installed on THIS phone.
// Falls back gracefully (empty list) in Expo Go or before a rebuild.
export interface InstalledApp { label: string; packageName: string }

let mod: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { requireNativeModule } = require('expo-modules-core');
  mod = requireNativeModule('AppList');
} catch {
  mod = null;
}

export function appListAvailable(): boolean {
  return !!mod;
}

export function getInstalledApps(): InstalledApp[] {
  try {
    return (mod?.getInstalledApps() as InstalledApp[]) ?? [];
  } catch {
    return [];
  }
}
