#!/usr/bin/env node
/*
 * Checks for src/profiles.ts and the per-profile keys around it, run against the real source in Node (no device, no
 * Metro), over an in-memory AsyncStorage, keystore and file system:
 *   - which profile is in use is read from the keystore, and anything that is not a profile id opens the first one
 *   - pkey / pdir: the first profile keeps the old keys and folders, another's carry its id
 *   - the store, the attachments and the journal follow the profile in use; the first profile's old single row is never
 *     read or removed by another
 *   - removing a profile takes only its own keys ('__abc' never matches '__abcd'), its folder, its PIN and its session;
 *     the profile in use and the first one are refused
 *   - the registry is cleaned (duplicates, junk ids, colours, the first profile first) and a profile whose entry was
 *     lost comes back from its data; one that could not be read is never written over
 *   - a fresh profile takes the name and colour it was made with; one renamed from another profile adopts the name
 *   - a switch writes what waits, cancels every reminder, names the new profile and restarts; it is refused while a
 *     Deep Work session runs or a backup is being sent; the launch it starts is recognised for a minute only
 *   - one cloud account per profile: another profile's account is found without regard to case
 * Usage: node scripts/test-profiles.js   (exit 1 on any failure)
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { createRequire } = require('module');

const ROOT = path.join(__dirname, '..');
const projectRequire = createRequire(path.join(ROOT, 'package.json'));
const ts = projectRequire('typescript');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const A = 'abcdefghij';
const Z = 'zyxwvutsrq';
const DOC = 'file:///doc/';

/**
 * Boots src/profiles.ts (and, through it, the real store) in a fresh module registry. `active` is what the keystore
 * names; `storage` and `secure` can be shared between boots, as one phone's are between launches.
 */
function boot({ active, storage = new Map(), secure = new Map(), secureThrows = false, cloudStatus = 'idle', registryFails = false } = {}) {
  if (active !== undefined) secure.set('sturoids.profile.active', active);
  const log = [];
  const toasts = [];
  const removedDirs = [];
  let writeGate = null;
  const asyncStorage = {
    getItem: async (k) => {
      if (registryFails && k === 'sturoids-profiles') throw new Error('storage is busy');
      return storage.has(k) ? storage.get(k) : null;
    },
    setItem: async (k, v) => { storage.set(k, v); },
    removeItem: async (k) => { storage.delete(k); },
    getAllKeys: async () => [...storage.keys()],
    multiGet: async (keys) => keys.map((k) => [k, storage.has(k) ? storage.get(k) : null]),
    multiSet: async (pairs) => {
      if (writeGate) await writeGate;
      for (const [k, v] of pairs) storage.set(k, v);
      log.push('rows written');
    },
    multiRemove: async (keys) => { for (const k of keys) storage.delete(k); },
  };
  const fileSystem = {
    documentDirectory: DOC,
    cacheDirectory: 'file:///cache/',
    async deleteAsync(uri) { removedDirs.push(uri); },
    async readAsStringAsync() { return ''; },
    async writeAsStringAsync() {},
    async makeDirectoryAsync() {},
    async readDirectoryAsync() { return []; },
  };
  const secureStore = {
    getItem: (k) => { if (secureThrows) throw new Error('keystore unavailable'); return secure.has(k) ? secure.get(k) : null; },
    setItem: (k, v) => { secure.set(k, v); },
    getItemAsync: async (k) => (secure.has(k) ? secure.get(k) : null),
    setItemAsync: async (k, v) => { secure.set(k, v); },
    deleteItemAsync: async (k) => { secure.delete(k); },
  };
  const reactNative = {
    AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
    BackHandler: { exitApp: () => log.push('exit') },
    DevSettings: { reload: () => log.push('reload') },
    Platform: { OS: 'android', select: (o) => o.android ?? o.default },
  };
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
      if (spec === 'expo-file-system') return fileSystem;
      if (spec === 'expo-secure-store') return secureStore;
      if (spec === 'expo-notifications') return { cancelAllScheduledNotificationsAsync: async () => { log.push('reminders cancelled'); } };
      if (spec === './components/Toast') return { toast: (m) => toasts.push(m) };
      if (spec === './cloud') return { useCloud: { getState: () => ({ status: cloudStatus }) } };
      if (spec === './notifications') return { rescheduleAllReminders: async () => { log.push('reminders laid out'); } };
      if (spec === '../modules/app-restart') return { restartApp: () => { log.push('restart'); return true; } };
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
  const profiles = load(path.join(ROOT, 'src', 'profiles.ts'));
  const store = load(path.join(ROOT, 'src', 'store.ts'));
  return {
    profiles, store, storage, secure, log, toasts, removedDirs, load,
    gateWrites() { let open; writeGate = new Promise((r) => { open = r; }); return () => { writeGate = null; open(); }; },
    registry: () => JSON.parse(storage.get('sturoids-profiles') || 'null'),
    state: () => store.useStore.getState(),
  };
}

