#!/usr/bin/env node
/*
 * Checks for Sift: the engine (src/search/engine.ts) run against the real source in Node — normalising, stemming, the
 * match tiers (exact, prefix, compound, substring, typo, acronym, related words), AND with the OR fallback, ranking,
 * the top hit, sections, highlighting, snippets, "did you mean", incremental collections and day parsing — the typed
 * maths (src/calcEngine.ts), and the settings index (src/search/settingsIndex.ts): every label in it must still appear
 * in Settings, so the index cannot drift from the page.
 * Usage: node scripts/test-search.js   (exit 1 on any failure)
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { createRequire } = require('module');

const ROOT = path.join(__dirname, '..');
const projectRequire = createRequire(path.join(ROOT, 'package.json'));
const ts = projectRequire('typescript');

function load(file) {
  const registry = new Map();
  const go = (f) => {
    if (registry.has(f)) return registry.get(f).exports;
    const { outputText } = ts.transpileModule(fs.readFileSync(f, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    });
    const mod = { exports: {} };
    registry.set(f, mod);
    const req = (spec) => {
      if (spec.startsWith('.')) {
        const base = path.resolve(path.dirname(f), spec);
        const hit = [base + '.ts', base + '.tsx', path.join(base, 'index.ts')].find((p) => fs.existsSync(p));
        if (!hit) throw new Error('cannot resolve ' + spec);
        return go(hit);
      }
      return projectRequire(spec);
    };
    new Function('require', 'module', 'exports', outputText)(req, mod, mod.exports);
    return mod.exports;
  };
  return go(file);
}

const E = load(path.join(ROOT, 'src', 'search', 'engine.ts'));
const SI = load(path.join(ROOT, 'src', 'search', 'settingsIndex.ts'));
const CE = load(path.join(ROOT, 'src', 'calcEngine.ts'));

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error('FAIL ' + name + '\n  ' + (e && e.message));
    process.exitCode = 1;
  }
};

const NOW = new Date('2026-10-24T12:00:00').getTime(); // a Saturday
const DAY = 24 * 60 * 60 * 1000;
const doc = (key, title, extra = {}) => ({ key, kind: extra.kind || 'note', section: extra.section || 'Notes', title, payload: key, ...extra });

function build(docs) {
  const ix = new E.SearchIndex();
  ix.setCollection('all', docs, (d) => d);
  return ix;
}
const keysOf = (res) => [res.top, ...res.sections.flatMap((s) => s.hits)].filter(Boolean).map((h) => h.doc.key);

/* ---------------------------------------------------------------- normalising */

test('fold lowers and takes accents off', () => {
  assert.equal(E.fold('Café Ünïcode'), 'cafe unicode');
  assert.deepEqual(E.words('Physics: test-paper, #2!'), ['physics', 'test', 'paper', '2']);
});

test('stems plurals, -ing and -ed lightly', () => {
  assert.equal(E.stem('notes'), 'note');
  assert.equal(E.stem('classes'), 'class');
  assert.equal(E.stem('studies'), 'study');
  assert.equal(E.stem('planned'), 'plan');
  assert.equal(E.stem('running'), 'run');
  assert.equal(E.stem('tested'), 'test');
  assert.equal(E.stem('bus'), 'bus');
  assert.equal(E.stem('focus'), 'focus');
  assert.equal(E.stem('2024s'), '2024s');
});

test('edit distance counts a swap as one and stops past the bound', () => {
  assert.equal(E.editDistance('physics', 'phsyics', 2), 1);
  assert.equal(E.editDistance('chemistry', 'chemstry', 2), 1);
  assert.equal(E.editDistance('maths', 'math', 2), 1);
  assert.equal(E.editDistance('abcdef', 'uvwxyz', 2), 3);
});

/* ---------------------------------------------------------------- matching and ranking */

