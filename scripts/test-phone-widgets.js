#!/usr/bin/env node
/*
 * Checks for the phone's home-screen widgets, run against the real source in Node: src/widgets/phone/model.ts (the
 * rows cleaned, the gates for archived and locked tools, the links, every widget's model) and
 * src/widgets/phone/widgets.tsx (every widget builds a full tree, for an empty install and a busy day, in each size,
 * with every tap a link the app reads). The widget library is stood in for by components that only carry their props.
 * Usage: node scripts/test-phone-widgets.js   (exit 1 on any failure)
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { createRequire } = require('module');

const ROOT = path.join(__dirname, '..');
const projectRequire = createRequire(path.join(ROOT, 'package.json'));
const ts = projectRequire('typescript');
const React = projectRequire('react');

/** the widget library: each component a named stand-in, as its own buildWidgetTree reads them */
const WIDGETS = ['FlexWidget', 'TextWidget', 'SvgWidget', 'ImageWidget', 'OverlapWidget', 'IconWidget', 'ListWidget'];
const widgetLib = {};
for (const n of WIDGETS) {
  const C = () => null;
  C.__name__ = n;
  C.convertProps = (p) => p;
  widgetLib[n] = C;
}

function load(file) {
  const registry = new Map();
  const go = (f) => {
    if (registry.has(f)) return registry.get(f).exports;
    const { outputText } = ts.transpileModule(fs.readFileSync(f, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, jsx: ts.JsxEmit.React,
      },
      fileName: f,
    });
    const mod = { exports: {} };
    registry.set(f, mod);
    const req = (spec) => {
      if (spec === 'react-native-android-widget') return widgetLib;
      if (spec.startsWith('.')) {
        const base = path.resolve(path.dirname(f), spec);
        const hit = [base + '.ts', base + '.tsx', path.join(base, 'index.ts')].find((p) => fs.existsSync(p));
        if (!hit) throw new Error('cannot resolve ' + spec + ' from ' + f);
        return go(hit);
      }
      return projectRequire(spec);
    };
    new Function('require', 'module', 'exports', outputText)(req, mod, mod.exports);
    return mod.exports;
  };
  return go(file);
}

const model = load(path.join(ROOT, 'src', 'widgets', 'phone', 'model.ts'));
const widgets = load(path.join(ROOT, 'src', 'widgets', 'phone', 'widgets.tsx'));
const links = load(path.join(ROOT, 'src', 'appLinks.ts'));
const calc = load(path.join(ROOT, 'src', 'widgets', 'phone', 'calc.ts'));

let failed = 0;
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failed++; console.error('FAIL', name, '\n ', e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n  ') : e); }
}

/** the library's own walk (build-widget-tree.ts): a custom component is called until a library one comes back */
function build(el) {
  assert.ok(el && typeof el === 'object', 'a component returned ' + el + ' (the library cannot build from nothing)');
  while (!el.type.__name__) {
    el = el.type(el.props);
    assert.ok(el && typeof el === 'object', 'a component returned ' + el);
  }
  const { children, ...props } = el.props;
  const kids = (children ? (Array.isArray(children) ? children : [children]) : []).flat(2).filter((x) => !!x);
  for (const k of kids) assert.ok(typeof k === 'object', el.type.__name__ + ' has a bare text child: ' + JSON.stringify(k));
  return { type: el.type.__name__, props, children: kids.map(build) };
}

function walk(tree, fn) {
  fn(tree);
  for (const c of tree.children) walk(c, fn);
}

