import React from 'react';
import { router, useNavigationContainerRef } from 'expo-router';
import { CommonActions } from '@react-navigation/native';
import { useStore } from './store';
import { ToolKey, normaliseSlots, toolByKey } from './tools';

// Navigation to tools. It lives apart from tools.ts on purpose: the store imports tools.ts, and the
// store must never pull in expo-router.

/** How a tool body is presented: filling a bar slot (`tab`), or as a full page with a back button (`stack`). */
export type ScreenMode = 'tab' | 'stack';

/** The bar's five routes, left to right. They never change: a swap changes what a slot shows, not its route. */
export const TAB_ROUTES = ['index', 'slot1', 'slot2', 'slot3', 'more'] as const;
export type TabRouteName = (typeof TAB_ROUTES)[number];

/** Route name of bar slot 0, 1 or 2. */
export const slotRouteName = (slot: number): TabRouteName => TAB_ROUTES[slot + 1];

const TABS_GROUP = '(tabs)';

export type ToolParams = Record<string, string | number | undefined>;

type ContainerRef = ReturnType<typeof useNavigationContainerRef>;
let containerRef: ContainerRef | null = null;

/**
 * Hands the navigation container to the plain functions below (openTool, the tab fling). The ref is
 * app-wide and stable, so every screen background and the tab layout can register it.
 */
export function useRegisterNavigation() {
  containerRef = useNavigationContainerRef();
}

function stringParams(params?: ToolParams): Record<string, string> | undefined {
  if (!params) return undefined;
  const out: Record<string, string> = {};
  for (const k of Object.keys(params)) {
    const v = params[k];
    if (v !== undefined && v !== '') out[k] = String(v);
  }
  return Object.keys(out).length ? out : undefined;
}

/** The root layout's Stack, once the container is ready and the tabs belong to it. */
function rootStack(): any {
  if (!containerRef?.isReady()) return undefined;
  // expo-router wraps the root layout's navigator in a single internal route
  const stack: any = containerRef.getRootState()?.routes?.[0]?.state;
  const ok = stack?.type === 'stack' && !!stack.key && !!stack.routeNames?.includes(TABS_GROUP);
  // this reads an expo-router internal: say so in development if an upgrade changes its shape
  if (__DEV__ && stack && !ok) console.warn('toolNav: unexpected root stack shape; openTool falls back to router.navigate');
  return ok ? stack : undefined;
}

/**
 * Opens a tool wherever it lives right now. In a bar slot: that tab, back at the tool's own screen
 * (pages the tool opened inside the slot, such as a note, close) with `params` delivered to it.
 * Not in a slot: its full page, with back.
 */
export function openTool(key: ToolKey, params?: ToolParams) {
  const tool = toolByKey(key);
  if (!tool) return;
  const p = stringParams(params);
  const slot = normaliseSlots(useStore.getState().settings.tabSlots).indexOf(key);
  if (slot < 0) {
    router.push(p ? { pathname: tool.stackPath, params: p } : tool.stackPath);
    return;
  }
  const stack = rootStack();
  if (!containerRef || !stack) {
    // only before the container is ready (the first frames of a cold start), when no full page can be open
    // yet, so a plain navigate cannot stack a second copy of the tabs
    const href = '/' + slotRouteName(slot);
    router.navigate(p ? { pathname: href, params: p } : href);
    return;
  }
  // One action with `pop` at every level. expo-router's navigate() sets no `pop`, which would stack a
  // second copy of the tabs over a full page, or move the slot's root above an open note.
  containerRef.dispatch({
    type: 'NAVIGATE',
    target: stack.key,
    payload: {
      name: TABS_GROUP,
      pop: true,
      params: { screen: slotRouteName(slot), params: { screen: 'index', params: p, pop: true } },
    },
  });
}

/** Tab fling: move to the next (1) or previous (-1) bar route, in bar order. Returns whether it moved. */
export function stepTab(dir: 1 | -1): boolean {
  const stack = rootStack();
  const top = stack?.routes?.[stack.index ?? 0];
  const tabs = top?.name === TABS_GROUP ? top.state : undefined;
  if (!containerRef || !tabs?.key) return false;
  const current = tabs.routes?.[tabs.index ?? 0]?.name;
  const at = (TAB_ROUTES as readonly string[]).indexOf(current);
  const next = at < 0 ? undefined : TAB_ROUTES[at + dir];
  if (!next) return false;
  // a plain navigate keeps whatever the target slot had open
  containerRef.dispatch({ ...CommonActions.navigate(next), target: tabs.key });
  return true;
}

const SlotContext = React.createContext<number>(-1);

/** Wraps a slot's Stack, so every page inside it (the tool, a note, a video) knows its bar slot. */
export function SlotProvider({ slot, children }: { slot: number; children?: React.ReactNode }) {
  return React.createElement(SlotContext.Provider, { value: slot }, children);
}

/** The bar slot (0..2) the calling screen is rendered in, or -1 on a full page. */
export const useSlot = () => React.useContext(SlotContext);

/**
 * Links for tool screens that respect the presentation: inside a slot, a tool's own pages open inside
 * that slot (the bar stays); on a full page they open as full pages.
 */
export function useToolNav() {
  const slot = React.useContext(SlotContext);
  return React.useMemo(() => {
    const inSlot = slot >= 0;
    const base = inSlot ? '/' + slotRouteName(slot) : '';
    return {
      mode: (inSlot ? 'tab' : 'stack') as ScreenMode,
      /** '/slot2' inside a slot, '' on a full page */
      base,
      openNote: (id: string) =>
        router.push({ pathname: inSlot ? `${base}/note/[id]` : '/notes/[id]', params: { id } }),
      openVideo: (id: string, atSec?: number) =>
        router.push({
          pathname: inSlot ? `${base}/video/[id]` : '/vault/[id]',
          params: atSec != null ? { id, t: String(Math.floor(atSec)) } : { id },
        }),
      /** the journal archive (its routes arrive with the Journal tool) */
      openArchive: () => router.push(inSlot ? `${base}/journal/archive` : '/journal/archive'),
    };
  }, [slot]);
}
