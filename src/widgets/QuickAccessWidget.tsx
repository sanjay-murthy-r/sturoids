import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, BackHandler, PixelRatio, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import Animated, {
  FadeIn, FadeOut, ZoomIn, ZoomOut, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { C, F, MIN, S, T, TRACK } from '../theme';
import { useStore, QuickItem } from '../store';
import { uid, dayName, fmtClockTime, toMinutes } from '../utils';
import { Sheet, Field, PillButton, Row, Chip, SectionTitle, useTheme } from '../components/UI';
import { CHANGE, Bouncy, EASE_OUT, FadeSwap, RISE_OUT, glide, rowOut, useAnimLevel } from '../components/Motion';
import { toast } from '../components/Toast';
import { tap } from '../haptics';
import { ROUTE_CATALOG, launchAction, launchExternal, sameSite, siteHost, siteName, siteUrl } from '../quickAccess';
import { ToolKey, colorOf, toolByKey } from '../tools';
import { openPage, openTool } from '../toolNav';
import { journalDayFor } from '../journal';
import { indexScores, upcoming, groupSummary, fmtPct, fromToday } from '../scores';
import { WIDE_AT } from '../layout';
import { LINK_SLOP, kit, useBoardNow, useBoardToday } from './kit';
import { useFocusToday, useNextBlock, useTodayItems } from './data';
import type { WidgetProps } from './types';

/** A shortcut to an archived tool stays in the saved list but is not shown. */
const hiddenTile = (q: QuickItem, archived: ReadonlySet<string>) => q.kind === 'tool' && archived.has(q.target);

/**
 * Quick access: a bento of shortcuts (tools, Settings, one-tap actions, websites), each wide tile saying a live fact
 * about its tool. Edit lets them be held and dragged, removed (with an Undo) and added; a website's tile opens to be put
 * right.
 */
export function QuickAccessWidget({ preview, editing: boardEditing }: WidgetProps) {
  const now = useBoardNow();
  const today = useBoardToday();
  const archivedTools = useStore((s) => s.settings.archivedTools);
  const quickAccess = useStore((s) => s.quickAccess);
  const setQuickAccess = useStore((s) => s.setQuickAccess);
  const [qaEdit, setQaEdit] = useState(false);
  const [qaAddSheet, setQaAddSheet] = useState(false);
  // the website shortcut the add sheet is editing; kept while the sheet closes, so its words never change mid-way
  const [qaEditing, setQaEditing] = useState<QuickItem | null>(null);
  const archived = useMemo(() => new Set<string>(archivedTools), [archivedTools]);
  const visibleQuick = useMemo(() => quickAccess.filter((q) => !hiddenTile(q, archived)), [quickAccess, archived]);
  const { width: winW } = useWindowDimensions();

  // editing quick access ends when Today is left, or when the board goes into its own editing; while it lasts, Back
  // ends it instead of closing the app
  useFocusEffect(useCallback(() => () => setQaEdit(false), []));
  useEffect(() => { if (boardEditing) setQaEdit(false); }, [boardEditing]);
  useEffect(() => {
    if (!qaEdit) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setQaEdit(false);
      return true;
    });
    return () => sub.remove();
  }, [qaEdit]);

  const quickMetas = useQuickMetas(visibleQuick, now, today);

  // the grid's callbacks keep their identity, so the grid (and its drag gestures) re-renders only for its own changes
  const runQuick = useCallback((q: QuickItem) => {
    if (qaEdit) {
      // while editing, a website's tile opens it for its name and address to be put right; the others take no press
      if (q.kind === 'url') {
        setQaEditing(q);
        setQaAddSheet(true);
      }
      return;
    }
    if (q.kind === 'tool') openTool(q.target as ToolKey);
    else if (q.kind === 'route') openPage(q.target);
    else if (q.kind === 'action') launchAction(q);
    else launchExternal(q);
  }, [qaEdit]);
  // a removal can be undone from its toast: the shortcut goes back to its old place in the saved list, so tiles
  // hidden with an archived tool keep theirs
  const removeQuick = useCallback((id: string) => {
    const full = useStore.getState().quickAccess;
    const at = full.findIndex((q) => q.id === id);
    if (at < 0) return;
    const gone = full[at];
    setQuickAccess(full.filter((q) => q.id !== id));
    toast('Shortcut removed', {
      label: 'Undo',
      onPress: () => {
        const list = useStore.getState().quickAccess;
        // added again by hand in the meantime: nothing to bring back
        if (list.some((q) => q.kind === gone.kind && (q.kind === 'url' ? sameSite(q.target, gone.target) : q.target === gone.target))) return;
        const next = [...list];
        next.splice(Math.min(at, next.length), 0, gone);
        setQuickAccess(next);
      },
    });
  }, [setQuickAccess]);
  // the grid reorders only what it shows: hidden tiles keep their places in the saved list, so restoring an archived
  // tool brings its shortcut back where it was
  const reorderQuick = useCallback((nextVisible: QuickItem[]) => {
    const { quickAccess: full, settings: s } = useStore.getState();
    const hidden = new Set<string>(s.archivedTools);
    if (full.filter((q) => !hiddenTile(q, hidden)).length !== nextVisible.length) return;
    let i = 0;
    setQuickAccess(full.map((q) => (hiddenTile(q, hidden) ? q : nextVisible[i++])));
  }, [setQuickAccess]);
  const openQaAdd = useCallback(() => {
    setQaEditing(null);
    setQaAddSheet(true);
  }, []);

  return (
    <View>
      <SectionTitle
        right={preview || boardEditing ? undefined : (
          <Pressable onPress={() => setQaEdit(!qaEdit)} hitSlop={LINK_SLOP} accessibilityRole="button">
            <FadeSwap swapKey={qaEdit ? 'done' : 'edit'}>
              <Text style={[kit.link, { color: C.accent }]}>{qaEdit ? 'Done' : 'Edit'}</Text>
            </FadeSwap>
          </Pressable>
        )}
      >
        Quick access
      </SectionTitle>
      <QuickGrid
        items={visibleQuick}
        metas={quickMetas}
        edit={qaEdit}
        onRun={runQuick}
        onRemove={removeQuick}
        onReorder={reorderQuick}
        onAdd={openQaAdd}
        estimateW={winW - S.pad * 2}
      />
      {preview ? null : (
        <QuickAddSheet visible={qaAddSheet} onClose={() => setQaAddSheet(false)} archived={archived} editing={qaEditing} />
      )}
    </View>
  );
}

