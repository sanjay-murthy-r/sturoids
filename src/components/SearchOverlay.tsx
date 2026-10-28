import React from 'react';
import {
  BackHandler, InteractionManager, Keyboard, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing, FadeIn, FadeOut, LinearTransition, runOnJS, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue,
  withDelay, withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { C, CHROME_FONT_MAX, F, MIN, S, T, TRACK, ThemeMode, bgFor, neuInset, neuRaised, oneLine } from '../theme';
import { useStore } from '../store';
import { Chip, useTheme } from './UI';
import { EASE_EXIT, EASE_OUT, Sheen, useAnimLevel } from './Motion';
import { PinSheet } from './LockGate';
import { toast } from './Toast';
import { tick } from '../haptics';
import { ALL_NOTES, markOpen } from '../lock';
import { ToolKey, colorOf, toolByKey } from '../tools';
import { openTool } from '../toolNav';
import { DAY_NAMES, fmtClockTime, todoDueOn, toMinutes } from '../utils';
import { requestJournalOpen } from '../journal';
import { openScoreNode } from '../scoresNav';
import { quickMath } from '../calcEngine';
import { startVoice, voiceAvailable, VoiceSession } from '../voice';
import { Range, SearchResult, fold, highlight, parseDay, queryTerms, snippet } from '../search/engine';
import { SiftDoc, addTodo, inScope, newNote, restoreDocs, useSiftSources } from '../search/sources';
import {
  OpenedRef, SiftScope, closeSift, forgetOpened, forgetQuery, loadSiftMemory, rememberOpen, rememberQuery, siftPull,
  siftShown, useSearch, useSiftMemory,
} from '../search/store';

// Sift: the app-wide search, laid over everything. The app behind scales back a little and dims (AppFrame, driven by
// siftShown on the UI thread); the field drops from the top, or grows out of the header a pull came from; the keyboard
// comes up once the motion has settled. Results are worked out a frame after typing pauses, and the last ones stay up
// until the new ones are ready, so nothing flashes. Pull the list down at its top, Back or Cancel to close.

const OPEN_MS = 280;
const CLOSE_MS = 220;
/** the scrim's strength over the app when Sift is fully open */
const SCRIM = 0.55;
/** the app behind, fully open */
const BACK_SCALE = 0.965;
/** results are worked out this long after the last keystroke, then on the next frame */
const TYPE_PAUSE = 40;
/** a pull down of this much on the list, from its top, closes Sift */
const PULL_CLOSE = 90;
const STAGGER = 24;
const STAGGER_ROWS = 10;
const PANEL_MAX = 640;

const SCOPES: { key: SiftScope; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'todos', label: 'ToDos' }, { key: 'notes', label: 'Notes' },
  { key: 'journal', label: 'Journal' }, { key: 'vault', label: 'Vault' }, { key: 'scores', label: 'Scores' },
  { key: 'settings', label: 'Settings' },
];

/** AI sites that take a question in their address, so "Ask … about" can hand the query over. */
const ASKABLE: { host: RegExp; url: (q: string) => string }[] = [
  { host: /(^|\.)chatgpt\.com$|(^|\.)chat\.openai\.com$/, url: (q) => 'https://chatgpt.com/?q=' + encodeURIComponent(q) },
  { host: /(^|\.)perplexity\.ai$/, url: (q) => 'https://www.perplexity.ai/search?q=' + encodeURIComponent(q) },
  { host: /(^|\.)google\.[a-z.]+$/, url: (q) => 'https://www.google.com/search?q=' + encodeURIComponent(q) },
];

