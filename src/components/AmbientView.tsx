import React from 'react';
import { AppState, Modal, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing, FadeIn, FadeOut, LayoutAnimationConfig, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useKeepAwake } from 'expo-keep-awake';
import * as Brightness from 'expo-brightness';
import * as NavigationBar from 'expo-navigation-bar';
import { C, F } from '../theme';
import { useStore } from '../store';
import { fmtClockTime } from '../utils';
import { TimerState, displayOf, shownSecondsOf, useSessionTick } from '../deepWork';
import { EASE_OUT, useAnimLevel } from './Motion';
import { ClockDigits, clockWidth } from './ClockDigits';

/** the ambient screen never brightens a dim room: it only ever lowers the phone to this */
const DIM_TO = 0.25;
/**
 * The ambient screen's own inks, a step darker than the app's: dimmed digits, softer words and a fainter rule on true
 * black, so a propped-up phone glows no more than it must.
 */
const INK = {
  digit: 'rgba(250,249,245,0.82)',
  soft: 'rgba(194,192,182,0.62)',
  faint: 'rgba(156,154,146,0.5)',
  track: 'rgba(250,249,245,0.07)',
};
/** burn-in care: the face visits these offsets, one step a minute, as shares of the screen's shorter side */
const DRIFT: [number, number][] = [[0.022, -0.022], [-0.022, 0.022], [0.022, 0.022], [-0.022, -0.022], [0, 0]];

// Monolith, as drawn in the Focus Lab on a 360 dp screen, in shares of the screen's shorter side (u)
/** the minutes, as large as the screen allows */
const BIG = 0.46;
/** the seconds, and the gap and drop that set them against the minutes, as shares of the minutes' size */
const SEC = 10 / 46;
const SEC_GAP = 1 / 46;
const SEC_TOP = 5 / 46;
/** "min" beside whole minutes when the seconds are off */
const UNIT = 6 / 46;
const UNIT_GAP = 2 / 46;
/** Geist Regular's "min" is about this many ems wide (1.70, measured from the font file) */
const UNIT_EM = 1.7;
const LINE = 1.02;

const pad2 = (n: number) => String(n).padStart(2, '0');
const clockAt = (ms: number, hour24: boolean) => {
  const d = new Date(ms);
  return fmtClockTime(d.getHours() * 60 + d.getMinutes(), hour24);
};

/**
 * Keeps the screen awake, dims it and hides the system bars. Brightness is handed back whenever the app leaves the
 * foreground (so a dimmed screen never outlives the view) and taken again on return; everything is put back on close.
 */
function useAmbientSystem() {
  useKeepAwake('sturoids-ambient');
  React.useEffect(() => {
    let previous: number | null = null;
    let live = true;
    const dim = async () => {
      try {
        const current = await Brightness.getBrightnessAsync();
        if (previous == null) previous = current;
        if (live) await Brightness.setBrightnessAsync(Math.min(current, DIM_TO));
      } catch {
        // some skins refuse: the phone keeps its own brightness
      }
    };
    const restore = () => {
      if (Platform.OS === 'android') Brightness.restoreSystemBrightnessAsync().catch(() => {});
      else if (previous != null) Brightness.setBrightnessAsync(previous).catch(() => {});
    };
    dim();
    if (Platform.OS === 'android') {
      NavigationBar.setVisibilityAsync('hidden').catch(() => {});
      NavigationBar.setBehaviorAsync('overlay-swipe').catch(() => {});
    }
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') dim();
      else restore();
    });
    return () => {
      live = false;
      sub.remove();
      restore();
      if (Platform.OS === 'android') NavigationBar.setVisibilityAsync('visible').catch(() => {});
    };
  }, []);
}

/** Re-renders its caller as each minute of the day turns, while `on`. */
function useMinuteTick(on: boolean) {
  const [, setN] = React.useState(0);
  React.useEffect(() => {
    if (!on) return undefined;
    let t: ReturnType<typeof setTimeout>;
    const arm = () => {
      t = setTimeout(() => { setN((x) => x + 1); arm(); }, 60_000 - (Date.now() % 60_000) + 20);
    };
    arm();
    return () => clearTimeout(t);
  }, [on]);
}

/**
 * The large part and the small part: "40" and ":59", or "1:05" and ":12"; whole minutes alone without seconds, rounded
 * the way the clock itself rounds: up for a countdown (it reads 50 until it has really begun), down for a stopwatch.
 */
function parts(secs: number, withSeconds: boolean, countdown: boolean): [string, string] {
  if (!withSeconds) {
    const mins = countdown ? Math.ceil(secs / 60) : Math.floor(secs / 60);
    const h = Math.floor(mins / 60);
    return [h ? h + ':' + pad2(mins % 60) : String(mins), ''];
  }
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return [h ? h + ':' + pad2(m) : String(m), ':' + pad2(secs % 60)];
}

interface FaceProps {
  timer: TimerState; subject: string; task?: string; startedAt: number | null; finishAt: number | null;
  hour24: boolean; width: number; height: number; topInset: number;
}

