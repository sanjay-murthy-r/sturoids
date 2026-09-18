#!/usr/bin/env node
/**
 * Handwritten date generator (plain Node, no dependencies).
 *
 *   node scripts/build-handwriting.js           write src/handDate.ts and print a summary
 *   node scripts/build-handwriting.js --check   rebuild in memory; exit 1 if src/handDate.ts is stale
 *
 * Input: scripts/handwriting.raw.json, the "Copy my data" text from the Handwriting Lab ({digits, date}); the lab's
 * two db documents pasted as {"digits": <hand/digits>, "date": <hand/date>} work too.
 *
 * Digits are recorded in guide units: the top line is y 0, the baseline y 1, and x uses the same unit. Each digit is
 * kept at its own size, DH units from its top line to its baseline, and timed the way build-signature.js times the
 * signature: pen lifts clamp to LIFT_MAX, gaps between samples to STEP_MAX, marks shorter than DOT_LEN become dots,
 * every line lasts at least MIN_STROKE_MS, and the samples are joined with Catmull-Rom cubics. Each line's `len` is
 * measured by flattening its cubics, for the intro's dash arithmetic (react-native-svg has no pathLength).
 *
 * The placement is in the signature's viewBox units: each group's anchor is the left end of its baseline; its digits
 * are scaled by size / DH and turned by tilt degrees about the anchor, exactly as the lab draws them.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const RAW_FILE = path.join(__dirname, 'handwriting.raw.json');
const SIG_FILE = path.join(__dirname, '..', 'src', 'signature.ts');
const OUT_FILE = path.join(__dirname, '..', 'src', 'handDate.ts');

const DH = 100;             // a digit, top line to baseline
const LIFT_MAX = 300;       // longest pen lift kept, ms
const STEP_MAX = 220;       // longest gap kept between two samples of one stroke, ms
const MIN_STROKE_MS = 60;   // shortest line duration, ms
const DOT_LEN = 6;          // marks shorter than this many digit units become dots
const REST_EPS = 0.6;       // samples closer than this at a stroke's end are the pen resting, not writing
const CUBIC_SEGMENTS = 24;  // flattening per cubic when measuring a path
const DIGITS = '0123456789'.split('');
const GROUPS = ['dd', 'mm', 'yy'];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const fmt = (v, digits) => {
  const n = +(+v).toFixed(digits);
  return Object.is(n, -0) ? '0' : String(n);
};

function fail(msg) {
  console.error(`build-handwriting: ${msg}`);
  process.exit(2);
}

/* ---------------------------------------------------------------- input */

function readInput() {
  if (!fs.existsSync(RAW_FILE)) fail(`missing ${path.relative(process.cwd(), RAW_FILE)}`);
  const text = fs.readFileSync(RAW_FILE, 'utf8');
  const at = text.indexOf('{'); // skips the "STUROIDS HANDWRITING v1" header line of a lab copy
  if (at < 0) fail('handwriting.raw.json holds no JSON object');
  let data;
  try {
    data = JSON.parse(text.slice(at));
  } catch (e) {
    fail(`handwriting.raw.json is not valid JSON (${e.message})`);
  }
  const digits = data && data.digits && (data.digits.digits || data.digits);
  const date = data && data.date;
  if (!digits || typeof digits !== 'object') fail('no digits found');
  const missing = DIGITS.filter((d) => !digits[d] || !Array.isArray(digits[d].strokes) || !digits[d].strokes.length);
  if (missing.length) fail(`digits not written yet: ${missing.join(' ')}`);
  if (!date || !date.groups || !GROUPS.every((g) => date.groups[g] && isFinite(date.groups[g].x) && isFinite(date.groups[g].y))) {
    fail('no date placement found');
  }
  return { digits, date };
}

/* ---------------------------------------------------------------- model (the lab's, kept at the digit's own size) */

