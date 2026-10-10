import * as FileSystem from 'expo-file-system';
import type { File } from 'expo-file-system/next';
import { ATT_DIR } from './attachments';
import type { Attachment, Note } from './store';
import { uid } from './utils';

// A backup is one JSON file. Its data comes first, exactly as JSON.stringify(data, null, 2) writes it; the files
// attached to notes follow under one last top-level key, each as base64 by attachment id. Files are streamed in
// chunks on both sides, so a backup with long videos never has to fit in memory. The key is found again by its exact
// place: a comma, a newline and two spaces before it, which JSON can only produce at the top level (a newline inside
// a string is always escaped, and deeper keys sit further in). An older app reads the same file as plain JSON.

const FILES_KEY = '__sturoidsFiles';
/** what joins the files to the data; the data is everything before it */
const JOIN = ',\n  "' + FILES_KEY + '": {';
/** bytes read from a file at a time: a multiple of 3, so each chunk encodes to base64 without padding */
const CHUNK = 3 * 256 * 1024;
const SCAN = 1024 * 1024;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const ENC = new Uint8Array(64);
const DEC = new Int16Array(256).fill(-1);
for (let i = 0; i < 64; i++) {
  ENC[i] = B64.charCodeAt(i);
  DEC[B64.charCodeAt(i)] = i;
}
const EQ = 61;
const QUOTE = 34;
const COLON = 58;

type Handle = ReturnType<File['open']>;

// The streaming file API is loaded the first time a backup needs it, never at launch: if it ever failed to load,
// only the backup would say so.
let FileClass: typeof File | null = null;
function fileAt(uri: string): File {
  if (!FileClass) FileClass = (require('expo-file-system/next') as typeof import('expo-file-system/next')).File;
  return new FileClass(uri);
}
type Bytes = Uint8Array<ArrayBuffer>;

const ascii = (text: string): Bytes => {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0x7f;
  return out;
};
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Bytes to base64, as ASCII bytes. */
export function encodeBase64(src: Uint8Array): Bytes {
  const n = src.length;
  const out = new Uint8Array(Math.ceil(n / 3) * 4);
  let i = 0;
  let o = 0;
  for (; i + 2 < n; i += 3) {
    const v = (src[i] << 16) | (src[i + 1] << 8) | src[i + 2];
    out[o++] = ENC[v >> 18];
    out[o++] = ENC[(v >> 12) & 63];
    out[o++] = ENC[(v >> 6) & 63];
    out[o++] = ENC[v & 63];
  }
  if (i < n) {
    const two = i + 1 < n;
    const v = (src[i] << 16) | (two ? src[i + 1] << 8 : 0);
    out[o++] = ENC[v >> 18];
    out[o++] = ENC[(v >> 12) & 63];
    out[o++] = two ? ENC[(v >> 6) & 63] : EQ;
    out[o++] = EQ;
  }
  return out;
}

/** base64 (ASCII bytes) back to bytes, fed in pieces of any length. */
export class Base64Decoder {
  private acc = 0;
  private count = 0;
  push(src: Uint8Array): Bytes {
    const out = new Uint8Array(Math.floor(((this.count + src.length) * 3) / 4) + 3);
    let acc = this.acc;
    let count = this.count;
    let o = 0;
    for (let i = 0; i < src.length; i++) {
      const d = DEC[src[i]];
      if (d < 0) continue; // padding
      acc = (acc << 6) | d;
      if (++count === 4) {
        out[o++] = (acc >> 16) & 255;
        out[o++] = (acc >> 8) & 255;
        out[o++] = acc & 255;
        acc = 0;
        count = 0;
      }
    }
    this.acc = acc;
    this.count = count;
    return out.slice(0, o);
  }
  /** what the padding left over at the end */
  end(): Bytes {
    const { acc, count } = this;
    this.acc = 0;
    this.count = 0;
    if (count === 2) return Uint8Array.of((acc >> 4) & 255);
    if (count === 3) return Uint8Array.of((acc >> 10) & 255, (acc >> 2) & 255);
    return new Uint8Array(0);
  }
}

