import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C, F, T } from '../theme';
import { useStore } from '../store';
import { ScoreNode, fmtExamDate, fmtMark, indexScores, marksProblem, parseMark } from '../scores';
import { todayKey } from '../utils';
import { shiftKey } from '../journal';
import { Sheet, Field, PillButton, Chip, Row } from './UI';
import { TagPicker } from './ScoreTags';
import { SegmentedControl } from './SegmentedControl';
import { JournalCalendar } from './JournalCalendar';

export type ScoreEditTarget =
  | { mode: 'new'; kind: 'group' | 'exam'; parentId: string | null }
  | { mode: 'edit'; id: string };

interface Draft {
  title: string;
  /** '' means no date */
  date: string;
  score: string;
  outOf: string;
  weight: string;
  target: string;
  rank: string;
  percentile: string;
  grade: string;
  note: string;
  combine: 'sum' | 'weighted';
  tags: string[];
}

const EMPTY: Draft = {
  title: '', date: '', score: '', outOf: '', weight: '', target: '', rank: '', percentile: '', grade: '', note: '',
  combine: 'sum', tags: [],
};

const num = (n: number | undefined) => (typeof n === 'number' ? fmtMark(n) : '');

type Problems = { title?: string; marks?: string; weight?: string; details?: string };

/**
 * One sheet for adding or editing an exam, one of its subjects, or a group. Marks are typed as they are printed on the paper
 * (negative marking included), the total is filled in from the exam before it, and everything a mock test report
 * carries (target, rank, percentile, grade, a note) waits behind "More details".
 */
