// The two small arrows at the bottom right of a wide screen whose tabs sit in the side rail (Settings > Tabs and tools).
// Back: inside a tool, out of the page open in it; at a tab's own screen, the tab before. Forward: back into the page
// just left (inside a tool, or a full page), else the tab after. An arrow with nothing to do is dimmed and takes no tap.
// Read from the navigation state, so they are right whichever way a page was opened or closed (the arrows, the system
// back, a link).

import React from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { useNavigationContainerRef } from 'expo-router';
import { StackActions } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, MIN, neuRaised } from '../theme';
import { useStore } from '../store';
import { WIDE_AT } from '../layout';
import { stepTab, TAB_ROUTES } from '../toolNav';
import { useSearch } from '../search/store';
import { Bouncy, EASE_OUT, useAnimLevel } from './Motion';
import { useTheme } from './UI';
import { tick } from '../haptics';

const TABS_GROUP = '(tabs)';

interface Kept { name: string; params?: object }
/** per stack (by its key): the pages closed from it, the one just closed last */
const ahead = new Map<string, Kept[]>();
/** each stack's pages as last seen, to tell a page closed from one opened */
const seen = new Map<string, { key: string; name: string; params?: object }[]>();
/** set while the forward arrow reopens a page, so that opening does not clear what is still ahead */
let reopening: string | null = null;

/** The stack the user is in now, how deep, and where the tabs stand. */
interface Where { stackKey: string | null; depth: number; tabIndex: number; atTabRoot: boolean; rootKey: string | null }

/** the tab open when the state was last read: a page closed over one tab is not reopened from another */
let lastTab = -1;

function walk(state: any): Where {
  const none: Where = { stackKey: null, depth: 0, tabIndex: -1, atTabRoot: false, rootKey: null };
  // the app's own stack: the one that holds the tabs (expo-router wraps it in a route of its own)
  let root = state;
  while (root && !root.routes?.some((r: any) => r.name === TABS_GROUP)) root = root.routes?.[root.index ?? 0]?.state;
  if (!root?.routes) return none;
  const rootKey = root.key ?? null;
  const top = root.routes[root.index ?? root.routes.length - 1];
  if (top?.name !== TABS_GROUP) return { stackKey: root.key, depth: root.routes.length, tabIndex: -1, atTabRoot: false, rootKey };
  const tabs = top.state;
  const tabIndex = tabs ? (TAB_ROUTES as readonly string[]).indexOf(tabs.routes?.[tabs.index ?? 0]?.name) : 0;
  const tab = tabs?.routes?.[tabs.index ?? 0];
  const inner = tab?.state;
  if (tabIndex !== lastTab) {
    // another tab: a full page closed over the last one is no longer ahead
    if (lastTab >= 0 && rootKey) ahead.delete(rootKey);
    lastTab = tabIndex;
  }
  if (inner?.type === 'stack' && inner.routes?.length > 1) {
    return { stackKey: inner.key, depth: inner.routes.length, tabIndex, atTabRoot: false, rootKey };
  }
  return { stackKey: inner?.type === 'stack' ? inner.key : null, depth: 1, tabIndex, atTabRoot: true, rootKey };
}

/** Notes every stack's change: pages closed are kept ahead, a page opened some other way clears what was ahead. */
function track(state: any) {
  const visit = (s: any) => {
    if (!s || !Array.isArray(s.routes)) return;
    if (s.type === 'stack' && s.key) {
      const now = s.routes.map((r: any) => ({ key: r.key, name: r.name, params: r.params }));
      const was = seen.get(s.key);
      if (was) {
        const shared = now.length <= was.length && now.every((r: any, i: number) => was[i]?.key === r.key);
        if (shared && now.length < was.length) {
          // closed: the pages that went are ahead, the deepest first, so forward reopens the nearest
          const list = ahead.get(s.key) ?? [];
          for (const r of was.slice(now.length).reverse()) list.push({ name: r.name, params: r.params });
          ahead.set(s.key, list.slice(-8));
        } else if (now.length > was.length && now.slice(0, was.length).every((r: any, i: number) => was[i].key === r.key)) {
          // opened: by the forward arrow, one less ahead; any other way, nothing is ahead any more
          if (reopening === s.key) {
            const list = ahead.get(s.key) ?? [];
            list.pop();
            ahead.set(s.key, list);
          } else ahead.delete(s.key);
        }
      }
      seen.set(s.key, now);
    }
    for (const r of s.routes) visit(r.state);
  };
  visit(state);
  reopening = null;
}

