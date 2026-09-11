import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { uid, todayKey, DayName, DAY_NAMES } from './utils';
import { ThemeMode, AnimLevel, DEFAULT_ACCENT } from './theme';

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
export interface QuickItem { id: string; label: string; icon: string; color: string; kind: 'route' | 'app' | 'url'; target: string }
export interface TodoReminder { id: string; time: string; label: string }

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
  /** the three customizable middle tab slots (Home and More are fixed) */
  tabSlots?: string[];
}

export type PlannerWeek = Record<DayName, PlannerBlock[]>;

const emptyWeek = (): PlannerWeek =>
  Object.fromEntries(DAY_NAMES.map((d) => [d, []])) as PlannerWeek;

const DEFAULT_AI_LINKS: AiLink[] = [
  { id: 'claude', label: 'Claude', url: 'https://claude.ai' },
  { id: 'chatgpt', label: 'ChatGPT', url: 'https://chatgpt.com' },
  { id: 'gemini', label: 'Gemini', url: 'https://gemini.google.com' },
  { id: 'perplexity', label: 'Perplexity', url: 'https://perplexity.ai' },
  { id: 'wolfram', label: 'WolframAlpha', url: 'https://www.wolframalpha.com' },
];

export const DEFAULT_QUICK: QuickItem[] = [
  { id: 'q-notes', label: 'Notes', icon: 'document-text-outline', color: '#8CD9A8', kind: 'route', target: '/notes' },
  { id: 'q-calc', label: 'Calc', icon: 'calculator-outline', color: '#E9BC7A', kind: 'route', target: '/calculator' },
  { id: 'q-vault', label: 'YT Vault', icon: 'play-circle-outline', color: '#E895A5', kind: 'route', target: '/vault' },
  { id: 'q-desmos', label: 'Desmos', icon: 'analytics-outline', color: '#7FD0D6', kind: 'route', target: '/desmos' },
  { id: 'q-ai', label: 'AI', icon: 'sparkles-outline', color: '#B3A3E8', kind: 'route', target: '/ai-links' },
  // slate, matching ROUTE_CATALOG — '#8FB6E8' is the Tasks tile's blue, and a user
  // who removes and re-adds Settings would otherwise watch the colour change on them
  { id: 'q-settings', label: 'Settings', icon: 'settings-outline', color: '#9AA6C0', kind: 'route', target: '/settings' },
];

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

  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  setAiLinks: (links: AiLink[]) => void;
  setQuickAccess: (items: QuickItem[]) => void;
  addTodoReminder: (time: string, label: string) => void;
  removeTodoReminder: (id: string) => void;

  addDaily: (title: string) => void;
  toggleDaily: (id: string) => void;
  removeDaily: (id: string) => void;
  setLastTriage: (dateKey: string) => void;

  addMission: (title: string, deadline: string) => void;
  toggleMission: (id: string) => void;
  removeMission: (id: string) => void;
  addSubtask: (missionId: string, title: string) => void;
  toggleSubtask: (missionId: string, subId: string) => void;
  removeSubtask: (missionId: string, subId: string) => void;

  logSession: (s: Omit<FocusSession, 'id'>) => void;

  addBlock: (day: DayName, b: Omit<PlannerBlock, 'id'>) => void;
  updateBlock: (day: DayName, b: PlannerBlock) => void;
  removeBlock: (day: DayName, id: string) => void;
  copyDay: (from: DayName, to: DayName) => void;
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
  addAttachment: (noteId: string, a: Omit<Attachment, 'id'>) => void;
  /** returns the removed attachment so the caller can delete its file */
  removeAttachment: (noteId: string, attId: string) => Attachment | undefined;

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

  pushCalc: (expr: string, result: string) => void;
  clearCalcHistory: () => void;

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


// v2 -> v3: two-theme grey app; remap old navy-era colours to the grey palette.
const COLOR_REMAP: Record<string, string> = {
  '#8FB6E8': '#8FB6E8', '#8CD9A8': '#8CD9A8', '#E9BC7A': '#E9BC7A',
  '#E895A5': '#E895A5', '#B3A3E8': '#B3A3E8', '#7FD0D6': '#7FD0D6',
};
export function migrateToGrey(old: any): any {
  const out = { ...old };
  const st = { ...(old.settings || {}) };
  st.theme = st.theme === 'minimal' ? 'minimal' : 'default';
  out.settings = st;
  const remap = (c: string) => COLOR_REMAP[c] || c;
  if (Array.isArray(out.quickAccess)) {
    out.quickAccess = out.quickAccess.map((q: any) => ({ ...q, color: remap(q.color) }));
  }
  if (out.planner) {
    for (const d of Object.keys(out.planner)) {
      out.planner[d] = (out.planner[d] || []).map((b: any) => ({ ...b, color: remap(b.color) }));
    }
  }
  if (out.weekTemplates) {
    for (const t of Object.keys(out.weekTemplates)) {
      for (const d of Object.keys(out.weekTemplates[t] || {})) {
        out.weekTemplates[t][d] = (out.weekTemplates[t][d] || []).map((b: any) => ({ ...b, color: remap(b.color) }));
      }
    }
  }
  return out;
}