async function settled(app) {
  for (let i = 0; i < 400; i++) {
    if (app.store.hydrationSettled()) { await sleep(5); return; }
    await sleep(5);
  }
  throw new Error('hydration never settled');
}

/** Boots, lets the store load and the registry be read, as the root layout does. */
async function start(opts) {
  const app = boot(opts);
  await settled(app);
  await app.profiles.loadProfiles();
  await sleep(10);
  return app;
}

const entry = (id, name, extra = {}) => ({ id, name, color: '#4FC4B8', email: null, createdAt: id === 'main' ? 0 : 10, ...extra });
const seedRegistry = (storage, list) => storage.set('sturoids-profiles', JSON.stringify({ v: 1, list }));

const scenarios = {
  'the keystore names the profile in use; anything else opens the first profile'() {
    assert.equal(boot({ active: A }).profiles.activeProfile, A);
    assert.equal(boot({ active: 'main' }).profiles.activeProfile, 'main');
    assert.equal(boot({}).profiles.activeProfile, 'main', 'nothing saved yet');
    for (const junk of ['ABCDEFGHIJ', 'abc', 'abcdefghijk', '../etc', '', 'main ']) {
      assert.equal(boot({ active: junk }).profiles.activeProfile, 'main', 'junk: ' + JSON.stringify(junk));
    }
    assert.equal(boot({ active: A, secureThrows: true }).profiles.activeProfile, 'main', 'an unreadable keystore');
  },

  'an avatar\'s initial is a whole letter, even for a name that opens with an emoji'() {
    const { profiles: m } = boot({ active: 'main' });
    assert.equal(m.profileInitial({ name: 'priya k', email: null }), 'P');
    assert.equal(m.profileInitial({ name: '', email: 'arun.s@x.com' }), 'A', 'from the email when there is no name');
    assert.equal(m.profileInitial({ name: '\u{1F393} Sam', email: null }), '\u{1F393}', 'no half of a surrogate pair');
    assert.equal(m.profileInitial({ name: '', email: null }), '');
  },

  'pkey and pdir keep the first profile\'s keys and folders, and suffix another\'s'() {
    const { profiles: m } = boot({ active: 'main' });
    assert.equal(m.pkey('student-hub-v2'), 'student-hub-v2');
    assert.equal(m.pdir('journal/'), DOC + 'journal/');
    assert.equal(m.sessionKey(), null, 'the first profile keeps Supabase\'s default session key');
    assert.equal(m.pkey('sturoids.pin.v2', A), 'sturoids.pin.v2__' + A, 'another id given');
    const { profiles: a } = boot({ active: A });
    assert.equal(a.pkey('student-hub-v2'), 'student-hub-v2__' + A);
    assert.equal(a.pkey('sturoids-cloud', 'main'), 'sturoids-cloud', 'the first profile named outright');
    assert.equal(a.pdir('attachments/'), DOC + 'profiles/' + A + '/attachments/');
    assert.equal(a.pdir('', Z), DOC + 'profiles/' + Z + '/');
    assert.equal(a.sessionKey(), 'sb-sturoids-auth__' + A);
    assert.ok(/^[\w.-]+$/.test(a.pkey('sturoids.pinAttempts.v2')), 'a valid keystore key');
  },

  async 'the store, attachments and journal follow the profile in use, and leave the first profile\'s rows alone'() {
    const storage = new Map([
      ['student-hub-v1', JSON.stringify({ state: { settings: { name: 'Main' } }, version: 5 })],
      ['student-hub-v1.recovery', 'main kept copy'],
    ]);
    const app = await start({ active: A, storage });
    assert.equal(app.state().settings.name, '', 'the first profile\'s old single row is not this profile\'s');
    assert.equal(app.store.RECOVERY_KEY, 'student-hub-v1.recovery__' + A);
    assert.equal(await app.store.readRecoveryCopy(), null, 'the first profile\'s kept copy is not this profile\'s');
    app.state().setSetting('name', 'Priya');
    await sleep(5);
    await app.store.flushSaves();
    const mine = [...storage.keys()].filter((k) => k.startsWith('student-hub-v2'));
    assert.ok(mine.length > 0, 'rows were written');
    for (const k of mine) assert.ok(k.startsWith('student-hub-v2__' + A + ':'), 'a row under the profile: ' + k);
    assert.ok(storage.has('student-hub-v2__' + A + ':meta'));
    assert.ok(storage.has('student-hub-v1'), 'the first profile\'s old single row stays');
    assert.equal(storage.get('student-hub-v1.recovery'), 'main kept copy');
    await app.store.clearSavedData();
    assert.ok(storage.has('student-hub-v1'), 'erasing this profile never takes the first profile\'s row');
    const { ATT_DIR } = app.load(path.join(ROOT, 'src', 'attachments.ts'));
    assert.equal(ATT_DIR, DOC + 'profiles/' + A + '/attachments/');
    const { JOURNAL_DIR } = app.load(path.join(ROOT, 'src', 'journal.ts'));
    assert.equal(JOURNAL_DIR, DOC + 'profiles/' + A + '/journal/');
    const main = await start({ active: 'main' });
    assert.equal(main.load(path.join(ROOT, 'src', 'attachments.ts')).ATT_DIR, DOC + 'attachments/');
    assert.equal(main.load(path.join(ROOT, 'src', 'journal.ts')).JOURNAL_DIR, DOC + 'journal/');
  },

  async 'a flush resolves only once its rows are on the disk'() {
    const app = await start({ active: A });
    const open = app.gateWrites();
    app.state().setSetting('name', 'Sam');
    await sleep(5);
    let done = false;
    const flushed = app.store.flushSaves().then(() => { done = true; });
    await sleep(20);
    assert.equal(done, false, 'still writing');
    // a second flush with nothing new waits for the first write too
    let second = false;
    app.store.flushSaves().then(() => { second = true; });
    await sleep(5);
    assert.equal(second, false);
    open();
    await flushed;
    await sleep(5);
    assert.equal(second, true);
    assert.ok(app.log.includes('rows written'));
  },

  'the removal filter takes a profile\'s own keys and nothing else'() {
    const { profiles: p } = boot({ active: 'main' });
    const all = [
      'student-hub-v2:meta', 'student-hub-v2:notes', 'student-hub-v1', 'sturoids-cloud', 'sb-imvydxgapirnkuvayimn-auth-token',
      'sturoids-profiles', 'sturoids-switched',
      'student-hub-v2__' + A + ':meta', 'student-hub-v2__' + A + ':notes', 'sturoids-cloud__' + A, 'sturoids-last-export__' + A,
      'student-hub-v1.recovery__' + A, 'sb-sturoids-auth__' + A, 'sb-sturoids-auth__' + A + '-code-verifier',
      'student-hub-v2__' + Z + ':meta', 'sturoids-cloud__' + Z,
      // a longer suffix that begins with the id is someone else's
      'student-hub-v2__' + A + 'k:meta', 'sturoids-cloud__' + A + 'k', 'x__' + A.slice(0, 9),
    ];
    const mine = p.keysOfProfile(all, A).sort();
    assert.deepEqual(mine, [
      'sb-sturoids-auth__' + A, 'sb-sturoids-auth__' + A + '-code-verifier', 'student-hub-v1.recovery__' + A,
      'student-hub-v2__' + A + ':meta', 'student-hub-v2__' + A + ':notes', 'sturoids-cloud__' + A, 'sturoids-last-export__' + A,
    ].sort());
    assert.deepEqual(p.keysOfProfile(all, 'main'), [], 'the first profile\'s keys carry no suffix and are never matched');
    assert.deepEqual(p.keysOfProfile(all, 'nonsense'), []);
    assert.deepEqual(p.profilesWithData(all).sort(), [A, Z].sort(), 'the profiles with data, from their meta rows');
  },

  async 'removing a profile deletes its keys, folder, PIN and session, and only those'() {
    const storage = new Map();
    seedRegistry(storage, [entry('main', 'Main'), entry(A, 'Asha'), entry(Z, 'Zed')]);
    for (const k of ['student-hub-v2:meta', 'sturoids-cloud', 'sb-imvydxgapirnkuvayimn-auth-token']) storage.set(k, 'main');
    for (const id of [A, Z]) {
      storage.set('student-hub-v2__' + id + ':meta', JSON.stringify({ version: 6, keys: ['notes'], seq: 1, savedAt: 1 }));
      storage.set('student-hub-v2__' + id + ':notes', '[]');
      for (const k of ['sturoids-cloud__' + id, 'sb-sturoids-auth__' + id]) storage.set(k, JSON.stringify(id));
    }
    const secure = new Map([
      ['sturoids.pin.v2', 'main pin'], ['sturoids.pin.v2__' + A, 'a pin'], ['sturoids.pin.v2__' + Z, 'z pin'],
      ['sturoids.pinAttempts.v2__' + Z, '{}'],
    ]);
    const app = await start({ active: A, storage, secure });
    assert.equal(await app.profiles.removeProfile(A), 'refused', 'the profile in use');
    assert.equal(await app.profiles.removeProfile('main'), 'refused', 'the first profile');
    assert.equal(await app.profiles.removeProfile(Z), 'ok');
    assert.deepEqual([...storage.keys()].filter((k) => k.includes(Z)), [], 'every key of the removed profile');
    assert.ok(storage.has('student-hub-v2__' + A + ':notes') && storage.has('sb-sturoids-auth__' + A), 'the profile in use keeps its keys');
    assert.ok(storage.has('student-hub-v2:meta') && storage.has('sb-imvydxgapirnkuvayimn-auth-token'), 'the first profile keeps its keys');
    assert.deepEqual(app.removedDirs, [DOC + 'profiles/' + Z + '/']);
    assert.ok(!secure.has('sturoids.pin.v2__' + Z) && !secure.has('sturoids.pinAttempts.v2__' + Z), 'its PIN');
    assert.equal(secure.get('sturoids.pin.v2'), 'main pin');
    assert.equal(secure.get('sturoids.pin.v2__' + A), 'a pin');
    assert.deepEqual(app.registry().list.map((p) => p.id), ['main', A]);
    assert.deepEqual(app.profiles.useProfiles.getState().list.map((p) => p.id), ['main', A]);
  },

  'the registry is cleaned, the first profile first, and lost profiles come back from their data'() {
    const { profiles: p } = boot({ active: 'main' });
    const main = { id: 'main', name: 'Me', color: '#9588F9', email: null, createdAt: 0 };
    assert.deepEqual(p.cleanRegistry(null, main), [main], 'no registry yet');
    assert.deepEqual(p.cleanRegistry('{not json', main), [main]);
    const raw = {
      v: 1,
      list: [
        { id: Z, name: '  Zed   Two  ', color: 'red', email: '  z@x.io ', createdAt: 30 },
        { id: 'main', name: 'Me', color: '#66D28F', email: null, createdAt: 0 },
        { id: A, name: 'A'.repeat(50), color: '#4FC4B8', email: '', createdAt: 20 },
        { id: A, name: 'Duplicate', color: '#4FC4B8', email: null, createdAt: 5 },
        { id: 'BAD', name: 'Junk' }, null, 'text', { name: 'No id' },
      ],
    };
    const out = p.cleanRegistry(raw, main, [A, 'qqqqqqqqqq', 'main', 'NOPE']);
    assert.deepEqual(out.map((x) => x.id), ['main', A, Z, 'qqqqqqqqqq'], 'first profile first, then by when made, then recovered');
    assert.equal(out[0].color, '#66D28F', 'the saved entry wins over the fallback');
    assert.equal(out[1].name, 'A'.repeat(30), 'names are capped');
    assert.equal(out[1].email, null, 'an empty email is none');
    assert.equal(out[2].name, 'Zed Two');
    assert.equal(out[2].color, '#9588F9', 'a colour that is not one falls back');
    assert.equal(out[2].email, 'z@x.io');
    assert.equal(out[3].name, '', 'a recovered profile has no name until it is given one');
    assert.deepEqual(p.cleanRegistry(JSON.parse(JSON.stringify({ v: 1, list: out })), main), out, 'cleaning twice changes nothing');
    // a profile's photo revision survives the cleaning; anything that is not a real time is dropped
    const revs = p.cleanRegistry({
      v: 1,
      list: [
        { id: 'main', name: 'Me', color: '#66D28F', email: null, createdAt: 0, avatarRev: 1700000000000 },
        { id: A, name: 'A', color: '#4FC4B8', email: null, createdAt: 1, avatarRev: 'soon' },
        { id: Z, name: 'Z', color: '#4FC4B8', email: null, createdAt: 2, avatarRev: -4 },
      ],
    }, main);
    assert.equal(revs[0].avatarRev, 1700000000000, 'avatarRev is kept');
    assert.ok(!('avatarRev' in revs[1]) && !('avatarRev' in revs[2]), 'a junk avatarRev is dropped');
    assert.deepEqual(p.cleanRegistry(JSON.parse(JSON.stringify({ v: 1, list: revs })), main), revs, 'and cleaning twice keeps it');
    const ids = new Set();
    for (let i = 0; i < 200; i++) ids.add(p.newProfileId([...ids]));
    assert.equal(ids.size, 200);
    for (const id of ids) assert.ok(p.isProfileId(id) && id !== 'main');
    let calls = 0;
    const repeat = () => (calls++ < 10 ? 0 : 0.5);
    assert.notEqual(p.newProfileId(['aaaaaaaaaa'], repeat), 'aaaaaaaaaa', 'an id already taken is never handed out');
  },

  async 'a registry that is missing is written from this profile; one that could not be read is never written over'() {
    const fresh = await start({ active: 'main' });
    fresh.state().setSetting('name', 'Mira');
    await sleep(700);
    assert.equal(fresh.registry().list[0].name, 'Mira', 'the first profile\'s entry follows its name');
    const storage = new Map();
    seedRegistry(storage, [entry('main', 'Main'), entry(Z, 'Zed')]);
    const app = await start({ active: 'main', storage, registryFails: true });
    app.state().setSetting('name', 'Changed');
    await sleep(700);
    assert.deepEqual(app.registry().list.map((p) => p.name), ['Main', 'Zed'], 'the unread registry stays as it was');
  },

  async 'a fresh profile takes the name and colour it was made with; a renamed one adopts its new name'() {
    const storage = new Map();
    seedRegistry(storage, [entry('main', 'Main'), entry(A, 'Priya', { color: '#F07E98' })]);
    const app = await start({ active: A, storage });
    assert.equal(app.state().settings.name, 'Priya');
    assert.equal(app.state().settings.accent, '#F07E98');
    await app.store.flushSaves();
    await sleep(700);
    // renamed from the first profile while this one was not in use
    const main = await start({ active: 'main', storage });
    assert.equal(await main.profiles.renameProfile(A, '  Priya  R  '), 'ok');
    assert.equal(main.registry().list.find((p) => p.id === A).name, 'Priya R');
    assert.notEqual(main.state().settings.name, 'Priya R', 'another profile\'s rename leaves this one\'s name');
    await sleep(700);
    const again = await start({ active: A, storage });
    assert.equal(again.state().settings.name, 'Priya R', 'the registry wins once');
    again.state().setSetting('name', 'Priya Rao');
    await sleep(700);
    assert.equal(again.registry().list.find((p) => p.id === A).name, 'Priya Rao', 'and from then on they stay in step');
  },

  async 'a switch writes what waits, cancels every reminder, names the new profile and restarts'() {
    const storage = new Map();
    seedRegistry(storage, [entry('main', 'Main'), entry(A, 'Asha')]);
    const app = await start({ active: A, storage });
    app.state().setSetting('name', 'Asha K');
    assert.equal(await app.profiles.switchProfile(A), 'same');
    assert.equal(await app.profiles.switchProfile('nobody1234'), 'refused');
    assert.equal(await app.profiles.switchProfile('main'), 'ok');
    assert.equal(app.secure.get('sturoids.profile.active'), 'main');
    assert.equal(JSON.parse(storage.get('student-hub-v2__' + A + ':settings')).name, 'Asha K', 'the change waiting was written first');
    assert.deepEqual(app.log.filter((l) => l !== 'rows written'), ['reminders cancelled', 'restart']);
    assert.ok(app.log.indexOf('rows written') < app.log.indexOf('restart'));
    const note = storage.get('sturoids-switched');
    assert.ok(app.profiles.arrivalValid(note, 'main'), 'the launch the switch starts is recognised');
    assert.equal(app.profiles.useProfiles.getState().switching.to.id, 'main', 'the overlay names where it goes');
  },

  async 'a switch is refused while Deep Work runs or a backup is being sent'() {
    const storage = new Map();
    seedRegistry(storage, [entry('main', 'Main'), entry(A, 'Asha')]);
    const app = await start({ active: 'main', storage });
    app.store.useStore.setState({ deepWork: { running: true } });
    assert.equal(await app.profiles.switchProfile(A), 'refused');
    assert.deepEqual(app.toasts, ['End the Deep Work session first']);
    app.store.useStore.setState({ deepWork: null });
    const busy = await start({ active: 'main', storage, cloudStatus: 'syncing' });
    assert.equal(await busy.profiles.switchProfile(A), 'refused');
    assert.deepEqual(busy.toasts, ['Wait for the backup to finish']);
    assert.notEqual(busy.secure.get('sturoids.profile.active'), A);
    assert.equal(busy.profiles.useProfiles.getState().switching, null);
  },

  async 'adding a profile records it and switches to it; there is room for five'() {
    const storage = new Map();
    const app = await start({ active: 'main', storage });
    assert.equal(await app.profiles.addProfile('   ', '#4FC4B8'), 'name');
    assert.equal(await app.profiles.addProfile('Kiran', '#4FC4B8'), 'ok');
    const added = app.registry().list.find((p) => p.name === 'Kiran');
    assert.ok(added && app.profiles.isProfileId(added.id) && added.id !== 'main');
    assert.equal(added.color, '#4FC4B8');
    assert.equal(app.secure.get('sturoids.profile.active'), added.id);
    assert.ok(app.log.includes('restart'));
    const full = new Map();
    seedRegistry(full, [entry('main', 'M'), ...['a', 'b', 'c', 'd'].map((c) => entry(c.repeat(10), c))]);
    const five = await start({ active: 'main', storage: full });
    assert.equal(await five.profiles.addProfile('Sixth', '#4FC4B8'), 'full');
    assert.equal(five.registry().list.length, 5);
  },

  'a switch\'s note is good for its own launch, for a minute'() {
    const { profiles: p } = boot({ active: 'main' });
    const now = 1_000_000;
    const note = (to, at) => JSON.stringify({ to, at });
    assert.ok(p.arrivalValid(note(A, now - 2000), A, now));
    assert.ok(!p.arrivalValid(note(A, now - 61_000), A, now), 'a minute later it is an ordinary launch');
    assert.ok(!p.arrivalValid(note(Z, now), A, now), 'another profile\'s note');
    assert.ok(!p.arrivalValid(note(A, now + 60_000), A, now), 'a time in the future');
    assert.ok(!p.arrivalValid('{oops', A, now));
    assert.ok(!p.arrivalValid(null, A, now));
  },

  'one cloud account per profile: another profile\'s account is found without regard to case'() {
    const { profiles: p } = boot({ active: A });
    const list = [entry('main', 'Main', { email: 'Sam@Example.com' }), entry(A, 'Asha', { email: 'asha@x.io' }), entry(Z, 'Zed')];
    assert.equal(p.profileWithEmail(list, ' sam@example.COM ').id, 'main');
    assert.equal(p.profileWithEmail(list, 'asha@x.io'), null, 'the profile in use may sign in again to its own');
    assert.equal(p.profileWithEmail(list, 'new@x.io'), null);
    assert.equal(p.profileWithEmail(list, ''), null);
    assert.equal(p.takenMessage(list[0]), 'That account is already on this phone as Main. Switch to that profile instead.');
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
      console.log('FAIL  ' + name + '\n      ' + String(e && e.stack ? e.stack : e).split('\n').join('\n      '));
    }
  }
  console.log(failed ? `\ntest-profiles: ${failed} failed` : '\ntest-profiles: all passed');
  process.exit(failed ? 1 : 0);
})();
