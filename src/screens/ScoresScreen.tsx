import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert, BackHandler } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { C, F, MIN, NEU, S, T, neuRaised } from '../theme';
import { useStore } from '../store';
import {
  ScoreNode, ScoreIndex, indexScores, resultOf, partsMismatch, groupSummary, examsUnder, upcoming, deltaVsPrevious,
  pathOf, descendantIds, canMove, fmtPct, fmtMark, fmtExamDate, fromToday, whenOf,
} from '../scores';
import { todayKey } from '../utils';
import {
  ScreenBG, Card, SectionTitle, EmptyState, ListCard, ListRow, NeuHeader, NeuIconBtn, DotMenu, Sheet, Hairline,
  PillButton, Chip, useTheme,
} from '../components/UI';
import { Bouncy, Enter, useFocusKey } from '../components/Motion';
import { Sparkline } from '../components/Sparkline';
import { ScoreEditor, ScoreEditTarget } from '../components/ScoreEditor';
import { toast } from '../components/Toast';
import { tap, tick } from '../haptics';
import { READ_MAX, frame } from '../layout';

type Sort = 'newest' | 'oldest' | 'best' | 'az';
const SORTS: { key: Sort; label: string }[] = [
  { key: 'newest', label: 'Newest' }, { key: 'oldest', label: 'Oldest' }, { key: 'best', label: 'Best' }, { key: 'az', label: 'A to Z' },
];

const plural = (n: number, one: string, many = one + 's') => n + ' ' + (n === 1 ? one : many);

/** How far a result moved: a small caret and the points, green up, muted red down. */
function Delta({ value, style }: { value: number; style?: any }) {
  const r = Math.round(value * 10) / 10;
  if (r === 0) return <Text style={[st.delta, { color: C.textFaint }, style]}>no change</Text>;
  const up = r > 0;
  return (
    <View style={[st.deltaRow, style]}>
      <Ionicons name={up ? 'caret-up' : 'caret-down'} size={11} color={up ? C.green : C.danger} />
      <Text style={[st.delta, { color: up ? C.green : C.danger }]}>{Math.abs(r)}</Text>
    </View>
  );
}

/** A result as a carved track with the accent filling it to the percentage. */
function Bar({ pct }: { pct: number }) {
  const theme = useTheme();
  return (
    <View style={[st.barTrack, theme === 'minimal' ? { backgroundColor: MIN.inset } : { backgroundColor: C.inset, ...NEU.insetHairline }]}>
      <View style={[st.barFill, { width: `${Math.max(0, Math.min(100, pct))}%`, backgroundColor: C.accent }]} />
    </View>
  );
}

/**
 * Exam scores: groups hold groups and exams, an exam holds sub-exams. The page walks the tree in place (hardware back
 * climbs one level), so it works the same in a tab slot and as a full page.
 */
