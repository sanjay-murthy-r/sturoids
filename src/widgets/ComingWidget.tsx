import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C, F, S, TRACK } from '../theme';
import { useStore } from '../store';
import { indexScores, upcoming } from '../scores';
import { openScoreNode } from '../scoresNav';
import { openTool } from '../toolNav';
import { DayPill, FlowPlaceholder, useBoardToday } from './kit';
import { comingUp, dPill } from './logic';
import type { WidgetProps } from './types';

/**
 * Coming up: up to four quiet rows, the exams in the next 30 days and the long-term tasks due in the week ahead,
 * soonest first, each with how many days off it is; each opens its own item. Gone with nothing ahead.
 */
export function ComingWidget({ editing }: WidgetProps) {
  const today = useBoardToday();
  const hideTasks = useStore((s) => s.settings.archivedTools.includes('tasks'));
  const hideScores = useStore((s) => s.settings.archivedTools.includes('scores'));
  const scores = useStore((s) => s.scores);
  const missions = useStore((s) => s.missions);
  const exams = React.useMemo(() => (hideScores ? [] : upcoming(indexScores(scores), null, today)), [hideScores, scores, today]);
  const rows = React.useMemo(() => comingUp(exams, hideTasks ? [] : missions, today), [exams, hideTasks, missions, today]);
  if (!rows.length) return editing ? <FlowPlaceholder title="Coming up" note="Exams in the next 30 days and tasks due this week." /> : null;
  return (
    <View style={st.box}>
      {rows.map((r) => {
        const open = r.kind === 'exam'
          ? () => { openScoreNode(r.id); openTool('scores'); }
          : () => openTool('tasks', { item: r.id });
        const when = r.days === 0 ? 'today' : r.days === 1 ? 'tomorrow' : 'in ' + r.days + ' days';
        return (
          <Pressable
            key={r.kind + r.id} onPress={open} style={({ pressed }) => [st.row, pressed && { opacity: 0.6 }]}
            accessibilityRole="button" accessibilityLabel={(r.kind === 'exam' ? 'Exam, ' : 'Task due, ') + r.title + ', ' + when}
            accessibilityHint={r.kind === 'exam' ? 'Opens the exam in Scores' : 'Opens the task'}
          >
            <Ionicons
              name={r.kind === 'exam' ? 'ribbon-outline' : 'flag-outline'} size={15}
              color={C.textFaint} style={st.icon}
            />
            <Text style={st.text} numberOfLines={1}>{r.title}</Text>
            <DayPill label={dPill(r.days)} color={r.days <= 1 ? C.amber : r.kind === 'exam' ? C.accent : C.textFaint} />
          </Pressable>
        );
      })}
    </View>
  );
}

const st = StyleSheet.create({
  // quiet rows with no surface, under the glance: nearer it than the next section
  box: { marginTop: -4, marginBottom: S.gap - 4 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: 4 },
  icon: { marginRight: 10 },
  text: { flex: 1, color: C.textDim, fontFamily: F.smMed, fontSize: 13, letterSpacing: TRACK.small },
});
