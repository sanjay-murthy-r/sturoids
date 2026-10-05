import React from 'react';
import { View, Text, StyleSheet, Pressable, Alert, BackHandler } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { C, F, S, T, TRACK } from '../theme';
import { useStore } from '../store';
import {
  ScoreIndex, ScoreNode, ScoreResult, ScoreTag, categoriesOf, categoryOf, combineParts, fmtExamDate, fmtMark, fmtPct,
  indexScores, marksProblem, nextTitle, parseMark, resultOf, topExams, whenOf,
} from '../scores';
import { todayKey } from '../utils';
import { shiftKey } from '../journal';
import { ScreenBG, Card, Chip, Field, Hairline, IconBtn, PillButton, Row, SectionTitle, Toggle, useToolHeader, contextLine } from '../components/UI';
import { EASE_OUT, Enter, useAnimLevel, useBuilt } from '../components/Motion';
import { TagPicker } from '../components/ScoreTags';
import { SegmentedControl } from '../components/SegmentedControl';
import { JournalCalendar } from '../components/JournalCalendar';
import { toast } from '../components/Toast';
import { tap, tick } from '../haptics';
import { openScoreNode } from '../scoresNav';
import { READ_MAX, frame } from '../layout';

interface SubjectRow {
  key: string;
  /** a subject already saved; a new row has none */
  id?: string;
  title: string;
  score: string;
  outOf: string;
  weight: string;
  /** a subject with subjects of its own: its result is theirs, so its marks are not typed here */
  locked: boolean;
}

interface Draft {
  title: string;
  /** '' is no date */
  date: string;
  category: string | null;
  /** the exam's plain tags; the category is kept apart */
  tags: string[];
  score: string;
  outOf: string;
  /** with subjects, whether the whole exam's marks are typed too (a paper whose total is not their sum) */
  ownMarks: boolean;
  combine: 'sum' | 'weighted';
  subjects: SubjectRow[];
  target: string;
  rank: string;
  percentile: string;
  grade: string;
  note: string;
}

interface Template { id: string; title: string }

const num = (n: number | undefined) => (typeof n === 'number' ? fmtMark(n) : '');
let seq = 0;
const rowKey = () => 'r' + ++seq;
const emptyRow = (): SubjectRow => ({ key: rowKey(), title: '', score: '', outOf: '', weight: '', locked: false });
const blankRow = (r: SubjectRow) => !r.title.trim() && !r.score.trim() && !r.outOf.trim() && !r.weight.trim();

const newestFirst = (a: ScoreNode, b: ScoreNode) => whenOf(b).localeCompare(whenOf(a)) || b.createdAt - a.createdAt;
const subjectsOf = (ix: ScoreIndex, id: string) =>
  (ix.children.get(id) || []).filter((k) => k.kind === 'exam').sort((a, b) => a.createdAt - b.createdAt);

/**
 * What a new exam starts from: the latest exam in its category (or, with no category, in the same group). Its
 * subjects come across with their totals and weights, marks blank, so a mock series is typed in seconds.
 */
function templateFor(ix: ScoreIndex, tags: ScoreTag[], category: string | null, parentId: string | null) {
  const pool = topExams(ix)
    .filter((n) => (category ? categoryOf(n, tags)?.id === category : n.parentId === parentId))
    .sort(newestFirst);
  const latest = pool[0];
  const withParts = pool.find((n) => subjectsOf(ix, n.id).length);
  const rows: SubjectRow[] = withParts
    ? subjectsOf(ix, withParts.id).map((p) => ({
      key: rowKey(), title: p.title, score: '', outOf: num(p.outOf ?? resultOf(p, ix)?.outOf), weight: num(p.weight), locked: false,
    }))
    : [];
  return {
    rows,
    combine: (withParts?.combine || 'sum') as Draft['combine'],
    template: withParts ? { id: withParts.id, title: withParts.title || 'the last exam' } : null,
    outOf: latest && typeof latest.outOf === 'number' ? num(latest.outOf) : '',
    // a numbered series offers its next number; a title without one is not guessed at
    suggestion: latest && /\d/.test(latest.title) ? nextTitle(latest.title) : null,
  };
}

