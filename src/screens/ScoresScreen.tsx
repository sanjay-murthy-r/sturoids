import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, BackHandler } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated from 'react-native-reanimated';
import { C, F, MIN, NEU, S, T, TRACK, neuRaised } from '../theme';
import { useStore } from '../store';
import {
  ScoreNode, ScoreIndex, Learning, TagMatch, indexScores, resultOf, partsMismatch, groupSummary, examsUnder, upcoming,
  deltaVsPrevious, pathOf, descendantIds, canMove, fmtPct, fmtMark, fmtExamDate, fromToday, whenOf, filterLearnings,
  categoriesOf, categoryOf, plainTagsOf, rootExamOf, isTopExam,
} from '../scores';
import { useToday } from '../hooks/useNow';
import {
  ScreenBG, Card, SectionTitle, EmptyState, ListCard, ListRow, DotMenu, Sheet, Hairline,
  PillButton, Chip, Field, useTheme, useToolHeader, contextLine,
} from '../components/UI';
import type { ToolAction } from '../components/UI';
import { Appear, Bouncy, Enter, FadeSwap } from '../components/Motion';
import { useSwapIn } from '../components/Swap';
import { ScoreEditor, ScoreEditTarget } from '../components/ScoreEditor';
import { ScoreAnalytics, AnalyticsTeaser, AnalyticsView, resolveView } from '../components/ScoreAnalytics';
import { useScoresNav, takeScoreNode } from '../scoresNav';
import { TagDots, TagRow, TagManagerSheet } from '../components/ScoreTags';
import { LearningSheet, LearningTarget } from '../components/LearningSheet';
import { toast } from '../components/Toast';
import { tap, tick } from '../haptics';
import { READ_MAX, frame } from '../layout';

type Sort = 'newest' | 'oldest' | 'best' | 'az';
const SORTS: { key: Sort; label: string }[] = [
  { key: 'newest', label: 'Newest' }, { key: 'oldest', label: 'Oldest' }, { key: 'best', label: 'Best' }, { key: 'az', label: 'A to Z' },
];

const plural = (n: number, one: string, many = one + 's') => n + ' ' + (n === 1 ? one : many);

