import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { C, F, MIN, S, T, TRACK } from '../src/theme';
import { useStore } from '../src/store';
import { subjectSummary } from '../src/subjects';
import { fmtExamDate, fmtPct, fromToday } from '../src/scores';
import { fmtClockTime, toMinutes } from '../src/utils';
import {
  Card, EmptyState, ListCard, ListRow, PillButton, ScreenBG, SectionTitle, contextLine, useTheme, useToolHeader,
} from '../src/components/UI';
import { useExport } from '../src/reports';
import { Enter } from '../src/components/Motion';
import { Sparkline } from '../src/components/Sparkline';
import { useNow, useToday } from '../src/hooks/useNow';
import { openTool } from '../src/toolNav';
import { openScoreNode } from '../src/scoresNav';
import { tick } from '../src/haptics';
import { fmtMins } from '../src/screens/FocusScreen';
import { READ_MAX, frame } from '../src/layout';

/** The words a day ahead is called by: "Today", "Tomorrow", "Fri", or a date past the week. */
function dayWord(inDays: number, dateKey: string): string {
  if (inDays === 0) return 'Today';
  if (inDays === 1) return 'Tomorrow';
  return new Date(dateKey + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long' });
}

/**
 * One subject across the app (`key`, its name as `name`): the focus on it this week and over 30 days, its results over
 * time, its next class, its next exam and its notes. Reached from Sift, from Scores (a subject's menu) and from links
 * that name a subject. Every part leads to where it lives; a part with nothing in it is left out.
 */
export default function SubjectPage() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const params = useLocalSearchParams<{ key?: string; name?: string }>();
  const subject = String(params.name || params.key || '').trim();
  const sessions = useStore((s) => s.sessions);
  const notes = useStore((s) => s.notes);
  const planner = useStore((s) => s.planner);
  const scores = useStore((s) => s.scores);
  const notesLocked = useStore((s) => s.settings.notesLocked);
  const archived = useStore((s) => s.settings.archivedTools);
  const hour24 = useStore((s) => s.settings.hour24);
  const today = useToday();
  // the next class turns over as the hour passes, only while the page is in front
  const now = useNow();
  const sum = React.useMemo(
    () => subjectSummary({ sessions, notes, planner, scores, settings: { notesLocked } }, subject, now),
    [sessions, notes, planner, scores, notesLocked, subject, now, today],
  );
  const off = new Set<string>(archived || []);

  const exp = useExport('subject', { subject: sum.name || subject });
  const tool = useToolHeader({
    title: sum.name || 'Subject',
    mode: 'page',
    actions: [exp.action],
    context: contextLine(
      sum.weekMin > 0 && [{ em: fmtMins(sum.weekMin) }, ' this week'],
      sum.nextExam && [sum.nextExam.title + ' ', { em: fromToday(sum.nextExam.date, today).toLowerCase() }],
    ),
  });

  const sparkMax = Math.max(1, ...sum.spark);
  const track = theme === 'minimal' ? MIN.inset : C.inset;
  const nothing = !sum.totalMin && !sum.trend.length && !sum.nextClass && !sum.nextExam && !sum.notes.length && !sum.notesHidden;
  const openExam = (id: string) => { tick(); openScoreNode(id); openTool('scores'); };
  let enter = 0;

  return (
    <ScreenBG>
      {tool.bar}
      <Animated.ScrollView
        {...tool.scrollProps}
        contentContainerStyle={[frame(READ_MAX), { padding: S.pad, paddingTop: tool.padTop, paddingBottom: 40 + insets.bottom }]}
      >
        <Enter index={enter++}>
          {tool.hero}
          {nothing ? (
            <EmptyState
              icon="school-outline" title={'Nothing on ' + (sum.name || 'this subject') + ' yet'}
              body="Focus on it, plan it, write a note about it or sit an exam in it, and it all gathers here."
              actionLabel={off.has('focus') ? undefined : 'Focus on it'}
              onAction={off.has('focus') ? undefined : () => openTool('focus', { subject: sum.name })}
            />
          ) : null}
        </Enter>

        {!nothing && !off.has('focus') ? (
          <Enter index={enter++}>
            <SectionTitle>Focus</SectionTitle>
            <Card>
              <View style={st.statRow}>
                <View style={{ flex: 1 }}>
                  <Text style={st.stat}>{sum.weekMin > 0 ? fmtMins(sum.weekMin) : 'None yet'}</Text>
                  <Text style={T.caption}>this week</Text>
                </View>
                {sum.totalMin > 0 ? (
                  <View style={{ flex: 1 }}>
                    <Text style={st.stat}>{fmtMins(sum.totalMin)}</Text>
                    <Text style={T.caption}>{sum.sessions === 1 ? 'in 1 session' : 'in ' + sum.sessions + ' sessions'}</Text>
                  </View>
                ) : null}
              </View>
              {sum.spark.some((m) => m > 0) ? (
                <View accessible accessibilityLabel="Minutes focused on it each day for the last 30 days">
                  <View style={st.spark}>
                    {sum.spark.map((m, i) => (
                      <View key={i} style={st.sparkCol}>
                        <View
                          style={m > 0
                            ? [st.sparkBar, { height: 4 + 28 * (m / sparkMax), backgroundColor: C.accent }]
                            : [st.sparkDot, { backgroundColor: track }]}
                        />
                      </View>
                    ))}
                  </View>
                  <Text style={[T.caption, { marginTop: 6 }]}>The last 30 days</Text>
                </View>
              ) : null}
              <View style={{ flexDirection: 'row', marginTop: 16 }}>
                <PillButton small icon="timer-outline" label={'Focus on ' + sum.name} onPress={() => { tick(); openTool('focus', { subject: sum.name }); }} />
              </View>
            </Card>
          </Enter>
        ) : null}

        {sum.trend.length && !off.has('scores') ? (
          <Enter index={enter++}>
            <SectionTitle
              right={sum.lastDelta != null && Math.round(sum.lastDelta) !== 0 ? (
                <Text style={[T.caption, { color: sum.lastDelta > 0 ? C.green : C.danger }]}>
                  {(sum.lastDelta > 0 ? 'up ' : 'down ') + Math.abs(Math.round(sum.lastDelta * 10) / 10) + ' on the last'}
                </Text>
              ) : undefined}
            >
              Results
            </SectionTitle>
            {sum.trend.length >= 2 ? (
              <Card style={{ marginBottom: S.gap }}>
                <Sparkline values={sum.trend.map((r) => r.pct)} height={64} />
              </Card>
            ) : null}
            <ListCard>
              {[...sum.trend].reverse().slice(0, 5).map((r) => (
                <ListRow key={r.id} onPress={() => openExam(r.examId)} style={{ paddingVertical: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={st.rowTitle} numberOfLines={1}>{r.examTitle}</Text>
                    <Text style={[T.caption, { marginTop: 2 }]}>{fmtExamDate(r.date)}</Text>
                  </View>
                  <Text style={st.pct}>{fmtPct(r.pct)}</Text>
                </ListRow>
              ))}
            </ListCard>
          </Enter>
        ) : null}

        {(sum.nextClass && !off.has('planner')) || (sum.nextExam && !off.has('scores')) ? (
          <Enter index={enter++}>
            <SectionTitle>Coming up</SectionTitle>
            <ListCard>
              {sum.nextClass && !off.has('planner') ? (
                <ListRow
                  onPress={() => { tick(); openTool('planner', { day: sum.nextClass!.day, item: sum.nextClass!.block.id }); }}
                  style={{ paddingVertical: 12 }}
                >
                  <Ionicons name="calendar-outline" size={18} color={C.accent} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={st.rowTitle} numberOfLines={1}>{sum.nextClass.onNow ? 'On now' : 'Next class'}</Text>
                    <Text style={[T.caption, { marginTop: 2 }]}>
                      {dayWord(sum.nextClass.inDays, sum.nextClass.dateKey) + ', '
                        + fmtClockTime(toMinutes(sum.nextClass.block.start), hour24) + ' to '
                        + (toMinutes(sum.nextClass.block.end) >= 1440 ? 'midnight' : fmtClockTime(toMinutes(sum.nextClass.block.end), hour24))}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={17} color={C.textFaint} />
                </ListRow>
              ) : null}
              {sum.nextExam && !off.has('scores') ? (
                <ListRow onPress={() => openExam(sum.nextExam!.id)} style={{ paddingVertical: 12 }}>
                  <Ionicons name="ribbon-outline" size={18} color={C.accent} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={st.rowTitle} numberOfLines={1}>{sum.nextExam.title}</Text>
                    <Text style={[T.caption, { marginTop: 2 }]}>{fmtExamDate(sum.nextExam.date, true)}</Text>
                  </View>
                  <Text style={[st.when, { color: C.accent }]}>{fromToday(sum.nextExam.date, today)}</Text>
                </ListRow>
              ) : null}
            </ListCard>
          </Enter>
        ) : null}

        {(sum.notes.length || sum.notesHidden) && !off.has('notes') ? (
          <Enter index={enter++}>
            <SectionTitle>Notes</SectionTitle>
            {sum.notesHidden ? (
              <Card>
                <Text style={T.label}>Notes are locked. Open Notes to see the ones about {sum.name}.</Text>
                <View style={{ flexDirection: 'row', marginTop: 12 }}>
                  <PillButton small icon="lock-open-outline" label="Open Notes" onPress={() => openTool('notes')} />
                </View>
              </Card>
            ) : (
              <ListCard>
                {sum.notes.slice(0, 6).map((n) => (
                  <ListRow
                    key={n.id} style={{ paddingVertical: 12 }}
                    onPress={() => router.push({ pathname: '/notes/[id]', params: { id: n.id } }, { dangerouslySingular: true })}
                  >
                    <Ionicons name={n.locked ? 'lock-closed-outline' : 'document-text-outline'} size={18} color={C.green} />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={st.rowTitle} numberOfLines={1}>{n.title || 'Untitled'}</Text>
                      {!n.locked && n.body ? <Text style={[T.caption, { marginTop: 2 }]} numberOfLines={1}>{n.body.slice(0, 120)}</Text> : null}
                    </View>
                  </ListRow>
                ))}
              </ListCard>
            )}
          </Enter>
        ) : null}
      </Animated.ScrollView>
      {exp.sheet}
    </ScreenBG>
  );
}

const st = StyleSheet.create({
  statRow: { flexDirection: 'row', gap: S.gap },
  stat: { ...T.numStat, fontSize: 20, lineHeight: 26, letterSpacing: TRACK.large },
  spark: { flexDirection: 'row', alignItems: 'flex-end', height: 34, gap: 2, marginTop: 16 },
  sparkCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: 34 },
  sparkBar: { width: '100%', maxWidth: 7, borderRadius: 2 },
  sparkDot: { width: 4, height: 4, borderRadius: 2 },
  rowTitle: { color: C.text, fontFamily: F.semi, fontSize: 15, letterSpacing: TRACK.body },
  pct: { ...T.numStat, fontSize: 16, color: C.text },
  when: { fontFamily: F.semi, fontSize: 13, letterSpacing: TRACK.small },
});
