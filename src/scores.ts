// Exam scores: a tree of groups, exams and their subjects. Every sum is worked out here, so screens only draw. Nothing in
// this file touches React Native: the store and the Node tests load it as it is.
//
// Every walk up or down the tree keeps a visited set, so a damaged tree (a cycle written by an old build or an edited
// backup) can never loop or overflow the stack.

import { uid } from './utils';

export interface ScoreNode {
  id: string;
  /** null at the top level */
  parentId: string | null;
  /** a group holds groups and exams; an exam holds its subjects, to any depth */
  kind: 'group' | 'exam';
  title: string;
  /** the day an exam is sat, YYYY-MM-DD; unmarked and today or later means it is coming up */
  date?: string;
  /** an exam's own marks; negative marking can take the score below zero */
  score?: number;
  outOf?: number;
  /** how an exam's subjects add up: their marks summed (the default), or their percentages weighted */
  combine?: 'sum' | 'weighted';
  /** a subject's share inside a weighted exam; 1 when unset */
  weight?: number;
  /** a goal, as a percentage */
  target?: number;
  rank?: number;
  percentile?: number;
  /** free text, for a letter grade or a CGPA */
  grade?: string;
  note?: string;
  /** ids from the tag list; an exam and its subjects carry their own */
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ScoreResult {
  pct: number;
  /** marks, when they can be added up (a weighted result has only a percentage) */
  score?: number;
  outOf?: number;
  /** a result worked out from subjects: how many of them are marked */
  marked?: number;
  parts?: number;
  from: 'own' | 'parts';
}

export type ScoreIndex = {
  byId: Map<string, ScoreNode>;
  children: Map<string | null, ScoreNode[]>;
};

export function indexScores(nodes: ScoreNode[]): ScoreIndex {
  const byId = new Map<string, ScoreNode>();
  const children = new Map<string | null, ScoreNode[]>();
  for (const n of nodes) {
    byId.set(n.id, n);
    const list = children.get(n.parentId);
    if (list) list.push(n);
    else children.set(n.parentId, [n]);
  }
  return { byId, children };
}

const kids = (ix: ScoreIndex, id: string | null) => ix.children.get(id) || [];
const examKids = (ix: ScoreIndex, id: string) => kids(ix, id).filter((k) => k.kind === 'exam');

/** When the exam was sat, or failing that when it was added, for ordering. */
export const whenOf = (n: ScoreNode) => n.date || new Date(n.createdAt).toISOString().slice(0, 10);

function byWhen(a: ScoreNode, b: ScoreNode) {
  const d = whenOf(a).localeCompare(whenOf(b));
  return d || a.createdAt - b.createdAt;
}

/** The exam's own marks, when it has a complete pair. */
export function ownResult(n: ScoreNode): ScoreResult | null {
  if (typeof n.score !== 'number' || typeof n.outOf !== 'number' || !(n.outOf > 0)) return null;
  return { pct: (n.score / n.outOf) * 100, score: n.score, outOf: n.outOf, from: 'own' };
}

/** What an exam's subjects add up to, ignoring its own marks. */
export function partsResult(n: ScoreNode, ix: ScoreIndex, seen: Set<string> = new Set()): ScoreResult | null {
  if (n.kind !== 'exam' || seen.has(n.id)) return null;
  seen.add(n.id);
  const parts = examKids(ix, n.id);
  if (!parts.length) return null;
  const results = parts.map((p) => ({ p, r: resultOf(p, ix, seen) }));
  const marked = results.filter((x) => x.r) as { p: ScoreNode; r: ScoreResult }[];
  if (!marked.length) return null;
  if ((n.combine || 'sum') === 'weighted') {
    let sum = 0;
    let w = 0;
    for (const { p, r } of marked) {
      const wt = typeof p.weight === 'number' && p.weight > 0 ? p.weight : 1;
      sum += r.pct * wt;
      w += wt;
    }
    return { pct: sum / w, marked: marked.length, parts: parts.length, from: 'parts' };
  }
  const withMarks = marked.filter((x) => typeof x.r.score === 'number' && typeof x.r.outOf === 'number');
  if (withMarks.length === marked.length) {
    const score = withMarks.reduce((a, x) => a + (x.r.score as number), 0);
    const outOf = withMarks.reduce((a, x) => a + (x.r.outOf as number), 0);
    return { pct: (score / outOf) * 100, score, outOf, marked: marked.length, parts: parts.length, from: 'parts' };
  }
  // a mix of marked and weighted parts cannot be summed as marks: fall back to the plain average
  const pct = marked.reduce((a, x) => a + x.r.pct, 0) / marked.length;
  return { pct, marked: marked.length, parts: parts.length, from: 'parts' };
}

/** An exam's result: its own marks when it has them, otherwise what its subjects add up to. */
export function resultOf(n: ScoreNode, ix: ScoreIndex, seen: Set<string> = new Set()): ScoreResult | null {
  if (n.kind !== 'exam') return null;
  return ownResult(n) || partsResult(n, ix, seen);
}

/**
 * The difference between an exam's own marks and what its subjects add up to, for a gentle hint on the exam's
 * page. Null when there is nothing to compare or the two agree.
 */
export function partsMismatch(n: ScoreNode, ix: ScoreIndex): ScoreResult | null {
  const own = ownResult(n);
  if (!own) return null;
  const parts = partsResult(n, ix);
  if (!parts) return null;
  if (typeof parts.score === 'number' && typeof parts.outOf === 'number') {
    return Math.abs(parts.score - (own.score as number)) > 1e-9 || Math.abs(parts.outOf - (own.outOf as number)) > 1e-9 ? parts : null;
  }
  return Math.abs(parts.pct - own.pct) >= 0.05 ? parts : null;
}

/** The exams directly in a group, and in every group inside it. Sub-exams are part of their exam, never counted alone. */
export function examsUnder(ix: ScoreIndex, groupId: string | null): ScoreNode[] {
  const out: ScoreNode[] = [];
  const seen = new Set<string>();
  const walk = (id: string | null) => {
    for (const k of kids(ix, id)) {
      if (seen.has(k.id)) continue;
      seen.add(k.id);
      if (k.kind === 'exam') out.push(k);
      else walk(k.id);
    }
  };
  walk(groupId);
  return out;
}

export interface GroupSummary {
  exams: number;
  marked: number;
  average: number;
  best: { node: ScoreNode; pct: number };
  latest: { node: ScoreNode; pct: number; delta: number | null };
  /** the last twelve marked exams, oldest first */
  series: { id: string; pct: number; when: string }[];
}

/** A group's glance: null until at least one of its exams is marked. */
export function groupSummary(ix: ScoreIndex, groupId: string | null): GroupSummary | null {
  const exams = examsUnder(ix, groupId);
  const scored = exams
    .map((node) => ({ node, r: resultOf(node, ix) }))
    .filter((x) => x.r)
    .map((x) => ({ node: x.node, pct: (x.r as ScoreResult).pct }))
    .sort((a, b) => byWhen(a.node, b.node));
  if (!scored.length) return null;
  const average = scored.reduce((a, x) => a + x.pct, 0) / scored.length;
  const best = scored.reduce((a, x) => (x.pct > a.pct ? x : a), scored[0]);
  const last = scored[scored.length - 1];
  const prev = scored.length > 1 ? scored[scored.length - 2] : null;
  return {
    exams: exams.length,
    marked: scored.length,
    average,
    best,
    latest: { node: last.node, pct: last.pct, delta: prev ? last.pct - prev.pct : null },
    series: scored.slice(-12).map((x) => ({ id: x.node.id, pct: x.pct, when: whenOf(x.node) })),
  };
}

/** Unmarked exams dated today or later, soonest first. */
export function upcoming(ix: ScoreIndex, groupId: string | null, today: string): ScoreNode[] {
  return examsUnder(ix, groupId)
    .filter((n) => !!n.date && (n.date as string) >= today && !resultOf(n, ix))
    .sort((a, b) => (a.date as string).localeCompare(b.date as string) || a.createdAt - b.createdAt);
}

/** How far an exam's result moved from the marked exam before it in the same group. */
export function deltaVsPrevious(n: ScoreNode, ix: ScoreIndex): number | null {
  const mine = resultOf(n, ix);
  if (!mine) return null;
  const siblings = kids(ix, n.parentId)
    .filter((s) => s.kind === 'exam' && s.id !== n.id && byWhen(s, n) < 0)
    .map((s) => ({ s, r: resultOf(s, ix) }))
    .filter((x) => x.r)
    .sort((a, b) => byWhen(a.s, b.s));
  const prev = siblings[siblings.length - 1];
  return prev ? mine.pct - (prev.r as ScoreResult).pct : null;
}

/** The node's ancestors, top level first. */
export function pathOf(ix: ScoreIndex, id: string | null): ScoreNode[] {
  const out: ScoreNode[] = [];
  const seen = new Set<string>();
  let cur = id ? ix.byId.get(id) : undefined;
  while (cur && cur.parentId && !seen.has(cur.id)) {
    seen.add(cur.id);
    const parent = ix.byId.get(cur.parentId);
    if (!parent) break;
    out.unshift(parent);
    cur = parent;
  }
  return out;
}

/** Every node below this one. */
export function descendantIds(ix: ScoreIndex, id: string): Set<string> {
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const at = stack.pop() as string;
    for (const k of kids(ix, at)) {
      if (out.has(k.id) || k.id === id) continue;
      out.add(k.id);
      stack.push(k.id);
    }
  }
  return out;
}

