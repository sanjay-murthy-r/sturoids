import React from 'react';
import { InteractionManager, Linking } from 'react-native';
import { router } from 'expo-router';
import { useStore, DailyTask, Mission, PlannerBlock, Habit, Note, JournalEntry, VaultVideo, FocusSession, AiLink, CalcEntry, TrashItem } from '../store';
import { TOOLS, ToolKey, colorOf, normaliseArchived, normaliseSlots, toolByKey } from '../tools';
import { openPage, openTool } from '../toolNav';
import { runAction } from '../actions';
import { markFreshNote } from '../freshNotes';
import { openReport } from '../reports';
import { openScoreNode } from '../scoresNav';
import { DAY_NAMES, DayName, daysLabel, fmtClockTime, fmtMediaTime, fmtShortDate, toMinutes, todayKey } from '../utils';
import { formatJournalDate, readBody, requestJournalOpen } from '../journal';
import { useOpen } from '../lock';
import { useProfiles, profileName, activeProfile, ProfileInfo } from '../profiles';
import { ScoreNode, ScoreTag, Learning, fmtExamDate } from '../scores';
import { subjectsOf, Subject } from '../subjects';
import { toast } from '../components/Toast';
import { SearchDoc, SearchIndex } from './engine';
import { SETTINGS_INDEX, SETTINGS_PAGE_TITLES, SettingRow, SettingsPage, isPageRow } from './settingsIndex';
import type { SiftScope, SiftScopes } from './store';

// What Sift searches: documents built from the store, the settings index and the profiles' registry, each with its
// kind, its section, its icon and where it opens. A locked tool's content and an archived tool's content are left out
// (the overlay offers one row to unlock or restore instead); a locked note's text is never read.

export interface SiftPayload {
  icon: string;
  color?: string;
  /** where it goes: Sift has already started closing when this runs */
  open: () => void;
}

export type SiftDoc = SearchDoc<SiftPayload>;

/** The sections, and the scope chip each belongs to. */
export const SECTION_SCOPE: Record<string, SiftScope> = {
  Tools: 'all', Actions: 'all', Settings: 'settings', ToDos: 'todos', Tasks: 'todos', Planner: 'all', Habits: 'all',
  Notes: 'notes', Journal: 'journal', Vault: 'vault', Scores: 'scores', Subjects: 'scores', 'Deep Work': 'all',
  'AI links': 'all', Calculator: 'all', 'Recently deleted': 'all', Profiles: 'all',
};

/** Whether a section is among the filters chosen (none chosen is everything). */
export const inScope = (section: string, scopes: SiftScopes) =>
  !scopes.length || (scopes as readonly string[]).includes(SECTION_SCOPE[section] as string);

/** Extra words a tool is found by. */
const TOOL_WORDS: Partial<Record<ToolKey, string>> = {
  tasks: 'todo todos list checklist missions deadlines long-term',
  focus: 'deep work pomodoro timer session study',
  planner: 'timetable schedule week blocks habits streaks',
  notes: 'note write folder',
  journal: 'diary day write mood',
  scores: 'marks exams results grades tests analytics',
  calculator: 'calc maths sum',
  desmos: 'graph plot maths',
  vault: 'youtube video lectures library',
  ai: 'chatgpt claude gemini perplexity assistant',
};

const PAGE_ICON: Record<SettingsPage, string> = {
  account: 'cloud-outline', appearance: 'color-palette-outline', tools: 'apps-outline', motion: 'sparkles-outline',
  time: 'time-outline', deepwork: 'timer-outline', privacy: 'lock-closed-outline', backup: 'archive-outline',
  trash: 'trash-bin-outline', updates: 'cloud-download-outline', delete: 'trash-outline',
};

const TRASH_LABEL: Record<string, [string, string, string]> = {
  note: ['document-text-outline', 'Note', 'Locked note'],
  journal: ['journal-outline', 'Journal entry', 'Locked entry'],
  video: ['play-circle-outline', 'Video', 'Locked video'],
  timedNote: ['chatbox-ellipses-outline', 'Note on a video', 'Locked note'],
  bookmark: ['bookmark-outline', 'Bookmark', 'Locked bookmark'],
  attachment: ['attach-outline', 'Attachment', 'Locked attachment'],
  habit: ['flame-outline', 'Habit', 'Habit'],
  mission: ['flag-outline', 'Long-term task', 'Long-term task'],
  exam: ['ribbon-outline', 'Exam', 'Exam'],
};

