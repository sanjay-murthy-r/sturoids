import React from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  FadeIn, LayoutAnimationConfig, useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated';
import { C, CHROME_FONT_MAX, F, MIN, S, T, TRACK, neuRaised, oneLine } from '../theme';
import { fmtClockTime } from '../utils';
import { TimerState, displayOf, shownSecondsOf, spokenTimeOf, useSessionTick } from '../deepWork';
import { WIDE_AT } from '../layout';
import { Appear, Bouncy, CHANGE, EASE_OUT, FadeSwap, useAnimLevel, useBuilt, useLoop } from './Motion';
import { ClockDigits, clockWidth } from './ClockDigits';
import { CheckCircle, Chip, NeuIconBtn, PillButton, ProgressBar, useTheme } from './UI';
import { Breathe } from './Cheer';

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
/** the breath caption's line (oneLine(13)) */
const BREATH_LINE = 16;

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
  // paused, the digits ease between full strength and 55 percent (the universal "paused" signal); running, they are still
  const pausedLoop = useLoop(!timer.running && !hold, 2400);
  const pausedStyle = useAnimatedStyle(() => ({ opacity: 1 - 0.45 * pausedLoop.value }));
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
      {/* one element for a screen reader, said in words, which change once a minute with the minutes */}
      <Animated.View
        key={size}
        entering={resized ? FadeIn.duration(level === 'full' ? 280 : 180).easing(EASE_OUT) : undefined}
        style={[st.time, clockStyle]}
        accessible
        accessibilityLabel={spokenTimeOf(timer)}
      >
        {/* Cheerful: a soft glow breathes behind the running clock */}
        {timer.running ? <Breathe size={size * 3.2} /> : null}
        <Animated.View style={[st.timeRow, pausedStyle]}>
          <ClockDigits text={big} size={size} lineHeight={Math.round(size * LINE)} />
          <ClockDigits
            text={sec}
            size={size * SEC}
            color={C.textDim}
            style={{ marginTop: Math.round(size * SEC_TOP), marginLeft: size * SEC_GAP }}
          />
        </Animated.View>
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
        <Text style={[st.metaText, st.metaRight]} numberOfLines={1}>{right}</Text>
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
  // paused, the ambient key fades out of reach and fades back on resume, instead of blinking
  const moon = useSharedValue(timer.running ? 1 : 0);
  React.useEffect(() => {
    moon.value = level === 'none' ? (timer.running ? 1 : 0) : withTiming(timer.running ? 1 : 0, CHANGE);
  }, [timer.running, level]);
  const moonStyle = useAnimatedStyle(() => ({ opacity: moon.value }));
  const block = timer.mode === 'countdown' ? `${timer.targetMin} min block` : 'Stopwatch';
  // what the plate is built with is simply there; a current task that turns up later (the first task attached
  // mid-session) fades in where it stands
  const built = useBuilt();

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
          {/* five more minutes changes the block's length in place: the words dip over */}
          <FadeSwap swapKey={block}>
            <Text style={st.block} numberOfLines={1}>{block}</Text>
          </FadeSwap>
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
          <Animated.View pointerEvents={timer.running ? 'auto' : 'none'} style={moonStyle}>
            <NeuIconBtn
              name="moon-outline" color={C.textDim} dim={50} size={20} onPress={onAmbient}
              accessibilityLabel="Open the ambient screen"
            />
          </Animated.View>
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
        <Arrive late={built.current} style={[st.current, { borderColor: minimal ? MIN.border : C.outline }]}>
          <View style={st.currentText}>
            <Text style={st.currentKick}>Current task</Text>
            <Animated.Text
              key={current ? current.title : 'done'}
              entering={level === 'none' ? undefined : FadeIn.duration(level === 'full' ? 220 : 180).easing(EASE_OUT)}
              style={[st.currentTitle, !current && { color: C.textDim }]}
              numberOfLines={1}
            >
              {current ? current.title : 'All tasks done'}
            </Animated.Text>
          </View>
          {current ? <CheckCircle done={false} color={current.color} onPress={onTickCurrent} label={current.title} /> : null}
        </Arrive>
      ) : null}
    </LayoutAnimationConfig>
  );
}

/** a break's minutes: calmer than a block's, so the plate reads as rest rather than work */
const BREAK_BIG = 72;
const BREAK_BIG_WIDE = 112;