/** Whether a node may move under a new parent: groups only under the top level or a group, never into itself. */
export function canMove(ix: ScoreIndex, id: string, parentId: string | null): boolean {
  const n = ix.byId.get(id);
  if (!n) return false;
  if (parentId === null) return true;
  const p = ix.byId.get(parentId);
  if (!p || p.id === id || descendantIds(ix, id).has(parentId)) return false;
  return n.kind === 'group' ? p.kind === 'group' : true;
}

// ---------- dates ----------

const dayNumber = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};

/** "Sat, 12 Sep", or with `long` "Saturday, 12 September"; the year only when it is not this year. */
export function fmtExamDate(key: string, long = false, now = new Date()): string {
  const d = new Date(key + 'T00:00:00');
  if (isNaN(d.getTime())) return key;
  const opts: Intl.DateTimeFormatOptions = long
    ? { weekday: 'long', day: 'numeric', month: 'long' }
    : { weekday: 'short', day: 'numeric', month: 'short' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-IN', opts);
}

/** "Today", "Tomorrow", "in 6 days", "Yesterday", "3 days ago". */
export function fromToday(key: string, today: string): string {
  const n = Math.round(dayNumber(key) - dayNumber(today));
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  return n > 1 ? 'in ' + n + ' days' : -n + ' days ago';
}

// ---------- numbers ----------

/** 74.666 is 74.7%; 80 is 80%. */
export function fmtPct(p: number): string {
  const r = Math.round(p * 10) / 10;
  return (Number.isInteger(r) ? String(r) : r.toFixed(1)) + '%';
}

/** Marks as entered: 42, 42.5, -4. */
export function fmtMark(n: number): string {
  const r = Math.round(n * 100) / 100;
  return String(r);
}

/** A typed mark: empty means none; a comma counts as a decimal point. */
export function parseMark(text: string): { value?: number; bad: boolean } {
  const t = text.trim().replace(',', '.');
  if (!t) return { bad: false };
  if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(t)) return { bad: true };
  const v = Number(t);
  return Number.isFinite(v) ? { value: v, bad: false } : { bad: true };
}

