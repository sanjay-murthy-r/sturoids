/**
 * The runtime halves of scripts/build-signature.js and scripts/build-handwriting.js, so a signature and digits recorded
 * on the phone become the same models the intro plays for the built-in one (src/signature.ts, src/handDate.ts).
 *
 * The steps are the generators' own, number for number: scripts/test-sigmodel.js rebuilds SIG, DIGITS and DATE_FIT
 * from the raw recordings with these functions and checks they come out the same. The generators stay the source of
 * the built-in signature; this file only has to agree with them.
 *
 * Pure TypeScript with no React Native imports, so the test can load it in Node. Every builder takes untrusted input
 * (a recording from storage or an import) and returns null instead of throwing when it cannot make a model of it.
 */
import type { SigDot, SigLine, SigModel, SigStroke } from './signature';
import type { HandDatePlace, HandDigit, HandDot, HandFit, HandFits, HandLine, HandStroke } from './handDate';

/* ---------------------------------------------------------------- recordings */

/** One recorded pen point: x and y in the recorder's unit, t in ms from the first touch. */
export type RecPoint = readonly [number, number, number];
export interface RecStroke { readonly pts: readonly RecPoint[] }
export interface Recording { readonly strokes: readonly RecStroke[] }
/** Each digit '0' to '9', recorded in guide units: the cap line is y 0, the baseline y 1, and x uses the same unit. */
export type DigitRecordings = Readonly<Record<string, { readonly strokes: readonly RecStroke[] }>>;

export type DigitMap = Readonly<Record<string, HandDigit>>;
export interface DateFits { readonly dd: HandFits; readonly mm: HandFits; readonly yy: HandFits }
/** The parts of a date, in the order they are written: the day, the month, the two-digit year. */
export type DatePart = 'dd' | 'mm' | 'yy';
/**
 * Where the date goes, and which of its parts are written: absent, all three. A placement made here leaves `parts`
 * out when all three are written, so the creator's placement, and every one saved before parts existed, reads the same.
 */
export interface DatePlace extends HandDatePlace {
  readonly parts?: readonly DatePart[];
}
/** Everything the intro needs to write a date after a signature: the digits, where they go, and the room they make. */
export interface Hand {
  readonly digits: DigitMap;
  readonly place: DatePlace;
  readonly fit: DateFits;
}

/* ---------------------------------------------------------------- the generators' constants */

const VW = 760;             // model width, viewBox units
const LIFT_MAX = 300;       // longest pen lift kept, ms
const STEP_MAX = 220;       // longest gap kept between two samples of one stroke, ms
const MIN_STROKE_MS = 60;   // shortest line duration, ms
const SIG_DOT_LEN = 10;     // signature marks shorter than this many units become dots
const TAIL_MS = 140;        // settle after the last pen-up, ms
const CUBIC_SEGMENTS = 24;  // flattening per cubic when measuring a path

export const DIGIT_H = 100; // a digit, top line to baseline
const DIGIT_DOT_LEN = 6;    // digit marks shorter than this many digit units become dots
const REST_EPS = 0.6;       // samples closer than this at a stroke's end are the pen resting, not writing

const FIT_CLEAR = 14;       // closest a date's centre line may come to the signature's, viewBox units
const FIT_MIN_GAP = 0.5;    // a pair's inner gap tightens to no less than this share of the chosen gap
const FIT_MIN_SCALE = 0.8;  // and a pair is written no smaller than this

/** A recording on the phone can run long: the model keeps at most this many points (the path is drawn every frame). */
const SIG_MAX_POINTS = 1200;
const SIG_MAX_STROKES = 300;
const DIGIT_MAX_POINTS = 400;

export const DIGIT_KEYS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;
const GROUPS = ['dd', 'mm', 'yy'] as const;
type Group = DatePart;
/** every part of a date, in the order it is written */
export const DATE_PARTS: readonly DatePart[] = GROUPS;
const pad2 = (n: number) => String(n).padStart(2, '0');
/** every pair a group can show */
const VALUES: Record<Group, string[]> = {
  dd: Array.from({ length: 31 }, (_, i) => pad2(i + 1)),
  mm: Array.from({ length: 12 }, (_, i) => pad2(i + 1)),
  yy: Array.from({ length: 100 }, (_, i) => pad2(i)),
};

/** The ranges the Handwriting Lab allows, which the generator clamps to. */
export const DATE_LIMITS = {
  size: { min: 20, max: 240 },
  gap: { min: 0, max: 0.6 },
  tilt: { min: -45, max: 45 },
} as const;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
/** The generators write numbers with toFixed; the models here are rounded the same way. */
const round = (v: number, digits: number) => {
  const n = +v.toFixed(digits);
  return Object.is(n, -0) ? 0 : n;
};
const finite = (n: number) => typeof n === 'number' && isFinite(n);