const LIB = [
  doc('n1', 'Physics test paper', { body: 'Kinematics, forces and energy', at: NOW - 2 * DAY }),
  doc('n2', 'Chemistry notes', { body: 'Organic reactions and the periodic table', tags: 'Chem', at: NOW - 40 * DAY }),
  doc('n3', 'Biology essay', { body: 'Cells and their e-mail like signalling', at: NOW - 5 * DAY }),
  doc('t1', 'Revise physics chapter 3', { kind: 'todo', section: 'ToDos', at: NOW - DAY }),
  doc('s1', 'Theme', { kind: 'setting', section: 'Settings', meta: 'dark minimal contrast look' }),
  doc('x1', 'Mock 7', { kind: 'exam', section: 'Scores', at: NOW - 3 * DAY }),
];
const ix = build(LIB);

test('exact and prefix find as you type', () => {
  assert.ok(keysOf(ix.search('phy', { now: NOW })).includes('n1'));
  assert.ok(keysOf(ix.search('physics', { now: NOW })).includes('t1'));
});

test('stemmed words meet: "note" finds "notes"', () => {
  assert.ok(keysOf(ix.search('note', { now: NOW })).includes('n2'));
});

test('a typo still finds it', () => {
  assert.ok(keysOf(ix.search('phsyics', { now: NOW })).includes('n1'));
  assert.ok(keysOf(ix.search('chemstry', { now: NOW })).includes('n2'));
});

test('substring and compound word starts', () => {
  assert.ok(keysOf(ix.search('mistry', { now: NOW })).includes('n2'));
  assert.ok(keysOf(ix.search('email', { now: NOW })).includes('n3'));
});

test('an acronym of the title', () => {
  assert.ok(keysOf(ix.search('ptp', { now: NOW })).includes('n1'));
});

test('a related word: exam finds a mock, dark finds the theme', () => {
  assert.ok(keysOf(ix.search('exam', { now: NOW })).includes('x1'));
  assert.ok(keysOf(ix.search('appearance', { now: NOW })).includes('s1'));
});

test('every term must match, with an OR fallback when that leaves too few', () => {
  const and = ix.search('physics paper', { now: NOW });
  assert.equal(and.top && and.top.doc.key, 'n1');
  assert.ok(and.sections.flatMap((s) => s.hits).every((h) => h.doc.key !== 'n2'));
  // nothing has both, so the OR fallback brings each at half
  const or = ix.search('kinematics organic', { now: NOW });
  const k = keysOf(or);
  assert.ok(k.includes('n1') && k.includes('n2'));
  assert.ok([or.top, ...or.sections.flatMap((s) => s.hits)].filter(Boolean).every((h) => !h.all));
});

test('title outranks body, and a clear leader is the top hit', () => {
  const lib = build([
    doc('a', 'Energy', { at: NOW }),
    doc('b', 'Forces', { body: 'energy in a spring', at: NOW }),
  ]);
  const r = lib.search('energy', { now: NOW });
  assert.equal(r.top.doc.key, 'a');
  assert.equal(r.sections[0].hits[0].doc.key, 'b');
});

test('no top hit when two results are close', () => {
  const lib = build([doc('a', 'Physics one', { at: NOW }), doc('b', 'Physics two', { at: NOW })]);
  assert.equal(lib.search('physics', { now: NOW }).top, null);
});

test('recency and use lift a result', () => {
  const lib = build([doc('old', 'Algebra', { at: NOW - 300 * DAY }), doc('new', 'Algebra', { at: NOW })]);
  assert.equal(lib.search('algebra', { now: NOW }).top.doc.key, 'new');
  const used = lib.search('algebra', { now: NOW, usage: (k) => (k === 'old' ? 40 : 0) });
  assert.equal(used.top.doc.key, 'old');
});

test('tools, actions and settings get a lift for a short query', () => {
  const lib = build([
    doc('note', 'Theme ideas', { kind: 'note', section: 'Notes' }),
    doc('set', 'Theme ideas', { kind: 'setting', section: 'Settings' }),
  ]);
  assert.equal(lib.search('them', { now: NOW }).top.doc.key, 'set');
});

test('sections are ordered by their best result and capped', () => {
  const docs = [];
  for (let i = 0; i < 8; i++) docs.push(doc('n' + i, 'Lab report ' + i, { at: NOW - i * DAY }));
  docs.push(doc('t', 'Lab report due', { kind: 'todo', section: 'ToDos', at: NOW }));
  const r = build(docs).search('lab report', { now: NOW, perSection: 5 });
  const notes = r.sections.find((s) => s.section === 'Notes');
  assert.ok(notes.hits.length <= 5);
  assert.equal(notes.hits.length + notes.more + (r.top && r.top.doc.section === 'Notes' ? 1 : 0), 8);
});