/* ---------------------------------------------------------------- the static documents */

const toolDocs = (archived: ToolKey[]): SiftDoc[] => TOOLS.filter((t) => !archived.includes(t.key)).map((t) => ({
  key: 'tool:' + t.key, kind: 'tool', section: 'Tools', title: t.label, subtitle: t.desc,
  meta: t.shortLabel + ' ' + (TOOL_WORDS[t.key] ?? ''),
  payload: { icon: t.icon, color: colorOf(t.colorKey), open: () => openTool(t.key) },
}));

/** What can be done from Sift by name; an archived tool's actions are left out with it. */
function actionDocs(archived: ToolKey[]): SiftDoc[] {
  const tool = (key: ToolKey) => toolByKey(key)!;
  const act = (id: string, title: string, meta: string, icon: string, color: string, open: () => void, subtitle?: string, of?: ToolKey): SiftDoc | null => (of && archived.includes(of) ? null : {
    key: 'action:' + id, kind: 'action', section: 'Actions', title, subtitle, meta, payload: { icon, color, open },
  });
  return [
    act('new-note', 'New note', 'write create add note', 'create-outline', colorOf(tool('notes').colorKey), () => newNote(''), 'Notes', 'notes'),
    act('add-todo', 'Add a ToDo', 'new task todo create', 'add-circle-outline', colorOf(tool('tasks').colorKey), () => runAction('add-todo'), 'Tasks', 'tasks'),
    act('start-focus', 'Start Deep Work', 'focus session timer begin pomodoro', 'play-outline', colorOf(tool('focus').colorKey), () => runAction('start-focus'), 'Deep Work', 'focus'),
    act('log-session', 'Log a session', 'focus history add manual record', 'add-outline', colorOf(tool('focus').colorKey), () => openPage('/focus-history'), 'Deep Work', 'focus'),
    act('focus-history', 'Focus history', 'sessions deep work past streak month', 'stats-chart-outline', colorOf(tool('focus').colorKey), () => openPage('/focus-history'), 'Deep Work', 'focus'),
    act('new-exam', 'Add an exam', 'new exam test mock score marks', 'ribbon-outline', colorOf(tool('scores').colorKey), () => openPage('/exam'), 'Scores', 'scores'),
    act('write-journal', "Write today's page", 'journal diary today write', 'journal-outline', colorOf(tool('journal').colorKey), () => openTool('journal'), 'Journal', 'journal'),
    act('journal-archive', 'Journal archive', 'past entries calendar journal all pages', 'calendar-outline', colorOf(tool('journal').colorKey), () => openPage('/journal/archive'), 'Journal', 'journal'),
    act('add-video', 'Add a video', 'youtube vault lecture paste link', 'logo-youtube', colorOf(tool('vault').colorKey), () => openTool('vault'), 'YT Vault', 'vault'),
    act('settings', 'Settings', 'preferences options configure', 'settings-outline', colorOf('slate'), () => openPage('/settings')),
    act('progress-report', 'Reports & exports', 'export pdf csv summary report progress share print week month term habits todos deep work scores journal', 'document-text-outline', colorOf('accent'), openReport),
  ].filter((d): d is SiftDoc => d !== null);
}

/** Settings rows of a tool's own, opened in that tool; an archived tool's rows are left out. */
function toolSettingDocs(archived: ToolKey[]): SiftDoc[] {
  const row = (id: string, title: string, under: ToolKey, meta: string, icon: string, open: () => void): SiftDoc => ({
    key: 'setting:' + id, kind: 'setting', section: 'Settings', title, subtitle: toolByKey(under)?.label, meta,
    tags: toolByKey(under)?.label, payload: { icon, color: colorOf(toolByKey(under)?.colorKey), open },
  });
  return [
    row('planner:templates', 'Week templates', 'planner', 'template week save apply timetable', 'albums-outline', () => openTool('planner', { sheet: 'templates' })),
    row('tasks:reminders', 'ToDo reminders', 'tasks', 'todo nudge reminder bell notification', 'notifications-outline', () => openTool('tasks', { sheet: 'reminders' })),
    row('journal:settings', 'Journal settings', 'journal', 'prompts word goal reminder cutoff check-out', 'options-outline', () => openTool('journal', { sheet: 'settings' })),
  ].filter((d) => !archived.some((k) => d.tags === toolByKey(k)?.label));
}

