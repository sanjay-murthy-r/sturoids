import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated from 'react-native-reanimated';
import { C, F, MIN, S, T, neuRaised } from '../theme';
import { useStore, DailyTask, Mission } from '../store';
import { yesterdayKey, daysUntil, fmtShortDate, toMinutes, indexAfterNeighbours } from '../utils';
import {
  ScreenBG, Card, CheckCircle, Sheet, Field, PillButton, EmptyState, Row, IconBtn, Toggle, NeuHeader, useTheme,
  ListCard, ListRow, StrikeText,
} from '../components/UI';
import { SegmentedControl } from '../components/SegmentedControl';
import {
  Enter, Bouncy, FadeSwap, glide, riseIn, rowIn, rowOut, useAnimLevel, useBuilt, useFocusKey,
} from '../components/Motion';
import { tap } from '../haptics';
import { ensurePermission, rescheduleAllReminders } from '../notifications';
import { toast } from '../components/Toast';
import { useToday } from '../hooks/useNow';
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

/** Turns reminders on (asking for permission) if they are off, then lays out every reminder again. */
async function applyReminders() {
  if (!useStore.getState().settings.remindersEnabled) {
    const ok = await ensurePermission();
    if (ok) useStore.getState().setSetting('remindersEnabled', true);
  }
  setTimeout(rescheduleAllReminders, 200);
}

export function TasksScreen({ mode }: { mode: 'tab' | 'stack' }) {
  const insets = useSafeAreaInsets();
  const fk = useFocusKey();
  const theme = useTheme();
  const level = useAnimLevel();
  const built = useBuilt();
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

  const [addSheet, setAddSheet] = useState(false);
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

  const sortedMissions = useMemo(
    () => [...missions].sort((a, b) => (a.done === b.done ? a.deadline.localeCompare(b.deadline) : a.done ? 1 : -1)),
    [missions]
  );

  // the rows' callbacks keep their identity, so ticking one row re-renders that row alone
  const askDeleteDaily = useCallback((t: DailyTask) => confirmDelete(t.title, () => removeDaily(t.id)), [removeDaily]);
  const askDeleteMission = useCallback((m: Mission) => confirmDelete(m.title, () => removeMission(m.id)), [removeMission]);
  const toggleOpen = useCallback((id: string) => setExpanded((x) => (x === id ? null : id)), []);

  const doneToday = useMemo(() => dailyTasks.filter((t) => t.doneOn === today).length, [dailyTasks, today]);
  const openCount = useMemo(() => missions.filter((m) => !m.done).length, [missions]);
  // the line above the title never states a zero: an empty list says what the list is for instead
  const kicker = tab === 'daily'
    ? (dailyTasks.length === 0 ? 'Resets each morning'
      : doneToday === 0 ? dailyTasks.length + ' left today'
        : doneToday + '/' + dailyTasks.length + ' done today')
    : (missions.length === 0 ? 'With deadlines' : openCount === 0 ? 'All done' : openCount + ' open');

  const tabMode = mode === 'tab';
  const reminderButton = (
    <IconBtn
      name={reminderOn || hasCheckIns ? 'notifications' : 'notifications-outline'}
      color={reminderOn ? C.accent : C.textDim} size={24}
      onPress={() => setRemindSheet(true)}
      accessibilityLabel="Reminders"
    />
  );

  const empty = tab === 'daily' ? dailyTasks.length === 0 : sortedMissions.length === 0;
  // switching lists, or a list filling or emptying, brings the new body up into the old one's place
  const bodyKey = tab + (empty ? ':empty' : ':list');

  return (
    <ScreenBG guard={tabMode}>
      {!tabMode && <NeuHeader title={tab === 'daily' ? 'ToDos' : 'Tasks'} right={reminderButton} />}
      <ScrollView
        key={fk}
        contentContainerStyle={{ padding: S.pad, paddingTop: tabMode ? insets.top + 20 : 8, paddingBottom: 130 + (tabMode ? 0 : insets.bottom) }}
        showsVerticalScrollIndicator={false}
      >
        <Row style={{ justifyContent: 'space-between' }}>
          <FadeSwap swapKey={tab}>
            <Text style={T.kicker}>{kicker}</Text>
            {tabMode && <Text style={[T.display, { marginTop: 4 }]}>{tab === 'daily' ? 'ToDos' : 'Tasks'}</Text>}
          </FadeSwap>
          {tabMode && reminderButton}
        </Row>

        <SegmentedControl
          options={TABS}
          value={tab}
          onChange={(k) => setTab(k)}
          stretch
          style={{ marginTop: 16, marginBottom: 16 }}
        />

        <Enter index={0}>
          <Animated.View key={bodyKey} entering={built.current && level !== 'none' ? riseIn : undefined}>
            {tab === 'daily' ? (
              <>
                {leftovers.length > 0 && (
                  // the card fades away once the last leftover is decided, and the list below glides up
                  <Animated.View exiting={rowOut(level)}>
                    <Card pad={16}>
                      <Text style={st.triageTitle}>Yesterday's leftovers</Text>
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
                        <Pressable onPress={() => setLastTriage(today)} hitSlop={8}>
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
                        <DailyRow key={t.id} task={t} done={t.doneOn === today} onToggle={toggleDaily} onDelete={askDeleteDaily} />
                      ))}
                    </ListCard>
                  </Animated.View>
                )}
              </>
            ) : sortedMissions.length === 0 ? (
              <EmptyState icon="flag-outline" title="Deadline-bound work lives here" body="Mock tests, revision targets, projects." />
            ) : (
              <ListCard>
                {sortedMissions.map((m) => (
                  <MissionRow
                    key={m.id} m={m} today={today} open={expanded === m.id}
                    onToggle={toggleMission} onToggleOpen={toggleOpen} onDelete={askDeleteMission}
                  />
                ))}
              </ListCard>
            )}
          </Animated.View>
        </Enter>
      </ScrollView>

      <Bouncy
        onPress={() => { tap(); setAddSheet(true); }}
        scaleTo={0.9}
        radius={999}
        accessibilityLabel={tab === 'daily' ? 'Add a ToDo' : 'Add a task'}
        accessibilityRole="button"
        style={[
          st.fab,
          { bottom: tabMode ? 24 : insets.bottom + 20 },
          theme === 'minimal'
            ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: C.accent }
            : { backgroundColor: C.card, ...neuRaised('high') },
        ]}
      >
        <Ionicons name="add" size={30} color={C.accent} />
      </Bouncy>

      <QuickTaskSheet
        visible={addSheet}
        onClose={() => setAddSheet(false)}
        initialKind={tab === 'daily' ? 'daily' : 'mission'}
      />

      <RemindersSheet visible={remindSheet} onClose={() => setRemindSheet(false)} />
    </ScreenBG>
  );
}

