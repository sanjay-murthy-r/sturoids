import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState as AppLifecycle } from 'react-native';
import { create } from 'zustand';
import { persist, createJSONStorage, PersistStorage, StorageValue } from 'zustand/middleware';
import { uid, todayKey, DayName, DAY_NAMES } from './utils';
import { ThemeMode, AnimLevel, DEFAULT_ACCENT, setAccent } from './theme';
import { ToolKey, DEFAULT_SLOTS, DEFAULT_ARCHIVED, ROUTE_TO_TOOL, TOOLS, normaliseSlots, normaliseArchived, toolByKey } from './tools';
import {
  ScoreNode, ScoreTag, Learning, sanitizeScores, sanitizeTags, sanitizeLearnings, indexScores, descendantIds,
  canMove, duplicateStructure, nextTagColor, sameTagName, pruneScoreRefs, withCategory, promoteToCategory,
} from './scores';

// ---------- types ----------

export interface DailyTask { id: string; title: string; doneOn: string | null; createdAt: number }
export interface Subtask { id: string; title: string; done: boolean }
export interface Mission { id: string; title: string; deadline: string; done: boolean; subtasks: Subtask[] }
export interface FocusSession { id: string; dateKey: string; endedAt: number; netSeconds: number; taskTitles: string[]; subject?: string }
export interface PlannerBlock { id: string; subject: string; start: string; end: string; color: string }
export interface Habit { id: string; title: string; doneDates: string[]; remindTime?: string }

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
}

export interface AiLink { id: string; label: string; url: string; custom?: boolean }
export interface CalcEntry { id: string; expr: string; result: string }
/**
 * `tool` targets a ToolKey (opens wherever that tool currently lives — its tab
 * slot or its full page); `route` is a plain path (Settings); `url` a website, opened in the default browser.
 * `color` is a palette slot (e.g. 'green') or a literal hex.
 */
export interface QuickItem { id: string; label: string; icon: string; color: string; kind: 'tool' | 'route' | 'url'; target: string }
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

const DEFAULT_AI_LINKS: AiLink[] = [
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

export const DEFAULT_SETTINGS: Settings = {
  name: '',
  theme: 'default',
  accent: DEFAULT_ACCENT,
  animLevel: 'full',
  hour24: false,
  remindersEnabled: false,
  githubRepo: '',
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
  };
}
type DataKey = keyof ReturnType<typeof initialData>;
const DATA_KEYS = Object.keys(initialData()) as DataKey[];

/**
 * Settings that belong to this phone, not to the data: when the app was opened here. They never travel in a backup's
 * fingerprint, a replace keeps this phone's own, and a change to them alone is not a change worth backing up.
 */
export const DEVICE_SETTINGS = ['firstOpenedAt', 'lastOpenedAt'] as const;
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

  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  /** puts tools in the three slots; a tool placed in a slot is restored if it was archived */
  setTabSlots: (slots: ToolKey[]) => void;
  /** false when the tool cannot be archived: it is in a tab slot, or it is Deep Work with a session going */
  setToolArchived: (key: ToolKey, archived: boolean) => boolean;
  setAiLinks: (links: AiLink[]) => void;
  setQuickAccess: (items: QuickItem[]) => void;
  addTodoReminder: (time: string, label: string) => void;
  removeTodoReminder: (id: string) => void;

  addDaily: (title: string) => string;
  toggleDaily: (id: string) => void;
  removeDaily: (id: string) => void;
  /** puts a removed task back at its old place in the list (an undo) */
  restoreDaily: (task: DailyTask, index: number) => void;
  setLastTriage: (dateKey: string) => void;

  addMission: (title: string, deadline: string) => string;
  toggleMission: (id: string) => void;
  removeMission: (id: string) => void;
  addSubtask: (missionId: string, title: string) => void;
  toggleSubtask: (missionId: string, subId: string) => void;
  removeSubtask: (missionId: string, subId: string) => void;

  logSession: (s: Omit<FocusSession, 'id'>) => void;
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

  addHabit: (title: string, remindTime?: string) => void;
  toggleHabitToday: (id: string) => void;
  removeHabit: (id: string) => void;
  setHabitReminder: (id: string, time?: string) => void;

  addNote: (n: Partial<Note>) => string;
  updateNote: (id: string, n: Partial<Note>) => void;
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
  /** the tag goes from the list and from every exam and learning carrying it */
  removeScoreTag: (id: string) => void;
  addLearning: (l: { nodeId: string; text: string; tags?: string[] }) => string;
  patchLearning: (id: string, patch: { text?: string; tags?: string[] }) => void;
  /** returns the learning so an Undo can put it back */
  removeLearning: (id: string) => Learning | null;
  restoreLearnings: (list: Learning[]) => void;

  pushCalc: (expr: string, result: string) => void;
  clearCalcHistory: () => void;

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

