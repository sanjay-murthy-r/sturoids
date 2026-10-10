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
 *   - a newer copy from another phone is followed only when this phone changed nothing (the decision, tested on its
 *     own), with a copy kept for the Undo; when both changed, the choice stays
 *   - attachments kept to Wi-Fi wait on mobile data while the data goes, and go once allowed or on Wi-Fi
 *   - a password reset by emailed code, and the password check behind Forgot PIN
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
    multiGet: async (keys) => keys.map((k) => [k, storage.has(k) ? storage.get(k) : null]),
    multiSet: async (pairs) => { for (const [k, v] of pairs) storage.set(k, v); },
    multiRemove: async (keys) => { for (const k of keys) storage.delete(k); },
  };

  // the cloud: one row per account, and the bucket as object path to bytes. `log` keeps the order things happened in.
  // `network` is what the phone is on; `offline` makes every auth call fail as an unanswered request would
  const world = {
    rows: new Map(Object.entries(rows)), files: new Map(Object.entries(files)), session, log: [], authCb: null,
    failUpsert: false, failDownload: new Set(), network: 'WIFI', offline: false, password: 'secret1', resetCode: null,
    toasts: [],
  };
  const offlineError = () => Object.assign(new Error('Network request failed'), { name: 'AuthRetryableFetchError', status: 0 });
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
      async signInWithPassword({ email, password }) {
        if (world.offline) return { data: { session: null }, error: offlineError() };
        if (password !== world.password) return { data: { session: null }, error: Object.assign(new Error('Invalid login credentials'), { status: 400 }) };
        world.session = sessionFor(email);
        if (world.authCb) world.authCb('SIGNED_IN', world.session);
        return { data: { session: world.session }, error: null };
      },
      async resetPasswordForEmail(email) {
        if (world.offline) return { data: null, error: offlineError() };
        world.log.push('reset code to ' + email);
        world.resetCode = '123456';
        return { data: {}, error: null };
      },
      async verifyOtp({ email, token, type }) {
        if (world.offline) return { data: { session: null }, error: offlineError() };
        world.log.push('verify ' + type);
        if (!world.resetCode || token !== world.resetCode) {
          return { data: { session: null }, error: Object.assign(new Error('Token has expired or is invalid'), { status: 403, code: 'otp_expired' }) };
        }
        world.resetCode = null; // a code works once
        world.session = sessionFor(email);
        if (world.authCb) world.authCb('SIGNED_IN', world.session);
        return { data: { session: world.session, user: world.session.user }, error: null };
      },
      async updateUser({ password }) {
        if (world.offline) return { data: null, error: offlineError() };
        if (!world.session) return { data: null, error: new Error('Auth session missing!') };
        if (password.length < 8) return { data: null, error: Object.assign(new Error('Password should be at least 8 characters.'), { code: 'weak_password' }) };
        world.password = password;
        return { data: { user: world.session.user }, error: null };
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
      if (spec === './components/Toast') return { toast: (message, action) => world.toasts.push({ message, action }) };
      if (spec === 'expo-network') {
        return {
          getNetworkStateAsync: async () => ({ type: world.network, isConnected: true }),
          addNetworkStateListener: (cb) => { world.netCb = cb; return { remove() {} }; },
        };
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

  async 'a newer copy is followed only from another phone, when this one changed nothing'() {
    const app = boot();
    const { newerCopyAction } = app.cloud;
    const base = {
      remoteAt: '2026-10-02T08:00:00.000Z', remoteDeviceId: 'dev-2', lastRemoteAt: T0, deviceId: 'dev-1',
      localHash: 'h1', lastHash: 'h1', savePending: false, declinedAt: null,
    };
    assert.equal(newerCopyAction(base), 'follow');
    const asks = {
      'this phone changed something': { localHash: 'h2' },
      'a change still waits to be saved': { savePending: true },
      'the copy is older than the one last seen': { remoteAt: '2026-09-30T08:00:00.000Z' },
      'the same copy': { remoteAt: T0 },
      'this phone wrote it': { remoteDeviceId: 'dev-1' },
      'nobody knows who wrote it': { remoteDeviceId: null },
      'a first sign-in (nothing seen yet)': { lastRemoteAt: null },
      'nothing sent yet': { lastHash: null },
      'the user undid following this very copy': { declinedAt: '2026-10-02T08:00:00.000Z' },
      'a time that is not one': { remoteAt: 'soon' },
    };
    for (const [why, change] of Object.entries(asks)) assert.equal(newerCopyAction({ ...base, ...change }), 'ask', why);
    assert.equal(newerCopyAction({ ...base, declinedAt: '2026-10-01T09:00:00.000Z' }), 'follow', 'an older undo says nothing about a newer copy');
    // the cloud's own times, with microseconds and an offset, as the database writes them
    const { isoTime } = app.cloud;
    assert.equal(isoTime('2026-10-09T15:56:08.222123+00:00'), Date.UTC(2026, 9, 9, 15, 56, 8, 222));
    assert.equal(isoTime('2026-10-09T21:26:08.5+05:30'), Date.UTC(2026, 9, 9, 15, 56, 8, 500));
    assert.equal(isoTime('2026-10-09T15:56:08Z'), Date.UTC(2026, 9, 9, 15, 56, 8));
    assert.ok(Number.isNaN(isoTime('yesterday')));
    assert.equal(newerCopyAction({ ...base, lastRemoteAt: '2026-10-01T08:00:00.000001+00:00', remoteAt: '2026-10-01T08:00:00.123456+00:00' }), 'follow');
  },

  async 'following a newer copy keeps a copy for the Undo, and the Undo turns it into a choice'() {
    const app = boot({ seed: { [KEY]: saved(SAM) }, rows: { [USER]: bigRow(800) }, meta: { lastRemoteAt: T0, lastHash: 'old', dirty: true } });
    await start(app);
    assert.equal(app.cloudState().status, 'idle');
    assert.equal(app.world.log.filter((l) => l === 'upsert').length, 1, 'this phone backed up first');
    // written on the tablet after this phone's own backup, by the cloud's clock
    const later = new Date(Date.now() + 60 * 1000).toISOString();
    app.world.rows.set(USER, {
      user_id: USER, snapshot: backupOf({ ...SAM, settings: { name: 'From the tablet' } }), device: 'Tablet', device_id: 'dev-2',
      bytes: 900, files: 0, updated_at: later,
    });
    app.store.flushSaves();
    await app.cloud.check(false);
    assert.equal(app.state().settings.name, 'From the tablet', 'the newer copy came here quietly');
    assert.equal(app.cloudState().status, 'idle');
    assert.equal(app.meta().lastRemoteAt, later);
    const kept = app.storage.get(app.store.RECOVERY_KEY);
    assert.ok(kept && kept.startsWith('{"_safety":'), "this phone's own data is kept for the Undo");
    assert.equal(app.store.readSnapshot(kept).data.settings.name, 'Sam', 'and reads as a backup');
    const t = app.world.toasts.find((x) => x.message === 'Updated from Tablet');
    assert.ok(t && t.action && t.action.label === 'Undo', 'a toast offers the Undo: ' + JSON.stringify(app.world.toasts));
    assert.equal(app.world.log.filter((l) => l === 'upsert').length, 1, 'nothing went up');

    t.action.onPress();
    await until(() => app.state().settings.name === 'Sam', 'the Undo');
    await until(() => app.cloudState().status === 'choice', 'the choice after the Undo');
    assert.equal(app.cloudState().reason, 'newer');
    assert.equal(app.storage.has(app.store.RECOVERY_KEY), false, 'the kept copy goes once used');
    assert.equal(app.meta().declinedAt, later);
    await app.cloud.check(false);
    assert.equal(app.state().settings.name, 'Sam', 'a copy undone is never followed again');
    assert.equal(app.cloudState().status, 'choice');
    assert.equal(app.world.log.filter((l) => l === 'upsert').length, 1, 'and nothing went over it');
    // the tablet writes again while the choice still waits: the choice is never made for the user by a quiet follow
    const again = new Date(Date.now() + 2 * 60 * 1000).toISOString();
    app.world.rows.set(USER, { ...app.world.rows.get(USER), snapshot: backupOf({ ...SAM, settings: { name: 'Tablet again' } }), updated_at: again });
    await app.cloud.check(false);
    assert.equal(app.state().settings.name, 'Sam', 'a later copy waits for the choice too');
    assert.equal(app.cloudState().status, 'choice');
    assert.equal(app.cloudState().remote.updatedAt, again, 'and the choice is about the newest copy');
  },

  async 'when both phones changed, the choice stays and nothing is replaced'() {
    const app = boot({ seed: { [KEY]: saved(SAM) }, rows: { [USER]: bigRow(800) }, meta: { lastRemoteAt: T0, lastHash: 'old', dirty: true } });
    await start(app);
    app.state().setSetting('name', 'Changed here');
    app.world.rows.set(USER, {
      user_id: USER, snapshot: backupOf({ ...SAM, settings: { name: 'Changed there' } }), device: 'Tablet', device_id: 'dev-2',
      bytes: 900, files: 0, updated_at: new Date(Date.now() + 60 * 1000).toISOString(),
    });
    app.store.flushSaves();
    await app.cloud.check(false);
    assert.equal(app.cloudState().status, 'choice');
    assert.equal(app.cloudState().reason, 'newer');
    assert.equal(app.state().settings.name, 'Changed here');
    assert.equal(app.storage.has(app.store.RECOVERY_KEY), false);
    assert.equal(app.world.toasts.length, 0);
  },

  async 'a Deep Work session under way here is never ended by following quietly'() {
    const app = boot({ seed: { [KEY]: saved(SAM) }, rows: { [USER]: bigRow(800) }, meta: { lastRemoteAt: T0, lastHash: 'old', dirty: true } });
    await start(app);
    const session = { mode: 'countdown', targetMin: 50, running: true, startTs: Date.now(), accumSec: 0, startedAt: Date.now(), subject: '' };
    app.state().setDeepWork(session);
    app.world.rows.set(USER, {
      user_id: USER, snapshot: backupOf({ ...SAM, settings: { name: 'From the tablet' } }), device: 'Tablet', device_id: 'dev-2',
      bytes: 900, files: 0, updated_at: new Date(Date.now() + 60 * 1000).toISOString(),
    });
    app.store.flushSaves();
    await app.cloud.check(false);
    assert.equal(app.cloudState().status, 'choice', 'the user chooses');
    assert.equal(app.state().settings.name, 'Sam');
    assert.ok(app.state().deepWork && app.state().deepWork.running, 'the session runs on');
    assert.equal(app.storage.has(app.store.RECOVERY_KEY), false);
  },

  async 'the open time stamped on a return, still waiting to be saved, does not stop a quiet follow'() {
    const app = boot({ seed: { [KEY]: saved(SAM) }, rows: { [USER]: bigRow(800) }, meta: { lastRemoteAt: T0, lastHash: 'old', dirty: true } });
    await start(app);
    app.world.rows.set(USER, {
      user_id: USER, snapshot: backupOf({ ...SAM, settings: { name: 'From the tablet' } }), device: 'Tablet', device_id: 'dev-2',
      bytes: 900, files: 0, updated_at: new Date(Date.now() + 60 * 1000).toISOString(),
    });
    app.store.flushSaves();
    app.state().setSetting('lastOpenedAt', Date.now());
    assert.equal(app.store.savePending(), true);
    await app.cloud.check(false);
    assert.equal(app.state().settings.name, 'From the tablet', 'followed once the pause had passed');
    assert.equal(app.cloudState().status, 'idle');
  },

  async 'a copy kept for an Undo goes at the next launch; a kept copy of unreadable data never does'() {
    const safety = '{"_safety":"x1","_app":"student-hub","_v":4,"settings":{"name":"Old"}}';
    const app = boot({ seed: { [KEY]: saved(SAM), 'student-hub-v1.recovery': safety }, rows: { [USER]: bigRow(800) }, meta: { lastRemoteAt: T0, lastHash: 'old', dirty: true } });
    await start(app);
    assert.equal(app.storage.has('student-hub-v1.recovery'), false);
    assert.ok(app.wipeCalls.includes('sweep'), 'what it kept on the phone is swept');
    const real = boot({ seed: { [KEY]: saved(SAM), 'student-hub-v1.recovery': '{"state":{},"version":5}' }, rows: { [USER]: bigRow(800) }, meta: { lastRemoteAt: T0, lastHash: 'old', dirty: true } });
    await start(real);
    assert.equal(real.storage.get('student-hub-v1.recovery'), '{"state":{},"version":5}');
  },

  async 'attachments kept to Wi-Fi wait on mobile data, and go once allowed or on Wi-Fi'() {
    const app = boot({ seed: { [KEY]: saved(SAM) }, rows: { [USER]: bigRow(800) }, meta: { lastRemoteAt: T0, lastHash: 'old', dirty: true } });
    app.world.network = 'CELLULAR';
    await until(() => app.store.hydrationSettled(), 'the store to load');
    const a = app.attach('v1', Buffer.alloc(3 * 1024 * 1024, 7));
    const n = app.state().addNote({ title: 'Lab video', body: '', folder: 'General' });
    app.store.useStore.setState((s) => ({ notes: s.notes.map((x) => (x.id === n ? { ...x, attachments: [a] } : x)) }));
    await start(app);
    assert.equal(app.world.log.filter((l) => l === 'upsert').length, 1, 'the data went');
    assert.ok(!app.world.log.some((l) => l.startsWith('upload')), 'the video did not');
    assert.equal(app.cloudState().note, 'Attachments wait for Wi-Fi');
    assert.equal(app.meta().filesWaiting, true);
    assert.equal(app.world.rows.get(USER).files, 0, 'the copy counts only what is there');
    assert.deepEqual(await app.cloud.mobileDataCost(), { bytes: 3 * 1024 * 1024, files: 1 });
    // "Back up now" again without agreeing sends nothing more
    await app.cloud.syncNow();
    assert.ok(!app.world.log.some((l) => l.startsWith('upload')));
    // agreeing sends it over mobile data, with the data unchanged
    await app.cloud.syncNow(false, { mobileData: true });
    assert.ok(app.world.log.includes('upload ' + USER + '/att/v1'));
    assert.equal(app.meta().filesWaiting, false);
    assert.equal(app.cloudState().note, null);
    assert.equal(app.world.rows.get(USER).files, 1);
    assert.equal(await app.cloud.mobileDataCost(), null, 'nothing waits now');

    // a second file waits, and goes by itself once the phone is on Wi-Fi
    const b = app.attach('v2', Buffer.from('a photo'));
    app.store.useStore.setState((s) => ({ notes: s.notes.map((x) => (x.id === n ? { ...x, attachments: [a, b] } : x)) }));
    await app.cloud.syncNow();
    assert.equal(app.meta().filesWaiting, true);
    app.world.network = 'WIFI';
    app.world.netCb({ type: 'WIFI', isConnected: true });
    await until(() => app.world.log.includes('upload ' + USER + '/att/v2'), 'the upload on Wi-Fi');
    await until(() => app.cloudState().status === 'idle' && app.meta().filesWaiting === false, 'the backup on Wi-Fi');
  },

  async 'a password reset by emailed code signs this phone in with the new password'() {
    const app = boot({ session: null });
    await start(app);
    assert.equal(app.cloudState().status, 'signed-out');
    assert.equal(await app.cloud.sendResetCode(' sam@example.com '), 'sent');
    assert.ok(app.world.log.includes('reset code to sam@example.com'));
    assert.equal(await app.cloud.resetPasswordWithCode('sam@example.com', '123456', 'short'), 'weak', 'checked before the code is spent');
    assert.equal(app.world.resetCode, '123456');
    assert.equal(await app.cloud.resetPasswordWithCode('sam@example.com', '000000', 'a good password'), 'wrong-code');
    assert.equal(await app.cloud.resetPasswordWithCode('sam@example.com', '12 34', 'a good password'), 'wrong-code');
    // the cloud turns a password down after the code is spent: a second try needs no new code
    assert.equal(await app.cloud.resetPasswordWithCode('sam@example.com', '123 456', 'seven7!'), 'weak');
    assert.equal(app.world.resetCode, null, 'the code was spent');
    assert.equal(await app.cloud.resetPasswordWithCode('sam@example.com', '123456', 'a good password'), 'ok');
    assert.equal(app.world.password, 'a good password');
    await until(() => app.cloudState().email === 'sam@example.com', 'signed in');
    app.world.offline = true;
    assert.equal(await app.cloud.sendResetCode('sam@example.com'), 'offline');
    assert.equal(await app.cloud.resetPasswordWithCode('ann@example.com', '123456', 'another password'), 'offline');
  },

  async 'Forgot PIN checks the account password by signing in again'() {
    const app = boot({ seed: { [KEY]: saved(SAM) }, rows: { [USER]: bigRow(800) }, meta: { lastRemoteAt: T0, lastHash: 'old', dirty: true } });
    await start(app);
    assert.equal(await app.cloud.verifyAccountPassword('secret1'), 'ok');
    assert.equal(await app.cloud.verifyAccountPassword('nope'), 'wrong');
    assert.equal(app.cloudState().status !== 'signed-out', true, 'a wrong password signs nobody out');
    app.world.offline = true;
    assert.equal(await app.cloud.verifyAccountPassword('secret1'), 'offline');
    const out = boot({ session: null });
    await start(out);
    assert.equal(await out.cloud.verifyAccountPassword('secret1'), 'signed-out');
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
