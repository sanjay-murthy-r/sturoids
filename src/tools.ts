import { C } from './theme';

/**
 * The single registry of every tool in the app. The tab-slot picker, the More
 * screen, the quick-access catalog and the defaults all derive from this — one
 * source, so Home and More can never disagree about a tool's name or colour.
 */
export type ToolKey =
  | 'tasks' | 'focus' | 'planner' | 'notes' | 'journal'
  | 'calculator' | 'desmos' | 'vault' | 'ai';

/** Palette slots rather than hex, so a palette swap recolours every tile. */
export type ColorKey = 'accent' | 'green' | 'amber' | 'pink' | 'teal' | 'slate' | 'gold' | 'danger';

export interface Tool {
  key: ToolKey;
  /** full name — More, headers, settings */
  label: string;
  /** fits a tab-bar slot at 11px on a 320dp screen */
  shortLabel: string;
  desc: string;
  icon: string;
  colorKey: ColorKey;
  /** full-screen route used when the tool is NOT in a tab slot */
  stackPath: string;
  lockable?: boolean;
}

export const TOOLS: Tool[] = [
  { key: 'tasks', label: 'Tasks', shortLabel: 'Tasks', desc: 'ToDos and long-term tasks', icon: 'checkbox-outline', colorKey: 'slate', stackPath: '/tasks' },
  { key: 'focus', label: 'Deep Work', shortLabel: 'Focus', desc: 'Timed focus sessions', icon: 'timer-outline', colorKey: 'accent', stackPath: '/focus' },
  { key: 'planner', label: 'Planner', shortLabel: 'Planner', desc: 'Week blocks and streaks', icon: 'calendar-outline', colorKey: 'teal', stackPath: '/planner' },
  { key: 'notes', label: 'Notes', shortLabel: 'Notes', desc: 'Text, voice, images and files', icon: 'document-text-outline', colorKey: 'green', stackPath: '/notes', lockable: true },
  { key: 'journal', label: 'Journal', shortLabel: 'Journal', desc: 'A page a day, in your words', icon: 'book-outline', colorKey: 'gold', stackPath: '/journal', lockable: true },
  { key: 'calculator', label: 'Calculator', shortLabel: 'Calc', desc: 'Precise scientific calculator', icon: 'calculator-outline', colorKey: 'amber', stackPath: '/calculator' },
  { key: 'desmos', label: 'Desmos', shortLabel: 'Desmos', desc: 'Graphing calculator', icon: 'analytics-outline', colorKey: 'teal', stackPath: '/desmos' },
  { key: 'vault', label: 'YT Vault', shortLabel: 'Vault', desc: 'YouTube study library', icon: 'play-circle-outline', colorKey: 'pink', stackPath: '/vault' },
  { key: 'ai', label: 'AI Quick-Links', shortLabel: 'AI', desc: 'Claude, ChatGPT, Gemini and more', icon: 'sparkles-outline', colorKey: 'accent', stackPath: '/ai-links' },
];

export const TOOL_KEYS: ToolKey[] = TOOLS.map((t) => t.key);
export const DEFAULT_SLOTS: ToolKey[] = ['tasks', 'focus', 'planner'];

export const toolByKey = (key: string): Tool | undefined => TOOLS.find((t) => t.key === key);

/** A palette slot or a literal colour, resolved against the live tokens. */
export function colorOf(c: string | undefined): string {
  if (!c) return C.accent;
  if (c.startsWith('#') || c.startsWith('rgb')) return c;
  return ((C as any)[c] as string) || C.accent;
}

/**
 * Exactly three distinct, valid slot keys. Unknown or duplicate entries are
 * dropped and the gaps filled from the defaults, then from registry order — a
 * corrupt persisted value can never produce a short or repeating bar.
 */
export function normaliseSlots(slots: unknown): ToolKey[] {
  const out: ToolKey[] = [];
  const push = (k: unknown) => {
    if (out.length < 3 && typeof k === 'string' && TOOL_KEYS.includes(k as ToolKey) && !out.includes(k as ToolKey)) {
      out.push(k as ToolKey);
    }
  };
  if (Array.isArray(slots)) slots.forEach(push);
  DEFAULT_SLOTS.forEach(push);
  TOOL_KEYS.forEach(push);
  return out;
}

/** Old route targets, as persisted by quick access before v5. */
export const ROUTE_TO_TOOL: Record<string, ToolKey> = {
  '/tasks': 'tasks', '/focus': 'focus', '/planner': 'planner', '/notes': 'notes',
  '/calculator': 'calculator', '/desmos': 'desmos', '/vault': 'vault', '/ai-links': 'ai',
};

/** Where a tool lives when opened as a full page. */
export const toolPath = (key: string): string => toolByKey(key)?.stackPath || '/';