export function ScoreEditor({ target, onClose }: { target: ScoreEditTarget | null; onClose: () => void }) {
  const scores = useStore((s) => s.scores);
  const addScoreNode = useStore((s) => s.addScoreNode);
  const patchScoreNode = useStore((s) => s.patchScoreNode);
  // the sheet keeps showing what it was opened for while it closes
  const [shown, setShown] = React.useState<ScoreEditTarget | null>(null);
  const [d, setD] = React.useState<Draft>(EMPTY);
  const [more, setMore] = React.useState(false);
  const [calendar, setCalendar] = React.useState(false);
  const [problems, setProblems] = React.useState<Problems>({});

  const ix = React.useMemo(() => indexScores(scores), [scores]);
  const node = shown?.mode === 'edit' ? ix.byId.get(shown.id) : undefined;
  const kind: 'group' | 'exam' = shown?.mode === 'new' ? shown.kind : node?.kind || 'exam';
  const parentId = shown?.mode === 'new' ? shown.parentId : node?.parentId ?? null;
  const parent = parentId ? ix.byId.get(parentId) : undefined;
  const isSub = parent?.kind === 'exam';
  const hasParts = !!node && (ix.children.get(node.id) || []).some((k) => k.kind === 'exam');
  const weighted = isSub && parent?.combine === 'weighted';

  React.useEffect(() => {
    if (!target) return;
    setShown(target);
    setProblems({});
    setCalendar(false);
    const t = indexScores(useStore.getState().scores);
    if (target.mode === 'edit') {
      const n = t.byId.get(target.id);
      if (!n) return;
      setD({
        title: n.title, date: n.date || '', score: num(n.score), outOf: num(n.outOf), weight: num(n.weight),
        target: num(n.target), rank: num(n.rank), percentile: num(n.percentile), grade: n.grade || '', note: n.note || '',
        combine: n.combine || 'sum', tags: n.tags || [],
      });
      setMore(n.target != null || n.rank != null || n.percentile != null || !!n.grade || !!n.note);
      return;
    }
    const p = target.parentId ? t.byId.get(target.parentId) : undefined;
    // the total is usually the same as the exam before it in the same place, so it starts filled in
    const lastTotal = (t.children.get(target.parentId) || [])
      .filter((k) => k.kind === 'exam' && typeof k.outOf === 'number')
      .sort((a, b) => b.createdAt - a.createdAt)[0]?.outOf;
    setD({ ...EMPTY, date: target.kind === 'exam' && p?.kind !== 'exam' ? todayKey() : '', outOf: num(lastTotal) });
    setMore(false);
  }, [target]);

  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));

  const save = () => {
    const title = d.title.trim();
    const found: Problems = {};
    if (!title) found.title = kind === 'group' ? 'Give the group a name.' : 'Give the exam a name.';
    const score = parseMark(d.score);
    const outOf = parseMark(d.outOf);
    const weight = parseMark(d.weight);
    const goal = parseMark(d.target);
    const rank = parseMark(d.rank);
    const percentile = parseMark(d.percentile);
    if (kind === 'exam') {
      if (score.bad || outOf.bad) found.marks = 'Use numbers for marks, like 42 or 42.5.';
      else {
        const p = marksProblem(score.value, outOf.value);
        if (p) found.marks = p;
      }
      if (weighted && (weight.bad || (weight.value !== undefined && !(weight.value > 0)))) found.weight = 'The weight must be more than 0.';
      if (rank.bad || (rank.value !== undefined && !(Number.isInteger(rank.value) && rank.value >= 1))) {
        found.details = 'Rank is a whole number, like 1204.';
      } else if (percentile.bad || (percentile.value !== undefined && (percentile.value < 0 || percentile.value > 100))) {
        found.details = 'Percentile runs from 0 to 100.';
      }
    }
    if (!found.details && (goal.bad || (goal.value !== undefined && (goal.value < 0 || goal.value > 100)))) {
      found.details = 'A target is a percentage, from 0 to 100.';
    }
    setProblems(found);
    if (found.title || found.marks || found.weight || found.details) {
      if (found.details) setMore(true);
      return;
    }
    const fields: Partial<ScoreNode> = kind === 'group'
      ? { title, target: goal.value }
      : {
        title,
        date: d.date || undefined,
        score: score.value,
        outOf: outOf.value,
        weight: weighted ? weight.value : node?.weight,
        combine: hasParts ? d.combine : node?.combine,
        target: goal.value,
        rank: rank.value,
        percentile: percentile.value,
        grade: d.grade.trim() || undefined,
        note: d.note.trim() || undefined,
        tags: d.tags.length ? d.tags : undefined,
      };
    if (shown?.mode === 'edit' && node) patchScoreNode(node.id, fields);
    else addScoreNode({ ...(fields as any), kind, parentId });
    onClose();
  };

  const sheetTitle = shown?.mode === 'edit'
    ? kind === 'group' ? 'Rename group' : isSub ? 'Edit subject' : 'Edit exam'
    : kind === 'group' ? 'New group'
      : isSub ? 'New subject in ' + (parent?.title || 'this exam')
        : parent ? 'New exam in ' + parent.title : 'New exam';
  const today = todayKey();
  const yesterday = shiftKey(today, -1);

  return (
    <Sheet visible={!!target} onClose={onClose} title={sheetTitle}>
      <Field
        label={kind === 'group' ? 'Group' : isSub ? 'Subject' : 'Exam'}
        value={d.title}
        onChangeText={(v) => set({ title: v })}
        placeholder={kind === 'group' ? 'e.g. JEE mocks' : isSub ? 'e.g. Physics' : 'e.g. Mock test 7'}
        autoFocus={shown?.mode === 'new'}
        maxLength={80}
      />
      {problems.title ? <Text style={st.problem}>{problems.title}</Text> : null}

      {kind === 'exam' ? (
        <>
          <Text style={st.label}>Date</Text>
          <Row style={{ flexWrap: 'wrap' }}>
            <Chip small label="Today" active={d.date === today} onPress={() => { set({ date: today }); setCalendar(false); }} />
            <Chip small label="Yesterday" active={d.date === yesterday} onPress={() => { set({ date: yesterday }); setCalendar(false); }} />
            <Chip small icon="calendar-outline" label="Pick a day" active={calendar} onPress={() => setCalendar(!calendar)} />
            <Chip small label="No date" active={!d.date} onPress={() => { set({ date: '' }); setCalendar(false); }} />
          </Row>
          <Text style={[T.caption, { marginBottom: calendar ? 10 : 14 }]}>
            {d.date ? fmtExamDate(d.date, true) : isSub ? 'Takes the date of the exam it belongs to' : 'No date'}
          </Text>
          {calendar ? (
            <View style={{ marginBottom: 14 }}>
              <JournalCalendar value={d.date} onPick={(k) => { set({ date: k }); setCalendar(false); }} />
            </View>
          ) : null}

          <Row style={{ alignItems: 'flex-start', gap: 14 }}>
            <Field
              label="Score" value={d.score} onChangeText={(v) => set({ score: v })} placeholder="68"
              keyboardType="numeric" style={{ flex: 1, marginBottom: 0 }}
            />
            <Field
              label="Out of" value={d.outOf} onChangeText={(v) => set({ outOf: v })} placeholder="100"
              keyboardType="numeric" style={{ flex: 1, marginBottom: 0 }}
            />
          </Row>
          <Text style={[problems.marks ? st.problem : st.hint]}>
            {problems.marks || (hasParts ? 'Leave the marks empty to add up the subjects.' : 'Negative marks are fine, like -4.')}
          </Text>

          {hasParts ? (
            <>
              <Text style={st.label}>How subjects add up</Text>
              <SegmentedControl
                size="sm"
                stretch
                style={{ marginBottom: 14 }}
                options={[{ key: 'sum', label: 'Add up marks' }, { key: 'weighted', label: 'Weighted' }]}
                value={d.combine}
                onChange={(k) => set({ combine: k as Draft['combine'] })}
              />
            </>
          ) : null}

          {weighted ? (
            <>
              <Field
                label="Weight" value={d.weight} onChangeText={(v) => set({ weight: v })} placeholder="1"
                keyboardType="numeric" style={{ marginBottom: 0 }}
              />
              <Text style={[problems.weight ? st.problem : st.hint]}>
                {problems.weight || 'Its share of ' + (parent?.title || 'the exam') + '. 1 when empty.'}
              </Text>
            </>
          ) : null}

          <TagPicker value={d.tags} onChange={(tags) => set({ tags })} />

          <Pressable onPress={() => setMore(!more)} hitSlop={8} style={st.moreRow} accessibilityRole="button">
            <Text style={[st.moreText, { color: C.accent }]}>More details</Text>
            <Ionicons name={more ? 'chevron-up' : 'chevron-down'} size={15} color={C.accent} />
          </Pressable>
          {more ? (
            <>
              <Row style={{ alignItems: 'flex-start', gap: 14 }}>
                <Field label="Target %" value={d.target} onChangeText={(v) => set({ target: v })} placeholder="75" keyboardType="numeric" style={{ flex: 1 }} />
                <Field label="Rank" value={d.rank} onChangeText={(v) => set({ rank: v })} placeholder="1204" keyboardType="numeric" style={{ flex: 1 }} />
              </Row>
              <Row style={{ alignItems: 'flex-start', gap: 14 }}>
                <Field label="Percentile" value={d.percentile} onChangeText={(v) => set({ percentile: v })} placeholder="97.2" keyboardType="numeric" style={{ flex: 1 }} />
                <Field label="Grade" value={d.grade} onChangeText={(v) => set({ grade: v })} placeholder="A or 8.6" maxLength={12} style={{ flex: 1 }} />
              </Row>
              <Field label="Note" value={d.note} onChangeText={(v) => set({ note: v })} placeholder="What went well, what to fix next time" multiline maxLength={600} />
            </>
          ) : null}
        </>
      ) : (
        <Field label="Target %" value={d.target} onChangeText={(v) => set({ target: v })} placeholder="Optional, like 75" keyboardType="numeric" />
      )}
      {problems.details ? <Text style={st.problem}>{problems.details}</Text> : null}

      <PillButton
        label={shown?.mode === 'edit' ? 'Save' : kind === 'group' ? 'Add group' : isSub ? 'Add subject' : 'Add exam'}
        onPress={save}
        style={{ marginTop: 6 }}
      />
    </Sheet>
  );
}

const st = StyleSheet.create({
  label: { color: C.textFaint, fontFamily: F.med, fontSize: 12, letterSpacing: 0.2, marginLeft: 2, marginBottom: 8 },
  hint: { color: C.textFaint, fontFamily: F.reg, fontSize: 12, lineHeight: 17, marginTop: 6, marginBottom: 14 },
  problem: { color: C.danger, fontFamily: F.med, fontSize: 12, lineHeight: 17, marginTop: 6, marginBottom: 14 },
  moreRow: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 4, marginBottom: 12 },
  moreText: { fontFamily: F.semi, fontSize: 13 },
});
