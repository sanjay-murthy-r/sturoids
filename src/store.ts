import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState as AppLifecycle } from 'react-native';
import React from 'react';
import { create, useStore as useZustand, StoreApi } from 'zustand';
import { persist, PersistStorage, StorageValue } from 'zustand/middleware';
import { uid, todayKey, toMinutes, fmtShortDate, fmtMediaTime, cleanDays, DayName, DAY_NAMES } from './utils';
import { ThemeMode, AnimLevel, DEFAULT_ACCENT, setAccent } from './theme';
import { pkey } from './profiles';
import { ToolKey, DEFAULT_SLOTS, DEFAULT_ARCHIVED, ROUTE_TO_TOOL, TOOLS, normaliseSlots, normaliseArchived, toolByKey } from './tools';
import {
  ScoreNode, ScoreTag, Learning, sanitizeScores, sanitizeTags, sanitizeLearnings, indexScores, descendantIds,
  canMove, duplicateStructure, nextTagColor, sameTagName, pruneScoreRefs, withCategory, promoteToCategory,
} from './scores';

export type { ExamRemind } from './scores';

// ---------- types ----------

/** How long before a reminder for a task with a time: the morning of its day (08:00), or an hour before the time. */
export type TaskRemind = 'morning' | 'hour';

export interface DailyTask {
  id: string; title: string; doneOn: string | null; createdAt: number;
  /** comes back every day; a ToDo without it is a one-off, which goes once it has been ticked and its day is over */
  repeat?: 'daily';
  /**
   * with repeat 'daily': the weekdays it comes back on, 0 Monday to 6 Sunday (as Habit.days): sorted, unique, never empty
   * and never all seven. Absent, every day. Today shows it, and its reminder rings, only on those days (utils.todoDueOn)
   */
  days?: number[];
  /** 'HH:MM', due by */
  time?: string;
  remind?: TaskRemind;
}
export interface Subtask { id: string; title: string; done: boolean }
export interface Mission {
  id: string; title: string; deadline: string; done: boolean; subtasks: Subtask[];
  /** the day it was ticked, YYYY-MM-DD, while it is done */
  doneOn?: string;
  /** 'HH:MM' on the deadline day */
  time?: string;
  remind?: TaskRemind;
  /** early reminders at 6 pm, three days and one day before the deadline, with or without a time; in this order */
  early?: MissionEarly[];
}
/** A long-term task's early reminders: '3d' three days before, '1d' the day before, both at 6 pm. */
export type MissionEarly = '3d' | '1d';
export const MISSION_EARLY: readonly MissionEarly[] = ['3d', '1d'];
export interface FocusSession {
  id: string; dateKey: string; endedAt: number; netSeconds: number; taskTitles: string[]; subject?: string;
  /** logged by hand in the history ("Log a session"), not timed */
  manual?: boolean;
}
export interface PlannerBlock { id: string; subject: string; start: string; end: string; color: string }
export interface Habit {
  id: string; title: string; doneDates: string[]; remindTime?: string;
  /**
   * the weekdays it is due on, 0 Monday to 6 Sunday (the order of DAY_NAMES): sorted, unique, never empty and never all
   * seven. Absent, it is due every day
   */
  days?: number[];
}

/** A ToDo or a long-term task as it was when it was ticked: its id and its title then. */
export interface DoneItem { id: string; title: string }
/** What was ticked on one calendar day: the ToDos and the long-term tasks. Habits keep their own days (doneDates). */
export interface DayDone { todos?: DoneItem[]; tasks?: DoneItem[] }

/** How long the day's record keeps a day, in days. */
export const DONE_LOG_KEEP_DAYS = 400;

export interface Attachment { id: string; kind: 'image' | 'video' | 'file'; uri: string; name: string }
export interface Note {
  id: string; title: string; body: string; folder: string; tags: string[];
  pinned: boolean; createdAt: number; updatedAt: number; subject?: string;
  attachments: Attachment[];
  /** hidden behind the app lock: no excerpt, no body search, no share */
  locked?: boolean;
}

export interface TimedNote { id: string; time: number; text: string }
export interface Bookmark { id: string; time: number; endTime?: number; label: string }
export interface VaultFolder { id: string; name: string; parentId: string | null }
export interface VaultVideo {
  id: string; videoId: string; url: string; title: string; folderId: string | null; tags: string[];
  addedAt: number; notes: TimedNote[]; bookmarks: Bookmark[];
  /** where it was left, in seconds */
  resumeAt?: number;
  /** when it was last opened, for Recently watched */
  openedAt?: number;
}

export interface AiLink { id: string; label: string; url: string; custom?: boolean }
export interface CalcEntry { id: string; expr: string; result: string }
/**
 * `tool` targets a ToolKey (opens wherever that tool currently lives — its tab
 * slot or its full page); `route` is a plain path (Settings); `url` a website, opened in the default browser; `action`
 * an action id that src/actions.ts runs (a new note, add a ToDo, start focus, search).
 * `color` is a palette slot (e.g. 'green') or a literal hex.
 */
export interface QuickItem { id: string; label: string; icon: string; color: string; kind: 'tool' | 'route' | 'url' | 'action'; target: string }

/** A widget's size on Today's board: S one cell (two side by side), M full width, L full width and two cells tall. */
export type WidgetSize = 'S' | 'M' | 'L';
/** One widget on Today's board, in order. `type` names a widget in src/widgets/registry.ts; `config` is its own. */
export interface TodayWidget { id: string; type: string; size: WidgetSize; config?: Record<string, unknown> }
/** Today's wide arrangements: by column count ('2', '3'), each column's widget ids from the top. */
export type TodayColumns = Record<string, string[][]>;
export interface TodoReminder { id: string; time: string; label: string }

/** A Deep Work session in flight — persisted so a process kill cannot lose it. */
export interface ActiveSession {
  mode: 'stopwatch' | 'countdown';
  targetMin: number;
  running: boolean;
  /** wall-clock ms when the current running stretch began; null while paused */
  startTs: number | null;
  /** seconds banked from earlier running stretches */
  accumSec: number;
  /** wall-clock ms of the very first start, for the session's day */
  startedAt: number;
  subject: string;
  attached: { key: string; kind: 'custom' | 'daily' | 'mission'; refId?: string; title: string; done: boolean }[];
  finishAt: number | null;
}

export interface JournalEntry {
  id: string;
  /** YYYY-MM-DD — the day the entry is ABOUT (not when it was typed) */
  dateKey: string;
  title: string;
  /** the first ~200 characters, for lists; the full text lives in a file (src/journal.ts) */
  excerpt: string;
  mood?: 1 | 2 | 3 | 4 | 5;
  /** how the day went, in stars */
  rating?: 1 | 2 | 3 | 4 | 5;
  /** the after-writing check-out was skipped for this entry, so it never asks again */
  checkoutSkipped?: boolean;
  tags: string[];
  wordCount: number;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  promptId?: string;
}

/** what a delete took away, and what an Undo puts back */
export interface RemovedScores { nodes: ScoreNode[]; learnings: Learning[] }

/** A removed tag, its place in the list, and the tags of every exam and learning that carried it, for an Undo. */
export interface RemovedScoreTag {
  tag: ScoreTag;
  index: number;
  nodes: Record<string, string[]>;
  learnings: Record<string, string[]>;
}

export type TrashKind = 'note' | 'journal' | 'video' | 'timedNote' | 'bookmark' | 'attachment' | 'habit' | 'mission' | 'exam';

/** What an exam kept in Recently deleted holds: the exam (or group) at `id`, everything under it, and their learnings. */
export interface TrashedExam { id: string; nodes: ScoreNode[]; learnings: Learning[] }

/**
 * Something deleted, kept for 30 days in Recently deleted. `data` is the thing itself (a note with its attachments,
 * a journal entry's index, a video with its notes, a habit, a long-term task, or a TrashedExam), `parentId` the note or
 * video a part came from, `index` its place.
 * A journal entry's text and an attachment's file stay where they were until the item is deleted for good.
 */
export interface TrashItem {
  id: string;
  kind: TrashKind;
  deletedAt: number;
  title: string;
  /** shown as "Locked note" or "Locked entry", and restored or deleted only with the PIN */
  locked: boolean;
  data: any;
  parentId?: string;
  index?: number;
  /** the item's own lock (a locked note, or an attachment of one), before a locked tool adds its own */
  ownLock?: boolean;
}

/** How long Recently deleted keeps an item. */
export const TRASH_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Days an item has left in Recently deleted (at least 1 while it is still there), counted in calendar days: it stays
 * through the day its 30 days are up and goes the day after (purgeTrash), so the count turns over at midnight, never
 * mid-afternoon.
 */
export function trashDaysLeft(item: TrashItem, now = Date.now()): number {
  const end = new Date(item.deletedAt + TRASH_KEEP_MS);
  const today = new Date(now);
  const days = Math.round(
    (Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()))
      / (24 * 60 * 60 * 1000),
  );
  return Math.max(1, days);
}

/** One recorded pen point: x and y as fractions of the pad, t in ms from the first touch. */
export type SigPoint = [number, number, number];
export interface SigStroke { pts: SigPoint[] }
export interface OwnSignature {
  v: 1;
  recordedAt: number;
  strokes: SigStroke[];
  digits?: Record<string, { strokes: SigStroke[] }>;
  date?: {
    size: number; gap: number; tilt: number; when: 'signature' | 'outro';
    groups: { dd: { x: number; y: number }; mm: { x: number; y: number }; yy: { x: number; y: number } };
    /** which parts of the date are written, in this order; absent, all three. Never empty */
    parts?: ('dd' | 'mm' | 'yy')[];
  };
}

/** What the full-screen exam form saves in one go: the exam, its subjects, and the subjects taken out. */
export interface ExamSave {
  /** the exam being edited; a new exam when absent */
  id?: string;
  parentId: string | null;
  fields: Partial<Omit<ScoreNode, 'id' | 'createdAt' | 'updatedAt' | 'parentId' | 'kind'>>;
  /** in the order shown; a subject with an id is patched, one without is added */
  subjects: { id?: string; title: string; score?: number; outOf?: number; weight?: number }[];
  /** subjects the form took out; they go with everything under them and their learnings */
  removeIds: string[];
}

export interface Settings {
  name: string;
  theme: ThemeMode;
  accent: string;
  animLevel: AnimLevel;
  hour24: boolean;
  remindersEnabled: boolean;
  githubRepo: string;
  todoReminderEnabled: boolean;
  todoReminderTime: string;
  /** the three customizable middle tab slots (Today and More are fixed) */
  tabSlots: ToolKey[];
  /** first launch on this install — undefined until the app has been opened once */
  firstOpenedAt?: number;
  /** the most recent time the app came to the foreground */
  lastOpenedAt?: number;
  /** Journal: hidden behind the app PIN */
  journalLocked: boolean;
  /** the whole Notes tool hidden behind the app PIN (single notes lock from inside the note) */
  notesLocked: boolean;
  /** the phone's own screen lock may open the journal, and Notes, as well as the app PIN */
  journalScreenLock: boolean;
  notesScreenLock: boolean;
  /** seconds in the background before any unlocked content re-locks (0 = immediately) */
  lockGraceSec: number;
  /** before this hour, opening the Journal writes about yesterday */
  journalCutoffHour: number;
  journalPromptsOn: boolean;
  /** daily word goal, 0 = off */
  journalWordGoal: number;
  /** 'HH:MM' daily journal nudge, '' = off */
  journalReminderTime: string;
  /** after writing, a quiet card asks for a mood and a rating */
  journalCheckout: boolean;
  /** tools kept out of sight (never one in a tab slot) */
  archivedTools: ToolKey[];
  /** how the start screen plays: 'signed' writes the signature large first, 'logo' writes it last, in its place */
  introStyle: 'signed' | 'logo';
  /** Deep Work's ambient screen shows the seconds beside the minutes */
  ambientSeconds: boolean;
  /** and the time of day above them */
  ambientClock: boolean;
  /** the profile photo, a small JPEG as a data URI ('' for none), so it travels with backups and the cloud */
  avatar: string;
  /** a tap during the start screen goes straight to Today */
  introTapSkip: boolean;
  /** a soft chime when a Deep Work block ends (the buzz always plays) */
  focusChime: boolean;
  /** the evening before each dated exam, at 7 pm */
  examReminders: boolean;
  /** a notification five minutes before each Planner block */
  blockAlerts: boolean;
  /** automatic backups send attachments only on Wi-Fi */
  attachmentsWifiOnly: boolean;
  /** which signature the start screen writes: the creator's, or one recorded on this app */
  signatureSource: 'creator' | 'own';
  ownSignature: OwnSignature | null;
  calcAngle: 'deg' | 'rad';
  calcFunctions: boolean;
  calcSci: boolean;
  /** the length and mode Deep Work last started with */
  focusLastMin: number;
  focusLastMode: 'countdown' | 'stopwatch';
  /** the face for what is written in Notes and the Journal (writingFace in theme.ts) */
  writingFont: 'sans' | 'serif';
  /** Deep Work's daily goal in minutes, 0 = off: Today's focused cell shows the progress to it, the history its streak */
  focusGoalMin: number;
  /** the "You won't hear when this block ends" line was dismissed on this phone, so it never shows again */
  focusAlertAsked: boolean;
  /** when the one-time "Your data only lives on this phone" card was answered on this phone (ms); 0, never */
  backupNudgeAt: number;
}

export type PlannerWeek = Record<DayName, PlannerBlock[]>;

const emptyWeek = (): PlannerWeek =>
  Object.fromEntries(DAY_NAMES.map((d) => [d, []])) as PlannerWeek;

/** A copy without the keys that hold undefined, so a cleared field is removed instead of kept empty. */
function withoutUndefined<T extends object>(o: T): T {
  const out: any = {};
  for (const k of Object.keys(o)) if ((o as any)[k] !== undefined) out[k] = (o as any)[k];
  return out;
}

