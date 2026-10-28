// The phone's home-screen widgets, the pure part: which widgets there are and the tool each belongs to, the rows they
// read, the links their taps open, and what each one shows (its model), worked out from the saved rows and the clock.
// No React, no React Native and no store at run time (only its types), so the widget task handler can use it without
// waking the app, and scripts/test-phone-widgets.js checks it in Node.

import type {
  ActiveSession, AiLink, DailyTask, FocusSession, Habit, JournalEntry, Mission, Note, PlannerBlock, VaultVideo,
} from '../../store';
import type { ScoreNode } from '../../scores';
import { fmtExamDate, fmtPct, indexScores, resultTable, topExams, upcoming, whenOf } from '../../scores';
import { focusWeek, subjectSummary, subjectsOf } from '../../subjects';
import { journalDayFor, journalStreak, moodSeries, onThisDay, promptFor } from '../../journalCore';
import { DAY_NAMES, DayName, blockOnNow, dayName, fmtClockTime, fmtMediaTime, focusStreak, habitDueOn, streaks, toMinutes, todayKey } from '../../utils';
import {
  blockProgress, dPill, daysBetween, dayWindow, lastSevenDays, minutesLeft, nextBlockOf, nextUpOf, noteExcerptOf,
  noteTitleOf, recentVideos, todayItems, TodayItem,
} from '../logic';

/* ---------------------------------------------------------------- the widgets */

/** The tools a widget can belong to (as src/tools.ts names them); null is the app itself. */
export type PhoneTool = 'tasks' | 'focus' | 'planner' | 'notes' | 'journal' | 'scores' | 'vault' | 'ai';

/** Every phone widget, by the name app.json gives it, with its tool. */
export const PHONE_WIDGETS = {
  DayRing: null,
  AtAGlance: null,
  Agenda: null,
  Clock: null,
  Search: null,
  NextUp: 'tasks',
  Checklist: 'tasks',
  Deadlines: 'tasks',
  QuickStart: 'focus',
  Session: 'focus',
  FocusWeek: 'focus',
  NowNext: 'planner',
  TodaysBlocks: 'planner',
  HabitGrid: 'planner',
  Streak: 'planner',
  NewNote: 'notes',
  Pinned: 'notes',
  RecentNotes: 'notes',
  WriteToday: 'journal',
  MoodStrip: 'journal',
  OnThisDay: 'journal',
  Countdown: 'scores',
  Results: 'scores',
  SubjectTrend: 'scores',
  ContinueWatching: 'vault',
  WatchList: 'vault',
  AiDock: 'ai',
} as const satisfies Record<string, PhoneTool | null>;

export type PhoneWidgetName = keyof typeof PHONE_WIDGETS;
export const PHONE_WIDGET_NAMES = Object.keys(PHONE_WIDGETS) as PhoneWidgetName[];
export const isPhoneWidget = (v: unknown): v is PhoneWidgetName =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(PHONE_WIDGETS, v);

const TOOL_LABEL: Record<PhoneTool, string> = {
  tasks: 'Tasks', focus: 'Deep Work', planner: 'Planner', notes: 'Notes', journal: 'Journal', scores: 'Scores',
  vault: 'YT Vault', ai: 'AI Quick-Links',
};
/** Tools archived on a fresh install (tools.ts DEFAULT_ARCHIVED). */
const DEFAULT_ARCHIVED = ['desmos', 'ai'];
const DEFAULT_SLOTS = ['tasks', 'focus', 'planner'];

/* ---------------------------------------------------------------- the rows */

/** The collections the widgets read, each its own row in storage (store.ts: 'student-hub-v2[__id]:<name>'). */
export const PHONE_ROWS = [
  'settings', 'dailyTasks', 'missions', 'sessions', 'planner', 'habits', 'notes', 'journal', 'scores', 'vaultVideos',
  'aiLinks', 'deepWork',
] as const;
export type PhoneRow = (typeof PHONE_ROWS)[number];

/** The settings the widgets read. */
export interface PhoneSettings {
  name: string;
  theme: 'default' | 'minimal';
  accent: string;
  hour24: boolean;
  journalLocked: boolean;
  notesLocked: boolean;
  journalCutoffHour: number;
  journalPromptsOn: boolean;
  journalWordGoal: number;
  archivedTools: string[];
  tabSlots: string[];
  focusLastMin: number;
  focusGoalMin: number;
}

/** What the widgets are drawn from: the saved rows, each checked enough that nothing in them can throw. */
export interface PhoneData {
  settings: PhoneSettings;
  dailyTasks: DailyTask[];
  missions: Mission[];
  sessions: FocusSession[];
  planner: Record<string, PlannerBlock[]>;
  habits: Habit[];
  notes: Note[];
  journal: JournalEntry[];
  scores: ScoreNode[];
  vaultVideos: VaultVideo[];
  aiLinks: AiLink[];
  deepWork: ActiveSession | null;
}

const DEFAULT_ACCENT = '#9588F9';
const isRecord = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const num = (v: unknown, d = 0): number => (typeof v === 'number' && isFinite(v) ? v : d);
const bool = (v: unknown, d = false): boolean => (typeof v === 'boolean' ? v : d);
const isKey = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isHhmm = (v: unknown): v is string => typeof v === 'string' && /^\d{1,2}:\d{2}$/.test(v);
/** the records of a row that have an id (and pass `ok`) */
function list<T>(v: unknown, ok: (x: Record<string, any>) => boolean = () => true): T[] {
  return Array.isArray(v) ? (v.filter((x) => isRecord(x) && typeof x.id === 'string' && ok(x)) as T[]) : [];
}

/**
 * The rows as the widgets can trust them. `rows` holds each collection as saved (parsed), or nothing for one that is
 * missing; whatever is missing or malformed reads as empty, as on a fresh install.
 */
