import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { C, F, MIN, S, T, TRACK, neuRaised } from '../theme';
import { useStore, DailyTask, Mission, TodoReminder } from '../store';
import { yesterdayKey, daysUntil, fmtShortDate, fmtClockTime, toMinutes, indexAfterNeighbours, daysLabel, todoDueOn } from '../utils';
import {
  ScreenBG, Card, CheckCircle, Sheet, Field, PillButton, EmptyState, Row, IconBtn, Toggle, useTheme, useToolHeader, contextLine,
  ListCard, ListRow, StrikeText, TimeField, ArrivalPulse,
} from '../components/UI';
import type { ContextPart } from '../components/UI';
import { useExport } from '../reports';
import { SegmentedControl } from '../components/SegmentedControl';
import {
  CHANGE, EASE_OUT, Enter, Bouncy, FadeSwap, glide, rowIn, rowOut, useAnimLevel, useBuilt, useEntrance, useFocusKey,
} from '../components/Motion';
import { useSwapIn } from '../components/Swap';
import { tap } from '../haptics';
import { rescheduleAllReminders, turnOnReminders } from '../notifications';
import { toast } from '../components/Toast';
import { useNow, useToday } from '../hooks/useNow';
import { useKeyboardOpen } from '../hooks/useKeyboard';
import { QuickTaskSheet, shortClock } from '../components/QuickTaskSheet';
import { toastTrashed, toastTrashedMany } from '../trashToast';
import { leftoverTodos, orderTodos } from '../todos';
import { useBringIntoView } from '../hooks/useBringIntoView';
import { useArrowsLift, useRail } from '../hooks/useRail';
import { RAIL_W, READ_MAX, TWO_COL_AT, WIDE_MAX } from '../layout';

type Tab = 'daily' | 'missions';

const TABS: { key: Tab; label: string }[] = [
  { key: 'daily', label: 'ToDos · daily' },
  { key: 'missions', label: 'Tasks · long-term' },
];

/** a stored HH:MM as the clock reads (12 or 24 hours, the setting's choice); a time that cannot be read shows as saved */
const clock = (hhmm: string, hour24: boolean) => {
  const m = toMinutes(hhmm);
  return m < 0 ? hhmm : fmtClockTime(m, hour24);
};

/**
 * The minutes from `now` until a deadline falls due: at its time of day, or, with none, as that day turns. Worked out
 * from the dates themselves, so a task due just after midnight is near late the evening before.
 */
const minutesToDue = (deadline: string, now: Date, time?: string) => {
  const end = new Date(deadline + 'T00:00:00');
  const at = time ? toMinutes(time) : -1;
  if (at >= 0) end.setMinutes(at);
  else end.setDate(end.getDate() + 1);
  return Math.round((end.getTime() - now.getTime()) / 60000);
};

/** Something due within the hour: a ToDo or a long-term task, with the time it is due by ('' for the end of its day). */
interface DueSoon { title: string; time: string }