// ---------- store ----------

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      settings: {
        name: '',
        theme: 'default',
        accent: '#8B7CF8',
        animLevel: 'full',
        hour24: false,
        remindersEnabled: false,
        githubRepo: '',
        todoReminderEnabled: false,
        todoReminderTime: '07:00',
        tabSlots: ['tasks', 'focus', 'planner'],
      },
      aiLinks: DEFAULT_AI_LINKS,
      quickAccess: DEFAULT_QUICK,
      todoReminders: [],
      dailyTasks: [],
      missions: [],
      lastTriage: '',
      sessions: [],
      planner: emptyWeek(),
      weekTemplates: {},
      habits: [],
      notes: [],
      noteFolders: ['General'],
      vaultVideos: [],
      vaultFolders: [],
      calcHistory: [],

      setSetting: (key, value) =>
        set((s) => ({ settings: { ...s.settings, [key]: value } })),
      setAiLinks: (links) => set({ aiLinks: links }),
      setQuickAccess: (items) => set({ quickAccess: items }),
      addTodoReminder: (time, label) =>
        set((s) => ({ todoReminders: [...s.todoReminders, { id: uid(), time, label }] })),
      removeTodoReminder: (id) =>
        set((s) => ({ todoReminders: s.todoReminders.filter((r) => r.id !== id) })),

      addDaily: (title) =>
        set((s) => ({ dailyTasks: [...s.dailyTasks, { id: uid(), title, doneOn: null, createdAt: Date.now() }] })),
      toggleDaily: (id) =>
        set((s) => ({
          dailyTasks: s.dailyTasks.map((t) =>
            t.id === id ? { ...t, doneOn: t.doneOn === todayKey() ? null : todayKey() } : t
          ),
        })),
      removeDaily: (id) => set((s) => ({ dailyTasks: s.dailyTasks.filter((t) => t.id !== id) })),
      setLastTriage: (dateKey) => set({ lastTriage: dateKey }),

      addMission: (title, deadline) =>
        set((s) => ({ missions: [...s.missions, { id: uid(), title, deadline, done: false, subtasks: [] }] })),
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
              attachments: [],
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

      pushCalc: (expr, result) =>
        set((s) => ({ calcHistory: [{ id: uid(), expr, result }, ...s.calcHistory].slice(0, 100) })),
      clearCalcHistory: () => set({ calcHistory: [] }),

      replaceAll: (data) => set(() => ({ ...data })),
    }),
    {
      name: 'student-hub-v1',
      storage: createJSONStorage(() => AsyncStorage),
      version: 4,
      migrate: (persisted: any, version) => {
        let p = version < 2 ? migrateData(persisted) : persisted;
        if (version < 3) p = migrateToGrey(p);
        if (version < 4) {
          p = { ...p, settings: { ...(p?.settings || {}), accent: p?.settings?.accent || DEFAULT_ACCENT } };
        }
        return p;
      },
    }
  )
);

/** Everything worth backing up, as a plain object. */
export function exportSnapshot() {
  const s = useStore.getState();
  return {
    _app: 'student-hub',
    _v: 2,
    _exportedAt: new Date().toISOString(),
    settings: s.settings,
    aiLinks: s.aiLinks,
    quickAccess: s.quickAccess,
    todoReminders: s.todoReminders,
    dailyTasks: s.dailyTasks,
    missions: s.missions,
    sessions: s.sessions,
    planner: s.planner,
    weekTemplates: s.weekTemplates,
    habits: s.habits,
    notes: s.notes,
    noteFolders: s.noteFolders,
    vaultVideos: s.vaultVideos,
    vaultFolders: s.vaultFolders,
  };
}

export function importSnapshot(json: string): boolean {
  try {
    const data = JSON.parse(json);
    if (!data || data._app !== 'student-hub') return false;
    const { _app, _exportedAt, _v, ...rest } = data;
    useStore.getState().replaceAll(_v === 2 ? rest : migrateData(rest));
    return true;
  } catch {
    return false;
  }
}
