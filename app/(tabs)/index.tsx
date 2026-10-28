import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Pressable, InteractionManager, BackHandler, Platform, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from 'expo-router';
import { useIsFocused, useScrollToTop } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  AnimatedRef, Easing, FadeIn, FadeOut, SharedValue, ZoomIn, ZoomOut, runOnJS, scrollTo, useAnimatedRef,
  useAnimatedScrollHandler, useAnimatedStyle, useFrameCallback, useSharedValue, withSequence, withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { C, CHROME_FONT_MAX, F, MIN, S, T, TRACK, neuRaised, oneLine } from '../../src/theme';
import {
  useStore, FocusSession, Habit, PlannerWeek, TodayWidget, StoreOverride, hasAnyUserData, todayColumnsKey,
} from '../../src/store';
import { makeSampleStore } from '../../src/widgets/sample';
import { fmtDate, uid } from '../../src/utils';
import { ArrivalPulse, Card, PillButton, PullPill, ScreenBG, SectionTopTrim, Sheet, useHeaderPull, useTheme } from '../../src/components/UI';
import { Bouncy, EASE_OUT, Enter, FadeSwap, glide, useAnimLevel, useFocusKey } from '../../src/components/Motion';
import { toast } from '../../src/components/Toast';
import { tap, tick } from '../../src/haptics';
import { normaliseSlots, toolByKey } from '../../src/tools';
import { openPage } from '../../src/toolNav';
import { useGreeting } from '../../src/greeting';
import { useIntro } from '../../src/intro';
import { useNow } from '../../src/hooks/useNow';
import { useScrollMemory } from '../../src/hooks/useScrollMemory';
import { BOARD_MAX, columnWidth } from '../../src/layout';
import { useProfiles } from '../../src/profiles';
import { ProfileSwitcher } from '../../src/components/ProfileSwitcher';
import { openSift } from '../../src/search/store';
import { BACKUP_ATTENTION_TEXT, useBackupAttention, useCloud } from '../../src/cloud';
import { readLastExport, shouldNudgeBackup } from '../../src/backupNudge';
import { BoardNow, NudgeRow } from '../../src/widgets/kit';
import { useTodayItems, useNextBlock } from '../../src/widgets/data';
import {
  ColItem, DEFAULT_LAYOUT, GRID_GAP, arrangeColumns, boardColumns, dropTarget, fitLayout, heightOf, insertWidget,
  layoutColumns, moveInColumns, nextSize, removeWidget,
} from '../../src/widgets/logic';
import { galleryGroups, sizesOf, widgetDef, widgetShown } from '../../src/widgets/registry';
import type { WidgetDef } from '../../src/widgets/types';

// what the greeting is told about a tool that is archived: nothing, so it never speaks of what the user put away
const NO_SESSIONS: FocusSession[] = [];
const NO_HABITS: Habit[] = [];
const NO_PLAN = {} as PlannerWeek;

/** a 13 pt text link reaches a 44 dp target without moving anything around it */
const LINK_SLOP = { top: 14, bottom: 14, left: 10, right: 10 };

/**
 * The greeting as a way in to the account: a tap opens Settings' Account page, and with more than one profile on the
 * phone a hold opens the profile switcher. The press is a slight give of the whole block, never a box behind the words.
 */
function GreetingPress({ onPress, onLongPress, several, children }: {
  onPress: () => void; onLongPress: () => void; several: boolean; children: React.ReactNode;
}) {
  const level = useAnimLevel();
  const p = useSharedValue(0);
  React.useEffect(() => { if (level === 'none') p.value = 0; }, [level]);
  const aStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 - 0.02 * p.value }] }));
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={level === 'none' ? undefined : () => { p.value = withTiming(1, { duration: 90, easing: EASE_OUT }); }}
      onPressOut={level === 'none' ? undefined : () => { p.value = withTiming(0, { duration: 180, easing: EASE_OUT }); }}
      accessibilityRole="button"
      accessibilityHint={'Opens your account.' + (several ? ' Hold to switch profile.' : '')}
    >
      <Animated.View style={aStyle}>{children}</Animated.View>
    </Pressable>
  );
}

