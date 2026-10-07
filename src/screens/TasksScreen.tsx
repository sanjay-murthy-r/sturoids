import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { C, F, MIN, S, T, TRACK, neuRaised } from '../theme';
import { useStore, DailyTask, Mission, TodoReminder } from '../store';
import { yesterdayKey, daysUntil, fmtShortDate, fmtClockTime, toMinutes, indexAfterNeighbours } from '../utils';
import {
  ScreenBG, Card, CheckCircle, Sheet, Field, PillButton, EmptyState, Row, IconBtn, Toggle, useTheme, useToolHeader, contextLine,
  ListCard, ListRow, StrikeText,
} from '../components/UI';
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
import { QuickTaskSheet } from '../components/QuickTaskSheet';

type Tab = 'daily' | 'missions';

const TABS: { key: Tab; label: string }[] = [
  { key: 'daily', label: 'ToDos · daily' },
  { key: 'missions', label: 'Tasks · long-term' },
];

const confirmDelete = (what: string, fn: () => void) =>
  Alert.alert('Delete', 'Remove "' + what + '"?', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: fn },
  ]);

/** a stored HH:MM as the clock reads (12 or 24 hours, the setting's choice); a time that cannot be read shows as saved */
const clock = (hhmm: string, hour24: boolean) => {
  const m = toMinutes(hhmm);
  return m < 0 ? hhmm : fmtClockTime(m, hour24);
};

/** The minutes from `now` until a deadline falls due. A deadline is a day with no time of day, and falls due as that day turns. */
const minutesToDue = (deadline: string, now: Date) => {
  const end = new Date(deadline + 'T00:00:00');
  end.setDate(end.getDate() + 1);
  return Math.round((end.getTime() - now.getTime()) / 60000);
};

