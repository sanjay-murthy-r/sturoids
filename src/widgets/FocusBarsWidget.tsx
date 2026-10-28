import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { C, F, MIN, T, TRACK, neuInset } from '../theme';
import { useStore } from '../store';
import { DAY_NAMES, todayKey } from '../utils';
import { Card, Hairline, Row, SectionTitle, useTheme } from '../components/UI';
import { CHANGE, CountUp, EASE_OUT, useAnimLevel } from '../components/Motion';
import { SeenCount, spokenMinutes, useBoardNow, useWhenSeen } from './kit';
import { useLiveMin } from './data';
import type { WidgetProps } from './types';

/** Focus, last 7 days: a carved trough a day, its fill easing up from the floor, today in the accent. */
export function FocusBarsWidget(_: WidgetProps) {
  const now = useBoardNow();
  const today = todayKey(now);
  const sessions = useStore((s) => s.sessions);
  const liveMin = useLiveMin(now, today);
  const weekBars = React.useMemo(() => {
    const out: { label: string; mins: number }[] = [];
    const [y, m, d] = today.split('-').map(Number);
    for (let i = 6; i >= 0; i--) {
      const day = new Date(y, m - 1, d - i);
      const key = todayKey(day);
      const mins = Math.round(sessions.filter((s) => s.dateKey === key).reduce((a, s) => a + s.netSeconds, 0) / 60);
      out.push({ label: DAY_NAMES[(day.getDay() + 6) % 7][0], mins: i === 0 ? mins + liveMin : mins });
    }
    return out;
  }, [sessions, today, liveMin]);
  const maxMins = Math.max(30, ...weekBars.map((b) => b.mins));
  const weekTotal = weekBars.reduce((a, b) => a + b.mins, 0);
  return (
    <View>
      <SectionTitle>Focus, last 7 days</SectionTitle>
      <Card>
        {/* a screen reader hears the week as one sentence, not seven loose figures and letters */}
        <View accessible accessibilityLabel={weekTotal > 0 ? 'Focus in the last 7 days, ' + spokenMinutes(weekTotal) : 'No focus in the last 7 days'}>
          <Row style={{ alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: 4 }}>
            {weekBars.map((b, i) => (
              <WeekBar key={i} label={b.label} mins={b.mins} maxMins={maxMins} isToday={i === 6} />
            ))}
          </Row>
          {/* a week with no focus says nothing about it: the empty troughs say it */}
          {weekTotal > 0 ? (
            <>
              <Hairline />
              <Text style={[T.caption, { textAlign: 'center', marginTop: 10 }]}>
                <SeenCount value={weekTotal} style={st.weekCount}> min</SeenCount> focused in the last 7 days
              </Text>
            </>
          ) : null}
        </View>
      </Card>
    </View>
  );
}

/** Carved vertical trough with a fill that eases up from the bottom: seven bars moving together must never bounce. */
const BAR_EASE = { duration: 360, easing: EASE_OUT };

function WeekBar({ label, mins: minsNow, maxMins: maxNow, isToday }: {
  label: string; mins: number; maxMins: number; isToday: boolean;
}) {
  const theme = useTheme();
  const level = useAnimLevel();
  // a week that changed behind another tab moves once Today is back in view
  const mins = useWhenSeen(minsNow);
  const maxMins = useWhenSeen(maxNow);
  const target = Math.max(4, (mins / maxMins) * 56);
  const h = useSharedValue(target);
  React.useEffect(() => {
    h.value = level === 'none' ? target : withTiming(target, level === 'full' ? BAR_EASE : CHANGE);
  }, [target, level]);
  // a full-height fill rises from the trough floor: a transform, never a height
  const fillStyle = useAnimatedStyle(() => ({ transform: [{ translateY: 56 - h.value }] }));
  const fillColor = isToday ? C.accent : C.slate + '73';
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      {mins > 0 && <CountUp value={mins} style={st.barValue} />}
      <View
        style={[
          st.barTrough,
          theme === 'minimal'
            ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border }
            : { backgroundColor: C.inset, ...neuInset('hairline') },
        ]}
      >
        <Animated.View style={[{ width: '100%', height: 56, borderRadius: 8, backgroundColor: fillColor }, fillStyle]} />
      </View>
      <Text style={[st.barLabel, isToday && { color: C.accent, fontFamily: F.smSemi }]}>{label}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  barValue: { color: C.textFaint, fontFamily: F.med, fontSize: 11, letterSpacing: TRACK.fine, marginBottom: 4, fontVariant: ['tabular-nums'] },
  barLabel: { color: C.textFaint, fontFamily: F.smMed, fontSize: 11, letterSpacing: TRACK.fine, marginTop: 7 },
  // the week's minutes in the caption under it: a count, so Inter Tight with tabular figures
  weekCount: { color: C.accent, fontFamily: F.semi, fontVariant: ['tabular-nums'] },
  barTrough: { width: 16, height: 56, borderRadius: 8, overflow: 'hidden', justifyContent: 'flex-end' },
});
