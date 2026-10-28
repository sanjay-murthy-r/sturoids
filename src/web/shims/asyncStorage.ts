// AsyncStorage on the PC version, over IndexedDB (see ../idb.ts): the same calls the app makes on a phone.
import { IdbMap } from '../idb';

const kv = new IdbMap<string>('kv');
type Cb = (e?: Error | null, r?: any) => void;
const wrap = async <T>(p: Promise<T>, cb?: Cb): Promise<T> => {
  try {
    const r = await p;
    cb?.(null, r);
    return r;
  } catch (e: any) {
    cb?.(e);
    throw e;
  }
};

const AsyncStorage = {
  getItem: (key: string, cb?: Cb) => wrap(kv.load().then((m) => m.get(key) ?? null), cb),
  setItem: (key: string, value: string, cb?: Cb) => wrap(kv.write([[key, String(value)]]), cb),
  removeItem: (key: string, cb?: Cb) => wrap(kv.write([[key, undefined]]), cb),
  mergeItem: (key: string, value: string, cb?: Cb) => wrap(kv.load().then((m) => {
    let next = value;
    try {
      next = JSON.stringify({ ...JSON.parse(m.get(key) || '{}'), ...JSON.parse(value) });
    } catch {
      // not two objects: the new value stands
    }
    return kv.write([[key, next]]);
  }), cb),
  getAllKeys: (cb?: Cb) => wrap(kv.load().then((m) => [...m.keys()]), cb),
  multiGet: (keys: readonly string[], cb?: Cb) => wrap(kv.load().then((m) => keys.map((k) => [k, m.get(k) ?? null] as [string, string | null])), cb),
  multiSet: (pairs: readonly (readonly [string, string])[], cb?: Cb) => wrap(kv.write(pairs.map(([k, v]) => [k, String(v)])), cb),
  multiRemove: (keys: readonly string[], cb?: Cb) => wrap(kv.write(keys.map((k) => [k, undefined])), cb),
  clear: (cb?: Cb) => wrap(kv.load().then((m) => kv.write([...m.keys()].map((k) => [k, undefined]))), cb),
  flushGetRequests: () => {},
};

export default AsyncStorage;
export const useAsyncStorage = (key: string) => ({
  getItem: (cb?: Cb) => AsyncStorage.getItem(key, cb),
  setItem: (v: string, cb?: Cb) => AsyncStorage.setItem(key, v, cb),
  removeItem: (cb?: Cb) => AsyncStorage.removeItem(key, cb),
  mergeItem: (v: string, cb?: Cb) => AsyncStorage.mergeItem(key, v, cb),
});