export function NavArrows() {
  const nav = useNavigationContainerRef();
  const side = useStore((s) => s.settings.tabNav === 'side');
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const siftOpen = useSearch((s) => s.open);
  const shown = side && width >= WIDE_AT && !siftOpen;
  const [where, setWhere] = React.useState<Where>({ stackKey: null, depth: 0, tabIndex: -1, atTabRoot: false, rootKey: null });
  const [, bump] = React.useState(0);

  React.useEffect(() => {
    const read = () => {
      if (!nav.isReady()) return;
      const st = nav.getRootState();
      track(st);
      setWhere(walk(st));
      bump((n) => n + 1);
    };
    read();
    const off = nav.addListener('state', read);
    return off;
  }, [nav]);

  const pageBack = where.depth > 1;
  // what forward reopens: a page closed inside this tool, else (at a tab's own screen) a full page just closed over it
  const own = where.stackKey ? ahead.get(where.stackKey) ?? [] : [];
  const keptKey = own.length ? where.stackKey : where.atTabRoot && where.rootKey && (ahead.get(where.rootKey)?.length ?? 0) > 0 ? where.rootKey : null;
  const kept = keptKey ? ahead.get(keptKey) ?? [] : [];
  const canBack = pageBack || (where.atTabRoot && where.tabIndex > 0);
  const canForward = kept.length > 0 || (where.atTabRoot && where.tabIndex >= 0 && where.tabIndex < TAB_ROUTES.length - 1);

  const back = () => {
    if (!canBack) return;
    tick();
    if (pageBack && where.stackKey) nav.dispatch({ ...StackActions.pop(), target: where.stackKey });
    else stepTab(-1);
  };
  const forward = () => {
    if (!canForward) return;
    tick();
    const next = kept[kept.length - 1];
    if (next && keptKey) {
      reopening = keptKey;
      nav.dispatch({ ...StackActions.push(next.name, next.params), target: keptKey });
    } else stepTab(1);
  };

  if (!shown) return null;
  return (
    <View pointerEvents="box-none" style={[st.place, { bottom: Math.max(16, insets.bottom + 10), right: Math.max(16, insets.right + 12) }]}>
      <Pill>
        <Arrow name="chevron-back" on={canBack} onPress={back} label="Back" />
        <View style={[st.hair, { backgroundColor: C.hairline }]} />
        <Arrow name="chevron-forward" on={canForward} onPress={forward} label="Forward" />
      </Pill>
    </View>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={[
        st.pill,
        theme === 'minimal' ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: MIN.border } : { backgroundColor: C.card, ...neuRaised('low') },
      ]}
    >
      {children}
    </View>
  );
}

/** One arrow: its ink eases between lit and dimmed as it gains or loses something to do. */
function Arrow({ name, on, onPress, label }: { name: 'chevron-back' | 'chevron-forward'; on: boolean; onPress: () => void; label: string }) {
  const level = useAnimLevel();
  const lit = useSharedValue(on ? 1 : 0);
  React.useEffect(() => {
    lit.value = level === 'none' ? (on ? 1 : 0) : withTiming(on ? 1 : 0, { duration: 200, easing: EASE_OUT });
  }, [on, level]);
  const ink = useAnimatedStyle(() => ({ opacity: 0.28 + 0.72 * lit.value }));
  return (
    <Bouncy
      onPress={onPress} disabled={!on} scaleTo={0.86} radius={17} style={st.key}
      accessibilityLabel={label} accessibilityState={{ disabled: !on }}
    >
      <Animated.View style={ink}>
        <Ionicons name={name} size={18} color={C.text} />
      </Animated.View>
    </Bouncy>
  );
}

const st = StyleSheet.create({
  place: { position: 'absolute', zIndex: 30 },
  pill: { flexDirection: 'row', alignItems: 'center', borderRadius: 999, padding: 2 },
  key: { width: 38, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  hair: { width: StyleSheet.hairlineWidth, height: 16 },
});
