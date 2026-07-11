import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { C, S, T } from '../../src/theme';
import { useStore } from '../../src/store';
import { todayKey, yesterdayKey, daysUntil, fmtShortDate } from '../../src/utils';
import {
  ScreenBG, GlassCard, CheckCircle, Sheet, Field, PillButton, EmptyText, Row, IconBtn, Chip,
} from '../../src/components/UI';

export default function Tasks() {
  const insets = useSafeAreaInsets();
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

  const [addSheet, setAddSheet] = useState(false);
  const [title, setTitle] = useState('');
  const [deadline, setDeadline] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [subDraft, setSubDraft] = useState('');
  const [triaged, setTriaged] = useState<string[]>([]); // per-item "keep" decisions this morning

  const today = todayKey();

  // Yesterday's leftovers: daily tasks that existed before today and weren't done yesterday (or today).
  const leftovers = useMemo(() => {
    if (lastTriage === today) return [];
    const yest = yesterdayKey();
    return dailyTasks.filter(
      (t) =>
        t.createdAt < new Date(today + 'T00:00:00').getTime() &&
        t.doneOn !== yest &&
        t.doneOn !== today &&
        !triaged.includes(t.id)
    );
  }, [dailyTasks, lastTriage, triaged]);

  const keepOne = (id: string) => {
    const next = [...triaged, id];
    setTriaged(next);
    // once every leftover is handled, close the triage for today
    const remaining = leftovers.filter((t) => t.id !== id);
    if (remaining.length === 0) setLastTriage(today);
  };

  const dropOne = (id: string) => {
    removeDaily(id);
    const remaining = leftovers.filter((t) => t.id !== id);
    if (remaining.length === 0) setLastTriage(today);
  };

  const sortedMissions = useMemo(
    () => [...missions].sort((a, b) => (a.done === b.done ? a.deadline.localeCompare(b.deadline) : a.done ? 1 : -1)),
    [missions]
  );

  const submitAdd = () => {
    const t = title.trim();
    if (!t) return;
    if (tab === 'daily') {
      addDaily(t);
    } else {
      const d = /^\d{4}-\d{2}-\d{2}$/.test(deadline.trim()) ? deadline.trim() : today;
      addMission(t, d);
    }
    setTitle(''); setDeadline(''); setAddSheet(false);
  };

  const confirmDelete = (what: string, fn: () => void) =>
    Alert.alert('Delete', `Remove "${what}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: fn },
    ]);

  return (
    <ScreenBG>
      <ScrollView
        contentContainerStyle={{ padding: S.pad, paddingTop: insets.top + 18, paddingBottom: 130 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={T.display}>Tasks</Text>

        {/* segmented */}
        <Row style={st.seg}>
          {(['daily', 'missions'] as const).map((k) => (
            <Pressable key={k} onPress={() => setTab(k)} style={[st.segBtn, tab === k && st.segActive]}>
              <Text style={[st.segText, tab === k && { color: C.text }]}>
                {k === 'daily' ? 'Daily' : 'Missions'}
              </Text>
            </Pressable>
          ))}
        </Row>

        {/* leftovers triage */}
        {tab === 'daily' && leftovers.length > 0 && (
          <GlassCard pad={14} style={{ borderColor: C.amber + '55' }}>
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
          </GlassCard>
        )}

        {/* daily list */}
        {tab === 'daily' &&
          (dailyTasks.length === 0 ? (
            <EmptyText>Daily to-dos repeat every day.{'\n'}Add your first one below.</EmptyText>
          ) : (
            dailyTasks.map((t) => {
              const done = t.doneOn === today;
              return (
                <GlassCard key={t.id} pad={13}>
                  <Row>
                    <CheckCircle done={done} onPress={() => toggleDaily(t.id)} />
                    <Text style={[st.taskText, done && st.taskDone]}>{t.title}</Text>
                    <IconBtn name="trash-outline" size={18} onPress={() => confirmDelete(t.title, () => removeDaily(t.id))} />
                  </Row>
                </GlassCard>
              );
            })
          ))}

        {/* missions list */}
        {tab === 'missions' &&
          (sortedMissions.length === 0 ? (
            <EmptyText>Missions are time-bound goals with a deadline —{'\n'}mock tests, revision targets, projects.</EmptyText>
          ) : (
            sortedMissions.map((m) => {
              const d = daysUntil(m.deadline);
              const pillText = m.done ? 'DONE' : d < 0 ? `${-d}D OVER` : d === 0 ? 'TODAY' : `D-${d}`;
              const pillColor = m.done ? C.green : d < 0 ? C.danger : d <= 2 ? C.amber : C.accent;
              const open = expanded === m.id;
              const subDone = m.subtasks.filter((x) => x.done).length;
              return (
                <GlassCard key={m.id} pad={13}>
                  <Row>
                    <CheckCircle done={m.done} color={C.amber} onPress={() => toggleMission(m.id)} />
                    <Pressable style={{ flex: 1, marginLeft: 12 }} onPress={() => setExpanded(open ? null : m.id)}>
                      <Text style={[st.taskText, { marginLeft: 0 }, m.done && st.taskDone]}>{m.title}</Text>
                      <Text style={[T.caption, { marginTop: 2 }]}>
                        {fmtShortDate(m.deadline)}
                        {m.subtasks.length > 0 ? `  ·  ${subDone}/${m.subtasks.length} steps` : ''}
                        {m.subtasks.length === 0 ? '  ·  tap for steps' : ''}
                      </Text>
                    </Pressable>
                    <View style={[st.pill, { borderColor: pillColor + '55', backgroundColor: pillColor + '18' }]}>
                      <Text style={{ color: pillColor, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 }}>{pillText}</Text>
                    </View>
                    <IconBtn name="trash-outline" size={18} onPress={() => confirmDelete(m.title, () => removeMission(m.id))} />
                  </Row>

                  {open && (
                    <View style={{ marginTop: 10, paddingLeft: 4 }}>
                      {m.subtasks.map((sub) => (
                        <Row key={sub.id} style={{ paddingVertical: 5 }}>
                          <CheckCircle done={sub.done} size={20} onPress={() => toggleSubtask(m.id, sub.id)} />
                          <Text style={[{ color: C.textDim, fontSize: 14, marginLeft: 10, flex: 1 }, sub.done && st.taskDone]}>
                            {sub.title}
                          </Text>
                          <IconBtn name="close" size={16} onPress={() => removeSubtask(m.id, sub.id)} />
                        </Row>
                      ))}
                      <Row style={{ marginTop: 6 }}>
                        <Field
                          value={subDraft}
                          onChangeText={setSubDraft}
                          placeholder="Add a step…"
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
                </GlassCard>
              );
            })
          ))}
      </ScrollView>

      {/* FAB */}
      <Pressable style={({ pressed }) => [st.fab, pressed && { transform: [{ scale: 0.94 }] }]} onPress={() => setAddSheet(true)}>
        <Ionicons name="add" size={30} color="#0A0F1E" />
      </Pressable>

      <Sheet
        visible={addSheet}
        onClose={() => setAddSheet(false)}
        title={tab === 'daily' ? 'New daily to-do' : 'New mission'}
      >
        <Field value={title} onChangeText={setTitle} placeholder={tab === 'daily' ? 'e.g. 50 PYQs' : 'e.g. Full mock test + analysis'} autoFocus />
        {tab === 'missions' && (
          <>
            <Field value={deadline} onChangeText={setDeadline} placeholder={`Deadline (YYYY-MM-DD), e.g. ${today}`} />
            <Row style={{ flexWrap: 'wrap', marginBottom: 6 }}>
              {[0, 1, 3, 7].map((n) => {
                const d = new Date(); d.setDate(d.getDate() + n);
                const key = todayKey(d);
                return <Chip key={n} small label={n === 0 ? 'Today' : `+${n}d`} active={deadline === key} onPress={() => setDeadline(key)} />;
              })}
            </Row>
          </>
        )}
        <PillButton label="Add" onPress={submitAdd} />
      </Sheet>
    </ScreenBG>
  );
}

const st = StyleSheet.create({
  seg: {
    backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 999, padding: 4,
    borderWidth: 1, borderColor: C.border, marginTop: 16, marginBottom: 16,
  },
  segBtn: { flex: 1, paddingVertical: 9, borderRadius: 999, alignItems: 'center' },
  segActive: { backgroundColor: 'rgba(143,180,255,0.18)' },
  segText: { color: C.textFaint, fontWeight: '700', fontSize: 14, letterSpacing: 0.2 },
  triageTitle: { color: C.amber, fontWeight: '800', fontSize: 13, marginBottom: 10, letterSpacing: 0.2 },
  taskText: { color: C.text, fontSize: 15, marginLeft: 12, flex: 1, letterSpacing: 0.1 },
  taskDone: { color: C.textFaint, textDecorationLine: 'line-through' },
  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, marginHorizontal: 6 },
  fab: {
    position: 'absolute', right: 20, bottom: 24, width: 58, height: 58, borderRadius: 29,
    backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center',
    elevation: 10, shadowColor: C.accent, shadowOpacity: 0.5, shadowRadius: 14, shadowOffset: { width: 0, height: 4 },
  },
});