/* ---------------------------------------------------------------- which parts of the date are written */

/** The parts written, in their fixed order: whichever valid ones are listed, else all three. Never none. */
export function datePartsOf(parts?: readonly unknown[] | null): DatePart[] {
  if (!Array.isArray(parts)) return [...GROUPS];
  const out = GROUPS.filter((g) => parts.includes(g));
  return out.length ? out : [...GROUPS];
}

/** A placement with these parts written: `parts` set only when not all three are, so a full date stores as before. */
export function withParts(place: HandDatePlace, parts?: readonly unknown[] | null): DatePlace {
  const chosen = datePartsOf(parts);
  const rest: DatePlace = { when: place.when, size: place.size, gap: place.gap, tilt: place.tilt, groups: place.groups };
  return chosen.length < GROUPS.length ? { ...rest, parts: chosen } : rest;
}

/** The pairs of a date (ddmmyy) that are written, in order, each with its part. */
export function datePairs(date: string, parts?: readonly unknown[] | null): { group: DatePart; pair: string }[] {
  return datePartsOf(parts).map((group) => {
    const at = GROUPS.indexOf(group) * 2;
    return { group, pair: date.slice(at, at + 2) };
  });
}

/** A date in words, as the intro writes it: only its chosen parts, in order, a middle dot between them ("23 · 10"). */
export function dateText(date: string, parts?: readonly unknown[] | null): string {
  return datePairs(date, parts).map((p) => p.pair).join(' · ');
}

type Pt = [number, number, number];

/** A recording's strokes as plain number triples, every point that is not three finite numbers left out. */
function readStrokes(strokes: readonly RecStroke[] | undefined, scale: number): Pt[][] {
  if (!Array.isArray(strokes)) return [];
  const out: Pt[][] = [];
  for (const s of strokes) {
    if (!s || !Array.isArray(s.pts)) continue;
    const pts: Pt[] = [];
    for (const p of s.pts) {
      if (!Array.isArray(p)) continue;
      const q: Pt = [+p[0] * scale, +p[1] * scale, +p[2]];
      if (finite(q[0]) && finite(q[1]) && finite(q[2])) pts.push(q);
    }
    if (pts.length) out.push(pts);
  }
  return out;
}

/**
 * Thins strokes evenly to at most `max` points in all: every stroke keeps its first and last point, the rest share what
 * is left in proportion to their length (as the store thins a saved recording).
 */
function thin(strokes: Pt[][], max: number): Pt[][] {
  const total = strokes.reduce((n, s) => n + s.length, 0);
  if (total <= max) return strokes;
  const ends = strokes.reduce((n, s) => n + Math.min(2, s.length), 0);
  const spare = Math.max(0, max - ends);
  const middles = total - ends;
  return strokes.map((s) => {
    const n = s.length;
    if (n <= 2) return s;
    const keep = 2 + Math.floor(((n - 2) * spare) / middles);
    if (keep >= n) return s;
    const pts: Pt[] = [];
    for (let i = 0; i < keep; i++) pts.push(s[Math.round((i * (n - 1)) / (keep - 1))]);
    return pts;
  });
}

