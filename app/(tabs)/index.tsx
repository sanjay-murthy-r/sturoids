import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Pressable, InteractionManager, BackHandler, PixelRatio, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from 'expo-router';
import { useIsFocused, useScrollToTop } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  FadeIn, FadeOut, ZoomIn, ZoomOut, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { C, F, MIN, S, T, TRACK, neuInset } from '../../src/theme';
import { useStore, QuickItem, FocusSession, Habit, PlannerWeek } from '../../src/store';
import { uid, fmtDate, todayKey, dayName, DAY_NAMES, toMinutes, fmtClockTime, daysUntil } from '../../src/utils';
import {
  ScreenBG, Card, SectionTitle, CheckCircle, Sheet, Field, PillButton, EmptyState, Row, Hairline, Chip,
  ListCard, ListRow, ProgressBar, StrikeText, useTheme,
} from '../../src/components/UI';
import {
  CHANGE, CountUp, EASE_OUT, Enter, Bouncy, FadeSwap, RISE_OUT, glide, rowOut, useAnimLevel, useFocusKey,
} from '../../src/components/Motion';
import { useSwapIn } from '../../src/components/Swap';
import { QuickTaskSheet } from '../../src/components/QuickTaskSheet';
import { toast } from '../../src/components/Toast';
import { tap } from '../../src/haptics';
import { ROUTE_CATALOG, launchExternal, sameSite, siteHost, siteName, siteUrl } from '../../src/quickAccess';
import { ToolKey, colorOf, normaliseSlots, toolByKey } from '../../src/tools';
import { openPage, openTool } from '../../src/toolNav';
import { useGreeting } from '../../src/greeting';
import { useIntro } from '../../src/intro';
import { journalDayFor } from '../../src/journal';
import { indexScores, upcoming, groupSummary, fmtPct, fromToday } from '../../src/scores';
import { useNow } from '../../src/hooks/useNow';
import { TWO_COL_AT, WIDE_AT, WIDE_MAX, columnWidth } from '../../src/layout';

// what the greeting is told about a tool that is archived: nothing, so it never speaks of what the user put away
const NO_SESSIONS: FocusSession[] = [];
const NO_HABITS: Habit[] = [];
const NO_PLAN = {} as PlannerWeek;

/**
 * A figure that changed while Today was out of sight is held where it was, and moves to its new value once Today is back
 * in view: the count or the bar plays where it can be seen, not behind another tab.
 */
function useWhenSeen<T>(value: T): T {
  const focused = useIsFocused();
  const held = React.useRef(value);
  if (focused) held.current = value;
  return held.current;
}

/** A count that waits for Today to be in view before it moves to a new figure. */
function SeenCount(props: React.ComponentProps<typeof CountUp>) {
  const value = useWhenSeen(props.value);
  return <CountUp {...props} value={value} />;
}

/** A shortcut to an archived tool stays in the saved list but is not shown. */
const hiddenTile = (q: QuickItem, archived: ReadonlySet<string>) => q.kind === 'tool' && archived.has(q.target);

/**
 * Long-term tasks ticked on Today's list, by the day they were ticked. They stay on the list, struck through and
 * counted as done, until the day turns, so a tick never makes the row vanish and a mis-tap is undone in place. A task
 * keeps no day it was done on, so this lives as long as the app is open.
 */
const tickedOnToday = new Map<string, string>();

/** a 13 pt text link reaches a 44 dp target without moving anything around it */
const LINK_SLOP = { top: 14, bottom: 14, left: 10, right: 10 };

/** "3 hours 20 minutes", for a screen reader */
function spokenMinutes(m: number) {
  const h = Math.floor(m / 60);
  const rest = m % 60;
  const parts = [h ? h + (h === 1 ? ' hour' : ' hours') : '', rest ? rest + (rest === 1 ? ' minute' : ' minutes') : ''];
  return parts.filter(Boolean).join(' ') || '0 minutes';
}