function initialDraft(params: { id?: string; parent?: string; subject?: string }) {
  const { scores, scoreTags } = useStore.getState();
  const ix = indexScores(scores);
  const cats = new Set(categoriesOf(scoreTags).map((t) => t.id));
  const editing = params.id ? ix.byId.get(params.id) : undefined;
  if (editing && editing.kind === 'exam') {
    const parts = subjectsOf(ix, editing.id);
    const rows: SubjectRow[] = parts.map((p) => ({
      key: rowKey(), id: p.id, title: p.title, score: num(p.score), outOf: num(p.outOf), weight: num(p.weight),
      locked: subjectsOf(ix, p.id).length > 0,
    }));
    if (params.subject) rows.push(emptyRow());
    const draft: Draft = {
      title: editing.title,
      date: editing.date || '',
      category: categoryOf(editing, scoreTags)?.id ?? null,
      tags: (editing.tags || []).filter((t) => !cats.has(t)),
      score: num(editing.score),
      outOf: num(editing.outOf),
      ownMarks: parts.length > 0 && (editing.score != null || editing.outOf != null),
      combine: editing.combine || 'sum',
      subjects: rows,
      target: num(editing.target),
      rank: num(editing.rank),
      percentile: num(editing.percentile),
      grade: editing.grade || '',
      note: editing.note || '',
    };
    return {
      draft, editId: editing.id, parentId: editing.parentId, template: null as Template | null, suggestion: null as string | null,
      originalIds: parts.map((p) => p.id), focusKey: params.subject ? rows[rows.length - 1].key : null,
    };
  }
  const parent = params.parent ? ix.byId.get(params.parent) : undefined;
  const parentId = parent && parent.kind === 'group' ? parent.id : null;
  // a new exam takes the category of the latest exam beside it
  const sibling = topExams(ix).filter((n) => n.parentId === parentId).sort(newestFirst)[0];
  const category = categoryOf(sibling, scoreTags)?.id ?? null;
  const t = templateFor(ix, scoreTags, category, parentId);
  const draft: Draft = {
    title: '', date: todayKey(), category, tags: [], score: '', outOf: t.rows.length ? '' : t.outOf, ownMarks: false,
    combine: t.combine, subjects: t.rows, target: '', rank: '', percentile: '', grade: '', note: '',
  };
  return { draft, editId: null as string | null, parentId, template: t.template, suggestion: t.suggestion, originalIds: [] as string[], focusKey: null };
}

type Problems = { title?: string; marks?: string; rows: Record<string, string>; details?: string };

/**
 * The exam form, on its own screen: name, category, date, every subject with its marks and the total adding up as
 * they are typed, then tags and the details a mock report carries. Used to add an exam and to edit one.
 */
