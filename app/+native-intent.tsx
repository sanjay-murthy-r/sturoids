// What expo-share-intent asks of an expo-router app. A share reaches the app through the native module (the share
// intake reads it, src/shareIntake.tsx); a link that only names a share is not a page, so it opens Today at launch and
// changes nothing while the app is already open. Every other link goes where it says.

const SHARE_LINK = 'dataUrl=';

export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string {
  try {
    if (typeof path === 'string' && path.includes(SHARE_LINK)) return initial ? '/' : '';
    return path;
  } catch {
    return initial ? '/' : '';
  }
}