export default function Today() {
  const insets = useSafeAreaInsets();
  const fk = useFocusKey();
  const theme = useTheme();
  // only what Today shows is selected, so a save elsewhere (a journal page being written) never re-renders the day
  const name = useStore((s) => s.settings.name);
  const archivedTools = useStore((s) => s.settings.archivedTools);
  const journalLocked = useStore((s) => s.settings.journalLocked);
  const journalCutoffHour = useStore((s) => s.settings.journalCutoffHour);
  const notesLocked = useStore((s) => s.settings.notesLocked === true);
  const hour24 = useStore((s) => s.settings.hour24);
  const dailyTasks = useStore((s) => s.dailyTasks);
  const toggleDaily = useStore((s) => s.toggleDaily);
  const missions = useStore((s) => s.missions);
  const toggleMission = useStore((s) => s.toggleMission);
  const habits = useStore((s) => s.habits);
  const toggleHabitToday = useStore((s) => s.toggleHabitToday);
  const planner = useStore((s) => s.planner);
  const sessions = useStore((s) => s.sessions);
  const quickAccess = useStore((s) => s.quickAccess);
  const noteCount = useStore((s) => s.notes.length);
  const videoCount = useStore((s) => s.vaultVideos.length);
  const scores = useStore((s) => s.scores);
  const setQuickAccess = useStore((s) => s.setQuickAccess);
  // the Deep Work session in flight, as the plain values its time is worked out from
  const dwOn = useStore((s) => !!s.deepWork);
  const dwRunning = useStore((s) => !!s.deepWork?.running);
  const dwStartTs = useStore((s) => s.deepWork?.startTs ?? null);
  const dwAccumSec = useStore((s) => s.deepWork?.accumSec ?? 0);
  const dwStartedAt = useStore((s) => s.deepWork?.startedAt ?? 0);
  const dwCapSec = useStore((s) => (s.deepWork?.mode === 'countdown' ? s.deepWork.targetMin * 60 : Infinity));

  const [nameSheet, setNameSheet] = useState(false);
  const [qaEdit, setQaEdit] = useState(false);
  const [qaAddSheet, setQaAddSheet] = useState(false);
  // the website shortcut the add sheet is editing; kept while the sheet closes, so its words never change mid-way
  const [qaEditing, setQaEditing] = useState<QuickItem | null>(null);
  const [taskSheet, setTaskSheet] = useState(false);
  // the day's column, known ahead on a wide window (so two columns appear on the first frame), then measured
  const { width: dayWinW } = useWindowDimensions();
  const [areaW, setAreaW] = useState(() => columnWidth(dayWinW, true, WIDE_MAX));
  // the quick-access grid is laid out before the list decides the columns, so it estimates with the same width rule
  const twoColEst = areaW >= TWO_COL_AT;
  const now = useNow();
  // a tap on Today in the bar, with Today already open, takes the day back to its top
  const scrollRef = React.useRef<ScrollView>(null);
  useScrollToTop(scrollRef);

  const today = todayKey();

  // editing quick access ends when Today is left, so the day never comes back with tiles that open nothing; while it
  // lasts, Back ends it instead of closing the app
  useFocusEffect(useCallback(() => () => setQaEdit(false), []));
  useEffect(() => {
    if (!qaEdit) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setQaEdit(false);
      return true;
    });
    return () => sub.remove();
  }, [qaEdit]);

  // an archived tool steps out of Today entirely: its sections, its glance and its shortcuts
  const archived = useMemo(() => new Set<string>(archivedTools), [archivedTools]);
  const hideTasks = archived.has('tasks');
  const hidePlanner = archived.has('planner');
  const hideFocus = archived.has('focus');
  const hideJournal = archived.has('journal');
  const visibleQuick = useMemo(() => quickAccess.filter((q) => !hiddenTile(q, archived)), [quickAccess, archived]);

  // A deadline falls due as the day turns, so today is part of the answer. A task ticked here today stays, struck
  // through, and the late ones come first, the longest overdue at the top.
  const dueMissions = useMemo(
    () => missions
      .filter((m) => (m.done ? tickedOnToday.get(m.id) === today : daysUntil(m.deadline) <= 0))
      .sort((a, b) => (a.deadline < b.deadline ? -1 : a.deadline > b.deadline ? 1 : 0)),
    [missions, today]
  );
  const onToggleMission = useCallback((id: string) => {
    const m = useStore.getState().missions.find((x) => x.id === id);
    if (m && !m.done) tickedOnToday.set(id, todayKey());
    toggleMission(id);
  }, [toggleMission]);
  const tasksLeft = dailyTasks.filter((t) => t.doneOn !== today).length + dueMissions.filter((m) => !m.done).length;
  const habitsDone = habits.filter((h) => h.doneDates.includes(today)).length;
  // a session still going counts as it runs, from the day it began, as it will once it is logged
  const liveMin = dwOn && todayKey(new Date(dwStartedAt)) === today
    ? Math.round(Math.min(dwCapSec, dwAccumSec + (dwRunning && dwStartTs ? Math.max(0, now.getTime() - dwStartTs) / 1000 : 0)) / 60)
    : 0;
  const focusToday = Math.round(
    sessions.filter((s) => s.dateKey === today).reduce((a, s) => a + s.netSeconds, 0) / 60
  ) + liveMin;

  // Worked out each minute, but the result keeps its identity while it is the same block with the same tag, so a new
  // minute re-renders only the text that shows the time, never the shortcuts that read the next block.
  const nextBlockNow = useMemo(() => {
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const dToday = dayName(now);
    const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
    const dTomorrow = dayName(tomorrow);
    const sorted = (d: typeof dToday) =>
      [...(planner[d] || [])].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
    const todays = sorted(dToday);
    // today's block comes first at any hour, so a late study block is never skipped for tomorrow's plan. Of two that
    // overlap (allowed, on purpose), the one on now is the one that ends first, as the Planner's header says.
    let current: (typeof todays)[number] | undefined;
    for (const b of todays) {
      if (toMinutes(b.start) <= nowMin && nowMin < toMinutes(b.end) && (!current || toMinutes(b.end) < toMinutes(current.end))) current = b;
    }
    if (current) return { block: current, tag: 'NOW' };
    const next = todays.find((b) => toMinutes(b.start) > nowMin);
    if (next) return { block: next, tag: 'NEXT UP' };
    const first = sorted(dTomorrow)[0];
    if (first) return { block: first, tag: 'TOMORROW' };
    return null;
  }, [planner, now]);
  const nextBlockKey = nextBlockNow ? nextBlockNow.block.id + ':' + nextBlockNow.tag : '';
  const nextBlock = useMemo(() => nextBlockNow, [nextBlockKey, planner]);

  const weekBars = useMemo(() => {
    const out: { label: string; mins: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = todayKey(d);
      const mins = Math.round(sessions.filter((s) => s.dateKey === key).reduce((a, s) => a + s.netSeconds, 0) / 60);
      out.push({ label: DAY_NAMES[(d.getDay() + 6) % 7][0], mins: i === 0 ? mins + liveMin : mins });
    }
    return out;
    // the day is part of the answer: past midnight the seven days move on even when no session has been logged
  }, [sessions, today, liveMin]);
  const maxMins = Math.max(30, ...weekBars.map((b) => b.mins));
  const weekTotal = weekBars.reduce((a, b) => a + b.mins, 0);

  const todayList = useMemo(() => [
    ...dailyTasks.map((t) => ({ kind: 'daily' as const, id: t.id, title: t.title, done: t.doneOn === today, overdue: false })),
    ...dueMissions.map((m) => ({
      kind: 'mission' as const, id: m.id, title: m.title, done: m.done, overdue: daysUntil(m.deadline) < 0,
    })),
  ], [dailyTasks, dueMissions, today]);
  const doneCount = todayList.filter((t) => t.done).length;
  // the first ToDo takes the place of the empty note, and the last one done away with gives it back
  const listIn = useSwapIn(todayList.length === 0 ? 'none' : 'list');

  const greeting = useGreeting({
    now, name,
    sessions: hideFocus ? NO_SESSIONS : sessions,
    habits: hidePlanner ? NO_HABITS : habits,
    planner: hidePlanner ? NO_PLAN : planner,
    listTotal: hideTasks ? 0 : todayList.length,
    listDone: hideTasks ? 0 : doneCount,
    nextBlock: hidePlanner ? null : nextBlock,
  });

  // The words on the Journal's page for today, as one number, so a save in the Journal re-renders Today only when the
  // count moves. A page that holds only a mood or a title has no words, and the Journal's calendar does not count it
  // as written, so the reminder stays for it too. Never shown while the journal is locked.
  const journalDay = journalDayFor(now, journalCutoffHour);
  const journalWords = useStore((s) => {
    let n = 0;
    for (const e of s.journal) if (e.dateKey === journalDay) n += e.wordCount || 0;
    return n;
  });
  const journalNudge = !hideJournal && !journalLocked && journalWords === 0;

  // the Scores tile's line walks every exam, so it is worked out only when the exams or the day change
  const hasScoresTile = visibleQuick.some((q) => q.kind === 'tool' && q.target === 'scores');
  const scoresMeta = useMemo(() => {
    if (!hasScoresTile) return null;
    // the next exam coming up says the most; failing that, how the latest one went
    const ix = indexScores(scores);
    const next = upcoming(ix, null, today)[0];
    if (next) return (next.title || 'An exam') + ' ' + fromToday(next.date as string, today).toLowerCase();
    const sum = groupSummary(ix, null);
    return sum ? 'Latest ' + fmtPct(sum.latest.pct) : 'No exams yet';
  }, [hasScoresTile, scores, today]);
  const blocksToday = (planner[dayName(now)] || []).length;

  // what a shortcut's wide tile says: a live fact about its tool. A shortcut with nothing to say stays a small tile,
  // and every tool always says the same kind of thing, so live changes never reshuffle the grid.
  const quickMetas = useMemo(() => {
    const count = (n: number, one: string, many: string) => n + ' ' + (n === 1 ? one : many);
    const out: Record<string, string | null> = {};
    for (const q of visibleQuick) {
      let meta: string | null = null;
      if (q.kind === 'tool') {
        switch (q.target as ToolKey) {
          case 'tasks':
            meta = todayList.length === 0 ? 'Nothing on the list' : tasksLeft ? count(tasksLeft, 'task left', 'tasks left') : 'All clear';
            break;
          case 'focus':
            meta = dwOn ? (dwRunning ? 'Session running' : 'Session paused')
              : focusToday ? focusToday + ' min today' : 'No focus yet today';
            break;
          case 'planner':
            // with nothing next, a day that had blocks is over, which is not the same as one with nothing planned
            meta = !nextBlock ? (blocksToday ? 'Done for today' : 'Nothing planned')
              : nextBlock.tag === 'NOW' ? nextBlock.block.subject + ' now'
                : nextBlock.tag === 'TOMORROW' ? 'Tomorrow, ' + nextBlock.block.subject
                  : nextBlock.block.subject + ' at ' + fmtClockTime(toMinutes(nextBlock.block.start), hour24);
            break;
          case 'notes':
            // locked Notes say nothing about what they hold
            meta = notesLocked ? 'Locked' : noteCount ? count(noteCount, 'note', 'notes') : 'No notes yet';
            break;
          case 'journal':
            // a locked journal says nothing about its pages
            meta = journalLocked ? 'Locked'
              : journalWords ? count(journalWords, 'word', 'words')
                : journalDay === today ? "Today's page is empty" : "Yesterday's page is empty";
            break;
          case 'vault':
            meta = videoCount ? count(videoCount, 'lecture saved', 'lectures saved') : 'No lectures yet';
            break;
          case 'scores':
            meta = scoresMeta;
            break;
        }
      } else if (q.kind === 'url') {
        // the address, so two shortcuts to one site's pages read apart
        meta = siteHost(q.target) || null;
      }
      out[q.id] = meta;
    }
    return out;
  }, [visibleQuick, todayList.length, tasksLeft, dwOn, dwRunning, focusToday, nextBlock, blocksToday, noteCount, videoCount,
    journalWords, journalDay, today, scoresMeta, journalLocked, notesLocked, hour24]);

  // the grid's callbacks keep their identity, so the grid (and its drag gestures) re-renders only for its own changes
  const runQuick = useCallback((q: QuickItem) => {
    if (qaEdit) {
      // while editing, a website's tile opens it for its name and address to be put right; the others take no press
      if (q.kind === 'url') {
        setQaEditing(q);
        setQaAddSheet(true);
      }
      return;
    }
    if (q.kind === 'tool') openTool(q.target as ToolKey);
    else if (q.kind === 'route') openPage(q.target);
    else launchExternal(q);
  }, [qaEdit]);
  // a removal can be undone from its toast: the shortcut goes back to its old place in the saved list, so tiles
  // hidden with an archived tool keep theirs
  const removeQuick = useCallback((id: string) => {
    const full = useStore.getState().quickAccess;
    const at = full.findIndex((q) => q.id === id);
    if (at < 0) return;
    const gone = full[at];
    setQuickAccess(full.filter((q) => q.id !== id));
    toast('Shortcut removed', {
      label: 'Undo',
      onPress: () => {
        const list = useStore.getState().quickAccess;
        // added again by hand in the meantime: nothing to bring back
        if (list.some((q) => q.kind === gone.kind && (q.kind === 'url' ? sameSite(q.target, gone.target) : q.target === gone.target))) return;
        const next = [...list];
        next.splice(Math.min(at, next.length), 0, gone);
        setQuickAccess(next);
      },
    });
  }, [setQuickAccess]);
  // the grid reorders only what it shows: hidden tiles keep their places in the saved list, so restoring an archived
  // tool brings its shortcut back where it was
  const reorderQuick = useCallback((nextVisible: QuickItem[]) => {
    const { quickAccess: full, settings: s } = useStore.getState();
    const hidden = new Set<string>(s.archivedTools);
    if (full.filter((q) => !hiddenTile(q, hidden)).length !== nextVisible.length) return;
    let i = 0;
    setQuickAccess(full.map((q) => (hiddenTile(q, hidden) ? q : nextVisible[i++])));
  }, [setQuickAccess]);
  const openQaAdd = useCallback(() => {
    setQaEditing(null);
    setQaAddSheet(true);
  }, []);

  // once the intro has gone and the screen is still, the other tabs are built one at a time, so a first visit
  // never waits for a screen to be made and nothing is built out of sight while the intro plays
  const navigation = useNavigation();
  const introDone = useIntro((s) => s.phase === 'done');
  useEffect(() => {
    if (!introDone) return undefined;
    // a slot holding Desmos waits for its first visit: its page loads desmos.com in a heavy web view, which no launch
    // should pay for unasked
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

  // the sections, placed in one column on a phone (and a tablet held upright), in two on a wide window
  // a greeting that changes while Today is open (a new part of the day, the list done) dips out and back as the new
  // words; a figure in the same sentence ("Physics in 12 min") changes in place, so the line never blinks each minute
  const greetingKey = greeting.kind + '|' + (greeting.sub || '');
  const greetingBlock = (
        <Enter index={0}>
          <Pressable onPress={() => setNameSheet(true)} accessibilityRole="button" accessibilityHint="Change your name">
            <Text style={T.kicker}>{fmtDate(now)}</Text>
            <FadeSwap swapKey={greetingKey}>
              <Text style={[T.display, { marginTop: 8, marginBottom: greeting.sub ? 6 : 24 }]}>
                {greeting.parts.map((part, i) => (
                  <Text key={i} style={part.name ? { color: C.accent } : undefined}>{part.text}</Text>
                ))}
              </Text>
              {greeting.sub ? <Text style={[T.label, { marginBottom: 24 }]}>{greeting.sub}</Text> : null}
            </FadeSwap>
          </Pressable>
        </Enter>
  );

  const noBlocksToday = !nextBlock && !blocksToday;
  const planBlock = hidePlanner || (!nextBlock && !noBlocksToday) ? null : (
      <>
        {nextBlock && !hidePlanner && (
          <Enter index={1}>
            <Card hero pad={S.cardPad} onPress={() => openTool('planner')}>
              {/* when one block ends and the next takes the card, the old one dips out and the new one comes up */}
              <FadeSwap swapKey={nextBlockKey}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Row style={{ flex: 1 }}>
                  <View style={[st.blockBar, { backgroundColor: nextBlock.block.color }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={T.head} numberOfLines={1}>{nextBlock.block.subject}</Text>
                    <Text style={[T.caption, { marginTop: 2, fontVariant: ['tabular-nums'] }]}>
                      {fmtClockTime(toMinutes(nextBlock.block.start), hour24)} – {fmtClockTime(toMinutes(nextBlock.block.end), hour24)}
                    </Text>
                  </View>
                </Row>
                <View style={[st.tagPill, { borderColor: C.accent + '55', backgroundColor: C.accent + '18' }]}>
                  <Text style={[st.tagText, { color: C.accent }]}>{nextBlock.tag}</Text>
                </View>
              </Row>
              </FadeSwap>
            </Card>
          </Enter>
        )}
        {!hidePlanner && noBlocksToday ? (
          <Enter index={1}>
            <Pressable
              onPress={() => openTool('planner')}
              style={[
                st.journalNudge,
                { marginTop: 0, marginBottom: S.gap },
                theme === 'minimal' ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border } : { backgroundColor: C.inset, ...neuInset('low') },
              ]}
            >
              <Ionicons name="calendar-outline" size={17} color={C.textFaint} />
              <Text style={st.journalNudgeText}>No blocks planned today</Text>
              <Text style={[st.link, { color: C.accent }]}>Plan</Text>
            </Pressable>
          </Enter>
        ) : null}
      </>
  );

  const glanceBlock = hideTasks && (hidePlanner || !habits.length) && hideFocus ? null : (
          <Enter index={2}>
            <Card pad={0}>
              <Row>
                {/* a student with no habits sees no figure for them: the glance has two cells */}
                {[
                  hideTasks ? null : (
                    <Glance
                      key="tasks" value={tasksLeft} label="tasks left" color={C.accent}
                      spoken={tasksLeft + (tasksLeft === 1 ? ' task left' : ' tasks left')}
                    />
                  ),
                  hidePlanner || !habits.length ? null : (
                    <Glance
                      key="habits" value={habitsDone} total={habits.length} label="habits" color={C.green}
                      spoken={habitsDone + ' of ' + habits.length + ' habits done today'}
                    />
                  ),
                  hideFocus ? null : (
                    <Glance
                      key="focus" value={focusToday} suffix=" min" label="focused" color={C.accent}
                      spoken={spokenMinutes(focusToday) + ' focused today'}
                    />
                  ),
                ].filter(Boolean).map((cell, i) => (
                  <React.Fragment key={(cell as React.ReactElement).key}>
                    {i > 0 ? <View style={st.vDivider} /> : null}
                    {cell}
                  </React.Fragment>
                ))}
              </Row>
            </Card>
          </Enter>
  );

  const quickBlock = (
      <>
        <Enter index={3}>
          <SectionTitle
            right={
              <Pressable onPress={() => setQaEdit(!qaEdit)} hitSlop={LINK_SLOP} accessibilityRole="button">
                <FadeSwap swapKey={qaEdit ? 'done' : 'edit'}>
                  <Text style={[st.link, { color: C.accent }]}>{qaEdit ? 'Done' : 'Edit'}</Text>
                </FadeSwap>
              </Pressable>
            }
          >
            Quick access
          </SectionTitle>
        </Enter>
        <Enter index={3}>
          <QuickGrid
            items={visibleQuick}
            metas={quickMetas}
            edit={qaEdit}
            onRun={runQuick}
            onRemove={removeQuick}
            onReorder={reorderQuick}
            onAdd={openQaAdd}
            estimateW={twoColEst ? (areaW - S.pad * 2 - 28) / 2 : areaW - S.pad * 2}
          />
        </Enter>
      </>
  );

  const journalBlock = journalNudge ? (
          <Enter index={4}>
            <Pressable
              onPress={() => openTool('journal')}
              style={[
                st.journalNudge,
                theme === 'minimal' ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border } : { backgroundColor: C.inset, ...neuInset('low') },
              ]}
            >
              <Ionicons name="journal-outline" size={17} color={C.gold} />
              <Text style={st.journalNudgeText}>{journalDay === today ? "Today's page is empty" : "Yesterday's page is empty"}</Text>
              <Text style={[st.link, { color: C.gold }]}>Write</Text>
            </Pressable>
          </Enter>
  ) : null;

  const listBlock = hideTasks ? null : (
          <>
            <Enter index={4}>
              <SectionTitle
                right={
                  <Row style={{ gap: 20 }}>
                    <Pressable onPress={() => setTaskSheet(true)} hitSlop={LINK_SLOP} accessibilityRole="button" accessibilityLabel="Add a task">
                      <Text style={[st.link, { color: C.accent }]}>Add</Text>
                    </Pressable>
                    <Pressable onPress={() => openTool('tasks')} hitSlop={LINK_SLOP} accessibilityRole="button" accessibilityLabel="All tasks">
                      <Text style={[st.link, { color: C.accent }]}>All tasks →</Text>
                    </Pressable>
                  </Row>
                }
              >
                Today {todayList.length > 0 ? '· ' + doneCount + '/' + todayList.length : ''}
              </SectionTitle>
              {/* an empty list has no progress to show; the bar comes up with the first ToDo, as the list does */}
              {todayList.length > 0 ? (
                <Animated.View entering={listIn} style={{ marginTop: 2, marginBottom: 16 }}>
                  <ProgressBar value={doneCount / todayList.length} />
                </Animated.View>
              ) : null}
            </Enter>
            <Enter index={4}>
              <Animated.View key={todayList.length === 0 ? 'none' : 'list'} entering={listIn}>
                {todayList.length === 0 ? (
                  <Card pad={6}>
                    <EmptyState
                      compact icon="checkbox-outline" title="Nothing on the list yet" body="ToDos and tasks due today show here."
                      actionLabel="Add a ToDo" onAction={() => setTaskSheet(true)}
                    />
                  </Card>
                ) : (
                  <TodayList items={todayList} onToggleDaily={toggleDaily} onToggleMission={onToggleMission} />
                )}
              </Animated.View>
            </Enter>
          </>
  );

  const habitsBlock = habits.length > 0 && !hidePlanner && (
          <Enter index={5}>
            <SectionTitle>Habits</SectionTitle>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {habits.map((h) => {
                const done = h.doneDates.includes(today);
                return (
                  <Chip
                    key={h.id}
                    icon={done ? 'checkmark-circle' : 'ellipse-outline'}
                    label={h.title}
                    active={done}
                    color={C.green}
                    onPress={() => toggleHabitToday(h.id)}
                    small
                  />
                );
              })}
            </View>
          </Enter>
  );

  const weekBlock = hideFocus ? null : (
          <>
            <Enter index={6}>
              <SectionTitle>Focus, last 7 days</SectionTitle>
            </Enter>
            <Enter index={6}>
              <Card>
                {/* a screen reader hears the week as one sentence, not seven loose figures and letters */}
                <View
                  accessible
                  accessibilityLabel={weekTotal > 0 ? 'Focus in the last 7 days, ' + spokenMinutes(weekTotal) : 'No focus in the last 7 days'}
                >
                  <Row style={{ alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: 4 }}>
                    {weekBars.map((b, i) => (
                      <WeekBar key={i} label={b.label} mins={b.mins} maxMins={maxMins} isToday={i === 6} />
                    ))}
                  </Row>
                  {/* a week with no focus says nothing about it: the empty troughs say it */}
                  {weekTotal > 0 ? (
                    <>
                      <Hairline />
                      <Text style={[T.caption, { textAlign: 'center', marginTop: 10 }]}>
                        <SeenCount value={weekTotal} style={{ color: C.accent, fontFamily: F.semi }}> min</SeenCount> focused in the last 7 days
                      </Text>
                    </>
                  ) : null}
                </View>
              </Card>
            </Enter>
          </>
  );

  // two columns once a wide window gives the day room for them: what is planned and what is left on the left, the
  // shortcuts, the journal, habits and the week on the right
  const twoCol = areaW >= TWO_COL_AT && !!listBlock;
  return (
    <ScreenBG guard maxWidth={WIDE_MAX}>
      <ScrollView
        key={fk}
        ref={scrollRef}
        onLayout={(e) => setAreaW(e.nativeEvent.layout.width)}
        contentContainerStyle={{ padding: S.pad, paddingTop: insets.top + 20, paddingBottom: 44 }}
        showsVerticalScrollIndicator={false}
      >
        {greetingBlock}
        {twoCol ? (
          <>
            {planBlock && glanceBlock ? (
              <View style={st.pair}>
                <View style={st.col}>{planBlock}</View>
                <View style={st.col}>{glanceBlock}</View>
              </View>
            ) : planBlock || glanceBlock}
            <View style={st.pair}>
              <View style={st.col}>{listBlock}</View>
              <View style={st.col}>{quickBlock}{journalBlock}{habitsBlock}{weekBlock}</View>
            </View>
          </>
        ) : (
          <>
            {planBlock}
            {glanceBlock}
            {quickBlock}
            {journalBlock}
            {listBlock}
            {habitsBlock}
            {weekBlock}
          </>
        )}
      </ScrollView>

      <NameSheet visible={nameSheet} onClose={() => setNameSheet(false)} />
      <QuickAddSheet visible={qaAddSheet} onClose={() => setQaAddSheet(false)} archived={archived} editing={qaEditing} />
      <QuickTaskSheet visible={taskSheet} onClose={() => setTaskSheet(false)} />
    </ScreenBG>
  );
}

/** The greeting's name. What is typed lives here, so a keystroke re-renders the sheet alone, never the whole day. */
function NameSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const setSetting = useStore((s) => s.setSetting);
  const [draft, setDraft] = useState('');
  // each opening starts from the saved name
  useEffect(() => { if (visible) setDraft(useStore.getState().settings.name); }, [visible]);
  const save = () => { setSetting('name', draft.trim()); onClose(); };
  return (
    <Sheet visible={visible} onClose={onClose} title="Your name">
      {/* a short cap, so a long name never wraps the greeting over several lines */}
      <Field
        value={draft} onChangeText={setDraft} placeholder="What should the greeting call you?" autoFocus maxLength={30}
        returnKeyType="done" onSubmitEditing={save}
      />
      <PillButton label="Save" onPress={save} />
    </Sheet>
  );
}