export function ExamFormScreen() {
  const params = useLocalSearchParams<{ id?: string; parent?: string; subject?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const level = useAnimLevel();
  // what turns up after the form was built (the marks row, a weight, the total, a new category's field) fades in where
  // it stands; what the form is built with arrives with the form's own entrance
  const built = useBuilt();
  const popIn = built.current && level !== 'none' ? FadeIn.duration(level === 'full' ? 220 : 180).easing(EASE_OUT) : undefined;
  const scores = useStore((s) => s.scores);
  const tags = useStore((s) => s.scoreTags);
  const saveExam = useStore((s) => s.saveExam);
  const addScoreTag = useStore((s) => s.addScoreTag);
  const restoreScoreNodes = useStore((s) => s.restoreScoreNodes);
  const ix = React.useMemo(() => indexScores(scores), [scores]);

  const [init] = React.useState(() => initialDraft(params));
  const [d, setD] = React.useState<Draft>(init.draft);
  const [template, setTemplate] = React.useState<Template | null>(init.template);
  const [suggestion, setSuggestion] = React.useState<string | null>(init.suggestion);
  const [touched, setTouched] = React.useState(false);
  const [calendar, setCalendar] = React.useState(false);
  const [more, setMore] = React.useState(() => {
    const x = init.draft;
    return !!(x.target || x.rank || x.percentile || x.grade || x.note);
  });
  const [newCat, setNewCat] = React.useState<string | null>(null);
  const [problems, setProblems] = React.useState<Problems>({ rows: {} });
  // rows present when the screen opened come in with it; a row added later fades in on its own
  const firstRows = React.useRef(new Set(init.draft.subjects.map((r) => r.key))).current;

  const editing = !!init.editId;
  const categories = categoriesOf(tags);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const setRow = (key: string, patch: Partial<SubjectRow>) => {
    setTouched(true);
    setD((x) => ({ ...x, subjects: x.subjects.map((r) => (r.key === key ? { ...r, ...patch } : r)) }));
    if (problems.rows[key]) setProblems((p) => ({ ...p, rows: { ...p.rows, [key]: '' } }));
  };
  const addRow = () => {
    tick();
    setTouched(true);
    setD((x) => ({ ...x, subjects: [...x.subjects, emptyRow()] }));
  };
  const removeRow = (key: string) => {
    tick();
    setTouched(true);
    setD((x) => ({ ...x, subjects: x.subjects.filter((r) => r.key !== key) }));
  };

  // a new exam that changes category takes that category's subjects, as long as nothing has been typed into the
  // subjects or the whole exam's marks yet
  const pickCategory = (id: string | null, toggle = true) => {
    tick();
    const next = toggle && d.category === id ? null : id;
    if (editing || touched || d.score.trim() || (d.outOf.trim() && d.outOf !== init.draft.outOf)) {
      set({ category: next });
      return;
    }
    const t = templateFor(ix, tags, next, init.parentId);
    setTemplate(t.template);
    setSuggestion(t.suggestion);
    set({ category: next, subjects: t.rows, combine: t.combine, outOf: t.rows.length ? '' : t.outOf || d.outOf });
  };
  const makeCategory = () => {
    const name = (newCat || '').trim();
    if (!name) return;
    const id = addScoreTag(name, { category: true });
    setNewCat(null);
    if (id) pickCategory(id, false);
  };

  // the total, adding up as marks are typed; the same sum the exam's page will show
  const live = React.useMemo(() => {
    const rows = d.subjects.filter((r) => !blankRow(r) || r.id);
    if (!rows.length) return null;
    let full = 0;
    let fullKnown = true;
    const parts = rows.map((r) => {
      const weight = parseMark(r.weight).value;
      if (r.locked && r.id) {
        const node = ix.byId.get(r.id);
        const res = node ? resultOf(node, ix) : null;
        if (res?.outOf != null) full += res.outOf; else fullKnown = false;
        return { r: res, weight };
      }
      const sc = parseMark(r.score);
      const of = parseMark(r.outOf);
      if (!of.bad && of.value != null && of.value > 0) full += of.value; else fullKnown = false;
      const ok = !sc.bad && !of.bad && sc.value != null && of.value != null && !marksProblem(sc.value, of.value);
      const res: ScoreResult | null = ok
        ? { pct: ((sc.value as number) / (of.value as number)) * 100, score: sc.value, outOf: of.value, from: 'own' }
        : null;
      return { r: res, weight };
    });
    return { result: combineParts(parts, d.combine), count: rows.length, full: fullKnown ? full : null };
  }, [d.subjects, d.combine, ix]);

  const dirty = JSON.stringify(d) !== JSON.stringify(init.draft);
  const leaveRef = React.useRef(() => {});
  leaveRef.current = () => {
    if (!dirty) { router.back(); return; }
    Alert.alert(
      editing ? 'Discard your changes?' : 'Discard this exam?',
      editing ? 'What you changed here is not saved.' : 'What you typed here is not saved.',
      [{ text: 'Keep editing', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: () => router.back() }],
    );
  };
  useFocusEffect(React.useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { leaveRef.current(); return true; });
    return () => sub.remove();
  }, []));

  const save = () => {
    const found: Problems = { rows: {} };
    const title = d.title.trim();
    if (!title) found.title = 'Give the exam a name.';
    const kept = d.subjects.filter((r) => !(blankRow(r) && !r.id));
    const subjects: { id?: string; title: string; score?: number; outOf?: number; weight?: number }[] = [];
    for (const r of kept) {
      const name = r.title.trim();
      const weight = parseMark(r.weight);
      if (!name) { found.rows[r.key] = 'Name this subject, or take it out.'; continue; }
      if (d.combine === 'weighted' && (weight.bad || (weight.value !== undefined && !(weight.value > 0)))) {
        found.rows[r.key] = 'The weight must be more than 0.';
        continue;
      }
      if (r.locked && r.id) {
        const node = ix.byId.get(r.id);
        subjects.push({ id: r.id, title: name, score: node?.score, outOf: node?.outOf, weight: weight.value });
        continue;
      }
      const sc = parseMark(r.score);
      const of = parseMark(r.outOf);
      if (sc.bad || of.bad) { found.rows[r.key] = 'Use numbers for marks, like 42 or 42.5.'; continue; }
      const p = marksProblem(sc.value, of.value);
      if (p) { found.rows[r.key] = p; continue; }
      subjects.push({ id: r.id, title: name, score: sc.value, outOf: of.value, weight: weight.value });
    }
    const own = !kept.length || d.ownMarks;
    const score = parseMark(d.score);
    const outOf = parseMark(d.outOf);
    if (own) {
      if (score.bad || outOf.bad) found.marks = 'Use numbers for marks, like 42 or 42.5.';
      else {
        const p = marksProblem(score.value, outOf.value);
        if (p) found.marks = p;
      }
    }
    const goal = parseMark(d.target);
    const rank = parseMark(d.rank);
    const percentile = parseMark(d.percentile);
    if (goal.bad || (goal.value !== undefined && (goal.value < 0 || goal.value > 100))) found.details = 'A target is a percentage, from 0 to 100.';
    else if (rank.bad || (rank.value !== undefined && !(Number.isInteger(rank.value) && rank.value >= 1))) found.details = 'Rank is a whole number, like 1204.';
    else if (percentile.bad || (percentile.value !== undefined && (percentile.value < 0 || percentile.value > 100))) found.details = 'Percentile runs from 0 to 100.';
    setProblems(found);
    if (found.title || found.marks || found.details || Object.values(found.rows).some(Boolean)) {
      if (found.details) setMore(true);
      return;
    }
    const allTags = d.category ? [d.category, ...d.tags.filter((t) => t !== d.category)] : d.tags;
    const removeIds = init.originalIds.filter((id) => !kept.some((r) => r.id === id));
    const { id, removed } = saveExam({
      id: init.editId || undefined,
      parentId: init.parentId,
      fields: {
        title,
        date: d.date || undefined,
        score: own ? score.value : undefined,
        outOf: own ? outOf.value : undefined,
        combine: subjects.length ? d.combine : undefined,
        target: goal.value,
        rank: rank.value,
        percentile: percentile.value,
        grade: d.grade.trim() || undefined,
        note: d.note.trim() || undefined,
        tags: allTags.length ? allTags : undefined,
      },
      subjects,
      removeIds,
    });
    tap();
    router.back();
    if (!editing) openScoreNode(id);
    const out = removed.nodes.filter((n) => n.parentId === id).length;
    if (out) {
      toast('Saved. ' + out + (out === 1 ? ' subject' : ' subjects') + ' taken out', { label: 'Undo', onPress: () => restoreScoreNodes(removed) });
    } else if (!editing) {
      toast('Added ' + title);
    }
  };

  // The header names where the exam will be saved: its group (or the top level) and the category picked below, which
  // follows the chips as they are tapped. Always a page, so Back is the arrow, and it goes through the same
  // unsaved-changes guard as the hardware key.
  const group = init.parentId ? ix.byId.get(init.parentId) : undefined;
  const pickedCategory = d.category ? categories.find((c) => c.id === d.category) : undefined;
  const header = useToolHeader({
    title: editing ? 'Edit exam' : 'New exam',
    mode: 'page',
    context: contextLine(
      group ? ['In ', { em: group.title.trim() || 'Untitled group' }] : 'At the top level',
      pickedCategory && { em: pickedCategory.label },
    ),
    onBack: () => leaveRef.current(),
  });

  const today = todayKey();
  const yesterday = shiftKey(today, -1);
  const rowsShown = d.subjects;
  const hasSubjects = rowsShown.length > 0;
  const weighted = d.combine === 'weighted';
  const rowError = (key: string) => problems.rows[key];

  return (
    <ScreenBG>
      {header.bar}
      <Animated.ScrollView
        {...header.scrollProps}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[frame(READ_MAX), { paddingHorizontal: S.pad, paddingTop: header.padTop, paddingBottom: 32 }]}
      >
        <Enter index={0}>
          {header.hero}
          <Field
            label="Exam" value={d.title} onChangeText={(v) => { set({ title: v }); if (problems.title) setProblems((p) => ({ ...p, title: '' })); }}
            placeholder={suggestion || 'e.g. Mock test 7'} autoFocus={!editing && !suggestion} maxLength={80}
            style={{ fontSize: 20, letterSpacing: TRACK.large, fontFamily: F.semi, marginBottom: 0 }}
          />
          {problems.title ? <Text style={st.problem}>{problems.title}</Text> : null}
          {!d.title.trim() && suggestion ? (
            <View style={[st.chips, { marginTop: 12 }]}>
              <Chip small icon="sparkles-outline" label={suggestion} onPress={() => { tick(); set({ title: suggestion }); }} />
            </View>
          ) : null}
        </Enter>

        <Enter index={1}>
          <SectionTitle>Category</SectionTitle>
          <View style={st.chips}>
            {categories.map((c) => (
              <Chip key={c.id} small label={c.label} color={c.color} active={d.category === c.id} onPress={() => pickCategory(c.id)} />
            ))}
            {newCat == null ? (
              <Chip small icon="add" label={categories.length ? 'New category' : 'Make a category'} onPress={() => setNewCat('')} />
            ) : null}
          </View>
          {newCat != null ? (
            <Animated.View entering={popIn}>
              <Row style={{ alignItems: 'flex-start' }}>
                <Field
                  value={newCat} onChangeText={setNewCat} placeholder="e.g. JEE Main mocks" maxLength={40} autoFocus
                  style={{ flex: 1, marginBottom: 0 }} onSubmitEditing={makeCategory} returnKeyType="done"
                />
                <IconBtn
                  name="add-circle" color={newCat.trim() ? C.accent : C.textFaint} size={26} style={{ marginLeft: 8, marginTop: 4 }}
                  onPress={makeCategory} accessibilityLabel="Make this category"
                />
              </Row>
            </Animated.View>
          ) : null}
          <Text style={[st.hint, { marginTop: newCat != null ? 8 : 0 }]}>
            {categories.length
              ? 'It goes on the exam as a tag. Analytics compares the exams inside each category.'
              : 'Keep like with like, such as JEE Main mocks apart from unit tests. Analytics compares the exams inside each.'}
          </Text>
        </Enter>

        <Enter index={2}>
          <SectionTitle>Date</SectionTitle>
          <View style={st.chips}>
            <Chip small label="Today" active={d.date === today} onPress={() => { set({ date: today }); setCalendar(false); }} />
            <Chip small label="Yesterday" active={d.date === yesterday} onPress={() => { set({ date: yesterday }); setCalendar(false); }} />
            <Chip small icon="calendar-outline" label="Pick a day" active={calendar} onPress={() => setCalendar(!calendar)} />
            <Chip small label="No date" active={!d.date} onPress={() => { set({ date: '' }); setCalendar(false); }} />
          </View>
          <Text style={st.hint}>
            {d.date ? fmtExamDate(d.date, true) + (d.date > today ? ', coming up' : '') : 'No date'}
          </Text>
          {calendar ? (
            <Animated.View entering={level === 'none' ? undefined : FadeIn.duration(200)} style={{ marginTop: 12 }}>
              <JournalCalendar value={d.date} onPick={(k) => { set({ date: k }); setCalendar(false); }} />
            </Animated.View>
          ) : null}
        </Enter>

        <Enter index={3}>
          <SectionTitle
            right={hasSubjects ? (
              <Pressable onPress={addRow} hitSlop={8} accessibilityRole="button" accessibilityLabel="Add a subject">
                <Text style={[st.link, { color: C.accent }]}>+ Add</Text>
              </Pressable>
            ) : undefined}
          >
            Subjects
          </SectionTitle>
          {template && !touched && hasSubjects ? (
            <View style={st.templateRow}>
              <Text style={[st.hint, { flex: 1, marginTop: 0 }]}>From {template.title}: its subjects and totals. Change anything.</Text>
              <Pressable
                onPress={() => { tick(); setTouched(true); setTemplate(null); set({ subjects: [] }); }}
                hitSlop={8} accessibilityRole="button"
              >
                <Text style={[st.link, { color: C.accent, marginLeft: 12 }]}>Start blank</Text>
              </Pressable>
            </View>
          ) : null}
          <Animated.View key={hasSubjects ? 'rows' : 'none'} entering={popIn}>
            {hasSubjects ? (
              <Card pad={16}>
                <View style={st.headRow}>
                  <Text style={[st.colHead, { flex: 1 }]}>Subject</Text>
                  <Text style={[st.colHead, st.numCol]}>Score</Text>
                  <View style={st.slash} />
                  <Text style={[st.colHead, st.numCol]}>Out of</Text>
                  <View style={st.removeCol} />
                </View>
                {rowsShown.map((r, i) => {
                  const lockedNode = r.locked && r.id ? ix.byId.get(r.id) : undefined;
                  const lockedRes = lockedNode ? resultOf(lockedNode, ix) : null;
                  return (
                    <Animated.View
                      key={r.key}
                      entering={firstRows.has(r.key) || level === 'none' ? undefined : FadeIn.duration(level === 'full' ? 220 : 180)}
                      exiting={level === 'none' ? undefined : FadeOut.duration(140)}
                    >
                      {i > 0 ? <View style={{ height: 6 }} /> : null}
                      <View style={st.subjectRow}>
                        <Field
                          value={r.title} onChangeText={(v) => setRow(r.key, { title: v })} placeholder={i === 0 ? 'Physics' : 'Subject'}
                          maxLength={60} autoFocus={r.key === init.focusKey || (!firstRows.has(r.key) && !r.title)}
                          style={{ flex: 1, marginBottom: 0 }}
                        />
                        {r.locked ? (
                          <Text style={[st.lockedPct, { width: 56 * 2 + 16 }]} numberOfLines={1}>
                            {lockedRes ? fmtPct(lockedRes.pct) : 'Not marked'}
                          </Text>
                        ) : (
                          <>
                            <Field
                              value={r.score} onChangeText={(v) => setRow(r.key, { score: v })} placeholder="-"
                              keyboardType="numeric" style={[st.numField, { marginBottom: 0 }]} maxLength={8}
                              accessibilityLabel={(r.title || 'Subject') + ' score'}
                            />
                            <Text style={st.slashText}>/</Text>
                            <Field
                              value={r.outOf} onChangeText={(v) => setRow(r.key, { outOf: v })} placeholder="100"
                              keyboardType="numeric" style={[st.numField, { marginBottom: 0 }]} maxLength={8}
                              accessibilityLabel={(r.title || 'Subject') + ' out of'}
                            />
                          </>
                        )}
                        <IconBtn
                          name="remove-circle-outline" size={19} color={C.textFaint} pad={6} style={{ marginLeft: 2 }}
                          onPress={() => removeRow(r.key)} accessibilityLabel={'Take out ' + (r.title || 'this subject')}
                        />
                      </View>
                      {weighted ? (
                        <Animated.View entering={popIn} style={st.weightRow}>
                          <Text style={st.colHead}>Weight</Text>
                          <Field
                            value={r.weight} onChangeText={(v) => setRow(r.key, { weight: v })} placeholder="1"
                            keyboardType="numeric" style={[st.numField, { marginBottom: 0, marginLeft: 10 }]} maxLength={6}
                            accessibilityLabel={(r.title || 'Subject') + ' weight'}
                          />
                        </Animated.View>
                      ) : null}
                      {r.locked ? <Text style={st.hint}>Has subjects of its own. Its marks are theirs; change them on its page.</Text> : null}
                      {rowError(r.key) ? <Text style={st.problem}>{rowError(r.key)}</Text> : null}
                    </Animated.View>
                  );
                })}
                <View style={{ flexDirection: 'row', marginTop: 16 }}>
                  <Chip small icon="add" label="Add a subject" onPress={addRow} />
                </View>
                {live ? (
                  <Animated.View entering={popIn}>
                    <Hairline />
                    <View style={st.totalRow}>
                      <Text style={T.kicker}>{d.ownMarks ? 'Subjects add up to' : 'Total'}</Text>
                      <View style={{ alignItems: 'flex-end' }}>
                        {live.result ? (
                          <Text style={st.totalPct}>
                            {live.result.score != null && live.result.outOf != null
                              ? fmtMark(live.result.score) + ' / ' + fmtMark(live.result.outOf) + '  ·  '
                              : ''}
                            {fmtPct(live.result.pct)}
                          </Text>
                        ) : (
                          <Text style={[st.totalPct, { color: C.textFaint }]}>
                            {live.full != null && live.full > 0 ? 'Out of ' + fmtMark(live.full) : 'Not marked yet'}
                          </Text>
                        )}
                        {live.result && live.result.marked != null && live.result.parts != null && live.result.marked < live.result.parts ? (
                          <Text style={[T.caption, { marginTop: 2 }]}>{live.result.marked} of {live.result.parts} marked</Text>
                        ) : null}
                      </View>
                    </View>
                  </Animated.View>
                ) : null}
              </Card>
            ) : (
              <Card pad={18}>
                <Text style={T.label}>
                  Split it into subjects, like Physics, Chemistry and Maths, and their marks add up as you type. Or give the whole exam one mark below.
                </Text>
                <View style={{ flexDirection: 'row', marginTop: 14 }}>
                  <Chip small icon="add" label="Add a subject" onPress={addRow} />
                </View>
              </Card>
            )}
          </Animated.View>
          {rowsShown.length >= 2 ? (
            <View style={{ marginTop: 18 }}>
              <Text style={st.label}>How subjects add up</Text>
              <SegmentedControl
                size="sm" stretch
                options={[{ key: 'sum', label: 'Add up marks' }, { key: 'weighted', label: 'Weighted' }]}
                value={d.combine}
                onChange={(k) => set({ combine: k as Draft['combine'] })}
              />
              <Text style={st.hint}>
                {weighted ? 'Each subject counts by its weight, as a percentage. 1 when a weight is empty.' : 'Marks are added up, so a subject out of more counts for more.'}
              </Text>
            </View>
          ) : null}
        </Enter>

        <Enter index={4}>
          <SectionTitle>Marks</SectionTitle>
          {hasSubjects ? (
            <Row style={{ alignItems: 'center' }}>
              <Text style={[T.body, { flex: 1 }]}>Enter the whole exam's marks</Text>
              <Toggle value={d.ownMarks} onChange={(v) => set({ ownMarks: v })} label="Enter the whole exam's marks" />
            </Row>
          ) : null}
          {!hasSubjects || d.ownMarks ? (
            <Animated.View entering={popIn}>
              <Row style={{ alignItems: 'flex-start', gap: 14, marginTop: hasSubjects ? 12 : 0 }}>
                <Field
                  label="Score" value={d.score} onChangeText={(v) => set({ score: v })} placeholder="68"
                  keyboardType="numeric" style={{ flex: 1, marginBottom: 0 }} maxLength={10}
                />
                <Field
                  label="Out of" value={d.outOf} onChangeText={(v) => set({ outOf: v })} placeholder="100"
                  keyboardType="numeric" style={{ flex: 1, marginBottom: 0 }} maxLength={10}
                />
              </Row>
            </Animated.View>
          ) : null}
          <Text style={problems.marks ? st.problem : st.hint}>
            {problems.marks
              || (hasSubjects
                ? d.ownMarks
                  ? 'These are the marks shown for the exam, whatever its subjects add up to.'
                  : "Only when the paper's total is not the sum of its subjects."
                : 'Negative marks are fine, like -4. Leave it empty for an exam still to come.')}
          </Text>
        </Enter>

        <Enter index={5}>
          <View style={{ marginTop: S.section }}>
            <TagPicker value={d.tags} onChange={(v) => set({ tags: v })} />
          </View>
        </Enter>

        <Enter index={6}>
          <Pressable onPress={() => setMore(!more)} hitSlop={8} style={st.moreRow} accessibilityRole="button">
            <Text style={[st.link, { color: C.accent }]}>More details</Text>
            <Ionicons name={more ? 'chevron-up' : 'chevron-down'} size={15} color={C.accent} />
          </Pressable>
          {more ? (
            <Animated.View entering={level === 'none' ? undefined : FadeIn.duration(200)}>
              <Row style={{ alignItems: 'flex-start', gap: 14 }}>
                <Field label="Target %" value={d.target} onChangeText={(v) => set({ target: v })} placeholder="75" keyboardType="numeric" style={{ flex: 1 }} />
                <Field label="Rank" value={d.rank} onChangeText={(v) => set({ rank: v })} placeholder="1204" keyboardType="numeric" style={{ flex: 1 }} />
              </Row>
              <Row style={{ alignItems: 'flex-start', gap: 14 }}>
                <Field label="Percentile" value={d.percentile} onChangeText={(v) => set({ percentile: v })} placeholder="97.2" keyboardType="numeric" style={{ flex: 1 }} />
                <Field label="Grade" value={d.grade} onChangeText={(v) => set({ grade: v })} placeholder="A or 8.6" maxLength={12} style={{ flex: 1 }} />
              </Row>
              <Field label="Note" value={d.note} onChangeText={(v) => set({ note: v })} placeholder="What went well, what to fix next time" multiline maxLength={600} />
            </Animated.View>
          ) : null}
          {problems.details ? <Text style={st.problem}>{problems.details}</Text> : null}
        </Enter>
      </Animated.ScrollView>

      <View style={[frame(READ_MAX), st.bar, { paddingBottom: insets.bottom + 14 }]}>
        <PillButton label={editing ? 'Save' : 'Add exam'} icon={editing ? 'checkmark' : 'add'} onPress={save} />
      </View>
    </ScreenBG>
  );
}

