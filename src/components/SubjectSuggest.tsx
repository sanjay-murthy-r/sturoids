import React from 'react';
import { ScrollView, StyleSheet, View, ViewStyle } from 'react-native';
import { S } from '../theme';
import { subjectKey, useSubjects } from '../subjects';
import { Chip } from './UI';
import { tick } from '../haptics';

/**
 * The subjects the app already knows (focused on, written about, planned, sat in exams; src/subjects.ts), offered as flat
 * chips under a subject field: the most used while the field is empty, the ones that start with (then contain) what is
 * typed once something is. The subject already written, and any in `exclude`, are left out; nothing to offer, nothing
 * drawn. `scroll` lays the chips in one sideways row instead of wrapping them.
 */
export function SubjectSuggest({ value, onPick, exclude, max = 5, scroll = false, style, extra }: {
  value: string; onPick: (name: string) => void; exclude?: readonly string[]; max?: number; scroll?: boolean;
  style?: ViewStyle;
  /** names to put first (today's planned subjects, say), when they are not in the list yet */
  extra?: readonly string[];
}) {
  const known = useSubjects();
  const picks = React.useMemo(() => {
    const typed = subjectKey(value || '');
    const out: string[] = [];
    const seen = new Set<string>([typed, ...(exclude || []).map((x) => subjectKey(x))]);
    const pool = [...(extra || []), ...known];
    const take = (pred: (k: string) => boolean) => {
      for (const name of pool) {
        if (out.length >= max) return;
        const k = subjectKey(name);
        if (!k || seen.has(k) || !pred(k)) continue;
        seen.add(k);
        out.push(name.trim());
      }
    };
    if (!typed) take(() => true);
    else {
      take((k) => k.startsWith(typed));
      take((k) => k.includes(typed));
    }
    return out;
  }, [value, known, exclude, max, extra]);
  if (!picks.length) return null;
  const chips = picks.map((name) => (
    <Chip key={name} small label={name} onPress={() => { tick(); onPick(name); }} accessibilityHint="Uses this subject" />
  ));
  if (scroll) {
    return (
      <ScrollView
        horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled"
        style={[st.scroll, style]} contentContainerStyle={st.scrollIn}
      >
        {chips}
      </ScrollView>
    );
  }
  return <View style={[st.wrap, style]}>{chips}</View>;
}

const st = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
  scroll: { marginHorizontal: -S.pad, flexGrow: 0 },
  scrollIn: { paddingHorizontal: S.pad, paddingVertical: 6 },
});
