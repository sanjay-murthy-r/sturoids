// Scores analytics: every figure the Analytics page shows is worked out here from the exam tree, so the page only
// draws. Nothing here touches React Native, so the Node tests load it as it is.
//
// The unit is an exam that stands on its own (a subject is part of its exam, never counted alone). Exams are compared
// within a category, since a school unit test and a national mock are not the same scale of hard. Subjects are matched
// across exams by name, ignoring case and spacing.

import {
  ScoreIndex, ScoreNode, ScoreTag, ScoreResult, categoryOf, fmtPct, resultOf, subjectKey, topExams, whenOf,
} from './scores';

/** Which exams a view looks at: one category, every exam, or the exams in no category. */
export type Scope = string | 'all' | 'none';
export const ALL: Scope = 'all';
export const NONE: Scope = 'none';

/** How far back a view looks: the latest few marked exams, or all of them. */
export type Range = 5 | 10 | 'all';

/** One marked exam, as the charts and figures see it. */
export interface ExamPoint {
  id: string;
  title: string;
  /** YYYY-MM-DD: the day it was sat, or failing that the day it was added */
  when: string;
  pct: number;
  score?: number;
  outOf?: number;
  target?: number;
  rank?: number;
  percentile?: number;
}

const byWhen = (a: ScoreNode, b: ScoreNode) => whenOf(a).localeCompare(whenOf(b)) || a.createdAt - b.createdAt;

/** The exams standing on their own in a scope, marked or not, oldest first. */
export function examsInScope(ix: ScoreIndex, tags: ScoreTag[], scope: Scope): ScoreNode[] {
  return topExams(ix)
    .filter((n) => {
      if (scope === ALL) return true;
      const cat = categoryOf(n, tags);
      return scope === NONE ? !cat : cat?.id === scope;
    })
    .sort(byWhen);
}

/** The marked exams in a scope, oldest first. */
export function examPoints(ix: ScoreIndex, tags: ScoreTag[], scope: Scope): ExamPoint[] {
  const out: ExamPoint[] = [];
  for (const n of examsInScope(ix, tags, scope)) {
    const r = resultOf(n, ix);
    if (!r || !Number.isFinite(r.pct)) continue;
    out.push(pointOf(n, r));
  }
  return out;
}

function pointOf(n: ScoreNode, r: ScoreResult): ExamPoint {
  const p: ExamPoint = { id: n.id, title: n.title || 'Untitled exam', when: whenOf(n), pct: r.pct };
  if (typeof r.score === 'number') p.score = r.score;
  if (typeof r.outOf === 'number') p.outOf = r.outOf;
  if (typeof n.target === 'number') p.target = n.target;
  if (typeof n.rank === 'number') p.rank = n.rank;
  if (typeof n.percentile === 'number') p.percentile = n.percentile;
  return p;
}

/** The latest few of a series, still oldest first. */
export function inRange<T>(points: T[], range: Range): T[] {
  return range === 'all' ? points : points.slice(-range);
}

// ---------- plain statistics ----------

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : NaN);

export function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** The population standard deviation: how far results sit from their average, typically. */
export function spread(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) * (x - m), 0) / xs.length);
}

/** The straight line that best fits a series against its position: y = intercept + slope * i. */
export function fitLine(ys: number[]): { slope: number; intercept: number; residual: number } | null {
  const n = ys.length;
  if (n < 2) return null;
  const mx = (n - 1) / 2;
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  ys.forEach((y, i) => {
    sxy += (i - mx) * (y - my);
    sxx += (i - mx) * (i - mx);
  });
  const slope = sxx ? sxy / sxx : 0;
  const intercept = my - slope * mx;
  const residual = Math.sqrt(ys.reduce((a, y, i) => a + (y - (intercept + slope * i)) ** 2, 0) / n);
  return { slope, intercept, residual };
}

/** Each result averaged with the ones just before it (`window` in all), from the first full window on. */
export function movingAverage(ys: number[], window = 3): (number | null)[] {
  return ys.map((_, i) => (i + 1 < window ? null : mean(ys.slice(i + 1 - window, i + 1))));
}

// ---------- how a series reads ----------

export type TrendWord = 'rising' | 'falling' | 'flat';

/** A slope of less than half a point an exam is flat: results wobble more than that on their own. */
export const trendWord = (slope: number): TrendWord => (slope >= 0.5 ? 'rising' : slope <= -0.5 ? 'falling' : 'flat');

export type SteadyWord = 'very steady' | 'steady' | 'some swing' | 'up and down';