const settingDoc = (r: SettingRow): SiftDoc => ({
  key: 'setting:' + r.id, kind: 'setting', section: 'Settings', title: r.label,
  subtitle: isPageRow(r) ? 'Settings' : SETTINGS_PAGE_TITLES[r.page] + (r.caption ? ' · ' + r.caption : ''),
  tags: SETTINGS_PAGE_TITLES[r.page], meta: [r.caption, r.keywords].filter(Boolean).join(' '),
  payload: {
    icon: PAGE_ICON[r.page], color: r.page === 'delete' ? colorOf('danger') : colorOf('slate'),
    open: () => openPage('/settings', isPageRow(r) ? { page: r.page } : { page: r.page, row: r.id }),
  },
});

/* ---------------------------------------------------------------- opening */

/** A new note, titled (or empty), opened. */
export function newNote(title: string) {
  const id = useStore.getState().addNote({ title: title.trim() });
  // a note nobody writes in goes again when its page closes
  markFreshNote(id);
  router.push({ pathname: '/notes/[id]', params: { id } }, { dangerouslySingular: true });
}

/** A query as a new ToDo, with an Undo. */
export function addTodo(title: string) {
  const t = title.trim();
  if (!t) return;
  const id = useStore.getState().addDaily(t);
  toast('Added to ToDos', {
    label: 'Undo',
    onPress: () => { useStore.getState().removeDaily(id); },
  });
}

const openNote = (id: string) => router.push({ pathname: '/notes/[id]', params: { id } }, { dangerouslySingular: true });
// a moment asked for carries a new nonce, so a player already open sees it as a new ask and goes there again
const openVideo = (id: string, t?: number) =>
  router.push({
    pathname: '/vault/[id]',
    params: t != null ? { id, t: String(Math.floor(t)), n: Date.now().toString(36) } : { id },
  }, { dangerouslySingular: true });
const openScores = (id: string) => { openScoreNode(id); openTool('scores'); };

/* ---------------------------------------------------------------- the store's documents */

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const firstLine = (s: string) => (s || '').split('\n')[0].trim();

/** The texts of journal entries, read in small batches once Sift opens: id → the entry's updatedAt and text. */
const journalBodies = new Map<string, { u: number; body: string }>();

interface Ctx {
  hour24: boolean;
  folderName: Map<string, string>;
  scoreById: Map<string, ScoreNode>;
  tagLabel: Map<string, ScoreTag>;
}

function todoDoc(t: DailyTask): SiftDoc {
  const days = (t as DailyTask & { days?: number[] }).days;
  const when = t.repeat === 'daily' ? (days && days.length ? daysLabel(days) : 'Every day') : 'ToDo';
  return {
    key: 'todo:' + t.id, kind: 'todo', section: 'ToDos', title: t.title,
    subtitle: [when, t.time ? 'by ' + t.time : '', t.doneOn ? 'Done' : ''].filter(Boolean).join(' · '),
    at: t.createdAt,
    payload: { icon: t.doneOn ? 'checkmark-circle-outline' : 'ellipse-outline', color: colorOf('slate'), open: () => openTool('tasks', { item: t.id }) },
  };
}

function missionDocs(m: Mission): SiftDoc[] {
  const open = () => openTool('tasks', { list: 'missions', item: m.id });
  const done = m.subtasks.filter((s) => s.done).length;
  const out: SiftDoc[] = [{
    key: 'task:' + m.id, kind: 'task', section: 'Tasks', title: m.title,
    subtitle: [m.done ? 'Done' : 'Due ' + fmtShortDate(m.deadline), m.subtasks.length ? done + ' of ' + m.subtasks.length + ' steps' : '']
      .filter(Boolean).join(' · '),
    meta: m.deadline,
    payload: { icon: m.done ? 'checkmark-done-outline' : 'flag-outline', color: colorOf('slate'), open },
  }];
  for (const s of m.subtasks) {
    out.push({
      key: 'step:' + m.id + ':' + s.id, kind: 'step', section: 'Tasks', title: s.title, subtitle: 'Step of ' + m.title,
      payload: { icon: s.done ? 'checkmark-outline' : 'remove-outline', color: colorOf('slate'), open },
    });
  }
  return out;
}

