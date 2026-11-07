import React from 'react';
import {
  BackHandler, InteractionManager, Platform, Keyboard, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  LinearTransition, runOnJS, useAnimatedReaction, useAnimatedScrollHandler, useAnimatedStyle,
  useSharedValue, withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { C, CHROME_FONT_MAX, F, MIN, S, T, TRACK, ThemeMode, bgFor, neuBase, neuInset, neuRaised, oneLine } from '../theme';
import { useStore } from '../store';
import { Chip, useTheme } from './UI';
import { Backdrop, useCheerful } from './Cheer';
import { WallpaperLayer, useWallpaper } from './Wallpaper';
import { Bouncy, EASE_EMPHASISED, EASE_EXIT, EASE_OUT, Sheen, useAnimLevel } from './Motion';
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
  ENTER_HINT_MS, OpenedRef, PinnedRef, SiftRect, SiftScope, SiftScopes, closeSift, forgetOpened, forgetQuery, loadSiftMemory,
  measureSiftAnchor, queryPinKey, rememberOpen, rememberQuery, siftAnchorOut, siftAnchorOwner, siftPull, siftShown, togglePin,
  unpin, useSearch, useSiftMemory,
} from '../search/store';
import { router } from 'expo-router';

/** the companion's actions wear Cheerful's pink */
const CHEER_PINK = '#FF8FB1';

// Sift: the app-wide search, laid over everything. It comes in as one piece: its ground fades in over the app while
// the field, the filters and the results settle a few points down into their places, and it goes the same way back,
// a little quicker. Nothing else moves (the app behind, a page's own search bar), so nothing can be left half-done; the
// keyboard comes up once the motion has settled. Results are worked out a frame after typing pauses, and the last ones
// stay up until the new ones are ready, so nothing flashes. Pull the list down at its top, Back or Cancel to close; on
// Android the keyboard goes down first, so the page behind has settled before Sift fades from over it.

