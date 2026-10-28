// Today's board, the pure part: how widgets pack into the grid, the default arrangement, the edits to a layout, and
// what the day's widgets read (the list, what is next, what is coming up). No React and no store, so
// scripts/test-widgets.js checks it in Node.

import type { TodayWidget, WidgetSize } from '../store';
import { DAY_NAMES, blockOnNow, dayName, todayKey, toMinutes, todoDueOn } from '../utils';

/* ---------------------------------------------------------------- the grid */

/** One cell's height: an S widget is one cell, an M is full width and one cell tall, an L two cells tall. */
export const CELL_H = 156;
/** between widgets, across and down: the spacing floor's gap */
export const GRID_GAP = 14;
/** an L widget's height: two cells and the gap between them */
export const L_H = CELL_H * 2 + GRID_GAP;

/** How many cells a widget spans across: S one; M and L the whole row on a phone (2 cells), half of a wide one (4). */
export function spanOf(size: WidgetSize, cols: number): number {
  return size === 'S' ? 1 : Math.min(cols, 2);
}

/** A widget's fixed height by size (a flow widget takes its own). */
export const heightOf = (size: WidgetSize) => (size === 'L' ? L_H : CELL_H);

/** What the board lays out, in order: a widget, or (while editing) an empty run of cells that offers Add. */
export type BoardSlot =
  | { kind: 'widget'; id: string; span: number; row: number; col: number }
  | { kind: 'gap'; key: string; span: number; row: number; col: number };

/**
 * Packs widgets into rows of `cols` cells in their order, as the screen's wrapping row does: one that does not fit on
 * the row moves to the next. Each run of cells a row leaves empty comes back as a gap, after the widgets of its row.
 */
export function packBoard(items: readonly { id: string; span: number }[], cols: number): BoardSlot[] {
  const out: BoardSlot[] = [];
  let row = 0;
  let used = 0;
  const close = () => {
    if (used > 0 && used < cols) out.push({ kind: 'gap', key: 'gap-' + row, span: cols - used, row, col: used });
  };
  for (const it of items) {
    const span = Math.max(1, Math.min(cols, it.span));
    if (used + span > cols) {
      close();
      row++;
      used = 0;
    }
    out.push({ kind: 'widget', id: it.id, span, row, col: used });
    used += span;
    if (used === cols) {
      row++;
      used = 0;
    }
  }
  close();
  return out;
}

/* ---------------------------------------------------------------- columns: the board as it is laid out and dragged */

/**
 * How many columns Today's board has in an area this wide: one on a phone (its S tiles two to a row, as ever), two on a
 * tablet upright, an opened foldable or a split screen, three on a tablet turned sideways or a desktop window.
 */
export function boardColumns(areaW: number): 1 | 2 | 3 {
  if (areaW >= 1080) return 3;
  if (areaW >= 600) return 2;
  return 1;
}

/** One widget as the column layout reads it: half a column (an S tile) or the whole, and its height. */
export interface ColItem { id: string; half: boolean; h: number }
export interface ColRect { x: number; y: number; w: number; h: number; col: number }
/** An empty half a lone S tile leaves beside it: while editing, it offers Add. */
export interface ColGap { key: string; afterId: string; x: number; y: number; w: number; h: number; col: number }

/**
 * Lays out columns of widgets: each column top to bottom, an S tile taking half its width (two side by side in a row,
 * the second on the right), the rest the whole width, `gap` between them across and down. Returns each widget's place,
 * the half-rows left empty, and each column's height (its last widget's foot, no gap after it).
 */