/**
 * Adding a shortcut: an in-app page, or a website. Given a website shortcut (`editing`), it puts that one's name and
 * address right instead, in its place. The address and name being typed live here, so a keystroke re-renders the sheet
 * alone.
 */
function QuickAddSheet({ visible, onClose, archived, editing }: {
  visible: boolean; onClose: () => void; archived: ReadonlySet<string>; editing: QuickItem | null;
}) {
  const level = useAnimLevel();
  const quickAccess = useStore((s) => s.quickAccess);
  const setQuickAccess = useStore((s) => s.setQuickAccess);
  const [siteDraft, setSiteDraft] = useState('');
  const [siteLabel, setSiteLabel] = useState('');
  const [siteError, setSiteError] = useState('');
  // each opening starts blank, or from the shortcut being edited
  useEffect(() => {
    if (!visible) return;
    setSiteDraft(editing ? editing.target : '');
    setSiteLabel(editing ? editing.label : '');
    setSiteError('');
  }, [visible]);
  const addQuick = (item: Omit<QuickItem, 'id'>) => {
    const list = useStore.getState().quickAccess;
    if (list.some((q) => q.kind === item.kind && (q.kind === 'url' ? sameSite(q.target, item.target) : q.target === item.target))) return false;
    setQuickAccess([...list, { ...item, id: uid() }]);
    return true;
  };
  const addSite = () => {
    const url = siteUrl(siteDraft);
    if (!url) {
      setSiteError(siteDraft.trim() ? 'That is not a web address. Try something like khanacademy.org' : "Type the site's address first.");
      return;
    }
    const label = siteLabel.trim() || siteName(url);
    if (editing) {
      const list = useStore.getState().quickAccess;
      if (list.some((q) => q.id !== editing.id && q.kind === 'url' && sameSite(q.target, url))) {
        setSiteError('That site is already in quick access.');
        return;
      }
      setQuickAccess(list.map((q) => (q.id === editing.id ? { ...q, label, target: url } : q)));
    } else if (!addQuick({ label, icon: 'globe-outline', color: 'teal', kind: 'url', target: url })) {
      setSiteError('That site is already in quick access.');
      return;
    }
    onClose();
  };
  const catalog = editing ? [] : ROUTE_CATALOG.filter(
    (r) => !(r.kind === 'tool' && archived.has(r.target)) && !quickAccess.some((q) => q.kind === r.kind && q.target === r.target)
  );
  const typedUrl = siteUrl(siteDraft);
  return (
    <Sheet visible={visible} onClose={onClose} title={editing ? 'Edit shortcut' : 'Add to quick access'}>
      {/* once every in-app page is a shortcut, the section goes rather than standing empty. A chip picked fades as the
          ones after it glide into its place, and the heading fades with the last one */}
      {catalog.length > 0 ? (
        <Animated.View exiting={rowOut(level)}>
          <Text style={st.sheetSection}>In-app</Text>
          <Row style={{ flexWrap: 'wrap' }}>
            {catalog.map((r) => (
              <Animated.View key={r.kind + r.target} exiting={rowOut(level)} layout={glide(level)}>
                <Chip label={r.label} color={colorOf(r.color)} onPress={() => addQuick(r)} />
              </Animated.View>
            ))}
          </Row>
        </Animated.View>
      ) : null}
      {editing ? null : <Text style={st.sheetSection}>A website</Text>}
      {/* the name is optional, so the address's own key can add the site */}
      <Field
        label="Address" value={siteDraft} autoCapitalize="none" autoCorrect={false} keyboardType="url"
        onChangeText={(t) => { setSiteDraft(t); if (siteError) setSiteError(''); }}
        placeholder="khanacademy.org" returnKeyType="done" onSubmitEditing={addSite}
      />
      <Row style={{ alignItems: 'flex-end' }}>
        <Field
          label="Name" value={siteLabel} onChangeText={setSiteLabel}
          placeholder={typedUrl ? siteName(typedUrl) : 'Optional'}
          style={{ flex: 1, marginBottom: 0 }} returnKeyType="done" onSubmitEditing={addSite}
        />
        <PillButton small label={editing ? 'Save' : 'Add'} style={{ marginLeft: 12 }} onPress={addSite} />
      </Row>
      {/* the help line and a problem with the address cross over rather than swapping in one frame */}
      <FadeSwap swapKey={siteError}>
        <Text style={[T.caption, { marginTop: 10, color: siteError ? C.danger : C.textFaint }]}>
          {siteError || 'Opens in your default browser.'}
        </Text>
      </FadeSwap>
    </Sheet>
  );
}