function blockDoc(b: PlannerBlock, day: DayName, ctx: Ctx): SiftDoc {
  const t = (hhmm: string) => fmtClockTime(toMinutes(hhmm), ctx.hour24);
  return {
    key: 'block:' + day + ':' + b.id, kind: 'block', section: 'Planner', title: b.subject || 'Block',
    subtitle: day + ' · ' + t(b.start) + '–' + t(b.end), meta: day,
    payload: { icon: 'time-outline', color: b.color || colorOf('teal'), open: () => openTool('planner', { day, item: b.id }) },
  };
}

const habitDoc = (h: Habit): SiftDoc => ({
  key: 'habit:' + h.id, kind: 'habit', section: 'Habits', title: h.title,
  subtitle: ['Habit', h.days && h.days.length ? daysLabel(h.days) : '', h.remindTime ? 'at ' + h.remindTime : ''].filter(Boolean).join(' · '),
  payload: { icon: 'flame-outline', color: colorOf('teal'), open: () => openTool('planner', { item: h.id }) },
});

function noteDoc(n: Note): SiftDoc {
  const tags = [n.folder, n.subject, ...(n.tags || [])].filter(Boolean).join(' ');
  return {
    key: 'note:' + n.id, kind: 'note', section: 'Notes', title: n.title.trim() || 'Untitled note',
    // the day it was edited on the phone's own calendar (the ISO date is UTC's, a day off in the small hours), and nothing
    // for a note whose time is missing or broken, which would otherwise throw and take the whole index down
    subtitle: [n.folder, Number.isFinite(n.updatedAt) ? fmtShortDate(todayKey(new Date(n.updatedAt))) : ''].filter(Boolean).join(' · '),
    tags,
    // a locked note's text is never indexed
    body: n.locked ? undefined : n.body,
    meta: n.attachments?.map((a) => a.name).join(' '),
    at: n.updatedAt,
    payload: { icon: n.locked ? 'lock-closed-outline' : n.pinned ? 'pin-outline' : 'document-text-outline', color: colorOf('green'), open: () => openNote(n.id) },
  };
}

function journalDoc(e: JournalEntry): SiftDoc {
  const cached = journalBodies.get(e.id);
  // a text that could not be read (readBody answers '') leaves the excerpt to be found by
  const body = cached && cached.u === e.updatedAt && cached.body ? cached.body : e.excerpt;
  const date = formatJournalDate(e.dateKey);
  // found by its weekday and month, never by its numbers: "10" or "24" would otherwise match every entry of a month (a
  // date typed in full finds the day through the day card, and an untitled entry carries its date as its title)
  const dateWords = date.replace(/\d+/g, '');
  return {
    key: 'journal:' + e.id, kind: 'journal', section: 'Journal', title: e.title.trim() || date,
    subtitle: e.title.trim() ? date : e.wordCount ? e.wordCount + (e.wordCount === 1 ? ' word' : ' words') : 'Journal',
    tags: (e.tags || []).join(' '), body, meta: dateWords, at: e.updatedAt,
    payload: {
      icon: 'journal-outline', color: colorOf('gold'),
      open: () => { requestJournalOpen(e.dateKey, e.id); openTool('journal'); },
    },
  };
}