export function ScoresScreen({ mode }: { mode: 'tab' | 'stack' }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const theme = useTheme();
  const fk = useFocusKey();
  const scores = useStore((s) => s.scores);
  const removeScoreNode = useStore((s) => s.removeScoreNode);
  const restoreScoreNodes = useStore((s) => s.restoreScoreNodes);
  const duplicateScoreNode = useStore((s) => s.duplicateScoreNode);
  const moveScoreNode = useStore((s) => s.moveScoreNode);
  const ix = useMemo(() => indexScores(scores), [scores]);
  const today = todayKey();

  const [cwd, setCwd] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>('newest');
  const [editor, setEditor] = useState<ScoreEditTarget | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  // menus keep their node while they close, so their rows never empty out mid-animation
  const [menuNode, setMenuNode] = useState<ScoreNode | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [moveNode, setMoveNode] = useState<ScoreNode | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const moved = useRef<string | null>(null);
  const [areaW, setAreaW] = useState(0);

  const here = cwd ? ix.byId.get(cwd) : undefined;

  // a page whose node goes away (a delete, an undo, an import) climbs to the nearest level that still exists
  const trail = useRef<string[]>([]);
  useEffect(() => {
    if (cwd && here) {
      trail.current = [...pathOf(ix, cwd).map((n) => n.id), cwd];
      return;
    }
    if (cwd && !here) {
      const alive = [...trail.current].reverse().find((id) => ix.byId.has(id));
      setCwd(alive ?? null);
    }
  }, [cwd, here, ix]);

  const hereRef = useRef(here);
  hereRef.current = here;
  const goUp = React.useCallback(() => {
    const cur = hereRef.current;
    if (!cur) return false;
    setCwd(cur.parentId);
    return true;
  }, []);
  useFocusEffect(React.useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', goUp);
    return () => sub.remove();
  }, [goUp]));

  const openMenu = (n: ScoreNode) => { setMenuNode(n); setMenuOpen(true); };

  const confirmDelete = (n: ScoreNode) => {
    const below = [...descendantIds(ix, n.id)].map((id) => ix.byId.get(id)).filter(Boolean) as ScoreNode[];
    const run = () => {
      const removed = removeScoreNode(n.id);
      if (!removed.length) return;
      tap();
      toast('Deleted ' + (n.title || (n.kind === 'group' ? 'the group' : 'the exam')), {
        label: 'Undo',
        onPress: () => restoreScoreNodes(removed),
      });
    };
    if (!below.length) { run(); return; }
    const exams = below.filter((x) => x.kind === 'exam').length;
    const groups = below.length - exams;
    const what = n.kind === 'exam'
      ? (exams === 1 ? 'Its sub-exam goes with it.' : 'Its ' + exams + ' sub-exams go with it.')
      : 'Everything inside goes with it: ' + [exams ? plural(exams, 'exam') : '', groups ? plural(groups, 'group') : ''].filter(Boolean).join(' and ') + '.';
    Alert.alert('Delete ' + (n.title || 'this') + '?', what, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: run },
    ]);
  };

  const duplicate = (n: ScoreNode) => {
    const id = duplicateScoreNode(n.id);
    const copy = id ? useStore.getState().scores.find((x) => x.id === id) : undefined;
    if (copy) toast('Added ' + copy.title + ', ready for its marks');
  };

  const menuItems = (n: ScoreNode, open: boolean) => [
    ...(open ? [{ label: 'Open', icon: 'open-outline', onPress: () => setCwd(n.id) }] : []),
    { label: n.kind === 'group' ? 'Rename' : 'Edit', icon: 'create-outline', onPress: () => setEditor({ mode: 'edit', id: n.id }) },
    { label: 'Duplicate without marks', icon: 'copy-outline', onPress: () => duplicate(n) },
    { label: 'Move to…', icon: 'return-down-forward-outline', onPress: () => { setMoveNode(n); setMoveOpen(true); } },
    { label: 'Delete', icon: 'trash-outline', color: C.danger, onPress: () => confirmDelete(n) },
  ];

  // where the node in the move sheet may go: the top level and every group it may enter, labelled by their path
  const destinations = useMemo(() => {
    if (!moveNode) return [];
    const groups = scores
      .filter((g) => g.kind === 'group')
      .map((g) => ({ id: g.id as string | null, label: [...pathOf(ix, g.id).map((p) => p.title), g.title].join(' / ') }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return [{ id: null as string | null, label: 'Top level' }, ...groups].filter((dst) => canMove(ix, moveNode.id, dst.id));
  }, [moveNode, scores, ix]);

  const titleOf = (n: ScoreNode | undefined) => (n ? n.title || (n.kind === 'group' ? 'Untitled group' : 'Untitled exam') : 'Scores');
  const fabRight = areaW > READ_MAX ? (areaW - READ_MAX) / 2 + 20 : 20;
  const inExam = here?.kind === 'exam';

  return (
    <ScreenBG guard={mode === 'tab'}>
      <View style={{ flex: 1 }} onLayout={(e) => setAreaW(e.nativeEvent.layout.width)}>
        <NeuHeader
          title={titleOf(here)}
          variant={mode === 'tab' && !here ? 'tab' : 'page'}
          onBack={() => { if (!goUp()) router.back(); }}
          right={here ? (
            <NeuIconBtn name="ellipsis-horizontal" dim={38} size={18} color={C.textDim} onPress={() => openMenu(here)} />
          ) : undefined}
        />
        <ScrollView
          key={fk + ':' + (cwd || 'top')}
          contentContainerStyle={[
            frame(READ_MAX),
            { padding: S.pad, paddingTop: 4, paddingBottom: (inExam ? 40 : 120) + (mode === 'tab' ? 0 : insets.bottom) },
          ]}
        >
          {here && pathOf(ix, here.id).length ? (
            <Text style={[T.kicker, { marginBottom: 12 }]} numberOfLines={1}>
              {pathOf(ix, here.id).map((p) => titleOf(p)).join('  /  ')}
            </Text>
          ) : null}
          {inExam && here ? (
            <ExamView
              exam={here} ix={ix} today={today} onOpen={setCwd} onMenu={openMenu}
              onEdit={() => setEditor({ mode: 'edit', id: here.id })}
              onAddPart={() => setEditor({ mode: 'new', kind: 'exam', parentId: here.id })}
            />
          ) : (
            <GroupView
              groupId={here?.id ?? null} group={here} ix={ix} today={today} sort={sort}
              onSort={() => { tick(); setSort(SORTS[(SORTS.findIndex((x) => x.key === sort) + 1) % SORTS.length].key); }}
              onOpen={setCwd} onMenu={openMenu}
              onAdd={() => setEditor({ mode: 'new', kind: 'exam', parentId: here?.id ?? null })}
            />
          )}
        </ScrollView>

        {!inExam ? (
          <Bouncy
            radius={999}
            scaleTo={0.9}
            style={[
              st.fab,
              { right: fabRight, bottom: mode === 'tab' ? 24 : insets.bottom + 20 },
              theme === 'minimal'
                ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: C.accent }
                : { backgroundColor: C.card, ...neuRaised('high') },
            ]}
            onPress={() => { tap(); setAddOpen(true); }}
          >
            <Ionicons name="add" size={30} color={C.accent} />
          </Bouncy>
        ) : null}
      </View>

      <DotMenu
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        items={[
          { label: here ? 'New exam in ' + titleOf(here) : 'New exam', icon: 'ribbon-outline', onPress: () => setEditor({ mode: 'new', kind: 'exam', parentId: here?.id ?? null }) },
          { label: here ? 'New group in ' + titleOf(here) : 'New group', icon: 'folder-outline', onPress: () => setEditor({ mode: 'new', kind: 'group', parentId: here?.id ?? null }) },
        ]}
      />
      <DotMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        items={menuNode ? menuItems(menuNode, menuNode.id !== cwd) : []}
      />
      <Sheet
        visible={moveOpen}
        onClose={() => setMoveOpen(false)}
        onClosed={() => { const m = moved.current; moved.current = null; if (m) toast(m); }}
        title={moveNode ? 'Move ' + titleOf(moveNode) : 'Move'}
      >
        {destinations.map((dst, i) => {
          const current = moveNode?.parentId === dst.id;
          return (
            <View key={dst.id || 'top'}>
              {i > 0 && <Hairline />}
              <Bouncy
                disabled={current}
                onPress={() => {
                  if (moveNode && moveScoreNode(moveNode.id, dst.id)) { tick(); moved.current = 'Moved to ' + dst.label; }
                  setMoveOpen(false);
                }}
                scaleTo={0.98}
                radius={S.radiusSm}
                style={st.moveRow}
              >
                <Ionicons name={dst.id ? 'folder-outline' : 'layers-outline'} size={19} color={current ? C.textFaint : C.accent} />
                <Text style={[T.body, { flex: 1, marginLeft: 12, fontFamily: F.med }, current && { color: C.textFaint }]} numberOfLines={1}>{dst.label}</Text>
                {current ? <Text style={T.caption}>Here now</Text> : null}
              </Bouncy>
            </View>
          );
        })}
        {moveNode?.kind === 'exam' ? (
          <Text style={[T.caption, { marginTop: 12 }]}>To make an exam part of another one, add it there as a sub-exam.</Text>
        ) : null}
      </Sheet>
      <ScoreEditor target={editor} onClose={() => setEditor(null)} />
    </ScreenBG>
  );
}