/** A value that follows another once it has held still for `ms`, so a line worded from a live search never flickers per key. */
function useSettled<T>(value: T, ms: number): T {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setOut(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return out;
}

/** A name cut to fit beside other facts on the header's one line. */
const clip = (s: string, n = 18) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

/** A node's name, or what it is called until it has one: the same words in the header, its rows and its menus. */
function nameOf(ix: ScoreIndex, n: ScoreNode) {
  const title = n.title.trim();
  if (title) return title;
  if (n.kind === 'group') return 'Untitled group';
  return n.parentId && ix.byId.get(n.parentId)?.kind === 'exam' ? 'Untitled subject' : 'Untitled exam';
}

/** Where a learning came from, top level first, for its caption and for the search. */
function learningPath(ix: ScoreIndex, l: Learning) {
  const from = ix.byId.get(l.nodeId);
  return from ? [...pathOf(ix, from.id).map((n) => nameOf(ix, n)), nameOf(ix, from)].join('  /  ') : '';
}

/**
 * Somewhere the page can be. The pages are kept as the way you came, so back always goes one step the way you came:
 * Analytics and the notebook return to the level they were opened from, and an exam opened from either returns to it.
 * The root is the empty trail.
 */
type Loc = { kind: 'node'; id: string } | { kind: 'analytics' } | { kind: 'notebook' };
const sameLoc = (a: Loc | undefined, b: Loc) => !!a && a.kind === b.kind && (a.kind !== 'node' || (b.kind === 'node' && a.id === b.id));

/** An exam's line under its header: where it lives, its date, and its result (or how soon, while it has none). */
function nodeLine(ix: ScoreIndex, n: ScoreNode, today: string) {
  const parent = n.parentId ? ix.byId.get(n.parentId) : undefined;
  const place = parent ? (parent.kind === 'exam' ? 'Part of ' : '') + clip(nameOf(ix, parent)) : null;
  if (n.kind === 'group') {
    const count = examsUnder(ix, n.id).length;
    const s = groupSummary(ix, n.id);
    return contextLine(place, count > 0 && plural(count, 'exam'), s && ['average ', { em: fmtPct(s.average) }]);
  }
  const r = resultOf(n, ix);
  return contextLine(
    place,
    n.date && fmtExamDate(n.date),
    r ? { em: fmtPct(r.pct) } : n.date && n.date >= today && fromToday(n.date, today),
  );
}

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
 * Exam scores: groups hold groups and exams, an exam holds its subjects, and every exam keeps what it taught you.
 * Categories group exams of a kind across the tree, and Analytics compares the exams inside each. The page walks the
 * tree in place (the header's arrow and the hardware back both go one step the way you came), so it works the same in a
 * tab slot and as a full page. Adding or editing an exam opens the full-screen form (app/exam.tsx); groups and
 * subjects keep their sheet.
 *
 * The header is the tool header (useToolHeader). Its title, mode, tray and context line all follow the page in view:
 * the root in a bar slot is the only tab-mode page, every level below it is a page with a back arrow.
 */
export function ScoresScreen({ mode }: { mode: 'tab' | 'stack' }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const theme = useTheme();
  const scores = useStore((s) => s.scores);
  const learnings = useStore((s) => s.learnings);
  const removeLearning = useStore((s) => s.removeLearning);
  const restoreLearnings = useStore((s) => s.restoreLearnings);
  const removeScoreNode = useStore((s) => s.removeScoreNode);
  const restoreScoreNodes = useStore((s) => s.restoreScoreNodes);
  const duplicateScoreNode = useStore((s) => s.duplicateScoreNode);
  const moveScoreNode = useStore((s) => s.moveScoreNode);
  const setExamCategory = useStore((s) => s.setExamCategory);
  const restoreExamTags = useStore((s) => s.restoreExamTags);
  const scoreTags = useStore((s) => s.scoreTags);
  const ix = useMemo(() => indexScores(scores), [scores]);
  const learnedBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of learnings) m.set(l.nodeId, (m.get(l.nodeId) || 0) + 1);
    return m;
  }, [learnings]);
  // turns over at midnight, so "Tomorrow" and "in 3 days" are never a day behind on a screen left open
  const today = useToday();

  const [stack, setStack] = useState<Loc[]>([]);
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
  // Analytics' view (which exams, how far back) lives here so the header can say what is in scope; null is its opening view
  const [analyticsView, setAnalyticsView] = useState<AnalyticsView | null>(null);
  // the group whose exams are being put in a category
  const [catGroup, setCatGroup] = useState<ScoreNode | null>(null);
  const [catOpen, setCatOpen] = useState(false);
  const [catDraft, setCatDraft] = useState('');
  const catDone = useRef<null | { text: string; undo: () => void }>(null);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [learn, setLearn] = useState<LearningTarget | null>(null);
  const [learnNode, setLearnNode] = useState<Learning | null>(null);
  const [learnMenu, setLearnMenu] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [match, setMatch] = useState<TagMatch>('any');
  const [find, setFind] = useState('');
  // a tag deleted in the manager leaves the filter with it, so the notebook never filters by a tag that is gone
  const tagIds = useStore((s) => s.scoreTags.map((t) => t.id).join(','));
  useEffect(() => {
    const live = new Set(tagIds ? tagIds.split(',') : []);
    setPicked((cur) => (cur.every((id) => live.has(id)) ? cur : cur.filter((id) => live.has(id))));
  }, [tagIds]);

  // The page in view is the last of the pages opened so far. One whose node has gone (a delete, an undo, an import) is
  // skipped in the very render that finds it gone, so no frame shows a title that is no longer true, and the page the
  // user came from is what is left: deleting the node in view goes up one level.
  const ixRef = useRef(ix);
  ixRef.current = ix;
  const trail = useMemo(() => stack.filter((l) => l.kind !== 'node' || ix.byId.has(l.id)), [stack, ix]);
  useEffect(() => { if (trail.length !== stack.length) setStack(trail); }, [trail, stack]);
  const loc = trail[trail.length - 1];
  const here = loc?.kind === 'node' ? ix.byId.get(loc.id) : undefined;
  // the notebook is the tool's other half: every learning, from every exam, filtered by the same tags
  const notebook = loc?.kind === 'notebook';
  // Analytics: every marked exam, compared within its category
  const analytics = loc?.kind === 'analytics';
  const aside = notebook || analytics;
  const inExam = here?.kind === 'exam';

  const go = React.useCallback((to: Loc) => setStack((cur) => (sameLoc(cur[cur.length - 1], to) ? cur : [...cur, to])), []);
  const openNode = (id: string) => go({ kind: 'node', id });
  // the notebook is never on the trail twice: from an exam it led to, its button goes back to the one already there
  const openNotebook = () => setStack((cur) => {
    const at = cur.findIndex((l) => l.kind === 'notebook');
    if (at < 0) return [...cur, { kind: 'notebook' }];
    return at === cur.length - 1 ? cur : cur.slice(0, at + 1);
  });
  const openAnalytics = () => { setAnalyticsView(null); go({ kind: 'analytics' }); };

  // Back, for the arrow and the hardware key alike: a sheet that is open closes first, then the page goes one step back
  // the way it came. False at the root, where the system takes the key.
  const gate = useRef({ depth: 0, sheet: false });
  gate.current = {
    depth: trail.length,
    sheet: addOpen || menuOpen || moveOpen || catOpen || tagsOpen || learnMenu || learn != null || editor != null,
  };
  const back = React.useCallback((): boolean => {
    if (gate.current.sheet) {
      setAddOpen(false); setMenuOpen(false); setMoveOpen(false); setCatOpen(false);
      setTagsOpen(false); setLearnMenu(false); setLearn(null); setEditor(null);
      return true;
    }
    if (!gate.current.depth) return false;
    setStack((cur) => cur.filter((l) => l.kind !== 'node' || ixRef.current.byId.has(l.id)).slice(0, -1));
    return true;
  }, []);
  useFocusEffect(React.useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', back);
    return () => sub.remove();
  }, [back]));

  // the exam form asks, after adding an exam, for its page to open here
  const pendingOpen = useScoresNav((s) => s.open);
  useEffect(() => {
    if (!pendingOpen || !ix.byId.has(pendingOpen)) return;
    const id = takeScoreNode();
    if (id) openNode(id);
  }, [pendingOpen, ix]);

  const openMenu = (n: ScoreNode) => { setMenuNode(n); setMenuOpen(true); };
  // an exam that stands on its own is added and edited on the full-screen form; a subject and a group keep the sheet
  const newExam = (parentId: string | null) => router.push({ pathname: '/exam', params: parentId ? { parent: parentId } : {} } as any);
  const editNode = (n: ScoreNode, addSubject = false) => {
    if (isTopExam(ix, n)) router.push({ pathname: '/exam', params: addSubject ? { id: n.id, subject: '1' } : { id: n.id } } as any);
    else if (addSubject) setEditor({ mode: 'new', kind: 'exam', parentId: n.id });
    else setEditor({ mode: 'edit', id: n.id });
  };
  const openCategoryFor = (g: ScoreNode) => { setCatGroup(g); setCatDraft(''); setCatOpen(true); };
  const putInCategory = (categoryId: string | null, label: string) => {
    if (!catGroup) return;
    const ids = examsUnder(ix, catGroup.id).filter((n) => isTopExam(ix, n)).map((n) => n.id);
    if (!ids.length) { setCatOpen(false); return; }
    const before = setExamCategory(ids, categoryId);
    tick();
    const n = Object.keys(before).length;
    catDone.current = {
      text: categoryId ? 'Put ' + plural(n, 'exam') + ' in ' + label : 'Took ' + plural(n, 'exam') + ' out of their category',
      undo: () => restoreExamTags(before),
    };
    setCatOpen(false);
  };

  const confirmDelete = (n: ScoreNode) => {
    const below = [...descendantIds(ix, n.id)].map((id) => ix.byId.get(id)).filter(Boolean) as ScoreNode[];
    const run = () => {
      const removed = removeScoreNode(n.id);
      if (!removed.nodes.length) return;
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
      ? (exams === 1 ? 'Its subject goes with it.' : 'Its ' + exams + ' subjects go with it.')
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

  const openLearning = (l: Learning) => { setLearnNode(l); setLearnMenu(true); };
  const deleteLearning = (l: Learning) => {
    const gone = removeLearning(l.id);
    if (!gone) return;
    tap();
    toast('Learning deleted', { label: 'Undo', onPress: () => restoreLearnings([gone]) });
  };

  const menuItems = (n: ScoreNode, open: boolean) => [
    ...(open ? [{ label: 'Open', icon: 'open-outline', onPress: () => openNode(n.id) }] : []),
    { label: n.kind === 'group' ? 'Rename' : 'Edit', icon: 'create-outline', onPress: () => editNode(n) },
    ...(n.kind === 'group' && examsUnder(ix, n.id).length
      ? [{ label: 'Category for its exams', icon: 'albums-outline', onPress: () => openCategoryFor(n) }]
      : []),
    { label: 'Duplicate without marks', icon: 'copy-outline', onPress: () => duplicate(n) },
    { label: 'Move to…', icon: 'return-down-forward-outline', onPress: () => { setMoveNode(n); setMoveOpen(true); } },
    { label: 'Delete', icon: 'trash-outline', color: C.danger, onPress: () => confirmDelete(n) },
  ];

  // where the node in the move sheet may go: the top level and every group it may enter, labelled by their path
  const destinations = useMemo(() => {
    if (!moveNode) return [];
    const groups = scores
      .filter((g) => g.kind === 'group')
      .map((g) => ({ id: g.id as string | null, label: [...pathOf(ix, g.id).map((p) => nameOf(ix, p)), nameOf(ix, g)].join(' / ') }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return [{ id: null as string | null, label: 'Top level' }, ...groups].filter((dst) => canMove(ix, moveNode.id, dst.id));
  }, [moveNode, scores, ix]);

  const fabRight = areaW > READ_MAX ? (areaW - READ_MAX) / 2 + 20 : 20;
  // a learning also carries its exam's category, so a category chip finds every learning from the exams inside it
  const learningCats = React.useCallback((l: Learning) => {
    const cat = categoryOf(rootExamOf(ix, l.nodeId), scoreTags);
    return cat ? [cat.id] : [];
  }, [ix, scoreTags]);

  // the notebook's rows, worked out here so its header can count them: every learning whose exam is still there, and
  // the ones the tags picked and the search let through
  const alive = useMemo(() => new Set(ix.byId.keys()), [ix]);
  const rowsFor = React.useCallback((search: string) => {
    const q = search.trim().toLowerCase();
    const byTags = filterLearnings(learnings, picked, match, alive, learningCats);
    return {
      mine: learnings.filter((l) => alive.has(l.nodeId)),
      shown: q ? byTags.filter((l) => l.text.toLowerCase().includes(q) || learningPath(ix, l).toLowerCase().includes(q)) : byTags,
    };
  }, [learnings, picked, match, alive, learningCats, ix]);
  const notebookRows = useMemo(() => (notebook ? rowsFor(find) : null), [notebook, rowsFor, find]);
  // the list follows each key of the search; the header's line waits until the typing pauses
  const settledFind = useSettled(find, 350);
  const lineRows = useMemo(
    () => (notebook ? (settledFind === find ? notebookRows : rowsFor(settledFind)) : null),
    [notebook, notebookRows, settledFind, find, rowsFor],
  );
  const focus = useMemo(() => (analytics ? resolveView(ix, scoreTags, analyticsView) : null), [analytics, ix, scoreTags, analyticsView]);

  // The header's line: the one fact each page is opened for. A figure that is zero is not said, and a page with nothing
  // true to say has no line at all.
  const context = useMemo(() => {
    if (focus) {
      const n = focus.pts.length;
      // a category with nothing marked keeps the scope's name, so the line (and the chips under it) stay put as the scope is switched
      if (!n) return focus.chips.length > 1 ? contextLine({ em: focus.label }) : null;
      return contextLine({ em: focus.label }, focus.range === 'all' ? n + ' marked' : 'last ' + n + ' of ' + focus.all.length + ' marked');
    }
    if (lineRows) {
      const { mine, shown } = lineRows;
      if (!mine.length) return null;
      const tag = picked.length === 1 ? scoreTags.find((t) => t.id === picked[0])?.label : undefined;
      const q = settledFind.trim();
      return contextLine(
        shown.length > 0 && (shown.length === mine.length ? plural(mine.length, 'learning') : shown.length + ' of ' + plural(mine.length, 'learning')),
        tag ? ['tagged ', { em: tag }] : picked.length > 1 && picked.length + ' tags, ' + (match === 'all' ? 'all of them' : 'any of them'),
        q && 'matching "' + clip(q, 14) + '"',
      );
    }
    if (here) return nodeLine(ix, here, today);
    const count = examsUnder(ix, null).length;
    const latest = groupSummary(ix, null)?.latest;
    return contextLine(
      count > 0 && plural(count, 'exam'),
      latest && ['latest ', { em: fmtPct(latest.pct) }, ' in ' + clip(nameOf(ix, latest.node), 22)],
    );
  }, [focus, lineRows, picked, match, settledFind, scoreTags, here, ix, today]);

  // Only actions that act on what is in view: the notebook and Analytics each manage what they filter by, and a group,
  // an exam or a subject has its own menu beside the way into the notebook.
  const tray: ToolAction[] = [];
  if (aside) {
    tray.push({ icon: 'pricetags-outline', label: analytics ? 'Manage categories' : 'Manage tags', onPress: () => setTagsOpen(true) });
  } else {
    tray.push({ icon: 'book-outline', label: 'Learnings notebook', onPress: openNotebook });
    if (here) {
      tray.push({
        icon: 'ellipsis-horizontal',
        label: here.kind === 'group' ? 'Group options' : isTopExam(ix, here) ? 'Exam options' : 'Subject options',
        onPress: () => openMenu(here),
      });
    }
  }
  const header = useToolHeader({
    title: notebook ? 'Learnings' : analytics ? 'Analytics' : here ? nameOf(ix, here) : 'Scores',
    // the root of a bar slot is the only page with the big title; every level below it, and the root opened from More, has an arrow
    mode: mode === 'tab' && !loc ? 'tab' : 'page',
    context,
    actions: tray,
    onBack: () => { if (!back()) router.back(); },
  });

  // the page's own scroll resets as the level changes, and the offset the bar follows with it instead of a frame later,
  // so the bar never keeps the last page's offset: back at the root from far down a level, its ground would otherwise
  // cover the big title for a frame. The content below is keyed to the level, so it rises anew while the scroll view
  // itself stays (the bar and the scroll are the same two elements in the root's tab mode and a level's page mode)
  const scrollRef = useRef<Animated.ScrollView>(null);
  const pageKey = loc ? loc.kind + (loc.kind === 'node' ? ':' + loc.id : '') : 'top';
  const barOffset = header.scrollY;
  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    barOffset.value = 0;
  }, [pageKey, barOffset]);

  // the sheet that opens a learning keeps the exam's name while it closes, so its title never flips to "New learning"
  const learnFor = useRef<string | undefined>(undefined);
  if (learn?.mode === 'new') {
    const from = ix.byId.get(learn.nodeId);
    learnFor.current = from ? nameOf(ix, from) : undefined;
  }

  return (
    <ScreenBG guard={mode === 'tab'}>
      <View style={{ flex: 1 }} onLayout={(e) => setAreaW(e.nativeEvent.layout.width)}>
        {header.bar}
        <Animated.ScrollView
          ref={scrollRef}
          {...header.scrollProps}
          contentContainerStyle={[
            frame(READ_MAX),
            { padding: S.pad, paddingTop: header.padTop, paddingBottom: (inExam || aside ? 40 : 120) + (mode === 'tab' ? 0 : insets.bottom) },
          ]}
        >
          <View key={pageKey}>
            {analytics ? (
              <ScoreAnalytics
                hero={header.hero} view={analyticsView} onView={setAnalyticsView}
                onOpenExam={openNode}
                onManageCategories={() => setTagsOpen(true)}
              />
            ) : notebookRows ? (
              <Notebook
                hero={header.hero} rows={notebookRows} ix={ix} picked={picked} match={match} find={find} onFind={setFind}
                onPick={(id) => { tick(); setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])); }}
                onMatch={() => { tick(); setMatch((m) => (m === 'all' ? 'any' : 'all')); }}
                onClear={() => { tick(); setPicked([]); setMatch('any'); }}
                onOpen={(l) => openNode(l.nodeId)}
                onMenu={openLearning}
                onManage={() => setTagsOpen(true)}
              />
            ) : inExam && here ? (
              <ExamView
                hero={header.hero}
                exam={here} ix={ix} today={today} onOpen={openNode} onMenu={openMenu}
                onEdit={() => editNode(here)}
                onAddPart={() => editNode(here, true)}
                learnings={learnings.filter((l) => l.nodeId === here.id)}
                onAddLearning={() => setLearn({ mode: 'new', nodeId: here.id })}
                onLearningMenu={openLearning}
              />
            ) : (
              <GroupView
                hero={header.hero}
                groupId={here?.id ?? null} group={here} ix={ix} today={today} sort={sort}
                onSort={() => { tick(); setSort(SORTS[(SORTS.findIndex((x) => x.key === sort) + 1) % SORTS.length].key); }}
                onOpen={openNode} onMenu={openMenu}
                onAdd={() => newExam(here?.id ?? null)}
                onAnalytics={openAnalytics}
                learnedBy={learnedBy}
              />
            )}
          </View>
        </Animated.ScrollView>

        {!inExam && !aside ? (
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
          { label: here ? 'New exam in ' + nameOf(ix, here) : 'New exam', icon: 'ribbon-outline', onPress: () => newExam(here?.id ?? null) },
          { label: here ? 'New group in ' + nameOf(ix, here) : 'New group', icon: 'folder-outline', onPress: () => setEditor({ mode: 'new', kind: 'group', parentId: here?.id ?? null }) },
        ]}
      />
      <DotMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        items={menuNode ? menuItems(menuNode, menuNode.id !== here?.id) : []}
      />
      <Sheet
        visible={moveOpen}
        onClose={() => setMoveOpen(false)}
        onClosed={() => { const m = moved.current; moved.current = null; if (m) toast(m); }}
        title={moveNode ? 'Move ' + nameOf(ix, moveNode) : 'Move'}
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
          <Text style={[T.caption, { marginTop: 12 }]}>To make an exam part of another one, add it there as a subject.</Text>
        ) : null}
      </Sheet>
      <Sheet
        visible={catOpen}
        onClose={() => setCatOpen(false)}
        onClosed={() => {
          const done = catDone.current;
          catDone.current = null;
          if (done) toast(done.text, { label: 'Undo', onPress: done.undo });
        }}
        title={catGroup ? 'Category for ' + nameOf(ix, catGroup) : 'Category'}
      >
        <Text style={[T.caption, { marginBottom: 12 }]}>
          Every exam in this group goes in the category you pick, and keeps its other tags. Subjects are not changed.
        </Text>
        {categoriesOf(scoreTags).map((c, i) => (
          <View key={c.id}>
            {i > 0 && <Hairline />}
            <Bouncy onPress={() => putInCategory(c.id, c.label)} scaleTo={0.98} radius={S.radiusSm} style={st.moveRow}>
              <View style={[st.catDot, { backgroundColor: c.color + '2E', borderColor: c.color + '99' }]} />
              <Text style={[T.body, { flex: 1, marginLeft: 12, fontFamily: F.med }]} numberOfLines={1}>{c.label}</Text>
            </Bouncy>
          </View>
        ))}
        {categoriesOf(scoreTags).length ? (
          <>
            <Hairline />
            <Bouncy onPress={() => putInCategory(null, '')} scaleTo={0.98} radius={S.radiusSm} style={st.moveRow}>
              <Ionicons name="remove-circle-outline" size={19} color={C.textFaint} />
              <Text style={[T.body, { flex: 1, marginLeft: 12, color: C.textDim }]}>No category</Text>
            </Bouncy>
          </>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginTop: 12 }}>
          <Field
            value={catDraft} onChangeText={setCatDraft} placeholder="New category" maxLength={40}
            style={{ flex: 1, marginBottom: 0 }} returnKeyType="done"
            onSubmitEditing={() => {
              const name = catDraft.trim();
              if (!name) return;
              const id = useStore.getState().addScoreTag(name, { category: true });
              if (id) putInCategory(id, name);
            }}
          />
          <PillButton
            small label="Add" style={{ marginLeft: 12 }}
            onPress={() => {
              const name = catDraft.trim();
              if (!name) return;
              const id = useStore.getState().addScoreTag(name, { category: true });
              if (id) putInCategory(id, name);
            }}
          />
        </View>
      </Sheet>
      <DotMenu
        visible={learnMenu}
        onClose={() => setLearnMenu(false)}
        items={learnNode ? [
          { label: 'Edit', icon: 'create-outline', onPress: () => setLearn({ mode: 'edit', learning: learnNode }) },
          ...(notebook ? [{
            label: 'Open its exam',
            icon: 'open-outline',
            onPress: () => openNode(learnNode.nodeId),
          }] : []),
          { label: 'Delete', icon: 'trash-outline', color: C.danger, onPress: () => deleteLearning(learnNode) },
        ] : []}
      />
      <LearningSheet
        target={learn}
        onClose={() => setLearn(null)}
        title={learnFor.current}
      />
      <TagManagerSheet visible={tagsOpen} onClose={() => setTagsOpen(false)} />
      <ScoreEditor target={editor} onClose={() => setEditor(null)} />
    </ScreenBG>
  );
}

