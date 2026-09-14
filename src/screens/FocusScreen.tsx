import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Modal, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { C, F, S, T } from '../theme';
import { useStore } from '../store';
import { todayKey, fmtDuration, uid, toMinutes, fmtClockTime } from '../utils';
import {
  ScreenBG, GlassCard, SectionTitle, CheckCircle, Sheet, Field, PillButton, EmptyState, Row, Chip, IconBtn, NeuIconBtn, ProgressBar, NeuHeader,
} from '../components/UI';
import { SegmentedControl } from '../components/SegmentedControl';
import { Enter, useFocusKey } from '../components/Motion';
import { tick as haptic } from '../haptics';
import { NOTIF_CHANNEL_ID, ensurePermission } from '../notifications';
import { TimerState, displayOf, elapsedOf, useSessionTick } from '../deepWork';
import { AmbientView } from '../components/AmbientView';

interface Attached { key: string; kind: 'custom' | 'daily' | 'mission'; refId?: string; title: string; done: boolean }
type ReviewChoice = 'done' | 'pending' | 'drop';

/** The finish-line heads-up has a fixed id, so it can be cancelled even after the app was killed. */
const FINISH_NOTIF_ID = 'sturoids-finish-line';
const HERO_SIZES = [48, 42, 38];
/** a stopwatch left running with no finish line (a killed app, a forgotten session) logs at most this much */
const STOPWATCH_CAP_SEC = 12 * 3600;

/** The live time. Only this re-renders each second; the screen around it does not. */
function LiveClock({ timer, style, availW = 0, reserve = 0 }: {
  timer: TimerState; style: any; availW?: number; reserve?: number;
}) {
  useSessionTick(timer);
  const text = fmtDuration(displayOf(timer));
  // m:ss always keeps the hero size; h:mm:ss steps down only when it would not fit the card
  let size: number | undefined;
  if (availW > 0 && text.length >= 7) {
    size = HERO_SIZES.find((px) => text.length * 0.6 * px + reserve <= availW - 24) ?? HERO_SIZES[HERO_SIZES.length - 1];
  }
  return <Text style={[style, size ? { fontSize: size } : null]}>{text}</Text>;
}

function LiveProgress({ timer }: { timer: TimerState }) {
  useSessionTick(timer);
  return <ProgressBar value={Math.min(1, Math.max(0, 1 - displayOf(timer) / (timer.targetMin * 60)))} />;
}