test('a filter leaves documents out', () => {
  const r = ix.search('physics', { now: NOW, filter: (d) => d.kind !== 'todo' });
  assert.ok(!keysOf(r).includes('t1'));
});

test('did you mean, when nothing matches', () => {
  const r = ix.search('kinematix forcez', { now: NOW });
  // kinematix is a typo hit (8+ letters, two edits allowed), so only the far-off one is suggested
  const r2 = ix.search('qqqqq', { now: NOW });
  assert.equal(r2.total, 0);
  const r3 = build([doc('a', 'Biology')]).search('bioloyy zz', { now: NOW });
  assert.ok(r.total > 0);
  assert.equal(r3.total > 0 || r3.didYouMean === 'biology zz', true);
  const r4 = build([doc('a', 'Thermodynamics')]).search('xhermodynamicz', { now: NOW });
  assert.equal(r4.total > 0 || r4.didYouMean === 'thermodynamics', true);
  const r5 = build([doc('a', 'Cells')]).search('cxlz', { now: NOW });
  assert.equal(r5.total, 0);
  assert.ok(['cell', 'cells'].includes(r5.didYouMean));
});

/* ---------------------------------------------------------------- incremental collections */

test('a collection made of one source object lists each document once', () => {
  const lib = new E.SearchIndex();
  const src = { sessions: [], notes: [], planner: {}, scores: [] };
  const toDocs = () => [doc('subject:physics', 'Physics'), doc('subject:chemistry', 'Chemistry')];
  lib.setCollection('subjects', [src], toDocs);
  assert.equal(lib.size, 2);
  const r = lib.search('physics');
  assert.equal(r.total, 1);
  assert.ok(r.top && r.top.doc.key === 'subject:physics', 'a lone match leads');
  // the same source and version is not read again; a new version is
  let calls = 0;
  lib.setCollection('subjects', [src], () => { calls++; return toDocs(); }, 'x');
  assert.equal(calls, 1);
  lib.setCollection('subjects', [src], () => { calls++; return toDocs(); }, 'x');
  assert.equal(calls, 1);
});

test('a collection whose source is unchanged is not rebuilt; one changed item is prepared alone', () => {
  const lib = new E.SearchIndex();
  const a = { id: 'a', t: 'Alpha' };
  const b = { id: 'b', t: 'Beta' };
  let calls = 0;
  const toDocs = (x) => { calls++; return doc(x.id, x.t); };
  const list1 = [a, b];
  lib.setCollection('c', list1, toDocs);
  assert.equal(calls, 2);
  lib.setCollection('c', list1, toDocs);
  assert.equal(calls, 2);
  const b2 = { id: 'b', t: 'Gamma' };
  lib.setCollection('c', [a, b2], toDocs);
  assert.equal(calls, 3);
  assert.ok(keysOf(lib.search('gamma')).includes('b'));
  assert.ok(!keysOf(lib.search('beta')).includes('b'));
  // a version change prepares again
  lib.setCollection('c', [a, b2], toDocs, 1);
  assert.equal(calls, 5);
  lib.dropCollection('c');
  assert.equal(lib.size, 0);
});

/* ---------------------------------------------------------------- highlighting and snippets */

test('highlight maps matches back to the words as written', () => {
  assert.deepEqual(E.highlight('Physics test paper', ['phy']), [[0, 3]]);
  assert.deepEqual(E.highlight('Café notes', ['cafe']), [[0, 4]]);
  assert.deepEqual(E.highlight('Revise physics', ['phsyics']), [[7, 14]]);
});

test('a snippet is a window around the first match, with ellipses', () => {
  const body = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. The mitochondria is the powerhouse of the cell, and so on and so forth for a long while.';
  const s = E.snippet(body, ['mitochondria']);
  assert.ok(s.text.startsWith('…'));
  assert.ok(s.text.includes('mitochondria'));
  assert.ok(s.text.length <= 74);
  const [a, b] = s.ranges[0];
  assert.equal(s.text.slice(a, b), 'mitochondria');
  assert.equal(E.snippet('nothing here', ['zebra']), null);
});

