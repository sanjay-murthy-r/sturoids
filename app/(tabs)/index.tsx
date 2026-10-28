import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Pressable, InteractionManager, BackHandler, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from 'expo-router';
import { useIsFocused, useScrollToTop } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn, FadeOut, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { C, CHROME_FONT_MAX, F, MIN, S, T, TRACK, neuInset, oneLine } from '../../src/theme';
import { useStore, FocusSession, Habit, PlannerWeek, TodayWidget, hasAnyUserData } from '../../src/store';
import { fmtDate, uid } from '../../src/utils';
import { Card, PillButton, PullPill, ScreenBG, Sheet, useHeaderPull, useTheme } from '../../src/components/UI';
import { EASE_OUT, Enter, FadeSwap, glide, useAnimLevel, useFocusKey } from '../../src/components/Motion';
import { toast } from '../../src/components/Toast';
import { tap } from '../../src/haptics';
import { normaliseSlots, toolByKey } from '../../src/tools';
import { openPage } from '../../src/toolNav';
import { useGreeting } from '../../src/greeting';
import { useIntro } from '../../src/intro';
import { useNow } from '../../src/hooks/useNow';
import { TWO_COL_AT, WIDE_MAX, columnWidth } from '../../src/layout';
import { useProfiles } from '../../src/profiles';
import { ProfileSwitcher } from '../../src/components/ProfileSwitcher';
import { openSift } from '../../src/search/store';
import { BACKUP_ATTENTION_TEXT, useBackupAttention, useCloud } from '../../src/cloud';
import { readLastExport, shouldNudgeBackup } from '../../src/backupNudge';
import { BoardNow, NudgeRow } from '../../src/widgets/kit';
import { useTodayItems, useNextBlock } from '../../src/widgets/data';
import {
  CELL_H, DEFAULT_LAYOUT, GRID_GAP, fitLayout, heightOf, insertWidget, moveWidget, nextSize, packBoard, removeWidget,
  spanOf,
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
  const [areaW, setAreaW] = useState(() => columnWidth(dayWinW, true, WIDE_MAX));
  const now = useNow();
  const scrollRef = React.useRef<ScrollView>(null);
  useScrollToTop(scrollRef);

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

  const cols = areaW >= TWO_COL_AT ? 4 : 2;
  return (
    <ScreenBG guard maxWidth={WIDE_MAX}>
      <BoardNow.Provider value={now}>
        <ScrollView
          key={fk}
          ref={scrollRef}
          scrollEnabled={!dragging}
          onLayout={(e) => setAreaW(e.nativeEvent.layout.width)}
          contentContainerStyle={{ padding: S.pad, paddingTop: insets.top + 20, paddingBottom: 44 }}
          showsVerticalScrollIndicator={false}
        >
          {header}
          <SystemBanners />
          <Board
            cols={cols} width={Math.max(0, areaW - S.pad * 2)} editing={editing} archived={archived}
            onEdit={setEditing} onDragging={setDragging}
          />
        </ScrollView>
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

/** where a widget sits inside the board, as last laid out */
type Rect = { x: number; y: number; w: number; h: number };

/**
 * Today's widgets, packed into rows of cells in their order (2 on a phone, 4 on a wide window). The layout is the saved
 * one, or Today's own arrangement until it is first edited; an archived tool's widgets keep their place but are not
 * shown. Editing settles each widget inside a carved outline with a remove well (and a size chip where it has several
 * sizes); holding one and dragging moves it, its neighbours gliding into place.
 */
function Board({ cols, width, editing, archived, onEdit, onDragging }: {
  cols: number; width: number; editing: boolean; archived: ReadonlySet<string>;
  onEdit: (on: boolean) => void; onDragging: (on: boolean) => void;
}) {
  const level = useAnimLevel();
  const saved = useStore((s) => s.todayLayout);
  const setTodayLayout = useStore((s) => s.setTodayLayout);
  const [gallery, setGallery] = useState(false);
  // where the gallery adds: after this widget (a gap's row), or at the end
  const [addAfter, setAddAfter] = useState<string | null>(null);
  const layout = useMemo(() => fitLayout(saved ?? DEFAULT_LAYOUT, sizesOf), [saved]);
  const visible = useMemo(
    () => layout.filter((w) => { const d = widgetDef(w.type); return !!d && widgetShown(d, archived); }),
    [layout, archived],
  );
  const spanFor = useCallback((w: TodayWidget) => {
    const def = widgetDef(w.type)!;
    return spanOf(def.flow ? 'M' : w.size, cols);
  }, [cols]);
  const slots = useMemo(() => packBoard(visible.map((w) => ({ id: w.id, span: spanFor(w) })), cols), [visible, spanFor, cols]);
  const cellW = Math.max(0, Math.floor(((width - GRID_GAP * (cols - 1)) / cols) * 100) / 100);
  const widthOf = (span: number) => cellW * span + GRID_GAP * (span - 1);

  // the latest of each, for callbacks handed to gestures and toasts
  const rects = React.useRef(new Map<string, Rect>());
  const visibleRef = React.useRef(visible);
  visibleRef.current = visible;

  const setRect = useCallback((id: string, r: Rect) => { rects.current.set(id, r); }, []);
  const commit = useCallback((next: TodayWidget[]) => setTodayLayout(next), [setTodayLayout]);
  const current = () => fitLayout(useStore.getState().todayLayout ?? DEFAULT_LAYOUT, sizesOf);

  const remove = useCallback((id: string) => {
    const { list, removed, index } = removeWidget(current(), id);
    if (!removed) return;
    commit(list);
    const name = widgetDef(removed.type)?.title || 'Widget';
    toast(name + ' removed', {
      label: 'Undo',
      onPress: () => commit(insertWidget(current(), removed, index)),
    });
  }, [commit]);

  const resize = useCallback((id: string) => {
    commit(current().map((w) => {
      if (w.id !== id) return w;
      const sizes = sizesOf(w.type) || [w.size];
      return { ...w, size: nextSize(sizes, w.size) };
    }));
  }, [commit]);

  // a drop moves the widget to the place under its centre (or the nearest), among the widgets shown; hidden ones keep
  // their places in the saved list
  const drop = useCallback((id: string, dx: number, dy: number) => {
    const vis = visibleRef.current;
    const from = vis.findIndex((w) => w.id === id);
    const r = rects.current.get(id);
    if (from < 0 || !r) return;
    const cx = r.x + r.w / 2 + dx;
    const cy = r.y + r.h / 2 + dy;
    let to = from;
    let best = Infinity;
    vis.forEach((w, i) => {
      const o = rects.current.get(w.id);
      if (!o) return;
      if (cx >= o.x && cx <= o.x + o.w && cy >= o.y && cy <= o.y + o.h) { to = i; best = -1; return; }
      if (best < 0) return;
      const d = Math.hypot(o.x + o.w / 2 - cx, o.y + o.h / 2 - cy);
      if (d < best) { best = d; to = i; }
    });
    if (to === from) return;
    const moved = moveWidget(vis, from, to);
    const full = current();
    const shownIds = new Set(vis.map((w) => w.id));
    let i = 0;
    commit(full.map((w) => (shownIds.has(w.id) ? moved[i++] : w)));
  }, [commit]);

  const add = useCallback((def: WidgetDef) => {
    const full = current();
    if (def.flow && full.some((w) => w.type === def.type)) return;
    const w: TodayWidget = { id: uid(), type: def.type, size: def.sizes[0] };
    const after = addAfter ? full.findIndex((x) => x.id === addAfter) : -1;
    commit(insertWidget(full, w, after >= 0 ? after + 1 : full.length));
    setGallery(false);
  }, [addAfter, commit]);

  const setConfig = useCallback((id: string, patch: Record<string, unknown>) => {
    commit(current().map((w) => (w.id === id ? { ...w, config: { ...(w.config || {}), ...patch } } : w)));
  }, [commit]);

  const openGallery = (after: string | null) => {
    setAddAfter(after);
    setGallery(true);
  };
  const enterEdit = useCallback(() => { tap(); onEdit(true); }, [onEdit]);

  const onTypes = useMemo(() => new Set(layout.map((w) => w.type)), [layout]);
  let enterAt = 1;
  return (
    <>
      <View style={[st.board, { columnGap: GRID_GAP }]}>
        {slots.map((slot) => {
          if (slot.kind === 'gap') {
            if (!editing) return null;
            // a gap's widget is the one before it on its row
            const before = slots.filter((x) => x.kind === 'widget' && x.row === slot.row).pop();
            return (
              <Animated.View key={slot.key} entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)} layout={glide(level)}>
                <Pressable
                  onPress={() => openGallery(before && before.kind === 'widget' ? before.id : null)}
                  style={[st.ghost, { width: widthOf(slot.span), height: CELL_H, borderColor: C.borderBright }]}
                  accessibilityRole="button" accessibilityLabel="Add a widget here"
                >
                  <Ionicons name="add" size={22} color={C.textFaint} />
                  <Text style={st.ghostText} maxFontSizeMultiplier={CHROME_FONT_MAX}>Add</Text>
                </Pressable>
              </Animated.View>
            );
          }
          const w = visible.find((x) => x.id === slot.id)!;
          const def = widgetDef(w.type)!;
          return (
            <BoardItem
              key={w.id} w={w} def={def} width={widthOf(slot.span)} editing={editing} enter={Math.min(6, enterAt++)}
              onRect={setRect} onRemove={remove} onResize={resize} onDrop={drop}
              onHold={enterEdit} onDragging={onDragging} setConfig={setConfig}
            />
          );
        })}
      </View>
      {editing ? (
        <Animated.View entering={FadeIn.duration(200)} style={st.editKeys}>
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
        visible={gallery} onClose={() => setGallery(false)} archived={archived} onTypes={onTypes} onAdd={add}
        cellW={cellW} boardW={width}
      />
    </>
  );
}

/**
 * One widget on the board. Resting, a hold (on a widget with no hold of its own) starts editing the board. Edited, it
 * settles to 0.97 inside a carved outline and takes no touches itself: its remove well and size chip do, and a hold
 * then a drag moves it.
 */
const BoardItem = React.memo(function BoardItem({
  w, def, width, editing, enter, onRect, onRemove, onResize, onDrop, onHold, onDragging, setConfig,
}: {
  w: TodayWidget; def: WidgetDef; width: number; editing: boolean; enter: number;
  onRect: (id: string, r: Rect) => void; onRemove: (id: string) => void; onResize: (id: string) => void;
  onDrop: (id: string, dx: number, dy: number) => void; onHold: () => void; onDragging: (on: boolean) => void;
  setConfig: (id: string, patch: Record<string, unknown>) => void;
}) {
  const theme = useTheme();
  const level = useAnimLevel();
  const settle = useSharedValue(editing ? 1 : 0);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const lift = useSharedValue(0);
  useEffect(() => {
    settle.value = level === 'none' ? (editing ? 1 : 0) : withTiming(editing ? 1 : 0, { duration: 240, easing: EASE_OUT });
  }, [editing, level]);
  // the latest callbacks, for the gestures' JS ends
  const cb = React.useRef({ onDrop, onHold, onDragging });
  cb.current = { onDrop, onHold, onDragging };
  const id = w.id;
  const hold = useCallback(() => cb.current.onHold(), []);
  const dragOn = useCallback((on: boolean) => cb.current.onDragging(on), []);
  const dropAt = useCallback((dx: number, dy: number) => cb.current.onDrop(id, dx, dy), [id]);

  const gesture = useMemo(() => {
    if (editing) {
      return Gesture.Pan()
        .activateAfterLongPress(220)
        .onStart(() => {
          lift.value = withTiming(1, { duration: 160, easing: EASE_OUT });
          runOnJS(dragOn)(true);
        })
        .onUpdate((e) => {
          tx.value = e.translationX;
          ty.value = e.translationY;
        })
        .onEnd((e) => {
          runOnJS(dropAt)(e.translationX, e.translationY);
        })
        .onFinalize(() => {
          // the widget eases from where it was let go into its new place, as the layout glides it there
          tx.value = withTiming(0, { duration: 260, easing: EASE_OUT });
          ty.value = withTiming(0, { duration: 260, easing: EASE_OUT });
          lift.value = withTiming(0, { duration: 200, easing: EASE_OUT });
          runOnJS(dragOn)(false);
        });
    }
    return Gesture.LongPress()
      .enabled(!def.ownHold)
      .minDuration(480)
      .onStart(() => { runOnJS(hold)(); });
  }, [editing, def.ownHold, hold, dragOn, dropAt]);

  const body = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: 1 - 0.03 * settle.value + 0.03 * lift.value },
    ] as const,
  }));
  const outline = useAnimatedStyle(() => ({ opacity: settle.value }));
  const front = useAnimatedStyle(() => ({ zIndex: lift.value > 0 ? 10 : 0 }));
  const sizes = def.sizes;
  const flowBox = def.flow ? null : { height: heightOf(w.size), marginBottom: GRID_GAP };
  const setOwn = useCallback((patch: Record<string, unknown>) => setConfig(id, patch), [id, setConfig]);
  const Component = def.Component;
  return (
    <Animated.View
      layout={glide(level)} style={[{ width }, flowBox, front]}
      onLayout={(e) => { const l = e.nativeEvent.layout; onRect(w.id, { x: l.x, y: l.y, w: l.width, h: l.height }); }}
    >
      <Enter index={enter}>
        <GestureDetector gesture={gesture}>
          <View collapsable={false} accessible={editing} accessibilityLabel={editing ? def.title : undefined}>
            {/* the carved outline the widget settles into while the board is edited */}
            <Animated.View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill, st.outline,
                theme === 'minimal' ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border } : { backgroundColor: C.inset, ...neuInset('low') },
                outline,
              ]}
            />
            <Animated.View style={body} pointerEvents={editing ? 'none' : 'auto'}>
              {editing && def.flow ? <View style={st.flowPad} /> : null}
              <Component
                id={w.id} size={w.size} config={w.config} editing={editing} preview={false} setConfig={setOwn}
              />
            </Animated.View>
          </View>
        </GestureDetector>
      </Enter>
      {editing ? (
        <>
          <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)} style={st.removeAt}>
            <Pressable
              onPress={() => onRemove(w.id)} hitSlop={10}
              style={[st.remove, theme === 'minimal' ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border } : { backgroundColor: C.inset, ...neuInset('hairline') }]}
              accessibilityRole="button" accessibilityLabel={'Remove ' + def.title}
            >
              <Ionicons name="remove" size={16} color={C.danger} />
            </Pressable>
          </Animated.View>
          {sizes.length > 1 ? (
            <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)} style={st.sizeAt}>
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