/** What is wrong with a pair of marks, in words for the field, or null when they are fine. */
export function marksProblem(score: number | undefined, outOf: number | undefined): string | null {
  if (outOf !== undefined && !(outOf > 0)) return 'Out of must be more than 0.';
  if (score !== undefined && outOf === undefined) return 'Add what it is out of.';
  if (score !== undefined && outOf !== undefined) {
    if (score > outOf) return "The score can't be more than the total.";
    if (score < -outOf) return "The score can't go below minus the total.";
  }
  return null;
}

/** "Mock 7" becomes "Mock 8", "Paper 09" becomes "Paper 10", and a title with no number gains " 2". */
export function nextTitle(title: string): string {
  const m = /^(.*?)(\d+)(\D*)$/.exec(title);
  if (!m) return (title.trim() || 'Exam') + ' 2';
  const next = String(Number(m[2]) + 1).padStart(m[2].length, '0');
  return m[1] + next + m[3];
}

/**
 * A copy of a node and everything under it with the marks, dates, ranks, grades and notes left blank, ready for the
 * next test in a series. Only the copied node's own title moves on a number.
 */
export function duplicateStructure(nodes: ScoreNode[], id: string, now = Date.now(), makeId: () => string = uid): { nodes: ScoreNode[]; rootId: string } | null {
  const ix = indexScores(nodes);
  const root = ix.byId.get(id);
  if (!root) return null;
  const out: ScoreNode[] = [];
  const seen = new Set<string>();
  const copy = (n: ScoreNode, parentId: string | null, isRoot: boolean): string => {
    seen.add(n.id);
    const c: ScoreNode = { id: makeId(), parentId, kind: n.kind, title: isRoot ? nextTitle(n.title) : n.title, createdAt: now, updatedAt: now };
    if (typeof n.outOf === 'number') c.outOf = n.outOf;
    if (n.combine) c.combine = n.combine;
    if (typeof n.weight === 'number') c.weight = n.weight;
    if (typeof n.target === 'number') c.target = n.target;
    // the exam's own tags say what kind of paper it is, so the next one keeps them; its subjects' tags describe how
    // that attempt went, and start blank like the marks
    if (isRoot && n.tags?.length) c.tags = [...n.tags];
    out.push(c);
    for (const k of kids(ix, n.id)) if (!seen.has(k.id)) copy(k, c.id, false);
    return c.id;
  };
  const rootId = copy(root, root.parentId, true);
  return { nodes: out, rootId };
}

