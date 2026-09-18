#!/usr/bin/env node
/*
 * Checks for src/backup.ts, run against the real source in Node over a real folder standing in for the phone:
 *   - base64 encoding and piecewise decoding agree with Node's own, at every awkward length
 *   - a backup with no attachments is the plain data, and reads back as it
 *   - a backup with attachments is valid JSON, its data reads back exactly (text that looks like the join, Tamil,
 *     emoji), and every file is restored byte for byte, including sizes on and around the chunk edges
 *   - a missing file is left out and counted; a file the platform reads in short pieces still restores whole
 *   - a backup cut short keeps the files before the cut and leaves no half-written file behind
 * Usage: node scripts/test-backup.js   (exit 1 on any failure)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert/strict');
const { createRequire } = require('module');

const ROOT = path.join(__dirname, '..');
const projectRequire = createRequire(path.join(ROOT, 'package.json'));
const ts = projectRequire('typescript');

const PHONE = fs.mkdtempSync(path.join(os.tmpdir(), 'sturoids-backup-'));
const toPath = (uri) => {
  if (!uri.startsWith('file://')) throw new Error('not a file uri: ' + uri);
  return path.join(PHONE, uri.slice('file://'.length));
};
const DOC = 'file:///doc/';
const CACHE = 'file:///cache/';
fs.mkdirSync(toPath(DOC), { recursive: true });
fs.mkdirSync(toPath(CACHE), { recursive: true });

// ---- the platform, as the app sees it
let shortReads = false;
const legacy = {
  documentDirectory: DOC,
  cacheDirectory: CACHE,
  async writeAsStringAsync(uri, text) { fs.writeFileSync(toPath(uri), text, 'utf8'); },
  async readAsStringAsync(uri) { return fs.readFileSync(toPath(uri), 'utf8'); },
  async getInfoAsync(uri) {
    try {
      const st = fs.statSync(toPath(uri));
      return { exists: true, isDirectory: st.isDirectory(), size: st.size, uri };
    } catch {
      return { exists: false, isDirectory: false, uri };
    }
  },
  async copyAsync({ from, to }) { fs.copyFileSync(toPath(from), toPath(to)); },
  async deleteAsync(uri) { fs.rmSync(toPath(uri), { force: true, recursive: true }); },
  async makeDirectoryAsync(uri) { fs.mkdirSync(toPath(uri), { recursive: true }); },
};

/** FileSystemFileHandle: a channel with a position; a read may come back short, as a full-length array. */
class Handle {
  constructor(p) { this.fd = fs.openSync(p, 'r+'); this.position = 0; }
  get size() { return fs.fstatSync(this.fd).size; }
  get offset() { return this.position; }
  set offset(v) { if (v != null) this.position = v; }
  readBytes(length) {
    const avail = Math.max(0, Math.min(length, this.size - this.position));
    const out = new Uint8Array(avail);
    const n = shortReads && avail > 7 ? Math.max(1, Math.floor(avail * Math.random())) : avail;
    const got = fs.readSync(this.fd, out, 0, n, this.position);
    this.position += got;
    return out;
  }
  writeBytes(bytes) {
    fs.writeSync(this.fd, bytes, 0, bytes.length, this.position);
    this.position += bytes.length;
  }
  close() { if (this.fd != null) { fs.closeSync(this.fd); this.fd = null; } }
}
class File {
  constructor(uri) { this.uri = uri; this.p = toPath(uri); }
  get exists() { return fs.existsSync(this.p) && fs.statSync(this.p).isFile(); }
  get size() { return this.exists ? fs.statSync(this.p).size : null; }
  create(opts = {}) {
    if (fs.existsSync(this.p) && !opts.overwrite) throw new Error('exists: ' + this.uri);
    fs.writeFileSync(this.p, '');
  }
  delete() { fs.rmSync(this.p); }
  open() { return new Handle(this.p); }
}