/** Whether the data holds anything the user made (a name, tasks, notes, sessions, habits, videos, journal entries). */
export function hasAnyUserData(p: any): boolean {
  const nonEmpty = (a: any) => Array.isArray(a) && a.length > 0;
  return !!(p?.settings?.name) || nonEmpty(p?.dailyTasks) || nonEmpty(p?.missions) || nonEmpty(p?.sessions)
    || nonEmpty(p?.notes) || nonEmpty(p?.habits) || nonEmpty(p?.vaultVideos) || nonEmpty(p?.journal);
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
    if (!['tool', 'route', 'url'].includes(q.kind)) continue;
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
  out.journal = (Array.isArray(p?.journal) ? p.journal : [])
    .filter((e: any) => e && typeof e === 'object' && typeof e.id === 'string' && typeof e.dateKey === 'string')
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

// ---------- persistence ----------

const STORE_KEY = 'student-hub-v1';
/** Set once a load has applied saved state, so a failure after that point is never taken for a failed load. */
let mergedFromStorage = false;
const rawJsonStorage = createJSONStorage<any>(() => AsyncStorage)!;

/**
 * The whole store is saved as one row, so a burst of changes (a note being typed) used to serialise and write all of
 * it on every keystroke, holding up the JS thread each time. A save now waits for a short pause, and the app going
 * to the background writes whatever is waiting at once.
 */
const SAVE_PAUSE_MS = 350;
let pendingSave: { name: string; value: StorageValue<any> } | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Android reads a row back only up to about 2 MB, and its whole database is capped too, so the size of the last save
 * is kept: Settings warns well before the row gets there.
 */
let savedChars: number | null = null;
/** How many characters the last save of the store wrote, or null before the first one this launch. */
export const savedSize = () => savedChars;
/** From here Settings suggests keeping a backup file, long before the row could not be read back. */
export const SAVE_WARN_CHARS = 1.2 * 1024 * 1024;

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

/** Writes a save that is still waiting for its pause. */
export function flushSaves(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const next = pendingSave;
  pendingSave = null;
  if (!next) return;
  let text: string;
  try {
    // stringified once, here, so its size is known
    text = JSON.stringify(next.value);
  } catch {
    setSaveFailing(true);
    return;
  }
  savedChars = text.length;
  Promise.resolve(AsyncStorage.setItem(next.name, text)).then(
    () => setSaveFailing(false),
    () => {
      // kept for the next flush (the next change, or leaving the app), unless a newer save is already waiting or
      // saving has paused since to protect data that could not be read
      if (!pendingSave && !persistPaused) pendingSave = next;
      setSaveFailing(true);
    },
  );
}

/** Forgets a save that is still waiting: saving is pausing to protect data that could not be read. */
function dropPendingSave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  pendingSave = null;
}

const jsonStorage: PersistStorage<any> = {
  // read as text first, so the row's size is known from the launch on, not only after the next save
  getItem: async (name) => {
    const text = await AsyncStorage.getItem(name);
    if (text == null) return null;
    savedChars = text.length;
    return JSON.parse(text);
  },
  setItem: (name, value) => {
    pendingSave = { name, value };
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSaves, SAVE_PAUSE_MS);
  },
  removeItem: (name) => {
    dropPendingSave();
    return rawJsonStorage.removeItem(name);
  },
};

// leaving the app, or closing it from the background, writes whatever is still waiting
AppLifecycle?.addEventListener?.('change', (next) => {
  if (next !== 'active') flushSaves();
});

/** Every persisted-shape migration, oldest first. Also restores the app's own saved blob on import. */
function migratePersisted(persisted: any, version: number): any {
  let p = version < 2 ? migrateData(persisted) : persisted;
  if (version < 3) p = migrateToGrey(p);
  if (version < 4) {
    p = { ...p, settings: { ...(p?.settings || {}), accent: p?.settings?.accent || DEFAULT_ACCENT } };
  }
  if (version < 5) p = migrateV5(p);
  return p;
}