// ---------- repair ----------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Makes any saved or imported tree safe to draw. Records that are not nodes are dropped, bad fields are removed (never
 * set to undefined), orphans and groups found inside exams go to the top level, and cycles are broken. Running it
 * twice changes nothing.
 */
export function sanitizeScores(raw: unknown): ScoreNode[] {
  if (!Array.isArray(raw)) return [];
  const nodes: ScoreNode[] = [];
  const ids = new Set<string>();
  for (const r of raw as any[]) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
    if (typeof r.id !== 'string' || !r.id || ids.has(r.id)) continue;
    if (r.kind !== 'group' && r.kind !== 'exam') continue;
    ids.add(r.id);
    const n: ScoreNode = {
      id: r.id,
      parentId: typeof r.parentId === 'string' && r.parentId ? r.parentId : null,
      kind: r.kind,
      title: typeof r.title === 'string' ? r.title : '',
      createdAt: finite(r.createdAt) ? r.createdAt : 0,
      updatedAt: finite(r.updatedAt) ? r.updatedAt : 0,
    };
    if (typeof r.date === 'string' && DATE_RE.test(r.date)) n.date = r.date;
    if (finite(r.score)) n.score = r.score;
    if (finite(r.outOf) && r.outOf > 0) n.outOf = r.outOf;
    if (r.combine === 'sum' || r.combine === 'weighted') n.combine = r.combine;
    if (finite(r.weight) && r.weight > 0) n.weight = r.weight;
    if (finite(r.target)) n.target = r.target;
    if (finite(r.rank)) n.rank = r.rank;
    if (finite(r.percentile)) n.percentile = r.percentile;
    if (typeof r.grade === 'string' && r.grade.trim()) n.grade = r.grade;
    if (typeof r.note === 'string' && r.note.trim()) n.note = r.note;
    if (Array.isArray(r.tags)) {
      const tags = [...new Set(r.tags.filter((t: unknown) => typeof t === 'string' && t))] as string[];
      if (tags.length) n.tags = tags;
    }
    nodes.push(n);
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    const p = n.parentId ? byId.get(n.parentId) : undefined;
    if (!p || (n.kind === 'group' && p.kind === 'exam')) n.parentId = null;
  }
  // a node whose ancestors lead back to itself is in a cycle: it moves to the top level, which breaks that cycle for
  // every other node in it. A node that only points into someone else's cycle stays where it is.
  for (const n of nodes) {
    const seen = new Set<string>();
    let cur = n.parentId ? byId.get(n.parentId) : undefined;
    while (cur && !seen.has(cur.id)) {
      if (cur.id === n.id) {
        n.parentId = null;
        break;
      }
      seen.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
  }
  return nodes;
}

/* ---------------- tags and learnings ---------------- */

/** A tag an exam, a subject or a learning can carry. Its colour is drawn translucent, never as a fill. */
export interface ScoreTag {
  id: string;
  label: string;
  /** one of TAG_COLORS, or any hex a user picked from them */
  color: string;
  createdAt: number;
}