/** A copy with a patch applied: a key the patch sets to null is removed, one it leaves undefined stays as it was. */
function patched<T extends object>(o: T, patch: object): T {
  const out: any = { ...o };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Puts an item back into a list at its old place (clamped to the list as it is now). */
function insertAt<T>(list: readonly T[], item: T, index: number | undefined): T[] {
  const out = [...list];
  out.splice(Math.max(0, Math.min(index ?? out.length, out.length)), 0, item);
  return out;
}

export const DEFAULT_AI_LINKS: AiLink[] = [
  { id: 'claude', label: 'Claude', url: 'https://claude.ai' },
  { id: 'chatgpt', label: 'ChatGPT', url: 'https://chatgpt.com' },
  { id: 'gemini', label: 'Gemini', url: 'https://gemini.google.com' },
  { id: 'perplexity', label: 'Perplexity', url: 'https://perplexity.ai' },
  { id: 'wolfram', label: 'WolframAlpha', url: 'https://www.wolframalpha.com' },
];

/** The Settings shortcut is the one quick item that is not a tool. */
export const SETTINGS_QUICK: Omit<QuickItem, 'id'> = {
  label: 'Settings', icon: 'settings-outline', color: 'slate', kind: 'route', target: '/settings',
};

const toolQuick = (key: ToolKey, label?: string): Omit<QuickItem, 'id'> => {
  const t = toolByKey(key)!;
  return { label: label || t.shortLabel, icon: t.icon, color: t.colorKey, kind: 'tool', target: t.key };
};

// derived from the tools registry, so fresh installs and upgraded installs match
export const DEFAULT_QUICK: QuickItem[] = [
  { id: 'q-notes', ...toolQuick('notes') },
  { id: 'q-calc', ...toolQuick('calculator') },
  { id: 'q-vault', ...toolQuick('vault', 'YT Vault') },
  // Desmos and AI start archived, so a fresh install's shortcuts point at tools it shows
  { id: 'q-scores', ...toolQuick('scores') },
  { id: 'q-journal', ...toolQuick('journal') },
  { id: 'q-settings', ...SETTINGS_QUICK },
];

/** Where Sturoids' releases are published: Settings, Updates checks it unless another repo is typed in. */
export const DEFAULT_UPDATE_REPO = 'sanjay-murthy-r/all-in-one-student-app';
/** the owner's GitHub name before it changed: a repo saved under it is moved to the new one */
const OLD_UPDATE_OWNER = /^sanjaypersonal448-cloud\//i;

export const DEFAULT_SETTINGS: Settings = {
  name: '',
  theme: 'default',
  accent: DEFAULT_ACCENT,
  animLevel: 'full',
  hour24: false,
  remindersEnabled: false,
  githubRepo: DEFAULT_UPDATE_REPO,
  todoReminderEnabled: false,
  todoReminderTime: '07:00',
  tabSlots: [...DEFAULT_SLOTS],
  journalLocked: false,
  notesLocked: false,
  journalScreenLock: false,
  notesScreenLock: false,
  lockGraceSec: 90,
  journalCutoffHour: 11,
  journalPromptsOn: true,
  journalWordGoal: 0,
  journalReminderTime: '',
  journalCheckout: true,
  archivedTools: [...DEFAULT_ARCHIVED],
  introStyle: 'signed',
  ambientSeconds: true,
  ambientClock: false,
  avatar: '',
  introTapSkip: false,
  focusChime: true,
  examReminders: false,
  blockAlerts: false,
  attachmentsWifiOnly: true,
  signatureSource: 'creator',
  ownSignature: null,
  calcAngle: 'deg',
  calcFunctions: false,
  calcSci: false,
  focusLastMin: 50,
  focusLastMode: 'countdown',
  writingFont: 'sans',
  focusGoalMin: 0,
  focusAlertAsked: false,
  backupNudgeAt: 0,
};

/** Every persisted data key with its fresh-install value (actions excluded). */
export function initialData() {
  return {
    settings: { ...DEFAULT_SETTINGS, tabSlots: [...DEFAULT_SLOTS], archivedTools: [...DEFAULT_ARCHIVED] },
    aiLinks: DEFAULT_AI_LINKS,
    quickAccess: DEFAULT_QUICK,
    todoReminders: [] as TodoReminder[],
    dailyTasks: [] as DailyTask[],
    missions: [] as Mission[],
    lastTriage: '',
    sessions: [] as FocusSession[],
    planner: emptyWeek(),
    weekTemplates: {} as Record<string, PlannerWeek>,
    habits: [] as Habit[],
    notes: [] as Note[],
    noteFolders: ['General'],
    vaultVideos: [] as VaultVideo[],
    vaultFolders: [] as VaultFolder[],
    calcHistory: [] as CalcEntry[],
    deepWork: null as ActiveSession | null,
    journal: [] as JournalEntry[],
    journalTags: [] as string[],
    scores: [] as ScoreNode[],
    scoreTags: [] as ScoreTag[],
    learnings: [] as Learning[],
    trash: [] as TrashItem[],
    /** the Desmos graph as Calc.getState() gives it, as JSON ('' for none) */
    desmosState: '',
    /** what was ticked, day by day ('YYYY-MM-DD'), for the journal's day line */
    doneLog: {} as Record<string, DayDone>,
    /** Today's board, in order; null until it is first edited: the default arrangement (src/widgets/registry.ts) */
    todayLayout: null as TodayWidget[] | null,
    /**
     * Today's board on a wide window, as columns of widget ids, kept apart for each count of columns ('2', '3'): a
     * tablet turned, or a foldable folded and opened, comes back to the arrangement it had (src/widgets/logic.ts)
     */
    todayColumns: {} as TodayColumns,
  };
}
type DataKey = keyof ReturnType<typeof initialData>;
const DATA_KEYS = Object.keys(initialData()) as DataKey[];

/**
 * Settings that belong to this phone, not to the data: when the app was opened here, and the one-time notes about this
 * phone (its backups, its notification permission) answered here. They never travel in a backup's
 * fingerprint, a replace keeps this phone's own, and a change to them alone is not a change worth backing up.
 */
export const DEVICE_SETTINGS = ['firstOpenedAt', 'lastOpenedAt', 'backupNudgeAt', 'focusAlertAsked'] as const;
const isDeviceSetting = (k: string) => (DEVICE_SETTINGS as readonly string[]).includes(k);

/** The settings without this phone's own ones. */
export function withoutDeviceSettings<T extends object>(settings: T): T {
  const out: any = {};
  for (const k of Object.keys(settings)) if (!isDeviceSetting(k)) out[k] = (settings as any)[k];
  return out;
}

/** True when a store change touched nothing but this phone's own settings (or no data at all). */
export function isDeviceOnlyChange(s: AppState, prev: AppState): boolean {
  for (const k of DATA_KEYS) if (k !== 'settings' && (s as any)[k] !== (prev as any)[k]) return false;
  if (s.settings === prev.settings) return true;
  const keys = new Set([...Object.keys(s.settings), ...Object.keys(prev.settings)]);
  for (const k of keys) if (!isDeviceSetting(k) && (s.settings as any)[k] !== (prev.settings as any)[k]) return false;
  return true;
}

export interface AppState {
  settings: Settings;
  aiLinks: AiLink[];
  quickAccess: QuickItem[];
  todoReminders: TodoReminder[];
  dailyTasks: DailyTask[];
  missions: Mission[];
  lastTriage: string;
  sessions: FocusSession[];
  planner: PlannerWeek;
  weekTemplates: Record<string, PlannerWeek>;
  habits: Habit[];
  notes: Note[];
  noteFolders: string[];
  vaultVideos: VaultVideo[];
  vaultFolders: VaultFolder[];
  calcHistory: CalcEntry[];
  deepWork: ActiveSession | null;
  journal: JournalEntry[];
  journalTags: string[];
  scores: ScoreNode[];
  scoreTags: ScoreTag[];
  learnings: Learning[];
  trash: TrashItem[];
  desmosState: string;
  /** what was ticked on each calendar day: kept as it was then, so a rename or a delete later never rewrites the past */
  doneLog: Record<string, DayDone>;
  /** Today's board, in order; null: the default arrangement, until it is first edited */
  todayLayout: TodayWidget[] | null;
  /** Today's board on a wide window, by how many columns it has: each column's widget ids, top to bottom */
  todayColumns: TodayColumns;

  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  /** puts tools in the three slots; a tool placed in a slot is restored if it was archived */
  setTabSlots: (slots: ToolKey[]) => void;
  /** false when the tool cannot be archived: it is in a tab slot, or it is Deep Work with a session going */
  setToolArchived: (key: ToolKey, archived: boolean) => boolean;
  setAiLinks: (links: AiLink[]) => void;
  setQuickAccess: (items: QuickItem[]) => void;
  addTodoReminder: (time: string, label: string) => void;
  removeTodoReminder: (id: string) => void;

  /** a one-off unless `extra.repeat` is 'daily' (then on `extra.days` only, when given); returns the new ToDo's id */
  addDaily: (title: string, extra?: { repeat?: 'daily'; days?: number[]; time?: string; remind?: TaskRemind }) => string;
  toggleDaily: (id: string) => void;
  /**
   * a field set to null in the patch is removed. A ToDo's reminder needs its time: one set without a time, or left
   * when the time is cleared, goes
   */
  updateDaily: (id: string, patch: { title?: string; repeat?: 'daily' | null; days?: number[] | null; time?: string | null; remind?: TaskRemind | null }) => void;
  removeDaily: (id: string) => void;
  /** puts a removed task back at its old place in the list (an undo) */
  restoreDaily: (task: DailyTask, index: number) => void;
  setLastTriage: (dateKey: string) => void;
  /** one-off ToDos ticked on an earlier day go; the store calls it at launch and when the day changes */
  settleDay: () => void;

  addMission: (title: string, deadline: string) => string;
  toggleMission: (id: string) => void;
  /** a field set to null in the patch is removed */
  updateMission: (id: string, patch: { title?: string; deadline?: string; time?: string | null; remind?: TaskRemind | null; early?: MissionEarly[] | null }) => void;
  /** returns what it removed and where it stood, for an Undo */
  removeMission: (id: string) => { mission: Mission; index: number } | null;
  restoreMission: (m: Mission, index: number) => void;
  addSubtask: (missionId: string, title: string) => void;
  toggleSubtask: (missionId: string, subId: string) => void;
  /** returns what it removed and where it stood, for an Undo */
  removeSubtask: (missionId: string, subId: string) => { subtask: Subtask; index: number } | null;
  restoreSubtask: (missionId: string, sub: Subtask, index: number) => void;

  /** returns the new session's id */
  logSession: (s: Omit<FocusSession, 'id'>) => string;
  /** returns what it removed and where it stood, for an Undo */
  removeSession: (id: string) => { session: FocusSession; index: number } | null;
  restoreSession: (session: FocusSession, index: number) => void;
  /**
   * a session logged by hand for a day up to today (manual), put in its place by time; minutes 1 to 720. Returns its id,
   * or null when the day or the minutes are not ones it takes
   */
  addManualSession: (s: { dateKey: string; minutes: number; subject?: string }) => string | null;
  /** changes a session's subject ('' takes it off) or its minutes (1 to 720); false when there is no such session */
  updateSession: (id: string, patch: { subject?: string; minutes?: number }) => boolean;
  setDeepWork: (s: ActiveSession | null) => void;
  patchDeepWork: (patch: Partial<ActiveSession>) => void;

  addBlock: (day: DayName, b: Omit<PlannerBlock, 'id'>) => void;
  updateBlock: (day: DayName, b: PlannerBlock) => void;
  removeBlock: (day: DayName, id: string) => void;
  copyDay: (from: DayName, to: DayName) => void;
  /** puts a whole week back as it was, for an Undo */
  restorePlanner: (week: PlannerWeek) => void;
  /** puts a deleted habit back, streak and all, for an Undo */
  restoreHabit: (h: Habit, index: number) => void;
  saveTemplate: (name: string) => void;
  applyTemplate: (name: string) => void;
  deleteTemplate: (name: string) => void;

  /** days: the weekdays it is due on (see Habit.days); none, or all seven, is every day */
  addHabit: (title: string, remindTime?: string, days?: number[]) => void;
  /** the weekdays a habit is due on; none, or all seven, is every day */
  setHabitDays: (id: string, days?: number[]) => void;
  toggleHabitToday: (id: string) => void;
  /** ticks or unticks a day: today or one of the six before it, never a day to come */
  toggleHabitDay: (id: string, dateKey: string) => void;
  renameHabit: (id: string, title: string) => void;
  removeHabit: (id: string) => void;
  setHabitReminder: (id: string, time?: string) => void;

  addNote: (n: Partial<Note>) => string;
  /** `touch: false` (a pin, a lock, a move) leaves the note's edited time as it was */
  updateNote: (id: string, n: Partial<Note>, opts?: { touch?: boolean }) => void;
  /** returns the attachments it orphaned — the caller deletes the files it copied */
  deleteNote: (id: string) => Attachment[];
  addNoteFolder: (name: string) => void;
  /** renames a folder and moves its notes with it (General keeps its name) */
  renameNoteFolder: (from: string, to: string) => void;
  /** deletes a folder; its notes move to General */
  deleteNoteFolder: (name: string) => void;
  addAttachment: (noteId: string, a: Omit<Attachment, 'id'>) => void;
  /** returns the removed attachment so the caller can delete its file */
  removeAttachment: (noteId: string, attId: string) => Attachment | undefined;
  /** points restored attachments at their files, by attachment id */
  relinkAttachments: (uris: Record<string, string>) => void;

  addVideo: (v: { url: string; videoId: string; title: string; folderId?: string | null }) => string;
  updateVideo: (id: string, v: Partial<VaultVideo>) => void;
  /** where the video was left; callers save it every 10 s at most, and on pause or leave */
  setVideoProgress: (id: string, seconds: number) => void;
  markVideoOpened: (id: string) => void;
  deleteVideo: (id: string) => void;
  addVaultFolder: (name: string, parentId?: string | null) => string;
  renameVaultFolder: (id: string, name: string) => void;
  deleteVaultFolder: (id: string) => void;
  addVideoTag: (videoId: string, tag: string) => void;
  removeVideoTag: (videoId: string, tag: string) => void;
  addTimedNote: (videoId: string, time: number, text: string) => void;
  updateTimedNote: (videoId: string, noteId: string, text: string) => void;
  removeTimedNote: (videoId: string, noteId: string) => void;
  addBookmark: (videoId: string, time: number, label: string, endTime?: number) => void;
  updateBookmark: (videoId: string, bookmarkId: string, label: string) => void;
  removeBookmark: (videoId: string, bookmarkId: string) => void;

  /** the journal index; entry text lives in files (src/journal.ts) */
  upsertJournalEntry: (e: JournalEntry) => void;
  patchJournalEntry: (id: string, patch: Partial<JournalEntry>) => void;
  removeJournalEntry: (id: string) => void;
  setJournalTags: (tags: string[]) => void;

  addScoreNode: (n: Omit<ScoreNode, 'id' | 'createdAt' | 'updatedAt'>) => string;
  /** a field set to undefined in the patch is removed */
  patchScoreNode: (id: string, patch: Partial<Omit<ScoreNode, 'id' | 'createdAt' | 'parentId' | 'kind'>>) => void;
  /** false when the move is not allowed (a group into an exam, or anything into itself) */
  moveScoreNode: (id: string, parentId: string | null) => boolean;
  /** removes the node, everything under it and their learnings, and returns them so an Undo can put them back */
  removeScoreNode: (id: string) => RemovedScores;
  restoreScoreNodes: (removed: RemovedScores) => void;
  /** a copy of the node's structure without marks; returns the copy's id */
  duplicateScoreNode: (id: string) => string | null;

  /**
   * the id of the tag with this name, making it (in the next free colour) when it is new; asked for a category, a
   * plain tag of that name becomes one
   */
  addScoreTag: (label: string, opts?: { category?: boolean }) => string;
  /** renaming to a name already in use is refused and returns false */
  patchScoreTag: (id: string, patch: { label?: string; color?: string; category?: boolean }) => boolean;
  /** saves the exam form as one change; returns the exam's id and what was taken out, for an Undo */
  saveExam: (input: ExamSave) => { id: string; removed: RemovedScores };
  /** puts exams in a category (or in none), keeping their other tags; returns their tags before, for an Undo */
  setExamCategory: (ids: string[], categoryId: string | null) => Record<string, string[]>;
  /** puts tags back as they were */
  restoreExamTags: (before: Record<string, string[]>) => void;
  /** the tag goes from the list and from every exam and learning carrying it; returns what an Undo puts back */
  removeScoreTag: (id: string) => RemovedScoreTag | null;
  /** puts a removed tag back with its id, its place in the list, and its links on exams and learnings */
  restoreScoreTag: (removed: RemovedScoreTag) => void;
  addLearning: (l: { nodeId: string; text: string; tags?: string[] }) => string;
  patchLearning: (id: string, patch: { text?: string; tags?: string[] }) => void;
  /** returns the learning so an Undo can put it back */
  removeLearning: (id: string) => Learning | null;
  restoreLearnings: (list: Learning[]) => void;

  pushCalc: (expr: string, result: string) => void;
  clearCalcHistory: () => void;
  /** keeps the Desmos graph; false (and the old graph kept) when it is too large to keep */
  setDesmosState: (json: string) => boolean;

  // Recently deleted. Each returns the trash item's id (null when there was nothing to move, or Recently deleted did not
  // load this launch and could not keep it: then the thing stays where it is), so an Undo can call restoreFromTrash
  trashNote: (id: string) => string | null;
  /** the entry's text stays in its file */
  trashJournalEntry: (id: string) => string | null;
  trashVideo: (id: string) => string | null;
  trashTimedNote: (videoId: string, id: string) => string | null;
  trashBookmark: (videoId: string, id: string) => string | null;
  /** the file stays where it is */
  trashAttachment: (noteId: string, attId: string) => string | null;
  /** a habit, streak and all */
  trashHabit: (id: string) => string | null;
  /** a long-term task with its steps (a done one stays in the day's record) */
  trashMission: (id: string) => string | null;
  /** an exam or a group, with everything under it and their learnings */
  trashExam: (id: string) => string | null;
  /**
   * 'parent-missing' when the note or video a part belongs to is not here (restore that first). Into a collection that
   * did not load this launch (and is not saved), the item comes back and stays in Recently deleted too, so it is never lost
   */
  restoreFromTrash: (trashId: string) => 'ok' | 'parent-missing';
  /** gone for good, with its files */
  deleteFromTrash: (trashId: string) => void;
  emptyTrash: () => void;
  /** what has been in Recently deleted for 30 days goes for good; the store calls it at launch and on a new day */
  purgeTrash: (now: number) => void;

  /** Today's board as edited (cleaned); null goes back to the default arrangement */
  setTodayLayout: (layout: TodayWidget[] | null) => void;
  /** keeps the arrangement of a wide board of `count` columns (null forgets it: it is laid out afresh) */
  setTodayColumns: (count: number, columns: string[][] | null) => void;

  /** a TRUE replace: every data key not in `data` goes back to its fresh value */
  replaceAll: (data: Partial<AppState>) => void;
}

// ---------- v1 -> v2 migration (also used for old backup imports) ----------

export function migrateData(old: any): any {
  const out = { ...old };
  const s = { ...(old.settings || {}) };
  // emit a VALID ThemeMode directly — importSnapshot runs this without the
  // later migrateToGrey step that used to remap the legacy 'normal' value
  if (!s.theme) s.theme = s.glassIntensity === 'off' ? 'minimal' : 'default';
  if (!s.animLevel) s.animLevel = 'full';
  if (s.todoReminderEnabled === undefined) s.todoReminderEnabled = false;
  if (!s.todoReminderTime) s.todoReminderTime = '07:00';
  delete s.glassIntensity; delete s.clockStyle;
  out.settings = s;
  if (!out.quickAccess) out.quickAccess = DEFAULT_QUICK;
  if (!out.todoReminders) out.todoReminders = [];
  if (Array.isArray(old.vaultFolders) && (old.vaultFolders.length === 0 || typeof old.vaultFolders[0] === 'string')) {
    const names: string[] = (old.vaultFolders || []).filter((n: string) => n !== 'Inbox');
    const folders: VaultFolder[] = names.map((n) => ({ id: uid() + n, name: n, parentId: null }));
    const byName: Record<string, string> = {};
    folders.forEach((f) => { byName[f.name] = f.id; });
    out.vaultFolders = folders;
    out.vaultVideos = (old.vaultVideos || []).map((v: any) => ({
      ...v,
      folderId: v.folderId !== undefined ? v.folderId : (v.folder && v.folder !== 'Inbox' ? byName[v.folder] ?? null : null),
      tags: v.tags || [],
    }));
  }
  out.notes = (old.notes || []).map((n: any) => ({ ...n, attachments: n.attachments || [] }));
  return out;
}

// v2 -> v3: two-theme grey app. (Colour remapping moved to v5, where it is done
// against the live palette in one coherent pass.)
export function migrateToGrey(old: any): any {
  const out = { ...old };
  const st = { ...(old.settings || {}) };
  st.theme = st.theme === 'minimal' ? 'minimal' : 'default';
  out.settings = st;
  return out;
}

// ---------- v4 -> v5 ----------

/** navy-era quick-tile hexes -> palette slots, so tiles follow the live theme */
const QUICK_COLOR_REMAP: Record<string, string> = {
  '#8CD9A8': 'green', '#E9BC7A': 'amber', '#E895A5': 'pink', '#7FD0D6': 'teal',
  '#B3A3E8': 'accent', '#9AA6C0': 'slate', '#8FB6E8': 'slate', '#83DBD6': 'teal',
};
/** navy-era planner block hexes -> the current BLOCK_COLORS they correspond to */
const BLOCK_REMAP: Record<string, string> = {
  '#8FB6E8': '#9DBCE3', '#8CD9A8': '#9AD6B0', '#E9BC7A': '#E3C08D',
  '#E895A5': '#E39EAC', '#B3A3E8': '#745FF2', '#7FD0D6': '#83DBD6',
};

/** The earliest moment the data itself records, so the same data always migrates to the same result. */
function earliestActivity(p: any): number {
  let min = Infinity;
  const each = (items: any, key: string) => {
    if (!Array.isArray(items)) return;
    for (const x of items) {
      const n = Number(x?.[key]);
      if (n > 0 && n < min) min = n;
    }
  };
  each(p?.notes, 'createdAt');
  each(p?.dailyTasks, 'createdAt');
  each(p?.sessions, 'endedAt');
  each(p?.vaultVideos, 'addedAt');
  each(p?.journal, 'createdAt');
  return Number.isFinite(min) ? min : 1;
}

/**
 * Whether the data holds anything the user made (a name, tasks, notes, sessions, habits, videos, journal entries,
 * exams, or something deleted that can still come back).
 */
export function hasAnyUserData(p: any): boolean {
  const nonEmpty = (a: any) => Array.isArray(a) && a.length > 0;
  return !!(p?.settings?.name) || nonEmpty(p?.dailyTasks) || nonEmpty(p?.missions) || nonEmpty(p?.sessions)
    || nonEmpty(p?.notes) || nonEmpty(p?.habits) || nonEmpty(p?.vaultVideos) || nonEmpty(p?.journal)
    || nonEmpty(p?.scores) || nonEmpty(p?.trash)
    || (!!p?.doneLog && typeof p.doneLog === 'object' && Object.keys(p.doneLog).length > 0);
}

function normaliseQuick(items: any): QuickItem[] {
  if (!Array.isArray(items)) return DEFAULT_QUICK;
  const out: QuickItem[] = [];
  for (const raw of items) {
    if (!raw || typeof raw.target !== 'string') continue;
    let q: QuickItem = { ...raw, id: raw.id || uid() };
    if (q.kind === 'route' && ROUTE_TO_TOOL[q.target]) {
      const t = toolByKey(ROUTE_TO_TOOL[q.target])!;
      q = { ...q, kind: 'tool', target: t.key, icon: t.icon };
    }
    if (q.kind === 'tool') {
      const t = toolByKey(q.target);
      if (!t) continue;
      q = { ...q, color: t.colorKey, icon: t.icon }; // one colour and one icon per tool, everywhere
    } else if (q.kind === 'route' && q.target === '/settings') {
      q = { ...q, color: 'slate' };
    } else if (typeof q.color === 'string' && QUICK_COLOR_REMAP[q.color.toUpperCase()]) {
      q = { ...q, color: QUICK_COLOR_REMAP[q.color.toUpperCase()] };
    }
    // shortcuts to other apps went with the app launcher in 1.5.1: without the permission to see them they cannot open
    if (!['tool', 'route', 'url', 'action'].includes(q.kind)) continue;
    if (q.kind === 'action' && !q.target) continue;
    if (out.some((o) => o.kind === q.kind && o.target === q.target)) continue;
    out.push(q);
  }
  return out;
}

const remapBlocks = (week: any): PlannerWeek => {
  const outWeek: any = emptyWeek();
  if (!week || typeof week !== 'object' || Array.isArray(week)) return outWeek;
  for (const d of Object.keys(week)) {
    outWeek[d] = (Array.isArray(week[d]) ? week[d] : [])
      .filter((b: any) => b && typeof b === 'object')
      .map((b: any) => ({ ...b, color: BLOCK_REMAP[String(b.color || '').toUpperCase()] || b.color }));
  }
  return outWeek;
};

/**
 * The ONE v5 migration. Pure and idempotent — it is also run on every imported
 * backup, so running it twice must change nothing.
 */
export function migrateV5(p: any): any {
  const out = { ...(p || {}) };
  // a malformed collection becomes its fresh value and anything that is not a record is dropped, so no screen
  // ever maps over a string or reads a field of null
  const isRecord = (x: any) => !!x && typeof x === 'object' && !Array.isArray(x);
  const list = (a: any): any[] => (Array.isArray(a) ? a : []);
  const fresh = initialData();
  for (const k of ['dailyTasks', 'missions', 'habits', 'vaultVideos', 'vaultFolders', 'aiLinks', 'sessions', 'calcHistory', 'todoReminders'] as const) {
    if (k in out) out[k] = Array.isArray(out[k]) ? out[k].filter(isRecord) : fresh[k];
  }
  if (Array.isArray(out.habits)) {
    out.habits = out.habits.map((h: any) => ({ ...h, doneDates: list(h.doneDates).filter((d) => typeof d === 'string') }));
  }
  if (Array.isArray(out.missions)) {
    out.missions = out.missions.map((m: any) => ({ ...m, subtasks: list(m.subtasks).filter(isRecord) }));
  }
  if (Array.isArray(out.vaultVideos)) {
    out.vaultVideos = out.vaultVideos.map((v: any) => ({
      ...v, tags: list(v.tags), notes: list(v.notes).filter(isRecord), bookmarks: list(v.bookmarks).filter(isRecord),
    }));
  }
  if ('noteFolders' in out) {
    out.noteFolders = Array.isArray(out.noteFolders) ? out.noteFolders.filter((x: any) => typeof x === 'string') : fresh.noteFolders;
  }
  const s = { ...(p?.settings || {}) };
  const tabSlots = normaliseSlots(s.tabSlots);
  out.settings = {
    ...DEFAULT_SETTINGS,
    ...s,
    accent: s.accent || DEFAULT_ACCENT,
    tabSlots,
    // a backup from before archiving takes the default; a tool in a slot is never archived
    archivedTools: normaliseArchived(s.archivedTools ?? DEFAULT_ARCHIVED, tabSlots),
    // an upgrading user with data is "returning", never "first launch"
    firstOpenedAt: s.firstOpenedAt ?? (hasAnyUserData(p) ? earliestActivity(p) : undefined),
    // only a small image the app made itself is kept: anything else would bloat every save
    avatar: typeof s.avatar === 'string' && s.avatar.startsWith('data:image/') && s.avatar.length < 300000 ? s.avatar : '',
  };
  out.quickAccess = normaliseQuick(p?.quickAccess);
  // every week comes back with all seven days holding blocks only, so a screen can read any day
  if ('planner' in out) out.planner = remapBlocks(out.planner);
  if ('weekTemplates' in out) {
    const src = isRecord(out.weekTemplates) ? out.weekTemplates : {};
    const t: any = {};
    for (const name of Object.keys(src)) if (isRecord(src[name])) t[name] = remapBlocks(src[name]);
    out.weekTemplates = t;
  }
  out.notes = (Array.isArray(p?.notes) ? p.notes : [])
    .filter((n: any) => n && typeof n === 'object')
    .map((n: any) => ({ ...n, attachments: Array.isArray(n.attachments) ? n.attachments : [], locked: !!n.locked }));
  out.deepWork = p?.deepWork ?? null;
  // entry text lives in files. No saved store ever held it inline; a backup's inline text is written back by
  // restoreBodies right after an import, so only the index is built here
  const scale = (v: any) => Number.isInteger(v) && v >= 1 && v <= 5;
  // a backup also carries the texts of entries in Recently deleted beside the journal (journalForBackup): those are
  // not entries, and their index is in the trash
  out.journal = (Array.isArray(p?.journal) ? p.journal : [])
    .filter((e: any) => e && typeof e === 'object' && typeof e.id === 'string' && typeof e.dateKey === 'string' && e.inTrash !== true)
    .map(({ body, mood, rating, checkoutSkipped, ...e }: any) => {
      const entry: any = {
        ...e,
        title: typeof e.title === 'string' ? e.title : '',
        excerpt: typeof e.excerpt === 'string' ? e.excerpt : String(body || '').slice(0, 200),
        tags: Array.isArray(e.tags) ? e.tags.filter((t: any) => typeof t === 'string') : [],
        wordCount: Number(e.wordCount) || 0,
        pinned: !!e.pinned,
      };
      // a mood or rating out of range is dropped, never kept as a key holding nothing
      if (scale(mood)) entry.mood = mood;
      if (scale(rating)) entry.rating = rating;
      if (checkoutSkipped === true) entry.checkoutSkipped = true;
      return entry;
    });
  out.journalTags = list(p?.journalTags).filter((t) => typeof t === 'string');
  out.scores = sanitizeScores(p?.scores);
  out.scoreTags = sanitizeTags(p?.scoreTags);
  const tied = pruneScoreRefs(out.scores, out.scoreTags, sanitizeLearnings(p?.learnings, out.scoreTags));
  out.scores = tied.nodes;
  out.learnings = tied.learnings;
  return out;
}

// ---------- v5 -> v6 (1.7) ----------

const isRecord = (x: any): boolean => !!x && typeof x === 'object' && !Array.isArray(x);
const isFiniteNumber = (n: any): n is number => typeof n === 'number' && Number.isFinite(n);
const listOf = (a: any): any[] => (Array.isArray(a) ? a : []);
const validTime = (t: any) => typeof t === 'string' && toMinutes(t) >= 0;
const REMINDS: TaskRemind[] = ['morning', 'hour'];

/** Iris and Terracotta moved a little in 1.7: a saved accent moves with them. */
const ACCENT_REMAP: Record<string, string> = { '#8B7CF8': '#9588F9', '#D97757': '#DB7E5F' };

/** at most this many pen points in a recorded signature, and in each recorded digit */
const SIG_MAX_POINTS = 2000;
const DIGIT_MAX_POINTS = 400;
const DIGIT_KEYS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
/** the parts of a written date, in the order they are written */
const DATE_PARTS = ['dd', 'mm', 'yy'] as const;

/** the longest session logged or edited by hand, in minutes (12 hours) */
const MANUAL_MAX_MIN = 720;

/** the largest Desmos graph kept, in characters; a larger one would bloat every save of its row */
export const DESMOS_MAX_CHARS = 300000;

/**
 * Thins strokes evenly to at most `max` points in all: every stroke keeps its first and last point (a dot its one), the
 * rest share what is left in proportion to their length. Null when even the ends do not fit.
 */
function thinStrokes(strokes: SigStroke[], max: number): SigStroke[] | null {
  const total = strokes.reduce((n, s) => n + s.pts.length, 0);
  if (total <= max) return strokes;
  const ends = strokes.reduce((n, s) => n + Math.min(2, s.pts.length), 0);
  if (ends > max) return null;
  const spare = max - ends;
  const middles = total - ends;
  return strokes.map((s) => {
    const n = s.pts.length;
    if (n <= 2) return s;
    const keep = 2 + Math.floor(((n - 2) * spare) / middles);
    if (keep >= n) return s;
    const pts: SigPoint[] = [];
    for (let i = 0; i < keep; i++) pts.push(s.pts[Math.round((i * (n - 1)) / (keep - 1))]);
    return { pts };
  });
}

/**
 * Recorded pen strokes, checked: every point an [x, y, t]; one holding a number that is not finite (which JSON keeps as
 * null) is dropped, as is a stroke left with no points, and the rest are thinned to `max`. Null when the shape is wrong
 * or nothing is left.
 */
function cleanStrokes(raw: any, max: number): SigStroke[] | null {
  if (!Array.isArray(raw)) return null;
  const strokes: SigStroke[] = [];
  for (const s of raw) {
    if (!isRecord(s) || !Array.isArray(s.pts)) return null;
    const pts: SigPoint[] = [];
    for (const p of s.pts) {
      if (!Array.isArray(p) || p.length < 3) return null;
      const xyt = [p[0], p[1], p[2]];
      if (xyt.some((n) => n !== null && typeof n !== 'number')) return null;
      if (!xyt.every(isFiniteNumber)) continue;
      pts.push(xyt as SigPoint);
    }
    if (pts.length) strokes.push({ pts });
  }
  return strokes.length ? thinStrokes(strokes, max) : null;
}

function cleanDigits(raw: any): OwnSignature['digits'] | null {
  if (!isRecord(raw)) return null;
  const out: Record<string, { strokes: SigStroke[] }> = {};
  for (const d of DIGIT_KEYS) {
    if (!isRecord(raw[d])) return null;
    const strokes = cleanStrokes(raw[d].strokes, DIGIT_MAX_POINTS);
    if (!strokes) return null;
    out[d] = { strokes };
  }
  return out;
}

function cleanDatePlace(raw: any): OwnSignature['date'] | null {
  if (!isRecord(raw) || !isFiniteNumber(raw.size) || !(raw.size > 0) || !isFiniteNumber(raw.gap) || !isFiniteNumber(raw.tilt)) return null;
  if (raw.when !== 'signature' && raw.when !== 'outro') return null;
  const at = (q: any) => (isRecord(q) && isFiniteNumber(q.x) && isFiniteNumber(q.y) ? { x: q.x, y: q.y } : null);
  const g = isRecord(raw.groups) ? raw.groups : {};
  const dd = at(g.dd);
  const mm = at(g.mm);
  const yy = at(g.yy);
  if (!dd || !mm || !yy) return null;
  const out: NonNullable<OwnSignature['date']> = { size: raw.size, gap: raw.gap, tilt: raw.tilt, when: raw.when, groups: { dd, mm, yy } };
  // the parts written keep their fixed order; with none valid, all three are written
  if (Array.isArray(raw.parts)) {
    const parts = DATE_PARTS.filter((k) => raw.parts.includes(k));
    if (parts.length) out.parts = parts;
  }
  return out;
}

/**
 * A signature recorded on this app, checked on every load and import: null when its strokes are damaged. Its digits and
 * the date's placement are optional, so a damaged one of those goes on its own (no digits, no date) and the signature
 * stays. Never throws.
 */
export function sanitizeSignature(raw: any): OwnSignature | null {
  try {
    if (!isRecord(raw) || raw.v !== 1 || !isFiniteNumber(raw.recordedAt)) return null;
    const strokes = cleanStrokes(raw.strokes, SIG_MAX_POINTS);
    if (!strokes) return null;
    const out: OwnSignature = { v: 1, recordedAt: raw.recordedAt, strokes };
    const digits = raw.digits === undefined ? null : cleanDigits(raw.digits);
    if (digits) {
      out.digits = digits;
      const date = raw.date === undefined ? null : cleanDatePlace(raw.date);
      if (date) out.date = date;
    }
    return out;
  } catch {
    return null;
  }
}

function cleanDaily(t: any): DailyTask {
  const out = { ...t };
  if (typeof out.title !== 'string') out.title = out.title == null ? '' : String(out.title);
  if (typeof out.doneOn !== 'string') out.doneOn = null;
  if (out.repeat !== 'daily') delete out.repeat;
  // chosen weekdays belong to a repeating ToDo only; none, or all seven, is every day
  const days = out.repeat === 'daily' ? cleanDays(out.days) : undefined;
  if (days) out.days = days;
  else delete out.days;
  if (!validTime(out.time)) delete out.time;
  // a ToDo's reminder is set from its time, so without one it has nothing to ring at
  if (!REMINDS.includes(out.remind) || !out.time) delete out.remind;
  return out;
}

function cleanMission(m: any): Mission {
  const out = { ...m, done: m.done === true };
  if (!out.done || typeof out.doneOn !== 'string') delete out.doneOn;
  if (!validTime(out.time)) delete out.time;
  // 'Morning of' rings at 8 am with or without a time; 'An hour before' needs the time it is an hour before
  if (!REMINDS.includes(out.remind) || (out.remind === 'hour' && !out.time)) delete out.remind;
  const early = Array.isArray(out.early) ? MISSION_EARLY.filter((e) => out.early.includes(e)) : [];
  if (early.length) out.early = early;
  else delete out.early;
  return out;
}

/** A Deep Work session as kept: `manual` only when true, a subject only as text. */
function cleanSession(x: any): FocusSession {
  const out = { ...x };
  if (out.manual !== true) delete out.manual;
  if (out.subject !== undefined && typeof out.subject !== 'string') delete out.subject;
  return out;
}

/** the most widgets Today's board keeps */
const TODAY_MAX_WIDGETS = 60;
const WIDGET_SIZES: WidgetSize[] = ['S', 'M', 'L'];

/**
 * Today's board as kept: null (the default arrangement) unless it is a list; each widget needs an id (once) and a type,
 * its size one of S, M and L (M otherwise), its config a plain record. With `knownTypes` (the registry's), a widget of a
 * type it does not know goes too. Never throws.
 */
export function cleanTodayLayout(raw: unknown, knownTypes?: readonly string[]): TodayWidget[] | null {
  if (!Array.isArray(raw)) return null;
  const out: TodayWidget[] = [];
  const seen = new Set<string>();
  for (const w of raw) {
    if (out.length >= TODAY_MAX_WIDGETS) break;
    if (!isRecord(w) || typeof w.id !== 'string' || !w.id || seen.has(w.id)) continue;
    if (typeof w.type !== 'string' || !w.type || w.type.length > 40) continue;
    if (knownTypes && !knownTypes.includes(w.type)) continue;
    seen.add(w.id);
    const widget: TodayWidget = { id: w.id, type: w.type, size: WIDGET_SIZES.includes(w.size) ? w.size : 'M' };
    if (isRecord(w.config)) {
      try {
        widget.config = JSON.parse(JSON.stringify(w.config));
      } catch {
        // a config that cannot be saved is left out; the widget starts on its own defaults
      }
    }
    out.push(widget);
  }
  return out;
}

/** the column counts a wide board keeps an arrangement for */
export const TODAY_COLUMN_COUNTS = [2, 3] as const;

/**
 * Today's wide arrangements as kept: for each column count it knows, that many columns of ids (each id once across them,
 * at most the board's limit). Anything else is dropped: that count is laid out afresh. Never throws.
 */
export function cleanTodayColumns(raw: unknown): TodayColumns {
  const out: TodayColumns = {};
  if (!isRecord(raw)) return out;
  for (const n of TODAY_COLUMN_COUNTS) {
    const cols = (raw as any)[String(n)];
    if (!Array.isArray(cols) || cols.length !== n) continue;
    const seen = new Set<string>();
    const clean = cols.map((col: unknown) => (Array.isArray(col) ? col : []).filter((id: unknown) => {
      if (typeof id !== 'string' || !id || seen.has(id) || seen.size >= TODAY_MAX_WIDGETS) return false;
      seen.add(id);
      return true;
    }) as string[]);
    out[String(n)] = clean;
  }
  return out;
}

function cleanVideo(v: any): VaultVideo {
  const out = { ...v };
  if (!(isFiniteNumber(out.resumeAt) && out.resumeAt >= 0)) delete out.resumeAt;
  if (!(isFiniteNumber(out.openedAt) && out.openedAt > 0)) delete out.openedAt;
  return out;
}

const TRASH_KINDS: TrashKind[] = ['note', 'journal', 'video', 'timedNote', 'bookmark', 'attachment', 'habit', 'mission', 'exam'];

/** Whether a trash item stands behind the PIN now: its own lock, or the lock on the tool it came from. */
function trashLockOf(item: TrashItem, settings: Partial<Settings>): boolean {
  if (item.ownLock) return true;
  if (item.kind === 'journal') return !!settings.journalLocked;
  if (item.kind === 'note' || item.kind === 'attachment') return !!settings.notesLocked;
  return false;
}

/** The trash with every item's lock worked out again from the settings (after a lock was switched on or off). */
function relockTrash(trash: TrashItem[], settings: Partial<Settings>): TrashItem[] {
  let changed = false;
  const out = trash.map((t) => {
    const locked = trashLockOf(t, settings);
    if (locked === t.locked) return t;
    changed = true;
    return { ...t, locked };
  });
  return changed ? out : trash;
}

/**
 * Recently deleted as saved: anything that is not a whole item of a known kind is dropped. With the settings at hand
 * every lock is worked out again; without them (their row did not load) a lock is only ever kept, never lifted.
 */
function cleanTrash(raw: any, settings?: Partial<Settings>): TrashItem[] {
  const out: TrashItem[] = [];
  const seen = new Set<string>();
  for (const it of listOf(raw)) {
    if (!isRecord(it) || typeof it.id !== 'string' || seen.has(it.id) || !TRASH_KINDS.includes(it.kind)) continue;
    if (!isFiniteNumber(it.deletedAt) || !isRecord(it.data) || typeof it.data.id !== 'string') continue;
    const part = it.kind === 'timedNote' || it.kind === 'bookmark' || it.kind === 'attachment';
    if (part && typeof it.parentId !== 'string') continue;
    if (it.kind === 'journal' && typeof it.data.dateKey !== 'string') continue;
    if (it.kind === 'attachment' && typeof it.data.uri !== 'string') continue;
    // an exam keeps its own node among the ones it took; without it there is nothing to put back
    const examNodes = it.kind === 'exam' ? listOf(it.data.nodes).filter((n) => isRecord(n) && typeof n.id === 'string' && n.id) : [];
    if (it.kind === 'exam' && !examNodes.some((n) => n.id === it.data.id)) continue;
    seen.add(it.id);
    // a note's attachments are records only, so relinking or restoring them never reads a field of null
    const data = it.kind === 'note' ? { ...it.data, attachments: listOf(it.data.attachments).filter(isRecord) }
      : it.kind === 'video' ? { ...it.data, notes: listOf(it.data.notes).filter(isRecord), bookmarks: listOf(it.data.bookmarks).filter(isRecord) }
        : it.kind === 'habit' ? cleanHabit(it.data)
          : it.kind === 'mission' ? cleanMission({ ...it.data, subtasks: listOf(it.data.subtasks).filter(isRecord) })
            : it.kind === 'exam' ? { id: it.data.id, nodes: examNodes, learnings: listOf(it.data.learnings).filter(isRecord) }
              : it.data;
    const item: TrashItem = {
      id: it.id, kind: it.kind, deletedAt: it.deletedAt, title: typeof it.title === 'string' ? it.title : '', locked: false, data,
    };
    if (typeof it.parentId === 'string') item.parentId = it.parentId;
    if (Number.isInteger(it.index) && it.index >= 0) item.index = it.index;
    if (it.ownLock === true || (it.kind === 'note' && it.data.locked === true)) item.ownLock = true;
    item.locked = settings ? trashLockOf(item, settings) : it.locked === true || !!item.ownLock;
    out.push(item);
  }
  return out;
}

const BOOLEAN_SETTINGS_V6 = [
  'introTapSkip', 'focusChime', 'examReminders', 'blockAlerts', 'attachmentsWifiOnly', 'calcFunctions', 'calcSci', 'focusAlertAsked',
] as const;

function cleanSettingsV6(s: any): Settings {
  const st = { ...s };
  if (typeof st.accent === 'string' && ACCENT_REMAP[st.accent.toUpperCase()]) st.accent = ACCENT_REMAP[st.accent.toUpperCase()];
  for (const k of BOOLEAN_SETTINGS_V6) if (typeof st[k] !== 'boolean') st[k] = DEFAULT_SETTINGS[k];
  st.ownSignature = sanitizeSignature(st.ownSignature);
  // with no signature of their own to write, the start screen writes the creator's
  st.signatureSource = st.signatureSource === 'own' && st.ownSignature ? 'own' : 'creator';
  st.calcAngle = st.calcAngle === 'rad' ? 'rad' : 'deg';
  if (!(Number.isInteger(st.focusLastMin) && st.focusLastMin >= 1 && st.focusLastMin <= 600)) st.focusLastMin = DEFAULT_SETTINGS.focusLastMin;
  st.focusLastMode = st.focusLastMode === 'stopwatch' ? 'stopwatch' : 'countdown';
  st.writingFont = st.writingFont === 'serif' ? 'serif' : 'sans';
  if (!(Number.isInteger(st.focusGoalMin) && st.focusGoalMin >= 0 && st.focusGoalMin <= 600)) st.focusGoalMin = DEFAULT_SETTINGS.focusGoalMin;
  if (!(isFiniteNumber(st.backupNudgeAt) && st.backupNudgeAt >= 0)) st.backupNudgeAt = DEFAULT_SETTINGS.backupNudgeAt;
  // no repo yet checks Sturoids' own releases; one under the owner's old GitHub name follows the rename
  if (typeof st.githubRepo !== 'string' || !st.githubRepo.trim()) st.githubRepo = DEFAULT_UPDATE_REPO;
  else if (OLD_UPDATE_OWNER.test(st.githubRepo.trim())) st.githubRepo = st.githubRepo.trim().replace(OLD_UPDATE_OWNER, 'sanjay-murthy-r/');
  return st;
}

/** A habit as kept: its ticks a list of day keys, its weekdays sorted and unique (or none, every day). */
function cleanHabit(h: any): Habit {
  const out = { ...h, doneDates: listOf(h.doneDates).filter((d) => typeof d === 'string') };
  const days = cleanDays(out.days);
  if (days) out.days = days;
  else delete out.days;
  return out;
}

/** One day's ticked ToDos or tasks, checked: an item needs an id, once each; its title is text. Undefined when empty. */
function cleanDoneItems(raw: any): DoneItem[] | undefined {
  const out: DoneItem[] = [];
  const seen = new Set<string>();
  for (const it of listOf(raw)) {
    if (!isRecord(it) || typeof it.id !== 'string' || !it.id || seen.has(it.id)) continue;
    seen.add(it.id);
    out.push({ id: it.id, title: typeof it.title === 'string' ? it.title : it.title == null ? '' : String(it.title) });
  }
  return out.length ? out : undefined;
}

/** The day's record as saved: a day whose key is not a date, or that holds nothing, is dropped. */
export function cleanDoneLog(raw: any): Record<string, DayDone> {
  const out: Record<string, DayDone> = {};
  if (!isRecord(raw)) return out;
  for (const key of Object.keys(raw)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !isRecord(raw[key])) continue;
    const todos = cleanDoneItems(raw[key].todos);
    const tasks = cleanDoneItems(raw[key].tasks);
    if (!todos && !tasks) continue;
    const day: DayDone = {};
    if (todos) day.todos = todos;
    if (tasks) day.tasks = tasks;
    out[key] = day;
  }
  return out;
}