export function FocusScreen({ mode }: { mode: 'tab' | 'stack' }) {
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
  const setDeepWork = useStore((s) => s.setDeepWork);
  const patchDeepWork = useStore((s) => s.patchDeepWork);
  // a session in flight survives a process kill: the store keeps a copy and this screen resumes from it
  const saved = useRef(useStore.getState().deepWork).current;

  const [timerMode, setTimerMode] = useState<'stopwatch' | 'countdown'>(saved?.mode ?? 'countdown');
  const [targetMin, setTargetMin] = useState(saved?.targetMin ?? 50);
  const [customMin, setCustomMin] = useState('');
  const [customSheet, setCustomSheet] = useState(false);
  const untilNext = useRef(false);
  const [running, setRunning] = useState(saved?.running ?? false);
  const [startTs, setStartTs] = useState<number | null>(saved?.startTs ?? null);
  const [accumSec, setAccumSec] = useState(saved?.accumSec ?? 0);
  const [subject, setSubject] = useState(saved?.subject ?? '');
  const [attached, setAttached] = useState<Attached[]>(saved?.attached ?? []);
  const [heroW, setHeroW] = useState(0);
  const startedAtRef = useRef<number | null>(saved?.startedAt ?? null);
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
  const [finishAt, setFinishAt] = useState<number | null>(saved?.finishAt ?? null);
  const [finishPrompt, setFinishPrompt] = useState(false);
  const finishNotifId = useRef<string | null>(null);
  const finishHandled = useRef(false);
  const autoConcludeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const started = running || accumSec > 0;
  const startedRef = useRef(started);
  startedRef.current = started;
  const subjectRef = useRef(subject);
  subjectRef.current = subject;
  const timer: TimerState = { mode: timerMode, targetMin, running, startTs, accumSec };

  // planner deep link: a subject (or a length) seeds only a session that has not started, and the params
  // are cleared after, so the same link works again and can never rewrite a session in progress
  useFocusEffect(useCallback(() => {
    if (!params.subject && !params.minutes) return;
    if (!startedRef.current) {
      if (params.subject) setSubject(String(params.subject));
      const m = parseInt(String(params.minutes || ''), 10);
      if (m > 0) { setTimerMode('countdown'); setTargetMin(m); }
    }
    router.setParams({ subject: undefined, minutes: undefined });
  }, [params.subject, params.minutes]));

  // the store keeps a copy of the session in flight, so a killed app resumes it exactly
  useEffect(() => {
    if (!started) {
      if (useStore.getState().deepWork) setDeepWork(null);
      return;
    }
    setDeepWork({
      mode: timerMode, targetMin, running, startTs, accumSec, finishAt, attached,
      startedAt: startedAtRef.current ?? Date.now(), subject: subjectRef.current,
    });
  }, [started, timerMode, targetMin, running, startTs, accumSec, finishAt, attached]);
  // typing a subject writes once it settles, not on every keystroke
  useEffect(() => {
    if (!startedRef.current) return undefined;
    const t = setTimeout(() => patchDeepWork({ subject }), 500);
    return () => clearTimeout(t);
  }, [subject]);

  // countdown auto-finish: one timeout for the moment it runs out, which fires at once for a resumed
  // session that ran out while the app was closed
  useEffect(() => {
    if (timerMode !== 'countdown' || !running || !startTs) return undefined;
    const left = targetMin * 60 - (accumSec + (Date.now() - startTs) / 1000);
    const t = setTimeout(() => {
      if (endedRef.current) return;
      endedRef.current = true;
      endSessionRef.current();
    }, Math.max(0, left * 1000));
    return () => clearTimeout(t);
  }, [timerMode, running, startTs, accumSec, targetMin]);

  const start = () => {
    endedRef.current = false;
    if (startedAtRef.current == null) startedAtRef.current = Date.now();
    setStartTs(Date.now());
    setRunning(true);
  };
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
    // cancelled by its fixed id, so a finish line set before the app was killed still clears
    Notifications.cancelScheduledNotificationAsync(FINISH_NOTIF_ID).catch(() => {});
    finishNotifId.current = null;
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
    else if (d.getTime() <= Date.now()) { Alert.alert('Already passed', 'That time has already passed today. Pick Tomorrow or a later time.'); return; }
    clearFinishLine();
    setFinishAt(d.getTime());
    setFinishSheet(false);
    // heads-up for when the app is backgrounded; the in-app flow below is primary
    try {
      if (await ensurePermission()) {
        finishNotifId.current = await Notifications.scheduleNotificationAsync({
          identifier: FINISH_NOTIF_ID,
          content: { title: 'Finish line reached', body: 'Your Deep Work finish line has passed. Open Sturoids to wrap up.' },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: d, channelId: NOTIF_CHANNEL_ID } as any,
        });
      }
    } catch {}
  };

  // unmount safety: never leave the 10-minute timer behind. The finish-line notification stays: the
  // session is persisted and still running, and the heads-up is exactly what an absent user needs.
  useEffect(() => () => {
    if (autoConcludeTimer.current) clearTimeout(autoConcludeTimer.current);
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
          content: { title: 'Session wrapped up', body: 'The stopwatch was paused at your finish line, so the session ended on its own.' },
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
    const reachedFinish = finishAt != null && Date.now() >= finishAt;
    clearFinishLine();
    let net = accumSec + (running && startTs ? (Date.now() - startTs) / 1000 : 0);
    // never log more than the block, or time after a finish line that passed while away
    if (timerMode === 'countdown') net = Math.min(net, targetMin * 60);
    else if (reachedFinish && finishAt != null && startedAtRef.current != null) {
      net = Math.min(net, Math.max(0, (finishAt - startedAtRef.current) / 1000));
    }
    if (timerMode === 'stopwatch') net = Math.min(net, STOPWATCH_CAP_SEC);
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
      if (choices[a.key] === 'done' && !a.done) completeInStore(a);
    }
    if (netSeconds >= 5) {
      logSession({
        // the day the session began, so a session across midnight counts where it started
        dateKey: todayKey(new Date(startedAtRef.current ?? Date.now())), endedAt: Date.now(),
        netSeconds: Math.round(netSeconds),
        taskTitles: attached.map((a) => a.title),
        subject: subject.trim() || undefined,
      });
    }
    reset();
  }

  function reset() {
    setReview(null); setAttached([]); setAccumSec(0); setRunning(false); setStartTs(null);
    setSubject(''); endedRef.current = false; startedAtRef.current = null;
  }
  useEffect(() => { endSessionRef.current = endSession; });

  /** Completes a task's store copy, only ever forward: a task already done elsewhere stays done. */
  const completeInStore = (a: Attached) => {
    const st0 = useStore.getState();
    if (a.kind === 'daily' && a.refId) {
      const t = st0.dailyTasks.find((x) => x.id === a.refId);
      if (t && t.doneOn !== todayKey()) toggleDaily(a.refId);
    } else if (a.kind === 'mission' && a.refId) {
      const m = st0.missions.find((x) => x.id === a.refId);
      if (m && !m.done) toggleMission(a.refId);
    }
  };

  // ticking completes the task for real; un-ticking inside the session only clears the session's mark
  const markAttached = (key: string) => {
    const a = attached.find((x) => x.key === key);
    if (!a) return;
    if (!a.done) completeInStore(a);
    setAttached((list) => list.map((x) => (x.key === key ? { ...x, done: !x.done } : x)));
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
    <ScreenBG guard={mode === 'tab'}>
      {mode !== 'tab' && <NeuHeader title="Deep Work" />}
      <ScrollView
        key={fk}
        contentContainerStyle={{ padding: S.pad, paddingTop: mode === 'tab' ? insets.top + 20 : 8, paddingBottom: 40 + (mode === 'tab' ? 0 : insets.bottom) }}
      >
        {mode === 'tab' && <Text style={st.h1}>Deep Work</Text>}
        {todayFocusMin > 0 ? (
          <Text style={{ color: C.textDim, fontFamily: F.reg, fontSize: 13, marginBottom: 14 }}>
            {todayFocusMin} focused minutes today
          </Text>
        ) : (
          <View style={{ height: 14 }} />
        )}

        {/* timer mode + presets */}
        {!started && (
          <>
            <SegmentedControl
              size="sm"
              options={[
                { key: 'countdown', label: 'Countdown' },
                { key: 'stopwatch', label: 'Stopwatch' },
              ]}
              value={timerMode}
              onChange={(k) => { setTimerMode(k); if (k === 'countdown') clearFinishLine(); }}
              style={{ marginBottom: 10 }}
            />
            {timerMode === 'countdown' && (
              <SegmentedControl
                size="sm"
                stretch
                options={[
                  { key: '25', label: '25' }, { key: '50', label: '50' }, { key: '90', label: '90' },
                  { key: '120', label: '120' }, { key: 'custom', label: 'Custom' },
                ]}
                value={[25, 50, 90, 120].includes(targetMin) ? String(targetMin) : 'custom'}
                onChange={(k) => { if (k === 'custom') { setCustomMin(''); setCustomSheet(true); } else setTargetMin(Number(k)); }}
                onPressActive={(k) => { if (k === 'custom') { setCustomMin(String(targetMin)); setCustomSheet(true); } }}
                style={{ marginBottom: 12 }}
              />
            )}
          </>
        )}

        {/* timer hero */}
        <Enter index={0}>
          <GlassCard hero style={{ alignItems: 'center', paddingVertical: 30 }}>
            <View style={{ alignSelf: 'stretch' }} onLayout={(e) => setHeroW(e.nativeEvent.layout.width)} />
            <Row style={{ alignItems: 'center', gap: 12 }}>
              {!started && timerMode === 'countdown' && (
                <NeuIconBtn name="remove" dim={38} size={18} color={C.textDim}
                  onPress={() => { haptic(); setTargetMin((m) => Math.max(1, m - 1)); }} />
              )}
              <LiveClock timer={timer} style={st.time} availW={heroW} reserve={!started && timerMode === 'countdown' ? 100 : 0} />
              {!started && timerMode === 'countdown' && (
                <NeuIconBtn name="add" dim={38} size={18} color={C.textDim}
                  onPress={() => { haptic(); setTargetMin((m) => m + 1); }} />
              )}
            </Row>
            <Text style={{ color: C.textDim, fontFamily: F.reg, fontSize: 13, marginTop: 4 }}>
              {timerMode === 'countdown' ? `${targetMin} min block` : 'stopwatch'}
              {subject ? ` · ${subject}` : ''}
            </Text>
            {timerMode === 'stopwatch' && (
              <View style={{ marginTop: 10 }}>
                <Chip
                  small
                  label={finishAt ? `Finish ${fmtClockTime(new Date(finishAt).getHours() * 60 + new Date(finishAt).getMinutes(), hour24)}` : 'Finish line'}
                  active={!!finishAt}
                  color={C.accent}
                  onPress={() => setFinishSheet(true)}
                />
              </View>
            )}
            {timerMode === 'countdown' && (
              <View style={{ alignSelf: 'stretch', marginTop: 12 }}>
                <LiveProgress timer={timer} />
              </View>
            )}
            <Row style={{ marginTop: 20, gap: 10 }}>
              {!running ? (
                <PillButton label={started ? 'Resume' : 'Start'} icon="play" onPress={start} />
              ) : (
                <PillButton label="Pause" icon="pause" color={C.amber} onPress={pause} />
              )}
              {started && <PillButton label="End" icon="stop" color={C.danger} outline onPress={endSession} />}
              {running && <PillButton label="Ambient" icon="moon" color={C.accent} outline onPress={() => setAmbient(true)} />}
            </Row>
          </GlassCard>
        </Enter>

        <Enter index={1}>
          <Field value={subject} onChangeText={setSubject} placeholder="Subject, like Physics (optional)" />
        </Enter>

        {/* attached tasks */}
        <SectionTitle right={<Text style={{ color: C.accent, fontFamily: F.semi, fontSize: 13 }} onPress={() => setPickSheet(true)}>+ Attach</Text>}>
          Session tasks
        </SectionTitle>
        <Enter index={2}>
          <GlassCard pad={10}>
            {attached.length === 0 ? (
              <EmptyState compact icon="link-outline" title="No tasks attached" body="Attach tasks before or during the session, then check them off as you go." />
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
          <EmptyState compact icon="time-outline" title="No sessions yet" body="Finished sessions land here." />
        ) : (
          [...sessions].reverse().slice(0, 6).map((s, i) => (
            <Enter key={s.id} index={3 + i}>
              <GlassCard pad={12}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: C.text, fontFamily: F.semi, fontSize: 14 }}>
                      {Math.round(s.netSeconds / 60)} min{s.subject ? ` · ${s.subject}` : ''}
                    </Text>
                    <Text style={{ color: C.textFaint, fontFamily: F.reg, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                      {s.dateKey}{s.taskTitles.length ? ` · ${s.taskTitles.join(', ')}` : ''}
                    </Text>
                  </View>
                  <Ionicons name="flash" size={18} color={C.accent} />
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
        <Text style={{ color: C.textDim, fontFamily: F.reg, marginBottom: 12, fontSize: 13 }}>
          {Math.round(accumSec / 60)} focused minutes. What happened to the unchecked items?
        </Text>
        {review?.items.map((it) => (
          <View key={it.key} style={{ marginBottom: 12 }}>
            <Text style={{ color: C.text, fontFamily: F.med, fontSize: 14, marginBottom: 6 }}>{it.title}</Text>
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
        <Text style={{ color: C.textDim, fontFamily: F.reg, fontSize: 13, marginBottom: 10 }}>
          Pick a time of day. The gap from now becomes the countdown length, and nothing stops on its own at that time.
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

      {/* a length that is not a preset: minutes, or until a clock time */}
      <Sheet
        visible={customSheet} onClose={() => setCustomSheet(false)} title="Custom length"
        onClosed={() => { if (untilNext.current) { untilNext.current = false; setUntilSheet(true); } }}
      >
        <Field
          value={customMin} onChangeText={setCustomMin} placeholder="Minutes"
          keyboardType="number-pad" autoFocus
          onSubmitEditing={() => { const n = parseInt(customMin, 10); if (n > 0) { setTargetMin(Math.min(n, 600)); setCustomSheet(false); } }}
        />
        <PillButton
          label="Set length"
          onPress={() => { const n = parseInt(customMin, 10); if (n > 0) { setTargetMin(Math.min(n, 600)); setCustomSheet(false); } }}
        />
        <Pressable
          onPress={() => { untilNext.current = true; setCustomSheet(false); }}
          style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 16, marginTop: 6 }}
        >
          <Ionicons name="alarm-outline" size={18} color={C.textDim} />
          <Text style={[T.body, { flex: 1, marginLeft: 10 }]}>Until a time</Text>
          <Ionicons name="chevron-forward" size={18} color={C.textFaint} />
        </Pressable>
      </Sheet>

      {/* stopwatch finish line */}
      <Sheet visible={finishSheet} onClose={() => setFinishSheet(false)} title="Finish line">
        <Text style={{ color: C.textDim, fontFamily: F.reg, fontSize: 13, marginBottom: 10 }}>
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
        <Text style={{ color: C.textDim, fontFamily: F.reg, fontSize: 13, marginBottom: 14 }}>
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

      <AmbientView
        visible={ambient} timer={timer} subject={subject} task={currentTask?.title}
        finishAt={finishAt} hour24={hour24} onExit={() => setAmbient(false)}
      />
    </ScreenBG>
  );
}

const st = StyleSheet.create({
  h1: { ...(T.display as object), marginBottom: 2 } as any,
  time: { ...T.mono48, letterSpacing: 0 },
  taskText: { color: C.text, fontFamily: F.reg, fontSize: 15, marginLeft: 10, flex: 1 },
  taskDone: { color: C.textFaint, textDecorationLine: 'line-through' },
  sheetSection: { color: C.textFaint, fontSize: 12, fontFamily: F.semi, textTransform: 'uppercase', letterSpacing: 1, marginTop: 10, marginBottom: 6 },
  pickRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.border },
});