export function TasksScreen({ mode }: { mode: 'tab' | 'stack' }) {
  const insets = useSafeAreaInsets();
  const fk = useFocusKey();
  const theme = useTheme();
  const level = useAnimLevel();
  const [tab, setTab] = useState<Tab>('daily');

  const dailyTasks = useStore((s) => s.dailyTasks);
  const toggleDaily = useStore((s) => s.toggleDaily);
  const removeDaily = useStore((s) => s.removeDaily);
  const restoreDaily = useStore((s) => s.restoreDaily);
  const lastTriage = useStore((s) => s.lastTriage);
  const setLastTriage = useStore((s) => s.setLastTriage);

  const missions = useStore((s) => s.missions);
  const toggleMission = useStore((s) => s.toggleMission);
  const removeMission = useStore((s) => s.removeMission);

  const reminderOn = useStore((s) => s.settings.todoReminderEnabled);
  const hasCheckIns = useStore((s) => s.todoReminders.length > 0);
  const remindersOn = useStore((s) => s.settings.remindersEnabled);

  const [addSheet, setAddSheet] = useState(false);
  const [editTask, setEditTask] = useState<DailyTask | null>(null);
  const [remindSheet, setRemindSheet] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [triaged, setTriaged] = useState<string[]>([]);

  const today = useToday();
  // the triage is a DAILY ritual — lastTriage expires with the date, so this
  // session's "keep" list has to expire with it or kept leftovers never return
  React.useEffect(() => { setTriaged((x) => (x.length ? [] : x)); }, [today]);

  const leftovers = useMemo(() => {
    if (lastTriage === today) return [];
    const yest = yesterdayKey();
    return dailyTasks.filter(
      (t) =>
        t.createdAt < new Date(today + 'T00:00:00').getTime() &&
        t.doneOn !== yest && t.doneOn !== today && !triaged.includes(t.id)
    );
  }, [dailyTasks, lastTriage, triaged, today]);

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
  // a long-term task takes its steps with it, and the store cannot put one back yet, so it still asks first
  const askDeleteMission = useCallback((m: Mission) => confirmDelete(m.title, () => removeMission(m.id)), [removeMission]);
  const toggleOpen = useCallback((id: string) => setExpanded((x) => (x === id ? null : id)), []);
  const clearDone = () => {
    const done = useStore.getState().missions.filter((m) => m.done);
    if (!done.length) return;
    Alert.alert(
      done.length === 1 ? 'Clear the done task?' : 'Clear ' + done.length + ' done tasks?',
      'They go with their steps. Open tasks stay as they are.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: () => { for (const m of done) removeMission(m.id); } },
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
  const openDaily = useMemo(() => dailyTasks.filter((t) => t.doneOn !== today).length, [dailyTasks, today]);
  const openCount = useMemo(() => missions.filter((m) => !m.done).length, [missions]);
  const dueToday = useMemo(() => missions.filter((m) => !m.done && daysUntil(m.deadline) === 0).length, [missions, today]);
  // Today counts these as due too, so the ToDos' line never leaves out a task that is past its day
  const overdue = useMemo(() => missions.filter((m) => !m.done && daysUntil(m.deadline) < 0).length, [missions, today]);
  const nextDue = useMemo(() => {
    let next: Mission | null = null;
    for (const m of missions) if (!m.done && (!next || m.deadline < next.deadline)) next = m;
    return next;
  }, [missions]);
  // The dot is for a task due within the hour. Deadlines carry no time of day (and a ToDo has none at all), so a task
  // falls due as its day turns, the reading Today uses: the hour that counts is the last of the deadline's day.
  const dueSoon = useMemo(
    () => missions.filter((m) => { const left = minutesToDue(m.deadline, now); return !m.done && left > 0 && left <= 60; }),
    [missions, now],
  );
  const dueSoonLine = dueSoon.length === 0 ? null
    : [{ em: dueSoon.length === 1 ? dueSoon[0].title : dueSoon.length + ' tasks' }, ' due by midnight'];
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
  const header = useToolHeader({
    title: tab === 'daily' ? 'ToDos' : 'Tasks',
    mode: tabMode ? 'tab' : 'page',
    context,
    live: dueSoon.length > 0,
    actions: [{
      // the bell looks on only when something can ring: reminders switched off in Settings leave it plain
      icon: remindersOn && (reminderOn || hasCheckIns) ? 'notifications' : 'notifications-outline',
      label: 'Reminders',
      color: remindersOn && reminderOn ? C.accent : undefined,
      onPress: () => setRemindSheet(true),
    }],
  });
  reveal.current = { tab: tabMode, barH: header.barH, still: level === 'none', y: header.scrollY };

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

  const empty = tab === 'daily' ? dailyTasks.length === 0 : missions.length === 0;
  // switching lists, or a list filling or emptying, brings the new body into the old one's place: the other list comes
  // in from the side its segment is on, and a list that fills or empties rises where the other stood
  const bodyKey = tab + (empty ? ':empty' : ':list');
  const bodyIn = useSwapIn(bodyKey, tab === 'daily' ? 0 : 1);

  return (
    <ScreenBG guard={tabMode}>
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
        {/* the header's hero, the list switch and the list rise together: the screen's first entrance */}
        <Enter index={0}>
          {header.hero}
          <SegmentedControl
            options={TABS}
            value={tab}
            onChange={(k) => setTab(k)}
            stretch
            style={{ marginBottom: 16 }}
          />

          <Animated.View key={bodyKey} entering={bodyIn}>
            {tab === 'daily' ? (
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
                  <EmptyState icon="sunny-outline" title="Your daily list resets each morning" body='Tap the bell for a daily "plan your day" nudge.' />
                ) : (
                  <Animated.View layout={glide(level)}>
                    <ListCard>
                      {dailyTasks.map((t) => (
                        <DailyRow
                          key={t.id} task={t} done={t.doneOn === today} onToggle={toggleDaily} onEdit={editDaily} onDelete={deleteDaily}
                        />
                      ))}
                    </ListCard>
                  </Animated.View>
                )}
              </>
            ) : missions.length === 0 ? (
              <EmptyState icon="flag-outline" title="Deadline-bound work lives here" body="Mock tests, revision targets, projects." />
            ) : (
              <MissionList
                open={openMissions} done={doneMissions} expanded={expanded} today={today} hint={!anySteps}
                onToggle={toggleMission} onToggleOpen={toggleOpen} onDelete={askDeleteMission}
                onStepFocus={revealStep} onClearDone={clearDone}
              />
            )}
          </Animated.View>
        </Enter>
      </Animated.ScrollView>

      <Animated.View
        pointerEvents={typing ? 'none' : 'box-none'}
        style={[st.fabWrap, { bottom: tabMode ? 24 : insets.bottom + 20 }, fabIn]}
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
    </ScreenBG>
  );
}

