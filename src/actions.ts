import { create } from 'zustand';
import { router } from 'expo-router';
import { useStore } from './store';
import { openTool } from './toolNav';
import { openSift } from './search/store';
import { toolByKey } from './tools';
import { requestJournalOpen } from './journal';
import { openScoreNode } from './scoresNav';
import type { AppLink } from './appLinks';
import type { TaskKind } from './components/QuickTaskSheet';

// Actions: things the app does in one tap from anywhere: an app shortcut (long-press the icon), a quick-access tile on
// Today, a phone widget's link (sturoids://…). Each is named by a short id, so a tile or a link only stores the id.

export type ActionId = 'search' | 'new-note' | 'add-todo' | 'start-focus';

export const ACTION_IDS: readonly ActionId[] = ['search', 'new-note', 'add-todo', 'start-focus'];

export const isActionId = (v: unknown): v is ActionId => typeof v === 'string' && (ACTION_IDS as readonly string[]).includes(v);

/** How each action is shown on a tile or a shortcut: its words, its icon (Ionicons) and its colour key. */
export const ACTIONS: Record<ActionId, { label: string; icon: string; color: string }> = {
  search: { label: 'Search', icon: 'search-outline', color: 'accent' },
  'new-note': { label: 'New note', icon: 'create-outline', color: 'green' },
  'add-todo': { label: 'Add ToDo', icon: 'add-circle-outline', color: 'accent' },
  'start-focus': { label: 'Start focus', icon: 'timer-outline', color: 'accent' },
};

/* ---------------------------------------------------------------- the global quick add */

export interface QuickAddState {
  open: boolean;
  kind: TaskKind;
  title: string;
  /** a new number for every opening, so the sheet starts fresh each time */
  n: number;
}

/** The app-wide "Add a task" sheet (QuickAddHost, mounted once in the root layout). */
export const useQuickAdd = create<QuickAddState>(() => ({ open: false, kind: 'daily', title: '', n: 0 }));

/** Opens the app-wide task sheet, on a ToDo by default, with a title already typed if one is given. */
export function openQuickAdd(opts: { kind?: TaskKind; title?: string } = {}) {
  const s = useQuickAdd.getState();
  if (s.open) return;
  useQuickAdd.setState({ open: true, kind: opts.kind ?? 'daily', title: opts.title ?? '', n: s.n + 1 });
}

export function closeQuickAdd() {
  if (useQuickAdd.getState().open) useQuickAdd.setState({ open: false });
}

/* ---------------------------------------------------------------- running one */

/** A new empty note, opened. */
function newNote() {
  const id = useStore.getState().addNote({ title: '' });
  router.push({ pathname: '/notes/[id]', params: { id } }, { dangerouslySingular: true });
}

/**
 * Runs an action. `origin` says where it came from (a shortcut or a widget opens Sift as 'shortcut'). Returns whether
 * it was one the app knows.
 */
export function runAction(id: string, origin: 'shortcut' | 'tile' | 'link' = 'tile'): boolean {
  switch (id) {
    case 'search':
      openSift(origin === 'tile' ? 'today' : 'shortcut');
      return true;
    case 'new-note':
      newNote();
      return true;
    case 'add-todo':
      openQuickAdd({ kind: 'daily' });
      return true;
    case 'start-focus': {
      // Deep Work opens on the length it last started with, ready to start
      const minutes = useStore.getState().settings.focusLastMin;
      openTool('focus', minutes > 0 ? { minutes } : undefined);
      return true;
    }
    default:
      return false;
  }
}

/* ---------------------------------------------------------------- the app's own links */

/**
 * Carries out an app link (src/appLinks.ts): an action, or a tool opened on one of its things. A tool this version
 * does not know opens nothing. Archived tools still open, as openTool does.
 */
export function runAppLink(link: AppLink) {
  if (link.kind === 'action') {
    if (link.action === 'search') openSift('shortcut', link.query ? { query: link.query } : {});
    else if (link.action === 'add-todo') openQuickAdd({ kind: 'daily', title: link.query });
    else runAction(link.action, 'link');
    return;
  }
  const tool = toolByKey(link.tool as any);
  if (!tool) return;
  const { item, ...rest } = link.params;
  if (item) {
    if (tool.key === 'notes') {
      router.push({ pathname: '/notes/[id]', params: { id: item } }, { dangerouslySingular: true });
      return;
    }
    if (tool.key === 'vault') {
      router.push({ pathname: '/vault/[id]', params: rest.t ? { id: item, t: rest.t } : { id: item } }, { dangerouslySingular: true });
      return;
    }
    if (tool.key === 'journal' && /^\d{4}-\d{2}-\d{2}$/.test(item)) {
      requestJournalOpen(item, rest.entry);
      openTool('journal');
      return;
    }
    if (tool.key === 'scores') {
      openScoreNode(item);
      openTool('scores', rest);
      return;
    }
  }
  openTool(tool.key, item ? { ...rest, item } : rest);
}

/** a link that arrived before the app could act on it (a cold start), carried out once the app is up */
let pendingLink: AppLink | null = null;
let appUp = false;

/** Carries out a link now if the app is up, or once it is (appIsUp). */
export function queueAppLink(link: AppLink) {
  if (appUp) {
    // a frame later: the router is still handling the link that brought it
    setTimeout(() => runAppLink(link), 0);
    return;
  }
  pendingLink = link;
}

/** The root layout says the app is up (its intro gone): a link waiting since the launch is carried out now. */
export function appIsUp() {
  if (appUp) return;
  appUp = true;
  const link = pendingLink;
  pendingLink = null;
  if (link) setTimeout(() => runAppLink(link), 0);
}