export function TasksScreen({ mode }: { mode: 'tab' | 'stack' }) {
  const insets = useSafeAreaInsets();
  const fk = useFocusKey();
  const theme = useTheme();
  const level = useAnimLevel();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('daily');

  // Arrivals. Today's Coming up row opens the long-term list (`list`); Sift opens a ToDo or a task (`item`: the list it
  // is on, scrolled to it, with one pulse) or the reminders sheet (`sheet`). Each param is cleared once followed, so the
  // same link works again.
  const params = useLocalSearchParams<{ list?: string; item?: string; sheet?: string }>();
  const [arrive, setArrive] = useState<string | null>(null);
  const [remindSheet, setRemindSheet] = useState(false);
  useFocusEffect(useCallback(() => {
    const clear: Record<string, undefined> = {};
    if (params.list === 'missions') { setTab('missions'); clear.list = undefined; }
    if (params.item) {
      const s = useStore.getState();
      if (s.missions.some((m) => m.id === params.item)) setTab('missions');
      else if (s.dailyTasks.some((t) => t.id === params.item)) setTab('daily');
      setArrive(params.item);
      clear.item = undefined;
    }
    if (params.sheet === 'reminders') { setRemindSheet(true); clear.sheet = undefined; }
    if (Object.keys(clear).length) router.setParams(clear);
  }, [params.list, params.item, params.sheet]));
  // the pulse is given once; after it the same item can be arrived at again
  React.useEffect(() => {
    if (!arrive) return undefined;
    const t = setTimeout(() => setArrive(null), 2000);
    return () => clearTimeout(t);
  }, [arrive]);

  const dailyTasks = useStore((s) => s.dailyTasks);
  const toggleDaily = useStore((s) => s.toggleDaily);
  const removeDaily = useStore((s) => s.removeDaily);
  const restoreDaily = useStore((s) => s.restoreDaily);
  const lastTriage = useStore((s) => s.lastTriage);
  const setLastTriage = useStore((s) => s.setLastTriage);

  const missions = useStore((s) => s.missions);
  const toggleMission = useStore((s) => s.toggleMission);
  const trashMission = useStore((s) => s.trashMission);

  const reminderOn = useStore((s) => s.settings.todoReminderEnabled);
  const hasCheckIns = useStore((s) => s.todoReminders.length > 0);
  const remindersOn = useStore((s) => s.settings.remindersEnabled);
  const hour24 = useStore((s) => s.settings.hour24);

  const [addSheet, setAddSheet] = useState(false);
  const [editTask, setEditTask] = useState<DailyTask | Mission | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [triaged, setTriaged] = useState<string[]>([]);

  const today = useToday();
  // the triage is a DAILY ritual — lastTriage expires with the date, so this
  // session's "keep" list has to expire with it or kept leftovers never return
  React.useEffect(() => { setTriaged((x) => (x.length ? [] : x)); }, [today]);

  // one-offs left open from before; a repeating ToDo comes back by itself, so it is never asked about
  const leftovers = useMemo(
    () => (lastTriage === today ? [] : leftoverTodos(dailyTasks, today, yesterdayKey(), triaged)),
    [dailyTasks, lastTriage, triaged, today],
  );
  // the list as shown: open ones by their time (untimed after), the ones ticked today sunk below them, and the weekly
  // ones not due today dimmed at the end
  const todoRows = useMemo(() => orderTodos(dailyTasks, today), [dailyTasks, today]);

  const keepOne = (id: string) => {
    setTriaged((x) => [...x, id]);
    if (leftovers.length <= 1) setLastTriage(today);
  };
  // dropping is the triage's answer, so it asks nothing first; for a slip of the finger, the toast offers Undo. Drops
  // made one after another share one toast and one Undo, so the first is never lost when the next toast replaces it.
  const drops = React.useRef<{ list: { task: DailyTask; before: string[] }[]; triageBefore: string; timer: ReturnType<typeof setTimeout> | null }>({
    list: [], triageBefore: '', timer: null,
  });
  React.useEffect(() => () => { if (drops.current.timer) clearTimeout(drops.current.timer); }, []);
  const dropOne = (id: string) => {
    const list = useStore.getState().dailyTasks;
    const index = list.findIndex((t) => t.id === id);
    if (index < 0) return;
    const task = list[index];
    const wasLast = leftovers.length <= 1;
    const batch = drops.current;
    if (!batch.list.length) batch.triageBefore = useStore.getState().lastTriage;
    // what stood before it, so Undo puts it back beside its neighbours even if the list changes meanwhile
    batch.list.push({ task, before: list.slice(0, index).map((t) => t.id) });
    removeDaily(id);
    if (wasLast) setLastTriage(today);
    // the batch lasts as long as its toast
    if (batch.timer) clearTimeout(batch.timer);
    batch.timer = setTimeout(() => { batch.list = []; batch.timer = null; }, 4400);
    const taken = [...batch.list];
    const triageBefore = batch.triageBefore;
    toast(taken.length === 1 ? 'Dropped "' + task.title + '"' : 'Dropped ' + taken.length + ' ToDos', {
      label: 'Undo',
      onPress: () => {
        // back in the reverse order they went, each beside the nearest neighbour it had that is still there; each
        // comes back as a new row, so it fades in there while the rows below it glide down to make room
        for (let i = taken.length - 1; i >= 0; i--) {
          const now = useStore.getState().dailyTasks.map((t) => t.id);
          restoreDaily(taken[i].task, indexAfterNeighbours(taken[i].before, now));
        }
        // the leftovers come back undecided
        setLastTriage(triageBefore);
        batch.list = [];
        if (batch.timer) { clearTimeout(batch.timer); batch.timer = null; }
      },
    });
  };

  // the open tasks by deadline; the done ones fold away beneath them
  const byDeadline = (a: Mission, b: Mission) => a.deadline.localeCompare(b.deadline);
  const openMissions = useMemo(() => missions.filter((m) => !m.done).sort(byDeadline), [missions]);
  const doneMissions = useMemo(() => missions.filter((m) => m.done).sort(byDeadline), [missions]);
  // a task's steps are found by tapping it: said once, under the list, until a task has some
  const anySteps = useMemo(() => missions.some((m) => m.subtasks.length > 0), [missions]);

  // The rows' callbacks keep their identity, so ticking one row re-renders that row alone. A ToDo goes at once and the
  // toast offers Undo, as the Planner's blocks and habits do: it comes back beside the ToDo it followed.
  const deleteDaily = useCallback((t: DailyTask) => {
    const list = useStore.getState().dailyTasks;
    const index = list.findIndex((x) => x.id === t.id);
    if (index < 0) return;
    const task = list[index];
    const before = list.slice(0, index).map((x) => x.id);
    removeDaily(t.id);
    toast('Deleted ' + task.title, {
      label: 'Undo',
      onPress: () => restoreDaily(task, indexAfterNeighbours(before, useStore.getState().dailyTasks.map((x) => x.id))),
    });
  }, [removeDaily, restoreDaily]);
  const editDaily = useCallback((t: DailyTask) => { setEditTask(t); setAddSheet(true); }, []);
  const editMission = useCallback((m: Mission) => { setEditTask(m); setAddSheet(true); }, []);
  // a long-term task goes to Recently deleted, steps and all, and the toast's Undo puts it back where it was
  const deleteMission = useCallback((m: Mission) => { toastTrashed(trashMission(m.id)); }, [trashMission]);
  const toggleOpen = useCallback((id: string) => setExpanded((x) => (x === id ? null : id)), []);
  const clearDone = () => {
    const done = useStore.getState().missions.filter((m) => m.done);
    if (!done.length) return;
    const clear = () => {
      const ids = useStore.getState().missions.filter((m) => m.done).map((m) => m.id);
      if (!ids.length) return;
      // each to Recently deleted, keeping its place; one toast and one Undo for them all
      toastTrashedMany(ids.map((id) => trashMission(id)), 'Moved ' + ids.length + ' done tasks to Recently deleted');
    };
    Alert.alert(
      done.length === 1 ? 'Clear the done task?' : 'Clear ' + done.length + ' done tasks?',
      'They move to Recently deleted with their steps. Open tasks stay as they are.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: clear },
      ],
    );
  };

  // The step field opened under the tab-mode bar: Android brings a focused field into view only when it is outside the
  // scroll, and the bar lies over the scroll's top, so a field tapped half under it stays there. It is moved to just
  // below the bar. (With the keyboard up, the window shrinks from below and the field is kept in view.)
  const scrollRef = React.useRef<Animated.ScrollView>(null);
  const reveal = React.useRef<{ tab: boolean; barH: number; still: boolean; y: { value: number } | null }>({
    tab: false, barH: 0, still: false, y: null,
  });
  const revealStep = useCallback((field: View | null) => {
    const r = reveal.current;
    if (!r.tab || !field || !r.y) return;
    const y0 = r.y.value;
    field.measureInWindow((_x, y) => {
      const clear = r.barH + 8;
      if (y >= clear) return;
      scrollRef.current?.scrollTo({ y: Math.max(0, y0 - (clear - y)), animated: !r.still });
    });
  }, []);

  // the header's line: counts that are not zero, and what falls due. The minute turns it over (useNow, only while this
  // screen is in front), so a deadline coming up is noticed without a tap
  const now = useNow();
  // a weekly ToDo off its days is not open today
  const openDaily = useMemo(() => dailyTasks.filter((t) => t.doneOn !== today && todoDueOn(t, today)).length, [dailyTasks, today]);
  const openCount = useMemo(() => missions.filter((m) => !m.done).length, [missions]);
  const dueToday = useMemo(() => missions.filter((m) => !m.done && daysUntil(m.deadline) === 0).length, [missions, today]);
  // Today counts these as due too, so the ToDos' line never leaves out a task that is past its day
  const overdue = useMemo(() => missions.filter((m) => !m.done && daysUntil(m.deadline) < 0).length, [missions, today]);
  const nextDue = useMemo(() => {
    let next: Mission | null = null;
    for (const m of missions) if (!m.done && (!next || m.deadline < next.deadline)) next = m;
    return next;
  }, [missions]);
  // The dot is for something due within the hour: an open ToDo with a time (it is due by then every day it is open), or
  // a long-term task due today, by its time or, with none, as its day turns, the reading Today uses.
  const dueSoon = useMemo(() => {
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const out: DueSoon[] = [];
    for (const t of dailyTasks) {
      if (!t.time) continue;
      let left = toMinutes(t.time) - nowMin;
      // a time already past today is next due tomorrow: late in the evening, one just after midnight is within the hour.
      // Tomorrow it is open unless it is a one-off ticked today, which goes as the day turns
      const tomorrow = left <= 0;
      if (tomorrow) left += 1440;
      if (t.doneOn === today && (!tomorrow || t.repeat !== 'daily')) continue;
      // a weekly ToDo is due only on its days
      if (!todoDueOn(t, tomorrow ? new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) : now)) continue;
      if (left > 0 && left <= 60) out.push({ title: t.title, time: t.time });
    }
    for (const m of missions) {
      if (m.done) continue;
      const left = minutesToDue(m.deadline, now, m.time);
      if (left > 0 && left <= 60) out.push({ title: m.title, time: m.time || '' });
    }
    return out;
  }, [dailyTasks, missions, now, today]);
  const dueSoonLine: ContextPart[] | null = dueSoon.length === 0 ? null
    : dueSoon.length === 1
      ? [{ em: dueSoon[0].title }, ' due by ' + (dueSoon[0].time ? shortClock(dueSoon[0].time, hour24) : 'midnight')]
      : [{ em: dueSoon.length + ' tasks' }, ' due within the hour'];
  const nextDueLine = nextDue == null ? null : (() => {
    const d = daysUntil(nextDue.deadline);
    return d < 0 ? 'overdue since ' + fmtShortDate(nextDue.deadline)
      : d === 0 ? 'next due today' : d === 1 ? 'next due tomorrow' : 'next due ' + fmtShortDate(nextDue.deadline);
  })();
  const context = tab === 'daily'
    ? contextLine(
      openDaily > 0 ? openDaily + ' open' : dailyTasks.length > 0 && 'All done',
      overdue > 0 && overdue + (overdue === 1 ? ' task overdue' : ' tasks overdue'),
      dueSoonLine ?? (dueToday > 0 && dueToday + (dueToday === 1 ? ' task due today' : ' tasks due today')),
    )
    : contextLine(openCount > 0 ? openCount + ' open' : missions.length > 0 && 'All done', dueSoonLine ?? nextDueLine);

  const tabMode = mode === 'tab';
  // a wide window (a tablet turned sideways, the PC) shows both lists side by side, with no switch between them
  const { width: winW } = useWindowDimensions();
  const rail = useRail();
  const twoCol = winW - (rail && tabMode ? RAIL_W : 0) >= TWO_COL_AT;
  const exp = useExport(tab === 'daily' ? ['todos', 'longterm'] : ['longterm', 'todos'], { range: tab === 'daily' ? 'week' : '30d' });
  const header = useToolHeader({ scrollRef,
    title: twoCol ? 'Tasks' : tab === 'daily' ? 'ToDos' : 'Tasks',
    mode: tabMode ? 'tab' : 'page',
    context,
    live: dueSoon.length > 0,
    // the header pull opens Sift only while the list is calm: no sheet up over it
    pull: !addSheet && !remindSheet,
    actions: [{
      // the bell looks on only when something can ring: reminders switched off in Settings leave it plain
      icon: remindersOn && (reminderOn || hasCheckIns) ? 'notifications' : 'notifications-outline',
      label: 'Reminders',
      color: remindersOn && reminderOn ? C.accent : undefined,
      onPress: () => setRemindSheet(true),
    }, exp.action],
  });
  reveal.current = { tab: tabMode, barH: header.barH, still: level === 'none', y: header.scrollY };
  // a row Sift opened is brought into view
  const { topRef, bring } = useBringIntoView({
    scrollTo: (y, animated) => scrollRef.current?.scrollTo({ y, animated }),
    scrollY: header.scrollY, padTop: header.padTop, barH: header.barH, still: level === 'none',
  });

  // the add button arrives with the screen, and sinks out of the way while the keyboard is up: it would sit over the
  // end of the step being typed, where its own add button is
  const fabIn = useEntrance(1);
  const typing = useKeyboardOpen();
  const sink = useSharedValue(typing ? 1 : 0);
  React.useEffect(() => {
    sink.value = level === 'none' ? (typing ? 1 : 0) : withTiming(typing ? 1 : 0, { duration: 160, easing: EASE_OUT });
  }, [typing, level]);
  const drop = level === 'full' ? 24 : 0;
  const sinkStyle = useAnimatedStyle(() => ({ opacity: 1 - sink.value, transform: [{ translateY: drop * sink.value }] }));

  const arrowsLift = useArrowsLift();
  const empty = tab === 'daily' ? dailyTasks.length === 0 : missions.length === 0;
  // switching lists, or a list filling or emptying, brings the new body into the old one's place: the other list comes
  // in from the side its segment is on, and a list that fills or empties rises where the other stood
  const bodyKey = tab + (empty ? ':empty' : ':list');
  const bodyIn = useSwapIn(bodyKey, tab === 'daily' ? 0 : 1);

  const dailyBody = (
              <>
                {leftovers.length > 0 && (
                  // the card fades away once the last leftover is decided, and the list below glides up
                  <Animated.View exiting={rowOut(level)}>
                    <Card>
                      {/* a ToDo can be left from several days back, not only from yesterday */}
                      <Text style={st.triageTitle}>Still open from before</Text>
                      {leftovers.map((t) => (
                        <Animated.View key={t.id} exiting={rowOut(level)} layout={glide(level)}>
                          <Row style={{ paddingVertical: 6 }}>
                            <Text style={[T.body, { flex: 1 }]} numberOfLines={1}>{t.title}</Text>
                            <PillButton small label="Keep" color={C.green} onPress={() => keepOne(t.id)} style={{ marginRight: 6 }} />
                            <PillButton small label="Drop" color={C.danger} outline onPress={() => dropOne(t.id)} />
                          </Row>
                        </Animated.View>
                      ))}
                      <Animated.View layout={glide(level)}>
                        <Pressable onPress={() => setLastTriage(today)} hitSlop={14} accessibilityRole="button">
                          <Text style={[T.caption, { textAlign: 'center', marginTop: 8 }]}>Keep all & dismiss</Text>
                        </Pressable>
                      </Animated.View>
                    </Card>
                  </Animated.View>
                )}
                {dailyTasks.length === 0 ? (
                  <EmptyState
                    icon="sunny-outline" title="Nothing on your list"
                    body="A ToDo stays until it is ticked. Switch on Every day for one that comes back each morning."
                  />
                ) : (
                  <Animated.View layout={glide(level)}>
                    <ListCard>
                      {todoRows.map(({ task: t, done, due }) => (
                        <DailyRow
                          key={t.id} task={t} done={done} due={due} hour24={hour24} arrive={arrive === t.id}
                          onToggle={toggleDaily} onEdit={editDaily} onDelete={deleteDaily} onArrive={bring}
                        />
                      ))}
                    </ListCard>
                  </Animated.View>
                )}
              </>
  );
  const missionBody = (
    missions.length === 0 ? (
              <EmptyState icon="flag-outline" title="Deadline-bound work lives here" body="Mock tests, revision targets, projects." />
            ) : (
              <MissionList
                open={openMissions} done={doneMissions} expanded={expanded} today={today} hint={!anySteps} hour24={hour24}
                arrive={arrive} onArrive={bring}
                onToggle={toggleMission} onToggleOpen={toggleOpen} onEdit={editMission} onDelete={deleteMission}
                onStepFocus={revealStep} onClearDone={clearDone}
              />
    )
  );

  return (
    <ScreenBG guard={tabMode} maxWidth={twoCol ? WIDE_MAX : READ_MAX}>
      {header.bar}
      <Animated.ScrollView
        key={fk}
        ref={scrollRef}
        {...header.scrollProps}
        // a tap on a row or a button while a step is being typed does its work, instead of only closing the keyboard
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: S.pad, paddingTop: header.padTop, paddingBottom: 130 + (tabMode ? 0 : insets.bottom) }}
        showsVerticalScrollIndicator={false}
      >
        <View ref={topRef} collapsable={false} />
        {/* the header's hero, the list switch and the list rise together: the screen's first entrance */}
        <Enter index={0}>
          {header.hero}
          {twoCol ? (
            <View style={st.twoCol}>
              <View style={st.col}>
                <Text style={st.colHead}>ToDos</Text>
                {dailyBody}
              </View>
              <View style={st.col}>
                <Text style={st.colHead}>Long-term</Text>
                {missionBody}
              </View>
            </View>
          ) : (
            <>
              <SegmentedControl
                options={TABS}
                value={tab}
                onChange={(k) => setTab(k)}
                stretch
                style={{ marginBottom: 16 }}
              />
              <Animated.View key={bodyKey} entering={bodyIn}>
                {tab === 'daily' ? dailyBody : missionBody}
              </Animated.View>
            </>
          )}
        </Enter>
      </Animated.ScrollView>

      <Animated.View
        pointerEvents={typing ? 'none' : 'box-none'}
        style={[st.fabWrap, { bottom: (tabMode ? 24 : insets.bottom + 20) + arrowsLift }, fabIn]}
      >
        <Animated.View style={sinkStyle}>
          <Bouncy
            onPress={() => { tap(); setEditTask(null); setAddSheet(true); }}
            scaleTo={0.9}
            radius={999}
            accessibilityLabel={tab === 'daily' ? 'Add a ToDo' : 'Add a task'}
            accessibilityRole="button"
            style={[
              st.fab,
              theme === 'minimal'
                ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: C.accent }
                : { backgroundColor: C.card, ...neuRaised('high') },
            ]}
          >
            <Ionicons name="add" size={30} color={C.accent} />
          </Bouncy>
        </Animated.View>
      </Animated.View>

      <QuickTaskSheet
        visible={addSheet}
        onClose={() => setAddSheet(false)}
        initialKind={tab === 'daily' ? 'daily' : 'mission'}
        editing={editTask}
      />

      <RemindersSheet visible={remindSheet} onClose={() => setRemindSheet(false)} />
      {exp.sheet}
    </ScreenBG>
  );
}