/** every check a built widget must pass */
function checkTree(tree, label) {
  assert.equal(tree.type, 'FlexWidget', label + ': the root is a FlexWidget');
  assert.equal(tree.props.style.width, 'match_parent', label + ': the root fills the widget');
  walk(tree, (n) => {
    if (n.props.clickAction === 'OPEN_URI') {
      const uri = n.props.clickActionData && n.props.clickActionData.uri;
      assert.ok(typeof uri === 'string' && uri, label + ': a tap with no link');
      if (uri.startsWith('sturoids:')) assert.ok(links.parseAppLink(uri), label + ': the app cannot read ' + uri);
      else assert.match(uri, /^https?:\/\//, label + ': ' + uri);
    } else if (n.props.clickAction === 'CALC') {
      assert.ok(calc.isCalcKey(n.props.clickActionData && n.props.clickActionData.key), label + ': a key the pad does not know');
    } else if (n.props.clickAction) {
      assert.equal(n.props.clickAction, 'OPEN_APP', label + ': an unknown tap ' + n.props.clickAction);
    }
    if (n.type === 'TextWidget') {
      assert.equal(typeof n.props.text, 'string', label + ': text that is not a string');
      assert.ok(!/undefined|NaN|null|\[object/.test(n.props.text), label + ': text reads "' + n.props.text + '"');
      const st = n.props.style;
      assert.ok(st.fontFamily, label + ': text with no face');
      assert.ok(Number.isInteger(st.fontSize) && st.fontSize >= 11, label + ': text at ' + st.fontSize);
      assert.ok(!('fontWeight' in st), label + ': a weight with a face');
    }
    if (n.type === 'SvgWidget') {
      assert.ok(typeof n.props.svg === 'string' && n.props.svg.startsWith('<svg'), label + ': an svg that is not one');
      assert.ok(!/NaN|undefined/.test(n.props.svg), label + ': an svg with NaN');
      assert.ok(n.props.style.width > 0 && n.props.style.height > 0, label + ': an svg with no size');
    }
    for (const k of ['backgroundColor', 'borderColor', 'color']) {
      const v = n.props.style && n.props.style[k];
      if (v !== undefined) assert.match(v, /^(#[0-9a-fA-F]{6}|rgba\(\d+, \d+, \d+, [\d.]+\))$/, label + ': ' + k + ' ' + v);
    }
  });
}

/* ---------------------------------------------------------------- data */

const NOW = new Date(2026, 9, 26, 15, 20); // Monday 26 Oct 2026, 3:20 pm
const TODAY = '2026-10-26';
const key = (d) => {
  const x = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + d);
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
};

function busyRows(over = {}) {
  return {
    settings: {
      name: 'Sanjay Murthy', theme: 'default', accent: '#9AD6B0', hour24: false, notesLocked: false, journalLocked: false,
      archivedTools: ['desmos'], tabSlots: ['tasks', 'focus', 'planner'], focusLastMin: 45, focusGoalMin: 120,
      journalCutoffHour: 3, journalPromptsOn: true, journalWordGoal: 300,
      ...(over.settings || {}),
    },
    dailyTasks: [
      { id: 't1', title: 'Physics sheet', doneOn: null, createdAt: 1, time: '17:00' },
      { id: 't2', title: 'Read chapter 4', doneOn: TODAY, createdAt: 2 },
      { id: 't3', title: 'Revise vectors', doneOn: null, createdAt: 3, repeat: 'daily' },
      { id: 't4', title: 'Mon only', doneOn: null, createdAt: 4, repeat: 'daily', days: [0] },
      { id: 't5', title: 'Tue only', doneOn: null, createdAt: 5, repeat: 'daily', days: [1] },
    ],
    missions: [
      { id: 'm1', title: 'Lab report', deadline: key(2), done: false, subtasks: [{ id: 's1', title: 'a', done: true }, { id: 's2', title: 'b', done: false }] },
      { id: 'm2', title: 'Late essay', deadline: key(-1), done: false, subtasks: [] },
      { id: 'm3', title: 'Done long ago', deadline: key(-9), done: true, doneOn: key(-9), subtasks: [] },
    ],
    sessions: [
      { id: 'f1', dateKey: TODAY, endedAt: 1, netSeconds: 50 * 60, taskTitles: [], subject: 'Physics' },
      { id: 'f2', dateKey: key(-1), endedAt: 1, netSeconds: 125 * 60, taskTitles: [], subject: 'Maths' },
      { id: 'f3', dateKey: key(-2), endedAt: 1, netSeconds: 30 * 60, taskTitles: [] },
    ],
    planner: {
      Mon: [
        { id: 'b1', subject: 'Physics', start: '15:00', end: '16:00', color: 'teal' },
        { id: 'b2', subject: 'Chemistry', start: '16:30', end: '17:30', color: '#E39EAC' },
        { id: 'b0', subject: 'Morning run', start: '07:00', end: '07:30', color: 'bogus' },
      ],
      Tue: [{ id: 'b3', subject: 'Maths', start: '09:00', end: '10:00', color: 'amber' }],
    },
    habits: [
      { id: 'h1', title: 'Water', doneDates: [key(-3), key(-2), key(-1)] },
      { id: 'h2', title: 'Walk', doneDates: [TODAY, key(-1)], days: [0, 2, 4] },
    ],
    notes: [
      { id: 'n1', title: 'Optics', body: 'Snell law\nn1 sin a = n2 sin b', folder: 'Physics', tags: [], pinned: true, createdAt: 1, updatedAt: NOW.getTime() - 3600e3, attachments: [] },
      { id: 'n2', title: '', body: 'Secret plans\nhidden', folder: 'General', tags: [], pinned: true, createdAt: 1, updatedAt: NOW.getTime() - 86400e3 * 3, attachments: [], locked: true },
    ],
    journal: [
      { id: 'j1', dateKey: key(-1), title: 'A good day', excerpt: 'Finished the sheet', mood: 4, rating: 5, tags: [], wordCount: 120, pinned: false, createdAt: 1, updatedAt: 1 },
      { id: 'j2', dateKey: '2025-10-26', title: '', excerpt: 'A year back', mood: 2, tags: [], wordCount: 40, pinned: false, createdAt: 1, updatedAt: 1 },
    ],
    scores: [
      { id: 'e1', parentId: null, kind: 'exam', title: 'Mid-term', date: key(-20), createdAt: 1, updatedAt: 1 },
      { id: 'e1p', parentId: 'e1', kind: 'exam', title: 'Physics', score: 40, outOf: 50, createdAt: 1, updatedAt: 1 },
      { id: 'e2', parentId: null, kind: 'exam', title: 'Unit test', date: key(-5), createdAt: 2, updatedAt: 2 },
      { id: 'e2p', parentId: 'e2', kind: 'exam', title: 'Physics', score: 45, outOf: 50, createdAt: 2, updatedAt: 2 },
      { id: 'e3', parentId: null, kind: 'exam', title: 'Chem mock', date: key(4), createdAt: 3, updatedAt: 3 },
      { id: 'e4', parentId: null, kind: 'exam', title: 'Bio quiz', date: TODAY, createdAt: 3, updatedAt: 3 },
    ],
    vaultVideos: [
      { id: 'v1', videoId: 'abc123', url: 'https://youtu.be/abc123', title: 'Optics lecture', folderId: null, tags: [], addedAt: 1, notes: [], bookmarks: [], resumeAt: 754, openedAt: 5 },
      { id: 'v2', videoId: 'def456', url: 'https://youtu.be/def456', title: '', folderId: null, tags: [], addedAt: 2, notes: [], bookmarks: [] },
    ],
    aiLinks: [
      { id: 'a1', label: 'Claude', url: 'https://claude.ai' },
      { id: 'a2', label: 'ChatGPT', url: 'https://chatgpt.com' },
      { id: 'a3', label: '', url: 'https://www.perplexity.ai/search' },
      { id: 'bad', label: 'Bad', url: 'javascript:alert(1)' },
    ],
    deepWork: {
      mode: 'countdown', targetMin: 50, running: true, startTs: NOW.getTime() - 20 * 60e3, accumSec: 5 * 60,
      startedAt: NOW.getTime() - 30 * 60e3, subject: 'Physics', attached: [], finishAt: null,
    },
    ...over.rows,
  };
}

const busy = () => model.cleanData(busyRows());
const empty = () => model.cleanData({});
const BOXES = [{ width: 110, height: 110 }, { width: 180, height: 180 }, { width: 250, height: 110 }, { width: 360, height: 180 }, { width: 320, height: 320 }];

/* ---------------------------------------------------------------- the list */

test('every widget in app.json has a model and a drawing, and the reverse', () => {
  const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
  const entry = app.expo.plugins.find((p) => Array.isArray(p) && p[0] === 'react-native-android-widget');
  assert.ok(entry, 'the widget plugin is in app.json');
  const names = entry[1].widgets.map((w) => w.name).sort();
  assert.deepEqual(names, [...model.PHONE_WIDGET_NAMES].sort());
  assert.equal(names.length, 28);
  for (const w of entry[1].widgets) {
    // the Calculator draws only when a key is pressed (and with the app's look): it asks for no updates at all
    if (w.name === 'Calculator') assert.equal(w.updatePeriodMillis, 0);
    else assert.ok(w.updatePeriodMillis >= 1800000, w.name + ' asks for updates more often than Android allows');
  }
});

test('the widget fonts in app.json are the faces the widgets use', () => {
  const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
  const entry = app.expo.plugins.find((p) => Array.isArray(p) && p[0] === 'react-native-android-widget');
  const bundled = new Set(entry[1].fonts.map((f) => path.basename(f, '.ttf')));
  for (const f of entry[1].fonts) assert.ok(fs.existsSync(path.join(ROOT, f)), f + ' is not on disk');
  const src = fs.readFileSync(path.join(ROOT, 'src', 'widgets', 'phone', 'widgets.tsx'), 'utf8');
  const faces = [...src.matchAll(/'((?:InterTight|SchibstedGrotesk|SourceSerif4)_[A-Za-z0-9]+)'/g)].map((m) => m[1]);
  assert.ok(faces.length >= 5);
  for (const f of faces) assert.ok(bundled.has(f), f + ' is used but not bundled for the widgets');
});

test('the library is pinned to 0.17.2 and the entry registers the handler', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies['react-native-android-widget'], '0.17.2');
  assert.equal(pkg.main, 'index.js');
  const entry = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
  assert.match(entry, /expo-router\/entry/);
  assert.match(entry, /bootPhoneWidgets\(\)/);
});

test('the task handler and its reader never load the store', () => {
  for (const f of ['handler.tsx', 'rows.ts', 'model.ts', 'widgets.tsx', 'boot.ts']) {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'widgets', 'phone', f), 'utf8');
    for (const m of src.matchAll(/(?:^|\n)\s*import\s+(type\s+)?[^;]*?from\s+'([^']+)'/g)) {
      if (/store'?$/.test(m[2]) && !/\.\.\/\.\.\/store$/.test(m[2])) continue;
      if (m[2] === '../../store') assert.ok(m[1], f + ' imports the store at run time');
    }
    assert.ok(!/require\('\.\.\/\.\.\/store'\)/.test(src), f + ' requires the store');
  }
});