function catmull(pts) {
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || pts[i + 1];
    d += `C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} `
      + `${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)} ${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} `
      + `${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

function buildDigit(raw) {
  const strokes = raw.strokes
    .filter((s) => s && s.pts && s.pts.length)
    .map((s) => s.pts.map((p) => [+p[0] * DH, +p[1] * DH, +p[2]]))
    .filter((s) => s.every((p) => isFinite(p[0]) && isFinite(p[1]) && isFinite(p[2])))
    .sort((a, b) => a[0][2] - b[0][2]);
  // a pen resting at the end of a stroke is not writing: its last still samples go, so the next stroke, or the next
  // digit, follows on instead of waiting out the rest
  for (const s of strokes) {
    while (s.length > 2) {
      const a = s[s.length - 1], b = s[s.length - 2];
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) >= REST_EPS) break;
      s.pop();
    }
  }
  const out = [];
  let cursor = 0;
  let prevEnd = null;
  let x0 = 1e9, x1 = -1e9;
  for (const s of strokes) {
    const gap = prevEnd == null ? 0 : clamp(s[0][2] - prevEnd, 0, LIFT_MAX);
    let t = cursor + gap;
    const pts = [];
    for (let i = 0; i < s.length; i++) {
      if (i > 0) t += clamp(s[i][2] - s[i - 1][2], 0, STEP_MAX);
      pts.push([s[i][0], s[i][1], t]);
      x0 = Math.min(x0, s[i][0]);
      x1 = Math.max(x1, s[i][0]);
    }
    prevEnd = s[s.length - 1][2];
    cursor = t;
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (pts.length < 2 || len < DOT_LEN) {
      let cx = 0, cy = 0;
      pts.forEach((p) => { cx += p[0]; cy += p[1]; });
      out.push({ type: 'dot', cx: cx / pts.length, cy: cy / pts.length, t0: pts[0][2] });
      continue;
    }
    const d = catmull(pts);
    const sArr = [0];
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      sArr.push(acc / len);
    }
    const ts = pts.map((p) => p[2]);
    if (ts[ts.length - 1] - ts[0] < MIN_STROKE_MS) {
      const a = ts[0];
      for (let i = 0; i < ts.length; i++) ts[i] = a + MIN_STROKE_MS * sArr[i];
      cursor = Math.max(cursor, a + MIN_STROKE_MS);
    }
    out.push({ type: 'line', d, s: sArr, ts, len: measurePath(d) });
  }
  return { x0, x1, total: cursor, strokes: out };
}

/** Flattens every cubic of an M..C..C path into CUBIC_SEGMENTS segments (the same measure as build-signature.js). */
function measurePath(d) {
  const n = (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  let x = n[0], y = n[1];
  let len = 0;
  for (let i = 2; i + 5 < n.length; i += 6) {
    const c1x = n[i], c1y = n[i + 1], c2x = n[i + 2], c2y = n[i + 3], ex = n[i + 4], ey = n[i + 5];
    let px = x, py = y;
    for (let j = 1; j <= CUBIC_SEGMENTS; j++) {
      const t = j / CUBIC_SEGMENTS, mt = 1 - t;
      const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, e = t * t * t;
      const bx = a * x + b * c1x + c * c2x + e * ex;
      const by = a * y + b * c1y + c * c2y + e * ey;
      len += Math.hypot(bx - px, by - py);
      px = bx;
      py = by;
    }
    x = ex;
    y = ey;
  }
  return len;
}

/* ---------------------------------------------------------------- output */

function wrapList(values, digits, indent) {
  const items = values.map((v) => fmt(v, digits));
  const lines = [];
  let line = '';
  for (const it of items) {
    const next = line ? `${line}, ${it}` : it;
    if (next.length > 96 - indent.length && line) {
      lines.push(line + ',');
      line = it;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length === 1 ? `[${lines[0]}]` : `[\n${lines.map((l) => indent + '  ' + l).join('\n')}\n${indent}]`;
}

function signatureHeight() {
  if (!fs.existsSync(SIG_FILE)) return null;
  const m = /\bvh:\s*([0-9.]+)/.exec(fs.readFileSync(SIG_FILE, 'utf8'));
  return m ? +m[1] : null;
}

function generate() {
  const input = readInput();
  const models = {};
  for (const ch of DIGITS) {
    models[ch] = buildDigit(input.digits[ch]);
    if (!models[ch].strokes.length) fail(`digit ${ch} has no usable strokes`);
  }
  const date = input.date;
  const vh = signatureHeight();
  const warnings = [];
  if (date.sig && vh != null && Math.abs(+date.sig.vh - vh) > 1) {
    warnings.push(`the placement was made on a signature ${fmt(date.sig.vh, 1)} units tall; src/signature.ts is ${fmt(vh, 1)}`);
  }
  const when = date.when === 'outro' ? 'outro' : 'signature';
  const place = {
    when,
    size: clamp(+date.size || 54, 20, 240),
    gap: clamp(+date.gap || 0, 0, 0.6),
    tilt: clamp(+date.tilt || 0, -45, 45),
    groups: Object.fromEntries(GROUPS.map((g) => [g, { x: Math.round(+date.groups[g].x), y: Math.round(+date.groups[g].y) }])),
  };

  const I = '      ';
  const digitSrc = DIGITS.map((ch) => {
    const m = models[ch];
    const strokes = m.strokes.map((st) => {
      if (st.type === 'dot') return `    { type: 'dot', cx: ${fmt(st.cx, 1)}, cy: ${fmt(st.cy, 1)}, t0: ${fmt(st.t0, 1)} },`;
      return [
        '    {',
        `${I}type: 'line',`,
        `${I}len: ${fmt(st.len, 2)},`,
        `${I}d: '${st.d}',`,
        `${I}s: ${wrapList(st.s, 4, I)},`,
        `${I}ts: ${wrapList(st.ts, 1, I)},`,
        '    },',
      ].join('\n');
    }).join('\n');
    return `  '${ch}': {\n    x0: ${fmt(m.x0, 1)},\n    x1: ${fmt(m.x1, 1)},\n    total: ${fmt(m.total, 1)},\n    strokes: [\n${strokes.split('\n').map((l) => '  ' + l).join('\n')}\n    ],\n  },`;
  }).join('\n');

  const src = `// AUTO-GENERATED by scripts/build-handwriting.js from scripts/handwriting.raw.json. Do not edit.
// To re-record: paste the Handwriting Lab data into scripts/handwriting.raw.json and run
// node scripts/build-handwriting.js (CI: node scripts/build-handwriting.js --check).

export interface HandLine {
  readonly type: 'line';
  /** path length in digit units (each cubic flattened into ${CUBIC_SEGMENTS} segments) */
  readonly len: number;
  /** Catmull-Rom path through the recorded samples, digit units */
  readonly d: string;
  /** arc fraction (0..1) reached at each recorded sample */
  readonly s: readonly number[];
  /** model ms (100% speed, from the digit's first pen-down) at each recorded sample */
  readonly ts: readonly number[];
}

export interface HandDot {
  readonly type: 'dot';
  readonly cx: number;
  readonly cy: number;
  /** model ms of the pen-down */
  readonly t0: number;
}

export type HandStroke = HandLine | HandDot;

/** One handwritten digit, ${DH} units from its top line (y 0) to its baseline (y ${DH}). */
export interface HandDigit {
  /** the ink's left and right edges, digit units */
  readonly x0: number;
  readonly x1: number;
  /** model ms at 100% speed, first pen-down to the last pen-up */
  readonly total: number;
  readonly strokes: readonly HandStroke[];
}

export interface HandPoint {
  readonly x: number;
  readonly y: number;
}

/** Where the date sits on the signature, in its viewBox units. */
export interface HandDatePlace {
  /** 'signature': written straight after the signature; 'outro': cut into the carve after the shine, before the hand-over */
  readonly when: 'signature' | 'outro';
  /** a digit's height */
  readonly size: number;
  /** space between the two digits of a group, as a fraction of a digit's height */
  readonly gap: number;
  /** degrees; each group turns about its anchor */
  readonly tilt: number;
  /** each group's anchor: the left end of its baseline */
  readonly groups: { readonly dd: HandPoint; readonly mm: HandPoint; readonly yy: HandPoint };
}

/** a digit's height in its own units */
export const DIGIT_H = ${DH};

export const DIGITS: Readonly<Record<string, HandDigit>> = {
${digitSrc}
};

export const DATE_PLACE: HandDatePlace = {
  when: '${place.when}',
  size: ${fmt(place.size, 1)},
  gap: ${fmt(place.gap, 2)},
  tilt: ${fmt(place.tilt, 1)},
  groups: {
    dd: { x: ${place.groups.dd.x}, y: ${place.groups.dd.y} },
    mm: { x: ${place.groups.mm.x}, y: ${place.groups.mm.y} },
    yy: { x: ${place.groups.yy.x}, y: ${place.groups.yy.y} },
  },
};
`;
  return { src, models, place, warnings };
}

function printSummary(g) {
  const out = ['handwritten date'];
  for (const ch of DIGITS) {
    const m = g.models[ch];
    const lines = m.strokes.filter((s) => s.type === 'line').length;
    const dots = m.strokes.length - lines;
    out.push(`  ${ch}  width ${fmt(m.x1 - m.x0, 1)}  ${fmt(m.total, 0)} ms  ${lines} line${lines === 1 ? '' : 's'}${dots ? `, ${dots} dot${dots === 1 ? '' : 's'}` : ''}`);
  }
  const p = g.place;
  out.push(`  placement  ${p.when}, size ${fmt(p.size, 1)}, gap ${fmt(p.gap, 2)}, tilt ${fmt(p.tilt, 1)}`);
  out.push(`             dd ${p.groups.dd.x},${p.groups.dd.y}  mm ${p.groups.mm.x},${p.groups.mm.y}  yy ${p.groups.yy.x},${p.groups.yy.y}`);
  g.warnings.forEach((w) => out.push(`  warning    ${w}`));
  console.log(out.join('\n'));
}

/* ---------------------------------------------------------------- main */

const check = process.argv.includes('--check');
const g = generate();
const rel = path.relative(process.cwd(), OUT_FILE);
if (check) {
  const current = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, 'utf8').replace(/\r\n/g, '\n') : null;
  if (current === g.src) {
    console.log(`${rel} is up to date`);
    process.exit(0);
  }
  console.error(current == null
    ? `${rel} is missing; run node scripts/build-handwriting.js`
    : `${rel} is stale; run node scripts/build-handwriting.js`);
  process.exit(1);
}
printSummary(g);
fs.writeFileSync(OUT_FILE, g.src);
console.log(`wrote ${rel}`);
