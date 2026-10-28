// expo-local-authentication on the PC version: there is no screen lock the page can ask, so only the PIN unlocks.
export enum SecurityLevel { NONE = 0, SECRET = 1, BIOMETRIC_WEAK = 2, BIOMETRIC_STRONG = 3 }
export enum AuthenticationType { FINGERPRINT = 1, FACIAL_RECOGNITION = 2, IRIS = 3 }
export const hasHardwareAsync = async () => false;
export const isEnrolledAsync = async () => false;
export const getEnrolledLevelAsync = async () => SecurityLevel.NONE;
export const supportedAuthenticationTypesAsync = async () => [] as AuthenticationType[];
export const authenticateAsync = async (_o?: any) => ({ success: false as const, error: 'not_available', warning: undefined });
export const cancelAuthenticate = async () => {};