export const steadyWord = (sd: number): SteadyWord =>
  sd < 2.5 ? 'very steady' : sd < 5 ? 'steady' : sd < 10 ? 'some swing' : 'up and down';

/** Result bands for the distribution, lowest first; a result below zero counts in the first. */
export const BANDS: { label: string; lo: number; hi: number }[] = [
  { label: 'Below 40', lo: -Infinity, hi: 40 },
  { label: '40s', lo: 40, hi: 50 },
  { label: '50s', lo: 50, hi: 60 },
  { label: '60s', lo: 60, hi: 70 },
  { label: '70s', lo: 70, hi: 80 },
  { label: '80s', lo: 80, hi: 90 },
  { label: '90 and up', lo: 90, hi: Infinity },
];

export interface SeriesStats {
  n: number;
  mean: number;
  median: number;
  /** standard deviation, in percentage points */
  sd: number;
  steady: SteadyWord;
  best: ExamPoint;
  worst: ExamPoint;
  latest: ExamPoint;
  previous: ExamPoint | null;
  /** latest minus the one before, in points */
  delta: number | null;
  /** whether the latest is the best in the range (and there is more than one) */
  latestIsBest: boolean;
  /** latest minus the average of the others: how the last one compares with usual */
  form: number | null;
  /** points gained (or lost) per exam across the range; from three exams on */
  slope: number | null;
  trend: TrendWord | null;
  /** the same over just the last five, when the range is longer: is the recent run different? */
  recentSlope: number | null;
  /** three-exam moving average, aligned with the points */
  moving: (number | null)[];
  /** where the fitted line puts the next exam, with the typical miss either side; from four exams on */
  projection: { value: number; low: number; high: number } | null;
  /** exams that had a target, and how many reached it */
  targets: { set: number; met: number };
  /** the run of rises or falls the latest exam ends */
  streak: { dir: 'up' | 'down'; count: number } | null;
  bands: { label: string; count: number }[];
  rank: { first: number; latest: number; best: number; change: number | null; n: number } | null;
  percentile: { latest: number; mean: number; best: number; n: number } | null;
}

const clampPct = (v: number) => Math.max(0, Math.min(100, v));

export function seriesStats(points: ExamPoint[]): SeriesStats | null {
  const n = points.length;
  if (!n) return null;
  const ys = points.map((p) => p.pct);
  const m = mean(ys);
  const sd = spread(ys);
  let best = points[0];
  let worst = points[0];
  for (const p of points) {
    if (p.pct > best.pct) best = p;
    if (p.pct < worst.pct) worst = p;
  }
  const latest = points[n - 1];
  const previous = n > 1 ? points[n - 2] : null;
  const fit = n >= 3 ? fitLine(ys) : null;
  const recent = n > 5 ? fitLine(ys.slice(-5)) : null;
  const full = n >= 4 ? fitLine(ys) : null;
  const projection = full
    ? (() => {
      const v = full.intercept + full.slope * n;
      const miss = Math.max(2, full.residual);
      return { value: clampPct(v), low: clampPct(v - miss), high: clampPct(v + miss) };
    })()
    : null;

  // the run the latest exam ends: rises in a row, or falls in a row (an exact repeat ends a run)
  let streak: SeriesStats['streak'] = null;
  if (n > 1) {
    const dir = ys[n - 1] > ys[n - 2] ? 'up' : ys[n - 1] < ys[n - 2] ? 'down' : null;
    if (dir) {
      let count = 1;
      for (let i = n - 2; i > 0; i--) {
        const d = ys[i] > ys[i - 1] ? 'up' : ys[i] < ys[i - 1] ? 'down' : null;
        if (d !== dir) break;
        count++;
      }
      streak = { dir, count };
    }
  }

  const withTarget = points.filter((p) => typeof p.target === 'number');
  const ranked = points.filter((p) => typeof p.rank === 'number');
  const pctiled = points.filter((p) => typeof p.percentile === 'number');

  return {
    n,
    mean: m,
    median: median(ys),
    sd,
    steady: steadyWord(sd),
    best,
    worst,
    latest,
    previous,
    delta: previous ? latest.pct - previous.pct : null,
    latestIsBest: n > 1 && latest.pct >= best.pct,
    form: n > 1 ? latest.pct - mean(ys.slice(0, -1)) : null,
    slope: fit ? fit.slope : null,
    trend: fit ? trendWord(fit.slope) : null,
    recentSlope: recent ? recent.slope : null,
    moving: n >= 4 ? movingAverage(ys, 3) : ys.map(() => null),
    projection,
    targets: { set: withTarget.length, met: withTarget.filter((p) => p.pct >= (p.target as number) - 1e-9).length },
    streak,
    bands: BANDS.map((b) => ({ label: b.label, count: ys.filter((y) => y >= b.lo && y < b.hi).length })),
    rank: ranked.length
      ? {
        first: ranked[0].rank as number,
        latest: ranked[ranked.length - 1].rank as number,
        best: Math.min(...ranked.map((p) => p.rank as number)),
        change: ranked.length > 1 ? (ranked[ranked.length - 1].rank as number) - (ranked[ranked.length - 2].rank as number) : null,
        n: ranked.length,
      }
      : null,
    percentile: pctiled.length
      ? {
        latest: pctiled[pctiled.length - 1].percentile as number,
        mean: mean(pctiled.map((p) => p.percentile as number)),
        best: Math.max(...pctiled.map((p) => p.percentile as number)),
        n: pctiled.length,
      }
      : null,
  };
}

