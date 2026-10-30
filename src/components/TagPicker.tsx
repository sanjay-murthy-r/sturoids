// A Deep Work session's tags: what the time was for, beyond its subject. An exam coming up (from Scores), or a tag of the
// student's own ("Revision", "Mock tests", "Backlog"). Picked from what is suggested, or typed; the history, its
// summaries and the reports count focus by them.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { C, F, TRACK } from '../theme';
import { useStore } from '../store';
import { todayKey } from '../utils';
import { indexScores, upcoming } from '../scores';
import { Chip, Field } from './UI';
import { glide, rowIn, rowOut, useAnimLevel } from './Motion';
import { tick } from '../haptics';

/** at most this many tags on a session */
export const TAGS_MAX = 6;

/** A tag as kept: one line, no doubled spaces, at most 40 characters. */
export const cleanTag = (t: string) => t.trim().replace(/\s+/g, ' ').slice(0, 40);

/** The tags a session list uses, most used first (ties to the most recent). */
export function tagsByUse(sessions: { tags?: string[]; endedAt: number }[]): string[] {
  const count = new Map<string, { n: number; at: number }>();
  for (const s of sessions) {
    for (const t of s.tags ?? []) {
      const c = count.get(t) ?? { n: 0, at: 0 };
      c.n++;
      c.at = Math.max(c.at, s.endedAt);
      count.set(t, c);
    }
  }
  return [...count.entries()].sort((a, b) => b[1].n - a[1].n || b[1].at - a[1].at).map(([t]) => t);
}

export function TagPicker({ value, onChange, style }: { value: string[]; onChange: (tags: string[]) => void; style?: any }) {
  const level = useAnimLevel();
  const sessions = useStore((s) => s.sessions);
  const scores = useStore((s) => s.scores);
  const hideScores = useStore((s) => s.settings.archivedTools.includes('scores'));
  const [typed, setTyped] = React.useState('');
  const chosen = new Set(value.map((t) => t.toLowerCase()));
  const exams = React.useMemo(
    () => (hideScores ? [] : upcoming(indexScores(scores), null, todayKey()).slice(0, 4).map((n) => cleanTag(n.title))),
    [scores, hideScores],
  );
  const own = React.useMemo(() => tagsByUse(sessions).slice(0, 10), [sessions]);
  const suggest = [...exams, ...own.filter((t) => !exams.includes(t))].filter((t) => t && !chosen.has(t.toLowerCase())).slice(0, 10);
  const add = (t: string) => {
    const tag = cleanTag(t);
    if (!tag || chosen.has(tag.toLowerCase()) || value.length >= TAGS_MAX) return;
    tick();
    onChange([...value, tag]);
    setTyped('');
  };
  const drop = (t: string) => { tick(); onChange(value.filter((x) => x !== t)); };
  return (
    <View style={style}>
      <Text style={st.label}>Tags</Text>
      <Animated.View layout={glide(level)} style={st.chips}>
        {value.map((t) => (
          <Animated.View key={'on:' + t} entering={rowIn(level)} exiting={rowOut(level)} layout={glide(level)}>
            <Chip small active icon={exams.includes(t) ? 'school-outline' : 'pricetag-outline'} label={t} onPress={() => drop(t)} accessibilityHint="Takes the tag off" />
          </Animated.View>
        ))}
        {suggest.map((t) => (
          <Animated.View key={'off:' + t} entering={rowIn(level)} exiting={rowOut(level)} layout={glide(level)}>
            <Chip small icon={exams.includes(t) ? 'school-outline' : 'add'} label={t} onPress={() => add(t)} accessibilityHint="Tags the session with it" />
          </Animated.View>
        ))}
      </Animated.View>
      {value.length < TAGS_MAX ? (
        <Field
          value={typed} onChangeText={setTyped} placeholder="A tag of your own, like Revision" maxLength={40}
          returnKeyType="done" blurOnSubmit={false} onSubmitEditing={() => add(typed)} style={{ marginTop: 6, marginBottom: 0 }}
        />
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  label: { color: C.textFaint, fontFamily: F.smMed, fontSize: 12, letterSpacing: TRACK.fine, marginLeft: 2, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
});