/** One figure of the glance. A screen reader hears it as one phrase (`spoken`), not a number and a word apart. */
function Glance({ value, total, label, color, suffix, spoken }: {
  value: number; total?: number; label: string; color: string; suffix?: string; spoken: string;
}) {
  return (
    <View style={{ flex: 1, alignItems: 'center', paddingVertical: 16 }} accessible accessibilityLabel={spoken}>
      <SeenCount value={value} style={[st.glanceValue, { color }]}>
        {total != null ? '/' + total : null}
        {suffix ? <Text style={{ fontSize: 13, letterSpacing: TRACK.small, fontFamily: F.semi }}>{suffix}</Text> : null}
      </SeenCount>
      <Text style={st.glanceLabel}>{label}</Text>
    </View>
  );
}

/** Carved vertical trough with a fill that eases up from the bottom: seven bars moving together must never bounce. */
const BAR_EASE = { duration: 360, easing: EASE_OUT };
/** tiles making way for a new, moved or removed shortcut */
const REFLOW = { duration: 280, easing: EASE_OUT };

/* ---------------- quick access: a bento of wide and small tiles, hold to drag ---------------- */
const QA_COLS = 4;
const QA_GAP = 8;
const QA_ROW_H = 80;
const QA_ADD_H = 52;

interface QaRect { x: number; y: number; w: number }