/** The record with an item added to a day's list, once (the same record when it is already there). */
function logDone(log: Record<string, DayDone>, day: string, kind: keyof DayDone, item: DoneItem): Record<string, DayDone> {
  const was = log[day] || {};
  const list = was[kind] || [];
  if (list.some((x) => x.id === item.id)) return log;
  return { ...log, [day]: { ...was, [kind]: [...list, item] } };
}

/** The record with an item taken off a day's list; a day left with nothing goes (the same record when it was not there). */
function unlogDone(log: Record<string, DayDone>, day: string, kind: keyof DayDone, id: string): Record<string, DayDone> {
  const was = log[day];
  const list = was?.[kind];
  if (!was || !list || !list.some((x) => x.id === id)) return log;
  const rest = list.filter((x) => x.id !== id);
  const next: DayDone = { ...was };
  if (rest.length) next[kind] = rest;
  else delete next[kind];
  const out = { ...log };
  if (next.todos || next.tasks) out[day] = next;
  else delete out[day];
  return out;
}

/**
 * The checks on everything 1.7 added: idempotent, run on every load, every import and the v6 migration. Only the
 * collections present are touched, so a row that could not be loaded is never stood in for.
 */
export function sanitizeV6(p: any): any {
  const out = { ...(p || {}) };
  if ('dailyTasks' in out) out.dailyTasks = listOf(out.dailyTasks).filter(isRecord).map(cleanDaily);
  if ('missions' in out) out.missions = listOf(out.missions).filter(isRecord).map(cleanMission);
  if ('sessions' in out) out.sessions = listOf(out.sessions).filter(isRecord).map(cleanSession);
  if ('todayLayout' in out) out.todayLayout = cleanTodayLayout(out.todayLayout);
  if ('todayColumns' in out) out.todayColumns = cleanTodayColumns(out.todayColumns);
  if ('vaultVideos' in out) out.vaultVideos = listOf(out.vaultVideos).filter(isRecord).map(cleanVideo);
  if ('habits' in out) out.habits = listOf(out.habits).filter(isRecord).map(cleanHabit);
  if ('doneLog' in out) out.doneLog = cleanDoneLog(out.doneLog);
  if (isRecord(out.settings)) out.settings = cleanSettingsV6(out.settings);
  if ('trash' in out) out.trash = cleanTrash(out.trash, isRecord(out.settings) ? out.settings : undefined);
  if ('desmosState' in out) {
    out.desmosState = typeof out.desmosState === 'string' && out.desmosState.length <= DESMOS_MAX_CHARS ? out.desmosState : '';
  }
  return out;
}