export function layoutColumns(
  columns: readonly (readonly string[])[], items: ReadonlyMap<string, ColItem>, colW: number, gap: number,
): { rects: Map<string, ColRect>; gaps: ColGap[]; heights: number[] } {
  const rects = new Map<string, ColRect>();
  const gaps: ColGap[] = [];
  const heights: number[] = [];
  const halfW = Math.max(0, (colW - gap) / 2);
  columns.forEach((ids, col) => {
    const x0 = col * (colW + gap);
    let y = 0;
    let pending: ColItem | null = null;
    const closeRow = () => {
      if (!pending) return;
      gaps.push({ key: 'gap-' + pending.id, afterId: pending.id, x: x0 + halfW + gap, y, w: halfW, h: pending.h, col });
      y += pending.h + gap;
      pending = null;
    };
    for (const id of ids) {
      const it = items.get(id);
      if (!it) continue;
      // a section with nothing to show today (no plan, nothing coming up) takes no room, and no gap either
      if (!it.half && it.h <= 0) {
        rects.set(id, { x: x0, y, w: colW, h: 0, col });
        continue;
      }
      if (it.half) {
        if (pending) {
          rects.set(id, { x: x0 + halfW + gap, y, w: halfW, h: it.h, col });
          y += Math.max(pending.h, it.h) + gap;
          pending = null;
        } else {
          rects.set(id, { x: x0, y, w: halfW, h: it.h, col });
          pending = it;
        }
      } else {
        closeRow();
        rects.set(id, { x: x0, y, w: colW, h: it.h, col });
        y += it.h + gap;
      }
    }
    closeRow();
    heights.push(Math.max(0, y - gap));
  });
  return { rects, gaps, heights };
}

/**
 * A wide board's columns for the widgets shown: the kept arrangement when there is one (a widget it does not know yet
 * goes to the foot of the shortest column, one it knows that is gone is left out), else the widgets dealt out in their
 * order, each to the shortest column so far, so the columns end close together.
 */
export function arrangeColumns(
  ids: readonly string[], count: number, saved: readonly (readonly string[])[] | null | undefined,
  heightOf: (id: string) => number,
): string[][] {
  if (count <= 1) return [ids.slice()];
  const known = new Set(ids);
  const cols: string[][] = Array.from({ length: count }, (_, i) => (saved && saved.length === count ? saved[i].filter((id) => known.has(id)) : []));
  const placed = new Set(cols.flat());
  const height = (col: string[]) => col.reduce((n, id) => n + heightOf(id) + GRID_GAP, 0);
  for (const id of ids) {
    if (placed.has(id)) continue;
    let best = 0;
    for (let i = 1; i < count; i++) if (height(cols[i]) < height(cols[best]) - 0.5) best = i;
    cols[best].push(id);
    placed.add(id);
  }
  return cols;
}

/** Moves one widget to `index` of column `col` (counted without it), the others closing up around it. */
export function moveInColumns(columns: readonly (readonly string[])[], id: string, col: number, index: number): string[][] {
  const out = columns.map((c) => c.filter((x) => x !== id));
  const c = Math.max(0, Math.min(out.length - 1, col));
  out[c].splice(Math.max(0, Math.min(index, out[c].length)), 0, id);
  return out;
}

/**
 * Where a widget being dragged would go: the column under its centre, and its place in that column among the others
 * as they would lie without it. A widget comes after another whose middle the centre has passed going down; beside an
 * S tile in the same row, after it once the centre is past its middle across. Worked against the board without the
 * dragged widget, which does not move while the drag lasts, so the place never flickers between two answers as the
 * others glide to make room.
 */
export function dropTarget(
  columns: readonly (readonly string[])[], id: string, items: ReadonlyMap<string, ColItem>, colW: number, gap: number,
  cx: number, cy: number,
): { col: number; index: number } {
  const count = columns.length;
  const col = Math.max(0, Math.min(count - 1, Math.floor((cx + gap / 2) / (colW + gap))));
  const rest = columns.map((c) => c.filter((x) => x !== id));
  const { rects } = layoutColumns(rest, items, colW, gap);
  const ids = rest[col];
  const self = items.get(id);
  let index = 0;
  for (let i = 0; i < ids.length; i++) {
    const r = rects.get(ids[i]);
    if (!r) continue;
    const midY = r.y + r.h / 2;
    const sameRow = cy >= r.y && cy <= r.y + r.h;
    // an S tile dragged across a row of S tiles takes its side; anything else goes by height
    const after = sameRow && self?.half && items.get(ids[i])?.half ? cx > r.x + r.w / 2 : cy > midY;
    if (after) index = i + 1;
  }
  return { col, index };
}