/**
 * A row a link opened: once it has laid out (and the list it is on has come in), the screen brings it into view, and
 * then it pulses once.
 */
function useArrival(arrive: boolean, onArrive: (view: View | null) => void) {
  const ref = React.useRef<View>(null);
  const cb = React.useRef(onArrive);
  cb.current = onArrive;
  React.useEffect(() => {
    if (!arrive) return undefined;
    const t = setTimeout(() => cb.current(ref.current), 320);
    return () => clearTimeout(t);
  }, [arrive]);
  return ref;
}

/** the pulse waits for the scroll that brings its row into view */
const PULSE_DELAY = 640;

/**
 * One ToDo. Its own memoised row, so ticking it leaves every other row alone. A long press opens it for editing. A
 * time it is due by shows under it ("by 5 pm"), and one that comes back carries a small repeat glyph. One that repeats
 * on chosen days says which; on the other days it stands back, dimmed.
 */
const DailyRow = React.memo(function DailyRow({ task, done, due, hour24, arrive, onToggle, onEdit, onDelete, onArrive }: {
  task: DailyTask; done: boolean;
  /** shows today: false for a weekly ToDo on a day it does not repeat on */
  due: boolean;
  hour24: boolean;
  /** Sift opened this ToDo: it is brought into view and pulses once */
  arrive: boolean;
  onToggle: (id: string) => void; onEdit: (t: DailyTask) => void; onDelete: (t: DailyTask) => void;
  onArrive: (view: View | null) => void;
}) {
  useTheme(); // a memo row: its repeat glyph follows the theme, which its props do not change with
  const ref = useArrival(arrive, onArrive);
  const by = task.time ? 'by ' + shortClock(task.time, hour24) : '';
  const daily = task.repeat === 'daily';
  const days = daily && task.days?.length ? daysLabel(task.days) : '';
  const sub = [days, by].filter(Boolean).join(' · ');
  const spoken = task.title + (days ? ', on ' + days : daily ? ', every day' : '') + (by ? ', ' + by : '') + (due ? '' : ', not today');
  return (
    <View ref={ref} collapsable={false}>
      <ListRow onLongPress={() => onEdit(task)} accessibilityHint="Double tap and hold to edit" style={due ? undefined : st.offDay}>
        <CheckCircle done={done} onPress={() => onToggle(task.id)} label={spoken} />
        <View style={st.taskWrap}>
          <StrikeText done={done} style={st.taskText}>{task.title}</StrikeText>
          {sub ? <Text style={[T.caption, { marginTop: 2 }]}>{sub}</Text> : null}
        </View>
        {daily ? (
          <Ionicons name="repeat" size={15} color={C.textFaint} style={st.repeat} accessibilityElementsHidden importantForAccessibility="no" />
        ) : null}
        <IconBtn name="trash-outline" size={18} onPress={() => onDelete(task)} accessibilityLabel={'Delete ' + task.title} />
      </ListRow>
      <ArrivalPulse active={arrive} radius={14} delay={PULSE_DELAY} />
    </View>
  );
});