/* ---------------------------------------------------------------- cleaning */

test('missing and malformed rows read as a fresh install', () => {
  const d = model.cleanData({ settings: 'junk', dailyTasks: [null, 5, { title: 'no id' }], planner: { Mon: [{ id: 'x', start: 'bad', end: '10:00' }] }, deepWork: 7 });
  assert.deepEqual(d.dailyTasks, []);
  assert.deepEqual(d.planner.Mon, []);
  assert.equal(d.deepWork, null);
  assert.equal(d.settings.accent, '#9588F9');
  assert.deepEqual(d.settings.archivedTools, ['desmos', 'ai']);
  assert.equal(d.settings.focusLastMin, 50);
});

test('AI links keep only web links', () => {
  assert.deepEqual(busy().aiLinks.map((l) => l.id), ['a1', 'a2', 'a3']);
});

/* ---------------------------------------------------------------- gates */

test('an archived tool hides its widgets, a tool in a tab slot never counts as archived', () => {
  const d = model.cleanData(busyRows({ settings: { archivedTools: ['scores', 'ai', 'tasks'] } }));
  assert.equal(model.gateOf('Countdown', d).kind, 'archived');
  assert.equal(model.gateOf('AiDock', d).kind, 'archived');
  assert.equal(model.gateOf('NextUp', d), null, 'tasks is in a tab slot');
  assert.equal(model.gateOf('DayRing', d), null);
  // the app's own widgets leave the archived tool's things out
  assert.ok(!model.agendaModel(d, NOW).rows.some((r) => r.kind === 'exam'));
  assert.ok(model.agendaModel(busy(), NOW).rows.some((r) => r.kind === 'exam'));
});