function videoDocs(v: VaultVideo, ctx: Ctx): SiftDoc[] {
  const folder = v.folderId ? ctx.folderName.get(v.folderId) : undefined;
  const out: SiftDoc[] = [{
    key: 'video:' + v.id, kind: 'video', section: 'Vault', title: v.title || 'Video',
    subtitle: v.resumeAt ? 'Left at ' + fmtMediaTime(v.resumeAt) : folder || 'YT Vault',
    tags: [folder, ...(v.tags || [])].filter(Boolean).join(' '), at: v.openedAt || v.addedAt,
    payload: { icon: 'play-circle-outline', color: colorOf('pink'), open: () => openVideo(v.id, v.resumeAt) },
  }];
  for (const n of v.notes || []) {
    out.push({
      key: 'timed:' + v.id + ':' + n.id, kind: 'timed', section: 'Vault', title: clip(firstLine(n.text) || 'Note', 90),
      subtitle: fmtMediaTime(n.time) + ' · ' + (v.title || 'Video'), body: n.text,
      payload: { icon: 'chatbox-ellipses-outline', color: colorOf('pink'), open: () => openVideo(v.id, n.time) },
    });
  }
  for (const b of v.bookmarks || []) {
    out.push({
      key: 'bookmark:' + v.id + ':' + b.id, kind: 'bookmark', section: 'Vault', title: b.label || 'Bookmark',
      subtitle: fmtMediaTime(b.time) + ' · ' + (v.title || 'Video'),
      payload: { icon: 'bookmark-outline', color: colorOf('pink'), open: () => openVideo(v.id, b.time) },
    });
  }
  return out;
}

function scoreDoc(n: ScoreNode, ctx: Ctx): SiftDoc {
  const parent = n.parentId ? ctx.scoreById.get(n.parentId) : undefined;
  const subject = n.kind === 'exam' && parent?.kind === 'exam';
  const kind = n.kind === 'group' ? 'group' : subject ? 'subject' : 'exam';
  const pct = n.score != null && n.outOf ? Math.round((n.score / n.outOf) * 1000) / 10 + '%' : '';
  const tags = (n.tags || []).map((id) => ctx.tagLabel.get(id)?.label).filter(Boolean).join(' ');
  return {
    key: 'score:' + n.id, kind, section: 'Scores', title: n.title || 'Untitled',
    subtitle: [
      kind === 'group' ? 'Group' : subject ? 'In ' + (parent?.title || 'an exam') : n.date ? fmtExamDate(n.date) : 'Exam', pct,
    ].filter(Boolean).join(' · '),
    tags, meta: [n.grade, n.note, n.date].filter(Boolean).join(' '), at: n.updatedAt,
    payload: { icon: kind === 'group' ? 'folder-outline' : 'ribbon-outline', color: colorOf('accent'), open: () => openScores(n.id) },
  };
}

function learningDoc(l: Learning, ctx: Ctx): SiftDoc {
  const node = ctx.scoreById.get(l.nodeId);
  return {
    key: 'learning:' + l.id, kind: 'learning', section: 'Scores', title: clip(firstLine(l.text) || 'Learning', 90),
    subtitle: 'Learning' + (node ? ' · ' + node.title : ''), body: l.text,
    tags: (l.tags || []).map((id) => ctx.tagLabel.get(id)?.label).filter(Boolean).join(' '), at: l.updatedAt,
    payload: { icon: 'bulb-outline', color: colorOf('accent'), open: () => openScores(l.nodeId) },
  };
}

const scoreTagDoc = (t: ScoreTag): SiftDoc => ({
  key: 'scoretag:' + t.id, kind: 'tag', section: 'Scores', title: t.label, subtitle: t.category ? 'Exam category' : 'Tag',
  payload: {
    icon: t.category ? 'albums-outline' : 'pricetag-outline', color: t.color,
    open: () => openTool('scores', { view: t.category ? 'analytics' : 'notebook' }),
  },
});

function sessionDoc(s: FocusSession, ctx: Ctx): SiftDoc {
  const min = Math.round(s.netSeconds / 60);
  return {
    key: 'session:' + s.id, kind: 'session', section: 'Deep Work', title: s.subject?.trim() || 'Focus session',
    subtitle: fmtShortDate(s.dateKey) + ' · ' + min + ' min' + (s.endedAt ? ' · ' + fmtClockTime(new Date(s.endedAt).getHours() * 60 + new Date(s.endedAt).getMinutes(), ctx.hour24) : ''),
    // a session is found by its tags, its tasks and its note as well as its subject
    tags: [...(s.tags || []), ...(s.taskTitles || [])].join(' '), meta: [s.dateKey, s.note || ''].join(' '), at: s.endedAt,
    payload: { icon: 'timer-outline', color: colorOf('accent'), open: () => openPage('/focus-history', { session: s.id }) },
  };
}