/* ---------------------------------------------------------------- layouts */

/**
 * The board before it is first edited: Today as it has always been, top to bottom. The ids are fixed, so the default
 * arrangement never changes identity between renders.
 */
export const DEFAULT_LAYOUT: readonly TodayWidget[] = Object.freeze([
  { id: 'd-plan', type: 'plan', size: 'M' },
  { id: 'd-glance', type: 'glance', size: 'M' },
  { id: 'd-coming', type: 'coming', size: 'M' },
  { id: 'd-quick', type: 'quick', size: 'M' },
  { id: 'd-journal', type: 'journalNudge', size: 'M' },
  { id: 'd-list', type: 'todayList', size: 'M' },
  { id: 'd-habits', type: 'habits', size: 'M' },
  { id: 'd-week', type: 'focusBars', size: 'M' },
] as TodayWidget[]);

/** The layout to edit: the saved one, or a copy of the default. */
export const materialise = (layout: readonly TodayWidget[] | null): TodayWidget[] =>
  (layout ? layout.map((w) => ({ ...w })) : DEFAULT_LAYOUT.map((w) => ({ ...w })));

/**
 * The saved layout made to fit the widgets there are: a type the registry does not know goes, and a size its type does
 * not come in becomes the type's first size.
 */
export function fitLayout(
  layout: readonly TodayWidget[],
  sizesOf: (type: string) => readonly WidgetSize[] | null,
): TodayWidget[] {
  const out: TodayWidget[] = [];
  for (const w of layout) {
    const sizes = sizesOf(w.type);
    if (!sizes || !sizes.length) continue;
    out.push(sizes.includes(w.size) ? w : { ...w, size: sizes[0] });
  }
  return out;
}

/** Moves the widget at `from` to `to`, the others closing up around it. */
export function moveWidget<T>(list: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return list.slice();
  const next = list.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** The size after `size` in a type's sizes, round again to the first. */
export function nextSize(sizes: readonly WidgetSize[], size: WidgetSize): WidgetSize {
  const at = sizes.indexOf(size);
  return sizes[(at + 1) % sizes.length] ?? size;
}

/** The layout without one widget, with what an Undo needs to put it back. */
export function removeWidget(list: readonly TodayWidget[], id: string): { list: TodayWidget[]; removed: TodayWidget | null; index: number } {
  const index = list.findIndex((w) => w.id === id);
  if (index < 0) return { list: list.slice(), removed: null, index: -1 };
  return { list: list.filter((w) => w.id !== id), removed: list[index], index };
}

/** A widget put back (or added) at `index`, never twice. */
export function insertWidget(list: readonly TodayWidget[], w: TodayWidget, index: number): TodayWidget[] {
  if (list.some((x) => x.id === w.id)) return list.slice();
  const next = list.slice();
  next.splice(Math.max(0, Math.min(index, next.length)), 0, w);
  return next;
}

/* ---------------------------------------------------------------- the day */

/** Whole calendar days from one day key to another. */
export function daysBetween(from: string, to: string): number {
  const a = from.split('-').map(Number);
  const b = to.split('-').map(Number);
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000);
}

/** One row of Today's list: a ToDo, or a long-term task due today or late. */
export interface TodayItem {
  kind: 'daily' | 'mission';
  id: string;
  title: string;
  done: boolean;
  overdue: boolean;
  /** 'HH:MM' it is due by, or '' */
  time: string;
}

interface DailyLike { id: string; title: string; doneOn: string | null; time?: string; repeat?: 'daily'; days?: number[] }
interface MissionLike { id: string; title: string; deadline: string; done: boolean; doneOn?: string; time?: string }

/**
 * Today's list. A task late by a day or more comes first, the longest overdue at the top (its time no longer says
 * anything). Then the rest by the time they are due by, and those with no time after them in the order they came: the
 * ToDos, then the tasks due today. A ToDo that repeats on chosen days shows only on those. A task ticked today stays,
 * done, until the day turns, so a mis-tap is undone in place.
 */