/** a wide window gives each column at least this much, so tiles keep a phone's proportions */
const QA_MIN_W = 88;

/**
 * Packs tiles into rows of `cols` columns (four on a phone), in their order: a shortcut with something to say spans two
 * columns, the rest one. A row that cannot take the next tile, and the last row, widen their own small tiles into the
 * gap, and a tile alone on the last row spans it, so no row ends with a hole.
 */
function packTiles(spans: number[], colW: number, cols: number): QaRect[] {
  const cells: { col: number; row: number; span: number }[] = [];
  let row = 0;
  let used = 0;
  let start = 0;
  const close = () => {
    const line = cells.slice(start);
    let gap = cols - used;
    if (line.length === 1) {
      line[0].span = cols;
      gap = 0;
    }
    for (let i = line.length - 1; i >= 0 && gap > 0; i--) {
      if (line[i].span === 1) { line[i].span = 2; gap--; }
    }
    let col = 0;
    for (const c of line) { c.col = col; col += c.span; }
  };
  spans.forEach((span) => {
    if (used + span > cols) {
      close();
      row++;
      used = 0;
      start = cells.length;
    }
    cells.push({ col: used, row, span });
    used += span;
  });
  if (cells.length) close();
  return cells.map((c) => ({
    x: c.col * (colW + QA_GAP),
    y: c.row * (QA_ROW_H + QA_GAP),
    w: c.span * colW + (c.span - 1) * QA_GAP,
  }));
}