/* ---------------- a group, or the top level ---------------- */

function GroupView({ groupId, group, ix, today, sort, onSort, onOpen, onMenu, onAdd }: {
  groupId: string | null; group?: ScoreNode; ix: ScoreIndex; today: string; sort: Sort;
  onSort: () => void; onOpen: (id: string) => void; onMenu: (n: ScoreNode) => void; onAdd: () => void;
}) {
  const kids = ix.children.get(groupId) || [];
  const groups = kids.filter((k) => k.kind === 'group').sort((a, b) => a.title.localeCompare(b.title));
  const exams = useMemo(() => {
    const list = kids.filter((k) => k.kind === 'exam');
    const pct = (n: ScoreNode) => resultOf(n, ix)?.pct ?? -Infinity;
    const byWhen = (a: ScoreNode, b: ScoreNode) => whenOf(a).localeCompare(whenOf(b)) || a.createdAt - b.createdAt;
    if (sort === 'oldest') return list.sort(byWhen);
    if (sort === 'best') return list.sort((a, b) => pct(b) - pct(a) || byWhen(b, a));
    if (sort === 'az') return list.sort((a, b) => a.title.localeCompare(b.title));
    return list.sort((a, b) => byWhen(b, a));
  }, [kids, sort, ix]);
  const summary = groupSummary(ix, groupId);
  const soon = upcoming(ix, groupId, today).slice(0, 4);
  let enter = 0;

  if (!kids.length) {
    return (
      <EmptyState
        icon={groupId ? 'folder-open-outline' : 'ribbon-outline'}
        title={groupId ? 'This group is empty' : 'No exams yet'}
        body={groupId ? 'Add an exam, or a group inside this one.' : 'Add an exam, or a group to keep a series together, like mock tests or a school term.'}
        actionLabel="Add an exam"
        onAction={onAdd}
      />
    );
  }

  return (
    <>
      {summary ? (
        <Enter index={enter++}>
          <Card hero pad={20} style={{ marginBottom: S.gap }}>
            <View style={st.heroRow}>
              <View style={{ flex: 1 }}>
                <Text style={T.kicker}>Average</Text>
                <Text style={st.heroPct}>{fmtPct(summary.average)}</Text>
                <Text style={T.caption}>
                  across {plural(summary.marked, 'marked exam')}
                  {group?.target != null ? '  ·  target ' + fmtPct(group.target) : ''}
                </Text>
              </View>
              <View style={st.heroSide}>
                <Text style={T.caption}>Best</Text>
                <Text style={st.sideVal}>{fmtPct(summary.best.pct)}</Text>
                <Text style={[T.caption, { marginTop: 8 }]}>Latest</Text>
                <View style={st.sideRow}>
                  <Text style={st.sideVal}>{fmtPct(summary.latest.pct)}</Text>
                  {summary.latest.delta != null ? <Delta value={summary.latest.delta} style={{ marginLeft: 6 }} /> : null}
                </View>
              </View>
            </View>
            {summary.series.length > 1 ? (
              <View style={{ marginTop: 16 }}>
                <Sparkline values={summary.series.map((x) => x.pct)} target={group?.target} />
              </View>
            ) : null}
          </Card>
        </Enter>
      ) : null}

      {soon.length ? (
        <Enter index={enter++}>
          <SectionTitle>Coming up</SectionTitle>
          <ListCard>
            {soon.map((n) => (
              <ListRow key={n.id} onPress={() => onOpen(n.id)} onLongPress={() => onMenu(n)} style={{ paddingVertical: 12 }}>
                <Ionicons name="calendar-outline" size={18} color={C.accent} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={st.rowTitle} numberOfLines={1}>{n.title || 'Untitled exam'}</Text>
                  <Text style={[T.caption, { marginTop: 2 }]}>{fmtExamDate(n.date as string)}</Text>
                </View>
                <Text style={[st.when, { color: C.accent }]}>{fromToday(n.date as string, today)}</Text>
              </ListRow>
            ))}
          </ListCard>
        </Enter>
      ) : null}

      <Enter index={enter++}>
        <SectionTitle
          right={exams.length > 1 ? (
            <Pressable onPress={onSort} hitSlop={8} accessibilityRole="button" accessibilityLabel={'Sorted by ' + SORTS.find((x) => x.key === sort)?.label}>
              <Text style={[st.link, { color: C.accent }]}>{SORTS.find((x) => x.key === sort)?.label}</Text>
            </Pressable>
          ) : undefined}
        >
          {groups.length && exams.length ? 'Groups and exams' : groups.length ? 'Groups' : 'Exams'}
        </SectionTitle>
        <ListCard>
          {groups.map((g) => {
            const count = examsUnder(ix, g.id).length;
            const s = groupSummary(ix, g.id);
            return (
              <ListRow key={g.id} onPress={() => onOpen(g.id)} onLongPress={() => onMenu(g)} style={{ paddingVertical: 12 }}>
                <Ionicons name="folder-outline" size={20} color={C.accent} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={st.rowTitle} numberOfLines={1}>{g.title || 'Untitled group'}</Text>
                  <Text style={[T.caption, { marginTop: 2 }]} numberOfLines={1}>
                    {count ? plural(count, 'exam') + (s ? '  ·  ' + fmtPct(s.average) + ' average' : '') : 'Empty'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={17} color={C.textFaint} />
              </ListRow>
            );
          })}
          {exams.map((n) => <ExamRow key={n.id} n={n} ix={ix} today={today} onOpen={onOpen} onMenu={onMenu} />)}
        </ListCard>
      </Enter>
    </>
  );
}

function ExamRow({ n, ix, today, onOpen, onMenu }: {
  n: ScoreNode; ix: ScoreIndex; today: string; onOpen: (id: string) => void; onMenu: (n: ScoreNode) => void;
}) {
  const r = resultOf(n, ix);
  const parts = (ix.children.get(n.id) || []).filter((k) => k.kind === 'exam').length;
  const delta = r ? deltaVsPrevious(n, ix) : null;
  const upcomingDay = !r && n.date && n.date >= today;
  const caption = [n.date ? fmtExamDate(n.date) : '', parts ? plural(parts, 'sub-exam') : ''].filter(Boolean).join('  ·  ');
  return (
    <ListRow onPress={() => onOpen(n.id)} onLongPress={() => onMenu(n)} style={{ paddingVertical: 12 }}>
      <View style={{ flex: 1 }}>
        <Text style={st.rowTitle} numberOfLines={1}>{n.title || 'Untitled exam'}</Text>
        {caption ? <Text style={[T.caption, { marginTop: 2 }]} numberOfLines={1}>{caption}</Text> : null}
      </View>
      {r ? (
        <View style={st.rowRight}>
          <Text style={st.rowPct}>{fmtPct(r.pct)}</Text>
          <View style={st.sideRow}>
            {r.score != null && r.outOf != null ? <Text style={T.caption}>{fmtMark(r.score)} / {fmtMark(r.outOf)}</Text> : null}
            {delta != null ? <Delta value={delta} style={{ marginLeft: 6 }} /> : null}
          </View>
        </View>
      ) : (
        <Text style={[st.when, { color: upcomingDay ? C.accent : C.textFaint }]}>
          {upcomingDay ? fromToday(n.date as string, today) : 'Not marked'}
        </Text>
      )}
    </ListRow>
  );
}

/* ---------------- one exam ---------------- */

function ExamView({ exam, ix, today, onOpen, onMenu, onEdit, onAddPart }: {
  exam: ScoreNode; ix: ScoreIndex; today: string; onOpen: (id: string) => void; onMenu: (n: ScoreNode) => void;
  onEdit: () => void; onAddPart: () => void;
}) {
  const r = resultOf(exam, ix);
  const parts = (ix.children.get(exam.id) || []).filter((k) => k.kind === 'exam').sort((a, b) => a.createdAt - b.createdAt);
  const mismatch = partsMismatch(exam, ix);
  const delta = r ? deltaVsPrevious(exam, ix) : null;
  const parent = exam.parentId ? ix.byId.get(exam.parentId) : undefined;
  const weighted = (exam.combine || 'sum') === 'weighted';
  const facts = [
    exam.rank != null ? 'Rank ' + exam.rank.toLocaleString('en-IN') : '',
    exam.percentile != null ? fmtMark(exam.percentile) + ' percentile' : '',
    exam.grade ? 'Grade ' + exam.grade : '',
  ].filter(Boolean).join('  ·  ');
  const gap = r && exam.target != null ? r.pct - exam.target : null;

  return (
    <>
      <Enter index={0}>
        <Card hero pad={20} style={{ marginBottom: S.gap }}>
          <Text style={T.kicker} numberOfLines={1}>
            {exam.date ? fmtExamDate(exam.date, true) + '  ·  ' + fromToday(exam.date, today) : parent?.kind === 'exam' ? 'Part of ' + (parent.title || 'an exam') : 'No date'}
          </Text>
          {r ? (
            <>
              <Text style={st.heroPct}>{fmtPct(r.pct)}</Text>
              {r.score != null && r.outOf != null ? (
                <Text style={st.heroMarks}>{fmtMark(r.score)} / {fmtMark(r.outOf)}</Text>
              ) : null}
              {r.from === 'parts' && r.marked != null && r.parts != null && r.marked < r.parts ? (
                <Text style={[T.caption, { marginTop: 4 }]}>{r.marked} of {plural(r.parts, 'sub-exam')} marked</Text>
              ) : null}
            </>
          ) : (
            <>
              <Text style={st.unmarked}>Not marked yet</Text>
              {!parts.length ? (
                <View style={{ flexDirection: 'row', marginTop: 14 }}>
                  <PillButton small label="Add marks" icon="create-outline" onPress={onEdit} />
                </View>
              ) : null}
            </>
          )}
          {facts ? <Text style={[st.facts, { marginTop: 12 }]}>{facts}</Text> : null}
          {gap != null || delta != null ? (
            <View style={[st.sideRow, { marginTop: 8, flexWrap: 'wrap', gap: 14 }]}>
              {gap != null ? (
                <Text style={[T.caption, { color: gap >= 0 ? C.green : C.danger }]}>
                  Target {fmtPct(exam.target as number)}
                  {Math.round(gap * 10) === 0 ? ', on target' : ', ' + Math.abs(Math.round(gap * 10) / 10) + (gap > 0 ? ' above' : ' below')}
                </Text>
              ) : null}
              {delta != null ? (
                <View style={st.sideRow}>
                  <Delta value={delta} />
                  <Text style={[T.caption, { marginLeft: 4 }]}>on the one before</Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </Card>
      </Enter>

      {mismatch ? (
        <Enter index={1}>
          <View style={st.hintRow}>
            <Ionicons name="information-circle-outline" size={16} color={C.textFaint} />
            <Text style={[T.caption, { flex: 1, marginLeft: 8 }]}>
              Its sub-exams add up to {mismatch.score != null && mismatch.outOf != null ? fmtMark(mismatch.score) + ' / ' + fmtMark(mismatch.outOf) + ', ' : ''}
              {fmtPct(mismatch.pct)}. The marks you entered for the whole exam are the ones shown.
            </Text>
          </View>
        </Enter>
      ) : null}

      <Enter index={2}>
        <SectionTitle
          right={
            <Pressable onPress={onAddPart} hitSlop={8} accessibilityRole="button">
              <Text style={[st.link, { color: C.accent }]}>+ Add</Text>
            </Pressable>
          }
        >
          Sub-exams{weighted && parts.length ? '  ·  weighted' : ''}
        </SectionTitle>
        {parts.length ? (
          <ListCard>
            {parts.map((p) => {
              const pr = resultOf(p, ix);
              const sub = (ix.children.get(p.id) || []).some((k) => k.kind === 'exam');
              return (
                <ListRow key={p.id} onPress={() => onOpen(p.id)} onLongPress={() => onMenu(p)} style={{ paddingVertical: 12 }}>
                  <View style={{ flex: 1 }}>
                    <View style={st.partHead}>
                      <Text style={[st.rowTitle, { flex: 1 }]} numberOfLines={1}>{p.title || 'Untitled'}</Text>
                      <Text style={pr ? st.partPct : [st.when, { color: C.textFaint }]}>{pr ? fmtPct(pr.pct) : 'Not marked'}</Text>
                    </View>
                    {pr ? <Bar pct={pr.pct} /> : null}
                    <Text style={[T.caption, { marginTop: pr ? 6 : 2 }]} numberOfLines={1}>
                      {[
                        pr && pr.score != null && pr.outOf != null ? fmtMark(pr.score) + ' / ' + fmtMark(pr.outOf) : '',
                        weighted ? 'weight ' + fmtMark(p.weight ?? 1) : '',
                        sub ? 'has sub-exams' : '',
                      ].filter(Boolean).join('  ·  ') || ' '}
                    </Text>
                  </View>
                </ListRow>
              );
            })}
          </ListCard>
        ) : (
          <Card pad={16}>
            <Text style={T.label}>Split it into parts, like Physics, Chemistry and Maths, and their marks add up here.</Text>
            <View style={{ flexDirection: 'row', marginTop: 12 }}>
              <Chip small icon="add" label="Add a sub-exam" onPress={onAddPart} />
            </View>
          </Card>
        )}
      </Enter>

      {exam.note ? (
        <Enter index={3}>
          <SectionTitle>Note</SectionTitle>
          <Card>
            <Text style={T.body}>{exam.note}</Text>
          </Card>
        </Enter>
      ) : null}
    </>
  );
}

const st = StyleSheet.create({
  fab: {
    position: 'absolute', width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center',
  },
  heroRow: { flexDirection: 'row', alignItems: 'flex-start' },
  heroPct: { ...T.numDisplay, lineHeight: 52, letterSpacing: -1, marginTop: 6 },
  heroMarks: { ...T.numStat, color: C.textDim, fontSize: 17, lineHeight: 22, letterSpacing: 0 },
  unmarked: { color: C.textDim, fontFamily: F.semi, fontSize: 24, lineHeight: 30, marginTop: 10 },
  heroSide: { alignItems: 'flex-end', marginLeft: 16 },
  sideVal: { ...T.numStat, fontSize: 17, lineHeight: 22, letterSpacing: 0, marginTop: 2 },
  sideRow: { flexDirection: 'row', alignItems: 'center' },
  facts: { color: C.textDim, fontFamily: F.med, fontSize: 13, fontVariant: ['tabular-nums'] },
  rowTitle: { color: C.text, fontFamily: F.semi, fontSize: 16, letterSpacing: -0.1 },
  rowRight: { alignItems: 'flex-end', marginLeft: 12 },
  rowPct: { ...T.numStat, fontSize: 18, lineHeight: 22, letterSpacing: 0 },
  partHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  partPct: { ...T.numStat, fontSize: 16, lineHeight: 20, letterSpacing: 0, marginLeft: 12 },
  when: { fontFamily: F.semi, fontSize: 13, marginLeft: 12, fontVariant: ['tabular-nums'] },
  delta: { fontFamily: F.semi, fontSize: 12, marginLeft: 2, fontVariant: ['tabular-nums'] },
  deltaRow: { flexDirection: 'row', alignItems: 'center' },
  link: { fontFamily: F.semi, fontSize: 13 },
  barTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3 },
  hintRow: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 4, marginBottom: 6 },
  moveRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 4 },
});