export function todayItems(dailies: readonly DailyLike[], missions: readonly MissionLike[], today: string): TodayItem[] {
  const late: (TodayItem & { deadline: string })[] = [];
  const rest: (TodayItem & { at: number; i: number })[] = [];
  let i = 0;
  for (const t of dailies) {
    if (!todoDueOn(t, today)) continue;
    const time = t.time ?? '';
    const m = toMinutes(time);
    rest.push({ kind: 'daily', id: t.id, title: t.title, done: t.doneOn === today, overdue: false, time, at: m >= 0 ? m : Infinity, i: i++ });
  }
  for (const m of missions) {
    const d = daysBetween(today, m.deadline);
    if (d > 0 || (m.done && m.doneOn !== today)) continue;
    if (d < 0) {
      late.push({ kind: 'mission', id: m.id, title: m.title, done: m.done, overdue: true, time: '', deadline: m.deadline });
    } else {
      const time = m.time ?? '';
      const at = toMinutes(time);
      rest.push({ kind: 'mission', id: m.id, title: m.title, done: m.done, overdue: false, time, at: at >= 0 ? at : Infinity, i: i++ });
    }
  }
  late.sort((a, b) => (a.deadline < b.deadline ? -1 : a.deadline > b.deadline ? 1 : 0));
  rest.sort((a, b) => (a.at === b.at ? a.i - b.i : a.at - b.at));
  return [
    ...late.map(({ deadline: _d, ...x }) => x),
    ...rest.map(({ at: _a, i: _i, ...x }) => x),
  ];
}

/** The single most urgent thing left today: the first open row of the list. */
export const nextUpOf = (items: readonly TodayItem[]): TodayItem | null => items.find((t) => !t.done) ?? null;

export interface BlockLike { id: string; subject: string; start: string; end: string; color: string }
export type NextTag = 'NOW' | 'NEXT UP' | 'TOMORROW';

/**
 * The block Today's plan card shows: today's block on now (of two that overlap, the one that ends first), or today's
 * next, or, with the day's blocks over, tomorrow's first. Null with nothing planned for either.
 */
export function nextBlockOf(planner: Record<string, readonly BlockLike[] | undefined>, now: Date): { block: BlockLike; tag: NextTag } | null {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const sorted = (d: string) => [...(planner[d] || [])].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  const todays = sorted(dayName(now));
  const current = blockOnNow(todays, nowMin);
  if (current) return { block: current, tag: 'NOW' };
  const next = todays.find((b) => toMinutes(b.start) > nowMin);
  if (next) return { block: next, tag: 'NEXT UP' };
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const first = sorted(dayName(tomorrow))[0];
  return first ? { block: first, tag: 'TOMORROW' } : null;
}

/** Whether anything is planned on a day of the week other than `now`'s. */
export const otherDaysPlanned = (planner: Record<string, readonly unknown[] | undefined>, now: Date) =>
  DAY_NAMES.some((d) => d !== dayName(now) && (planner[d] || []).length > 0);

/** One row of Coming up. */
export interface ComingRow { kind: 'exam' | 'task'; id: string; title: string; days: number }

/** how far ahead Coming up looks for exams, and for long-term tasks, in days */
export const COMING_EXAM_DAYS = 30;
export const COMING_TASK_DAYS = 7;
export const COMING_MAX = 4;

/**
 * Coming up: dated exams still to sit within 30 days and open long-term tasks due within the week (a task due today
 * or late is on the list already), soonest first, an exam before a task on the same day. At most four.
 */
export function comingUp(
  exams: readonly { id: string; title: string; date?: string }[],
  missions: readonly MissionLike[],
  today: string,
): ComingRow[] {
  const rows: ComingRow[] = [];
  for (const e of exams) {
    if (!e.date) continue;
    const d = daysBetween(today, e.date);
    if (d >= 0 && d <= COMING_EXAM_DAYS) rows.push({ kind: 'exam', id: e.id, title: e.title.trim() || 'An exam', days: d });
  }
  for (const m of missions) {
    if (m.done) continue;
    const d = daysBetween(today, m.deadline);
    if (d >= 1 && d <= COMING_TASK_DAYS) rows.push({ kind: 'task', id: m.id, title: m.title, days: d });
  }
  rows.sort((a, b) => a.days - b.days || (a.kind === b.kind ? 0 : a.kind === 'exam' ? -1 : 1));
  return rows.slice(0, COMING_MAX);
}