/** from about 1.15x system text, a wide tile keeps its line of meta to one line, so the words stay inside the tile */
const QA_BIG_TEXT = 1.15;
/** the tiles' text grows with the system's size only this far: the tiles are a fixed height */
const QA_TEXT_MAX = 1.25;

function QuickTile({ q, meta, index, last, rect, wide, rects, isDragging, onDragState, onCross, onDrop, onRun, edit, onRemove, fadeIn }: {
  q: QuickItem; meta: string | null; index: number; last: boolean; rect: QaRect; wide: boolean; rects: SharedValue<QaRect[]>;
  isDragging: boolean; onDragState: (id: string) => void; onCross: (id: string, idx: number) => void; onDrop: () => void;
  onRun: (q: QuickItem) => void; edit: boolean; onRemove: (id: string) => void; fadeIn: boolean;
}) {
  const theme = useTheme();
  const level = useAnimLevel();
  const x = useSharedValue(rect.x);
  const y = useSharedValue(rect.y);
  const w = useSharedValue(rect.w);
  const sx = useSharedValue(0);
  const sy = useSharedValue(0);
  const lift = useSharedValue(0);
  const over = useSharedValue(-1);
  // the motion level, for the memoised drag worklet: a held tile lifts at once with motion off, eases with some, and
  // springs (one tile answering a touch) only with every animation on
  const motion = useSharedValue(level === 'none' ? 0 : level === 'some' ? 1 : 2);
  React.useEffect(() => { motion.value = level === 'none' ? 0 : level === 'some' ? 1 : 2; }, [level]);

  // live refs — the pan worklet is memoized, so JS callbacks go through here
  const idxRef = React.useRef(index); idxRef.current = index;
  const crossRef = React.useRef(onCross); crossRef.current = onCross;
  const dropRef = React.useRef(onDrop); dropRef.current = onDrop;
  const dragStateRef = React.useRef(onDragState); dragStateRef.current = onDragState;
  const crossStable = React.useCallback((id: string, idx: number) => {
    if (idx !== idxRef.current) crossRef.current(id, idx);
  }, []);
  const dropStable = React.useCallback(() => dropRef.current(), []);
  const dragStable = React.useCallback((id: string) => dragStateRef.current(id), []);

  const wasDragging = React.useRef(false);
  React.useEffect(() => {
    // while dragging, the finger owns the tile: its place and its width both hold still until it lands, so a tile
    // that is about to change span never grows under the finger
    if (isDragging) { wasDragging.current = true; return; }
    const dropped = wasDragging.current;
    wasDragging.current = false;
    if (level === 'none') {
      x.value = rect.x; y.value = rect.y; w.value = rect.w;
    } else if (dropped) {
      // the tile the finger lets go of settles into its slot: one tile answering a touch may spring (with some
      // motion it eases, as a pop does)
      const settle = (to: number) => (level === 'full' ? withSpring(to, RISE_OUT) : withTiming(to, CHANGE));
      x.value = settle(rect.x);
      y.value = settle(rect.y);
      w.value = settle(rect.w);
    } else if (level === 'full') {
      // the others make way on an eased glide: springs across a whole grid overshoot against each other
      x.value = withTiming(rect.x, REFLOW);
      y.value = withTiming(rect.y, REFLOW);
      w.value = withTiming(rect.w, REFLOW);
    } else {
      // with some motion nothing slides across the grid: the tiles take their places
      x.value = rect.x; y.value = rect.y; w.value = rect.w;
    }
  }, [rect.x, rect.y, rect.w, isDragging, level]);

  // 420ms: long enough that a lingering tap never rearranges by accident,
  // short enough to still feel like a standard launcher hold-to-drag
  const pan = React.useMemo(() => Gesture.Pan()
    .activateAfterLongPress(420)
    .onStart(() => {
      lift.value = motion.value === 0 ? 1 : motion.value === 1 ? withTiming(1, CHANGE) : withSpring(1, RISE_OUT);
      sx.value = x.value; sy.value = y.value;
      over.value = -1;
      runOnJS(tap)();
      runOnJS(dragStable)(q.id);
    })
    .onUpdate((e) => {
      x.value = sx.value + e.translationX;
      y.value = sy.value + e.translationY;
      // the slot under the tile's centre, away from that slot's edges, so a tile that changes span on the move
      // never lands on a spot that sends it straight back
      const cx = x.value + w.value / 2;
      const cy = y.value + QA_ROW_H / 2;
      const rs = rects.value;
      let hit = -1;
      for (let i = 0; i < rs.length; i++) {
        const r = rs[i];
        const mx = r.w * 0.2;
        if (cx > r.x + mx && cx < r.x + r.w - mx && cy > r.y + QA_ROW_H * 0.2 && cy < r.y + QA_ROW_H * 0.8) {
          hit = i;
          break;
        }
      }
      if (hit !== over.value) {
        over.value = hit;
        if (hit >= 0) runOnJS(crossStable)(q.id, hit);
      }
    })
    .onFinalize(() => {
      lift.value = motion.value === 0 ? 0 : motion.value === 1 ? withTiming(0, CHANGE) : withSpring(0, RISE_OUT);
      runOnJS(dropStable)();
    }), [q.id]);

  const aStyle = useAnimatedStyle(() => ({
    width: w.value,
    transform: [
      { translateX: x.value },
      { translateY: y.value },
      { scale: 1 + lift.value * 0.05 },
    ] as const,
  }));

  const icon = (q.kind === 'tool' ? toolByKey(q.target)?.icon || q.icon : q.icon) as any;
  // neutral tiles: the colour lives only in the icon
  const surface = theme === 'minimal'
    ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border }
    : { backgroundColor: C.inset };

  // While editing, a screen reader meets the tile as one element whose actions do what the drag and the cross do (and
  // a website's opens it to be edited). Otherwise the face is the button, with what its tile says.
  const site = q.kind === 'url';
  const editA11y = edit ? {
    accessible: true,
    accessibilityLabel: q.label,
    accessibilityActions: [
      ...(site ? [{ name: 'activate', label: 'Edit' }] : []),
      ...(index > 0 ? [{ name: 'earlier', label: 'Move earlier' }] : []),
      ...(last ? [] : [{ name: 'later', label: 'Move later' }]),
      { name: 'remove', label: 'Remove' },
    ],
    onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) => {
      const action = e.nativeEvent.actionName;
      if (action === 'activate' && site) onRun(q);
      else if (action === 'earlier' && index > 0) crossRef.current(q.id, index - 1);
      else if (action === 'later' && !last) crossRef.current(q.id, index + 1);
      else if (action === 'remove') onRemove(q.id);
    },
  } : null;
  // past about 1.15x system text, the meta keeps to one line so it never runs out of the tile
  const metaLines = PixelRatio.getFontScale() > QA_BIG_TEXT ? 1 : 2;

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[st.qaTile, { zIndex: isDragging ? 10 : 0, elevation: isDragging ? 10 : 0 }, aStyle]} {...editA11y}>
        <Animated.View
          style={st.qaFill}
          entering={fadeIn && level !== 'none' ? FadeIn.duration(level === 'full' ? 220 : 180) : undefined}
          // a removed shortcut shrinks away while the others slide into its place
          exiting={level === 'none' ? undefined : level === 'full' ? ZoomOut.duration(180) : FadeOut.duration(160)}
        >
          {/* while editing only a website's tile takes a press (to be edited); the rest no longer sink under a finger
              that opens nothing */}
          <Bouncy
            onPress={() => onRun(q)}
            disabled={edit && !site}
            radius={18}
            scaleTo={0.97}
            accessibilityRole={edit ? undefined : 'button'}
            accessibilityLabel={edit ? undefined : q.label + (meta ? ', ' + meta : '')}
            style={[st.qaFace, wide ? st.qaWide : st.qaSmall, wide && !meta && { justifyContent: 'center' }, wide && edit && { paddingRight: 26 }, surface]}
          >
            {wide ? (
              <>
                <Row>
                  <Ionicons name={icon} size={20} color={colorOf(q.color)} />
                  <Text style={st.qaLabel} numberOfLines={1} maxFontSizeMultiplier={QA_TEXT_MAX}>{q.label}</Text>
                </Row>
                {meta ? <Text style={st.qaMeta} numberOfLines={metaLines} maxFontSizeMultiplier={QA_TEXT_MAX}>{meta}</Text> : null}
              </>
            ) : (
              <>
                <Ionicons name={icon} size={22} color={colorOf(q.color)} />
                <Text style={st.qaSmallLabel} numberOfLines={1} maxFontSizeMultiplier={QA_TEXT_MAX}>{q.label}</Text>
              </>
            )}
          </Bouncy>
          {edit ? (
            <Animated.View
              entering={level === 'none' ? undefined : level === 'full' ? ZoomIn.duration(200) : FadeIn.duration(180)}
              exiting={level === 'none' ? undefined : level === 'full' ? ZoomOut.duration(140) : FadeOut.duration(140)}
              style={st.qaX}
            >
              {/* the cross sits on the tile's corner, so its target reaches past the glyph to a full 44 dp */}
              <Bouncy
                onPress={() => onRemove(q.id)} scaleTo={0.85} hitSlop={10} radius={999} style={{ padding: 4 }}
                accessibilityRole="button" accessibilityLabel={'Remove ' + q.label}
              >
                <Ionicons name="close-circle" size={18} color={C.danger} />
              </Bouncy>
            </Animated.View>
          ) : null}
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