/**
 * The long-term tasks: the open ones by deadline, and the done ones folded under one quiet row beneath them. Built
 * with its list, so the fold starts closed each time the list is shown, and a part that turns up later fades in.
 */
function MissionList({
  open, done, expanded, today, hint, hour24, arrive, onArrive, onToggle, onToggleOpen, onEdit, onDelete, onStepFocus, onClearDone,
}: {
  open: Mission[]; done: Mission[]; expanded: string | null; today: string;
  /** no task has steps yet: say once, under the list, how to give one some */
  hint: boolean;
  hour24: boolean;
  /** the task Sift opened, if any: a done one unfolds the done tasks to show it */
  arrive: string | null;
  onArrive: (view: View | null) => void;
  onToggle: (id: string) => void; onToggleOpen: (id: string) => void; onEdit: (m: Mission) => void; onDelete: (m: Mission) => void;
  onStepFocus: (field: View | null) => void; onClearDone: () => void;
}) {
  const level = useAnimLevel();
  const built = useBuilt();
  const [showDone, setShowDone] = useState(false);
  React.useEffect(() => { if (arrive && done.some((m) => m.id === arrive)) setShowDone(true); }, [arrive]);
  const turn = useSharedValue(0);
  React.useEffect(() => {
    turn.value = level === 'none' ? (showDone ? 1 : 0) : withTiming(showDone ? 1 : 0, CHANGE);
  }, [showDone, level]);
  const chevronStyle = useAnimatedStyle(() => ({ transform: [{ rotate: turn.value * 180 + 'deg' }] }));
  const enter = built.current ? rowIn(level) : undefined;
  const rows = (list: Mission[]) => list.map((m) => (
    <MissionRow
      key={m.id} m={m} today={today} open={expanded === m.id} hour24={hour24} arrive={arrive === m.id} onArrive={onArrive}
      onToggle={onToggle} onToggleOpen={onToggleOpen} onEdit={onEdit} onDelete={onDelete} onStepFocus={onStepFocus}
    />
  ));
  return (
    <>
      {open.length > 0 && (
        <Animated.View entering={enter} exiting={rowOut(level)} layout={glide(level)}>
          <ListCard>{rows(open)}</ListCard>
          {hint ? <Text style={st.listHint}>Tap a task to list its steps.</Text> : null}
        </Animated.View>
      )}
      {done.length > 0 && (
        <Animated.View entering={enter} exiting={rowOut(level)} layout={glide(level)}>
          <Pressable
            onPress={() => { tap(); setShowDone((x) => !x); }} hitSlop={8} style={st.doneRow}
            accessibilityRole="button" accessibilityState={{ expanded: showDone }} accessibilityLabel={'Done tasks, ' + done.length}
          >
            <Text style={st.doneText}>Done · {done.length}</Text>
            <Animated.View style={chevronStyle}>
              <Ionicons name="chevron-down" size={14} color={C.textFaint} />
            </Animated.View>
          </Pressable>
          {showDone && (
            <Animated.View entering={rowIn(level)} exiting={rowOut(level)}>
              <ListCard>{rows(done)}</ListCard>
              <Pressable onPress={onClearDone} hitSlop={12} style={st.clearDone} accessibilityRole="button">
                <Text style={[st.linkText, { color: C.accent }]}>Clear done</Text>
              </Pressable>
            </Animated.View>
          )}
        </Animated.View>
      )}
    </>
  );
}