// ---------- subjects ----------

export interface SubjectCell {
  examId: string;
  pct: number;
  score?: number;
  outOf?: number;
}

export interface SubjectStat {
  key: string;
  /** the spelling used most recently */
  name: string;
  /** one cell per exam in the range, null where the subject was not sat or not marked */
  cells: (SubjectCell | null)[];
  n: number;
  mean: number;
  latest: number;
  delta: number | null;
  best: number;
  worst: number;
  sd: number;
  slope: number | null;
  /** full marks minus marks scored, summed over the range, when the marks are known */
  lost: number;
  /** its part of all the marks lost across subjects, 0 to 1 */
  lostShare: number;
  /** its part of the exam's full marks, on average, 0 to 1 */
  weight: number;
}

/**
 * How each subject did across a run of exams (given oldest first). A subject counts once per exam; when an exam
 * repeats a subject name, the first one is used. Subjects are sorted strongest first by average, then by latest.
 */
export function subjectStats(ix: ScoreIndex, examIds: string[]): SubjectStat[] {
  const rows = new Map<string, { name: string; cells: (SubjectCell | null)[]; lost: number; weights: number[] }>();
  examIds.forEach((examId, col) => {
    const parts = (ix.children.get(examId) || []).filter((k) => k.kind === 'exam').sort((a, b) => a.createdAt - b.createdAt);
    const total = parts.reduce((a, p) => a + (resultOf(p, ix)?.outOf ?? 0), 0);
    const taken = new Set<string>();
    for (const p of parts) {
      const key = subjectKey(p.title);
      if (!key || taken.has(key)) continue;
      taken.add(key);
      let row = rows.get(key);
      if (!row) {
        row = { name: p.title.trim(), cells: examIds.map(() => null), lost: 0, weights: [] };
        rows.set(key, row);
      }
      row.name = p.title.trim().replace(/\s+/g, ' ');
      const r = resultOf(p, ix);
      if (!r || !Number.isFinite(r.pct)) continue;
      const cell: SubjectCell = { examId, pct: r.pct };
      if (typeof r.score === 'number' && typeof r.outOf === 'number') {
        cell.score = r.score;
        cell.outOf = r.outOf;
        row.lost += r.outOf - r.score;
        if (total > 0) row.weights.push(r.outOf / total);
      }
      row.cells[col] = cell;
    }
  });
  const allLost = [...rows.values()].reduce((a, r) => a + Math.max(0, r.lost), 0);
  const out: SubjectStat[] = [];
  for (const [key, row] of rows) {
    const ys = row.cells.filter(Boolean).map((c) => (c as SubjectCell).pct);
    if (!ys.length) continue;
    const fit = ys.length >= 3 ? fitLine(ys) : null;
    out.push({
      key,
      name: row.name,
      cells: row.cells,
      n: ys.length,
      mean: mean(ys),
      latest: ys[ys.length - 1],
      delta: ys.length > 1 ? ys[ys.length - 1] - ys[ys.length - 2] : null,
      best: Math.max(...ys),
      worst: Math.min(...ys),
      sd: spread(ys),
      slope: fit ? fit.slope : null,
      lost: row.lost,
      lostShare: allLost > 0 ? Math.max(0, row.lost) / allLost : 0,
      weight: row.weights.length ? mean(row.weights) : 0,
    });
  }
  // level averages: the one doing better lately goes first
  return out.sort((a, b) => b.mean - a.mean || b.latest - a.latest || a.name.localeCompare(b.name));
}