type TodayItem = { kind: 'daily' | 'mission'; id: string; title: string; done: boolean; overdue: boolean };

/** Today's list. Its own component, so the minute changing on Today leaves the rows alone. */
const TodayList = React.memo(function TodayList({ items, onToggleDaily, onToggleMission }: {
  items: TodayItem[]; onToggleDaily: (id: string) => void; onToggleMission: (id: string) => void;
}) {
  return (
    <ListCard>
      {items.map((t) => (
        <TodayRow
          key={t.kind + t.id} kind={t.kind} id={t.id} title={t.title} done={t.done} overdue={t.overdue}
          onToggleDaily={onToggleDaily} onToggleMission={onToggleMission}
        />
      ))}
    </ListCard>
  );
});

/** One of today's rows. Memoised on plain values, so ticking one re-renders that row alone. */
const TodayRow = React.memo(function TodayRow({ kind, id, title, done, overdue, onToggleDaily, onToggleMission }: TodayItem & {
  onToggleDaily: (id: string) => void; onToggleMission: (id: string) => void;
}) {
  return (
    <ListRow>
      <CheckCircle
        done={done}
        color={kind === 'mission' ? C.amber : C.green}
        onPress={() => (kind === 'daily' ? onToggleDaily(id) : onToggleMission(id))}
        label={title}
      />
      <StrikeText done={done} style={st.taskText} wrapStyle={st.taskWrap} numberOfLines={1}>{title}</StrikeText>
      {/* a task past its deadline says so, as Tasks does, rather than looking like one due today */}
      {kind === 'mission' && (
        <View style={[st.missionPill, overdue && { backgroundColor: C.danger + '1C', borderColor: C.danger + '55' }]}>
          <Text style={[st.missionPillText, overdue && { color: C.danger }]}>{overdue ? 'OVERDUE' : 'DUE'}</Text>
        </View>
      )}
    </ListRow>
  );
});