/** Catmull-Rom cubics through the samples, as both generators write them. */
function catmull(pts: Pt[]): string {
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || pts[i + 1];
    d += `C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} `
      + `${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)} ${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} `
      + `${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

const pathNumbers = (d: string) => (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);

/** Flattens every cubic of an M..C..C path into CUBIC_SEGMENTS segments: its length and its extents. */
function measurePath(d: string): { len: number; box: [number, number, number, number] } {
  const n = pathNumbers(d);
  let x = n[0], y = n[1];
  let len = 0;
  const box: [number, number, number, number] = [x, y, x, y];
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
    x = ex;
    y = ey;
  }
  return { len, box };
}

/** Points along every cubic of an M..C..C path, CUBIC_SEGMENTS per cubic. */
function samplePath(d: string): [number, number][] {
  const n = pathNumbers(d);
  const out: [number, number][] = [[n[0], n[1]]];
  let x = n[0], y = n[1];
  for (let i = 2; i + 5 < n.length; i += 6) {
    const c1x = n[i], c1y = n[i + 1], c2x = n[i + 2], c2y = n[i + 3], ex = n[i + 4], ey = n[i + 5];
    for (let j = 1; j <= CUBIC_SEGMENTS; j++) {
      const t = j / CUBIC_SEGMENTS, mt = 1 - t;
      const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, e = t * t * t;
      out.push([a * x + b * c1x + c * c2x + e * ex, a * y + b * c1y + c * c2y + e * ey]);
    }
    x = ex;
    y = ey;
  }
  return out;
}

/* ---------------------------------------------------------------- the signature (scripts/build-signature.js) */

/**
 * A recording turned into the intro's model, as build-signature.js builds SIG: fitted to VW units wide, pen lifts
 * clamped to LIFT_MAX and gaps inside a stroke to STEP_MAX, marks shorter than DOT_LEN as dots, every line at least
 * MIN_STROKE_MS, Catmull-Rom paths, each line's len measured by flattening, s[] and ts[] carrying the recorded timing.
 * Null when it holds no line at all (a recording of dots only, or nothing usable).
 */
export function buildSigModel(rec: Recording | null | undefined): SigModel | null {
  try {
    if (!rec || !Array.isArray(rec.strokes)) return null;
    let strokes = readStrokes(rec.strokes, 1).sort((a, b) => a[0][2] - b[0][2]);
    if (!strokes.length) return null;
    if (strokes.length > SIG_MAX_STROKES) strokes = strokes.slice(0, SIG_MAX_STROKES);
    strokes = thin(strokes, SIG_MAX_POINTS);

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

    const out: SigStroke[] = [];
    const box = [1e9, 1e9, -1e9, -1e9];
    const grow = (b: readonly number[]) => {
      box[0] = Math.min(box[0], b[0]); box[1] = Math.min(box[1], b[1]);
      box[2] = Math.max(box[2], b[2]); box[3] = Math.max(box[3], b[3]);
    };
    let lineLength = 0;
    let lines = 0;
    let cursor = 0;
    let prevEnd: number | null = null;
    for (const s of strokes) {
      const gap = prevEnd == null ? 0 : clamp(s[0][2] - prevEnd, 0, LIFT_MAX);
      let t = cursor + gap;
      const pts: Pt[] = [];
      for (let i = 0; i < s.length; i++) {
        if (i > 0) t += clamp(s[i][2] - s[i - 1][2], 0, STEP_MAX);
        pts.push([(s[i][0] - x0) * k + ox, (s[i][1] - y0) * k + oy, t]);
      }
      prevEnd = s[s.length - 1][2];
      cursor = t;

      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (pts.length < 2 || len < SIG_DOT_LEN) {
        let cx = 0, cy = 0;
        pts.forEach((p) => { cx += p[0]; cy += p[1]; });
        cx /= pts.length;
        cy /= pts.length;
        grow([cx, cy, cx, cy]);
        const dot: SigDot = { type: 'dot', cx: round(cx, 1), cy: round(cy, 1), t0: round(pts[0][2], 2) };
        out.push(dot);
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
      const m = measurePath(d);
      const line: SigLine = {
        type: 'line', len: round(m.len, 2), start: round(lineLength, 2), d, s: sArr.map((v) => round(v, 4)), ts: ts.map((v) => round(v, 2)),
      };
      lineLength += line.len;
      lines++;
      grow(m.box);
      out.push(line);
    }
    if (!lines) return null;
    const total = cursor + TAIL_MS;
    if (!finite(total) || !finite(VH)) return null;
    return {
      vw: VW,
      vh: round(VH, 1),
      total: round(total, 2),
      lineLength: round(lineLength, 2),
      bbox: [Math.floor(box[0] * 10) / 10, Math.floor(box[1] * 10) / 10, Math.ceil(box[2] * 10) / 10, Math.ceil(box[3] * 10) / 10],
      strokes: out,
    };
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- the digits (scripts/build-handwriting.js) */

function buildDigit(raw: readonly RecStroke[] | undefined): HandDigit | null {
  let strokes = readStrokes(raw, DIGIT_H).sort((a, b) => a[0][2] - b[0][2]);
  if (!strokes.length) return null;
  strokes = thin(strokes, DIGIT_MAX_POINTS).map((s) => s.slice());
  // a pen resting at the end of a stroke is not writing: its last still samples go, so the next stroke, or the next
  // digit, follows on instead of waiting out the rest
  for (const s of strokes) {
    while (s.length > 2) {
      const a = s[s.length - 1], b = s[s.length - 2];
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) >= REST_EPS) break;
      s.pop();
    }
  }
  const out: HandStroke[] = [];
  let cursor = 0;
  let prevEnd: number | null = null;
  let x0 = 1e9, x1 = -1e9;
  for (const s of strokes) {
    const gap = prevEnd == null ? 0 : clamp(s[0][2] - prevEnd, 0, LIFT_MAX);
    let t = cursor + gap;
    const pts: Pt[] = [];
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
    if (pts.length < 2 || len < DIGIT_DOT_LEN) {
      let cx = 0, cy = 0;
      pts.forEach((p) => { cx += p[0]; cy += p[1]; });
      const dot: HandDot = { type: 'dot', cx: round(cx / pts.length, 1), cy: round(cy / pts.length, 1), t0: round(pts[0][2], 1) };
      out.push(dot);
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
    const line: HandLine = {
      type: 'line', len: round(measurePath(d).len, 2), d, s: sArr.map((v) => round(v, 4)), ts: ts.map((v) => round(v, 1)),
    };
    out.push(line);
  }
  if (!out.length || !finite(x0) || !finite(x1) || !finite(cursor)) return null;
  return { x0: round(x0, 1), x1: round(x1, 1), total: round(cursor, 1), strokes: out };
}

/**
 * Ten recorded digits turned into the intro's DIGITS, as build-handwriting.js builds them: each kept at its own size,
 * DIGIT_H units from its cap line to its baseline, the pen's rest at a stroke's end trimmed. Null unless all ten are
 * there and usable.
 */
export function buildDigits(rec: DigitRecordings | null | undefined): DigitMap | null {
  try {
    if (!rec || typeof rec !== 'object') return null;
    const out: Record<string, HandDigit> = {};
    for (const ch of DIGIT_KEYS) {
      const m = rec[ch] ? buildDigit(rec[ch].strokes) : null;
      if (!m) return null;
      out[ch] = m;
    }
    return out;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- the date's room (build-handwriting.js fitDates) */

/**
 * How far any point is from the signature's strokes, as the generator's map of one-unit cells reads it: the distance
 * from the cell the point rounds to, to the nearest sample within FIT_CLEAR + 10 cells, else Infinity. The generator
 * fills every cell up front; on a phone that is millions of steps, so a cell is worked out the first time it is asked
 * for, from the samples in the buckets around it, and kept. Null when there is nothing to measure against.
 */
function signatureField(sig: SigModel): ((x: number, y: number) => number) | null {
  const pts: [number, number][] = [];
  for (const st of sig.strokes) {
    if (st.type === 'line') pts.push(...samplePath(st.d));
    else pts.push([st.cx, st.cy]);
  }
  if (!pts.length) return null;
  const R = FIT_CLEAR + 10;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const X0 = Math.floor(minX) - R, Y0 = Math.floor(minY) - R;
  const W = Math.ceil(maxX) + R - X0, H = Math.ceil(maxY) + R - Y0;
  if (!(W > 0 && H > 0) || W * H > 4e6) return null;
  // samples by the cell they round to, in square buckets
  const B = 16;
  const BW = Math.ceil(W / B), BH = Math.ceil(H / B);
  const buckets = new Map<number, number[]>();
  const cells = new Int32Array(pts.length * 2);
  pts.forEach(([sx, sy], i) => {
    const cx = Math.round(sx) - X0, cy = Math.round(sy) - Y0;
    cells[i * 2] = cx;
    cells[i * 2 + 1] = cy;
    const key = Math.floor(cy / B) * BW + Math.floor(cx / B);
    const list = buckets.get(key);
    if (list) list.push(i);
    else buckets.set(key, [i]);
  });
  const memo = new Float32Array(W * H).fill(NaN);
  return (x, y) => {
    const ix = Math.round(x) - X0, iy = Math.round(y) - Y0;
    if (ix < 0 || iy < 0 || ix >= W || iy >= H) return Infinity;
    const at = iy * W + ix;
    const known = memo[at];
    if (known === known) return known;
    let best = Infinity;
    const bx0 = Math.max(0, Math.floor((ix - R) / B)), bx1 = Math.min(BW - 1, Math.floor((ix + R) / B));
    const by0 = Math.max(0, Math.floor((iy - R) / B)), by1 = Math.min(BH - 1, Math.floor((iy + R) / B));
    for (let by = by0; by <= by1; by++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const list = buckets.get(by * BW + bx);
        if (!list) continue;
        for (const i of list) {
          // the generator fills the cells within R of the cell a sample rounds to, and nothing further
          if (Math.abs(cells[i * 2] - ix) > R || Math.abs(cells[i * 2 + 1] - iy) > R) continue;
          const d = Math.hypot(ix + X0 - pts[i][0], iy + Y0 - pts[i][1]);
          if (d < best) best = d;
        }
      }
    }
    memo[at] = best;
    return memo[at];
  };
}

/** The pairs a list of dates (ddmmyy) shows, by group; every pair a group can show when there is no list. */
function pairsFor(dates?: string | readonly string[]): Record<Group, string[]> {
  if (dates == null) return VALUES;
  const list = typeof dates === 'string' ? [dates] : dates;
  const out: Record<Group, string[]> = { dd: [], mm: [], yy: [] };
  for (const date of list) {
    if (typeof date !== 'string' || !/^\d{6}$/.test(date)) continue;
    GROUPS.forEach((g, gi) => {
      const pair = date.slice(gi * 2, gi * 2 + 2);
      if (!out[g].includes(pair)) out[g].push(pair);
    });
  }
  return out;
}

/**
 * Where each pair would run into the signature, the tighter gap (and, if needed, the smaller size) that clears it, as
 * build-handwriting.js works out DATE_FIT: the space inside the pair tightens down to half the chosen gap, then the
 * pair is written a little smaller, down to 80%; the anchors never move. `dates` (ddmmyy, one or a list) limits the
 * work to the pairs those dates show, which is all the intro needs at launch; without it every pair is fitted. Only the
 * parts the placement writes are fitted.
 */
export function fitDate(sig: SigModel, digits: DigitMap, place: DatePlace, dates?: string | readonly string[]): DateFits {
  const fits: Record<Group, Record<string, HandFit>> = { dd: {}, mm: {}, yy: {} };
  const field = signatureField(sig);
  if (!field) return fits;
  // each digit's ink as flat x, y pairs
  const inkPts: Record<string, Float64Array> = {};
  for (const ch of DIGIT_KEYS) {
    const m = digits[ch];
    if (!m) return fits;
    const pts = m.strokes.flatMap((st) => (st.type === 'line' ? samplePath(st.d) : [[st.cx, st.cy] as [number, number]]));
    const flat = new Float64Array(pts.length * 2);
    pts.forEach(([x, y], i) => { flat[i * 2] = x; flat[i * 2 + 1] = y; });
    inkPts[ch] = flat;
  }
  const rad = (place.tilt * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const advance = (ch: string) => Math.max(14, digits[ch].x1 - digits[ch].x0);
  /**
   * How close one digit of a group comes to the signature, `x` digit units along the group. With `stopBelow`, it stops
   * at the first point closer than that: whether a pair clears is all the search needs, and most tries fail early.
   */
  const digitClearance = (group: Group, ch: string, x: number, scale: number, stopBelow = -Infinity) => {
    const P = place.groups[group];
    const S = (place.size / DIGIT_H) * scale;
    const ink = inkPts[ch];
    const dx = x - digits[ch].x0;
    let best = Infinity;
    for (let i = 0; i < ink.length; i += 2) {
      const lx = (ink[i] + dx) * S, ly = (ink[i + 1] - DIGIT_H) * S;
      const d = field(P.x + lx * cos - ly * sin, P.y + lx * sin + ly * cos);
      if (d < best) {
        best = d;
        if (d < stopBelow) return d;
      }
    }
    return best;
  };
  /** How close a pair written this way comes to the signature, measured in full (the generator's clearance). */
  const clearance = (group: Group, pair: string, gap: number, scale: number) => Math.min(
    digitClearance(group, pair[0], 0, scale),
    digitClearance(group, pair[1], advance(pair[0]) + gap * DIGIT_H, scale),
  );
  // a pair's first digit does not move as the gap tightens, so whether it clears is worked out once per size
  const firstClears = new Map<string, boolean>();
  const clears = (group: Group, pair: string, gap: number, scale: number) => {
    const key = group + pair[0] + scale;
    let first = firstClears.get(key);
    if (first === undefined) {
      first = digitClearance(group, pair[0], 0, scale, FIT_CLEAR) >= FIT_CLEAR;
      firstClears.set(key, first);
    }
    return first && digitClearance(group, pair[1], advance(pair[0]) + gap * DIGIT_H, scale, FIT_CLEAR) >= FIT_CLEAR;
  };
  const values = pairsFor(dates);
  // only the parts the date writes are fitted: the others are never on the page
  for (const group of datePartsOf(place.parts)) {
    for (const pair of values[group]) {
      if (clears(group, pair, place.gap, 1)) continue;
      // the generator's tries, in its order: the gap tightens a hundredth at a time, then the size comes down
      const tries: [number, number][] = [];
      const minGap = place.gap * FIT_MIN_GAP;
      for (let k = 1; ; k++) {
        const gap = Math.max(minGap, place.gap - 0.01 * k);
        tries.push([gap, 1]);
        if (gap <= minGap) break;
      }
      for (let k = 1; ; k++) {
        const scale = Math.max(FIT_MIN_SCALE, 1 - 0.01 * k);
        tries.push([minGap, scale]);
        if (scale <= FIT_MIN_SCALE) break;
      }
      let chosen = tries.find(([gap, scale]) => clears(group, pair, gap, scale));
      if (!chosen) {
        // nothing clears: the try that comes least close, measured in full (the first of equals, as the generator keeps)
        let closest = { gap: place.gap, scale: 1, d: -Infinity };
        for (const [gap, scale] of tries) {
          const d = clearance(group, pair, gap, scale);
          if (d > closest.d) closest = { gap, scale, d };
        }
        chosen = [closest.gap, closest.scale];
      }
      fits[group][pair] = { gap: round(chosen[0], 2), scale: round(chosen[1], 2) };
    }
  }
  return fits;
}

/* ---------------------------------------------------------------- placement */

/** The generator's defaults for a placement it is not given: a digit 54 units high, upright. */
const DEFAULT_SIZE = 54;
const DEFAULT_TILT = 0;
/**
 * The generator's default gap is 0, which is only its fallback for missing data: two handwritten digits with no space
 * between them run together, so a placement made here starts with a little air inside each pair.
 */
const DEFAULT_GAP = 0.25;
/** the room between two groups set in a row, as a share of the size */
const ROW_SPACE = 0.45;
/** how far a group can reach above its baseline (a tall digit's top) and below it (a tail), as a share of the size */
export const DATE_TOP = 1.15;
export const DATE_FOOT = 0.2;

export type Box = readonly [number, number, number, number];
type Anchor = { x: number; y: number };

/**
 * A placement read from storage, clamped to what the lab allows (and the anchors rounded), as the generator reads one.
 * The parts written are kept when they are a real choice (fewer than all three), in their order.
 */
export function clampPlace(p: DatePlace): DatePlace {
  const at = (q: { x: number; y: number }) => ({ x: Math.round(+q.x || 0), y: Math.round(+q.y || 0) });
  return withParts({
    when: p.when === 'outro' ? 'outro' : 'signature',
    size: clamp(+p.size || DEFAULT_SIZE, DATE_LIMITS.size.min, DATE_LIMITS.size.max),
    gap: clamp(+p.gap || 0, DATE_LIMITS.gap.min, DATE_LIMITS.gap.max),
    tilt: clamp(+p.tilt || 0, DATE_LIMITS.tilt.min, DATE_LIMITS.tilt.max),
    groups: { dd: at(p.groups.dd), mm: at(p.groups.mm), yy: at(p.groups.yy) },
  }, p.parts);
}

/** How wide a group of two digits is written, signature units: as layoutDate sets them, on the widest digits. */
export function groupWidth(digits: DigitMap | null | undefined, size: number, gap: number): number {
  const widths = digits ? DIGIT_KEYS.map((ch) => (digits[ch] ? Math.max(14, digits[ch].x1 - digits[ch].x0) : 50)) : [50];
  const widest = Math.max(...widths);
  return (2 * widest + gap * DIGIT_H) * (size / DIGIT_H);
}

/**
 * How far one group of the date can reach from its anchor, signature units, turned with the tilt: [left, top, right,
 * bottom] from the anchor, on the widest digits, from a tall digit's top to a tail below the baseline.
 */
export function groupReach(digits: DigitMap | null | undefined, size: number, gap: number, tilt: number): Box {
  const w = groupWidth(digits, size, gap);
  const rad = (tilt * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of [[0, -DATE_TOP * size], [w, -DATE_TOP * size], [0, DATE_FOOT * size], [w, DATE_FOOT * size]]) {
    const X = x * c - y * s;
    const Y = x * s + y * c;
    x0 = Math.min(x0, X); y0 = Math.min(y0, Y); x1 = Math.max(x1, X); y1 = Math.max(y1, Y);
  }
  return [x0, y0, x1, y1];
}

/** Where the written parts of a placement could reach, signature units [x0, y0, x1, y1]: what a frame must leave room for. */
export function placeBox(place: DatePlace, digits: DigitMap | null | undefined): Box {
  const r = groupReach(digits, place.size, place.gap, place.tilt);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const g of datePartsOf(place.parts)) {
    const P = place.groups[g];
    x0 = Math.min(x0, P.x + r[0]); y0 = Math.min(y0, P.y + r[1]);
    x1 = Math.max(x1, P.x + r[2]); y1 = Math.max(y1, P.y + r[3]);
  }
  return [x0, y0, x1, y1];
}

/**
 * The written parts set in a row along the tilt, the first one's anchor at `origin`, one group's width and a little
 * air apart: spaced as if the parts left out never existed. A part left out goes on after the row, where it is never
 * seen; turning it back on sets the row again.
 */
export function rowPlace(
  place: HandDatePlace, digits: DigitMap | null | undefined, parts: readonly unknown[] | null | undefined, origin: Anchor,
): DatePlace {
  const chosen = datePartsOf(parts);
  const step = groupWidth(digits, place.size, place.gap) + ROW_SPACE * place.size;
  const rad = (place.tilt * Math.PI) / 180;
  const ux = Math.cos(rad);
  const uy = Math.sin(rad);
  const at = (i: number): Anchor => ({ x: Math.round(origin.x + i * step * ux), y: Math.round(origin.y + i * step * uy) });
  const order = [...chosen, ...GROUPS.filter((g) => !chosen.includes(g))];
  const slot = (g: DatePart) => at(order.indexOf(g));
  return withParts({ ...place, groups: { dd: slot('dd'), mm: slot('mm'), yy: slot('yy') } }, chosen);
}

/**
 * Where a new signature's date goes when nobody has placed it: its parts in a row, upright, ending under the
 * signature's right edge and just below its lowest ink, so it never runs into the signature and needs no room made.
 */
export function defaultPlace(sig: SigModel, digits?: DigitMap | null, parts?: readonly unknown[] | null): DatePlace {
  const size = DEFAULT_SIZE;
  const gap = DEFAULT_GAP;
  const n = datePartsOf(parts).length;
  const w = groupWidth(digits, size, gap);
  const row = n * w + (n - 1) * ROW_SPACE * size;
  const [bx0, , bx1, by1] = sig.bbox;
  // the cap line a quarter of a digit under the signature
  const origin = { x: Math.max(bx0, bx1 - row), y: by1 + 1.25 * size };
  const base: HandDatePlace = { when: 'signature', size, gap, tilt: DEFAULT_TILT, groups: { dd: origin, mm: origin, yy: origin } };
  return rowPlace(base, digits, parts, origin);
}

/* ---------------------------------------------------------------- quick spots */

/** The quick spots the recorder offers for the date, relative to the signature's ink. */
export type DateSpot = 'after' | 'belowRight' | 'belowLeft' | 'above';
export const DATE_SPOTS: readonly DateSpot[] = ['after', 'belowRight', 'belowLeft', 'above'];

/**
 * The date moved to a quick spot, as defaultPlace places one: its written parts in a row at its own size, spacing and
 * tilt, set against the signature's ink. After it: just past the ink's right edge, on the signature's baseline. Below:
 * a sliver under the lowest ink, at the right or the left edge. Above: a sliver over the highest ink, at the right.
 */
export function spotPlace(
  sig: SigModel, digits: DigitMap | null | undefined, place: DatePlace, spot: DateSpot, baseline?: number,
): DatePlace {
  const size = place.size;
  const row = rowPlace(place, digits, place.parts, { x: 0, y: 0 });
  const b = placeBox(row, digits);
  const [bx0, by0, bx1, by1] = sig.bbox;
  const air = 0.1 * size;
  let x: number;
  let y: number;
  if (spot === 'after') {
    x = bx1 + 0.3 * size - b[0];
    y = baseline ?? sigBaseline(sig);
  } else if (spot === 'above') {
    x = bx1 - b[2];
    y = by0 - air - b[3];
  } else {
    x = spot === 'belowLeft' ? bx0 - b[0] : bx1 - b[2];
    y = by1 + air - b[1];
  }
  return rowPlace(place, digits, place.parts, { x, y });
}

/** Whether two placements write the same parts in the same places, at the same size, spacing and tilt. */
export function samePlace(a: DatePlace | null | undefined, b: DatePlace | null | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.size !== b.size || a.gap !== b.gap || a.tilt !== b.tilt || a.when !== b.when) return false;
  if (datePartsOf(a.parts).join() !== datePartsOf(b.parts).join()) return false;
  return GROUPS.every((g) => a.groups[g].x === b.groups[g].x && a.groups[g].y === b.groups[g].y);
}

/**
 * Where the signature sits, viewBox y: the middle of the low points its strokes turn up from (the bottoms of its
 * letters), so a descender or a flourish below does not pull it down. The bottom of its box when it has no line.
 */
export function sigBaseline(sig: SigModel): number {
  const bottoms: number[] = [];
  // a low point is the lowest sample this many samples either side (a cubic is CUBIC_SEGMENTS samples)
  const W = 8;
  for (const st of sig.strokes) {
    if (st.type !== 'line') continue;
    const pts = samplePath(st.d);
    for (let i = 0; i < pts.length; i++) {
      const y = pts[i][1];
      // the first sample of a flat run counts once
      if (i > 0 && pts[i - 1][1] === y) continue;
      let low = true;
      for (let j = Math.max(0, i - W); j <= Math.min(pts.length - 1, i + W) && low; j++) {
        if (pts[j][1] > y) low = false;
      }
      if (low) bottoms.push(y);
    }
  }
  if (!bottoms.length) return sig.bbox[3];
  bottoms.sort((a, b) => a - b);
  return bottoms[Math.floor(bottoms.length / 2)];
}

/* ---------------------------------------------------------------- the date on the signature */

/** pen lifts inside the date, model ms: between two digits of a group, and between two groups written */
const DIGIT_GAP_MS = 90;
const GROUP_GAP_MS = 200;

export interface PlacedDigit {
  key: string;
  ch: string;
  /** from the digit's own units into the signature's */
  transform: string;
  /** the digit's scale into the signature's units, so its ink keeps the same weight at any size */
  scale: number;
  /** model ms, from the date's first pen-down, when this digit begins */
  t0: number;
}

/**
 * The date's digits placed on the signature as the Handwriting Lab placed them: each group anchored at the left end of
 * its baseline, scaled and turned about that anchor, its two digits side by side. Only the parts the placement writes
 * are laid out, and the pen goes from one to the next as if the others were never there. `date` is ddmmyy.
 */
export function layoutDate(date: string, hand: Hand): { digits: PlacedDigit[]; total: number } {
  const { place } = hand;
  const digits: PlacedDigit[] = [];
  let t = 0;
  datePairs(date, place.parts).forEach(({ group, pair }, gi) => {
    const P = place.groups[group];
    if (gi) t += GROUP_GAP_MS;
    // a pair that would run into the signature makes room: tighter, and smaller only when it has to be
    const fit = hand.fit[group][pair];
    const scale = (place.size / DIGIT_H) * (fit?.scale ?? 1);
    const gap = fit?.gap ?? place.gap;
    let x = 0;
    for (let i = 0; i < 2; i++) {
      const ch = pair[i];
      const m = ch === undefined ? undefined : hand.digits[ch];
      if (!m) continue;
      if (i) t += DIGIT_GAP_MS;
      digits.push({
        key: group + i,
        ch,
        transform: `translate(${P.x} ${P.y}) rotate(${place.tilt}) scale(${scale.toFixed(4)}) `
          + `translate(${(x - m.x0).toFixed(2)} ${-DIGIT_H})`,
        scale,
        t0: t,
      });
      t += m.total;
      x += Math.max(14, m.x1 - m.x0) + (i === 0 ? gap * DIGIT_H : 0);
    }
  });
  return { digits, total: t };
}

const DATE_BOXES = new WeakMap<Hand, Box>();
/** Where any date could reach, signature units, so a canvas never clips a wide digit: the written parts only. */
export function dateBox(hand: Hand): Box {
  const known = DATE_BOXES.get(hand);
  if (known) return known;
  const box = placeBox(hand.place, hand.digits);
  DATE_BOXES.set(hand, box);
  return box;
}

/** A day as the intro writes it: day, month and two-digit year. */
export function dateDigits(d: Date = new Date()): string {
  return pad2(d.getDate()) + pad2(d.getMonth() + 1) + pad2(d.getFullYear() % 100);
}

/* ---------------------------------------------------------------- is it a signature */

/**
 * Why a recording cannot stand as a signature, or null when it can. The recording is in the recorder's unit (a share
 * of the pad's width, both ways): it needs at least one real line, and to cover more than a small corner of the pad.
 */
export function signatureProblem(rec: Recording | null | undefined): 'empty' | 'dots' | 'small' | null {
  const strokes = readStrokes(rec?.strokes, 1);
  if (!strokes.length) return 'empty';
  let ink = 0;
  let longest = 0;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) {
    let len = 0;
    for (let i = 0; i < s.length; i++) {
      const [x, y] = s[i];
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
      if (i) len += Math.hypot(x - s[i - 1][0], y - s[i - 1][1]);
    }
    ink += len;
    longest = Math.max(longest, len);
  }
  if (longest < 0.04) return 'dots';
  if (Math.max(x1 - x0, y1 - y0) < 0.2 || ink < 0.3) return 'small';
  return buildSigModel(rec) ? null : 'dots';
}