const hostOf = (url: string) => url.replace(/^https?:\/\//i, '').split(/[/?#]/)[0].replace(/^www\./i, '').toLowerCase();

/* ---------------------------------------------------------------- the app behind */

/**
 * The app as Sift opens over it: it scales back to 0.965 as Sift comes in (full motion only; with some it only dims,
 * under the overlay's scrim). Wrap the root navigator with it, and mount <SearchOverlay/> after it.
 */
export function AppFrame({ children }: { children: React.ReactNode }) {
  const level = useAnimLevel();
  const style = useAnimatedStyle(() => (level === 'full' && siftShown.value > 0
    ? { transform: [{ scale: 1 - (1 - BACK_SCALE) * siftShown.value }] }
    : { transform: [{ scale: 1 }] }));
  return <Animated.View style={[{ flex: 1 }, style]}>{children}</Animated.View>;
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
function ResultRow({ icon, color, title, subtitle, terms, body, onPress, onRemove, theme, trailing }: {
  icon: string; color?: string; title: string; subtitle?: string; terms: string[]; body?: string; onPress: () => void;
  onRemove?: () => void; theme: ThemeMode; trailing?: string;
}) {
  const snip = body && terms.length ? snippet(body, terms) : null;
  // a snippet only when the title itself does not already show the match
  const titleRanges = highlight(title, terms);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[title, subtitle].filter(Boolean).join(', ')}
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
      {onRemove ? (
        <Pressable onPress={onRemove} hitSlop={10} accessibilityRole="button" accessibilityLabel={'Remove ' + title} style={st.rowX}>
          <Ionicons name="close" size={16} color={C.textFaint} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

/** A section's head: a kicker, sticky at the top of the list while its rows scroll under it. */
function SectionHead({ label, theme, more }: { label: string; theme: ThemeMode; more?: number }) {
  return (
    <View style={[st.head, { backgroundColor: bgFor(theme) }]} accessibilityRole="header">
      <Text style={T.kicker} maxFontSizeMultiplier={CHROME_FONT_MAX}>{label}</Text>
      {more ? <Text style={st.headMore} maxFontSizeMultiplier={CHROME_FONT_MAX}>{'+' + more + ' more'}</Text> : null}
    </View>
  );
}

/** The raised card at the top: the Top hit, a sum's answer, a day. */
function TopCard({ kicker, children, theme, onPress, label }: {
  kicker: string; children: React.ReactNode; theme: ThemeMode; onPress?: () => void; label?: string;
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
      onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
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
  | { t: 'head'; key: string; label: string; more?: number }
  | { t: 'doc'; key: string; doc: SiftDoc; index: number }
  | { t: 'top'; key: string; doc: SiftDoc }
  | { t: 'math'; key: string; expr: string; answer: string }
  | { t: 'day'; key: string; day: DayCard }
  | { t: 'row'; key: string; icon: string; color?: string; title: string; subtitle?: string; onPress: () => void; onRemove?: () => void; index: number }
  | { t: 'loading'; key: string; label: string }
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
  const [scope, setScope] = React.useState<SiftScope>(() => useSearch.getState().scope);
  const [dq, setDq] = React.useState(q);
  const [pinFor, setPinFor] = React.useState<'notes' | 'journal' | null>(null);

  React.useEffect(() => { loadSiftMemory(); }, []);

  // opening again while still leaving: it starts over with what it was opened with
  React.useEffect(() => {
    if (!open) return;
    const s = useSearch.getState();
    setQ(s.query);
    setDq(s.query);
    setScope(s.scope);
  }, [open]);

  /* ---- in and out */
  const fromPull = origin === 'pull';
  React.useEffect(() => {
    if (open) {
      tick();
      const start = fromPull ? Math.max(siftShown.value, 0.25 * siftPull.value) : siftShown.value;
      siftShown.value = start;
      siftShown.value = level === 'none' ? 1 : withTiming(1, { duration: OPEN_MS, easing: EASE_OUT });
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
    siftShown.value = withTiming(0, { duration: CLOSE_MS, easing: EASE_EXIT }, (fin) => { if (fin) runOnJS(done)(); });
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
      filter: (d) => inScope(d.section, scope),
      usage: (k) => memory.uses[k] || 0,
      perSection: scope === 'all' ? 5 : 30,
    });
  }, [dq, scope, sources.rev, restore, memory.uses]);

  const go = React.useCallback((doc: SiftDoc) => {
    rememberOpen({
      key: doc.key, title: doc.title, subtitle: doc.subtitle, icon: doc.payload.icon, color: doc.payload.color, section: doc.section,
    });
    if (dq.trim()) rememberQuery(dq);
    closeSift();
    // the target opens under Sift as it leaves
    requestAnimationFrame(() => doc.payload.open());
  }, [dq]);

  const run = React.useCallback((fn: () => void, remember = true) => {
    if (remember && dq.trim()) rememberQuery(dq);
    closeSift();
    requestAnimationFrame(fn);
  }, [dq]);

  const openRecent = React.useCallback((o: OpenedRef) => {
    const doc = sources.index.get(o.key);
    if (!doc) { forgetOpened(o.key); toast("That isn't here any more"); return; }
    go(doc);
  }, [sources.index, go]);

  // a sum's answer, worked out once per query (mathjs is not free)
  const math = React.useMemo(() => (scope === 'all' && dq.trim() ? quickMath(dq.trim()) : null), [dq, scope]);
  const { index, journalLoading, notesLocked, journalLocked, archived, subjects } = sources;

  const items: Item[] = React.useMemo(() => {
    const out: Item[] = [];
    const query = dq.trim();
    let n = 0;
    const row = (x: Omit<Extract<Item, { t: 'row' }>, 't' | 'index'>) => out.push({ t: 'row', index: n++, ...x });

    if (!query) {
      // nothing typed: what you searched, what you opened, and tools that fit now
      if (scope === 'all' || scope === 'settings') {
        if (memory.recent.length) {
          out.push({ t: 'head', key: 'h-recent', label: 'Recent searches' });
          for (const r of memory.recent) {
            row({
              key: 'recent:' + r, icon: 'time-outline', title: r,
              onPress: () => { setQ(r); setDq(r); }, onRemove: () => forgetQuery(r),
            });
          }
        }
      }
      if (scope === 'all') {
        const opened = memory.opened.filter((o) => index.get(o.key));
        if (opened.length) {
          out.push({ t: 'head', key: 'h-opened', label: 'Recently opened' });
          for (const o of opened) {
            row({ key: 'opened:' + o.key, icon: o.icon, color: o.color, title: o.title, subtitle: o.subtitle || o.section, onPress: () => openRecent(o) });
          }
        }
        const tools = suggestedTools(memory.uses, archived, new Date().getHours());
        if (tools.length) {
          out.push({ t: 'head', key: 'h-suggest', label: 'Suggested' });
          for (const k of tools) {
            const tool = toolByKey(k)!;
            row({
              key: 'suggest:' + k, icon: tool.icon, color: colorOf(tool.colorKey), title: tool.label, subtitle: tool.desc,
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
      return out;
    }

    // a sum: its answer first
    if (scope === 'all') {
      if (math) out.push({ t: 'math', key: 'math', expr: math.expr, answer: math.answer });
      // a day: what it holds
      const d = parseDay(query);
      if (d) out.push({ t: 'day', key: 'day:' + d.key, day: dayCard(d.key, d.date, hour24, journalLocked, archived) });
    }

    if (result?.top && !out.length) out.push({ t: 'top', key: 'top:' + result.top.doc.key, doc: result.top.doc });
    const rest = result ? (out.length && result.top ? [{ section: result.top.doc.section, hits: [result.top], more: 0 }, ...result.sections] : result.sections) : [];
    // a top hit pushed down by a sum or a day joins its own section, at its head
    const merged = new Map<string, { hits: SiftDoc[]; more: number }>();
    for (const sec of rest) {
      const m = merged.get(sec.section) ?? { hits: [], more: 0 };
      for (const h of sec.hits) if (!m.hits.some((x) => x.key === h.doc.key)) m.hits.push(h.doc);
      m.more += sec.more;
      merged.set(sec.section, m);
    }
    for (const [section, { hits, more }] of merged) {
      out.push({ t: 'head', key: 'h:' + section, label: section, more: more || undefined });
      for (const doc of hits) out.push({ t: 'doc', key: doc.key, doc, index: n++ });
    }

    // the journal's texts are still being read
    if (journalLoading && (scope === 'all' || scope === 'journal')) {
      out.push({ t: 'loading', key: 'loading-journal', label: 'Searching the journal…' });
    }

    // locked tools: one row each, to unlock and search them too
    const locks: Item[] = [];
    if (notesLocked && !archived.includes('notes') && (scope === 'all' || scope === 'notes')) {
      locks.push({
        t: 'row', key: 'lock:notes', index: n++, icon: 'lock-closed-outline', color: colorOf('green'),
        title: 'Notes are locked', subtitle: 'Unlock to search them', onPress: () => { Keyboard.dismiss(); setPinFor('notes'); },
      });
    }
    if (journalLocked && !archived.includes('journal') && (scope === 'all' || scope === 'journal')) {
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
    if (scope === 'all' || scope === 'todos' || scope === 'notes') {
      const acts: Item[] = [];
      const clip = query.length > 40 ? query.slice(0, 39).trimEnd() + '…' : query;
      if ((scope === 'all' || scope === 'todos') && !archived.includes('tasks')) {
        acts.push({ t: 'row', key: 'q:todo', index: n++, icon: 'add-circle-outline', color: colorOf(toolByKey('tasks')!.colorKey), title: 'Add “' + clip + '” as a ToDo', onPress: () => run(() => addTodo(query)) });
      }
      if ((scope === 'all' || scope === 'notes') && !archived.includes('notes')) {
        acts.push({ t: 'row', key: 'q:note', index: n++, icon: 'create-outline', color: colorOf(toolByKey('notes')!.colorKey), title: 'New note “' + clip + '”', onPress: () => run(() => newNote(query)) });
      }
      if (scope === 'all') {
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

    if (!result?.total && !out.some((x) => x.t === 'math' || x.t === 'day')) {
      const dym = result?.didYouMean;
      out.unshift({
        t: 'note', key: 'n-none',
        text: scope === 'all' ? 'Nothing matches “' + query + '”.' : 'Nothing in ' + SCOPES.find((x) => x.key === scope)!.label + ' matches “' + query + '”.',
        action: dym ? { label: 'Did you mean “' + dym + '”?', onPress: () => { setQ(dym); setDq(dym); } }
          : scope !== 'all' ? { label: 'Search everything', onPress: () => setScope('all') } : undefined,
      });
    }
    return out;
  }, [dq, scope, result, math, memory, index, journalLoading, notesLocked, journalLocked, archived, subjects, hour24, aiLinks, go, run, openRecent]);

  const onSubmit = () => {
    const first = items.find((x) => x.t === 'math' || x.t === 'top' || x.t === 'doc');
    if (!first) return;
    if (first.t === 'math') run(() => openTool('calculator', { expr: first.expr }));
    else if (first.t === 'top' || first.t === 'doc') go(first.doc);
  };

  /* ---- the panel's motion */
  const panelStyle = useAnimatedStyle(() => ({ opacity: siftShown.value }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: SCRIM * siftShown.value }));
  const fieldStyle = useAnimatedStyle(() => {
    if (level !== 'full') return { opacity: siftShown.value };
    const p = siftShown.value;
    return {
      opacity: p,
      // from a pull it grows out of the header; otherwise it drops in from the top
      transform: fromPull
        ? [{ translateY: -6 * (1 - p) }, { scaleX: 0.86 + 0.14 * p }] as const
        : [{ translateY: -22 * (1 - p) }, { scaleX: 1 }] as const,
    };
  });
  const bodyStyle = useAnimatedStyle(() => ({
    opacity: level === 'none' ? 1 : Math.max(0, (siftShown.value - 0.35) / 0.65),
    transform: [{ translateY: (level === 'full' ? 14 * (1 - siftShown.value) : 0) + drag.value }],
  }));

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
  const layout = level === 'full' ? LinearTransition.duration(220).easing(EASE_OUT) : undefined;
  const exiting = level === 'none' ? undefined : FadeOut.duration(120);

  const sticky = items.map((x, i) => (x.t === 'head' ? i : -1)).filter((i) => i >= 0);

  const renderItem = (x: Item) => {
    switch (x.t) {
      case 'head':
        return <SectionHead label={x.label} theme={theme} more={x.more} />;
      case 'doc':
        return (
          <ResultRow
            icon={x.doc.payload.icon} color={x.doc.payload.color} title={x.doc.title} subtitle={x.doc.subtitle} terms={terms}
            body={x.doc.body} onPress={() => go(x.doc)} theme={theme}
          />
        );
      case 'row':
        return (
          <ResultRow
            icon={x.icon} color={x.color} title={x.title} subtitle={x.subtitle} terms={x.key.startsWith('recent:') || x.key.startsWith('q:') ? [] : terms}
            onPress={x.onPress} onRemove={x.onRemove} theme={theme}
          />
        );
      case 'top': {
        const d = x.doc;
        const snip = d.body ? snippet(d.body, terms) : null;
        return (
          <TopCard kicker="Top hit" theme={theme} onPress={() => go(d)} label={[d.title, d.subtitle].filter(Boolean).join(', ')}>
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
      entering={x.t === 'head' ? undefined : entering('index' in x ? x.index : 0)}
      exiting={exiting}
      layout={x.t === 'head' ? undefined : layout}
    >
      {renderItem(x)}
    </Animated.View>
  )), [items, terms, theme, level]);

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
            <View style={[st.field, fieldWell]}>
              <Ionicons name="search" size={18} color={C.textFaint} />
              <TextInput
                ref={inputRef}
                value={q}
                onChangeText={setQ}
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
            </View>
            <Pressable onPress={closeSift} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel" style={st.cancel}>
              <Text style={[st.cancelText, { color: C.accent }]} maxFontSizeMultiplier={CHROME_FONT_MAX}>Cancel</Text>
            </Pressable>
          </Animated.View>

          <Animated.View style={[{ flex: 1 }, bodyStyle]}>
            {/* scope chips: flat, in one scrolling row */}
            <ScrollView
              horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled"
              contentContainerStyle={st.chips} style={{ flexGrow: 0 }}
            >
              {SCOPES.map((s) => (
                <Chip key={s.key} small label={s.label} active={scope === s.key} onPress={() => setScope(s.key)} style={{ marginRight: 8 }} />
              ))}
            </ScrollView>

            <GestureDetector gesture={listGesture}>
              <Animated.ScrollView
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
  fieldRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: S.pad, paddingBottom: 12 },
  field: { flex: 1, height: 48, borderRadius: 16, flexDirection: 'row', alignItems: 'center', paddingLeft: 14, paddingRight: 6, gap: 8, overflow: 'hidden' },
  input: { flex: 1, color: C.text, fontFamily: F.reg, fontSize: 16, letterSpacing: TRACK.body, paddingVertical: 0 },
  fieldBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  cancel: { marginLeft: 14, height: 44, justifyContent: 'center' },
  cancelText: { fontFamily: F.med, fontSize: 15, letterSpacing: TRACK.body },
  chips: { paddingHorizontal: S.pad, paddingBottom: 14, alignItems: 'center' },
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
