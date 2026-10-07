#!/usr/bin/env node
/*
 * Checks for src/scores.ts, run against the real source in Node: results (own marks, sums, weights, nesting, partial
 * marking, negative marks), summaries, what is coming up and what waits for marks, deltas, moving, duplicating, local
 * dates, and repairing a damaged tree.
 * Usage: node scripts/test-scores.js   (exit 1 on any failure)
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

const S = load(path.join(ROOT, 'src', 'scores.ts'));
const node = (id, parentId, kind, extra = {}) => ({ id, parentId, kind, title: id, createdAt: 1, updatedAt: 1, ...extra });
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

// a mock series: Mock 7 split into three sections, Mock 6 marked as a whole, Mock 8 coming up
const TREE = [
  node('mocks', null, 'group', { target: 75 }),
  node('m6', 'mocks', 'exam', { date: '2026-09-05', score: 180, outOf: 300 }),
  node('m7', 'mocks', 'exam', { date: '2026-09-12' }),
  node('phy', 'm7', 'exam', { score: 68, outOf: 100 }),
  node('che', 'm7', 'exam', { score: 81, outOf: 100 }),
  node('mat', 'm7', 'exam', { score: -4, outOf: 100 }),
  node('m8', 'mocks', 'exam', { date: '2026-09-26' }),
  node('school', null, 'group'),
  node('term1', 'school', 'group'),
  node('maths', 'term1', 'exam', { date: '2026-08-01', combine: 'weighted' }),
  node('theory', 'maths', 'exam', { score: 70, outOf: 100, weight: 3 }),
  node('practical', 'maths', 'exam', { score: 45, outOf: 50, weight: 1 }),
];

const checks = {
  'own marks give the percentage'() {
    const ix = S.indexScores(TREE);
    const r = S.resultOf(ix.byId.get('m6'), ix);
    assert.equal(r.from, 'own');
    near(r.pct, 60, 'pct');
  },
  'sub-exams add up their marks, negative marks included'() {
    const ix = S.indexScores(TREE);
    const r = S.resultOf(ix.byId.get('m7'), ix);
    assert.equal(r.from, 'parts');
    assert.equal(r.score, 145);
    assert.equal(r.outOf, 300);
    assert.equal(r.marked, 3);
    near(r.pct, (145 / 300) * 100, 'pct');
  },
  'weighted sub-exams average their percentages by weight'() {
    const ix = S.indexScores(TREE);
    const r = S.resultOf(ix.byId.get('maths'), ix);
    near(r.pct, (70 * 3 + 90 * 1) / 4, 'weighted pct');
    assert.equal(r.score, undefined, 'a weighted result has no marks');
  },
  'partial marking reports what is marked'() {
    const t = TREE.map((n) => (n.id === 'mat' ? { ...n, score: undefined } : n));
    const ix = S.indexScores(t);
    const r = S.resultOf(ix.byId.get('m7'), ix);
    assert.equal(r.marked, 2);
    assert.equal(r.parts, 3);
    assert.equal(r.outOf, 200);
  },
  "a parent's own marks win, with a hint when the parts disagree"() {
    const t = TREE.map((n) => (n.id === 'm7' ? { ...n, score: 150, outOf: 300 } : n));
    const ix = S.indexScores(t);
    assert.equal(S.resultOf(ix.byId.get('m7'), ix).from, 'own');
    const hint = S.partsMismatch(ix.byId.get('m7'), ix);
    assert.equal(hint.score, 145);
    const same = S.indexScores(TREE.map((n) => (n.id === 'm7' ? { ...n, score: 145, outOf: 300 } : n)));
    assert.equal(S.partsMismatch(same.byId.get('m7'), same), null, 'agreeing marks give no hint');
  },
  'a group summary counts top-level exams only, through inner groups'() {
    const ix = S.indexScores(TREE);
    const g = S.groupSummary(ix, 'mocks');
    assert.equal(g.exams, 3, 'm6, m7, m8 (sections are part of m7)');
    assert.equal(g.marked, 2);
    near(g.average, (60 + (145 / 300) * 100) / 2, 'average');
    assert.equal(g.latest.node.id, 'm7');
    near(g.latest.delta, (145 / 300) * 100 - 60, 'delta');
    assert.equal(g.best.node.id, 'm6');
    assert.deepEqual(g.series.map((x) => x.id), ['m6', 'm7']);
    const top = S.groupSummary(ix, null);
    assert.equal(top.exams, 4, 'everything, school exams included');
    assert.equal(S.groupSummary(S.indexScores([node('e', null, 'group')]), 'e'), null, 'nothing marked, no summary');
  },
  'coming up lists unmarked exams from today on'() {
    const ix = S.indexScores(TREE);
    assert.deepEqual(S.upcoming(ix, null, '2026-09-21').map((n) => n.id), ['m8']);
    assert.deepEqual(S.upcoming(ix, null, '2026-09-27').map((n) => n.id), []);
  },
  'delta compares with the previous marked exam in the same group'() {
    const ix = S.indexScores(TREE);
    near(S.deltaVsPrevious(ix.byId.get('m7'), ix), (145 / 300) * 100 - 60, 'm7 vs m6');
    assert.equal(S.deltaVsPrevious(ix.byId.get('m6'), ix), null, 'first in the series');
    assert.equal(S.deltaVsPrevious(ix.byId.get('m8'), ix), null, 'unmarked');
  },
  'moves: groups never into exams, nothing into itself'() {
    const ix = S.indexScores(TREE);
    assert.equal(S.canMove(ix, 'term1', 'mocks'), true);
    assert.equal(S.canMove(ix, 'term1', 'm6'), false, 'a group into an exam');
    assert.equal(S.canMove(ix, 'school', 'term1'), false, 'into its own descendant');
    assert.equal(S.canMove(ix, 'm6', 'm6'), false, 'into itself');
    assert.equal(S.canMove(ix, 'm6', null), true);
    assert.deepEqual([...S.descendantIds(ix, 'school')].sort(), ['maths', 'practical', 'term1', 'theory']);
    assert.deepEqual(S.pathOf(ix, 'theory').map((n) => n.id), ['school', 'term1', 'maths']);
  },
  'duplicating copies the structure without marks and moves the number on'() {
    let n = 0;
    const copy = S.duplicateStructure(TREE, 'm7', 5, () => 'c' + n++);
    assert.equal(copy.nodes.length, 4);
    const root = copy.nodes.find((x) => x.id === copy.rootId);
    assert.equal(root.title, 'm8', "'m7' becomes 'm8'");
    assert.equal(root.parentId, 'mocks');
    assert.ok(copy.nodes.every((x) => x.score === undefined && x.date === undefined), 'no marks, no dates');
    assert.ok(copy.nodes.filter((x) => x.parentId === copy.rootId).every((x) => x.outOf === 100), 'totals kept');
    assert.equal(S.nextTitle('Mock 7'), 'Mock 8');
    assert.equal(S.nextTitle('Paper 09'), 'Paper 10');
    assert.equal(S.nextTitle('JEE 2026 Mock 7 (Allen)'), 'JEE 2026 Mock 8 (Allen)');
    assert.equal(S.nextTitle('Unit test'), 'Unit test 2');
  },
  "a year at the end of a title is the series' year, not its count"() {
    assert.equal(S.nextTitle('JEE Mock 7 (2026)'), 'JEE Mock 8 (2026)');
    assert.equal(S.nextTitle('Term 1 2026'), 'Term 2 2026');
    assert.equal(S.nextTitle('Batch 2026'), 'Batch 2027', 'a year alone still moves on');  },
  'an exam with no date reads as the local day it was added'() {
    const was = process.env.TZ;
    process.env.TZ = 'Asia/Kolkata';
    try {
      // 01:30 on 6 Oct in India is still 5 Oct in UTC
      const at = Date.UTC(2026, 9, 5, 20, 0);
      assert.equal(new Date(at).getHours(), 1, 'the zone took effect');
      assert.equal(S.whenOf({ id: 'x', parentId: null, kind: 'exam', title: 'X', createdAt: at, updatedAt: at }), '2026-10-06');
      assert.equal(S.whenOf({ id: 'y', parentId: null, kind: 'exam', title: 'Y', date: '2026-09-01', createdAt: at, updatedAt: at }), '2026-09-01');
    } finally {
      if (was === undefined) delete process.env.TZ;
      else process.env.TZ = was;
    }
  },
  'the result table matches each exam worked out alone'() {
    const tree = [...TREE, node('m5', 'mocks', 'exam', { date: '2026-09-12', score: 200, outOf: 300 })];
    const ix = S.indexScores(tree);
    const table = S.resultTable(ix);
    for (const n of tree) {
      if (n.kind !== 'exam') continue;
      const want = S.resultOf(n, ix);
      assert.deepEqual(table.result.get(n.id), want, 'result of ' + n.id);
      const d = S.deltaVsPrevious(n, ix);
      const got = table.delta.get(n.id);
      assert.ok(d == null ? got == null : Math.abs(got - d) < 1e-9, 'delta of ' + n.id + ': ' + got + ' vs ' + d);
    }
  },
  'exams sat lately and still unmarked wait for their marks'() {
    const tree = [
      node('a', null, 'exam', { date: '2026-10-05' }),
      node('b', null, 'exam', { date: '2026-10-01' }),
      node('c', null, 'exam', { date: '2026-09-20' }),
      node('d', null, 'exam', { date: '2026-09-30', score: 5, outOf: 10 }),
      node('e', null, 'exam', { date: '2026-10-06' }),
      node('f', null, 'exam'),
      node('g', null, 'exam', { date: '2026-09-25' }),
    ];
    const ix = S.indexScores(tree);
    assert.deepEqual(S.waitingForMarks(ix, null, '2026-10-06').map((n) => n.id), ['a', 'b', 'g'], 'newest first, at most three');
    assert.deepEqual(S.waitingForMarks(ix, null, '2026-10-06', 10).map((n) => n.id), ['a', 'b', 'g'], 'two weeks back at most, marked and undated left out');
    assert.deepEqual(S.waitingForMarks(ix, null, '2026-10-04', 10).map((n) => n.id), ['b', 'g', 'c'], 'today and later are coming up instead');
  },
  'a duplicated group keeps the category of every exam inside it'() {
    const nodes = [
      { id: 't1', parentId: null, kind: 'group', title: 'Term 1', createdAt: 1, updatedAt: 1 },
      { id: 'u1', parentId: 't1', kind: 'exam', title: 'Unit test 1', tags: ['unit', 'hard'], createdAt: 1, updatedAt: 1 },
      { id: 'p1', parentId: 'u1', kind: 'exam', title: 'Physics', tags: ['careless'], score: 4, outOf: 10, createdAt: 1, updatedAt: 1 },
      { id: 'inner', parentId: 't1', kind: 'group', title: 'Labs', createdAt: 1, updatedAt: 1 },
      { id: 'l1', parentId: 'inner', kind: 'exam', title: 'Lab 1', tags: ['unit'], createdAt: 1, updatedAt: 1 },
    ];
    let n = 0;
    const copy = S.duplicateStructure(nodes, 't1', 5, () => 'c' + ++n);
    const by = (title) => copy.nodes.find((x) => x.title === title);
    assert.equal(copy.nodes.find((x) => x.id === copy.rootId).title, 'Term 2');
    assert.deepEqual(by('Unit test 1').tags, ['unit', 'hard'], 'an exam in the group keeps its tags');
    assert.deepEqual(by('Lab 1').tags, ['unit'], 'so does one in a group inside it');
    assert.ok(!('tags' in by('Physics')), "a subject's tags still start blank");
  },
  'marks read as typed and are checked'() {
    assert.deepEqual(S.parseMark('42.5'), { value: 42.5, bad: false });
    assert.deepEqual(S.parseMark('42,5'), { value: 42.5, bad: false });
    assert.deepEqual(S.parseMark('-4'), { value: -4, bad: false });
    assert.deepEqual(S.parseMark(''), { bad: false });
    assert.equal(S.parseMark('4x').bad, true);
    assert.equal(S.marksProblem(101, 100), "The score can't be more than the total.");
    assert.equal(S.marksProblem(-120, 100), "The score can't go below minus the total.");
    assert.equal(S.marksProblem(5, undefined), 'Add what it is out of.');
    assert.equal(S.marksProblem(undefined, 0), 'Out of must be more than 0.');
    assert.equal(S.marksProblem(-4, 100), null);
    assert.equal(S.fmtPct(74.666), '74.7%');
    assert.equal(S.fmtPct(80), '80%');
    assert.equal(S.fmtMark(-4), '-4');
  },
  'a damaged tree is repaired, and repairing twice changes nothing'() {
    const junk = [
      null, 'x', { kind: 'exam' },
      { id: 'g', kind: 'group', title: 'G', parentId: 'e' },
      { id: 'e', kind: 'exam', title: 'E', parentId: 'g', score: 'ten', outOf: 100, date: 'soon', weight: -1 },
      { id: 'a', kind: 'exam', title: 'A', parentId: 'b' },
      { id: 'b', kind: 'exam', title: 'B', parentId: 'a' },
      { id: 'c', kind: 'exam', title: 'C', parentId: 'a' },
      { id: 'o', kind: 'exam', title: 'O', parentId: 'gone', score: 5, outOf: 10 },
      { id: 'o', kind: 'exam', title: 'duplicate id' },
      { id: 'w', kind: 'weird' },
    ];
    const once = S.sanitizeScores(junk);
    const by = Object.fromEntries(once.map((n) => [n.id, n]));
    assert.deepEqual(Object.keys(by).sort(), ['a', 'b', 'c', 'e', 'g', 'o']);
    assert.equal(by.g.parentId, null, 'a group inside an exam moves to the top level');
    assert.equal(by.e.parentId, 'g');
    assert.ok(!('score' in by.e) && !('date' in by.e) && !('weight' in by.e), 'bad fields are removed, not left undefined');
    assert.equal(by.e.outOf, 100);
    assert.equal(by.o.parentId, null, 'an orphan moves to the top level');
    assert.ok(by.a.parentId === null || by.b.parentId === null, 'the cycle is broken');
    assert.equal(by.c.parentId, 'a', 'a node pointing into the cycle keeps its place');
    const ix = S.indexScores(once);
    assert.doesNotThrow(() => { S.groupSummary(ix, null); S.pathOf(ix, 'c'); S.resultOf(by.a, ix); });
    assert.deepEqual(S.sanitizeScores(once), once, 'a second pass changes nothing');
    assert.deepEqual(S.sanitizeScores('nope'), []);
  },
  'a tag filter keeps any of them, or only all of them'() {
    const tags = S.sanitizeTags([
      { id: 't1', label: ' Careless ', createdAt: 1 },
      { id: 't2', label: 'careless', createdAt: 2 },
      { id: 't3', label: 'Formulae', color: '#9AD6B0', createdAt: 3 },
      { id: 'bad', label: '   ', createdAt: 4 },
    ]);
    assert.deepEqual(tags.map((t) => t.id), ['t1', 't3'], 'the same name twice is one tag, a blank name is none');
    assert.equal(tags[0].label, 'Careless');
    const learnings = S.sanitizeLearnings([
      { id: 'l1', nodeId: 'e1', text: 'Both', tags: ['t1', 't3', 'gone'], createdAt: 3 },
      { id: 'l2', nodeId: 'e1', text: 'One', tags: ['t1'], createdAt: 2 },
      { id: 'l3', nodeId: 'e2', text: 'Other', tags: ['t3'], createdAt: 1 },
      { id: 'l4', nodeId: 'e1', text: '  ', tags: [], createdAt: 4 },
    ], tags);
    assert.deepEqual(learnings.map((l) => l.id), ['l1', 'l2', 'l3'], 'an empty learning is dropped');
    assert.deepEqual(learnings[0].tags, ['t1', 't3'], 'a tag that no longer exists is dropped');
    const ids = (list) => list.map((l) => l.id);
    assert.deepEqual(ids(S.filterLearnings(learnings, [], 'any')), ['l1', 'l2', 'l3'], 'no filter keeps them, newest first');
    assert.deepEqual(ids(S.filterLearnings(learnings, ['t1', 't3'], 'any')), ['l1', 'l2', 'l3']);
    assert.deepEqual(ids(S.filterLearnings(learnings, ['t1', 't3'], 'all')), ['l1'], 'all means every tag picked');
    assert.deepEqual(ids(S.filterLearnings(learnings, ['t1'], 'any', new Set(['e1']))), ['l1', 'l2'], 'a deleted exam is left out');
    const use = S.tagUse(tags, [{ id: 'e1', tags: ['t1'] }], learnings);
    assert.equal(use.get('t1'), 3, 'an exam and two learnings');
    assert.equal(use.get('t3'), 2);
    assert.notEqual(S.nextTagColor([{ color: S.TAG_COLORS[0] }]), S.TAG_COLORS[0], 'a new tag takes a free colour');
  },
  'the lists are tied together: dead tags leave exams, orphan learnings leave the notebook'() {
    const tags = [{ id: 't1', label: 'Kept', color: '#9AD6B0', createdAt: 1 }];
    const nodes = [
      { id: 'e', parentId: null, kind: 'exam', title: 'E', tags: ['t1', 'ghost'], createdAt: 1, updatedAt: 1 },
      { id: 'f', parentId: null, kind: 'exam', title: 'F', tags: ['ghost'], createdAt: 1, updatedAt: 1 },
      { id: 'g', parentId: null, kind: 'exam', title: 'G', createdAt: 1, updatedAt: 1 },
    ];
    const learnings = [
      { id: 'l1', nodeId: 'e', text: 'Stays', tags: [], createdAt: 1, updatedAt: 1 },
      { id: 'l2', nodeId: 'gone', text: 'Orphan', tags: [], createdAt: 1, updatedAt: 1 },
    ];
    const out = S.pruneScoreRefs(nodes, tags, learnings);
    assert.deepEqual(out.nodes[0].tags, ['t1'], 'a tag that no longer exists leaves the exam');
    assert.ok(!('tags' in out.nodes[1]), 'no tags left means no tags key');
    assert.equal(out.nodes[2], nodes[2], 'an untouched node is the same object');
    assert.deepEqual(out.learnings.map((l) => l.id), ['l1'], 'a learning whose exam is gone is dropped');
    const again = S.pruneScoreRefs(out.nodes, tags, out.learnings);
    assert.equal(again.learnings, out.learnings, 'a second pass changes nothing');
  },

  'a duplicate keeps what kind of paper it is, not how the last attempt went'() {
    const nodes = [
      { id: 'm', parentId: null, kind: 'exam', title: 'Mock 7', tags: ['full'], score: 50, outOf: 100, createdAt: 1, updatedAt: 1 },
      { id: 'p', parentId: 'm', kind: 'exam', title: 'Physics', tags: ['careless'], score: 20, outOf: 50, createdAt: 1, updatedAt: 1 },
    ];
    let n = 0;
    const copy = S.duplicateStructure(nodes, 'm', 5, () => 'c' + ++n);
    const root = copy.nodes.find((x) => x.id === copy.rootId);
    const sub = copy.nodes.find((x) => x.id !== copy.rootId);
    assert.equal(root.title, 'Mock 8');
    assert.deepEqual(root.tags, ['full'], "the exam's own tags carry over");
    assert.ok(!('tags' in sub), "a subject's tags start blank, like its marks");
    assert.ok(!('score' in root) && !('score' in sub), 'no marks');
  },
};

let failed = 0;
for (const [name, run] of Object.entries(checks)) {
  try {
    run();
    console.log('pass  ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL  ' + name + '\n      ' + String(e && e.message ? e.message : e).split('\n').join('\n      '));
  }
}
console.log(failed ? `\ntest-scores: ${failed} failed` : '\ntest-scores: all passed');
process.exit(failed ? 1 : 0);