/** Everything on the ambient screen that counts: re-renders once a second, and once a minute for the time of day. */
function MonolithFace({ timer, subject, task, startedAt, finishAt, hour24, width, height, topInset }: FaceProps) {
  useSessionTick(timer);
  const level = useAnimLevel();
  const withSeconds = useStore((s) => s.settings.ambientSeconds);
  const showClock = useStore((s) => s.settings.ambientClock);
  useMinuteTick(showClock);

  const u = Math.min(width, height);
  const secs = shownSecondsOf(timer);
  const [big, sec] = parts(secs, withSeconds, timer.mode === 'countdown');
  // whole minutes under an hour carry "min"; "1:05" reads as hours and minutes on its own
  const unit = !withSeconds && !big.includes(':');

  // the subject at the top and the task at the foot keep their places; the time is centred between them, as large as
  // the width and the height left over allow
  const kickerSize = u * 0.035;
  const todSize = u * 0.039;
  const metaSize = u * 0.044;
  const taskSize = u * 0.04;
  const top = Math.max(u * 0.15, topInset + 12);
  const foot = u * 0.17;
  const topH = top + (subject ? kickerSize * 1.5 : 0) + (showClock ? u * 0.024 + todSize * 1.35 : 0);
  const footH = foot + Math.max(1, u * 0.005) + (task ? u * 0.045 + taskSize * 1.35 : 0);
  const metaH = u * 0.03 + metaSize * 1.35;
  const room = height - 2 * (Math.max(topH, footH) + u * 0.04) - metaH;
  const rowEm = clockWidth(big, 1)
    + (withSeconds ? SEC_GAP + clockWidth(sec, 1) * SEC : unit ? UNIT_GAP + UNIT * UNIT_EM : 0);
  const size = Math.floor(Math.max(24, Math.min(u * BIG, (width * 0.84) / rowEm, room / LINE)));
  const firstSize = React.useRef(size);
  const resized = level !== 'none' && size !== firstSize.current;

  const raw = displayOf(timer);
  let progress = 0;
  let meta = '';
  if (timer.mode === 'countdown') {
    progress = 1 - raw / (timer.targetMin * 60);
    meta = timer.running && timer.startTs
      ? 'Ends ' + clockAt(timer.startTs + (timer.targetMin * 60 - timer.accumSec) * 1000, hour24)
      : 'Paused';
  } else {
    if (finishAt && startedAt && finishAt > startedAt) progress = (Date.now() - startedAt) / (finishAt - startedAt);
    meta = !timer.running ? 'Paused' : finishAt ? 'Finish ' + clockAt(finishAt, hour24) : startedAt ? 'Started ' + clockAt(startedAt, hour24) : '';
  }
  progress = Math.min(1, Math.max(0, progress));
  const ruleW = width - u * 0.22;

  return (
    <>
      <View style={[st.top, { top }]}>
        {subject ? (
          <Text
            allowFontScaling={false}
            style={[st.kicker, { color: C.accent, fontSize: kickerSize, letterSpacing: kickerSize * 0.32, paddingLeft: kickerSize * 0.32 }]}
            numberOfLines={1}
          >
            {subject}
          </Text>
        ) : null}
        {showClock ? (
          <Text allowFontScaling={false} style={[st.faint, { fontSize: todSize, marginTop: subject ? u * 0.024 : 0 }]}>
            {clockAt(Date.now(), hour24)}
          </Text>
        ) : null}
      </View>

      <View style={st.mid} pointerEvents="none">
        <Animated.View key={size} entering={resized ? FadeIn.duration(280).easing(EASE_OUT) : undefined} style={st.time}>
          <ClockDigits text={big} size={size} lineHeight={Math.round(size * LINE)} color={INK.digit} />
          {withSeconds ? (
            <ClockDigits
              text={sec}
              size={size * SEC}
              color={INK.soft}
              style={{ marginTop: Math.round(size * SEC_TOP), marginLeft: size * SEC_GAP }}
            />
          ) : unit ? (
            <Text
              allowFontScaling={false}
              style={[st.unit, {
                fontSize: size * UNIT, lineHeight: Math.round(size * UNIT * 1.25),
                marginTop: Math.round(size * 0.175), marginLeft: size * UNIT_GAP,
              }]}
            >
              min
            </Text>
          ) : null}
        </Animated.View>
        {meta ? (
          <Text allowFontScaling={false} style={[st.meta, { fontSize: metaSize, marginTop: u * 0.03 }]}>{meta}</Text>
        ) : null}
      </View>

      <View style={[st.foot, { left: u * 0.11, right: u * 0.11, bottom: foot }]} pointerEvents="none">
        {task ? (
          <Text allowFontScaling={false} style={[st.faint, st.task, { fontSize: taskSize, marginBottom: u * 0.045 }]} numberOfLines={1}>
            {task}
          </Text>
        ) : null}
        <View style={[st.rule, { height: Math.max(1, u * 0.005), borderRadius: u * 0.005 }]}>
          <View style={{ height: '100%', width: ruleW, backgroundColor: C.accent, opacity: 0.75, transform: [{ translateX: (progress - 1) * ruleW }] }} />
        </View>
      </View>
    </>
  );
}