/**
 * The ONE v6 migration. `fromBefore6`: the data comes from before one-off ToDos, when every ToDo came back each day,
 * so each keeps doing that. Only data that old is marked (a 1.7 backup's one-offs stay one-offs), and the rest is
 * sanitizeV6, so running it again changes nothing.
 */
export function migrateV6(p: any, fromBefore6: boolean): any {
  const out = { ...(p || {}) };
  if (fromBefore6 && Array.isArray(out.dailyTasks)) {
    out.dailyTasks = out.dailyTasks.map((t: any) => (isRecord(t) && t.repeat === undefined ? { ...t, repeat: 'daily' } : t));
  }
  return sanitizeV6(out);
}

// ---------- persistence ----------
//
// Every collection is saved as a row of its own, with a small meta row naming them. Android reads a row back only up
// to about 2 MB, and one row holding everything would one day pass that; a collection on its own takes far longer to
// get there, and a row that cannot be read loses only its own collection's launch, never the rest. A save waits for a
// short pause after a burst of changes (a note being typed), then writes only the rows whose text changed and the meta
// row last, in one multiSet (one transaction on Android). The app going to the background writes what is waiting.

/** v6 is 1.7: one-off ToDos, Recently deleted, and one row per collection */
const STORE_VERSION = 6;
/** zustand's name for the saved store; the rows sit under it. Per profile ('student-hub-v2__<id>:notes'), see profiles.ts */
const STORE_KEY = pkey('student-hub-v2');
/** the version of the rows, which collections have one, and a count of saves */
const META_KEY = STORE_KEY + ':meta';
const rowKey = (k: string) => STORE_KEY + ':' + k;
/**
 * the single row everything was saved in before 1.7: read to move from, removed after a later launch loads cleanly.
 * Only the first profile can have one: another's key names a row that never existed
 */
const LEGACY_KEY = pkey('student-hub-v1');
interface RowsMeta { version: number; keys: string[]; seq: number; savedAt: number }

/** Whether this launch found nothing saved: a fresh install, or a profile on its first launch. */
export const loadedFresh = () => loadedFrom === 'none';

/** Set once a load has applied saved state, so a failure after that point is never taken for a failed load. */
let mergedFromStorage = false;

/** how long a save waits after the last change of a burst */
export const SAVE_PAUSE_MS = 350;
let pendingSave: StorageValue<any> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** the newest state a save set out to write: a failed write is tried again from it, never from anything older */
let latestSave: StorageValue<any> | null = null;

/** each row's text as it is on disk (read or written this launch), so a save writes only the rows that changed */
const rowText = new Map<string, string>();
/** each collection's size in characters, as last saved or loaded */
const rowChars = new Map<string, number>();
/** the collections with a row on disk, which the meta row names */
const rowsOnDisk = new Set<string>();
/** rows that could not be read or opened this launch: never written over, so what is on disk is never lost */
const blockedRows = new Set<string>();
/** the collections that did not load this launch */
let failedRows: string[] = [];
let saveSeq = 0;
/** the old single row's size, until the rows are first written */
let legacyChars: number | null = null;
/** where this launch's data came from: the rows, the old single row, or nowhere (a fresh install) */
let loadedFrom: 'rows' | 'legacy' | 'none' | null = null;
/** why the whole load failed: storage refused to read the row it needed, or what it held could not be opened */
let loadFailure: 'unreadable' | 'unparsable' | null = null;

/**
 * Android reads a row back only up to about 2 MB, and its whole database is capped too, so the size of each row is
 * kept: Settings warns well before one gets there.
 */
export const savedSize = (): number | null => largestCollection()?.chars ?? legacyChars;
/** The largest collection's row, by size in characters, or null before any has been saved or loaded this launch. */
export function largestCollection(): { key: string; name: string; chars: number } | null {
  let key = '';
  let chars = -1;
  for (const [k, n] of rowChars) {
    if (n > chars) {
      key = k;
      chars = n;
    }
  }
  return chars < 0 ? null : { key, name: COLLECTION_NAMES[key] || key, chars };
}
/** From here Settings suggests keeping a backup file, long before a row could not be read back. */
export const SAVE_WARN_CHARS = 1.2 * 1024 * 1024;

/** Each collection as the user knows it, for a notice that names what did not load. */
const COLLECTION_NAMES: Record<string, string> = {
  settings: 'Settings', aiLinks: 'AI links', quickAccess: 'Quick access', todoReminders: 'ToDo check-ins',
  dailyTasks: 'ToDos', missions: 'Long-term tasks', lastTriage: 'ToDos', sessions: 'Deep Work sessions',
  planner: 'Planner', weekTemplates: 'Week templates', habits: 'Habits', notes: 'Notes', noteFolders: 'Note folders',
  vaultVideos: 'YT Vault', vaultFolders: 'YT Vault folders', calcHistory: 'Calculator history', deepWork: 'Deep Work',
  journal: 'Journal', journalTags: 'Journal tags', scores: 'Scores', scoreTags: 'Score tags', learnings: 'Learnings',
  trash: 'Recently deleted', desmosState: 'Desmos', doneLog: 'Done history', todayLayout: 'Today',
  todayColumns: 'Today',
};

/** The collections that could not be loaded this launch, by name ("Notes"); empty when everything loaded. */
export function failedCollections(): string[] {
  return [...new Set(failedRows.map((k) => COLLECTION_NAMES[k] || k))];
}

/** A save that failed is never silent: the user hears once, until a save goes through again. */
let saveFailing = false;
const saveListeners = new Set<(failing: boolean) => void>();
export const savesFailing = () => saveFailing;
/** Calls cb whenever saving starts or stops failing. Returns an unsubscribe. */
export function subscribeSaveProblems(cb: (failing: boolean) => void): () => void {
  saveListeners.add(cb);
  return () => { saveListeners.delete(cb); };
}
function setSaveFailing(failing: boolean) {
  if (saveFailing === failing) return;
  saveFailing = failing;
  saveListeners.forEach((cb) => cb(failing));
}

/** the writes on their way to the disk, so a flush can wait for every one of them (a profile switch does) */
const writesInFlight = new Set<Promise<void>>();
const writesSettled = (): Promise<void> => Promise.all([...writesInFlight]).then(() => undefined);

/**
 * Writes a save that is still waiting for its pause: only the rows whose text changed, then the meta row. Resolves
 * once every write on its way has reached the disk or failed (savesFailing says which), this one and any before it.
 */
