#!/usr/bin/env node
/*
 * Checks for the progress reports' pure builders, run against the real source in Node: src/reports/build.ts (ranges,
 * every section's figures and tables, the locks and the journal-text rule, archived tools, the CSV text and the
 * printable HTML).
 * Usage: node scripts/test-report.js   (exit 1 on any failure)
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

const R = load(path.join(ROOT, 'src', 'reports', 'build.ts'));
const U = load(path.join(ROOT, 'src', 'utils.ts'));
const J = load(path.join(ROOT, 'src', 'journalCore.ts'));

let failed = 0;
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failed++; console.error('FAIL ' + name + '\n  ' + (e && e.message)); }
}

const today = U.todayKey();
const k = (n) => J.shiftKey(today, n);
const empty = () => ({
  dailyTasks: [], missions: [], doneLog: {}, habits: [], sessions: [],
  planner: { Mon: [], Tue: [], Wed: [], Thu: [], Fri: [], Sat: [], Sun: [] },
  journal: [], scores: [], scoreTags: [], notes: [],
});
const base = (src, extra) => R.buildReport(src, {
  range: R.rangeOf('30d', today), sections: R.SECTION_ORDER, journalOpen: true, notesOpen: true, today, profile: 'Asha',
  generatedAt: new Date(), ...extra,
});
const section = (rep, key) => rep.sections.find((s) => s.key === key);
const stat = (s, label) => s && (s.summary.find((x) => x.label === label) || {}).value;

// ---------- ranges ----------

test('ranges: fixed on a known day', () => {
  const t = '2026-10-26'; // a Monday
  assert.deepEqual([R.rangeOf('week', t).from, R.rangeOf('week', t).to], ['2026-10-26', '2026-10-26']);
  assert.equal(R.rangeOf('week', '2026-10-29').from, '2026-10-26');
  assert.equal(R.rangeOf('week', '2026-11-01').from, '2026-10-26', 'Sunday still belongs to the Monday before');
  assert.equal(R.rangeOf('month', t).from, '2026-10-01');
  assert.equal(R.rangeOf('month', t).label, 'October 2026');
  assert.equal(R.rangeOf('30d', t).from, '2026-09-27');
  assert.equal(R.daysIn(R.rangeOf('30d', t)).length, 30);
});

test('ranges: a history longer than the cap keeps its most recent days, not its oldest', () => {
  const t = '2026-10-26';
  const days = R.daysIn(R.rangeOf('all', t, { earliest: '2020-01-01' }));
  assert.equal(days.length, 800);
  assert.equal(days[days.length - 1], t, 'ends on today');
  assert.equal(days[0], '2024-08-18', 'and starts 799 days before it');
});

test('ranges: custom is ordered, cut at today; all and day', () => {
  const t = '2026-10-26';
  const c = R.rangeOf('custom', t, { from: '2026-12-01', to: '2026-08-01' });
  assert.deepEqual([c.from, c.to], ['2026-08-01', t]);
  assert.equal(R.rangeOf('custom', t, { from: 'bad' }).from, t);
  assert.equal(R.rangeOf('all', t, { earliest: '2026-01-05' }).from, '2026-01-05');
  assert.equal(R.rangeOf('all', t, {}).from, t);
  const d = R.rangeOf('day', t, { from: '2026-10-20' });
  assert.deepEqual([d.from, d.to], ['2026-10-20', '2026-10-20']);
  assert.equal(R.fmtDay('2026-10-26'), 'Mon 26 Oct');
  assert.equal(R.fmtSpan('2026-10-01', '2026-10-26'), '1 to 26 Oct 2026');
  assert.equal(R.fmtSpan('2025-12-30', '2026-01-02'), '30 Dec 2025 to 2 Jan 2026');
  const m = R.monthRange('2026-10', '2026-10-26');
  assert.deepEqual([m.from, m.to], ['2026-10-01', '2026-10-26']);
  assert.equal(R.monthRange('2026-09', '2026-10-26').to, '2026-09-30');
});

test('formats: minutes', () => {
  assert.equal(R.fmtMin(45), '45 min');
  assert.equal(R.fmtMin(120), '2 h');
  assert.equal(R.fmtMin(200), '3 h 20 min');
});

// ---------- sections ----------

test('tasks: only days in range count, missions listed with status', () => {
  const src = empty();
  src.doneLog[k(0)] = { todos: [{ id: 'a', title: 'Read ch 3' }, { id: 'b', title: 'Lab sheet' }], tasks: [{ id: 'm', title: 'Essay' }] };
  src.doneLog[k(-5)] = { todos: [{ id: 'c', title: 'Flashcards' }] };
  src.doneLog[k(-60)] = { todos: [{ id: 'd', title: 'Old one' }] };
  src.missions = [
    { id: 'm1', title: 'Project', deadline: k(-2), done: false, subtasks: [{ id: 's', title: 'x', done: true }, { id: 't', title: 'y', done: false }] },
    { id: 'm2', title: 'Essay', deadline: k(3), done: true, doneOn: k(0), subtasks: [] },
    { id: 'm3', title: 'Ancient', deadline: k(-200), done: true, doneOn: k(-190), subtasks: [] },
  ];
  const s = section(base(src), 'tasks');
  assert.equal(stat(s, 'ToDos done'), '3');
  assert.equal(stat(s, 'Long-term tasks done'), '1');
  const ticked = s.blocks.find((b) => b.t === 'table' && b.title === 'What was ticked');
  assert.equal(ticked.rows.length, 4);
  assert.ok(!ticked.rows.some((r) => r[1] === 'Old one'));
  const lt = s.blocks.find((b) => b.t === 'table' && b.title === 'Long-term tasks');
  assert.deepEqual(lt.rows.map((r) => r[0]), ['Project', 'Essay']);
  assert.equal(lt.rows[0][3], 'Overdue');
  assert.equal(lt.rows[0][2], '1 of 2');
  const bars = s.blocks.find((b) => b.t === 'bars');
  assert.equal(bars.values.length, 30);
  assert.equal(bars.values[29], 3);
});

test('tasks: a long range is charted by week', () => {
  const src = empty();
  src.doneLog[k(0)] = { todos: [{ id: 'a', title: 'x' }] };
  const rep = R.buildReport(src, { range: R.rangeOf('custom', today, { from: k(-120), to: today }), sections: ['tasks'], journalOpen: true, notesOpen: true, today });
  const bars = section(rep, 'tasks').blocks.find((b) => b.t === 'bars');
  assert.ok(bars.values.length <= 19 && bars.values.length >= 17, 'about 18 weeks, got ' + bars.values.length);
  assert.equal(bars.values.reduce((a, v) => a + v, 0), 1);
  assert.match(bars.title, /week/);
});

test('habits: due, rest and done days; grid capped at 35 days', () => {
  const src = empty();
  // due every day; done today and yesterday, missed the day before
  src.habits = [{ id: 'h_1', title: 'Read', doneDates: [k(0), k(-1)] }];
  const s = section(base(src), 'habits');
  const grid = s.blocks.find((b) => b.t === 'grid');
  assert.equal(grid.days.length, 30);
  const cells = grid.rows[0].cells;
  assert.equal(cells[29], 'done');
  assert.equal(cells[28], 'done');
  assert.equal(cells[27], 'missed');
  const table = s.blocks.find((b) => b.t === 'table');
  assert.deepEqual(table.rows[0].slice(0, 4), ['Read', '2', '30', '7%']);
  assert.equal(table.rows[0][4], '2');
  const long = R.buildReport(src, { range: R.rangeOf('custom', today, { from: k(-99), to: today }), sections: ['habits'], journalOpen: true, notesOpen: true, today });
  assert.equal(section(long, 'habits').blocks.find((b) => b.t === 'grid').days.length, 35);
});

test('habits: a weekday habit rests on its other days', () => {
  const src = empty();
  const wd = (new Date().getDay() + 6) % 7;
  src.habits = [{ id: 'h_2', title: 'Gym', doneDates: [], days: [wd] }];
  const rep = R.buildReport(src, { range: R.rangeOf('custom', today, { from: k(-6), to: today }), sections: ['habits'], journalOpen: true, notesOpen: true, today });
  const cells = section(rep, 'habits').blocks.find((b) => b.t === 'grid').rows[0].cells;
  // today is its day and not ticked yet: not missed until the day is over
  assert.equal(cells.filter((c) => c === 'missed').length, 0);
  assert.equal(cells.filter((c) => c === 'ahead').length, 1);
  assert.equal(cells.filter((c) => c === 'rest').length, 6);
});

test('habits: a tick on a rest day is done but is not a day kept', () => {
  const src = empty();
  const day = '2026-10-28'; // a Wednesday
  // due Monday and Wednesday; ticked on Saturday and Sunday (rest days) and on Monday the 26th only
  src.habits = [{ id: 'h_3', title: 'Read', doneDates: ['2026-10-24', '2026-10-25', '2026-10-26'], days: [0, 2] }];
  const rep = R.buildReport(src, { range: R.rangeOf('custom', day, { from: '2026-10-19', to: day }), sections: ['habits'], journalOpen: true, notesOpen: true, today: day });
  const s = section(rep, 'habits');
  // due: Mon 19, Wed 21, Mon 26 (kept) and Wed 28, which is today and not over
  assert.deepEqual(s.blocks.find((b) => b.t === 'table').rows[0].slice(0, 4), ['Read', '3', '3', '33%']);
  assert.equal(stat(s, 'Kept'), '33% of due days');
});

test('focus: totals, by subject, and one subject only', () => {
  const src = empty();
  src.sessions = [
    { id: '1', dateKey: k(0), endedAt: 1, netSeconds: 3000, taskTitles: ['Ch 4'], subject: 'Physics' },
    { id: '2', dateKey: k(-1), endedAt: 2, netSeconds: 1800, taskTitles: [], subject: ' physics ' },
    { id: '3', dateKey: k(-2), endedAt: 3, netSeconds: 2400, taskTitles: [], subject: 'Chemistry', manual: true },
    { id: '4', dateKey: k(-40), endedAt: 4, netSeconds: 9999, taskTitles: [], subject: 'Physics' },
  ];
  const s = section(base(src), 'focus');
  assert.equal(stat(s, 'Focused'), '2 h');
  assert.equal(stat(s, 'Sessions'), '3');
  assert.equal(stat(s, 'Most time on'), 'Physics');
  const by = s.blocks.find((b) => b.t === 'table' && b.title === 'By subject');
  assert.deepEqual(by.rows[0], ['Physics', '1 h 20 min', '2', '67%']);
  const every = s.blocks.find((b) => b.title === 'Every session');
  assert.ok(every.rows.some((r) => r[2] === '40 (logged)'));
  const only = section(base(src, { subject: 'PHYSICS', sections: ['focus'] }), 'focus');
  assert.equal(stat(only, 'Sessions'), '2');
  assert.ok(!only.blocks.some((b) => b.title === 'By subject'));
});

test('planner: the week in order and hours by subject', () => {
  const src = empty();
  src.planner.Mon = [{ id: 'b', subject: 'Maths', start: '10:00', end: '11:30', color: '' }, { id: 'a', subject: 'Physics', start: '08:00', end: '09:00', color: '' }];
  src.planner.Wed = [{ id: 'c', subject: 'Maths', start: '14:00', end: '15:00', color: '' }];
  const s = section(base(src), 'planner');
  assert.equal(stat(s, 'Blocks a week'), '3');
  assert.equal(stat(s, 'Planned'), '3 h 30 min a week');
  const wk = s.blocks.find((b) => b.title === 'The week');
  assert.deepEqual(wk.rows.map((r) => r[2]), ['Physics', 'Maths', 'Maths']);
  const by = s.blocks.find((b) => b.title === 'Planned by subject');
  assert.deepEqual(by.rows[0], ['Maths', '2 h 30 min', '71%']);
});

const entry = (id, dateKey, extra) => ({
  id, dateKey, title: 'Secret title ' + id, excerpt: 'secret excerpt ' + id, tags: [], wordCount: 120, pinned: false,
  createdAt: 1, updatedAt: 1, ...extra,
});

test('journal: locked is left out; open shows moods and counts but never words unless given', () => {
  const src = empty();
  src.journal = [entry('e1', k(0), { mood: 4, rating: 5 }), entry('e2', k(-3), { mood: 2 }), entry('e3', k(-90), { mood: 1 })];
  const locked = base(src, { journalOpen: false });
  const ls = section(locked, 'journal');
  assert.equal(ls.blocks.length, 1);
  assert.equal(ls.blocks[0].t, 'note');
  const lockedText = R.reportHtml(locked) + R.reportCsv(locked);
  assert.ok(!/secret/i.test(lockedText));
  assert.ok(!section(locked, 'overview').summary.some((x) => x.label === 'Journal entries'));

  const open = base(src);
  const os = section(open, 'journal');
  assert.equal(stat(os, 'Entries'), '2');
  assert.equal(stat(os, 'Words'), '240');
  assert.equal(stat(os, 'Usual mood'), 'Okay');
  assert.ok(os.blocks.some((b) => b.t === 'strip'));
  const text = R.reportHtml(open) + R.reportCsv(open);
  assert.ok(!/secret/i.test(text), 'no titles or texts without the tick');
  assert.equal(section(open, 'overview').summary.find((x) => x.label === 'Journal entries').value, '2');

  const withText = base(src, { journalText: new Map([['e1', 'Dear diary <b>today</b>'], ['e2', '']]) });
  const html = R.reportHtml(withText);
  assert.ok(html.includes('Dear diary &lt;b&gt;today&lt;/b&gt;'));
  assert.ok(html.includes('Secret title e1'));
  assert.ok(!html.includes('e3'), 'an entry outside the range stays out');
});

test('notes: locked tool, locked note, open note', () => {
  const src = empty();
  const now = Date.now();
  src.notes = [
    { id: 'n1', title: 'Optics', body: 'b', folder: 'Physics', tags: [], pinned: false, createdAt: now, updatedAt: now, attachments: [], subject: 'Physics' },
    { id: 'n2', title: 'Private plan', body: 'b', folder: 'Notes', tags: [], pinned: false, createdAt: now, updatedAt: now, attachments: [], locked: true },
  ];
  const shut = section(base(src, { notesOpen: false }), 'notes');
  assert.equal(shut.blocks[0].t, 'note');
  const open = base(src);
  const os = section(open, 'notes');
  assert.equal(stat(os, 'Notes'), '1');
  assert.ok(os.blocks.some((b) => b.t === 'note' && /1 locked note/.test(b.text)));
  assert.ok(!R.reportHtml(open).includes('Private plan'));
  const unlocked = section(base(src, { noteOpen: (id) => id === 'n2' }), 'notes');
  assert.equal(stat(unlocked, 'Notes'), '2');
  const subj = section(base(src, { subject: 'physics', noteOpen: () => true }), 'notes');
  assert.equal(stat(subj, 'Notes'), '1');
});

test('scores: exams in range, one exam, one subject', () => {
  const src = empty();
  src.scores = [
    { id: 'x1', parentId: null, kind: 'exam', title: 'Mock 1', date: k(-20), createdAt: 1, updatedAt: 1 },
    { id: 'x1p', parentId: 'x1', kind: 'exam', title: 'Physics', score: 30, outOf: 50, createdAt: 1, updatedAt: 1 },
    { id: 'x1c', parentId: 'x1', kind: 'exam', title: 'Chemistry', score: 40, outOf: 50, createdAt: 1, updatedAt: 1 },
    { id: 'x2', parentId: null, kind: 'exam', title: 'Mock 2', date: k(-2), createdAt: 2, updatedAt: 2 },
    { id: 'x2p', parentId: 'x2', kind: 'exam', title: 'physics', score: 45, outOf: 50, createdAt: 2, updatedAt: 2 },
    { id: 'x0', parentId: null, kind: 'exam', title: 'Old test', date: k(-100), score: 5, outOf: 10, createdAt: 0, updatedAt: 0 },
  ];
  const s = section(base(src), 'scores');
  assert.equal(stat(s, 'Exams'), '2');
  assert.equal(stat(s, 'Latest'), '90%');
  const each = s.blocks.find((b) => b.title === 'Each exam');
  assert.deepEqual(each.rows.map((r) => r[1]), ['Mock 1', 'Mock 2']);
  assert.equal(each.rows[1][4], '+20');
  assert.ok(s.blocks.some((b) => b.t === 'line'));
  assert.ok(s.blocks.some((b) => b.title === 'By subject'));

  const one = section(base(src, { examId: 'x1', sections: ['scores'] }), 'scores');
  assert.equal(one.title, 'Mock 1');
  assert.deepEqual(one.blocks.find((b) => b.title === 'Subjects').rows[0], ['Physics', '30 / 50', '60%']);

  const subj = section(base(src, { subject: 'Physics', sections: ['scores'] }), 'scores');
  assert.equal(stat(subj, 'Results'), '2');
  assert.equal(stat(subj, 'Average'), '75%');

  const view = section(base(src, { examIds: ['x0', 'x2'], scopeLabel: 'All exams', sections: ['scores'] }), 'scores');
  assert.equal(stat(view, 'Exams'), '2', 'the exams in view, whatever their date');
});

test('archived tools drop their sections; the overview skips them', () => {
  const src = empty();
  src.sessions = [{ id: '1', dateKey: today, endedAt: 1, netSeconds: 600, taskTitles: [] }];
  const rep = base(src, { archived: ['focus', 'planner'] });
  assert.ok(!section(rep, 'focus'));
  assert.ok(!section(rep, 'habits'));
  assert.ok(!section(rep, 'planner'));
  assert.ok(!section(rep, 'overview').summary.some((x) => x.label === 'Deep Work'));
  assert.deepEqual(R.availableSections(['journal']).includes('journal'), false);
  const only = R.buildReport(src, { range: R.rangeOf('30d', today), sections: ['overview'], journalOpen: true, notesOpen: true, today });
  assert.deepEqual(only.sections.map((x) => x.key), ['overview']);
  assert.equal(section(only, 'overview').summary.find((x) => x.label === 'Deep Work').value, '10 min');
});

test('earliest day across the data', () => {
  const src = empty();
  src.sessions = [{ id: '1', dateKey: '2025-03-04', endedAt: 1, netSeconds: 60, taskTitles: [] }];
  src.journal = [entry('j', '2025-01-02')];
  assert.equal(R.earliestKey(src, today), '2025-01-02');
  assert.equal(R.earliestKey(empty(), today), today);
});

// ---------- the files ----------

test('csv: cells, formulas defused, BOM, every table', () => {
  assert.equal(R.csvCell('a,b'), '"a,b"');
  assert.equal(R.csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(R.csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(R.csvCell('-5'), '-5');
  assert.equal(R.csvCell(null), '');
  const src = empty();
  src.doneLog[today] = { todos: [{ id: 'a', title: 'Read, then write' }] };
  const csv = R.reportCsv(base(src, { sections: ['tasks'] }));
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.ok(csv.includes('"Read, then write"'));
  assert.ok(csv.includes('ToDos and long-term tasks: What was ticked'));
  assert.ok(csv.includes('\r\n'));
});

test('html: A4, page breaks, wordmark, profile, escaped', () => {
  const src = empty();
  src.doneLog[today] = { todos: [{ id: 'a', title: '<script>alert(1)</script>' }] };
  const rep = base(src, { profile: 'Asha & co' });
  const html = R.reportHtml(rep);
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('size: A4'));
  assert.ok(html.includes('Sturoids'));
  assert.ok(html.includes('Asha &amp; co'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.equal((html.match(/class="next"/g) || []).length, rep.sections.length - 1);
  assert.ok(html.includes('<svg'));
  assert.ok(html.includes('Inter+Tight') && html.includes('Source+Serif+4') && html.includes('Schibsted+Grotesk'));
  assert.ok(/font-family: 'Inter Tight', -apple-system/.test(html), 'system fallbacks');
});

test('file names', () => {
  assert.equal(R.fileSafe('a/b:c*?'), 'a b c');
  assert.equal(R.fileSafe(''), 'Sturoids report');
  const rep = R.buildReport(empty(), { range: R.rangeOf('month', '2026-10-26'), sections: ['overview'], journalOpen: true, notesOpen: true, today: '2026-10-26' });
  assert.equal(R.reportFileName(rep), 'Sturoids progress report 1 to 26 Oct 2026');
});

test('an empty profile still builds every section', () => {
  const rep = base(empty());
  assert.equal(rep.sections.length, R.SECTION_ORDER.length);
  for (const s of rep.sections) if (s.key !== 'overview') assert.ok(s.empty || s.blocks.length, s.key);
  assert.ok(R.reportHtml(rep).length > 1000);
});


// ---------- single summaries (one summary, one range: never only the all-in-one report) ----------

test('ranges: last week is the Monday to Sunday before this one', () => {
  const lw = R.rangeOf('lastweek', '2026-10-28'); // a Wednesday
  assert.deepEqual([lw.from, lw.to], ['2026-10-19', '2026-10-25']);
  assert.equal(R.daysIn(lw).length, 7);
  assert.ok(lw.label.startsWith('Last week'));
  const fromMon = R.rangeOf('lastweek', '2026-10-26');
  assert.deepEqual([fromMon.from, fromMon.to], ['2026-10-19', '2026-10-25']);
});

test('single summaries: ToDos and long-term tasks each on their own', () => {
  const src = empty();
  src.doneLog[k(0)] = { todos: [{ id: 'a', title: 'Read ch 3' }], tasks: [{ id: 'm', title: 'Essay' }] };
  src.missions = [{ id: 'm1', title: 'Project', deadline: k(-2), done: false, subtasks: [] }];
  const todos = base(src, { sections: ['todos'] });
  assert.deepEqual(todos.sections.map((s) => s.key), ['todos']);
  const t = todos.sections[0];
  assert.equal(stat(t, 'ToDos done'), '1');
  assert.equal(stat(t, 'Long-term tasks done'), undefined);
  assert.ok(!t.blocks.some((b) => b.t === 'table' && b.title === 'Long-term tasks'));
  assert.deepEqual(t.blocks.find((b) => b.title === 'What was ticked').columns, ['Day', 'Item']);
  const lt = base(src, { sections: ['longterm'] }).sections[0];
  assert.equal(lt.key, 'longterm');
  assert.equal(stat(lt, 'Long-term tasks done'), '1');
  assert.equal(stat(lt, 'ToDos done'), undefined);
  assert.ok(lt.blocks.some((b) => b.t === 'table' && b.title === 'Long-term tasks'));
  // the full report keeps the combined section and never the halves
  const full = base(src);
  assert.ok(full.sections.some((s) => s.key === 'tasks'));
  assert.ok(!full.sections.some((s) => s.key === 'todos' || s.key === 'longterm'));
  // an archived Tasks tool takes its halves with it
  assert.equal(base(src, { sections: ['todos'], archived: ['tasks'] }).sections.length, 0);
});

test('single summaries: one section per file, no part numbers, its own name', () => {
  const src = empty();
  src.habits = [{ id: 'h', title: 'Read', doneDates: [k(0)], createdAt: Date.now() - 864e5 * 40 }];
  const rep = base(src, { sections: ['habits'], title: 'Habits summary' });
  assert.equal(rep.sections.length, 1);
  const html = R.reportHtml(rep);
  assert.ok(html.includes('Habits summary'));
  assert.ok(!html.includes('class="kicker">01'), 'a single summary carries no part numbers');
  assert.ok(R.reportHtml(base(src)).includes('class="kicker">01'), 'the full report numbers its parts');
  assert.equal(R.reportFileName(R.buildReport(src, { range: R.rangeOf('lastweek', '2026-10-28'), sections: ['habits'], title: 'Habits summary', journalOpen: true, notesOpen: true, today: '2026-10-28' })),
    'Sturoids habits summary 19 to 25 Oct 2026');
});

console.log(failed ? `test-report: ${failed} failed, ${passed} passed` : `test-report: all ${passed} passed`);
process.exit(failed ? 1 : 0);
