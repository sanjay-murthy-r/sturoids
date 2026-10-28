#!/usr/bin/env node
/*
 * Checks for Today's board, the pure part (src/widgets/logic.ts): how widgets pack into the grid, the edits to a
 * layout, the day's list and what is next or coming up, and the small helpers the widgets read.
 * Usage: node scripts/test-widgets.js   (exit 1 on any failure)
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

const L = load(path.join(ROOT, 'src', 'widgets', 'logic.ts'));

let failed = 0;
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failed++; console.error('FAIL', name, '\n ', e.message); }
}

// ---------------------------------------------------------------- the grid
test('S widgets pair up; M takes a row; L takes a row', () => {
  const slots = L.packBoard([{ id: 'a', span: 1 }, { id: 'b', span: 1 }, { id: 'c', span: 2 }], 2);
  assert.deepEqual(slots.map((s) => [s.kind, s.row, s.col]), [['widget', 0, 0], ['widget', 0, 1], ['widget', 1, 0]]);
});
test('a lone S leaves a gap on its row, after it', () => {
  const slots = L.packBoard([{ id: 'a', span: 1 }, { id: 'b', span: 2 }], 2);
  assert.deepEqual(slots.map((s) => s.kind + s.row + ':' + s.col + 'x' + s.span), ['widget0:0x1', 'gap0:1x1', 'widget1:0x2']);
});
test('a trailing lone S leaves a gap', () => {
  const slots = L.packBoard([{ id: 'a', span: 2 }, { id: 'b', span: 1 }], 2);
  assert.equal(slots[slots.length - 1].kind, 'gap');
});
test('four columns: two M side by side', () => {
  assert.equal(L.spanOf('M', 4), 2);
  assert.equal(L.spanOf('S', 4), 1);
  const slots = L.packBoard([{ id: 'a', span: 2 }, { id: 'b', span: 2 }], 4);
  assert.deepEqual(slots.map((s) => s.row), [0, 0]);
});
test('a span wider than the row is held to it', () => {
  const slots = L.packBoard([{ id: 'a', span: 9 }], 2);
  assert.equal(slots[0].span, 2);
});
test('heights: L is two cells and a gap', () => {
  assert.equal(L.heightOf('S'), L.CELL_H);
  assert.equal(L.heightOf('L'), L.CELL_H * 2 + L.GRID_GAP);
});

// ---------------------------------------------------------------- layouts
test('the default layout is Today as it was, and frozen', () => {
  assert.deepEqual(L.DEFAULT_LAYOUT.map((w) => w.type),
    ['plan', 'glance', 'coming', 'quick', 'journalNudge', 'todayList', 'habits', 'focusBars']);
  assert.ok(Object.isFrozen(L.DEFAULT_LAYOUT));
});
test('fitLayout drops unknown types and fixes sizes', () => {
  const out = L.fitLayout([{ id: '1', type: 'x', size: 'M' }, { id: '2', type: 'ring', size: 'L' }],
    (t) => (t === 'ring' ? ['S'] : null));
  assert.deepEqual(out, [{ id: '2', type: 'ring', size: 'S' }]);
});
test('fitLayout keeps a widget whose size fits as the same object', () => {
  const w = { id: '1', type: 'a', size: 'M' };
  assert.equal(L.fitLayout([w], () => ['M'])[0], w);
});
test('move, remove and insert (an undo puts it back where it was)', () => {
  const list = ['a', 'b', 'c'].map((id) => ({ id, type: 't', size: 'M' }));
  assert.deepEqual(L.moveWidget(list, 0, 2).map((w) => w.id), ['b', 'c', 'a']);
  assert.deepEqual(L.moveWidget(list, 5, 0).map((w) => w.id), ['a', 'b', 'c']);
  const r = L.removeWidget(list, 'b');
  assert.deepEqual(r.list.map((w) => w.id), ['a', 'c']);
  assert.equal(r.index, 1);
  assert.deepEqual(L.insertWidget(r.list, r.removed, r.index).map((w) => w.id), ['a', 'b', 'c']);
  assert.deepEqual(L.insertWidget(list, list[0], 2).map((w) => w.id), ['a', 'b', 'c'], 'never twice');
  assert.equal(L.removeWidget(list, 'zz').removed, null);
});
test('nextSize goes round', () => {
  assert.equal(L.nextSize(['S', 'M'], 'S'), 'M');
  assert.equal(L.nextSize(['S', 'M'], 'M'), 'S');
  assert.equal(L.nextSize(['M'], 'M'), 'M');
});

// ---------------------------------------------------------------- the day
const today = '2026-10-26'; // a Monday
test("today's list: late first, then timed by time, then untimed in order; weekly ToDos only on their days", () => {
  const dailies = [
    { id: 'u1', title: 'untimed', doneOn: null },
    { id: 't9', title: 'nine', doneOn: null, time: '09:00' },
    { id: 't7', title: 'seven', doneOn: today, time: '07:00' },
    { id: 'tue', title: 'tuesdays', doneOn: null, repeat: 'daily', days: [1] },
    { id: 'mon', title: 'mondays', doneOn: null, repeat: 'daily', days: [0] },
  ];
  const missions = [
    { id: 'late2', title: 'late 2', deadline: '2026-10-24', done: false },
    { id: 'late1', title: 'late 1', deadline: '2026-10-25', done: false },
    { id: 'due', title: 'due', deadline: today, done: false, time: '08:00' },
    { id: 'later', title: 'later', deadline: '2026-10-28', done: false },
    { id: 'olddone', title: 'old done', deadline: '2026-10-20', done: true, doneOn: '2026-10-21' },
    { id: 'donetoday', title: 'done today', deadline: '2026-10-20', done: true, doneOn: today },
  ];
  const ids = L.todayItems(dailies, missions, today).map((t) => t.id);
  assert.deepEqual(ids, ['donetoday', 'late2', 'late1', 't7', 'due', 't9', 'u1', 'mon']);
});
test('next up is the first open row', () => {
  assert.equal(L.nextUpOf([{ id: 'a', done: true }, { id: 'b', done: false }]).id, 'b');
  assert.equal(L.nextUpOf([{ id: 'a', done: true }]), null);
});
test('next block: on now, then next, then tomorrow', () => {
  const blk = (id, subject, start, end) => ({ id, subject, start, end, color: '#fff' });
  const planner = {
    Mon: [blk('m1', 'A', '09:00', '10:00'), blk('m2', 'B', '14:00', '15:00')],
    Tue: [blk('t1', 'C', '08:00', '09:00')],
  };
  const at = (h, m = 0) => new Date(2026, 9, 26, h, m);
  const now = L.nextBlockOf(planner, at(9, 30));
  assert.deepEqual([now.block.id, now.tag], ['m1', 'NOW']);
  assert.equal(L.nextBlockOf(planner, at(11)).tag, 'NEXT UP');
  const tom = L.nextBlockOf(planner, at(16));
  assert.deepEqual([tom.block.id, tom.tag], ['t1', 'TOMORROW']);
  assert.equal(L.nextBlockOf({}, at(16)), null);
});
test('coming up: exams in 30 days, tasks in 7, soonest first, exam before task, at most 4', () => {
  const exams = [
    { id: 'e40', title: 'far', date: '2026-12-05' },
    { id: 'e3', title: 'mock', date: '2026-10-29' },
    { id: 'e0', title: 'today', date: today },
    { id: 'nodate', title: 'x' },
  ];
  const missions = [
    { id: 'm3', title: 'essay', deadline: '2026-10-29', done: false },
    { id: 'm1', title: 'lab', deadline: '2026-10-27', done: false },
    { id: 'm0', title: 'due today', deadline: today, done: false },
    { id: 'm9', title: 'later', deadline: '2026-11-04', done: false },
    { id: 'mdone', title: 'done', deadline: '2026-10-27', done: true },
  ];
  const rows = L.comingUp(exams, missions, today);
  assert.deepEqual(rows.map((r) => r.id), ['e0', 'm1', 'e3', 'm3']);
  assert.equal(L.dPill(0), 'Today');
  assert.equal(L.dPill(3), 'D-3');
});
test('last seven days end today, across a month', () => {
  assert.deepEqual(L.lastSevenDays('2026-11-02'),
    ['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
});
test('block progress and minutes left', () => {
  const b = { start: '09:00', end: '10:00' };
  assert.equal(L.blockProgress(b, new Date(2026, 9, 26, 9, 30)), 0.5);
  assert.equal(L.blockProgress(b, new Date(2026, 9, 26, 8)), 0);
  assert.equal(L.blockProgress(b, new Date(2026, 9, 26, 11)), 1);
  assert.equal(L.minutesLeft(b, new Date(2026, 9, 26, 9, 45)), 15);
  assert.equal(L.minutesLeft(b, new Date(2026, 9, 26, 11)), 0);
  assert.equal(L.minutesLeft({ end: '24:00' }, new Date(2026, 9, 26, 23, 0)), 60);
});
test('day window: whole hours around the blocks, at least four hours, inside the day', () => {
  assert.deepEqual(L.dayWindow([{ start: '09:30', end: '10:15' }]), { start: 8 * 60, end: 12 * 60 });
  assert.deepEqual(L.dayWindow([{ start: '08:00', end: '17:00' }]), { start: 480, end: 1020 });
  assert.deepEqual(L.dayWindow([{ start: '00:00', end: '01:00' }]), { start: 0, end: 240 });
  assert.deepEqual(L.dayWindow([{ start: '23:00', end: '24:00' }]), { start: 1200, end: 1440 });
});
test('note title and excerpt', () => {
  assert.equal(L.noteTitleOf({ title: ' Physics ', body: 'x' }), 'Physics');
  assert.equal(L.noteTitleOf({ title: '', body: '\n# First line\nsecond' }), '# First line');
  assert.equal(L.noteTitleOf({ title: '', body: '' }), 'Untitled');
  assert.equal(L.noteExcerptOf({ title: 'T', body: '- one\n- [x] two' }), 'one two');
  assert.equal(L.noteExcerptOf({ title: '', body: 'head\nrest of it' }), 'rest of it');
  assert.ok(L.noteExcerptOf({ title: 'T', body: 'a'.repeat(200) }).endsWith('…'));
});
test('recent videos: opened first by when, else by when added', () => {
  const v = [{ id: 'a', addedAt: 5 }, { id: 'b', addedAt: 1, openedAt: 10 }, { id: 'c', addedAt: 7 }];
  assert.deepEqual(L.recentVideos(v, 2).map((x) => x.id), ['b', 'c']);
  assert.equal(v[0].id, 'a', 'the list itself is left alone');
});

test('continue video: the latest opened one left part-way, else the latest opened', () => {
  const v = [
    { id: 'a', addedAt: 5, resumeAt: 30, openedAt: 2 },
    { id: 'b', addedAt: 1, openedAt: 10 },
    { id: 'c', addedAt: 7, resumeAt: 60, openedAt: 8 },
  ];
  assert.equal(L.continueVideo(v).id, 'c');
  assert.equal(L.continueVideo([v[1]]).id, 'b');
  assert.equal(L.continueVideo([]), null);
});

/* ---------------------------------------------------------------- columns and drag */

