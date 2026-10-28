#!/usr/bin/env node
/*
 * Checks for src/toolLogic.ts, run against the real source in Node: month grids, the exam helpers ("Study for this" and
 * "Add revision tasks"), the notes search (words in any order across every field, locked text kept out, snippets and
 * highlight runs), videos found in a paste or a share (several, duplicates, playlists), and the focus goal's share.
 * Usage: node scripts/test-tools.js   (exit 1 on any failure)
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

const L = load(path.join(ROOT, 'src', 'toolLogic.ts'));
const SC = load(path.join(ROOT, 'src', 'scores.ts'));

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

/* ---------------------------------------------------------------- days */

test('minutes until a clock time are worked to the second', () => {
  const at = (h, m, s) => new Date(2026, 9, 28, h, m, s);
  assert.equal(L.minutesUntil(11 * 60, at(10, 0, 45)), 59);
  assert.equal(L.minutesUntil(11 * 60, at(10, 0, 10)), 60);
  assert.equal(L.minutesUntil(11 * 60, at(10, 0, 0)), 60);
  assert.equal(L.minutesUntil(10 * 60, at(10, 0, 5)), 1440, 'a time just gone is tomorrow\'s');
  assert.equal(L.minutesUntil(10 * 60 + 1, at(10, 0, 50)), 1, 'never less than one minute');
});

test('shifts days and months across their ends', () => {
  assert.equal(L.shiftDay('2026-03-01', -1), '2026-02-28');
  assert.equal(L.shiftDay('2026-12-31', 1), '2027-01-01');
  assert.equal(L.shiftMonthKey('2026-01', -1), '2025-12');
  assert.equal(L.shiftMonthKey('2026-12', 1), '2027-01');
});

test('a month grid starts on Monday and fills whole weeks', () => {
  // 1 Oct 2026 is a Thursday
  const g = L.monthGrid('2026-10');
  assert.ok(g.every((w) => w.length === 7));
  assert.deepEqual(g[0].slice(0, 4), [null, null, null, '2026-10-01']);
  const days = g.flat().filter(Boolean);
  assert.equal(days.length, 31);
  assert.equal(days[30], '2026-10-31');
  // February 2027 starts on a Monday and has exactly four weeks
  assert.equal(L.monthGrid('2027-02').length, 4);
});

/* ---------------------------------------------------------------- exams */

const node = (id, kind, parentId, extra = {}) => ({ id, kind, parentId, title: id, createdAt: extra.createdAt || 1, updatedAt: 1, ...extra });

test('Study for this offers each subject once, or the exam itself', () => {
  const ix = SC.indexScores([
    node('m7', 'exam', null, { title: 'Mock 7', date: '2026-11-02' }),
    node('p', 'exam', 'm7', { title: 'Physics', createdAt: 1 }),
    node('c', 'exam', 'm7', { title: 'Chemistry', createdAt: 2 }),
    node('c2', 'exam', 'm7', { title: 'chemistry ', createdAt: 3 }),
    node('solo', 'exam', null, { title: 'Unit test' }),
  ]);
  assert.deepEqual(L.studySubjects(ix, ix.byId.get('m7')), ['Physics', 'Chemistry']);
  assert.deepEqual(L.studySubjects(ix, ix.byId.get('solo')), ['Unit test']);
});

test('an exam is ahead while dated, not past and not marked', () => {
  const ix = SC.indexScores([
    node('a', 'exam', null, { date: '2026-11-02' }),
    node('b', 'exam', null, { date: '2026-10-01' }),
    node('c', 'exam', null, { date: '2026-11-02', score: 40, outOf: 50 }),
    node('d', 'exam', null),
  ]);
  const today = '2026-10-25';
  assert.equal(L.examAhead(ix, ix.byId.get('a'), today), true);
  assert.equal(L.examAhead(ix, ix.byId.get('b'), today), false);
  assert.equal(L.examAhead(ix, ix.byId.get('c'), today), false);
  assert.equal(L.examAhead(ix, ix.byId.get('d'), today), false);
});

test('revision tasks: one per subject, due the day before, duplicates skipped', () => {
  const ix = SC.indexScores([
    node('m7', 'exam', null, { title: 'Mock 7', date: '2026-11-02' }),
    node('p', 'exam', 'm7', { title: 'Physics', createdAt: 1 }),
    node('c', 'exam', 'm7', { title: 'Chemistry', createdAt: 2 }),
  ]);
  const missions = [{ title: 'revise physics for mock 7', deadline: '2026-11-01', done: false }];
  const plan = L.revisionPlan(ix, ix.byId.get('m7'), missions, '2026-10-25');
  assert.deepEqual(plan, [{ title: 'Revise Chemistry for Mock 7', deadline: '2026-11-01' }]);
  // a done one with the same name does not count
  const again = L.revisionPlan(ix, ix.byId.get('m7'), [{ ...missions[0], done: true }], '2026-10-25');
  assert.equal(again.length, 2);
});