/**
 * What each shortcut's wide tile says: a live fact about its tool. A shortcut with nothing to say stays a small tile,
 * and every tool always says the same kind of thing, so live changes never reshuffle the grid.
 */
function useQuickMetas(visibleQuick: QuickItem[], now: Date, today: string): Record<string, string | null> {
  const hour24 = useStore((s) => s.settings.hour24);
  const notesLocked = useStore((s) => s.settings.notesLocked === true);
  const journalLocked = useStore((s) => s.settings.journalLocked);
  const journalCutoffHour = useStore((s) => s.settings.journalCutoffHour);
  const noteCount = useStore((s) => s.notes.length);
  const videoCount = useStore((s) => s.vaultVideos.length);
  const scores = useStore((s) => s.scores);
  const blocksToday = useStore((s) => (s.planner[dayName(now)] || []).length);
  const dwOn = useStore((s) => !!s.deepWork);
  const dwRunning = useStore((s) => !!s.deepWork?.running);
  const items = useTodayItems();
  const focusToday = useFocusToday();
  const nextBlock = useNextBlock();
  const journalDay = journalDayFor(now, journalCutoffHour);
  const journalWords = useStore((s) => {
    let n = 0;
    for (const e of s.journal) if (e.dateKey === journalDay) n += e.wordCount || 0;
    return n;
  });
  const tasksLeft = items.filter((t) => !t.done).length;
  const listLen = items.length;
  const hasScoresTile = visibleQuick.some((q) => q.kind === 'tool' && q.target === 'scores');
  const scoresMeta = useMemo(() => {
    if (!hasScoresTile) return null;
    const ix = indexScores(scores);
    // the next exam coming up says the most; failing that, how the latest one went
    const nextExam = upcoming(ix, null, today)[0];
    if (nextExam) return (nextExam.title || 'An exam') + ' ' + fromToday(nextExam.date as string, today).toLowerCase();
    const sum = groupSummary(ix, null);
    return sum ? 'Latest ' + fmtPct(sum.latest.pct) : 'No exams yet';
  }, [hasScoresTile, scores, today]);
  return useMemo(() => {
    const count = (n: number, one: string, many: string) => n + ' ' + (n === 1 ? one : many);
    const out: Record<string, string | null> = {};
    for (const q of visibleQuick) {
      let meta: string | null = null;
      if (q.kind === 'tool') {
        switch (q.target as ToolKey) {
          case 'tasks':
            meta = listLen === 0 ? 'Nothing on the list' : tasksLeft ? count(tasksLeft, 'task left', 'tasks left') : 'All clear';
            break;
          case 'focus':
            meta = dwOn ? (dwRunning ? 'Session running' : 'Session paused')
              : focusToday ? focusToday + ' min today' : 'No focus yet today';
            break;
          case 'planner':
            // with nothing next, a day that had blocks is over, which is not the same as one with nothing planned
            meta = !nextBlock ? (blocksToday ? 'Done for today' : 'Nothing planned')
              : nextBlock.tag === 'NOW' ? nextBlock.block.subject + ' now'
                : nextBlock.tag === 'TOMORROW' ? 'Tomorrow, ' + nextBlock.block.subject
                  : nextBlock.block.subject + ' at ' + fmtClockTime(toMinutes(nextBlock.block.start), hour24);
            break;
          case 'notes':
            // locked Notes say nothing about what they hold
            meta = notesLocked ? 'Locked' : noteCount ? count(noteCount, 'note', 'notes') : 'No notes yet';
            break;
          case 'journal':
            // a locked journal says nothing about its pages
            meta = journalLocked ? 'Locked'
              : journalWords ? count(journalWords, 'word', 'words')
                : journalDay === today ? "Today's page is empty" : "Yesterday's page is empty";
            break;
          case 'vault':
            meta = videoCount ? count(videoCount, 'lecture saved', 'lectures saved') : 'No lectures yet';
            break;
          case 'scores':
            meta = scoresMeta;
            break;
        }
      } else if (q.kind === 'url') {
        // the address, so two shortcuts to one site's pages read apart
        meta = siteHost(q.target) || null;
      }
      out[q.id] = meta;
    }
    return out;
  }, [visibleQuick, listLen, tasksLeft, dwOn, dwRunning, focusToday, nextBlock, blocksToday, noteCount, videoCount,
    journalWords, journalDay, today, scoresMeta, journalLocked, notesLocked, hour24]);
}