export function cleanData(rows: Partial<Record<PhoneRow, unknown>>): PhoneData {
  const s = isRecord(rows.settings) ? rows.settings : {};
  const settings: PhoneSettings = {
    name: str(s.name).trim(),
    theme: s.theme === 'minimal' ? 'minimal' : 'default',
    accent: typeof s.accent === 'string' && /^#[0-9a-f]{6}$/i.test(s.accent) ? s.accent : DEFAULT_ACCENT,
    hour24: bool(s.hour24),
    journalLocked: bool(s.journalLocked),
    notesLocked: bool(s.notesLocked),
    journalCutoffHour: Math.max(0, Math.min(23, Math.round(num(s.journalCutoffHour, 11)))),
    journalPromptsOn: bool(s.journalPromptsOn, true),
    journalWordGoal: Math.max(0, num(s.journalWordGoal)),
    archivedTools: Array.isArray(s.archivedTools) ? s.archivedTools.filter((k: unknown) => typeof k === 'string') : [...DEFAULT_ARCHIVED],
    tabSlots: Array.isArray(s.tabSlots) ? s.tabSlots.filter((k: unknown) => typeof k === 'string') : [...DEFAULT_SLOTS],
    focusLastMin: Math.max(0, Math.round(num(s.focusLastMin, 50))),
    focusGoalMin: Math.max(0, Math.round(num(s.focusGoalMin))),
  };
  const plannerRow = isRecord(rows.planner) ? rows.planner : {};
  const planner: Record<string, PlannerBlock[]> = {};
  for (const d of DAY_NAMES) {
    planner[d] = list<PlannerBlock>(plannerRow[d], (b) => isHhmm(b.start) && isHhmm(b.end)).map((b) => ({
      ...b, subject: str(b.subject), color: str(b.color),
    }));
  }
  const dw = rows.deepWork;
  return {
    settings,
    dailyTasks: list<DailyTask>(rows.dailyTasks, (t) => typeof t.title === 'string').map((t) => ({
      ...t, doneOn: typeof t.doneOn === 'string' ? t.doneOn : null,
    })),
    missions: list<Mission>(rows.missions, (m) => typeof m.title === 'string' && isKey(m.deadline)).map((m) => ({
      ...m, done: !!m.done, subtasks: Array.isArray(m.subtasks) ? m.subtasks.filter(isRecord) : [],
    })),
    sessions: list<FocusSession>(rows.sessions, (x) => isKey(x.dateKey) && typeof x.netSeconds === 'number'),
    planner,
    habits: list<Habit>(rows.habits, (h) => typeof h.title === 'string').map((h) => ({
      ...h, doneDates: Array.isArray(h.doneDates) ? h.doneDates.filter(isKey) : [],
    })),
    notes: list<Note>(rows.notes).map((n) => ({
      ...n, title: str(n.title), body: str(n.body), folder: str(n.folder), pinned: !!n.pinned,
      updatedAt: num(n.updatedAt), createdAt: num(n.createdAt), tags: Array.isArray(n.tags) ? n.tags : [],
    })),
    journal: list<JournalEntry>(rows.journal, (e) => isKey(e.dateKey)).map((e) => ({
      ...e, title: str(e.title), excerpt: str(e.excerpt), wordCount: Math.max(0, num(e.wordCount)),
      tags: Array.isArray(e.tags) ? e.tags : [],
    })),
    scores: list<ScoreNode>(rows.scores, (n) => (n.kind === 'group' || n.kind === 'exam') && typeof n.title === 'string'),
    vaultVideos: list<VaultVideo>(rows.vaultVideos, (v) => typeof v.videoId === 'string').map((v) => ({
      ...v, title: str(v.title), addedAt: num(v.addedAt),
    })),
    aiLinks: list<AiLink>(rows.aiLinks, (l) => typeof l.url === 'string' && /^https?:\/\//i.test(l.url)),
    deepWork: isRecord(dw) && typeof dw.startedAt === 'number' ? (dw as ActiveSession) : null,
  };
}

/** The tools kept out of sight, as tools.ts normaliseArchived keeps them: never one in a tab slot. */
export function archivedOf(s: PhoneSettings): string[] {
  return s.archivedTools.filter((k) => !s.tabSlots.includes(k));
}

/* ---------------------------------------------------------------- links */

export const APP_LINK = {
  search: 'sturoids://search',
  newNote: 'sturoids://new-note',
  addTodo: 'sturoids://add-todo',
  startFocus: 'sturoids://start-focus',
} as const;

/** sturoids://open?tool=<tool>&… — opens a tool, on one of its things (src/appLinks.ts reads it). */
export function openLink(tool: PhoneTool, params: Record<string, string | number | undefined> = {}): string {
  let q = 'tool=' + tool;
  for (const k of Object.keys(params)) {
    const v = params[k];
    if (v === undefined || v === '') continue;
    q += '&' + k + '=' + encodeURIComponent(String(v));
  }
  return 'sturoids://open?' + q;
}

/* ---------------------------------------------------------------- gates */

/** A widget shown in place of its content: its tool is archived, or locked. */
export interface Gate { kind: 'archived' | 'locked'; tool: PhoneTool; title: string; body: string; uri: string }

/**
 * What stands in front of a widget's content: an archived tool (its content stays out of sight, as in the app), or the
 * Notes or Journal tool behind the app PIN (nothing of it is drawn on the home screen). Null when nothing does.
 */
export function gateOf(name: PhoneWidgetName, d: PhoneData): Gate | null {
  const tool = PHONE_WIDGETS[name] as PhoneTool | null;
  if (!tool) return null;
  const label = TOOL_LABEL[tool];
  if (archivedOf(d.settings).includes(tool)) {
    return { kind: 'archived', tool, title: label + ' is archived', body: 'Restore it in Settings to see it here', uri: openLink(tool) };
  }
  if ((tool === 'notes' && d.settings.notesLocked) || (tool === 'journal' && d.settings.journalLocked)) {
    return { kind: 'locked', tool, title: label + ' is locked', body: 'Tap to unlock in Sturoids', uri: openLink(tool) };
  }
  return null;
}

/** Whether a tool's content may show inside one of the app's own widgets (Agenda, At a glance…). */
const shows = (d: PhoneData, tool: PhoneTool) => !archivedOf(d.settings).includes(tool);

/* ---------------------------------------------------------------- shared reads */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** A time of day on the user's clock, as compact as it reads: "4:00 pm" or "16:00". */
export const clockOf = (hhmm: string, hour24: boolean) => fmtClockTime(Math.max(0, toMinutes(hhmm)), hour24);
const nowMinOf = (now: Date) => now.getHours() * 60 + now.getMinutes();

/** The minutes focused today, a session in flight counted as it stands. */
export function focusToday(d: PhoneData, now: Date): number {
  const today = todayKey(now);
  let secs = 0;
  for (const x of d.sessions) if (x.dateKey === today) secs += Math.max(0, x.netSeconds);
  return Math.round(secs / 60) + liveMin(d.deepWork, now, today);
}

/** A Deep Work session in flight, in whole minutes for `today` (0 with none, or one begun another day). */
export function liveMin(w: ActiveSession | null, now: Date, today = todayKey(now)): number {
  if (!w || todayKey(new Date(w.startedAt)) !== today) return 0;
  return Math.round(liveSec(w, now) / 60);
}

function liveSec(w: ActiveSession, now: Date): number {
  const cap = w.mode === 'countdown' ? Math.max(0, num(w.targetMin)) * 60 : Infinity;
  const run = w.running && w.startTs ? Math.max(0, now.getTime() - w.startTs) / 1000 : 0;
  return Math.min(cap, Math.max(0, num(w.accumSec)) + run);
}

function itemsOf(d: PhoneData, today: string): TodayItem[] {
  return shows(d, 'tasks') ? todayItems(d.dailyTasks, d.missions, today) : [];
}

const itemLink = (t: { id: string }) => openLink('tasks', { item: t.id });
const blockLink = (day: DayName, id: string) => openLink('planner', { day, item: id });

/* ---------------------------------------------------------------- the models */

export interface Row { id: string; title: string; sub: string; uri: string; tint?: string; done?: boolean; late?: boolean }

export interface DayRingModel { left: number; done: number; total: number; focusMin: number; goalMin: number; uri: string }
export function dayRingModel(d: PhoneData, now: Date): DayRingModel {
  const items = itemsOf(d, todayKey(now));
  const done = items.filter((t) => t.done).length;
  return {
    left: items.length - done, done, total: items.length,
    focusMin: shows(d, 'focus') ? focusToday(d, now) : 0,
    goalMin: shows(d, 'focus') ? d.settings.focusGoalMin : 0,
    uri: openLink('tasks'),
  };
}

export interface BlockModel { id: string; subject: string; color: string; range: string; tag: 'NOW' | 'NEXT UP' | 'TOMORROW'; progress: number; minLeft: number; uri: string }

function blockModel(d: PhoneData, now: Date): BlockModel | null {
  if (!shows(d, 'planner')) return null;
  const next = nextBlockOf(d.planner, now);
  if (!next) return null;
  const b = next.block;
  const day = next.tag === 'TOMORROW' ? dayName(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)) : dayName(now);
  return {
    id: b.id, subject: b.subject.trim() || 'Block', color: b.color,
    range: clockOf(b.start, d.settings.hour24) + ' – ' + clockOf(b.end, d.settings.hour24),
    tag: next.tag,
    progress: next.tag === 'NOW' ? blockProgress(b, now) : 0,
    minLeft: next.tag === 'NOW' ? minutesLeft(b, now) : 0,
    uri: blockLink(day, b.id),
  };
}