/** One ToDo. Its own memoised row, so ticking it leaves every other row alone. A long press opens it for editing. */
const DailyRow = React.memo(function DailyRow({ task, done, onToggle, onEdit, onDelete }: {
  task: DailyTask; done: boolean; onToggle: (id: string) => void; onEdit: (t: DailyTask) => void; onDelete: (t: DailyTask) => void;
}) {
  return (
    <ListRow onLongPress={() => onEdit(task)}>
      <CheckCircle done={done} onPress={() => onToggle(task.id)} label={task.title} />
      <StrikeText done={done} style={st.taskText} wrapStyle={st.taskWrap}>{task.title}</StrikeText>
      <IconBtn name="trash-outline" size={18} onPress={() => onDelete(task)} accessibilityLabel={'Delete ' + task.title} />
    </ListRow>
  );
});

/**
 * The long-term tasks: the open ones by deadline, and the done ones folded under one quiet row beneath them. Built
 * with its list, so the fold starts closed each time the list is shown, and a part that turns up later fades in.
 */
function MissionList({ open, done, expanded, today, hint, onToggle, onToggleOpen, onDelete, onStepFocus, onClearDone }: {
  open: Mission[]; done: Mission[]; expanded: string | null; today: string;
  /** no task has steps yet: say once, under the list, how to give one some */
  hint: boolean;
  onToggle: (id: string) => void; onToggleOpen: (id: string) => void; onDelete: (m: Mission) => void;
  onStepFocus: (field: View | null) => void; onClearDone: () => void;
}) {
  const level = useAnimLevel();
  const built = useBuilt();
  const [showDone, setShowDone] = useState(false);
  const turn = useSharedValue(0);
  React.useEffect(() => {
    turn.value = level === 'none' ? (showDone ? 1 : 0) : withTiming(showDone ? 1 : 0, CHANGE);
  }, [showDone, level]);
  const chevronStyle = useAnimatedStyle(() => ({ transform: [{ rotate: turn.value * 180 + 'deg' }] }));
  const enter = built.current ? rowIn(level) : undefined;
  const rows = (list: Mission[]) => list.map((m) => (
    <MissionRow
      key={m.id} m={m} today={today} open={expanded === m.id}
      onToggle={onToggle} onToggleOpen={onToggleOpen} onDelete={onDelete} onStepFocus={onStepFocus}
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
const MissionRow = React.memo(function MissionRow({ m, open, onToggle, onToggleOpen, onDelete, onStepFocus }: {
  /** only compared, never read: a new day re-renders the row, so its countdown turns over at midnight */
  today: string;
  m: Mission; open: boolean;
  onToggle: (id: string) => void; onToggleOpen: (id: string) => void; onDelete: (m: Mission) => void;
  /** the step field took focus: the screen keeps it clear of the bar */
  onStepFocus: (field: View | null) => void;
}) {
  useTheme(); // a memo row: it follows a new accent itself, since its props do not change with one
  const level = useAnimLevel();
  const addSubtask = useStore((s) => s.addSubtask);
  const toggleSubtask = useStore((s) => s.toggleSubtask);
  const removeSubtask = useStore((s) => s.removeSubtask);
  const [draft, setDraft] = useState('');
  const stepField = React.useRef<View>(null);
  // folding the steps away drops the half-typed step with them
  React.useEffect(() => { if (!open) setDraft(''); }, [open]);

  const d = daysUntil(m.deadline);
  // the line below gives the date, so an overdue task's pill says only that it is
  const pillText = m.done ? 'DONE' : d < 0 ? 'OVERDUE' : d === 0 ? 'TODAY' : 'D-' + d;
  const pillColor = m.done ? C.green : d < 0 ? C.danger : d <= 2 ? C.amber : C.accent;
  const subDone = m.subtasks.filter((x) => x.done).length;
  const line = fmtShortDate(m.deadline) + (m.subtasks.length > 0 ? ', ' + subDone + '/' + m.subtasks.length + ' steps' : '');
  const addStep = () => {
    const t = draft.trim();
    if (!t) return;
    addSubtask(m.id, t);
    setDraft('');
  };
  return (
    <View style={st.missionRow}>
      <Row>
        <CheckCircle done={m.done} color={C.amber} onPress={() => onToggle(m.id)} label={m.title} />
        <Pressable
          style={st.taskWrap} onPress={() => onToggleOpen(m.id)}
          accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={'Steps for ' + m.title + ', ' + line}
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
          <Steps m={m} onToggle={toggleSubtask} onRemove={removeSubtask} />
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
 * The reminders sheet. Its times and labels are typed here, so a keystroke re-renders the sheet alone, never the
 * whole list behind it.
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
        <Field
          value={setupTime} onChangeText={setSetupTime}
          placeholder="07:00" keyboardType="numbers-and-punctuation" style={{ flex: 1, marginBottom: 0 }}
        />
        <FadeSwap swapKey={saved ? 'saved' : 'set'}>
          <PillButton
            small label={saved ? 'Saved' : 'Set time'} style={st.setTime}
            onPress={async () => {
              if (toMinutes(setupTime.trim()) < 0) { Alert.alert('Time format', 'Use 24h HH:MM, e.g. 07:00'); return; }
              // a time is set to ring: it turns the nudge on, never leaving it saved behind a switch that is off
              setSetting('todoReminderTime', setupTime.trim());
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
        <Field
          value={remTime} onChangeText={(v) => { added.current = false; setRemTime(v); }}
          placeholder="16:30" keyboardType="numbers-and-punctuation" style={{ width: 90, marginBottom: 0 }}
        />
        <Field
          value={remLabel} onChangeText={(v) => { added.current = false; setRemLabel(v); }}
          placeholder="Label (optional)" maxLength={60} style={{ flex: 1, marginHorizontal: 8, marginBottom: 0 }}
        />
        <PillButton
          small label="Add"
          onPress={async () => {
            if (added.current) return;
            if (toMinutes(remTime.trim()) < 0) { Alert.alert('Time format', 'Use 24h HH:MM'); return; }
            added.current = true;
            addTodoReminder(remTime.trim(), remLabel.trim());
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
  triageTitle: { color: C.amber, fontFamily: F.semi, fontSize: 13, marginBottom: 10, letterSpacing: TRACK.small },
  taskWrap: { flex: 1, marginLeft: 12 },
  taskText: { color: C.text, fontFamily: F.reg, fontSize: 15, lineHeight: 21, letterSpacing: TRACK.body },
  missionRow: { paddingVertical: 12, paddingHorizontal: 12 },
  steps: { marginTop: 10, paddingLeft: 4 },
  stepWrap: { flex: 1, marginLeft: 10 },
  stepText: { color: C.textDim, fontFamily: F.reg, fontSize: 14, letterSpacing: TRACK.small, lineHeight: 20 },
  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, marginHorizontal: 6 },
  pillText: { fontSize: 11, fontFamily: F.semi, letterSpacing: TRACK.caps },
  // under a list card (which keeps S.gap below it), nearer the list it speaks of
  listHint: { ...T.caption, marginTop: -4, marginBottom: 14, paddingHorizontal: 4 },
  doneRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, paddingVertical: 10, paddingHorizontal: 4 },
  doneText: { color: C.textFaint, fontFamily: F.semi, fontSize: 13, letterSpacing: TRACK.small },
  clearDone: { alignSelf: 'center', paddingHorizontal: 8, paddingVertical: 4, marginBottom: 8 },
  linkText: { fontFamily: F.semi, fontSize: 13, letterSpacing: TRACK.small },
  // wide enough for either of its labels, so the field beside it holds still as it changes
  setTime: { marginLeft: 8, minWidth: 92 },
  fabWrap: { position: 'absolute', right: 20, bottom: 24 },
  fab: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
  sheetSection: {
    color: C.textFaint, fontSize: 11, fontFamily: F.semi,
    textTransform: 'uppercase', letterSpacing: TRACK.caps, marginTop: 18, marginBottom: 8,
  },
});