/**
 * Adding a shortcut: an in-app page, or a website. Given a website shortcut (`editing`), it puts that one's name and
 * address right instead, in its place. The address and name being typed live here, so a keystroke re-renders the sheet
 * alone.
 */
function QuickAddSheet({ visible, onClose, archived, editing }: {
  visible: boolean; onClose: () => void; archived: ReadonlySet<string>; editing: QuickItem | null;
}) {
  const level = useAnimLevel();
  const quickAccess = useStore((s) => s.quickAccess);
  const setQuickAccess = useStore((s) => s.setQuickAccess);
  const [siteDraft, setSiteDraft] = useState('');
  const [siteLabel, setSiteLabel] = useState('');
  const [siteError, setSiteError] = useState('');
  // each opening starts blank, or from the shortcut being edited
  useEffect(() => {
    if (!visible) return;
    setSiteDraft(editing ? editing.target : '');
    setSiteLabel(editing ? editing.label : '');
    setSiteError('');
  }, [visible]);
  const addQuick = (item: Omit<QuickItem, 'id'>) => {
    const list = useStore.getState().quickAccess;
    if (list.some((q) => q.kind === item.kind && (q.kind === 'url' ? sameSite(q.target, item.target) : q.target === item.target))) return false;
    setQuickAccess([...list, { ...item, id: uid() }]);
    return true;
  };
  const addSite = () => {
    const url = siteUrl(siteDraft);
    if (!url) {
      setSiteError(siteDraft.trim() ? 'That is not a web address. Try something like khanacademy.org' : "Type the site's address first.");
      return;
    }
    const label = siteLabel.trim() || siteName(url);
    if (editing) {
      const list = useStore.getState().quickAccess;
      if (list.some((q) => q.id !== editing.id && q.kind === 'url' && sameSite(q.target, url))) {
        setSiteError('That site is already in quick access.');
        return;
      }
      setQuickAccess(list.map((q) => (q.id === editing.id ? { ...q, label, target: url } : q)));
    } else if (!addQuick({ label, icon: 'globe-outline', color: 'teal', kind: 'url', target: url })) {
      setSiteError('That site is already in quick access.');
      return;
    }
    onClose();
  };
  const open = editing ? [] : ROUTE_CATALOG.filter(
    (r) => !(r.kind === 'tool' && archived.has(r.target)) && !quickAccess.some((q) => q.kind === r.kind && q.target === r.target)
  );
  const catalog = open.filter((r) => r.kind !== 'action');
  const actions = open.filter((r) => r.kind === 'action');
  const typedUrl = siteUrl(siteDraft);
  return (
    <Sheet visible={visible} onClose={onClose} title={editing ? 'Edit shortcut' : 'Add to quick access'}>
      {/* once every in-app page is a shortcut, the section goes rather than standing empty. A chip picked fades as the
          ones after it glide into its place, and the heading fades with the last one */}
      {catalog.length > 0 ? (
        <Animated.View exiting={rowOut(level)}>
          <Text style={st.sheetSection}>In-app</Text>
          <Row style={{ flexWrap: 'wrap' }}>
            {catalog.map((r) => (
              <Animated.View key={r.kind + r.target} exiting={rowOut(level)} layout={glide(level)}>
                <Chip label={r.label} color={colorOf(r.color)} onPress={() => addQuick(r)} />
              </Animated.View>
            ))}
          </Row>
        </Animated.View>
      ) : null}
      {actions.length > 0 ? (
        <Animated.View exiting={rowOut(level)}>
          <Text style={st.sheetSection}>Actions</Text>
          <Row style={{ flexWrap: 'wrap' }}>
            {actions.map((r) => (
              <Animated.View key={r.kind + r.target} exiting={rowOut(level)} layout={glide(level)}>
                <Chip label={r.label} color={colorOf(r.color)} onPress={() => addQuick(r)} />
              </Animated.View>
            ))}
          </Row>
        </Animated.View>
      ) : null}
      {editing ? null : <Text style={st.sheetSection}>A website</Text>}
      {/* the name is optional, so the address's own key can add the site */}
      <Field
        label="Address" value={siteDraft} autoCapitalize="none" autoCorrect={false} keyboardType="url"
        onChangeText={(t) => { setSiteDraft(t); if (siteError) setSiteError(''); }}
        placeholder="khanacademy.org" returnKeyType="done" onSubmitEditing={addSite}
      />
      <Row style={{ alignItems: 'flex-end' }}>
        <Field
          label="Name" value={siteLabel} onChangeText={setSiteLabel}
          placeholder={typedUrl ? siteName(typedUrl) : 'Optional'}
          style={{ flex: 1, marginBottom: 0 }} returnKeyType="done" onSubmitEditing={addSite}
        />
        <PillButton small label={editing ? 'Save' : 'Add'} style={{ marginLeft: 12 }} onPress={addSite} />
      </Row>
      {/* the help line and a problem with the address cross over rather than swapping in one frame */}
      <FadeSwap swapKey={siteError}>
        <Text style={[T.caption, { marginTop: 10, color: siteError ? C.danger : C.textFaint }]}>
          {siteError || 'Opens in your default browser.'}
        </Text>
      </FadeSwap>
    </Sheet>
  );
}

