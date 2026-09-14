// Local Expo module: lists the launchable apps installed on THIS phone.
// Falls back gracefully (empty list) in Expo Go or before a rebuild.
export interface InstalledApp { label: string; packageName: string }

// resolved on first use, not at import — Home imports this module and the
// native lookup has no business on the startup path
let mod: any;
let resolved = false;
function native(): any {
  if (resolved) return mod;
  resolved = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { requireNativeModule } = require('expo-modules-core');
    mod = requireNativeModule('AppList');
  } catch {
    mod = null;
  }
  return mod;
}

export function appListAvailable(): boolean {
  return !!native();
}

export function getInstalledApps(): InstalledApp[] {
  try {
    return (native()?.getInstalledApps() as InstalledApp[]) ?? [];
  } catch {
    return [];
  }
}
