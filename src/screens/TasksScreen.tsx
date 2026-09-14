import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { C, F, MIN, S, T, neuRaised } from '../theme';
import { useStore } from '../store';
import { todayKey, yesterdayKey, daysUntil, fmtShortDate, toMinutes } from '../utils';
import {
  ScreenBG, Card, CheckCircle, Sheet, Field, PillButton, EmptyText, Row, IconBtn, Chip, Toggle, NeuHeader, useTheme,
} from '../components/UI';
import { SegmentedControl } from '../components/SegmentedControl';
import { Enter, Bouncy, useFocusKey } from '../components/Motion';
import { tap } from '../haptics';
import { ensurePermission, rescheduleAllReminders } from '../notifications';

export function TasksScreen({ mode }: { mode: 'tab' | 'stack' }) {
  const insets = useSafeAreaInsets();
  const fk = useFocusKey();
  const theme = useTheme();
  const [tab, setTab] = useState<'daily' | 'missions'>('daily');

  const dailyTasks = useStore((s) => s.dailyTasks);
  const addDaily = useStore((s) => s.addDaily);
  const toggleDaily = useStore((s) => s.toggleDaily);
  const removeDaily = useStore((s) => s.removeDaily);
  const lastTriage = useStore((s) => s.lastTriage);
  const setLastTriage = useStore((s) => s.setLastTriage);

  const missions = useStore((s) => s.missions);
  const addMission = useStore((s) => s.addMission);
  const toggleMission = useStore((s) => s.toggleMission);
  const removeMission = useStore((s) => s.removeMission);
  const addSubtask = useStore((s) => s.addSubtask);
  const toggleSubtask = useStore((s) => s.toggleSubtask);
  const removeSubtask = useStore((s) => s.removeSubtask);

  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const todoReminders = useStore((s) => s.todoReminders);
  const addTodoReminder = useStore((s) => s.addTodoReminder);
  const removeTodoReminder = useStore((s) => s.removeTodoReminder);

  const [addSheet, setAddSheet] = useState(false);
  const [remindSheet, setRemindSheet] = useState(false);
  const [title, setTitle] = useState('');
  const [deadline, setDeadline] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [subDraft, setSubDraft] = useState('');
  const [triaged, setTriaged] = useState<string[]>([]);
  const [setupTime, setSetupTime] = useState(settings.todoReminderTime);
  const [remTime, setRemTime] = useState('');
  const [remLabel, setRemLabel] = useState('');

  const today = todayKey();
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
  const dropOne = (id: string) => {
    removeDaily(id);
    if (leftovers.length <= 1) setLastTriage(today);
  };

  const sortedMissions = useMemo(
    () => [...missions].sort((a, b) => (a.done === b.done ? a.deadline.localeCompare(b.deadline) : a.done ? 1 : -1)),
    [missions]
  );

  const submitAdd = () => {
    const t = title.trim();
    if (!t) return;
    if (tab === 'daily') addDaily(t);
    else addMission(t, /^\d{4}-\d{2}-\d{2}$/.test(deadline.trim()) ? deadline.trim() : today);
    setTitle(''); setDeadline(''); setAddSheet(false);
  };

  const confirmDelete = (what: string, fn: () => void) =>
    Alert.alert('Delete', 'Remove "' + what + '"?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: fn },
    ]);

  const applyReminders = async () => {
    if (!settings.remindersEnabled) {
      const ok = await ensurePermission();
      if (ok) setSetting('remindersEnabled', true);
    }
    setTimeout(rescheduleAllReminders, 200);
  };

  const doneToday = dailyTasks.filter((t) => t.doneOn === today).length;
  const tabMode = mode === 'tab';
  const reminderButton = (
    <IconBtn
      name={settings.todoReminderEnabled || todoReminders.length ? 'notifications' : 'notifications-outline'}
      color={settings.todoReminderEnabled ? C.accent : C.textDim} size={24}
      onPress={() => { setSetupTime(settings.todoReminderTime); setRemindSheet(true); }}
    />
  );

  return (
    <ScreenBG guard={tabMode}>
      {!tabMode && <NeuHeader title={tab === 'daily' ? 'ToDos' : 'Tasks'} right={reminderButton} />}
      <ScrollView
        key={fk}
        contentContainerStyle={{ padding: S.pad, paddingTop: tabMode ? insets.top + 20 : 8, paddingBottom: 130 + (tabMode ? 0 : insets.bottom) }}
        showsVerticalScrollIndicator={false}
      >
        <Row style={{ justifyContent: 'space-between' }}>
          <View>
            <Text style={T.kicker}>
              {tab === 'daily' ? doneToday + '/' + dailyTasks.length + ' done today' : missions.filter((m) => !m.done).length + ' open'}
            </Text>
            {tabMode && <Text style={[T.display, { marginTop: 4 }]}>{tab === 'daily' ? 'ToDos' : 'Tasks'}</Text>}
          </View>
          {tabMode && reminderButton}
        </Row>

        <SegmentedControl
          options={[
            { key: 'daily', label: 'ToDos · daily' },
            { key: 'missions', label: 'Tasks · long-term' },
          ]}
          value={tab}
          onChange={(k) => setTab(k)}
          stretch
          style={{ marginTop: 16, marginBottom: 16 }}
        />

        {tab === 'daily' && leftovers.length > 0 && (
          <Enter index={0}>
            <Card pad={14}>
              <Text style={st.triageTitle}>Yesterday's leftovers — 5-second triage</Text>
              {leftovers.map((t) => (
                <Row key={t.id} style={{ paddingVertical: 6 }}>
                  <Text style={[T.body, { flex: 1 }]} numberOfLines={1}>{t.title}</Text>
                  <PillButton small label="Keep" color={C.green} onPress={() => keepOne(t.id)} style={{ marginRight: 6 }} />
                  <PillButton small label="Drop" color={C.danger} outline onPress={() => dropOne(t.id)} />
                </Row>
              ))}
              <Pressable onPress={() => setLastTriage(today)} hitSlop={8}>
                <Text style={[T.caption, { textAlign: 'center', marginTop: 8 }]}>Keep all & dismiss</Text>
              </Pressable>
            </Card>
          </Enter>
        )}

        {tab === 'daily' &&
          (dailyTasks.length === 0 ? (
            <EmptyText>Your daily list — it resets each morning.{'\n'}Tap the bell to get a daily "plan your day" nudge.</EmptyText>
          ) : (
            dailyTasks.map((t, i) => {
              const done = t.doneOn === today;
              return (
                <Enter key={t.id} index={i}>
                  <Card pad={13}>
                    <Row>
                      <CheckCircle done={done} onPress={() => toggleDaily(t.id)} />
                      <Text style={[st.taskText, done && st.taskDone]}>{t.title}</Text>
                      <IconBtn name="trash-outline" size={18} onPress={() => confirmDelete(t.title, () => removeDaily(t.id))} />
                    </Row>
                  </Card>
                </Enter>
              );
            })
          ))}

        {tab === 'missions' &&
          (sortedMissions.length === 0 ? (
            <EmptyText>Long-term, deadline-bound work —{'\n'}mock tests, revision targets, projects.</EmptyText>
          ) : (
            sortedMissions.map((m, idx) => {
              const d = daysUntil(m.deadline);
              const pillText = m.done ? 'DONE' : d < 0 ? -d + 'D OVER' : d === 0 ? 'TODAY' : 'D-' + d;
              const pillColor = m.done ? C.green : d < 0 ? C.danger : d <= 2 ? C.amber : C.accent;
              const open = expanded === m.id;
              const subDone = m.subtasks.filter((x) => x.done).length;
              return (
                <Enter key={m.id} index={idx}>
                  <Card pad={13}>
                    <Row>
                      <CheckCircle done={m.done} color={C.amber} onPress={() => toggleMission(m.id)} />
                      {/* one subDraft serves every mission's step field, so it has to be
                          dropped here or a half-typed step follows you to the next mission */}
                      <Pressable style={{ flex: 1, marginLeft: 12 }} onPress={() => { setSubDraft(''); setExpanded(open ? null : m.id); }}>
                        <Text style={[st.taskText, { marginLeft: 0 }, m.done && st.taskDone]}>{m.title}</Text>
                        <Text style={[T.caption, { marginTop: 2 }]}>
                          {fmtShortDate(m.deadline)}
                          {m.subtasks.length > 0 ? '  ·  ' + subDone + '/' + m.subtasks.length + ' steps' : '  ·  tap for steps'}
                        </Text>
                      </Pressable>
                      <View style={[st.pill, { borderColor: pillColor + '55', backgroundColor: pillColor + '18' }]}>
                        <Text style={{ color: pillColor, fontSize: 11, fontFamily: F.semi, letterSpacing: 0.8 }}>{pillText}</Text>
                      </View>
                      <IconBtn name="trash-outline" size={18} onPress={() => confirmDelete(m.title, () => removeMission(m.id))} />
                    </Row>

                    {open && (
                      <View style={{ marginTop: 10, paddingLeft: 4 }}>
                        {m.subtasks.map((sub) => (
                          <Row key={sub.id} style={{ paddingVertical: 5 }}>
                            <CheckCircle done={sub.done} size={20} onPress={() => toggleSubtask(m.id, sub.id)} />
                            <Text style={[{ color: C.textDim, fontFamily: F.reg, fontSize: 14, marginLeft: 10, flex: 1 }, sub.done && st.taskDone]}>
                              {sub.title}
                            </Text>
                            <IconBtn name="close" size={16} onPress={() => removeSubtask(m.id, sub.id)} />
                          </Row>
                        ))}
                        <Row style={{ marginTop: 6 }}>
                          <Field
                            value={subDraft} onChangeText={setSubDraft} placeholder="Add a step…"
                            style={{ flex: 1, marginBottom: 0, paddingVertical: 8 }}
                            onSubmitEditing={() => { if (subDraft.trim()) { addSubtask(m.id, subDraft.trim()); setSubDraft(''); } }}
                          />
                          <IconBtn
                            name="add-circle" color={C.accent} size={28} style={{ marginLeft: 6 }}
                            onPress={() => { if (subDraft.trim()) { addSubtask(m.id, subDraft.trim()); setSubDraft(''); } }}
                          />
                        </Row>
                      </View>
                    )}
                  </Card>
                </Enter>
              );
            })
          ))}
      </ScrollView>

      <Bouncy
        onPress={() => { tap(); setAddSheet(true); }}
        scaleTo={0.9}
        radius={999}
        style={[
          st.fab,
          { bottom: tabMode ? 24 : insets.bottom + 20 },
          theme === 'minimal'
            ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: C.accent }
            : { backgroundColor: C.card, boxShadow: neuRaised('high').boxShadow + ', 0 0 14px ' + C.accent + '55' },
        ]}
      >
        <Ionicons name="add" size={30} color={C.accent} />
      </Bouncy>

      <Sheet
        visible={addSheet}
        onClose={() => setAddSheet(false)}
        title={tab === 'daily' ? 'New ToDo (daily)' : 'New long-term task'}
      >
        <Field value={title} onChangeText={setTitle} placeholder={tab === 'daily' ? 'e.g. 50 PYQs' : 'e.g. Full mock test + analysis'} autoFocus />
        {tab === 'missions' && (
          <>
            <Field value={deadline} onChangeText={setDeadline} placeholder={'Deadline (YYYY-MM-DD), e.g. ' + today} />
            <Row style={{ flexWrap: 'wrap', marginBottom: 6 }}>
              {[0, 1, 3, 7, 14].map((n) => {
                const d = new Date(); d.setDate(d.getDate() + n);
                const key = todayKey(d);
                return <Chip key={n} small label={n === 0 ? 'Today' : '+' + n + 'd'} active={deadline === key} onPress={() => setDeadline(key)} />;
              })}
            </Row>
          </>
        )}
        <PillButton label="Add" onPress={submitAdd} />
      </Sheet>

      <Sheet visible={remindSheet} onClose={() => setRemindSheet(false)} title="ToDo reminders">
        <Row style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <Text style={T.body}>Daily "plan your ToDos" nudge</Text>
          <Toggle
            value={settings.todoReminderEnabled}
            color={C.green}
            onChange={async (v) => {
              setSetting('todoReminderEnabled', v);
              await applyReminders();
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
            <IconBtn name="close" size={17} onPress={async () => { removeTodoReminder(r.id); await applyReminders(); }} />
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
        {!settings.remindersEnabled && (
          <Text style={[T.caption, { marginTop: 10 }]}>
            Reminders master switch is off — turning any reminder on will ask for notification permission and enable it.
          </Text>
        )}
      </Sheet>
    </ScreenBG>
  );
}

const st = StyleSheet.create({
  triageTitle: { color: C.amber, fontFamily: F.semi, fontSize: 13, marginBottom: 10, letterSpacing: 0.2 },
  taskText: { color: C.text, fontFamily: F.reg, fontSize: 15, marginLeft: 12, flex: 1, letterSpacing: 0.1 },
  taskDone: { color: C.textFaint, textDecorationLine: 'line-through' },
  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, marginHorizontal: 6 },
  fab: {
    position: 'absolute', right: 20, bottom: 24, width: 58, height: 58, borderRadius: 29,
    alignItems: 'center', justifyContent: 'center',
  },
  sheetSection: {
    color: C.textFaint, fontSize: 11, fontFamily: F.semi,
    textTransform: 'uppercase', letterSpacing: 1.6, marginTop: 18, marginBottom: 8,
  },
});