export interface HabitDot { id: string; title: string; done: boolean }
function todaysHabits(d: PhoneData, today: string): HabitDot[] {
  if (!shows(d, 'planner')) return [];
  return d.habits
    .filter((h) => habitDueOn(h, today) || h.doneDates.includes(today))
    .map((h) => ({ id: h.id, title: h.title, done: h.doneDates.includes(today) }));
}

export interface AtAGlanceModel { block: BlockModel | null; todos: Row[]; left: number; habits: HabitDot[]; uri: string }
export function atAGlanceModel(d: PhoneData, now: Date): AtAGlanceModel {
  const today = todayKey(now);
  const open = itemsOf(d, today).filter((t) => !t.done);
  return {
    block: blockModel(d, now),
    todos: open.slice(0, 3).map((t) => itemRow(t, d.settings.hour24)),
    left: open.length,
    habits: todaysHabits(d, today).slice(0, 8),
    uri: openLink('tasks'),
  };
}

function itemRow(t: TodayItem, hour24: boolean): Row {
  return {
    id: t.id, title: t.title.trim() || 'Untitled', done: t.done, late: t.overdue,
    sub: t.overdue ? 'Late' : t.time ? clockOf(t.time, hour24) : t.kind === 'mission' ? 'Due today' : '',
    uri: itemLink(t),
  };
}

export interface AgendaRow { id: string; kind: 'block' | 'todo' | 'task' | 'exam'; title: string; time: string; at: number; color: string; past: boolean; on: boolean; uri: string }
export interface AgendaModel { dateText: string; rows: AgendaRow[]; nowAt: number; untimed: number; uri: string }

/** Today in time order: the Planner's blocks, timed ToDos and tasks, and today's exams, with where now falls among them. */
export function agendaModel(d: PhoneData, now: Date): AgendaModel {
  const today = todayKey(now);
  const nowMin = nowMinOf(now);
  const h24 = d.settings.hour24;
  const rows: AgendaRow[] = [];
  const day = dayName(now);
  if (shows(d, 'planner')) {
    for (const b of d.planner[day] || []) {
      const s = toMinutes(b.start);
      const e = toMinutes(b.end);
      rows.push({
        id: b.id, kind: 'block', title: b.subject.trim() || 'Block', time: clockOf(b.start, h24) + ' – ' + clockOf(b.end, h24),
        at: s, color: b.color, past: e <= nowMin, on: s <= nowMin && nowMin < e, uri: blockLink(day, b.id),
      });
    }
  }
  let untimed = 0;
  for (const t of itemsOf(d, today)) {
    if (t.done) continue;
    const at = toMinutes(t.time);
    if (!(at >= 0) || t.overdue) {
      untimed++;
      continue;
    }
    rows.push({
      id: t.id, kind: t.kind === 'daily' ? 'todo' : 'task', title: t.title.trim() || 'Untitled', time: clockOf(t.time, h24),
      at, color: '', past: at < nowMin, on: false, uri: itemLink(t),
    });
  }
  if (shows(d, 'scores')) {
    for (const n of upcoming(indexScores(d.scores), null, today)) {
      if (n.date !== today) continue;
      rows.push({
        id: n.id, kind: 'exam', title: n.title.trim() || 'An exam', time: 'Today', at: -1, color: '', past: false, on: false,
        uri: openLink('scores', { item: n.id }),
      });
    }
  }
  rows.sort((a, b) => a.at - b.at);
  const nowAt = rows.findIndex((r) => r.at > nowMin);
  return { dateText: longDate(now), rows, nowAt: nowAt < 0 ? rows.length : nowAt, untimed, uri: openLink('planner') };
}