export function flushSaves(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const next = pendingSave;
  pendingSave = null;
  if (!next) return writesSettled();
  const state: any = next.state || {};
  const pairs: [string, string][] = [];
  const wrote: { key: string; text: string; before: string | undefined }[] = [];
  try {
    for (const k of DATA_KEYS) {
      if (blockedRows.has(k) || !(k in state)) continue;
      // stringified once, here, so the row's size is known
      const text = JSON.stringify(state[k]);
      if (typeof text !== 'string') continue;
      rowChars.set(k, text.length);
      if (rowText.get(k) === text) continue;
      wrote.push({ key: k, text, before: rowText.get(k) });
      pairs.push([rowKey(k), text]);
    }
  } catch {
    setSaveFailing(true);
    return writesSettled();
  }
  if (!pairs.length) return writesSettled();
  latestSave = next;
  for (const w of wrote) {
    rowText.set(w.key, w.text);
    rowsOnDisk.add(w.key);
  }
  const meta: RowsMeta = {
    version: typeof next.version === 'number' ? next.version : STORE_VERSION,
    keys: [...rowsOnDisk],
    seq: ++saveSeq,
    savedAt: Date.now(),
  };
  pairs.push([META_KEY, JSON.stringify(meta)]);
  const write = Promise.resolve(AsyncStorage.multiSet(pairs)).then(
    () => {
      legacyChars = null;
      setSaveFailing(false);
    },
    () => {
      // none of it reached the disk: its rows count as unwritten again (unless a later save has set them since), and
      // the newest state waits for the next flush (the next change, or leaving the app), unless a newer save is already
      // waiting or saving has paused since to protect data that could not be read
      for (const w of wrote) {
        if (rowText.get(w.key) !== w.text) continue;
        if (w.before === undefined) rowText.delete(w.key);
        else rowText.set(w.key, w.before);
      }
      if (!pendingSave && !persistPaused && latestSave) pendingSave = latestSave;
      setSaveFailing(true);
    },
  );
  writesInFlight.add(write);
  write.finally(() => { writesInFlight.delete(write); });
  return writesSettled();
}

/** Whether a change is still waiting for its pause before it is saved. */
export const savePending = () => pendingSave != null;

/** Forgets a save that is still waiting: saving is pausing to protect data that could not be read. */
function dropPendingSave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  pendingSave = null;
}

/** Every row the store keeps, the old single row included. */
function allRowKeys(): string[] {
  return [META_KEY, LEGACY_KEY, ...[...new Set<string>([...DATA_KEYS, ...rowsOnDisk])].map(rowKey)];
}

/** Reads the old single row: the data as it was saved before 1.7. */
async function readLegacy(): Promise<StorageValue<any> | null> {
  let text: string | null;
  try {
    text = await AsyncStorage.getItem(LEGACY_KEY);
  } catch (e) {
    // the row itself cannot be read (on Android, one grown past about 2 MB): no restart will read it either
    loadFailure = 'unreadable';
    throw e;
  }
  if (text == null) {
    loadedFrom = 'none';
    return null;
  }
  loadedFrom = 'legacy';
  legacyChars = text.length;
  try {
    return JSON.parse(text);
  } catch (e) {
    loadFailure = 'unparsable';
    throw e;
  }
}

/**
 * Reads the meta row, then every row it names. A row that cannot be read or opened is left out: its collection starts
 * on its fresh value this launch, the row is never written over, and the user hears which collection it was. Before
 * 1.7 there are no rows yet, and the old single row is read instead.
 */
async function readSaved(): Promise<StorageValue<any> | null> {
  let metaText: string | null;
  try {
    metaText = await AsyncStorage.getItem(META_KEY);
  } catch (e) {
    loadFailure = 'unreadable';
    throw e;
  }
  if (metaText == null) return readLegacy();
  let meta: RowsMeta;
  try {
    meta = JSON.parse(metaText);
    if (!isRecord(meta) || typeof meta.version !== 'number' || !Array.isArray(meta.keys)) throw new Error('damaged meta row');
  } catch (e) {
    // without it there is no knowing what the rows hold, so nothing is read or written over
    loadFailure = 'unparsable';
    throw e;
  }
  loadedFrom = 'rows';
  saveSeq = Number(meta.seq) || 0;
  const listed = meta.keys.filter((k: unknown): k is string => typeof k === 'string');
  // a collection from a later version stays named, so its row is kept for that version
  listed.forEach((k) => rowsOnDisk.add(k));
  const keys = listed.filter((k) => (DATA_KEYS as string[]).includes(k));
  const unreadable = new Set<string>();
  const texts = new Map<string, string | null>();
  try {
    for (const [key, value] of await AsyncStorage.multiGet(keys.map(rowKey))) texts.set(key, value);
  } catch {
    // one row too large to read fails the whole read: each is read on its own, so the others still load
    for (const k of keys) {
      try {
        texts.set(rowKey(k), await AsyncStorage.getItem(rowKey(k)));
      } catch {
        unreadable.add(k);
      }
    }
  }
  const state: any = {};
  const failed: string[] = [];
  const missing: string[] = [];
  for (const k of keys) {
    if (unreadable.has(k)) {
      failed.push(k);
      continue;
    }
    const text = texts.get(rowKey(k));
    if (text == null) {
      // named but not there: there is nothing on disk to protect, but the collection is gone, which is said
      missing.push(k);
      continue;
    }
    try {
      state[k] = JSON.parse(text);
    } catch {
      failed.push(k);
      continue;
    }
    rowText.set(k, text);
    rowChars.set(k, text.length);
  }
  // the exam tree, its tags and its learnings are checked against one another on every load: with one of them out, the
  // others would lose their links to it, so they stay out together (and untouched on disk)
  const linked = ['scores', 'scoreTags', 'learnings'];
  if (linked.some((k) => failed.includes(k) || missing.includes(k))) {
    for (const k of linked) {
      if (!(k in state)) continue;
      delete state[k];
      failed.push(k);
    }
  }
  if (failed.length || missing.length) {
    failed.forEach((k) => blockedRows.add(k));
    failedRows = [...failed, ...missing];
    // what this phone holds is not the user's whole data now: nothing goes over a copy kept elsewhere, and no file is
    // cleared as unused (the missing collection may use it)
    loadFailed = true;
    // a restart reads the same rows again: a backup or the cloud copy can bring them back
    if (failed.length) rowUnreadable = true;
  }
  return { state, version: meta.version };
}

/** Removes every row the store keeps (zustand's clearStorage). */
async function removeRows(): Promise<void> {
  dropPendingSave();
  await AsyncStorage.multiRemove(allRowKeys());
  rowText.clear();
  rowChars.clear();
  rowsOnDisk.clear();
}

const rowStorage: PersistStorage<any> = {
  getItem: () => readSaved(),
  setItem: (_name, value) => {
    pendingSave = value;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSaves, SAVE_PAUSE_MS);
  },
  removeItem: () => removeRows(),
};

/**
 * Everything the store keeps on this phone goes, and every guard this launch put on saving is lifted: the user asked
 * for all of it to go (erasing the phone). What the store holds after this is saved as new.
 */
export async function clearSavedData(): Promise<void> {
  dropPendingSave();
  blockedRows.clear();
  failedRows = [];
  try {
    await AsyncStorage.multiRemove(allRowKeys());
  } catch {
    // whatever stays is written over by the next save, now that nothing blocks it
  }
  rowText.clear();
  rowChars.clear();
  rowsOnDisk.clear();
  legacyChars = null;
  resumePersistence();
  replacedThisLaunch = true;
}

// leaving the app, or closing it from the background, writes whatever is still waiting
AppLifecycle?.addEventListener?.('change', (next) => {
  if (next !== 'active') flushSaves();
  else settleIfNewDay();
});

/** Every persisted-shape migration, oldest first. Also restores the app's own saved blob on import. */
function migratePersisted(persisted: any, version: number): any {
  let p = version < 2 ? migrateData(persisted) : persisted;
  if (version < 3) p = migrateToGrey(p);
  if (version < 4) {
    p = { ...p, settings: { ...(p?.settings || {}), accent: p?.settings?.accent || DEFAULT_ACCENT } };
  }
  if (version < 5) p = migrateV5(p);
  if (version < 6) p = migrateV6(p, true);
  return p;
}

// ---------- Recently deleted ----------

const firstLine = (text: unknown) => (typeof text === 'string' ? text.trim().split('\n')[0].trim().slice(0, 80) : '');
const noteTitle = (n: Note) => firstLine(n.title) || firstLine(n.body) || 'Untitled note';
const entryTitle = (e: JournalEntry) => firstLine(e.title) || 'Entry for ' + fmtShortDate(e.dateKey);

/**
 * Recently deleted did not load this launch, so it is not saved: a delete moving something into it would be saved on
 * one side only and lose it, so nothing is moved.
 */
const trashUnsaved = () => blockedRows.has('trash');

/** The collection a trash item goes back into. */
const homeOf = (kind: TrashKind): DataKey => (
  kind === 'note' || kind === 'attachment' ? 'notes'
    : kind === 'journal' ? 'journal'
      : kind === 'habit' ? 'habits'
        : kind === 'mission' ? 'missions'
          : kind === 'exam' ? 'scores'
            : 'vaultVideos'
);

function trashItemOf(kind: TrashKind, data: any, title: string, settings: Settings, extra: Partial<TrashItem> = {}): TrashItem {
  const item: TrashItem = { id: uid(), kind, deletedAt: Date.now(), title, locked: false, data, ...extra };
  if (!item.ownLock) delete item.ownLock;
  item.locked = trashLockOf(item, settings);
  return item;
}

/** The attachments a trash item keeps: a deleted note's, or one removed on its own. */
function trashedAttachmentsOf(t: TrashItem): Attachment[] {
  if (t.kind === 'note') return listOf(t.data?.attachments).filter((a) => a && typeof a.id === 'string' && typeof a.uri === 'string');
  if (t.kind === 'attachment') return typeof t.data?.uri === 'string' ? [t.data] : [];
  return [];
}

/**
 * Every attachment kept in Recently deleted. Their files stay on the phone until the item is deleted for good, so a
 * backup, the cloud copy and the folder sweep after a restore all count them with the notes' own.
 */
export function trashedAttachments(trash: TrashItem[]): Attachment[] {
  return trash.flatMap(trashedAttachmentsOf);
}

/** The journal entries kept in Recently deleted, whose texts stay in their files until then. */
export function trashedEntryIds(trash: TrashItem[]): string[] {
  return trash.filter((t) => t.kind === 'journal' && typeof t.data?.id === 'string').map((t) => t.data.id);
}

/**
 * Deletes trash items for good, with what goes with them: the parts kept from a note or a video deleted alongside
 * (unless it is back in the app), and the files nothing that stays still uses. The store stays free of the file system:
 * the attachments and journal modules delete the files, each only inside the app's own folder.
 */
function dropForGood(s: AppState, items: TrashItem[], set: (partial: Partial<AppState>) => void) {
  const gone = new Set(items.map((t) => t.id));
  for (const t of items) {
    const kept = t.kind === 'note' ? s.notes.some((n) => n.id === t.data.id) : t.kind === 'video' ? s.vaultVideos.some((v) => v.id === t.data.id) : true;
    if (kept) continue;
    for (const x of s.trash) {
      const part = t.kind === 'note' ? x.kind === 'attachment' : x.kind === 'timedNote' || x.kind === 'bookmark';
      if (part && x.parentId === t.data.id) gone.add(x.id);
    }
  }
  const trash = s.trash.filter((t) => !gone.has(t.id));
  const removed = s.trash.filter((t) => gone.has(t.id));
  const used = new Set<string>();
  for (const n of s.notes) for (const a of n.attachments || []) used.add(a.uri);
  for (const a of trashedAttachments(trash)) used.add(a.uri);
  const files = trashedAttachments(removed).filter((a) => !used.has(a.uri));
  const entries = new Set([...s.journal.map((e) => e.id), ...trashedEntryIds(trash)]);
  const bodies = trashedEntryIds(removed).filter((id) => !entries.has(id));
  set({ trash });
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    if (files.length) (require('./attachments') as typeof import('./attachments')).deleteAttachmentFiles(files);
  } catch {
    // the files stay; the sweep after the next restore clears what nothing uses
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    if (bodies.length) void (require('./journal') as typeof import('./journal')).deleteBodies(bodies);
  } catch {
    // as above
  }
}

// ---------- store ----------