/** "Today", "D-1", "D-12": the pill on a row that is some days off. */
export const dPill = (days: number) => (days <= 0 ? 'Today' : 'D-' + days);

/** The seven day keys ending today, oldest first. */
export function lastSevenDays(today: string = todayKey()): string[] {
  const [y, m, d] = today.split('-').map(Number);
  const out: string[] = [];
  for (let i = 6; i >= 0; i--) out.push(todayKey(new Date(y, m - 1, d - i)));
  return out;
}

/** How far through a block the clock is, 0 to 1 (0 before it starts, 1 once it is over). */
export function blockProgress(b: { start: string; end: string }, now: Date): number {
  const s = toMinutes(b.start);
  const e = toMinutes(b.end);
  const m = now.getHours() * 60 + now.getMinutes();
  if (!(e > s)) return 0;
  return Math.max(0, Math.min(1, (m - s) / (e - s)));
}

/** Whole minutes left in a block from now (0 once it is over). */
export function minutesLeft(b: { end: string }, now: Date): number {
  const e = Math.min(1440, toMinutes(b.end));
  const m = now.getHours() * 60 + now.getMinutes();
  return Math.max(0, e - m);
}

/**
 * The stretch of the day a line of blocks is drawn over: from the whole hour the first starts in to the whole hour after
 * the last ends, widened an hour each side in turn to at least four hours, inside midnight to midnight.
 */
export function dayWindow(blocks: readonly { start: string; end: string }[]): { start: number; end: number } {
  if (!blocks.length) return { start: 8 * 60, end: 18 * 60 };
  let lo = 1440;
  let hi = 0;
  for (const b of blocks) {
    lo = Math.min(lo, toMinutes(b.start));
    hi = Math.max(hi, Math.min(1440, toMinutes(b.end)));
  }
  let start = Math.max(0, Math.floor(lo / 60) * 60);
  let end = Math.min(1440, Math.ceil(hi / 60) * 60);
  while (end - start < 240) {
    if (start > 0) start -= 60;
    if (end - start < 240 && end < 1440) end += 60;
    if (start === 0 && end === 1440) break;
  }
  return { start, end };
}

/** A note's name on a widget: its title, or its first line, or "Untitled". */
export function noteTitleOf(n: { title: string; body: string }): string {
  const t = (n.title || '').trim();
  if (t) return t;
  const first = (n.body || '').split('\n').map((l) => l.trim()).find(Boolean);
  return first ? first.slice(0, 80) : 'Untitled';
}

/** A line of what a note says, its markup let go: the body after the title's own line, to about 90 letters. */
export function noteExcerptOf(n: { title: string; body: string }): string {
  const lines = (n.body || '').split('\n').map((l) => l.replace(/^[#>*\-\s\[\]x]+/i, '').trim()).filter(Boolean);
  if (!(n.title || '').trim()) lines.shift();
  const text = lines.join(' ');
  return text.length > 90 ? text.slice(0, 89).trimEnd() + '…' : text;
}

/** Videos opened most recently first (those never opened by when they were added), at most `n`. */
export function recentVideos<V extends { openedAt?: number; addedAt: number }>(videos: readonly V[], n: number): V[] {
  return videos.slice().sort((a, b) => (b.openedAt || b.addedAt) - (a.openedAt || a.addedAt)).slice(0, n);
}

/** The video to carry on with: the one opened most recently that was left part-way, else the one opened most recently. */
export function continueVideo<V extends { openedAt?: number; addedAt: number; resumeAt?: number }>(videos: readonly V[]): V | null {
  const recent = recentVideos(videos, videos.length);
  return recent.find((v) => (v.resumeAt || 0) > 0) ?? recent[0] ?? null;
}