const st = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  label: { color: C.textFaint, fontFamily: F.med, fontSize: 12, letterSpacing: TRACK.fine, marginLeft: 2, marginBottom: 8 },
  hint: { color: C.textFaint, fontFamily: F.reg, fontSize: 12, letterSpacing: TRACK.fine, lineHeight: 17, marginTop: 6 },
  problem: { color: C.danger, fontFamily: F.med, fontSize: 12, letterSpacing: TRACK.fine, lineHeight: 17, marginTop: 6 },
  link: { fontFamily: F.semi, fontSize: 13, letterSpacing: TRACK.small },
  templateRow: { flexDirection: 'row', alignItems: 'center', marginTop: -4, marginBottom: 12, paddingHorizontal: 2 },
  headRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  colHead: { color: C.textFaint, fontFamily: F.med, fontSize: 11, letterSpacing: TRACK.fine },
  numCol: { width: 56, textAlign: 'center' },
  slash: { width: 16 },
  removeCol: { width: 33 },
  subjectRow: { flexDirection: 'row', alignItems: 'flex-end' },
  numField: { width: 56, textAlign: 'center', fontVariant: ['tabular-nums'], marginLeft: 0 },
  slashText: { width: 16, textAlign: 'center', color: C.textFaint, fontFamily: F.reg, fontSize: 15, letterSpacing: TRACK.body, paddingBottom: 11 },
  lockedPct: { color: C.textDim, fontFamily: F.med, fontSize: 14, letterSpacing: TRACK.small, textAlign: 'center', paddingBottom: 11, fontVariant: ['tabular-nums'] },
  weightRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 4, marginLeft: 2 },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 14 },
  totalPct: { ...T.numStat, fontSize: 17, lineHeight: 22, letterSpacing: TRACK.title },
  moreRow: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 4, marginTop: 22, marginBottom: 14 },
  bar: { paddingHorizontal: S.pad, paddingTop: 10 },
});