export default function Today() {
  const insets = useSafeAreaInsets();
  const fk = useFocusKey();
  const focused = useIsFocused();
  // only what the greeting needs is selected here: each widget reads its own slice of the store
  const name = useStore((s) => s.settings.name);
  const archivedTools = useStore((s) => s.settings.archivedTools);
  const sessions = useStore((s) => s.sessions);
  const habits = useStore((s) => s.habits);
  const planner = useStore((s) => s.planner);
  const dwRunning = useStore((s) => !!s.deepWork?.running);
  const dwStartTs = useStore((s) => s.deepWork?.startTs ?? null);
  const dwCapSec = useStore((s) => (s.deepWork?.mode === 'countdown' ? s.deepWork.targetMin * 60 : Infinity));

  const [switcher, setSwitcher] = useState(false);
  const severalProfiles = useProfiles((p) => p.list.length > 1);
  const openAccount = useCallback(() => openPage('/settings', { page: 'account' }), []);
  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState(false);
  // the day's column, known ahead on a wide window (so the board's columns are right on the first frame), then measured
  const { width: dayWinW } = useWindowDimensions();
  const [areaW, setAreaW] = useState(() => columnWidth(dayWinW, true, BOARD_MAX));
  const now = useNow();
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  useScrollToTop(scrollRef as unknown as React.RefObject<ScrollView>);
  // the scroll, on the UI thread, as a drag near an edge of the screen reads and moves it
  const scrollY = useSharedValue(0);
  const scrollMax = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => { scrollY.value = e.contentOffset.y; });
  // back within 15 seconds, Today is where it was left; later, at its top (src/hooks/useScrollMemory.ts)
  const memory = useScrollMemory(scrollY, { ref: scrollRef });
  const viewH = React.useRef(0);
  const contentH = React.useRef(0);
  const measureScroll = () => { scrollMax.value = Math.max(0, contentH.current - viewH.current); };
  const scroll = useMemo<BoardScroll>(() => ({ ref: scrollRef, y: scrollY, max: scrollMax }), [scrollRef, scrollY, scrollMax]);

  // editing ends when Today is left; while it lasts, Back ends it instead of closing the app
  useFocusEffect(useCallback(() => () => setEditing(false), []));
  useEffect(() => {
    if (!editing) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setEditing(false);
      return true;
    });
    return () => sub.remove();
  }, [editing]);

  // A countdown block still running from before the app was last closed ends with its buzz (and chime) even while Deep
  // Work has not been opened since. Deep Work's module watches it (it stands down while a Deep Work screen is open).
  useEffect(() => {
    if (!dwRunning || !dwStartTs || !Number.isFinite(dwCapSec)) return;
    (require('../../src/screens/FocusScreen') as typeof import('../../src/screens/FocusScreen')).watchAwayEnd();
  }, [dwRunning, dwStartTs, dwCapSec]);

  const archived = useMemo(() => new Set<string>(archivedTools), [archivedTools]);
  const hideTasks = archived.has('tasks');
  const hidePlanner = archived.has('planner');
  const hideFocus = archived.has('focus');

  const items = useTodayItems();
  const nextBlock = useNextBlock();
  const greeting = useGreeting({
    now, name,
    sessions: hideFocus ? NO_SESSIONS : sessions,
    habits: hidePlanner ? NO_HABITS : habits,
    planner: hidePlanner ? NO_PLAN : planner,
    listTotal: hideTasks ? 0 : items.length,
    listDone: hideTasks ? 0 : items.filter((t) => t.done).length,
    nextBlock: hidePlanner ? null : nextBlock,
  });

  // once the intro has gone and the screen is still, the other tabs are built one at a time, so a first visit
  // never waits for a screen to be made and nothing is built out of sight while the intro plays
  const navigation = useNavigation();
  const introDone = useIntro((s) => s.phase === 'done');
  useEffect(() => {
    if (!introDone) return undefined;
    // a slot holding Desmos waits for its first visit: its page loads desmos.com in a heavy web view
    const slots = normaliseSlots(useStore.getState().settings.tabSlots);
    const names = [...(['slot1', 'slot2', 'slot3'] as const).filter((_, i) => slots[i] !== 'desmos'), 'more'];
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const next = (i: number) => {
      if (!live || i >= names.length) return;
      InteractionManager.runAfterInteractions(() => {
        if (!live) return;
        try {
          (navigation as any).preload?.(names[i]);
        } catch {
          // a navigator that cannot preload builds the tab on its first visit instead
        }
        timer = setTimeout(() => next(i + 1), 700);
      });
    };
    timer = setTimeout(() => next(0), 1000);
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [introDone]);

  // a drag down from inside the greeting opens Sift; off while the board is edited
  const headerPull = useHeaderPull(focused && !editing);

  // a greeting that changes while Today is open dips out and back as the new words; a figure in the same sentence
  // changes in place, so the line never blinks each minute
  const greetingKey = greeting.kind + '|' + (greeting.sub || '');
  const header = (
    <Enter index={0}>
      <GestureDetector gesture={headerPull.gesture}>
        <View collapsable={false} style={st.header}>
          <View style={st.headTop}>
            <View style={{ flex: 1 }}>
              <GreetingPress
                onPress={openAccount} several={severalProfiles}
                onLongPress={() => { if (severalProfiles) { tap(); setSwitcher(true); } else openAccount(); }}
              >
                <Text style={T.kicker}>{fmtDate(now)}</Text>
                <FadeSwap swapKey={greetingKey}>
                  <Text style={[T.display, { marginTop: 8, marginBottom: greeting.sub ? 6 : 24 }]}>
                    {greeting.parts.map((part, i) => (
                      <Text key={i} style={part.name ? { color: C.accent } : undefined}>{part.text}</Text>
                    ))}
                  </Text>
                  {greeting.sub ? <Text style={[T.label, { marginBottom: 24 }]}>{greeting.sub}</Text> : null}
                </FadeSwap>
              </GreetingPress>
            </View>
            {/* Sift, a tap away: a small flat glyph, no well; while the board is edited, Done takes its place */}
            {editing ? (
              <Pressable
                onPress={() => setEditing(false)} hitSlop={LINK_SLOP} style={st.headAction}
                accessibilityRole="button" accessibilityLabel="Done editing Today"
              >
                <Text style={[st.link, { color: C.accent }]} maxFontSizeMultiplier={CHROME_FONT_MAX}>Done</Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => openSift('today')} hitSlop={12} style={({ pressed }) => [st.headAction, st.search, pressed && { opacity: 0.55 }]}
                accessibilityRole="button" accessibilityLabel="Search" accessibilityHint="Opens Sift, to search everything"
              >
                <Ionicons name="search" size={20} color={C.textDim} />
              </Pressable>
            )}
          </View>
          <PullPill progress={headerPull.progress} />
        </View>
      </GestureDetector>
    </Enter>
  );

  const boardW = Math.max(0, areaW - S.pad * 2);
  const count = boardColumns(boardW);
  return (
    // while the board is edited a sideways drag moves a widget between columns, never to the next tab
    <ScreenBG guard maxWidth={BOARD_MAX} fling={!editing}>
      <BoardNow.Provider value={now}>
        <Animated.ScrollView
          key={fk}
          ref={memory.ref}
          scrollEnabled={!dragging}
          onScroll={onScroll}
          scrollEventThrottle={16}
          onLayout={(e) => {
            setAreaW(e.nativeEvent.layout.width);
            viewH.current = e.nativeEvent.layout.height;
            measureScroll();
          }}
          onContentSizeChange={(w, h) => { contentH.current = h; measureScroll(); memory.onContentSizeChange(w, h); }}
          contentContainerStyle={{ padding: S.pad, paddingTop: insets.top + 20, paddingBottom: 44 }}
          showsVerticalScrollIndicator={false}
        >
          {header}
          <SystemBanners />
          <Board
            count={count} width={boardW} editing={editing} archived={archived}
            onEdit={setEditing} onDragging={setDragging} scroll={scroll}
          />
        </Animated.ScrollView>
      </BoardNow.Provider>
      <ProfileSwitcher visible={switcher} onClose={() => setSwitcher(false)} onManage={openAccount} />
    </ScreenBG>
  );
}

/* ---------------------------------------------------------------- the system banners (item 2) */

/**
 * Above the board, never removable: a slim line while the backup is paused or lost, which opens Account; and, once,
 * after a week of use with no account and no backup file in two weeks, a card saying the data lives only on this phone.
 */