/** "Monday 26 Oct" */
export const longDate = (now: Date) => WEEKDAYS[now.getDay()] + ' ' + now.getDate() + ' ' + MONTHS[now.getMonth()];

export interface ClockModel {
  weekday: string; day: string; month: string; greeting: string;
  /** how far through the day it is, 0 to 1 */
  dayFrac: number;
  /** what comes next: a block, or a timed ToDo, as one line; '' with nothing */
  next: string;
  left: number;
  /** '' opens the app on Today */
  uri: string;
}

/** The part of the day, as the greeting says it. */
export function partOfDay(now: Date): 'morning' | 'afternoon' | 'evening' | 'night' {
  const h = now.getHours();
  return h < 5 ? 'night' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 22 ? 'evening' : 'night';
}

export function clockModel(d: PhoneData, now: Date): ClockModel {
  const today = todayKey(now);
  const h24 = d.settings.hour24;
  const nowMin = nowMinOf(now);
  const part = partOfDay(now);
  const first = d.settings.name.split(' ')[0];
  const items = itemsOf(d, today);
  let next = '';
  const b = blockModel(d, now);
  if (b && b.tag !== 'TOMORROW') {
    const block = (d.planner[dayName(now)] || []).find((x) => x.id === b.id);
    next = b.tag === 'NOW'
      ? b.subject + ' until ' + clockOf(block?.end || '', h24)
      : b.subject + ' at ' + clockOf(block?.start || '', h24);
  }
  if (!next) {
    const timed = items.find((t) => !t.done && !t.overdue && toMinutes(t.time) > nowMin);
    if (timed) next = (timed.title.trim() || 'A ToDo') + ' at ' + clockOf(timed.time, h24);
  }
  if (!next && b) next = 'Tomorrow: ' + b.subject;
  return {
    weekday: WEEKDAYS[now.getDay()], day: String(now.getDate()), month: MONTHS[now.getMonth()],
    greeting: (part === 'night' ? 'Good night' : 'Good ' + part) + (first ? ', ' + first : ''),
    dayFrac: Math.max(0, Math.min(1, (nowMin + now.getSeconds() / 60) / 1440)),
    next,
    left: items.filter((t) => !t.done).length,
    uri: '',
  };
}

export interface NextUpModel { item: Row | null; left: number; uri: string }
export function nextUpModel(d: PhoneData, now: Date): NextUpModel {
  const items = itemsOf(d, todayKey(now));
  const next = nextUpOf(items);
  return {
    item: next ? itemRow(next, d.settings.hour24) : null,
    left: items.filter((t) => !t.done).length,
    uri: next ? itemLink(next) : APP_LINK.addTodo,
  };
}

export interface ChecklistModel { rows: Row[]; left: number; done: number; uri: string }
export function checklistModel(d: PhoneData, now: Date): ChecklistModel {
  const items = itemsOf(d, todayKey(now));
  const open = items.filter((t) => !t.done);
  return {
    rows: open.slice(0, 4).map((t) => itemRow(t, d.settings.hour24)),
    left: open.length, done: items.length - open.length, uri: openLink('tasks'),
  };
}

export interface DeadlineRow extends Row { pill: string; steps: string; stepFrac: number; days: number }
export interface DeadlinesModel { rows: DeadlineRow[]; more: number; uri: string }
export function deadlinesModel(d: PhoneData, now: Date): DeadlinesModel {
  const today = todayKey(now);
  const open = d.missions.filter((m) => !m.done).sort((a, b) => a.deadline.localeCompare(b.deadline));
  return {
    rows: open.slice(0, 3).map((m) => {
      const days = daysBetween(today, m.deadline);
      const total = m.subtasks.length;
      const done = m.subtasks.filter((s) => s.done).length;
      return {
        id: m.id, title: m.title.trim() || 'Untitled', sub: '', uri: openLink('tasks', { list: 'missions', item: m.id }),
        pill: days < 0 ? 'Late' : dPill(days), days, late: days < 0,
        steps: total ? done + '/' + total : '', stepFrac: total ? done / total : 0,
      };
    }),
    more: Math.max(0, open.length - 3),
    uri: openLink('tasks', { list: 'missions' }),
  };
}

export interface QuickStartModel { minutes: number; todayMin: number; running: boolean; runningMin: number; uri: string }
export function quickStartModel(d: PhoneData, now: Date): QuickStartModel {
  const w = d.deepWork;
  return {
    minutes: d.settings.focusLastMin || 25,
    todayMin: focusToday(d, now),
    running: !!w,
    runningMin: w ? Math.floor(liveSec(w, now) / 60) : 0,
    uri: w ? openLink('focus') : APP_LINK.startFocus,
  };
}

export interface SessionModel {
  /** a session in flight: what it is on, how far, and when it ends */
  live: { subject: string; paused: boolean; elapsedMin: number; targetMin: number; countdown: boolean; frac: number; endsAt: string } | null;
  presets: { minutes: number; uri: string }[];
  todayMin: number;
  goalMin: number;
  uri: string;
}
export function sessionModel(d: PhoneData, now: Date): SessionModel {
  const w = d.deepWork;
  let live: SessionModel['live'] = null;
  if (w) {
    const sec = liveSec(w, now);
    const countdown = w.mode === 'countdown';
    const target = Math.max(0, num(w.targetMin));
    const endsMs = countdown && w.running && w.startTs ? w.startTs + (target * 60 - num(w.accumSec)) * 1000 : 0;
    const ends = endsMs ? new Date(endsMs) : null;
    live = {
      subject: str(w.subject).trim(), paused: !w.running, elapsedMin: Math.floor(sec / 60), targetMin: target, countdown,
      frac: countdown && target > 0 ? Math.min(1, sec / (target * 60)) : 0,
      endsAt: ends ? fmtClockTime(ends.getHours() * 60 + ends.getMinutes(), d.settings.hour24) : '',
    };
  }
  return {
    live,
    presets: [25, 50, 90].map((m) => ({ minutes: m, uri: openLink('focus', { minutes: m }) })),
    todayMin: focusToday(d, now),
    goalMin: d.settings.focusGoalMin,
    uri: openLink('focus'),
  };
}

