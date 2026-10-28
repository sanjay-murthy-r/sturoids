#!/usr/bin/env node
/*
 * Data-safety checks for src/store.ts, run against the real source in Node (no device, no Metro).
 * Each scenario boots a fresh copy of the store over its own in-memory AsyncStorage and checks:
 *   - a fresh install, and an upgrade from a v4 blob through the real persist migration
 *   - migrateV5 is idempotent and survives malformed collections
 *   - a backup round-trips through exportSnapshot / importSnapshot, and junk is refused
 *   - a blob that cannot be read is copied aside (or saving pauses) and the user is told
 *   - storage that answers after the wait replaces the defaults, resumes saving and says so
 *   - a row that cannot be read back pauses saving and holds the cloud back; a failed save is kept and reported
 *   - a restore keeps this phone's own visit times, and a change to them alone is not a data change
 *   - one row per collection: a round trip, the move from the old single row, a row that cannot be read never being
 *     written over, and only changed rows being written
 *   - 1.7's migration (daily ToDos, the moved accents, the new settings), and one-off ToDos leaving on a new day
 *   - Recently deleted: every kind goes and comes back in its place, locks follow the tools, and the purge after
 *     30 days deletes the files too
 *   - 1.8: habit weekdays (streaks that pass rest days, the same count as before for every day), the day's record of
 *     ticks (logged, unlogged, pruned at 400 days, cleaned), the writing font and the parts of a written date
 *   - 2.0: ToDo weekdays, early task reminders, logged sessions, quick actions, Today's board and the new settings
 *     cleaned on load and import; habits, long-term tasks and exams through Recently deleted; this phone's own notes
 *     kept through a restore; the reminders they ring (early, a week before, weekly ToDos); and the pure helpers the
 *     widgets read (weekdays, YouTube links, focus streaks, moods, subjects, the focus week, the backup card)
 * Usage: node scripts/test-store.js   (exit 1 on any failure)
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { createRequire } = require('module');

const ROOT = path.join(__dirname, '..');
const projectRequire = createRequire(path.join(ROOT, 'package.json'));
const ts = projectRequire('typescript');
/** the single row everything was saved in before 1.7 */
const KEY = 'student-hub-v1';
/** 1.7's rows: a meta row, and one per collection */
const META = 'student-hub-v2:meta';
const ROW = (k) => 'student-hub-v2:' + k;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 24 * 60 * 60 * 1000;

/**
 * Boots src/store.ts in a fresh module registry over its own storage map. `faults` can be changed while it runs:
 * `unreadable` keys throw on read (a row Android cannot read back), `writesFail` makes every write throw. `writes`
 * records the keys of every multiSet, and `deleted` every file the app deleted.
 */
function boot(seed = {}, { gate, faults = {}, storage: shared, stubs = {} } = {}) {
  const storage = shared || new Map(Object.entries(seed));
  const writes = [];
  const deleted = [];
  const read = async (k) => {
    if (gate) await gate;
    if (faults.unreadable && faults.unreadable.includes(k)) throw new Error('Row too big to fit into CursorWindow');
    return storage.has(k) ? storage.get(k) : null;
  };
  const asyncStorage = {
    getItem: read,
    setItem: async (k, v) => {
      if (faults.writesFail) throw new Error('database or disk is full');
      storage.set(k, v);
    },
    removeItem: async (k) => { storage.delete(k); },
    // as on Android: one row that cannot be read fails the whole read, and a multiSet is one transaction
    multiGet: async (keys) => {
      const out = [];
      for (const k of keys) out.push([k, await read(k)]);
      return out;
    },
    multiSet: async (pairs) => {
      if (faults.writesFail) throw new Error('database or disk is full');
      writes.push(pairs.map(([k]) => k));
      for (const [k, v] of pairs) storage.set(k, v);
    },
    multiRemove: async (keys) => { for (const k of keys) storage.delete(k); },
  };
  const fileSystem = {
    documentDirectory: 'file:///doc/',
    cacheDirectory: 'file:///cache/',
    async deleteAsync(uri) { deleted.push(uri); },
    async readAsStringAsync() { return ''; },
    async writeAsStringAsync() {},
    async makeDirectoryAsync() {},
  };
  const registry = new Map();
  const load = (file) => {
    if (registry.has(file)) return registry.get(file).exports;
    const source = fs.readFileSync(file, 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    });
    const mod = { exports: {} };
    registry.set(file, mod);
    const req = (spec) => {
      if (Object.prototype.hasOwnProperty.call(stubs, spec)) return stubs[spec];
      if (spec === '@react-native-async-storage/async-storage') return { __esModule: true, default: asyncStorage };
      if (spec === 'react-native') return {};
      if (spec === 'expo-file-system') return fileSystem;
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
  const notices = [];
  const named = [];
  store.subscribeLoadNotices((n, collections) => { notices.push(n); named.push(collections || []); });
  const utils = load(path.join(ROOT, 'src', 'utils.ts'));
  return {
    store, utils, storage, notices, named, writes, deleted, state: () => store.useStore.getState(),
    /** loads another module of the app into this copy (with the same store and storage) */
    load: (rel) => load(path.join(ROOT, rel)),
    /** a collection's row as saved, parsed */
    row: (k) => (storage.has(ROW(k)) ? JSON.parse(storage.get(ROW(k))) : undefined),
    meta: () => (storage.has(META) ? JSON.parse(storage.get(META)) : undefined),
  };
}

/** Writes what waits, after the store's own pause has been skipped. */
async function flush(app) {
  await sleep(5);
  app.store.flushSaves();
  await sleep(5);
}

/** A day's key, `days` from today. */
function dayKey(utils, days) {
  const d = new Date();
  return utils.todayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days));
}

async function settled(app) {
  for (let i = 0; i < 200; i++) {
    if (app.store.hydrationSettled()) { await sleep(5); return; }
    await sleep(5);
  }
  throw new Error('hydration never settled');
}

const V4 = {
  settings: { name: 'Sam', theme: 'default', accent: '#8B7CF8', animLevel: 'full', hour24: true },
  quickAccess: [
    { id: 'q1', label: 'Notes', icon: 'document-text', color: '#8CD9A8', kind: 'route', target: '/notes' },
    { id: 'q2', label: 'Settings', icon: 'settings', color: '#9AA6C0', kind: 'route', target: '/settings' },
    { id: 'q3', label: 'Notes again', icon: 'document-text', color: '#8CD9A8', kind: 'route', target: '/notes' },
  ],
  planner: { Mon: [{ id: 'b1', subject: 'Physics', start: '09:00', end: '10:00', color: '#8FB6E8' }] },
  notes: [{ id: 'n1', title: 'Waves', body: 'text', folder: 'General', tags: [], pinned: false, createdAt: 1700000000000, updatedAt: 1700000000000 }],
  dailyTasks: [{ id: 'd1', title: 'Read', doneOn: null, createdAt: 1690000000000 }],
  habits: [{ id: 'h1', title: 'Walk', doneDates: ['2026-09-01'] }],
};