function SystemBanners() {
  const attention = useBackupAttention();
  const signedIn = useCloud((s) => s.ready && s.status !== 'signed-out');
  const firstOpenedAt = useStore((s) => s.settings.firstOpenedAt);
  const backupNudgeAt = useStore((s) => s.settings.backupNudgeAt);
  const setSetting = useStore((s) => s.setSetting);
  const [lastExport, setLastExport] = useState<number | null | undefined>(undefined);
  // read each time Today comes into view: a backup made in Settings in the meantime counts at once
  useFocusEffect(useCallback(() => {
    let live = true;
    readLastExport().then((v) => { if (live) setLastExport(v); });
    return () => { live = false; };
  }, []));
  const openAccount = () => openPage('/settings', { page: 'account' });
  // whether the app holds anything is asked last, and only when the rest would show the card: it walks every collection
  const nudge = lastExport !== undefined
    && shouldNudgeBackup({ firstOpenedAt, backupNudgeAt, signedIn, lastExportAt: lastExport, hasData: true })
    && hasAnyUserData(useStore.getState());
  const answer = (backUp: boolean) => {
    setSetting('backupNudgeAt', Date.now());
    if (backUp) openAccount();
  };
  return (
    <>
      {attention !== 'ok' ? (
        <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(160)}>
          <NudgeRow
            icon={attention === 'lost' ? 'cloud-offline-outline' : 'pause-circle-outline'} iconColor={C.amber}
            text={BACKUP_ATTENTION_TEXT[attention]} action="Fix" actionColor={C.amber} onPress={openAccount}
            style={{ marginTop: 0, marginBottom: S.gap }}
          />
        </Animated.View>
      ) : null}
      {nudge ? (
        <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(160)}>
          <Card pad={S.cardPad}>
            <View style={st.nudgeHead}>
              <Ionicons name="phone-portrait-outline" size={18} color={C.amber} />
              <Text style={[T.head, { marginLeft: 10, flex: 1 }]}>Your data only lives on this phone</Text>
            </View>
            <Text style={[T.caption, { marginTop: 8 }]}>
              Lose the phone and it goes with it. Sign in to back it up, or save a backup file in Settings.
            </Text>
            <View style={st.nudgeKeys}>
              <PillButton label="Back up" onPress={() => answer(true)} small />
              <Pressable onPress={() => answer(false)} hitSlop={LINK_SLOP} accessibilityRole="button" style={{ marginLeft: 20 }}>
                <Text style={[st.link, { color: C.textDim }]}>Not now</Text>
              </Pressable>
            </View>
          </Card>
        </Animated.View>
      ) : null}
    </>
  );
}

/* ---------------------------------------------------------------- the board */

/** the PC version (the web build the desktop app wraps): its board keeps an arrangement of its own */
const ON_PC = Platform.OS === 'web';
/** a flow section's height before it has been measured (its first frame), for the columns' first layout */
const FLOW_EST = 200;
/** how near the top or foot of the screen a dragged widget starts the board scrolling, and how fast at the very edge */
const EDGE_ZONE = 90;
const EDGE_SPEED = 14;
/** the glide of a widget to a new place, and of a dropped one into its own */
const MOVE = { duration: 300, easing: EASE_OUT };
const LAND = { duration: 340, easing: EASE_OUT };

/** What the board is told about the scroll view it sits in, for a drag near the edges to scroll it. */
export interface BoardScroll {
  ref: AnimatedRef<Animated.ScrollView>;
  /** the scroll offset, and the furthest it goes, kept on the UI thread */
  y: SharedValue<number>;
  max: SharedValue<number>;
}

/**
 * Today's widgets in columns: one on a phone (its S tiles two to a row), two or three on a wide window, each count of
 * columns keeping its own arrangement, so a tablet turned or a foldable folded comes back to the board it had. Every
 * widget sits at a place worked out here (src/widgets/logic.ts) and glides when it changes. Editing settles each widget
 * inside a carved outline with a remove well (and a size chip where it has several sizes); holding one lifts it, and as
 * it is dragged the others move aside to show where it will land, the board scrolling when it nears an edge.
 */
