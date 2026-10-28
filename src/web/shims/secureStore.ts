// expo-secure-store on the PC version: the few small secrets the app keeps (the PIN's salted hash, the active profile)
// in the page's own storage. A PC has no keystore the page can reach; the lock still hides content, as it does on a phone.
const P = 'sturoids.secure.';
const ls = () => (typeof localStorage !== 'undefined' ? localStorage : null);
export const AFTER_FIRST_UNLOCK = 0;
export const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY = 1;
export const ALWAYS = 2;
export const WHEN_UNLOCKED = 5;
export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 6;
export const isAvailableAsync = async () => !!ls();
export const getItemAsync = async (key: string, _o?: any) => ls()?.getItem(P + key) ?? null;
export const setItemAsync = async (key: string, value: string, _o?: any) => { ls()?.setItem(P + key, value); };
export const deleteItemAsync = async (key: string, _o?: any) => { ls()?.removeItem(P + key); };
export const getItem = (key: string) => ls()?.getItem(P + key) ?? null;
export const setItem = (key: string, value: string) => { ls()?.setItem(P + key, value); };
export const canUseBiometricAuthentication = () => false;