// ---- src/backup.ts, loaded with the platform above
function load(file, registry = new Map()) {
  if (registry.has(file)) return registry.get(file).exports;
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  });
  const mod = { exports: {} };
  registry.set(file, mod);
  const req = (spec) => {
    if (spec === 'expo-file-system') return legacy;
    if (spec === 'expo-file-system/next') return { File };
    if (spec.startsWith('.')) {
      const base = path.resolve(path.dirname(file), spec);
      const hit = [base + '.ts', base + '.tsx'].find((p) => fs.existsSync(p));
      if (!hit) throw new Error('cannot resolve ' + spec);
      return load(hit, registry);
    }
    return projectRequire(spec);
  };
  new Function('require', 'module', 'exports', outputText)(req, mod, mod.exports);
  return mod.exports;
}
const backup = load(path.join(ROOT, 'src', 'backup.ts'));
const { ATT_DIR } = load(path.join(ROOT, 'src', 'attachments.ts'));

const CHUNK = 3 * 256 * 1024;
const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name + '\n      ' + (e && e.stack || e)]);
  }
}

function attach(id, bytes) {
  fs.mkdirSync(toPath(ATT_DIR), { recursive: true });
  const uri = ATT_DIR + id + '-photo.bin';
  if (bytes) fs.writeFileSync(toPath(uri), bytes);
  return { id, kind: 'file', uri, name: 'photo.bin' };
}
const JOIN_TEXT = ',\n  "__sturoidsFiles": {';

function data(notes) {
  return {
    _app: 'student-hub', _v: 3,
    settings: { name: 'Sam' },
    notes,
    journal: [{ id: 'j1', body: 'ஒரு நாள் 🌙 and a line that says ' + JOIN_TEXT + ' in the middle' }],
  };
}

