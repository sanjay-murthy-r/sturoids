import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { C, F, T, TRACK } from '../theme';
import { useStore } from '../store';
import { Card, Row } from '../components/UI';
import { SeenCount, FlowPlaceholder, Track, spokenMinutes, useBoardToday } from './kit';
import { useFocusToday, useTodayItems, useTodaysHabits } from './data';
import type { WidgetProps } from './types';

/**
 * The glance: tasks left, today's habits ticked, and the minutes focused today, against the focus goal when one is set.
 * A cell for an archived tool steps out, and so does the habits cell on a day with none due.
 */
export function GlanceWidget({ editing }: WidgetProps) {
  const today = useBoardToday();
  const archived = useStore((s) => s.settings.archivedTools);
  const goal = useStore((s) => s.settings.focusGoalMin || 0);
  const hideTasks = archived.includes('tasks');
  const hidePlanner = archived.includes('planner');
  const hideFocus = archived.includes('focus');
  const items = useTodayItems();
  const habits = useTodaysHabits();
  const focusToday = useFocusToday();
  const tasksLeft = items.filter((t) => !t.done).length;
  const habitsDone = habits.filter((h) => h.doneDates.includes(today)).length;

  const cells = [
    hideTasks ? null : (
      <Glance key="tasks" value={tasksLeft} label="tasks left" color={C.accent} spoken={tasksLeft + (tasksLeft === 1 ? ' task left' : ' tasks left')} />
    ),
    hidePlanner || !habits.length ? null : (
      <Glance
        key="habits" value={habitsDone} total={habits.length} label="habits" color={C.green}
        spoken={habitsDone + ' of ' + habits.length + ' habits done today'}
      />
    ),
    hideFocus ? null : (
      <Glance
        key="focus" value={focusToday} suffix={goal > 0 ? '/' + goal + ' min' : ' min'} label={goal > 0 ? 'of your goal' : 'focused'}
        color={C.accent} goal={goal > 0 ? focusToday / goal : undefined}
        spoken={spokenMinutes(focusToday) + ' focused today' + (goal > 0 ? ', of a ' + spokenMinutes(goal) + ' goal' : '')}
      />
    ),
  ].filter(Boolean) as React.ReactElement[];
  if (!cells.length) return editing ? <FlowPlaceholder title="Glance" note="Tasks left, habits and focus, for the tools in use." /> : null;
  return (
    <Card pad={0}>
      <Row>
        {cells.map((cell, i) => (
          <React.Fragment key={cell.key}>
            {i > 0 ? <View style={st.vDivider} /> : null}
            {cell}
          </React.Fragment>
        ))}
      </Row>
    </Card>
  );
}

/** One figure of the glance. A screen reader hears it as one phrase (`spoken`), not a number and a word apart. */
function Glance({ value, total, label, color, suffix, spoken, goal }: {
  value: number; total?: number; label: string; color: string; suffix?: string; spoken: string;
  /** progress to the focus goal, 0 to 1 and past it: a slim bar under the figure */
  goal?: number;
}) {
  return (
    <View style={{ flex: 1, alignItems: 'center', paddingVertical: 16 }} accessible accessibilityLabel={spoken}>
      <SeenCount value={value} style={[st.glanceValue, { color }]}>
        {total != null ? '/' + total : null}
        {suffix ? <Text style={st.suffix}>{suffix}</Text> : null}
      </SeenCount>
      <Text style={st.glanceLabel}>{label}</Text>
      {goal != null ? (
        <View style={st.goal}>
          <Track value={goal} color={goal >= 1 ? C.green : C.accent} height={4} />
        </View>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  vDivider: { width: StyleSheet.hairlineWidth, backgroundColor: C.hairline, alignSelf: 'stretch', marginVertical: 12 },
  glanceValue: { ...T.numStat },
  suffix: { fontSize: 13, letterSpacing: TRACK.small, fontFamily: F.semi },
  glanceLabel: { color: C.textFaint, fontFamily: F.smMed, fontSize: 11, marginTop: 3, letterSpacing: TRACK.fine },
  goal: { width: 56, marginTop: 7 },
});
