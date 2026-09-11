import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Modal, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { C, F, S, T } from '../../src/theme';
import { useStore } from '../../src/store';
import { todayKey, fmtDuration, uid, toMinutes, fmtClockTime } from '../../src/utils';
import {
  ScreenBG, GlassCard, SectionTitle, CheckCircle, Sheet, Field, PillButton, EmptyText, Row, Chip, IconBtn, NeuIconBtn, ProgressBar,
} from '../../src/components/UI';
import { SegmentedControl } from '../../src/components/SegmentedControl';
import { Enter, useFocusKey } from '../../src/components/Motion';
import { tick as haptic } from '../../src/haptics';
import { ensurePermission } from '../../src/notifications';

interface Attached { key: string; kind: 'custom' | 'daily' | 'mission'; refId?: string; title: string; done: boolean }
type ReviewChoice = 'done' | 'pending' | 'drop';

export default function Focus() {
  const insets = useSafeAreaInsets();
  const fk = useFocusKey();
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

  // "until a time of day" countdown seeding
  const [untilSheet, setUntilSheet] = useState(false);
  const [untilTime, setUntilTime] = useState('');

  // stopwatch finish line (optional auto-conclude)
  const [finishSheet, setFinishSheet] = useState(false);
  const [finishDay, setFinishDay] = useState<'today' | 'tomorrow'>('today');
  const [finishTime, setFinishTime] = useState('');
  const [finishAt, setFinishAt] = useState<number | null>(null);
  const [finishPrompt, setFinishPrompt] = useState(false);
  const finishNotifId = useRef<string | null>(null);
  const finishHandled = useRef(false);
  const autoConcludeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // live refs so the finish-line interval never acts on stale closures
  const runningRef = useRef(running); runningRef.current = running;
  const startedLiveRef = useRef(started); startedLiveRef.current = started;
  const endSessionRef = useRef<() => void>(() => {});

  /** Minutes from now until the next occurrence of a wall-clock HH:MM. */
  const minutesUntil = (hhmm: string): number | null => {
    const t = toMinutes(hhmm);
    if (t < 0) return null;
    const now = new Date();
    let diff = t - (now.getHours() * 60 + now.getMinutes());
    if (diff <= 0) diff += 24 * 60;
    return diff;
  };
  const untilPreviewMin = minutesUntil(untilTime.trim());

  const clearFinishLine = () => {
    if (autoConcludeTimer.current) { clearTimeout(autoConcludeTimer.current); autoConcludeTimer.current = null; }
    if (finishNotifId.current) {
      Notifications.cancelScheduledNotificationAsync(finishNotifId.current).catch(() => {});
      finishNotifId.current = null;
    }
    finishHandled.current = false;
    setFinishPrompt(false);
    setFinishAt(null);
  };

  const setFinishLine = async () => {
    const t = toMinutes(finishTime.trim());
    if (t < 0) { Alert.alert('Time format', 'Use 24h HH:MM, e.g. 17:30'); return; }
    const d = new Date();
    d.setHours(Math.floor(t / 60), t % 60, 0, 0);
    if (finishDay === 'tomorrow') d.setDate(d.getDate() + 1);
    else if (d.getTime() <= Date.now()) { Alert.alert('Already passed', 'That time is behind us today — pick Tomorrow or a later time.'); return; }
    clearFinishLine();
    setFinishAt(d.getTime());
    setFinishSheet(false);
    // heads-up for when the app is backgrounded; the in-app flow below is primary.
    // (a reminders reschedule elsewhere cancels ALL scheduled notifications — rare
    // mid-session; the in-app check still concludes correctly.)
    try {
      if (await ensurePermission()) {
        finishNotifId.current = await Notifications.scheduleNotificationAsync({
          content: { title: 'Finish line reached', body: 'Your Deep Work finish line has passed — open Sturoids to wrap up.' },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: d } as any,
        });
      }
    } catch {}
  };

  // unmount safety: never leave a 10-min timer or scheduled notification behind
  useEffect(() => () => {
    if (autoConcludeTimer.current) clearTimeout(autoConcludeTimer.current);
    if (finishNotifId.current) Notifications.cancelScheduledNotificationAsync(finishNotifId.current).catch(() => {});
  }, []);

  // watch the finish line even while paused (the tick interval only runs when running)
  useEffect(() => {
    if (!finishAt) return;
    const check = () => {
      if (finishHandled.current || !finishAt) return;
      if (Date.now() < finishAt) return;
      finishHandled.current = true;
      if (runningRef.current) {
        // running: ask, auto-conclude after 10 minutes of silence
        setFinishPrompt(true);
        autoConcludeTimer.current = setTimeout(() => {
          if (runningRef.current) {
            setFinishPrompt(false);
            endSessionRef.current();
          }
        }, 10 * 60 * 1000);
      } else if (startedLiveRef.current) {
        // paused at the finish line: conclude immediately, notify
        Notifications.scheduleNotificationAsync({
          content: { title: 'Session wrapped up', body: 'The stopwatch was paused at your finish line — the session was concluded automatically.' },
          trigger: null,
        }).catch(() => {});
        endSessionRef.current();
      } else {
        // never started — nothing to conclude
        clearFinishLine();
      }
    };
    const iv = setInterval(check, 1000);
    check();
    return () => clearInterval(iv);
  }, [finishAt]);

  function endSession() {
    clearFinishLine();
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
  endSessionRef.current = endSession;

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
    <ScreenBG guard>
      <ScrollView key={fk} contentContainerStyle={{ padding: S.pad, paddingTop: insets.top + 20, paddingBottom: 40 }}>
        <Text style={st.h1}>Deep Work</Text>
        {todayFocusMin > 0 ? (
          <Text style={{ color: C.textDim, fontSize: 13, marginBottom: 14 }}>
            {todayFocusMin} focused minutes today
          </Text>
        ) : (
          <View style={{ height: 14 }} />
        )}

        {/* mode + presets */}
        {!started && (
          <>
            <SegmentedControl
              size="sm"
              options={[
                { key: 'countdown', label: 'Countdown' },
                { key: 'stopwatch', label: 'Stopwatch' },
              ]}
              value={mode}
              onChange={(k) => { setMode(k); if (k === 'countdown') clearFinishLine(); }}
              style={{ marginBottom: 10 }}
            />
            {mode === 'countdown' && (
              <Row style={{ flexWrap: 'wrap', marginBottom: 4 }}>
                {[25, 50, 90, 120].map((m) => (
                  <Chip key={m} small label={`${m}m`} active={targetMin === m} onPress={() => setTargetMin(m)} />
                ))}
                <Chip small label="Until…" onPress={() => setUntilSheet(true)} />
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
        <Enter index={0}>
          <GlassCard hero style={{ alignItems: 'center', paddingVertical: 30 }}>
            <Row style={{ alignItems: 'center', gap: 12 }}>
              {!started && mode === 'countdown' && (
                <NeuIconBtn name="remove" dim={38} size={18} color={C.textDim}
                  onPress={() => { haptic(); setTargetMin((m) => Math.max(1, m - 1)); }} />
              )}
              <Text style={st.time}>{fmtDuration(displaySec)}</Text>
              {!started && mode === 'countdown' && (
                <NeuIconBtn name="add" dim={38} size={18} color={C.textDim}
                  onPress={() => { haptic(); setTargetMin((m) => m + 1); }} />
              )}
            </Row>
            <Text style={{ color: C.textDim, fontSize: 13, marginTop: 4 }}>
              {mode === 'countdown' ? `${targetMin} min block` : 'stopwatch'}
              {subject ? ` · ${subject}` : ''}
            </Text>
            {mode === 'stopwatch' && (
              <View style={{ marginTop: 10 }}>
                <Chip
                  small
                  label={finishAt ? `Finish ${fmtClockTime(new Date(finishAt).getHours() * 60 + new Date(finishAt).getMinutes(), hour24)}` : 'Finish line'}
                  active={!!finishAt}
                  color={C.violet}
                  onPress={() => setFinishSheet(true)}
                />
              </View>
            )}
            {mode === 'countdown' && (
              <View style={{ alignSelf: 'stretch', marginTop: 12 }}>
                <ProgressBar value={Math.min(1, Math.max(0, 1 - remaining / (targetMin * 60)))} />
              </View>
            )}
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
        </Enter>

        <Enter index={1}>
          <Field value={subject} onChangeText={setSubject} placeholder="Subject (optional) — e.g. Physics" />
        </Enter>

        {/* attached tasks */}
        <SectionTitle right={<Text style={{ color: C.accent, fontSize: 13 }} onPress={() => setPickSheet(true)}>+ Attach</Text>}>
          Session tasks
        </SectionTitle>
        <Enter index={2}>
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
        </Enter>

        {/* recent sessions */}
        <SectionTitle>Recent sessions</SectionTitle>
        {sessions.length === 0 ? (
          <EmptyText>Finished sessions land here.</EmptyText>
        ) : (
          [...sessions].reverse().slice(0, 6).map((s, i) => (
            <Enter key={s.id} index={3 + i}>
              <GlassCard pad={12}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: C.text, fontFamily: F.semi, fontSize: 14 }}>
                      {Math.round(s.netSeconds / 60)} min{s.subject ? ` · ${s.subject}` : ''}
                    </Text>
                    <Text style={{ color: C.textFaint, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                      {s.dateKey}{s.taskTitles.length ? ` · ${s.taskTitles.join(', ')}` : ''}
                    </Text>
                  </View>
                  <Ionicons name="flash" size={18} color={C.violet} />
                </Row>
              </GlassCard>
            </Enter>
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

      {/* countdown until a time of day */}
      <Sheet visible={untilSheet} onClose={() => setUntilSheet(false)} title="Count down until…">
        <Text style={{ color: C.textDim, fontSize: 13, marginBottom: 10 }}>
          Pick a time of day — the gap from now becomes the countdown length. Nothing stops automatically at that time.
        </Text>
        <Field
          value={untilTime} onChangeText={setUntilTime}
          placeholder="24h HH:MM, e.g. 17:30" keyboardType="numbers-and-punctuation" autoFocus
        />
        {untilPreviewMin != null && (
          <Text style={{ color: C.accent, fontSize: 13, fontFamily: F.med, marginBottom: 10 }}>
            ≈ {Math.floor(untilPreviewMin / 60) > 0 ? `${Math.floor(untilPreviewMin / 60)}h ` : ''}{untilPreviewMin % 60}m from now
          </Text>
        )}
        <PillButton
          label="Set countdown"
          onPress={() => {
            const m = minutesUntil(untilTime.trim());
            if (m == null) { Alert.alert('Time format', 'Use 24h HH:MM, e.g. 17:30'); return; }
            setTargetMin(m); setCustomMin(''); setUntilSheet(false);
          }}
        />
      </Sheet>

      {/* stopwatch finish line */}
      <Sheet visible={finishSheet} onClose={() => setFinishSheet(false)} title="Finish line">
        <Text style={{ color: C.textDim, fontSize: 13, marginBottom: 10 }}>
          A soft endpoint for the stopwatch. When it passes while running you'll be asked to wrap up (auto-concludes after 10 quiet minutes); if you're paused at that moment, the session wraps up on its own.
        </Text>
        <Row style={{ marginBottom: 4 }}>
          <Chip small label="Today" active={finishDay === 'today'} onPress={() => setFinishDay('today')} />
          <Chip small label="Tomorrow" active={finishDay === 'tomorrow'} onPress={() => setFinishDay('tomorrow')} />
        </Row>
        <Field
          value={finishTime} onChangeText={setFinishTime}
          placeholder="24h HH:MM, e.g. 22:00" keyboardType="numbers-and-punctuation"
        />
        <Row style={{ gap: 10 }}>
          <PillButton label="Set finish line" onPress={setFinishLine} style={{ flex: 1 }} />
          {finishAt != null && (
            <PillButton label="Clear" color={C.danger} outline onPress={() => { clearFinishLine(); setFinishSheet(false); }} />
          )}
        </Row>
      </Sheet>

      {/* finish line reached — approval window */}
      <Sheet
        visible={finishPrompt}
        onClose={() => { if (autoConcludeTimer.current) clearTimeout(autoConcludeTimer.current); clearFinishLine(); }}
        title="Finish line reached"
      >
        <Text style={{ color: C.textDim, fontSize: 13, marginBottom: 14 }}>
          End the session here, or skip the finish line and keep going. If you do nothing, the session wraps up on its own in 10 minutes.
        </Text>
        <PillButton
          label="End session" color={C.danger}
          onPress={() => { setFinishPrompt(false); endSession(); }}
        />
        <PillButton
          label="Skip finish line" outline style={{ marginTop: 10 }}
          onPress={() => { if (autoConcludeTimer.current) clearTimeout(autoConcludeTimer.current); clearFinishLine(); }}
        />
      </Sheet>

      {/* ambient mode */}
      <Modal visible={ambient} animationType="fade" onRequestClose={() => setAmbient(false)}>
        <Pressable style={[st.ambient, { paddingTop: insets.top }]} onPress={() => setAmbient(false)}>
          <View style={[st.ambientGlow, { backgroundColor: C.accent }]} />
          <Text style={st.ambientTime}>{fmtDuration(displaySec)}</Text>
          {subject ? <Text style={[st.ambientSub, { color: C.accent }]}>{subject}</Text> : null}
          {currentTask && <Text style={st.ambientTask}>{currentTask.title}</Text>}
          <Text style={{ color: C.textFaint, fontSize: 12, position: 'absolute', bottom: Math.max(insets.bottom, 20) + 20 }}>tap anywhere to exit</Text>
        </Pressable>
      </Modal>
    </ScreenBG>
  );
}

const st = StyleSheet.create({
  h1: { ...(T.display as object), marginBottom: 2 } as any,
  time: { color: C.text, fontSize: 48, fontFamily: F.mono, letterSpacing: 0 },
  taskText: { color: C.text, fontSize: 15, marginLeft: 10, flex: 1 },
  taskDone: { color: C.textFaint, textDecorationLine: 'line-through' },
  sheetSection: { color: C.textFaint, fontSize: 12, fontFamily: F.semi, textTransform: 'uppercase', letterSpacing: 1, marginTop: 10, marginBottom: 6 },
  pickRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  ambient: { flex: 1, backgroundColor: '#05070F', alignItems: 'center', justifyContent: 'center' },
  ambientGlow: {
    position: 'absolute', width: 320, height: 320, borderRadius: 160,
    opacity: 0.10, transform: [{ scale: 1.4 }],
  },
  ambientTime: { color: C.text, fontSize: 58, fontFamily: F.mono, letterSpacing: 0 },
  ambientSub: { fontSize: 16, marginTop: 8, fontFamily: F.semi },
  ambientTask: { color: C.textDim, fontSize: 14, marginTop: 14 },
});