/** A break's time said for a screen reader, to the minute as its clock rounds. */
function breakSpoken(secs: number): string {
  const mins = Math.ceil(secs / 60);
  if (mins <= 0) return 'Break over';
  return mins + (mins === 1 ? ' minute' : ' minutes') + ' of break left';
}

/** A break's calm countdown: the minutes without the roll, the seconds small, a quiet rule and when it ends. */
function BreakClock({ endAt, min, base, availW, hour24, hold }: {
  endAt: number; min: number; base: number; availW: number; hour24: boolean; hold?: boolean;
}) {
  // a break is a countdown that started `min` minutes before its end and never pauses
  const timer: TimerState = { mode: 'countdown', targetMin: min, running: true, startTs: endAt - min * 60_000, accumSec: 0 };
  useSessionTick(timer, hold);
  const secs = shownSecondsOf(timer);
  const [big, sec] = splitClock(secs);
  const size = fitSize(big, sec, base, availW);
  const progress = min > 0 ? 1 - displayOf(timer) / (min * 60) : 1;
  const h = Math.round(size * LINE);
  return (
    <>
      <View style={st.time}>
        <BreathGuide ring={Math.round(h * 1.2)} centerX={clockWidth(big, size) / 2} centerY={h / 2} on={!hold} />
        <View style={st.timeRow} accessible accessibilityLabel={breakSpoken(secs)}>
          <ClockDigits text={big} size={size} lineHeight={h} roll={false} />
          <ClockDigits
            text={sec}
            size={size * SEC}
            color={C.textFaint}
            roll={false}
            style={{ marginTop: Math.round(size * SEC_TOP), marginLeft: size * SEC_GAP }}
          />
        </View>
      </View>
      <View style={st.rule}>
        <ProgressBar value={Math.min(1, Math.max(0, progress))} height={6} color={C.textDim} />
      </View>
      <View style={st.meta}>
        <Text style={st.metaText} numberOfLines={1}>{min + ' min break'}</Text>
        <Text style={[st.metaText, st.metaRight]} numberOfLines={1}>{'Ends ' + clockAt(endAt, hour24)}</Text>
      </View>
    </>
  );
}

/** one breath: in over 4 s, out over 4 s */
const BREATH_MS = 8000;

/**
 * A breathing guide behind a break's minutes: a soft ring that grows over 4 s and shrinks over 4 s, with a caption at the
 * row's end that crossfades "Breathe in" and "Breathe out" on the same beat. With less than every animation on, the
 * ring stays still at its middle size and the caption does not change. A screen reader hears none of it.
 */
function BreathGuide({ ring, centerX, centerY, on }: { ring: number; centerX: number; centerY: number; on: boolean }) {
  const level = useAnimLevel();
  const moving = level === 'full';
  const v = useLoop(on, BREATH_MS);
  // which way the breath goes: 1 breathing in (the ring growing), 0 breathing out. The caption crossfades on each turn
  const inhale = useSharedValue(1);
  const goingUp = useSharedValue(1);
  useAnimatedReaction(
    () => v.value,
    (now, before) => {
      if (before == null || now === before) return;
      const up = now > before ? 1 : 0;
      if (up === goingUp.value) return;
      goingUp.value = up;
      inhale.value = withTiming(up, { duration: 600, easing: EASE_OUT });
    },
  );
  React.useEffect(() => {
    if (moving) return;
    goingUp.value = 1;
    inhale.value = 1;
  }, [moving]);
  const ringStyle = useAnimatedStyle(() => {
    const k = moving ? v.value : 0.5;
    return { opacity: 0.55 + 0.45 * k, transform: [{ scale: 0.72 + 0.28 * k }] };
  });
  const inStyle = useAnimatedStyle(() => ({ opacity: inhale.value }));
  const outStyle = useAnimatedStyle(() => ({ opacity: 1 - inhale.value }));
  return (
    <>
      <Animated.View
        pointerEvents="none"
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        style={[
          st.breathRing,
          { width: ring, height: ring, borderRadius: ring / 2, left: centerX - ring / 2, top: centerY - ring / 2 },
          ringStyle,
        ]}
      />
      <View
        pointerEvents="none"
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        style={[st.breathCaption, { top: Math.round(centerY - BREATH_LINE / 2) }]}
      >
        {moving ? (
          <>
            {/* the longer words hold the place, the shorter lie over them at the same right edge */}
            <Animated.Text style={[st.breathText, outStyle]} numberOfLines={1} maxFontSizeMultiplier={CHROME_FONT_MAX}>
              Breathe out
            </Animated.Text>
            <Animated.Text style={[st.breathText, st.breathOver, inStyle]} numberOfLines={1} maxFontSizeMultiplier={CHROME_FONT_MAX}>
              Breathe in
            </Animated.Text>
          </>
        ) : (
          <Text style={st.breathText} numberOfLines={1} maxFontSizeMultiplier={CHROME_FONT_MAX}>Breathe slowly</Text>
        )}
      </View>
    </>
  );
}