{
  const G = L.GRID_GAP;
  const item = (id, half, h) => [id, { id, half, h }];
  const items = new Map([item('a', false, 100), item('s1', true, 156), item('s2', true, 156), item('b', false, 200), item('s3', true, 156), item('c', false, 50)]);

  test('the board has one column on a phone, two on a tablet upright or a foldable, three sideways', () => {
    assert.equal(L.boardColumns(360), 1);
    assert.equal(L.boardColumns(599), 1);
    assert.equal(L.boardColumns(600), 2);
    assert.equal(L.boardColumns(1079), 2);
    assert.equal(L.boardColumns(1080), 3);
  });

  test('a column lays out top to bottom, S tiles two to a row, a lone one leaving a half to add into', () => {
    const { rects, gaps, heights } = L.layoutColumns([['a', 's1', 's2', 'b', 's3', 'c']], items, 400, G);
    const half = (400 - G) / 2;
    assert.deepEqual(rects.get('a'), { x: 0, y: 0, w: 400, h: 100, col: 0 });
    assert.deepEqual(rects.get('s1'), { x: 0, y: 100 + G, w: half, h: 156, col: 0 });
    assert.deepEqual(rects.get('s2'), { x: half + G, y: 100 + G, w: half, h: 156, col: 0 });
    const yB = 100 + G + 156 + G;
    assert.deepEqual(rects.get('b'), { x: 0, y: yB, w: 400, h: 200, col: 0 });
    const yS3 = yB + 200 + G;
    assert.deepEqual(rects.get('s3'), { x: 0, y: yS3, w: half, h: 156, col: 0 });
    // the full-width widget after a lone S starts below it, and the half beside the S is a gap
    assert.equal(rects.get('c').y, yS3 + 156 + G);
    assert.deepEqual(gaps.map((g) => [g.afterId, g.x, g.y]), [['s3', half + G, yS3]]);
    assert.equal(heights[0], yS3 + 156 + G + 50);
  });

  test('a section with nothing to show takes no room and no gap', () => {
    const its = new Map([item('empty', false, 0), item('a', false, 100), item('b', false, 50)]);
    const { rects, heights } = L.layoutColumns([['empty', 'a', 'b']], its, 400, G);
    assert.equal(rects.get('empty').h, 0);
    assert.equal(rects.get('a').y, 0, 'the first thing with something to show starts the column');
    assert.equal(rects.get('b').y, 100 + G);
    assert.equal(heights[0], 100 + G + 50);
  });

  test('columns sit side by side, each its own stack', () => {
    const { rects, heights } = L.layoutColumns([['a', 'c'], ['b']], items, 300, G);
    assert.deepEqual(rects.get('b'), { x: 300 + G, y: 0, w: 300, h: 200, col: 1 });
    assert.equal(rects.get('c').y, 100 + G);
    assert.deepEqual(heights, [100 + G + 50, 200]);
  });

  test('a wide board deals its widgets to the shortest column, and keeps an arrangement it was given', () => {
    const h = (id) => ({ a: 100, b: 300, c: 100, d: 100, e: 100 })[id];
    assert.deepEqual(L.arrangeColumns(['a', 'b', 'c', 'd', 'e'], 2, null, h), [['a', 'c', 'd'], ['b', 'e']]);
    assert.deepEqual(L.arrangeColumns(['a', 'b', 'c'], 3, null, h), [['a'], ['b'], ['c']]);
    // kept: its order wins; one it does not know joins the shortest column; one gone is left out
    assert.deepEqual(L.arrangeColumns(['a', 'b', 'c', 'e'], 2, [['c', 'gone', 'a'], ['b']], h), [['c', 'a', 'e'], ['b']]);
    // an arrangement for another column count is not used
    assert.deepEqual(L.arrangeColumns(['a', 'b'], 2, [['a'], ['b'], []], h), [['a'], ['b']]);
    // one column is the order itself
    assert.deepEqual(L.arrangeColumns(['b', 'a'], 1, null, h), [['b', 'a']]);
  });

  test('a move takes a widget out and puts it at a place counted without it', () => {
    assert.deepEqual(L.moveInColumns([['a', 'b', 'c']], 'a', 0, 2), [['b', 'c', 'a']]);
    assert.deepEqual(L.moveInColumns([['a', 'b', 'c']], 'c', 0, 0), [['c', 'a', 'b']]);
    assert.deepEqual(L.moveInColumns([['a', 'b'], ['c']], 'a', 1, 1), [['b'], ['c', 'a']]);
    assert.deepEqual(L.moveInColumns([['a'], []], 'a', 1, 9), [[], ['a']]);
    assert.deepEqual(L.moveInColumns([['a', 'b']], 'b', 0, 1), [['a', 'b']]);
  });

  test('a dragged widget lands after those whose middle its centre has passed, before the rest', () => {
    const its = new Map([item('a', false, 100), item('b', false, 100), item('c', false, 100), item('d', false, 100)]);
    const cols = [['a', 'b', 'c', 'd']];
    const y = (i) => i * (100 + G);
    // a, picked up and not moved: its own place
    assert.deepEqual(L.dropTarget(cols, 'a', its, 400, G, 200, 50), { col: 0, index: 0 });
    // a, dragged down: past b's middle (b now at the top, middle 50), before c's
    assert.deepEqual(L.dropTarget(cols, 'a', its, 400, G, 200, 60), { col: 0, index: 1 });
    assert.deepEqual(L.dropTarget(cols, 'a', its, 400, G, 200, y(1) + 40), { col: 0, index: 1 });
    assert.deepEqual(L.dropTarget(cols, 'a', its, 400, G, 200, y(1) + 60), { col: 0, index: 2 });
    // to the very end, and past it
    assert.deepEqual(L.dropTarget(cols, 'a', its, 400, G, 200, 5000), { col: 0, index: 3 });
    // d, dragged to the top, and above it
    assert.deepEqual(L.dropTarget(cols, 'd', its, 400, G, 200, 40), { col: 0, index: 0 });
    assert.deepEqual(L.dropTarget(cols, 'd', its, 400, G, 200, -300), { col: 0, index: 0 });
    // the answer moves on only once the middle is passed: the same point always gives the same place
    for (let cy = 0; cy < 450; cy += 7) {
      const t = L.dropTarget(cols, 'b', its, 400, G, 200, cy);
      assert.deepEqual(t, L.dropTarget(cols, 'b', its, 400, G, 200, cy));
    }
  });

  test('a dragged widget takes the column under it, and an empty column takes it at the top', () => {
    const its = new Map([item('a', false, 100), item('b', false, 100), item('c', false, 100)]);
    const cols = [['a', 'b'], ['c'], []];
    const colW = 300;
    assert.deepEqual(L.dropTarget(cols, 'a', its, colW, G, colW + G + 150, 200), { col: 1, index: 1 });
    assert.deepEqual(L.dropTarget(cols, 'a', its, colW, G, colW + G + 150, 20), { col: 1, index: 0 });
    assert.deepEqual(L.dropTarget(cols, 'a', its, colW, G, 2 * (colW + G) + 10, 500), { col: 2, index: 0 });
    // off either side: the nearest column
    assert.deepEqual(L.dropTarget(cols, 'c', its, colW, G, -80, 0).col, 0);
    assert.deepEqual(L.dropTarget(cols, 'c', its, colW, G, 5000, 0).col, 2);
  });

  test('an S tile dragged along a row of S tiles takes the side its centre is on', () => {
    const its = new Map([item('s1', true, 156), item('s2', true, 156), item('s3', true, 156), item('m', false, 100)]);
    const cols = [['s1', 's2', 'm', 's3']];
    const half = (400 - G) / 2;
    // s3 brought up to the row of s1 and s2 (y 0..156): left of s1's middle is before it, between the middles is
    // between them, past s2's middle is after both
    assert.deepEqual(L.dropTarget(cols, 's3', its, 400, G, 20, 78), { col: 0, index: 0 });
    assert.deepEqual(L.dropTarget(cols, 's3', its, 400, G, half / 2 + 20, 78), { col: 0, index: 1 });
    assert.deepEqual(L.dropTarget(cols, 's3', its, 400, G, half + G + half / 2 + 20, 78), { col: 0, index: 2 });
    // the full-width widget below goes by height, as ever
    assert.deepEqual(L.dropTarget(cols, 's3', its, 400, G, 50, 156 + G + 80), { col: 0, index: 3 });
    // and shown where it would land, the tiles pair up again around it
    const moved = L.moveInColumns(cols, 's3', 0, 1);
    const { rects } = L.layoutColumns(moved, its, 400, G);
    assert.deepEqual([rects.get('s1').x, rects.get('s3').x, rects.get('s2').x], [0, half + G, 0]);
    assert.equal(rects.get('s2').y, 156 + G);
  });
}

console.log((failed ? 'FAILED ' : 'ok ') + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
