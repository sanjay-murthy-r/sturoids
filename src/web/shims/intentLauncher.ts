// expo-intent-launcher on the PC version: Android's activities do not exist here (updates open the release instead).
export const startActivityAsync = async (..._a: any[]): Promise<never> => {
  throw new Error('Not available on a PC.');
};
export const ActivityAction = {} as Record<string, string>;
export const ResultCode = { Success: -1, Canceled: 0, FirstUser: 1 } as const;