/** Reads exactly `length` bytes from `offset`, in as many reads as the file takes. */
function readRange(handle: Handle, offset: number, length: number): Bytes {
  const out = new Uint8Array(length);
  let got = 0;
  handle.offset = offset;
  while (got < length) {
    const before = handle.offset ?? offset + got;
    const bytes = handle.readBytes(length - got);
    const advanced = Math.min(bytes.length, (handle.offset ?? before + bytes.length) - before);
    if (advanced <= 0) throw new Error('The file ended early.');
    out.set(bytes.subarray(0, advanced), got);
    got += advanced;
  }
  return out;
}

/**
 * The attachments kept in Recently deleted, whose files stay on the phone for 30 days: a backup carries them with the
 * notes' own, and a restore writes them back. Read from the store when a backup needs them, never at load, so this
 * module stays free of the store.
 */
function trashedAttachmentsNow(): Attachment[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const store = require('./store') as typeof import('./store');
    return store.trashedAttachments(store.useStore.getState().trash);
  } catch {
    return [];
  }
}

/** Every attachment of these notes and of Recently deleted, once, with the file that holds it. */
function attachmentsOf(notes: Note[]): Attachment[] {
  const seen = new Set<string>();
  const out: Attachment[] = [];
  for (const a of [...notes.flatMap((n) => n.attachments ?? []), ...trashedAttachmentsNow()]) {
    if (!a || typeof a.id !== 'string' || typeof a.uri !== 'string' || seen.has(a.id)) continue;
    seen.add(a.id);
    out.push(a);
  }
  return out;
}

async function sizeOf(uri: string): Promise<number | null> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists && !info.isDirectory ? info.size ?? null : null;
  } catch {
    return null;
  }
}

/**
 * Roughly how many bytes a backup of this data and these notes' files takes (with those kept in Recently deleted),
 * before anything is written.
 */
export async function estimateBackupBytes(dataJson: string, notes: Note[]): Promise<number> {
  let bytes = dataJson.length * 1.1;
  for (const a of attachmentsOf(notes)) {
    const size = await sizeOf(a.uri);
    if (size != null) bytes += Math.ceil(size / 3) * 4 + 64;
  }
  return bytes;
}

export interface BackupWritten {
  /** attachment files carried in the backup */
  carried: number;
  /** attachments whose file could not be read (already gone from the phone) */
  missing: number;
}

/**
 * Writes a backup to `uri`: the data, then every file attached to its notes and to what Recently deleted keeps.
 * `onProgress` gets 0..1 as the files are written. A file that can no longer be found is left out and counted as missing; one that fails half way fails
 * the whole backup, which is then removed rather than left looking complete.
 */
export async function writeBackup(
  uri: string, dataJson: string, notes: Note[], onProgress?: (share: number) => void,
): Promise<BackupWritten> {
  // anything outside the app's own folders (a picker's original, when copying it in failed) is read from a copy
  const temps: string[] = [];
  const sources: { id: string; uri: string; size: number }[] = [];
  let missing = 0;
  for (const a of attachmentsOf(notes)) {
    let from = a.uri;
    if (!from.startsWith('file://')) {
      try {
        const tmp = FileSystem.cacheDirectory + 'backup-src-' + uid();
        await FileSystem.copyAsync({ from, to: tmp });
        temps.push(tmp);
        from = tmp;
      } catch {
        missing++;
        continue;
      }
    }
    const size = await sizeOf(from);
    if (size == null) {
      missing++;
      continue;
    }
    sources.push({ id: a.id, uri: from, size });
  }
  if (!sources.length || !dataJson.endsWith('\n}')) {
    await FileSystem.writeAsStringAsync(uri, dataJson);
    return { carried: 0, missing };
  }

  // the data without its closing brace; the files follow and close it
  await FileSystem.writeAsStringAsync(uri, dataJson.slice(0, -2));
  const total = sources.reduce((sum, s) => sum + s.size, 0) || 1;
  let done = 0;
  let carried = 0;
  let written = false;
  const out = fileAt(uri).open();
  try {
    out.offset = out.size ?? 0;
    out.writeBytes(ascii(JOIN));
    for (const s of sources) {
      const src = fileAt(s.uri).open();
      try {
        out.writeBytes(ascii((carried ? ',' : '') + '\n    "' + s.id + '": "'));
        for (let pos = 0; pos < s.size; pos += CHUNK) {
          const n = Math.min(CHUNK, s.size - pos);
          out.writeBytes(encodeBase64(readRange(src, pos, n)));
          done += n;
          onProgress?.(done / total);
          await pause();
        }
        out.writeBytes(ascii('"'));
        carried++;
      } finally {
        src.close();
      }
    }
    out.writeBytes(ascii('\n  }\n}\n'));
    written = true;
  } finally {
    out.close();
    for (const t of temps) FileSystem.deleteAsync(t, { idempotent: true }).catch(() => {});
    if (!written) FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
  }
  onProgress?.(1);
  return { carried, missing };
}