export interface SubjectCallouts {
  strongest: SubjectStat | null;
  weakest: SubjectStat | null;
  /** the steepest climb, from three marked exams on */
  improving: SubjectStat | null;
  /** the steepest fall, from three marked exams on */
  slipping: SubjectStat | null;
  /** where most marks go, when marks are known */
  costliest: SubjectStat | null;
}

/** The subjects worth naming. With fewer than two subjects there is nothing to compare, so all are null. */
export function subjectCallouts(stats: SubjectStat[]): SubjectCallouts {
  const none = { strongest: null, weakest: null, improving: null, slipping: null, costliest: null };
  if (stats.length < 2) return none;
  const byMean = [...stats].sort((a, b) => b.mean - a.mean || b.latest - a.latest);
  const sloped = stats.filter((s) => s.slope != null);
  const up = sloped.filter((s) => (s.slope as number) >= 0.5).sort((a, b) => (b.slope as number) - (a.slope as number))[0] || null;
  const down = sloped.filter((s) => (s.slope as number) <= -0.5).sort((a, b) => (a.slope as number) - (b.slope as number))[0] || null;
  const lost = stats.filter((s) => s.lost > 0).sort((a, b) => b.lost - a.lost)[0] || null;
  const strongest = byMean[0];
  const weakest = byMean[byMean.length - 1];
  return {
    strongest,
    weakest: weakest.mean < strongest.mean ? weakest : null,
    improving: up,
    slipping: down,
    costliest: lost,
  };
}

// ---------- categories side by side ----------

export interface CategoryRow {
  /** a category's id, or NONE for the exams in no category */
  scope: Scope;
  label: string;
  color: string | null;
  exams: number;
  marked: number;
  mean: number | null;
  latest: number | null;
  delta: number | null;
  slope: number | null;
  /** the last twelve, oldest first */
  series: number[];
}

/** Every category with an exam in it, then the exams in no category (when there are any), for the overview. */
export function categoryRows(ix: ScoreIndex, tags: ScoreTag[]): CategoryRow[] {
  const exams = topExams(ix);
  const buckets = new Map<Scope, ScoreNode[]>();
  for (const n of exams) {
    const key = categoryOf(n, tags)?.id ?? NONE;
    const list = buckets.get(key);
    if (list) list.push(n);
    else buckets.set(key, [n]);
  }
  const rows: CategoryRow[] = [];
  const make = (scope: Scope, label: string, color: string | null) => {
    const list = (buckets.get(scope) || []).sort(byWhen);
    if (!list.length) return;
    const ys = list.map((n) => resultOf(n, ix)).filter((r) => r && Number.isFinite(r.pct)).map((r) => (r as ScoreResult).pct);
    const fit = ys.length >= 3 ? fitLine(ys) : null;
    rows.push({
      scope, label, color,
      exams: list.length,
      marked: ys.length,
      mean: ys.length ? mean(ys) : null,
      latest: ys.length ? ys[ys.length - 1] : null,
      delta: ys.length > 1 ? ys[ys.length - 1] - ys[ys.length - 2] : null,
      slope: fit ? fit.slope : null,
      series: ys.slice(-12),
    });
  };
  for (const t of tags) if (t.category) make(t.id, t.label, t.color);
  make(NONE, 'No category', null);
  return rows;
}

/**
 * Where Analytics opens: the category of the most recent marked exam, or every exam when that one has no category
 * (or there are no categories at all).
 */
export function defaultScope(ix: ScoreIndex, tags: ScoreTag[]): Scope {
  const pts = examPoints(ix, tags, ALL);
  const last = pts[pts.length - 1];
  const cat = last ? categoryOf(ix.byId.get(last.id), tags) : null;
  return cat ? cat.id : ALL;
}

// ---------- words ----------

/** "+2.4", "-0.8", "0": a change in points, to one place. */
export function fmtPoints(v: number): string {
  const r = Math.round(v * 10) / 10;
  if (r === 0) return '0';
  return (r > 0 ? '+' : '-') + (Number.isInteger(Math.abs(r)) ? String(Math.abs(r)) : Math.abs(r).toFixed(1));
}

/** "rising, 1.6 points an exam" or "flat". */
export function trendText(slope: number): string {
  const w = trendWord(slope);
  if (w === 'flat') return 'Holding steady';
  const a = Math.round(Math.abs(slope) * 10) / 10;
  return (w === 'rising' ? 'Rising ' : 'Falling ') + a + (a === 1 ? ' point' : ' points') + ' an exam';
}