function Board({ count, width, editing, archived, onEdit, onDragging, scroll }: {
  count: 1 | 2 | 3; width: number; editing: boolean; archived: ReadonlySet<string>;
  onEdit: (on: boolean) => void; onDragging: (on: boolean) => void; scroll: BoardScroll;
}) {
  const level = useAnimLevel();
  const theme = useTheme();
  const saved = useStore((s) => s.todayLayout);
  // a PC keeps its own arrangement once one is made there; until then it shows the tablet's (the account's, synced)
  const colKey = todayColumnsKey(count, ON_PC);
  const savedCols = useStore((s) => s.todayColumns[colKey] ?? (ON_PC ? s.todayColumns[String(count)] : undefined));
  const setTodayLayout = useStore((s) => s.setTodayLayout);
  const setTodayColumns = useStore((s) => s.setTodayColumns);
  const [gallery, setGallery] = useState(false);
  // where the gallery adds: after this widget, or at the end
  const [addAfter, setAddAfter] = useState<string | null>(null);
  const layout = useMemo(() => fitLayout(saved ?? DEFAULT_LAYOUT, sizesOf), [saved]);
  const visible = useMemo(
    () => layout.filter((w) => { const d = widgetDef(w.type); return !!d && widgetShown(d, archived); }),
    [layout, archived],
  );

  // the flow sections' heights, as measured (the tiles' are fixed)
  const [measured, setMeasured] = useState<Record<string, number>>({});
  const onMeasure = useCallback((id: string, h: number) => {
    setMeasured((m) => (Math.abs((m[id] ?? -1) - h) < 0.5 ? m : { ...m, [id]: h }));
  }, []);
  const items = useMemo(() => {
    const map = new Map<string, ColItem>();
    for (const w of visible) {
      const def = widgetDef(w.type)!;
      // a flow section carries its own space below it (its card's margin), which stands in for the board's gap
      const h = def.flow ? Math.max(0, (measured[w.id] ?? FLOW_EST) - GRID_GAP) : heightOf(w.size);
      map.set(w.id, { id: w.id, half: !def.flow && w.size === 'S', h });
    }
    return map;
  }, [visible, measured]);

  const colW = Math.max(0, Math.floor(((width - GRID_GAP * (count - 1)) / count) * 100) / 100);
  const ids = useMemo(() => visible.map((w) => w.id), [visible]);
  const allMeasured = visible.every((w) => !widgetDef(w.type)!.flow || measured[w.id] != null);
  const columns = useMemo(
    () => arrangeColumns(ids, count, count > 1 ? savedCols : null, (id) => {
      const it = items.get(id);
      return it ? (it.half ? it.h / 2 : it.h) : 0;
    }),
    // the heights only steer where a widget new to the arrangement goes: past the first measure (which deals a first
    // arrangement by the sections' real heights), a height changing never re-deals the columns
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ids, count, savedCols, allMeasured],
  );

  // A wide board's first arrangement is kept once its sections have been measured, so adding or removing a widget later
  // never deals the others out afresh into different columns.
  useEffect(() => {
    if (count === 1 || savedCols || !allMeasured || !visible.length) return undefined;
    const t = setTimeout(() => setTodayColumns(colKey, live.current.columns), 400);
    return () => clearTimeout(t);
  }, [count, colKey, savedCols, allMeasured, visible.length, setTodayColumns]);

  // a drag in progress: the widget and where it would land
  const [drag, setDrag] = useState<{ id: string; col: number; index: number } | null>(null);
  const shown = useMemo(
    () => (drag ? moveInColumns(columns, drag.id, drag.col, drag.index) : columns),
    [columns, drag],
  );
  const { rects, gaps, heights } = useMemo(() => layoutColumns(shown, items, colW, GRID_GAP), [shown, items, colW]);
  const boardH = Math.max(0, ...heights);

  // the latest of each, for the gestures' JS ends and the edge scroll's timer
  const live = React.useRef({ columns, items, colW, drag, count, colKey, layout, savedCols, rects });
  live.current = { columns, items, colW, drag, count, colKey, layout, savedCols, rects };

  const current = () => fitLayout(useStore.getState().todayLayout ?? DEFAULT_LAYOUT, sizesOf);
  const commit = useCallback((next: TodayWidget[]) => setTodayLayout(next), [setTodayLayout]);

  const remove = useCallback((id: string) => {
    const { list, removed, index } = removeWidget(current(), id);
    if (!removed) return;
    commit(list);
    const name = widgetDef(removed.type)?.title || 'Widget';
    toast(name + ' removed', { label: 'Undo', onPress: () => commit(insertWidget(current(), removed, index)) });
  }, [commit]);

  const resize = useCallback((id: string) => {
    commit(current().map((w) => {
      if (w.id !== id) return w;
      const sizes = sizesOf(w.type) || [w.size];
      return { ...w, size: nextSize(sizes, w.size) };
    }));
  }, [commit]);

  /**
   * A drop: the board takes the arrangement it showed. On a phone that is the order itself (hidden widgets keep their
   * places in the saved list); on a wide window it is that column count's own arrangement, where a hidden widget keeps
   * its place in its column too.
   */
  const settleDrop = useCallback((id: string, col: number, index: number) => {
    const { columns: cols, count: n, colKey: key, layout: full, savedCols: kept } = live.current;
    const next = moveInColumns(cols, id, col, index);
    if (n === 1) {
      const order = next[0];
      const shownIds = new Set(order);
      let i = 0;
      const moved = full.filter((w) => shownIds.has(w.id));
      const byId = new Map(moved.map((w) => [w.id, w]));
      commit(full.map((w) => (shownIds.has(w.id) ? byId.get(order[i++])! : w)));
      return;
    }
    const exists = new Set(full.map((w) => w.id));
    const merged = next.map((c, ci) => {
      const out = c.slice();
      // a hidden widget (its tool archived) goes back where it was in its column
      (kept?.[ci] || []).forEach((hid, at) => {
        if (exists.has(hid) && !out.includes(hid) && !next.some((x) => x.includes(hid))) out.splice(Math.min(at, out.length), 0, hid);
      });
      return out;
    });
    setTodayColumns(key, merged);
  }, [commit, setTodayColumns]);

  // where the drag would land, worked out from the centre of the widget: where the finger has taken it, and how far the
  // board has scrolled under it since it was picked up
  const point = React.useRef({ cx: 0, cy: 0, scrollAt: 0 });
  const aimNow = useCallback((id: string) => {
    const { cx, cy, scrollAt } = point.current;
    const { columns: cols, items: its, colW: w, drag: d } = live.current;
    const t = dropTarget(cols, id, its, w, GRID_GAP, cx, cy + (scroll.y.value - scrollAt));
    if (!d || d.id !== id || d.col !== t.col || d.index !== t.index) {
      if (d && d.id === id) tick();
      setDrag({ id, ...t });
    }
  }, [scroll]);
  const aim = useCallback((id: string, cx: number, cy: number) => {
    point.current.cx = cx;
    point.current.cy = cy;
    aimNow(id);
  }, [aimNow]);

  // Held near the top or foot of the screen, the board scrolls under the dragged widget, faster the nearer the edge: on
  // the UI thread, a frame at a time, so it glides; the place it would land is worked out again as it goes.
  const edgeDir = useSharedValue(0);
  const edgeFrame = useFrameCallback((f) => {
    const dir = edgeDir.value;
    if (!dir) return;
    const step = dir * EDGE_SPEED * Math.min(3, (f.timeSincePreviousFrame ?? 16) / 16);
    const to = Math.max(0, Math.min(scroll.max.value, scroll.y.value + step));
    if (Math.abs(to - scroll.y.value) >= 0.5) scrollTo(scroll.ref, 0, to, false);
  }, false);
  const edgeTimer = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const stopEdge = useCallback(() => {
    edgeDir.value = 0;
    edgeFrame.setActive(false);
    if (edgeTimer.current) clearInterval(edgeTimer.current);
    edgeTimer.current = null;
  }, [edgeFrame]);
  const edgeAt = useCallback((id: string, screenY: number, winH: number) => {
    const top = EDGE_ZONE + 40;
    const dir = screenY < top ? -(top - screenY) / top : screenY > winH - EDGE_ZONE ? (screenY - (winH - EDGE_ZONE)) / EDGE_ZONE : 0;
    if (!dir) {
      if (edgeTimer.current) stopEdge();
      return;
    }
    edgeDir.value = Math.max(-1, Math.min(1, dir));
    if (edgeTimer.current) return;
    edgeFrame.setActive(true);
    edgeTimer.current = setInterval(() => aimNow(id), 80);
  }, [aimNow, edgeFrame, stopEdge]);
  useEffect(() => stopEdge, [stopEdge]);

  const dragStart = useCallback((id: string, scrollAt: number) => {
    onDragging(true);
    const r = live.current.rects.get(id);
    point.current.scrollAt = scrollAt;
    if (r) aim(id, r.x + r.w / 2, r.y + r.h / 2);
  }, [aim, onDragging]);
  // a drag the system cancelled (keep false) puts the widget back where it was instead of dropping it
  const dragEnd = useCallback((id: string, keep = true) => {
    stopEdge();
    const d = live.current.drag;
    if (keep && d && d.id === id) settleDrop(id, d.col, d.index);
    setDrag(null);
    onDragging(false);
  }, [onDragging, settleDrop, stopEdge]);

  // Widgets picked in the gallery go on the board once its sheet has gone, so they rise into a board that is in view,
  // each with a soft wash of the accent to say where it went.
  const pending = React.useRef<GalleryPick[]>([]);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  const add = useCallback((picks: GalleryPick[]) => {
    pending.current = picks;
    setGallery(false);
  }, []);
  const placePending = useCallback(() => {
    const picks = pending.current;
    pending.current = [];
    if (!picks.length) return;
    let full = current();
    const added: string[] = [];
    let after = addAfter ? full.findIndex((x) => x.id === addAfter) : -1;
    for (const { def, size } of picks) {
      if (def.flow && full.some((w) => w.type === def.type)) continue;
      const w: TodayWidget = { id: uid(), type: def.type, size: def.sizes.includes(size) ? size : def.sizes[0] };
      full = insertWidget(full, w, after >= 0 ? after + 1 : full.length);
      if (after >= 0) after += 1;
      added.push(w.id);
    }
    if (!added.length) return;
    commit(full);
    // on a wide board they go beside the widget they were added after, in that widget's column, in the order picked
    const { columns: cols, count: n, colKey: key } = live.current;
    if (n > 1 && addAfter) {
      const ci = cols.findIndex((c) => c.includes(addAfter));
      if (ci >= 0) {
        let next = cols;
        added.forEach((id, i) => { next = moveInColumns(next, id, ci, cols[ci].indexOf(addAfter) + 1 + i); });
        setTodayColumns(key, next);
      }
    }
    setFresh(new Set(added));
  }, [addAfter, commit, setTodayColumns]);
  // the wash has played by then; a set kept longer would play it again if the board were rebuilt
  useEffect(() => {
    if (!fresh.size) return undefined;
    const t = setTimeout(() => setFresh(new Set()), 2200);
    return () => clearTimeout(t);
  }, [fresh]);
  // a section of Today's own taken off from the gallery, by its tick
  const removeType = useCallback((type: string) => {
    const w = current().find((x) => x.type === type);
    if (w) remove(w.id);
  }, [remove]);

  const setConfig = useCallback((id: string, patch: Record<string, unknown>) => {
    commit(current().map((w) => (w.id === id ? { ...w, config: { ...(w.config || {}), ...patch } } : w)));
  }, [commit]);

  const openGallery = (after: string | null) => {
    setAddAfter(after);
    setGallery(true);
  };
  const enterEdit = useCallback(() => { tap(); onEdit(true); }, [onEdit]);

  const onTypes = useMemo(() => new Set(layout.map((w) => w.type)), [layout]);
  const dragRect = drag ? rects.get(drag.id) : undefined;
  let enterAt = 1;
  return (
    <>
      <View style={{ height: boardH, width }}>
        {/* where the dragged widget will land: its place drawn in a fine line of the accent, flat on the material */}
        {dragRect ? (
          <Animated.View
            pointerEvents="none" entering={FadeIn.duration(160).easing(EASE_OUT)} exiting={FadeOut.duration(180)} layout={glide(level)}
            style={[
              st.landing,
              { left: dragRect.x, top: dragRect.y, width: dragRect.w, height: dragRect.h, borderColor: theme === 'minimal' ? MIN.border : C.accent },
            ]}
          />
        ) : null}
        {editing && !drag ? gaps.map((g) => (
          <Animated.View
            key={g.key} entering={FadeIn.duration(220).easing(EASE_OUT)} exiting={FadeOut.duration(140)}
            style={{ position: 'absolute', left: g.x, top: g.y, width: g.w, height: g.h }}
          >
            <Pressable
              onPress={() => openGallery(g.afterId)}
              style={({ pressed }) => [st.ghost, { flex: 1, borderColor: C.borderBright }, pressed && { opacity: 0.6 }]}
              accessibilityRole="button" accessibilityLabel="Add a widget here"
            >
              <Ionicons name="add" size={22} color={C.textFaint} />
              <Text style={st.ghostText} maxFontSizeMultiplier={CHROME_FONT_MAX}>Add</Text>
            </Pressable>
          </Animated.View>
        )) : null}
        {visible.map((w) => {
          const r = rects.get(w.id);
          if (!r) return null;
          const def = widgetDef(w.type)!;
          return (
            <BoardItem
              key={w.id} w={w} def={def} x={r.x} y={r.y} width={r.w} editing={editing} enter={Math.min(6, enterAt++)}
              fresh={fresh.has(w.id)}
              topOfColumn={count > 1 && r.y === 0}
              dragging={drag?.id === w.id} scroll={scroll}
              onMeasure={onMeasure} onRemove={remove} onResize={resize} onHold={enterEdit}
              onDragStart={dragStart} onAim={aim} onEdge={edgeAt} onDragEnd={dragEnd} setConfig={setConfig}
            />
          );
        })}
      </View>
      {editing ? (
        <Animated.View entering={FadeIn.duration(220).easing(EASE_OUT)} style={st.editKeys}>
          <PillButton label="Add widget" icon="add" onPress={() => openGallery(null)} />
          <PillButton label="Done" outline onPress={() => onEdit(false)} style={{ marginLeft: 14 }} />
        </Animated.View>
      ) : (
        <Pressable
          onPress={() => onEdit(true)} hitSlop={LINK_SLOP} style={st.editLink}
          accessibilityRole="button" accessibilityHint="Choose and arrange what Today shows"
        >
          <Ionicons name="grid-outline" size={14} color={C.textFaint} />
          <Text style={[st.link, { color: C.textFaint, marginLeft: 8 }]} maxFontSizeMultiplier={CHROME_FONT_MAX}>Edit Today</Text>
        </Pressable>
      )}
      <Gallery
        visible={gallery} onClose={() => setGallery(false)} onClosed={placePending} archived={archived} onTypes={onTypes}
        onAdd={add} onRemoveType={removeType} cellW={(colW - GRID_GAP) / 2} boardW={colW}
      />
    </>
  );
}

