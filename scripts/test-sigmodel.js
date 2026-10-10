#!/usr/bin/env node
/*
 * Checks for src/sigModel.ts, the runtime halves of scripts/build-signature.js and scripts/build-handwriting.js, run
 * against the real source in Node:
 *   - buildSigModel on scripts/signature.raw.json reproduces SIG in src/signature.ts
 *   - buildDigits and fitDate on scripts/handwriting.raw.json reproduce DIGITS and DATE_FIT in src/handDate.ts
 *   - recordings made on a phone that are odd or damaged (only dots, one tiny stroke, a huge number of points,
 *     timestamps out of order or repeated, junk) give a sound model or null, never a throw
 *   - a placement made for someone who never placed their date, and the check that a recording is a signature
 * Usage: node scripts/test-sigmodel.js   (exit 1 on any failure)
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

const M = load(path.join(ROOT, 'src', 'sigModel.ts'));
const { SIG } = load(path.join(ROOT, 'src', 'signature.ts'));
const { DIGITS, DATE_PLACE, DATE_FIT } = load(path.join(ROOT, 'src', 'handDate.ts'));

const readJson = (file) => {
  const text = fs.readFileSync(path.join(__dirname, file), 'utf8');
  return JSON.parse(text.slice(text.indexOf('{')));
};
const rawSig = (() => {
  const data = readJson('signature.raw.json');
  return data.strokes ? data : data.signature || data.raw;
})();
const rawHand = (() => {
  const data = readJson('handwriting.raw.json');
  return { digits: data.digits.digits || data.digits, date: data.date };
})();

const within = (a, b, share, msg) => assert.ok(Math.abs(a - b) <= Math.abs(b) * share + 1e-9, `${msg}: ${a} vs ${b}`);

/** A model is sound: finite numbers everywhere, ts never going back, s from 0 to 1, a line at least. */
function assertSound(m, msg) {
  assert.ok(m, msg + ': no model');
  assert.ok(isFinite(m.vw) && isFinite(m.vh) && m.vh > 0 && isFinite(m.total) && m.total > 0, msg + ': size and length');
  assert.ok(m.bbox.every(isFinite), msg + ': bbox');
  assert.ok(m.strokes.some((s) => s.type === 'line'), msg + ': a line');
  for (const st of m.strokes) {
    if (st.type === 'dot') {
      assert.ok(isFinite(st.cx) && isFinite(st.cy) && isFinite(st.t0), msg + ': dot');
      continue;
    }
    assert.ok(isFinite(st.len) && st.len > 0, msg + ': len');
    assert.equal(st.s.length, st.ts.length, msg + ': one time per sample');
    assert.equal(st.s[0], 0, msg + ': s starts at 0');
    assert.ok(Math.abs(st.s[st.s.length - 1] - 1) < 1e-3, msg + ': s ends at 1');
    for (let i = 1; i < st.ts.length; i++) {
      assert.ok(isFinite(st.ts[i]) && st.ts[i] >= st.ts[i - 1], `${msg}: ts goes back at ${i}`);
      assert.ok(st.s[i] >= st.s[i - 1], `${msg}: s goes back at ${i}`);
    }
    assert.ok(!/NaN|Infinity/.test(st.d), msg + ': path');
    assert.ok(st.ts[st.ts.length - 1] <= m.total, msg + ': a line ends before the model does');
  }
}

const points = (m) => m.strokes.reduce((n, s) => n + (s.type === 'line' ? s.ts.length : 1), 0);
/** a pen line from (x0, y0) to (x1, y1), n samples, from t at dt ms apart */
const line = (x0, y0, x1, y1, n, t = 0, dt = 16) => ({
  pts: Array.from({ length: n }, (_, i) => [x0 + ((x1 - x0) * i) / (n - 1), y0 + ((y1 - y0) * i) / (n - 1), t + i * dt]),
});
/** one recording of a digit: a loop for 0, a stroke for the rest, enough to build a model */
const digitRec = (ch) => ({
  strokes: ch === '0'
    ? [{ pts: Array.from({ length: 24 }, (_, i) => [0.3 + 0.25 * Math.cos(i / 3.6), 0.5 + 0.45 * Math.sin(i / 3.6), i * 16]) }]
    : [line(0.2 + 0.02 * +ch, 0.05, 0.4, 1, 14)],
});