const appStore = create<AppState>()(
  persist(
    (set, get) => ({
      ...initialData(),

      setSetting: (key, value) =>
        set((s) => {
          const settings = { ...s.settings, [key]: value };
          // what Recently deleted keeps from a tool locks and unlocks with that tool
          if (key === 'journalLocked' || key === 'notesLocked') return { settings, trash: relockTrash(s.trash, settings) };
          return { settings };
        }),
      setTabSlots: (slots) =>
        set((s) => {
          const tabSlots = normaliseSlots(slots);
          return { settings: { ...s.settings, tabSlots, archivedTools: normaliseArchived(s.settings.archivedTools, tabSlots) } };
        }),
      setToolArchived: (key, archived) => {
        const s = get();
        const slots = normaliseSlots(s.settings.tabSlots);
        const current = normaliseArchived(s.settings.archivedTools, slots);
        if (archived) {
          if (slots.includes(key)) return false;
          // a session going on in an archived Deep Work would have no way back to it
          if (key === 'focus' && s.deepWork) return false;
          if (!current.includes(key)) set({ settings: { ...s.settings, archivedTools: [...current, key] } });
          return true;
        }
        if (current.includes(key)) set({ settings: { ...s.settings, archivedTools: current.filter((k) => k !== key) } });
        return true;
      },
      setAiLinks: (links) => set({ aiLinks: links }),
      setQuickAccess: (items) => set({ quickAccess: items }),
      addTodoReminder: (time, label) =>
        set((s) => ({ todoReminders: [...s.todoReminders, { id: uid(), time, label }] })),
      removeTodoReminder: (id) =>
        set((s) => ({ todoReminders: s.todoReminders.filter((r) => r.id !== id) })),

      addDaily: (title, extra) => {
        const id = uid();
        // a new ToDo is a one-off unless it is asked to come back every day
        const task = cleanDaily({ id, title, doneOn: null, createdAt: Date.now(), ...(extra || {}) });
        set((s) => ({ dailyTasks: [...s.dailyTasks, task] }));
        return id;
      },
      toggleDaily: (id) =>
        set((s) => {
          const today = todayKey();
          const task = s.dailyTasks.find((t) => t.id === id);
          if (!task) return {};
          const ticking = task.doneOn !== today;
          return {
            dailyTasks: s.dailyTasks.map((t) => (t.id === id ? { ...t, doneOn: ticking ? today : null } : t)),
            // the day's record keeps the tick, with the title it had then; an untick takes it off today's list
            doneLog: ticking
              ? logDone(s.doneLog, today, 'todos', { id, title: task.title })
              : unlogDone(s.doneLog, today, 'todos', id),
          };
        }),
      updateDaily: (id, patch) =>
        set((s) => {
          const at = s.dailyTasks.findIndex((t) => t.id === id);
          if (at < 0) return {};
          const list = [...s.dailyTasks];
          const next = cleanDaily(patched(list[at], patch));
          // an every-day ToDo ticked on an earlier day is open today: made a one-off, that old tick would read as a
          // one-off done before today and the new day's tidy-up would delete it, so it goes
          if (!next.repeat && next.doneOn && next.doneOn !== todayKey()) next.doneOn = null;
          list[at] = next;
          return { dailyTasks: list };
        }),
      removeDaily: (id) => set((s) => ({ dailyTasks: s.dailyTasks.filter((t) => t.id !== id) })),
      restoreDaily: (task, index) =>
        set((s) => {
          if (s.dailyTasks.some((t) => t.id === task.id)) return {};
          const list = [...s.dailyTasks];
          list.splice(Math.max(0, Math.min(index, list.length)), 0, task);
          return { dailyTasks: list };
        }),
      setLastTriage: (dateKey) => set({ lastTriage: dateKey }),
      settleDay: () => {
        const today = todayKey();
        const s = get();
        const patch: Partial<AppState> = {};
        const keep = s.dailyTasks.filter((t) => t.repeat === 'daily' || !t.doneOn || t.doneOn >= today);
        if (keep.length !== s.dailyTasks.length) patch.dailyTasks = keep;
        // the day's record keeps the last 400 days
        const now = new Date();
        const from = todayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - DONE_LOG_KEEP_DAYS));
        const old = Object.keys(s.doneLog).filter((k) => k < from);
        if (old.length) {
          const log = { ...s.doneLog };
          for (const k of old) delete log[k];
          patch.doneLog = log;
        }
        if (patch.dailyTasks || patch.doneLog) set(patch);
      },

      addMission: (title, deadline) => {
        const id = uid();
        set((s) => ({ missions: [...s.missions, { id, title, deadline, done: false, subtasks: [] }] }));
        return id;
      },
      toggleMission: (id) =>
        set((s) => {
          const m = s.missions.find((x) => x.id === id);
          if (!m) return {};
          if (m.done) {
            const { doneOn, ...rest } = m;
            return {
              missions: s.missions.map((x) => (x.id === id ? { ...rest, done: false } : x)),
              // undone, it comes off the day it was ticked on
              doneLog: doneOn ? unlogDone(s.doneLog, doneOn, 'tasks', id) : s.doneLog,
            };
          }
          const today = todayKey();
          return {
            missions: s.missions.map((x) => (x.id === id ? { ...m, done: true, doneOn: today } : x)),
            doneLog: logDone(s.doneLog, today, 'tasks', { id, title: m.title }),
          };
        }),
      updateMission: (id, patch) =>
        set((s) => {
          const at = s.missions.findIndex((m) => m.id === id);
          if (at < 0) return {};
          const list = [...s.missions];
          list[at] = cleanMission(patched(list[at], patch));
          return { missions: list };
        }),
      removeMission: (id) => {
        const s = get();
        const index = s.missions.findIndex((m) => m.id === id);
        if (index < 0) return null;
        const mission = s.missions[index];
        set({ missions: s.missions.filter((m) => m.id !== id) });
        return { mission, index };
      },
      restoreMission: (m, index) =>
        set((s) => {
          if (s.missions.some((x) => x.id === m.id)) return {};
          const list = [...s.missions];
          list.splice(Math.max(0, Math.min(index, list.length)), 0, m);
          return { missions: list };
        }),
      addSubtask: (missionId, title) =>
        set((s) => ({
          missions: s.missions.map((m) =>
            m.id === missionId ? { ...m, subtasks: [...m.subtasks, { id: uid(), title, done: false }] } : m
          ),
        })),
      toggleSubtask: (missionId, subId) =>
        set((s) => ({
          missions: s.missions.map((m) =>
            m.id === missionId
              ? { ...m, subtasks: m.subtasks.map((st) => (st.id === subId ? { ...st, done: !st.done } : st)) }
              : m
          ),
        })),
      removeSubtask: (missionId, subId) => {
        const s = get();
        const m = s.missions.find((x) => x.id === missionId);
        const index = m ? m.subtasks.findIndex((st) => st.id === subId) : -1;
        if (!m || index < 0) return null;
        const subtask = m.subtasks[index];
        set({
          missions: s.missions.map((x) => (x.id === missionId ? { ...x, subtasks: x.subtasks.filter((st) => st.id !== subId) } : x)),
        });
        return { subtask, index };
      },
      restoreSubtask: (missionId, sub, index) =>
        set((s) => {
          const m = s.missions.find((x) => x.id === missionId);
          if (!m || m.subtasks.some((st) => st.id === sub.id)) return {};
          const subtasks = [...m.subtasks];
          subtasks.splice(Math.max(0, Math.min(index, subtasks.length)), 0, sub);
          return { missions: s.missions.map((x) => (x.id === missionId ? { ...x, subtasks } : x)) };
        }),

      logSession: (sess) => {
        const id = uid();
        set((s) => ({ sessions: [...s.sessions, { ...sess, id }] }));
        return id;
      },
      removeSession: (id) => {
        const s = get();
        const index = s.sessions.findIndex((x) => x.id === id);
        if (index < 0) return null;
        const session = s.sessions[index];
        set({ sessions: s.sessions.filter((x) => x.id !== id) });
        return { session, index };
      },
      restoreSession: (session, index) =>
        set((s) => {
          if (s.sessions.some((x) => x.id === session.id)) return {};
          const list = [...s.sessions];
          list.splice(Math.max(0, Math.min(index, list.length)), 0, session);
          return { sessions: list };
        }),
      addManualSession: ({ dateKey, minutes, subject }) => {
        const min = Math.round(Number(minutes));
        const today = todayKey();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || dateKey > today || !(min >= 1 && min <= MANUAL_MAX_MIN)) return null;
        const [y, m, d] = dateKey.split('-').map(Number);
        // today's ends now; an earlier day's in its evening, so it sits after that day's timed sessions
        const endedAt = dateKey === today ? Date.now() : new Date(y, m - 1, d, 18, 0).getTime();
        if (!Number.isFinite(endedAt)) return null;
        const id = uid();
        const what = typeof subject === 'string' ? subject.trim().replace(/\s+/g, ' ') : '';
        const session: FocusSession = {
          id, dateKey, endedAt, netSeconds: min * 60, taskTitles: [], manual: true, ...(what ? { subject: what } : {}),
        };
        set((s) => {
          // in its place by time, as the timed ones are
          const at = s.sessions.findIndex((x) => x.endedAt > endedAt);
          return { sessions: at < 0 ? [...s.sessions, session] : insertAt(s.sessions, session, at) };
        });
        return id;
      },
      updateSession: (id, patch) => {
        const s = get();
        const was = s.sessions.find((x) => x.id === id);
        if (!was) return false;
        const next: FocusSession = { ...was };
        if (typeof patch.subject === 'string') {
          const what = patch.subject.trim().replace(/\s+/g, ' ');
          if (what) next.subject = what;
          else delete next.subject;
        }
        if (patch.minutes !== undefined) {
          const min = Math.round(Number(patch.minutes));
          if (min >= 1 && min <= MANUAL_MAX_MIN) next.netSeconds = min * 60;
        }
        if (next.subject === was.subject && next.netSeconds === was.netSeconds) return true;
        set({ sessions: s.sessions.map((x) => (x.id === id ? next : x)) });
        return true;
      },
      setDeepWork: (session) => set({ deepWork: session }),
      patchDeepWork: (patch) =>
        set((s) => (s.deepWork ? { deepWork: { ...s.deepWork, ...patch } } : {})),

      addBlock: (day, b) =>
        set((s) => ({ planner: { ...s.planner, [day]: [...s.planner[day], { ...b, id: uid() }] } })),
      updateBlock: (day, b) =>
        set((s) => ({
          planner: { ...s.planner, [day]: s.planner[day].map((x) => (x.id === b.id ? b : x)) },
        })),
      removeBlock: (day, id) =>
        set((s) => ({ planner: { ...s.planner, [day]: s.planner[day].filter((x) => x.id !== id) } })),
      copyDay: (from, to) =>
        set((s) => ({
          planner: { ...s.planner, [to]: s.planner[from].map((b) => ({ ...b, id: uid() })) },
        })),
      restorePlanner: (week) => set({ planner: week }),
      restoreHabit: (h, index) =>
        set((s) => {
          if (s.habits.some((x) => x.id === h.id)) return {};
          const habits = [...s.habits];
          habits.splice(Math.min(Math.max(0, index), habits.length), 0, h);
          return { habits };
        }),
      saveTemplate: (name) =>
        set((s) => ({ weekTemplates: { ...s.weekTemplates, [name]: JSON.parse(JSON.stringify(s.planner)) } })),
      applyTemplate: (name) => {
        const tpl = get().weekTemplates[name];
        if (!tpl) return;
        const fresh = Object.fromEntries(
          DAY_NAMES.map((d) => [d, (tpl[d] || []).map((b) => ({ ...b, id: uid() }))])
        ) as PlannerWeek;
        set({ planner: fresh });
      },
      deleteTemplate: (name) =>
        set((s) => {
          const t = { ...s.weekTemplates };
          delete t[name];
          return { weekTemplates: t };
        }),

      addHabit: (title, remindTime, days) =>
        set((s) => {
          const due = cleanDays(days);
          return { habits: [...s.habits, { id: uid(), title, doneDates: [], remindTime, ...(due ? { days: due } : {}) }] };
        }),
      setHabitDays: (id, days) =>
        set((s) => {
          const due = cleanDays(days);
          const key = (due || []).join();
          if (!s.habits.some((h) => h.id === id && (h.days || []).join() !== key)) return {};
          return {
            habits: s.habits.map((h) => {
              if (h.id !== id) return h;
              const { days: _was, ...rest } = h;
              return due ? { ...rest, days: due } : rest;
            }),
          };
        }),
      toggleHabitToday: (id) =>
        set((s) => ({
          habits: s.habits.map((h) => {
            if (h.id !== id) return h;
            const today = todayKey();
            const has = h.doneDates.includes(today);
            return { ...h, doneDates: has ? h.doneDates.filter((d) => d !== today) : [...h.doneDates, today] };
          }),
        })),
      toggleHabitDay: (id, dateKey) => {
        // the week strip reaches back six days: a day further back, or one still to come, is never ticked
        const today = new Date();
        const earliest = todayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6));
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || dateKey > todayKey(today) || dateKey < earliest) return;
        set((s) => ({
          habits: s.habits.map((h) => {
            if (h.id !== id) return h;
            const has = h.doneDates.includes(dateKey);
            return { ...h, doneDates: has ? h.doneDates.filter((d) => d !== dateKey) : [...h.doneDates, dateKey] };
          }),
        }));
      },
      renameHabit: (id, title) => {
        const name = title.trim();
        if (!name) return;
        set((s) => ({ habits: s.habits.map((h) => (h.id === id && h.title !== name ? { ...h, title: name } : h)) }));
      },
      removeHabit: (id) => set((s) => ({ habits: s.habits.filter((h) => h.id !== id) })),
      setHabitReminder: (id, time) =>
        set((s) => ({ habits: s.habits.map((h) => (h.id === id ? { ...h, remindTime: time } : h)) })),

      addNote: (n) => {
        const id = uid();
        const now = Date.now();
        set((s) => ({
          notes: [
            {
              id, title: n.title || '', body: n.body || '', folder: n.folder || 'General',
              tags: n.tags || [], pinned: false, createdAt: now, updatedAt: now, subject: n.subject,
              attachments: [], locked: false,
            },
            ...s.notes,
          ],
        }));
        return id;
      },
      updateNote: (id, n, opts) =>
        set((s) => ({
          notes: s.notes.map((x) => (x.id === id ? { ...x, ...n, ...(opts?.touch === false ? {} : { updatedAt: Date.now() }) } : x)),
        })),
      // the store stays free of expo-file-system: only the notes screen knows which
      // uris it actually copied into its own directory (persistFile falls back to the
      // source uri on a failed copy, and deleting THAT would eat the user's original).
      // so hand the orphans back and let the caller do the guarded delete.
      deleteNote: (id) => {
        const orphaned = get().notes.find((x) => x.id === id)?.attachments ?? [];
        set((s) => ({ notes: s.notes.filter((x) => x.id !== id) }));
        return orphaned;
      },
      renameNoteFolder: (from, to) =>
        set((s) => {
          const name = to.trim();
          if (!name || from === 'General' || name === from || !s.noteFolders.includes(from) || s.noteFolders.includes(name)) return {};
          return {
            noteFolders: s.noteFolders.map((f) => (f === from ? name : f)),
            notes: s.notes.map((n) => (n.folder === from ? { ...n, folder: name } : n)),
          };
        }),
      deleteNoteFolder: (name) =>
        set((s) => {
          if (name === 'General' || !s.noteFolders.includes(name)) return {};
          return {
            noteFolders: s.noteFolders.filter((f) => f !== name),
            notes: s.notes.map((n) => (n.folder === name ? { ...n, folder: 'General' } : n)),
          };
        }),
      addNoteFolder: (name) =>
        set((s) => ({
          noteFolders: s.noteFolders.includes(name) ? s.noteFolders : [...s.noteFolders, name],
        })),
      addAttachment: (noteId, a) =>
        set((s) => ({
          notes: s.notes.map((n) =>
            n.id === noteId ? { ...n, attachments: [...n.attachments, { ...a, id: uid() }], updatedAt: Date.now() } : n
          ),
        })),
      removeAttachment: (noteId, attId) => {
        const orphaned = get().notes.find((n) => n.id === noteId)?.attachments.find((x) => x.id === attId);
        set((s) => ({
          notes: s.notes.map((n) =>
            n.id === noteId ? { ...n, attachments: n.attachments.filter((x) => x.id !== attId) } : n
          ),
        }));
        return orphaned;
      },
      relinkAttachments: (uris) =>
        set((s) => ({
          notes: s.notes.map((n) => (n.attachments.some((a) => uris[a.id])
            ? { ...n, attachments: n.attachments.map((a) => (uris[a.id] ? { ...a, uri: uris[a.id] } : a)) }
            : n)),
          // and those kept in Recently deleted, so they come back with their files
          trash: s.trash.some((t) => trashedAttachmentsOf(t).some((a) => uris[a.id])) ? s.trash.map((t) => {
            if (!trashedAttachmentsOf(t).some((a) => uris[a.id])) return t;
            if (t.kind === 'attachment') return { ...t, data: { ...t.data, uri: uris[t.data.id] } };
            return { ...t, data: { ...t.data, attachments: t.data.attachments.map((a: Attachment) => (uris[a.id] ? { ...a, uri: uris[a.id] } : a)) } };
          }) : s.trash,
        })),

      addVideo: (v) => {
        const id = uid();
        set((s) => ({
          vaultVideos: [
            {
              id, videoId: v.videoId, url: v.url, title: v.title, folderId: v.folderId ?? null,
              tags: [], addedAt: Date.now(), notes: [], bookmarks: [],
            },
            ...s.vaultVideos,
          ],
        }));
        return id;
      },
      updateVideo: (id, v) =>
        set((s) => ({ vaultVideos: s.vaultVideos.map((x) => (x.id === id ? { ...x, ...v } : x)) })),
      setVideoProgress: (id, seconds) => {
        if (!Number.isFinite(seconds)) return;
        const at = Math.max(0, Math.floor(seconds));
        const v = get().vaultVideos.find((x) => x.id === id);
        if (!v || v.resumeAt === at) return;
        set((s) => ({ vaultVideos: s.vaultVideos.map((x) => (x.id === id ? { ...x, resumeAt: at } : x)) }));
      },
      markVideoOpened: (id) => {
        if (!get().vaultVideos.some((x) => x.id === id)) return;
        const now = Date.now();
        set((s) => ({ vaultVideos: s.vaultVideos.map((x) => (x.id === id ? { ...x, openedAt: now } : x)) }));
      },
      deleteVideo: (id) => set((s) => ({ vaultVideos: s.vaultVideos.filter((x) => x.id !== id) })),
      addVaultFolder: (name, parentId = null) => {
        const id = uid();
        set((s) => ({ vaultFolders: [...s.vaultFolders, { id, name, parentId }] }));
        return id;
      },
      renameVaultFolder: (id, name) =>
        set((s) => ({ vaultFolders: s.vaultFolders.map((f) => (f.id === id ? { ...f, name } : f)) })),
      deleteVaultFolder: (id) =>
        set((s) => {
          const folder = s.vaultFolders.find((f) => f.id === id);
          const parent = folder ? folder.parentId : null;
          return {
            vaultFolders: s.vaultFolders
              .filter((f) => f.id !== id)
              .map((f) => (f.parentId === id ? { ...f, parentId: parent } : f)),
            vaultVideos: s.vaultVideos.map((v) => (v.folderId === id ? { ...v, folderId: parent } : v)),
          };
        }),
      addVideoTag: (videoId, tag) =>
        set((s) => ({
          vaultVideos: s.vaultVideos.map((v) => {
            if (v.id !== videoId) return v;
            const t = tag.replace(/^#/, '').trim().toLowerCase();
            if (!t || v.tags.includes(t)) return v;
            return { ...v, tags: [...v.tags, t] };
          }),
        })),
      removeVideoTag: (videoId, tag) =>
        set((s) => ({
          vaultVideos: s.vaultVideos.map((v) =>
            v.id === videoId ? { ...v, tags: v.tags.filter((t) => t !== tag) } : v
          ),
        })),
      addTimedNote: (videoId, time, text) =>
        set((s) => ({
          vaultVideos: s.vaultVideos.map((v) =>
            v.id === videoId
              ? { ...v, notes: [...v.notes, { id: uid(), time, text }].sort((a, b) => a.time - b.time) }
              : v
          ),
        })),
      updateTimedNote: (videoId, noteId, text) =>
        set((s) => ({
          vaultVideos: s.vaultVideos.map((v) =>
            v.id === videoId ? { ...v, notes: v.notes.map((n) => (n.id === noteId ? { ...n, text } : n)) } : v
          ),
        })),
      removeTimedNote: (videoId, noteId) =>
        set((s) => ({
          vaultVideos: s.vaultVideos.map((v) =>
            v.id === videoId ? { ...v, notes: v.notes.filter((n) => n.id !== noteId) } : v
          ),
        })),
      addBookmark: (videoId, time, label, endTime) =>
        set((s) => ({
          vaultVideos: s.vaultVideos.map((v) =>
            v.id === videoId
              ? { ...v, bookmarks: [...v.bookmarks, { id: uid(), time, endTime, label }].sort((a, b) => a.time - b.time) }
              : v
          ),
        })),
      updateBookmark: (videoId, bookmarkId, label) =>
        set((s) => ({
          vaultVideos: s.vaultVideos.map((v) =>
            v.id === videoId ? { ...v, bookmarks: v.bookmarks.map((b) => (b.id === bookmarkId ? { ...b, label } : b)) } : v
          ),
        })),
      removeBookmark: (videoId, bookmarkId) =>
        set((s) => ({
          vaultVideos: s.vaultVideos.map((v) =>
            v.id === videoId ? { ...v, bookmarks: v.bookmarks.filter((b) => b.id !== bookmarkId) } : v
          ),
        })),

      upsertJournalEntry: (e) =>
        set((s) => ({ journal: [e, ...s.journal.filter((x) => x.id !== e.id)] })),
      patchJournalEntry: (id, patch) =>
        set((s) => ({ journal: s.journal.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
      removeJournalEntry: (id) => set((s) => ({ journal: s.journal.filter((x) => x.id !== id) })),
      setJournalTags: (tags) => set({ journalTags: tags }),

      addScoreNode: (n) => {
        const id = uid();
        const now = Date.now();
        set((s) => {
          // a parent that has gone, or a group asked to live inside an exam, puts the new node at the top level
          // instead: what was typed is never lost, and the tree never takes a shape the screens cannot show
          const parent = n.parentId ? s.scores.find((x) => x.id === n.parentId) : undefined;
          const parentId = parent && !(n.kind === 'group' && parent.kind === 'exam') ? parent.id : null;
          return { scores: [...s.scores, withoutUndefined({ ...n, parentId, id, createdAt: now, updatedAt: now }) as ScoreNode] };
        });
        return id;
      },
      patchScoreNode: (id, patch) =>
        set((s) => ({
          scores: s.scores.map((x) => (x.id === id ? (withoutUndefined({ ...x, ...patch, updatedAt: Date.now() }) as ScoreNode) : x)),
        })),
      moveScoreNode: (id, parentId) => {
        const s = get();
        if (!canMove(indexScores(s.scores), id, parentId)) return false;
        set({ scores: s.scores.map((x) => (x.id === id ? { ...x, parentId, updatedAt: Date.now() } : x)) });
        return true;
      },
      removeScoreNode: (id) => {
        const s = get();
        if (!s.scores.some((x) => x.id === id)) return { nodes: [], learnings: [] };
        const gone = descendantIds(indexScores(s.scores), id);
        gone.add(id);
        const nodes = s.scores.filter((x) => gone.has(x.id));
        // an exam's learnings go with it, and come back with it
        const learnings = s.learnings.filter((l) => gone.has(l.nodeId));
        set({
          scores: s.scores.filter((x) => !gone.has(x.id)),
          learnings: learnings.length ? s.learnings.filter((l) => !gone.has(l.nodeId)) : s.learnings,
        });
        return { nodes, learnings };
      },
      restoreScoreNodes: (removed) =>
        set((s) => {
          const have = new Set(s.scores.map((x) => x.id));
          const back = removed.nodes.filter((x) => !have.has(x.id));
          const hasL = new Set(s.learnings.map((l) => l.id));
          const backL = removed.learnings.filter((l) => !hasL.has(l.id));
          if (!back.length && !backL.length) return {};
          // the tree is repaired in case a parent went away in the meantime
          return {
            ...(back.length ? { scores: sanitizeScores([...s.scores, ...back]) } : {}),
            ...(backL.length ? { learnings: [...s.learnings, ...backL] } : {}),
          };
        }),
      duplicateScoreNode: (id) => {
        const copy = duplicateStructure(get().scores, id);
        if (!copy) return null;
        set((s) => ({ scores: [...s.scores, ...copy.nodes] }));
        return copy.rootId;
      },

      addScoreTag: (label, opts) => {
        const name = label.trim().slice(0, 40);
        const s = get();
        const already = s.scoreTags.find((t) => sameTagName(t.label, name));
        if (!name) return '';
        if (already) {
          if (opts?.category && !already.category) {
            // a plain tag of that name becomes the category, and no exam carrying it ends up in two
            set({
              scoreTags: s.scoreTags.map((t) => (t.id === already.id ? { ...t, category: true } : t)),
              scores: promoteToCategory(s.scores, s.scoreTags, already.id).nodes,
            });
          }
          return already.id;
        }
        const tag: ScoreTag = {
          id: uid(), label: name, color: nextTagColor(s.scoreTags), createdAt: Date.now(), ...(opts?.category ? { category: true } : {}),
        };
        set({ scoreTags: [...s.scoreTags, tag] });
        return tag.id;
      },
      patchScoreTag: (id, patch) => {
        const s = get();
        const name = patch.label?.trim().slice(0, 40);
        if (patch.label !== undefined && !name) return false;
        if (name && s.scoreTags.some((t) => t.id !== id && sameTagName(t.label, name))) return false;
        set({
          scoreTags: s.scoreTags.map((t) => {
            if (t.id !== id) return t;
            const next: ScoreTag = { ...t, ...(name ? { label: name } : {}), ...(patch.color ? { color: patch.color } : {}) };
            if (patch.category === true) next.category = true;
            if (patch.category === false) delete next.category;
            return next;
          }),
          // a tag made a category never puts an exam in two categories
          ...(patch.category === true && !s.scoreTags.find((t) => t.id === id)?.category
            ? { scores: promoteToCategory(s.scores, s.scoreTags, id).nodes }
            : {}),
        });
        return true;
      },
      removeScoreTag: (id) => {
        const s = get();
        const index = s.scoreTags.findIndex((t) => t.id === id);
        if (index < 0) return null;
        const removed: RemovedScoreTag = { tag: s.scoreTags[index], index, nodes: {}, learnings: {} };
        for (const n of s.scores) if (n.tags?.includes(id)) removed.nodes[n.id] = [...n.tags];
        for (const l of s.learnings) if (l.tags.includes(id)) removed.learnings[l.id] = [...l.tags];
        set({
          scoreTags: s.scoreTags.filter((t) => t.id !== id),
          scores: s.scores.map((n) => (n.tags?.includes(id) ? { ...n, tags: n.tags.filter((t) => t !== id) } : n)),
          learnings: s.learnings.map((l) => (l.tags.includes(id) ? { ...l, tags: l.tags.filter((t) => t !== id) } : l)),
        });
        return removed;
      },
      restoreScoreTag: ({ tag, index, nodes, learnings }) =>
        set((s) => {
          // a tag of the same name made since takes the links back, so no exam ends up with two of one name
          const same = s.scoreTags.find((t) => t.id === tag.id) || s.scoreTags.find((t) => sameTagName(t.label, tag.label));
          const id = same ? same.id : tag.id;
          const scoreTags = same ? s.scoreTags : insertAt(s.scoreTags, tag, index);
          const category = same ? !!same.category : !!tag.category;
          const categories = new Set(scoreTags.filter((t) => t.category).map((t) => t.id));
          // back at its old place in each list of tags it was on
          const putBack = (tags: string[], before: string[]) => {
            if (tags.includes(id)) return tags;
            const at = before.indexOf(tag.id);
            return insertAt(tags, id, at < 0 ? tags.length : at);
          };
          return {
            scoreTags,
            scores: s.scores.map((n) => {
              const before = nodes[n.id];
              if (!before) return n;
              const tags = n.tags || [];
              // an exam put in another category since stays there: no exam sits in two
              if (category && tags.some((t) => t !== id && categories.has(t))) return n;
              return { ...n, tags: putBack(tags, before) };
            }),
            learnings: s.learnings.map((l) => (learnings[l.id] ? { ...l, tags: putBack(l.tags, learnings[l.id]) } : l)),
          };
        }),
      saveExam: ({ id, parentId, fields, subjects, removeIds }) => {
        const s = get();
        const now = Date.now();
        const examId = id && s.scores.some((x) => x.id === id) ? id : uid();
        const isNew = examId !== id;
        // the subjects taken out go with everything under them, and their learnings, and can come back with an Undo
        const ix = indexScores(s.scores);
        const gone = new Set<string>();
        for (const rid of removeIds) {
          const n = ix.byId.get(rid);
          if (!n || n.parentId !== examId) continue;
          gone.add(rid);
          for (const d of descendantIds(ix, rid)) gone.add(d);
        }
        const removed: RemovedScores = {
          nodes: s.scores.filter((x) => gone.has(x.id)),
          learnings: s.learnings.filter((l) => gone.has(l.nodeId)),
        };
        let scores = s.scores.filter((x) => !gone.has(x.id));
        if (isNew) {
          const parent = parentId ? scores.find((x) => x.id === parentId) : undefined;
          const exam = withoutUndefined({
            ...fields, kind: 'exam', parentId: parent ? parent.id : null, id: examId, createdAt: now, updatedAt: now,
          }) as ScoreNode;
          scores = [...scores, exam];
        } else {
          scores = scores.map((x) => (x.id === examId ? (withoutUndefined({ ...x, ...fields, updatedAt: now }) as ScoreNode) : x));
        }
        const byId = new Map(scores.map((x) => [x.id, x]));
        const added: ScoreNode[] = [];
        subjects.forEach((sub, i) => {
          const patch = { title: sub.title, score: sub.score, outOf: sub.outOf, weight: sub.weight };
          const had = sub.id ? byId.get(sub.id) : undefined;
          if (had && had.parentId === examId) {
            byId.set(had.id, withoutUndefined({ ...had, ...patch, updatedAt: now }) as ScoreNode);
          } else {
            // new subjects keep the order they were typed in: the exam's page lists subjects by when they were made
            added.push(withoutUndefined({
              ...patch, id: uid(), parentId: examId, kind: 'exam', createdAt: now + i, updatedAt: now,
            }) as ScoreNode);
          }
        });
        set({
          scores: [...scores.map((x) => byId.get(x.id) as ScoreNode), ...added],
          ...(removed.learnings.length ? { learnings: s.learnings.filter((l) => !gone.has(l.nodeId)) } : {}),
        });
        return { id: examId, removed };
      },
      setExamCategory: (ids, categoryId) => {
        const s = get();
        const want = new Set(ids);
        const before: Record<string, string[]> = {};
        const now = Date.now();
        const scores = s.scores.map((n) => {
          if (!want.has(n.id) || n.kind !== 'exam') return n;
          before[n.id] = n.tags ? [...n.tags] : [];
          const tags = withCategory(n.tags, categoryId, s.scoreTags);
          const { tags: _drop, ...rest } = n;
          return (tags.length ? { ...rest, tags, updatedAt: now } : { ...rest, updatedAt: now }) as ScoreNode;
        });
        set({ scores });
        return before;
      },
      restoreExamTags: (before) =>
        set((s) => {
          const known = new Set(s.scoreTags.map((t) => t.id));
          return {
            scores: s.scores.map((n) => {
              if (!(n.id in before)) return n;
              const tags = before[n.id].filter((t) => known.has(t));
              const { tags: _drop, ...rest } = n;
              return (tags.length ? { ...rest, tags } : rest) as ScoreNode;
            }),
          };
        }),
      addLearning: ({ nodeId, text, tags }) => {
        const body = text.trim();
        if (!body) return '';
        const id = uid();
        const now = Date.now();
        set((s) => ({ learnings: [...s.learnings, { id, nodeId, text: body, tags: tags || [], createdAt: now, updatedAt: now }] }));
        return id;
      },
      patchLearning: (id, patch) =>
        set((s) => ({
          learnings: s.learnings.map((l) => (l.id === id
            ? {
              ...l,
              ...(patch.text !== undefined ? { text: patch.text.trim() || l.text } : {}),
              ...(patch.tags ? { tags: patch.tags } : {}),
              updatedAt: Date.now(),
            }
            : l)),
        })),
      removeLearning: (id) => {
        const s = get();
        const gone = s.learnings.find((l) => l.id === id) || null;
        if (gone) set({ learnings: s.learnings.filter((l) => l.id !== id) });
        return gone;
      },
      restoreLearnings: (list) =>
        set((s) => {
          const have = new Set(s.learnings.map((l) => l.id));
          const back = list.filter((l) => !have.has(l.id));
          return back.length ? { learnings: [...s.learnings, ...back] } : {};
        }),

      pushCalc: (expr, result) =>
        set((s) => ({ calcHistory: [{ id: uid(), expr, result }, ...s.calcHistory].slice(0, 100) })),
      clearCalcHistory: () => set({ calcHistory: [] }),
      setDesmosState: (json) => {
        if (typeof json !== 'string' || json.length > DESMOS_MAX_CHARS) return false;
        if (get().desmosState !== json) set({ desmosState: json });
        return true;
      },

      trashNote: (id) => {
        if (trashUnsaved()) return null;
        const s = get();
        const index = s.notes.findIndex((n) => n.id === id);
        if (index < 0) return null;
        const note = s.notes[index];
        const item = trashItemOf('note', note, noteTitle(note), s.settings, { index, ownLock: !!note.locked });
        set({ notes: s.notes.filter((n) => n.id !== id), trash: [item, ...s.trash] });
        return item.id;
      },
      trashJournalEntry: (id) => {
        if (trashUnsaved()) return null;
        const s = get();
        const index = s.journal.findIndex((e) => e.id === id);
        if (index < 0) return null;
        const entry = s.journal[index];
        const item = trashItemOf('journal', entry, entryTitle(entry), s.settings, { index });
        set({ journal: s.journal.filter((e) => e.id !== id), trash: [item, ...s.trash] });
        return item.id;
      },
      trashVideo: (id) => {
        if (trashUnsaved()) return null;
        const s = get();
        const index = s.vaultVideos.findIndex((v) => v.id === id);
        if (index < 0) return null;
        const video = s.vaultVideos[index];
        const item = trashItemOf('video', video, firstLine(video.title) || 'Video', s.settings, { index });
        set({ vaultVideos: s.vaultVideos.filter((v) => v.id !== id), trash: [item, ...s.trash] });
        return item.id;
      },
      trashTimedNote: (videoId, id) => {
        if (trashUnsaved()) return null;
        const s = get();
        const v = s.vaultVideos.find((x) => x.id === videoId);
        const index = v ? v.notes.findIndex((n) => n.id === id) : -1;
        if (!v || index < 0) return null;
        const note = v.notes[index];
        const title = firstLine(note.text) || 'Note at ' + fmtMediaTime(note.time);
        const item = trashItemOf('timedNote', note, title, s.settings, { parentId: videoId, index });
        set({
          vaultVideos: s.vaultVideos.map((x) => (x.id === videoId ? { ...x, notes: x.notes.filter((n) => n.id !== id) } : x)),
          trash: [item, ...s.trash],
        });
        return item.id;
      },
      trashBookmark: (videoId, id) => {
        if (trashUnsaved()) return null;
        const s = get();
        const v = s.vaultVideos.find((x) => x.id === videoId);
        const index = v ? v.bookmarks.findIndex((b) => b.id === id) : -1;
        if (!v || index < 0) return null;
        const mark = v.bookmarks[index];
        const title = firstLine(mark.label) || 'Bookmark at ' + fmtMediaTime(mark.time);
        const item = trashItemOf('bookmark', mark, title, s.settings, { parentId: videoId, index });
        set({
          vaultVideos: s.vaultVideos.map((x) => (x.id === videoId ? { ...x, bookmarks: x.bookmarks.filter((b) => b.id !== id) } : x)),
          trash: [item, ...s.trash],
        });
        return item.id;
      },
      trashAttachment: (noteId, attId) => {
        if (trashUnsaved()) return null;
        const s = get();
        const n = s.notes.find((x) => x.id === noteId);
        const index = n ? n.attachments.findIndex((a) => a.id === attId) : -1;
        if (!n || index < 0) return null;
        const att = n.attachments[index];
        // an attachment of a locked note stays behind the PIN, as the note does
        const item = trashItemOf('attachment', att, firstLine(att.name) || 'Attachment', s.settings, {
          parentId: noteId, index, ownLock: !!n.locked,
        });
        set({
          notes: s.notes.map((x) => (x.id === noteId ? { ...x, attachments: x.attachments.filter((a) => a.id !== attId) } : x)),
          trash: [item, ...s.trash],
        });
        return item.id;
      },
      trashHabit: (id) => {
        if (trashUnsaved()) return null;
        const s = get();
        const index = s.habits.findIndex((h) => h.id === id);
        if (index < 0) return null;
        const habit = s.habits[index];
        const item = trashItemOf('habit', habit, firstLine(habit.title) || 'Habit', s.settings, { index });
        set({ habits: s.habits.filter((h) => h.id !== id), trash: [item, ...s.trash] });
        return item.id;
      },
      trashMission: (id) => {
        if (trashUnsaved()) return null;
        const s = get();
        const index = s.missions.findIndex((m) => m.id === id);
        if (index < 0) return null;
        const mission = s.missions[index];
        const item = trashItemOf('mission', mission, firstLine(mission.title) || 'Long-term task', s.settings, { index });
        set({ missions: s.missions.filter((m) => m.id !== id), trash: [item, ...s.trash] });
        return item.id;
      },
      trashExam: (id) => {
        if (trashUnsaved()) return null;
        const s = get();
        const node = s.scores.find((x) => x.id === id);
        if (!node) return null;
        const gone = descendantIds(indexScores(s.scores), id);
        gone.add(id);
        const data: TrashedExam = {
          id,
          nodes: s.scores.filter((x) => gone.has(x.id)),
          learnings: s.learnings.filter((l) => gone.has(l.nodeId)),
        };
        const fallback = node.kind === 'group' ? 'Group' : 'Exam';
        const item = trashItemOf('exam', data, firstLine(node.title) || fallback, s.settings);
        set({
          scores: s.scores.filter((x) => !gone.has(x.id)),
          learnings: data.learnings.length ? s.learnings.filter((l) => !gone.has(l.nodeId)) : s.learnings,
          trash: [item, ...s.trash],
        });
        return item.id;
      },
      restoreFromTrash: (trashId) => {
        const s = get();
        const item = s.trash.find((t) => t.id === trashId);
        // already back (an Undo tapped twice), or gone for good
        if (!item) return 'ok';
        // a collection that did not load this launch is not saved: the item stays here too, so it is never lost on the way
        const trash = blockedRows.has(homeOf(item.kind)) ? s.trash : s.trash.filter((t) => t.id !== trashId);
        const d = item.data;
        if (item.kind === 'note') {
          if (s.notes.some((n) => n.id === d.id)) set({ trash });
          // a folder deleted meanwhile took its notes to General, and so does this one
          else set({ notes: insertAt(s.notes, { ...d, folder: s.noteFolders.includes(d.folder) ? d.folder : 'General' }, item.index), trash });
          return 'ok';
        }
        if (item.kind === 'journal') {
          if (s.journal.some((e) => e.id === d.id)) set({ trash });
          else set({ journal: insertAt(s.journal, d, item.index), trash });
          return 'ok';
        }
        if (item.kind === 'video') {
          if (s.vaultVideos.some((v) => v.id === d.id)) set({ trash });
          else {
            const folderId = d.folderId && s.vaultFolders.some((f) => f.id === d.folderId) ? d.folderId : null;
            set({ vaultVideos: insertAt(s.vaultVideos, { ...d, folderId }, item.index), trash });
          }
          return 'ok';
        }
        if (item.kind === 'habit') {
          if (!s.habits.some((h) => h.id === d.id)) set({ habits: insertAt(s.habits, d, item.index), trash });
          else set({ trash });
          return 'ok';
        }
        if (item.kind === 'mission') {
          if (!s.missions.some((m) => m.id === d.id)) set({ missions: insertAt(s.missions, d, item.index), trash });
          else set({ trash });
          return 'ok';
        }
        if (item.kind === 'exam') {
          const have = new Set(s.scores.map((x) => x.id));
          // already back (its own node is here): nothing of it comes in twice
          if (have.has(d.id)) {
            set({ trash });
            return 'ok';
          }
          const nodes = listOf(d.nodes).filter((x) => !have.has(x.id));
          const hasL = new Set(s.learnings.map((l) => l.id));
          // checked as a load would: a group it sat in that went meanwhile puts it at the top level, a tag deleted
          // meanwhile comes off it
          const scores = sanitizeScores([...s.scores, ...nodes]);
          const learnings = [...s.learnings, ...sanitizeLearnings(listOf(d.learnings).filter((l) => !hasL.has(l?.id)), s.scoreTags)];
          const tied = pruneScoreRefs(scores, s.scoreTags, learnings);
          set({ scores: tied.nodes, learnings: tied.learnings, trash });
          return 'ok';
        }
        if (item.kind === 'timedNote' || item.kind === 'bookmark') {
          const v = s.vaultVideos.find((x) => x.id === item.parentId);
          if (!v) return 'parent-missing';
          const key = item.kind === 'timedNote' ? 'notes' : 'bookmarks';
          const list: { id: string; time: number }[] = v[key];
          if (list.some((x) => x.id === d.id)) set({ trash });
          else {
            const next = [...list, d].sort((a, b) => a.time - b.time);
            set({ vaultVideos: s.vaultVideos.map((x) => (x.id === v.id ? { ...x, [key]: next } : x)), trash });
          }
          return 'ok';
        }
        // an attachment goes back into its note, which must be here
        const n = s.notes.find((x) => x.id === item.parentId);
        if (!n) return 'parent-missing';
        if (n.attachments.some((a) => a.id === d.id)) set({ trash });
        else set({ notes: s.notes.map((x) => (x.id === n.id ? { ...x, attachments: insertAt(x.attachments, d, item.index) } : x)), trash });
        return 'ok';
      },
      deleteFromTrash: (trashId) => {
        const s = get();
        const item = s.trash.find((t) => t.id === trashId);
        if (item) dropForGood(s, [item], set);
      },
      emptyTrash: () => {
        const s = get();
        if (s.trash.length) dropForGood(s, s.trash, set);
      },
      purgeTrash: (now) => {
        const s = get();
        // an item goes on the first day after its 30 days are up, whatever the hour the app opens, so it lasts the whole
        // of the last day Recently deleted counts down ("1 day left")
        const today = todayKey(new Date(now));
        const old = s.trash.filter((t) => !(todayKey(new Date(t.deletedAt + TRASH_KEEP_MS)) >= today));
        if (old.length) dropForGood(s, old, set);
      },

      setTodayLayout: (layout) => set({ todayLayout: cleanTodayLayout(layout) }),
      setTodayColumns: (count, columns) =>
        set((s) => {
          const next = { ...s.todayColumns };
          if (columns) next[String(count)] = columns;
          else delete next[String(count)];
          return { todayColumns: cleanTodayColumns(next) };
        }),

      replaceAll: (data) => {
        const fresh = initialData();
        const next: any = {};
        for (const k of DATA_KEYS) next[k] = (data as any)[k] !== undefined ? (data as any)[k] : fresh[k];
        next.deepWork = null; // an import always ends any running Deep Work session
        set(next);
      },
    }),
    {
      name: STORE_KEY,
      storage: rowStorage,
      version: STORE_VERSION,
      migrate: (persisted: any, version) => migratePersisted(persisted, version),
      // zustand's own shallow merge, plus the one fact the failure handler needs; a setting added since the data was
      // saved takes its default instead of arriving undefined. What 1.7 added is checked on every load, like the exams
      merge: (rawPersisted: any, current) => {
        const persisted = rawPersisted ? sanitizeV6(rawPersisted) : rawPersisted;
        const merged = { ...current, ...(persisted || {}) };
        if (persisted?.settings) merged.settings = cleanSettingsV6({ ...current.settings, ...persisted.settings });
        // a tool in a tab slot is never archived, whatever was saved (archiving arrived with its own default)
        const tabSlots = normaliseSlots(merged.settings.tabSlots);
        merged.settings = { ...merged.settings, tabSlots, archivedTools: normaliseArchived(merged.settings.archivedTools, tabSlots) };
        // with the settings row out, nothing says whether the journal and Notes were locked: they start locked, and open
        // again once this phone is known to have no PIN (see unlockWithoutPin), so a damaged row never lays them open
        if (failedRows.includes('settings')) merged.settings = { ...merged.settings, journalLocked: true, notesLocked: true };
        // the migration only runs the first time after an upgrade; the exam tree is repaired on every load, so a tree
        // damaged after that (a bad import, a half-written save) can never reach a screen
        merged.scores = sanitizeScores(merged.scores);
        merged.scoreTags = sanitizeTags(merged.scoreTags);
        const tied = pruneScoreRefs(merged.scores, merged.scoreTags, sanitizeLearnings(merged.learnings, merged.scoreTags));
        merged.scores = tied.nodes;
        merged.learnings = tied.learnings;
        // marked only once the merge has worked: a merge that throws leaves the app on defaults, which is a failed load
        if (persisted) mergedFromStorage = true;
        return merged;
      },
      // zustand reports a load that throws only here and never marks the store hydrated
      onRehydrateStorage: () => (_state, error) => {
        if (error) void handleHydrationError(error);
      },
    }
  )
);