/**
 * Adding a widget: per tool, each kind drawn live and scaled down in each size it comes in. An archived tool's are left
 * out; one of Today's own sections already on the board says so. The previews are built once the sheet has risen.
 */
function Gallery({ visible, onClose, archived, onTypes, onAdd, cellW, boardW }: {
  visible: boolean; onClose: () => void; archived: ReadonlySet<string>; onTypes: ReadonlySet<string>;
  onAdd: (def: WidgetDef) => void; cellW: number; boardW: number;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => { if (!visible) setReady(false); }, [visible]);
  const groups = useMemo(() => galleryGroups(archived), [archived]);
  const { width: winW } = useWindowDimensions();
  const room = Math.min(winW, 560) - 48;
  return (
    <Sheet visible={visible} onClose={onClose} onRisen={() => setReady(true)} title="Add a widget">
      {groups.map((g) => (
        <View key={g.tool || 'app'} style={{ marginBottom: 26 }}>
          <Text style={[T.kicker, { marginBottom: 12 }]}>{g.tool ? toolByKey(g.tool)?.label ?? g.tool : 'Sturoids'}</Text>
          {g.defs.map((def) => {
            const on = !!def.flow && onTypes.has(def.type);
            return (
              <View key={def.type} style={st.galleryItem}>
                <View style={st.galleryHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={st.galleryTitle} maxFontSizeMultiplier={CHROME_FONT_MAX}>{def.title}</Text>
                    <Text style={T.caption} maxFontSizeMultiplier={CHROME_FONT_MAX}>{def.desc}</Text>
                  </View>
                  {on ? (
                    <Text style={[st.link, { color: C.textFaint }]} maxFontSizeMultiplier={CHROME_FONT_MAX}>On Today</Text>
                  ) : (
                    <Pressable
                      onPress={() => onAdd(def)} hitSlop={LINK_SLOP}
                      accessibilityRole="button" accessibilityLabel={'Add ' + def.title}
                    >
                      <Text style={[st.link, { color: C.accent }]} maxFontSizeMultiplier={CHROME_FONT_MAX}>Add</Text>
                    </Pressable>
                  )}
                </View>
                <View style={st.previews}>
                  {def.sizes.map((size) => (
                    <Preview key={size} def={def} size={size} ready={ready} room={room} cellW={cellW} boardW={boardW} onPress={on ? undefined : () => onAdd(def)} />
                  ))}
                </View>
              </View>
            );
          })}
        </View>
      ))}
    </Sheet>
  );
}

/** a flow section's preview shows at most this much of it, before scaling */
const FLOW_PREVIEW_H = 240;

/** One widget drawn live at its board size, scaled to fit the sheet; it takes no touches, a tap on it adds it. */
function Preview({ def, size, ready, room, cellW, boardW, onPress }: {
  def: WidgetDef; size: TodayWidget['size']; ready: boolean; room: number; cellW: number; boardW: number; onPress?: () => void;
}) {
  const natW = size === 'S' && !def.flow ? Math.max(140, cellW) : Math.max(280, boardW);
  const natH = def.flow ? FLOW_PREVIEW_H : heightOf(size);
  const scale = Math.min(size === 'S' && !def.flow ? 0.8 : 0.72, room / natW);
  const Component = def.Component;
  const noop = useCallback(() => {}, []);
  return (
    <Pressable
      onPress={onPress} disabled={!onPress} style={{ width: natW * scale, height: natH * scale }}
      accessibilityRole="button" accessibilityLabel={'Add ' + def.title + (def.sizes.length > 1 ? ', size ' + size : '')}
      importantForAccessibility={onPress ? 'auto' : 'no-hide-descendants'}
    >
      <View pointerEvents="none" style={[st.previewClip, { width: natW * scale, height: natH * scale }]}>
        {ready ? (
          <Animated.View
            entering={FadeIn.duration(200)}
            style={{ width: natW, height: natH, transform: [{ scale }], transformOrigin: 'top left' }}
          >
            <Component id={'preview-' + def.type} size={size} editing preview setConfig={noop} />
          </Animated.View>
        ) : null}
      </View>
    </Pressable>
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
  board: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start' },
  outline: { borderRadius: S.radius + 2, margin: -4 },
  flowPad: { height: 4 },
  ghost: {
    borderWidth: 1, borderStyle: 'dashed', borderRadius: S.radius, alignItems: 'center', justifyContent: 'center',
    marginBottom: GRID_GAP, gap: 4,
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
  galleryHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  galleryTitle: { color: C.text, fontFamily: F.semi, fontSize: 15, letterSpacing: TRACK.body },
  previews: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  previewClip: { overflow: 'hidden', borderRadius: 12 },
});