test('locked Notes and Journal draw nothing of theirs', () => {
  const d = model.cleanData(busyRows({ settings: { notesLocked: true, journalLocked: true } }));
  for (const n of ['NewNote', 'Pinned', 'RecentNotes', 'WriteToday', 'MoodStrip', 'OnThisDay']) {
    const g = model.gateOf(n, d);
    assert.equal(g && g.kind, 'locked', n);
    const tree = build(widgets.renderPhoneWidget(n, d, BOXES[3], NOW));
    const texts = [];
    walk(tree, (x) => x.type === 'TextWidget' && texts.push(x.props.text));
    assert.ok(!texts.some((t) => /Optics|good day|year back|Snell/.test(t)), n + ' shows locked content: ' + texts.join(' | '));
  }
});

test('a single locked note shows its name, never its words', () => {
  const rows = model.pinnedModel(busy(), NOW).rows;
  const locked = rows.find((r) => r.id === 'n2');
  assert.equal(locked.excerpt, 'Locked');
  assert.ok(!/hidden/.test(JSON.stringify(locked)));
});

test('a locked note never shows the first line of its words as a name', () => {
  const rows = model.pinnedModel(busy(), NOW).rows;
  assert.equal(rows.find((r) => r.id === 'n2').title, 'Locked note');
  assert.equal(model.recentNotesModel(busy(), NOW).rows.find((r) => r.id === 'n2').title, 'Locked note');
  const only = model.cleanData({ notes: [{ id: 'n2', title: '', body: 'Secret plans', locked: true, updatedAt: 5 }] });
  assert.equal(model.newNoteModel(only, NOW).last.title, 'Locked note');
  const named = model.cleanData({ notes: [{ id: 'n3', title: 'Chem', body: 'x', locked: true, updatedAt: 5 }] });
  assert.equal(model.newNoteModel(named, NOW).last.title, 'Chem');
});