/**
 * One long-term task, with its steps folding out beneath it. The step being typed lives here, so a keystroke
 * re-renders this row only, and a half-typed step never follows you to another task.
 */
const MissionRow = React.memo(function MissionRow({ m, open, hour24, arrive, onArrive, onToggle, onToggleOpen, onEdit, onDelete, onStepFocus }: {
  /** only compared, never read: a new day re-renders the row, so its countdown turns over at midnight */
  today: string;
  m: Mission; open: boolean; hour24: boolean;
  /** Sift opened this task: it is brought into view and pulses once */
  arrive: boolean;
  onArrive: (view: View | null) => void;
  onToggle: (id: string) => void; onToggleOpen: (id: string) => void; onEdit: (m: Mission) => void; onDelete: (m: Mission) => void;
  /** the step field took focus: the screen keeps it clear of the bar */
  onStepFocus: (field: View | null) => void;
}) {
  useTheme(); // a memo row: it follows a new accent itself, since its props do not change with one
  const level = useAnimLevel();
  const arriveRef = useArrival(arrive, onArrive);
  const addSubtask = useStore((s) => s.addSubtask);
  const toggleSubtask = useStore((s) => s.toggleSubtask);
  const removeSubtask = useStore((s) => s.removeSubtask);
  const restoreSubtask = useStore((s) => s.restoreSubtask);
  const [draft, setDraft] = useState('');
  const stepField = React.useRef<View>(null);
  // folding the steps away drops the half-typed step with them
  React.useEffect(() => { if (!open) setDraft(''); }, [open]);

  // a step goes at once, and the toast's Undo puts it back beside the step it followed
  const removeStep = useCallback((missionId: string, subId: string) => {
    const task = useStore.getState().missions.find((x) => x.id === missionId);
    const at = task ? task.subtasks.findIndex((x) => x.id === subId) : -1;
    if (!task || at < 0) return;
    const before = task.subtasks.slice(0, at).map((x) => x.id);
    const gone = removeSubtask(missionId, subId);
    if (!gone) return;
    toast('Removed ' + gone.subtask.title, {
      label: 'Undo',
      onPress: () => {
        // a task deleted in the meantime takes its steps with it: there is nothing to put this one back into
        const cur = useStore.getState().missions.find((x) => x.id === missionId);
        if (cur) restoreSubtask(missionId, gone.subtask, indexAfterNeighbours(before, cur.subtasks.map((x) => x.id)));
      },
    });
  }, [removeSubtask, restoreSubtask]);

  const d = daysUntil(m.deadline);
  // the line below gives the date, so an overdue task's pill says only that it is
  const pillText = m.done ? 'DONE' : d < 0 ? 'OVERDUE' : d === 0 ? 'TODAY' : 'D-' + d;
  const pillColor = m.done ? C.green : d < 0 ? C.danger : d <= 2 ? C.amber : C.accent;
  const subDone = m.subtasks.filter((x) => x.done).length;
  const line = fmtShortDate(m.deadline) + (m.time ? ', by ' + shortClock(m.time, hour24) : '')
    + (m.subtasks.length > 0 ? ', ' + subDone + '/' + m.subtasks.length + ' steps' : '');
  const addStep = () => {
    const t = draft.trim();
    if (!t) return;
    addSubtask(m.id, t);
    setDraft('');
  };
  return (
    <View style={st.missionRow} ref={arriveRef} collapsable={false}>
      <Row>
        <CheckCircle done={m.done} color={C.amber} onPress={() => onToggle(m.id)} label={m.title} />
        {/* a tap folds the steps out; a long press opens the task for editing, as a ToDo's does */}
        <Pressable
          style={st.taskWrap} onPress={() => onToggleOpen(m.id)} onLongPress={() => onEdit(m)}
          accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={'Steps for ' + m.title + ', ' + line}
          accessibilityHint="Double tap and hold to edit"
        >
          <StrikeText done={m.done} style={st.taskText}>{m.title}</StrikeText>
          <Text style={[T.caption, { marginTop: 2 }]}>{line}</Text>
        </Pressable>
        <View style={[st.pill, { borderColor: pillColor + '55', backgroundColor: pillColor + '18' }]}>
          <Text style={[st.pillText, { color: pillColor }]}>{pillText}</Text>
        </View>
        <IconBtn name="trash-outline" size={18} onPress={() => onDelete(m)} accessibilityLabel={'Delete ' + m.title} />
      </Row>

      {/* the steps unfold, and the card grows around them */}
      {open && (
        <Animated.View entering={rowIn(level)} exiting={rowOut(level)} style={st.steps}>
          <Steps m={m} onToggle={toggleSubtask} onRemove={removeStep} />
          <Animated.View layout={glide(level)}>
            <View ref={stepField} collapsable={false}>
              <Row style={{ marginTop: 2 }}>
                {/* Return adds the step and keeps the keyboard up for the next; a tap outside closes it */}
                <Field
                  value={draft} onChangeText={setDraft} placeholder="Add a step" maxLength={140}
                  style={{ flex: 1, marginBottom: 0 }}
                  returnKeyType="done" submitBehavior="submit"
                  onSubmitEditing={addStep}
                  onFocus={() => onStepFocus(stepField.current)}
                />
                <IconBtn name="add-circle" color={C.accent} size={28} style={{ marginLeft: 6 }} onPress={addStep} accessibilityLabel="Add this step" />
              </Row>
            </View>
          </Animated.View>
        </Animated.View>
      )}
      <ArrivalPulse active={arrive} radius={14} delay={PULSE_DELAY} />
    </View>
  );
});

