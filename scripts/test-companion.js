// Checks the companion's drawing and words (src/mascot/art.ts, src/mascot/lines.ts): every pose fits its grid, lines
// rest once said and months of days do not run a pool dry, the budget holds, and messages get sensible answers.
// Run: npm run test:companion

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { createRequire } = require('module');

const ROOT = path.join(__dirname, '..');
const projectRequire = createRequire(path.join(ROOT, 'package.json'));
const ts = projectRequire('typescript');

function load(file) {
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  });
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(projectRequire, mod, mod.exports);
  return mod.exports;
}

const art = load(path.join(ROOT, 'src', 'mascot', 'art.ts'));
const lines = load(path.join(ROOT, 'src', 'mascot', 'lines.ts'));

let failed = 0;
let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('pass  ' + name); } catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + String(e.stack || e).split('\n').slice(0, 3).join('\n      ')); }
}

const ctx = (over = {}) => ({
  kind: 'sprout', name: 'Sprout', hour: 10, weekday: 3, date: '03-11', year: 2027, due: 4, left: 2, next: 'Physics notes',
  exam: { title: 'Chemistry test', days: 3 }, focusMin: 30, away: 0, run: 3, first: false, gear: [], ...over,
});

check('every pose of both companions stays inside its grid, and every colour is in each palette', () => {
  const limbs = ['rest', 'out', 'up', 'swing', 'down'];
  const eyes = ['open', 'blink', 'happy', 'up', 'left', 'right', 'read', 'sleepy', 'focus', 'wide'];
  for (const kind of ['sprout', 'pip']) {
    for (const set of art.COLOR_SETS[kind]) {
      for (const l of limbs) for (const e of eyes) for (const book of ['none', 'open', 'turn']) {
        const gear = art.gearFor(kind).map((g) => g.key);
        const cells = art.compose(kind, { ...art.REST, l, r: l, eyes: e, book, phones: true, blush: true, mouth: 'grin' }, gear, 3);
        for (const [c, r, k] of cells) {
          assert.ok(c >= 0 && c < art.COLS && r >= 0 && r < art.ROWS, kind + ' ' + l + ' ' + e + ': ' + c + ',' + r);
          assert.ok(k in set.pal, kind + '/' + set.key + ' has no colour ' + k);
        }
      }
    }
  }
});

check('the right side is the left one mirrored: a resting companion has the same outline both sides', () => {
  for (const kind of ['sprout', 'pip']) {
    const cells = art.compose(kind, art.REST, [], 0);
    const have = new Set(cells.map(([c, r]) => c + ',' + r));
    for (const [c, r] of cells) assert.ok(have.has((art.COLS - 1 - c) + ',' + r), kind + ' ' + c + ',' + r);
  }
});

check('runs join a row of one colour into one rectangle', () => {
  const r = art.runs([[0, 0, 'b'], [1, 0, 'b'], [2, 0, 'd'], [0, 1, 'b']], { b: '#1', d: '#2' }, 3, 2);
  assert.deepEqual(r, [{ x: 0, y: 0, w: 2, fill: '#1' }, { x: 2, y: 0, w: 1, fill: '#2' }, { x: 0, y: 1, w: 1, fill: '#1' }]);
});

check('a line once said rests: ninety days of a hello and an idle line each never repeat one within a fortnight', () => {
  let mem = lines.freshMemory();
  const said = new Map();
  let start = lines.dayNo('2027-01-01');
  for (let d = 0; d < 90; d++) {
    const key = new Date((start + d) * 86400000).toISOString().slice(0, 10);
    mem = lines.newDay(mem, key);
    for (const m of ['hello', 'idle']) {
      const c = ctx({ hour: 7 + (d % 14), weekday: (d + 5) % 7, date: key.slice(5), focusMin: d % 3 ? 20 : 130 });
      const l = m === 'idle' ? lines.chooseIdle(c, mem, start + d) : lines.choose(lines.poolFor(m, c), c, mem, start + d);
      assert.ok(l, 'a line for ' + m);
      const last = said.get(l.id);
      if (last !== undefined) assert.ok(start + d - last >= 14, l.id + ' again after ' + (start + d - last) + ' days');
      said.set(l.id, start + d);
      mem = lines.remember(mem, l.id, start + d, d * 86400000, true);
    }
  }
});

