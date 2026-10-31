#!/usr/bin/env node
/*
 * Checks for the Planner's and Tasks' pure helpers, run against the real source in Node: src/blocks.ts (a block's Deep
 * Work, its subject's colour, its repeats on other days, overlaps, the next date of a weekday) and src/todos.ts (the
 * ToDo list's order, the triage's leftovers, and the moves a long-term task's deadline is offered).
 * Usage: node scripts/test-plan.js   (exit 1 on any failure)
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

const blocks = load(path.join(ROOT, 'src', 'blocks.ts'));
const todos = load(path.join(ROOT, 'src', 'todos.ts'));

let failed = 0;
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failed++; console.error('FAIL', name, '\n ', e.message); }
}

const at = (h, m = 0) => new Date(2026, 9, 24, h, m); // Sat 24 Oct 2026 … any day works for the clock

// ---------- blockFocusParams ----------
test('a block not on now opens its whole length', () => {
  assert.deepEqual(blocks.blockFocusParams({ subject: 'Physics', start: '16:00', end: '17:30' }, false, at(9)), { subject: 'Physics', minutes: 90 });
});
test('a block on now opens what is left of it', () => {
  assert.deepEqual(blocks.blockFocusParams({ subject: 'Chem', start: '09:00', end: '10:00' }, true, at(9, 20)), { subject: 'Chem', minutes: 40 });
});
test('a block said to be on now but outside its times opens its length', () => {
  assert.equal(blocks.blockFocusParams({ subject: 'Chem', start: '09:00', end: '10:00' }, true, at(11)).minutes, 60);
});
test('a block until midnight counts to the end of the day', () => {
  assert.equal(blocks.blockFocusParams({ subject: 'Maths', start: '23:00', end: '24:00' }, true, at(23, 30)).minutes, 30);
});
test('a broken block still opens at least a minute', () => {
  assert.equal(blocks.blockFocusParams({ subject: 'X', start: 'bad', end: '10:00' }, false, at(9)).minutes, 1);
});

// ---------- the week ----------
const week = {
  Mon: [{ id: 'a', subject: 'Physics', start: '09:00', end: '10:00', color: '#111' }],
  Tue: [{ id: 'b', subject: ' physics ', start: '09:00', end: '10:00', color: '#222' }, { id: 'c', subject: 'Chem', start: '11:00', end: '12:00', color: '#333' }],
  Wed: [{ id: 'd', subject: 'Physics', start: '09:00', end: '10:30', color: '#111' }],
  Thu: [], Fri: [{ id: 'e', subject: 'PHYSICS', start: '09:00', end: '10:00', color: '#444' }], Sat: [], Sun: [],
};
test('a subject takes the colour it already has, the day shown first', () => {
  assert.equal(blocks.colorForSubject(week, 'physics'), '#111');
  assert.equal(blocks.colorForSubject(week, 'Physics', 'Tue'), '#222');
  assert.equal(blocks.colorForSubject(week, 'Biology'), null);
  assert.equal(blocks.colorForSubject(week, '   '), null);
});
test('a block repeats where the same subject has the same times', () => {
  assert.deepEqual(blocks.repeatsOf(week, 'Mon', week.Mon[0]), [{ day: 'Tue', id: 'b' }, { day: 'Fri', id: 'e' }]);
  assert.deepEqual(blocks.repeatsOf(week, 'Tue', week.Tue[1]), []);
});
test('overlaps are found, ignoring the block itself and touching ends', () => {
  assert.equal(blocks.clashIn(week.Tue, '09:30', '10:30').id, 'b');
  assert.equal(blocks.clashIn(week.Tue, '10:00', '11:00'), null);
  assert.equal(blocks.clashIn(week.Tue, '09:30', '11:30', ['b']).id, 'c');
  assert.equal(blocks.clashIn(undefined, '09:00', '10:00'), null);
});

// ---------- dates ----------
test('the next date of a weekday is today on that day, else the coming one', () => {
  const sat = new Date(2026, 9, 24); // a Saturday
  assert.equal(blocks.nextDateOf(5, sat).getDate(), 24);
  assert.equal(blocks.nextDateOf(4, sat).getDate(), 30); // Fri 30 Oct
  assert.equal(blocks.nextDateOf(0, sat).getDate(), 26); // Mon 26 Oct
  const nextMonth = blocks.nextDateOf(2, new Date(2026, 9, 30)); // Fri 30 Oct -> Wed 4 Nov
  assert.equal(nextMonth.getMonth(), 10);
  assert.equal(nextMonth.getDate(), 4);
});
test('a date is said short', () => {
  assert.equal(blocks.fmtDayShort(new Date(2026, 9, 30)), 'Fri 30 Oct');
  assert.equal(blocks.fmtDayShort(new Date(2026, 0, 4)), 'Sun 4 Jan');
});

// ---------- the ToDo list ----------
const today = '2026-10-24'; // Saturday (5)
const T = (id, extra = {}) => ({ id, title: id, doneOn: null, createdAt: 0, ...extra });
test('open timed ToDos sort by time, untimed after in their order', () => {
  const list = [T('a'), T('b', { time: '17:00' }), T('c'), T('d', { time: '08:30' })];
  assert.deepEqual(todos.orderTodos(list, today).map((x) => x.task.id), ['d', 'b', 'a', 'c']);
});
test('ToDos ticked today sink below the open ones, in the same order', () => {
  const list = [T('a', { doneOn: today }), T('b', { time: '17:00', doneOn: today }), T('c'), T('d', { time: '09:00' })];
  const out = todos.orderTodos(list, today);
  assert.deepEqual(out.map((x) => x.task.id), ['d', 'c', 'b', 'a']);
  assert.deepEqual(out.map((x) => x.done), [false, false, true, true]);
});
test('a weekly ToDo off its days goes last, not due', () => {
  const list = [T('w', { repeat: 'daily', days: [0, 2] }), T('a'), T('s', { repeat: 'daily', days: [5] })];
  const out = todos.orderTodos(list, today);
  assert.deepEqual(out.map((x) => x.task.id), ['a', 's', 'w']);
  assert.deepEqual(out.map((x) => x.due), [true, true, false]);
});
test('a ticked one-off from yesterday is open, not done', () => {
  assert.equal(todos.orderTodos([T('a', { doneOn: '2026-10-23' })], today)[0].done, false);
});
test('the triage leaves out repeating ToDos and the ones made today', () => {
  const start = new Date(today + 'T00:00:00').getTime();
  const list = [
    T('old', { createdAt: start - 1 }),
    T('rep', { createdAt: start - 1, repeat: 'daily' }),
    T('new', { createdAt: start + 1 }),
    T('yday', { createdAt: start - 1, doneOn: '2026-10-23' }),
    T('kept', { createdAt: start - 1 }),
  ];
  assert.deepEqual(todos.leftoverTodos(list, today, '2026-10-23', ['kept']).map((t) => t.id), ['old']);
});

// ---------- deadlineMoves ----------
test('a deadline moves to tomorrow, in three days or in a week, across a month end', () => {
  assert.deepEqual(todos.deadlineMoves('2026-10-30').map((m) => m.label + ' ' + m.dateKey),
    ['Tomorrow 2026-10-31', 'In 3 days 2026-11-02', 'In a week 2026-11-06']);
});
test('across a year end too', () => {
  assert.deepEqual(todos.deadlineMoves('2026-12-31').map((m) => m.dateKey), ['2027-01-01', '2027-01-03', '2027-01-07']);
});
test('the deadline it already has is not offered', () => {
  assert.deepEqual(todos.deadlineMoves('2026-10-30', '2026-11-02').map((m) => m.days), [1, 7]);
});
test('a day that cannot be read offers nothing', () => {
  assert.deepEqual(todos.deadlineMoves('soon'), []);
});

console.log(passed + ' passed' + (failed ? ', ' + failed + ' failed' : ''));
process.exit(failed ? 1 : 0);