export interface FocusWeekModel {
  days: { label: string; min: number; parts: { min: number; color: string }[]; today: boolean }[];
  maxMin: number; totalMin: number; best: string; streak: number;
  subjects: { name: string; color: string }[];
  uri: string;
}
/** the colours the Focus week gives its three most-focused subjects, then everything else */
export const FOCUS_COLORS = ['#9588F9', '#83DBD6', '#E3C08D', '#728AB7'];
export function focusWeekModel(d: PhoneData, now: Date): FocusWeekModel {
  const today = todayKey(now);
  const week = focusWeek(d.sessions, today);
  // a session still running counts on today, unnamed if it has no subject yet
  const live = liveMin(d.deepWork, now, today);
  const totals = new Map<string, { name: string; min: number }>();
  for (const day of week.days) for (const s of day.bySubject) {
    const t = totals.get(s.key);
    if (t) t.min += s.min;
    else totals.set(s.key, { name: s.name, min: s.min });
  }
  const top = [...totals.entries()].filter(([k]) => k !== '').sort((a, b) => b[1].min - a[1].min).slice(0, 3);
  const colorOf = (key: string) => {
    const i = top.findIndex(([k]) => k === key);
    return FOCUS_COLORS[i >= 0 ? i : 3];
  };
  const days = week.days.map((day) => {
    const isToday = day.dateKey === today;
    const parts = day.bySubject.map((s) => ({ min: s.min, color: colorOf(s.key) }));
    if (isToday && live > 0) parts.push({ min: live, color: FOCUS_COLORS[0] });
    const dt = new Date(day.dateKey + 'T00:00:00');
    return { label: WEEKDAYS[dt.getDay()].slice(0, 1), min: day.min + (isToday ? live : 0), parts, today: isToday };
  });
  const best = week.best ? WEEKDAYS[new Date(week.best.dateKey + 'T00:00:00').getDay()].slice(0, 3) + ' · ' + minText(week.best.min) : '';
  return {
    days, maxMin: Math.max(1, ...days.map((x) => x.min)), totalMin: week.totalMin + live, best,
    streak: focusStreak(d.sessions, d.settings.focusGoalMin || 1).current,
    subjects: top.map(([k, v]) => ({ name: v.name, color: colorOf(k) })),
    uri: openLink('focus'),
  };
}

/** "45 min", "2 h", "2 h 05" */
export function minText(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? h + ' h ' + String(r).padStart(2, '0') : h + ' h';
}

export interface NowNextModel { block: BlockModel | null; uri: string }
export function nowNextModel(d: PhoneData, now: Date): NowNextModel {
  const block = blockModel(d, now);
  return { block, uri: block ? block.uri : openLink('planner') };
}

export interface TodaysBlocksModel {
  blocks: { id: string; subject: string; color: string; from: number; to: number; on: boolean; time: string; uri: string }[];
  /** where now falls on the line, 0 to 1, or -1 outside it */
  nowAt: number;
  startLabel: string; endLabel: string;
  uri: string;
}
export function todaysBlocksModel(d: PhoneData, now: Date): TodaysBlocksModel {
  const day = dayName(now);
  const blocks = [...(d.planner[day] || [])].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  const win = dayWindow(blocks);
  const span = Math.max(1, win.end - win.start);
  const at = (m: number) => Math.max(0, Math.min(1, (m - win.start) / span));
  const nowMin = nowMinOf(now);
  const on = blockOnNow(blocks, nowMin);
  const h24 = d.settings.hour24;
  return {
    blocks: blocks.map((b) => ({
      id: b.id, subject: b.subject.trim() || 'Block', color: b.color, from: at(toMinutes(b.start)), to: at(Math.min(1440, toMinutes(b.end))),
      on: on?.id === b.id, time: clockOf(b.start, h24), uri: blockLink(day, b.id),
    })),
    nowAt: nowMin >= win.start && nowMin <= win.end ? at(nowMin) : -1,
    startLabel: fmtClockTime(win.start, h24), endLabel: fmtClockTime(win.end, h24),
    uri: openLink('planner', { day }),
  };
}

export interface HabitGridModel {
  days: { label: string; today: boolean }[];
  habits: { id: string; title: string; cells: ('done' | 'missed' | 'rest' | 'open')[]; uri: string }[];
  more: number;
  uri: string;
}
export function habitGridModel(d: PhoneData, now: Date): HabitGridModel {
  const today = todayKey(now);
  const keys = lastSevenDays(today);
  const rows = d.habits.slice(0, 4).map((h) => ({
    id: h.id, title: h.title.trim() || 'Habit',
    cells: keys.map((k) => {
      if (h.doneDates.includes(k)) return 'done' as const;
      if (!habitDueOn(h, k)) return 'rest' as const;
      return k === today ? ('open' as const) : ('missed' as const);
    }),
    uri: openLink('planner', { item: h.id }),
  }));
  return {
    days: keys.map((k) => ({ label: WEEKDAYS[new Date(k + 'T00:00:00').getDay()].slice(0, 1), today: k === today })),
    habits: rows, more: Math.max(0, d.habits.length - 4), uri: openLink('planner'),
  };
}

export interface StreakModel { title: string; current: number; best: number; atRisk: boolean; uri: string }
export function streakModel(d: PhoneData, now: Date): StreakModel | null {
  const today = todayKey(now);
  let pick: StreakModel | null = null;
  for (const h of d.habits) {
    const s = streaks(h.doneDates, h.days);
    const atRisk = s.current > 0 && habitDueOn(h, today) && !h.doneDates.includes(today);
    if (!pick || s.current > pick.current || (s.current === pick.current && s.best > pick.best)) {
      pick = { title: h.title.trim() || 'Habit', current: s.current, best: s.best, atRisk, uri: openLink('planner', { item: h.id }) };
    }
  }
  return pick;
}

