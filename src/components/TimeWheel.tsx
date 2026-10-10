import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { C, CHROME_FONT_MAX, F, MIN, TRACK, ThemeMode, shownTheme } from '../theme';
import { useStore } from '../store';
import { fmtClockTime } from '../utils';
import { Wheel, WheelLabel } from './Wheel';
import { Bouncy, CHANGE, useAnimLevel } from './Motion';

// The time wheel: the app's own wheels set to a clock. It lives apart from UI.tsx (which re-exports it and builds the
// TimeField row on it) and draws its one chip itself, so the two files never import each other.

/** The end of the day, which a block's end may be: '24:00'. */
const END_OF_DAY = 1440;

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Minutes since midnight as 'HH:MM' (1440 is '24:00'). */
export const hhmm = (mins: number) => `${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}`;

/** 'HH:MM' as minutes since midnight: 0 to 1439, 1440 for '24:00', or -1 when it is not a time. */
export function parseTime(value: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec((value || '').trim());
  if (!m) return -1;
  const h = +m[1];
  const min = +m[2];
  if (h === 24 && min === 0) return END_OF_DAY;
  if (h > 23 || min > 59) return -1;
  return h * 60 + min;
}

/** Whether a value is a time to show: '24:00' only where the end of the day is allowed. */
export const isTime = (value: string, allowEndOfDay = false) => {
  const t = parseTime(value);
  return t >= 0 && (t < END_OF_DAY || allowEndOfDay);
};

/** A time as the user's clock reads it, "4:30 pm" or "16:30", and the end of the day as "Midnight". */
export function timeLabel(value: string, hour24: boolean): string {
  const t = parseTime(value);
  if (t < 0) return value;
  return t === END_OF_DAY ? 'Midnight' : fmtClockTime(t, hour24);
}

/** A time to start the wheels on when there is none yet: the next whole hour, kept inside the day. */
export function defaultTime(now = new Date()): string {
  return hhmm(Math.min((now.getHours() + 1) * 60, END_OF_DAY - 5));
}

const ROW_H = 52;

/**
 * A time picked on the app's wheels: the hours (1 to 12 and a wheel for am and pm, or 0 to 23), then the minutes in
 * steps of `step`, under a readout of the time they make. It is controlled: `value` is 'HH:MM' and every settled turn
 * of a wheel calls `onChange` with the new one. A value off the step shows at the nearest step, and is kept exactly as
 * it is until a wheel is turned. With `allowEndOfDay` a flat Midnight chip adds '24:00'; while it is on, the wheels
 * rest dimmed, and turning one picks its time instead. Each wheel is adjustable for a screen reader ("Hour, 4 pm").
 */
export function TimeWheel({ value, onChange, hour24, step = 5, allowEndOfDay = false }: {
  value: string; onChange: (value: string) => void; hour24: boolean; step?: number; allowEndOfDay?: boolean;
}) {
  useStore((s) => s.settings.accent); // the chip's tint is the accent: follow a new one
  const theme = shownTheme(useStore((s) => s.settings.theme));
  const level = useAnimLevel();
  const stepMin = step > 0 && step <= 60 && 60 % step === 0 ? step : 5;
  const lastStep = END_OF_DAY - stepMin;

  const parsed = parseTime(value);
  const endOfDay = allowEndOfDay && parsed === END_OF_DAY;
  // the time the wheels held when Midnight was chosen, so turning it off goes back there
  const beforeEnd = React.useRef<number | null>(null);
  // where the wheels start with no time to show, taken once so a minute turning over never moves them
  const fallback = React.useRef(-1);
  if (fallback.current < 0) fallback.current = parseTime(defaultTime());
  // what the wheels show: the value (or, with none, the default) at its nearest step, or while Midnight is on, the time
  // before it
  const shown = endOfDay
    ? beforeEnd.current ?? lastStep
    : Math.min(lastStep, Math.round((parsed >= 0 ? parsed : fallback.current) / stepMin) * stepMin);
  // The time the wheels were last turned to, read by their handlers. A wheel settles a moment before the screen has
  // drawn its new value, so two quick turns must build on each other, not on the value drawn before both.
  const latest = React.useRef(shown);
  const seen = React.useRef(value);
  if (seen.current !== value) {
    seen.current = value;
    latest.current = shown;
  }
  const changeRef = React.useRef(onChange);
  changeRef.current = onChange;
  const commit = React.useCallback((mins: number) => {
    latest.current = mins;
    changeRef.current(hhmm(mins));
  }, []);

  const hour = Math.floor(shown / 60);
  const pm = hour >= 12;
  const onHour = React.useCallback((i: number) => {
    const cur = latest.current;
    const h = hour24 ? i : (i % 12) + (cur >= 720 ? 12 : 0);
    commit(h * 60 + (cur % 60));
  }, [hour24, commit]);
  const onMinute = React.useCallback((i: number) => {
    const cur = latest.current;
    commit(Math.floor(cur / 60) * 60 + i * stepMin);
  }, [stepMin, commit]);
  const onHalf = React.useCallback((i: number) => {
    const cur = latest.current;
    commit(((Math.floor(cur / 60) % 12) + (i === 1 ? 12 : 0)) * 60 + (cur % 60));
  }, [commit]);
  const toggleEnd = () => {
    if (endOfDay) {
      commit(latest.current);
      return;
    }
    beforeEnd.current = latest.current;
    changeRef.current(hhmm(END_OF_DAY));
  };

  const hourLabel = React.useCallback((i: number): WheelLabel => {
    if (hour24) return { full: pad2(i), spoken: String(i) };
    const h = i === 0 ? 12 : i;
    return { full: String(h), spoken: h + (pm ? ' pm' : ' am') };
  }, [hour24, pm]);
  const minuteLabel = React.useCallback((i: number): WheelLabel => ({ full: pad2(i * stepMin), spoken: String(i * stepMin) }), [stepMin]);
  const halfLabel = React.useCallback((i: number): WheelLabel => (i ? { full: 'pm', spoken: 'PM' } : { full: 'am', spoken: 'AM' }), []);

  // the wheels rest dimmed while Midnight stands in for them, and come back as one is turned
  const dim = useSharedValue(endOfDay ? 1 : 0);
  React.useEffect(() => {
    dim.value = level === 'none' ? (endOfDay ? 1 : 0) : withTiming(endOfDay ? 1 : 0, CHANGE);
  }, [endOfDay, level]);
  const wheelsStyle = useAnimatedStyle(() => ({ opacity: 1 - 0.6 * dim.value }));

  // the readout says the time that will be kept: the value itself (even off the step) or, before there is one, the wheels'
  const said = endOfDay ? 'Midnight' : timeLabel(parsed >= 0 && parsed < END_OF_DAY ? value : hhmm(shown), hour24);
  const space = said.indexOf(' ');
  const clock = !hour24 && !endOfDay && space > 0 ? said.slice(0, space) : said;
  const half = clock === said ? '' : said.slice(space);

  return (
    <View style={st.wrap}>
      <Text style={st.readout} maxFontSizeMultiplier={CHROME_FONT_MAX}>
        {clock}
        {half ? <Text style={st.half}>{half}</Text> : null}
      </Text>
      <Animated.View style={wheelsStyle}>
        <Wheel
          loop count={hour24 ? 24 : 12} index={hour24 ? hour : hour % 12} onChange={onHour} label={hourLabel}
          spacing={64} minScale={0.6} colorOn={C.text} colorOff={C.textFaint} height={ROW_H} textStyle={st.num}
          accessibilityLabel="Hour"
        />
        <Wheel
          loop count={60 / stepMin} index={(shown % 60) / stepMin} onChange={onMinute} label={minuteLabel}
          spacing={64} minScale={0.6} colorOn={C.text} colorOff={C.textFaint} height={ROW_H} textStyle={st.num}
          accessibilityLabel="Minute"
        />
        {hour24 ? null : (
          <Wheel
            count={2} index={pm ? 1 : 0} onChange={onHalf} label={halfLabel}
            spacing={76} minScale={0.6} colorOn={C.text} colorOff={C.textFaint} height={ROW_H} textStyle={st.num}
            accessibilityLabel="AM or PM"
          />
        )}
      </Animated.View>
      {allowEndOfDay ? <MidnightChip on={endOfDay} theme={theme} onPress={toggleEnd} /> : null}
    </View>
  );
}