test("Today's blocks: the next one is the first still to begin, none once the day is over", () => {
  const d = model.cleanData({ planner: { Mon: [
    { id: 'p1', subject: 'Physics', start: '09:00', end: '10:30', color: 'teal' },
    { id: 'p2', subject: 'Maths', start: '11:00', end: '12:00', color: 'teal' },
  ] } });
  const at = (h, m) => model.todaysBlocksModel(d, new Date(2026, 9, 26, h, m));
  assert.equal(at(7, 0).nextId, 'p1');
  assert.equal(at(9, 30).nextId, 'p2');
  assert.equal(at(11, 30).nextId, null);
  assert.equal(at(14, 0).nextId, null, 'past the window, nothing is next');
});

test('Habit grid: days before the habit existed are rest days', () => {
  const id = Math.floor(new Date(2026, 9, 24, 12).getTime()).toString(36).padStart(8, '0') + 'x';
  const d = model.cleanData({ habits: [{ id, title: 'New', doneDates: [] }] });
  assert.deepEqual(model.habitGridModel(d, NOW).habits[0].cells, ['rest', 'rest', 'rest', 'rest', 'missed', 'missed', 'open']);
});

test('Quick start: a paused session says so', () => {
  const w = { startedAt: NOW.getTime() - 600e3, running: false, accumSec: 600, mode: 'stopwatch', targetMin: 0 };
  const m = model.quickStartModel(model.cleanData({ deepWork: w }), NOW);
  assert.equal(m.running, true);
  assert.equal(m.paused, true);
  assert.equal(model.quickStartModel(model.cleanData({ deepWork: { ...w, running: true, startTs: NOW.getTime() } }), NOW).paused, false);
});

