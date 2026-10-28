// A small key-value store over IndexedDB for the PC version: the page's own storage (localStorage) holds only a few
// megabytes, and the app's saved rows, journal texts and attachments need far more. Each store keeps everything it
// holds in memory once it has loaded (reads are then instant, as AsyncStorage's are on a phone), and writes through
// to IndexedDB, in order.

const DB_NAME = 'sturoids';
const STORES = ['kv', 'files'] as const;
export type StoreName = (typeof STORES)[number];

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

const done = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error);
});

/** One IndexedDB store, mirrored in memory. */
export class IdbMap<V> {
  private mem: Map<string, V> | null = null;
  private loading: Promise<Map<string, V>> | null = null;
  /** writes go out one after another, so a later write never lands before an earlier one */
  private queue: Promise<void> = Promise.resolve();
  constructor(private store: StoreName) {}

  load(): Promise<Map<string, V>> {
    if (this.mem) return Promise.resolve(this.mem);
    if (this.loading) return this.loading;
    this.loading = db().then((d) => new Promise<Map<string, V>>((resolve, reject) => {
      const map = new Map<string, V>();
      const tx = d.transaction(this.store, 'readonly');
      const req = tx.objectStore(this.store).openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (c) {
          map.set(String(c.key), c.value as V);
          c.continue();
        } else {
          this.mem = map;
          resolve(map);
        }
      };
      req.onerror = () => reject(req.error);
    }));
    return this.loading;
  }

  /** Applies changes in memory at once and to IndexedDB in order; `undefined` deletes. */
  async write(changes: [string, V | undefined][]): Promise<void> {
    const map = await this.load();
    for (const [k, v] of changes) {
      if (v === undefined) map.delete(k);
      else map.set(k, v);
    }
    const run = async () => {
      const d = await db();
      const tx = d.transaction(this.store, 'readwrite');
      const os = tx.objectStore(this.store);
      for (const [k, v] of changes) {
        if (v === undefined) os.delete(k);
        else os.put(v, k);
      }
      await done(tx);
    };
    this.queue = this.queue.then(run, run);
    return this.queue;
  }
}