export interface BackupOpened {
  /** the backup's data, ready for importSnapshot */
  json: string;
  /** whether the backup carries attachment files */
  hasFiles: boolean;
  /**
   * Writes the carried files into the notes' attachment folder. `target(id)` names the file for an attachment (or
   * null to skip it); one it skips that Recently deleted keeps (the backup's data is in place by now) goes to its own
   * place there. Resolves with the attachments restored, by id, with their new files, and whether every file
   * could be read: one cut short stops the restore there, keeping those already written, and a file already at its
   * place stays as it was unless a whole one replaces it.
   */
  restoreFiles: (target: (id: string) => string | null, onProgress?: (share: number) => void) => Promise<Restored>;
}

export interface Restored {
  files: Record<string, string>;
  complete: boolean;
}

/**
 * Finds `needle` in the file, reading it in pieces. -1 when it is not there. It lets the screen draw between pieces,
 * so a long backup's scan never freezes the "Reading backup" label it shows.
 */
async function findInFile(handle: Handle, size: number, needle: Uint8Array): Promise<number> {
  let carry: Uint8Array = new Uint8Array(0);
  const first = needle[0];
  for (let pos = 0; pos < size; pos += SCAN) {
    if (pos) await pause();
    const piece = readRange(handle, pos, Math.min(SCAN, size - pos));
    const hay = new Uint8Array(carry.length + piece.length);
    hay.set(carry, 0);
    hay.set(piece, carry.length);
    const base = pos - carry.length;
    outer: for (let i = 0; i + needle.length <= hay.length; i++) {
      if (hay[i] !== first) continue;
      for (let j = 1; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
      return base + i;
    }
    carry = hay.slice(Math.max(0, hay.length - (needle.length - 1)));
  }
  return -1;
}

/** Opens a backup: its data at once, its files (when it carries any) once they are asked for. */
export async function openBackup(uri: string): Promise<BackupOpened> {
  const size = fileAt(uri).size ?? 0;
  const scan = fileAt(uri).open();
  let at = -1;
  try {
    at = await findInFile(scan, size, ascii(JOIN));
  } finally {
    scan.close();
  }
  if (at < 0) {
    return {
      json: await FileSystem.readAsStringAsync(uri),
      hasFiles: false,
      restoreFiles: async () => ({ files: {}, complete: true }),
    };
  }

  // the data is copied out on its own, so the platform reads it as text, never byte by byte here
  const dataUri = FileSystem.cacheDirectory + 'backup-data-' + uid() + '.json';
  let json: string;
  const src = fileAt(uri).open();
  try {
    const dataFile = fileAt(dataUri);
    dataFile.create({ overwrite: true });
    const out = dataFile.open();
    try {
      for (let pos = 0; pos < at; pos += SCAN) out.writeBytes(readRange(src, pos, Math.min(SCAN, at - pos)));
    } finally {
      out.close();
    }
    json = (await FileSystem.readAsStringAsync(dataUri)) + '\n}';
  } finally {
    src.close();
    FileSystem.deleteAsync(dataUri, { idempotent: true }).catch(() => {});
  }

  const filesStart = at + JOIN.length;
  const restoreFiles: BackupOpened['restoreFiles'] = async (target, onProgress) => {
    const restored: Record<string, string> = {};
    const trashed = new Map(trashedAttachmentsNow().map((a) => [a.id, a]));
    const placeFor = (id: string): string | null => {
      const named = target(id);
      if (named) return named;
      const kept = trashed.get(id);
      return kept ? restoredPath(kept) : null;
    };
    await FileSystem.makeDirectoryAsync(ATT_DIR, { intermediates: true }).catch(() => {});
    const reader = fileAt(uri).open();
    const span = Math.max(1, size - filesStart);
    let pos = filesStart;
    let buf: Bytes = new Uint8Array(0);
    let i = 0;
    const more = () => {
      if (pos >= size) return false;
      const n = Math.min(SCAN, size - pos);
      buf = readRange(reader, pos, n);
      pos += n;
      i = 0;
      return true;
    };
    const peek = (): number => (i < buf.length || more() ? buf[i] : -1);
    const skipSpace = () => {
      for (let c = peek(); c === 32 || c === 10 || c === 13 || c === 9 || c === 44; c = peek()) i++;
    };
    const damaged = () => new Error('The backup file is damaged or cut short.');
    let complete = true;
    try {
      for (;;) {
        skipSpace();
        if (peek() !== QUOTE) break; // the closing brace, or the end
        i++;
        let id = '';
        for (let c = peek(); c !== QUOTE; c = peek()) {
          if (c < 0 || id.length > 200) throw damaged();
          id += String.fromCharCode(c);
          i++;
        }
        i++;
        skipSpace();
        if (peek() !== COLON) throw damaged();
        i++;
        skipSpace();
        if (peek() !== QUOTE) throw damaged();
        i++;

        const dest = placeFor(id);
        // written beside its place and moved over it only once whole, so a backup cut short (or any failure) never
        // touches the file this phone already has there
        const part = dest ? dest + '.part' : null;
        let partFile: File | null = null;
        let out: Handle | null = null;
        try {
          if (part) {
            partFile = fileAt(part);
            if (partFile.exists) partFile.delete();
            partFile.create();
            out = partFile.open();
          }
          const decoder = new Base64Decoder();
          for (;;) {
            if (i >= buf.length && !more()) throw damaged();
            const quote = buf.indexOf(QUOTE, i);
            const end = quote >= 0 ? quote : buf.length;
            const bytes = decoder.push(buf.subarray(i, end));
            if (out && bytes.length) out.writeBytes(bytes);
            i = end;
            if (quote >= 0) {
              i++;
              const tail = decoder.end();
              if (out && tail.length) out.writeBytes(tail);
              break;
            }
            onProgress?.(Math.min(1, (pos - filesStart) / span));
            await pause();
          }
          out?.close();
          out = null;
          if (dest && part) {
            await FileSystem.moveAsync({ from: part, to: dest });
            restored[id] = dest;
          }
        } catch (e) {
          // a half-written file is never left behind looking like a whole one
          out?.close();
          out = null;
          try { if (partFile?.exists) partFile.delete(); } catch {}
          throw e;
        }
      }
    } catch {
      complete = false;
    } finally {
      reader.close();
    }
    onProgress?.(1);
    return { files: restored, complete };
  };

  return { json, hasFiles: true, restoreFiles };
}

/** Where a restored attachment's file goes: the attachment folder, under its old name when it had one there. */
export function restoredPath(a: Attachment): string {
  const tail = a.uri.split('/').pop() || '';
  const name = tail && a.uri.includes('/attachments/')
    ? tail
    : uid() + '-' + (a.name || 'file').replace(/[^\w.\-]/g, '_');
  return ATT_DIR + name;
}