export interface NoteRow { id: string; title: string; excerpt: string; folder: string; when: string; locked: boolean; uri: string }
function noteRow(n: Note, now: Date): NoteRow {
  return {
    id: n.id, title: noteTitleOf(n), excerpt: n.locked ? 'Locked' : noteExcerptOf(n), folder: n.folder,
    when: whenText(n.updatedAt, now), locked: !!n.locked, uri: openLink('notes', { item: n.id }),
  };
}
const byEdited = (notes: Note[]) => notes.slice().sort((a, b) => b.updatedAt - a.updatedAt);

/** "Today", "Yesterday", "Mon", "12 Oct" for a moment before now. */
export function whenText(ms: number, now: Date): string {
  if (!(ms > 0)) return '';
  const then = new Date(ms);
  const days = daysBetween(todayKey(then), todayKey(now));
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return WEEKDAYS[then.getDay()].slice(0, 3);
  return then.getDate() + ' ' + MONTHS[then.getMonth()];
}

export interface NewNoteModel { last: NoteRow | null; count: number; uri: string }
export function newNoteModel(d: PhoneData, now: Date): NewNoteModel {
  const last = byEdited(d.notes)[0];
  return { last: last ? noteRow(last, now) : null, count: d.notes.length, uri: APP_LINK.newNote };
}

export interface NotesModel { rows: NoteRow[]; uri: string }
export function pinnedModel(d: PhoneData, now: Date): NotesModel {
  return { rows: byEdited(d.notes.filter((n) => n.pinned)).slice(0, 3).map((n) => noteRow(n, now)), uri: openLink('notes') };
}
export function recentNotesModel(d: PhoneData, now: Date): NotesModel {
  return { rows: byEdited(d.notes).slice(0, 5).map((n) => noteRow(n, now)), uri: openLink('notes') };
}

export interface WriteTodayModel { dayKey: string; yesterday: boolean; words: number; goal: number; prompt: string; streak: number; uri: string }
export function writeTodayModel(d: PhoneData, now: Date): WriteTodayModel {
  const key = journalDayFor(now, d.settings.journalCutoffHour);
  const words = d.journal.filter((e) => e.dateKey === key).reduce((a, e) => a + e.wordCount, 0);
  return {
    dayKey: key, yesterday: key !== todayKey(now), words, goal: d.settings.journalWordGoal,
    prompt: d.settings.journalPromptsOn ? promptFor(key).text : '',
    streak: journalStreak(d.journal, d.settings.journalCutoffHour, now).current,
    uri: openLink('journal', { item: key }),
  };
}

export interface MoodStripModel { days: { mood: number | null; rating: number | null; today: boolean; label: string }[]; streak: number; written: number; uri: string }
/** the mood scale's colours, 1 (rough) to 5 (great) */
export const MOOD_COLORS = ['#E0958A', '#E3C08D', '#C2C0B6', '#83DBD6', '#9AD6B0'];
export function moodStripModel(d: PhoneData, now: Date): MoodStripModel {
  const today = todayKey(now);
  const series = moodSeries(d.journal, 14, today);
  return {
    days: series.map((x) => ({
      mood: x.mood, rating: x.rating, today: x.dateKey === today,
      label: WEEKDAYS[new Date(x.dateKey + 'T00:00:00').getDay()].slice(0, 1),
    })),
    streak: journalStreak(d.journal, d.settings.journalCutoffHour, now).current,
    written: series.filter((x) => x.words > 0).length,
    uri: openLink('journal'),
  };
}

export interface OnThisDayModel { entry: { title: string; excerpt: string; when: string; uri: string } | null; uri: string }
export function onThisDayModel(d: PhoneData, now: Date): OnThisDayModel {
  const today = todayKey(now);
  const e = onThisDay(d.journal, today)[0];
  if (!e) return { entry: null, uri: openLink('journal') };
  const years = Number(today.slice(0, 4)) - Number(e.dateKey.slice(0, 4));
  const when = e.dateKey.slice(5) === today.slice(5) ? (years === 1 ? 'A year ago' : years + ' years ago') : 'A month ago';
  return {
    entry: {
      title: e.title.trim() || fmtExamDate(e.dateKey, true, now), excerpt: e.excerpt.trim(), when,
      uri: openLink('journal', { item: e.dateKey, entry: e.id }),
    },
    uri: openLink('journal'),
  };
}

export interface CountdownModel { exam: { title: string; days: number; date: string; uri: string } | null; uri: string }
export function countdownModel(d: PhoneData, now: Date): CountdownModel {
  const today = todayKey(now);
  const next = upcoming(indexScores(d.scores), null, today)[0];
  if (!next || !next.date) return { exam: null, uri: openLink('scores') };
  return {
    exam: {
      title: next.title.trim() || 'An exam', days: daysBetween(today, next.date), date: fmtExamDate(next.date, false, now),
      uri: openLink('scores', { item: next.id }),
    },
    uri: openLink('scores'),
  };
}

export interface ResultsModel { rows: { id: string; title: string; pct: string; move: 'up' | 'down' | 'level' | 'none'; uri: string }[]; uri: string }
export function resultsModel(d: PhoneData): ResultsModel {
  const ix = indexScores(d.scores);
  const { result, delta } = resultTable(ix);
  const rows = topExams(ix)
    .filter((n) => result.get(n.id))
    .sort((a, b) => whenOf(b).localeCompare(whenOf(a)) || b.createdAt - a.createdAt)
    .slice(0, 3)
    .map((n) => {
      const dl = delta.get(n.id) ?? null;
      return {
        id: n.id, title: n.title.trim() || 'Exam', pct: fmtPct(result.get(n.id)!.pct),
        move: dl == null ? ('none' as const) : dl > 0.05 ? ('up' as const) : dl < -0.05 ? ('down' as const) : ('level' as const),
        uri: openLink('scores', { item: n.id }),
      };
    });
  return { rows, uri: openLink('scores') };
}

export interface SubjectTrendModel { subject: string; values: number[]; last: string; delta: string; move: 'up' | 'down' | 'level' | 'none'; note: string; uri: string }
/**
 * One subject's results over time. The phone widget has no settings of its own, so it follows the subject with the
 * latest result (ties to the one with more results).
 */