/**
 * One widget on the board, at the place the board gives it, gliding there when it changes. Resting, a hold (on a widget
 * with no hold of its own) starts editing the board. Edited, it settles to 0.97 inside a carved outline and takes no
 * touches itself: its remove well and size chip do, and a hold lifts it to be dragged, following the finger (and the
 * board, as it scrolls under it) until it is let go, when it glides into the place the board kept for it.
 */
const BoardItem = React.memo(function BoardItem({
  w, def, x, y, width, editing, enter, fresh, dragging, topOfColumn, scroll, onMeasure, onRemove, onResize, onHold,
  onDragStart, onAim, onEdge, onDragEnd, setConfig,
}: {
  w: TodayWidget; def: WidgetDef; x: number; y: number; width: number; editing: boolean; enter: number; dragging: boolean;
  /** just added from the gallery: it gives one soft wash of the accent */
  fresh: boolean;
  /** first in its column on a wide board: a heading at its top drops the space above it */
  topOfColumn: boolean;
  scroll: BoardScroll;
  onMeasure: (id: string, h: number) => void; onRemove: (id: string) => void; onResize: (id: string) => void;
  onHold: () => void; onDragStart: (id: string, scrollAt: number) => void; onAim: (id: string, cx: number, cy: number) => void;
  onEdge: (id: string, screenY: number, winH: number) => void; onDragEnd: (id: string, keep?: boolean) => void;
  setConfig: (id: string, patch: Record<string, unknown>) => void;
}) {
  const theme = useTheme();
  const level = useAnimLevel();
  const { height: winH } = useWindowDimensions();
  const settle = useSharedValue(editing ? 1 : 0);
  // where it rests on the board, and the drag: where it was picked up, how far the finger has gone, the scroll then
  const px = useSharedValue(x);
  const py = useSharedValue(y);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const scrollAt = useSharedValue(0);
  const held = useSharedValue(0);
  const lift = useSharedValue(0);
  const h = useSharedValue(0);
  const placed = React.useRef(false);

  useEffect(() => {
    settle.value = level === 'none' ? (editing ? 1 : 0) : withTiming(editing ? 1 : 0, { duration: 260, easing: EASE_OUT });
  }, [editing, level]);

  // a new place: glide there (its very first place, and any while the animation level is off, is simply taken)
  useEffect(() => {
    if (dragging) return;
    if (!placed.current || level === 'none') {
      px.value = x;
      py.value = y;
      placed.current = true;
      return;
    }
    if (held.value) {
      // just let go: land from where the finger left it
      const fromX = px.value + tx.value;
      const fromY = py.value + ty.value + (scroll.y.value - scrollAt.value);
      held.value = 0;
      tx.value = 0;
      ty.value = 0;
      px.value = fromX;
      py.value = fromY;
      px.value = withTiming(x, LAND);
      py.value = withTiming(y, LAND);
      lift.value = withTiming(0, LAND);
      return;
    }
    px.value = withTiming(x, MOVE);
    py.value = withTiming(y, MOVE);
  }, [x, y, dragging, level]);

  // the latest callbacks, for the gestures' JS ends
  const cb = React.useRef({ onHold, onDragStart, onAim, onEdge, onDragEnd });
  cb.current = { onHold, onDragStart, onAim, onEdge, onDragEnd };
  const id = w.id;
  const hold = useCallback(() => cb.current.onHold(), []);
  const start = useCallback((scrollAtStart: number) => { tap(); cb.current.onDragStart(id, scrollAtStart); }, [id]);
  const aimAt = useCallback((cx: number, cy: number, screenY: number) => {
    cb.current.onAim(id, cx, cy);
    cb.current.onEdge(id, screenY, winH);
  }, [id, winH]);
  const end = useCallback((keep: boolean) => cb.current.onDragEnd(id, keep), [id]);

  const gesture = useMemo(() => {
    if (editing) {
      return Gesture.Pan()
        .activateAfterLongPress(220)
        .onStart(() => {
          held.value = 1;
          scrollAt.value = scroll.y.value;
          lift.value = withTiming(1, { duration: 180, easing: EASE_OUT });
          runOnJS(start)(scrollAt.value);
        })
        .onUpdate((e) => {
          tx.value = e.translationX;
          ty.value = e.translationY;
          // the centre as the finger has moved it; the board adds how far it has scrolled since the pick-up
          const cx = px.value + e.translationX + width / 2;
          const cy = py.value + e.translationY + h.value / 2;
          runOnJS(aimAt)(cx, cy, e.absoluteY);
        })
        .onFinalize((_e, success) => {
          if (!held.value) return;
          runOnJS(end)(success);
        });
    }
    return Gesture.LongPress()
      .enabled(!def.ownHold)
      .minDuration(480)
      .onStart(() => { runOnJS(hold)(); });
  }, [editing, def.ownHold, hold, start, aimAt, end, width]);

  const place = useAnimatedStyle(() => {
    const ride = held.value ? scroll.y.value - scrollAt.value : 0;
    return {
      transform: [{ translateX: px.value + tx.value }, { translateY: py.value + ty.value + ride }] as const,
      zIndex: held.value || lift.value > 0.01 ? 10 : 0,
    };
  });
  const body = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - 0.03 * settle.value + 0.045 * lift.value }] as const,
    opacity: 1 - 0.06 * lift.value,
  }));
  // the ring that marks a widget being edited: a fine line of the accent that draws in as the board settles and goes
  // while the widget is held up
  const outline = useAnimatedStyle(() => ({
    opacity: 0.55 * settle.value * (1 - lift.value),
    transform: [{ scale: 1.012 - 0.012 * settle.value }] as const,
  }));
  const sizes = def.sizes;
  const box = def.flow ? null : { height: heightOf(w.size) };
  const setOwn = useCallback((patch: Record<string, unknown>) => setConfig(id, patch), [id, setConfig]);
  const Component = def.Component;
  return (
    <Animated.View
      style={[st.item, { width }, box, place]}
      onLayout={(e) => {
        const hh = e.nativeEvent.layout.height;
        h.value = hh;
        if (def.flow) onMeasure(id, hh);
      }}
    >
      <Enter index={enter}>
        <GestureDetector gesture={gesture}>
          <View collapsable={false} accessible={editing} accessibilityLabel={editing ? def.title : undefined}>
            {/* while the board is edited the widget stays on the material, ringed by a fine line of the accent */}
            <Animated.View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, st.outline, { borderColor: theme === 'minimal' ? MIN.border : C.accent }, outline]}
            />
            <Animated.View style={body} pointerEvents={editing ? 'none' : 'auto'}>
              {editing && def.flow ? <View style={st.flowPad} /> : null}
              <SectionTopTrim.Provider value={topOfColumn}>
                <Component id={w.id} size={w.size} config={w.config} editing={editing} preview={false} setConfig={setOwn} />
              </SectionTopTrim.Provider>
              <ArrivalPulse active={fresh} radius={S.radius} delay={420} />
            </Animated.View>
          </View>
        </GestureDetector>
      </Enter>
      {editing && !dragging ? (
        <>
          <Animated.View entering={ZoomIn.duration(220).easing(EASE_OUT)} exiting={ZoomOut.duration(140)} style={st.removeAt}>
            <Bouncy
              onPress={() => onRemove(w.id)} hitSlop={10} scaleTo={0.86} radius={14}
              style={[st.remove, theme === 'minimal' ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: MIN.border } : { backgroundColor: C.card, ...neuRaised('low') }]}
              accessibilityLabel={'Remove ' + def.title}
            >
              <Ionicons name="remove" size={16} color={C.danger} />
            </Bouncy>
          </Animated.View>
          {sizes.length > 1 ? (
            <Animated.View entering={ZoomIn.duration(220).delay(40).easing(EASE_OUT)} exiting={ZoomOut.duration(140)} style={st.sizeAt}>
              <Pressable
                onPress={() => onResize(w.id)} hitSlop={12} style={[st.sizeChip, { borderColor: C.outline, backgroundColor: C.card }]}
                accessibilityRole="button" accessibilityLabel={def.title + ', size ' + w.size} accessibilityHint="Changes its size"
              >
                <Text style={st.sizeText} maxFontSizeMultiplier={CHROME_FONT_MAX}>{w.size}</Text>
              </Pressable>
            </Animated.View>
          ) : null}
        </>
      ) : null}
    </Animated.View>
  );
});

