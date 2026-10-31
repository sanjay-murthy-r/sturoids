#!/usr/bin/env node
/*
 * Checks for what the Deep Work history says about the sessions, run against the real source in Node:
 * src/focusInsights.ts (this week against last week by the same day, subjects gone quiet, and the time of day the focus
 * and the deep focus come at).
 * Usage: node scripts/test-focus.js   (exit 1 on any failure)
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

const fi = load(path.join(ROOT, 'src', 'focusInsights.ts'));

let failed = 0;
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failed++; console.error('FAIL', name, '\n ', e.message); }
}

// Wednesday 28 October 2026; its week began on Monday the 26th
const today = '2026-10-28';
let n = 0;
/** a session of `min` minutes on `day`, begun at `hour` o'clock */
const S = (day, min, extra = {}) => {
  const hour = extra.hour ?? 10;
  const start = new Date(day + 'T00:00:00');
  start.setHours(hour);
  return { id: 's' + n++, dateKey: day, endedAt: start.getTime() + min * 60000, netSeconds: min * 60, taskTitles: [], ...extra };
};

// ---------- mondayOf ----------
test('a week starts on its Monday, a Sunday belonging to the week before it', () => {
  assert.equal(fi.mondayOf('2026-10-28'), '2026-10-26');
  assert.equal(fi.mondayOf('2026-10-26'), '2026-10-26');
  assert.equal(fi.mondayOf('2026-11-01'), '2026-10-26');
});

// ---------- weekPace ----------
test('no focus last week says nothing', () => {
  assert.equal(fi.weekPace([S('2026-10-27', 60)], today), null);
  assert.equal(fi.weekPace([], today), null);
});
test('this week against last, day for day: last Thursday on does not count yet', () => {
  const p = fi.weekPace([
    S('2026-10-19', 30), S('2026-10-21', 30), // last Monday and Wednesday: by this day
    S('2026-10-22', 120), S('2026-10-25', 60), // last Thursday and Sunday: not yet
    S('2026-10-26', 50), S('2026-10-28', 40), // this week
    S('2026-10-18', 500), // the week before last
  ], today);
  assert.deepEqual(p, { thisMin: 90, lastSoFarMin: 60, lastMin: 240, aheadMin: 30 });
});
test('behind is negative, and within five minutes is level', () => {
  assert.equal(fi.weekPace([S('2026-10-20', 90), S('2026-10-27', 30)], today).aheadMin, -60);
  assert.equal(fi.weekPace([S('2026-10-20', 62), S('2026-10-27', 60)], today).aheadMin, 0);
});
test('on a Monday only the two Mondays are weighed', () => {
  const p = fi.weekPace([S('2026-10-19', 45), S('2026-10-20', 45), S('2026-10-26', 10)], '2026-10-26');
  assert.equal(p.lastSoFarMin, 45);
  assert.equal(p.thisMin, 10);
});
test('damaged rows are passed over', () => {
  const p = fi.weekPace([S('2026-10-20', 30), { dateKey: 5 }, null, { dateKey: '2026-10-27', netSeconds: 'x' }], today);
  assert.equal(p.thisMin, 0);
  assert.equal(p.lastSoFarMin, 30);
});

// ---------- quietSubjects ----------
test('a subject worked on this month and not this week has gone quiet', () => {
  const q = fi.quietSubjects([
    S('2026-10-10', 60, { subject: 'Chemistry' }), S('2026-10-18', 40, { subject: 'chemistry ' }),
    S('2026-10-15', 30, { subject: 'Maths' }), S('2026-10-26', 30, { subject: 'maths' }),
  ], today);
  assert.deepEqual(q, [{ key: 'chemistry', name: 'chemistry', daysSince: 10, min: 100 }]);
});
test('the most worked on comes first, and only the first three', () => {
  const q = fi.quietSubjects([
    S('2026-10-05', 30, { subject: 'A' }), S('2026-10-06', 90, { subject: 'B' }), S('2026-10-07', 60, { subject: 'C' }),
    S('2026-10-08', 45, { subject: 'D' }),
  ], today);
  assert.deepEqual(q.map((x) => x.name), ['B', 'C', 'D']);
});
test('one stray session, no subject, or one past the month are never counted', () => {
  assert.deepEqual(fi.quietSubjects([
    S('2026-10-12', 10, { subject: 'Stray' }), S('2026-10-12', 90), S('2026-09-20', 90, { subject: 'Old' }),
  ], today), []);
});
test('exactly a week since is quiet; six days is not', () => {
  assert.equal(fi.quietSubjects([S('2026-10-21', 30, { subject: 'Bio' })], today).length, 1);
  assert.equal(fi.quietSubjects([S('2026-10-22', 30, { subject: 'Bio' })], today).length, 0);
});
test('the name shown is the latest spelling', () => {
  const q = fi.quietSubjects([S('2026-10-02', 30, { subject: 'phys' }), S('2026-10-09', 30, { subject: 'Phys' })], today);
  assert.equal(q[0].name, 'Phys');
  assert.equal(q[0].daysSince, 19);
});

// ---------- focusHours ----------
test('an hour belongs to its part of the day, the small hours to the night', () => {
  assert.deepEqual([5, 11, 12, 16, 17, 20, 21, 0, 4].map(fi.partOfHour),
    ['morning', 'morning', 'afternoon', 'afternoon', 'evening', 'evening', 'night', 'night', 'night']);
});
test('the focus is counted where each session began', () => {
  const h = fi.focusHours([
    S('2026-10-27', 60, { hour: 6 }), S('2026-10-27', 90, { hour: 18 }), S('2026-10-26', 45, { hour: 19 }),
    S('2026-10-25', 30, { hour: 23 }),
  ], today);
  assert.deepEqual(h.parts.map((p) => p.min), [60, 0, 135, 30]);
  assert.equal(h.best, 'evening');
  assert.equal(h.totalMin, 225);
  assert.equal(h.deepest, null);
});
test('a session begun just before 5 that ends after it is still the night', () => {
  const h = fi.focusHours([S('2026-10-27', 60, { hour: 4 })], today);
  assert.equal(h.best, 'night');
});
test('sessions logged by hand and ones older than the stretch are left out', () => {
  const h = fi.focusHours([S('2026-10-27', 60, { hour: 9, manual: true }), S('2026-09-01', 60, { hour: 9 })], today);
  assert.equal(h.totalMin, 0);
  assert.equal(h.best, null);
});
test('the deep sessions are named when they come at another time than most', () => {
  const h = fi.focusHours([
    S('2026-10-27', 120, { hour: 20, rating: 2 }), S('2026-10-26', 120, { hour: 19, rating: 1 }),
    S('2026-10-25', 50, { hour: 7, rating: 3 }),
  ], today);
  assert.equal(h.best, 'evening');
  assert.equal(h.deepest, 'morning');
  assert.equal(h.parts[0].deepMin, 50);
});
test('fewer than three rated sessions name no deepest time, and nor does the busiest time itself', () => {
  assert.equal(fi.focusHours([S('2026-10-27', 120, { hour: 20 }), S('2026-10-25', 50, { hour: 7, rating: 3 })], today).deepest, null);
  assert.equal(fi.focusHours([
    S('2026-10-27', 120, { hour: 20, rating: 3 }), S('2026-10-26', 20, { hour: 7, rating: 3 }), S('2026-10-25', 20, { hour: 8, rating: 1 }),
  ], today).deepest, null);
});

console.log(passed + ' passed' + (failed ? ', ' + failed + ' failed' : ''));
process.exit(failed ? 1 : 0);