/** tiles making way for a new, moved or removed shortcut */
const REFLOW = { duration: 280, easing: EASE_OUT };

/* ---------------- quick access: a bento of wide and small tiles, hold to drag ---------------- */
const QA_COLS = 4;
const QA_GAP = 8;
const QA_ROW_H = 80;
const QA_ADD_H = 52;

interface QaRect { x: number; y: number; w: number }

/** a wide window gives each column at least this much, so tiles keep a phone's proportions */
const QA_MIN_W = 88;

/**
 * Packs tiles into rows of `cols` columns (four on a phone), in their order: a shortcut with something to say spans two
 * columns, the rest one. A row that cannot take the next tile, and the last row, widen their own small tiles into the
 * gap, and a tile alone on the last row spans it, so no row ends with a hole.
 */
function packTiles(spans: number[], colW: number, cols: number): QaRect[] {
  const cells: { col: number; row: number; span: number }[] = [];
  let row = 0;
  let used = 0;
  let start = 0;
  const close = () => {
    const line = cells.slice(start);
    let gap = cols - used;
    if (line.length === 1) {
      line[0].span = cols;
      gap = 0;
    }
    for (let i = line.length - 1; i >= 0 && gap > 0; i--) {
      if (line[i].span === 1) { line[i].span = 2; gap--; }
    }
    let col = 0;
    for (const c of line) { c.col = col; col += c.span; }
  };
  spans.forEach((span) => {
    if (used + span > cols) {
      close();
      row++;
      used = 0;
      start = cells.length;
    }
    cells.push({ col: used, row, span });
    used += span;
  });
  if (cells.length) close();
  return cells.map((c) => ({
    x: c.col * (colW + QA_GAP),
    y: c.row * (QA_ROW_H + QA_GAP),
    w: c.span * colW + (c.span - 1) * QA_GAP,
  }));
}