/** A task's steps: the ones there when it opens unfold with it; a step added or removed later fades in or out alone. */
function Steps({ m, onToggle, onRemove }: {
  m: Mission; onToggle: (missionId: string, subId: string) => void; onRemove: (missionId: string, subId: string) => void;
}) {
  const level = useAnimLevel();
  const built = useBuilt();
  return (
    <>
      {m.subtasks.map((sub) => (
        <Animated.View key={sub.id} entering={built.current ? rowIn(level) : undefined} exiting={rowOut(level)} layout={glide(level)}>
          <Row style={{ paddingVertical: 5 }}>
            <CheckCircle done={sub.done} size={20} onPress={() => onToggle(m.id, sub.id)} label={sub.title} />
            <StrikeText done={sub.done} style={st.stepText} wrapStyle={st.stepWrap}>{sub.title}</StrikeText>
            <IconBtn name="close" size={16} onPress={() => onRemove(m.id, sub.id)} accessibilityLabel={'Remove ' + sub.title} />
          </Row>
        </Animated.View>
      ))}
    </>
  );
}

/**
 * The reminders sheet. Its times are picked on the time wheel and its labels typed here, so a keystroke re-renders the
 * sheet alone, never the whole list behind it.
 */
function RemindersSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const enabled = useStore((s) => s.settings.todoReminderEnabled);
  const time = useStore((s) => s.settings.todoReminderTime);
  const remindersEnabled = useStore((s) => s.settings.remindersEnabled);
  const setSetting = useStore((s) => s.setSetting);
  const todoReminders = useStore((s) => s.todoReminders);
  const addTodoReminder = useStore((s) => s.addTodoReminder);
  const removeTodoReminder = useStore((s) => s.removeTodoReminder);
  const hour24 = useStore((s) => s.settings.hour24);
  const [setupTime, setSetupTime] = useState(time);
  const [remTime, setRemTime] = useState('');
  const [remLabel, setRemLabel] = useState('');
  // 'Set time' answers in place: its label crosses over to Saved for a moment
  const [saved, setSaved] = useState(false);
  React.useEffect(() => {
    if (!saved) return undefined;
    const t = setTimeout(() => setSaved(false), 1500);
    return () => clearTimeout(t);
  }, [saved]);
  // A check-in is added once for what was typed: a second tap before the cleared fields have rendered finds it set.
  // Typing again clears it.
  const added = React.useRef(false);
  // each opening starts from the saved time
  React.useEffect(() => {
    if (!visible) return;
    setSetupTime(useStore.getState().settings.todoReminderTime);
    setSaved(false);
  }, [visible]);
  const checkIns = useMemo(() => [...todoReminders].sort((a, b) => toMinutes(a.time) - toMinutes(b.time)), [todoReminders]);

  return (
    <Sheet visible={visible} onClose={onClose} title="ToDo reminders">
      <Row style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <Text style={T.body}>Daily "plan your ToDos" nudge</Text>
        <Toggle
          value={enabled}
          color={C.green}
          label="Daily plan your ToDos nudge"
          onChange={async (v) => {
            setSetting('todoReminderEnabled', v);
            // only switching one on asks for permission and enables reminders app-wide; switching off just
            // cancels it, so turning a nudge off can never silently turn reminders on
            if (v) await turnOnReminders();
            else setTimeout(rescheduleAllReminders, 200);
          }}
        />
      </Row>
      <Row>
        <TimeField value={setupTime} onChange={setSetupTime} style={{ flex: 1, marginBottom: 0 }} />
        <FadeSwap swapKey={saved ? 'saved' : 'set'}>
          <PillButton
            small label={saved ? 'Saved' : 'Set time'} style={st.setTime}
            onPress={async () => {
              if (toMinutes(setupTime) < 0) return;
              // a time is set to ring: it turns the nudge on, never leaving it saved behind a switch that is off
              setSetting('todoReminderTime', setupTime);
              setSetting('todoReminderEnabled', true);
              setSaved(true);
              await turnOnReminders();
            }}
          />
        </FadeSwap>
      </Row>

      <Text style={st.sheetSection}>Check-ins during the day</Text>
      <CheckInRows
        list={checkIns} hour24={hour24}
        onRemove={(r) => { removeTodoReminder(r.id); void rescheduleAllReminders(); }}
      />
      <Row style={{ marginTop: 4 }}>
        <TimeField
          value={remTime} onChange={(v) => { added.current = false; setRemTime(v); }} placeholder="Time"
          style={{ width: 104, marginBottom: 0 }}
        />
        <Field
          value={remLabel} onChangeText={(v) => { added.current = false; setRemLabel(v); }}
          placeholder="Label (optional)" maxLength={60} style={{ flex: 1, marginHorizontal: 8, marginBottom: 0 }}
        />
        <PillButton
          small label="Add"
          onPress={async () => {
            if (added.current) return;
            if (toMinutes(remTime) < 0) { Alert.alert('No time yet', 'Pick the time the check-in rings at.'); return; }
            added.current = true;
            addTodoReminder(remTime, remLabel.trim());
            setRemTime(''); setRemLabel('');
            await turnOnReminders();
          }}
        />
      </Row>
      {!remindersEnabled && (
        <Text style={[T.caption, { marginTop: 10 }]}>
          Reminders are off in Settings. Turning one on here asks for notification permission and switches them on.
        </Text>
      )}
    </Sheet>
  );
}