/** One ToDo. Its own memoised row, so ticking it leaves every other row alone. */
const DailyRow = React.memo(function DailyRow({ task, done, onToggle, onDelete }: {
  task: DailyTask; done: boolean; onToggle: (id: string) => void; onDelete: (t: DailyTask) => void;
}) {
  return (
    <ListRow style={{ paddingVertical: 10 }}>
      <CheckCircle done={done} onPress={() => onToggle(task.id)} label={task.title} />
      <StrikeText done={done} style={st.taskText} wrapStyle={st.taskWrap}>{task.title}</StrikeText>
      <IconBtn name="trash-outline" size={18} onPress={() => onDelete(task)} accessibilityLabel={'Delete ' + task.title} />
    </ListRow>
  );
});

/**
 * One long-term task, with its steps folding out beneath it. The step being typed lives here, so a keystroke
 * re-renders this row only, and a half-typed step never follows you to another task.
 */
const MissionRow = React.memo(function MissionRow({ m, open, onToggle, onToggleOpen, onDelete }: {
  /** only compared, never read: a new day re-renders the row, so its countdown turns over at midnight */
  today: string;
  m: Mission; open: boolean;
  onToggle: (id: string) => void; onToggleOpen: (id: string) => void; onDelete: (m: Mission) => void;
}) {
  useTheme(); // a memo row: it follows a new accent itself, since its props do not change with one
  const level = useAnimLevel();
  const addSubtask = useStore((s) => s.addSubtask);
  const toggleSubtask = useStore((s) => s.toggleSubtask);
  const removeSubtask = useStore((s) => s.removeSubtask);
  const [draft, setDraft] = useState('');
  // folding the steps away drops the half-typed step with them
  React.useEffect(() => { if (!open) setDraft(''); }, [open]);

  const d = daysUntil(m.deadline);
  const pillText = m.done ? 'DONE' : d < 0 ? -d + 'D OVER' : d === 0 ? 'TODAY' : 'D-' + d;
  const pillColor = m.done ? C.green : d < 0 ? C.danger : d <= 2 ? C.amber : C.accent;
  const subDone = m.subtasks.filter((x) => x.done).length;
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
        <Pressable style={st.taskWrap} onPress={() => onToggleOpen(m.id)}>
          <StrikeText done={m.done} style={st.taskText}>{m.title}</StrikeText>
          <Text style={[T.caption, { marginTop: 2 }]}>
            {fmtShortDate(m.deadline)}
            {m.subtasks.length > 0 ? ', ' + subDone + '/' + m.subtasks.length + ' steps' : ', tap for steps'}
          </Text>
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
            <Row style={{ marginTop: 2 }}>
              <Field
                value={draft} onChangeText={setDraft} placeholder="Add a step"
                style={{ flex: 1, marginBottom: 0 }}
                onSubmitEditing={addStep}
              />
              <IconBtn name="add-circle" color={C.accent} size={28} style={{ marginLeft: 6 }} onPress={addStep} accessibilityLabel="Add this step" />
            </Row>
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
  const [setupTime, setSetupTime] = useState(time);
  const [remTime, setRemTime] = useState('');
  const [remLabel, setRemLabel] = useState('');
  // each opening starts from the saved time
  React.useEffect(() => { if (visible) setSetupTime(useStore.getState().settings.todoReminderTime); }, [visible]);

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
            if (v) await applyReminders();
            else setTimeout(rescheduleAllReminders, 200);
          }}
        />
      </Row>
      <Row>
        <Field
          value={setupTime} onChangeText={setSetupTime}
          placeholder="07:00" keyboardType="numbers-and-punctuation" style={{ flex: 1, marginBottom: 0 }}
        />
        <PillButton
          small label="Set time" style={{ marginLeft: 8 }}
          onPress={async () => {
            if (toMinutes(setupTime.trim()) < 0) { Alert.alert('Time format', 'Use 24h HH:MM, e.g. 07:00'); return; }
            setSetting('todoReminderTime', setupTime.trim());
            await applyReminders();
          }}
        />
      </Row>

      <Text style={st.sheetSection}>Check-ins during the day</Text>
      {todoReminders.map((r) => (
        <Row key={r.id} style={{ paddingVertical: 6 }}>
          <Text style={[T.body, { width: 62, fontVariant: ['tabular-nums'], color: C.accent }]}>{r.time}</Text>
          <Text style={[T.body, { flex: 1 }]} numberOfLines={1}>{r.label || 'ToDo check-in'}</Text>
          <IconBtn name="close" size={17} onPress={async () => { removeTodoReminder(r.id); await rescheduleAllReminders(); }} accessibilityLabel={'Remove the reminder at ' + r.time} />
        </Row>
      ))}
      <Row style={{ marginTop: 4 }}>
        <Field value={remTime} onChangeText={setRemTime} placeholder="16:30" keyboardType="numbers-and-punctuation" style={{ width: 90, marginBottom: 0 }} />
        <Field value={remLabel} onChangeText={setRemLabel} placeholder="Label (optional)" style={{ flex: 1, marginHorizontal: 8, marginBottom: 0 }} />
        <PillButton
          small label="Add"
          onPress={async () => {
            if (toMinutes(remTime.trim()) < 0) { Alert.alert('Time format', 'Use 24h HH:MM'); return; }
            addTodoReminder(remTime.trim(), remLabel.trim());
            setRemTime(''); setRemLabel('');
            await applyReminders();
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

const st = StyleSheet.create({
  triageTitle: { color: C.amber, fontFamily: F.semi, fontSize: 13, marginBottom: 10, letterSpacing: 0.2 },
  taskWrap: { flex: 1, marginLeft: 12 },
  taskText: { color: C.text, fontFamily: F.reg, fontSize: 15, lineHeight: 21, letterSpacing: 0.1 },
  missionRow: { paddingVertical: 12, paddingHorizontal: 12 },
  steps: { marginTop: 10, paddingLeft: 4 },
  stepWrap: { flex: 1, marginLeft: 10 },
  stepText: { color: C.textDim, fontFamily: F.reg, fontSize: 14, lineHeight: 20 },
  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, marginHorizontal: 6 },
  pillText: { fontSize: 11, fontFamily: F.semi, letterSpacing: 0.8 },
  fab: {
    position: 'absolute', right: 20, bottom: 24, width: 58, height: 58, borderRadius: 29,
    alignItems: 'center', justifyContent: 'center',
  },
  sheetSection: {
    color: C.textFaint, fontSize: 11, fontFamily: F.semi,
    textTransform: 'uppercase', letterSpacing: 1.6, marginTop: 18, marginBottom: 8,
  },
});
