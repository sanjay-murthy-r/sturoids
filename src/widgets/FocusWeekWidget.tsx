import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { C, F, TRACK } from '../theme';
import { useStore } from '../store';
import { DAY_NAMES, focusStreak } from '../utils';
import { focusWeek } from '../subjects';
import { colorForSubject } from '../blocks';
import { openPage } from '../toolNav';
import { Kicker, TILE_TEXT_MAX, Tile, kit, spokenMinutes, useBoardToday } from './kit';
import type { WidgetProps } from './types';

/** the colours the week's subjects take, most focused first, when the Planner has none of its own for them */
const SUBJECT_INKS = () => [C.accent, C.teal, C.gold, C.pink];
const BAR_H = 128;

const hm = (min: number) => (min >= 60 ? Math.floor(min / 60) + ' h' + (min % 60 ? ' ' + (min % 60) + ' min' : '') : min + ' min');

/**
 * Focus week: the last seven days as bars stacked by subject, the week's total, the run of days focused and the best
 * day. Opens the history.
 */
export function FocusWeekWidget({ size }: WidgetProps) {
  const today = useBoardToday();
  const sessions = useStore((s) => s.sessions);
  const planner = useStore((s) => s.planner);
  const week = React.useMemo(() => focusWeek(sessions, today), [sessions, today]);
  const streak = React.useMemo(() => focusStreak(sessions).current, [sessions, today]);
  // the subjects of the week, most focused first: the first three keep a colour each, the rest share a quiet one
  const inks = React.useMemo(() => {
    const total = new Map<string, { name: string; min: number }>();
    for (const d of week.days) for (const s of d.bySubject) {
      const was = total.get(s.key);
      total.set(s.key, { name: s.name, min: (was?.min || 0) + s.min });
    }
    const order = [...total.entries()].sort((a, b) => b[1].min - a[1].min);
    const palette = SUBJECT_INKS();
    const out = new Map<string, string>();
    order.forEach(([key, v], i) => {
      out.set(key, (key && colorForSubject(planner, v.name)) || (i < 3 && key ? palette[i] : C.slate + '99'));
    });
    return out;
  }, [week, planner]);
  const max = Math.max(30, ...week.days.map((d) => d.min));
  const dayOf = (key: string) => DAY_NAMES[(new Date(key + 'T00:00:00').getDay() + 6) % 7];
  const label = week.totalMin
    ? 'Focus this week, ' + spokenMinutes(week.totalMin) + (streak > 1 ? ', a ' + streak + ' day run' : '')
    : 'No focus this week';
  return (
    <Tile size={size} onPress={() => openPage('/focus-history')} label={label} hint="Opens the focus history">
      <Kicker>Focus, this week</Kicker>
      <Text style={st.total} maxFontSizeMultiplier={TILE_TEXT_MAX}>{week.totalMin ? hm(week.totalMin) : 'Nothing yet'}</Text>
      <Text style={[kit.sub, { color: streak > 1 ? C.green : C.textFaint }]} numberOfLines={1} maxFontSizeMultiplier={TILE_TEXT_MAX}>
        {[streak > 1 ? streak + '-day run' : '', week.best ? 'Best ' + dayOf(week.best.dateKey) + ', ' + week.best.min + ' min' : '']
          .filter(Boolean).join(' · ') || 'A session a day starts a run'}
      </Text>
      <View style={st.bars}>
        {week.days.map((d, i) => (
          <View key={d.dateKey} style={st.col}>
            <View style={[st.trough, { backgroundColor: C.inset }]}>
              {/* the day's subjects stacked from the floor, most focused at the bottom */}
              <View style={{ height: Math.max(d.min ? 4 : 0, (d.min / max) * BAR_H), width: '100%', borderRadius: 6, overflow: 'hidden' }}>
                {[...d.bySubject].reverse().map((s) => (
                  <View key={s.key} style={{ flex: s.min, backgroundColor: inks.get(s.key) || C.slate }} />
                ))}
              </View>
            </View>
            <Text style={[st.day, i === 6 && { color: C.accent, fontFamily: F.smSemi }]} maxFontSizeMultiplier={TILE_TEXT_MAX}>
              {dayOf(d.dateKey)[0]}
            </Text>
          </View>
        ))}
      </View>
    </Tile>
  );
}

const st = StyleSheet.create({
  total: { color: C.text, fontFamily: F.num, fontSize: 28, lineHeight: 34, fontVariant: ['tabular-nums'], marginTop: 6 },
  bars: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginTop: 10 },
  col: { flex: 1, alignItems: 'center' },
  trough: { width: '100%', maxWidth: 26, height: BAR_H, borderRadius: 6, justifyContent: 'flex-end', overflow: 'hidden' },
  day: { color: C.textFaint, fontFamily: F.smMed, fontSize: 11, letterSpacing: TRACK.fine, marginTop: 6 },
});