const scenarios = {
  async 'a fresh install starts on defaults with nothing to report'() {
    const app = boot();
    await settled(app);
    const s = app.state();
    assert.deepEqual(s.settings.tabSlots, ['tasks', 'focus', 'planner']);
    assert.equal(s.notes.length, 0);
    assert.deepEqual(s.scores, []);
    assert.deepEqual(s.settings.archivedTools, ['desmos', 'ai'], 'Desmos and AI start archived');
    assert.equal(s.settings.journalCheckout, true);
    assert.equal(s.settings.ambientSeconds, true, 'the ambient screen shows seconds, as picked in the lab');
    assert.equal(s.settings.ambientClock, false);
    assert.equal(app.store.loadFailedThisLaunch(), false);
    assert.deepEqual(app.notices, []);
  },

  async 'a tool in a tab slot is never archived'() {
    const saved = { ...V4, settings: { ...V4.settings, tabSlots: ['desmos', 'focus', 'planner'] } };
    const app = boot({ [KEY]: JSON.stringify({ state: saved, version: 5 }) });
    await settled(app);
    const st = app.state;
    assert.deepEqual(st().settings.archivedTools, ['ai'], 'a slotted Desmos stays out of the archive');
    assert.equal(st().setToolArchived('focus', true), false, 'a slotted tool refuses');
    assert.equal(st().setToolArchived('notes', true), true);
    assert.deepEqual(st().settings.archivedTools, ['ai', 'notes']);
    st().setTabSlots(['notes', 'focus', 'planner']);
    assert.deepEqual(st().settings.archivedTools, ['ai'], 'slotting a tool restores it');
    st().setTabSlots(['tasks', 'notes', 'planner']);
    st().setDeepWork({ mode: 'countdown', targetMin: 25, running: true, startTs: 1, accumSec: 0, startedAt: 1, subject: '', attached: [], finishAt: null });
    assert.equal(st().setToolArchived('focus', false), true);
    assert.equal(st().setToolArchived('focus', true), false, 'never while a session is going');
    st().setDeepWork(null);
    assert.equal(st().setToolArchived('focus', true), true);
    assert.equal(st().setToolArchived('focus', false), true);
    assert.deepEqual(st().settings.archivedTools, ['ai']);
  },

  async 'a damaged exam tree is repaired on every load, not only on the upgrade'() {
    // version 5: zustand skips the migration entirely, so the repair has to live in merge
    const saved = {
      ...V4,
      scores: [
        { id: 'a', parentId: 'b', kind: 'group', title: 'A', createdAt: 1, updatedAt: 1 },
        { id: 'b', parentId: 'a', kind: 'group', title: 'B', createdAt: 1, updatedAt: 1 },
        { id: 'c', parentId: 'gone', kind: 'exam', title: 'C', createdAt: 1, updatedAt: 1 },
        { id: 'd', kind: 'exam', title: 7, createdAt: 1, updatedAt: 1 },
      ],
    };
    const app = boot({ [KEY]: JSON.stringify({ state: saved, version: 5 }) });
    await settled(app);
    const scores = app.state().scores;
    assert.ok(scores.every((n) => typeof n.title === 'string'), 'a title that is not text is dropped');
    const byId = new Map(scores.map((n) => [n.id, n]));
    for (const n of scores) {
      const seen = new Set([n.id]);
      let p = n.parentId;
      while (p) {
        assert.ok(!seen.has(p), 'no node is its own ancestor');
        seen.add(p);
        assert.ok(byId.has(p), 'every parent exists');
        p = byId.get(p).parentId;
      }
    }
  },

  async 'tasks added return their ids, and score nodes keep no empty fields'() {
    const app = boot();
    await settled(app);
    const st = app.state;
    const d = st().addDaily('Read');
    const m = st().addMission('Mock', '2026-10-01');
    assert.equal(st().dailyTasks[0].id, d);
    assert.equal(st().missions[0].id, m);
    const g = st().addScoreNode({ parentId: null, kind: 'group', title: 'Mocks' });
    const e = st().addScoreNode({ parentId: g, kind: 'exam', title: 'Mock 1', score: 50, outOf: 100, note: undefined });
    assert.ok(!('note' in st().scores.find((x) => x.id === e)), 'undefined is never stored');
    st().patchScoreNode(e, { score: undefined });
    assert.ok(!('score' in st().scores.find((x) => x.id === e)), 'clearing a mark removes it');
    assert.equal(st().moveScoreNode(g, e), false, 'a group never moves into an exam');
    const copy = st().duplicateScoreNode(e);
    assert.equal(st().scores.find((x) => x.id === copy).title, 'Mock 2');
    const removed = st().removeScoreNode(g);
    assert.equal(removed.nodes.length, 3, 'the group and both exams');
    assert.deepEqual(st().scores, []);
    st().restoreScoreNodes(removed);
    assert.equal(st().scores.length, 3, 'Undo puts them all back');
  },

  async 'tags are made once, renamed uniquely, and let go of everything when deleted'() {
    const app = boot();
    await settled(app);
    const st = app.state;
    const a = st().addScoreTag('  Silly mistakes ');
    assert.equal(st().scoreTags[0].label, 'Silly mistakes', 'a name is trimmed');
    assert.equal(st().addScoreTag('SILLY MISTAKES'), a, 'the same name is the same tag');
    const b = st().addScoreTag('Revision');
    assert.notEqual(st().scoreTags[0].color, st().scoreTags[1].color, 'a new tag takes a free colour');
    assert.equal(st().patchScoreTag(b, { label: 'silly mistakes' }), false, 'a name already in use is refused');
    assert.equal(st().patchScoreTag(b, { label: 'Revision gaps' }), true);
    const exam = st().addScoreNode({ parentId: null, kind: 'exam', title: 'Mock 1', tags: [a, b] });
    const l1 = st().addLearning({ nodeId: exam, text: '  Read the question twice  ', tags: [a] });
    st().addLearning({ nodeId: exam, text: 'Revise rotation', tags: [a, b] });
    assert.equal(st().learnings[0].text, 'Read the question twice', 'a learning is trimmed');
    assert.equal(st().addLearning({ nodeId: exam, text: '   ' }), '', 'an empty learning is not kept');
    st().removeScoreTag(a);
    assert.deepEqual(st().scores.find((x) => x.id === exam).tags, [b], 'the tag leaves the exam');
    assert.deepEqual(st().learnings.map((l) => l.tags), [[], [b]], 'and every learning');
    const gone = st().removeLearning(l1);
    assert.equal(st().learnings.length, 1);
    st().restoreLearnings([gone]);
    assert.equal(st().learnings.length, 2, 'Undo puts a learning back');
    const removed = st().removeScoreNode(exam);
    assert.equal(removed.learnings.length, 2, 'an exam takes its learnings with it');
    assert.equal(st().learnings.length, 0);
    st().restoreScoreNodes(removed);
    assert.equal(st().learnings.length, 2, 'and brings them back');
  },

  async 'damaged tags and learnings from an old save or a backup never reach a screen'() {
    const saved = {
      ...V4,
      scores: [{ id: 'e', parentId: null, kind: 'exam', title: 'E', tags: ['t1', 'ghost', 7], createdAt: 1, updatedAt: 1 }],
      scoreTags: [
        { id: 't1', label: 'Careless', color: '#E39EAC', createdAt: 1 },
        { id: 't2', label: ' careless ', color: 'red', createdAt: 2 },
        'junk', null, { id: 't3', label: 42 },
      ],
      learnings: [
        { id: 'l1', nodeId: 'e', text: 'Keep', tags: ['t1', 'ghost'], createdAt: 1, updatedAt: 1 },
        { id: 'l2', nodeId: 'nowhere', text: 'Orphan', tags: [], createdAt: 1, updatedAt: 1 },
        { id: 'l3', nodeId: 'e', text: '   ', tags: [], createdAt: 1, updatedAt: 1 },
        { nodeId: 'e', text: 'No id' },
      ],
    };
    for (const version of [4, 5]) {
      const app = boot({ [KEY]: JSON.stringify({ state: saved, version }) });
      await settled(app);
      const st = app.state();
      assert.deepEqual(st.scoreTags.map((t) => t.id), ['t1'], 'v' + version + ': one tag per name, junk dropped');
      assert.deepEqual(st.scores[0].tags, ['t1'], 'v' + version + ': unknown tag ids leave the exam');
      assert.deepEqual(st.learnings.map((l) => l.id), ['l1'], 'v' + version + ': orphan, empty and id-less learnings dropped');
      assert.deepEqual(st.learnings[0].tags, ['t1']);
    }
  },

  async 'undone drops come back beside their neighbours, even after other edits'() {
    const app = boot();
    await settled(app);
    const st = app.state;
    for (const t of ['A', 'B', 'C', 'D', 'E']) st().addDaily(t);
    const ids = () => st().dailyTasks.map((t) => t.title).join('');
    const titleId = (t) => st().dailyTasks.find((x) => x.title === t).id;
    // what the leftovers card does: record what stood before each drop, then remove it
    const drop = (t) => {
      const list = st().dailyTasks;
      const index = list.findIndex((x) => x.title === t);
      const rec = { task: list[index], before: list.slice(0, index).map((x) => x.id) };
      st().removeDaily(rec.task.id);
      return rec;
    };
    const batch = [drop('C')];
    st().removeDaily(titleId('A')); // deleted from the ToDo list itself while the toast is up
    batch.push(drop('D'));
    assert.equal(ids(), 'BE');
    for (let i = batch.length - 1; i >= 0; i--) {
      const now = st().dailyTasks.map((x) => x.id);
      st().restoreDaily(batch[i].task, app.utils.indexAfterNeighbours(batch[i].before, now));
    }
    assert.equal(ids(), 'BCDE', 'each lands beside its old neighbour, in order');
  },

  async 'note folders rename and delete without losing a note'() {
    const app = boot();
    await settled(app);
    const st = app.state;
    st().addNoteFolder('Phyics');
    st().addNoteFolder('Maths');
    st().addNote({ title: 'Torque', body: '', folder: 'Phyics' });
    st().renameNoteFolder('Phyics', 'Maths');
    assert.ok(st().noteFolders.includes('Phyics'), 'a name already in use is refused');
    st().renameNoteFolder('Phyics', 'Physics');
    assert.deepEqual(st().noteFolders, ['General', 'Physics', 'Maths']);
    assert.equal(st().notes[0].folder, 'Physics', 'the note moves with its folder');
    st().renameNoteFolder('General', 'Misc');
    st().deleteNoteFolder('General');
    assert.ok(st().noteFolders.includes('General'), 'General always stays');
    st().deleteNoteFolder('Physics');
    assert.deepEqual(st().noteFolders, ['General', 'Maths']);
    assert.equal(st().notes.length, 1, 'no note is deleted');
    assert.equal(st().notes[0].folder, 'General', 'its notes move to General');
  },

  async 'a v4 blob upgrades through the real persist migration'() {
    const app = boot({ [KEY]: JSON.stringify({ state: V4, version: 4 }) });
    await settled(app);
    const s = app.state();
    assert.ok(s.quickAccess.every((q) => ['tool', 'route', 'url'].includes(q.kind)), 'quick access kinds');
    assert.equal(s.quickAccess.filter((q) => q.kind === 'tool' && q.target === 'notes').length, 1, 'duplicates dropped');
    assert.equal(s.planner.Mon[0].color, '#9DBCE3', 'planner colour remapped');
    for (const day of Object.keys(s.planner)) assert.ok(Array.isArray(s.planner[day]), 'day ' + day);
    assert.equal(Object.keys(s.planner).length, 7, 'every day present');
    assert.equal(s.settings.firstOpenedAt, 1690000000000, 'first open comes from the data');
    assert.equal(s.notes[0].locked, false);
    assert.deepEqual(s.notes[0].attachments, []);
    assert.equal(s.deepWork, null);
    assert.deepEqual(s.journal, []);
    assert.deepEqual(s.scores, []);
    assert.deepEqual(s.settings.archivedTools, ['desmos', 'ai'], 'an upgrade takes the archive default');
    assert.equal(s.settings.name, 'Sam');
    assert.equal(s.settings.accent, '#9588F9', 'the old Iris moves to the new one');
    assert.equal(s.dailyTasks[0].repeat, 'daily', 'a ToDo from before one-offs keeps coming back every day');
    await flush(app); // saves wait for a pause; the test does not
    assert.equal(app.meta().version, 6, 'written back as v6, one row per collection');
    assert.equal(app.row('settings').name, 'Sam');
    assert.ok(app.storage.has(KEY), 'the old row stays until a later launch has loaded the new ones');
    assert.deepEqual(app.notices, []);
  },

  async 'migrateV5 is idempotent and survives malformed collections'() {
    const app = boot();
    await settled(app);
    const { migrateV5 } = app.store;
    const junk = {
      dailyTasks: 'oops', missions: [null, { id: 'm', title: 'x', subtasks: 'bad' }], habits: [null, { id: 'h', doneDates: 'bad' }],
      planner: 'nope', weekTemplates: { broken: 'x', good: { Mon: [null, { id: 'b', color: '#8FB6E8' }] } },
      noteFolders: [1, 'General'], vaultVideos: [{ id: 'v', notes: null }], journalTags: ['a', 2],
      journal: [
        { id: 'j', dateKey: '2026-09-01', body: 'hello there' }, { dateKey: 'no id' },
        { id: 'j2', dateKey: '2026-09-02', mood: 9, rating: 4, checkoutSkipped: 'yes' },
      ],
      quickAccess: [{ target: '/tasks', kind: 'route' }],
      scores: [null, { id: 'g', kind: 'group', title: 'G', parentId: 'e' }, { id: 'e', kind: 'exam', title: 'E', parentId: 'g', score: 'x', outOf: 100 }],
      settings: { tabSlots: ['ai', 'bogus'], archivedTools: ['ai', 'nope', 'vault', 'vault'] },
    };
    const once = migrateV5(junk);
    const j2 = once.journal.find((e) => e.id === 'j2');
    assert.ok(!('mood' in j2), 'a mood out of range is dropped');
    assert.equal(j2.rating, 4);
    assert.ok(!('checkoutSkipped' in j2), 'only true counts');
    assert.equal(once.scores.length, 2);
    assert.equal(once.scores.find((n) => n.id === 'g').parentId, null, 'a group never sits inside an exam');
    assert.ok(!('score' in once.scores.find((n) => n.id === 'e')));
    assert.deepEqual(once.settings.tabSlots, ['ai', 'tasks', 'focus']);
    assert.deepEqual(once.settings.archivedTools, ['vault'], 'slotted, unknown and repeated tools leave the archive');
    assert.deepEqual(once.dailyTasks, []);
    assert.deepEqual(once.missions, [{ id: 'm', title: 'x', subtasks: [] }]);
    assert.deepEqual(once.habits, [{ id: 'h', doneDates: [] }]);
    assert.equal(Object.keys(once.planner).length, 7);
    assert.deepEqual(Object.keys(once.weekTemplates), ['good']);
    assert.equal(once.weekTemplates.good.Mon.length, 1);
    assert.deepEqual(once.noteFolders, ['General']);
    assert.deepEqual(once.vaultVideos[0].notes, []);
    assert.deepEqual(once.journalTags, ['a']);
    assert.equal(once.journal.length, 2, 'the entry without an id is dropped');
    assert.equal(once.journal[0].body, undefined, 'text never kept inline');
    assert.deepEqual(migrateV5(once), once, 'a second pass changes nothing');
    const v4once = migrateV5(V4);
    assert.deepEqual(migrateV5(v4once), v4once);
  },

  async 'a backup round-trips and junk is refused'() {
    const app = boot({ [KEY]: JSON.stringify({ state: V4, version: 4 }) });
    await settled(app);
    const g = app.state().addScoreNode({ parentId: null, kind: 'group', title: 'Mocks', target: 75 });
    app.state().addScoreNode({ parentId: g, kind: 'exam', title: 'Mock 1', date: '2026-09-01', score: -4, outOf: 100 });
    app.state().setToolArchived('vault', true);
    const snap = JSON.parse(JSON.stringify(app.store.exportSnapshot()));
    assert.equal(snap.scores.length, 2, 'scores ride along in a backup');
    app.state().setSetting('name', 'Changed');
    assert.equal(app.store.importSnapshot('not json'), false);
    assert.equal(app.store.importSnapshot('{"hello":1}'), false);
    assert.equal(app.state().settings.name, 'Changed', 'refused imports change nothing');
    assert.equal(app.store.importSnapshot(JSON.stringify(snap)), true);
    const s = app.state();
    for (const k of ['settings', 'notes', 'planner', 'quickAccess', 'dailyTasks', 'habits', 'journal', 'calcHistory', 'scores']) {
      assert.deepEqual(s[k], snap[k], k + ' restored');
    }
    assert.equal(s.deepWork, null);
    assert.equal(app.store.importSnapshot(JSON.stringify({ state: V4, version: 4 })), true, "the app's own saved blob imports");
  },

  async 'a blob that cannot be read is kept aside and reported'() {
    const app = boot({ [KEY]: '{not json' });
    await settled(app);
    assert.equal(app.storage.get(app.store.RECOVERY_KEY), '{not json');
    assert.equal(app.store.loadFailedThisLaunch(), true);
    assert.equal(app.store.savingPaused(), false);
    assert.deepEqual(app.notices, ['failed-kept']);
  },

  async 'with an older copy already kept, saving pauses so nothing is overwritten'() {
    const app = boot({ [KEY]: '{still bad', 'student-hub-v1.recovery': '{older copy' });
    await settled(app);
    assert.equal(app.store.savingPaused(), true);
    app.state().setSetting('name', 'x');
    await sleep(20);
    app.store.flushSaves();
    await sleep(5);
    assert.equal(app.storage.get(KEY), '{still bad', 'the unreadable blob is untouched');
    assert.equal(app.storage.has(META), false, 'and nothing new is written beside it');
    assert.equal(app.storage.get(app.store.RECOVERY_KEY), '{older copy');
    assert.deepEqual(app.notices, ['failed-paused']);
  },

  async 'a row that cannot be read back pauses saving, is never overwritten, and holds the cloud back'() {
    const faults = { unreadable: [KEY] };
    const app = boot({ [KEY]: JSON.stringify({ state: V4, version: 4 }) }, { faults });
    await settled(app);
    assert.equal(app.store.loadFailedThisLaunch(), true);
    assert.equal(app.store.savedRowUnreadable(), true, 'the row itself could not be read');
    assert.equal(app.store.savingPaused(), true);
    assert.equal(app.store.localDataState(), 'failed', 'nothing may be sent over a copy elsewhere');
    assert.deepEqual(app.notices, ['failed-paused']);
    app.state().setSetting('name', 'typed on defaults');
    await sleep(20);
    app.store.flushSaves();
    await sleep(5);
    assert.equal(JSON.parse(app.storage.get(KEY)).state.settings.name, 'Sam', 'the saved row is untouched');
    assert.equal(app.storage.has(app.store.RECOVERY_KEY), false);
    // a backup brought in on purpose is the user's data again
    const snap = JSON.stringify({ _app: 'student-hub', _v: 3, settings: { name: 'From backup' }, notes: [] });
    assert.equal(app.store.importSnapshot(snap), true);
    assert.equal(app.store.localDataState(), 'ok');
    assert.equal(app.store.savingPaused(), false);
  },

  async 'a save that fails is kept, retried and reported until one goes through'() {
    const faults = {};
    const app = boot({}, { faults });
    await settled(app);
    assert.equal(app.store.localDataState(), 'ok');
    const seen = [];
    app.store.subscribeSaveProblems((failing) => seen.push(failing));
    faults.writesFail = true;
    app.state().setSetting('name', 'First');
    app.store.flushSaves();
    await sleep(5);
    assert.equal(app.store.savesFailing(), true);
    assert.ok(app.store.savedSize() > 0, 'the size of the save is known');
    app.store.flushSaves(); // a second failure says nothing new
    await sleep(5);
    assert.deepEqual(seen, [true]);
    faults.writesFail = false;
    app.store.flushSaves(); // the kept save goes through on the next flush
    await sleep(5);
    assert.equal(app.row('settings').name, 'First');
    assert.equal(app.store.savesFailing(), false);
    assert.deepEqual(seen, [true, false]);
  },

  async 'a restore keeps when this phone was opened, and those times alone are no change'() {
    const app = boot();
    await settled(app);
    app.state().setSetting('firstOpenedAt', 111);
    app.state().setSetting('lastOpenedAt', 222);
    const backup = JSON.stringify({
      _app: 'student-hub', _v: 3, _exportedAt: '2026-10-03T08:00:00.000Z',
      settings: { name: 'Elsewhere', firstOpenedAt: 5, lastOpenedAt: 6 }, notes: [{ id: 'n', title: 'T', body: '', attachments: [] }],
    });
    const read = app.store.readSnapshot(backup);
    assert.equal(read.exportedAt, '2026-10-03T08:00:00.000Z');
    assert.equal(read.data.notes.length, 1);
    assert.equal(app.state().notes.length, 0, 'reading changes nothing');
    assert.equal(app.store.readSnapshot('{"hello":1}'), null);
    assert.equal(app.store.importSnapshot(backup), true);
    const s = app.state().settings;
    assert.equal(s.name, 'Elsewhere');
    assert.equal(s.firstOpenedAt, 111, "this phone's first visit stays");
    assert.equal(s.lastOpenedAt, 222, "this phone's last visit stays");
    const before = app.state();
    app.state().setSetting('lastOpenedAt', 333);
    assert.equal(app.store.isDeviceOnlyChange(app.state(), before), true);
    const mid = app.state();
    app.state().setSetting('name', 'Changed');
    assert.equal(app.store.isDeviceOnlyChange(app.state(), mid), false);
    assert.deepEqual(Object.keys(app.store.withoutDeviceSettings(app.state().settings)).filter((k) => /OpenedAt$/.test(k)), []);
  },

  async 'storage that answers late replaces the defaults, resumes saving and says so'() {
    let release;
    const gate = new Promise((r) => { release = r; });
    const saved = { ...V4, settings: { ...V4.settings, name: 'Saved' } };
    const app = boot({ [KEY]: JSON.stringify({ state: saved, version: 4 }) }, { gate });
    await sleep(10);
    app.store.giveUpWaitingForHydration();
    assert.equal(app.store.hydrationSettled(), true);
    assert.equal(app.store.savingPaused(), true);
    assert.equal(app.store.localDataState(), 'waiting', 'defaults are never sent anywhere');
    app.state().setSetting('name', 'Typed while waiting');
    release();
    for (let i = 0; i < 100 && !app.notices.length; i++) await sleep(5);
    assert.deepEqual(app.notices, ['late-load']);
    assert.equal(app.state().settings.name, 'Saved');
    assert.equal(app.store.savingPaused(), false);
    assert.equal(app.store.localDataState(), 'ok');
    app.state().setSetting('name', 'After');
    await flush(app);
    assert.equal(app.row('settings').name, 'After', 'saving resumed');
    assert.ok(app.row('notes'), 'every collection is written once saving resumes');
  },

  // ---------- one row per collection ----------

  async 'the rows round-trip: what one launch saves, the next loads'() {
    const first = boot();
    await settled(first);
    first.state().setSetting('name', 'Asha');
    first.state().addNote({ title: 'Waves', body: 'λ = v / f' });
    first.state().addDaily('Read', { repeat: 'daily', time: '17:00', remind: 'hour' });
    first.state().setDesmosState('{"graph":1}');
    await flush(first);
    const meta = first.meta();
    assert.equal(meta.version, 6);
    for (const k of ['settings', 'notes', 'dailyTasks', 'trash', 'desmosState']) {
      assert.ok(meta.keys.includes(k), 'the meta row names ' + k);
      assert.ok(first.storage.has(ROW(k)), k + ' has a row of its own');
    }
    assert.ok(first.store.savedSize() > 0);
    assert.equal(first.store.largestCollection().chars, first.store.savedSize(), 'the size is the largest row');

    const second = boot({}, { storage: first.storage });
    await settled(second);
    const s = second.state();
    assert.equal(s.settings.name, 'Asha');
    assert.equal(s.notes[0].body, 'λ = v / f');
    assert.deepEqual(
      { repeat: s.dailyTasks[0].repeat, time: s.dailyTasks[0].time, remind: s.dailyTasks[0].remind },
      { repeat: 'daily', time: '17:00', remind: 'hour' },
    );
    assert.equal(s.desmosState, '{"graph":1}');
    assert.equal(second.store.loadFailedThisLaunch(), false);
    assert.deepEqual(second.notices, []);
  },

  async 'the old single row moves to rows, and goes only after a later launch loads them'() {
    const saved = { ...V4, settings: { ...V4.settings, accent: '#D97757' }, dailyTasks: [{ id: 'd1', title: 'Read', doneOn: null, createdAt: 1 }] };
    const first = boot({ [KEY]: JSON.stringify({ state: saved, version: 5 }) });
    await settled(first);
    assert.equal(first.state().settings.accent, '#DB7E5F', 'Terracotta moves too');
    assert.equal(first.state().dailyTasks[0].repeat, 'daily');
    await flush(first);
    assert.equal(first.meta().version, 6, 'the first save writes the rows');
    assert.ok(first.storage.has(KEY), 'the old row is still there');
    const second = boot({}, { storage: first.storage });
    await settled(second);
    await sleep(10);
    assert.equal(second.state().settings.name, 'Sam', 'loaded from the rows');
    assert.equal(second.storage.has(KEY), false, 'a clean load from the rows lets the old row go');
  },

  async 'a row that cannot be read loses only its own collection, and is never written over'() {
    const first = boot();
    await settled(first);
    first.state().setSetting('name', 'Asha');
    first.state().addNote({ title: 'Precious', body: 'only copy' });
    await flush(first);
    const notesText = first.storage.get(ROW('notes'));
    for (const fault of ['unreadable', 'garbled']) {
      const storage = new Map(first.storage);
      const faults = {};
      if (fault === 'unreadable') faults.unreadable = [ROW('notes')];
      else storage.set(ROW('notes'), notesText.slice(0, 20));
      const before = storage.get(ROW('notes'));
      const app = boot({}, { storage, faults });
      await settled(app);
      await sleep(5);
      assert.equal(app.state().settings.name, 'Asha', fault + ': the rest loads');
      assert.deepEqual(app.state().notes, [], fault + ': the collection starts fresh this launch');
      assert.deepEqual(app.notices, ['failed-paused']);
      assert.deepEqual(app.named[0], ['Notes'], fault + ': the notice names it');
      assert.equal(app.store.loadFailedThisLaunch(), true);
      assert.equal(app.store.localDataState(), 'failed', fault + ': nothing goes over a copy elsewhere');
      app.state().addNote({ title: 'Typed meanwhile' });
      app.state().setSetting('name', 'Asha K');
      await flush(app);
      assert.equal(storage.get(ROW('notes')), before, fault + ': the row is never written over');
      assert.equal(JSON.parse(storage.get(ROW('settings'))).name, 'Asha K', fault + ': the others save as usual');
      assert.ok(JSON.parse(storage.get(META)).keys.includes('notes'), fault + ': and stay named');
    }
  },

  async 'a move into or out of Recently deleted is never saved on one side only'() {
    const first = boot();
    await settled(first);
    const keep = first.state().addNote({ title: 'Keep me' });
    const gone = first.state().addNote({ title: 'Deleted' });
    const tid = first.state().trashNote(gone);
    await flush(first);
    // Recently deleted cannot be read: a delete moves nothing, so the note is not saved away into a row that is not saved
    const blockedTrash = new Map(first.storage);
    blockedTrash.set(ROW('trash'), '{broken');
    const a = boot({}, { storage: blockedTrash });
    await settled(a);
    assert.equal(a.state().trashNote(keep), null, 'nothing is moved');
    await flush(a);
    assert.ok(JSON.parse(blockedTrash.get(ROW('notes'))).some((n) => n.id === keep), 'the note stays saved');
    assert.equal(blockedTrash.get(ROW('trash')), '{broken', 'and the trash row is never written over');
    // Notes cannot be read: a restore brings the note back and it stays in Recently deleted, which is saved
    const blockedNotes = new Map(first.storage);
    blockedNotes.set(ROW('notes'), '{broken');
    const b = boot({}, { storage: blockedNotes });
    await settled(b);
    assert.equal(b.state().restoreFromTrash(tid), 'ok');
    assert.ok(b.state().notes.some((n) => n.id === gone), 'it is back for this launch');
    await flush(b);
    assert.ok(JSON.parse(blockedNotes.get(ROW('trash'))).some((t) => t.id === tid), 'and still kept where it is saved');
    assert.equal(b.state().restoreFromTrash(tid), 'ok');
    await flush(b);
    assert.ok(JSON.parse(blockedNotes.get(ROW('trash'))).some((t) => t.id === tid), 'a second tap loses nothing either');
  },

  async 'a save writes only the rows that changed, and the meta row last'() {
    const app = boot();
    await settled(app);
    app.state().addNote({ title: 'One' });
    await flush(app);
    app.writes.length = 0;
    app.state().setSetting('name', 'Changed');
    await flush(app);
    assert.deepEqual(app.writes, [[ROW('settings'), META]]);
    app.writes.length = 0;
    app.state().setSetting('name', 'Changed');
    await flush(app);
    assert.deepEqual(app.writes, [], 'nothing changed, nothing written');
  },

  // ---------- 1.7's data ----------

  async 'the v6 migration makes old ToDos daily, sets the new defaults, and changes nothing twice'() {
    const app = boot();
    await settled(app);
    const { migrateV6, readSnapshot, DEFAULT_SETTINGS } = app.store;
    const old = {
      settings: { name: 'Sam', accent: '#8b7cf8', ownSignature: { v: 1, recordedAt: 1, strokes: 'bad' } },
      dailyTasks: [{ id: 'a', title: 'Read', doneOn: null, createdAt: 1 }, { id: 'b', title: 'Run', doneOn: null, createdAt: 1, time: '25:00', remind: 'hour' }],
      missions: [{ id: 'm', title: 'Essay', deadline: '2026-11-01', done: false, subtasks: [], doneOn: '2026-10-01', remind: 'soon' }],
    };
    const once = migrateV6(old, true);
    assert.deepEqual(once.dailyTasks.map((t) => t.repeat), ['daily', 'daily']);
    assert.ok(!('time' in once.dailyTasks[1]) && !('remind' in once.dailyTasks[1]), 'a bad time goes, and its reminder with it');
    assert.ok(!('doneOn' in once.missions[0]) && !('remind' in once.missions[0]));
    assert.equal(once.settings.accent, '#9588F9', 'any case');
    assert.equal(once.settings.ownSignature, null, 'a damaged signature is dropped');
    assert.equal(once.settings.signatureSource, 'creator');
    for (const k of ['introTapSkip', 'focusChime', 'examReminders', 'blockAlerts', 'attachmentsWifiOnly', 'calcAngle', 'calcFunctions', 'calcSci', 'focusLastMin', 'focusLastMode']) {
      assert.equal(once.settings[k], DEFAULT_SETTINGS[k], k + ' takes its default');
    }
    assert.deepEqual(migrateV6(once, true), once, 'a second pass changes nothing');
    // a backup from before 1.7 has its ToDos made daily; a 1.7 backup's one-offs stay one-offs
    const older = readSnapshot(JSON.stringify({ _app: 'student-hub', _v: 3, dailyTasks: [{ id: 'a', title: 'A', doneOn: null, createdAt: 1 }] }));
    assert.equal(older.data.dailyTasks[0].repeat, 'daily');
    const newer = readSnapshot(JSON.stringify({ _app: 'student-hub', _v: 4, dailyTasks: [{ id: 'a', title: 'A', doneOn: null, createdAt: 1 }] }));
    assert.ok(!('repeat' in newer.data.dailyTasks[0]));
  },

  async 'a recorded signature is kept within its limits, and dropped when damaged'() {
    const app = boot();
    await settled(app);
    const { sanitizeSignature } = app.store;
    const stroke = (n) => ({ pts: Array.from({ length: n }, (_, i) => [i / n, 0.5, i * 10]) });
    const digits = Object.fromEntries('0123456789'.split('').map((d) => [d, { strokes: [stroke(500)] }]));
    const sig = sanitizeSignature({
      v: 1, recordedAt: 5, strokes: [stroke(1500), stroke(1500), { pts: [[0.1, 0.1, 0], [null, 0.2, 5]] }], digits,
      date: { size: 0.2, gap: 0.05, tilt: -3, when: 'outro', groups: { dd: { x: 0.1, y: 0.8 }, mm: { x: 0.4, y: 0.8 }, yy: { x: 0.7, y: 0.8 } } },
    });
    assert.ok(sig.strokes.reduce((n, s) => n + s.pts.length, 0) <= 2000, 'at most 2000 points');
    assert.equal(sig.strokes[2].pts.length, 1, 'a point holding a non-finite number is dropped');
    assert.ok(sig.digits['7'].strokes[0].pts.length <= 400, 'at most 400 per digit');
    assert.equal(sig.date.when, 'outro');
    assert.equal(sanitizeSignature({ v: 1, recordedAt: 5, strokes: [{ pts: 'x' }] }), null);
    const noDigits = sanitizeSignature({ v: 1, recordedAt: 5, strokes: [stroke(3)], digits: { 0: 'bad' } });
    assert.ok(noDigits && !('digits' in noDigits), 'damaged digits go on their own');
  },

  async 'one-off ToDos ticked on an earlier day leave on a new day; daily ones stay'() {
    const app = boot();
    await settled(app);
    const yesterday = dayKey(app.utils, -1);
    const today = app.utils.todayKey();
    app.store.useStore.setState({
      dailyTasks: [
        { id: 'once-done-yesterday', title: 'A', doneOn: yesterday, createdAt: 1 },
        { id: 'once-done-today', title: 'B', doneOn: today, createdAt: 1 },
        { id: 'once-open', title: 'C', doneOn: null, createdAt: 1 },
        { id: 'daily-done-yesterday', title: 'D', doneOn: yesterday, createdAt: 1, repeat: 'daily' },
      ],
    });
    app.state().settleDay();
    assert.deepEqual(app.state().dailyTasks.map((t) => t.id), ['once-done-today', 'once-open', 'daily-done-yesterday']);
    // and at launch, from what was saved
    await flush(app);
    app.store.useStore.setState({ dailyTasks: [...app.state().dailyTasks, { id: 'late', title: 'E', doneOn: yesterday, createdAt: 1 }] });
    await flush(app);
    const next = boot({}, { storage: app.storage });
    await settled(next);
    await sleep(5);
    assert.ok(!next.state().dailyTasks.some((t) => t.id === 'late'), 'settled at launch');
    // a ToDo's reminder needs its time
    const id = next.state().addDaily('Call', { time: '09:00', remind: 'morning' });
    next.state().updateDaily(id, { time: null });
    const t = next.state().dailyTasks.find((x) => x.id === id);
    assert.ok(!('time' in t) && !('remind' in t) && !('repeat' in t), 'a new ToDo is a one-off; its reminder goes with its time');
    // a backup brought in after this launch settled its day is settled too, so yesterday's ticks never come back open
    const snap = { ...next.store.exportSnapshot(), dailyTasks: [{ id: 'old-tick', title: 'F', doneOn: yesterday, createdAt: 1 }] };
    assert.equal(next.store.importSnapshot(JSON.stringify(snap)), true);
    assert.ok(!next.state().dailyTasks.some((x) => x.id === 'old-tick'), 'settled on the way in');
  },

  async 'long-term tasks remember the day they were ticked, and deletes can be undone'() {
    const app = boot();
    await settled(app);
    const st = app.state;
    const m = st().addMission('Essay', '2026-11-01');
    st().toggleMission(m);
    assert.equal(st().missions[0].doneOn, app.utils.todayKey());
    st().toggleMission(m);
    assert.ok(!('doneOn' in st().missions[0]));
    st().updateMission(m, { time: '17:00', remind: 'hour' });
    st().updateMission(m, { remind: null });
    assert.deepEqual([st().missions[0].time, 'remind' in st().missions[0]], ['17:00', false]);
    st().addSubtask(m, 'Outline');
    st().addSubtask(m, 'Draft');
    const sub = st().removeSubtask(m, st().missions[0].subtasks[0].id);
    st().restoreSubtask(m, sub.subtask, sub.index);
    assert.deepEqual(st().missions[0].subtasks.map((x) => x.title), ['Outline', 'Draft']);
    const gone = st().removeMission(m);
    assert.equal(st().missions.length, 0);
    st().restoreMission(gone.mission, gone.index);
    assert.equal(st().missions.length, 1);
    const sid = st().logSession({ dateKey: '2026-10-01', endedAt: 1, netSeconds: 60, taskTitles: [] });
    const removed = st().removeSession(sid);
    st().restoreSession(removed.session, removed.index);
    assert.equal(st().sessions[0].id, sid);
    // habits: today and the six days before, never a day to come
    st().addHabit('Walk');
    const h = st().habits[0].id;
    st().toggleHabitDay(h, dayKey(app.utils, -6));
    st().toggleHabitDay(h, dayKey(app.utils, -7));
    st().toggleHabitDay(h, dayKey(app.utils, 1));
    assert.deepEqual(st().habits[0].doneDates, [dayKey(app.utils, -6)]);
    st().renameHabit(h, '  Evening walk ');
    assert.equal(st().habits[0].title, 'Evening walk');
  },

  // ---------- Recently deleted ----------

  async 'every kind of delete goes to Recently deleted and comes back in its place'() {
    const app = boot();
    await settled(app);
    const st = app.state;
    st().addNote({ title: 'Second' });
    const n = st().addNote({ title: 'First' });
    st().addAttachment(n, { kind: 'image', uri: 'file:///doc/attachments/a.jpg', name: 'a.jpg' });
    st().addAttachment(n, { kind: 'file', uri: 'file:///doc/attachments/b.pdf', name: 'b.pdf' });
    const [a1] = st().notes[0].attachments;
    const v = st().addVideo({ url: 'u', videoId: 'abcdefghijk', title: 'Lecture' });
    st().addTimedNote(v, 30, 'Key idea');
    st().addBookmark(v, 60, 'Proof');
    st().upsertJournalEntry({ id: 'j1', dateKey: '2026-10-01', title: '', excerpt: 'x', tags: [], wordCount: 1, pinned: false, createdAt: 1, updatedAt: 1 });

    const ta = st().trashAttachment(n, a1.id);
    assert.equal(st().notes[0].attachments.length, 1);
    const tn = st().trashNote(n);
    assert.equal(st().notes.length, 1);
    assert.equal(st().restoreFromTrash(ta), 'parent-missing', 'a part waits for its note');
    assert.equal(st().restoreFromTrash(tn), 'ok');
    assert.equal(st().notes[0].id, n, 'back at its place');
    assert.equal(st().restoreFromTrash(ta), 'ok');
    assert.deepEqual(st().notes[0].attachments.map((x) => x.id)[0], a1.id, 'the attachment back in its place');

    const tt = st().trashTimedNote(v, st().vaultVideos[0].notes[0].id);
    const tb = st().trashBookmark(v, st().vaultVideos[0].bookmarks[0].id);
    const tv = st().trashVideo(v);
    const tj = st().trashJournalEntry('j1');
    assert.equal(st().trash.length, 4);
    assert.equal(st().trash.find((t) => t.id === tj).title, 'Entry for ' + app.utils.fmtShortDate('2026-10-01'));
    assert.equal(st().restoreFromTrash(tt), 'parent-missing');
    for (const id of [tv, tt, tb, tj]) assert.equal(st().restoreFromTrash(id), 'ok');
    assert.equal(st().vaultVideos[0].notes.length, 1);
    assert.equal(st().vaultVideos[0].bookmarks.length, 1);
    assert.equal(st().journal.length, 1);
    assert.deepEqual(st().trash, []);
    assert.equal(st().restoreFromTrash(tv), 'ok', 'an Undo tapped twice is harmless');
    assert.equal(st().vaultVideos.length, 1);
  },

  async 'locked items stay locked in Recently deleted, as their tools are'() {
    const app = boot();
    await settled(app);
    const st = app.state;
    const n = st().addNote({ title: 'Secret' });
    st().updateNote(n, { locked: true }, { touch: false });
    const open = st().addNote({ title: 'Open' });
    st().upsertJournalEntry({ id: 'j1', dateKey: '2026-10-01', title: 'Day', excerpt: '', tags: [], wordCount: 0, pinned: false, createdAt: 1, updatedAt: 1 });
    const tn = st().trashNote(n);
    const to = st().trashNote(open);
    const tj = st().trashJournalEntry('j1');
    const lockOf = (id) => st().trash.find((t) => t.id === id).locked;
    assert.deepEqual([lockOf(tn), lockOf(to), lockOf(tj)], [true, false, false]);
    st().setSetting('journalLocked', true);
    assert.equal(lockOf(tj), true, 'locking the journal locks its entries in the trash');
    st().setSetting('journalLocked', false);
    assert.equal(lockOf(tj), false);
    assert.equal(lockOf(tn), true, 'a locked note stays locked');
  },

  async 'deleting for good takes the files, and the purge after 30 days does it at launch'() {
    const app = boot();
    await settled(app);
    const st = app.state;
    const n = st().addNote({ title: 'With a photo' });
    st().addAttachment(n, { kind: 'image', uri: 'file:///doc/attachments/p.jpg', name: 'p.jpg' });
    st().addAttachment(n, { kind: 'image', uri: 'content://gallery/1', name: 'g.jpg' });
    const kept = st().addNote({ title: 'Shares a file' });
    st().addAttachment(kept, { kind: 'image', uri: 'file:///doc/attachments/shared.jpg', name: 's.jpg' });
    st().addAttachment(n, { kind: 'image', uri: 'file:///doc/attachments/shared.jpg', name: 's.jpg' });
    st().upsertJournalEntry({ id: 'j1', dateKey: '2026-10-01', title: '', excerpt: '', tags: [], wordCount: 0, pinned: false, createdAt: 1, updatedAt: 1 });
    const tn = st().trashNote(n);
    const tj = st().trashJournalEntry('j1');
    st().deleteFromTrash(tn);
    await sleep(5);
    assert.deepEqual(app.deleted, ['file:///doc/attachments/p.jpg'], "only the app's own copy nothing else uses");
    st().emptyTrash();
    await sleep(5);
    assert.ok(app.deleted.includes('file:///doc/journal/j1.txt'), "the entry's text goes too");
    assert.deepEqual(st().trash, []);
    assert.equal(st().restoreFromTrash(tj), 'ok', 'gone for good is gone');
    assert.equal(st().journal.length, 0);

    // a launch purges what has been there 30 days
    const old = { id: 'old', kind: 'video', deletedAt: Date.now() - 31 * DAY, title: 'Old', locked: false, data: { id: 'v', notes: [], bookmarks: [] } };
    const fresh = { ...old, id: 'fresh', deletedAt: Date.now() - DAY, data: { id: 'v2', notes: [], bookmarks: [] } };
    app.store.useStore.setState({ trash: [old, fresh] });
    await flush(app);
    const next = boot({}, { storage: app.storage });
    await settled(next);
    await sleep(5);
    assert.deepEqual(next.state().trash.map((t) => t.id), ['fresh']);
    assert.equal(next.store.trashDaysLeft(fresh), 29);
  },

  async 'a backup carries Recently deleted and the Desmos graph, and an import brings them back'() {
    const app = boot();
    await settled(app);
    const st = app.state;
    const n = st().addNote({ title: 'Gone' });
    st().trashNote(n);
    st().setDesmosState('{"x":1}');
    assert.equal(st().setDesmosState('x'.repeat(300001)), false, 'too large a graph is refused');
    assert.equal(st().desmosState, '{"x":1}', 'and the old one kept');
    const snap = JSON.stringify(app.store.exportSnapshot());
    st().emptyTrash();
    st().setDesmosState('');
    assert.equal(app.store.importSnapshot(snap), true);
    assert.equal(st().trash.length, 1);
    assert.equal(st().trash[0].data.title, 'Gone');
    assert.equal(st().desmosState, '{"x":1}');
    assert.equal(app.store.hasAnyUserData(JSON.parse(snap)), true, 'something deleted is still data');
  },
  // ---------- 1.8: habit days and the day's record ----------

  async 'a habit kept on some weekdays: rest days neither count nor break, and every day matches the old count'() {
    const app = boot();
    await settled(app);
    const u = app.utils;
    const key = (n) => dayKey(u, n);
    const wd = (n) => u.weekdayIndex(new Date(key(n) + 'T00:00:00'));
    // the count as it was before weekdays came in, kept here to hold the every-day case to it
    const before = (doneDates) => {
      if (!doneDates || doneDates.length === 0) return { current: 0, best: 0 };
      const set = new Set(doneDates);
      const sorted = [...set].sort();
      let best = 1, run = 1;
      const dayNo = (k) => { const [y, m, d] = k.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
      for (let i = 1; i < sorted.length; i++) {
        run = dayNo(sorted[i]) - dayNo(sorted[i - 1]) === 1 ? run + 1 : 1;
        if (run > best) best = run;
      }
      let current = 0;
      const cursor = new Date();
      if (!set.has(u.todayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
      while (set.has(u.todayKey(cursor))) { current++; cursor.setDate(cursor.getDate() - 1); }
      return { current, best };
    };
    let seed = 7;
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 300; i++) {
      const dates = [];
      for (let d = -60; d <= 2; d++) if (rand() < (i % 3 === 0 ? 0.85 : 0.4)) dates.push(key(d));
      const want = before(dates);
      assert.deepEqual(u.streaks(dates), want, 'no days: as before');
      assert.deepEqual(u.streaks(dates, undefined), want);
      assert.deepEqual(u.streaks(dates, []), want, 'none chosen is every day');
      assert.deepEqual(u.streaks(dates, [0, 1, 2, 3, 4, 5, 6]), want, 'all seven is every day');
      assert.deepEqual(u.streaks(dates, [6, 5, 4, 3, 2, 1, 0, 0]), want, 'in any order');
    }
    // due on today's weekday only: the six days between are rest days
    assert.deepEqual(u.streaks([key(0), key(-7), key(-14)], [wd(0)]), { current: 3, best: 3 });
    assert.deepEqual(u.streaks([key(-7), key(-14)], [wd(0)]), { current: 2, best: 2 }, 'today not done yet never breaks it');
    assert.deepEqual(u.streaks([key(-14)], [wd(0)]), { current: 0, best: 1 }, 'a due day missed ends it');
    // a rest day done still counts
    assert.deepEqual(u.streaks([key(0), key(-1)], [wd(0)]), { current: 2, best: 2 });
    // a due day not done ends the run, even with a rest day done before it
    assert.deepEqual(u.streaks([key(0), key(-2)], [wd(0), wd(-1)]), { current: 1, best: 1 });
    // best runs forward over rest days: every weekday but one, done for eleven days around it
    const skip = wd(-25);
    const days = [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== skip);
    const run = [];
    for (let d = -30; d <= -20; d++) if (d !== -25) run.push(key(d));
    assert.deepEqual(u.streaks(run, days), { current: 0, best: 10 });
    // due checks and words
    assert.equal(u.habitDueOn({}, key(0)), true);
    assert.equal(u.habitDueOn({ days: [wd(0)] }, key(0)), true);
    assert.equal(u.habitDueOn({ days: [wd(-1)] }, new Date(key(0) + 'T12:00:00')), false);
    assert.equal(u.daysLabel(undefined), 'Every day');
    assert.equal(u.daysLabel([0, 1, 2, 3, 4]), 'Weekdays');
    assert.equal(u.daysLabel([6, 5]), 'Weekends');
    assert.equal(u.daysLabel([4, 0, 2]), 'Mon, Wed, Fri');
    assert.equal(u.weekdayIndex(new Date(2026, 9, 26)), 0, 'Monday is 0');
    assert.equal(u.weekdayIndex(new Date(2026, 10, 1)), 6, 'Sunday is 6');
  },

  async 'habit days are kept sorted and unique, set and cleared, and cleaned on load and import'() {
    const app = boot();
    await settled(app);
    const st = app.state;
    st().addHabit('Gym', undefined, [4, 0, 2, 2]);
    st().addHabit('Read', '21:00', [0, 1, 2, 3, 4, 5, 6]);
    const [gym, read] = st().habits;
    assert.deepEqual(gym.days, [0, 2, 4]);
    assert.ok(!('days' in read), 'all seven is every day, kept as none');
    st().setHabitDays(read.id, [5, 6]);
    assert.deepEqual(st().habits[1].days, [5, 6]);
    const same = st().habits;
    st().setHabitDays(read.id, [6, 5]);
    assert.equal(st().habits, same, 'the same days change nothing');
    st().setHabitDays(read.id, []);
    assert.ok(!('days' in st().habits[1]), 'none chosen is every day');
    // an Undo of a deleted habit brings its days back
    const h = st().habits[0];
    st().removeHabit(h.id);
    st().restoreHabit(h, 0);
    assert.deepEqual(st().habits[0].days, [0, 2, 4]);
    // what a save or a backup holds is cleaned
    const saved = {
      ...V4,
      habits: [
        { id: 'a', title: 'A', doneDates: ['2026-10-01', 7], days: [3, 1, 1, 9, -1, 2.5, 'x'] },
        { id: 'b', title: 'B', doneDates: 'bad', days: [0, 1, 2, 3, 4, 5, 6] },
        { id: 'c', title: 'C', doneDates: [], days: 'Mon' },
        { id: 'd', title: 'D', doneDates: [], days: [] },
      ],
    };
    const next = boot({ [KEY]: JSON.stringify({ state: saved, version: 6 }) });
    await settled(next);
    const hs = next.state().habits;
    assert.deepEqual(hs[0].days, [1, 3]);
    assert.deepEqual(hs[0].doneDates, ['2026-10-01']);
    assert.deepEqual(hs[1].doneDates, []);
    assert.ok(hs.slice(1).every((x) => !('days' in x)), 'all seven, junk and none are every day');
    const read2 = app.store.readSnapshot(JSON.stringify({ _app: 'student-hub', _v: 4, habits: saved.habits }));
    assert.deepEqual(read2.data.habits.map((x) => x.days), [[1, 3], undefined, undefined, undefined]);
    // a backup keeps them
    const snap = app.store.exportSnapshot();
    assert.equal(app.store.importSnapshot(JSON.stringify(snap)), true);
    assert.deepEqual(app.state().habits[0].days, [0, 2, 4]);
  },

  async "the day's record keeps each tick as it was, and a rename, a delete or an Undo never rewrites it"() {
    const app = boot();
    await settled(app);
    const st = app.state;
    const today = dayKey(app.utils, 0);
    const yest = dayKey(app.utils, -1);
    const a = st().addDaily('Read');
    const b = st().addDaily('Write', { repeat: 'daily' });
    st().toggleDaily(a);
    assert.deepEqual(st().doneLog[today], { todos: [{ id: a, title: 'Read' }] });
    st().toggleDaily(a);
    assert.equal(st().doneLog[today], undefined, 'an untick takes it off, and a day left empty goes');
    st().toggleDaily(a);
    st().toggleDaily(b);
    st().updateDaily(a, { title: 'Read chapter 3' });
    assert.deepEqual(st().doneLog[today].todos.map((t) => t.title), ['Read', 'Write'], 'a rename later never rewrites the day');
    const task = st().dailyTasks.find((t) => t.id === a);
    st().removeDaily(a);
    assert.equal(st().doneLog[today].todos.length, 2, 'a ToDo deleted after it was done keeps its line');
    st().restoreDaily(task, 0);
    st().restoreDaily(task, 0);
    assert.equal(st().doneLog[today].todos.length, 2, 'an Undo never adds it twice');
    // long-term tasks
    const m = st().addMission('Project', today);
    st().toggleMission(m);
    assert.deepEqual(st().doneLog[today].tasks, [{ id: m, title: 'Project' }]);
    st().toggleMission(m);
    assert.ok(!('tasks' in st().doneLog[today]), 'undone, it comes off');
    // one ticked yesterday and undone today comes off yesterday
    app.store.useStore.setState({
      missions: st().missions.map((x) => (x.id === m ? { ...x, done: true, doneOn: yest } : x)),
      doneLog: { ...st().doneLog, [yest]: { tasks: [{ id: m, title: 'Project' }] } },
    });
    st().toggleMission(m);
    assert.equal(st().doneLog[yest], undefined);
    st().toggleMission(m);
    const removed = st().removeMission(m);
    st().restoreMission(removed.mission, removed.index);
    st().restoreMission(removed.mission, removed.index);
    assert.equal(st().doneLog[today].tasks.length, 1, 'a delete and its Undo leave one line');
    // it travels in a backup and in the rows
    const snap = JSON.stringify(app.store.exportSnapshot());
    app.store.useStore.setState({ doneLog: {} });
    assert.equal(app.store.importSnapshot(snap), true);
    assert.equal(st().doneLog[today].todos.length, 2);
    await flush(app);
    assert.ok(app.meta().keys.includes('doneLog'), 'a row of its own');
    const next = boot({}, { storage: app.storage });
    await settled(next);
    assert.deepEqual(next.state().doneLog, st().doneLog);
    assert.equal(app.store.hasAnyUserData({ doneLog: { [today]: { todos: [{ id: 'x', title: 'X' }] } } }), true);
    assert.equal(app.store.hasAnyUserData({ doneLog: {} }), false);
  },

  async "the day's record keeps 400 days, and junk in it is cleaned on load and import"() {
    const app = boot();
    await settled(app);
    const k = (n) => dayKey(app.utils, n);
    app.store.useStore.setState({
      doneLog: {
        [k(-401)]: { todos: [{ id: 'a', title: 'Old' }] },
        [k(-400)]: { todos: [{ id: 'b', title: 'Kept' }] },
        [k(-3)]: { tasks: [{ id: 'c', title: 'Recent' }] },
      },
    });
    app.state().settleDay();
    assert.deepEqual(Object.keys(app.state().doneLog).sort(), [k(-400), k(-3)]);
    const junk = {
      [k(-1)]: { todos: [{ id: 'x', title: 5 }, { id: 'x', title: 'twice' }, { title: 'no id' }, null], tasks: 'bad' },
      'not-a-day': { todos: [{ id: 'y', title: 'Y' }] },
      [k(-2)]: { todos: [] },
      [k(-3)]: 'bad',
    };
    const cleaned = app.store.cleanDoneLog(junk);
    assert.deepEqual(cleaned, { [k(-1)]: { todos: [{ id: 'x', title: '5' }] } });
    assert.deepEqual(app.store.cleanDoneLog('oops'), {});
    const saved = { ...V4, doneLog: junk };
    const next = boot({ [KEY]: JSON.stringify({ state: saved, version: 6 }) });
    await settled(next);
    assert.deepEqual(next.state().doneLog, cleaned, 'cleaned on load');
    const read = app.store.readSnapshot(JSON.stringify({ _app: 'student-hub', _v: 4, doneLog: junk }));
    assert.deepEqual(read.data.doneLog, cleaned, 'and on import');
    const old = app.store.readSnapshot(JSON.stringify({ _app: 'student-hub', _v: 4, notes: [] }));
    app.store.applySnapshot(old);
    assert.deepEqual(app.state().doneLog, {}, 'a backup from before has none');
  },

  async 'the writing font and the parts of a written date are cleaned on load and import'() {
    const app = boot();
    await settled(app);
    assert.equal(app.state().settings.writingFont, 'sans', 'Sans by default');
    const { sanitizeSignature, migrateV6 } = app.store;
    assert.equal(migrateV6({ settings: { writingFont: 'serif' } }, false).settings.writingFont, 'serif');
    assert.equal(migrateV6({ settings: { writingFont: 'comic' } }, false).settings.writingFont, 'sans');
    const next = boot({ [KEY]: JSON.stringify({ state: { ...V4, settings: { ...V4.settings, writingFont: 7 } }, version: 6 }) });
    await settled(next);
    assert.equal(next.state().settings.writingFont, 'sans');
    const stroke = (n) => ({ pts: Array.from({ length: n }, (_, i) => [i / n, 0.5, i * 10]) });
    const digits = Object.fromEntries('0123456789'.split('').map((d) => [d, { strokes: [stroke(5)] }]));
    const place = { size: 0.2, gap: 0.05, tilt: -3, when: 'outro', groups: { dd: { x: 0.1, y: 0.8 }, mm: { x: 0.4, y: 0.8 }, yy: { x: 0.7, y: 0.8 } } };
    const sig = (parts) => sanitizeSignature({ v: 1, recordedAt: 5, strokes: [stroke(3)], digits, date: { ...place, parts } });
    assert.deepEqual(sig(['yy', 'dd', 'dd']).date.parts, ['dd', 'yy'], 'in the fixed order, once each');
    assert.deepEqual(sig(['mm', 'zz']).date.parts, ['mm']);
    assert.ok(!('parts' in sig([]).date), 'none is all three');
    assert.ok(!('parts' in sig('dd').date));
    assert.ok(!('parts' in sig(undefined).date));
    assert.deepEqual(sig(['dd', 'mm', 'yy']).date.parts, ['dd', 'mm', 'yy']);
    assert.deepEqual(sanitizeSignature(sig(['mm'])), sig(['mm']), 'a second pass changes nothing');
  },

  // ---------- 2.0 ----------

  async '2.0: the new fields are cleaned on load and on import'() {
    const app = boot();
    await settled(app);
    const s0 = app.state().settings;
    assert.equal(s0.focusGoalMin, 0, 'no focus goal by default');
    assert.equal(s0.focusAlertAsked, false);
    assert.equal(s0.backupNudgeAt, 0);
    assert.equal(app.state().todayLayout, null, "Today's board starts on its default arrangement");
    const saved = {
      ...V4,
      settings: { ...V4.settings, focusGoalMin: 90, focusAlertAsked: 'yes', backupNudgeAt: -5 },
      dailyTasks: [
        { id: 'w', title: 'Gym', doneOn: null, createdAt: 1, repeat: 'daily', days: [4, 0, 0, 9, 2] },
        { id: 'o', title: 'One-off', doneOn: null, createdAt: 1, days: [1] },
        { id: 'all', title: 'All', doneOn: null, createdAt: 1, repeat: 'daily', days: [0, 1, 2, 3, 4, 5, 6] },
      ],
      missions: [
        { id: 'm1', title: 'Essay', deadline: '2030-01-10', done: false, subtasks: [], early: ['1d', 'x', '3d', '1d'], remind: 'morning' },
        { id: 'm2', title: 'Lab', deadline: '2030-01-10', done: false, subtasks: [], early: [], remind: 'hour' },
      ],
      sessions: [
        { id: 's1', dateKey: '2026-10-01', endedAt: 5, netSeconds: 600, taskTitles: [], manual: true, subject: 'Physics' },
        { id: 's2', dateKey: '2026-10-01', endedAt: 6, netSeconds: 600, taskTitles: [], manual: 'yes', subject: 4 },
      ],
      todayLayout: [
        { id: 'a', type: 'dayRing', size: 'S' },
        { id: 'a', type: 'twice', size: 'M' },
        { id: 'b', type: 'checklist', size: 'XL', config: { n: 4 } },
        { type: 'no-id' }, null, 'junk',
      ],
    };
    const check = (d, where) => {
      const task = (id) => d.dailyTasks.find((t) => t.id === id);
      assert.deepEqual(task('w').days, [0, 2, 4], 'weekdays sorted, once each, ' + where);
      assert.ok(!('days' in task('o')), 'a one-off has no weekdays, ' + where);
      assert.ok(!('days' in task('all')), 'all seven is every day, ' + where);
      assert.deepEqual(d.missions[0].early, ['3d', '1d'], where);
      assert.equal(d.missions[0].remind, 'morning', 'the morning of needs no time, ' + where);
      assert.ok(!('early' in d.missions[1]), where);
      assert.ok(!('remind' in d.missions[1]), 'an hour before needs a time, ' + where);
      assert.equal(d.sessions[0].manual, true, where);
      assert.equal(d.sessions[0].subject, 'Physics', where);
      assert.ok(!('manual' in d.sessions[1]) && !('subject' in d.sessions[1]), where);
      assert.deepEqual(d.todayLayout, [
        { id: 'a', type: 'dayRing', size: 'S' },
        { id: 'b', type: 'checklist', size: 'M', config: { n: 4 } },
      ], where);
      assert.equal(d.settings.focusGoalMin, 90, where);
      assert.equal(d.settings.focusAlertAsked, false, where);
      assert.equal(d.settings.backupNudgeAt, 0, where);
    };
    const next = boot({ [KEY]: JSON.stringify({ state: saved, version: 6 }) });
    await settled(next);
    check(next.state(), 'on load');
    const read = app.store.readSnapshot(JSON.stringify({ _app: 'student-hub', _v: 4, ...saved }));
    check(read.data, 'on import');
    assert.deepEqual(app.store.sanitizeV6(read.data), read.data, 'a second pass changes nothing');
    // quick action tiles come through an import; one with no action is dropped
    const q = app.store.readSnapshot(JSON.stringify({
      _app: 'student-hub', _v: 4,
      quickAccess: [
        { id: 'q1', label: 'New note', icon: 'create-outline', color: 'amber', kind: 'action', target: 'new-note' },
        { id: 'q2', label: 'Nothing', icon: 'ellipse', color: 'amber', kind: 'action', target: '' },
      ],
    }));
    assert.deepEqual(q.data.quickAccess.map((x) => x.target), ['new-note']);
    // the board: known types only when the registry is asked, null for anything that is not a list
    const { cleanTodayLayout } = app.store;
    assert.deepEqual(cleanTodayLayout([{ id: 'a', type: 'dayRing', size: 'S' }, { id: 'b', type: 'gone', size: 'S' }], ['dayRing']).map((w) => w.id), ['a']);
    assert.equal(cleanTodayLayout('x'), null);
    assert.deepEqual(cleanTodayLayout([]), [], 'an empty board is kept: everything removed');
    const st = app.state;
    st().setTodayLayout([{ id: 'x', type: 'clock', size: 'L' }, { id: 'x', type: 'clock', size: 'S' }]);
    assert.deepEqual(st().todayLayout, [{ id: 'x', type: 'clock', size: 'L' }]);
    st().setTodayLayout(null);
    assert.equal(st().todayLayout, null);
    // a weekly ToDo, and its weekdays going when it is made a one-off
    const id = st().addDaily('Swim', { repeat: 'daily', days: [5, 6, 5] });
    assert.deepEqual(st().dailyTasks.find((t) => t.id === id).days, [5, 6]);
    st().updateDaily(id, { days: null });
    assert.ok(!('days' in st().dailyTasks.find((t) => t.id === id)), 'every day again');
    st().updateDaily(id, { days: [1] });
    st().updateDaily(id, { repeat: null });
    assert.ok(!('days' in st().dailyTasks.find((t) => t.id === id)), 'made a one-off, its weekdays go');
    const m = st().addMission('Essay', '2030-01-01');
    st().updateMission(m, { early: ['1d', '3d'], remind: 'hour' });
    assert.deepEqual(st().missions.find((x) => x.id === m).early, ['3d', '1d']);
    assert.ok(!('remind' in st().missions.find((x) => x.id === m)), 'an hour before with no time goes');
    st().updateMission(m, { early: null });
    assert.ok(!('early' in st().missions.find((x) => x.id === m)));
  },

  async '2.0: habits, long-term tasks and exams go to Recently deleted and come back in their place'() {
    const app = boot();
    await settled(app);
    const st = app.state;
    st().addHabit('Walk');
    st().addHabit('Read');
    const [h1, h2] = st().habits;
    st().toggleHabitToday(h1.id);
    const t1 = st().trashHabit(h1.id);
    assert.ok(t1);
    assert.deepEqual(st().habits.map((h) => h.id), [h2.id]);
    assert.equal(st().trash[0].kind, 'habit');
    assert.equal(st().trash[0].title, 'Walk');
    assert.equal(st().trash[0].locked, false);
    assert.equal(st().restoreFromTrash(t1), 'ok');
    assert.deepEqual(st().habits.map((h) => h.id), [h1.id, h2.id], 'back in its place');
    assert.equal(st().habits[0].doneDates.length, 1, 'streak and all');
    assert.equal(st().trash.length, 0);
    assert.equal(st().trashHabit('nope'), null);

    const m1 = st().addMission('Essay', '2030-01-01');
    const m2 = st().addMission('Lab', '2030-01-02');
    st().addSubtask(m1, 'Outline');
    st().toggleMission(m1);
    const t2 = st().trashMission(m1);
    assert.deepEqual(st().missions.map((m) => m.id), [m2]);
    assert.ok(st().doneLog[app.utils.todayKey()].tasks.some((x) => x.id === m1), "the day's record keeps the tick");
    assert.equal(st().restoreFromTrash(t2), 'ok');
    assert.deepEqual(st().missions.map((m) => m.id), [m1, m2]);
    assert.equal(st().missions[0].subtasks.length, 1);
    assert.equal(st().missions[0].done, true);

    const g = st().addScoreNode({ kind: 'group', parentId: null, title: 'Term 1' });
    const tag = st().addScoreTag('Hard');
    const { id: ex } = st().saveExam({
      parentId: g, fields: { title: 'Mock', date: '2030-02-01', tags: [tag] }, subjects: [{ title: 'Physics', score: 40, outOf: 50 }], removeIds: [],
    });
    const sub = st().scores.find((n) => n.parentId === ex);
    st().addLearning({ nodeId: sub.id, text: 'Units', tags: [tag] });
    const t3 = st().trashExam(ex);
    assert.deepEqual(st().scores.map((n) => n.id), [g], 'only the group stays');
    assert.equal(st().learnings.length, 0, 'its learnings go with it');
    const item = st().trash.find((t) => t.id === t3);
    assert.equal(item.kind, 'exam');
    assert.equal(item.title, 'Mock');
    assert.equal(item.data.nodes.length, 2);
    assert.equal(st().restoreFromTrash(t3), 'ok');
    assert.equal(st().scores.length, 3);
    assert.equal(st().scores.find((n) => n.id === ex).parentId, g, 'back in its group');
    assert.equal(st().learnings.length, 1);
    assert.equal(st().restoreFromTrash(t3), 'ok', 'an Undo tapped twice');
    assert.equal(st().scores.length, 3, 'nothing comes in twice');

    // its group and a tag deleted meanwhile: it comes back at the top level, without the tag
    const t4 = st().trashExam(ex);
    st().removeScoreNode(g);
    st().removeScoreTag(tag);
    assert.equal(st().restoreFromTrash(t4), 'ok');
    const back = st().scores.find((n) => n.id === ex);
    assert.equal(back.parentId, null);
    assert.ok(!back.tags || !back.tags.includes(tag));
    assert.deepEqual(st().learnings[0].tags, []);

    // saved and loaded again, every new kind is still a trash item
    st().trashHabit(h2.id);
    st().trashMission(m2);
    st().trashExam(ex);
    await flush(app);
    const again = boot({}, { storage: app.storage });
    await settled(again);
    const kinds = again.state().trash.map((t) => t.kind).sort();
    assert.deepEqual(kinds, ['exam', 'habit', 'mission']);
    for (const t of again.state().trash) assert.equal(again.state().restoreFromTrash(t.id), 'ok');
    assert.ok(again.state().habits.some((h) => h.id === h2.id));
    assert.ok(again.state().missions.some((m) => m.id === m2));
    assert.ok(again.state().scores.some((n) => n.id === ex));
    // an exam item that lost its own node is no item at all
    const junk = again.store.sanitizeV6({ trash: [{ id: 'z', kind: 'exam', deletedAt: 1, title: 'x', locked: false, data: { id: 'e', nodes: [{ id: 'f' }] } }] });
    assert.deepEqual(junk.trash, []);
    // gone for good after 30 days
    again.state().trashHabit(h2.id);
    again.state().purgeTrash(Date.now() + 32 * DAY);
    assert.equal(again.state().trash.length, 0);
  },

  async '2.0: sessions are logged and edited by hand'() {
    const app = boot();
    await settled(app);
    const st = app.state;
    const today = app.utils.todayKey();
    st().logSession({ dateKey: today, endedAt: Date.now() - 1000, netSeconds: 300, taskTitles: [] });
    const id = st().addManualSession({ dateKey: dayKey(app.utils, -1), minutes: 45, subject: '  Chem  lab ' });
    assert.ok(id);
    assert.equal(st().sessions[0].id, id, "yesterday's goes before today's");
    assert.equal(st().sessions[0].manual, true);
    assert.equal(st().sessions[0].netSeconds, 2700);
    assert.equal(st().sessions[0].subject, 'Chem lab');
    assert.equal(st().addManualSession({ dateKey: dayKey(app.utils, 1), minutes: 10 }), null, 'never a day to come');
    assert.equal(st().addManualSession({ dateKey: today, minutes: 0 }), null);
    assert.equal(st().addManualSession({ dateKey: today, minutes: 721 }), null);
    assert.equal(st().addManualSession({ dateKey: 'soon', minutes: 10 }), null);
    const now = st().addManualSession({ dateKey: today, minutes: 20 });
    assert.equal(st().sessions[st().sessions.length - 1].id, now, "today's ends now");
    assert.ok(!('subject' in st().sessions[st().sessions.length - 1]));
    assert.equal(st().updateSession(id, { subject: '', minutes: 50 }), true);
    const edited = st().sessions.find((x) => x.id === id);
    assert.ok(!('subject' in edited));
    assert.equal(edited.netSeconds, 3000);
    assert.equal(st().updateSession('nope', { minutes: 5 }), false);
    const before = st().sessions;
    assert.equal(st().updateSession(id, { minutes: 50 }), true);
    assert.equal(st().sessions, before, 'no change, no new list');
    st().updateSession(id, { minutes: 9999 });
    assert.equal(st().sessions.find((x) => x.id === id).netSeconds, 3000, 'minutes out of range are refused');
  },

  async "2.0: a restore keeps this phone's own answers to its one-time notes"() {
    const app = boot();
    await settled(app);
    app.state().setSetting('backupNudgeAt', 1234);
    app.state().setSetting('focusAlertAsked', true);
    const snap = app.store.exportSnapshot();
    assert.deepEqual(snap.todayLayout, null, "Today's board travels in a backup");
    const other = { ...snap, settings: { ...snap.settings, backupNudgeAt: 0, focusAlertAsked: false, focusGoalMin: 60 } };
    app.store.applySnapshot(app.store.readSnapshot(JSON.stringify(other)));
    const s = app.state().settings;
    assert.equal(s.backupNudgeAt, 1234);
    assert.equal(s.focusAlertAsked, true);
    assert.equal(s.focusGoalMin, 60, 'the goal is data and comes with the backup');
    const prev = app.state();
    app.state().setSetting('backupNudgeAt', 99);
    assert.equal(app.store.isDeviceOnlyChange(app.state(), prev), true, 'answering the card is no change to back up');
  },

  async 'a journal open request reaches a Journal already in front, and is dropped when nobody takes it for long'() {
    const app = boot();
    await settled(app);
    const j = app.load('src/journal.ts');
    let heard = 0;
    const off = j.onJournalOpenRequest(() => { heard++; });
    const req = j.requestJournalOpen('2026-10-01', 'e1');
    assert.equal(heard, 1, 'a listener hears the request as it is made');
    const taken = j.takeJournalOpenRequest();
    assert.equal(taken.dateKey, '2026-10-01');
    assert.equal(taken.entryId, 'e1');
    assert.equal(j.takeJournalOpenRequest(), null, 'a request is taken once');
    off();
    j.requestJournalOpen('2026-10-02');
    assert.equal(heard, 1, 'an unsubscribed listener hears nothing');
    const realNow = Date.now;
    Date.now = () => realNow() + 60_000;
    try {
      assert.equal(j.takeJournalOpenRequest(), null, 'a request nobody took for a minute is dropped');
    } finally {
      Date.now = realNow;
    }
    assert.ok(req.at > 0);
  },

  async '2.0: the reminders ring early, a week before, and on a weekly ToDo\'s days only'() {
    const scheduled = [];
    const N = {
      setNotificationHandler() {},
      async setNotificationChannelAsync() {},
      async getPermissionsAsync() { return { granted: true, status: 'granted', canAskAgain: true }; },
      async requestPermissionsAsync() { return { granted: true }; },
      async getAllScheduledNotificationsAsync() { return []; },
      async cancelScheduledNotificationAsync() {},
      async scheduleNotificationAsync(req) { scheduled.push(req); },
      addNotificationResponseReceivedListener() {},
      async getLastNotificationResponseAsync() { return null; },
      async clearLastNotificationResponseAsync() {},
      SchedulableTriggerInputTypes: { DAILY: 'daily', DATE: 'date' },
      AndroidImportance: { DEFAULT: 3, HIGH: 4 },
      DEFAULT_ACTION_IDENTIFIER: 'default',
    };
    const RN = { Platform: { OS: 'ios' }, AppState: { currentState: 'active', addEventListener() {} }, Alert: { alert() {} }, Linking: {} };
    const app = boot({}, {
      stubs: {
        'expo-notifications': N, 'react-native': RN,
        './deepWork': { COUNTDOWN_NOTIF_ID: 'c', FINISH_NOTIF_ID: 'f' },
        './toolNav': { openTool() {} },
        './components/Toast': { toast() {} },
      },
    });
    await settled(app);
    const notif = app.load('src/notifications.ts');
    assert.equal(await notif.notificationPermission(), 'granted');
    const st = app.state;
    const u = app.utils;
    const k = (n) => dayKey(u, n);
    const weekday = (n) => u.weekdayIndex(new Date(k(n) + 'T00:00:00'));
    st().setSetting('remindersEnabled', true);
    const m = st().addMission('Essay', k(5));
    st().updateMission(m, { early: ['3d', '1d'], remind: 'morning' });
    const e1 = st().saveExam({ parentId: null, fields: { title: 'Chem mock', date: k(9), remind: ['week', 'eve'] }, subjects: [], removeIds: [] }).id;
    const e2 = st().saveExam({ parentId: null, fields: { title: 'Bio', date: k(4) }, subjects: [], removeIds: [] }).id;
    const e3 = st().saveExam({ parentId: null, fields: { title: 'Maths', date: k(6), remind: [] }, subjects: [], removeIds: [] }).id;
    const t = st().addDaily('Gym', { repeat: 'daily', days: [weekday(2)], time: '20:00', remind: 'hour' });
    const run = async () => {
      scheduled.length = 0;
      await notif.rescheduleAllReminders();
      return scheduled.map((r) => ({ id: r.identifier.replace('sturoids-reminder:', ''), at: r.trigger.date, title: r.content.title, body: r.content.body }));
    };
    let got = await run();
    const find = (id) => got.find((r) => r.id === id);
    const r3 = find(`mission3d:${m}:${k(2)}`);
    assert.ok(r3, 'three days before');
    assert.equal(r3.body, 'Due in 3 days');
    assert.equal(r3.at.getHours(), 18);
    assert.equal(find(`mission1d:${m}:${k(4)}`).body, 'Due tomorrow');
    assert.equal(find(`mission:${m}:${k(5)}`).at.getHours(), 8, 'the morning of, with no time');
    assert.equal(find(`examweek:${e1}:${k(2)}`).title, 'In a week: Chem mock');
    assert.equal(find(`examweek:${e1}:${k(2)}`).at.getHours(), 19);
    assert.ok(find(`exam:${e1}:${k(8)}`), 'and the evening before');
    assert.ok(!got.some((r) => r.id.includes(e2)), 'the switch off, an exam of its own choosing nothing rings nothing');
    const gym = got.filter((r) => r.id.startsWith(`task:${t}:`));
    assert.ok(gym.length >= 2, 'its day this week and next');
    for (const r of gym) assert.equal(u.weekdayIndex(r.at), weekday(2), 'a weekly ToDo rings on its days only');
    st().setSetting('examReminders', true);
    got = await run();
    assert.ok(find(`exam:${e2}:${k(3)}`), 'the switch on: the evening before');
    assert.ok(!got.some((r) => r.id.includes(e3)), "an exam's own choice of none wins over the switch");
    assert.ok(!got.some((r) => r.id === `examweek:${e2}:${k(-3)}`));
  },

  async '2.0: a Deep Work alert cancelled while it was being set is not left scheduled'() {
    const live = new Set();
    const N = {
      setNotificationHandler() {},
      async setNotificationChannelAsync() {},
      async getPermissionsAsync() { await new Promise((r) => setTimeout(r, 20)); return { granted: true, status: 'granted', canAskAgain: true }; },
      async requestPermissionsAsync() { return { granted: true }; },
      async getAllScheduledNotificationsAsync() { return []; },
      async cancelScheduledNotificationAsync(id) { live.delete(id); },
      async scheduleNotificationAsync(req) { live.add(req.identifier); },
      addNotificationResponseReceivedListener() {},
      async getLastNotificationResponseAsync() { return null; },
      async clearLastNotificationResponseAsync() {},
      SchedulableTriggerInputTypes: { DAILY: 'daily', DATE: 'date' },
      AndroidImportance: { DEFAULT: 3, HIGH: 4 },
      DEFAULT_ACTION_IDENTIFIER: 'default',
    };
    const RN = { Platform: { OS: 'ios' }, AppState: { currentState: 'active', addEventListener() {} }, Alert: { alert() {} }, Linking: {} };
    const app = boot({}, {
      stubs: {
        'expo-notifications': N, 'react-native': RN,
        './deepWork': { COUNTDOWN_NOTIF_ID: 'c', FINISH_NOTIF_ID: 'f' },
        './toolNav': { openTool() {} },
        './components/Toast': { toast() {} },
      },
    });
    await settled(app);
    const notif = app.load('src/notifications.ts');
    const end = Date.now() + 25 * 60_000;
    await notif.scheduleCountdownEnd(end, 25, 'Physics');
    assert.equal(live.size, 1, 'a countdown with nobody pausing it is scheduled');
    notif.cancelCountdownEnd();
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(live.size, 0);
    // paused (cancelled) while the permission was still being read
    const pending = notif.scheduleCountdownEnd(end, 25, 'Physics');
    notif.cancelCountdownEnd();
    await pending;
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(live.size, 0, 'the overtaken scheduling stands down');
  },

  async '2.0: the pure helpers the widgets read'() {
    const app = boot();
    await settled(app);
    const u = app.utils;
    const mon = new Date(2024, 0, 1); // a Monday
    assert.equal(u.weekdayIndex(mon), 0);
    assert.equal(u.todoDueOn({ repeat: 'daily', days: [0] }, mon), true);
    assert.equal(u.todoDueOn({ repeat: 'daily', days: [1] }, '2024-01-01'), false);
    assert.equal(u.todoDueOn({ days: [1] }, mon), true, 'a one-off shows every day');
    assert.equal(u.todoDueOn({ repeat: 'daily' }, mon), true);

    const clean = (id) => ({ videoId: id, url: 'https://www.youtube.com/watch?v=' + id });
    const text = 'Watch https://youtu.be/dQw4w9WgXcQ?si=abc. and https://www.youtube.com/watch?v=9bZkp7q19f0&list=PL123&t=30s, again youtu.be/dQw4w9WgXcQ';
    assert.deepEqual(u.youTubeLinksIn(text), [clean('dQw4w9WgXcQ'), clean('9bZkp7q19f0')]);
    assert.equal(u.isYouTubePlaylist(text), false, 'a video in a playlist is a video');
    assert.equal(u.isYouTubePlaylist('https://youtube.com/playlist?list=PLabc_12'), true);
    assert.deepEqual(u.youTubeLinksIn('https://youtube.com/playlist?list=PLabc_12'), []);
    assert.deepEqual(u.youTubeLinksIn('no links here'), []);
    assert.equal(u.isYouTubePlaylist('no links here'), false);
    assert.deepEqual(u.youTubeLinksIn(' dQw4w9WgXcQ '), [clean('dQw4w9WgXcQ')], 'a bare id, as before');
    assert.deepEqual(u.youTubeLinksIn('(https://m.youtube.com/shorts/9bZkp7q19f0)'), [clean('9bZkp7q19f0')]);

    const k = (n) => dayKey(u, n);
    const sess = [
      { dateKey: k(0), netSeconds: 1800 }, { dateKey: k(-1), netSeconds: 600 }, { dateKey: k(-1), netSeconds: 1200 },
      { dateKey: k(-2), netSeconds: 300 }, { dateKey: k(-4), netSeconds: 3600 },
    ];
    assert.deepEqual(u.focusStreak(sess), { current: 3, best: 3 });
    assert.deepEqual(u.focusStreak(sess, 30), { current: 2, best: 2 }, 'with a goal, a short day ends the run');
    assert.deepEqual(u.focusStreak([]), { current: 0, best: 0 });

    // moods, and focus on good days
    const jc = app.load('src/journalCore.ts');
    const entry = (id, dateKey, extra) => ({ id, dateKey, title: '', excerpt: '', tags: [], wordCount: 10, pinned: false, createdAt: 1, updatedAt: 1, ...extra });
    const end = '2026-03-10';
    const series = jc.moodSeries([
      entry('a', '2026-03-10', { mood: 4, rating: 5 }), entry('b', '2026-03-10', { mood: 5 }),
      entry('c', '2026-03-08', { rating: 2 }), entry('d', '2026-02-01', { mood: 1 }),
    ], 3, end);
    assert.deepEqual(series.map((d) => d.dateKey), ['2026-03-08', '2026-03-09', '2026-03-10']);
    assert.deepEqual(series[2], { dateKey: '2026-03-10', mood: 5, rating: 5, words: 20, entries: 2 });
    assert.deepEqual(series[1], { dateKey: '2026-03-09', mood: null, rating: null, words: 0, entries: 0 });
    assert.equal(series[0].rating, 2);
    assert.equal(series[0].mood, null);
    const ents = [];
    const ss = [];
    for (let i = 0; i < 10; i++) {
      const key = jc.shiftKey(end, -i);
      ents.push(entry('x' + i, key, { rating: i < 5 ? 5 : 2 }));
      ss.push({ dateKey: key, netSeconds: i < 5 ? 3600 : 600 });
    }
    assert.deepEqual(jc.moodFocusLink(ents, ss, 60, end), { goodDays: 5, otherDays: 5, goodMin: 60, otherMin: 10 });
    assert.equal(jc.moodFocusLink(ents.slice(0, 7), ss, 60, end), null, 'too few other days to say anything');
    const journal = app.load('src/journal.ts');
    assert.equal(journal.moodSeries, jc.moodSeries, 'the journal module still gives every helper');
    assert.equal(journal.journalStreak, jc.journalStreak);

    // subjects
    const sj = app.load('src/subjects.ts');
    const now = new Date(2026, 2, 10, 12, 0);
    const planner = Object.fromEntries(u.DAY_NAMES.map((d) => [d, []]));
    planner[u.dayName(now)] = [
      { id: 'b1', subject: 'Physics', start: '09:00', end: '10:00', color: '#fff' },
      { id: 'b2', subject: 'physics', start: '15:00', end: '16:00', color: '#fff' },
    ];
    const s = (id, dateKey, mins, subject) => ({ id, dateKey, endedAt: 1, netSeconds: mins * 60, taskTitles: [], subject });
    const node = (id, parentId, title, extra) => ({ id, parentId, kind: 'exam', title, createdAt: 1, updatedAt: 1, ...extra });
    const note = (id, subject, updatedAt) => ({ id, title: id, body: '', folder: 'General', tags: [], pinned: false, createdAt: 1, updatedAt, subject, attachments: [] });
    const data = {
      sessions: [s('1', '2026-03-10', 30, 'Physics'), s('2', '2026-03-04', 10, ' physics '), s('3', '2026-02-01', 10, 'Physics'), s('4', '2026-03-10', 15, 'Chem')],
      notes: [note('n1', 'Physics', 5), note('n2', 'PHYSICS', 9), note('n3', 'Chem', 1)],
      planner,
      scores: [
        node('e1', null, 'Mock 1', { date: '2026-01-10' }), node('p1', 'e1', 'Physics', { score: 30, outOf: 50 }),
        node('e2', null, 'Mock 2', { date: '2026-02-10' }), node('p2', 'e2', 'physics', { score: 40, outOf: 50 }),
        node('e3', null, 'Final', { date: '2026-04-01' }), node('p3', 'e3', 'Physics'),
      ],
    };
    const list = sj.subjectsOf(data);
    assert.equal(list[0].name, 'Physics');
    assert.equal(list[0].uses, 10);
    assert.deepEqual(list[0].from, ['focus', 'notes', 'planner', 'scores']);
    assert.deepEqual(list.map((x) => x.key), ['physics', 'chem']);
    const sum = sj.subjectSummary(data, 'PHYSICS', now);
    assert.equal(sum.name, 'Physics');
    assert.equal(sum.weekMin, 40);
    assert.equal(sum.spark.length, 30);
    assert.equal(sum.spark[29], 30);
    assert.equal(sum.totalMin, 50);
    assert.deepEqual(sum.trend.map((r) => Math.round(r.pct)), [60, 80]);
    assert.equal(Math.round(sum.lastDelta), 20);
    assert.equal(sum.nextClass.block.id, 'b2', 'the next to start, the morning one being over');
    assert.equal(sum.nextClass.inDays, 0);
    assert.equal(sum.nextClass.onNow, false);
    assert.deepEqual([sum.nextExam.id, sum.nextExam.inDays], ['e3', 22]);
    assert.deepEqual(sum.notes.map((n) => n.id), ['n2', 'n1']);
    const hidden = sj.subjectSummary({ ...data, settings: { notesLocked: true } }, 'physics', now);
    assert.deepEqual([hidden.notes, hidden.notesHidden], [[], true]);
    // a class held once a week and over for today is next week's
    const weekly = Object.fromEntries(u.DAY_NAMES.map((d) => [d, []]));
    weekly[u.dayName(now)] = [{ id: 'w1', subject: 'Maths', start: '09:00', end: '10:00', color: '#fff' }];
    const next = sj.subjectSummary({ sessions: [], notes: [], planner: weekly, scores: [] }, 'Maths', now);
    assert.deepEqual([next.nextClass.block.id, next.nextClass.inDays, next.nextClass.onNow], ['w1', 7, false]);
    const week = sj.focusWeek(data.sessions, '2026-03-10');
    assert.equal(week.days.length, 7);
    assert.equal(week.days[6].min, 45);
    assert.deepEqual(week.days[6].bySubject.map((x) => [x.name, x.min]), [['Physics', 30], ['Chem', 15]]);
    assert.equal(week.best.dateKey, '2026-03-10');
    assert.equal(week.totalMin, 55);

    // the backup card
    const bn = app.load('src/backupNudge.ts');
    const t0 = Date.UTC(2026, 9, 1);
    const base = { firstOpenedAt: t0 - 8 * DAY, backupNudgeAt: 0, signedIn: false, lastExportAt: null, hasData: true, now: t0 };
    assert.equal(bn.shouldNudgeBackup(base), true);
    assert.equal(bn.shouldNudgeBackup({ ...base, firstOpenedAt: t0 - 3 * DAY }), false, 'not in the first week');
    assert.equal(bn.shouldNudgeBackup({ ...base, firstOpenedAt: undefined }), false);
    assert.equal(bn.shouldNudgeBackup({ ...base, signedIn: true }), false);
    assert.equal(bn.shouldNudgeBackup({ ...base, lastExportAt: t0 - 2 * DAY }), false);
    assert.equal(bn.shouldNudgeBackup({ ...base, lastExportAt: t0 - 20 * DAY }), true);
    assert.equal(bn.shouldNudgeBackup({ ...base, backupNudgeAt: 5 }), false, 'once only');
    assert.equal(bn.shouldNudgeBackup({ ...base, hasData: false }), false);
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
      console.log('FAIL  ' + name + '\n      ' + String(e && e.message ? e.message : e).split('\n').join('\n      '));
    }
  }
  console.log(failed ? `\ntest-store: ${failed} failed` : '\ntest-store: all passed');
  process.exit(failed ? 1 : 0);
})();
