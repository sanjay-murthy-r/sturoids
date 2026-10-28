#!/usr/bin/env node
/*
 * Draws the picture Android's widget picker shows for each phone widget (app.json, previewImage), from the widgets' own
 * drawing code (src/widgets/phone/widgets.tsx) over a sample day, so the picker shows what the widget really looks like
 * instead of the app's icon. The widget tree is laid out the way the widget library lays it out on the phone (each
 * FlexWidget a LinearLayout: a column unless it says row, flex as weight, match_parent filling), as HTML, and
 * photographed in Chromium with the widgets' own fonts.
 *
 * Usage: node scripts/build-widget-previews.js           (writes assets/widget-previews/<name>.png)
 *        node scripts/build-widget-previews.js --check   (exit 1 when a picture is missing for a widget in app.json)
 * Needs Playwright with Chromium (preinstalled in the cloud workspace; `npx playwright install chromium` elsewhere).
 */
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'assets', 'widget-previews');
const projectRequire = createRequire(path.join(ROOT, 'package.json'));
const ts = projectRequire('typescript');
const React = projectRequire('react');

const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
const entry = app.expo.plugins.find((p) => Array.isArray(p) && p[0] === 'react-native-android-widget');
const NAMES = entry[1].widgets.map((w) => w.name);

if (process.argv.includes('--check')) {
  const missing = entry[1].widgets.filter((w) => !w.previewImage || !fs.existsSync(path.join(ROOT, w.previewImage)));
  if (missing.length) {
    console.error('widget pictures missing: ' + missing.map((w) => w.name).join(', '));
    process.exit(1);
  }
  console.log('widget previews: ok (' + NAMES.length + ')');
  process.exit(0);
}

/* ---------------------------------------------------------------- the widget code, loaded as the tests load it */

const WIDGETS = ['FlexWidget', 'TextWidget', 'SvgWidget', 'ImageWidget', 'OverlapWidget', 'IconWidget', 'ListWidget'];
const widgetLib = {};
for (const n of WIDGETS) {
  const C = () => null;
  C.__name__ = n;
  widgetLib[n] = C;
}