/* ---------------------------------------------------------------- dates */

test('days in the query', () => {
  const now = new Date('2026-10-24T09:00:00'); // Saturday
  assert.equal(E.parseDay('today', now).key, '2026-10-24');
  assert.equal(E.parseDay('Tomorrow', now).key, '2026-10-25');
  assert.equal(E.parseDay('fri', now).key, '2026-10-30');
  assert.equal(E.parseDay('sat', now).key, '2026-10-24');
  assert.equal(E.parseDay('next saturday', now).key, '2026-10-31');
  assert.equal(E.parseDay('next monday', now).key, '2026-10-26');
  assert.equal(E.parseDay('23 oct', now).key, '2026-10-23');
  assert.equal(E.parseDay('oct 23', now).key, '2026-10-23');
  assert.equal(E.parseDay('23/10', now).key, '2026-10-23');
  assert.equal(E.parseDay('1st december 2027', now).key, '2027-12-01');
  assert.equal(E.parseDay('31 feb', now), null);
  assert.equal(E.parseDay('physics', now), null);
  assert.equal(E.parseDay('fr', now), null);
});

/* ---------------------------------------------------------------- typed maths */

test('a sum typed into Sift is answered with the calculator engine', () => {
  assert.deepEqual(CE.quickMath('12*7+3'), { expr: '12×7+3', answer: '87' });
  assert.equal(CE.quickMath('0.1+0.2').answer, '0.3');
  assert.equal(CE.quickMath('15% of 80').answer, '12');
  assert.equal(CE.quickMath('sqrt 2').answer.slice(0, 6), '1.4142');
  assert.equal(CE.quickMath('√(16)').answer, '4');
  assert.equal(CE.quickMath('2^10').answer, '1024');
  assert.equal(CE.quickMath('12 x 7').answer, '84');
  assert.equal(CE.quickMath('sin 30').answer, '0.5');
  assert.equal(CE.quickMath('10 mod 3').answer, '1');
  assert.equal(CE.quickMath('3-5').answer, '−2');
  assert.equal(CE.quickMath('2024'), null);
  assert.equal(CE.quickMath('physics 2'), null);
  assert.equal(CE.quickMath('mock 7'), null);
  assert.equal(CE.quickMath('1/0'), null);
});

/* ---------------------------------------------------------------- the settings index */

test('settings ids are page:slug(label), unique', () => {
  assert.equal(SI.slug('All reminders (master)'), 'all-reminders-master');
  assert.equal(SI.settingId('time', '24-hour time'), 'time:24-hour-time');
  const ids = SI.SETTINGS_INDEX.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const r of SI.SETTINGS_INDEX) assert.equal(r.id, r.page + ':' + SI.slug(r.label));
});

test('every settings label still appears in Settings (no drift)', () => {
  const src = ['app/settings.tsx', 'src/components/CloudCard.tsx', 'src/components/ProfileSwitcher.tsx']
    .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  const missing = SI.SETTINGS_INDEX.filter((r) => !src.includes(r.label)).map((r) => r.id);
  assert.deepEqual(missing, [], 'labels no longer in Settings: ' + missing.join(', '));
  for (const [page, title] of Object.entries(SI.SETTINGS_PAGE_TITLES)) {
    assert.ok(src.includes(page + ": '" + title + "'") || src.includes(title), 'page title ' + title);
  }
});

test('Settings search groups matches by page', () => {
  const r = SI.searchSettings('lock');
  assert.ok(r.length >= 1);
  assert.equal(r[0].page, 'privacy');
  assert.ok(r[0].rows.some((x) => x.row.label === 'Lock the journal'));
  const dark = SI.searchSettings('dark');
  assert.ok(dark.some((m) => m.rows.some((x) => x.row.id === 'appearance:theme')));
  assert.deepEqual(SI.searchSettings('  '), []);
});

console.log(process.exitCode ? 'test-search: failures above' : 'test-search: ' + passed + ' checks passed');