// ---------- store ----------

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      ...initialData(),

      setSetting: (key, value) =>
        set((s) => ({ settings: { ...s.settings, [key]: value } })),
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

      addDaily: (title) => {
        const id = uid();
        set((s) => ({ dailyTasks: [...s.dailyTasks, { id, title, doneOn: null, createdAt: Date.now() }] }));
        return id;
      },
      toggleDaily: (id) =>
        set((s) => ({
          dailyTasks: s.dailyTasks.map((t) =>
            t.id === id ? { ...t, doneOn: t.doneOn === todayKey() ? null : todayKey() } : t
          ),
        })),
      removeDaily: (id) => set((s) => ({ dailyTasks: s.dailyTasks.filter((t) => t.id !== id) })),
      restoreDaily: (task, index) =>
        set((s) => {
          if (s.dailyTasks.some((t) => t.id === task.id)) return {};
          const list = [...s.dailyTasks];
          list.splice(Math.max(0, Math.min(index, list.length)), 0, task);
          return { dailyTasks: list };
        }),
      setLastTriage: (dateKey) => set({ lastTriage: dateKey }),

      addMission: (title, deadline) => {
        const id = uid();
        set((s) => ({ missions: [...s.missions, { id, title, deadline, done: false, subtasks: [] }] }));
        return id;
      },
      toggleMission: (id) =>
        set((s) => ({ missions: s.missions.map((m) => (m.id === id ? { ...m, done: !m.done } : m)) })),
      removeMission: (id) => set((s) => ({ missions: s.missions.filter((m) => m.id !== id) })),
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
      removeSubtask: (missionId, subId) =>
        set((s) => ({
          missions: s.missions.map((m) =>
            m.id === missionId ? { ...m, subtasks: m.subtasks.filter((st) => st.id !== subId) } : m
          ),
        })),

      logSession: (sess) => set((s) => ({ sessions: [...s.sessions, { ...sess, id: uid() }] })),
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

      addHabit: (title, remindTime) =>
        set((s) => ({ habits: [...s.habits, { id: uid(), title, doneDates: [], remindTime }] })),
      toggleHabitToday: (id) =>
        set((s) => ({
          habits: s.habits.map((h) => {
            if (h.id !== id) return h;
            const today = todayKey();
            const has = h.doneDates.includes(today);
            return { ...h, doneDates: has ? h.doneDates.filter((d) => d !== today) : [...h.doneDates, today] };
          }),
        })),
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
      updateNote: (id, n) =>
        set((s) => ({
          notes: s.notes.map((x) => (x.id === id ? { ...x, ...n, updatedAt: Date.now() } : x)),
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
      removeScoreTag: (id) =>
        set((s) => ({
          scoreTags: s.scoreTags.filter((t) => t.id !== id),
          scores: s.scores.map((n) => (n.tags?.includes(id) ? { ...n, tags: n.tags.filter((t) => t !== id) } : n)),
          learnings: s.learnings.map((l) => (l.tags.includes(id) ? { ...l, tags: l.tags.filter((t) => t !== id) } : l)),
        })),
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
      storage: jsonStorage,
      version: 5,
      migrate: (persisted: any, version) => migratePersisted(persisted, version),
      // zustand's own shallow merge, plus the one fact the failure handler needs; a setting added since the data was
      // saved takes its default instead of arriving undefined
      merge: (persisted: any, current) => {
        const merged = { ...current, ...(persisted || {}) };
        if (persisted?.settings) merged.settings = { ...current.settings, ...persisted.settings };
        // a tool in a tab slot is never archived, whatever was saved (archiving arrived with its own default)
        const tabSlots = normaliseSlots(merged.settings.tabSlots);
        merged.settings = { ...merged.settings, tabSlots, archivedTools: normaliseArchived(merged.settings.archivedTools, tabSlots) };
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

// ---------- accent stays in step with the store (never set during render) ----------
// registered before any component subscribes, so it runs first on every change
useStore.subscribe((s, prev) => {
  if (s.settings.accent !== prev.settings.accent) setAccent(s.settings.accent);
});
useStore.persist.onFinishHydration((s) => setAccent(s.settings.accent));
if (useStore.persist.hasHydrated()) setAccent(useStore.getState().settings.accent);

// ---------- hydration can never strand the app ----------
// The app renders nothing until the saved data has loaded. When reading or migrating the saved
// blob throws (unreadable storage, a corrupt blob, a migration bug) zustand never marks the store
// hydrated, so the failure is settled here instead: the raw blob is copied aside (Settings > Data
// can share or restore it) and only then does the app render, on defaults. If that copy cannot be
// made, saving pauses for this launch, so the defaults never overwrite the blob still on disk.

export const RECOVERY_KEY = 'student-hub-v1.recovery';

let loadFailed = false;
let rowUnreadable = false;
/** an import or a restore put data the user chose in place this launch */
let replacedThisLaunch = false;
let settledOnError = false;
let timedOut = false;
let persistPaused = false;
const settledListeners = new Set<() => void>();

/** What the user should be told about this launch's load. The root layout shows it once the intro is gone. */
export type LoadNotice = 'late-load' | 'failed-kept' | 'failed-paused';
let pendingNotice: LoadNotice | null = null;
const noticeListeners = new Set<(n: LoadNotice) => void>();

function raiseNotice(n: LoadNotice) {
  if (noticeListeners.size === 0) pendingNotice = n;
  else noticeListeners.forEach((cb) => cb(n));
}

/** Delivers a notice raised before anyone listened, then every later one as it happens. */
export function subscribeLoadNotices(cb: (n: LoadNotice) => void): () => void {
  noticeListeners.add(cb);
  if (pendingNotice) {
    const n = pendingNotice;
    pendingNotice = null;
    cb(n);
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
  useStore.persist.setOptions({ storage: jsonStorage });
}

async function handleHydrationError(error: unknown) {
  console.warn('[store] saved data could not be loaded', error);
  // the blob loaded and only its write-back failed: the data is already in, nothing to rescue
  if (mergedFromStorage) {
    if (timedOut) finishLateLoad();
    settledOnError = true;
    settleHydration();
    return;
  }
  let safe = false;
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(STORE_KEY);
  } catch {
    // the row itself cannot be read (on Android, one grown past about 2 MB): no restart will read it either
    rowUnreadable = true;
  }
  try {
    if (rowUnreadable) throw new Error('unreadable');
    if (raw == null) {
      safe = true; // nothing on disk to protect
    } else {
      const kept = await AsyncStorage.getItem(RECOVERY_KEY);
      if (kept == null) {
        await AsyncStorage.setItem(RECOVERY_KEY, raw);
        safe = true;
      } else {
        // an older copy is already kept: never replace it, and never overwrite this blob either
        safe = kept === raw;
      }
    }
  } catch {
    safe = false;
  }
  if (safe) resumePersistence();
  else pausePersistence();
  loadFailed = true;
  // settled only now, after the copy: nothing may render (and write) before the blob is safe
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
});

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

/** Everything worth backing up, as a plain object. */
export function exportSnapshot() {
  const s = useStore.getState();
  return {
    _app: 'student-hub',
    _v: 3,
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
    if (data._app === 'student-hub') {
      const { _app, _exportedAt, _v, ...rest } = data;
      d = _v === 2 || _v === 3 ? rest : migrateToGrey(migrateData(rest));
      if (typeof _exportedAt === 'string') exportedAt = _exportedAt;
    } else if (data.state && typeof data.state === 'object' && typeof data.version === 'number') {
      // the app's own saved blob, such as the copy kept when it could not be opened
      d = migratePersisted(data.state, data.version);
    } else {
      return null;
    }
    return { data: migrateV5(d), exportedAt };
  } catch {
    return null;
  }
}

/** Replaces everything with a backup already read. This phone keeps its own settings (see DEVICE_SETTINGS). */
export function applySnapshot(read: ReadSnapshot): void {
  const own: any = useStore.getState().settings;
  const settings: any = { ...(read.data.settings || {}) };
  for (const k of DEVICE_SETTINGS) if (own[k] !== undefined) settings[k] = own[k];
  // an explicit import replaces everything, so saving resumes even if this launch paused it
  resumePersistence();
  useStore.getState().replaceAll({ ...read.data, settings });
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