function AmbientBody({ onExit, ...face }: Omit<AmbientProps, 'visible'>) {
  useAmbientSystem();
  const level = useAnimLevel();
  const insets = useSafeAreaInsets();
  // the face is laid out in the screen it fills: the window until the screen has measured itself
  const win = useWindowDimensions();
  const [box, setBox] = React.useState({ width: win.width, height: win.height });
  const { width, height } = box;
  const u = Math.min(width, height);

  // a tap only brings the hint back: leaving takes a deliberate hold, so a brushed screen never ends the view
  const [hint, setHint] = React.useState(true);
  const hintTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const showHint = React.useCallback(() => {
    setHint(true);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(false), 2500);
  }, []);
  React.useEffect(() => {
    showHint();
    return () => { if (hintTimer.current) clearTimeout(hintTimer.current); };
  }, [showHint]);

  const dx = useSharedValue(0);
  const dy = useSharedValue(0);
  React.useEffect(() => {
    let step = 0;
    const iv = setInterval(() => {
      const [x, y] = DRIFT[step++ % DRIFT.length];
      if (level === 'none') {
        dx.value = x;
        dy.value = y;
      } else {
        const ease = { duration: 2000, easing: Easing.inOut(Easing.cubic) };
        dx.value = withTiming(x, ease);
        dy.value = withTiming(y, ease);
      }
    }, 60_000);
    return () => clearInterval(iv);
  }, [level]);
  const driftStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dx.value * u }, { translateY: dy.value * u }] as const,
  }));

  return (
    <Pressable
      style={st.root}
      onLayout={(e) => {
        const { width: w, height: h } = e.nativeEvent.layout;
        if (w > 0 && h > 0 && (Math.abs(w - width) > 0.5 || Math.abs(h - height) > 0.5)) setBox({ width: w, height: h });
      }}
      onPress={showHint}
      onLongPress={onExit}
      delayLongPress={600}
      accessibilityLabel="Deep Work clock. Hold anywhere to exit."
    >
      <StatusBar hidden />
      <Animated.View style={[StyleSheet.absoluteFill, driftStyle]} pointerEvents="none">
        <MonolithFace {...face} width={width} height={height} topInset={insets.top} />
      </Animated.View>
      {hint ? (
        <Animated.Text
          entering={level === 'none' ? undefined : FadeIn.duration(200).easing(EASE_OUT)}
          exiting={level === 'none' ? undefined : FadeOut.duration(400).easing(Easing.inOut(Easing.quad))}
          allowFontScaling={false}
          style={[st.hint, { bottom: u * 0.08, fontSize: Math.max(12, u * 0.034) }]}
        >
          Hold anywhere to exit
        </Animated.Text>
      ) : null}
    </Pressable>
  );
}

interface AmbientProps {
  visible: boolean; timer: TimerState; subject: string; task?: string; startedAt: number | null;
  finishAt: number | null; hour24: boolean;
  onExit: () => void;
}

/**
 * Deep Work's ambient screen (Monolith, picked in the Focus Lab): the minutes as large as the screen allows with the
 * seconds small beside them, on a near-black, dimmed, always-on screen for a phone propped on the desk. The subject
 * sits at the top, the task and a hairline of progress at the foot. The system bars hide, the screen stays awake, and
 * the face drifts a little each minute against burn-in.
 */
export function AmbientView({ visible, onExit, ...rest }: AmbientProps) {
  const level = useAnimLevel();
  return (
    // with motion off the dark screen is simply there, and simply gone
    <Modal visible={visible} animationType={level === 'none' ? 'none' : 'fade'} statusBarTranslucent onRequestClose={onExit}>
      {visible ? (
        // the face leaves with the screen, not digit by digit
        <LayoutAnimationConfig skipExiting>
          <AmbientBody onExit={onExit} {...rest} />
        </LayoutAnimationConfig>
      ) : <View style={st.root} />}
    </Modal>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.ambient },
  top: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  // the kicker's colour is the accent, read at render: a sheet built at load would keep the first accent for good
  kicker: { opacity: 0.8, fontFamily: F.semi, textTransform: 'uppercase', maxWidth: '84%' },
  faint: { color: INK.faint, fontFamily: F.reg, fontVariant: ['tabular-nums'] },
  mid: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  time: { flexDirection: 'row', alignItems: 'flex-start' },
  unit: { color: INK.soft, fontFamily: F.reg },
  meta: { color: INK.soft, fontFamily: F.reg, fontVariant: ['tabular-nums'] },
  foot: { position: 'absolute' },
  task: { textAlign: 'center' },
  rule: { backgroundColor: INK.track, overflow: 'hidden' },
  hint: { position: 'absolute', left: 0, right: 0, textAlign: 'center', color: INK.faint, fontFamily: F.reg },
});
