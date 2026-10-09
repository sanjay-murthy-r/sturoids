#!/usr/bin/env node
/*
 * Checks for src/cloud.ts, run against the real source and the real store in Node, over a fake Supabase (one backups
 * row per account, a storage bucket) and a real folder standing in for the phone:
 *   - a phone whose saved data could not be opened sends nothing and offers the cloud copy instead
 *   - an empty phone never empties a fuller cloud copy without asking
 *   - cloud files no note uses are removed only after the snapshot naming the rest is saved
 *   - signing out ends this phone's session only, and signing back in to the same account raises no false choice
 *   - when this phone was opened is not a change worth a backup
 *   - a same-phone restore keeps the files already here, never fetches them again, and survives a failed download
 *   - a session ended elsewhere is said; deleting the account ends every session
 * Usage: node scripts/test-cloud.js   (exit 1 on any failure)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');
const { createRequire } = require('module');

const ROOT = path.join(__dirname, '..');
const projectRequire = createRequire(path.join(ROOT, 'package.json'));
const ts = projectRequire('typescript');
const KEY = 'student-hub-v1';
const META_KEY = 'sturoids-cloud';
const USER = 'user-1';
const T0 = '2026-10-01T08:00:00.000Z';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PHONES = fs.mkdtempSync(path.join(os.tmpdir(), 'sturoids-cloud-'));
let phones = 0;

const sessionFor = (email = 'sam@example.com', id = USER) => ({ access_token: 'token', user: { id, email } });
const saved = (state) => JSON.stringify({ state, version: 5 });
const backupOf = (data) => JSON.stringify({ _app: 'student-hub', _v: 3, _exportedAt: T0, ...data });

/** Boots src/cloud.ts and src/store.ts in a fresh module registry, over its own storage, files and cloud. */
function boot({ seed = {}, rows = {}, files = {}, session = sessionFor(), meta } = {}) {
  const root = path.join(PHONES, String(++phones));
  const toPath = (uri) => {
    if (!uri.startsWith('file://')) throw new Error('not a file uri: ' + uri);
    return path.join(root, uri.slice('file://'.length));
  };
  const DOC = 'file:///doc/';
  const CACHE = 'file:///cache/';
  fs.mkdirSync(toPath(DOC + 'attachments/'), { recursive: true });
  fs.mkdirSync(toPath(CACHE), { recursive: true });

  const storage = new Map(Object.entries(seed));
  if (session) storage.set('sb-test-auth-token', '{}');
  if (meta) storage.set(META_KEY, JSON.stringify({ deviceId: 'dev-1', userId: USER, email: 'sam@example.com', auto: true, lastSyncedAt: 1, ...meta }));
  const asyncStorage = {
    getItem: async (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: async (k, v) => { storage.set(k, v); },
    removeItem: async (k) => { storage.delete(k); },
    getAllKeys: async () => [...storage.keys()],
  };

  // the cloud: one row per account, and the bucket as object path to bytes. `log` keeps the order things happened in
  const world = {
    rows: new Map(Object.entries(rows)), files: new Map(Object.entries(files)), session, log: [], authCb: null,
    failUpsert: false, failDownload: new Set(),
  };
  const objectPath = (url) => url.split('/storage/v1/object/')[1].replace(/^authenticated\//, '').replace(/^backups\//, '');
  const fileSystem = {
    documentDirectory: DOC,
    cacheDirectory: CACHE,
    FileSystemUploadType: { BINARY_CONTENT: 0 },
    async getInfoAsync(uri) {
      try {
        const st = fs.statSync(toPath(uri));
        return { exists: true, isDirectory: st.isDirectory(), size: st.size, uri, modificationTime: st.mtimeMs / 1000 };
      } catch {
        return { exists: false, isDirectory: false, uri };
      }
    },
    async makeDirectoryAsync(uri) { fs.mkdirSync(toPath(uri), { recursive: true }); },
    async deleteAsync(uri) { fs.rmSync(toPath(uri), { force: true, recursive: true }); },
    async moveAsync({ from, to }) { fs.renameSync(toPath(from), toPath(to)); },
    async readAsStringAsync(uri) { return fs.readFileSync(toPath(uri), 'utf8'); },
    async writeAsStringAsync(uri, text) { fs.writeFileSync(toPath(uri), text); },
    async readDirectoryAsync(uri) { return fs.readdirSync(toPath(uri)); },
    async uploadAsync(url, uri) {
      const p = objectPath(url);
      world.log.push('upload ' + p);
      world.files.set(p, fs.readFileSync(toPath(uri)));
      return { status: 200, body: '{}' };
    },
    async downloadAsync(url, uri) {
      const p = objectPath(url);
      world.log.push('download ' + p);
      // as on the phone, the body is written whatever the status
      if (!world.files.has(p) || world.failDownload.has(p)) {
        fs.writeFileSync(toPath(uri), '{"error":"failed"}');
        return { status: world.failDownload.has(p) ? 500 : 404, uri };
      }
      fs.writeFileSync(toPath(uri), world.files.get(p));
      return { status: 200, uri };
    },
  };
  const client = {
    auth: {
      async getSession() { return { data: { session: world.session } }; },
      onAuthStateChange(cb) { world.authCb = cb; return { data: { subscription: { unsubscribe() {} } } }; },
      async signOut(opts) {
        world.log.push('signOut ' + (opts && opts.scope));
        world.session = null;
        if (world.authCb) world.authCb('SIGNED_OUT', null);
        return { error: null };
      },
      async signInWithPassword({ email }) {
        world.session = sessionFor(email);
        if (world.authCb) world.authCb('SIGNED_IN', world.session);
        return { data: { session: world.session }, error: null };
      },
      async getUser() { return { data: { user: world.session ? world.session.user : null }, error: null }; },
      startAutoRefresh() {},
      stopAutoRefresh() {},
    },
    from(table) {
      assert.equal(table, 'backups');
      return {
        select() {
          return { eq(_, id) { return { async maybeSingle() { return { data: world.rows.get(id) || null, error: null }; } }; } };
        },
        upsert(row) {
          return {
            select() {
              return {
                async single() {
                  world.log.push('upsert');
                  if (world.failUpsert) return { data: null, error: { message: 'Network request failed' } };
                  // the server's own time, a moment after the phone's
                  const kept = { ...row, updated_at: new Date(Date.parse(row.updated_at) + 1).toISOString() };
                  world.rows.set(row.user_id, kept);
                  return { data: { updated_at: kept.updated_at }, error: null };
                },
              };
            },
          };
        },
        delete() { return { async eq(_, id) { world.rows.delete(id); return { error: null }; } }; },
      };
    },
    storage: {
      from() {
        return {
          async list(folder, { limit = 100, offset = 0 } = {}) {
            const names = [...world.files.keys()].filter((p) => p.startsWith(folder + '/')).map((p) => p.slice(folder.length + 1)).sort();
            return { data: names.slice(offset, offset + limit).map((name) => ({ name, metadata: { size: world.files.get(folder + '/' + name).length } })), error: null };
          },
          async remove(paths) {
            world.log.push('remove ' + paths.join(','));
            for (const p of paths) world.files.delete(p);
            return { error: null };
          },
        };
      },
    },
    async rpc(name) {
      if (name === 'my_storage_bytes') return { data: [...world.files.values()].reduce((n, b) => n + b.length, 0), error: null };
      if (name === 'delete_my_account') { world.log.push('delete account'); world.rows.delete(USER); return { error: null }; }
      return { data: null, error: null };
    },
  };

  const reactNative = {
    AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
    InteractionManager: { runAfterInteractions: (cb) => { setTimeout(cb, 0); return { cancel() {} }; } },
    Platform: { OS: 'android' },
  };
  const wipeCalls = [];
  const registry = new Map();
  const load = (file) => {
    if (registry.has(file)) return registry.get(file).exports;
    const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    });
    const mod = { exports: {} };
    registry.set(file, mod);
    const req = (spec) => {
      if (spec === '@react-native-async-storage/async-storage') return { __esModule: true, default: asyncStorage };
      if (spec === 'react-native') return reactNative;
      if (spec === 'react-native-url-polyfill/auto') return {};
      if (spec === 'expo-file-system') return fileSystem;
      if (spec === 'expo-constants') return { __esModule: true, default: { deviceName: 'Test phone', expoConfig: { version: '1.6.0' } } };
      if (spec === '@supabase/supabase-js') return { createClient: () => client };
      if (spec === './journal') {
        return { journalForBackup: async (entries) => entries.map((e) => ({ ...e, body: 'text of ' + e.id })), restoreBodies: async () => {} };
      }
      if (spec === './wipe') {
        return { afterReplace: () => wipeCalls.push('afterReplace'), sweepUnusedFiles: async () => { wipeCalls.push('sweep'); } };
      }
      if (spec.startsWith('.')) {
        const base = path.resolve(path.dirname(file), spec);
        const hit = [base + '.ts', base + '.tsx', path.join(base, 'index.ts')].find((p) => fs.existsSync(p));
        if (!hit) throw new Error('cannot resolve ' + spec + ' from ' + file);
        return load(hit);
      }
      return projectRequire(spec);
    };
    new Function('require', 'module', 'exports', '__DEV__', outputText)(req, mod, mod.exports, false);
    return mod.exports;
  };
  const store = load(path.join(ROOT, 'src', 'store.ts'));
  const cloud = load(path.join(ROOT, 'src', 'cloud.ts'));
  const { ATT_DIR } = load(path.join(ROOT, 'src', 'attachments.ts'));
  /** a file in the phone's attachment folder, as a note holds it */
  const attach = (id, bytes) => {
    const uri = ATT_DIR + id + '-clip.bin';
    if (bytes) fs.writeFileSync(toPath(uri), bytes);
    return { id, kind: 'file', uri, name: 'clip.bin' };
  };
  return {
    store, cloud, world, storage, wipeCalls, attach, toPath, ATT_DIR,
    state: () => store.useStore.getState(),
    cloudState: () => cloud.useCloud.getState(),
    meta: () => JSON.parse(storage.get(META_KEY) || '{}'),
  };
}