/* ---------------------------------------------------------------- the gallery */

/** A widget picked in the gallery, in the size picked. */
interface GalleryPick { def: WidgetDef; size: TodayWidget['size'] }

/**
 * Adding widgets: per tool, each kind drawn live and scaled down in each size it comes in. An archived tool's are left
 * out. Each kind has Add, which puts it on the board at once, and a circle that picks it, so several can go on together:
 * with one picked, a Confirm key comes in at the sheet's top right, and a tap on a preview picks that size. One of
 * Today's own sections already on the board shows its circle ticked, quietly, in place of Add; a tap there takes it
 * off the board. The
 * previews are built once the sheet has risen.
 */
function Gallery({ visible, onClose, onClosed, archived, onTypes, onAdd, onRemoveType, cellW, boardW }: {
  visible: boolean; onClose: () => void; onClosed: () => void; archived: ReadonlySet<string>; onTypes: ReadonlySet<string>;
  onAdd: (picks: GalleryPick[]) => void; onRemoveType: (type: string) => void; cellW: number; boardW: number;
}) {
  const [ready, setReady] = useState(false);
  const [picked, setPicked] = useState<ReadonlyMap<string, TodayWidget['size']>>(() => new Map());
  useEffect(() => {
    if (!visible) setReady(false);
    else setPicked(new Map());
  }, [visible]);
  const groups = useMemo(() => galleryGroups(archived), [archived]);
  const { width: winW } = useWindowDimensions();
  const room = Math.min(winW, 560) - 48;
  // the previews read a sample day, made fresh each time the gallery opens, never the app's own data
  const sample = useMemo(() => (visible ? makeSampleStore() : null), [visible]);

  const toggle = (def: WidgetDef, size: TodayWidget['size']) => {
    tick();
    setPicked((m) => {
      const next = new Map(m);
      if (next.get(def.type) === size) next.delete(def.type);
      else next.set(def.type, size);
      return next;
    });
  };
  const picks = (): GalleryPick[] => {
    const out: GalleryPick[] = [];
    for (const g of groups) for (const def of g.defs) { const size = picked.get(def.type); if (size) out.push({ def, size }); }
    return out;
  };
  const confirm = () => { tap(); onAdd(picks()); };
  const addOne = (def: WidgetDef, size: TodayWidget['size']) => {
    tap();
    // anything already picked goes on with it
    onAdd([...picks().filter((x) => x.def.type !== def.type), { def, size }]);
  };

  return (
    <Sheet
      visible={visible} onClose={onClose} onClosed={onClosed} onRisen={() => setReady(true)} title="Add widgets"
      action={picked.size ? <ConfirmKey count={picked.size} onPress={confirm} /> : null}
    >
      <StoreOverride.Provider value={sample}>
      {groups.map((g) => (
        <View key={g.tool || 'app'} style={{ marginBottom: 26 }}>
          <Text style={[T.kicker, { marginBottom: 12 }]}>{g.tool ? toolByKey(g.tool)?.label ?? g.tool : 'Sturoids'}</Text>
          {g.defs.map((def) => {
            const on = !!def.flow && onTypes.has(def.type);
            const size = picked.get(def.type);
            return (
              <View key={def.type} style={st.galleryItem}>
                <View style={st.galleryHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={st.galleryTitle} maxFontSizeMultiplier={CHROME_FONT_MAX}>{def.title}</Text>
                    <Text style={T.caption} maxFontSizeMultiplier={CHROME_FONT_MAX}>{def.desc}</Text>
                  </View>
                  <View style={st.galleryKeys}>
                    {on ? null : (
                      <Animated.View entering={FadeIn.duration(200).easing(EASE_OUT)} exiting={FadeOut.duration(120)}>
                        <Pressable
                          onPress={() => addOne(def, size ?? def.sizes[0])} hitSlop={LINK_SLOP}
                          accessibilityRole="button" accessibilityLabel={'Add ' + def.title}
                        >
                          <Text style={[st.link, { color: C.accent }]} maxFontSizeMultiplier={CHROME_FONT_MAX}>Add</Text>
                        </Pressable>
                      </Animated.View>
                    )}
                    <PickCircle
                      state={on ? 'on' : size ? 'picked' : 'off'}
                      onPress={() => (on ? (tap(), onRemoveType(def.type)) : toggle(def, size ?? def.sizes[0]))}
                      label={on ? def.title + ' is on Today. Remove it' : 'Pick ' + def.title}
                    />
                  </View>
                </View>
                <View style={st.previews}>
                  {def.sizes.map((sz) => (
                    <Preview
                      key={sz} def={def} size={sz} ready={ready} room={room} cellW={cellW} boardW={boardW}
                      picked={size === sz}
                      onPress={on ? undefined : () => (picked.size ? toggle(def, sz) : addOne(def, sz))}
                    />
                  ))}
                </View>
              </View>
            );
          })}
        </View>
      ))}
      </StoreOverride.Provider>
    </Sheet>
  );
}

/**
 * The circle beside Add. Empty: a tap picks the widget, and it fills with the accent and a tick. A section already on
 * Today shows it ticked but quiet (no accent): a tap takes that section off, and it eases back to empty.
 */
function PickCircle({ state, onPress, label }: { state: 'off' | 'picked' | 'on'; onPress: () => void; label: string }) {
  const level = useAnimLevel();
  const fill = useSharedValue(state === 'off' ? 0 : 1);
  const settle = useSharedValue(1);
  const was = React.useRef(state);
  useEffect(() => {
    if (was.current === state) return;
    const from = was.current;
    was.current = state;
    const to = state === 'off' ? 0 : 1;
    if (level === 'none') { fill.value = to; return; }
    fill.value = withTiming(to, { duration: to ? 200 : 160, easing: EASE_OUT });
    if (state === 'picked' && from === 'off' && level === 'full') {
      settle.value = withSequence(
        withTiming(1.14, { duration: 130, easing: EASE_OUT }),
        withTiming(1, { duration: 200, easing: Easing.inOut(Easing.quad) }),
      );
    }
  }, [state, level]);
  const ring = useAnimatedStyle(() => ({ opacity: 1 - fill.value }));
  const dot = useAnimatedStyle(() => ({ opacity: fill.value, transform: [{ scale: (0.55 + 0.45 * fill.value) * settle.value }] }));
  return (
    <Bouncy
      onPress={onPress} scaleTo={0.84} radius={13} hitSlop={12}
      accessibilityRole="checkbox" accessibilityState={{ checked: state !== 'off' }} accessibilityLabel={label}
    >
      <View style={st.pick}>
        <Animated.View style={[StyleSheet.absoluteFill, st.pick, ring]}>
          <Ionicons name="ellipse-outline" size={24} color={C.textFaint} />
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, st.pick, dot]}>
          <Ionicons name="checkmark-circle" size={24} color={state === 'on' ? C.textFaint : C.accent} />
        </Animated.View>
      </View>
    </Bouncy>
  );
}