function aiDoc(a: AiLink): SiftDoc {
  let host = '';
  try { host = a.url.replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, ''); } catch { /* shown without it */ }
  return {
    key: 'ai:' + a.id, kind: 'ai', section: 'AI links', title: a.label, subtitle: host, meta: a.url,
    payload: { icon: 'sparkles-outline', color: colorOf('accent'), open: () => { Linking.openURL(a.url).catch(() => toast("Couldn't open that link")); } },
  };
}

const calcDoc = (c: CalcEntry): SiftDoc => ({
  key: 'calc:' + c.id, kind: 'calc', section: 'Calculator', title: c.expr + ' = ' + c.result, subtitle: 'Calculator history',
  payload: { icon: 'calculator-outline', color: colorOf('amber'), open: () => openTool('calculator', { expr: c.expr }) },
});

function trashDoc(t: TrashItem, notesLocked = false, journalLocked = false): SiftDoc {
  const [icon, label, lockedLabel] = TRASH_LABEL[t.kind] ?? ['trash-outline', 'Item', 'Locked item'];
  // an item of a tool that is locked right now is as hidden as one locked itself
  const hidden = t.locked || (notesLocked && (t.kind === 'note' || t.kind === 'attachment')) || (journalLocked && t.kind === 'journal');
  return {
    // a locked item is found by what it is, never by its title
    key: 'trash:' + t.id, kind: 'trash', section: 'Recently deleted', title: hidden ? lockedLabel : t.title || label,
    subtitle: 'In Recently deleted · Restore', meta: label + ' deleted trash', at: t.deletedAt,
    payload: { icon, color: colorOf('danger'), open: () => openPage('/settings', { page: 'trash' }) },
  };
}

const profileDoc = (p: ProfileInfo): SiftDoc => ({
  key: 'profile:' + p.id, kind: 'profile', section: 'Profiles', title: 'Switch to ' + profileName(p),
  subtitle: 'Profile', meta: [p.name, (p as ProfileInfo & { email?: string }).email, 'profile switch account'].filter(Boolean).join(' '),
  payload: { icon: 'people-outline', color: colorOf('accent'), open: () => openPage('/settings', { page: 'account' }) },
});

const subjectDoc = (s: Subject): SiftDoc => ({
  key: 'subject:' + s.key, kind: 'subjectpage', section: 'Subjects', title: s.name,
  subtitle: 'Subject · ' + s.uses + (s.uses === 1 ? ' use' : ' uses'),
  payload: { icon: 'school-outline', color: colorOf('accent'), open: () => openPage('/subject', { key: s.key, name: s.name }) },
});

/* ---------------------------------------------------------------- the index, kept while the app runs */

const index = new SearchIndex<SiftPayload>();
let staticDone = false;
/** the one source of a collection that is a single list of documents, set again when its version changes */
const ONE = [0];
/** the inputs of the subjects, one object replaced only when one of them changes, so the collection holds them once */
let subjectSrc: { sessions: unknown; notes: unknown; planner: unknown; scores: unknown } | null = null;

/** The keys of the collections a tool's content lives in, which leave the index while it is archived or locked. */
const TOOL_COLLECTIONS: Partial<Record<ToolKey, string[]>> = {
  tasks: ['todos', 'missions'],
  planner: ['blocks', 'habits'],
  notes: ['notes', 'folders'],
  journal: ['journal', 'journalTags'],
  vault: ['videos'],
  scores: ['scores', 'learnings', 'scoreTags'],
  focus: ['sessions'],
  ai: ['ai'],
  calculator: ['calc'],
};

export interface SiftSources {
  index: SearchIndex<SiftPayload>;
  /** changes whenever the index does, so results are worked out again */
  rev: number;
  /** the journal's texts are still being read */
  journalLoading: boolean;
  notesLocked: boolean;
  journalLocked: boolean;
  archived: ToolKey[];
  subjects: Subject[];
}