/**
 * The end of the day as a flat chip, drawn as UI's Chip is (an outline at rest, the accent's tint when on, the two
 * inks crossing over), so this file needs nothing from UI.tsx.
 */
function MidnightChip({ on, theme, onPress }: { on: boolean; theme: ThemeMode; onPress: () => void }) {
  const level = useAnimLevel();
  const v = useSharedValue(on ? 1 : 0);
  React.useEffect(() => {
    v.value = level === 'none' ? (on ? 1 : 0) : withTiming(on ? 1 : 0, CHANGE);
  }, [on, level]);
  const lit = useAnimatedStyle(() => ({ opacity: v.value }));
  const rest = useAnimatedStyle(() => ({ opacity: 1 - v.value }));
  const c = C.accent;
  return (
    <Bouncy
      onPress={onPress} scaleTo={0.94} radius={999} hitSlop={{ top: 8, bottom: 8, left: 5, right: 5 }}
      accessibilityRole="switch" accessibilityState={{ checked: on }} accessibilityLabel="Midnight, the end of the day"
      style={st.chip}
    >
      <Animated.View pointerEvents="none" style={[st.chipEdge, { borderColor: theme === 'minimal' ? MIN.border : C.outline }, rest]} />
      <Animated.View pointerEvents="none" style={[st.chipEdge, { backgroundColor: c + '1F', borderColor: c + '66' }, lit]} />
      <View>
        <Animated.Text style={[st.chipText, rest]} maxFontSizeMultiplier={CHROME_FONT_MAX}>Midnight</Animated.Text>
        <Animated.Text
          style={[st.chipText, st.ink, { color: c }, lit]} maxFontSizeMultiplier={CHROME_FONT_MAX}
          importantForAccessibility="no" accessibilityElementsHidden
        >
          Midnight
        </Animated.Text>
      </View>
    </Bouncy>
  );
}

const st = StyleSheet.create({
  wrap: { alignSelf: 'stretch' },
  // the time the wheels make, as a clock reads: the counting face, like Deep Work's clock
  readout: {
    color: C.text, fontFamily: F.num, fontSize: 40, lineHeight: 48, textAlign: 'center', marginBottom: 8,
    fontVariant: ['tabular-nums'],
  },
  half: { color: C.textDim, fontFamily: F.med, fontSize: 16, letterSpacing: TRACK.body },
  // the wheels' figures, set as the Planner's day wheel is
  num: { fontFamily: F.semi, fontSize: 22, lineHeight: 28, letterSpacing: TRACK.large, fontVariant: ['tabular-nums'] },
  chip: {
    alignSelf: 'center', marginTop: 14, paddingVertical: 5, paddingHorizontal: 11, borderRadius: 999, overflow: 'hidden',
  },
  chipEdge: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 999, borderWidth: 1 },
  chipText: { color: C.textDim, fontFamily: F.med, fontSize: 12, letterSpacing: TRACK.fine },
  ink: { position: 'absolute', top: 0, left: 0, right: 0 },
});
