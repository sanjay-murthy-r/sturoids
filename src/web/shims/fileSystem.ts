// expo-file-system on the PC version: the app's files (journal texts, note attachments, backups being made or read)
// kept in IndexedDB (../idb.ts) under the same file:// paths the app uses on a phone. Everything is held in memory once
// loaded, so the synchronous File API of 'expo-file-system/next' (which backups stream through) works too. Loading
// starts as soon as the module is first imported, long before anything reads a file.

import { IdbMap } from '../idb';

interface Entry { dir: boolean; data?: Uint8Array; mtime: number }

const files = new IdbMap<Entry>('files');
let mem: Map<string, Entry> | null = null;
export const fsReady: Promise<Map<string, Entry>> = files.load().then((m) => (mem = m));

export const documentDirectory = 'file:///sturoids/documents/';
export const cacheDirectory = 'file:///sturoids/cache/';
export const bundleDirectory = null;
export const EncodingType = { UTF8: 'utf8', Base64: 'base64' } as const;
export const FileSystemUploadType = { BINARY_CONTENT: 0, MULTIPART: 1 } as const;
export const FileSystemSessionType = { BACKGROUND: 0, FOREGROUND: 1 } as const;

const norm = (uri: string) => String(uri).replace(/\/+$/, '');
const parentOf = (p: string) => p.slice(0, p.lastIndexOf('/'));
const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(b64: string): Uint8Array {
  const s = atob(b64.replace(/\s/g, ''));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** The map, loaded (the sync API needs it there already; it is, a moment after launch). */
function m(): Map<string, Entry> {
  if (!mem) throw new Error('Files are still loading. Try again in a moment.');
  return mem;
}
const get = (uri: string) => m().get(norm(uri));
const put = (uri: string, e: Entry | undefined) => {
  const k = norm(uri);
  if (e) m().set(k, e);
  else m().delete(k);
  urls.delete(k);
  return files.write([[k, e]]);
};
function ensureParents(path: string) {
  const writes: Promise<void>[] = [];
  let p = parentOf(path);
  while (p.length > 'file://'.length && !get(p)) {
    writes.push(put(p, { dir: true, mtime: Date.now() }));
    p = parentOf(p);
  }
  return Promise.all(writes);
}
const childrenOf = (path: string) => [...m().keys()].filter((k) => k.startsWith(norm(path) + '/'));

export async function getInfoAsync(uri: string, _opts?: any) {
  await fsReady;
  const e = get(uri);
  if (!e) return { exists: false, isDirectory: false, uri };
  return { exists: true, isDirectory: e.dir, uri, size: e.data?.length ?? 0, modificationTime: e.mtime / 1000 };
}

export async function readAsStringAsync(uri: string, opts: { encoding?: string; position?: number; length?: number } = {}) {
  await fsReady;
  const e = get(uri);
  if (!e || e.dir) throw new Error('File ' + uri + ' does not exist.');
  let data = e.data ?? new Uint8Array();
  if (opts.position != null || opts.length != null) {
    const at = opts.position ?? 0;
    data = data.subarray(at, opts.length != null ? at + opts.length : undefined);
  }
  return opts.encoding === 'base64' ? toB64(data) : dec.decode(data);
}

export async function writeAsStringAsync(uri: string, contents: string, opts: { encoding?: string; append?: boolean } = {}) {
  await fsReady;
  const bytes = opts.encoding === 'base64' ? fromB64(contents) : enc.encode(contents);
  const prev = opts.append ? get(uri)?.data : undefined;
  const data = prev ? concat(prev, bytes) : bytes;
  await ensureParents(norm(uri));
  await put(uri, { dir: false, data, mtime: Date.now() });
}

function concat(a: Uint8Array, b: Uint8Array) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export async function deleteAsync(uri: string, opts: { idempotent?: boolean } = {}) {
  await fsReady;
  const e = get(uri);
  if (!e) {
    if (opts.idempotent) return;
    throw new Error('File ' + uri + ' does not exist.');
  }
  const gone = e.dir ? childrenOf(uri) : [];
  await Promise.all([...gone.map((k) => put(k, undefined)), put(uri, undefined)]);
}

export async function makeDirectoryAsync(uri: string, opts: { intermediates?: boolean } = {}) {
  await fsReady;
  const e = get(uri);
  if (e) {
    if (e.dir && opts.intermediates) return;
    if (e.dir) throw new Error('Directory ' + uri + ' already exists.');
  }
  await ensureParents(norm(uri));
  await put(uri, { dir: true, mtime: Date.now() });
}

export async function readDirectoryAsync(uri: string) {
  await fsReady;
  const base = norm(uri) + '/';
  const names = new Set<string>();
  for (const k of m().keys()) if (k.startsWith(base)) names.add(k.slice(base.length).split('/')[0]);
  return [...names];
}

async function bytesOf(from: string): Promise<Uint8Array> {
  if (/^(blob:|data:|https?:)/i.test(from)) {
    const r = await fetch(from);
    return new Uint8Array(await r.arrayBuffer());
  }
  await fsReady;
  const e = get(from);
  if (!e || e.dir) throw new Error('File ' + from + ' does not exist.');
  return e.data ?? new Uint8Array();
}

export async function copyAsync({ from, to }: { from: string; to: string }) {
  await fsReady;
  const e = get(from);
  if (e?.dir) {
    await makeDirectoryAsync(to, { intermediates: true });
    for (const k of childrenOf(from)) {
      const c = get(k)!;
      await put(norm(to) + k.slice(norm(from).length), { ...c, mtime: Date.now() });
    }
    return;
  }
  const data = await bytesOf(from);
  await ensureParents(norm(to));
  await put(to, { dir: false, data, mtime: Date.now() });
}

export async function moveAsync({ from, to }: { from: string; to: string }) {
  await copyAsync({ from, to });
  if (!/^(blob:|data:|https?:)/i.test(from)) await deleteAsync(from, { idempotent: true });
}

export async function downloadAsync(url: string, uri: string, opts?: { headers?: Record<string, string> }) {
  // the headers go with it: the cloud's attachments are fetched with the account's sign-in
  const r = await fetch(url, opts?.headers ? { headers: opts.headers } : undefined);
  if (!r.ok) return { uri, status: r.status, headers: {} as Record<string, string>, md5: undefined };
  const data = new Uint8Array(await r.arrayBuffer());
  await ensureParents(norm(uri));
  await put(uri, { dir: false, data, mtime: Date.now() });
  return { uri, status: r.status, headers: {} as Record<string, string>, md5: undefined };
}

export function createDownloadResumable(url: string, uri: string, _opts?: any, onProgress?: (p: { totalBytesWritten: number; totalBytesExpectedToWrite: number }) => void) {
  return {
    downloadAsync: async () => {
      const res = await downloadAsync(url, uri);
      const size = get(uri)?.data?.length ?? 0;
      onProgress?.({ totalBytesWritten: size, totalBytesExpectedToWrite: size });
      return res;
    },
    pauseAsync: async () => ({}),
    resumeAsync: async () => undefined,
    savable: () => ({}),
  };
}

export async function uploadAsync(url: string, uri: string, opts: { httpMethod?: string; headers?: Record<string, string> } = {}) {
  const body = await bytesOf(uri);
  const r = await fetch(url, { method: opts.httpMethod || 'POST', headers: opts.headers, body: body as BodyInit });
  return { status: r.status, body: await r.text(), headers: {} as Record<string, string> };
}

export const getFreeDiskStorageAsync = async () => 8 * 1024 * 1024 * 1024;
export const getTotalDiskCapacityAsync = async () => 64 * 1024 * 1024 * 1024;
export const getContentUriAsync = async (uri: string) => uri;

/* ---------------------------------------------------------------- shown in the page */

const urls = new Map<string, string>();
/**
 * A file the page can show (an attachment's picture or video): an object URL for it, made once. Null while files are
 * still loading or for a path that holds nothing; any other address is returned as it is.
 */
export function displayUrl(uri: string): string | null {
  if (!/^file:\/\/\/sturoids\//.test(uri)) return uri;
  if (!mem) return null;
  const k = norm(uri);
  const hit = urls.get(k);
  if (hit) return hit;
  const e = mem.get(k);
  if (!e?.data) return null;
  const url = URL.createObjectURL(new Blob([e.data as BlobPart]));
  urls.set(k, url);
  return url;
}

/* ---------------------------------------------------------------- the synchronous File API ('expo-file-system/next') */

class FileHandle {
  offset: number | null = 0;
  constructor(private uri: string) {}
  get size() { return get(this.uri)?.data?.length ?? 0; }
  readBytes(n: number): Uint8Array {
    const data = get(this.uri)?.data ?? new Uint8Array();
    const at = this.offset ?? 0;
    const out = data.slice(at, at + n);
    this.offset = at + out.length;
    return out;
  }
  writeBytes(bytes: Uint8Array) {
    const data = get(this.uri)?.data ?? new Uint8Array();
    const at = this.offset ?? data.length;
    const end = at + bytes.length;
    const next = end > data.length ? new Uint8Array(end) : data.slice();
    if (end > data.length) next.set(data, 0);
    next.set(bytes, at);
    m().set(norm(this.uri), { dir: false, data: next, mtime: Date.now() });
    this.offset = end;
  }
  close() {
    const e = get(this.uri);
    void put(this.uri, e);
  }
}

export class File {
  uri: string;
  constructor(...parts: (string | { uri: string })[]) {
    this.uri = parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/').replace(/([^:])\/\/+/g, '$1/');
  }
  get exists() { const e = get(this.uri); return !!e && !e.dir; }
  get size() { return get(this.uri)?.data?.length ?? 0; }
  create(_opts?: any) {
    void ensureParents(norm(this.uri));
    void put(this.uri, { dir: false, data: new Uint8Array(), mtime: Date.now() });
  }
  delete() { void put(this.uri, undefined); }
  open() { return new FileHandle(this.uri); }
  text() { return dec.decode(get(this.uri)?.data ?? new Uint8Array()); }
  bytes() { return get(this.uri)?.data ?? new Uint8Array(); }
  write(content: string | Uint8Array) {
    const data = typeof content === 'string' ? enc.encode(content) : content;
    void ensureParents(norm(this.uri));
    void put(this.uri, { dir: false, data, mtime: Date.now() });
  }
}

export class Directory {
  uri: string;
  constructor(...parts: (string | { uri: string })[]) {
    this.uri = parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/');
  }
  get exists() { return !!get(this.uri)?.dir; }
  create() { void put(this.uri, { dir: true, mtime: Date.now() }); }
  delete() { void deleteAsync(this.uri, { idempotent: true }); }
}

export const Paths = {
  get document() { return new Directory(documentDirectory); },
  get cache() { return new Directory(cacheDirectory); },
};
