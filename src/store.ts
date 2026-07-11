import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { uid, todayKey, DayName, DAY_NAMES } from './utils';
import { GlassIntensity } from './theme';

// ---------- types ----------

export interface DailyTask { id: string; title: string; doneOn: string | null; createdAt: number }
export interface Subtask { id: string; title: string; done: boolean }
export interface Mission { id: string; title: string; deadline: string; done: boolean; subtasks: Subtask[] }
export interface FocusSession { id: string; dateKey: string; endedAt: number; netSeconds: number; taskTitles: string[]; subject?: string }
export interface PlannerBlock { id: string; subject: string; start: string; end: string; color: string }
export interface Habit { id: string; title: string; doneDates: string[]; remindTime?: string }
export interface Note {
  id: string; title: string; body: string; folder: string; tags: string[];
  pinned: boolean; createdAt: number; updatedAt: number; subject?: string;
}
export interface TimedNote { id: string; time: number; text: string }
export interface Bookmark { id: string; time: number; endTime?: number; label: string }
export interface VaultVideo {
  id: string; videoId: string; url: string; title: string; folder: string; tags: string[];
  addedAt: number; notes: TimedNote[]; bookmarks: Bookmark[];
}
export interface AiLink { id: string; label: string; url: string }
export interface CalcEntry { id: string; expr: string; result: string }

export interface Settings {
  name: string;
  glassIntensity: GlassIntensity;
  clockStyle: 'digital' | 'analog';
  hour24: boolean;
  remindersEnabled: boolean;
  githubRepo: string; // "owner/repo" for the update check
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

export interface AppState {
  settings: Settings;
  aiLinks: AiLink[];
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
  vaultFolders: string[];
  calcHistory: CalcEntry[];

  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  setAiLinks: (links: AiLink[]) => void;

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
  deleteNote: (id: string) => void;
  addNoteFolder: (name: string) => void;

  addVideo: (v: { url: string; videoId: string; title: string; folder?: string }) => string;
  updateVideo: (id: string, v: Partial<VaultVideo>) => void;
  deleteVideo: (id: string) => void;
  addVaultFolder: (name: string) => void;
  addTimedNote: (videoId: string, time: number, text: string) => void;
  removeTimedNote: (videoId: string, noteId: string) => void;
  addBookmark: (videoId: string, time: number, label: string, endTime?: number) => void;
  removeBookmark: (videoId: string, bookmarkId: string) => void;

  pushCalc: (expr: string, result: string) => void;
  clearCalcHistory: () => void;

  replaceAll: (data: Partial<AppState>) => void;
}

// ---------- store ----------

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      settings: {
        name: '',
        glassIntensity: 'full',
        clockStyle: 'digital',
        hour24: false,
        remindersEnabled: false,
        githubRepo: '',
      },
      aiLinks: DEFAULT_AI_LINKS,
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
      vaultFolders: ['Inbox'],
      calcHistory: [],

      setSetting: (key, value) =>
        set((s) => ({ settings: { ...s.settings, [key]: value } })),
      setAiLinks: (links) => set({ aiLinks: links }),

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
          planner: {
            ...s.planner,
            [to]: s.planner[from].map((b) => ({ ...b, id: uid() })),
          },
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
      deleteNote: (id) => set((s) => ({ notes: s.notes.filter((x) => x.id !== id) })),
      addNoteFolder: (name) =>
        set((s) => ({
          noteFolders: s.noteFolders.includes(name) ? s.noteFolders : [...s.noteFolders, name],
        })),

      addVideo: (v) => {
        const id = uid();
        set((s) => ({
          vaultVideos: [
            {
              id, videoId: v.videoId, url: v.url, title: v.title, folder: v.folder || 'Inbox',
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
      addVaultFolder: (name) =>
        set((s) => ({
          vaultFolders: s.vaultFolders.includes(name) ? s.vaultFolders : [...s.vaultFolders, name],
        })),
      addTimedNote: (videoId, time, text) =>
        set((s) => ({
          vaultVideos: s.vaultVideos.map((v) =>
            v.id === videoId
              ? { ...v, notes: [...v.notes, { id: uid(), time, text }].sort((a, b) => a.time - b.time) }
              : v
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
      version: 1,
    }
  )
);

/** Everything worth backing up, as a plain object. */
export function exportSnapshot() {
  const s = useStore.getState();
  return {
    _app: 'student-hub',
    _exportedAt: new Date().toISOString(),
    settings: s.settings,
    aiLinks: s.aiLinks,
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
    const { _app, _exportedAt, ...rest } = data;
    useStore.getState().replaceAll(rest);
    return true;
  } catch {
    return false;
  }
}