/**
 * Keeps the index in step with the store while Sift is open (`active`). Each collection is set from its own slice, so
 * a change to one re-indexes that one; nothing runs while Sift is closed.
 */
export function useSiftSources(active: boolean): SiftSources {
  const s = useStore;
  const dailyTasks = s((x) => x.dailyTasks);
  const missions = s((x) => x.missions);
  const planner = s((x) => x.planner);
  const habits = s((x) => x.habits);
  const notes = s((x) => x.notes);
  const noteFolders = s((x) => x.noteFolders);
  const journal = s((x) => x.journal);
  const journalTags = s((x) => x.journalTags);
  const videos = s((x) => x.vaultVideos);
  const vaultFolders = s((x) => x.vaultFolders);
  const scores = s((x) => x.scores);
  const scoreTags = s((x) => x.scoreTags);
  const learnings = s((x) => x.learnings);
  const sessions = s((x) => x.sessions);
  const aiLinks = s((x) => x.aiLinks);
  const calc = s((x) => x.calcHistory);
  const trash = s((x) => x.trash);
  const hour24 = s((x) => x.settings.hour24);
  const rawSlots = s((x) => x.settings.tabSlots);
  const rawArchived = s((x) => x.settings.archivedTools);
  const notesLockSetting = s((x) => x.settings.notesLocked === true);
  const journalLockSetting = s((x) => x.settings.journalLocked === true);
  const notesOpen = useOpen('notes');
  const journalOpen = useOpen('journal');
  const profiles = useProfiles((p) => p.list);
  const notesLocked = notesLockSetting && !notesOpen;
  const journalLocked = journalLockSetting && !journalOpen;
  const archived = React.useMemo(() => normaliseArchived(rawArchived, normaliseSlots(rawSlots)), [rawArchived, rawSlots]);

  // the journal's texts: read in batches of 20 after the overlay has settled, a batch at a time between frames
  const [bodiesRev, setBodiesRev] = React.useState(0);
  const [journalLoading, setJournalLoading] = React.useState(false);
  React.useEffect(() => {
    if (!active || journalLocked || archived.includes('journal')) { setJournalLoading(false); return undefined; }
    const todo = journal.filter((e) => journalBodies.get(e.id)?.u !== e.updatedAt).map((e) => ({ id: e.id, u: e.updatedAt }));
    if (!todo.length) { setJournalLoading(false); return undefined; }
    let live = true;
    let task: { cancel: () => void } | null = null;
    setJournalLoading(true);
    const step = (from: number) => {
      task = InteractionManager.runAfterInteractions(async () => {
        const batch = todo.slice(from, from + 20);
        await Promise.all(batch.map(async ({ id, u }) => {
          try { journalBodies.set(id, { u, body: await readBody(id) }); } catch { /* the excerpt stands in */ }
        }));
        if (!live) return;
        setBodiesRev((n) => n + 1);
        if (from + 20 < todo.length) step(from + 20);
        else setJournalLoading(false);
      });
    };
    step(0);
    return () => { live = false; task?.cancel(); };
  }, [active, journal, journalLocked, archived]);

  const rev = React.useMemo(() => {
    if (!active) return -1;
    if (!staticDone) {
      staticDone = true;
      index.setCollection('settings', SETTINGS_INDEX, settingDoc);
    }
    // an archived tool leaves these with it, and comes back when it is restored
    const gone = archived.join('|');
    index.setCollection('tools', ONE, () => toolDocs(archived), gone);
    index.setCollection('actions', ONE, () => actionDocs(archived), gone);
    index.setCollection('toolSettings', ONE, () => toolSettingDocs(archived), gone);
    const ctx: Ctx = {
      hour24,
      folderName: new Map(vaultFolders.map((f) => [f.id, f.name])),
      scoreById: new Map(scores.map((n) => [n.id, n])),
      tagLabel: new Map(scoreTags.map((t) => [t.id, t])),
    };
    const flatBlocks = DAY_NAMES.flatMap((d) => (planner[d] || []).map((b) => ({ b, d })));
    // the planner's blocks are re-read with the week (each block keeps its own day)
    index.setCollection('todos', dailyTasks, todoDoc);
    index.setCollection('missions', missions, missionDocs);
    index.setCollection('blocks', [planner], () => flatBlocks.map(({ b, d }) => blockDoc(b, d, ctx)), hour24);
    index.setCollection('habits', habits, habitDoc);
    index.setCollection('notes', notes, noteDoc);
    index.setCollection('folders', noteFolders, (f: string): SiftDoc => ({
      key: 'folder:' + f, kind: 'folder', section: 'Notes', title: f, subtitle: 'Folder',
      payload: { icon: 'folder-outline', color: colorOf('green'), open: () => openTool('notes', { folder: f }) },
    }));
    index.setCollection('journal', journal, journalDoc, bodiesRev, (e) => journalBodies.get(e.id)?.u === e.updatedAt);
    index.setCollection('journalTags', journalTags, (t: string): SiftDoc => ({
      key: 'jtag:' + t, kind: 'tag', section: 'Journal', title: t, subtitle: 'Journal tag',
      payload: { icon: 'pricetag-outline', color: colorOf('gold'), open: () => openPage('/journal/archive', { tag: t }) },
    }));
    index.setCollection('videos', videos, (v) => videoDocs(v, ctx), vaultFolders);
    index.setCollection('scores', scores, (n) => scoreDoc(n, ctx), scoreTags);
    index.setCollection('learnings', learnings, (l) => learningDoc(l, ctx), scores);
    index.setCollection('scoreTags', scoreTags, scoreTagDoc);
    if (!subjectSrc || subjectSrc.sessions !== sessions || subjectSrc.notes !== notes || subjectSrc.planner !== planner || subjectSrc.scores !== scores) {
      subjectSrc = { sessions, notes, planner, scores };
    }
    // one source object, so the subjects are listed once (a source of four inputs would list them four times)
    index.setCollection('subjects', [subjectSrc], (x) => subjectsOf(x as any).map(subjectDoc));
    index.setCollection('sessions', sessions, (x) => sessionDoc(x, ctx), hour24);
    index.setCollection('ai', aiLinks, aiDoc);
    index.setCollection('calc', calc, calcDoc);
    index.setCollection('trash', trash, (t) => trashDoc(t, notesLocked, journalLocked), notesLocked + '|' + journalLocked);
    index.setCollection('profiles', profiles.filter((p) => p.id !== activeProfile), profileDoc);
    // a locked tool, or an archived one, keeps its content out
    const out = new Set<string>();
    if (notesLocked) TOOL_COLLECTIONS.notes!.forEach((k) => out.add(k));
    if (journalLocked) TOOL_COLLECTIONS.journal!.forEach((k) => out.add(k));
    for (const t of archived) (TOOL_COLLECTIONS[t] ?? []).forEach((k) => out.add(k));
    if (out.has('notes')) out.add('subjects');
    for (const k of out) index.dropCollection(k);
    // a key dropped once must be set again from scratch next time: dropping removed it, so a later set rebuilds it
    return Math.random();
  }, [
    active, dailyTasks, missions, planner, habits, notes, noteFolders, journal, journalTags, videos, vaultFolders, scores,
    scoreTags, learnings, sessions, aiLinks, calc, trash, hour24, profiles, notesLocked, journalLocked, archived, bodiesRev,
  ]);

  const subjects = React.useMemo(
    () => (active ? subjectsOf({ sessions, notes: notesLocked ? [] : notes, planner, scores }) : []),
    [active, sessions, notes, planner, scores, notesLocked],
  );

  return { index, rev, journalLoading, notesLocked, journalLocked, archived, subjects };
}

/** The archived tools as rows that bring them back. */
export function restoreDocs(archived: ToolKey[]): SiftDoc[] {
  return archived.map((key) => {
    const t = toolByKey(key)!;
    return {
      key: 'restore:' + key, kind: 'action', section: 'Actions', title: 'Restore ' + t.label,
      subtitle: 'Archived', meta: t.label + ' ' + t.shortLabel + ' archived unarchive ' + (TOOL_WORDS[key] ?? ''),
      payload: {
        icon: 'arrow-undo-outline', color: colorOf(t.colorKey),
        open: () => {
          if (useStore.getState().setToolArchived(key, false)) toast(t.label + ' restored');
        },
      },
    };
  });
}