/**
 * A stand-in store a subtree can read instead of the app's own (the widget gallery's sample data): every `useStore`
 * selector under the provider reads it. Only reads are redirected; `useStore.getState()` is always the app's own.
 */
export const StoreOverride = React.createContext<StoreApi<AppState> | null>(null);

function useAppStore<U = AppState>(selector?: (s: AppState) => U): U {
  const alt = React.useContext(StoreOverride);
  // the override is fixed for a subtree's life, so the hook called is always the same one for a component
  return alt ? useZustand(alt, selector as (s: AppState) => U) : appStore(selector as (s: AppState) => U);
}

export const useStore = Object.assign(useAppStore, appStore) as typeof appStore;

// ---------- accent stays in step with the store (never set during render) ----------
// registered before any component subscribes, so it runs first on every change
useStore.subscribe((s, prev) => {
  if (s.settings.accent !== prev.settings.accent) setAccent(s.settings.accent);
});
useStore.persist.onFinishHydration((s) => setAccent(s.settings.accent));
if (useStore.persist.hasHydrated()) setAccent(useStore.getState().settings.accent);

// ---------- hydration can never strand the app ----------
// The app renders nothing until the saved data has loaded. When reading or migrating it throws
// (unreadable storage, a corrupt row, a migration bug) zustand never marks the store hydrated, so
// the failure is settled here instead. The old single row, when it could be read, is copied aside
// (Settings > Data can share or restore it) and only then does the app render, on defaults; if
// that copy cannot be made, or the rows themselves are what failed, saving pauses for this launch,
// so the defaults never overwrite what is still on disk. A single row that fails is settled while
// reading (readSaved): its collection alone starts fresh and is never saved over.