const checks = {
  'buildSigModel reproduces SIG from signature.raw.json'() {
    const m = M.buildSigModel(rawSig);
    assert.ok(m, 'a model');
    assert.equal(m.vw, SIG.vw);
    assert.equal(m.vh, SIG.vh);
    assert.equal(m.total, SIG.total, 'total');
    within(m.lineLength, SIG.lineLength, 0.005, 'lineLength');
    assert.deepEqual(m.bbox, SIG.bbox, 'bbox');
    assert.equal(m.strokes.length, SIG.strokes.length, 'stroke count');
    m.strokes.forEach((st, i) => {
      const ref = SIG.strokes[i];
      assert.equal(st.type, ref.type, `stroke ${i} type`);
      if (ref.type === 'dot') {
        assert.deepEqual([st.cx, st.cy, st.t0], [ref.cx, ref.cy, ref.t0], `dot ${i}`);
        return;
      }
      within(st.len, ref.len, 0.005, `line ${i} len`);
      within(st.start, ref.start, 0.005, `line ${i} start`);
      assert.equal(st.d, ref.d, `line ${i} path`);
      assert.deepEqual(st.ts, ref.ts, `line ${i} ts`);
      assert.deepEqual(st.s, ref.s, `line ${i} s`);
    });
  },
  'buildDigits reproduces DIGITS from handwriting.raw.json'() {
    const digits = M.buildDigits(rawHand.digits);
    assert.ok(digits, 'digits');
    for (const ch of '0123456789') {
      const a = digits[ch];
      const b = DIGITS[ch];
      assert.deepEqual([a.x0, a.x1, a.total], [b.x0, b.x1, b.total], `digit ${ch} extents and total`);
      assert.equal(a.strokes.length, b.strokes.length, `digit ${ch} strokes`);
      a.strokes.forEach((st, i) => {
        const ref = b.strokes[i];
        assert.equal(st.type, ref.type, `digit ${ch} stroke ${i} type`);
        if (ref.type === 'dot') {
          assert.deepEqual([st.cx, st.cy, st.t0], [ref.cx, ref.cy, ref.t0], `digit ${ch} dot ${i}`);
          return;
        }
        within(st.len, ref.len, 0.005, `digit ${ch} line ${i} len`);
        assert.equal(st.d, ref.d, `digit ${ch} line ${i} path`);
        assert.deepEqual(st.ts, ref.ts, `digit ${ch} line ${i} ts`);
        assert.deepEqual(st.s, ref.s, `digit ${ch} line ${i} s`);
      });
    }
  },
  'fitDate reproduces DATE_FIT, on the built-in models and on the rebuilt ones'() {
    const place = M.clampPlace(rawHand.date);
    assert.deepEqual(place, DATE_PLACE, 'the placement reads as the generator reads it');
    assert.deepEqual(M.fitDate(SIG, DIGITS, DATE_PLACE), DATE_FIT, 'from SIG and DIGITS');
    const sig = M.buildSigModel(rawSig);
    const digits = M.buildDigits(rawHand.digits);
    assert.deepEqual(M.fitDate(sig, digits, place), DATE_FIT, 'from the rebuilt models');
  },
  'fitDate for given dates fits only the pairs they show, exactly as the full fit does'() {
    const dates = ['220226', '311299', '010101'];
    const some = M.fitDate(SIG, DIGITS, DATE_PLACE, dates);
    for (const [gi, g] of ['dd', 'mm', 'yy'].entries()) {
      const pairs = new Set(dates.map((d) => d.slice(gi * 2, gi * 2 + 2)));
      for (const pair of Object.keys(some[g])) assert.ok(pairs.has(pair), `${g} ${pair} was not asked for`);
      for (const pair of pairs) assert.deepEqual(some[g][pair], DATE_FIT[g][pair], `${g} ${pair}`);
    }
    assert.deepEqual(M.fitDate(SIG, DIGITS, DATE_PLACE, '220226'), { dd: { 22: DATE_FIT.dd['22'] }, mm: { '02': DATE_FIT.mm['02'] }, yy: {} });
    assert.deepEqual(M.fitDate(SIG, DIGITS, DATE_PLACE, 'junk'), { dd: {}, mm: {}, yy: {} }, 'a date that is not ddmmyy asks for nothing');
  },
  'a recording of dots only has no model; one tiny stroke is a model, but not a signature'() {
    const dots = { strokes: [{ pts: [[0.2, 0.2, 0]] }, { pts: [[0.5, 0.3, 200], [0.5001, 0.3, 216]] }, { pts: [[0.8, 0.25, 400]] }] };
    assert.equal(M.buildSigModel(dots), null);
    assert.equal(M.buildSigModel({ strokes: [{ pts: [[0.4, 0.4, 0]] }] }), null, 'a tap on its own is a dot');
    // the model is fitted to its own size, as the generator fits it, so a tiny stroke comes out full width and sound;
    // what is too small to keep is the recorder's call (signatureProblem)
    assertSound(M.buildSigModel({ strokes: [line(0.4, 0.4, 0.4005, 0.4002, 5)] }), 'a tiny stroke');
    assert.equal(M.signatureProblem(dots), 'dots');
    assert.equal(M.signatureProblem({ strokes: [line(0.4, 0.4, 0.4005, 0.4002, 5)] }), 'dots');
    assert.equal(M.signatureProblem({ strokes: [line(0.4, 0.4, 0.46, 0.42, 6)] }), 'small', 'a short scribble in a corner');
    assert.equal(M.signatureProblem({ strokes: [] }), 'empty');
    assert.equal(M.signatureProblem(null), 'empty');
    assert.equal(M.signatureProblem(rawSig), null, 'the creator signature is a signature');
  },
  'a single small line is still a model, scaled up to the full width'() {
    const m = M.buildSigModel({ strokes: [line(0.4, 0.4, 0.46, 0.42, 6)] });
    assertSound(m, 'small line');
    assert.equal(m.strokes.length, 1);
    assert.ok(m.bbox[2] - m.bbox[0] > 700, 'fitted to the model width');
  },
  'a huge recording is thinned to about 1200 points and still plays'() {
    const strokes = [];
    for (let s = 0; s < 6; s++) {
      strokes.push({
        pts: Array.from({ length: 1000 }, (_, i) => [0.1 + s * 0.12 + 0.1 * Math.sin(i / 50), 0.3 + 0.2 * Math.cos(i / 37), s * 9000 + i * 8]),
      });
    }
    const m = M.buildSigModel({ strokes });
    assertSound(m, 'huge');
    assert.ok(points(m) <= 1200, `${points(m)} points`);
    assert.equal(m.strokes.length, 6);
    // thousands of strokes: the first ones are kept, and it stays a model
    const many = M.buildSigModel({ strokes: Array.from({ length: 2000 }, (_, i) => line(0.001 * i, 0.2, 0.001 * i + 0.3, 0.5, 3, i * 50)) });
    assertSound(many, 'many strokes');
    assert.ok(points(many) <= 1200);
  },
  'timestamps out of order or repeated still give a model whose pen only moves forward'() {
    const strokes = [
      { pts: [[0.6, 0.3, 900], [0.7, 0.35, 900], [0.8, 0.3, 900], [0.9, 0.4, 900]] },
      { pts: [[0.1, 0.5, 500], [0.2, 0.4, 480], [0.3, 0.5, 520], [0.4, 0.3, 510], [0.5, 0.45, 9000]] },
      { pts: [[0.15, 0.2, -50], [0.25, 0.25, -60], [0.35, 0.2, -10]] },
      { pts: [[0.5, 0.6, 700], [0.55, 0.62, 700]] },
    ];
    const m = M.buildSigModel({ strokes });
    assertSound(m, 'disordered');
    // strokes are written in the order they began
    const firstLine = m.strokes.find((s) => s.type === 'line');
    assert.equal(firstLine.ts[0], 0, 'the earliest stroke starts the pen');
    // a stroke whose time does not move lasts the shortest line, and the lifts are clamped
    assert.ok(m.total < 2000, `total ${m.total}`);
  },
  'junk never throws'() {
    for (const junk of [undefined, null, 0, 'x', {}, { strokes: 'x' }, { strokes: [null, 1, { pts: 'x' }] },
      { strokes: [{ pts: [[NaN, 1, 2], [1, Infinity, 2], ['a', 'b', 'c'], [1, 2]] }] }]) {
      assert.equal(M.buildSigModel(junk), null, JSON.stringify(junk));
      assert.equal(M.buildDigits(junk), null, JSON.stringify(junk));
    }
    // non-finite points are dropped, the rest stands
    const m = M.buildSigModel({ strokes: [{ pts: [[0.1, 0.2, 0], [NaN, 0.2, 10], [0.5, 0.4, 20], [0.9, 0.3, 40]] }] });
    assertSound(m, 'with a bad point');
  },
  'digits need all ten, each with something written'() {
    const rec = Object.fromEntries('0123456789'.split('').map((ch) => [ch, digitRec(ch)]));
    const digits = M.buildDigits(rec);
    assert.ok(digits);
    for (const ch of '0123456789') assert.ok(digits[ch].strokes.length && isFinite(digits[ch].total), ch);
    const missing = { ...rec };
    delete missing['7'];
    assert.equal(M.buildDigits(missing), null, 'one missing');
    assert.equal(M.buildDigits({ ...rec, 3: { strokes: [] } }), null, 'one empty');
  },
  'a default placement sits under the signature, needs no room, and fits on any signature'() {
    const digits = M.buildDigits(rawHand.digits);
    const place = M.defaultPlace(SIG, digits);
    assert.equal(place.when, 'signature');
    assert.equal(place.tilt, 0);
    for (const g of ['dd', 'mm', 'yy']) {
      assert.ok(Number.isInteger(place.groups[g].x) && Number.isInteger(place.groups[g].y), g);
      assert.ok(place.groups[g].y - place.size > SIG.bbox[3], `${g} sits below the signature`);
    }
    assert.ok(place.groups.dd.x < place.groups.mm.x && place.groups.mm.x < place.groups.yy.x, 'day, month, year');
    const fits = M.fitDate(SIG, digits, place);
    assert.deepEqual(fits, { dd: {}, mm: {}, yy: {} }, 'nothing runs into the signature');
    // a placement from storage is clamped as the generator clamps it
    const wild = M.clampPlace({ ...place, size: 999, gap: -1, tilt: 90, when: 'x' });
    assert.deepEqual([wild.size, wild.gap, wild.tilt, wild.when], [240, 0, 45, 'signature']);
    // without digits a placement still comes out
    const blind = M.defaultPlace(M.buildSigModel({ strokes: [line(0.1, 0.5, 0.9, 0.45, 20)] }));
    assert.ok(['dd', 'mm', 'yy'].every((g) => isFinite(blind.groups[g].x) && isFinite(blind.groups[g].y)));
  },
  'a date reads as day, month and two-digit year'() {
    assert.equal(M.dateDigits(new Date(2026, 9, 9)), '091026');
    assert.equal(M.dateDigits(new Date(2031, 0, 31)), '310131');
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
console.log(failed ? `\ntest-sigmodel: ${failed} failed` : '\ntest-sigmodel: all passed');
process.exit(failed ? 1 : 0);