/** from about 1.15x system text, a wide tile keeps its line of meta to one line, so the words stay inside the tile */
const QA_BIG_TEXT = 1.15;
/** the tiles' text grows with the system's size only this far: the tiles are a fixed height */
const QA_TEXT_MAX = 1.25;

function QuickTile({ q, meta, index, last, rect, wide, rects, isDragging, onDragState, onCross, onDrop, onRun, edit, onRemove, fadeIn }: {
  q: QuickItem; meta: string | null; index: number; last: boolean; rect: QaRect; wide: boolean; rects: SharedValue<QaRect[]>;
  isDragging: boolean; onDragState: (id: string) => void; onCross: (id: string, idx: number) => void; onDrop: () => void;
  onRun: (q: QuickItem) => void; edit: boolean; onRemove: (id: string) => void; fadeIn: boolean;
}) {
  const theme = useTheme();
  const level = useAnimLevel();
  const x = useSharedValue(rect.x);
  const y = useSharedValue(rect.y);
  const w = useSharedValue(rect.w);
  const sx = useSharedValue(0);
  const sy = useSharedValue(0);
  const lift = useSharedValue(0);
  const over = useSharedValue(-1);
  // the motion level, for the memoised drag worklet: a held tile lifts at once with motion off, eases with some, and
  // springs (one tile answering a touch) only with every animation on
  const motion = useSharedValue(level === 'none' ? 0 : level === 'some' ? 1 : 2);
  React.useEffect(() => { motion.value = level === 'none' ? 0 : level === 'some' ? 1 : 2; }, [level]);

  // live refs — the pan worklet is memoized, so JS callbacks go through here
  const idxRef = React.useRef(index); idxRef.current = index;
  const crossRef = React.useRef(onCross); crossRef.current = onCross;
  const dropRef = React.useRef(onDrop); dropRef.current = onDrop;
  const dragStateRef = React.useRef(onDragState); dragStateRef.current = onDragState;
  const crossStable = React.useCallback((id: string, idx: number) => {
    if (idx !== idxRef.current) crossRef.current(id, idx);
  }, []);
  const dropStable = React.useCallback(() => dropRef.current(), []);
  const dragStable = React.useCallback((id: string) => dragStateRef.current(id), []);

  const wasDragging = React.useRef(false);
  React.useEffect(() => {
    // while dragging, the finger owns the tile: its place and its width both hold still until it lands, so a tile
    // that is about to change span never grows under the finger
    if (isDragging) { wasDragging.current = true; return; }
    const dropped = wasDragging.current;
    wasDragging.current = false;
    if (level === 'none') {
      x.value = rect.x; y.value = rect.y; w.value = rect.w;
    } else if (dropped) {
      // the tile the finger lets go of settles into its slot: one tile answering a touch may spring (with some
      // motion it eases, as a pop does)
      const settle = (to: number) => (level === 'full' ? withSpring(to, RISE_OUT) : withTiming(to, CHANGE));
      x.value = settle(rect.x);
      y.value = settle(rect.y);
      w.value = settle(rect.w);
    } else if (level === 'full') {
      // the others make way on an eased glide: springs across a whole grid overshoot against each other
      x.value = withTiming(rect.x, REFLOW);
      y.value = withTiming(rect.y, REFLOW);
      w.value = withTiming(rect.w, REFLOW);
    } else {
      // with some motion nothing slides across the grid: the tiles take their places
      x.value = rect.x; y.value = rect.y; w.value = rect.w;
    }
  }, [rect.x, rect.y, rect.w, isDragging, level]);

  // 420ms: long enough that a lingering tap never rearranges by accident,
  // short enough to still feel like a standard launcher hold-to-drag
  const pan = React.useMemo(() => Gesture.Pan()
    .activateAfterLongPress(420)
    .onStart(() => {
      lift.value = motion.value === 0 ? 1 : motion.value === 1 ? withTiming(1, CHANGE) : withSpring(1, RISE_OUT);
      sx.value = x.value; sy.value = y.value;
      over.value = -1;
      runOnJS(tap)();
      runOnJS(dragStable)(q.id);
    })
    .onUpdate((e) => {
      x.value = sx.value + e.translationX;
      y.value = sy.value + e.translationY;
      // the slot under the tile's centre, away from that slot's edges, so a tile that changes span on the move
      // never lands on a spot that sends it straight back
      const cx = x.value + w.value / 2;
      const cy = y.value + QA_ROW_H / 2;
      const rs = rects.value;
      let hit = -1;
      for (let i = 0; i < rs.length; i++) {
        const r = rs[i];
        const mx = r.w * 0.2;
        if (cx > r.x + mx && cx < r.x + r.w - mx && cy > r.y + QA_ROW_H * 0.2 && cy < r.y + QA_ROW_H * 0.8) {
          hit = i;
          break;
        }
      }
      if (hit !== over.value) {
        over.value = hit;
        if (hit >= 0) runOnJS(crossStable)(q.id, hit);
      }
    })
    .onFinalize(() => {
      lift.value = motion.value === 0 ? 0 : motion.value === 1 ? withTiming(0, CHANGE) : withSpring(0, RISE_OUT);
      runOnJS(dropStable)();
    }), [q.id]);

  const aStyle = useAnimatedStyle(() => ({
    width: w.value,
    transform: [
      { translateX: x.value },
      { translateY: y.value },
      { scale: 1 + lift.value * 0.05 },
    ] as const,
  }));

  const icon = (q.kind === 'tool' ? toolByKey(q.target)?.icon || q.icon : q.icon) as any;
  // neutral tiles: the colour lives only in the icon
  const surface = theme === 'minimal'
    ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border }
    : { backgroundColor: C.inset };

  // While editing, a screen reader meets the tile as one element whose actions do what the drag and the cross do (and
  // a website's opens it to be edited). Otherwise the face is the button, with what its tile says.
  const site = q.kind === 'url';
  const editA11y = edit ? {
    accessible: true,
    accessibilityLabel: q.label,
    accessibilityActions: [
      ...(site ? [{ name: 'activate', label: 'Edit' }] : []),
      ...(index > 0 ? [{ name: 'earlier', label: 'Move earlier' }] : []),
      ...(last ? [] : [{ name: 'later', label: 'Move later' }]),
      { name: 'remove', label: 'Remove' },
    ],
    onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) => {
      const action = e.nativeEvent.actionName;
      if (action === 'activate' && site) onRun(q);
      else if (action === 'earlier' && index > 0) crossRef.current(q.id, index - 1);
      else if (action === 'later' && !last) crossRef.current(q.id, index + 1);
      else if (action === 'remove') onRemove(q.id);
    },
  } : null;
  // past about 1.15x system text, the meta keeps to one line so it never runs out of the tile
  const metaLines = PixelRatio.getFontScale() > QA_BIG_TEXT ? 1 : 2;

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[st.qaTile, { zIndex: isDragging ? 10 : 0, elevation: isDragging ? 10 : 0 }, aStyle]} {...editA11y}>
        <Animated.View
          style={st.qaFill}
          entering={fadeIn && level !== 'none' ? FadeIn.duration(level === 'full' ? 220 : 180) : undefined}
          // a removed shortcut shrinks away while the others slide into its place
          exiting={level === 'none' ? undefined : level === 'full' ? ZoomOut.duration(180) : FadeOut.duration(160)}
        >
          {/* while editing only a website's tile takes a press (to be edited); the rest no longer sink under a finger
              that opens nothing */}
          <Bouncy
            onPress={() => onRun(q)}
            disabled={edit && !site}
            radius={18}
            scaleTo={0.97}
            accessibilityRole={edit ? undefined : 'button'}
            accessibilityLabel={edit ? undefined : q.label + (meta ? ', ' + meta : '')}
            style={[st.qaFace, wide ? st.qaWide : st.qaSmall, wide && !meta && { justifyContent: 'center' }, wide && edit && { paddingRight: 26 }, surface]}
          >
            {wide ? (
              <>
                <Row>
                  <Ionicons name={icon} size={20} color={colorOf(q.color)} />
                  <Text style={st.qaLabel} numberOfLines={1} maxFontSizeMultiplier={QA_TEXT_MAX}>{q.label}</Text>
                </Row>
                {meta ? <Text style={st.qaMeta} numberOfLines={metaLines} maxFontSizeMultiplier={QA_TEXT_MAX}>{meta}</Text> : null}
              </>
            ) : (
              <>
                <Ionicons name={icon} size={22} color={colorOf(q.color)} />
                <Text style={st.qaSmallLabel} numberOfLines={1} maxFontSizeMultiplier={QA_TEXT_MAX}>{q.label}</Text>
              </>
            )}
          </Bouncy>
          {edit ? (
            <Animated.View
              entering={level === 'none' ? undefined : level === 'full' ? ZoomIn.duration(200) : FadeIn.duration(180)}
              exiting={level === 'none' ? undefined : level === 'full' ? ZoomOut.duration(140) : FadeOut.duration(140)}
              style={st.qaX}
            >
              {/* the cross sits on the tile's corner, so its target reaches past the glyph to a full 44 dp */}
              <Bouncy
                onPress={() => onRemove(q.id)} scaleTo={0.85} hitSlop={10} radius={999} style={{ padding: 4 }}
                accessibilityRole="button" accessibilityLabel={'Remove ' + q.label}
              >
                <Ionicons name="close-circle" size={18} color={C.danger} />
              </Bouncy>
            </Animated.View>
          ) : null}
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