export const RECOVERY_KEY = pkey('student-hub-v1.recovery');

let loadFailed = false;
let rowUnreadable = false;
/** an import or a restore put data the user chose in place this launch */
let replacedThisLaunch = false;
let settledOnError = false;
let timedOut = false;
let persistPaused = false;
const settledListeners = new Set<() => void>();

/**
 * What the user should be told about this launch's load. The root layout shows it once the intro is gone. A
 * collection that failed on its own comes as 'failed-paused' with its name: it is not saved this launch.
 */
export type LoadNotice = 'late-load' | 'failed-kept' | 'failed-paused';
let pendingNotice: { n: LoadNotice; collections: string[] } | null = null;
const noticeListeners = new Set<(n: LoadNotice, collections: string[]) => void>();

function raiseNotice(n: LoadNotice, collections: string[] = []) {
  if (noticeListeners.size === 0) pendingNotice = { n, collections };
  else noticeListeners.forEach((cb) => cb(n, collections));
}

/**
 * Delivers a notice raised before anyone listened, then every later one as it happens. `collections` names what did
 * not load when only some collections failed ("Notes"); it is empty when the whole load failed.
 */
export function subscribeLoadNotices(cb: (n: LoadNotice, collections: string[]) => void): () => void {
  noticeListeners.add(cb);
  if (pendingNotice) {
    const { n, collections } = pendingNotice;
    pendingNotice = null;
    cb(n, collections);
  }
  return () => {
    noticeListeners.delete(cb);
  };
}
const noopStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

function settleHydration() {
  const listeners = [...settledListeners];
  settledListeners.clear();
  listeners.forEach((cb) => cb());
}

function pausePersistence() {
  if (persistPaused) return;
  persistPaused = true;
  dropPendingSave();
  useStore.persist.setOptions({ storage: noopStorage as any });
}

function resumePersistence() {
  if (!persistPaused) return;
  persistPaused = false;
  useStore.persist.setOptions({ storage: rowStorage });
}

async function handleHydrationError(error: unknown) {
  console.warn('[store] saved data could not be loaded', error);
  // the data loaded and only its write-back failed: it is already in, nothing to rescue
  if (mergedFromStorage) {
    if (timedOut) finishLateLoad();
    settledOnError = true;
    settleHydration();
    return;
  }
  let safe = false;
  if (loadedFrom === 'legacy' && loadFailure !== 'unreadable') {
    // the old single row was read but could not be opened (or moved on): it is copied aside before anything is saved
    try {
      const raw = await AsyncStorage.getItem(LEGACY_KEY);
      if (raw == null) {
        safe = true; // nothing on disk to protect
      } else {
        const kept = await AsyncStorage.getItem(RECOVERY_KEY);
        if (kept == null) {
          await AsyncStorage.setItem(RECOVERY_KEY, raw);
          safe = true;
        } else {
          // an older copy is already kept: never replace it, and never overwrite this row either
          safe = kept === raw;
        }
      }
    } catch {
      safe = false;
    }
  } else if (loadFailure) {
    // storage refused to read the row the load needed (on Android, one grown past about 2 MB), or the meta row is
    // damaged: no restart will read them either, and nothing is saved over them
    rowUnreadable = true;
  }
  if (safe) resumePersistence();
  else pausePersistence();
  loadFailed = true;
  // settled only now, after the copy: nothing may render (and write) before the data is safe
  settledOnError = true;
  settleHydration();
  raiseNotice(safe ? 'failed-kept' : 'failed-paused');
}

// Storage that answered after the wait: its data replaces the defaults the app started on and saving resumes.
// Changes made in that window were never saved, so the user is told instead of finding them gone.
function finishLateLoad() {
  resumePersistence();
  raiseNotice('late-load');
}
useStore.persist.onFinishHydration(() => {
  if (timedOut) finishLateLoad();
  // a collection that could not be loaded on its own is named; the rest of the data is in and saves as usual
  if (failedRows.length) raiseNotice('failed-paused', failedCollections());
  if (failedRows.includes('settings')) unlockWithoutPin();
  // the old single row goes only once the rows have loaded cleanly on a later launch than the one that wrote them
  if (loadedFrom === 'rows' && !failedRows.length) AsyncStorage.removeItem(LEGACY_KEY).catch(() => {});
  settleIfNewDay();
  armMidnight();
});

/**
 * The settings did not load, so the journal and Notes started locked (see merge). No lock is ever set without a PIN, so
 * on a phone with none they open again; when the PIN cannot be asked about, they stay locked this launch.
 */
function unlockWithoutPin() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const lock = require('./lock') as typeof import('./lock');
    lock.pinStatus().then((status) => {
      if (status !== 'none') return;
      const { setSetting } = useStore.getState();
      setSetting('journalLocked', false);
      setSetting('notesLocked', false);
    }).catch(() => {});
  } catch {
    // no lock module here: they stay locked this launch
  }
}

// ---------- a new day ----------
// One-off ToDos ticked on an earlier day go, and what has been in Recently deleted for 30 days goes for good: at launch,
// when the app comes back on a new day, and at midnight while it is open.

let settledDay = '';
let midnightTimer: ReturnType<typeof setTimeout> | null = null;

function settleIfNewDay() {
  // never before the saved data is in: a change made then would be saved over it
  if (!useStore.persist.hasHydrated()) return;
  const today = todayKey();
  if (today === settledDay) return;
  settledDay = today;
  const s = useStore.getState();
  s.settleDay();
  // files are deleted for good only when this launch's data is whole: a collection that did not load may still use them
  if (!loadFailed) s.purgeTrash(Date.now());
}

function armMidnight() {
  if (midnightTimer) clearTimeout(midnightTimer);
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
  midnightTimer = setTimeout(() => {
    midnightTimer = null;
    settleIfNewDay();
    armMidnight();
  }, Math.max(1000, next.getTime() - now.getTime()));
  // a test run in Node is never held open by it
  (midnightTimer as any)?.unref?.();
}

/** True once the saved data has loaded, or its failure to load has been handled. */
export function hydrationSettled(): boolean {
  return useStore.persist.hasHydrated() || settledOnError || timedOut;
}

/** Calls cb once hydration settles (immediately if it already has). Returns an unsubscribe. */
export function onHydrationSettled(cb: () => void): () => void {
  if (hydrationSettled()) {
    cb();
    return () => {};
  }
  settledListeners.add(cb);
  const unsubscribe = useStore.persist.onFinishHydration(() => {
    settledListeners.delete(cb);
    cb();
  });
  return () => {
    settledListeners.delete(cb);
    unsubscribe();
  };
}

/** Last resort when storage never answers: render on defaults and save nothing until it does. */
export function giveUpWaitingForHydration() {
  if (hydrationSettled()) return;
  console.warn('[store] storage did not answer; starting on defaults with saving paused');
  timedOut = true;
  pausePersistence();
  settleHydration();
}

/** The saved data failed to load this launch; the app is running on defaults. */
export const loadFailedThisLaunch = () => loadFailed;
/** The saved row could not even be read this launch (not just parsed): a restart cannot help, a backup can. */
export const savedRowUnreadable = () => rowUnreadable;
/** Saving is paused this launch so nothing overwrites data that could not be loaded. */
export const savingPaused = () => persistPaused;

/**
 * Whether what the app holds is the user's own data, safe to send over a copy kept elsewhere (the cloud): 'failed' when
 * the saved data could not be opened this launch and the app runs on defaults, 'waiting' while it has not loaded yet,
 * 'ok' once it has, or once an import or a restore has put data the user chose in place.
 */
export function localDataState(): 'ok' | 'failed' | 'waiting' {
  if (replacedThisLaunch) return 'ok';
  if (loadFailed) return 'failed';
  if (persistPaused || !(useStore.persist.hasHydrated() || mergedFromStorage)) return 'waiting';
  return 'ok';
}

/** The raw saved blob kept aside when it could not be opened, if any. */
export async function readRecoveryCopy(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(RECOVERY_KEY);
  } catch {
    return null;
  }
}

export async function deleteRecoveryCopy(): Promise<void> {
  try {
    await AsyncStorage.removeItem(RECOVERY_KEY);
  } catch {
    // nothing left to clean up
  }
}

/**
 * The backup format. 4 is 1.7: a ToDo without `repeat` is a one-off, so only an older backup has its ToDos made daily
 * on the way in. Recently deleted rides along, and so does the Desmos graph.
 */
const BACKUP_V = 4;

/** Everything worth backing up, as a plain object. */
export function exportSnapshot() {
  const s = useStore.getState();
  return {
    _app: 'student-hub',
    _v: BACKUP_V,
    _exportedAt: new Date().toISOString(),
    settings: s.settings,
    aiLinks: s.aiLinks,
    quickAccess: s.quickAccess,
    todoReminders: s.todoReminders,
    dailyTasks: s.dailyTasks,
    missions: s.missions,
    lastTriage: s.lastTriage,
    sessions: s.sessions,
    planner: s.planner,
    weekTemplates: s.weekTemplates,
    habits: s.habits,
    notes: s.notes,
    noteFolders: s.noteFolders,
    vaultVideos: s.vaultVideos,
    vaultFolders: s.vaultFolders,
    calcHistory: s.calcHistory,
    journal: s.journal,
    journalTags: s.journalTags,
    scores: s.scores,
    scoreTags: s.scoreTags,
    learnings: s.learnings,
    trash: s.trash,
    desmosState: s.desmosState,
    doneLog: s.doneLog,
    todayLayout: s.todayLayout,
    todayColumns: s.todayColumns,
  };
}

/** A backup that has been read and checked: its data, ready to replace everything, and when it was made if it says. */
export interface ReadSnapshot { data: any; exportedAt: string | null }

/**
 * Reads a backup of any version (its text, or the text already parsed) through the same migration chain as persisted
 * state, changing nothing yet, so a file can be checked and described before anything is replaced. Null when it is not
 * a backup.
 */
export function readSnapshot(input: unknown): ReadSnapshot | null {
  try {
    const data: any = typeof input === 'string' ? JSON.parse(input) : input;
    if (!data || typeof data !== 'object') return null;
    let d: any;
    let exportedAt: string | null = null;
    let fromBefore6 = false;
    if (data._app === 'student-hub') {
      // _safety marks this phone's own copy kept while it followed the cloud (see cloud.ts); it reads as any backup
      const { _app, _exportedAt, _v, _safety, ...rest } = data;
      const v = typeof _v === 'number' ? _v : 0;
      d = v >= 2 ? rest : migrateToGrey(migrateData(rest));
      fromBefore6 = v < BACKUP_V;
      if (typeof _exportedAt === 'string') exportedAt = _exportedAt;
    } else if (data.state && typeof data.state === 'object' && typeof data.version === 'number') {
      // the app's own saved data, such as the copy kept when it could not be opened (migrated to v6 just here)
      d = migratePersisted(data.state, data.version);
    } else {
      return null;
    }
    return { data: migrateV6(migrateV5(d), fromBefore6), exportedAt };
  } catch {
    return null;
  }
}

/** Replaces everything with a backup already read. This phone keeps its own settings (see DEVICE_SETTINGS). */
export function applySnapshot(read: ReadSnapshot): void {
  const own: any = useStore.getState().settings;
  const settings: any = { ...(read.data.settings || {}) };
  for (const k of DEVICE_SETTINGS) if (own[k] !== undefined) settings[k] = own[k];
  // an explicit import replaces everything, so saving resumes even if this launch paused it, and a collection that
  // could not be loaded is saved over by the one the user chose
  resumePersistence();
  blockedRows.clear();
  useStore.getState().replaceAll({ ...read.data, settings });
  // one-off ToDos ticked on an earlier day go, as they would at a launch: this launch has settled its day already, and
  // they would otherwise come back as open until tomorrow
  useStore.getState().settleDay();
  replacedThisLaunch = true;
}

/** Restores a backup of any version (its text, or the text already parsed). False when it is not a backup. */
export function importSnapshot(input: unknown): boolean {
  const read = readSnapshot(input);
  if (!read) return false;
  try {
    applySnapshot(read);
    return true;
  } catch {
    return false;
  }
}

/** Used by the tab bar and settings: the registry's tools, in slot-picker order. */
export const SLOT_TOOLS = TOOLS;