test('revision tasks for an exam without subjects, and one tomorrow', () => {
  const ix = SC.indexScores([node('u', 'exam', null, { title: 'Unit test', date: '2026-10-25' }), node('x', 'exam', null)]);
  assert.deepEqual(L.revisionPlan(ix, ix.byId.get('u'), [], '2026-10-25'), [{ title: 'Revise for Unit test', deadline: '2026-10-25' }]);
  assert.deepEqual(L.revisionPlan(ix, ix.byId.get('x'), [], '2026-10-25'), []);
});

/* ---------------------------------------------------------------- notes search */

const note = (extra) => ({ title: '', body: '', tags: [], folder: 'General', ...extra });

test('every word, in any order, across title, text, tags, subject and folder', () => {
  const n = note({ title: 'Thermo summary', body: 'Entropy always rises in a closed system.', subject: 'Physics', folder: 'Revision', tags: ['unit3'] });
  assert.ok(L.matchNote(n, 'entropy physics'));
  assert.ok(L.matchNote(n, 'physics entropy'));
  assert.ok(L.matchNote(n, 'revision unit3 thermo'));
  assert.equal(L.matchNote(n, 'entropy biology'), null);
});

test('forgiving words: prefixes, stems and a near spelling', () => {
  const n = note({ title: 'Organic reactions', body: 'Notes on substitution mechanisms' });
  assert.ok(L.matchNote(n, 'org'));
  assert.ok(L.matchNote(n, 'reaction'));
  assert.ok(L.matchNote(n, 'mechansims'));
});

test('a locked note is found by its title and tags only', () => {
  const n = note({ title: 'Diary', body: 'secret words', locked: true, tags: ['private'] });
  assert.equal(L.matchNote(n, 'secret'), null);
  const hit = L.matchNote(n, 'diary private');
  assert.ok(hit);
  assert.equal(hit.snippet, null);
});

test('a snippet around the match, with the words marked', () => {
  const long = 'Intro line. '.repeat(20) + 'The Krebs cycle makes ATP in the mitochondria. ' + 'More text here. '.repeat(10);
  const hit = L.matchNote(note({ title: 'Bio', body: long }), 'krebs');
  assert.ok(hit && hit.snippet);
  assert.ok(hit.snippet.text.startsWith('…'));
  const runs = L.splitRanges(hit.snippet.text, hit.snippet.ranges);
  assert.ok(runs.some((r) => r.on && r.text.toLowerCase() === 'krebs'));
  assert.equal(runs.map((r) => r.text).join(''), hit.snippet.text);
});

test('splitRanges keeps every character once', () => {
  assert.deepEqual(L.splitRanges('abcdef', [[1, 3], [4, 5]]).map((r) => [r.text, r.on]), [['a', false], ['bc', true], ['d', false], ['e', true], ['f', false]]);
  assert.deepEqual(L.splitRanges('abc', []), [{ text: 'abc', on: false }]);
});

/* ---------------------------------------------------------------- videos */

test('a paste with several videos, one already in the Vault', () => {
  const text = 'watch https://youtu.be/dQw4w9WgXcQ and https://www.youtube.com/watch?v=9bZkp7q19f0&t=3s, also youtu.be/dQw4w9WgXcQ';
  const r = L.videosIn(text, (id) => id === '9bZkp7q19f0');
  assert.deepEqual(r.fresh.map((v) => v.videoId), ['dQw4w9WgXcQ']);
  assert.equal(r.fresh[0].url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(r.have, 1);
  assert.equal(r.playlist, false);
});

test('a playlist link alone is said to be a playlist', () => {
  const r = L.videosIn('https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG', () => false);
  assert.equal(r.fresh.length, 0);
  assert.equal(r.playlist, true);
  const plain = L.videosIn('just some words', () => false);
  assert.equal(plain.playlist, false);
  assert.equal(plain.fresh.length, 0);
});

/* ---------------------------------------------------------------- focus */

test('the goal share runs 0 to 1, and is null with no goal', () => {
  assert.equal(L.goalShare(30, 60), 0.5);
  assert.equal(L.goalShare(90, 60), 1);
  assert.equal(L.goalShare(30, 0), null);
});

console.log(process.exitCode ? 'test-tools: failures above' : 'test-tools: ' + passed + ' checks passed');