const QuickGrid = React.memo(function QuickGrid({ items, metas, edit, onRun, onRemove, onReorder, onAdd, estimateW }: {
  items: QuickItem[]; metas: Record<string, string | null>; edit: boolean; onRun: (q: QuickItem) => void;
  onRemove: (id: string) => void; onReorder: (items: QuickItem[]) => void; onAdd: () => void;
  /** the grid's width before it has measured itself: its column of Today */
  estimateW?: number;
}) {
  const { width: winW } = useWindowDimensions();
  const level = useAnimLevel();
  // the grid measures its own room (a column of Today on a wide window); until it has, it assumes the phone's
  const [boxW, setBoxW] = useState(0);
  const avail = boxW || estimateW || winW - S.pad * 2;
  // a phone always has four columns; a wide window fits as many as keep the tiles in a phone's proportions
  const cols = winW >= WIDE_AT ? Math.max(QA_COLS, Math.floor((avail + QA_GAP) / (QA_MIN_W + QA_GAP))) : QA_COLS;
  const colW = (avail - QA_GAP * (cols - 1)) / cols;
  const [dragId, setDragId] = useState<string | null>(null);
  const spanKey = items.map((q) => (metas[q.id] ? 2 : 1)).join('');
  const layout = useMemo(() => packTiles(spanKey.split('').map(Number), colW, cols), [spanKey, colW, cols]);
  // the drag worklets read the packed slots from here, so a reorder never rebuilds a gesture mid-drag
  const rects = useSharedValue<QaRect[]>(layout);
  useEffect(() => { rects.value = layout; }, [layout]);
  // shortcuts added after the first paint fade in; the grid's own entrance covers the first paint
  const painted = React.useRef(false);
  useEffect(() => { painted.current = true; }, []);

  // an empty grid always offers Add, so quick access never looks like nothing
  const showAdd = edit || items.length === 0;
  const tilesH = layout.length ? Math.max(...layout.map((r) => r.y)) + QA_ROW_H : 0;
  const addY = tilesH ? tilesH + QA_GAP : 0;
  const height = showAdd ? addY + QA_ADD_H : tilesH;
  // A grid that grows takes its new height at once. One that shrinks keeps the old height until the tiles have glided
  // into their places, so the last tile never slides over the section below on its way up.
  const [heldH, setHeldH] = useState(height);
  useEffect(() => {
    if (height >= heldH || level !== 'full') {
      if (height !== heldH) setHeldH(height);
      return undefined;
    }
    const timer = setTimeout(() => setHeldH(height), REFLOW.duration);
    return () => clearTimeout(timer);
  }, [height, level]);
  const boxH = level === 'full' ? Math.max(height, heldH) : height;
  const reorder = (id: string, idx: number) => {
    const from = items.findIndex((it) => it.id === id);
    if (from < 0 || idx < 0 || idx === from || idx >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(idx, 0, moved);
    onReorder(next);
  };
  return (
    <View style={{ height: boxH, marginBottom: 6 }} onLayout={(e) => setBoxW(e.nativeEvent.layout.width)}>
      {items.map((q, i) => (
        <QuickTile
          key={q.id} q={q} meta={metas[q.id] ?? null} index={i} last={i === items.length - 1} rect={layout[i]}
          wide={layout[i].w > colW + 1} rects={rects}
          isDragging={dragId === q.id}
          onDragState={setDragId}
          onCross={reorder}
          onDrop={() => setDragId(null)}
          onRun={onRun} edit={edit} onRemove={onRemove} fadeIn={painted.current}
        />
      ))}
      {showAdd && <QuickAdd y={addY} onAdd={onAdd} />}
    </View>
  );
});

/**
 * Add, under the tiles. It moves with them, on the same glide, when a removal empties a row, instead of jumping up
 * while they are still on their way.
 */
function QuickAdd({ y, onAdd }: { y: number; onAdd: () => void }) {
  const level = useAnimLevel();
  const ty = useSharedValue(y);
  useEffect(() => {
    ty.value = level === 'full' ? withTiming(y, REFLOW) : y;
  }, [y, level]);
  const aStyle = useAnimatedStyle(() => ({ transform: [{ translateY: ty.value }] }));
  return (
    <Animated.View
      entering={level === 'none' ? undefined : FadeIn.duration(200)}
      exiting={level === 'none' ? undefined : FadeOut.duration(140)}
      style={[st.qaAddWrap, aStyle]}
    >
      <Bouncy onPress={onAdd} radius={18} scaleTo={0.985} style={[st.qaAdd, { borderColor: C.borderBright }]}>
        <Ionicons name="add" size={18} color={C.textDim} />
        <Text style={st.qaAddText} maxFontSizeMultiplier={QA_TEXT_MAX}>Add shortcut</Text>
      </Bouncy>
    </Animated.View>
  );
}

function WeekBar({ label, mins: minsNow, maxMins: maxNow, isToday }: {
  label: string; mins: number; maxMins: number; isToday: boolean;
}) {
  const theme = useTheme();
  const level = useAnimLevel();
  // a week that changed behind another tab moves once Today is back in view
  const mins = useWhenSeen(minsNow);
  const maxMins = useWhenSeen(maxNow);
  const target = Math.max(4, (mins / maxMins) * 56);
  const h = useSharedValue(target);
  React.useEffect(() => {
    // the fill is a change in place: the full ease with every animation on, a short one with some
    h.value = level === 'none' ? target : withTiming(target, level === 'full' ? BAR_EASE : CHANGE);
  }, [target, level]);
  // a full-height fill rises from the trough floor: a transform, never a height
  const fillStyle = useAnimatedStyle(() => ({ transform: [{ translateY: 56 - h.value }] }));
  const fillColor = isToday ? C.accent : C.slate + '73';
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      {/* the figure counts to its new value as the fill rises; it no longer pops on the first paint, out of sight */}
      {mins > 0 && <CountUp value={mins} style={st.barValue} />}
      <View
        style={[
          st.barTrough,
          theme === 'minimal'
            ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border }
            : { backgroundColor: C.inset, ...neuInset('hairline') },
        ]}
      >
        <Animated.View
          style={[
            {
              width: '100%', height: 56, borderRadius: 8, backgroundColor: fillColor,
            },
            fillStyle,
          ]}
        />
      </View>
      <Text style={[st.barLabel, isToday && { color: C.accent, fontFamily: F.semi }]}>{label}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  pair: { flexDirection: 'row', alignItems: 'flex-start', gap: 28 },
  col: { flex: 1, minWidth: 0 },
  blockBar: { width: 4, height: 34, borderRadius: 2, marginRight: 12 },
  // accent colours are applied inline at the call site: a StyleSheet freezes
  // C.accent at import time and would never follow an accent change
  tagPill: {
    borderWidth: 1,
    borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, marginLeft: 10,
  },
  tagText: { fontFamily: F.bold, fontSize: 11, letterSpacing: TRACK.caps },
  vDivider: { width: StyleSheet.hairlineWidth, backgroundColor: C.hairline, alignSelf: 'stretch', marginVertical: 12 },
  glanceValue: { ...T.numStat },
  glanceLabel: { color: C.textFaint, fontFamily: F.med, fontSize: 11, marginTop: 3, letterSpacing: TRACK.fine },
  qaTile: { position: 'absolute', left: 0, top: 0, height: QA_ROW_H },
  qaFill: { flex: 1 },
  qaFace: { flex: 1, borderRadius: 18 },
  qaWide: { padding: 12, justifyContent: 'space-between' },
  qaSmall: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  qaLabel: { flex: 1, marginLeft: 8, color: C.text, fontFamily: F.med, fontSize: 13, letterSpacing: TRACK.small },
  qaSmallLabel: { maxWidth: '100%', marginTop: 6, color: C.textDim, fontFamily: F.med, fontSize: 11, letterSpacing: TRACK.small },
  qaMeta: { color: C.textFaint, fontFamily: F.reg, fontSize: 12, letterSpacing: TRACK.fine, lineHeight: 15 },
  qaX: { position: 'absolute', top: 1, right: 1 },
  qaAddWrap: { position: 'absolute', left: 0, right: 0, top: 0, height: QA_ADD_H },
  qaAdd: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 18, borderWidth: 1, borderStyle: 'dashed',
  },
  qaAddText: { color: C.textDim, fontFamily: F.med, fontSize: 13, letterSpacing: TRACK.small },
  link: { fontFamily: F.semi, fontSize: 13, letterSpacing: TRACK.small },
  journalNudge: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 14, paddingHorizontal: 16, borderRadius: S.radiusSm, marginTop: 18, marginBottom: 4,
  },
  journalNudgeText: { flex: 1, color: C.textDim, fontFamily: F.med, fontSize: 14, letterSpacing: TRACK.small },
  taskWrap: { flex: 1, marginLeft: 12 },
  taskText: { color: C.text, fontFamily: F.reg, fontSize: 15, letterSpacing: TRACK.body },
  missionPill: {
    backgroundColor: C.amber + '1C', borderColor: C.amber + '55', borderWidth: 1,
    borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, marginLeft: 8,
  },
  missionPillText: { color: C.amber, fontFamily: F.bold, fontSize: 11, letterSpacing: TRACK.caps },
  barValue: { color: C.textFaint, fontFamily: F.med, fontSize: 11, letterSpacing: TRACK.fine, marginBottom: 4, fontVariant: ['tabular-nums'] },
  barLabel: { color: C.textFaint, fontFamily: F.med, fontSize: 11, letterSpacing: TRACK.fine, marginTop: 7 },
  barTrough: {
    width: 16, height: 56, borderRadius: 8,
    overflow: 'hidden', justifyContent: 'flex-end',
  },
  sheetSection: {
    color: C.textFaint, fontFamily: F.semi, fontSize: 11,
    textTransform: 'uppercase', letterSpacing: TRACK.caps, marginTop: 14, marginBottom: 8,
  },
});