/** Something learned from an exam, kept with it and gathered in the notebook. */
export interface Learning {
  id: string;
  /** the exam (or subject) it came from */
  nodeId: string;
  text: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

/** The pastels a new tag takes, in order; they read as themselves against the material at 12% fill. */
export const TAG_COLORS = ['#9AD6B0', '#E3C08D', '#E39EAC', '#83DBD6', '#9DBCE3', '#C2D392', '#D5C68E', '#728AB7'];

/** The colour a new tag takes: the least used one, so a short list never repeats. */
export function nextTagColor(tags: ScoreTag[]): string {
  const used = new Map<string, number>(TAG_COLORS.map((c) => [c, 0]));
  for (const t of tags) if (used.has(t.color)) used.set(t.color, (used.get(t.color) || 0) + 1);
  let best = TAG_COLORS[0];
  let low = Infinity;
  for (const c of TAG_COLORS) {
    const n = used.get(c) || 0;
    if (n < low) { low = n; best = c; }
  }
  return best;
}

/** Two names are the same tag when they differ only by case or by the spaces around them. */
export const sameTagName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The tags an id list stands for, in the order the tags were made, with ids that no longer exist left out. */
export function tagsOf(ids: string[] | undefined, all: ScoreTag[]): ScoreTag[] {
  if (!ids || !ids.length) return [];
  const want = new Set(ids);
  return all.filter((t) => want.has(t.id));
}

/** How a filter of several tags reads: any of them (the default), or every one of them. */
export type TagMatch = 'any' | 'all';

/** The learnings a filter keeps: newest first, and only from the exams that still exist. */
export function filterLearnings(
  learnings: Learning[], selected: string[], match: TagMatch, alive?: Set<string>,
): Learning[] {
  const sel = selected.filter(Boolean);
  return learnings
    .filter((l) => (alive ? alive.has(l.nodeId) : true))
    .filter((l) => {
      if (!sel.length) return true;
      const has = new Set(l.tags);
      return match === 'all' ? sel.every((t) => has.has(t)) : sel.some((t) => has.has(t));
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** How many learnings and nodes carry each tag, for the tag manager. */
export function tagUse(tags: ScoreTag[], nodes: ScoreNode[], learnings: Learning[]): Map<string, number> {
  const count = new Map<string, number>(tags.map((t) => [t.id, 0]));
  const bump = (ids?: string[]) => {
    for (const id of ids || []) if (count.has(id)) count.set(id, (count.get(id) || 0) + 1);
  };
  for (const n of nodes) bump(n.tags);
  for (const l of learnings) bump(l.tags);
  return count;
}

/**
 * Ties the three lists together after each is repaired on its own: a node keeps only tags that exist, and a learning
 * whose exam is gone is dropped (an exam's learnings leave and come back with it, so one left behind is lost for
 * good and could never be reached to delete). Nothing is rebuilt when nothing changes.
 */
export function pruneScoreRefs(nodes: ScoreNode[], tags: ScoreTag[], learnings: Learning[]): { nodes: ScoreNode[]; learnings: Learning[] } {
  const known = new Set(tags.map((t) => t.id));
  const ids = new Set(nodes.map((n) => n.id));
  const outNodes = nodes.map((n) => {
    if (!n.tags || n.tags.every((t) => known.has(t))) return n;
    const kept = n.tags.filter((t) => known.has(t));
    const { tags: _drop, ...rest } = n;
    return kept.length ? { ...rest, tags: kept } : rest;
  });
  const outLearnings = learnings.every((l) => ids.has(l.nodeId)) ? learnings : learnings.filter((l) => ids.has(l.nodeId));
  return { nodes: outNodes, learnings: outLearnings };
}

/** Drops anything that is not a tag, and any duplicate name or id. */
export function sanitizeTags(raw: unknown): ScoreTag[] {
  if (!Array.isArray(raw)) return [];
  const out: ScoreTag[] = [];
  const ids = new Set<string>();
  for (const r of raw as any[]) {
    if (!r || typeof r !== 'object') continue;
    if (typeof r.id !== 'string' || !r.id || ids.has(r.id)) continue;
    const label = typeof r.label === 'string' ? r.label.trim() : '';
    if (!label) continue;
    if (out.some((t) => sameTagName(t.label, label))) continue;
    ids.add(r.id);
    out.push({
      id: r.id,
      label: label.slice(0, 40),
      color: typeof r.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(r.color) ? r.color : TAG_COLORS[out.length % TAG_COLORS.length],
      createdAt: finite(r.createdAt) ? r.createdAt : 0,
    });
  }
  return out;
}

/** Drops anything that is not a learning, and tag ids that no longer exist. */
export function sanitizeLearnings(raw: unknown, tags: ScoreTag[]): Learning[] {
  if (!Array.isArray(raw)) return [];
  const known = new Set(tags.map((t) => t.id));
  const out: Learning[] = [];
  const ids = new Set<string>();
  for (const r of raw as any[]) {
    if (!r || typeof r !== 'object') continue;
    if (typeof r.id !== 'string' || !r.id || ids.has(r.id)) continue;
    if (typeof r.nodeId !== 'string' || !r.nodeId) continue;
    const text = typeof r.text === 'string' ? r.text.trim() : '';
    if (!text) continue;
    ids.add(r.id);
    out.push({
      id: r.id,
      nodeId: r.nodeId,
      text,
      tags: Array.isArray(r.tags) ? [...new Set(r.tags.filter((t: unknown) => typeof t === 'string' && known.has(t)))] as string[] : [],
      createdAt: finite(r.createdAt) ? r.createdAt : 0,
      updatedAt: finite(r.updatedAt) ? r.updatedAt : 0,
    });
  }
  return out;
}