/** The sheet's Confirm: it comes in from the right as the first widget is picked, and counts them. */
function ConfirmKey({ count, onPress }: { count: number; onPress: () => void }) {
  return (
    <Animated.View entering={confirmIn} exiting={FadeOut.duration(140)}>
      <Bouncy
        onPress={onPress} scaleTo={0.94} radius={999}
        style={[st.confirm, { backgroundColor: C.accent }]}
        accessibilityLabel={'Add ' + count + (count === 1 ? ' widget' : ' widgets')}
      >
        <Text style={[st.confirmText, { color: C.onAccent }]} maxFontSizeMultiplier={CHROME_FONT_MAX}>Confirm</Text>
        <View style={[st.confirmCount, { backgroundColor: C.onAccent }]}>
          <FadeSwap swapKey={String(count)}>
            <Text style={[st.confirmCountText, { color: C.accent }]} maxFontSizeMultiplier={CHROME_FONT_MAX}>{count}</Text>
          </FadeSwap>
        </View>
      </Bouncy>
    </Animated.View>
  );
}

const confirmIn = (): any => {
  'worklet';
  const ease = { duration: 280, easing: Easing.bezier(0.16, 1, 0.3, 1) };
  return {
    initialValues: { opacity: 0, transform: [{ translateX: 14 }, { scale: 0.92 }] },
    animations: {
      opacity: withTiming(1, { duration: 200 }),
      transform: [{ translateX: withTiming(0, ease) }, { scale: withTiming(1, ease) }],
    },
  };
};

