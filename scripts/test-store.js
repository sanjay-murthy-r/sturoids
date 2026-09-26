#!/usr/bin/env node
/*
 * Data-safety checks for src/store.ts, run against the real source in Node (no device, no Metro).
 * Each scenario boots a fresh copy of the store over its own in-memory AsyncStorage and checks:
 *   - a fresh install, and an upgrade from a v4 blob through the real persist migration
 *   - migrateV5 is idempotent and survives malformed collections
 *   - a backup round-trips through exportSnapshot / importSnapshot, and junk is refused
 *   - a blob that cannot be read is copied aside (or saving pauses) and the user is told
 *   - storage that answers after the wait replaces the defaults, resumes saving and says so
 * Usage: node scripts/test-store.js   (exit 1 on any failure)
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { createRequire } = require('module');

const ROOT = path.join(__dirname, '..');
const projectRequire = createRequire(path.join(ROOT, 'package.json'));
const ts = projectRequire('typescript');
const KEY = 'student-hub-v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Boots src/store.ts in a fresh module registry over its own storage map. */
function boot(seed = {}, { gate } = {}) {
  const storage = new Map(Object.entries(seed));
  const asyncStorage = {
    getItem: async (k) => { if (gate) await gate; return storage.has(k) ? storage.get(k) : null; },
    setItem: async (k, v) => { storage.set(k, v); },
    removeItem: async (k) => { storage.delete(k); },
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
      if (spec === '@react-native-async-storage/async-storage') return { __esModule: true, default: asyncStorage };
      if (spec === 'react-native') return {};
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
  store.subscribeLoadNotices((n) => notices.push(n));
  const utils = load(path.join(ROOT, 'src', 'utils.ts'));
  return { store, utils, storage, notices, state: () => store.useStore.getState() };
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
    assert.ok(s.quickAccess.every((q) => ['tool', 'route', 'app', 'url'].includes(q.kind)), 'quick access kinds');
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
    await sleep(10);
    app.store.flushSaves(); // saves wait for a pause; the test does not
    assert.equal(JSON.parse(app.storage.get(KEY)).version, 5, 'written back as v5');
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
    assert.equal(app.storage.get(KEY), '{still bad', 'the unreadable blob is untouched');
    assert.equal(app.storage.get(app.store.RECOVERY_KEY), '{older copy');
    assert.deepEqual(app.notices, ['failed-paused']);
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
    app.state().setSetting('name', 'Typed while waiting');
    release();
    for (let i = 0; i < 100 && !app.notices.length; i++) await sleep(5);
    assert.deepEqual(app.notices, ['late-load']);
    assert.equal(app.state().settings.name, 'Saved');
    assert.equal(app.store.savingPaused(), false);
    app.state().setSetting('name', 'After');
    await sleep(20);
    app.store.flushSaves();
    assert.equal(JSON.parse(app.storage.get(KEY)).state.settings.name, 'After', 'saving resumed');
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
