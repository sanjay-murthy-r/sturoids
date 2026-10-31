import React from 'react';
import {
  BackHandler, InteractionManager, Platform, Keyboard, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing, FadeIn, FadeOut, LinearTransition, runOnJS, useAnimatedReaction, useAnimatedScrollHandler, useAnimatedStyle,
  useDerivedValue, useSharedValue, withDelay, withTiming,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { C, CHROME_FONT_MAX, F, MIN, S, T, TRACK, ThemeMode, bgFor, neuInset, neuRaised, oneLine } from '../theme';
import { useStore } from '../store';
import { Chip, useTheme } from './UI';
import { EASE_EMPHASISED, EASE_EXIT, EASE_OUT, Sheen, useAnimLevel } from './Motion';
import { PinSheet } from './LockGate';
import { toast } from './Toast';
import { tick } from '../haptics';
import { ALL_NOTES, markOpen } from '../lock';
import { ToolKey, colorOf, toolByKey } from '../tools';
import { openTool } from '../toolNav';
import { DAY_NAMES, fmtClockTime, todoDueOn, toMinutes } from '../utils';
import { requestJournalOpen } from '../journal';
import { openScoreNode } from '../scoresNav';
import { keypadSum, quickMath } from '../calcEngine';
import { startVoice, voiceAvailable, VoiceSession } from '../voice';
import { Range, SearchResult, fold, highlight, parseDay, queryTerms, snippet } from '../search/engine';
import { SiftDoc, addTodo, inScope, newNote, restoreDocs, useSiftSources } from '../search/sources';
import {
  ENTER_HINT_MS, OpenedRef, PinnedRef, SiftScope, SiftScopes, closeSift, forgetOpened, forgetQuery, loadSiftMemory, queryPinKey,
  rememberOpen, rememberQuery, siftPull, siftShown, togglePin, unpin, useSearch, useSiftMemory,
} from '../search/store';
import { rightClick } from '../web/rightClick';
import { router } from 'expo-router';

/** the companion's actions wear Cheerful's pink */
const CHEER_PINK = '#FF8FB1';

// Sift: the app-wide search, laid over everything. The app behind scales back a little and dims (AppFrame, driven by
// siftShown on the UI thread); the field drops from the top, or grows out of the header a pull came from; the keyboard
// comes up once the motion has settled. Results are worked out a frame after typing pauses, and the last ones stay up
// until the new ones are ready, so nothing flashes. Pull the list down at its top, Back or Cancel to close.

const OPEN_MS = 400;
const CLOSE_MS = 300;
/** the pill a pull draws under the bar, about this wide: Sift's field grows out of it */
const PILL_W = 96;
/** the scrim's strength over the app when Sift is fully open */
const SCRIM = 0.55;
/** the app behind, fully open */
const BACK_SCALE = 0.955;
/** the soft leading edge of the rising blur */
const FEATHER = 48;
/** how far out of focus a full pull takes the app, before Sift opens */
const PULL_SOFTEN = 0.55;
/** results are worked out this long after the last keystroke, then on the next frame */
const TYPE_PAUSE = 40;
/** a pull down of this much on the list, from its top, closes Sift */
const PULL_CLOSE = 90;
const STAGGER = 24;
const STAGGER_ROWS = 10;
const PANEL_MAX = 640;
/** what leaves for a result waits this long once Sift starts to go, so the first frames of its way out are never held up */
const HAND_OVER_MS = 70;

const SCOPES: { key: Exclude<SiftScope, 'all'>; label: string }[] = [
  { key: 'todos', label: 'ToDos' }, { key: 'notes', label: 'Notes' },
  { key: 'journal', label: 'Journal' }, { key: 'vault', label: 'Vault' }, { key: 'scores', label: 'Scores' },
  { key: 'settings', label: 'Settings' },
];

/** AI sites that take a question in their address, so "Ask … about" can hand the query over. */
const ASKABLE: { host: RegExp; url: (q: string) => string }[] = [
  { host: /(^|\.)chatgpt\.com$|(^|\.)chat\.openai\.com$/, url: (q) => 'https://chatgpt.com/?q=' + encodeURIComponent(q) },
  { host: /(^|\.)perplexity\.ai$/, url: (q) => 'https://www.perplexity.ai/search?q=' + encodeURIComponent(q) },
  { host: /^google\.[a-z.]+$/, url: (q) => 'https://www.google.com/search?q=' + encodeURIComponent(q) },
];

/** Runs what a result opens a moment after Sift starts to leave (see HAND_OVER_MS). */
const handOver = (fn: () => void) => requestAnimationFrame(() => setTimeout(fn, HAND_OVER_MS));

const hostOf = (url: string) => url.replace(/^https?:\/\//i, '').split(/[/?#]/)[0].replace(/^www\./i, '').toLowerCase();

/* ---------------------------------------------------------------- the app behind */

/**
 * The app as Sift opens over it: it scales back to 0.965 as Sift comes in (full motion only; with some it only dims,
 * under the overlay's scrim). Wrap the root navigator with it, and mount <SearchOverlay/> after it.
 */
export function AppFrame({ children }: { children: React.ReactNode }) {
  const level = useAnimLevel();
  // Focus: how far the app has gone out of focus. A pull takes it part of the way, as the finger goes; Sift opening
  // takes it the rest
  const away = useDerivedValue(() => Math.max(siftShown.value, Math.min(1, siftPull.value) * PULL_SOFTEN));
  const style = useAnimatedStyle(() => (level === 'full' && away.value > 0
    ? { transform: [{ scale: 1 - (1 - BACK_SCALE) * away.value }] }
    : { transform: [{ scale: 1 }] }));
  // the blur rises from the bottom of the screen, a soft edge leading it, and recedes back down the same way
  const { height: winH } = useWindowDimensions();
  const blurStyle = useAnimatedStyle(() => {
    if (level !== 'full') return { height: winH + FEATHER, opacity: level === 'none' ? 0 : away.value };
    const k = Math.min(1, away.value / 0.62);
    const e = 1 - Math.pow(1 - k, 3);
    return { height: (winH + FEATHER) * e, opacity: 1 };
  });
  // the blur is there only while it shows: a full-screen blur costs, even when clear
  const [blurOn, setBlurOn] = React.useState(false);
  useAnimatedReaction(() => away.value > 0.001, (on, was) => { if (on !== was) runOnJS(setBlurOn)(on); });
  return (
    <Animated.View style={[{ flex: 1 }, style]}>
      {children}
      {blurOn && level !== 'none' ? (
        <Animated.View pointerEvents="none" style={[st.rise, blurStyle]}>
          {/* a real blur on the PC; Android's blur is experimental (a gray slab, and a crash as it unmounts), so there the
              app is dimmed instead, rising the same way */}
          {Platform.OS === 'web'
            ? <BlurView intensity={level === 'full' ? 30 : 14} tint="dark" style={[st.riseBlur, { height: winH + FEATHER }]} />
            : <View style={[st.riseBlur, { height: winH + FEATHER, backgroundColor: 'rgba(12,12,11,0.32)' }]} />}
          {/* the leading edge: a soft dimming that eases the line where the blur begins */}
          <LinearGradient pointerEvents="none" colors={['rgba(12,12,11,0.14)', 'rgba(12,12,11,0)']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={st.riseEdge} />
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

/* ---------------------------------------------------------------- pieces */

/** Words with the ranges a query matched drawn in the accent, at the same weight. */
function Marked({ text, ranges, style, lines = 1 }: { text: string; ranges: Range[]; style: any; lines?: number }) {
  if (!ranges.length) return <Text style={style} numberOfLines={lines}>{text}</Text>;
  const parts: React.ReactNode[] = [];
  let at = 0;
  ranges.forEach(([a, b], i) => {
    if (a > at) parts.push(text.slice(at, a));
    parts.push(<Text key={i} style={{ color: C.accent }}>{text.slice(a, b)}</Text>);
    at = b;
  });
  if (at < text.length) parts.push(text.slice(at));
  return <Text style={style} numberOfLines={lines}>{parts}</Text>;
}

const wellOf = (theme: ThemeMode) => (theme === 'minimal'
  ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border }
  : { backgroundColor: C.inset });

/** A result's row: flat, its icon in a small well, the title (matches in the accent), a sub-line, a snippet. */
function ResultRow({ icon, color, title, subtitle, terms, body, onPress, onLongPress, pinned, onRemove, theme, trailing }: {
  icon: string; color?: string; title: string; subtitle?: string; terms: string[]; body?: string; onPress: () => void;
  /** a hold pins the row (or unpins it) */
  onLongPress?: () => void; pinned?: boolean;
  onRemove?: () => void; theme: ThemeMode; trailing?: string;
}) {
  const snip = body && terms.length ? snippet(body, terms) : null;
  // a snippet only when the title itself does not already show the match
  const titleRanges = highlight(title, terms);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      {...rightClick(onLongPress)}
      delayLongPress={420}
      accessibilityRole="button"
      accessibilityLabel={[title, subtitle, pinned ? 'pinned' : ''].filter(Boolean).join(', ')}
      accessibilityHint={onLongPress ? (pinned ? 'Hold to unpin' : 'Hold to pin to the top of Sift') : undefined}
      style={({ pressed }) => [st.row, pressed && { backgroundColor: theme === 'minimal' ? MIN.inset : C.pressDim }]}
    >
      <View style={[st.rowWell, wellOf(theme)]}>
        <Ionicons name={icon as any} size={18} color={color || C.textDim} />
      </View>
      <View style={st.rowText}>
        <Marked text={title} ranges={titleRanges} style={st.rowTitle} />
        {subtitle ? <Text style={st.rowSub} numberOfLines={1}>{subtitle}</Text> : null}
        {snip && !titleRanges.length ? <Marked text={snip.text} ranges={snip.ranges} style={st.rowSnip} lines={2} /> : null}
        {snip && titleRanges.length && snip.ranges.length ? <Marked text={snip.text} ranges={snip.ranges} style={st.rowSnip} lines={1} /> : null}
      </View>
      {trailing ? <Text style={st.rowTrail} numberOfLines={1}>{trailing}</Text> : null}
      {pinned && !onRemove ? <Ionicons name="pin" size={14} color={C.textFaint} style={st.rowPin} /> : null}
      {onRemove ? (
        <Pressable onPress={onRemove} hitSlop={10} accessibilityRole="button" accessibilityLabel={'Remove ' + title} style={st.rowX}>
          <Ionicons name="close" size={16} color={C.textFaint} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

/** A section's head: a kicker, sticky at the top of the list while its rows scroll under it. */
function SectionHead({ label, theme, more, onMore }: { label: string; theme: ThemeMode; more?: number; onMore?: () => void }) {
  return (
    <View style={[st.head, { backgroundColor: bgFor(theme) }]} accessibilityRole="header">
      <Text style={T.kicker} maxFontSizeMultiplier={CHROME_FONT_MAX}>{label}</Text>
      {more && onMore ? (
        <Pressable onPress={onMore} hitSlop={10} accessibilityRole="button" accessibilityLabel={'Show more ' + label}>
          <Text style={[st.headMore, { color: C.accent }]} maxFontSizeMultiplier={CHROME_FONT_MAX}>{'+' + more + ' more'}</Text>
        </Pressable>
      ) : more ? <Text style={st.headMore} maxFontSizeMultiplier={CHROME_FONT_MAX}>{'+' + more + ' more'}</Text> : null}
    </View>
  );
}

/** The raised card at the top: the Top hit, a sum's answer, a day. */
function TopCard({ kicker, children, theme, onPress, onLongPress, label }: {
  kicker: string; children: React.ReactNode; theme: ThemeMode; onPress?: () => void; onLongPress?: () => void; label?: string;
}) {
  const face = theme === 'minimal'
    ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: MIN.border }
    : { backgroundColor: C.card, ...neuRaised('mid') };
  const body = (
    <>
      <Text style={[T.kicker, { marginBottom: 10 }]} maxFontSizeMultiplier={CHROME_FONT_MAX}>{kicker}</Text>
      {children}
    </>
  );
  return onPress ? (
    <Pressable
      onPress={onPress} onLongPress={onLongPress} {...rightClick(onLongPress)} delayLongPress={420} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [st.top, face, pressed && { opacity: 0.85 }]}
    >
      {body}
    </Pressable>
  ) : (
    <View style={[st.top, face]}>{body}</View>
  );
}

/* ---------------------------------------------------------------- the list's items */

type Item =
  | { t: 'head'; key: string; label: string; more?: number; onMore?: () => void }
  | { t: 'doc'; key: string; doc: SiftDoc; index: number }
  | { t: 'top'; key: string; doc: SiftDoc }
  | { t: 'math'; key: string; expr: string; answer: string }
  | { t: 'day'; key: string; day: DayCard }
  | {
    t: 'row'; key: string; icon: string; color?: string; title: string; subtitle?: string; onPress: () => void;
    onRemove?: () => void; index: number; pin?: PinnedRef; pinned?: boolean;
  }
  | { t: 'loading'; key: string; label: string }
  | { t: 'hint'; key: string; text: string }
  | { t: 'note'; key: string; text: string; action?: { label: string; onPress: () => void } };

interface DayLine { key: string; icon: string; color?: string; text: string; open: () => void }
interface DayCard { title: string; lines: DayLine[] }

/** What a day holds: its weekday's blocks, the ToDos and tasks due, the exams that day, and its journal entry. */
function dayCard(key: string, date: Date, hour24: boolean, journalLocked: boolean, archived: ToolKey[]): DayCard {
  const s = useStore.getState();
  const dayName = DAY_NAMES[(date.getDay() + 6) % 7];
  const lines: DayLine[] = [];
  const t = (hhmm: string) => fmtClockTime(toMinutes(hhmm), hour24);
  if (!archived.includes('planner')) {
    for (const b of [...(s.planner[dayName] || [])].sort((a, z) => a.start.localeCompare(z.start))) {
      lines.push({
        key: 'b' + b.id, icon: 'time-outline', color: b.color, text: t(b.start) + '  ' + (b.subject || 'Block'),
        open: () => openTool('planner', { day: dayName, item: b.id }),
      });
    }
  }
  if (!archived.includes('tasks')) {
    const isToday = key === localKey(new Date());
    for (const td of s.dailyTasks) {
      // a one-off ToDo belongs to today; a repeating one to each of its days
      const due = td.repeat === 'daily' ? todoDueOn(td, date) : isToday && !td.doneOn;
      if (due) lines.push({ key: 't' + td.id, icon: 'ellipse-outline', text: (td.time ? td.time + '  ' : '') + td.title, open: () => openTool('tasks', { item: td.id }) });
    }
    for (const m of s.missions) {
      if (!m.done && m.deadline === key) {
        lines.push({ key: 'm' + m.id, icon: 'flag-outline', text: 'Due: ' + m.title, open: () => openTool('tasks', { list: 'missions', item: m.id }) });
      }
    }
  }
  if (!archived.includes('scores')) {
    for (const n of s.scores) {
      if (n.kind === 'exam' && n.date === key) {
        lines.push({ key: 'e' + n.id, icon: 'ribbon-outline', color: C.accent, text: n.title || 'Exam', open: () => { openScoreNode(n.id); openTool('scores'); } });
      }
    }
  }
  if (!journalLocked && !archived.includes('journal')) {
    const e = s.journal.find((j) => j.dateKey === key);
    if (e) {
      lines.push({
        key: 'j' + e.id, icon: 'journal-outline', color: C.gold, text: e.title.trim() || (e.wordCount + ' words in the journal'),
        open: () => { requestJournalOpen(e.dateKey, e.id); openTool('journal'); },
      });
    }
  }
  const title = date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  return { title, lines };
}

const localKey = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
};

/** The tools to suggest with nothing typed: the most opened from Sift first, then what fits the time of day. */
function suggestedTools(uses: Record<string, number>, archived: ToolKey[], hour: number): ToolKey[] {
  const byUse = Object.entries(uses)
    .filter(([k]) => k.startsWith('tool:'))
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k.slice(5) as ToolKey);
  const byHour: ToolKey[] = hour < 11 ? ['planner', 'tasks', 'focus', 'notes']
    : hour < 17 ? ['focus', 'notes', 'tasks', 'scores']
      : hour < 21 ? ['tasks', 'notes', 'focus', 'journal']
        : ['journal', 'planner', 'tasks', 'notes'];
  const out: ToolKey[] = [];
  for (const k of [...byUse, ...byHour]) {
    if (!toolByKey(k) || archived.includes(k) || out.includes(k)) continue;
    out.push(k);
    if (out.length === 4) break;
  }
  return out;
}

/* ---------------------------------------------------------------- the overlay */

/**
 * Sift itself. Mount it once in the root layout, after <AppFrame>, so it lies over the tabs and every page. It renders
 * nothing while closed; opening it (openSift) builds it, and it takes itself down once its way out has played.
 */
export function SearchOverlay() {
  const open = useSearch((s) => s.open);
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => { if (open) setMounted(true); }, [open]);
  if (!mounted) return null;
  return <SiftPanel open={open} onGone={() => setMounted(false)} />;
}

function SiftPanel({ open, onGone }: { open: boolean; onGone: () => void }) {
  const theme = useTheme();
  const level = useAnimLevel();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const origin = useSearch((s) => s.origin);
  // opened over a page's own search bar (More's, Settings'): the field lifts out of that bar and goes back into it
  const anchor = useSearch((s) => s.anchor);
  const anchored = anchor != null && level === 'full';
  const wellRef = React.useRef<View>(null);
  const well = useSharedValue({ x: 0, y: 0, w: 0, h: 0 });
  const from = useSharedValue({ x: 0, y: 0, w: 0, h: 0 });
  const waitingForWell = React.useRef(false);
  const hour24 = useStore((s) => s.settings.hour24);
  const aiLinks = useStore((s) => s.aiLinks);
  const memory = useSiftMemory();
  const sources = useSiftSources(true);
  const inputRef = React.useRef<TextInput>(null);
  const voice = React.useRef<VoiceSession | null>(null);
  // the list's offset, and how far a pull at its top has taken it down
  const listY = useSharedValue(0);
  const drag = useSharedValue(0);
  const startY = useSharedValue(0);

  const [q, setQ] = React.useState(() => useSearch.getState().query);
  // the filters chosen: one or more, or none for everything
  const [scopes, setScopes] = React.useState<SiftScopes>(() => useSearch.getState().scopes);
  const isAll = scopes.length === 0;
  const has = React.useCallback((k: Exclude<SiftScope, 'all'>) => scopes.length === 0 || scopes.includes(k), [scopes]);
  const toggleScope = React.useCallback((k: Exclude<SiftScope, 'all'>) => {
    tick();
    setScopes((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
  }, []);
  // the filters as a row: the chosen ones first, in the order they were chosen, then the rest in their usual order. No
  // chip for everything: nothing chosen is everything.
  const chipOrder = React.useMemo(
    () => [...scopes.map((k) => SCOPES.find((x) => x.key === k)!).filter(Boolean), ...SCOPES.filter((x) => !scopes.includes(x.key))],
    [scopes],
  );
  const chipsRef = React.useRef<ScrollView>(null);
  // a chosen filter moves to the front, so the row goes back to its start to show it there
  React.useEffect(() => { chipsRef.current?.scrollTo({ x: 0, animated: level !== 'none' }); }, [scopes.length]);
  const [dq, setDq] = React.useState(q);
  // how many results past a section's first few have been asked for, by section (its "+N more"); a new search or filter
  // starts them over
  const [extra, setExtra] = React.useState<Record<string, number>>({});
  React.useEffect(() => { setExtra({}); }, [dq, scopes]);
  const [pinFor, setPinFor] = React.useState<'notes' | 'journal' | null>(null);

  React.useEffect(() => { loadSiftMemory(); }, []);

  // opening again while still leaving: it starts over with what it was opened with
  React.useEffect(() => {
    if (!open) return;
    const s = useSearch.getState();
    setQ(s.query);
    setDq(s.query);
    setScopes(s.scopes);
  }, [open]);

  /* ---- in and out */
  const fromPull = origin === 'pull' && !anchored;
  const openMotion = () => {
    siftShown.value = level === 'none' ? 1 : withTiming(1, { duration: OPEN_MS, easing: EASE_EMPHASISED });
  };
  const openMotionNow = () => { waitingForWell.current = false; openMotion(); };
  // the field's own place, once laid out: an opening from a bar waits for it (a frame), so the lift starts true
  const measureWell = () => {
    // once per opening: the well's own size moves while it lifts, and that must never become where it is going
    if (!waitingForWell.current && well.value.w > 0) return;
    wellRef.current?.measureInWindow((x, y, w, h) => {
      if (w > 0 && h > 0) well.value = { x, y, w, h };
      if (waitingForWell.current) { waitingForWell.current = false; openMotion(); }
    });
  };
  React.useEffect(() => {
    if (open && anchored && anchor) {
      tick();
      from.value = anchor;
      siftShown.value = 0;
      waitingForWell.current = true;
      // a field already laid out (opened again while leaving) starts at once; otherwise its layout starts it
      if (well.value.w > 0) openMotionNow();
      const late = setTimeout(() => { if (waitingForWell.current) { waitingForWell.current = false; openMotion(); } }, 120);
      const t = setTimeout(() => inputRef.current?.focus(), 260);
      return () => { clearTimeout(late); clearTimeout(t); };
    }
    if (open) {
      tick();
      const start = fromPull ? Math.max(siftShown.value, 0.25 * siftPull.value) : siftShown.value;
      siftShown.value = start;
      // quick off the mark and long to settle, as every panel arrives: from a pull it carries on the finger's motion
      siftShown.value = level === 'none' ? 1 : withTiming(1, { duration: OPEN_MS, easing: EASE_EMPHASISED });
      // the keyboard comes once the motion has settled, so it never rides the opening
      const t = setTimeout(() => inputRef.current?.focus(), level === 'none' ? 30 : 200);
      return () => clearTimeout(t);
    }
    Keyboard.dismiss();
    voice.current?.stop();
    const done = () => { siftPull.value = 0; onGone(); };
    if (level === 'none') {
      siftShown.value = 0;
      done();
      return undefined;
    }
    siftShown.value = withTiming(0, { duration: CLOSE_MS, easing: Easing.inOut(Easing.cubic) }, (fin) => { if (fin) runOnJS(done)(); });
    return undefined;
  }, [open]);

  // Back closes Sift first
  React.useEffect(() => {
    if (!open) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { closeSift(); return true; });
    return () => sub.remove();
  }, [open]);

  /* ---- typing: worked out a frame after a pause, the old results kept until then */
  React.useEffect(() => {
    if (q === dq) return undefined;
    let raf = 0;
    const t = setTimeout(() => { raf = requestAnimationFrame(() => setDq(q)); }, TYPE_PAUSE);
    return () => { clearTimeout(t); cancelAnimationFrame(raf); };
  }, [q]);

  /* ---- voice */
  const [listening, setListening] = React.useState(false);
  const toggleVoice = async () => {
    if (voice.current) { voice.current.stop(); return; }
    const base = q.trim() ? q.trim() + ' ' : '';
    let said = '';
    setListening(true);
    const session = await startVoice(
      (text) => { said += (said ? ' ' : '') + text.trim(); setQ(base + said); },
      (text) => setQ(base + (said ? said + ' ' : '') + text),
      () => { voice.current = null; setListening(false); },
      (msg) => { voice.current = null; setListening(false); toast(msg); },
    );
    if (!session) { setListening(false); return; }
    voice.current = session;
  };
  React.useEffect(() => () => voice.current?.stop(), []);

  /* ---- results */
  const terms = React.useMemo(() => (dq.trim() ? queryTerms(dq) : []), [dq]);
  const restore = React.useMemo(() => restoreDocs(sources.archived), [sources.archived]);
  React.useMemo(() => {
    sources.index.setCollection('restore', restore, (d) => d);
  }, [restore, sources.index]);

  const result: SearchResult<SiftDoc['payload']> | null = React.useMemo(() => {
    if (!dq.trim()) return null;
    return sources.index.search(dq, {
      filter: (d) => inScope(d.section, scopes),
      usage: (k) => memory.uses[k] || 0,
      // every hit of a section is kept; the list shows as many as have been asked for
      perSection: 1000,
    });
  }, [dq, scopes, sources.rev, restore, memory.uses]);

  const go = React.useCallback((doc: SiftDoc) => {
    rememberOpen({
      key: doc.key, title: doc.title, subtitle: doc.subtitle, icon: doc.payload.icon, color: doc.payload.color, section: doc.section,
    });
    if (dq.trim()) rememberQuery(dq);
    closeSift();
    // the target opens under Sift as it leaves, once its fade has begun: building the page never stalls the first frames
    handOver(() => doc.payload.open());
  }, [dq]);

  const run = React.useCallback((fn: () => void, remember = true) => {
    if (remember && dq.trim()) rememberQuery(dq);
    closeSift();
    handOver(fn);
  }, [dq]);

  /* ---- pins: a hold on a result, a recent search or a suggested tool keeps it at the top of Sift */
  const pinToggle = React.useCallback((ref: PinnedRef, name: string) => {
    tick();
    const on = togglePin(ref);
    toast(on ? 'Pinned ' + name : 'Unpinned ' + name);
  }, []);
  const docPin = (doc: SiftDoc): PinnedRef => ({
    kind: 'doc', key: doc.key, title: doc.title, subtitle: doc.subtitle, icon: doc.payload.icon, color: doc.payload.color, section: doc.section,
  });
  const pinnedKeys = React.useMemo(() => new Set(memory.pinned.map((p) => p.key)), [memory.pinned]);

  const openRecent = React.useCallback((o: OpenedRef) => {
    const doc = sources.index.get(o.key);
    if (!doc) { forgetOpened(o.key); toast("That isn't here any more"); return; }
    go(doc);
  }, [sources.index, go]);

  // a sum's answer, worked out once per query (mathjs is not free)
  const math = React.useMemo(() => (dq.trim() ? quickMath(dq.trim()) : null), [dq]);
  const { index, journalLoading, notesLocked, journalLocked, archived, subjects } = sources;

  const items: Item[] = React.useMemo(() => {
    const out: Item[] = [];
    const query = dq.trim();
    let n = 0;
    const row = (x: Omit<Extract<Item, { t: 'row' }>, 't' | 'index'>) => out.push({ t: 'row', index: n++, ...x });

    if (!query) {
      // nothing typed: what was pinned, what you searched, what you opened, and tools that fit now
      if (isAll && memory.pinned.length) {
        out.push({ t: 'head', key: 'h-pinned', label: 'Pinned' });
        for (const p of memory.pinned) {
          if (p.kind === 'query') {
            row({
              key: 'pin:' + p.key, icon: 'search', color: C.accent, title: p.query, subtitle: 'Pinned search',
              onPress: () => { setQ(p.query); setDq(p.query); }, onRemove: () => unpin(p.key),
            });
          } else {
            row({
              key: 'pin:' + p.key, icon: p.icon, color: p.color, title: p.title, subtitle: p.subtitle || p.section,
              onPress: () => {
                const doc = index.get(p.key);
                if (!doc) { unpin(p.key); toast("That isn't here any more"); return; }
                go(doc);
              },
              onRemove: () => unpin(p.key),
            });
          }
        }
      }
      if (isAll) {
        const recent = memory.recent.filter((r) => !pinnedKeys.has(queryPinKey(r)));
        if (recent.length) {
          out.push({ t: 'head', key: 'h-recent', label: 'Recent searches' });
          for (const r of recent) {
            row({
              key: 'recent:' + r, icon: 'time-outline', title: r,
              onPress: () => { setQ(r); setDq(r); }, onRemove: () => forgetQuery(r),
              pin: { kind: 'query', key: queryPinKey(r), query: r },
            });
          }
        }
      }
      if (isAll) {
        const opened = memory.opened.filter((o) => index.get(o.key) && !pinnedKeys.has(o.key));
        if (opened.length) {
          out.push({ t: 'head', key: 'h-opened', label: 'Recently opened' });
          for (const o of opened) {
            row({
              key: 'opened:' + o.key, icon: o.icon, color: o.color, title: o.title, subtitle: o.subtitle || o.section, onPress: () => openRecent(o),
              pin: { kind: 'doc', key: o.key, title: o.title, subtitle: o.subtitle, icon: o.icon, color: o.color, section: o.section },
            });
          }
        }
        const tools = suggestedTools(memory.uses, archived, new Date().getHours()).filter((k) => !pinnedKeys.has('tool:' + k));
        if (tools.length) {
          out.push({ t: 'head', key: 'h-suggest', label: 'Suggested' });
          for (const k of tools) {
            const tool = toolByKey(k)!;
            row({
              key: 'suggest:' + k, icon: tool.icon, color: colorOf(tool.colorKey), title: tool.label, subtitle: tool.desc,
              pin: { kind: 'doc', key: 'tool:' + k, title: tool.label, subtitle: tool.desc, icon: tool.icon, color: colorOf(tool.colorKey), section: 'Tools' },
              onPress: () => {
                const doc = index.get('tool:' + k);
                if (doc) go(doc);
                else run(() => openTool(k), false);
              },
            });
          }
        }
      }
      if (!out.length) out.push({ t: 'note', key: 'n-start', text: 'Type to sift through your ToDos, notes, journal, videos, scores and settings.' });
      if (isAll && !memory.pinned.length) {
        out.push({ t: 'hint', key: 'n-pin', text: 'Hold a search, a tool or any result to pin it here.' });
      }
      return out;
    }

    // a sum: its answer first, whichever scope is chosen
    if (math) out.push({ t: 'math', key: 'math', expr: math.expr, answer: math.answer });
    if (isAll) {
      // a day: what it holds
      const d = parseDay(query);
      // a sum is not a day: "10-5" is five (a slashed one, "23/10", is both)
      if (d && (!math || query.includes('/'))) out.push({ t: 'day', key: 'day:' + d.key, day: dayCard(d.key, d.date, hour24, journalLocked, archived) });
    }

    // the top hit leads the list as its own card, or, with a sum or a day above it, goes down into its section (decided
    // before the card is added, so a top hit is never listed twice)
    const topCard = !!result?.top && !out.length;
    if (topCard) out.push({ t: 'top', key: 'top:' + result!.top!.doc.key, doc: result!.top!.doc });
    const rest = result ? (!topCard && result.top ? [{ section: result.top.doc.section, hits: [result.top], more: 0 }, ...result.sections] : result.sections) : [];
    // a top hit pushed down by a sum or a day joins its own section, at its head
    const merged = new Map<string, { hits: SiftDoc[]; more: number }>();
    const base = isAll ? 5 : scopes.length === 1 ? 30 : 12;
    for (const sec of rest) {
      const m = merged.get(sec.section) ?? { hits: [], more: 0 };
      for (const h of sec.hits) if (!m.hits.some((x) => x.key === h.doc.key)) m.hits.push(h.doc);
      m.more += sec.more;
      merged.set(sec.section, m);
    }
    for (const [section, { hits }] of merged) {
      const shown = base + (extra[section] || 0);
      const more = Math.max(0, hits.length - shown);
      out.push({
        t: 'head', key: 'h:' + section, label: section, more: more || undefined,
        onMore: more ? () => { tick(); setExtra((x) => ({ ...x, [section]: (x[section] || 0) + 25 })); } : undefined,
      });
      for (const doc of hits.slice(0, shown)) out.push({ t: 'doc', key: doc.key, doc, index: n++ });
    }

    // the journal's texts are still being read
    if (journalLoading && has('journal')) {
      out.push({ t: 'loading', key: 'loading-journal', label: 'Searching the journal…' });
    }

    // locked tools: one row each, to unlock and search them too
    const locks: Item[] = [];
    if (notesLocked && !archived.includes('notes') && has('notes')) {
      locks.push({
        t: 'row', key: 'lock:notes', index: n++, icon: 'lock-closed-outline', color: colorOf('green'),
        title: 'Notes are locked', subtitle: 'Unlock to search them', onPress: () => { Keyboard.dismiss(); setPinFor('notes'); },
      });
    }
    if (journalLocked && !archived.includes('journal') && has('journal')) {
      locks.push({
        t: 'row', key: 'lock:journal', index: n++, icon: 'lock-closed-outline', color: colorOf('gold'),
        title: 'The journal is locked', subtitle: 'Unlock to search it', onPress: () => { Keyboard.dismiss(); setPinFor('journal'); },
      });
    }
    if (locks.length) {
      out.push({ t: 'head', key: 'h-locked', label: 'Locked' });
      out.push(...locks);
    }

    // what the query itself can become
    if (has('todos') || has('notes')) {
      const acts: Item[] = [];
      const clip = query.length > 40 ? query.slice(0, 39).trimEnd() + '…' : query;
      if (has('todos') && !archived.includes('tasks')) {
        acts.push({ t: 'row', key: 'q:todo', index: n++, icon: 'add-circle-outline', color: colorOf(toolByKey('tasks')!.colorKey), title: 'Add “' + clip + '” as a ToDo', onPress: () => run(() => addTodo(query)) });
      }
      if (has('notes') && !archived.includes('notes')) {
        acts.push({ t: 'row', key: 'q:note', index: n++, icon: 'create-outline', color: colorOf(toolByKey('notes')!.colorKey), title: 'New note “' + clip + '”', onPress: () => run(() => newNote(query)) });
      }
      if (isAll) {
        const fq = fold(query);
        const subject = fq.length >= 2 ? subjects.find((s) => fold(s.name) === fq) ?? (fq.length >= 3 ? subjects.find((s) => fold(s.name).startsWith(fq)) : undefined) : undefined;
        if (subject && !archived.includes('focus')) {
          acts.push({ t: 'row', key: 'q:focus', index: n++, icon: 'play-outline', color: colorOf(toolByKey('focus')!.colorKey), title: 'Start Deep Work on ' + subject.name, onPress: () => run(() => openTool('focus', { subject: subject.name })) });
        }
        if (!archived.includes('ai')) {
          for (const a of aiLinks) {
            const ask = ASKABLE.find((x) => x.host.test(hostOf(a.url)));
            if (!ask) continue;
            acts.push({
              t: 'row', key: 'q:ask:' + a.id, index: n++, icon: 'sparkles-outline', color: C.accent, title: 'Ask ' + a.label + ' about “' + clip + '”',
              onPress: () => run(() => { Linking.openURL(ask.url(query)).catch(() => toast("Couldn't open that link")); }),
            });
            if (acts.length >= 6) break;
          }
        }
      }
      if (acts.length) {
        out.push({ t: 'head', key: 'h-actions-q', label: 'Do' });
        out.push(...acts);
      }
    }

    // the companion, asked for by name or by what it is: hide it a while, send it off or call it back, its page
    const st = useStore.getState().settings;
    if (isAll && st.mood === 'cheerful' && st.mascot !== 'off') {
      const pal = st.mascotName || (st.mascot === 'pip' ? 'Pip' : 'Sprout');
      const fq = fold(query);
      const words = ['companion', 'mascot', 'sprout', 'pip', 'buddy', 'hide', 'pet', fold(pal)];
      if (fq.length >= 3 && words.some((w) => w.startsWith(fq) || fq.split(' ').some((p) => p.length >= 3 && w.startsWith(p)))) {
        const gone = st.mascotOut || st.mascotHideUntil > Date.now();
        const set = useStore.getState().setSetting;
        const hide = (min: number, label: string): Item => ({
          t: 'row', key: 'm:hide' + min, index: n++, icon: 'eye-off-outline', color: CHEER_PINK, title: 'Hide ' + pal + ' for ' + label,
          subtitle: 'Back by itself after', onPress: () => run(() => { set('mascotHideUntil', Date.now() + min * 60000); toast(pal + ' will be back in ' + label); }, false),
        });
        const rows: Item[] = gone
          ? [{ t: 'row', key: 'm:back', index: n++, icon: 'enter-outline', color: CHEER_PINK, title: 'Bring ' + pal + ' back', onPress: () => run(() => { set('mascotOut', false); set('mascotHideUntil', 0); }, false) }]
          : [
            hide(5, '5 minutes'), hide(30, '30 minutes'), hide(120, '2 hours'),
            { t: 'row', key: 'm:off', index: n++, icon: 'exit-outline', color: CHEER_PINK, title: 'Send ' + pal + ' off', subtitle: 'Until you knock on its door', onPress: () => run(() => set('mascotOut', true), false) },
          ];
        rows.push({ t: 'row', key: 'm:page', index: n++, icon: 'color-palette-outline', color: CHEER_PINK, title: pal + "'s look and manners", onPress: () => run(() => router.push('/companion'), false) });
        out.push({ t: 'head', key: 'h-companion', label: 'Companion' });
        out.push(...rows);
      }
    }

    if (!result?.total && !out.some((x) => x.t === 'math' || x.t === 'day')) {
      const dym = result?.didYouMean;
      out.unshift({
        t: 'note', key: 'n-none',
        text: isAll ? 'Nothing matches “' + query + '”.' : 'Nothing in ' + scopes.map((k) => SCOPES.find((x) => x.key === k)!.label).join(', ') + ' matches “' + query + '”.',
        action: dym ? { label: 'Did you mean “' + dym + '”?', onPress: () => { setQ(dym); setDq(dym); } }
          : !isAll ? { label: 'Search everything', onPress: () => setScopes([]) } : undefined,
      });
    }
    return out;
  }, [dq, scopes, isAll, extra, has, result, math, memory, pinnedKeys, index, journalLoading, notesLocked, journalLocked, archived, subjects, hour24, aiLinks, go, run, openRecent]);

  /**
   * Enter: a sum goes to the Calculator, written in (even one with no answer yet, to be finished there); anything else
   * opens the top result. Worked out from what is typed now, not from the results a pause behind it.
   */
  const enterTarget = React.useCallback((typed: string): { kind: 'sum'; expr: string } | { kind: 'doc'; doc: SiftDoc } | null => {
    const query = typed.trim();
    if (!query) return null;
    const sum = keypadSum(query);
    if (sum) return { kind: 'sum', expr: sum };
    if (query === dq.trim()) {
      const first = items.find((x) => x.t === 'top' || x.t === 'doc');
      return first && (first.t === 'top' || first.t === 'doc') ? { kind: 'doc', doc: first.doc } : null;
    }
    const fresh = sources.index.search(query, { filter: (d) => inScope(d.section, scopes), usage: (k) => memory.uses[k] || 0, perSection: 5 });
    const doc = fresh.top?.doc ?? fresh.sections[0]?.hits[0]?.doc;
    return doc ? { kind: 'doc', doc } : null;
  }, [dq, items, sources.index, scopes, memory.uses]);

  /* ---- the PC's keyboard: Up and Down move a highlight through the results, Enter opens it, typing starts it over */
  const [sel, setSel] = React.useState(0);
  // the highlight is drawn only once a key has moved it; before that Enter opens the top result as ever
  const [kbd, setKbd] = React.useState(false);
  const selectable = React.useMemo(() => items.filter((x) => x.t === 'top' || x.t === 'doc' || x.t === 'row'), [items]);
  React.useEffect(() => { setSel(0); setKbd(false); }, [dq, scopes]);
  const selKey = kbd ? selectable[Math.min(sel, selectable.length - 1)]?.key : undefined;
  const nodes = React.useRef(new Map<string, any>());
  const onKey = (e: any) => {
    const k = e.nativeEvent?.key;
    if (Platform.OS !== 'web' || (k !== 'ArrowDown' && k !== 'ArrowUp') || !selectable.length) return;
    e.preventDefault?.();
    const next = kbd ? Math.max(0, Math.min(selectable.length - 1, Math.min(sel, selectable.length - 1) + (k === 'ArrowDown' ? 1 : -1))) : 0;
    setKbd(true);
    setSel(next);
    // into view, clear of the sticky section head
    const el = nodes.current.get(selectable[next].key) as HTMLElement | undefined;
    let box: HTMLElement | null = el?.parentElement ?? null;
    while (box && !(box.scrollHeight > box.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
    if (el && box) {
      const r = el.getBoundingClientRect();
      const c = box.getBoundingClientRect();
      if (r.top < c.top + 48) box.scrollTop -= c.top + 48 - r.top;
      else if (r.bottom > c.bottom - 8) box.scrollTop += r.bottom - (c.bottom - 8);
    }
  };
  const onSubmit = () => {
    if (kbd && selKey) {
      const x = selectable.find((i) => i.key === selKey);
      if (x && (x.t === 'top' || x.t === 'doc')) { go(x.doc); return; }
      if (x && x.t === 'row') { x.onPress(); return; }
    }
    const target = enterTarget(q);
    if (!target) return;
    if (target.kind === 'sum') {
      if (q.trim()) rememberQuery(q);
      closeSift();
      handOver(() => openTool('calculator', { expr: target.expr }));
    } else go(target.doc);
  };
  // the first week, a quiet line says what Enter will do
  const hintOn = memory.loaded && memory.firstUsedAt > 0 && Date.now() - memory.firstUsedAt < ENTER_HINT_MS;
  const enterHint = React.useMemo(() => {
    if (!hintOn || !dq.trim()) return '';
    const t = enterTarget(dq);
    if (!t) return '';
    if (t.kind === 'sum') return 'Enter opens the Calculator with this sum';
    const name = t.doc.title.length > 34 ? t.doc.title.slice(0, 33).trimEnd() + '…' : t.doc.title;
    return 'Enter opens the top result, “' + name + '”';
  }, [hintOn, dq, enterTarget]);

  /* ---- the panel's motion */
  // The fold: the app's blur rises from the bottom (AppFrame) while Sift settles in from the top down, its ground a
  // breath behind the blur, then the field, then the filters and the results, each coming into focus in turn. Closing
  // plays it back: the results go first, the field last, and the blur sinks away
  const span = (p: number, a: number, b: number) => {
    'worklet';
    return Math.min(1, Math.max(0, (p - a) / (b - a)));
  };
  const panelStyle = useAnimatedStyle(() => ({ opacity: level === 'full' ? span(siftShown.value, 0.12, 0.62) : siftShown.value }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: SCRIM * siftShown.value }));
  // From a pull, the field grows out of the pill the pull drew under the bar: it starts the pill's width and a little
  // lower, fully there almost at once, and opens out to its own width; closing, it draws back into the pill the same
  // way. Opened any other way, it drops in from the top.
  const pillScale = Math.min(0.9, Math.max(0.2, PILL_W / Math.max(1, Math.min(width, PANEL_MAX) - 32)));
  const fieldStyle = useAnimatedStyle(() => {
    if (anchored) return { opacity: 1, transform: [{ translateY: 0 }, { scaleX: 1 }, { scaleY: 1 }] as const };
    if (level !== 'full') return { opacity: siftShown.value };
    const p = siftShown.value;
    // the field comes into focus where it sits, first of Sift's parts: from a hair larger and soft to sharp
    const e = 1 - Math.pow(1 - span(p, 0.16, 0.66), 3);
    return {
      opacity: e,
      transform: [{ translateY: -8 * (1 - e) }, { scaleX: 1.04 - 0.04 * e }, { scaleY: 1.04 - 0.04 * e }] as const,
      ...(Platform.OS === 'web' ? { filter: 'blur(' + (7 * (1 - e)).toFixed(2) + 'px)' } : null),
    } as any;
  });
  // the well itself, from the bar's place and size to its own: moved and sized (never scaled), so its corners and words
  // stay true the whole way
  const wellStyle = useAnimatedStyle(() => {
    const w = well.value;
    if (!anchored || w.w === 0) return {};
    const a = from.value;
    const p = siftShown.value;
    const q = 1 - p;
    return {
      flexGrow: 0,
      width: w.w + (a.w - w.w) * q,
      height: w.h + (a.h - w.h) * q,
      transform: [{ translateX: (a.x - w.x) * q }, { translateY: (a.y - w.y) * q }] as const,
    };
  });
  const cancelStyle = useAnimatedStyle(() => ({ opacity: anchored ? Math.max(0, (siftShown.value - 0.4) / 0.6) : 1 }));
  const bodyStyle = useAnimatedStyle(() => {
    if (level === 'none') return { opacity: 1, transform: [{ translateY: drag.value }] };
    if (level !== 'full') return { opacity: span(siftShown.value, 0.3, 1), transform: [{ translateY: drag.value }] };
    // the filters and the results, after the field, coming down into focus from just above their place
    const e = 1 - Math.pow(1 - span(siftShown.value, 0.3, 0.92), 3);
    return {
      opacity: e,
      transform: [{ translateY: -14 * (1 - e) + drag.value }],
      ...(Platform.OS === 'web' ? { filter: e < 1 ? 'blur(' + (6 * (1 - e)).toFixed(2) + 'px)' : 'none' } : null),
    } as any;
  });

  /* ---- pull the list down at its top to close */
  const onScroll = useAnimatedScrollHandler((e) => { listY.value = e.contentOffset.y; });
  const pull = React.useMemo(() => Gesture.Pan()
    .manualActivation(true)
    .onTouchesDown((e) => { startY.value = e.allTouches[0]?.absoluteY ?? 0; })
    .onTouchesMove((e, state) => {
      const y = e.allTouches[0]?.absoluteY ?? 0;
      const dy = y - startY.value;
      if (listY.value <= 0 && dy > 12) state.activate();
      else if (dy < -6 || listY.value > 0) state.fail();
    })
    .onUpdate((e) => { drag.value = Math.max(0, e.translationY) * 0.45; })
    .onEnd((e) => {
      if (e.translationY > PULL_CLOSE) runOnJS(closeSift)();
      drag.value = withTiming(0, { duration: 200, easing: EASE_OUT });
    })
    .onFinalize(() => { if (drag.value > 0) drag.value = withTiming(0, { duration: 200, easing: EASE_OUT }); }), []);
  const listGesture = React.useMemo(() => Gesture.Simultaneous(pull, Gesture.Native()), [pull]);

  /* ---- rows' entrance: they rise and fade in, the first ten a beat apart; reordering glides, never springs */
  const entering = (index: number) => {
    if (level === 'none') return undefined;
    const delay = index < STAGGER_ROWS ? index * STAGGER : 0;
    if (level === 'some') return FadeIn.duration(160).delay(delay);
    return () => {
      'worklet';
      const ease = { duration: 220, easing: Easing.out(Easing.cubic) };
      return {
        initialValues: { opacity: 0, transform: [{ translateY: 8 }] },
        animations: {
          opacity: withDelay(delay, withTiming(1, ease)),
          transform: [{ translateY: withDelay(delay, withTiming(0, ease)) }],
        },
      };
    };
  };
  // Rows rise in only as Sift opens. After that a new search swaps the whole list at once, under a quick fade of the
  // list (below): rows that animated out while new ones animated in overlapped, and moved the sticky heads about
  const staged = React.useRef(true);
  React.useEffect(() => {
    const t = setTimeout(() => { staged.current = false; }, 600);
    return () => clearTimeout(t);
  }, []);
  const listFade = useSharedValue(1);
  const listRef = React.useRef<any>(null);
  const firstQuery = React.useRef(true);
  React.useEffect(() => {
    if (firstQuery.current) { firstQuery.current = false; return; }
    listRef.current?.scrollTo?.({ y: 0, animated: false });
    if (level === 'none') return;
    listFade.value = 0.45;
    listFade.value = withTiming(1, { duration: 160, easing: EASE_OUT });
  }, [dq, scopes]);
  const listStyle = useAnimatedStyle(() => ({ opacity: listFade.value }));

  const sticky = items.map((x, i) => (x.t === 'head' ? i : -1)).filter((i) => i >= 0);

  const renderItem = (x: Item) => {
    switch (x.t) {
      case 'head':
        return <SectionHead label={x.label} theme={theme} more={x.more} onMore={x.onMore} />;
      case 'doc':
        return (
          <ResultRow
            icon={x.doc.payload.icon} color={x.doc.payload.color} title={x.doc.title} subtitle={x.doc.subtitle} terms={terms}
            body={x.doc.body} onPress={() => go(x.doc)} theme={theme}
            pinned={pinnedKeys.has(x.doc.key)} onLongPress={() => pinToggle(docPin(x.doc), x.doc.title)}
          />
        );
      case 'row':
        return (
          <ResultRow
            icon={x.icon} color={x.color} title={x.title} subtitle={x.subtitle} terms={x.key.startsWith('recent:') || x.key.startsWith('q:') || x.key.startsWith('pin:') ? [] : terms}
            onPress={x.onPress} onRemove={x.onRemove} theme={theme}
            onLongPress={x.pin ? () => pinToggle(x.pin!, x.title) : undefined}
          />
        );
      case 'top': {
        const d = x.doc;
        const snip = d.body ? snippet(d.body, terms) : null;
        return (
          <TopCard
            kicker={pinnedKeys.has(d.key) ? 'Top hit · pinned' : 'Top hit'} theme={theme} onPress={() => go(d)}
            onLongPress={() => pinToggle(docPin(d), d.title)} label={[d.title, d.subtitle].filter(Boolean).join(', ')}
          >
            <View style={st.topRow}>
              <View style={[st.topWell, wellOf(theme), theme !== 'minimal' && neuInset('low')]}>
                <Ionicons name={d.payload.icon as any} size={22} color={d.payload.color || C.textDim} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Marked text={d.title} ranges={highlight(d.title, terms)} style={st.topTitle} />
                {d.subtitle ? <Text style={st.rowSub} numberOfLines={1}>{d.subtitle}</Text> : null}
              </View>
              <Ionicons name="return-down-back-outline" size={16} color={C.textFaint} style={{ transform: [{ scaleX: -1 }] }} />
            </View>
            {snip ? <Marked text={snip.text} ranges={snip.ranges} style={[st.rowSnip, { marginTop: 10 }]} lines={2} /> : null}
          </TopCard>
        );
      }
      case 'math':
        return (
          <TopCard
            kicker="Maths" theme={theme} label={x.expr + ' equals ' + x.answer}
            onPress={() => run(() => openTool('calculator', { expr: x.expr }))}
          >
            <Text style={st.mathExpr} numberOfLines={1}>{x.expr}</Text>
            <Text style={st.mathAnswer} numberOfLines={1} adjustsFontSizeToFit>{'= ' + x.answer}</Text>
            <Text style={[T.caption, { marginTop: 6 }]}>Open in the Calculator</Text>
          </TopCard>
        );
      case 'day':
        return (
          <TopCard kicker={x.day.title} theme={theme}>
            {x.day.lines.length ? x.day.lines.slice(0, 8).map((l) => (
              <Pressable
                key={l.key} onPress={() => run(l.open)} accessibilityRole="button" accessibilityLabel={l.text}
                style={({ pressed }) => [st.dayLine, pressed && { opacity: 0.7 }]}
              >
                <Ionicons name={l.icon as any} size={15} color={l.color || C.textDim} />
                <Text style={st.dayText} numberOfLines={1}>{l.text}</Text>
              </Pressable>
            )) : <Text style={T.caption}>Nothing planned, due or dated that day.</Text>}
            {x.day.lines.length > 8 ? <Text style={[T.caption, { marginTop: 4 }]}>{'+' + (x.day.lines.length - 8) + ' more'}</Text> : null}
          </TopCard>
        );
      case 'loading':
        return (
          <View style={st.row} accessibilityLabel={x.label}>
            <View style={[st.rowWell, wellOf(theme), { overflow: 'hidden' }]}><Sheen radius={12} /></View>
            <View style={st.rowText}>
              <Text style={[st.rowSub, { color: C.textFaint }]}>{x.label}</Text>
              <View style={[st.loadBar, wellOf(theme)]}><Sheen radius={4} /></View>
            </View>
          </View>
        );
      case 'hint':
        return <Text style={st.hint} maxFontSizeMultiplier={CHROME_FONT_MAX}>{x.text}</Text>;
      case 'note':
        return (
          <View style={st.note}>
            <Text style={[T.body, { color: C.textDim }]}>{x.text}</Text>
            {x.action ? (
              <Pressable onPress={x.action.onPress} hitSlop={8} accessibilityRole="button" style={{ marginTop: 10 }}>
                <Text style={[st.noteAction, { color: C.accent }]}>{x.action.label}</Text>
              </Pressable>
            ) : null}
          </View>
        );
      default:
        return null;
    }
  };

  // the rows are built again only when the results, the theme or the motion change, never on a keystroke alone
  const rows = React.useMemo(() => items.map((x) => (
    <Animated.View
      key={x.key}
      ref={(n: any) => { if (n) nodes.current.set(x.key, n); else nodes.current.delete(x.key); }}
      style={x.key === selKey ? [st.picked, { backgroundColor: theme === 'minimal' ? MIN.inset : C.pressDim }] : undefined}
      entering={x.t === 'head' || !staged.current ? undefined : entering('index' in x ? x.index : 0)}
    >
      {renderItem(x)}
    </Animated.View>
  )), [items, terms, theme, level, pinnedKeys, selKey]);

  const column = width > PANEL_MAX + S.pad * 2 ? { width: PANEL_MAX, alignSelf: 'center' as const } : null;
  const fieldWell = theme === 'minimal'
    ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border }
    : { backgroundColor: C.inset, ...neuInset('mid') };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={open ? 'auto' : 'none'} accessibilityViewIsModal>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#0C0C0B' }, scrimStyle]} />
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: bgFor(theme) }, panelStyle]}>
        <View style={[{ flex: 1, paddingTop: insets.top + 8 }, column]}>
          {/* the field: a carved well, with the glyph, the words, a clear key, the mic; Cancel beside it */}
          <Animated.View style={[st.fieldRow, fieldStyle]}>
            <Animated.View ref={wellRef} onLayout={anchored ? measureWell : undefined} collapsable={false} style={[st.field, fieldWell, wellStyle]}>
              <Ionicons name="search" size={18} color={C.textFaint} />
              <TextInput
                ref={inputRef}
                value={q}
                onChangeText={setQ}
                onKeyPress={onKey}
                placeholder="Sift through everything"
                placeholderTextColor={C.textFaint}
                selectionColor={C.accent}
                cursorColor={C.accent}
                style={st.input}
                returnKeyType="search"
                autoCorrect={false}
                autoCapitalize="none"
                submitBehavior="submit"
                onSubmitEditing={onSubmit}
                accessibilityLabel="Sift through everything"
              />
              {q ? (
                <Pressable onPress={() => { setQ(''); setDq(''); inputRef.current?.focus(); }} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear" style={st.fieldBtn}>
                  <Ionicons name="close-circle" size={18} color={C.textFaint} />
                </Pressable>
              ) : null}
              {voiceAvailable() ? (
                <Pressable onPress={toggleVoice} hitSlop={8} accessibilityRole="button" accessibilityLabel={listening ? 'Stop listening' : 'Search by voice'} style={st.fieldBtn}>
                  <Ionicons name={listening ? 'mic' : 'mic-outline'} size={19} color={listening ? C.accent : C.textFaint} />
                </Pressable>
              ) : null}
            </Animated.View>
            <Animated.View style={cancelStyle}>
              <Pressable onPress={closeSift} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel" style={st.cancel}>
                <Text style={[st.cancelText, { color: C.accent }]} maxFontSizeMultiplier={CHROME_FONT_MAX}>Cancel</Text>
              </Pressable>
            </Animated.View>
          </Animated.View>

          {/* the first week: a quiet line under the field, saying what Enter will open. Its room is kept all week, so the
              list below never jumps as the line comes and goes */}
          {hintOn ? (
            <View style={st.enterHint}>
              {enterHint ? (
                <Animated.View
                  key={enterHint} style={st.enterHintRow}
                  entering={level === 'none' ? undefined : FadeIn.duration(180).easing(EASE_OUT)}
                  exiting={level === 'none' ? undefined : FadeOut.duration(120)}
                >
                  <Ionicons name="return-down-back-outline" size={13} color={C.textFaint} style={{ transform: [{ scaleX: -1 }] }} />
                  <Text style={st.enterHintText} numberOfLines={1} maxFontSizeMultiplier={CHROME_FONT_MAX}>{enterHint}</Text>
                </Animated.View>
              ) : null}
            </View>
          ) : null}

          <Animated.View style={[{ flex: 1 }, bodyStyle]}>
            {/* scope chips: flat, in one scrolling row, each at its own natural width */}
            <ScrollView
              ref={chipsRef} horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled"
              contentContainerStyle={st.chips} style={st.chipsRow}
            >
              {chipOrder.map((s) => (
                <Animated.View key={s.key} layout={level === 'none' ? undefined : LinearTransition.duration(260).easing(EASE_OUT)}>
                  <Chip
                    small label={s.label} active={scopes.includes(s.key)} icon={scopes.includes(s.key) ? 'close' : undefined}
                    onPress={() => toggleScope(s.key)} style={st.chip}
                    accessibilityHint={scopes.includes(s.key) ? 'Takes the filter off' : 'Narrows Sift to it'}
                  />
                </Animated.View>
              ))}
            </ScrollView>

            <GestureDetector gesture={listGesture}>
              <Animated.ScrollView
                ref={listRef}
                style={listStyle}
                onScroll={onScroll}
                scrollEventThrottle={16}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                overScrollMode="never"
                stickyHeaderIndices={sticky}
                contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 24 }}
              >
                {rows}
              </Animated.ScrollView>
            </GestureDetector>
          </Animated.View>
        </View>
      </Animated.View>

      <PinSheet
        visible={pinFor != null}
        mode="enter"
        onClose={() => setPinFor(null)}
        onDone={() => {
          if (pinFor === 'notes') { markOpen('notes'); markOpen(ALL_NOTES); }
          if (pinFor === 'journal') markOpen('journal');
          setPinFor(null);
          // the unlocked texts join the results; the keyboard comes back for more typing
          InteractionManager.runAfterInteractions(() => inputRef.current?.focus());
        }}
      />
    </View>
  );
}


