// A Deep Work session's tags: what the time was for, beyond its subject. An exam coming up (from Scores), or a tag of the
// student's own ("Revision", "Mock tests", "Backlog"). Kept small and out of the way: one quiet row with the tags on, a
// "Tag" key, and the one exam it most likely is (the nearest, or the one the subject names) offered beside it. The key
// opens the rest: the exams ahead with their dates, the tags used before, and a field for a new one. The history, its
// summaries and the reports count focus by them.

import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { C, F, MIN, TRACK } from '../theme';
import { useStore } from '../store';
import { todayKey } from '../utils';
import { indexScores, upcoming } from '../scores';
import { Chip, useTheme } from './UI';
import { EASE_OUT, glide, rowIn, rowOut, useAnimLevel } from './Motion';
import { tick } from '../haptics';
import { noteUse, useLearnt } from '../learn';

/** at most this many tags on a session */
export const TAGS_MAX = 6;
/** exams this far ahead are offered */
const EXAMS_AHEAD_DAYS = 60;

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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "today", "tomorrow", "in 5 days", or "12 Nov" further off */
function whenOf(date: string, today: string): string {
  const d = new Date(date + 'T00:00:00');
  const t = new Date(today + 'T00:00:00');
  const days = Math.round((d.getTime() - t.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 7) return 'in ' + days + ' days';
  return d.getDate() + ' ' + MONTHS[d.getMonth()];
}

export function TagPicker({ value, onChange, style, subject }: {
  value: string[]; onChange: (tags: string[]) => void; style?: any;
  /** the session's subject: an exam it names is the one offered first */
  subject?: string;
}) {
  const level = useAnimLevel();
  const theme = useTheme();
  const sessions = useStore((s) => s.sessions);
  const scores = useStore((s) => s.scores);
  const hideScores = useStore((s) => s.settings.archivedTools.includes('scores'));
  const [open, setOpen] = React.useState(false);
  const [typed, setTyped] = React.useState('');
  const placeholder = useLearnt('tags.create', 'Create a tag of your own, like Revision', 'Create tag');
  const chosen = new Set(value.map((t) => t.toLowerCase()));
  const today = todayKey();
  const exams = React.useMemo(() => {
    if (hideScores) return [];
    const until = new Date(Date.now() + EXAMS_AHEAD_DAYS * 86_400_000);
    const last = until.getFullYear() + '-' + String(until.getMonth() + 1).padStart(2, '0') + '-' + String(until.getDate()).padStart(2, '0');
    return upcoming(indexScores(scores), null, today)
      .filter((n) => (n.date as string) <= last)
      .slice(0, 6)
      .map((n) => ({ tag: cleanTag(n.title), when: whenOf(n.date as string, today) }))
      .filter((e, i, all) => e.tag && all.findIndex((x) => x.tag === e.tag) === i);
  }, [scores, hideScores, today]);
  const examTags = new Set(exams.map((e) => e.tag));
  const own = React.useMemo(() => tagsByUse(sessions).filter((t) => !examTags.has(t)).slice(0, 8), [sessions, exams]);
  // the one exam worth offering without opening anything: the one the subject names, or else the nearest
  const hint = React.useMemo(() => {
    const free = exams.filter((e) => !chosen.has(e.tag.toLowerCase()));
    const subj = (subject ?? '').trim().toLowerCase();
    return (subj ? free.find((e) => e.tag.toLowerCase().includes(subj) || subj.includes(e.tag.toLowerCase())) : undefined) ?? free[0];
  }, [exams, subject, value]);

  const full = value.length >= TAGS_MAX;
  const add = (t: string, typedNew = false) => {
    const tag = cleanTag(t);
    if (!tag || chosen.has(tag.toLowerCase()) || full) return;
    tick();
    if (typedNew) noteUse('tags.create');
    onChange([...value, tag]);
    setTyped('');
  };
  const drop = (t: string) => { tick(); onChange(value.filter((x) => x !== t)); };
  const iconOf = (t: string) => (examTags.has(t) ? 'school-outline' : 'pricetag-outline');
  const anim = level !== 'none';

  return (
    <View style={style}>
      <Animated.View layout={anim ? glide(level) : undefined} style={st.chips}>
        {value.map((t) => (
          <Animated.View key={'on:' + t} entering={rowIn(level)} exiting={rowOut(level)} layout={glide(level)}>
            <Chip small active icon={iconOf(t)} label={t} onPress={() => drop(t)} accessibilityHint="Takes the tag off" />
          </Animated.View>
        ))}
        {!full ? (
          <Animated.View key="key" layout={glide(level)}>
            <Pressable
              onPress={() => { tick(); setOpen((o) => !o); }} hitSlop={6} accessibilityRole="button"
              accessibilityLabel={open ? 'Done tagging' : 'Tag this session'} accessibilityState={{ expanded: open }}
              style={({ pressed }) => [st.key, pressed && { opacity: 0.6 }]}
            >
              <Ionicons name={open ? 'chevron-up' : 'pricetag-outline'} size={13} color={C.textFaint} />
              <Text style={st.keyText}>{open ? 'Done' : value.length ? 'Tag' : 'Add a tag'}</Text>
            </Pressable>
          </Animated.View>
        ) : null}
        {!open && hint && !full ? (
          <Animated.View key={'hint:' + hint.tag} entering={rowIn(level)} exiting={rowOut(level)} layout={glide(level)}>
            <Pressable
              onPress={() => add(hint.tag)} hitSlop={6} accessibilityRole="button" accessibilityLabel={'Tag ' + hint.tag + ', ' + hint.when}
              style={({ pressed }) => [st.key, pressed && { opacity: 0.6 }]}
            >
              <Ionicons name="add" size={13} color={C.accent} />
              <Text style={[st.keyText, { color: C.textDim }]} numberOfLines={1}>{hint.tag}</Text>
              <Text style={st.when}>{hint.when}</Text>
            </Pressable>
          </Animated.View>
        ) : null}
      </Animated.View>

      {open && !full ? (
        <Animated.View
          entering={anim ? FadeIn.duration(200).easing(EASE_OUT) : undefined}
          exiting={anim ? FadeOut.duration(140) : undefined}
          style={st.tray}
        >
          {exams.some((e) => !chosen.has(e.tag.toLowerCase())) ? (
            <>
              <Text style={st.kicker}>Exams ahead</Text>
              <View style={st.chips}>
                {exams.filter((e) => !chosen.has(e.tag.toLowerCase())).map((e) => (
                  <Chip key={e.tag} small icon="school-outline" label={e.tag + ' · ' + e.when} onPress={() => add(e.tag)} accessibilityHint="Tags the session with this exam" />
                ))}
              </View>
            </>
          ) : null}
          {own.some((t) => !chosen.has(t.toLowerCase())) ? (
            <>
              <Text style={st.kicker}>Yours</Text>
              <View style={st.chips}>
                {own.filter((t) => !chosen.has(t.toLowerCase())).map((t) => (
                  <Chip key={t} small icon="add" label={t} onPress={() => add(t)} accessibilityHint="Tags the session with it" />
                ))}
              </View>
            </>
          ) : null}
          <View style={[st.field, theme === 'minimal' ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border } : { backgroundColor: C.inset }]}>
            <Ionicons name="add" size={15} color={C.textFaint} />
            <TextInput
              value={typed} onChangeText={setTyped} placeholder={placeholder} placeholderTextColor={C.textFaint} maxLength={40}
              returnKeyType="done" blurOnSubmit={false} onSubmitEditing={() => add(typed, true)}
              selectionColor={C.accent} cursorColor={C.accent} style={st.input} accessibilityLabel="Create a tag"
            />
            {typed.trim() ? (
              <Pressable onPress={() => add(typed, true)} hitSlop={8} accessibilityRole="button" accessibilityLabel={'Add ' + typed}>
                <Text style={[st.keyText, { color: C.accent }]}>Add</Text>
              </Pressable>
            ) : null}
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  key: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 30, paddingHorizontal: 6, marginRight: 8, marginBottom: 8 },
  keyText: { color: C.textFaint, fontFamily: F.smMed, fontSize: 12.5, letterSpacing: TRACK.fine, maxWidth: 180 },
  when: { color: C.textFaint, fontFamily: F.sm, fontSize: 11, letterSpacing: TRACK.fine, opacity: 0.8 },
  tray: { marginTop: 2 },
  kicker: { color: C.textFaint, fontFamily: F.smMed, fontSize: 11, letterSpacing: TRACK.fine, marginLeft: 2, marginBottom: 6, marginTop: 4 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, borderRadius: 12, paddingHorizontal: 12, marginTop: 4, marginBottom: 4 },
  input: { flex: 1, color: C.text, fontFamily: F.reg, fontSize: 14, letterSpacing: TRACK.body, paddingVertical: 0 },
});