test('Focus week: the streak is judged on the widget\'s own clock', () => {
  const key = (n) => { const x = new Date(2026, 9, 26 + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const d = model.cleanData({ sessions: [-2, -1, 0].map((n, i) => ({ id: 's' + i, dateKey: key(n), endedAt: 1, netSeconds: 1800, taskTitles: [] })) });
  assert.equal(model.focusWeekModel(d, NOW).streak, 3);
});

/* ---------------------------------------------------------------- models */

test('Day ring counts today\'s ToDos (a weekday ToDo only on its day) and the running session', () => {
  const m = model.dayRingModel(busy(), NOW);
  // t1, t2 (done), t3, t4 (Monday), late essay m2; t5 is a Tuesday ToDo
  assert.equal(m.total, 5);
  assert.equal(m.done, 1);
  assert.equal(m.left, 4);
  assert.equal(m.focusMin, 50 + 25);
  assert.equal(m.goalMin, 120);
});

test('Next up is the late task first; with nothing left it offers adding one', () => {
  const m = model.nextUpModel(busy(), NOW);
  assert.equal(m.item.id, 'm2');
  assert.ok(m.item.late);
  assert.equal(m.uri, 'sturoids://open?tool=tasks&item=m2');
  assert.equal(model.nextUpModel(empty(), NOW).uri, 'sturoids://add-todo');
});

test('Now / Next: the block on now with its progress, minutes left and a Planner link to it', () => {
  const m = model.nowNextModel(busy(), NOW);
  assert.equal(m.block.tag, 'NOW');
  assert.equal(m.block.subject, 'Physics');
  assert.equal(m.block.minLeft, 40);
  assert.ok(Math.abs(m.block.progress - 20 / 60) < 1e-9);
  assert.equal(m.block.range, '3:00 pm – 4:00 pm');
  assert.deepEqual(links.parseAppLink(m.uri), { kind: 'open', tool: 'planner', params: { day: 'Mon', item: 'b1' } });
  const late = model.nowNextModel(busy(), new Date(2026, 9, 26, 22, 0));
  assert.equal(late.block.tag, 'TOMORROW');
  assert.match(late.uri, /day=Tue/);
});

test('Agenda orders the day and puts now between what is over and what is next', () => {
  const m = model.agendaModel(busy(), NOW);
  const ids = m.rows.map((r) => r.id);
  assert.deepEqual(ids, ['e4', 'b0', 'b1', 'b2', 't1']);
  assert.equal(m.rows[2].on, true);
  assert.equal(m.rows[1].past, true);
  assert.equal(m.nowAt, 3, 'now sits after the block on now');
  // untimed open: t3, t4 and the late essay
  assert.equal(m.untimed, 3);
});

test('Clock: the date, the greeting by name, what is next, and how far the day has gone', () => {
  const m = model.clockModel(busy(), NOW);
  assert.equal(m.weekday, 'Monday');
  assert.equal(m.day + ' ' + m.month, '26 Oct');
  assert.equal(m.greeting, 'Good afternoon, Sanjay');
  assert.equal(m.next, 'Physics until 4:00 pm');
  assert.ok(Math.abs(m.dayFrac - (15 * 60 + 20) / 1440) < 1e-6);
  assert.equal(m.left, 4);
  assert.equal(m.uri, '');
  const night = model.clockModel(model.cleanData(busyRows({ settings: { name: '' } })), new Date(2026, 9, 26, 23, 30));
  assert.equal(night.greeting, 'Good night');
  assert.equal(night.next, 'Tomorrow: Maths');
  const h24 = model.clockModel(model.cleanData(busyRows({ settings: { hour24: true } })), new Date(2026, 9, 26, 14, 0));
  assert.equal(h24.next, 'Physics at 15:00');
});

test('Deadlines: open long-term tasks by date, with D-n, Late and their steps', () => {
  const m = model.deadlinesModel(busy(), NOW);
  assert.deepEqual(m.rows.map((r) => [r.id, r.pill, r.steps]), [['m2', 'Late', ''], ['m1', 'D-2', '1/2']]);
  assert.deepEqual(links.parseAppLink(m.rows[1].uri), { kind: 'open', tool: 'tasks', params: { list: 'missions', item: 'm1' } });
});

test('Session: a running countdown with when it ends; otherwise presets that open Deep Work on their length', () => {
  const m = model.sessionModel(busy(), NOW);
  assert.equal(m.live.elapsedMin, 25);
  assert.equal(m.live.countdown, true);
  assert.equal(m.live.endsAt, '3:45 pm');
  const idle = model.sessionModel(empty(), NOW);
  assert.equal(idle.live, null);
  assert.deepEqual(idle.presets.map((x) => links.parseAppLink(x.uri).params.minutes), ['25', '50', '90']);
  assert.equal(model.quickStartModel(empty(), NOW).uri, 'sturoids://start-focus');
});

test('Focus week: seven days, today with the live session, subjects coloured, a streak', () => {
  const m = model.focusWeekModel(busy(), NOW);
  assert.equal(m.days.length, 7);
  assert.equal(m.days[6].today, true);
  assert.equal(m.days[6].min, 75);
  assert.equal(m.days[5].min, 125);
  assert.equal(m.totalMin, 50 + 125 + 30 + 25);
  assert.deepEqual(m.subjects.map((s) => s.name), ['Maths', 'Physics']);
  assert.equal(m.best, 'Sun · 2 h 05');
});

test('Habit grid: done, missed, rest days and today open', () => {
  const m = model.habitGridModel(busy(), NOW);
  const walk = m.habits.find((h) => h.id === 'h2');
  // last seven: Tue 20 … Mon 26; Walk is due Mon, Wed, Fri
  assert.deepEqual(walk.cells, ['rest', 'missed', 'rest', 'missed', 'rest', 'done', 'done']);
  const water = m.habits.find((h) => h.id === 'h1');
  assert.equal(water.cells[6], 'open');
  assert.deepEqual(links.parseAppLink(water.uri), { kind: 'open', tool: 'planner', params: { item: 'h1' } });
});

test('Streak: the longest live run, at risk while today is still open', () => {
  const m = model.streakModel(busy(), NOW);
  assert.equal(m.title, 'Water');
  assert.equal(m.current, 3);
  assert.equal(m.atRisk, true);
  assert.equal(model.streakModel(empty(), NOW), null);
});

test('Notes: newest first; a new note from the widget', () => {
  assert.deepEqual(model.recentNotesModel(busy(), NOW).rows.map((r) => r.id), ['n1', 'n2']);
  assert.equal(model.newNoteModel(busy(), NOW).uri, 'sturoids://new-note');
  assert.equal(model.newNoteModel(busy(), NOW).last.when, 'Today');
});

test('Journal: today\'s page, the 14-day strip and on this day', () => {
  const w = model.writeTodayModel(busy(), NOW);
  assert.equal(w.dayKey, TODAY);
  assert.equal(w.words, 0);
  assert.ok(w.prompt.length > 0);
  assert.equal(w.streak, 1, 'yesterday was written, today not yet');
  assert.deepEqual(links.parseAppLink(w.uri), { kind: 'open', tool: 'journal', params: { item: TODAY } });
  const s = model.moodStripModel(busy(), NOW);
  assert.equal(s.days.length, 14);
  assert.equal(s.days[12].mood, 4);
  assert.equal(s.days[13].today, true);
  const o = model.onThisDayModel(busy(), NOW);
  assert.equal(o.entry.when, 'A year ago');
  assert.deepEqual(links.parseAppLink(o.entry.uri).params, { item: '2025-10-26', entry: 'j2' });
});

test('Scores: the next exam, results with how they moved, a subject\'s trend', () => {
  const c = model.countdownModel(busy(), NOW);
  assert.equal(c.exam.title, 'Bio quiz');
  assert.equal(c.exam.days, 0);
  const r = model.resultsModel(busy());
  assert.deepEqual(r.rows.map((x) => [x.title, x.pct, x.move]), [['Unit test', '90%', 'up'], ['Mid-term', '80%', 'none']]);
  const t = model.subjectTrendModel(busy(), NOW);
  assert.equal(t.subject, 'Physics');
  assert.deepEqual(t.values, [80, 90]);
  assert.equal(t.delta, '+10 pts');
  assert.equal(model.subjectTrendModel(empty(), NOW), null);
});

test('Vault: carry on where it was left, at that second', () => {
  const m = model.continueModel(busy());
  assert.equal(m.rows[0].id, 'v1');
  assert.equal(m.rows[0].left, 'Left at 12:34');
  assert.deepEqual(links.parseAppLink(m.rows[0].uri).params, { item: 'v1', t: '754' });
  assert.equal(model.watchListModel(busy()).rows[1].title, 'Untitled video');
});

test('AI dock: up to four links with their initials, a missing label from the site', () => {
  const m = model.aiDockModel(busy());
  assert.deepEqual(m.links.map((l) => [l.label, l.initial]), [['Claude', 'C'], ['ChatGPT', 'C'], ['perplexity.ai', 'P']]);
});

test('colours: palette slots and literals resolve, anything else is the accent', () => {
  const p = model.paletteOf({ theme: 'minimal', accent: '#123456' });
  assert.equal(p.bg, '#262624');
  assert.equal(model.hexOf('teal', p), '#83DBD6');
  assert.equal(model.hexOf('#abc', p), '#aabbcc');
  assert.equal(model.hexOf('bogus', p), '#123456');
  assert.equal(model.rgba('#9588F9', 0.5), 'rgba(149, 136, 249, 0.5)');
});

test('shapes: rings and trend lines are well-formed at the ends of their range', () => {
  for (const f of [0, 0.25, 0.5, 0.75, 0.99999, 1, 1.5, -1]) {
    const s = model.ringSvg({ size: 64, stroke: 6, frac: f, color: '#ffffff', track: '#000000', dot: '#ffffff', inner: { frac: f, color: '#ff0000' } });
    assert.ok(s.startsWith('<svg') && !/NaN/.test(s), String(f));
  }
  assert.ok(!/NaN/.test(model.trendSvg([50], 200, 80, '#ffffff', '#999999')));
  assert.ok(!/NaN/.test(model.trendSvg([50, 50, 50], 200, 80, '#ffffff', '#999999')));
});

/* ---------------------------------------------------------------- drawing */

test('every widget draws a full tree, empty and busy, in every size, at any hour', () => {
  const states = {
    empty: empty(),
    busy: busy(),
    minimal: model.cleanData(busyRows({ settings: { theme: 'minimal', accent: '#E39EAC', hour24: true } })),
    archived: model.cleanData(busyRows({ settings: { archivedTools: ['notes', 'journal', 'scores', 'vault', 'ai', 'desmos'] } })),
    locked: model.cleanData(busyRows({ settings: { notesLocked: true, journalLocked: true } })),
    paused: model.cleanData(busyRows({ rows: { deepWork: { mode: 'stopwatch', targetMin: 0, running: false, startTs: null, accumSec: 600, startedAt: NOW.getTime(), subject: '', attached: [], finishAt: null } } })),
  };
  const hours = [new Date(2026, 9, 26, 0, 1), NOW, new Date(2026, 9, 26, 23, 59)];
  for (const [label, d] of Object.entries(states)) {
    for (const name of model.PHONE_WIDGET_NAMES) {
      for (const box of BOXES) {
        for (const now of hours) {
          const tag = label + ' ' + name + ' ' + box.width + 'x' + box.height + ' ' + now.getHours();
          checkTree(build(widgets.renderPhoneWidget(name, d, box, now)), tag);
        }
      }
    }
  }
  checkTree(build(widgets.fallbackWidget()), 'fallback');
});

test('a widget passed its model draws the same as one that works it out', () => {
  const d = busy();
  for (const name of model.PHONE_WIDGET_NAMES) {
    const a = JSON.stringify(build(widgets.renderPhoneWidget(name, d, BOXES[3], NOW)));
    const b = JSON.stringify(build(widgets.renderPhoneWidget(name, d, BOXES[3], NOW, model.modelFor(name, d, NOW))));
    assert.equal(a, b, name);
  }
});

test('models are plain data (the updater compares them as JSON)', () => {
  const d = busy();
  for (const name of model.PHONE_WIDGET_NAMES) {
    const m = model.modelFor(name, d, NOW);
    assert.deepEqual(JSON.parse(JSON.stringify(m === undefined ? null : m)), m === undefined ? null : m, name);
  }
});

/* ---------------------------------------------------------------- the Calculator widget's keypad */

test('the Calculator widget works a sum key by key, as the Calculator does', () => {
  const type = (keys, from = calc.EMPTY_PAD) => keys.reduce((p, k) => calc.pressKey(p, k), from);
  assert.equal(type(['1', '2', '×', '7', '+', '3']).expr, '12×7+3');
  assert.equal(calc.padAnswer('12×7+3'), '87');
  assert.equal(type(['1', '2', '×', '7', '+', '3', '=']).expr, '87');
  assert.equal(type(['0', '.', '1', '+', '0', '.', '2', '=']).expr, '0.3');
  // a sign after a sign takes its place; a minus after × is a negative number
  assert.equal(type(['5', '+', '×', '2']).expr, '5×2');
  assert.equal(type(['5', '×', '−', '2', '=']).expr, '−10');
  // one point to a number, and a point on its own starts 0.
  assert.equal(type(['.', '5', '.', '2']).expr, '0.52');
  // a digit after an answer starts afresh, a sign carries it on
  const ans = type(['2', '+', '2', '=']);
  assert.equal(type(['9'], ans).expr, '9');
  assert.equal(type(['×', '3', '='], ans).expr, '12');
  // brackets close only what is open, and multiply next to a number
  assert.equal(type([')', '2', '(', '1', '+', '1', ')', ')']).expr, '2×(1+1)');
  assert.equal(calc.padAnswer('2×(1+1'), '4');
  // leading zeros, delete, clear
  assert.equal(type(['0', '0', '7']).expr, '7');
  assert.equal(type(['1', '2', 'DEL']).expr, '1');
  assert.equal(type(['1', '2', 'C']).expr, '');
  // nothing to work out is no answer, and "=" on it changes nothing
  assert.equal(calc.padAnswer('5÷'), '5');
  assert.equal(type(['1', '÷', '0', '=']).expr, '1÷0');
  assert.equal(calc.showsAnswer('42'), false);
  // a stored pad is checked
  assert.deepEqual(calc.cleanPad({ expr: 'rm -rf', done: true }), calc.EMPTY_PAD);
  assert.deepEqual(calc.cleanPad({ expr: '1.5×10^23', done: true }), { expr: '1.5×10^23', done: true });
  assert.equal(type(Array(80).fill('9')).expr.length, calc.PAD_MAX);
});

test('the Calculator widget draws a sum and its answer, and its keys in every size', () => {
  const d = busy();
  const pad = { expr: '12×7+3', done: false };
  for (const box of BOXES) {
    const tree = build(widgets.renderPhoneWidget('Calculator', d, box, NOW, pad));
    checkTree(tree, 'calc ' + box.width + 'x' + box.height);
    const texts = [];
    let keys = 0;
    walk(tree, (n) => {
      if (n.type === 'TextWidget') texts.push(n.props.text);
      if (n.props.clickAction === 'CALC') keys++;
    });
    assert.ok(texts.includes('12×7+3'), 'the sum shows');
    assert.ok(texts.includes('= 87'), 'the answer shows');
    assert.equal(keys, box.height >= 230 ? 20 : 0, 'the keypad at ' + box.height);
  }
});

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