const OPEN_MS = 260;
const CLOSE_MS = 200;
/** the field's way out of a page's bar and back into it: long enough to follow, quick off the mark */
const LIFT_MS = 360;
const LAND_MS = 280;
/** how far Sift's parts travel to settle into their places */
const SETTLE = 10;
/** results are worked out this long after the last keystroke, then on the next frame */
const TYPE_PAUSE = 40;
/** a pull down of this much on the list, from its top, closes Sift */
const PULL_CLOSE = 90;
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
 * The app under Sift. It stays exactly as it is (no scaling, no blur, no dimming: Sift's own ground covers it), so
 * nothing behind Sift can show at the edges or stick half-done; a screen reader is only held inside Sift while it is up.
 * Wrap the root navigator with it, and mount <SearchOverlay/> after it.
 */
export function AppFrame({ children }: { children: React.ReactNode }) {
  const siftOpen = useSearch((s) => s.open);
  return (
    <View style={{ flex: 1 }} importantForAccessibility={siftOpen ? 'no-hide-descendants' : 'auto'}>
      {children}
    </View>
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

/** A body's window around its first match, worked out once per result and query (see the list's items) */
type Snip = ReturnType<typeof snippet>;

/** A result's row: flat, its icon in a small well, the title (matches in the accent), a sub-line, a snippet. */
const ResultRow = React.memo(function ResultRow({ icon, color, title, subtitle, terms, snip, onPress, onLongPress, pinned, onRemove, theme, trailing }: {
  icon: string; color?: string; title: string; subtitle?: string; terms: string[];
  /** the body's snippet, already worked out */
  snip?: Snip; onPress: () => void;
  /** a hold pins the row (or unpins it) */
  onLongPress?: () => void; pinned?: boolean;
  onRemove?: () => void; theme: ThemeMode; trailing?: string;
}) {
  // a snippet only when the title itself does not already show the match
  const titleRanges = highlight(title, terms);
  // pressed, it carves in where it stands, as a list row does everywhere else in the app (ListRow)
  return (
    <Bouncy
      onPress={onPress}
      onLongPress={onLongPress}
      scaleTo={1} sink={false} radius={14}
      accessibilityRole="button"
      accessibilityLabel={[title, subtitle, pinned ? 'pinned' : ''].filter(Boolean).join(', ')}
      accessibilityHint={onLongPress ? (pinned ? 'Hold to unpin' : 'Hold to pin to the top of Sift') : undefined}
      style={st.row}
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
    </Bouncy>
  );
});

/** "+N more" is a short word in small type: its reach grows to a finger's size */
const MORE_SLOP = { top: 14, bottom: 14, left: 12, right: 12 };

/** A section's head: a kicker, sticky at the top of the list while its rows scroll under it. */
function SectionHead({ label, theme, more, onMore }: { label: string; theme: ThemeMode; more?: number; onMore?: () => void }) {
  const cheerful = useCheerful();
  const bg = bgFor(theme);
  return (
    <View style={[st.head, !cheerful && { backgroundColor: bg }]} accessibilityRole="header">
      {cheerful ? (
        // Cheerful's glows show through Sift: the head masks the rows passing under it with a fade, not a band
        <LinearGradient pointerEvents="none" colors={[bg, bg + 'EB', bg + '00']} locations={[0, 0.62, 1]} style={StyleSheet.absoluteFill} />
      ) : null}
      <Text style={T.kicker} maxFontSizeMultiplier={CHROME_FONT_MAX}>{label}</Text>
      {more && onMore ? (
        <Pressable onPress={onMore} hitSlop={MORE_SLOP} accessibilityRole="button" accessibilityLabel={'Show more ' + label}>
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
  // one that opens something sinks into the material under the finger, as a Card does: it keeps only its contact shadow
  // here, and Bouncy draws the rest on a layer that fades as it is pressed in
  const minimal = theme === 'minimal';
  return onPress ? (
    <Bouncy
      onPress={onPress} onLongPress={onLongPress} radius={S.radius} raised={minimal ? undefined : 'mid'}
      accessibilityRole="button" accessibilityLabel={label}
      style={[st.top, minimal ? face : { backgroundColor: C.card, ...neuBase() }]}
    >
      {body}
    </Bouncy>
  ) : (
    <View style={[st.top, face]}>{body}</View>
  );
}

/* ---------------------------------------------------------------- the list's items */

type Item =
  | { t: 'head'; key: string; label: string; more?: number; onMore?: () => void }
  | { t: 'doc'; key: string; doc: SiftDoc; index: number; snip: Snip }
  | { t: 'top'; key: string; doc: SiftDoc; snip: Snip }
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

  /*
   * ---- in and out. Opened from a page's own bar (More's, Settings') at full motion, the field lifts out of that bar: it
   * starts exactly over it and glides to its place, by transforms alone (its background scales from the bar's size, its
   * glyph and words only move, so nothing stretches), while the ground fades in behind it and the filters and results
   * settle after it; the bar hides in the frame the field takes its place. Going, the field glides back into the bar,
   * measured again, and the bar shows in the frame it lands. Opened any other way, it fades in with a short settle.
   */
  const anchorRect = useSearch((s) => s.anchor);
  const anchorOwner = useSearch((s) => s.anchorOwner);
  const wellRef = React.useRef<View>(null);
  const wellRect = React.useRef<SiftRect | null>(null);
  /** 1 while the field travels between the bar and its place; the offset and scales it starts from */
  const lift = useSharedValue(0);
  const from = useSharedValue({ dx: 0, dy: 0, sx: 1, sy: 1 });
  const fromBar = (bar: SiftRect, well: SiftRect) => ({
    dx: bar.x - well.x, dy: bar.y - well.y, sx: bar.w / Math.max(1, well.w), sy: bar.h / Math.max(1, well.h),
  });
  React.useEffect(() => {
    if (open) {
      tick();
      const bar = anchorRect;
      const owner = anchorOwner;
      const plain = () => {
        lift.value = 0;
        siftShown.value = level === 'none' ? 1 : withTiming(1, { duration: OPEN_MS, easing: EASE_OUT });
      };
      if (bar && owner && level === 'full') {
        siftShown.value = 0;
        // the field's own place, once laid out (the next frame): measured the same way as the bar, so the status bar
        // Android leaves out of both cancels
        let started = false;
        const start = (well: SiftRect | null) => {
          if (started) return;
          started = true;
          if (!well || well.w <= 0) { plain(); return; }
          wellRect.current = well;
          from.value = fromBar(bar, well);
          lift.value = 1;
          siftAnchorOwner.value = owner;
          siftAnchorOut.value = 1;
          siftShown.value = withTiming(1, { duration: LIFT_MS, easing: EASE_EMPHASISED });
        };
        const raf = requestAnimationFrame(() => wellRef.current?.measureInWindow((x, y, w, h) => start({ x, y, w, h })));
        const late = setTimeout(() => start(null), 120);
        // the keyboard comes once the field has landed, so it never rides the lift
        const t = setTimeout(() => inputRef.current?.focus(), LIFT_MS + 40);
        // closed again before the field was measured: the lift never starts over the way out
        return () => { started = true; cancelAnimationFrame(raf); clearTimeout(late); clearTimeout(t); };
      }
      plain();
      // the keyboard comes once the motion has settled, so it never rides the opening
      const t = setTimeout(() => inputRef.current?.focus(), level === 'none' ? 30 : OPEN_MS);
      return () => clearTimeout(t);
    }
    const kbUp = Platform.OS === 'android' && Keyboard.isVisible();
    Keyboard.dismiss();
    voice.current?.stop();
    // however it went, the page's bar is shown again as Sift goes: it can never be left hidden
    const done = () => { siftPull.value = 0; siftAnchorOut.value = 0; onGone(); };
    if (level === 'none') {
      siftShown.value = 0;
      done();
      return undefined;
    }
    const plainOut = () => {
      lift.value = 0;
      siftAnchorOut.value = 0;
      siftShown.value = withTiming(0, { duration: CLOSE_MS, easing: EASE_EXIT }, (fin) => { if (fin) runOnJS(done)(); });
    };
    const fade = () => {
      const owner = anchorOwner;
      const well = wellRect.current;
      if (!(lift.value > 0.5 && owner && well)) { plainOut(); return; }
      // back into the bar, measured again where it is now (the page behind may have moved under the keyboard)
      measureSiftAnchor(owner, (bar) => {
        if (!bar || bar.w <= 0 || bar.y + bar.h <= 0) { plainOut(); return; }
        from.value = fromBar(bar, well);
        siftShown.value = withTiming(0, { duration: LAND_MS, easing: EASE_EMPHASISED }, (fin) => {
          if (!fin) return;
          // the bar shows in the frame the field lands in it
          siftAnchorOut.value = 0;
          runOnJS(done)();
        });
      });
    };
    if (!kbUp) { fade(); return undefined; }
    // Android: the keyboard goes down first, and the page behind takes its full height back while Sift still covers it;
    // then Sift fades from over a page already at rest
    let went = false;
    const go = () => { if (went) return; went = true; sub.remove(); clearTimeout(t); fade(); };
    const sub = Keyboard.addListener('keyboardDidHide', () => setTimeout(go, 40));
    const t = setTimeout(go, 260);
    return () => { if (!went) { sub.remove(); clearTimeout(t); } };
  }, [open]);

  // Back closes Sift first; while it fades out (until it is gone and this panel unmounts) Back does nothing, so a second
  // press never pops the page behind it
  React.useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { if (open) closeSift(); return true; });
    return () => sub.remove();
  }, [open]);

  // while it fades out it still takes touches, and swallows them, until it is mostly gone: a second tap (Cancel again,
  // a result) never lands on the page behind it while that page still looks covered
  const [held, setHeld] = React.useState(true);
  useAnimatedReaction(() => siftShown.value >= 0.3, (now, was) => { if (now !== was) runOnJS(setHeld)(now); });

  // and if Sift is taken down any other way (a profile switch, a reload), the bar comes back too
  React.useEffect(() => () => { siftAnchorOut.value = 0; }, []);

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
  // each result's snippet, worked out once per document and query: a new list (another section opened, a pin) never
  // walks every body again
  const snips = React.useRef({ dq: '', map: new Map<string, Snip>() });

  const items: Item[] = React.useMemo(() => {
    const out: Item[] = [];
    const query = dq.trim();
    let n = 0;
    if (snips.current.dq !== dq) snips.current = { dq, map: new Map() };
    const snipOf = (doc: SiftDoc): Snip => {
      if (!doc.body || !terms.length) return null;
      const k = doc.key + '|' + doc.body.length;
      const known = snips.current.map;
      if (!known.has(k)) known.set(k, snippet(doc.body, terms));
      return known.get(k) ?? null;
    };
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
    if (topCard) out.push({ t: 'top', key: 'top:' + result!.top!.doc.key, doc: result!.top!.doc, snip: snipOf(result!.top!.doc) });
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
      for (const doc of hits.slice(0, shown)) out.push({ t: 'doc', key: doc.key, doc, index: n++, snip: snipOf(doc) });
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
  }, [dq, terms, scopes, isAll, extra, has, result, math, memory, pinnedKeys, index, journalLoading, notesLocked, journalLocked, archived, subjects, hour24, aiLinks, go, run, openRecent]);

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

  /* ---- the panel's motion: the ground fades in; the field, filters and results settle down a few points with it */
  const span = (p: number, a: number, b: number) => {
    'worklet';
    return Math.min(1, Math.max(0, (p - a) / (b - a)));
  };
  // lifting out of a bar, the ground comes in just behind the field, so the field is seen leaving the page first
  const panelStyle = useAnimatedStyle(() => ({ opacity: lift.value > 0.5 ? span(siftShown.value, 0.08, 0.55) : siftShown.value }));
  // the filters and results (and, opened any other way, the field too) settle a few points down into their places
  const settleStyle = useAnimatedStyle(() => {
    const p = lift.value > 0.5 ? span(siftShown.value, 0.35, 1) : siftShown.value;
    return { opacity: p, transform: [{ translateY: level === 'full' ? -SETTLE * (1 - p) : 0 }] };
  });
  const fieldRowStyle = useAnimatedStyle(() => {
    if (lift.value > 0.5) return { opacity: 1, transform: [{ translateY: 0 }] };
    const p = siftShown.value;
    return { opacity: p, transform: [{ translateY: level === 'full' ? -SETTLE * (1 - p) : 0 }] };
  });
  // the field itself, travelling from the bar's place to its own
  const wellMove = useAnimatedStyle(() => {
    const q = lift.value > 0.5 ? 1 - siftShown.value : 0;
    return { transform: [{ translateX: from.value.dx * q }, { translateY: from.value.dy * q }] as const };
  });
  // its background taking the bar's size on the way (scaled from its left edge); the glyph and words never scale
  const wellBg = useAnimatedStyle(() => {
    const q = lift.value > 0.5 ? 1 - siftShown.value : 0;
    return { transform: [{ scaleX: 1 + (from.value.sx - 1) * q }, { scaleY: 1 + (from.value.sy - 1) * q }] as const };
  });
  const cancelStyle = useAnimatedStyle(() => {
    const p = lift.value > 0.5 ? span(siftShown.value, 0.5, 1) : 1;
    return { opacity: p, transform: [{ translateX: 12 * (1 - p) }] };
  });
  const bodyStyle = useAnimatedStyle(() => ({ transform: [{ translateY: drag.value }] }));

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

  // a new search swaps the whole list at once, under a quick fade of the list (rows animating in and out over each
  // other moved the sticky heads about)
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
            snip={x.snip} onPress={() => go(x.doc)} theme={theme}
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
        const snip = x.snip;
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
              <Bouncy
                key={l.key} onPress={() => run(l.open)} scaleTo={1} sink={false} radius={10}
                accessibilityRole="button" accessibilityLabel={l.text} style={st.dayLine}
              >
                <Ionicons name={l.icon as any} size={15} color={l.color || C.textDim} />
                <Text style={st.dayText} numberOfLines={1}>{l.text}</Text>
              </Bouncy>
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
    >
      {renderItem(x)}
    </Animated.View>
  )), [items, terms, theme, level, pinnedKeys, selKey]);

  const column = width > PANEL_MAX + S.pad * 2 ? { width: PANEL_MAX, alignSelf: 'center' as const } : null;
  const cheerful = useCheerful();
  const photo = useWallpaper();
  const fieldWell = theme === 'minimal'
    ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border }
    : { backgroundColor: C.inset, ...neuInset('mid') };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={open ? 'auto' : held ? 'box-only' : 'none'} accessibilityViewIsModal>
      {/* Sift's ground (Cheerful's glows on it), opaque once in: nothing of the app behind shows through */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: bgFor(theme) }, panelStyle]}>
        {/* with a photo behind the pages, Sift's ground is its frosted copy, dimmed so the results read */}
        {photo ? <WallpaperLayer bar /> : null}
        {cheerful && (!photo || photo.glows) ? <Backdrop minimal={theme === 'minimal'} /> : null}
      </Animated.View>
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <View style={[{ flex: 1, paddingTop: insets.top + 8 }, column]}>
          {/* the field: a carved well, with the glyph, the words, a clear key, the mic; Cancel beside it */}
          <Animated.View style={[st.fieldRow, fieldRowStyle]}>
            <Animated.View ref={wellRef as any} collapsable={false} style={[st.field, wellMove]}>
              <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, st.fieldBg, fieldWell, wellBg]} />
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
                maxFontSizeMultiplier={CHROME_FONT_MAX}
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

          <Animated.View style={[{ flex: 1 }, settleStyle]}>

          {/* the first week: a quiet line under the field, saying what Enter will open. Its room is kept all week, so the
              list below never jumps as the line comes and goes */}
          {hintOn ? (
            <View style={st.enterHint}>
              {enterHint ? (
                <View style={st.enterHintRow}>
                  <Ionicons name="return-down-back-outline" size={13} color={C.textFaint} style={{ transform: [{ scaleX: -1 }] }} />
                  <Text style={st.enterHintText} numberOfLines={1} maxFontSizeMultiplier={CHROME_FONT_MAX}>{enterHint}</Text>
                </View>
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
                contentContainerStyle={{ paddingTop: 6, paddingBottom: Math.max(insets.bottom, 16) + 24 }}
              >
                {rows}
              </Animated.ScrollView>
            </GestureDetector>
          </Animated.View>
          </Animated.View>
        </View>
      </View>

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
  fieldRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: S.pad, paddingBottom: 12 },
  // not clipped: its background scales out to the bar's width while it lifts out of a page's bar
  field: { flex: 1, minHeight: 48, borderRadius: 16, flexDirection: 'row', alignItems: 'center', paddingLeft: 14, paddingRight: 6, gap: 8 },
  fieldBg: { borderRadius: 16, transformOrigin: 'left' } as any,
  input: { flex: 1, color: C.text, fontFamily: F.reg, fontSize: 16, letterSpacing: TRACK.body, paddingVertical: 0, includeFontPadding: false },
  fieldBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  cancel: { marginLeft: 14, height: 44, justifyContent: 'center' },
  cancelText: { fontFamily: F.med, fontSize: 15, letterSpacing: TRACK.body },
  chipsRow: { flexGrow: 0, flexShrink: 0 },
  chips: { paddingHorizontal: S.pad, paddingTop: 2, paddingBottom: 12, alignItems: 'center' },
  chip: { marginRight: 8, marginBottom: 0, flexShrink: 0 },
  enterHint: { height: 19, marginTop: -5, marginBottom: 8, paddingHorizontal: S.pad + 4, opacity: 0.62 },
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
  // reaching a little past the card's text on both sides, so a press carves a pill round the line, not tight to its words
  dayLine: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, paddingHorizontal: 8, marginHorizontal: -8 },
  dayText: { flex: 1, color: C.text, fontFamily: F.reg, fontSize: 15, letterSpacing: TRACK.body },
  loadBar: { height: 8, borderRadius: 4, marginTop: 6, width: '60%', overflow: 'hidden' },
  note: { paddingHorizontal: S.pad, paddingVertical: 18 },
  noteAction: { fontFamily: F.med, fontSize: 15, letterSpacing: TRACK.body, ...oneLine(15) },
});