function load(file) {
  const registry = new Map();
  const go = (f) => {
    if (registry.has(f)) return registry.get(f).exports;
    const { outputText } = ts.transpileModule(fs.readFileSync(f, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, jsx: ts.JsxEmit.React },
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

/* ---------------------------------------------------------------- the sample day */

const NOW = new Date(2026, 9, 27, 10, 20); // a Tuesday morning
const key = (d) => {
  const x = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + d);
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
};
const TODAY = key(0);
const T = NOW.getTime();
const days = (pattern) => pattern.map((on, i) => (on ? key(i - 6) : '')).filter(Boolean);
const exam = (id, title, d, marks) => [
  { id, parentId: 'g', kind: 'exam', title, date: key(d), createdAt: T + d, updatedAt: T },
  ...(marks || []).map((score, i) => ({
    id: id + i, parentId: id, kind: 'exam', title: ['Physics', 'Chemistry', 'Maths'][i], score, outOf: 100, createdAt: T + i, updatedAt: T,
  })),
];

const rows = {
  settings: {
    name: 'Sanjay', theme: 'default', accent: '#9588F9', hour24: false, notesLocked: false, journalLocked: false,
    archivedTools: ['desmos'], tabSlots: ['tasks', 'focus', 'planner'], focusLastMin: 50, focusGoalMin: 240,
    journalCutoffHour: 3, journalPromptsOn: true, journalWordGoal: 300,
  },
  dailyTasks: [
    { id: 't1', title: 'Solve 20 integration problems', doneOn: null, createdAt: 1, time: '12:30' },
    { id: 't2', title: 'Revise rotational motion', doneOn: TODAY, createdAt: 2 },
    { id: 't3', title: 'Organic reactions flashcards', doneOn: null, createdAt: 3 },
    { id: 't4', title: 'Read chapter 7, thermodynamics', doneOn: null, createdAt: 4, time: '18:00' },
    { id: 't5', title: 'Plan tomorrow', doneOn: null, createdAt: 5, time: '21:30' },
    { id: 't6', title: 'Formula sheet, optics', doneOn: TODAY, createdAt: 6 },
  ],
  missions: [
    { id: 'm1', title: 'Physics project report', deadline: key(3), done: false, subtasks: [{ id: 'a', title: 'a', done: true }, { id: 'b', title: 'b', done: true }, { id: 'c', title: 'c', done: false }] },
    { id: 'm2', title: 'Chemistry lab record', deadline: key(8), done: false, subtasks: [{ id: 'a', title: 'a', done: true }, { id: 'b', title: 'b', done: false }] },
    { id: 'm3', title: 'Maths assignment 4', deadline: key(1), done: false, subtasks: [] },
  ],
  sessions: [
    [-6, 95, 'Physics'], [-6, 40, 'Maths'], [-5, 140, 'Chemistry'], [-4, 70, 'Maths'], [-3, 120, 'Physics'], [-3, 45, 'Chemistry'],
    [-2, 120, 'Maths'], [-1, 150, 'Physics'], [-1, 35, 'Maths'], [0, 75, 'Physics'],
  ].map(([d, min, subject], i) => ({ id: 'f' + i, dateKey: key(d), endedAt: T + d * 86400e3, netSeconds: min * 60, taskTitles: [], subject })),
  planner: {
    Tue: [
      { id: 'b1', subject: 'Physics, rotation', start: '09:30', end: '11:00', color: '#9DBCE3' },
      { id: 'b2', subject: 'Chemistry', start: '11:30', end: '12:30', color: '#9AD6B0' },
      { id: 'b3', subject: 'Maths practice', start: '14:00', end: '15:30', color: '#E3C08D' },
      { id: 'b4', subject: 'Revision', start: '17:00', end: '18:00', color: '#E39EAC' },
    ],
    Wed: [{ id: 'b5', subject: 'Maths', start: '09:00', end: '10:30', color: '#E3C08D' }],
  },
  habits: [
    { id: 'h1', title: 'Morning revision', doneDates: days([1, 1, 1, 1, 1, 1, 0]) },
    { id: 'h2', title: 'Read 20 pages', doneDates: days([1, 0, 1, 1, 0, 1, 0]) },
    { id: 'h3', title: 'No phone after 10', doneDates: days([0, 1, 1, 1, 1, 0, 1]) },
    { id: 'h4', title: 'Water, 8 glasses', doneDates: days([1, 1, 0, 1, 1, 1, 1]) },
  ],
  notes: [
    { title: 'Electrostatics formulas', body: "Coulomb's law, the field of a dipole, Gauss's law for a sphere", folder: 'Physics', pinned: true, ago: 1 },
    { title: 'Organic named reactions', body: 'Aldol, Cannizzaro, Reimer-Tiemann, with the reagents for each', folder: 'Chemistry', pinned: true, ago: 5 },
    { title: 'Mock 5 mistakes', body: 'A sign error in work-energy, and the units misread in Q17', folder: 'General', pinned: true, ago: 26 },
    { title: 'Integration tricks', body: 'The King property, by parts twice, and when to put t = tan x/2', folder: 'Maths', pinned: false, ago: 50 },
    { title: 'Revision plan', body: 'Mechanics this week, then optics and modern physics', folder: 'General', pinned: false, ago: 80 },
  ].map((n, i) => ({ id: 'n' + i, title: n.title, body: n.title + '\n' + n.body, folder: n.folder, tags: [], pinned: n.pinned, createdAt: 1, updatedAt: T - n.ago * 3600e3, attachments: [] })),
  journal: [
    ...[4, 3, 4, 5, 3, 4, 2, 4, 5, 4, 3, 4, 5].map((mood, i) => ({
      id: 'j' + i, dateKey: key(i - 13), title: '', excerpt: 'A steady day of revision', mood, rating: Math.min(5, mood + (i % 2)),
      tags: [], wordCount: 140 + i * 11, pinned: false, createdAt: 1, updatedAt: 1,
    })),
    { id: 'jy', dateKey: '2025-10-27', title: 'The first mock', excerpt: 'Nervous before it, calmer after. Physics went better than I thought it would.', mood: 4, rating: 4, tags: [], wordCount: 210, pinned: false, createdAt: 1, updatedAt: 1 },
  ],
  scores: [
    { id: 'g', parentId: null, kind: 'group', title: 'JEE Main mocks', createdAt: T, updatedAt: T },
    ...exam('e1', 'Mock 1', -42, [58, 64, 52]),
    ...exam('e2', 'Mock 2', -33, [63, 61, 60]),
    ...exam('e3', 'Mock 3', -24, [61, 70, 66]),
    ...exam('e4', 'Mock 4', -14, [70, 68, 71]),
    ...exam('e5', 'Mock 5', -5, [78, 74, 81]),
    ...exam('e6', 'Mock 6', 9, null),
  ],
  vaultVideos: [
    { title: 'Rotational dynamics, the whole chapter', resumeAt: 1834, openedAt: 9 },
    { title: 'Chemical bonding in one shot', resumeAt: 0, openedAt: 8 },
    { title: 'Definite integrals, properties', resumeAt: 0, openedAt: 7 },
  ].map((v, i) => ({ id: 'v' + i, videoId: '', url: 'https://youtu.be/x', title: v.title, folderId: null, tags: [], addedAt: i, notes: [], bookmarks: [], resumeAt: v.resumeAt, openedAt: v.openedAt })),
  aiLinks: [
    { id: 'a1', label: 'Claude', url: 'https://claude.ai' },
    { id: 'a2', label: 'ChatGPT', url: 'https://chatgpt.com' },
    { id: 'a3', label: 'Gemini', url: 'https://gemini.google.com' },
    { id: 'a4', label: 'Perplexity', url: 'https://perplexity.ai' },
  ],
  deepWork: null,
};
const DATA = model.cleanData(rows);
/** Session shows a session in flight: it says more than the presets */
const LIVE = model.cleanData({
  ...rows,
  deepWork: {
    mode: 'countdown', targetMin: 50, running: true, startTs: T - 32 * 60e3, accumSec: 0, startedAt: T - 32 * 60e3,
    subject: 'Physics', attached: [], finishAt: null,
  },
});

/** The size each picture is drawn at, in dp: the picker scales it into its own box. */
function boxOf(name) {
  const w = entry[1].widgets.find((x) => x.name === name);
  const tw = w.targetCellWidth || 2;
  const th = w.targetCellHeight || 2;
  // a roomy launcher cell (phones run 70 to 100 dp): the picture keeps the widget's own proportions
  return { width: tw * 90 - 8, height: th * 90 - 8 };
}

/* ---------------------------------------------------------------- the tree, as HTML */

function build(el) {
  while (!el.type.__name__) el = el.type(el.props);
  const { children, ...props } = el.props;
  const kids = (children ? (Array.isArray(children) ? children : [children]) : []).flat(3).filter((x) => !!x && typeof x === 'object');
  return { type: el.type.__name__, props, children: kids.map(build) };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** a size as LinearLayout reads it, inside a parent laid out along `axis` */
function sizeCss(st, parentAxis) {
  const css = [];
  const dim = (k, v) => {
    if (v === 'match_parent') {
      // along the parent's line, match_parent takes what is left; across it, the whole
      if ((k === 'width' && parentAxis === 'row') || (k === 'height' && parentAxis === 'column')) css.push('flex-grow:1', 'flex-basis:0', 'min-' + k + ':0');
      else css.push('align-self:stretch');
    } else if (typeof v === 'number') css.push(k + ':' + v + 'px', 'flex-shrink:0');
  };
  dim('width', st.width);
  dim('height', st.height);
  if (st.flex) css.push('flex:' + st.flex + ' 1 0', parentAxis === 'row' ? 'min-width:0' : 'min-height:0');
  return css;
}

function boxCss(st) {
  const css = [];
  const px = (v) => v + 'px';
  if (st.padding != null) css.push('padding:' + px(st.padding));
  if (st.paddingHorizontal != null) css.push('padding-left:' + px(st.paddingHorizontal), 'padding-right:' + px(st.paddingHorizontal));
  if (st.paddingVertical != null) css.push('padding-top:' + px(st.paddingVertical), 'padding-bottom:' + px(st.paddingVertical));
  for (const side of ['Top', 'Bottom', 'Left', 'Right']) {
    if (st['padding' + side] != null) css.push('padding-' + side.toLowerCase() + ':' + px(st['padding' + side]));
    if (st['margin' + side] != null) css.push('margin-' + side.toLowerCase() + ':' + px(st['margin' + side]));
  }
  if (st.marginHorizontal != null) css.push('margin-left:' + px(st.marginHorizontal), 'margin-right:' + px(st.marginHorizontal));
  if (st.marginVertical != null) css.push('margin-top:' + px(st.marginVertical), 'margin-bottom:' + px(st.marginVertical));
  if (st.backgroundColor) css.push('background:' + st.backgroundColor);
  if (st.borderRadius != null) css.push('border-radius:' + px(st.borderRadius));
  if (st.borderWidth) css.push('border:' + px(st.borderWidth) + ' ' + (st.borderStyle || 'solid') + ' ' + (st.borderColor || 'transparent'));
  if (st.overflow === 'hidden') css.push('overflow:hidden');
  return css;
}

const JUSTIFY = { 'flex-start': 'flex-start', center: 'center', 'flex-end': 'flex-end', 'space-between': 'space-between', 'space-around': 'space-around', 'space-evenly': 'space-evenly' };

function html(n, parentAxis) {
  const st = n.props.style || {};
  if (n.type === 'TextWidget') {
    const lines = n.props.maxLines || 1;
    const css = [
      ...sizeCss(st, parentAxis), ...boxCss(st),
      "font-family:'" + st.fontFamily + "'", 'font-size:' + st.fontSize + 'px', 'color:' + st.color,
      'line-height:' + Math.round(st.fontSize * 1.28) + 'px', 'letter-spacing:' + (st.letterSpacing || 0) + 'px',
      'text-align:' + (st.textAlign || 'left'), 'overflow:hidden', 'display:-webkit-box', '-webkit-box-orient:vertical',
      '-webkit-line-clamp:' + lines, 'white-space:' + (lines === 1 ? 'nowrap' : 'normal'), 'text-overflow:ellipsis',
      'word-break:break-word', 'flex-shrink:1', 'min-width:0', 'max-width:100%',
    ];
    if (lines === 1) css.push('display:block');
    return '<div style="' + css.join(';') + '">' + esc(n.props.text) + '</div>';
  }
  if (n.type === 'SvgWidget') {
    const css = [...sizeCss(st, parentAxis), ...boxCss(st), 'display:flex', 'flex-shrink:0'];
    const svg = String(n.props.svg).replace(/^<svg /, '<svg style="width:100%;height:100%" ');
    return '<div style="' + css.join(';') + '">' + svg + '</div>';
  }
  if (n.type === 'ImageWidget') {
    const css = [...sizeCss(st, parentAxis), ...boxCss(st), 'width:' + (n.props.imageWidth || 40) + 'px', 'height:' + (n.props.imageHeight || 40) + 'px'];
    return '<div style="' + css.join(';') + '"></div>';
  }
  if (n.type === 'OverlapWidget') {
    const css = [...sizeCss(st, parentAxis), ...boxCss(st), 'position:relative', 'display:flex'];
    return '<div style="' + css.join(';') + '">' + n.children.map((c, i) => (
      '<div style="' + (i ? 'position:absolute;left:0;top:0;right:0;bottom:0;' : '') + 'display:flex;flex-direction:column">' + html(c, 'column') + '</div>'
    )).join('') + '</div>';
  }
  // FlexWidget: a LinearLayout, a column unless it says row
  const axis = st.flexDirection === 'row' ? 'row' : 'column';
  const css = [
    ...sizeCss(st, parentAxis), ...boxCss(st), 'display:flex', 'flex-direction:' + axis, 'box-sizing:border-box',
    'justify-content:' + (JUSTIFY[st.justifyContent] || 'flex-start'), 'align-items:' + (st.alignItems || 'flex-start'),
    'gap:' + (st.flexGap || 0) + 'px',
  ];
  return '<div style="' + css.join(';') + '">' + n.children.map((c) => html(c, axis)).join('') + '</div>';
}

const FONTS = entry[1].fonts.map((f) => {
  const file = path.join(ROOT, f);
  const family = path.basename(f, '.ttf');
  return '@font-face{font-family:"' + family + '";src:url("data:font/ttf;base64,' + fs.readFileSync(file).toString('base64') + '")}';
}).join('\n');

function page(name) {
  const box = boxOf(name);
  const d = name === 'Session' || name === 'QuickStart' ? LIVE : DATA;
  const own = name === 'Calculator' ? { expr: '6.022×10^23×0.25', done: false } : undefined;
  const tree = build(widgets.renderPhoneWidget(name, d, box, NOW, own));
  return {
    box,
    html: '<!doctype html><html><head><meta charset="utf-8"><style>' + FONTS +
      '\nhtml,body{margin:0;padding:0;background:transparent}*{box-sizing:border-box}' +
      '#w{width:' + box.width + 'px;height:' + box.height + 'px;display:flex;flex-direction:column}</style></head><body><div id="w">' +
      html(tree, 'column') + '</div></body></html>',
  };
}

/* ---------------------------------------------------------------- photographs */

async function main() {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    ({ chromium } = projectRequire('playwright'));
  }
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ deviceScaleFactor: 2.5, viewport: { width: 700, height: 700 } });
  const tab = await ctx.newPage();
  for (const name of NAMES) {
    const { html: doc } = page(name);
    await tab.setContent(doc, { waitUntil: 'load' });
    await tab.evaluate(() => document.fonts.ready);
    const file = path.join(OUT, name.toLowerCase() + '.png');
    await tab.locator('#w').screenshot({ path: file, omitBackground: true });
    console.log('drew ' + path.relative(ROOT, file));
  }
  await browser.close();

  // every widget names its picture in app.json
  let changed = false;
  for (const w of entry[1].widgets) {
    const want = './assets/widget-previews/' + w.name.toLowerCase() + '.png';
    if (w.previewImage !== want) {
      w.previewImage = want;
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(path.join(ROOT, 'app.json'), JSON.stringify(app, null, 2) + '\n');
    console.log('app.json: previewImage set for every widget');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
