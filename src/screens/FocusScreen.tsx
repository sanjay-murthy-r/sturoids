import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Alert, AppState, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import Animated, { Easing, FadeIn, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { C, F, S, T, TRACK } from '../theme';
import { useStore } from '../store';
import { todayKey, yesterdayKey, uid, toMinutes, fmtClockTime, dayName } from '../utils';
import {
  ScreenBG, GlassCard, SectionTitle, CheckCircle, Sheet, Field, PillButton, EmptyState, Row, Chip, IconBtn, ProgressBar,
  ListCard, ListRow, StrikeText, TimeWheel, useToolHeader, contextLine,
} from '../components/UI';
import { defaultTime, hhmm, parseTime } from '../components/TimeWheel';
import { SegmentedControl } from '../components/SegmentedControl';
import {
  Bouncy, EASE_OUT, Enter, FadeSwap, glide, rowOut, useAnimLevel, useAppActive, useBuilt, useFocusKey,
} from '../components/Motion';
import { swapIn, useSwapIn } from '../components/Swap';
import { Wheel } from '../components/Wheel';
import { tick as haptic } from '../haptics';
import {
  NOTIF_CHANNEL_ID, cancelBreakEnd, cancelCountdownEnd, ensurePermission, scheduleBreakEnd, scheduleCountdownEnd,
} from '../notifications';
import { playSessionEnd } from '../chime';
import { FINISH_NOTIF_ID, TimerState, displayOf, elapsedOf } from '../deepWork';
import { AmbientView } from '../components/AmbientView';
import { ClockDigits } from '../components/ClockDigits';
import { BreakStage, SessionStage } from '../components/SessionStage';
import { READ_MAX, TWO_COL_AT, WIDE_MAX, columnWidth, frame } from '../layout';
import { useNow, useToday } from '../hooks/useNow';
import { toast, ToastAction } from '../components/Toast';
import { openPage, openTool } from '../toolNav';
import { useIntro } from '../intro';

interface Attached { key: string; kind: 'custom' | 'daily' | 'mission'; refId?: string; title: string; done: boolean }
type ReviewChoice = 'done' | 'pending' | 'drop';
/** a session as it stood when it was ended by hand, for the Undo that puts it back */
interface Resume {
  mode: 'stopwatch' | 'countdown'; targetMin: number; accumSec: number; subject: string; attached: Attached[];
  startedAt: number | null; finishAt: number | null; chosen: number; running: boolean;
}

/** the idle stopwatch's clock sits in the slot the clock has always had, so the card keeps its height */
const CLOCK_SLOT_H = 60;
/** a stopwatch left running with no finish line (a killed app, a forgotten session) logs at most this much */
const STOPWATCH_CAP_SEC = 12 * 3600;

/** the countdown lengths the wheel offers, in minutes; a custom length joins them */
const LENGTHS = Array.from({ length: 48 }, (_, i) => 5 + 5 * i);
/** the longest block, typed or until a clock time: ten hours */
const LONGEST_MIN = 600;

/** the breaks offered when a countdown block runs out, in minutes */
const BREAK_LENGTHS = [5, 10, 15];
/** a break offered and not taken lets itself go after this long; so does the next block offered after a break */
const OFFER_FOR_MS = 15 * 60_000;
const NEXT_FOR_MS = 30 * 60_000;
/** a block or a break that ran out longer ago than this ended while the phone was away, where the notification spoke */
const FRESH_MS = 2500;

/** The block a break leads back to: the one just done, its subject and the length it was set up with. */
interface NextBlock { subject: string; min: number }

/**
 * The time between two countdown blocks. `offer`: a block has just run out and a break is offered; `break`: one runs
 * until `endAt`; `over`: it has ended, or was skipped, and the next block is offered. `at` is when the stage began, so
 * an offer nobody takes goes quietly.
 */
interface Between { stage: 'offer' | 'break' | 'over'; at: number; endAt: number; min: number; next: NextBlock }

// The time between blocks lives outside the screen: a break goes on while another tab is in front or a full-page Deep
// Work is closed, and its end is still heard. It is not saved: a phone restarted mid-break has the notification.
let between: Between | null = null;
const betweenListeners = new Set<() => void>();
const subscribeBetween = (cb: () => void) => { betweenListeners.add(cb); return () => { betweenListeners.delete(cb); }; };
const readBetween = () => between;
let breakTimer: ReturnType<typeof setTimeout> | null = null;
/** whether Deep Work is in front and seen, told by the screen while it is mounted */
let deepWorkSeen: () => boolean = () => false;

function setBetween(next: Between | null) {
  between = next;
  betweenListeners.forEach((l) => l());
}

/** A countdown block has run out at `at`: a break is offered, leading back to `next`. */
function offerBreak(at: number, next: NextBlock) {
  clearBetween();
  setBetween({ stage: 'offer', at, endAt: 0, min: 0, next });
}

/** A break of `min` minutes starts now: a calm countdown, never logged as focus, with its own heads-up for a phone away. */
function startBreak(min: number) {
  const b = between;
  if (!b) return;
  const endAt = Date.now() + min * 60_000;
  setBetween({ stage: 'break', at: Date.now(), endAt, min, next: b.next });
  void scheduleBreakEnd(endAt, min);
  if (breakTimer) clearTimeout(breakTimer);
  breakTimer = setTimeout(() => {
    breakTimer = null;
    const now = between;
    if (!now || now.stage !== 'break' || now.endAt !== endAt) return;
    setBetween({ ...now, stage: 'over', at: Date.now() });
    // heard only as it ends with the app open; a phone that was away was told by the notification, with its own buzz
    if (AppState.currentState !== 'active' || Date.now() - endAt > FRESH_MS) return;
    playSessionEnd();
    if (!deepWorkSeen()) toastWhenSeen('Break over', { label: 'Open', onPress: () => openTool('focus') }, () => !deepWorkSeen());
  }, Math.max(0, endAt - Date.now()));
}

/** Ends a running break early: the next block is offered at once. */
function skipBreak() {
  const b = between;
  if (!b || b.stage !== 'break') return;
  if (breakTimer) { clearTimeout(breakTimer); breakTimer = null; }
  cancelBreakEnd();
  setBetween({ ...b, stage: 'over', at: Date.now() });
}

/** Lets the time between blocks go: a new session starts, or the student is done with breaks for now. */
function clearBetween() {
  if (breakTimer) { clearTimeout(breakTimer); breakTimer = null; }
  if (between?.stage === 'break') cancelBreakEnd();
  if (between) setBetween(null);
}

/** The time between blocks as it stands at `t`: a break run out reads as over, and an offer gone stale as nothing. */
function betweenAt(b: Between | null, t: number): Between | null {
  if (!b) return null;
  if (b.stage === 'break') return t < b.endAt ? b : t - b.endAt < NEXT_FOR_MS ? { ...b, stage: 'over', at: b.endAt } : null;
  return t - b.at < (b.stage === 'offer' ? OFFER_FOR_MS : NEXT_FOR_MS) ? b : null;
}

// A full-page Deep Work closed while its block runs leaves the session in the store, and no screen to hear its end.
// The block's end is still felt (and heard, with the chime on) if the app is open elsewhere then: the notification
// keeps quiet while the app is in front. The screen wraps the session up when it is next opened. The same holds for a
// block resumed from the store after the app was closed, before Deep Work is opened at all: Today starts the watch.
let screensOpen = 0;
let awayEndTimer: ReturnType<typeof setTimeout> | null = null;

/** Watches the end of the block in the store, while no Deep Work screen is open to do it. */
export function watchAwayEnd() {
  if (awayEndTimer) { clearTimeout(awayEndTimer); awayEndTimer = null; }
  const dw = useStore.getState().deepWork;
  if (screensOpen > 0 || !dw || dw.mode !== 'countdown' || !dw.running || !dw.startTs) return;
  const endAt = dw.startTs + (dw.targetMin * 60 - dw.accumSec) * 1000;
  awayEndTimer = setTimeout(() => {
    awayEndTimer = null;
    const now = useStore.getState().deepWork;
    // the same block, still running, with no screen open since
    if (screensOpen > 0 || !now || now.startedAt !== dw.startedAt || now.startTs !== dw.startTs || !now.running) return;
    if (AppState.currentState !== 'active' || Date.now() - endAt > FRESH_MS) return;
    playSessionEnd();
    const name = (now.subject || '').trim();
    toastWhenSeen(name ? name + ' block done' : 'Block done', { label: 'Open', onPress: () => openTool('focus') }, () => screensOpen === 0);
  }, Math.max(0, endAt - Date.now()));
}

export function FocusScreen({ mode }: { mode: 'tab' | 'stack' }) {
  const insets = useSafeAreaInsets();
  const fk = useFocusKey();
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ subject?: string; minutes?: string }>();

  const dailyTasks = useStore((s) => s.dailyTasks);
  const missions = useStore((s) => s.missions);
  const toggleDaily = useStore((s) => s.toggleDaily);
  const toggleMission = useStore((s) => s.toggleMission);
  const logSession = useStore((s) => s.logSession);
  const addDaily = useStore((s) => s.addDaily);
  const sessions = useStore((s) => s.sessions);
  const planner = useStore((s) => s.planner);
  const hour24 = useStore((s) => s.settings.hour24);
  const setDeepWork = useStore((s) => s.setDeepWork);
  const patchDeepWork = useStore((s) => s.patchDeepWork);
  // a session in flight survives a process kill: the store keeps a copy and this screen resumes from it
  const saved = useRef(useStore.getState().deepWork).current;
  // with none in flight, the screen opens on the mode and the length the last session started with
  const last = useRef(useStore.getState().settings).current;
  // whether this screen is still open: an Undo pressed after a full page has closed goes through the store instead
  const mountedRef = useRef(false);

  const [timerMode, setTimerMode] = useState<'stopwatch' | 'countdown'>(saved?.mode ?? last.focusLastMode);
  const [targetMin, setTargetMin] = useState(saved?.targetMin ?? last.focusLastMin);
  // the length chosen at Start, which the wheel goes back to when the session ends: five more minutes, or a block that
  // ran until a clock time, belongs to that session alone
  const chosenRef = useRef(saved?.targetMin ?? last.focusLastMin);
  // a countdown set to run until a clock time: the time (minutes of the day), the length it gave, and the length the
  // wheel had before. Start works the length out again from the time, so a block started a while later still ends then
  const untilRef = useRef<{ at: number; min: number; prev: number } | null>(null);
  const [customMin, setCustomMin] = useState('');
  const [customSheet, setCustomSheet] = useState(false);
  const untilNext = useRef(false);
  const [running, setRunning] = useState(saved?.running ?? false);
  const [startTs, setStartTs] = useState<number | null>(saved?.startTs ?? null);
  const [accumSec, setAccumSec] = useState(saved?.accumSec ?? 0);
  const [subject, setSubject] = useState(saved?.subject ?? '');
  const [attached, setAttached] = useState<Attached[]>(saved?.attached ?? []);
  const [subjectSheet, setSubjectSheet] = useState(false);
  // a sideways tablet is known before it lays out, so its first frame already has its two columns
  const [areaW, setAreaW] = useState(() => columnWidth(Dimensions.get('window').width, mode === 'tab', WIDE_MAX));
  const startedAtRef = useRef<number | null>(saved?.startedAt ?? null);
  const [pickSheet, setPickSheet] = useState(false);
  const [customTask, setCustomTask] = useState('');
  const [ambient, setAmbient] = useState(false);
  // the review of a session that has ended: `byHand` offers Keep going; `finishAt` is a finish line still ahead, which
  // Keep going puts back
  const [review, setReview] = useState<{
    items: Attached[]; choices: Record<string, ReviewChoice>; byHand: boolean; finishAt: number | null;
  } | null>(null);
  // a review or a finish-line question that came up behind another tab waits for Deep Work to be in front
  const [held, setHeld] = useState(false);
  const endedRef = useRef(false);
  // the wrap-up the completion pulse schedules, kept so ending by hand first can call it off
  const wrapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  // the wheel's lengths; every custom length set while the screen is open joins them in order and stays, so moving off
  // one never shifts the lengths under the wheel
  const [extras, setExtras] = useState<number[]>([]);
  if (!LENGTHS.includes(targetMin) && !extras.includes(targetMin)) setExtras([...extras, targetMin]);
  const lengths = React.useMemo(
    () => (extras.length ? [...LENGTHS, ...extras].sort((a, b) => a - b) : LENGTHS),
    [extras],
  );
  // the wheel's props hold still between renders, so typing a subject never re-renders the wheel
  const targetRef = useRef(targetMin);
  targetRef.current = targetMin;
  const lengthsRef = useRef(lengths);
  lengthsRef.current = lengths;
  const wheelLabel = useCallback((i: number) => ({ full: String(lengths[i]) }), [lengths]);
  const wheelChange = useCallback((i: number) => setTargetMin(lengthsRef.current[i]), []);
  const openCustomLength = useCallback(() => { setCustomMin(String(targetRef.current)); setCustomSheet(true); }, []);

  // planner deep link: a subject (or a length) seeds only a session that has not started, and the params
  // are cleared after, so the same link works again and can never rewrite a session in progress (it says so instead)
  useFocusEffect(useCallback(() => {
    if (!params.subject && !params.minutes) return;
    if (!startedRef.current) {
      // a block asked for by name takes the place of a break or the next block on offer, so its setup is in view
      clearBetween();
      if (params.subject) setSubject(String(params.subject));
      const m = parseInt(String(params.minutes || ''), 10);
      if (m > 0) { setTimerMode('countdown'); clearFinishLine(); setTargetMin(Math.min(m, LONGEST_MIN)); }
    } else {
      toast('A session is already running');
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
  // the countdown's end notice names the subject, so a new subject lays it out again, from the live session
  const timerRef = useRef(timer);
  timerRef.current = timer;
  const renewEndNotice = () => {
    const t = timerRef.current;
    if (t.mode === 'countdown' && t.running && t.startTs) {
      void scheduleCountdownEnd(t.startTs + (t.targetMin * 60 - t.accumSec) * 1000, t.targetMin, subjectRef.current);
    }
  };
  // typing a subject writes once it settles, not on every keystroke
  useEffect(() => {
    if (!startedRef.current) return undefined;
    const t = setTimeout(() => { patchDeepWork({ subject }); renewEndNotice(); }, 500);
    return () => clearTimeout(t);
  }, [subject]);

  // countdown auto-finish: one timeout for the moment it runs out, which fires at once for a resumed
  // session that ran out while the app was closed. Live, the clock gives one soft pulse as the bar fills, then
  // the session wraps up; behind another tab nobody sees the pulse, so it wraps up at once.
  const level = useAnimLevel();
  const pulse = useSharedValue(1);
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));
  useEffect(() => {
    if (timerMode !== 'countdown' || !running || !startTs) return undefined;
    const endAt = startTs + (targetMin * 60 - accumSec) * 1000;
    const t = setTimeout(() => {
      if (endedRef.current) return;
      endedRef.current = true;
      // read as it fires: a block that ran out while the app was closed or asleep (the timer fires late on return)
      // ended where the notification spoke, so it is neither heard again nor pulsed
      const fresh = Date.now() - endAt < FRESH_MS;
      // the buzz, and the chime when it is on, wherever in the app the student is
      if (fresh && AppState.currentState === 'active') playSessionEnd();
      // the completion pulse is a scale: only full motion plays it, and a resumed session that ran out ends at once
      if (level !== 'full' || !fresh || !navigation.isFocused()) {
        endSessionRef.current();
        return;
      }
      pulse.value = withSequence(
        withTiming(1.06, { duration: 220, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: 380, easing: Easing.inOut(Easing.quad) }),
      );
      // not cleared with the effect: once the pulse has begun, the session must still wrap up
      if (wrapTimer.current) clearTimeout(wrapTimer.current);
      wrapTimer.current = setTimeout(() => { wrapTimer.current = null; endSessionRef.current(); }, 650);
    }, Math.max(0, endAt - Date.now()));
    return () => clearTimeout(t);
  }, [timerMode, running, startTs, accumSec, targetMin, level]);

  // a countdown that ends while the phone is away still says so. Rescheduled on every start, resume and +5 min,
  // cancelled on pause, end and reset, and never on unmount: a full-page Focus closes while its session goes on
  useEffect(() => {
    if (timerMode === 'countdown' && running && startTs) {
      const endAt = startTs + (targetMin * 60 - accumSec) * 1000;
      void scheduleCountdownEnd(endAt, targetMin, subjectRef.current);
    } else {
      cancelCountdownEnd();
    }
  }, [timerMode, running, startTs, accumSec, targetMin]);

  // five more minutes on a running block; inert once the block has run out and is wrapping up
  const addFive = () => {
    if (wrapTimer.current || endedRef.current) return;
    haptic();
    setTargetMin((m) => m + 5);
  };

  const start = () => {
    // the block has run out and is wrapping up: there is nothing left to resume
    if (wrapTimer.current) return;
    endedRef.current = false;
    if (startedAtRef.current == null) {
      startedAtRef.current = Date.now();
      // a new session: a break or a next block still on offer has had its turn
      clearBetween();
      // the length the session was set up with; a block until a clock time is measured again from now, as long as the
      // wheel still has the length that time gave
      const u = untilRef.current;
      untilRef.current = null;
      chosenRef.current = targetMin;
      if (timerMode === 'countdown' && u && u.min === targetMin) {
        chosenRef.current = u.prev;
        const m = minutesUntil(u.at);
        if (m <= LONGEST_MIN && m !== targetMin) setTargetMin(m);
      }
      // the next visit opens on this mode and length: written once here, never as the wheel turns
      const { settings, setSetting } = useStore.getState();
      if (settings.focusLastMode !== timerMode) setSetting('focusLastMode', timerMode);
      const chosen = chosenRef.current;
      if (timerMode === 'countdown' && settings.focusLastMin !== chosen && Number.isInteger(chosen) && chosen >= 1 && chosen <= LONGEST_MIN) {
        setSetting('focusLastMin', chosen);
      }
    }
    setStartTs(Date.now());
    setRunning(true);
    // the finish line's heads-up is for a session under way, so it is set here rather than with the line
    if (finishAt != null && finishAt > Date.now()) void noticeFinish(finishAt);
  };
  const pause = () => {
    // the block has run out and is wrapping up: pausing now would only stall the wrap-up
    if (wrapTimer.current) return;
    // a phone clock set back never takes time away
    if (startTs) setAccumSec((a) => a + Math.max(0, (Date.now() - startTs) / 1000));
    setRunning(false); setStartTs(null);
  };

  // live refs so the finish-line timer never acts on stale closures
  const runningRef = useRef(running); runningRef.current = running;
  const startedLiveRef = useRef(started); startedLiveRef.current = started;
  const endSessionRef = useRef<() => void>(() => {});

  // the clock time set on the wheel for "until", and how far ahead it is (a time just gone is tomorrow's)
  const untilParsed = parseTime(untilTime);
  const untilAt = untilParsed >= 0 && untilParsed < 1440 ? untilParsed : null;
  const untilPreviewMin = untilAt == null ? null : minutesUntil(untilAt);

  const openUntil = () => { setUntilTime(defaultTime()); setUntilSheet(true); };
  const setUntil = () => {
    if (untilAt == null) return;
    const m = minutesUntil(untilAt);
    if (m > LONGEST_MIN) { Alert.alert('Too far ahead', 'A block runs up to 10 hours. Pick a time within the next 10 hours.'); return; }
    const u = untilRef.current;
    untilRef.current = { at: untilAt, min: m, prev: u && u.min === targetMin ? u.prev : targetMin };
    setTargetMin(m); setCustomMin(''); setUntilSheet(false);
  };

  const clearFinishLine = () => {
    if (autoConcludeTimer.current) { clearTimeout(autoConcludeTimer.current); autoConcludeTimer.current = null; }
    // cancelled by its fixed id, so a finish line set before the app was killed still clears
    Notifications.cancelScheduledNotificationAsync(FINISH_NOTIF_ID).catch(() => {});
    finishNotifId.current = null;
    finishHandled.current = false;
    setFinishPrompt(false);
    setFinishAt(null);
  };

  const finishAtRef = useRef(finishAt);
  finishAtRef.current = finishAt;
  /** The finish line's heads-up for when the app is away; the in-app flow below is primary. */
  const noticeFinish = async (at: number) => {
    try {
      // a line cleared or moved while permission was asked is not announced
      if (!(await ensurePermission()) || finishAtRef.current !== at) return;
      finishNotifId.current = await Notifications.scheduleNotificationAsync({
        identifier: FINISH_NOTIF_ID,
        content: {
          title: 'Finish line reached', body: 'Your Deep Work finish line has passed. Open Sturoids to wrap up.',
          // a tap opens Deep Work, wherever it lives
          data: { tool: 'focus' },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(at), channelId: NOTIF_CHANNEL_ID } as any,
      });
    } catch {}
  };

  // the sheet opens on the line already set, or on the next whole hour
  const openFinishSheet = () => {
    if (finishAt != null) {
      const d = new Date(finishAt);
      setFinishTime(hhmm(d.getHours() * 60 + d.getMinutes()));
      setFinishDay(todayKey(d) === todayKey() ? 'today' : 'tomorrow');
    } else {
      setFinishTime(defaultTime());
      setFinishDay('today');
    }
    setFinishSheet(true);
  };

  const setFinishLine = () => {
    const t = parseTime(finishTime);
    if (t < 0 || t >= 1440) return;
    const d = new Date();
    d.setHours(Math.floor(t / 60), t % 60, 0, 0);
    if (finishDay === 'tomorrow') d.setDate(d.getDate() + 1);
    const when = d.getTime();
    if (when <= Date.now()) { Alert.alert('Already passed', 'That time has already passed today. Pick Tomorrow or a later time.'); return; }
    clearFinishLine();
    setFinishAt(when);
    setFinishSheet(false);
    // a session that has not begun gets its heads-up at Start
    if (startedRef.current) void noticeFinish(when);
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
        // running: ask, auto-conclude after 10 minutes of silence. Behind another tab the question waits for Deep Work
        // to be in front, with a toast meanwhile; the 10 minutes run all the same
        setFinishPrompt(true);
        if (!navigation.isFocused()) {
          setHeld(true);
          toastWhenSeen('Finish line reached', { label: 'Open', onPress: () => openTool('focus') }, () => !navigation.isFocused());
        }
        autoConcludeTimer.current = setTimeout(() => {
          if (runningRef.current) {
            setFinishPrompt(false);
            endSessionRef.current();
          }
        }, 10 * 60 * 1000);
      } else if (startedLiveRef.current) {
        // paused at the finish line: conclude at once. A phone that is away is told, in place of the heads-up; in the
        // app the session ending is plain to see
        endSessionRef.current();
        if (AppState.currentState !== 'active') {
          Notifications.scheduleNotificationAsync({
            identifier: FINISH_NOTIF_ID,
            content: {
              title: 'Session wrapped up', body: 'The stopwatch was paused at your finish line, so the session ended on its own.',
              data: { tool: 'focus' },
            },
            trigger: { channelId: NOTIF_CHANNEL_ID },
          }).catch(() => {});
        }
      } else {
        // never started — nothing to conclude
        clearFinishLine();
      }
    };
    // one timer for the moment itself, and a look whenever the app comes back, in case the phone slept through it
    const t = setTimeout(check, Math.max(0, finishAt - Date.now()) + 50);
    const sub = AppState.addEventListener('change', (next) => { if (next === 'active') check(); });
    check();
    return () => {
      clearTimeout(t);
      sub.remove();
    };
  }, [finishAt]);

  /** Ends the session: `byHand` when the student ended it (End, or End session at the finish line). */
  function endSession(byHand = false) {
    // one wrap-up per session: a countdown running out and a tap on End must never both build the review
    if (wrapTimer.current) { clearTimeout(wrapTimer.current); wrapTimer.current = null; }
    if (review) return;
    const reachedFinish = finishAt != null && Date.now() >= finishAt;
    clearFinishLine();
    let net = Math.max(0, accumSec + (running && startTs ? (Date.now() - startTs) / 1000 : 0));
    // never log more than the block, or running time after a finish line that passed while away (time paused in
    // between was never counted, so only the stretch past the line comes off)
    if (timerMode === 'countdown') net = Math.min(net, targetMin * 60);
    else if (reachedFinish && finishAt != null && running && startTs) {
      net = Math.max(0, net - Math.max(0, Date.now() - Math.max(finishAt, startTs)) / 1000);
    }
    if (timerMode === 'stopwatch') net = Math.min(net, STOPWATCH_CAP_SEC);
    // what Undo puts back after a session ended by hand: the session as it stood, paused or running
    const before: Resume = {
      mode: timerMode, targetMin, accumSec: net, subject, attached: live, startedAt: startedAtRef.current,
      finishAt: reachedFinish ? null : finishAt, chosen: chosenRef.current, running,
    };
    setRunning(false); setStartTs(null); setAccumSec(net); setAmbient(false);
    const unchecked = live.filter((a) => !a.done);
    if (net < 5 && attached.length === 0) { reset(); return; }
    // a block that ran out offers a break, then a block like it; one ended by hand was ended on purpose
    if (!byHand && timerMode === 'countdown') {
      const blockEnd = running && startTs ? startTs + (targetMin * 60 - accumSec) * 1000 : Date.now();
      offerBreak(Math.min(blockEnd, Date.now()), { subject: subject.trim(), min: chosenRef.current });
    }
    // a session that ends behind another tab (its block ran out, its finish line passed) says so in a toast, and its
    // review waits for Deep Work to be in front instead of opening over another tool
    if (!byHand && !navigation.isFocused()) {
      const name = subject.trim();
      const line = timerMode === 'countdown'
        ? (name ? name + ' block done' : 'Block done')
        : (name ? name + ' session wrapped up' : 'Session wrapped up');
      toastWhenSeen(line, { label: 'Open', onPress: () => openTool('focus') }, () => !navigation.isFocused());
      if (unchecked.length > 0) setHeld(true);
    }
    if (unchecked.length === 0) {
      const id = commit(net, {});
      // a session ended by hand with nothing to review is saved at once: a tap on End by mistake can be taken back
      if (byHand && id) toast('Session saved', { label: 'Undo', onPress: () => resumeRef.current(id, before) });
      return;
    }
    const choices: Record<string, ReviewChoice> = {};
    unchecked.forEach((u) => (choices[u.key] = 'pending'));
    setReview({ items: unchecked, choices, byHand, finishAt: reachedFinish ? null : finishAt });
  }

  /** Saves the session ended and applies its review; returns the logged session's id, or null when too short to keep. */
  function commit(netSeconds: number, choices: Record<string, ReviewChoice>): string | null {
    let added = 0;
    for (const a of live) {
      if (choices[a.key] === 'done' && !a.done) completeInStore(a);
      // a task made on the spot and still pending is kept: it goes on as a one-off ToDo
      else if (choices[a.key] === 'pending' && a.kind === 'custom' && !a.done) {
        addDaily(a.title);
        added++;
      }
    }
    // said once the review has gone, where the toast can be seen
    if (added) afterReview.current = () => toast(added === 1 ? 'Task added to ToDos' : added + ' tasks added to ToDos');
    let id: string | null = null;
    if (netSeconds >= 5) {
      id = logSession({
        // the day the session began, so a session across midnight counts where it started
        dateKey: todayKey(new Date(startedAtRef.current ?? Date.now())), endedAt: Date.now(),
        netSeconds: Math.round(netSeconds),
        taskTitles: attached.map((a) => a.title),
        subject: subject.trim() || undefined,
      });
    }
    reset();
    return id;
  }

  /**
   * Undo for a session ended by hand: it comes out of the history and carries on from where it stopped, running or
   * paused as it was. Time between the end and the Undo is not counted. A session started since keeps the plate.
   */
  function resume(id: string, r: Resume) {
    if (!mountedRef.current) {
      // the full page has closed since: the session goes back into the store and Deep Work opens on it, unless another
      // has begun there
      const st0 = useStore.getState();
      if (st0.deepWork || !st0.removeSession(id)) return;
      clearBetween();
      st0.setDeepWork({
        mode: r.mode, targetMin: r.targetMin, running: r.running, startTs: r.running ? Date.now() : null,
        accumSec: r.accumSec, startedAt: r.startedAt ?? Date.now(), subject: r.subject, attached: r.attached,
        finishAt: r.finishAt != null && r.finishAt > Date.now() ? r.finishAt : null,
      });
      openTool('focus');
      return;
    }
    if (startedRef.current) return;
    useStore.getState().removeSession(id);
    clearBetween();
    setTimerMode(r.mode); setTargetMin(r.targetMin); setAccumSec(r.accumSec); setSubject(r.subject); setAttached(r.attached);
    startedAtRef.current = r.startedAt; chosenRef.current = r.chosen; endedRef.current = false;
    if (r.finishAt != null && r.finishAt > Date.now()) setFinishAt(r.finishAt);
    // a running session starts again once these are in place (start reads them)
    if (r.running) startOnRender.current = true;
  }
  const resumeRef = useRef(resume);
  resumeRef.current = resume;
  // a start asked for along with new settings (Undo, the next block) runs once they have rendered
  const startOnRender = useRef(false);
  useEffect(() => {
    if (!startOnRender.current) return;
    startOnRender.current = false;
    start();
  });
  const afterReview = useRef<(() => void) | null>(null);

  function reset() {
    setReview(null); setHeld(false); setAttached([]); setAccumSec(0); setRunning(false); setStartTs(null);
    setSubject(''); endedRef.current = false; startedAtRef.current = null;
    // the wheel goes back to the length the session was set up with
    setTargetMin(chosenRef.current);
  }

  // The review's way back: the session carries on from where it stopped, with its finish line if that was still ahead.
  const keepGoing = () => {
    const r = review;
    if (!r) return;
    setReview(null);
    const line = r.finishAt != null && r.finishAt > Date.now() ? r.finishAt : null;
    if (line != null) { setFinishAt(line); void noticeFinish(line); }
    start();
  };

  // Erasing the phone, importing a backup or restoring from the cloud ends the session in the store. The screen stands
  // down with it, so no timer of the old session logs it into the new data or writes it back. The screen's own clear
  // runs only once its session has ended, so it never comes this way.
  function standDown() {
    if (wrapTimer.current) { clearTimeout(wrapTimer.current); wrapTimer.current = null; }
    if (autoConcludeTimer.current) { clearTimeout(autoConcludeTimer.current); autoConcludeTimer.current = null; }
    clearFinishLine();
    cancelCountdownEnd();
    clearBetween();
    setAmbient(false); setFinishPrompt(false); setSubjectSheet(false);
    reset();
  }
  const standDownRef = useRef<() => void>(() => {});
  useEffect(() => useStore.subscribe((s, prev) => {
    if (prev.deepWork && !s.deepWork && startedRef.current) standDownRef.current();
  }), []);
  useEffect(() => { endSessionRef.current = endSession; standDownRef.current = standDown; });
  // a review or a question held back behind another tab opens once Deep Work is in front
  useFocusEffect(useCallback(() => { setHeld(false); }, []));

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

  /** Opens a task's store copy again, for a tick taken back here. */
  const reopenInStore = (a: Attached) => {
    const st0 = useStore.getState();
    if (a.kind === 'daily' && a.refId) {
      const t = st0.dailyTasks.find((x) => x.id === a.refId);
      if (t && t.doneOn === todayKey()) toggleDaily(a.refId);
    } else if (a.kind === 'mission' && a.refId) {
      const m = st0.missions.find((x) => x.id === a.refId);
      if (m && m.done) toggleMission(a.refId);
    }
  };

  // a tick here is the task's own tick, both ways: the list shows the store's copy (see `live`)
  const markAttached = (key: string) => {
    const a = live.find((x) => x.key === key);
    if (!a) return;
    if (!a.done) completeInStore(a);
    else reopenInStore(a);
    setAttached((list) => list.map((x) => (x.key === key ? { ...x, done: !a.done } : x)));
  };

  const attach = (kind: Attached['kind'], title: string, refId?: string) => {
    setAttached((l) => [...l, { key: uid(), kind, title, refId, done: false }]);
  };

  // today turns over at midnight, so the focused time in the header does too
  const today = useToday();
  // A ToDo or a long-term task ticked in Tasks mid-session is ticked here too: its store copy says whether it is done,
  // on the plate, on the ambient screen and in the review. The session's own mark counts only for a task made on the
  // spot, or one deleted since.
  const live = attached.map((a) => {
    let done = a.done;
    if (a.kind === 'daily' && a.refId) {
      const t = dailyTasks.find((x) => x.id === a.refId);
      if (t) done = t.doneOn === today;
    } else if (a.kind === 'mission' && a.refId) {
      const m = missions.find((x) => x.id === a.refId);
      if (m) done = m.done;
    }
    return done === a.done ? a : { ...a, done };
  });
  const pickableDaily = dailyTasks.filter((t) => t.doneOn !== today && !attached.some((a) => a.refId === t.id));
  const pickableMissions = missions.filter((m) => !m.done && !attached.some((a) => a.refId === m.id));
  const currentTask = live.find((a) => !a.done);

  // today's planned blocks, the one on now and the next; the minute turns them over (useNow, only while in front)
  const now = useNow();
  const blocks = React.useMemo(() => {
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const todays = [...(planner[dayName(now)] || [])].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
    // of two blocks on now (allowed, on purpose), the one that ends first, as the Planner's header says
    let onNow: (typeof todays)[number] | undefined;
    for (const b of todays) {
      if (toMinutes(b.start) <= nowMin && nowMin < toMinutes(b.end) && (!onNow || toMinutes(b.end) < toMinutes(onNow.end))) onNow = b;
    }
    return { todays, onNow, next: todays.find((b) => toMinutes(b.start) > nowMin) };
  }, [planner, now]);
  // subjects to tap instead of typing: today's planned ones first, then those of recent sessions; four at most
  const subjectPicks = React.useMemo(() => {
    const out: string[] = [];
    const add = (name?: string) => {
      const t = (name || '').trim();
      if (t && out.length < 4 && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
    };
    blocks.todays.forEach((b) => add(b.subject));
    for (let i = sessions.length - 1; i >= 0 && out.length < 4; i--) add(sessions[i].subject);
    return out;
  }, [blocks.todays, sessions]);

  const todayFocusMin = React.useMemo(
    () => Math.round(sessions.filter((s) => s.dateKey === today).reduce((a, s) => a + s.netSeconds, 0) / 60),
    [sessions, today],
  );
  const recent = React.useMemo(() => [...sessions].reverse().slice(0, 6), [sessions]);
  // what the screen was built with is simply there; a mode switch or a task added later eases in
  const built = useBuilt();
  const modeIn = built.current && level !== 'none' ? FadeIn.duration(level === 'full' ? 260 : 180).easing(EASE_OUT) : undefined;

  const idle = !started;
  // the time between blocks (a break offered, running or over) takes the setup's place while it lasts; read against the
  // clock, which the minute turns over, so an offer left alone goes by itself
  const betweenNow = React.useSyncExternalStore(subscribeBetween, readBetween);
  const gap = idle ? betweenAt(betweenNow, Date.now()) : null;
  // the screen's own entrance brings the first stage in; after that, a start or an end rises the new one in place
  const stageNow = idle ? (gap ? 'between' : 'idle') : 'running';
  const lastStage = useRef(stageNow);
  const switched = useRef(false);
  if (lastStage.current !== stageNow) {
    lastStage.current = stageNow;
    switched.current = true;
  }
  const switchIn = switched.current ? swapIn(level) : undefined;
  // the first task attached takes the place of the empty note, and the last one taken off gives it back
  const tasksIn = useSwapIn(attached.length === 0 ? 'none' : 'list');
  const shownSubject = subject.trim();
  const current = attached.length === 0
    ? undefined
    : currentTask ? { title: currentTask.title, color: currentTask.kind === 'mission' ? C.amber : C.green } : null;
  const twoCol = areaW >= TWO_COL_AT;

  // The header's line, with no ticking seconds in it and nothing the plate already shows (its subject, when it ends).
  // While a session runs: its subject, then the next block planned today, or else the focus already logged today, or
  // else when it ends (or since when it runs). Paused: what is left, or done so far, which holds still while paused.
  // Idle: a block planned for now, then today's focused time. Only a running session is live: not paused, not set up.
  // A session being reviewed has ended, so it is neither running nor paused and the line says nothing. A fact whose
  // value is zero is left out.
  const clockAt = (ms: number) => fmtClockTime(new Date(ms).getHours() * 60 + new Date(ms).getMinutes(), hour24);
  const lead = shownSubject ? { em: shownSubject } : timerMode === 'stopwatch' ? 'Stopwatch' : 'Countdown';
  const endsAt = timerMode === 'countdown' && startTs ? startTs + (targetMin * 60 - accumSec) * 1000 : finishAt;
  const after = blocks.next
    ? (blocks.next.subject.trim() || 'Next block') + ' at ' + fmtClockTime(toMinutes(blocks.next.start), hour24)
    : todayFocusMin > 0 ? fmtMins(todayFocusMin) + ' earlier today' : null;
  // rounded as the clock rounds: up for what is left, down for what is done
  const pausedMin = timerMode === 'countdown' ? Math.ceil(displayOf(timer) / 60) : Math.floor(elapsedOf(timer) / 60);
  const planned = blocks.onNow && blocks.onNow.subject.trim()
    // a block that runs to the end of the day ends at midnight, as the Planner and Today say
    ? [{ em: blocks.onNow.subject.trim() }, ' planned until '
      + (toMinutes(blocks.onNow.end) >= 1440 ? 'midnight' : fmtClockTime(toMinutes(blocks.onNow.end), hour24))]
    : null;
  const focusContext = review ? null : !started
    ? gap?.stage === 'break'
      ? contextLine('Break until ' + clockAt(gap.endAt))
      : contextLine(planned, todayFocusMin > 0 && focusedToday(todayFocusMin))
    : !running
      ? contextLine([lead, ' paused'], pausedMin > 0 && fmtMins(pausedMin) + (timerMode === 'countdown' ? ' left' : ' so far'))
      : after
        ? contextLine(lead, after)
        : contextLine([
          lead,
          endsAt ? ' until ' + clockAt(endsAt) : startedAtRef.current ? ' since ' + clockAt(startedAtRef.current) : '',
        ]);
  const header = useToolHeader({
    title: 'Deep Work',
    mode: mode === 'tab' ? 'tab' : 'page',
    context: focusContext,
    live: started && running,
    // the ambient screen covers this one: the dot rests until it is gone
    covered: ambient,
  });

  // The subject field tapped half under the tab-mode bar: Android brings a focused field into view only when it is
  // outside the scroll, and the bar lies over the scroll's top, so it would stay there. It is moved to just below the bar.
  const scrollRef = useRef<Animated.ScrollView>(null);
  const subjectBox = useRef<View>(null);
  const revealSubject = () => {
    const box = subjectBox.current;
    if (mode !== 'tab' || !box) return;
    const y0 = header.scrollY.value;
    box.measureInWindow((_x, y) => {
      const clear = header.barH + 12;
      if (y < clear) scrollRef.current?.scrollTo({ y: Math.max(0, y0 - (clear - y)), animated: level !== 'none' });
    });
  };

  // subjects to tap, under the idle field and in the subject sheet: flat chips, as small choices are
  const subjectChips = subjectPicks.length > 0 ? (
    <Row style={st.picks}>
      {subjectPicks.map((name) => (
        <Chip
          key={name} small label={name}
          active={name.toLowerCase() === shownSubject.toLowerCase()}
          onPress={() => setSubject(name)}
        />
      ))}
    </Row>
  ) : null;

  // a plate nobody can see (under the ambient screen, behind another tab, the app away) does not tick
  const focused = useIsFocused();
  const appActive = useAppActive();

  // the end of a break is told in a toast only when Deep Work is not in front to show it
  useEffect(() => {
    const seen = () => navigation.isFocused() && AppState.currentState === 'active';
    deepWorkSeen = seen;
    return () => { if (deepWorkSeen === seen) deepWorkSeen = () => false; };
  }, []);
  // while this screen is open it hears the block's end itself; once closed, the store's copy is watched (watchAwayEnd)
  useEffect(() => {
    screensOpen++;
    mountedRef.current = true;
    if (awayEndTimer) { clearTimeout(awayEndTimer); awayEndTimer = null; }
    return () => {
      screensOpen--;
      mountedRef.current = false;
      watchAwayEnd();
    };
  }, []);

  // The next block: the subject and the length of the one before the break, started at once.
  const startNext = () => {
    const b = betweenAt(between, Date.now());
    if (!b || startedRef.current) return;
    clearBetween();
    clearFinishLine();
    untilRef.current = null;
    setTimerMode('countdown');
    setSubject(b.next.subject);
    setTargetMin(Math.min(Math.max(1, b.next.min), LONGEST_MIN));
    startOnRender.current = true;
  };
  const nextName = gap ? gap.next.subject : '';
  // "Physics · 50 min", under "Start the next block"
  const nextDetail = gap ? [nextName, fmtMins(gap.next.min)].filter(Boolean).join(' · ') : '';

  const stageBlock = (
    <Enter index={0}>
      {idle && gap ? (
        <Animated.View key="between" entering={switchIn}>
          <BreakStage
            stage={gap.stage}
            subject={nextName}
            endAt={gap.endAt}
            min={gap.min}
            lengths={BREAK_LENGTHS}
            nextDetail={nextDetail}
            hour24={hour24}
            onBreak={startBreak}
            onSkip={skipBreak}
            onNext={startNext}
            onDismiss={clearBetween}
            hold={!focused || !appActive}
          />
        </Animated.View>
      ) : idle ? (
        <Animated.View key="idle" entering={switchIn}>
          {/* timer mode */}
          <SegmentedControl
            size="sm"
            options={[
              { key: 'countdown', label: 'Countdown' },
              { key: 'stopwatch', label: 'Stopwatch' },
            ]}
            value={timerMode}
            onChange={(k) => { setTimerMode(k); if (k === 'countdown') clearFinishLine(); }}
            style={{ marginBottom: 24 }}
          />
          <GlassCard hero style={{ alignItems: 'center', paddingVertical: 34 }}>
            {timerMode === 'countdown' ? (
              // the length: drag it or tap a length beside it; tap the number for an exact length or a clock time
              <Animated.View entering={modeIn} style={st.wheelBox}>
                <Wheel
                  count={lengths.length}
                  index={Math.max(0, lengths.indexOf(targetMin))}
                  onChange={wheelChange}
                  label={wheelLabel}
                  spacing={92}
                  minScale={0.42}
                  colorOn={C.text}
                  colorOff={C.textFaint}
                  height={72}
                  textStyle={st.wheelText}
                  accessibilityLabel="Countdown length in minutes"
                  onPressCenter={openCustomLength}
                />
              </Animated.View>
            ) : (
              <Animated.View entering={modeIn} style={st.clockSlot}>
                <ClockDigits text="0:00" size={48} lineHeight={CLOCK_SLOT_H} roll={false} />
              </Animated.View>
            )}
            {/* the line under the time changes with the mode: it dips over with it */}
            <FadeSwap swapKey={timerMode}>
              <Text style={{ color: C.textDim, fontFamily: F.reg, fontSize: 13, letterSpacing: TRACK.small, marginTop: 4 }}>
                {timerMode === 'countdown' ? 'minutes, or tap the number to type one' : 'stopwatch'}
                {shownSubject ? ` · ${shownSubject}` : ''}
              </Text>
            </FadeSwap>
            {timerMode === 'stopwatch' && (
              <Animated.View entering={modeIn} style={{ marginTop: 10 }}>
                <Chip
                  small
                  label={finishAt ? `Finish ${fmtClockTime(new Date(finishAt).getHours() * 60 + new Date(finishAt).getMinutes(), hour24)}` : 'Finish line'}
                  active={!!finishAt}
                  color={C.accent}
                  onPress={openFinishSheet}
                />
              </Animated.View>
            )}
            {timerMode === 'countdown' && (
              <Animated.View entering={modeIn} style={{ alignSelf: 'stretch', marginTop: 12 }}>
                <ProgressBar value={0} />
              </Animated.View>
            )}
            <Row style={{ marginTop: 20, gap: 10 }}>
              <PillButton label="Start" icon="play" onPress={start} />
            </Row>
          </GlassCard>
          <View ref={subjectBox} collapsable={false}>
            <Field
              value={subject} onChangeText={setSubject} placeholder="Subject, like Physics (optional)"
              maxLength={60} returnKeyType="done" onFocus={revealSubject}
            />
          </View>
          {subjectChips}
        </Animated.View>
      ) : (
        <Animated.View key="running" entering={switchIn}>
          <SessionStage
            timer={timer}
            subject={shownSubject}
            startedAt={startedAtRef.current}
            finishAt={finishAt}
            hour24={hour24}
            current={current}
            onSubject={() => setSubjectSheet(true)}
            onToggle={running ? pause : start}
            onEnd={() => endSession(true)}
            onAmbient={() => setAmbient(true)}
            onAddFive={addFive}
            onFinishLine={openFinishSheet}
            onTickCurrent={() => { if (currentTask) markAttached(currentTask.key); }}
            clockStyle={pulseStyle}
            hold={ambient || !focused || !appActive}
          />
        </Animated.View>
      )}
    </Enter>
  );

  const tasksBlock = (
    <>
      {/* attached tasks: the title rises with its card, so neither waits for the other */}
      <Enter index={2}>
        <SectionTitle
          right={(
            <Bouncy
              onPress={() => setPickSheet(true)} scaleTo={0.92} radius={8} hitSlop={8} style={st.attachKey}
              accessibilityRole="button" accessibilityLabel="Attach tasks"
            >
              <Text style={{ color: C.accent, fontFamily: F.semi, fontSize: 13, letterSpacing: TRACK.small }}>+ Attach</Text>
            </Bouncy>
          )}
        >
          Session tasks
        </SectionTitle>
        <Animated.View key={attached.length === 0 ? 'none' : 'list'} entering={tasksIn}>
          {attached.length === 0 ? (
            <GlassCard pad={12}>
              <EmptyState compact icon="link-outline" title="No tasks attached" body="Attach tasks before or during the session, then check them off as you go." />
            </GlassCard>
          ) : (
            // one card for the list: a task attached or taken off folds in or out, and the card follows its rows
            <ListCard>
              {live.map((a) => (
                <ListRow key={a.key} style={st.taskRow}>
                  <CheckCircle done={a.done} color={a.kind === 'mission' ? C.amber : C.green} onPress={() => markAttached(a.key)} label={a.title} />
                  <StrikeText done={a.done} style={st.taskText} wrapStyle={st.taskWrap} numberOfLines={1}>{a.title}</StrikeText>
                  <IconBtn name="close" size={16} onPress={() => setAttached((l) => l.filter((x) => x.key !== a.key))} accessibilityLabel={'Take ' + a.title + ' off this session'} />
                </ListRow>
              ))}
            </ListCard>
          )}
        </Animated.View>
      </Enter>

      {/* recent sessions: history belongs to the time between sessions; it rises in when a session ends, as it does with the screen */}
      {idle && (
        <Enter index={3}>
          <SectionTitle
            right={sessions.length > 0 ? (
              // every session, by day, with the week's minutes per subject
              <Bouncy
                onPress={() => openPage('/focus-history')} scaleTo={0.92} radius={8} hitSlop={8} style={st.attachKey}
                accessibilityRole="button" accessibilityLabel="See all sessions"
              >
                <Text style={{ color: C.accent, fontFamily: F.semi, fontSize: 13, letterSpacing: TRACK.small }}>See all</Text>
              </Bouncy>
            ) : undefined}
          >
            Recent sessions
          </SectionTitle>
          {sessions.length === 0 ? (
            <EmptyState compact icon="time-outline" title="No sessions yet" body="Finished sessions land here." />
          ) : (
            <ListCard>
              {recent.map((s) => (
                <ListRow key={s.id} style={{ paddingVertical: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: C.text, fontFamily: F.semi, fontSize: 14, letterSpacing: TRACK.small }} numberOfLines={1}>
                      {sessionLength(s.netSeconds)}{s.subject ? ` · ${s.subject}` : ''}
                    </Text>
                    <Text style={{ color: C.textFaint, fontFamily: F.reg, fontSize: 12, letterSpacing: TRACK.fine, marginTop: 2 }} numberOfLines={1}>
                      {sessionDay(s.dateKey)}{s.taskTitles.length ? ` · ${s.taskTitles.join(', ')}` : ''}
                    </Text>
                  </View>
                </ListRow>
              ))}
            </ListCard>
          )}
        </Enter>
      )}
    </>
  );

  const reviewMin = Math.round(accumSec / 60);

  // the subject sheet closes onto the store at once, not half a second later
  const closeSubject = () => {
    setSubjectSheet(false);
    if (startedRef.current) { patchDeepWork({ subject: subjectRef.current }); renewEndNotice(); }
  };

  return (
    <ScreenBG guard={mode === 'tab'} maxWidth={WIDE_MAX}>
      {/* above the scroll, so the bar's shade falls over the cards rather than behind them */}
      <View style={[frame(twoCol ? WIDE_MAX : READ_MAX), st.barLayer]}>{header.bar}</View>
      <Animated.ScrollView
        key={fk}
        ref={scrollRef}
        {...header.scrollProps}
        // a tap on Start (or the wheel, or the mode) while the keyboard is up acts at once, instead of only closing it
        keyboardShouldPersistTaps="handled"
        onLayout={(e) => setAreaW(e.nativeEvent.layout.width)}
        contentContainerStyle={{ padding: S.pad, paddingTop: header.padTop, paddingBottom: 40 + (mode === 'tab' ? 0 : insets.bottom) }}
      >
        <View style={frame(twoCol ? WIDE_MAX : READ_MAX)}>
          {/* the hero rises with the session: both are the screen's first entrance */}
          <Enter index={0}>{header.hero}</Enter>

          {/* a sideways tablet: the session on the left, its tasks and the history beside it. One tree either way, so
              turning the tablet only changes styles and never builds the stage again; a phone has no styles here */}
          <View style={twoCol ? st.cols : undefined}>
            <View style={twoCol ? st.col : undefined}>{stageBlock}</View>
            <View style={twoCol ? [st.col, st.colSide] : undefined}>{tasksBlock}</View>
          </View>
        </View>
      </Animated.ScrollView>

      {/* the subject, once a session is under way */}
      <Sheet visible={subjectSheet} onClose={closeSubject} title="Subject">
        <Field
          value={subject}
          onChangeText={setSubject}
          placeholder="Subject, like Physics"
          autoFocus
          maxLength={60}
          returnKeyType="done"
          onSubmitEditing={closeSubject}
        />
        {subjectChips}
        <PillButton label="Done" onPress={closeSubject} />
      </Sheet>

      {/* attach sheet */}
      <Sheet visible={pickSheet} onClose={() => setPickSheet(false)} title="Attach tasks">
        <Row>
          <Field
            value={customTask} onChangeText={setCustomTask} placeholder="On-the-spot task…"
            style={{ flex: 1 }}
            // the field keeps the keyboard, so several tasks go in one after another
            returnKeyType="done" submitBehavior="submit"
            onSubmitEditing={() => { if (customTask.trim()) { attach('custom', customTask.trim()); setCustomTask(''); } }}
          />
          <IconBtn
            name="add-circle" color={C.accent} size={30} style={{ marginLeft: 8, marginTop: 2 }}
            onPress={() => { if (customTask.trim()) { attach('custom', customTask.trim()); setCustomTask(''); } }}
            accessibilityLabel="Attach this task"
          />
        </Row>
        {pickableDaily.length > 0 && <Text style={st.sheetSection}>Daily</Text>}
        {pickableDaily.map((t) => (
          // a row picked folds out of the list as it joins the session; the rows under it glide up
          <Animated.View key={t.id} exiting={rowOut(level)} layout={glide(level)}>
            <Bouncy onPress={() => { haptic(); attach('daily', t.title, t.id); }} scaleTo={1} sink={false} radius={12} style={st.pickRow}>
              <Ionicons name="repeat" size={16} color={C.green} />
              <Text style={st.pickText}>{t.title}</Text>
              <Ionicons name="add" size={18} color={C.textFaint} />
            </Bouncy>
          </Animated.View>
        ))}
        {pickableMissions.length > 0 && <Text style={st.sheetSection}>Missions</Text>}
        {pickableMissions.map((m) => (
          <Animated.View key={m.id} exiting={rowOut(level)} layout={glide(level)}>
            <Bouncy onPress={() => { haptic(); attach('mission', m.title, m.id); }} scaleTo={1} sink={false} radius={12} style={st.pickRow}>
              <Ionicons name="flag" size={16} color={C.amber} />
              <Text style={st.pickText}>{m.title}</Text>
              <Ionicons name="add" size={18} color={C.textFaint} />
            </Bouncy>
          </Animated.View>
        ))}
        <PillButton label="Done" onPress={() => setPickSheet(false)} style={{ marginTop: 12 }} />
      </Sheet>

      {/* post-session review */}
      <Sheet
        visible={!!review && !held} onClose={() => review && commit(accumSec, review.choices)} title="Session review"
        onClosed={() => { const say = afterReview.current; afterReview.current = null; say?.(); }}
      >
        <Text style={{ color: C.textDim, fontFamily: F.reg, marginBottom: 12, fontSize: 13, letterSpacing: TRACK.small }}>
          {reviewMin > 0 ? fmtMins(reviewMin) + ' focused. ' : ''}
          What happened to the unchecked items?
        </Text>
        {review?.items.map((it) => (
          <View key={it.key} style={{ marginBottom: 12 }}>
            <Text style={{ color: C.text, fontFamily: F.med, fontSize: 14, letterSpacing: TRACK.small, marginBottom: 6 }}>{it.title}</Text>
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
        {/* what Still pending does with a task made here: the ToDos and long-term tasks it came from keep it anyway */}
        {review?.items.some((it) => it.kind === 'custom') ? (
          <Text style={[T.caption, { marginTop: -2, marginBottom: 14 }]}>Still pending adds an on-the-spot task to ToDos.</Text>
        ) : null}
        <PillButton label="Save session" onPress={() => review && commit(accumSec, review.choices)} />
        {/* a session ended by hand can be taken back up: a quiet way out, under the answer */}
        {review?.byHand ? (
          <Bouncy onPress={keepGoing} scaleTo={1} sink={false} radius={12} accessibilityRole="button" style={st.quietKey}>
            <Text style={st.quietText}>Keep going</Text>
          </Bouncy>
        ) : null}
      </Sheet>

      {/* countdown until a time of day */}
      <Sheet visible={untilSheet} onClose={() => setUntilSheet(false)} title="Count down until…">
        <Text style={{ color: C.textDim, fontFamily: F.reg, fontSize: 13, letterSpacing: TRACK.small, marginBottom: 10 }}>
          Pick a time of day. The block ends at that time.
        </Text>
        {/* the sheet is the picker: the wheels sit in it, rather than a time field opening a second sheet */}
        <TimeWheel value={untilTime} onChange={setUntilTime} hour24={hour24} />
        {untilPreviewMin != null && (
          <Text style={{ color: C.accent, fontSize: 13, letterSpacing: TRACK.small, fontFamily: F.med, marginBottom: 10, textAlign: 'center' }}>
            About {fmtMins(untilPreviewMin)} from now
          </Text>
        )}
        <PillButton label="Set countdown" onPress={setUntil} />
      </Sheet>

      {/* a length that is not a preset: minutes, or until a clock time */}
      <Sheet
        visible={customSheet} onClose={() => setCustomSheet(false)} title="Custom length"
        onClosed={() => { if (untilNext.current) { untilNext.current = false; openUntil(); } }}
      >
        <Field
          value={customMin} onChangeText={setCustomMin} placeholder="Minutes"
          keyboardType="number-pad" autoFocus
          onSubmitEditing={() => { const n = parseInt(customMin, 10); if (n > 0) { setTargetMin(Math.min(n, LONGEST_MIN)); setCustomSheet(false); } }}
        />
        <PillButton
          label="Set length"
          onPress={() => { const n = parseInt(customMin, 10); if (n > 0) { setTargetMin(Math.min(n, LONGEST_MIN)); setCustomSheet(false); } }}
        />
        <Bouncy
          onPress={() => { untilNext.current = true; setCustomSheet(false); }}
          scaleTo={1}
          sink={false}
          radius={12}
          accessibilityRole="button"
          style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 16, marginTop: 6 }}
        >
          <Ionicons name="alarm-outline" size={18} color={C.textDim} />
          <Text style={[T.body, { flex: 1, marginLeft: 10 }]}>Until a time</Text>
          <Ionicons name="chevron-forward" size={18} color={C.textFaint} />
        </Bouncy>
      </Sheet>

      {/* stopwatch finish line */}
      <Sheet visible={finishSheet} onClose={() => setFinishSheet(false)} title="Finish line">
        <Text style={{ color: C.textDim, fontFamily: F.reg, fontSize: 13, letterSpacing: TRACK.small, marginBottom: 10 }}>
          A soft end for the stopwatch. If it passes while the clock runs, you are asked to wrap up, and the session ends on its own after 10 quiet minutes. If the clock is paused then, it ends at once.
        </Text>
        <Row style={{ marginBottom: 4 }}>
          <Chip small label="Today" active={finishDay === 'today'} onPress={() => setFinishDay('today')} />
          <Chip small label="Tomorrow" active={finishDay === 'tomorrow'} onPress={() => setFinishDay('tomorrow')} />
        </Row>
        <TimeWheel value={finishTime} onChange={setFinishTime} hour24={hour24} />
        <Row style={{ gap: 10, marginTop: 6 }}>
          <PillButton label="Set finish line" onPress={setFinishLine} style={{ flex: 1 }} />
          {finishAt != null && (
            <PillButton label="Clear" color={C.danger} outline onPress={() => { clearFinishLine(); setFinishSheet(false); }} />
          )}
        </Row>
      </Sheet>

      {/* finish line reached — approval window */}
      <Sheet
        visible={finishPrompt && !held}
        onClose={() => { if (autoConcludeTimer.current) clearTimeout(autoConcludeTimer.current); clearFinishLine(); }}
        title="Finish line reached"
      >
        <Text style={{ color: C.textDim, fontFamily: F.reg, fontSize: 13, letterSpacing: TRACK.small, marginBottom: 14 }}>
          End the session here, or skip the finish line and keep going. If you do nothing, the session wraps up on its own in 10 minutes.
        </Text>
        <PillButton
          label="End session" color={C.danger}
          onPress={() => { setFinishPrompt(false); endSession(true); }}
        />
        <PillButton
          label="Skip finish line" outline style={{ marginTop: 10 }}
          onPress={() => { if (autoConcludeTimer.current) clearTimeout(autoConcludeTimer.current); clearFinishLine(); }}
        />
      </Sheet>

      <AmbientView
        visible={ambient} timer={timer} subject={shownSubject} task={currentTask?.title}
        startedAt={startedAtRef.current} finishAt={finishAt} hour24={hour24} onExit={() => setAmbient(false)}
      />
    </ScreenBG>
  );
}

/** A length of time, the one way Deep Work writes it: "45 min", "1 h", "1 h 35 min", never a zero part. */
export function fmtMins(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return m + ' min';
  return m === 0 ? h + ' h' : h + ' h ' + m + ' min';
}

/** Today's focused time for the header. */
function focusedToday(min: number): string {
  return fmtMins(min) + ' focused today';
}

/** A logged session's length: whole minutes, or less than one said plainly instead of "0 min". */
export function sessionLength(secs: number): string {
  const m = Math.round(secs / 60);
  return m > 0 ? fmtMins(m) : 'Under a minute';
}

/**
 * The day a session was logged on: Today, Yesterday, or as the notes list writes a date (26 Sep), with the year when it
 * is not this one.
 */
export function sessionDay(key: string): string {
  if (key === todayKey()) return 'Today';
  if (key === yesterdayKey()) return 'Yesterday';
  const d = new Date(key + 'T00:00:00');
  if (isNaN(d.getTime())) return key;
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-IN', opts);
}

/** Minutes from now until the clock next reads `at` (minutes of the day); a time just gone is tomorrow's. */
function minutesUntil(at: number): number {
  const now = new Date();
  let diff = at - (now.getHours() * 60 + now.getMinutes());
  if (diff <= 0) diff += 24 * 60;
  return diff;
}

/**
 * A toast from a session that ended out of sight. It waits until it can be seen (the app in front, the intro gone),
 * and is dropped if `still` says it no longer needs saying (Deep Work came to the front first).
 */
function toastWhenSeen(message: string, action: ToastAction, still: () => boolean) {
  const seen = () => AppState.currentState === 'active' && useIntro.getState().phase !== 'playing';
  if (seen()) { toast(message, action); return; }
  let done = false;
  const tryNow = () => {
    if (done || !seen()) return;
    done = true;
    app.remove();
    intro();
    if (still()) toast(message, action);
  };
  const app = AppState.addEventListener('change', tryNow);
  const intro = useIntro.subscribe(tryNow);
}

const st = StyleSheet.create({
  barLayer: { zIndex: 2 },
  clockSlot:{ height: CLOCK_SLOT_H, alignItems: 'center', justifyContent: 'center' },
  wheelBox: { alignSelf: 'stretch' },
  wheelText: { ...T.numWheel },
  taskText: { color: C.text, fontFamily: F.reg, fontSize: 15, letterSpacing: TRACK.body },
  /** the words take the row's middle; the strike is drawn across them, not across the row */
  taskWrap: { flex: 1, marginLeft: 10 },
  /** close to the card's old rhythm, with the list card's own edges */
  taskRow: { paddingVertical: 8, paddingHorizontal: 8 },
  sheetSection: { color: C.textFaint, fontSize: 12, fontFamily: F.semi, textTransform: 'uppercase', letterSpacing: TRACK.caps, marginTop: 10, marginBottom: 6 },
  pickRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  pickText: { color: C.text, fontFamily: F.reg, fontSize: 15, letterSpacing: TRACK.body, marginLeft: 10, flex: 1 },
  /** "+ Attach" reaches a finger's height without moving: the padding is taken back by the margin */
  attachKey: { paddingVertical: 6, marginVertical: -6 },
  picks: { flexWrap: 'wrap' },
  quietKey: { alignSelf: 'center', paddingVertical: 14, paddingHorizontal: 18, marginTop: 6 },
  quietText: { color: C.textDim, fontFamily: F.med, fontSize: 14, letterSpacing: TRACK.small },
  cols: { flexDirection: 'row', alignItems: 'flex-start', gap: 28 },
  col: { flex: 1, minWidth: 0 },
  /** the side column's first title lines up with the top of the session instead of a section's gap below it */
  colSide: { marginTop: -S.section },
});