export function subjectTrendModel(d: PhoneData, now: Date): SubjectTrendModel | null {
  const data = { sessions: [] as FocusSession[], notes: [] as Note[], planner: {} as any, scores: d.scores };
  let pick: { name: string; sum: ReturnType<typeof subjectSummary> } | null = null;
  for (const s of subjectsOf(data)) {
    if (!s.from.includes('scores')) continue;
    const sum = subjectSummary(data, s.name, now);
    if (!sum.trend.length) continue;
    const last = sum.trend[sum.trend.length - 1].date;
    const was = pick?.sum.trend[pick.sum.trend.length - 1].date || '';
    if (!pick || last > was || (last === was && sum.trend.length > pick.sum.trend.length)) pick = { name: s.name, sum };
  }
  if (!pick) return null;
  const trend = pick.sum.trend.slice(-10);
  const lastPct = trend[trend.length - 1].pct;
  const dl = pick.sum.lastDelta;
  return {
    subject: pick.name, values: trend.map((t) => t.pct), last: fmtPct(lastPct),
    delta: dl == null ? '' : (dl > 0 ? '+' : dl < 0 ? '−' : '') + fmtPct(Math.abs(dl)).replace('%', '') + ' pts',
    move: dl == null ? 'none' : dl > 0.05 ? 'up' : dl < -0.05 ? 'down' : 'level',
    note: trend.length + (trend.length === 1 ? ' result' : ' results') + ' · latest ' + trend[trend.length - 1].examTitle,
    uri: openLink('scores'),
  };
}

export interface VideoRow { id: string; title: string; thumb: string; left: string; uri: string }
const thumbOf = (videoId: string) => 'https://i.ytimg.com/vi/' + encodeURIComponent(videoId) + '/mqdefault.jpg';
function videoRow(v: VaultVideo): VideoRow {
  const t = Math.max(0, Math.floor(num(v.resumeAt)));
  return {
    id: v.id, title: v.title.trim() || 'Untitled video', thumb: thumbOf(v.videoId),
    left: t > 0 ? 'Left at ' + fmtMediaTime(t) : 'Not started',
    uri: openLink('vault', { item: v.id, t: t > 0 ? t : undefined }),
  };
}
export interface VideosModel { rows: VideoRow[]; uri: string }
/** The video to carry on with: the last opened one that was left part-way, else the last opened. */
export function continueModel(d: PhoneData): VideosModel {
  const recent = recentVideos(d.vaultVideos, d.vaultVideos.length);
  const pick = recent.find((v) => num(v.resumeAt) > 0) || recent[0];
  return { rows: pick ? [videoRow(pick)] : [], uri: openLink('vault') };
}
export function watchListModel(d: PhoneData): VideosModel {
  return { rows: recentVideos(d.vaultVideos, 3).map(videoRow), uri: openLink('vault') };
}

export interface AiDockModel { links: { id: string; label: string; initial: string; uri: string }[]; uri: string }
export function aiDockModel(d: PhoneData): AiDockModel {
  return {
    links: d.aiLinks.slice(0, 4).map((l) => {
      const label = str(l.label).trim() || l.url.replace(/^https?:\/\/(www\.)?/i, '').split('/')[0];
      return { id: l.id, label, initial: (label[0] || '?').toUpperCase(), uri: l.url };
    }),
    uri: openLink('ai'),
  };
}

/** Every widget's model by name (null where a widget has nothing of its own to compute). */
export function modelFor(name: PhoneWidgetName, d: PhoneData, now: Date): unknown {
  switch (name) {
    case 'DayRing': return dayRingModel(d, now);
    case 'AtAGlance': return atAGlanceModel(d, now);
    case 'Agenda': return agendaModel(d, now);
    case 'Clock': return clockModel(d, now);
    case 'Search': return null;
    case 'NextUp': return nextUpModel(d, now);
    case 'Checklist': return checklistModel(d, now);
    case 'Deadlines': return deadlinesModel(d, now);
    case 'QuickStart': return quickStartModel(d, now);
    case 'Session': return sessionModel(d, now);
    case 'FocusWeek': return focusWeekModel(d, now);
    case 'NowNext': return nowNextModel(d, now);
    case 'TodaysBlocks': return todaysBlocksModel(d, now);
    case 'HabitGrid': return habitGridModel(d, now);
    case 'Streak': return streakModel(d, now);
    case 'NewNote': return newNoteModel(d, now);
    case 'Pinned': return pinnedModel(d, now);
    case 'RecentNotes': return recentNotesModel(d, now);
    case 'WriteToday': return writeTodayModel(d, now);
    case 'MoodStrip': return moodStripModel(d, now);
    case 'OnThisDay': return onThisDayModel(d, now);
    case 'Countdown': return countdownModel(d, now);
    case 'Results': return resultsModel(d);
    case 'SubjectTrend': return subjectTrendModel(d, now);
    case 'ContinueWatching': return continueModel(d);
    case 'WatchList': return watchListModel(d);
    case 'AiDock': return aiDockModel(d);
  }
}

/* ---------------------------------------------------------------- the look */

/** The colours a phone widget is drawn in: flat (a home-screen widget cannot draw the app's soft shadows), the theme's. */
export interface PhonePalette {
  bg: `#${string}`; well: `#${string}`; line: `#${string}`; text: `#${string}`; dim: `#${string}`; faint: `#${string}`;
  accent: `#${string}`; onAccent: `#${string}`;
  green: `#${string}`; amber: `#${string}`; danger: `#${string}`; teal: `#${string}`; pink: `#${string}`; gold: `#${string}`; slate: `#${string}`;
}