const st = StyleSheet.create({
  rise: { position: 'absolute', left: 0, right: 0, bottom: 0, overflow: 'hidden' },
  riseBlur: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  riseEdge: { position: 'absolute', left: 0, right: 0, top: 0, height: FEATHER },
  fieldRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: S.pad, paddingBottom: 12 },
  field: { flex: 1, height: 48, borderRadius: 16, flexDirection: 'row', alignItems: 'center', paddingLeft: 14, paddingRight: 6, gap: 8, overflow: 'hidden' },
  input: { flex: 1, color: C.text, fontFamily: F.reg, fontSize: 16, letterSpacing: TRACK.body, paddingVertical: 0 },
  fieldBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  cancel: { marginLeft: 14, height: 44, justifyContent: 'center' },
  cancelText: { fontFamily: F.med, fontSize: 15, letterSpacing: TRACK.body },
  chipsRow: { flexGrow: 0, flexShrink: 0 },
  chips: { paddingHorizontal: S.pad, paddingTop: 2, paddingBottom: 12, alignItems: 'center' },
  chip: { marginRight: 8, marginBottom: 0, flexShrink: 0 },
  enterHint: { height: 16, marginTop: -4, marginBottom: 10, paddingHorizontal: S.pad + 4, opacity: 0.62 },
  enterHintRow: { position: 'absolute', left: S.pad + 4, right: S.pad + 4, top: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  enterHintText: { flex: 1, color: C.textFaint, fontFamily: F.sm, ...oneLine(12), letterSpacing: TRACK.fine },
  hint: { color: C.textFaint, fontFamily: F.sm, fontSize: 12, lineHeight: 17, letterSpacing: TRACK.fine, paddingHorizontal: S.pad, paddingTop: 22, opacity: 0.8 },
  picked: { borderRadius: 14 },
  rowPin: { marginLeft: 8 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: S.pad, paddingTop: 18, paddingBottom: 8 },
  headMore: { color: C.textFaint, fontFamily: F.sm, fontSize: 11, letterSpacing: TRACK.fine },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: S.pad, paddingVertical: 10, minHeight: 56 },
  rowWell: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, minWidth: 0, marginLeft: 14 },
  rowTitle: { color: C.text, fontFamily: F.med, fontSize: 15, letterSpacing: TRACK.body },
  rowSub: { color: C.textFaint, fontFamily: F.sm, fontSize: 12, lineHeight: 17, letterSpacing: TRACK.fine, marginTop: 1 },
  rowSnip: { color: C.textDim, fontFamily: F.sm, fontSize: 13, lineHeight: 18, letterSpacing: TRACK.fine, marginTop: 3 },
  rowTrail: { color: C.textFaint, fontFamily: F.sm, fontSize: 12, marginLeft: 8 },
  rowX: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', marginLeft: 4 },
  top: { marginHorizontal: S.pad, marginTop: 6, marginBottom: 8, borderRadius: S.radius, padding: S.cardPad },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  topWell: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  topTitle: { color: C.text, fontFamily: F.semi, fontSize: 17, letterSpacing: TRACK.title },
  mathExpr: { color: C.textDim, fontFamily: F.reg, fontSize: 15, letterSpacing: TRACK.body },
  mathAnswer: { color: C.text, fontFamily: F.med, fontSize: 28, letterSpacing: TRACK.large, marginTop: 4, fontVariant: ['tabular-nums'] },
  dayLine: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 },
  dayText: { flex: 1, color: C.text, fontFamily: F.reg, fontSize: 15, letterSpacing: TRACK.body },
  loadBar: { height: 8, borderRadius: 4, marginTop: 6, width: '60%', overflow: 'hidden' },
  note: { paddingHorizontal: S.pad, paddingVertical: 18 },
  noteAction: { fontFamily: F.med, fontSize: 15, letterSpacing: TRACK.body, ...oneLine(15) },
});
