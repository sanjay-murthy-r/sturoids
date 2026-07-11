import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { C, S, T } from '../../src/theme';
import { useStore } from '../../src/store';
import {
  fmtDate, todayKey, dayName, DAY_NAMES, toMinutes, fmtClockTime, daysUntil,
} from '../../src/utils';
import {
  ScreenBG, GlassCard, SectionTitle, CheckCircle, Sheet, Field, PillButton, EmptyText, Row, Hairline,
} from '../../src/components/UI';
import { ClockOrb } from '../../src/components/ClockOrb';

const QUICK = [
  { label: 'Tasks', icon: 'checkbox-outline', route: '/tasks', color: C.accent },
  { label: 'Deep Work', icon: 'timer-outline', route: '/focus', color: C.violet },
  { label: 'Planner', icon: 'calendar-outline', route: '/planner', color: C.teal },
  { label: 'Notes', icon: 'document-text-outline', route: '/notes', color: C.green },
  { label: 'Calc', icon: 'calculator-outline', route: '/calculator', color: C.amber },
  { label: 'Vault', icon: 'play-circle-outline', route: '/vault', color: C.pink },
] as const;

function greetWord(d = new Date()) {
  const h = d.getHours();
  return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 21 ? 'Good evening' : 'Winding down';
}

