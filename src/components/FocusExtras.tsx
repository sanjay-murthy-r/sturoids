// Deep Work's quieter cards, beside the clock:
// - Today: the focus put in today (the session running counted as it goes), against the day's goal when there is one,
//   how many sessions, the subjects it went to, the days in a row with focus, and the Planner's next block.
// - Park a thought: whatever comes to mind mid-session ("email the teacher", "look up Raoult's law") is put down here in
//   a line and left, so the session carries on. Parked thoughts go to the ToDos when the session ends.

import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { C, F, MIN, T, TRACK } from '../theme';
import { FocusSession } from '../store';
import { Card, useTheme } from './UI';
import { glide, rowIn, rowOut, useAnimLevel } from './Motion';
import { tick } from '../haptics';
import { noteUse, useLearnt } from '../learn';
import { todayKey } from '../utils';
import { cheer } from '../cheerSound';
import { Flicker } from './Cheer';

const fmt = (min: number) => (min >= 60 ? Math.floor(min / 60) + ' h' + (min % 60 ? ' ' + (min % 60) + ' min' : '') : min + ' min');

/** Days in a row, up to today, with at least one session (today counts once it has one, and does not break a run yet). */
export function streakOf(sessions: FocusSession[], today: string): number {
  const days = new Set(sessions.map((s) => s.dateKey));
  const d = new Date(today + 'T00:00:00');
  if (!days.has(today)) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(todayKey(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

export function TodayCard({ sessions, today, liveMin, goalMin, next }: {
  sessions: FocusSession[]; today: string;
  /** the session running, in whole minutes, counted in */
  liveMin: number;
  goalMin: number;
  /** the Planner's next block today: "Chemistry at 4:30 PM" */
  next?: string;
}) {
  const level = useAnimLevel();
  const theme = useTheme();
  const todays = sessions.filter((s) => s.dateKey === today);
  const min = Math.round(todays.reduce((a, s) => a + s.netSeconds, 0) / 60) + liveMin;
  const bySubject = new Map<string, number>();
  for (const s of todays) {
    const k = s.subject?.trim() || 'No subject';
    bySubject.set(k, (bySubject.get(k) ?? 0) + s.netSeconds / 60);
  }
  const subjects = [...bySubject.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const top = subjects[0]?.[1] ?? 1;
  const streak = streakOf(sessions, today);
  const share = goalMin > 0 ? Math.min(1, min / goalMin) : 0;
  const track = theme === 'minimal' ? MIN.inset : C.inset;
  return (
    <Card pad={16}>
      <View style={st.head}>
        <Text style={T.kicker}>Today</Text>
        {streak > 1 ? (
          <View style={st.streak} accessibilityLabel={streak + ' days in a row'}>
            <Flicker><Ionicons name="flame-outline" size={13} color={C.amber} /></Flicker>
            <Text style={st.streakText}>{streak + ' days'}</Text>
          </View>
        ) : null}
      </View>
      <View style={st.figure}>
        <Text style={st.big}>{min ? fmt(min) : 'Nothing yet'}</Text>
        {goalMin > 0 ? <Text style={st.of}>{'of ' + fmt(goalMin)}</Text> : null}
      </View>
      {goalMin > 0 ? (
        <View style={[st.bar, { backgroundColor: track }]}>
          <Animated.View layout={glide(level)} style={[st.fill, { width: (share * 100 + '%') as any, backgroundColor: share >= 1 ? C.green : C.accent }]} />
        </View>
      ) : null}
      <Text style={st.line}>
        {[todays.length ? todays.length + (todays.length === 1 ? ' session' : ' sessions') : '', liveMin ? 'one running' : '', next ? 'next, ' + next : '']
          .filter(Boolean).join(' · ') || 'Your first session today counts from Start.'}
      </Text>
      {subjects.length > 1 ? (
        <View style={{ marginTop: 10, gap: 6 }}>
          {subjects.map(([name, m]) => (
            <View key={name} style={st.subj}>
              <Text style={st.subjName} numberOfLines={1}>{name}</Text>
              <View style={[st.subjBar, { backgroundColor: track }]}>
                <View style={[st.fill, { width: (Math.max(0.06, m / top) * 100 + '%') as any, backgroundColor: C.accent, opacity: 0.75 }]} />
              </View>
              <Text style={st.subjMin}>{fmt(Math.round(m))}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

export function ParkedCard({ parked, onPark, onUnpark }: { parked: string[]; onPark: (t: string) => void; onUnpark: (i: number) => void }) {
  const level = useAnimLevel();
  const theme = useTheme();
  const [text, setText] = React.useState('');
  const lede = useLearnt(
    'focus.park',
    'On your mind? Park it here and keep going. Parked thoughts land in your ToDos when the session ends.',
    'They go to your ToDos when the session ends.',
    5,
  );
  const park = () => {
    const t = text.trim().replace(/\s+/g, ' ').slice(0, 140);
    if (!t) return;
    tick();
    noteUse('focus.park');
    cheer('add');
    onPark(t);
    setText('');
  };
  return (
    <Card pad={16}>
      <Text style={T.kicker}>Park a thought</Text>
      <Text style={st.lede}>{lede}</Text>
      <View style={[st.field, theme === 'minimal' ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border } : { backgroundColor: C.inset }]}>
        <TextInput
          value={text} onChangeText={setText} placeholder="Email the teacher, look up…" placeholderTextColor={C.textFaint}
          returnKeyType="done" blurOnSubmit={false} onSubmitEditing={park} maxLength={140}
          selectionColor={C.accent} cursorColor={C.accent} style={st.input} accessibilityLabel="Park a thought"
        />
        {text.trim() ? (
          <Pressable onPress={park} hitSlop={8} accessibilityRole="button" accessibilityLabel="Park it">
            <Text style={st.parkKey}>Park</Text>
          </Pressable>
        ) : null}
      </View>
      {parked.map((p, i) => (
        <Animated.View key={p + i} entering={rowIn(level)} exiting={rowOut(level)} layout={glide(level)} style={st.item}>
          <View style={st.dot} />
          <Text style={st.itemText} numberOfLines={2}>{p}</Text>
          <Pressable onPress={() => { tick(); onUnpark(i); }} hitSlop={10} accessibilityRole="button" accessibilityLabel={'Remove ' + p}>
            <Ionicons name="close" size={15} color={C.textFaint} />
          </Pressable>
        </Animated.View>
      ))}
    </Card>
  );
}

const st = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  streak: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  streakText: { color: C.textDim, fontFamily: F.smMed, fontSize: 12, letterSpacing: TRACK.fine },
  figure: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 8 },
  big: { color: C.text, fontFamily: F.semi, fontSize: 22, letterSpacing: TRACK.title, fontVariant: ['tabular-nums'] },
  of: { color: C.textFaint, fontFamily: F.sm, fontSize: 13, letterSpacing: TRACK.fine },
  bar: { height: 6, borderRadius: 3, overflow: 'hidden', marginTop: 10 },
  fill: { height: '100%', borderRadius: 3 },
  line: { color: C.textFaint, fontFamily: F.sm, fontSize: 12.5, lineHeight: 18, letterSpacing: TRACK.fine, marginTop: 8 },
  subj: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  subjName: { width: 92, color: C.textDim, fontFamily: F.sm, fontSize: 12, letterSpacing: TRACK.fine },
  subjBar: { flex: 1, height: 5, borderRadius: 3, overflow: 'hidden' },
  subjMin: { width: 64, textAlign: 'right', color: C.textFaint, fontFamily: F.sm, fontSize: 11.5, fontVariant: ['tabular-nums'] },
  lede: { color: C.textFaint, fontFamily: F.sm, fontSize: 12.5, lineHeight: 18, letterSpacing: TRACK.fine, marginTop: 6 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 42, borderRadius: 13, paddingHorizontal: 13, marginTop: 10 },
  input: { flex: 1, color: C.text, fontFamily: F.reg, fontSize: 14.5, letterSpacing: TRACK.body, paddingVertical: 0 },
  parkKey: { color: C.accent, fontFamily: F.semi, fontSize: 13, letterSpacing: TRACK.small },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 10 },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: C.accent, opacity: 0.7 },
  itemText: { flex: 1, color: C.textDim, fontFamily: F.reg, fontSize: 14, lineHeight: 19, letterSpacing: TRACK.body },
});