/**
 * The check-ins, by time of day. Built each time the sheet opens, so the ones there are simply there; one added or
 * removed while it is open fades in or out, and the rest glide to their places.
 */
function CheckInRows({ list, hour24, onRemove }: { list: TodoReminder[]; hour24: boolean; onRemove: (r: TodoReminder) => void }) {
  const level = useAnimLevel();
  const built = useBuilt();
  return (
    <>
      {list.map((r) => (
        <Animated.View key={r.id} entering={built.current ? rowIn(level) : undefined} exiting={rowOut(level)} layout={glide(level)}>
          <Row style={{ paddingVertical: 6 }}>
            <Text style={[T.body, { width: hour24 ? 62 : 80, fontVariant: ['tabular-nums'], color: C.accent }]}>{clock(r.time, hour24)}</Text>
            <Text style={[T.body, { flex: 1 }]} numberOfLines={1}>{r.label || 'ToDo check-in'}</Text>
            <IconBtn name="close" size={17} onPress={() => onRemove(r)} accessibilityLabel={'Remove the reminder at ' + clock(r.time, hour24)} />
          </Row>
        </Animated.View>
      ))}
    </>
  );
}

const st = StyleSheet.create({
  triageTitle: { color: C.amber, fontFamily: F.smSemi, fontSize: 13, marginBottom: 10, letterSpacing: TRACK.small },
  taskWrap: { flex: 1, marginLeft: 12 },
  taskText: { color: C.text, fontFamily: F.reg, fontSize: 15, lineHeight: 21, letterSpacing: TRACK.body },
  // a ToDo that comes back every day: a small glyph between its words and its delete
  repeat: { marginLeft: 8, marginRight: 2 },
  // a weekly ToDo on a day it does not repeat on stands back
  offDay: { opacity: 0.5 },
  missionRow: { paddingVertical: 12, paddingHorizontal: 12 },
  steps: { marginTop: 10, paddingLeft: 4 },
  stepWrap: { flex: 1, marginLeft: 10 },
  stepText: { color: C.textDim, fontFamily: F.reg, fontSize: 14, letterSpacing: TRACK.small, lineHeight: 20 },
  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, marginHorizontal: 6 },
  pillText: { fontSize: 11, fontFamily: F.smSemi, letterSpacing: TRACK.caps },
  // under a list card (which keeps S.gap below it), nearer the list it speaks of
  listHint: { ...T.caption, marginTop: -4, marginBottom: 14, paddingHorizontal: 4 },
  doneRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, paddingVertical: 10, paddingHorizontal: 4 },
  doneText: { color: C.textFaint, fontFamily: F.semi, fontSize: 13, letterSpacing: TRACK.small },
  clearDone: { alignSelf: 'center', paddingHorizontal: 8, paddingVertical: 4, marginBottom: 8 },
  linkText: { fontFamily: F.semi, fontSize: 13, letterSpacing: TRACK.small },
  // wide enough for either of its labels, so the field beside it holds still as it changes
  setTime: { marginLeft: 8, minWidth: 92 },
  fabWrap: { position: 'absolute', right: 20, bottom: 24 },
  twoCol: { flexDirection: 'row', alignItems: 'flex-start', gap: 20 },
  col: { flex: 1, minWidth: 0 },
  colHead: { ...T.kicker, marginBottom: 12, marginLeft: 4 },
  fab: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
  sheetSection: {
    color: C.textFaint, fontSize: 11, fontFamily: F.smSemi,
    textTransform: 'uppercase', letterSpacing: TRACK.caps, marginTop: 18, marginBottom: 8,
  },
});
