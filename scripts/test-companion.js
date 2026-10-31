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
  assert.ok(lines.poolFor('hello', ctx({ date: '01-14' }))[0].text.includes('Pongal'));
  assert.ok(lines.poolFor('hello', ctx({ date: '10-29', year: 2027 }))[0].text.includes('Deepavali'));
  assert.ok(lines.poolFor('hello', ctx({ away: 4 })).some((l) => l.id === 'bk2'));
  assert.equal(lines.fill('Hey, it has been {away} days.', ctx({ away: 4 })), 'Hey, it has been 4 days.');
});

check('messages: greetings wave, worries are met gently, the list and exams are answered from the data', () => {
  const r0 = () => 0;
  assert.equal(lines.reply('hii', ctx(), r0).act, 'wave');
  assert.equal(lines.reply('vanakkam', ctx(), r0).text, 'Vanakkam!');
  assert.match(lines.reply('i am so stressed about boards', ctx(), r0).text, /one thing|breathe|a lot/i);
  assert.equal(lines.reply('what should i do next', ctx(), r0).text, 'Next up: Physics notes. 2 left in all.');
  assert.match(lines.reply('when is my exam', ctx(), r0).text, /Chemistry test is in 3 days/);
  assert.match(lines.reply('exam?', ctx({ exam: null }), r0).text, /No exams/);
  assert.equal(lines.reply('lets study', ctx(), r0).focus, true);
  assert.equal(lines.reply('tell me a joke', ctx(), r0).act, 'cheer');
  assert.equal(lines.reply('good night', ctx(), r0).act, 'nap');
  assert.ok(lines.reply('qwertyuiop', ctx(), r0).text.length > 0);
  // "this" is not "hi", "shy" is not "hi"
  assert.notEqual(lines.reply('this is hard', ctx(), r0).act, 'wave');
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
