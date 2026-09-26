import React from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, LayoutAnimationConfig } from 'react-native-reanimated';
import { C, F, MIN, S, T, neuRaised } from '../theme';
import { fmtClockTime } from '../utils';
import { TimerState, displayOf, shownSecondsOf, useSessionTick } from '../deepWork';
import { WIDE_AT } from '../layout';
import { useAnimLevel } from './Motion';
import { ClockDigits, clockWidth } from './ClockDigits';
import { CheckCircle, Chip, NeuIconBtn, PillButton, ProgressBar, useTheme } from './UI';

// The Slab, as drawn in the Focus Lab with 104 dp minutes. Every other measure of the clock is a share of that size,
// so a larger clock (a tablet) or a smaller one (hours on a narrow phone) keeps the same proportions.
const BIG = 104;
/** the minutes on a tablet */
const BIG_WIDE = 160;
/** the minutes' cell height */
const LINE = 1.02;
/** the seconds' size */
const SEC = 30 / BIG;
/** the gap between the minutes and the seconds */
const SEC_GAP = 2 / BIG;
/** how far below the top of the minutes' line the seconds' line starts */
const SEC_TOP = 12 / BIG;
const PAD_X = 22;

const pad2 = (n: number) => String(n).padStart(2, '0');
const clockAt = (ms: number, hour24: boolean) => {
  const d = new Date(ms);
  return fmtClockTime(d.getHours() * 60 + d.getMinutes(), hour24);
};

/** The large part and the small part of a clock: "41" and ":06", or "1:05" and ":12" once there are hours. */
export function splitClock(secs: number): [string, string] {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return [h ? h + ':' + pad2(m) : String(m), ':' + pad2(secs % 60)];
}

/** The minutes' size: the plate's own size, stepping down only when the time would not fit across the plate. */
function fitSize(big: string, sec: string, base: number, availW: number) {
  const em = clockWidth(big, 1) + SEC_GAP + clockWidth(sec, 1) * SEC;
  return availW > 0 ? Math.min(base, Math.floor(availW / em)) : base;
}

/** The time, its progress rule and the times under it: the only part of the plate that renders each second. */
function SlabClock({ timer, base, availW, startedAt, finishAt, hour24, clockStyle, hold }: {
  timer: TimerState; base: number; availW: number; startedAt: number | null; finishAt: number | null;
  hour24: boolean; clockStyle?: any; hold?: boolean;
}) {
  useSessionTick(timer, hold);
  const level = useAnimLevel();
  const [big, sec] = splitClock(shownSecondsOf(timer));
  const size = fitSize(big, sec, base, availW);
  // when the hours arrive and the clock has to step down, the smaller clock fades in instead of every digit snapping
  // smaller in one frame. The clock's first size needs no fade: the plate brings it in.
  const firstSize = React.useRef(size);
  const resized = level !== 'none' && size !== firstSize.current;

  let progress: number | null = null;
  let right = '';
  if (timer.mode === 'countdown') {
    progress = 1 - displayOf(timer) / (timer.targetMin * 60);
    right = timer.running && timer.startTs
      ? 'Ends ' + clockAt(timer.startTs + (timer.targetMin * 60 - timer.accumSec) * 1000, hour24)
      : 'Paused';
  } else {
    // a stopwatch fills its rule toward the finish line, when it has one
    if (finishAt && startedAt && finishAt > startedAt) progress = (Date.now() - startedAt) / (finishAt - startedAt);
    right = finishAt ? 'Finish ' + clockAt(finishAt, hour24) : timer.running ? '' : 'Paused';
  }
  const left = startedAt ? 'Started ' + clockAt(startedAt, hour24) : '';

  return (
    <>
      <Animated.View key={size} entering={resized ? FadeIn.duration(280) : undefined} style={[st.time, clockStyle]}>
        <ClockDigits text={big} size={size} lineHeight={Math.round(size * LINE)} />
        <ClockDigits
          text={sec}
          size={size * SEC}
          color={C.textDim}
          style={{ marginTop: Math.round(size * SEC_TOP), marginLeft: size * SEC_GAP }}
        />
      </Animated.View>
      {progress != null ? (
        <View style={st.rule}>
          <ProgressBar value={Math.min(1, Math.max(0, progress))} height={6} />
        </View>
      ) : (
        <View style={st.noRule} />
      )}
      <View style={st.meta}>
        <Text style={st.metaText} numberOfLines={1}>{left}</Text>
        <Text style={st.metaText} numberOfLines={1}>{right}</Text>
      </View>
    </>
  );
}

export interface StageTask { title: string; color: string }

/**
 * Deep Work once a session has started (the Slab, picked in the Focus Lab): one raised plate with the subject, the
 * minutes large and the seconds small, a carved progress rule with the start and end times, and the keys inside the
 * plate. Below it, five more minutes (or the finish line) and the task in hand.
 */
