import React from 'react';
import { AppState, Modal, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { StatusBar } from 'expo-status-bar';
import { useKeepAwake } from 'expo-keep-awake';
import * as Brightness from 'expo-brightness';
import * as NavigationBar from 'expo-navigation-bar';
import { C, F, T } from '../theme';
import { fmtClockTime } from '../utils';
import { TimerState, displayOf, useSessionTick } from '../deepWork';
import { useAnimLevel } from './Motion';

/** the ambient screen never brightens a dim room: it only ever lowers the phone to this */
const DIM_TO = 0.4;
/** burn-in care: the stack visits these offsets, one step a minute */
const DRIFT: [number, number][] = [[8, -8], [-8, 8], [8, 8], [-8, -8], [0, 0]];
const MONO_ADVANCE = 0.6;

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

/** The clock, its progress rule and the end time: the only part that renders each second. */
function Clock({ timer, width, finishAt, hour24 }: { timer: TimerState; width: number; finishAt: number | null; hour24: boolean }) {
  useSessionTick(timer);
  const raw = displayOf(timer);
  const secs = timer.mode === 'countdown' ? Math.ceil(raw) : Math.floor(raw);
  const text = pad2(Math.floor(secs / 3600)) + ':' + pad2(Math.floor((secs % 3600) / 60)) + ':' + pad2(secs % 60);
  // sized for 00:00:00 and held at that width, so nothing shifts when the hour digit changes
  const size = Math.min(68, Math.floor((width - 40) / (8 * MONO_ADVANCE)));
  const boxW = Math.ceil(8 * MONO_ADVANCE * size);
  const progress = timer.mode === 'countdown' ? Math.min(1, Math.max(0, 1 - raw / (timer.targetMin * 60))) : null;
  let meta = '';
  if (timer.mode === 'countdown') meta = timer.running ? 'Ends ' + clockAt(Date.now() + raw * 1000, hour24) : 'Paused';
  else if (finishAt) meta = 'Finish ' + clockAt(finishAt, hour24);
  else if (!timer.running) meta = 'Paused';

  return (
    <View style={st.center}>
      <Text style={[st.clock, { fontSize: size, lineHeight: Math.round(size * 1.15), width: boxW }]} numberOfLines={1}>{text}</Text>
      {progress != null ? (
        <View style={[st.rule, { width: boxW }]}>
          <View style={{ height: 2, width: `${progress * 100}%`, backgroundColor: C.accent }} />
        </View>
      ) : null}
      {meta ? <Text style={st.meta}>{meta}</Text> : null}
    </View>
  );
}

function AmbientBody({ timer, subject, task, finishAt, hour24, onExit }: Omit<AmbientProps, 'visible'>) {
  useAmbientSystem();
  const level = useAnimLevel();
  const { width } = useWindowDimensions();

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
  const driftStyle = useAnimatedStyle(() => ({ transform: [{ translateX: dx.value }, { translateY: dy.value }] as const }));

  return (
    <Pressable
      style={st.root}
      onPress={showHint}
      onLongPress={onExit}
      delayLongPress={600}
      accessibilityLabel="Deep Work clock. Hold anywhere to exit."
    >
      <StatusBar hidden />
      <Animated.View style={[st.center, driftStyle]}>
        {subject ? <Text style={[st.subject, { color: C.accent }]} numberOfLines={1}>{subject}</Text> : null}
        <Clock timer={timer} width={width} finishAt={finishAt} hour24={hour24} />
        {task ? <Text style={st.task} numberOfLines={1}>{task}</Text> : null}
      </Animated.View>
      {hint ? (
        <Animated.Text entering={FadeIn.duration(200)} exiting={FadeOut.duration(400)} style={st.hint}>
          Hold anywhere to exit
        </Animated.Text>
      ) : null}
    </Pressable>
  );
}

interface AmbientProps {
  visible: boolean; timer: TimerState; subject: string; task?: string; finishAt: number | null; hour24: boolean;
  onExit: () => void;
}

/**
 * Deep Work's ambient screen: a near-black, dimmed, always-on clock for a phone propped on the desk. The
 * system bars hide, the screen stays awake, and the stack drifts a few points each minute against burn-in.
 */
export function AmbientView({ visible, onExit, ...rest }: AmbientProps) {
  return (
    <Modal visible={visible} animationType="fade" statusBarTranslucent onRequestClose={onExit}>
      {visible ? <AmbientBody onExit={onExit} {...rest} /> : <View style={st.root} />}
    </Modal>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.ambient, alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center' },
  subject: { fontFamily: F.semi, fontSize: 24, marginBottom: 18, maxWidth: 320, textAlign: 'center' },
  clock: { ...T.numAmbient, textAlign: 'center', fontVariant: ['tabular-nums'] },
  rule: { height: 2, marginTop: 18, backgroundColor: C.textFaint + '4D', overflow: 'hidden' },
  meta: { color: C.textDim, fontFamily: F.reg, fontSize: 18, marginTop: 16, fontVariant: ['tabular-nums'] },
  task: { color: C.textDim, fontFamily: F.reg, fontSize: 18, marginTop: 30, maxWidth: 300, textAlign: 'center' },
  hint: { position: 'absolute', bottom: 40, color: C.textFaint, fontFamily: F.reg, fontSize: 12 },
});