export function paletteOf(s: Pick<PhoneSettings, 'theme' | 'accent'>): PhonePalette {
  const minimal = s.theme === 'minimal';
  return {
    bg: minimal ? '#262624' : '#30302E',
    well: minimal ? '#30302E' : '#2B2B29',
    line: minimal ? '#3D3D3A' : '#3A3A37',
    text: '#FAF9F5', dim: '#C2C0B6', faint: '#9C9A92',
    accent: (/^#[0-9a-f]{6}$/i.test(s.accent) ? s.accent : DEFAULT_ACCENT) as `#${string}`,
    onAccent: '#262624',
    green: '#9AD6B0', amber: '#E3C08D', danger: '#E0958A', teal: '#83DBD6', pink: '#E39EAC', gold: '#D5C68E', slate: '#728AB7',
  };
}

/** A block's or tag's colour as a hex the widget can draw: a palette slot ('teal') or a literal, else the accent. */
export function hexOf(c: string | undefined, p: PhonePalette): `#${string}` {
  if (c && /^#[0-9a-f]{6}$/i.test(c)) return c as `#${string}`;
  if (c && /^#[0-9a-f]{3}$/i.test(c)) return ('#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3]) as `#${string}`;
  const slot = c && (p as any)[c];
  return typeof slot === 'string' && slot.startsWith('#') ? (slot as `#${string}`) : p.accent;
}

/** A hex colour at an opacity, as the widget library takes it ('#RRGGBBAA' is not read; rgba is). */
export function rgba(hex: string, a: number): `rgba(${number}, ${number}, ${number}, ${number})` {
  const h = /^#[0-9a-f]{6}$/i.test(hex) ? hex : DEFAULT_ACCENT;
  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, +a.toFixed(3)))})` as any;
}

/* ---------------------------------------------------------------- drawn shapes (SVG strings) */

/** A ring from 12 o'clock, `frac` of the way round, with an optional dot at its end. */
export function ringSvg(o: { size: number; stroke: number; frac: number; color: string; track: string; dot?: string; inner?: { frac: number; color: string } }): string {
  const { size, stroke } = o;
  const c = size / 2;
  const arc = (r: number, frac: number, color: string, w: number) => {
    const f = Math.max(0, Math.min(1, frac));
    if (f <= 0) return '';
    if (f >= 0.9999) return `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="${w}"/>`;
    const a = f * 2 * Math.PI;
    const x = c + r * Math.sin(a);
    const y = c - r * Math.cos(a);
    return `<path d="M ${c} ${c - r} A ${r} ${r} 0 ${f > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`;
  };
  const r = c - stroke / 2 - (o.dot ? stroke * 0.4 : 0);
  let body = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${o.track}" stroke-width="${stroke}"/>` + arc(r, o.frac, o.color, stroke);
  if (o.inner) {
    const ri = r - stroke * 1.7;
    body += `<circle cx="${c}" cy="${c}" r="${ri}" fill="none" stroke="${o.track}" stroke-width="${stroke}"/>` + arc(ri, o.inner.frac, o.inner.color, stroke);
  }
  if (o.dot) {
    const a = Math.max(0, Math.min(1, o.frac)) * 2 * Math.PI;
    const x = c + r * Math.sin(a);
    const y = c - r * Math.cos(a);
    body += `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${(stroke * 1.25).toFixed(2)}" fill="${o.dot}" fill-opacity="0.28"/>`
      + `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${(stroke * 0.7).toFixed(2)}" fill="${o.dot}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`;
}

/** A line through values (0 to 100 %), a dot on each and the last one filled. */
export function trendSvg(values: number[], w: number, h: number, color: string, faint: string): string {
  const pad = 6;
  if (!values.length) return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"/>`;
  const lo = Math.max(0, Math.min(...values) - 10);
  const hi = Math.min(100, Math.max(...values) + 10);
  const span = Math.max(1, hi - lo);
  const pts = values.map((v, i) => {
    const x = values.length === 1 ? w / 2 : pad + (i * (w - pad * 2)) / (values.length - 1);
    const y = pad + (1 - (v - lo) / span) * (h - pad * 2);
    return [+x.toFixed(2), +y.toFixed(2)];
  });
  const line = pts.length > 1 ? `<polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` : '';
  const dots = pts.map((p, i) => i === pts.length - 1
    ? `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="${color}"/>`
    : `<circle cx="${p[0]}" cy="${p[1]}" r="2.5" fill="${faint}"/>`).join('');
  const base = `<line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="${faint}" stroke-opacity="0.35" stroke-width="1"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${base}${line}${dots}</svg>`;
}

/** The small outline glyphs the widgets use, 24-unit paths drawn as a stroke. */
const GLYPH: Record<string, string> = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16 L20.5 20.5"/>',
  plus: '<path d="M12 5 V19 M5 12 H19"/>',
  check: '<path d="M6 12.5 L10.2 16.5 L18 8"/>',
  play: '<path d="M8.5 6.5 L17.5 12 L8.5 17.5 Z"/>',
  pause: '<path d="M9 6.5 V17.5 M15 6.5 V17.5"/>',
  flame: '<path d="M12 3.5 C13 7 17 9 17 13.5 A5 5 0 0 1 7 13.5 C7 11 8.5 9.5 9.5 8.5 C9.8 10.5 11 11.5 12 11.5 C11.5 9 11 6 12 3.5 Z"/>',
  lock: '<rect x="6" y="10.5" width="12" height="9" rx="2"/><path d="M8.5 10.5 V8 A3.5 3.5 0 0 1 15.5 8 V10.5"/>',
  archive: '<rect x="4.5" y="5.5" width="15" height="4" rx="1"/><path d="M6 9.5 V18 A1.5 1.5 0 0 0 7.5 19.5 H16.5 A1.5 1.5 0 0 0 18 18 V9.5 M10 13 H14"/>',
  pen: '<path d="M5 19 L6 15 L15.5 5.5 A1.8 1.8 0 0 1 18.5 8.5 L9 18 Z"/>',
  up: '<path d="M12 18.5 V6 M7 11 L12 6 L17 11"/>',
  down: '<path d="M12 5.5 V18 M7 13 L12 18 L17 13"/>',
  level: '<path d="M6 12 H18"/>',
  note: '<path d="M7 4.5 H14 L18 8.5 V19.5 H7 Z M14 4.5 V8.5 H18 M9.5 12.5 H15.5 M9.5 15.5 H13.5"/>',
  arrow: '<path d="M9 6 L15 12 L9 18"/>',
};

export function glyphSvg(name: keyof typeof GLYPH | string, size: number, color: string, fill = false): string {
  const body = GLYPH[name] || GLYPH.arrow;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill ? color : 'none'}" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}