/* ---------------- a group, or the top level ---------------- */

function GroupView({ hero, groupId, ix, today, sort, onSort, onOpen, onMenu, onAdd, onAnalytics, learnedBy }: {
  /** the header's first block, carried in the page's first entrance */
  hero: React.ReactNode;
  groupId: string | null; group?: ScoreNode; ix: ScoreIndex; today: string; sort: Sort;
  onSort: () => void; onOpen: (id: string) => void; onMenu: (n: ScoreNode) => void; onAdd: () => void;
  onAnalytics: () => void;
  /** how many learnings each exam keeps */
  learnedBy: Map<string, number>;
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
  const soon = upcoming(ix, groupId, today).slice(0, 4);
  let enter = 0;

  if (!kids.length) {
    return (
      <>
        {/* the note rises with the header's hero, as one entrance */}
        <Enter index={enter++}>
          {hero}
          <EmptyState
            icon={groupId ? 'folder-open-outline' : 'ribbon-outline'}
            title={groupId ? 'This group is empty' : 'No exams yet'}
            body={groupId ? 'Add an exam, or a group inside this one.' : 'Add an exam, or a group to keep a series together, like mock tests or a school term.'}
            actionLabel="Add an exam"
            onAction={onAdd}
          />
        </Enter>
      </>
    );
  }

  return (
    <>
      <Enter index={enter++}>
        {hero}
        <AnalyticsTeaser onPress={onAnalytics} />
      </Enter>

      {soon.length ? (
        <Enter index={enter++}>
          <SectionTitle>Coming up</SectionTitle>
          <ListCard>
            {soon.map((n) => (
              <ListRow key={n.id} onPress={() => onOpen(n.id)} onLongPress={() => onMenu(n)} style={{ paddingVertical: 12 }}>
                <Ionicons name="calendar-outline" size={18} color={C.accent} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={st.rowTitle} numberOfLines={1}>{nameOf(ix, n)}</Text>
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
              {/* the order's name dips over as the rows take their new places */}
              <FadeSwap swapKey={sort}>
                <Text style={[st.link, { color: C.accent }]}>{SORTS.find((x) => x.key === sort)?.label}</Text>
              </FadeSwap>
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
                  <Text style={st.rowTitle} numberOfLines={1}>{nameOf(ix, g)}</Text>
                  <Text style={[T.caption, { marginTop: 2 }]} numberOfLines={1}>
                    {count ? plural(count, 'exam') + (s ? '  ·  latest ' + fmtPct(s.latest.pct) : '') : 'Empty'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={17} color={C.textFaint} />
              </ListRow>
            );
          })}
          {exams.map((n) => (
            <ExamRow key={n.id} n={n} ix={ix} today={today} onOpen={onOpen} onMenu={onMenu} learned={learnedBy.get(n.id) || 0} />
          ))}
        </ListCard>
      </Enter>
    </>
  );
}

function ExamRow({ n, ix, today, onOpen, onMenu, learned }: {
  n: ScoreNode; ix: ScoreIndex; today: string; onOpen: (id: string) => void; onMenu: (n: ScoreNode) => void;
  learned: number;
}) {
  const r = resultOf(n, ix);
  const parts = (ix.children.get(n.id) || []).filter((k) => k.kind === 'exam').length;
  const delta = r ? deltaVsPrevious(n, ix) : null;
  const upcomingDay = !r && n.date && n.date >= today;
  const caption = [
    n.date ? fmtExamDate(n.date) : '',
    parts ? plural(parts, 'subject') : '',
    learned ? plural(learned, 'learning') : '',
  ].filter(Boolean).join('  ·  ');
  return (
    <ListRow onPress={() => onOpen(n.id)} onLongPress={() => onMenu(n)} style={{ paddingVertical: 12 }}>
      <View style={{ flex: 1 }}>
        <Text style={st.rowTitle} numberOfLines={1}>{nameOf(ix, n)}</Text>
        {caption || n.tags?.length ? (
          <View style={[st.sideRow, { marginTop: 3 }]}>
            <TagDots ids={n.tags} />
            <Text style={[T.caption, { flex: 1 }]} numberOfLines={1}>{caption}</Text>
          </View>
        ) : null}
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

function ExamView({
  hero, exam, ix, today, onOpen, onMenu, onEdit, onAddPart, learnings, onAddLearning, onLearningMenu,
}: {
  /** the header's first block, carried in the page's first entrance */
  hero: React.ReactNode;
  exam: ScoreNode; ix: ScoreIndex; today: string; onOpen: (id: string) => void; onMenu: (n: ScoreNode) => void;
  onEdit: () => void; onAddPart: () => void;
  learnings: Learning[]; onAddLearning: () => void; onLearningMenu: (l: Learning) => void;
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
  // the first subject, or the first learning, takes the place of the note that invited it (and the last one gives it back)
  const partsIn = useSwapIn(parts.length ? 'list' : 'none');
  const learnIn = useSwapIn(learnings.length ? 'list' : 'none');

  return (
    <>
      <Enter index={0}>
        {hero}
        <Card hero pad={20} style={{ marginBottom: S.gap }}>
          <Text style={T.kicker} numberOfLines={1}>
            {exam.date ? fmtExamDate(exam.date, true) + '  ·  ' + fromToday(exam.date, today) : parent?.kind === 'exam' ? 'Part of ' + nameOf(ix, parent) : 'No date'}
          </Text>
          {r ? (
            <>
              <Text style={st.heroPct}>{fmtPct(r.pct)}</Text>
              {r.score != null && r.outOf != null ? (
                <Text style={st.heroMarks}>{fmtMark(r.score)} / {fmtMark(r.outOf)}</Text>
              ) : null}
              {r.from === 'parts' && r.marked != null && r.parts != null && r.marked < r.parts ? (
                <Text style={[T.caption, { marginTop: 4 }]}>{r.marked} of {plural(r.parts, 'subject')} marked</Text>
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
          <TagRow ids={exam.tags} style={{ marginTop: 14, marginBottom: -6 }} />
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
              Its subjects add up to {mismatch.score != null && mismatch.outOf != null ? fmtMark(mismatch.score) + ' / ' + fmtMark(mismatch.outOf) + ', ' : ''}
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
          Subjects{weighted && parts.length ? '  ·  weighted' : ''}
        </SectionTitle>
        <Animated.View key={parts.length ? 'list' : 'none'} entering={partsIn}>
          {parts.length ? (
            <ListCard>
              {parts.map((p) => {
                const pr = resultOf(p, ix);
                const sub = (ix.children.get(p.id) || []).some((k) => k.kind === 'exam');
                return (
                  <ListRow key={p.id} onPress={() => onOpen(p.id)} onLongPress={() => onMenu(p)} style={{ paddingVertical: 12 }}>
                    <View style={{ flex: 1 }}>
                      <View style={st.partHead}>
                        <Text style={[st.rowTitle, { flex: 1 }]} numberOfLines={1}>{nameOf(ix, p)}</Text>
                        <Text style={pr ? st.partPct : [st.when, { color: C.textFaint }]}>{pr ? fmtPct(pr.pct) : 'Not marked'}</Text>
                      </View>
                      {pr ? <Bar pct={pr.pct} /> : null}
                      <Text style={[T.caption, { marginTop: pr ? 6 : 2 }]} numberOfLines={1}>
                        {[
                          pr && pr.score != null && pr.outOf != null ? fmtMark(pr.score) + ' / ' + fmtMark(pr.outOf) : '',
                          weighted ? 'weight ' + fmtMark(p.weight ?? 1) : '',
                          sub ? 'has subjects' : '',
                        ].filter(Boolean).join('  ·  ') || ' '}
                      </Text>
                      <TagRow ids={p.tags} style={{ marginTop: 8, marginBottom: -10 }} />
                    </View>
                  </ListRow>
                );
              })}
            </ListCard>
          ) : (
            <Card pad={16}>
              <Text style={T.label}>Split it into subjects, like Physics, Chemistry and Maths, and their marks add up here.</Text>
              <View style={{ flexDirection: 'row', marginTop: 12 }}>
                <Chip small icon="add" label="Add a subject" onPress={onAddPart} />
              </View>
            </Card>
          )}
        </Animated.View>
      </Enter>

      <Enter index={3}>
        <SectionTitle
          right={(
            <Pressable onPress={onAddLearning} hitSlop={8} accessibilityRole="button">
              <Text style={[st.link, { color: C.accent }]}>+ Add</Text>
            </Pressable>
          )}
        >
          Learnings
        </SectionTitle>
        <Animated.View key={learnings.length ? 'list' : 'none'} entering={learnIn}>
          {learnings.length ? (
            <ListCard>
              {[...learnings].sort((a, b) => b.createdAt - a.createdAt).map((l) => (
                <ListRow key={l.id} onPress={() => onLearningMenu(l)} onLongPress={() => onLearningMenu(l)} style={{ paddingVertical: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={T.body}>{l.text}</Text>
                    <TagRow ids={l.tags} style={{ marginTop: 8, marginBottom: -6 }} />
                  </View>
                </ListRow>
              ))}
            </ListCard>
          ) : (
            <Card pad={16}>
              <Text style={T.label}>
                What this exam taught you, in your own words. Tag them, and they gather in the notebook.
              </Text>
              <View style={{ flexDirection: 'row', marginTop: 12 }}>
                <Chip small icon="add" label="Add a learning" onPress={onAddLearning} />
              </View>
            </Card>
          )}
        </Animated.View>
      </Enter>

      {exam.note ? (
        <Enter index={4}>
          <SectionTitle>Note</SectionTitle>
          <Card>
            <Text style={T.body}>{exam.note}</Text>
          </Card>
        </Enter>
      ) : null}
    </>
  );
}

/* ---------------- the learnings notebook ---------------- */

/**
 * Every learning, from every exam, newest first. Picking tags narrows it: by default a learning shows when it carries
 * any of them, and "All tags" keeps only the ones carrying every tag picked, whatever else they carry too.
 */
function Notebook({ hero, rows, ix, picked, match, find, onFind, onPick, onMatch, onClear, onOpen, onMenu, onManage }: {
  /** the header's first block, carried in the page's first entrance */
  hero: React.ReactNode;
  /** every learning whose exam is still there, and the ones the tags and the search let through (worked out by the screen, whose header counts them) */
  rows: { mine: Learning[]; shown: Learning[] };
  ix: ScoreIndex; picked: string[]; match: TagMatch; find: string; onFind: (v: string) => void;
  onPick: (id: string) => void; onMatch: () => void; onClear: () => void;
  onOpen: (l: Learning) => void; onMenu: (l: Learning) => void; onManage: () => void;
}) {
  const all = useStore((s) => s.scoreTags);
  const tags = React.useMemo(() => [...categoriesOf(all), ...plainTagsOf(all)], [all]);
  const { mine, shown } = rows;

  if (!mine.length) {
    return (
      <>
        {/* the note rises with the header's hero, as one entrance */}
        <Enter index={0}>
          {hero}
          <EmptyState
            icon="book-outline"
            title="Nothing learned yet"
            body="Open an exam and add what it taught you. Every learning gathers here, and its tags bring it back."
          />
        </Enter>
      </>
    );
  }

  return (
    <>
      <Enter index={0}>
        {hero}
        <Field
          value={find} onChangeText={onFind} placeholder="Search learnings and exams"
          autoCapitalize="none" returnKeyType="search" maxLength={80}
        />
        {tags.length ? (
          <View style={st.filterRow}>
            {tags.map((t) => (
              <Chip
                key={t.id} small label={t.label} color={t.color} active={picked.includes(t.id)}
                onPress={() => onPick(t.id)}
              />
            ))}
          </View>
        ) : null}
        <View style={st.filterRow}>
          {/* the keys that only make sense with tags picked fade in where they appear */}
          {picked.length > 1 ? (
            <Appear>
              <Chip
                small icon={match === 'all' ? 'checkmark-circle' : 'ellipse-outline'} label="All tags"
                active={match === 'all'} onPress={onMatch}
              />
            </Appear>
          ) : null}
          {picked.length ? <Appear><Chip small icon="close" label="Clear" onPress={onClear} /></Appear> : null}
          <Chip small icon="pricetags-outline" label={tags.length ? 'Manage tags' : 'Make a tag'} onPress={onManage} />
        </View>
        {picked.length > 1 ? (
          <Appear>
            <FadeSwap swapKey={match}>
              <Text style={[T.caption, { marginBottom: 14 }]}>
                {match === 'all'
                  ? 'Only learnings carrying every tag picked.'
                  : 'Learnings carrying any of the tags picked. Turn on All tags for the ones carrying every one.'}
              </Text>
            </FadeSwap>
          </Appear>
        ) : null}
      </Enter>

      {shown.length ? (
        // the count and the filter are in the header's line, so the list follows the filters directly
        <Enter index={1} style={{ marginTop: 10 }}>
          <ListCard>
            {shown.map((l) => {
              const path = learningPath(ix, l);
              return (
                <ListRow key={l.id} onPress={() => onOpen(l)} onLongPress={() => onMenu(l)} style={{ paddingVertical: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={T.body}>{l.text}</Text>
                    <TagRow ids={l.tags} style={{ marginTop: 8, marginBottom: -6 }} />
                    <Text style={[T.caption, { marginTop: 6 }]} numberOfLines={1}>{path}</Text>
                  </View>
                </ListRow>
              );
            })}
          </ListCard>
        </Enter>
      ) : (
        <EmptyState
          compact icon="filter-outline"
          title={find.trim() && !picked.length ? 'Nothing matches that' : 'Nothing with those tags'}
          body={find.trim() && !picked.length
            ? 'Search looks through what each learning says and the exam it came from.'
            : match === 'all' && picked.length > 1
              ? 'No learning carries every tag picked. Turn All tags off to see any of them.'
              : 'Try another tag, or clear the search.'}
        />
      )}
    </>
  );
}

const st = StyleSheet.create({
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 },
  fab: {
    position: 'absolute', width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center',
  },
  heroPct: { ...T.numDisplay, lineHeight: 52, letterSpacing: -1, marginTop: 6 },
  heroMarks: { ...T.numStat, color: C.textDim, fontSize: 17, lineHeight: 22, letterSpacing: TRACK.title },
  unmarked: { color: C.textDim, fontFamily: F.semi, fontSize: 24, letterSpacing: TRACK.large, lineHeight: 30, marginTop: 10 },
  sideRow: { flexDirection: 'row', alignItems: 'center' },
  facts: { color: C.textDim, fontFamily: F.med, fontSize: 13, letterSpacing: TRACK.small, fontVariant: ['tabular-nums'] },
  rowTitle: { color: C.text, fontFamily: F.semi, fontSize: 16, letterSpacing: TRACK.title },
  rowRight: { alignItems: 'flex-end', marginLeft: 12 },
  rowPct: { ...T.numStat, fontSize: 18, lineHeight: 22, letterSpacing: TRACK.title },
  partHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  partPct: { ...T.numStat, fontSize: 16, lineHeight: 20, letterSpacing: TRACK.title, marginLeft: 12 },
  when: { fontFamily: F.semi, fontSize: 13, letterSpacing: TRACK.small, marginLeft: 12, fontVariant: ['tabular-nums'] },
  delta: { fontFamily: F.semi, fontSize: 12, letterSpacing: TRACK.fine, marginLeft: 2, fontVariant: ['tabular-nums'] },
  deltaRow: { flexDirection: 'row', alignItems: 'center' },
  link: { fontFamily: F.semi, fontSize: 13, letterSpacing: TRACK.small },
  barTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3 },
  hintRow: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 4, marginBottom: 6 },
  moveRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 4 },
  catDot: { width: 20, height: 20, borderRadius: 10, borderWidth: 1 },
});
