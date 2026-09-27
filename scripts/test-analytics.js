#!/usr/bin/env node
/*
 * Checks for src/analytics.ts and the category helpers in src/scores.ts, run against the real source in Node: scopes,
 * ranges, plain statistics, trend and projection, streaks, targets, ranks, subjects matched by name, where marks go,
 * the category overview, and categories as tags.
 * Usage: node scripts/test-analytics.js   (exit 1 on any failure)
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

const A = load(path.join(ROOT, 'src', 'analytics.ts'));
const S = load(path.join(ROOT, 'src', 'scores.ts'));
const near = (a, b, msg, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`);

let t = 0;
const node = (id, parentId, kind, extra = {}) => ({ id, parentId, kind, title: id, createdAt: ++t, updatedAt: 1, ...extra });

const TAGS = [
  { id: 'jee', label: 'JEE mocks', color: '#9AD6B0', createdAt: 1, category: true },
  { id: 'unit', label: 'Unit tests', color: '#E3C08D', createdAt: 2, category: true },
  { id: 'careless', label: 'Careless', color: '#E39EAC', createdAt: 3 },
];

// three JEE mocks with subjects, a unit test, and an exam in no category; one mock is coming up unmarked
const sub = (id, parent, title, score, outOf) => node(id, parent, 'exam', { title, score, outOf });
const TREE = [
  node('g', null, 'group', { title: 'Mocks' }),
  node('m1', 'g', 'exam', { title: 'Mock 1', date: '2026-08-01', tags: ['jee'], target: 60, rank: 5000, percentile: 90 }),
  sub('m1p', 'm1', 'Physics', 40, 100), sub('m1c', 'm1', 'Chemistry', 60, 100), sub('m1m', 'm1', 'Maths', 50, 100),
  node('m2', 'g', 'exam', { title: 'Mock 2', date: '2026-08-15', tags: ['careless', 'jee'], target: 60, rank: 4000, percentile: 92 }),
  sub('m2p', 'm2', 'physics ', 50, 100), sub('m2c', 'm2', 'Chemistry', 65, 100), sub('m2m', 'm2', 'Maths', 60, 100),
  node('m3', 'g', 'exam', { title: 'Mock 3', date: '2026-09-01', tags: ['jee'], target: 60, rank: 3000, percentile: 95 }),
  sub('m3p', 'm3', 'Physics', 60, 100), sub('m3c', 'm3', 'Chemistry', 70, 100), sub('m3m', 'm3', 'Maths', 40, 100),
  node('m4', 'g', 'exam', { title: 'Mock 4', date: '2026-10-01', tags: ['jee'] }),
  node('u1', null, 'exam', { title: 'Unit 1', date: '2026-08-10', tags: ['unit'], score: 18, outOf: 20 }),
  node('x1', null, 'exam', { title: 'Loose', date: '2026-08-20', score: 30, outOf: 50 }),
];
const ix = () => S.indexScores(TREE);

const checks = {
  'a category is the first category tag an exam carries'() {
    const i = ix();
    assert.equal(S.categoryOf(i.byId.get('m2'), TAGS).id, 'jee');
    assert.equal(S.categoryOf(i.byId.get('x1'), TAGS), null);
    assert.equal(S.categoryOf(i.byId.get('m1p'), TAGS), null, 'a subject carries no category of its own');
  },
  'an exam reads as the category it carries first, whatever order the categories were made in'() {
    const tags = [TAGS[1], TAGS[0], TAGS[2]];
    assert.equal(S.categoryOf({ ...TREE[1], tags: ['jee', 'unit'] }, tags).id, 'jee');
  },
  'a tag made a category never puts an exam in two'() {
    const tags = [...TAGS];
    const nodes = [
      node('a', null, 'exam', { tags: ['jee', 'careless'] }),
      node('b', null, 'exam', { tags: ['careless'] }),
      node('c', null, 'exam', { tags: ['other'] }),
    ];
    const out = S.promoteToCategory(nodes, tags, 'careless');
    assert.equal(out.dropped, 1);
    assert.deepEqual(out.nodes[0].tags, ['jee'], 'an exam already in a category keeps it and lets the tag go');
    assert.deepEqual(out.nodes[1].tags, ['careless'], 'an exam in none moves into it');
    assert.equal(out.nodes[2], nodes[2], 'others are untouched');
    const moved = S.promoteToCategory([node('d', null, 'exam', { tags: ['x', 'careless'] })], tags, 'careless');
    assert.deepEqual(moved.nodes[0].tags, ['careless', 'x'], 'the new category goes first');
    const same = [node('e', null, 'exam', { tags: ['x'] })];
    assert.equal(S.promoteToCategory(same, tags, 'careless').nodes, same, 'nothing rebuilt when nothing changes');
  },
  'swapping a category keeps the plain tags'() {
    assert.deepEqual(S.withCategory(['careless', 'jee'], 'unit', TAGS), ['unit', 'careless']);
    assert.deepEqual(S.withCategory(['careless', 'jee'], null, TAGS), ['careless']);
    assert.deepEqual(S.withCategory(undefined, 'jee', TAGS), ['jee']);
  },
  'repair keeps the category mark and drops anything else'() {
    const out = S.sanitizeTags([{ id: 'a', label: 'A', color: '#9AD6B0', category: true }, { id: 'b', label: 'B', category: 'yes' }]);
    assert.equal(out[0].category, true);
    assert.ok(!('category' in out[1]));
  },
  'a subject belongs to its exam at the top'() {
    const i = ix();
    assert.equal(S.rootExamOf(i, 'm2c').id, 'm2');
    assert.equal(S.rootExamOf(i, 'm2').id, 'm2');
    assert.equal(S.rootExamOf(i, 'g'), undefined);
  },
  'a category finds learnings through their exam'() {
    const learnings = [
      { id: 'l1', nodeId: 'm1', text: 'a', tags: [], createdAt: 1, updatedAt: 1 },
      { id: 'l2', nodeId: 'u1', text: 'b', tags: ['careless'], createdAt: 2, updatedAt: 2 },
    ];
    const i = ix();
    const extra = (l) => { const c = S.categoryOf(S.rootExamOf(i, l.nodeId), TAGS); return c ? [c.id] : []; };
    assert.deepEqual(S.filterLearnings(learnings, ['jee'], 'any', undefined, extra).map((l) => l.id), ['l1']);
    assert.deepEqual(S.filterLearnings(learnings, ['unit', 'careless'], 'all', undefined, extra).map((l) => l.id), ['l2']);
  },
  'scopes pick exams standing on their own, oldest first'() {
    const i = ix();
    assert.deepEqual(A.examsInScope(i, TAGS, 'jee').map((n) => n.id), ['m1', 'm2', 'm3', 'm4']);
    assert.deepEqual(A.examPoints(i, TAGS, 'jee').map((p) => p.id), ['m1', 'm2', 'm3'], 'unmarked exams are left out');
    assert.deepEqual(A.examPoints(i, TAGS, A.NONE).map((p) => p.id), ['x1']);
    assert.deepEqual(A.examPoints(i, TAGS, A.ALL).map((p) => p.id), ['m1', 'u1', 'm2', 'x1', 'm3']);
  },
  'a range keeps the latest few'() {
    assert.deepEqual(A.inRange([1, 2, 3, 4, 5, 6, 7], 5), [3, 4, 5, 6, 7]);
    assert.deepEqual(A.inRange([1, 2], 10), [1, 2]);
    assert.deepEqual(A.inRange([1, 2], 'all'), [1, 2]);
  },
  'plain statistics'() {
    near(A.mean([1, 2, 3, 4]), 2.5, 'mean');
    near(A.median([5, 1, 3]), 3, 'odd median');
    near(A.median([4, 1, 3, 2]), 2.5, 'even median');
    near(A.spread([2, 4, 4, 4, 5, 5, 7, 9]), 2, 'spread');
    assert.equal(A.spread([7]), 0);
    assert.ok(Number.isNaN(A.mean([])));
  },
  'a straight line through a series'() {
    const f = A.fitLine([50, 52, 54, 56]);
    near(f.slope, 2, 'slope');
    near(f.intercept, 50, 'intercept');
    near(f.residual, 0, 'residual');
    assert.equal(A.fitLine([3]), null);
    near(A.fitLine([5, 5, 5]).slope, 0, 'flat');
  },
  'moving average starts at the first full window'() {
    assert.deepEqual(A.movingAverage([3, 6, 9, 12], 3), [null, null, 6, 9]);
  },
  'a JEE series reads as it should'() {
    const pts = A.examPoints(ix(), TAGS, 'jee');
    const s = A.seriesStats(pts);
    // Mock 1: 150/300 = 50, Mock 2: 175/300 = 58.33, Mock 3: 170/300 = 56.67
    near(s.latest.pct, 170 / 3, 'latest');
    near(s.best.pct, 175 / 3, 'best');
    near(s.worst.pct, 50, 'worst');
    near(s.delta, 170 / 3 - 175 / 3, 'delta');
    assert.equal(s.latestIsBest, false);
    assert.equal(s.trend, 'rising');
    assert.equal(s.projection, null, 'no projection from three exams');
    assert.deepEqual(s.streak, { dir: 'down', count: 1 });
    assert.deepEqual(s.targets, { set: 3, met: 0 });
    assert.deepEqual(s.rank, { first: 5000, latest: 3000, best: 3000, change: -1000, n: 3 });
    near(s.percentile.mean, (90 + 92 + 95) / 3, 'percentile mean');
    assert.equal(s.bands.find((b) => b.label === '50s').count, 3);
  },
  'streaks, targets met and the projection'() {
    const pts = [40, 45, 50, 60, 70].map((pct, i) => ({ id: 'p' + i, title: '', when: '2026-01-0' + (i + 1), pct, target: 55 }));
    const s = A.seriesStats(pts);
    assert.deepEqual(s.streak, { dir: 'up', count: 4 });
    assert.deepEqual(s.targets, { set: 5, met: 2 });
    assert.equal(s.latestIsBest, true);
    assert.ok(s.projection.value > 70 && s.projection.value <= 100, 'projects upward');
    assert.ok(s.projection.low <= s.projection.value && s.projection.value <= s.projection.high);
    near(s.form, 70 - 48.75, 'form');
  },
  'a projection never leaves 0 to 100'() {
    const pts = [80, 88, 94, 98, 100].map((pct, i) => ({ id: 'p' + i, title: '', when: '2026-01-0' + (i + 1), pct }));
    const s = A.seriesStats(pts);
    assert.ok(s.projection.value <= 100 && s.projection.high <= 100);
  },
  'one exam is a series of one'() {
    const s = A.seriesStats([{ id: 'a', title: '', when: '2026-01-01', pct: 64 }]);
    assert.equal(s.n, 1);
    assert.equal(s.delta, null);
    assert.equal(s.slope, null);
    assert.equal(s.streak, null);
    assert.equal(s.sd, 0);
    assert.equal(A.seriesStats([]), null);
  },
  'subjects match by name across exams'() {
    const stats = A.subjectStats(ix(), ['m1', 'm2', 'm3']);
    const phy = stats.find((x) => x.key === 'physics');
    assert.equal(stats.length, 3, 'physics and "physics " are one subject');
    assert.equal(phy.n, 3);
    near(phy.mean, 50, 'physics mean');
    near(phy.slope, 10, 'physics climbs ten an exam');
    assert.equal(phy.name, 'Physics', 'the latest spelling');
    assert.equal(stats[0].key, 'chemistry', 'strongest first');
    // lost: physics 150, chemistry 105, maths 150, of 405
    near(phy.lostShare, 150 / 405, 'lost share');
    near(phy.weight, 1 / 3, 'a third of the paper');
  },
  'a subject missing from an exam leaves a gap'() {
    const tree = [...TREE, node('m5', 'g', 'exam', { title: 'Mock 5', date: '2026-09-10', tags: ['jee'] }), sub('m5b', 'm5', 'Biology', 30, 40)];
    const stats = A.subjectStats(S.indexScores(tree), ['m3', 'm5']);
    const bio = stats.find((x) => x.key === 'biology');
    assert.equal(bio.cells[0], null);
    assert.equal(bio.cells[1].pct, 75);
    assert.equal(stats.find((x) => x.key === 'physics').cells[1], null);
  },
  'callouts name the subjects worth naming'() {
    const c = A.subjectCallouts(A.subjectStats(ix(), ['m1', 'm2', 'm3']));
    assert.equal(c.strongest.key, 'chemistry');
    assert.equal(c.weakest.key, 'maths');
    assert.equal(c.improving.key, 'physics');
    assert.equal(c.slipping.key, 'maths');
    assert.ok(['physics', 'maths'].includes(c.costliest.key));
    assert.deepEqual(A.subjectCallouts([]), { strongest: null, weakest: null, improving: null, slipping: null, costliest: null });
  },
  'the category overview lists each category, then the rest'() {
    const rows = A.categoryRows(ix(), TAGS);
    assert.deepEqual(rows.map((r) => r.scope), ['jee', 'unit', A.NONE]);
    assert.equal(rows[0].exams, 4);
    assert.equal(rows[0].marked, 3);
    near(rows[1].latest, 90, 'unit latest');
  },
  'Analytics opens on the category of the latest marked exam'() {
    assert.equal(A.defaultScope(ix(), TAGS), 'jee');
    assert.equal(A.defaultScope(S.indexScores([]), TAGS), A.ALL);
  },
  'words for changes and trends'() {
    assert.equal(A.fmtPoints(2.44), '+2.4');
    assert.equal(A.fmtPoints(-3), '-3');
    assert.equal(A.fmtPoints(0.04), '0');
    assert.equal(A.trendText(1.64), 'Rising 1.6 points an exam');
    assert.equal(A.trendText(-1), 'Falling 1 point an exam');
    assert.equal(A.trendText(0.2), 'Holding steady');
  },
  'the insight line says the latest and how it moves, never a zero'() {
    const pt = (pct, i, title = 'Mock ' + (i + 1)) => ({ id: 'p' + i, title, when: '2026-01-0' + (i + 1), pct });
    assert.equal(A.insightLine(A.seriesStats([50, 52, 54].map((v, i) => pt(v, i)))), 'Latest 54%, rising 2 points an exam');
    assert.equal(A.insightLine(A.seriesStats([54, 54.2, 54].map((v, i) => pt(v, i)))), 'Latest 54%, holding steady');
    assert.equal(A.insightLine(A.seriesStats([50, 51].map((v, i) => pt(v, i)))), 'Latest 51%, up 1 point on the one before');
    assert.equal(A.insightLine(A.seriesStats([60, 57.6].map((v, i) => pt(v, i)))), 'Latest 57.6%, down 2.4 points on the one before');
    assert.equal(A.insightLine(A.seriesStats([60, 60.02].map((v, i) => pt(v, i)))), 'Latest 60%', 'no sentence about no change');
    assert.equal(A.insightLine(A.seriesStats([pt(72.44, 0, 'Unit 1')])), '72.4% in Unit 1');
  },
  'a second reading only when the last five run differently'() {
    const pts = [40, 50, 60, 70, 80, 78, 76, 74, 72].map((pct, i) => ({ id: 'p' + i, title: '', when: '2026-01-0' + (i + 1), pct }));
    const s = A.seriesStats(pts);
    assert.equal(s.trend, 'rising');
    assert.equal(A.recentNote(s), 'Over the last five: falling 2 points an exam');
    const same = A.seriesStats([40, 45, 50, 55, 60, 65].map((pct, i) => ({ id: 'q' + i, title: '', when: '2026-01-0' + (i + 1), pct })));
    assert.equal(A.recentNote(same), null);
    assert.equal(A.recentNote(A.seriesStats(pts.slice(0, 3))), null, 'no recent slope from three');
  },
  'consistency in words, and none for results that never move'() {
    assert.equal(A.steadyText(3.24), 'Steady: within about 3.2 points of the average');
    assert.equal(A.steadyText(1), 'Very steady: within about 1 point of the average');
    assert.equal(A.steadyText(12), 'Up and down: within about 12 points of the average');
    assert.equal(A.steadyText(0.02), null);
    assert.equal(A.steadyText(0), null);
  },
  'a view opens on every result up to ten'() {
    assert.equal(A.defaultRange(0), 'all');
    assert.equal(A.defaultRange(10), 'all');
    assert.equal(A.defaultRange(11), 10);
  },
  'a chart scale has three or four round gridlines and a ten point span'() {
    const check = (values, lo, hi, ticks) => {
      const s = A.chartScale(values);
      assert.deepEqual([s.lo, s.hi, s.ticks], [lo, hi, ticks], 'scale for ' + values.join(', '));
    };
    check([50, 170 / 3, 175 / 3], 45, 60, [45, 50, 55, 60]);
    check([42, 71], 40, 80, [40, 60, 80]);
    check([30, 95], 25, 100, [25, 50, 75, 100]);
    check([0, 100], 0, 100, [0, 50, 100]);
    check([98, 100], 90, 100, [90, 95, 100]);
    check([1, 3], 0, 10, [0, 5, 10]);
    check([-12, 40], -20, 40, [-20, 0, 20, 40]);
    check([64], 55, 70, [55, 60, 65, 70]);
    for (const vals of [[12.3, 13.1], [33, 34, 99], [-80, 100], [71.4]]) {
      const s = A.chartScale(vals);
      assert.ok(s.ticks.length >= 3 && s.ticks.length <= 4, 'three or four ticks for ' + vals);
      assert.ok(s.hi - s.lo >= 10, 'at least ten points for ' + vals);
      assert.ok(s.lo <= Math.min(...vals) && s.hi >= Math.max(...vals), 'the results inside for ' + vals);
      assert.ok(s.ticks.every((t) => Number.isInteger(t / 5)), 'round ticks for ' + vals);
    }
  },
  'a series with gaps splits into runs'() {
    assert.deepEqual(A.runsOf([1, 2, null, 4, null, null, 7, 8]), [
      { start: 0, values: [1, 2] }, { start: 3, values: [4] }, { start: 6, values: [7, 8] },
    ]);
    assert.deepEqual(A.runsOf([null, null]), []);
  },
  'columns are named by date, then by number, then by place'() {
    assert.equal(A.shortDay('2026-09-12'), '12 Sep');
    assert.equal(A.shortDay('2026-01-01'), '1 Jan');
    assert.equal(A.shortDay('bad'), 'bad');
    assert.deepEqual(A.columnLabels([{ title: 'Mock 1', when: '2026-08-01' }, { title: 'Mock 2', when: '2026-08-15' }]), ['1 Aug', '15 Aug']);
    assert.deepEqual(A.columnLabels([{ title: 'Mock 07', when: '2026-08-01' }, { title: 'Mock 8', when: '2026-08-01' }]), ['#7', '#8']);
    assert.deepEqual(A.columnLabels([{ title: 'Physics', when: '2026-08-01' }, { title: 'Maths', when: '2026-08-01' }]), ['1', '2']);
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
console.log(failed ? `\ntest-analytics: ${failed} failed` : '\ntest-analytics: all passed');
process.exit(failed ? 1 : 0);
