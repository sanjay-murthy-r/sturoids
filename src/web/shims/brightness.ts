// expo-brightness on the PC version: a monitor's brightness is not the app's to set; ambient mode dims its own face.
export const getBrightnessAsync = async () => 1;
export const setBrightnessAsync = async (_v: number) => {};
export const restoreSystemBrightnessAsync = async () => {};
export const getSystemBrightnessAsync = async () => 1;
export const isAvailableAsync = async () => false;
export const requestPermissionsAsync = async () => ({ granted: false, status: 'denied' });
export const getPermissionsAsync = async () => ({ granted: false, status: 'denied' });