/** "1 point", "1.6 points": a size of change, to one place, without a sign. */
function pointsText(v: number): string {
  const a = Math.round(Math.abs(v) * 10) / 10;
  return a + (a === 1 ? ' point' : ' points');
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * The one line the Scores page shows for a series: the latest result and how it is moving. "Latest 72.4%, rising 1.6
 * points an exam" from three exams on, the change on the one before with two (left out when there was none), and the
 * result with its exam's name for a series of one.
 */
export function insightLine(s: SeriesStats): string {
  const latest = 'Latest ' + fmtPct(s.latest.pct);
  if (s.slope != null) return latest + ', ' + lowerFirst(trendText(s.slope));
  if (s.delta != null) {
    const r = Math.round(s.delta * 10) / 10;
    return r === 0 ? latest : latest + ', ' + (r > 0 ? 'up ' : 'down ') + pointsText(r) + ' on the one before';
  }
  return fmtPct(s.latest.pct) + ' in ' + s.latest.title;
}

/** A second reading when the last five run differently from the whole range, or null when they agree. */
export function recentNote(s: SeriesStats): string | null {
  if (s.slope == null || s.recentSlope == null) return null;
  if (trendWord(s.recentSlope) === trendWord(s.slope)) return null;
  return 'Over the last five: ' + lowerFirst(trendText(s.recentSlope));
}

/** "Steady: within about 3.2 points of the average", or null when the results do not move at all. */
export function steadyText(sd: number): string | null {
  const r = Math.round(sd * 10) / 10;
  if (!(r > 0)) return null;
  const w = steadyWord(sd);
  return w.charAt(0).toUpperCase() + w.slice(1) + ': within about ' + pointsText(r) + ' of the average';
}

/** Where a view opens: every result when there are ten or fewer, otherwise the latest ten. */
export const defaultRange = (marked: number): Range => (marked <= 10 ? 'all' : 10);

// ---------- charts ----------

/** Gridline steps a chart may use: round numbers only, so a label never reads 47.5. */
const STEPS = [5, 10, 20, 25, 50, 100];

/**
 * A chart's vertical scale: the results, widened to at least `minSpan` points so two close results never look like a
 * cliff, kept inside 0 to 100 when the results are, then snapped out to round gridlines (three or four of them, the
 * top and bottom ones included).
 */
export function chartScale(values: number[], minSpan = 10): { lo: number; hi: number; step: number; ticks: number[] } {
  const ys = values.filter((v) => Number.isFinite(v));
  const dataLo = ys.length ? Math.min(...ys) : 0;
  const dataHi = ys.length ? Math.max(...ys) : 100;
  let lo = dataLo;
  let hi = dataHi;
  if (hi - lo < minSpan) {
    const mid = (hi + lo) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
    if (hi > 100 && dataHi <= 100) { lo -= hi - 100; hi = 100; }
    if (lo < 0 && dataLo >= 0) { hi -= lo; lo = 0; }
  }
  let pick = { a: 0, b: 100, step: 50 };
  for (const step of STEPS) {
    const a = Math.floor(lo / step + 1e-9) * step;
    const b = Math.ceil(hi / step - 1e-9) * step;
    pick = { a, b, step };
    if (Math.round((b - a) / step) + 1 <= 4) break;
  }
  const ticks: number[] = [];
  for (let v = pick.a; v <= pick.b + 1e-9; v += pick.step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { lo: pick.a, hi: pick.b, step: pick.step, ticks };
}

/** The unbroken runs of a series with gaps, for drawing it as separate lines: where each starts, and its values. */
export function runsOf(values: (number | null)[]): { start: number; values: number[] }[] {
  const out: { start: number; values: number[] }[] = [];
  let cur: { start: number; values: number[] } | null = null;
  values.forEach((v, i) => {
    if (v == null || !Number.isFinite(v)) { cur = null; return; }
    if (!cur) { cur = { start: i, values: [] }; out.push(cur); }
    cur.values.push(v);
  });
  return out;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "12 Sep", from YYYY-MM-DD, the same on every device. */
export function shortDay(key: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return key;
  return Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1];
}

/**
 * Short names for a run of exams laid side by side: their dates when no two share a day, otherwise the numbers in
 * their titles ("#7") when every one has its own, otherwise their places in the run.
 */
export function columnLabels(points: { title: string; when: string }[]): string[] {
  const days = points.map((p) => shortDay(p.when));
  if (new Set(days).size === days.length) return days;
  const nums = points.map((p) => /(\d+)\D*$/.exec(p.title)?.[1] ?? '');
  if (nums.every(Boolean) && new Set(nums.map(Number)).size === nums.length) return nums.map((n) => '#' + Number(n));
  return points.map((_, i) => String(i + 1));
}