export function SessionStage({
  timer, subject, startedAt, finishAt, hour24, current,
  onSubject, onToggle, onEnd, onAmbient, onAddFive, onFinishLine, onTickCurrent, clockStyle, hold,
}: {
  timer: TimerState;
  subject: string;
  startedAt: number | null;
  finishAt: number | null;
  hour24: boolean;
  /** the first unticked session task; null once every task is ticked; undefined with none attached */
  current: StageTask | null | undefined;
  onSubject: () => void;
  onToggle: () => void;
  onEnd: () => void;
  onAmbient: () => void;
  onAddFive: () => void;
  onFinishLine: () => void;
  onTickCurrent: () => void;
  /** the completion pulse, on the time */
  clockStyle?: any;
  /** the ambient screen covers the plate: its clock rests until it is seen again */
  hold?: boolean;
}) {
  const theme = useTheme();
  const level = useAnimLevel();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_AT;
  // a phone's plate is known before it lays out (the screen less its margins), so the clock is sized right from its
  // first frame; a wide window measures
  const [innerW, setInnerW] = React.useState(wide ? 0 : width - S.pad * 2 - PAD_X * 2);
  const base = wide ? BIG_WIDE : BIG;
  const minimal = theme === 'minimal';
  const surface = minimal
    ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: MIN.border }
    : { backgroundColor: C.card, ...neuRaised('high') };

  return (
    // the clock's digits never play their exits when the whole plate goes: it leaves as one
    <LayoutAnimationConfig skipExiting>
      <View
        style={[st.plate, surface]}
        onLayout={(e) => setInnerW(Math.round(e.nativeEvent.layout.width) - PAD_X * 2 - (minimal ? 2 : 0))}
      >
        <View style={st.top}>
          <Pressable
            onPress={onSubject}
            hitSlop={12}
            style={st.subject}
            accessibilityRole="button"
            accessibilityLabel={subject ? `Subject, ${subject}. Change it` : 'Add a subject'}
          >
            <Text style={[T.kicker, { color: subject ? C.accent : C.textFaint }]} numberOfLines={1}>
              {subject || 'Add a subject'}
            </Text>
          </Pressable>
          <Text style={st.block} numberOfLines={1}>
            {timer.mode === 'countdown' ? `${timer.targetMin} min block` : 'Stopwatch'}
          </Text>
        </View>

        <SlabClock
          timer={timer} base={base} availW={innerW} startedAt={startedAt} finishAt={finishAt} hour24={hour24}
          clockStyle={clockStyle} hold={hold}
        />

        <View style={st.dock}>
          <NeuIconBtn name="stop" color={C.danger} dim={50} size={20} onPress={onEnd} accessibilityLabel="End session" />
          <PillButton
            label={timer.running ? 'Pause' : 'Resume'}
            icon={timer.running ? 'pause' : 'play'}
            onPress={onToggle}
            style={st.toggle}
          />
          {/* paused, the ambient screen has nothing to count: its key keeps its place so the pill never moves */}
          <View pointerEvents={timer.running ? 'auto' : 'none'} style={{ opacity: timer.running ? 1 : 0 }}>
            <NeuIconBtn
              name="moon-outline" color={C.textDim} dim={50} size={20} onPress={onAmbient}
              accessibilityLabel="Open the ambient screen"
            />
          </View>
        </View>
      </View>

      <View style={st.extra}>
        {/* a chip carries its own margins for a row of chips; this one sits alone at the right edge */}
        <View style={st.chipBox}>
          {timer.mode === 'countdown' ? (
            <Chip small label="+5 min" onPress={onAddFive} />
          ) : (
            <Chip small label="Finish line" active={!!finishAt} color={C.accent} onPress={onFinishLine} />
          )}
        </View>
      </View>

      {current !== undefined ? (
        <View style={[st.current, { borderColor: minimal ? MIN.border : C.outline }]}>
          <View style={st.currentText}>
            <Text style={st.currentKick}>Current task</Text>
            <Animated.Text
              key={current ? current.title : 'done'}
              entering={level === 'none' ? undefined : FadeIn.duration(220)}
              style={[st.currentTitle, !current && { color: C.textDim }]}
              numberOfLines={1}
            >
              {current ? current.title : 'All tasks done'}
            </Animated.Text>
          </View>
          {current ? <CheckCircle done={false} color={current.color} onPress={onTickCurrent} label={current.title} /> : null}
        </View>
      ) : null}
    </LayoutAnimationConfig>
  );
}

const st = StyleSheet.create({
  plate: { borderRadius: 26, paddingTop: 20, paddingHorizontal: PAD_X, paddingBottom: 22 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  subject: { flexShrink: 1, paddingVertical: 2 },
  block: { color: C.textFaint, fontFamily: F.reg, fontSize: 12, marginLeft: 12 },
  time: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 10 },
  rule: { marginTop: 18, marginBottom: 9 },
  noRule: { height: 12 },
  meta: { flexDirection: 'row', justifyContent: 'space-between' },
  metaText: { color: C.textFaint, fontFamily: F.reg, fontSize: 12, fontVariant: ['tabular-nums'] },
  dock: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 20 },
  toggle: { flex: 1, height: 52, paddingVertical: 0 },
  extra: { marginTop: 14, height: 30, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' },
  chipBox: { marginRight: -10, marginBottom: -10 },
  current: {
    flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 22,
    paddingVertical: 12, paddingLeft: 14, paddingRight: 10, borderRadius: 16, borderWidth: 1,
  },
  currentText: { flex: 1, minWidth: 0 },
  currentKick: { color: C.textFaint, fontFamily: F.semi, fontSize: 11, letterSpacing: 1.6, textTransform: 'uppercase' },
  currentTitle: { color: C.text, fontFamily: F.med, fontSize: 15, marginTop: 3 },
});