async function until(cond, label, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return;
    await sleep(5);
  }
  throw new Error('timed out waiting for ' + label);
}

/** Lets the store load, then the cloud start, as after the intro; waits for its first look to finish. */
async function start(app) {
  await until(() => app.store.hydrationSettled(), 'the store to load');
  await sleep(5);
  await app.cloud.initCloud();
  await until(() => app.cloudState().ready && app.cloudState().status !== 'syncing', 'the cloud to settle');
  await sleep(30);
  await until(() => app.cloudState().status !== 'syncing', 'the first look to finish');
}

const SAM = { settings: { name: 'Sam' }, dailyTasks: [{ id: 'd1', title: 'Read', doneOn: null, createdAt: 1 }] };
const bigRow = (bytes = 60000) => ({
  user_id: USER, snapshot: backupOf(SAM), device: 'Test phone', device_id: 'dev-1', bytes, files: 0, updated_at: T0,
});

const scenarios = {
  async 'a phone whose data could not be opened sends nothing and offers the cloud copy'() {
    const app = boot({ seed: { [KEY]: '{not json' }, rows: { [USER]: bigRow() }, meta: { lastRemoteAt: T0, lastHash: 'old', dirty: true } });
    await start(app);
    assert.equal(app.store.loadFailedThisLaunch(), true);
    const c = app.cloudState();
    assert.equal(c.status, 'choice');
    assert.equal(c.reason, 'rescue');
    app.state().setSetting('name', 'Typed on defaults');
    await app.cloud.syncNow();
    assert.ok(!app.world.log.some((l) => l === 'upsert' || l.startsWith('remove')), 'nothing went up: ' + app.world.log.join(' | '));
    assert.equal(app.world.rows.get(USER).snapshot, backupOf(SAM), 'the good copy is untouched');
    assert.equal(app.meta().rescue, true, 'the offer stands across launches');
    // bringing the cloud copy here gets the data back, and backing up carries on
    await app.cloud.restoreFromCloud();
    assert.equal(app.state().settings.name, 'Sam');
    assert.equal(app.cloudState().status, 'idle');
    assert.equal(app.meta().rescue, false);
    assert.deepEqual(app.wipeCalls, ['afterReplace', 'sweep']);
  },

  async 'keeping this phone after the offer sends it, and later changes go up as usual'() {
    const app = boot({ seed: { [KEY]: '{not json' }, rows: { [USER]: bigRow() }, meta: { lastRemoteAt: T0, lastHash: 'old', dirty: true } });
    await start(app);
    assert.equal(app.cloudState().reason, 'rescue');
    await app.cloud.keepThisPhone();
    assert.equal(app.world.log.filter((l) => l === 'upsert').length, 1);
    app.state().addDaily('A new start');
    await app.cloud.syncNow();
    assert.equal(app.cloudState().status, 'idle', 'the offer is not raised again');
    assert.equal(app.world.log.filter((l) => l === 'upsert').length, 2);
  },

  async 'an empty phone never empties a fuller cloud copy without asking'() {
    const app = boot({ rows: { [USER]: bigRow() }, meta: { lastRemoteAt: T0, lastHash: 'old', dirty: true } });
    await start(app);
    assert.equal(app.cloudState().status, 'choice');
    assert.equal(app.cloudState().reason, 'empty');
    assert.ok(!app.world.log.includes('upsert'), 'nothing went up');
    await app.cloud.check(false);
    assert.equal(app.cloudState().reason, 'empty', 'a later look keeps asking');
  },

  async 'cloud files no note uses go only after the snapshot is saved'() {
    const app = boot({
      rows: { [USER]: { ...bigRow(800), snapshot: backupOf({}) } },
      files: { [USER + '/att/old1']: Buffer.from('an old video') },
      meta: { lastRemoteAt: T0, lastHash: 'old', dirty: true },
    });
    await until(() => app.store.hydrationSettled(), 'the store to load');
    const a = app.attach('a1', Buffer.from('a photo'));
    app.state().addNote({ title: 'Waves', body: '', folder: 'General' });
    app.store.useStore.setState((s) => ({ notes: s.notes.map((n) => ({ ...n, attachments: [a] })) }));
    app.world.failUpsert = true;
    await start(app);
    assert.equal(app.cloudState().status, 'error');
    assert.ok(app.world.files.has(USER + '/att/old1'), 'a failed save removes nothing');
    app.world.failUpsert = false;
    await app.cloud.syncNow();
    assert.equal(app.cloudState().status, 'idle');
    assert.ok(!app.world.files.has(USER + '/att/old1'), 'the unused file goes once the copy is saved');
    assert.ok(app.world.files.has(USER + '/att/a1'), 'the note keeps its own');
    const lastUpsert = app.world.log.lastIndexOf('upsert');
    const removed = app.world.log.findIndex((l) => l.startsWith('remove'));
    assert.ok(removed > lastUpsert, 'removed after the save: ' + app.world.log.join(' | '));
  },

  async 'signing out ends this phone only, and signing back in raises no false choice'() {
    const app = boot({ seed: { [KEY]: saved(SAM) }, rows: { [USER]: bigRow(800) }, meta: { lastRemoteAt: T0, lastHash: 'old', dirty: true } });
    await start(app);
    assert.equal(app.cloudState().status, 'idle');
    assert.equal(app.world.log.filter((l) => l === 'upsert').length, 1);
    await app.cloud.signOut();
    assert.ok(app.world.log.includes('signOut local'), 'only this phone: ' + app.world.log.join(' | '));
    assert.equal(app.cloudState().status, 'signed-out');
    assert.equal(app.cloudState().lost, false, 'a sign-out asked for is not "signed out elsewhere"');
    await app.cloud.signIn('sam@example.com', 'secret1');
    await sleep(30);
    await until(() => app.cloudState().status !== 'syncing', 'the look after signing in');
    assert.equal(app.cloudState().status, 'idle', 'the copy this phone wrote is no surprise');
  },

  async 'when this phone was opened is not a change worth a backup'() {
    const app = boot({ seed: { [KEY]: saved(SAM) }, rows: { [USER]: bigRow(800) }, meta: { lastRemoteAt: T0, lastHash: 'old', dirty: true } });
    await start(app);
    const sent = app.world.log.filter((l) => l === 'upsert').length;
    assert.equal(app.cloudState().pending, false);
    app.state().setSetting('lastOpenedAt', Date.now());
    assert.equal(app.cloudState().pending, false, 'nothing waits');
    await app.cloud.syncNow();
    assert.equal(app.world.log.filter((l) => l === 'upsert').length, sent, 'nothing went up');
    app.state().setSetting('name', 'Samira');
    assert.equal(app.cloudState().pending, true, 'a real change waits');
  },

  async 'a same-phone restore keeps the files here and survives a failed download'() {
    const app = boot({ seed: { [KEY]: saved(SAM) } });
    await until(() => app.store.hydrationSettled(), 'the store to load');
    const here = Buffer.from('already here');
    const a = app.attach('a', here); // here and in the cloud, the same size: not fetched again
    const b = app.attach('b', Buffer.from('too large to go up')); // here, never sent up
    const c = app.attach('c', null); // only in the cloud
    const d = app.attach('d', Buffer.from('mine')); // here; the cloud's differs and its download fails
    const notes = [{ id: 'n1', title: 'T', body: '', folder: 'General', tags: [], pinned: false, createdAt: 1, updatedAt: 1, attachments: [a, b, c, d] }];
    app.world.rows.set(USER, { ...bigRow(900), snapshot: backupOf({ ...SAM, notes }) });
    app.world.files.set(USER + '/att/a', here);
    app.world.files.set(USER + '/att/c', Buffer.from('from the cloud'));
    app.world.files.set(USER + '/att/d', Buffer.from('a different copy'));
    app.world.failDownload.add(USER + '/att/d');
    await start(app);
    const { missing } = await app.cloud.restoreFromCloud();
    assert.equal(missing, 0);
    const downloads = app.world.log.filter((l) => l.startsWith('download')).sort();
    assert.deepEqual(downloads, ['download ' + USER + '/att/c', 'download ' + USER + '/att/d']);
    assert.deepEqual(fs.readFileSync(app.toPath(a.uri)), here);
    assert.equal(fs.readFileSync(app.toPath(b.uri), 'utf8'), 'too large to go up');
    assert.equal(fs.readFileSync(app.toPath(c.uri), 'utf8'), 'from the cloud');
    assert.equal(fs.readFileSync(app.toPath(d.uri), 'utf8'), 'mine', 'a failed download never touches the file here');
    assert.ok(!fs.readdirSync(app.toPath(app.ATT_DIR)).some((n) => n.endsWith('.part')), 'no pieces left behind');
    assert.deepEqual(app.state().notes[0].attachments.map((x) => x.uri), [a.uri, b.uri, c.uri, d.uri]);
  },

  async 'a session ended elsewhere is said, and deleting the account ends every session'() {
    const app = boot({ seed: { [KEY]: saved(SAM) }, rows: { [USER]: bigRow(800) }, meta: { lastRemoteAt: T0, lastHash: 'old', dirty: true } });
    await start(app);
    app.world.session = null;
    app.world.authCb('SIGNED_OUT', null);
    await sleep(5);
    assert.equal(app.cloudState().status, 'signed-out');
    assert.equal(app.cloudState().lost, true);
    await app.cloud.signIn('sam@example.com', 'secret1');
    await sleep(30);
    assert.equal(app.cloudState().lost, false);
    await until(() => app.cloudState().status !== 'syncing', 'the look after signing in');
    await app.cloud.deleteAccount();
    assert.ok(app.world.log.includes('signOut global'), 'every session: ' + app.world.log.join(' | '));
    assert.equal(app.cloudState().lost, false);
  },
};

(async () => {
  let failed = 0;
  for (const [name, run] of Object.entries(scenarios)) {
    try {
      await run();
      console.log('pass  ' + name);
    } catch (e) {
      failed++;
      console.log('FAIL  ' + name + '\n      ' + String(e && e.stack ? e.stack : e).split('\n').slice(0, 6).join('\n      '));
    }
  }
  fs.rmSync(PHONES, { recursive: true, force: true });
  console.log(failed ? `\ntest-cloud: ${failed} failed` : '\ntest-cloud: all passed');
  // the cloud's own waits (the pause after a change, a retry) would keep Node running
  process.exit(failed ? 1 : 0);
})();
