// expo-share-intent on the PC version: nothing is shared to a desktop app from other apps.
export function useShareIntent(_o?: any) {
  return { hasShareIntent: false, shareIntent: { text: null, webUrl: null, files: null, type: null }, resetShareIntent: () => {}, error: null, isReady: true };
}
export const ShareIntentProvider = ({ children }: { children: any }) => children;
export const useShareIntentContext = () => useShareIntent();
export type ShareIntentFile = { path: string; mimeType: string; fileName: string; size?: number };