const QuickGrid = React.memo(function QuickGrid({ items, metas, edit, onRun, onRemove, onReorder, onAdd, estimateW }: {
  items: QuickItem[]; metas: Record<string, string | null>; edit: boolean; onRun: (q: QuickItem) => void;
  onRemove: (id: string) => void; onReorder: (items: QuickItem[]) => void; onAdd: () => void;
  /** the grid's width before it has measured itself: its column of Today */
  estimateW?: number;
}) {
  const { width: winW } = useWindowDimensions();
  const level = useAnimLevel();
  // the grid measures its own room (a column of Today on a wide window); until it has, it assumes the phone's
  const [boxW, setBoxW] = useState(0);
  const avail = boxW || estimateW || winW - S.pad * 2;
  // a phone always has four columns; a wide window fits as many as keep the tiles in a phone's proportions
  const cols = winW >= WIDE_AT ? Math.max(QA_COLS, Math.floor((avail + QA_GAP) / (QA_MIN_W + QA_GAP))) : QA_COLS;
  const colW = (avail - QA_GAP * (cols - 1)) / cols;
  const [dragId, setDragId] = useState<string | null>(null);
  const spanKey = items.map((q) => (metas[q.id] ? 2 : 1)).join('');
  const layout = useMemo(() => packTiles(spanKey.split('').map(Number), colW, cols), [spanKey, colW, cols]);
  // the drag worklets read the packed slots from here, so a reorder never rebuilds a gesture mid-drag
  const rects = useSharedValue<QaRect[]>(layout);
  useEffect(() => { rects.value = layout; }, [layout]);
  // shortcuts added after the first paint fade in; the grid's own entrance covers the first paint
  const painted = React.useRef(false);
  useEffect(() => { painted.current = true; }, []);

  // an empty grid always offers Add, so quick access never looks like nothing
  const showAdd = edit || items.length === 0;
  const tilesH = layout.length ? Math.max(...layout.map((r) => r.y)) + QA_ROW_H : 0;
  const addY = tilesH ? tilesH + QA_GAP : 0;
  const height = showAdd ? addY + QA_ADD_H : tilesH;
  // A grid that grows takes its new height at once. One that shrinks keeps the old height until the tiles have glided
  // into their places, so the last tile never slides over the section below on its way up.
  const [heldH, setHeldH] = useState(height);
  useEffect(() => {
    if (height >= heldH || level !== 'full') {
      if (height !== heldH) setHeldH(height);
      return undefined;
    }
    const timer = setTimeout(() => setHeldH(height), REFLOW.duration);
    return () => clearTimeout(timer);
  }, [height, level]);
  const boxH = level === 'full' ? Math.max(height, heldH) : height;
  const reorder = (id: string, idx: number) => {
    const from = items.findIndex((it) => it.id === id);
    if (from < 0 || idx < 0 || idx === from || idx >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(idx, 0, moved);
    onReorder(next);
  };
  return (
    <View style={{ height: boxH, marginBottom: 6 }} onLayout={(e) => setBoxW(e.nativeEvent.layout.width)}>
      {items.map((q, i) => (
        <QuickTile
          key={q.id} q={q} meta={metas[q.id] ?? null} index={i} last={i === items.length - 1} rect={layout[i]}
          wide={layout[i].w > colW + 1} rects={rects}
          isDragging={dragId === q.id}
          onDragState={setDragId}
          onCross={reorder}
          onDrop={() => setDragId(null)}
          onRun={onRun} edit={edit} onRemove={onRemove} fadeIn={painted.current}
        />
      ))}
      {showAdd && <QuickAdd y={addY} onAdd={onAdd} />}
    </View>
  );
});

/**
 * Add, under the tiles. It moves with them, on the same glide, when a removal empties a row, instead of jumping up
 * while they are still on their way.
 */
function QuickAdd({ y, onAdd }: { y: number; onAdd: () => void }) {
  const level = useAnimLevel();
  const ty = useSharedValue(y);
  useEffect(() => {
    ty.value = level === 'full' ? withTiming(y, REFLOW) : y;
  }, [y, level]);
  const aStyle = useAnimatedStyle(() => ({ transform: [{ translateY: ty.value }] }));
  return (
    <Animated.View
      entering={level === 'none' ? undefined : FadeIn.duration(200)}
      exiting={level === 'none' ? undefined : FadeOut.duration(140)}
      style={[st.qaAddWrap, aStyle]}
    >
      <Bouncy onPress={onAdd} radius={18} scaleTo={0.985} style={[st.qaAdd, { borderColor: C.borderBright }]}>
        <Ionicons name="add" size={18} color={C.textDim} />
        <Text style={st.qaAddText} maxFontSizeMultiplier={QA_TEXT_MAX}>Add shortcut</Text>
      </Bouncy>
    </Animated.View>
  );
}

const st = StyleSheet.create({
  qaTile: { position: 'absolute', left: 0, top: 0, height: QA_ROW_H },
  qaFill: { flex: 1 },
  qaFace: { flex: 1, borderRadius: 18 },
  qaWide: { padding: 12, justifyContent: 'space-between' },
  qaSmall: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  qaLabel: { flex: 1, marginLeft: 8, color: C.text, fontFamily: F.med, fontSize: 13, letterSpacing: TRACK.small },
  qaSmallLabel: { maxWidth: '100%', marginTop: 6, color: C.textDim, fontFamily: F.smMed, fontSize: 11, letterSpacing: TRACK.small },
  qaMeta: { color: C.textFaint, fontFamily: F.sm, fontSize: 12, letterSpacing: TRACK.fine, lineHeight: 15 },
  qaX: { position: 'absolute', top: 1, right: 1 },
  qaAddWrap: { position: 'absolute', left: 0, right: 0, top: 0, height: QA_ADD_H },
  qaAdd: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 18, borderWidth: 1, borderStyle: 'dashed',
  },
  qaAddText: { color: C.textDim, fontFamily: F.med, fontSize: 13, letterSpacing: TRACK.small },
  sheetSection: {
    color: C.textFaint, fontFamily: F.smSemi, fontSize: 11,
    textTransform: 'uppercase', letterSpacing: TRACK.caps, marginTop: 14, marginBottom: 8,
  },
});