/**
 * The time between two countdown blocks, in the stage's place. When a block runs out (`offer`) it offers a 5, 10 or 15
 * minute break, or the next block straight away; a break (`break`) is a calm countdown that is never logged as focus,
 * and can be skipped; once it is over (`over`) the next block is offered, with the subject and the length of the one
 * before. "Not now" goes back to setting up a session.
 */
export function BreakStage({
  stage, subject, endAt, min, lengths, nextDetail, hour24, onBreak, onSkip, onNext, onDismiss, hold,
}: {
  stage: 'offer' | 'break' | 'over';
  /** the subject of the block just done, '' for none */
  subject: string;
  /** the running break's end and length */
  endAt: number;
  min: number;
  /** the break lengths offered, in minutes */
  lengths: number[];
  /** the next block under "Start the next block": "Physics · 50 min" */
  nextDetail: string;
  hour24: boolean;
  onBreak: (min: number) => void;
  onSkip: () => void;
  onNext: () => void;
  onDismiss: () => void;
  /** the plate is out of sight: its clock rests */
  hold?: boolean;
}) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_AT;
  const [innerW, setInnerW] = React.useState(wide ? 0 : width - S.pad * 2 - PAD_X * 2);
  const minimal = theme === 'minimal';
  const surface = minimal
    ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: MIN.border }
    : { backgroundColor: C.card, ...neuRaised('high') };
  const kicker = stage === 'offer' ? (subject ? subject + ' block done' : 'Block done') : stage === 'break' ? 'Break' : 'Break over';
  return (
    <View
      style={[st.plate, surface]}
      onLayout={(e) => setInnerW(Math.round(e.nativeEvent.layout.width) - PAD_X * 2 - (minimal ? 2 : 0))}
    >
      <FadeSwap swapKey={kicker}>
        <Text style={[T.kicker, { color: stage === 'break' ? C.textDim : C.accent }]} numberOfLines={1}>{kicker}</Text>
      </FadeSwap>
      {/* what the plate holds dips over as the time between blocks moves on */}
      <FadeSwap swapKey={stage}>
        {stage === 'offer' ? (
          <View>
            <Text style={st.betweenTitle} accessibilityRole="header">Take a break</Text>
            <View style={st.lengths}>
              {lengths.map((m) => (
                <Chip key={m} label={m + ' min'} onPress={() => onBreak(m)} accessibilityLabel={'Take a ' + m + ' minute break'} />
              ))}
            </View>
            <NextKey detail={nextDetail} outline onPress={onNext} />
          </View>
        ) : stage === 'break' ? (
          <View>
            <BreakClock endAt={endAt} min={min} base={wide ? BREAK_BIG_WIDE : BREAK_BIG} availW={innerW} hour24={hour24} hold={hold} />
            <PillButton label="Skip break" outline color={C.textDim} onPress={onSkip} style={st.skip} />
          </View>
        ) : (
          <View>
            <Text style={st.betweenTitle} accessibilityRole="header">Ready for the next one</Text>
            <NextKey detail={nextDetail} onPress={onNext} />
          </View>
        )}
      </FadeSwap>
      {stage === 'break' ? null : (
        // a quiet way out, under the answer
        <Bouncy onPress={onDismiss} scaleTo={1} sink={false} radius={12} accessibilityRole="button" style={st.notNow}>
          <Text style={st.notNowText}>Not now</Text>
        </Bouncy>
      )}
    </View>
  );
}

/**
 * "Start the next block" with the block under it on a second line (its subject and length), so a long subject never
 * wraps the words of a one-line pill. Drawn as a PillButton is: raised, or an outline when it is the second choice.
 */
