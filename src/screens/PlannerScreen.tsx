import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, F, MIN, S, T, BLOCK_COLORS, neuInset, neuRaised } from '../theme';
import { useStore, PlannerBlock, Habit } from '../store';
import { DAY_NAMES, DayName, dayName, toMinutes, fmtClockTime, todayKey, streaks } from '../utils';
import { useNow } from '../hooks/useNow';
import {
  ScreenBG, GlassCard, SectionTitle, Sheet, Field, PillButton, EmptyState, Row, Chip, IconBtn, CheckCircle, useTheme, NeuHeader,
} from '../components/UI';
import { Ionicons } from '@expo/vector-icons';
import { SegmentedControl } from '../components/SegmentedControl';
import { Bouncy, Enter, useFocusKey } from '../components/Motion';
import { tick } from '../haptics';
import { rescheduleAllReminders, ensurePermission } from '../notifications';
import { openTool } from '../toolNav';

export function PlannerScreen({ mode }: { mode: 'tab' | 'stack' }) {
  const insets = useSafeAreaInsets();
  const fk = useFocusKey();
  const theme = useTheme();

  const planner = useStore((s) => s.planner);
  const addBlock = useStore((s) => s.addBlock);
  const updateBlock = useStore((s) => s.updateBlock);
  const removeBlock = useStore((s) => s.removeBlock);
  const copyDay = useStore((s) => s.copyDay);
  const weekTemplates = useStore((s) => s.weekTemplates);
  const saveTemplate = useStore((s) => s.saveTemplate);
  const applyTemplate = useStore((s) => s.applyTemplate);
  const deleteTemplate = useStore((s) => s.deleteTemplate);

  const habits = useStore((s) => s.habits);
  const addHabit = useStore((s) => s.addHabit);
  const toggleHabitToday = useStore((s) => s.toggleHabitToday);
  const removeHabit = useStore((s) => s.removeHabit);
  const setHabitReminder = useStore((s) => s.setHabitReminder);
  const remindersEnabled = useStore((s) => s.settings.remindersEnabled);
  const hour24 = useStore((s) => s.settings.hour24);

  const [day, setDay] = useState<DayName>(dayName());
  const [blockSheet, setBlockSheet] = useState(false);
  const [editing, setEditing] = useState<PlannerBlock | null>(null);
  const [subj, setSubj] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [color, setColor] = useState(BLOCK_COLORS[0]);
  const [copySheet, setCopySheet] = useState(false);
  const [tplSheet, setTplSheet] = useState(false);
  const [tplName, setTplName] = useState('');
  const [habitSheet, setHabitSheet] = useState(false);
  const [habitTitle, setHabitTitle] = useState('');
  const [habitTime, setHabitTime] = useState('');
  const [remindEdit, setRemindEdit] = useState<Habit | null>(null);
  const [remindDraft, setRemindDraft] = useState('');

  const blocks = useMemo(
    () => [...planner[day]].sort((a, b) => toMinutes(a.start) - toMinutes(b.start)),
    [planner, day]
  );
  const today = todayKey();
  // tick every 30s so the NOW badge appears/clears while the screen sits open
  const now = useNow();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const viewingToday = day === dayName();

  const openAdd = () => { setEditing(null); setSubj(''); setStart(''); setEnd(''); setColor(BLOCK_COLORS[0]); setBlockSheet(true); };
  const openEdit = (b: PlannerBlock) => { setEditing(b); setSubj(b.subject); setStart(b.start); setEnd(b.end); setColor(b.color); setBlockSheet(true); };

  const submitBlock = () => {
    const s = start.trim(), e = end.trim(), t = subj.trim();
    if (!t) { Alert.alert('Missing subject', 'Give the block a subject.'); return; }
    if (toMinutes(s) < 0 || toMinutes(e) < 0) { Alert.alert('Time format', 'Use 24h HH:MM, e.g. 16:00'); return; }
    if (toMinutes(e) <= toMinutes(s)) { Alert.alert('Time order', 'End must be after start.'); return; }
    if (editing) updateBlock(day, { ...editing, subject: t, start: s, end: e, color });
    else addBlock(day, { subject: t, start: s, end: e, color });
    setBlockSheet(false);
  };

  const submitHabit = async () => {
    const t = habitTitle.trim();
    if (!t) return;
    const time = /^\d{1,2}:\d{2}$/.test(habitTime.trim()) ? habitTime.trim() : undefined;
    addHabit(t, time);
    setHabitTitle(''); setHabitTime(''); setHabitSheet(false);
    if (time && remindersEnabled) {
      await ensurePermission();
      await rescheduleAllReminders();
    }
  };

  const saveReminder = async () => {
    if (!remindEdit) return;
    const t = remindDraft.trim();
    const valid = /^\d{1,2}:\d{2}$/.test(t) && toMinutes(t) >= 0;
    if (t && !valid) { Alert.alert('Time format', 'Use 24h HH:MM, like 21:00, or leave it empty to clear.'); return; }
    setHabitReminder(remindEdit.id, valid ? t : undefined);
    setRemindEdit(null);
    if (remindersEnabled) {
      await ensurePermission();
      await rescheduleAllReminders();
    }
  };

  const tabMode = mode === 'tab';
  const plannerActions = (
    <Row>
      <IconBtn name="copy-outline" color={C.textDim} onPress={() => setCopySheet(true)} />
      <IconBtn name="albums-outline" color={C.textDim} onPress={() => setTplSheet(true)} />
    </Row>
  );

  return (
    <ScreenBG guard={tabMode}>
      {!tabMode && <NeuHeader title="Planner" right={plannerActions} />}
      <ScrollView
        key={fk}
        contentContainerStyle={{ padding: S.pad, paddingTop: tabMode ? insets.top + 20 : 8, paddingBottom: 44 + (tabMode ? 0 : insets.bottom) }}
        showsVerticalScrollIndicator={false}
      >
        {tabMode && (
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={T.display}>Planner</Text>
            {plannerActions}
          </Row>
        )}

        {/* day selector */}
        <Enter index={0}>
          {/* all seven days always in view: the chosen one never scrolls away */}
          <SegmentedControl
            size="sm"
            stretch
            options={DAY_NAMES.map((d) => ({ key: d, label: d.slice(0, 2) }))}
            value={day}
            onChange={(d) => setDay(d)}
            style={{ marginTop: 8, marginBottom: 12 }}
          />
        </Enter>

        {/* blocks */}
        {blocks.length === 0 ? (
          <EmptyState compact icon="calendar-outline" title={'No blocks on ' + day} body="Add subjects with start and end times below." />
        ) : (
          blocks.map((b, i) => (
            <Enter key={b.id} index={Math.min(1 + i, 8)}>
              <GlassCard
                pad={14}
                onPress={() => openTool('focus', { subject: b.subject })}
              >
                <Row>
                  <View style={[st.colorBar, { backgroundColor: b.color }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={T.title}>{b.subject}</Text>
                    <Text style={[T.caption, { marginTop: 2, fontVariant: ['tabular-nums'] }]}>
                      {fmtClockTime(toMinutes(b.start), hour24)} – {fmtClockTime(toMinutes(b.end), hour24)}
                      <Text style={{ color: C.textFaint }}>   ·   tap → Deep Work</Text>
                    </Text>
                  </View>
                  {viewingToday && toMinutes(b.start) <= nowMin && nowMin < toMinutes(b.end) && (
                    <View style={{ borderRadius: 999, borderWidth: 1, borderColor: C.accent + '66', backgroundColor: C.accent + '1A', paddingHorizontal: 8, paddingVertical: 3, marginRight: 4 }}>
                      <Text style={{ color: C.accent, fontFamily: F.semi, fontSize: 11, letterSpacing: 1 }}>NOW</Text>
                    </View>
                  )}
                  <IconBtn name="create-outline" size={18} onPress={() => openEdit(b)} />
                  <IconBtn name="trash-outline" size={18} onPress={() => removeBlock(day, b.id)} />
                </Row>
              </GlassCard>
            </Enter>
          ))
        )}
        <PillButton label={`Add block to ${day}`} icon="add" onPress={openAdd} style={{ marginTop: 4 }} />

        {/* streaks */}
        <SectionTitle
          right={
            <Pressable onPress={() => setHabitSheet(true)} hitSlop={8}>
              <Text style={{ color: C.accent, fontSize: 13, fontFamily: F.semi }}>+ Habit</Text>
            </Pressable>
          }
        >
          Streaks
        </SectionTitle>
        {habits.length === 0 ? (
          <EmptyState compact icon="repeat-outline" title="No habits yet" body="Daily habits with streak counters. Small, repeatable, honest." />
        ) : (
          habits.map((h, i) => {
            const { current, best } = streaks(h.doneDates);
            const done = h.doneDates.includes(today);
            return (
              <Enter key={h.id} index={Math.min(1 + i, 8)}>
              <GlassCard pad={13}>
                <Row>
                  <CheckCircle done={done} onPress={() => toggleHabitToday(h.id)} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={T.title}>{h.title}</Text>
                    <Row style={{ marginTop: 3 }}>
                      <Ionicons name="flame-outline" size={13} color={C.textFaint} />
                      <Text style={[T.caption, { marginLeft: 4 }]}>{current} current · {best} best</Text>
                      {h.remindTime ? (
                        <>
                          <Ionicons name="alarm-outline" size={13} color={C.textFaint} style={{ marginLeft: 10 }} />
                          <Text style={[T.caption, { marginLeft: 4 }]}>{h.remindTime}</Text>
                        </>
                      ) : null}
                    </Row>
                  </View>
                  <IconBtn
                    name="alarm-outline" size={18}
                    color={h.remindTime ? C.accent : C.textFaint}
                    onPress={() => { setRemindDraft(h.remindTime || ''); setRemindEdit(h); }}
                  />
                  {/* re-run the scheduler after the delete, or the habit's daily
                      reminder keeps firing for a habit that no longer exists */}
                  <IconBtn
                    name="trash-outline" size={18}
                    onPress={async () => { removeHabit(h.id); await rescheduleAllReminders(); }}
                  />
                </Row>
              </GlassCard>
              </Enter>
            );
          })
        )}
      </ScrollView>

      {/* block sheet */}
      <Sheet visible={blockSheet} onClose={() => setBlockSheet(false)} title={editing ? 'Edit block' : `New block for ${day}`}>
        <Field value={subj} onChangeText={setSubj} placeholder="Subject, e.g. Physics" autoFocus />
        <Row style={{ gap: 10 }}>
          <Field value={start} onChangeText={setStart} placeholder="Start 16:00" style={{ flex: 1 }} keyboardType="numbers-and-punctuation" />
          <Field value={end} onChangeText={setEnd} placeholder="End 17:30" style={{ flex: 1 }} keyboardType="numbers-and-punctuation" />
        </Row>
        <Row style={{ flexWrap: 'wrap', gap: 10, marginBottom: 12, marginTop: 2 }}>
          {BLOCK_COLORS.map((c) => {
            const active = color === c;
            return (
              <Bouncy
                key={c} radius={20} scaleTo={0.88}
                onPress={() => { tick(); setColor(c); }}
                style={[
                  st.swatchWell,
                  theme === 'minimal'
                    ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: active ? c : MIN.border }
                    : active
                      ? { backgroundColor: C.inset, ...neuInset('low') }
                      : { backgroundColor: C.card, ...neuRaised('low') },
                ]}
              >
                <View style={[st.swatchDisc, { backgroundColor: c }, active && st.swatchDiscActive]} />
              </Bouncy>
            );
          })}
        </Row>
        <PillButton label={editing ? 'Save' : 'Add block'} onPress={submitBlock} />
      </Sheet>

      {/* copy day sheet */}
      <Sheet visible={copySheet} onClose={() => setCopySheet(false)} title={`Copy ${day} to…`}>
        <Row style={{ flexWrap: 'wrap' }}>
          {DAY_NAMES.filter((d) => d !== day).map((d) => (
            <Chip key={d} label={d} onPress={() => { copyDay(day, d); setCopySheet(false); }} />
          ))}
        </Row>
        <Text style={[T.caption, { marginTop: 8 }]}>Replaces the target day's blocks.</Text>
      </Sheet>

      {/* templates sheet */}
      <Sheet visible={tplSheet} onClose={() => setTplSheet(false)} title="Week templates">
        {Object.keys(weekTemplates).length === 0 && (
          <Text style={[T.caption, { marginBottom: 10 }]}>
            Save the whole week ("Exam week", "Normal week") and switch anytime.
          </Text>
        )}
        {Object.keys(weekTemplates).map((name) => (
          <Row key={name} style={{ paddingVertical: 8 }}>
            <Text style={[T.body, { flex: 1 }]}>{name}</Text>
            <PillButton small label="Apply" onPress={() => { applyTemplate(name); setTplSheet(false); }} style={{ marginRight: 8 }} />
            <IconBtn name="trash-outline" size={18} onPress={() => deleteTemplate(name)} />
          </Row>
        ))}
        <Row style={{ marginTop: 10 }}>
          <Field value={tplName} onChangeText={setTplName} placeholder="Save current week as…" style={{ flex: 1, marginBottom: 0 }} />
          <PillButton
            small label="Save" style={{ marginLeft: 8 }}
            onPress={() => { if (tplName.trim()) { saveTemplate(tplName.trim()); setTplName(''); } }}
          />
        </Row>
      </Sheet>

      {/* habit sheet */}
      <Sheet visible={habitSheet} onClose={() => setHabitSheet(false)} title="New habit">
        <Field value={habitTitle} onChangeText={setHabitTitle} placeholder="e.g. Revise formula sheet" autoFocus />
        <Field value={habitTime} onChangeText={setHabitTime} placeholder="Reminder time 21:00 (optional)" keyboardType="numbers-and-punctuation" />
        <PillButton label="Add habit" onPress={submitHabit} />
      </Sheet>

      {/* reminder edit sheet */}
      <Sheet visible={!!remindEdit} onClose={() => setRemindEdit(null)} title={`Reminder for ${remindEdit?.title || 'this habit'}`}>
        <Field
          value={remindDraft} onChangeText={setRemindDraft}
          placeholder="24h HH:MM, e.g. 21:00 (empty = off)" keyboardType="numbers-and-punctuation" autoFocus
        />
        <PillButton label="Save" onPress={saveReminder} />
        {!remindersEnabled && (
          <Text style={[T.caption, { marginTop: 10 }]}>
            Reminders are off in Settings, so times are saved but stay silent until you turn them on.
          </Text>
        )}
      </Sheet>
    </ScreenBG>
  );
}

const st = StyleSheet.create({
  colorBar: { width: 4, height: 36, borderRadius: 2, marginRight: 12 },
  swatchWell: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  swatchDisc: { width: 22, height: 22, borderRadius: 11 },
  swatchDiscActive: { borderWidth: 2, borderColor: C.text },
});
