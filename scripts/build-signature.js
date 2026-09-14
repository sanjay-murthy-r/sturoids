#!/usr/bin/env node
/**
 * Signature model generator (plain Node, no dependencies).
 *
 *   node scripts/build-signature.js           write src/signature.ts and print a summary
 *   node scripts/build-signature.js --check   rebuild in memory; exit 1 if src/signature.ts is stale
 *
 * Input: scripts/signature.raw.json. Either the raw recording
 * {"strokes":[{"pts":[[x, y, tMs], ...]}]} or the whole "Copy my data" text from the Intro Lab
 * (its size and speed picks are then honoured). An Intro Lab db document ({"raw": ...}) and the
 * first lab's pre-built model ({"model": ...}) are accepted too.
 *
 * The model is a faithful port of the Intro Lab's buildModel(): the drawing is fitted to VW units
 * wide, pen lifts clamp to LIFT_MAX and sample gaps inside a stroke to STEP_MAX, marks shorter than
 * DOT_LEN become dots, every line lasts at least MIN_STROKE_MS, and the samples are joined with
 * Catmull-Rom cubics. s[] (arc fraction at each sample) and ts[] (ms at each sample) carry the
 * recorded pen timing, so the pen speed changes inside a stroke as well as between strokes.
 *
 * react-native-svg has no pathLength, so each line's `len` is measured here by flattening every
 * cubic of its path into CUBIC_SEGMENTS segments; the intro's dash arithmetic runs on that length.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const RAW_FILE = path.join(__dirname, 'signature.raw.json');
const OUT_FILE = path.join(__dirname, '..', 'src', 'signature.ts');

const VW = 760;             // model width, viewBox units
const LIFT_MAX = 300;       // longest pen lift kept, ms
const STEP_MAX = 220;       // longest gap kept between two samples of one stroke, ms
const MIN_STROKE_MS = 60;   // shortest line duration, ms
const DOT_LEN = 10;         // marks shorter than this many units become dots
const TAIL_MS = 140;        // settle after the last pen-up, ms
const CUBIC_SEGMENTS = 24;  // flattening per cubic when measuring a path
const DEFAULT_SIZE = 36;    // % of the screen width in the final slot
const DEFAULT_SPEED = 120;  // % of the recorded speed

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const fmt = (v, digits) => {
  const n = +(+v).toFixed(digits);
  return Object.is(n, -0) ? '0' : String(n);
};

function fail(msg) {
  console.error(`build-signature: ${msg}`);
  process.exit(2);
}

/* ---------------------------------------------------------------- input */

const isRaw = (o) => !!(o && Array.isArray(o.strokes) && o.strokes.some((s) => s && Array.isArray(s.pts)));