function NextKey({ detail, outline, onPress }: { detail: string; outline?: boolean; onPress: () => void }) {
  const theme = useTheme();
  const c = C.accent;
  return (
    <Bouncy
      onPress={onPress} scaleTo={0.96} radius={999}
      accessibilityRole="button" accessibilityLabel={'Start the next block' + (detail ? ', ' + detail : '')}
      style={[
        st.nextKey,
        outline
          ? { borderColor: c + '88', borderWidth: 1.5 }
          : theme === 'minimal'
            ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: c + '77' }
            : { backgroundColor: C.card, ...neuRaised('low') },
      ]}
    >
      <Text style={[st.nextTitle, { color: c }]} numberOfLines={1}>Start the next block</Text>
      {detail ? <Text style={st.nextDetail} numberOfLines={1}>{detail}</Text> : null}
    </Bouncy>
  );
}

/** A part that fades in (see Appear) only when it turns up after its surroundings were built; decided once, as it mounts. */
function Arrive({ late, style, children }: { late: boolean; style: any; children: React.ReactNode }) {
  const [fade] = React.useState(late);
  return fade ? <Appear style={style}>{children}</Appear> : <View style={style}>{children}</View>;
}

const st = StyleSheet.create({
  plate: { borderRadius: 26, paddingTop: 20, paddingHorizontal: PAD_X, paddingBottom: 22 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  subject: { flexShrink: 1, paddingVertical: 2 },
  block: { color: C.textFaint, fontFamily: F.sm, fontSize: 12, letterSpacing: TRACK.fine, marginLeft: 12 },
  time: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 10 },
  timeRow: { flexDirection: 'row', alignItems: 'flex-start' },
  // the breath's ring: a soft outline with a faint fill, behind the minutes
  breathRing: {
    position: 'absolute', borderWidth: 1.5, borderColor: C.textDim + '38', backgroundColor: C.textDim + '0D',
  },
  // the breath's words sit at the row's end, level with the middle of the minutes
  breathCaption: { position: 'absolute', right: 0, alignItems: 'flex-end' },
  breathText: { ...oneLine(13), color: C.textFaint, fontFamily: F.sm, letterSpacing: TRACK.small, textAlign: 'right' },
  breathOver: { position: 'absolute', right: 0, top: 0 },
  rule: { marginTop: 18, marginBottom: 9 },
  noRule: { height: 12 },
  meta: { flexDirection: 'row', justifyContent: 'space-between' },
  // at a large font size the two times share the line instead of running off the plate. The times keep the text
  // face's tabular figures, like the clock above them
  metaText: { flexShrink: 1, color: C.textFaint, fontFamily: F.reg, fontSize: 12, letterSpacing: TRACK.fine, fontVariant: ['tabular-nums'] },
  metaRight: { textAlign: 'right', marginLeft: 12 },
  dock: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 20 },
  toggle: { flex: 1, height: 52, paddingVertical: 0 },
  // at least the chip's height, and more when a large font size makes the chip taller
  extra: { marginTop: 14, minHeight: 30, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' },
  chipBox: { marginRight: -10, marginBottom: -10 },
  current: {
    flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 22,
    paddingVertical: 12, paddingLeft: 14, paddingRight: 10, borderRadius: 16, borderWidth: 1,
  },
  currentText: { flex: 1, minWidth: 0 },
  currentKick: { color: C.textFaint, fontFamily: F.smSemi, fontSize: 11, letterSpacing: TRACK.caps, textTransform: 'uppercase' },
  currentTitle: { color: C.text, fontFamily: F.med, fontSize: 15, letterSpacing: TRACK.body, marginTop: 3 },
  betweenTitle: { ...T.title, marginTop: 10 },
  // a chip carries its own right and bottom margins for a row of chips: the row gives the bottom one back
  lengths: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 14, marginBottom: -10 },
  skip: { marginTop: 20 },
  nextKey: {
    alignItems: 'center', justifyContent: 'center', marginTop: 20,
    paddingVertical: 11, paddingHorizontal: 20, borderRadius: 999, overflow: 'hidden',
  },
  nextTitle: { fontFamily: F.semi, fontSize: 15, letterSpacing: TRACK.body },
  nextDetail: { color: C.textDim, fontFamily: F.sm, fontSize: 12, letterSpacing: TRACK.fine, marginTop: 2 },
  notNow: { alignSelf: 'center', paddingVertical: 12, paddingHorizontal: 18, marginTop: 6, marginBottom: -10 },
  notNowText: { color: C.textDim, fontFamily: F.med, fontSize: 14, letterSpacing: TRACK.small },
});
