import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Modal, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { C, S, T } from '../../src/theme';
import { useStore } from '../../src/store';
import { todayKey, fmtDuration, uid } from '../../src/utils';
import {
  ScreenBG, GlassCard, SectionTitle, CheckCircle, Sheet, Field, PillButton, EmptyText, Row, Chip, IconBtn,
} from '../../src/components/UI';

interface Attached { key: string; kind: 'custom' | 'daily' | 'mission'; refId?: string; title: string; done: boolean }
type ReviewChoice = 'done' | 'pending' | 'drop';

export default function Focus() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ subject?: string; minutes?: string }>();

  const dailyTasks = useStore((s) => s.dailyTasks);
  const missions = useStore((s) => s.missions);
  const toggleDaily = useStore((s) => s.toggleDaily);
  const toggleMission = useStore((s) => s.toggleMission);
  const logSession = useStore((s) => s.logSession);
  const sessions = useStore((s) => s.sessions);
  const hour24 = useStore((s) => s.settings.hour24);

  const [mode, setMode] = useState<'stopwatch' | 'countdown'>('countdown');
  const [targetMin, setTargetMin] = useState(50);
  const [customMin, setCustomMin] = useState('');
  const [running, setRunning] = useState(false);
  const [startTs, setStartTs] = useState<number | null>(null);
  const [accumSec, setAccumSec] = useState(0);
  const [, setTick] = useState(0);
  const [subject, setSubject] = useState('');
  const [attached, setAttached] = useState<Attached[]>([]);
  const [pickSheet, setPickSheet] = useState(false);
  const [customTask, setCustomTask] = useState('');
  const [ambient, setAmbient] = useState(false);
  const [review, setReview] = useState<{ items: Attached[]; choices: Record<string, ReviewChoice> } | null>(null);
  const endedRef = useRef(false);

  // planner deep-link
  useEffect(() => {
    if (params.subject) setSubject(String(params.subject));
    if (params.minutes) {
      const m = parseInt(String(params.minutes), 10);
      if (m > 0) { setMode('countdown'); setTargetMin(m); }
    }
  }, [params.subject, params.minutes]);

  // ticking
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setTick((x) => x + 1), 500);
    return () => clearInterval(t);
  }, [running]);

  const elapsed = accumSec + (running && startTs ? (Date.now() - startTs) / 1000 : 0);
  const remaining = Math.max(0, targetMin * 60 - elapsed);
  const displaySec = mode === 'countdown' ? remaining : elapsed;
  const started = running || accumSec > 0;

  // countdown auto-finish
  useEffect(() => {
    if (mode === 'countdown' && running && remaining <= 0 && !endedRef.current) {
      endedRef.current = true;
      endSession();
    }
  });

  const start = () => { endedRef.current = false; setStartTs(Date.now()); setRunning(true); };
  const pause = () => {
    if (startTs) setAccumSec((a) => a + (Date.now() - startTs) / 1000);
    setRunning(false); setStartTs(null);
  };

  function endSession() {
    const net = accumSec + (running && startTs ? (Date.now() - startTs) / 1000 : 0);
    setRunning(false); setStartTs(null); setAccumSec(net); setAmbient(false);
    const unchecked = attached.filter((a) => !a.done);
    if (net < 5 && attached.length === 0) { reset(); return; }
    if (unchecked.length === 0) { commit(net, {}); return; }
    const choices: Record<string, ReviewChoice> = {};
    unchecked.forEach((u) => (choices[u.key] = 'pending'));
    setReview({ items: unchecked, choices });
  }

  function commit(netSeconds: number, choices: Record<string, ReviewChoice>) {
    // apply review outcomes
    for (const a of attached) {
      const c = choices[a.key];
      if (c === 'done' && !a.done) {
        if (a.kind === 'daily' && a.refId) toggleDaily(a.refId);
        if (a.kind === 'mission' && a.refId) toggleMission(a.refId);
      }
    }
    if (netSeconds >= 5) {
      logSession({
        dateKey: todayKey(), endedAt: Date.now(),
        netSeconds: Math.round(netSeconds),
        taskTitles: attached.map((a) => a.title),
        subject: subject.trim() || undefined,
      });
    }
    reset();
  }

  function reset() {
    setReview(null); setAttached([]); setAccumSec(0); setRunning(false); setStartTs(null);
    setSubject(''); endedRef.current = false;
  }

  const markAttached = (key: string) => {
    setAttached((list) => list.map((a) => {
      if (a.key !== key) return a;
      const done = !a.done;
      if (a.kind === 'daily' && a.refId) toggleDaily(a.refId);
      if (a.kind === 'mission' && a.refId) toggleMission(a.refId);
      return { ...a, done };
    }));
  };

  const attach = (kind: Attached['kind'], title: string, refId?: string) => {
    setAttached((l) => [...l, { key: uid(), kind, title, refId, done: false }]);
  };

  const today = todayKey();
  const pickableDaily = dailyTasks.filter((t) => t.doneOn !== today && !attached.some((a) => a.refId === t.id));
  const pickableMissions = missions.filter((m) => !m.done && !attached.some((a) => a.refId === m.id));
  const currentTask = attached.find((a) => !a.done);

  const todayFocusMin = Math.round(
    sessions.filter((s) => s.dateKey === today).reduce((a, s) => a + s.netSeconds, 0) / 60
  );

  return (
    <ScreenBG>
      <ScrollView contentContainerStyle={{ padding: S.pad, paddingTop: insets.top + 14, paddingBottom: 40 }}>
        <Text style={st.h1}>Deep Work</Text>
        <Text style={{ color: C.textDim, fontSize: 13, marginBottom: 14 }}>
          {todayFocusMin} focused minutes today · pauses don't count, honestly logged
        </Text>

        {/* mode + presets */}
        {!started && (
          <>
            <Row style={{ marginBottom: 10 }}>
              <Chip label="Countdown" active={mode === 'countdown'} onPress={() => setMode('countdown')} />
              <Chip label="Stopwatch" active={mode === 'stopwatch'} onPress={() => setMode('stopwatch')} />
            </Row>
            {mode === 'countdown' && (
              <Row style={{ flexWrap: 'wrap', marginBottom: 4 }}>
                {[25, 50, 90, 120].map((m) => (
                  <Chip key={m} small label={`${m}m`} active={targetMin === m} onPress={() => setTargetMin(m)} />
                ))}
                <Field
                  value={customMin} keyboardType="number-pad" placeholder="custom"
                  onChangeText={(v) => { setCustomMin(v); const n = parseInt(v, 10); if (n > 0) setTargetMin(n); }}
                  style={{ width: 90, marginBottom: 0, paddingVertical: 6 }}
                />
              </Row>
            )}
          </>
        )}

        {/* timer hero */}
        <GlassCard hero style={{ alignItems: 'center', paddingVertical: 30 }}>
          <Text style={st.time}>{fmtDuration(displaySec)}</Text>
          <Text style={{ color: C.textDim, fontSize: 13, marginTop: 4 }}>
            {mode === 'countdown' ? `${targetMin} min block` : 'stopwatch'}
            {subject ? ` · ${subject}` : ''}
          </Text>
          <Row style={{ marginTop: 20, gap: 10 }}>
            {!running ? (
              <PillButton label={started ? 'Resume' : 'Start'} icon="play" onPress={start} />
            ) : (
              <PillButton label="Pause" icon="pause" color={C.amber} onPress={pause} />
            )}
            {started && <PillButton label="End" icon="stop" color={C.danger} outline onPress={endSession} />}
            {running && <PillButton label="Ambient" icon="moon" color={C.violet} outline onPress={() => setAmbient(true)} />}
          </Row>
        </GlassCard>

        <Field value={subject} onChangeText={setSubject} placeholder="Subject (optional) — e.g. Physics" />

        {/* attached tasks */}
        <SectionTitle right={<Text style={{ color: C.accent, fontSize: 13 }} onPress={() => setPickSheet(true)}>+ Attach</Text>}>
          Session tasks
        </SectionTitle>
        <GlassCard pad={10}>
          {attached.length === 0 ? (
            <EmptyText>Attach tasks before or during the session —{'\n'}check them off as you go.</EmptyText>
          ) : (
            attached.map((a) => (
              <Row key={a.key} style={{ paddingVertical: 7, paddingHorizontal: 4 }}>
                <CheckCircle done={a.done} color={a.kind === 'mission' ? C.amber : C.green} onPress={() => markAttached(a.key)} />
                <Text style={[st.taskText, a.done && st.taskDone]} numberOfLines={1}>{a.title}</Text>
                <IconBtn name="close" size={16} onPress={() => setAttached((l) => l.filter((x) => x.key !== a.key))} />
              </Row>
            ))
          )}
        </GlassCard>

        {/* recent sessions */}
        <SectionTitle>Recent sessions</SectionTitle>
        {sessions.length === 0 ? (
          <EmptyText>Finished sessions land here.</EmptyText>
        ) : (
          [...sessions].reverse().slice(0, 6).map((s) => (
            <GlassCard key={s.id} pad={12}>
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: C.text, fontWeight: '600', fontSize: 14 }}>
                    {Math.round(s.netSeconds / 60)} min{s.subject ? ` · ${s.subject}` : ''}
                  </Text>
                  <Text style={{ color: C.textFaint, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                    {s.dateKey}{s.taskTitles.length ? ` · ${s.taskTitles.join(', ')}` : ''}
                  </Text>
                </View>
                <Ionicons name="flash" size={18} color={C.violet} />
              </Row>
            </GlassCard>
          ))
        )}
      </ScrollView>

      {/* attach sheet */}
      <Sheet visible={pickSheet} onClose={() => setPickSheet(false)} title="Attach tasks">
        <Row>
          <Field
            value={customTask} onChangeText={setCustomTask} placeholder="On-the-spot task…"
            style={{ flex: 1 }}
            onSubmitEditing={() => { if (customTask.trim()) { attach('custom', customTask.trim()); setCustomTask(''); } }}
          />
          <IconBtn
            name="add-circle" color={C.accent} size={30} style={{ marginLeft: 8, marginTop: 2 }}
            onPress={() => { if (customTask.trim()) { attach('custom', customTask.trim()); setCustomTask(''); } }}
          />
        </Row>
        {pickableDaily.length > 0 && <Text style={st.sheetSection}>Daily</Text>}
        {pickableDaily.map((t) => (
          <Pressable key={t.id} style={st.pickRow} onPress={() => attach('daily', t.title, t.id)}>
            <Ionicons name="repeat" size={16} color={C.green} />
            <Text style={{ color: C.text, marginLeft: 10, flex: 1 }}>{t.title}</Text>
            <Ionicons name="add" size={18} color={C.textFaint} />
          </Pressable>
        ))}
        {pickableMissions.length > 0 && <Text style={st.sheetSection}>Missions</Text>}
        {pickableMissions.map((m) => (
          <Pressable key={m.id} style={st.pickRow} onPress={() => attach('mission', m.title, m.id)}>
            <Ionicons name="flag" size={16} color={C.amber} />
            <Text style={{ color: C.text, marginLeft: 10, flex: 1 }}>{m.title}</Text>
            <Ionicons name="add" size={18} color={C.textFaint} />
          </Pressable>
        ))}
        <PillButton label="Done" onPress={() => setPickSheet(false)} style={{ marginTop: 12 }} />
      </Sheet>

      {/* post-session review */}
      <Sheet visible={!!review} onClose={() => review && commit(accumSec, review.choices)} title="Session review">
        <Text style={{ color: C.textDim, marginBottom: 12, fontSize: 13 }}>
          {Math.round(accumSec / 60)} focused minutes. What happened to the unchecked items?
        </Text>
        {review?.items.map((it) => (
          <View key={it.key} style={{ marginBottom: 12 }}>
            <Text style={{ color: C.text, fontSize: 14, marginBottom: 6 }}>{it.title}</Text>
            <Row>
              {(['done', 'pending', 'drop'] as ReviewChoice[]).map((c) => (
                <Chip
                  key={c} small label={c === 'done' ? 'Done' : c === 'pending' ? 'Still pending' : 'Drop'}
                  color={c === 'done' ? C.green : c === 'pending' ? C.accent : C.danger}
                  active={review.choices[it.key] === c}
                  onPress={() => setReview({ ...review, choices: { ...review.choices, [it.key]: c } })}
                />
              ))}
            </Row>
          </View>
        ))}
        <PillButton label="Save session" onPress={() => review && commit(accumSec, review.choices)} />
      </Sheet>

      {/* ambient mode */}
      <Modal visible={ambient} animationType="fade" onRequestClose={() => setAmbient(false)}>
        <Pressable style={st.ambient} onPress={() => setAmbient(false)}>
          <View style={[st.ambientGlow]} />
          <Text style={st.ambientTime}>{fmtDuration(displaySec)}</Text>
          {subject ? <Text style={st.ambientSub}>{subject}</Text> : null}
          {currentTask && <Text style={st.ambientTask}>{currentTask.title}</Text>}
          <Text style={{ color: C.textFaint, fontSize: 12, position: 'absolute', bottom: 40 }}>tap anywhere to exit</Text>
        </Pressable>
      </Modal>
    </ScreenBG>
  );
}

const st = StyleSheet.create({
  h1: { ...(T.display as object), marginBottom: 2 } as any,
  time: { color: C.text, fontSize: 56, fontWeight: '800', fontVariant: ['tabular-nums'], letterSpacing: 2 },
  taskText: { color: C.text, fontSize: 15, marginLeft: 10, flex: 1 },
  taskDone: { color: C.textFaint, textDecorationLine: 'line-through' },
  sheetSection: { color: C.textFaint, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginTop: 10, marginBottom: 6 },
  pickRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  ambient: { flex: 1, backgroundColor: '#05070F', alignItems: 'center', justifyContent: 'center' },
  ambientGlow: {
    position: 'absolute', width: 320, height: 320, borderRadius: 160,
    backgroundColor: '#22315E', opacity: 0.35, transform: [{ scale: 1.4 }],
  },
  ambientTime: { color: C.text, fontSize: 64, fontWeight: '800', fontVariant: ['tabular-nums'], letterSpacing: 2 },
  ambientSub: { color: C.accent, fontSize: 16, marginTop: 8, fontWeight: '600' },
  ambientTask: { color: C.textDim, fontSize: 14, marginTop: 14 },
});