/** a flow section's preview shows at most this much of it, before scaling */
const FLOW_PREVIEW_H = 240;
/** the room a preview keeps around itself, so a raised tile's light and shadow are never cut */
const PREVIEW_PAD = 12;

/**
 * One widget drawn at its board size over the gallery's sample day, scaled to fit the sheet, on the sheet's own material:
 * raised only if it is raised on Today, flat if it sits flat there. It takes no touches itself; a tap on it adds it (or,
 * with widgets picked, picks this size), and a picked size is ringed in the accent.
 */
function Preview({ def, size, ready, room, cellW, boardW, picked, onPress }: {
  def: WidgetDef; size: TodayWidget['size']; ready: boolean; room: number; cellW: number; boardW: number;
  picked: boolean; onPress?: () => void;
}) {
  const level = useAnimLevel();
  const small = size === 'S' && !def.flow;
  const natW = small ? Math.max(150, cellW) : Math.max(300, boardW);
  const natH = def.flow ? FLOW_PREVIEW_H : heightOf(size);
  const scale = Math.min(small ? 0.8 : 0.74, (room - PREVIEW_PAD * 2) / natW);
  const Component = def.Component;
  const noop = useCallback(() => {}, []);
  const w = natW * scale + PREVIEW_PAD * 2;
  const h = natH * scale + PREVIEW_PAD * 2;
  const on = useSharedValue(picked ? 1 : 0);
  useEffect(() => {
    on.value = level === 'none' ? (picked ? 1 : 0) : withTiming(picked ? 1 : 0, { duration: 200, easing: EASE_OUT });
  }, [picked, level]);
  const ring = useAnimatedStyle(() => ({ opacity: on.value, transform: [{ scale: 1.03 - 0.03 * on.value }] }));
  return (
    <Bouncy
      onPress={onPress} disabled={!onPress} scaleTo={0.97} radius={S.radius}
      style={[st.preview, { width: w, height: h }]}
      accessibilityLabel={(picked ? 'Picked: ' : 'Add ') + def.title + (def.sizes.length > 1 ? ', size ' + size : '')}
    >
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, st.outline, { margin: 2, borderColor: C.accent }, ring]} />
      <View pointerEvents="none" style={{ width: natW * scale, height: natH * scale, overflow: def.flow ? 'hidden' : 'visible' }}>
        {ready ? (
          <Animated.View
            entering={FadeIn.duration(260).easing(EASE_OUT)}
            style={{ width: natW, height: natH, transform: [{ scale }], transformOrigin: 'top left' }}
          >
            <Component id={'preview-' + def.type} size={size} editing preview setConfig={noop} />
          </Animated.View>
        ) : null}
      </View>
    </Bouncy>
  );
}

const st = StyleSheet.create({
  header: { position: 'relative' },
  headTop: { flexDirection: 'row', alignItems: 'flex-start' },
  headAction: { marginLeft: 12, minHeight: 24, justifyContent: 'center' },
  // the flat search glyph: no well, level with the date
  search: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', marginTop: -6, marginRight: -6 },
  link: { fontFamily: F.semi, fontSize: 13, letterSpacing: TRACK.small },
  nudgeHead: { flexDirection: 'row', alignItems: 'center' },
  nudgeKeys: { flexDirection: 'row', alignItems: 'center', marginTop: 16 },
  item: { position: 'absolute', left: 0, top: 0 },
  landing: { position: 'absolute', borderRadius: S.radius + 2, borderWidth: 1.5, borderStyle: 'dashed', opacity: 0.7 },
  outline: { borderRadius: S.radius + 4, margin: -5, borderWidth: 1.5 },
  flowPad: { height: 4 },
  ghost: {
    borderWidth: 1, borderStyle: 'dashed', borderRadius: S.radius, alignItems: 'center', justifyContent: 'center', gap: 4,
  },
  ghostText: { color: C.textFaint, fontFamily: F.smMed, ...oneLine(12), letterSpacing: TRACK.fine },
  removeAt: { position: 'absolute', top: -10, left: -10, zIndex: 20 },
  remove: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  sizeAt: { position: 'absolute', top: -10, right: -6, zIndex: 20 },
  sizeChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  sizeText: { color: C.textDim, fontFamily: F.smSemi, ...oneLine(11), letterSpacing: TRACK.caps },
  editKeys: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: S.section - S.gap },
  editLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginTop: S.section - S.gap, paddingVertical: 6 },
  galleryItem: { marginBottom: 20 },
  galleryHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  galleryKeys: { flexDirection: 'row', alignItems: 'center', marginLeft: 12, gap: 14 },
  pick: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  confirm: { flexDirection: 'row', alignItems: 'center', borderRadius: 999, paddingLeft: 14, paddingRight: 6, height: 32 },
  confirmText: { fontFamily: F.semi, ...oneLine(13), letterSpacing: TRACK.small },
  confirmCount: { minWidth: 20, height: 20, borderRadius: 10, marginLeft: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  confirmCountText: { fontFamily: F.smSemi, ...oneLine(11) },
  galleryTitle: { color: C.text, fontFamily: F.semi, fontSize: 15, letterSpacing: TRACK.body },
  previews: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  preview: { borderRadius: S.radius, padding: PREVIEW_PAD },
});
