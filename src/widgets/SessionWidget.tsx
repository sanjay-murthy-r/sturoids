import React from 'react';
import { View, Text, StyleSheet, AppState, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { C, F, TRACK, oneLine } from '../theme';
import { useStore } from '../store';
import { openTool } from '../toolNav';
import { Bouncy } from '../components/Motion';
import { Kicker, TILE_TEXT_MAX, Tile, Track, kit } from './kit';
import { useFocusToday } from './data';
import type { WidgetProps } from './types';

const PRESETS = [25, 50, 90];

/** "12:05", or "1:02:05" past the hour */
function clock(secs: number) {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(r).padStart(2, '0');
}

/**
 * Session: while Deep Work runs, its live time (left on a block, or gone on a stopwatch) and a button that opens it to
 * pause; otherwise three lengths to start one with, and today's minutes against the focus goal.
 */
export function SessionWidget({ size, preview }: WidgetProps) {
  const on = useStore((s) => !!s.deepWork);
  const running = useStore((s) => !!s.deepWork?.running);
  const startTs = useStore((s) => s.deepWork?.startTs ?? null);
  const accum = useStore((s) => s.deepWork?.accumSec ?? 0);
  const countdown = useStore((s) => s.deepWork?.mode === 'countdown');
  const target = useStore((s) => (s.deepWork?.targetMin ?? 0) * 60);
  const subject = useStore((s) => s.deepWork?.subject ?? '');
  const goal = useStore((s) => s.settings.focusGoalMin || 0);
  const last = useStore((s) => s.settings.focusLastMin || 25);
  const today = useFocusToday();
  const secs = useTicking(on && running && !preview, () => {
    const gone = accum + (running && startTs ? Math.max(0, Date.now() - startTs) / 1000 : 0);
    return countdown ? Math.max(0, target - gone) : gone;
  }, [accum, running, startTs, countdown, target]);

  const goalLine = goal > 0 ? today + ' of ' + goal + ' min today' : today ? today + ' min today' : 'No focus yet today';
  if (on) {
    return (
      <Tile size={size} pad={16} onPress={() => openTool('focus')} label={'Deep Work' + (subject ? ', ' + subject : '') + (running ? ', running' : ', paused')} hint="Opens the session">
        <View style={st.row}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Kicker color={C.accent}>{(subject || 'Deep Work') + ' · ' + (running ? 'running' : 'paused')}</Kicker>
            <Text style={st.timer} maxFontSizeMultiplier={TILE_TEXT_MAX}>{clock(secs)}</Text>
            <Text style={kit.sub} maxFontSizeMultiplier={TILE_TEXT_MAX}>{goalLine}</Text>
            {goal > 0 ? <View style={{ marginTop: 6 }}><Track value={today / goal} color={C.green} height={4} /></View> : null}
          </View>
          {/* pausing is Deep Work's own: its screen keeps the session's clock and its end notice, so this opens it */}
          <Bouncy
            onPress={() => openTool('focus')} radius={999} scaleTo={0.92}
            accessibilityLabel={running ? 'Pause in Deep Work' : 'Resume in Deep Work'} style={[st.key, { borderColor: C.accent + '66' }]}
          >
            <Ionicons name={running ? 'pause' : 'play'} size={20} color={C.accent} />
          </Bouncy>
        </View>
      </Tile>
    );
  }
  return (
    <Tile size={size} pad={16}>
      <Kicker color={C.accent}>Deep Work</Kicker>
      <Text style={st.timer} maxFontSizeMultiplier={TILE_TEXT_MAX}>{last} min</Text>
      <View style={st.presets}>
        {PRESETS.map((m) => (
          <Pressable
            key={m} onPress={() => openTool('focus', { minutes: m })} hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
            accessibilityRole="button" accessibilityLabel={'Focus for ' + m + ' minutes'}
            style={[st.chip, { borderColor: m === last ? C.accent + '88' : C.outline }]}
          >
            <Text style={[st.chipText, { color: m === last ? C.accent : C.textDim }]} maxFontSizeMultiplier={TILE_TEXT_MAX}>{m}</Text>
          </Pressable>
        ))}
        <Text style={[kit.sub, { marginLeft: 'auto' }]} numberOfLines={1} maxFontSizeMultiplier={TILE_TEXT_MAX}>{goalLine}</Text>
      </View>
    </Tile>
  );
}

/**
 * A value read every second while `on`, Today is in view and the app is in front; read once otherwise. The reader
 * goes through a ref, so the second's timer never holds an old one.
 */
function useTicking(on: boolean, read: () => number, deps: unknown[]): number {
  const focused = useIsFocused();
  const readRef = React.useRef(read);
  readRef.current = read;
  const [v, setV] = React.useState(read);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(() => { setV(readRef.current()); }, deps);
  React.useEffect(() => {
    if (!on || !focused) return undefined;
    let timer: ReturnType<typeof setInterval> | null = setInterval(() => setV(readRef.current()), 1000);
    const sub = AppState.addEventListener('change', (state) => {
      if (timer) clearInterval(timer);
      timer = null;
      if (state === 'active') {
        setV(readRef.current());
        timer = setInterval(() => setV(readRef.current()), 1000);
      }
    });
    return () => {
      if (timer) clearInterval(timer);
      sub.remove();
    };
  }, [on, focused]);
  return v;
}

const st = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14 },
  timer: { color: C.text, fontFamily: F.num, fontSize: 38, lineHeight: 46, fontVariant: ['tabular-nums'], marginTop: 4 },
  key: { width: 48, height: 48, borderRadius: 24, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  presets: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 'auto' },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  chipText: { fontFamily: F.med, ...oneLine(13), letterSpacing: TRACK.small, fontVariant: ['tabular-nums'] },
});