/** The first lab saved a pre-built model whose y axis was stretched by the pad's 16:10 box. */
function legacyToRaw(m) {
  if (!m || !m.strokes) return null;
  const ky = 10 / 16;
  const strokes = [];
  let t = 0;
  for (const s of m.strokes) {
    t += +s.lift || 0;
    if (s.dot) { strokes.push({ pts: [[s.dot.cx, s.dot.cy * ky, t]] }); t += +s.dur || 0; continue; }
    const pts = [];
    for (const part of s.parts || []) {
      const n = (String(part.d).match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
      if (n.length < 2) continue;
      pts.push([n[0], n[1] * ky]);
      for (let i = 2; i + 5 < n.length; i += 6) pts.push([n[i + 4], n[i + 5] * ky]);
    }
    if (!pts.length) continue;
    const L = [0];
    for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const tot = L[L.length - 1] || 1;
    const dur = +s.dur || 300;
    strokes.push({ pts: pts.map((p, i) => [p[0], p[1], t + (dur * L[i]) / tot]) });
    t += dur;
  }
  return strokes.length ? { strokes } : null;
}

function readInput() {
  if (!fs.existsSync(RAW_FILE)) fail(`missing ${path.relative(process.cwd(), RAW_FILE)}`);
  const text = fs.readFileSync(RAW_FILE, 'utf8');
  const at = text.indexOf('{'); // skips the "STUROIDS INTRO LAB v2" header line of a lab copy
  if (at < 0) fail('signature.raw.json holds no JSON object');
  let data;
  try {
    data = JSON.parse(text.slice(at));
  } catch (e) {
    fail(`signature.raw.json is not valid JSON (${e.message})`);
  }
  let raw = null;
  let source = 'raw recording';
  if (isRaw(data)) raw = data;
  else if (isRaw(data.signature)) { raw = data.signature; source = 'Intro Lab copy'; }
  else if (isRaw(data.raw)) { raw = data.raw; source = 'Intro Lab db document'; }
  else if (data.model) { raw = legacyToRaw(data.model); source = 'legacy lab model'; }
  else if (data.strokes) { raw = legacyToRaw(data); source = 'legacy lab model'; }
  if (!raw) {
    fail(data && data.signatureSource === 'video'
      ? 'this lab copy uses the video signature; press "Use this signature" on a recording first'
      : 'no signature strokes found in signature.raw.json');
  }
  const size = typeof data.size === 'number' ? clamp(data.size, 24, 70) : DEFAULT_SIZE;
  const speed = typeof data.speed === 'number' ? clamp(data.speed, 60, 150) : DEFAULT_SPEED;
  return { raw, source, size, speed };
}

/* ---------------------------------------------------------------- model (port of the lab) */

function buildModel(raw) {
  const strokes = raw.strokes
    .filter((s) => s && s.pts && s.pts.length)
    .map((s) => s.pts.map((p) => [+p[0], +p[1], +p[2]]))
    .filter((s) => s.every((p) => isFinite(p[0]) && isFinite(p[1]) && isFinite(p[2])));
  if (!strokes.length) return null;
  strokes.sort((a, b) => a[0][2] - b[0][2]);

  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  strokes.forEach((s) => s.forEach((p) => {
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[1] > y1) y1 = p[1];
  }));
  const span = Math.max(x1 - x0, (y1 - y0) * 0.4, 1e-3);
  const k = VW / span;
  const VH = Math.max(120, (y1 - y0) * k);
  const oy = (VH - (y1 - y0) * k) / 2;
  const ox = (VW - (x1 - x0) * k) / 2;

  const out = [];
  const stats = { lifts: [], clampedSteps: 0 };
  let cursor = 0;
  let prevEnd = null;
  for (const s of strokes) {
    const rawGap = prevEnd == null ? 0 : s[0][2] - prevEnd;
    const gap = prevEnd == null ? 0 : clamp(rawGap, 0, LIFT_MAX);
    if (prevEnd != null) stats.lifts.push({ raw: rawGap, kept: gap });
    let t = cursor + gap;
    const pts = [];
    for (let i = 0; i < s.length; i++) {
      if (i > 0) {
        const step = s[i][2] - s[i - 1][2];
        if (step > STEP_MAX) stats.clampedSteps++;
        t += clamp(step, 0, STEP_MAX);
      }
      pts.push([(s[i][0] - x0) * k + ox, (s[i][1] - y0) * k + oy, t]);
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
    // Catmull-Rom through the samples; arc-length fractions carry the recorded timing
    let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || pts[i + 1];
      d += `C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} `
        + `${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)} ${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} `
        + `${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
    }
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
    out.push({ type: 'line', d, s: sArr, ts, polyLen: len, pts });
  }
  return { vw: VW, vh: VH, strokes: out, total: cursor + TAIL_MS, stats };
}

/* ---------------------------------------------------------------- measuring */

/** Flattens every cubic of an M..C..C path into CUBIC_SEGMENTS segments. */
function measurePath(d) {
  const n = (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  let x = n[0], y = n[1];
  let len = 0;
  const knots = [0];
  const box = [x, y, x, y];
  for (let i = 2; i + 5 < n.length; i += 6) {
    const c1x = n[i], c1y = n[i + 1], c2x = n[i + 2], c2y = n[i + 3], ex = n[i + 4], ey = n[i + 5];
    let px = x, py = y;
    for (let j = 1; j <= CUBIC_SEGMENTS; j++) {
      const t = j / CUBIC_SEGMENTS, mt = 1 - t;
      const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, e = t * t * t;
      const bx = a * x + b * c1x + c * c2x + e * ex;
      const by = a * y + b * c1y + c * c2y + e * ey;
      len += Math.hypot(bx - px, by - py);
      if (bx < box[0]) box[0] = bx;
      if (by < box[1]) box[1] = by;
      if (bx > box[2]) box[2] = bx;
      if (by > box[3]) box[3] = by;
      px = bx;
      py = by;
    }
    knots.push(len);
    x = ex;
    y = ey;
  }
  return { len, knots, box };
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

function generate() {
  const input = readInput();
  const model = buildModel(input.raw);
  if (!model) fail('the recording has no usable strokes');

  const lines = [];
  const box = [1e9, 1e9, -1e9, -1e9];
  const grow = (b) => {
    box[0] = Math.min(box[0], b[0]); box[1] = Math.min(box[1], b[1]);
    box[2] = Math.max(box[2], b[2]); box[3] = Math.max(box[3], b[3]);
  };
  let lineLength = 0;
  for (const st of model.strokes) {
    if (st.type !== 'line') { grow([st.cx, st.cy, st.cx, st.cy]); continue; }
    const m = measurePath(st.d);
    st.len = +m.len.toFixed(2);
    st.start = +lineLength.toFixed(2);
    st.knots = m.knots;
    lineLength += st.len;
    grow(m.box);
    lines.push(st);
  }
  if (!lines.length) fail('the recording has only dots; at least one line stroke is needed');
  lineLength = +lineLength.toFixed(2);
  const bbox = [Math.floor(box[0] * 10) / 10, Math.floor(box[1] * 10) / 10, Math.ceil(box[2] * 10) / 10, Math.ceil(box[3] * 10) / 10];

  const I = '    ';
  const strokeSrc = model.strokes.map((st) => {
    if (st.type === 'dot') {
      return `  { type: 'dot', cx: ${fmt(st.cx, 1)}, cy: ${fmt(st.cy, 1)}, t0: ${fmt(st.t0, 2)} },`;
    }
    return [
      '  {',
      `${I}type: 'line',`,
      `${I}len: ${fmt(st.len, 2)},`,
      `${I}start: ${fmt(st.start, 2)},`,
      `${I}d: '${st.d}',`,
      `${I}s: ${wrapList(st.s, 4, I)},`,
      `${I}ts: ${wrapList(st.ts, 2, I)},`,
      '  },',
    ].join('\n');
  }).join('\n');

  const size = input.size / 100;
  const speed = input.speed / 100;
  const src = `// AUTO-GENERATED by scripts/build-signature.js from scripts/signature.raw.json. Do not edit.
// To re-record: paste the Intro Lab data into scripts/signature.raw.json and run
// node scripts/build-signature.js (CI: node scripts/build-signature.js --check).

export interface SigLine {
  readonly type: 'line';
  /** path length in viewBox units (each cubic flattened into ${CUBIC_SEGMENTS} segments) */
  readonly len: number;
  /** distance along all line strokes, in stroke order, where this one begins */
  readonly start: number;
  /** Catmull-Rom path through the recorded samples, viewBox units */
  readonly d: string;
  /** arc fraction (0..1) reached at each recorded sample */
  readonly s: readonly number[];
  /** model ms (100% speed, from the first pen-down) at each recorded sample */
  readonly ts: readonly number[];
}

export interface SigDot {
  readonly type: 'dot';
  readonly cx: number;
  readonly cy: number;
  /** model ms of the pen-down */
  readonly t0: number;
}

export type SigStroke = SigLine | SigDot;

export interface SigModel {
  readonly vw: number;
  readonly vh: number;
  /** model ms at 100% speed, first pen-down to the end of the settle */
  readonly total: number;
  /** sum of every line's len */
  readonly lineLength: number;
  /** extents of the drawn geometry [x0, y0, x1, y1]; the cubics may overshoot the viewBox */
  readonly bbox: readonly [number, number, number, number];
  readonly strokes: readonly SigStroke[];
}

export const SIG: SigModel = {
  vw: ${fmt(model.vw, 1)},
  vh: ${fmt(model.vh, 1)},
  total: ${fmt(model.total, 2)},
  lineLength: ${fmt(lineLength, 2)},
  bbox: [${bbox.map((v) => fmt(v, 1)).join(', ')}],
  strokes: [
${strokeSrc.split('\n').map((l) => '  ' + l).join('\n')}
  ],
};

/** width of the signature in its final slot, as a fraction of the screen width */
export const SIG_SIZE = ${fmt(size, 2)};
/** playback speed: recorded timings run at 1 / SIG_SPEED */
export const SIG_SPEED = ${fmt(speed, 2)};
`;
  return { src, model, input, lines, lineLength, bbox, size, speed };
}

/* ---------------------------------------------------------------- summary */

function printSummary(g) {
  const { model, input, lines, lineLength, bbox, speed } = g;
  const real = (ms) => Math.round(ms / speed);
  const out = [];
  out.push(`signature model (${input.source})`);
  out.push(`  viewBox      ${fmt(model.vw, 1)} x ${fmt(model.vh, 1)}`);
  out.push(`  duration     ${fmt(model.total, 2)} ms at 100%, ${real(model.total)} ms at ${Math.round(speed * 100)}%`);
  out.push(`  line length  ${fmt(lineLength, 2)} units (${lines.map((l) => fmt(l.len, 1)).join(' / ')})`);
  out.push(`  size, speed  SIG_SIZE ${fmt(g.size, 2)}, SIG_SPEED ${fmt(g.speed, 2)}`);
  out.push('  strokes (model ms at 100%)');
  let li = 0, di = 0;
  for (const st of model.strokes) {
    if (st.type === 'dot') {
      di++;
      out.push(`    dot ${di}     at (${fmt(st.cx, 1)}, ${fmt(st.cy, 1)})  t0 ${fmt(st.t0, 1)}`);
      continue;
    }
    li++;
    let vMin = Infinity, vMax = 0;
    for (let i = 1; i < st.pts.length; i++) {
      const dt = st.ts[i] - st.ts[i - 1];
      if (dt <= 0) continue;
      const v = Math.hypot(st.pts[i][0] - st.pts[i - 1][0], st.pts[i][1] - st.pts[i - 1][1]) / dt;
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;
    }
    // how far the lab's chord fractions put the pen from each knot along the measured cubic path
    let drift = 0;
    for (let i = 0; i < st.s.length; i++) drift = Math.max(drift, Math.abs(st.s[i] * st.len - st.knots[i]));
    out.push(
      `    line ${li}    ${fmt(st.ts[0], 1)}..${fmt(st.ts[st.ts.length - 1], 1)}  len ${fmt(st.len, 1)} (polyline ${fmt(st.polyLen, 1)})`
      + `  ${st.pts.length} samples  pen ${vMin.toFixed(2)}..${vMax.toFixed(2)} u/ms  knot drift ${drift.toFixed(1)} u`,
    );
  }
  const lifts = model.stats.lifts.filter((l) => l.raw > l.kept);
  out.push(`  lifts        ${model.stats.lifts.map((l) => fmt(l.kept, 0)).join(', ')} ms`
    + (lifts.length ? `  (clamped: ${lifts.map((l) => `${fmt(l.raw, 0)} -> ${fmt(l.kept, 0)}`).join(', ')})` : ''));
  out.push(`  steps        ${model.stats.clampedSteps} intra-stroke gap(s) over ${STEP_MAX} ms clamped`);
  const over = Math.max(0, -bbox[0], -bbox[1], bbox[2] - model.vw, bbox[3] - model.vh);
  out.push(`  bbox         [${bbox.map((v) => fmt(v, 1)).join(', ')}]  overshoot ${fmt(over, 1)} units`);
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
  if (current == null) {
    console.error(`${rel} is missing; run node scripts/build-signature.js`);
  } else {
    const a = current.split('\n'), b = g.src.split('\n');
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    console.error(`${rel} is stale (first difference at line ${i + 1}); run node scripts/build-signature.js`);
  }
  process.exit(1);
}
printSummary(g);
fs.writeFileSync(OUT_FILE, g.src);
console.log(`wrote ${rel}`);
