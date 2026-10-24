// Local Expo module (Android): restarts the app's process, so a profile switch starts every module afresh. Absent in
// Expo Go, in a dev client built without it and in an APK from before it: then restartApp() is false and the caller
// falls back (see src/profiles.ts).
import { requireOptionalNativeModule } from 'expo-modules-core';

interface AppRestartNative {
  restart(): boolean;
}

const native = requireOptionalNativeModule<AppRestartNative>('AppRestart');

/** Restarts the app. False when the module is missing or there was nothing to start; true never returns in practice. */
export function restartApp(): boolean {
  if (!native) return false;
  try {
    return native.restart() === true;
  } catch {
    return false;
  }
}
