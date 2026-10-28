// expo-screen-capture on the PC version: a page cannot keep itself out of screenshots; locked content is still hidden
// until it is unlocked.
export const preventScreenCaptureAsync = async (_k?: string) => {};
export const allowScreenCaptureAsync = async (_k?: string) => {};
export const usePreventScreenCapture = (_k?: string) => {};
export const isAvailableAsync = async () => false;
export const addScreenshotListener = (_l: () => void) => ({ remove() {} });
export const removeScreenshotListener = (_s: { remove(): void }) => {};