check('a pool used up gives back the line rested longest, never nothing', () => {
  const c = ctx();
  let mem = lines.freshMemory();
  const pool = lines.poolFor('bye', c);
  for (const l of pool) mem = lines.remember(mem, l.id, 100, 0, false);
  assert.ok(lines.choose(pool, c, mem, 100));
});

check('the budget: chatty, now and then, and only when spoken to', () => {
  const m = { ...lines.freshMemory(), said: 2, lastAt: 0 };
  assert.equal(lines.maySpeak(m, 'some', 60 * 60 * 1000), true);
  assert.equal(lines.maySpeak({ ...m, said: 3 }, 'some', 60 * 60 * 1000), false);
  assert.equal(lines.maySpeak({ ...m, lastAt: 1000 }, 'some', 10 * 60 * 1000), false);
  assert.equal(lines.maySpeak(m, 'often', 60 * 60 * 1000), true);
  assert.equal(lines.maySpeak(lines.freshMemory(), 'asked', 1e12), false);
});

check('days in a row go on, and start again after a gap', () => {
  let m = lines.newDay(lines.freshMemory(), '2027-03-01');
  m = lines.newDay(m, '2027-03-02');
  m = lines.newDay(m, '2027-03-03');
  assert.equal(m.run, 3);
  m = lines.newDay(m, '2027-03-06');
  assert.equal(m.run, 1);
  assert.equal(m.firstDay, '2027-03-01');
});

check('special days and a return after days away get their own hello', () => {
  assert.ok(lines.poolFor('hello', ctx({ date: '01-14' }))[0].text.includes('pongal'));
  assert.ok(lines.poolFor('hello', ctx({ date: '10-29', year: 2027 }))[0].text.includes('deepavali'));
  assert.ok(lines.poolFor('hello', ctx({ away: 4 })).some((l) => l.id === 'bk2'));
  assert.equal(lines.fill('u was gone {away} sleeps!', ctx({ away: 4 })), 'u was gone 4 sleeps!');
});

check('tapped, it sometimes speaks of the day; long names are cut short in what it says', () => {
  const c = ctx({ next: 'Finish the extremely long physics worksheet on rotational motion' });
  const pools = new Set();
  for (let i = 0; i < 60; i++) for (const l of lines.poolFor('tap', c)) pools.add(l.id);
  assert.ok([...pools].some((id) => /^c|^e|^f/.test(id)), 'facts about the day among the taps');
  // never advice: no line tells the user to rest, sleep, drink or take a break
  for (const m of ['hello', 'idle', 'tick', 'start', 'done', 'day', 'tap']) for (const l of lines.poolFor(m, { ...c, hour: 23 })) {
    assert.ok(!/\b(drink|water break|rest your|take a break|go to bed|early night|sleep is|you should)\b/i.test(l.text), l.id + ': ' + l.text);
  }
  assert.ok([...pools].some((id) => id.startsWith('tp')), 'and plain reactions');
  assert.equal(lines.fill('next is {next}!', c), 'next is Finish the extremely long p…!');
  for (const m of ['back', 'shh', 'bye', 'idea', 'wave', 'dizzy', 'taps', 'start', 'day', 'streak', 'carry', 'land']) assert.ok(lines.poolFor(m, c).length, m);
});

check('every line fills in: no braces are left, and no line is long for a bubble', () => {
  const c = ctx({ subject: 'Physics', focusMin: 70 });
  for (const m of ['hello', 'idle', 'tick', 'start', 'done', 'day', 'streak', 'wave', 'bye', 'back', 'idea', 'shh', 'tap', 'taps', 'dizzy', 'carry', 'land']) {
    for (const k of ['sprout', 'pip']) for (const l of lines.poolFor(m, { ...c, kind: k })) {
      const t = lines.fill(l.text, { ...c, kind: k });
      assert.ok(!/[{}]/.test(t), l.id + ': ' + t);
      assert.ok(t.length <= 84, l.id + ' is ' + t.length + ' long');
    }
  }
});

check('a companion says only its own lines', () => {
  const c = ctx({ kind: 'pip' });
  const mem = lines.freshMemory();
  for (let i = 0; i < 200; i++) {
    const l = lines.chooseIdle(c, mem, 10);
    assert.ok(!l.who || l.who === 'pip', l.id);
  }
});

console.log('\ntest-companion: ' + (failed ? failed + ' failed' : 'all passed') + ' (' + passed + ')');
process.exit(failed ? 1 : 0);