(async () => {
  await check('base64 matches Node at every awkward length, and decodes in any pieces', async () => {
    for (const n of [0, 1, 2, 3, 4, 5, 6, 7, 64, 255, 1000, 4097]) {
      const src = crypto.randomBytes(n);
      const enc = Buffer.from(backup.encodeBase64(new Uint8Array(src))).toString('latin1');
      assert.equal(enc, src.toString('base64'), 'encode ' + n);
      const dec = new backup.Base64Decoder();
      const ascii = Buffer.from(enc, 'latin1');
      const parts = [];
      for (let i = 0; i < ascii.length;) {
        const step = 1 + Math.floor(Math.random() * 7);
        parts.push(Buffer.from(dec.push(new Uint8Array(ascii.subarray(i, i + step)))));
        i += step;
      }
      parts.push(Buffer.from(dec.end()));
      assert.deepEqual(Buffer.concat(parts), src, 'decode ' + n);
    }
  });

  await check('no attachments: the backup is the plain data and reads back as it', async () => {
    const d = data([{ id: 'n1', title: 'T', body: 'B', attachments: [] }]);
    const json = JSON.stringify(d, null, 2);
    const uri = CACHE + 'plain.json';
    const w = await backup.writeBackup(uri, json, d.notes);
    assert.deepEqual(w, { carried: 0, missing: 0 });
    assert.equal(fs.readFileSync(toPath(uri), 'utf8'), json);
    const opened = await backup.openBackup(uri);
    assert.equal(opened.hasFiles, false);
    assert.deepEqual(JSON.parse(opened.json), d);
  });

  const roundTrip = async (label) => {
    const sizes = [0, 1, 2, 3, 4, 5, CHUNK - 1, CHUNK, CHUNK + 1, 2 * CHUNK + 2, 2_500_000];
    const files = {};
    const atts = sizes.map((n, k) => {
      const id = label + 'a' + k;
      files[id] = crypto.randomBytes(n);
      return attach(id, files[id]);
    });
    const gone = attach(label + 'gone', null);
    const foreign = { id: label + 'foreign', kind: 'image', uri: 'content://media/1', name: 'x.jpg' };
    const d = data([
      { id: 'n1', title: 'Waves', body: 'text ' + JOIN_TEXT, attachments: atts.slice(0, 5).concat([gone]) },
      { id: 'n2', title: 'Ünïcode 🌙', body: 'இரண்டு', attachments: atts.slice(5).concat([foreign]) },
    ]);
    const json = JSON.stringify(d, null, 2);
    const uri = CACHE + label + '-backup.json';
    const seen = [];
    const w = await backup.writeBackup(uri, json, d.notes, (p) => seen.push(p));
    assert.deepEqual(w, { carried: sizes.length, missing: 2 });
    assert.ok(seen.every((p, i) => i === 0 || p >= seen[i - 1]) && seen[seen.length - 1] === 1, 'progress rises to 1');

    // the whole file is valid JSON, and carries each file as base64
    const whole = JSON.parse(fs.readFileSync(toPath(uri), 'utf8'));
    for (const id of Object.keys(files)) {
      assert.deepEqual(Buffer.from(whole.__sturoidsFiles[id], 'base64'), files[id], 'embedded ' + id);
    }

    const opened = await backup.openBackup(uri);
    assert.equal(opened.hasFiles, true);
    assert.deepEqual(JSON.parse(opened.json), d, 'the data reads back exactly');

    // restore into a fresh attachment folder, as on a new phone
    fs.rmSync(toPath(ATT_DIR), { recursive: true, force: true });
    const restoredTo = {};
    const byId = Object.fromEntries(d.notes.flatMap((n) => n.attachments).map((a) => [a.id, a]));
    const result = await opened.restoreFiles((id) => {
      if (!byId[id]) return null;
      restoredTo[id] = backup.restoredPath(byId[id]);
      return restoredTo[id];
    });
    assert.equal(result.complete, true);
    const restored = result.files;
    assert.deepEqual(Object.keys(restored).sort(), Object.keys(files).sort());
    for (const id of Object.keys(files)) {
      assert.equal(restored[id], restoredTo[id]);
      assert.equal(restored[id], byId[id].uri, 'an attachment made here comes back under its old name');
      assert.deepEqual(fs.readFileSync(toPath(restored[id])), files[id], 'restored ' + id);
    }
  };

  await check('attachments: valid JSON, exact data, every file restored byte for byte', () => roundTrip('r'));

  await check('short reads from the platform still give whole files', async () => {
    shortReads = true;
    try {
      await roundTrip('s');
    } finally {
      shortReads = false;
    }
  });

  await check('a backup cut short keeps the files before the cut and leaves no half-written file', async () => {
    const small = crypto.randomBytes(1000);
    const big = crypto.randomBytes(3 * CHUNK);
    const a = attach('whole', small);
    const b = attach('cut', big);
    const d = data([{ id: 'n1', title: 'T', body: 'B', attachments: [a, b] }]);
    const uri = CACHE + 'cut.json';
    await backup.writeBackup(uri, JSON.stringify(d, null, 2), d.notes);
    const full = fs.readFileSync(toPath(uri));
    fs.writeFileSync(toPath(uri), full.subarray(0, Math.floor(full.length * 0.6)));
    const opened = await backup.openBackup(uri);
    assert.deepEqual(JSON.parse(opened.json), d);
    fs.rmSync(toPath(ATT_DIR), { recursive: true, force: true });
    const paths = { whole: backup.restoredPath(a), cut: backup.restoredPath(b) };
    const result = await opened.restoreFiles((id) => paths[id] ?? null);
    assert.equal(result.complete, false);
    assert.deepEqual(result.files, { whole: paths.whole });
    assert.deepEqual(fs.readFileSync(toPath(paths.whole)), small);
    assert.equal(fs.existsSync(toPath(paths.cut)), false);
  });

  fs.rmSync(PHONE, { recursive: true, force: true });
  let failed = 0;
  for (const [state, name] of results) {
    if (state !== 'ok') failed++;
    console.log(`${state === 'ok' ? '  ok  ' : '  FAIL'}  ${name}`);
  }
  console.log(failed ? `\n${failed} of ${results.length} failed` : `\nall ${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