export default function Today() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const dailyTasks = useStore((s) => s.dailyTasks);
  const toggleDaily = useStore((s) => s.toggleDaily);
  const missions = useStore((s) => s.missions);
  const toggleMission = useStore((s) => s.toggleMission);
  const habits = useStore((s) => s.habits);
  const toggleHabitToday = useStore((s) => s.toggleHabitToday);
  const planner = useStore((s) => s.planner);
  const sessions = useStore((s) => s.sessions);

  const [nameSheet, setNameSheet] = useState(false);
  const [nameDraft, setNameDraft] = useState(settings.name);
  const [now, setNow] = useState(new Date());

  // keep the next-block card + greeting honest as time passes
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const today = todayKey();

  // ----- derived -----
  const dueMissions = useMemo(
    () => missions.filter((m) => !m.done && daysUntil(m.deadline) <= 0),
    [missions]
  );
  const tasksLeft = dailyTasks.filter((t) => t.doneOn !== today).length + dueMissions.length;
  const habitsDone = habits.filter((h) => h.doneDates.includes(today)).length;

  const focusToday = Math.round(
    sessions.filter((s) => s.dateKey === today).reduce((a, s) => a + s.netSeconds, 0) / 60
  );

  // Next block up (after 9pm: tomorrow's first block)
  const nextBlock = useMemo(() => {
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const lateNight = now.getHours() >= 21;
    const dToday = dayName(now);
    const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
    const dTomorrow = dayName(tomorrow);

    const sorted = (d: typeof dToday) =>
      [...(planner[d] || [])].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));

    if (!lateNight) {
      const current = sorted(dToday).find((b) => toMinutes(b.start) <= nowMin && toMinutes(b.end) > nowMin);
      if (current) return { block: current, tag: 'NOW' };
      const next = sorted(dToday).find((b) => toMinutes(b.start) > nowMin);
      if (next) return { block: next, tag: 'NEXT UP' };
    }
    const first = sorted(dTomorrow)[0];
    if (first) return { block: first, tag: 'TOMORROW' };
    return null;
  }, [planner, now]);

  // Weekly focus bars (last 7 days, minutes)
  const weekBars = useMemo(() => {
    const out: { label: string; mins: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = todayKey(d);
      const mins = Math.round(sessions.filter((s) => s.dateKey === key).reduce((a, s) => a + s.netSeconds, 0) / 60);
      out.push({ label: DAY_NAMES[(d.getDay() + 6) % 7][0], mins });
    }
    return out;
  }, [sessions]);
  const maxMins = Math.max(30, ...weekBars.map((b) => b.mins));
  const weekTotal = weekBars.reduce((a, b) => a + b.mins, 0);

  const todayList = [
    ...dailyTasks.map((t) => ({ kind: 'daily' as const, id: t.id, title: t.title, done: t.doneOn === today })),
    ...dueMissions.map((m) => ({ kind: 'mission' as const, id: m.id, title: m.title, done: m.done })),
  ];
  const doneCount = todayList.filter((t) => t.done).length;

  return (
    <ScreenBG>
      <ScrollView
        contentContainerStyle={{ padding: S.pad, paddingTop: insets.top + 18, paddingBottom: 44 }}
        showsVerticalScrollIndicator={false}
      >
        {/* header */}
        <Pressable onPress={() => { setNameDraft(settings.name); setNameSheet(true); }}>
          <Text style={T.kicker}>{fmtDate(now)}</Text>
          <Text style={[T.display, { marginTop: 6 }]}>
            {greetWord(now)}
            {settings.name ? <Text>{','}{'\n'}<Text style={{ color: C.accent }}>{settings.name}</Text></Text> : null}
          </Text>
        </Pressable>

        <ClockOrb />

        {/* next block up */}
        {nextBlock && (
          <GlassCard pad={14} onPress={() => router.push('/planner')}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Row style={{ flex: 1 }}>
                <View style={[st.blockBar, { backgroundColor: nextBlock.block.color }]} />
                <View style={{ flex: 1 }}>
                  <Text style={T.title} numberOfLines={1}>{nextBlock.block.subject}</Text>
                  <Text style={[T.caption, { marginTop: 2 }]}>
                    {fmtClockTime(toMinutes(nextBlock.block.start), settings.hour24)} – {fmtClockTime(toMinutes(nextBlock.block.end), settings.hour24)}
                  </Text>
                </View>
              </Row>
              <View style={st.tagPill}>
                <Text style={st.tagText}>{nextBlock.tag}</Text>
              </View>
            </Row>
          </GlassCard>
        )}

        {/* glance strip — one card, three columns */}
        <GlassCard pad={0}>
          <Row>
            <Glance value={String(tasksLeft)} label="tasks left" color={C.accent} />
            <View style={st.vDivider} />
            <Glance value={habits.length ? `${habitsDone}/${habits.length}` : '—'} label="habits" color={C.green} />
            <View style={st.vDivider} />
            <Glance value={`${focusToday}`} suffix=" min" label="focused" color={C.violet} />
          </Row>
        </GlassCard>

        {/* quick access */}
        <SectionTitle>Quick access</SectionTitle>
        <View style={st.grid}>
          {QUICK.map((q) => (
            <GlassCard key={q.label} pad={0} style={st.gridItem} onPress={() => router.push(q.route as any)}>
              <View style={{ alignItems: 'center', paddingVertical: 16 }}>
                <View style={[st.iconTile, { backgroundColor: q.color + '1C', borderColor: q.color + '44' }]}>
                  <Ionicons name={q.icon as any} size={22} color={q.color} />
                </View>
                <Text style={st.gridLabel}>{q.label}</Text>
              </View>
            </GlassCard>
          ))}
        </View>

        {/* today's tasks inline */}
        <SectionTitle
          right={
            <Pressable onPress={() => router.push('/tasks')} hitSlop={8}>
              <Text style={st.link}>All tasks →</Text>
            </Pressable>
          }
        >
          Today {todayList.length > 0 ? `· ${doneCount}/${todayList.length}` : ''}
        </SectionTitle>
        <GlassCard pad={6}>
          {todayList.length === 0 ? (
            <EmptyText>Nothing on the list — add tasks from the Tasks tab.</EmptyText>
          ) : (
            todayList.map((t, i) => (
              <View key={t.kind + t.id}>
                {i > 0 && <Hairline />}
                <Row style={{ paddingVertical: 11, paddingHorizontal: 10 }}>
                  <CheckCircle
                    done={t.done}
                    color={t.kind === 'mission' ? C.amber : C.green}
                    onPress={() => (t.kind === 'daily' ? toggleDaily(t.id) : toggleMission(t.id))}
                  />
                  <Text style={[st.taskText, t.done && st.taskDone]} numberOfLines={1}>{t.title}</Text>
                  {t.kind === 'mission' && (
                    <View style={st.missionPill}><Text style={st.missionPillText}>DUE</Text></View>
                  )}
                </Row>
              </View>
            ))
          )}
        </GlassCard>

        {/* habit chips */}
        {habits.length > 0 && (
          <>
            <SectionTitle>Habits</SectionTitle>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {habits.map((h) => {
                const done = h.doneDates.includes(today);
                return (
                  <Pressable
                    key={h.id}
                    onPress={() => toggleHabitToday(h.id)}
                    style={({ pressed }) => [st.habitChip, done && st.habitChipDone, pressed && { opacity: 0.8 }]}
                  >
                    <Ionicons name={done ? 'checkmark-circle' : 'ellipse-outline'} size={15} color={done ? C.green : C.textFaint} />
                    <Text style={[st.habitText, done && { color: C.green, fontWeight: '600' }]}>{h.title}</Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}

        {/* weekly focus */}
        <SectionTitle>Focus this week</SectionTitle>
        <GlassCard>
          <Row style={{ alignItems: 'flex-end', justifyContent: 'space-between', height: 88, paddingHorizontal: 4 }}>
            {weekBars.map((b, i) => (
              <View key={i} style={{ alignItems: 'center', flex: 1 }}>
                {b.mins > 0 && (
                  <Text style={st.barValue}>{b.mins}</Text>
                )}
                <View
                  style={{
                    width: 16,
                    height: Math.max(4, (b.mins / maxMins) * 56),
                    borderRadius: 8,
                    backgroundColor: i === 6 ? C.accent : 'rgba(143,180,255,0.28)',
                  }}
                />
                <Text style={[st.barLabel, i === 6 && { color: C.accent, fontWeight: '700' }]}>{b.label}</Text>
              </View>
            ))}
          </Row>
          <Hairline />
          <Text style={[T.caption, { textAlign: 'center', marginTop: 10 }]}>
            <Text style={{ color: C.accent, fontWeight: '700' }}>{weekTotal} min</Text> of honest focus in the last 7 days
          </Text>
        </GlassCard>
      </ScrollView>

      {/* set name */}
      <Sheet visible={nameSheet} onClose={() => setNameSheet(false)} title="Your name">
        <Field value={nameDraft} onChangeText={setNameDraft} placeholder="What should the greeting call you?" autoFocus />
        <PillButton label="Save" onPress={() => { setSetting('name', nameDraft.trim()); setNameSheet(false); }} />
      </Sheet>
    </ScreenBG>
  );
}

function Glance({ value, label, color, suffix }: { value: string; label: string; color: string; suffix?: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', paddingVertical: 16 }}>
      <Text style={[st.glanceValue, { color }]}>
        {value}
        {suffix ? <Text style={{ fontSize: 13, fontWeight: '600' }}>{suffix}</Text> : null}
      </Text>
      <Text style={st.glanceLabel}>{label}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  blockBar: { width: 4, height: 34, borderRadius: 2, marginRight: 12 },
  tagPill: {
    borderWidth: 1, borderColor: C.accent + '55', backgroundColor: C.accent + '18',
    borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, marginLeft: 10,
  },
  tagText: { color: C.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  vDivider: { width: StyleSheet.hairlineWidth, backgroundColor: C.hairline, alignSelf: 'stretch', marginVertical: 12 },
  glanceValue: { fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'], letterSpacing: -0.3 },
  glanceLabel: { color: C.textFaint, fontSize: 11, marginTop: 3, letterSpacing: 0.4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  gridItem: { width: '31.6%' },
  iconTile: {
    width: 42, height: 42, borderRadius: 14, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  gridLabel: { color: C.text, fontSize: 12.5, fontWeight: '600', marginTop: 8, letterSpacing: 0.1 },
  link: { color: C.accent, fontSize: 13, fontWeight: '600' },
  taskText: { color: C.text, fontSize: 15, marginLeft: 12, flex: 1, letterSpacing: 0.1 },
  taskDone: { color: C.textFaint, textDecorationLine: 'line-through' },
  missionPill: {
    backgroundColor: C.amber + '1C', borderColor: C.amber + '55', borderWidth: 1,
    borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, marginLeft: 8,
  },
  missionPillText: { color: C.amber, fontSize: 9.5, fontWeight: '800', letterSpacing: 1 },
  habitChip: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 13,
    borderRadius: 999, borderWidth: 1, borderColor: C.border,
    backgroundColor: 'rgba(255,255,255,0.045)', marginRight: 8, marginBottom: 8,
  },
  habitChipDone: { backgroundColor: C.green + '1E', borderColor: C.green + '77' },
  habitText: { color: C.textDim, fontSize: 13, marginLeft: 7 },
  barValue: { color: C.textFaint, fontSize: 9.5, marginBottom: 4, fontVariant: ['tabular-nums'] },
  barLabel: { color: C.textFaint, fontSize: 10.5, marginTop: 7 },
});
