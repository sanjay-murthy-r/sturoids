import React from 'react';
import { Alert, Pressable, ScrollView, SectionList, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { C, F, MIN, NEU, S, T, TRACK, bgFor } from '../theme';
import { useStore, JournalEntry, FocusSession } from '../store';
import { todayKey } from '../utils';
import {
  Card, Chip, DotMenu, EmptyState, Field, GateHeader, Hairline, ListRow, ListSlice, PillButton, Row, ScreenBG, Sheet, useTheme,
  useToolHeader, contextLine,
} from '../components/UI';
import { monthRange, useExport } from '../reports';
import { SegmentedControl } from '../components/SegmentedControl';
import { ToolGate } from '../components/LockGate';
import { JournalCalendar } from '../components/JournalCalendar';
import {
  MOODS, PROMPTS, clearJournalOpenRequest, dayFacts, dayRecord, entryMatches, formatJournalDate, journalDayFor,
  journalStats, keyToDate, loadBodies, moodFocusLink, moodSeries, onThisDay, readBody, requestJournalOpen, searchTokens,
  shiftKey,
} from '../journal';
import { openTool } from '../toolNav';
import { expectAway } from '../lock';
import { tick } from '../haptics';
import { Appear, Bouncy, CountUp, EASE_OUT, useAnimLevel } from '../components/Motion';
import { swapIn } from '../components/Swap';
import { toastTrashed } from '../trashToast';

type Sort = 'newest' | 'oldest' | 'longest' | 'best';
const SORT_LABEL: Record<Sort, string> = { newest: 'Newest', oldest: 'Oldest', longest: 'Longest', best: 'Best days' };
const NEXT_SORT: Record<Sort, Sort> = { newest: 'oldest', oldest: 'longest', longest: 'best', best: 'newest' };
const HEAT_WEEKS = 12;

/** The list the header's scroll offset follows: Reanimated hands the offset to its handler on the UI thread. */
const AnimatedSectionList = Animated.createAnimatedComponent(SectionList) as typeof SectionList;

export function JournalArchiveScreen({ mode }: { mode: 'tab' | 'stack' }) {
  // a page pushed from the journal, in a tab slot or not: it has its back button either way
  return (
    <ToolGate tool="journal" guard={mode === 'tab'} header={<GateHeader title="Journal" tab={false} />}>
      <Archive tabMode={mode === 'tab'} />
    </ToolGate>
  );
}

const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `em`: the face a match is set in, the semibold of the text's own family */
function Highlighted({ text, tokens, style, lines, em = F.semi }: {
  text: string; tokens: string[]; style: any; lines?: number; em?: string;
}) {
  if (!tokens.length) return <Text style={style} numberOfLines={lines}>{text}</Text>;
  const parts = text.split(new RegExp('(' + tokens.map(escapeRe).join('|') + ')', 'ig'));
  return (
    <Text style={style} numberOfLines={lines}>
      {parts.map((p, i) => (i % 2 ? <Text key={i} style={{ color: C.accent, fontFamily: em }}>{p}</Text> : p))}
    </Text>
  );
}

/**
 * What an untitled entry's row is titled with, and how much of the text that title used up. The first sentence is
 * the title, its punctuation kept, and the line under it starts after that sentence, so the row never says it twice.
 * An entry begun from the day's prompt opens with the prompt, so the writer's own first sentence titles it instead,
 * or the prompt itself when nothing follows it yet.
 */
function untitledLead(e: JournalEntry): { title: string; used: string } {
  let text = e.excerpt;
  let skipped = '';
  const prompt = e.promptId ? PROMPTS[Number(e.promptId.slice(1))] : undefined;
  if (prompt && text.startsWith(prompt)) {
    const after = text.slice(prompt.length).trimStart();
    if (!after) return { title: prompt, used: text };
    skipped = text.slice(0, text.length - after.length);
    text = after;
  }
  const m = /^.*?[.!?…]+(?=\s|$)/.exec(text);
  const sentence = m ? m[0] : text;
  return { title: sentence.trim(), used: skipped + sentence };
}

/**
 * One entry in the archive, memoised: a filter or a pin re-renders the rows that changed, not every row. Its meta line
 * says the words and tags, then what the day held (`day`: "3 done · 2/3 habits · 45 min"), each part only when there is one.
 */
const EntryRow = React.memo(function EntryRow({ e, first, last, enter, tokens, snippet, day, well, dip, onOpen, onMenu }: {
  e: JournalEntry; first: boolean; last: boolean; enter: boolean; tokens: string[]; snippet: string; day: string;
  well: object; dip: SharedValue<number>; onOpen: (dateKey: string, id?: string) => void; onMenu: (e: JournalEntry) => void;
}) {
  useTheme(); // a memo row: its search matches follow a new accent, which its props never carry
  const d = keyToDate(e.dateKey);
  const moodIcon = MOODS.find((m) => m.value === e.mood)?.icon;
  const lead = e.title ? null : untitledLead(e);
  const shown = lead && snippet.startsWith(lead.used) ? snippet.slice(lead.used.length).trimStart() : snippet;
  // the words and the tags; an entry with neither (a mood alone) states no count of nothing
  const caption = [
    [
      e.wordCount ? e.wordCount + (e.wordCount === 1 ? ' word' : ' words') : '',
      e.tags.map((t) => '#' + t).join(' '),
    ].filter(Boolean).join(', '),
    day,
  ].filter(Boolean).join(' · ');
  const dipStyle = useAnimatedStyle(() => ({ opacity: dip.value }));
  // settled as the row mounts: a row of the first screenful rises with the page, and the parent's later renders (which
  // pass false once the page is built) never take that back before it has played
  const [rise] = React.useState(enter);
  return (
    <ListSlice first={first} last={last} enter={rise}>
      <Animated.View style={dipStyle}>
        <ListRow onPress={() => onOpen(e.dateKey, e.id)} onLongPress={() => { tick(); onMenu(e); }} style={st.entry}>
          <View style={[st.dayWell, well]}>
            <Text style={st.dayName}>{d.toLocaleDateString('en-IN', { weekday: 'short' })}</Text>
            <Text style={st.dayNum}>{d.getDate()}</Text>
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Row>
              <Highlighted text={e.title || lead?.title || 'Untitled'} tokens={tokens} style={[T.title, { flex: 1 }]} lines={1} />
              {e.pinned ? <Ionicons name="pin" size={14} color={C.gold} style={{ marginLeft: 6 }} /> : null}
              {moodIcon ? <Ionicons name={moodIcon as any} size={15} color={C.gold} style={{ marginLeft: 6 }} /> : null}
              {e.rating ? (
                <View style={st.rate}>
                  <Ionicons name="star" size={12} color={C.gold} />
                  <Text style={st.rateText}>{e.rating}</Text>
                </View>
              ) : null}
            </Row>
            {shown ? <Highlighted text={shown} tokens={tokens} style={st.excerpt} lines={2} em={F.smSemi} /> : null}
            {caption ? <Text style={[T.caption, { marginTop: 6 }]} numberOfLines={2}>{caption}</Text> : null}
          </View>
        </ListRow>
      </Animated.View>
    </ListSlice>
  );
});

function Archive({ tabMode }: { tabMode: boolean }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const theme = useTheme();
  const level = useAnimLevel();
  const journal = useStore((s) => s.journal);
  const journalTags = useStore((s) => s.journalTags);
  const cutoff = useStore((s) => s.settings.journalCutoffHour);
  const patchJournalEntry = useStore((s) => s.patchJournalEntry);
  // what each entry's day held, for its meta line; an archived tool says nothing, as on Today
  const archivedTools = useStore((s) => s.settings.archivedTools);
  const doneLog = useStore((s) => s.doneLog);
  const habits = useStore((s) => s.habits);
  const sessions = useStore((s) => s.sessions);
  const dayLines = React.useMemo(() => {
    const off = new Set<string>(archivedTools || []);
    const byDay = new Map<string, FocusSession[]>();
    if (!off.has('focus')) {
      for (const x of sessions) {
        const list = byDay.get(x.dateKey);
        if (list) list.push(x);
        else byDay.set(x.dateKey, [x]);
      }
    }
    const out = new Map<string, string>();
    for (const key of new Set(journal.map((e) => e.dateKey))) {
      const r = dayRecord(key, off.has('tasks') ? undefined : doneLog[key], off.has('planner') ? [] : habits, byDay.get(key) || []);
      const line = dayFacts(r, true).map((f) => f.text).join(' · ');
      if (line) out.set(key, line);
    }
    return out;
  }, [journal, doneLog, habits, sessions, archivedTools]);

  const [q, setQ] = React.useState('');
  const [bodies, setBodies] = React.useState<Map<string, string> | null>(null);
  const [month, setMonth] = React.useState<string | null>(null); // 'YYYY-MM'
  const [moods, setMoods] = React.useState<number[]>([]);
  const [ratings, setRatings] = React.useState<number[]>([]);
  const [tags, setTags] = React.useState<string[]>([]);
  const [pinnedOnly, setPinnedOnly] = React.useState(false);
  const [sort, setSort] = React.useState<Sort>('newest');
  const [stats, setStats] = React.useState(false);
  const [filters, setFilters] = React.useState(false);
  const [menu, setMenu] = React.useState<JournalEntry | null>(null);
  const [moveEntry, setMoveEntry] = React.useState<JournalEntry | null>(null);

  // Arrivals: Sift opens the archive on one tag (`tag`), as the only filter. The param is cleared once followed, so the
  // same link works again
  const params = useLocalSearchParams<{ tag?: string; from?: string }>();
  const fromJournal = params.from === 'journal';
  useFocusEffect(React.useCallback(() => {
    const t = params.tag;
    if (!t) return;
    setMonth(null); setMoods([]); setRatings([]); setPinnedOnly(false); setQ('');
    setTags(useStore.getState().journalTags.includes(t) ? [t] : []);
    router.setParams({ tag: undefined } as any);
  }, [params.tag]));

  // the first screenful rises as one card; rows that mount later (scrolling, filtering) appear at once
  const firstPaint = React.useRef(true);
  React.useEffect(() => { firstPaint.current = false; }, []);

  // typing stays immediate; the search over every entry runs on the settled text
  const settledQ = React.useDeferredValue(q);
  const tokens = React.useMemo(() => searchTokens(settledQ), [settledQ]);

  // full-text search reads every entry's text once, then stays in memory
  React.useEffect(() => {
    if (!tokens.length || bodies) return;
    let live = true;
    loadBodies(journal.map((e) => e.id)).then((m) => { if (live) setBodies(m); });
    return () => { live = false; };
  }, [tokens.length, bodies, journal]);
  React.useEffect(() => { setBodies(null); }, [journal]);

  const visible = React.useMemo(() => {
    const out = journal.filter((e) =>
      (!month || e.dateKey.startsWith(month))
      && (!moods.length || (e.mood != null && moods.includes(e.mood)))
      && (!ratings.length || (e.rating != null && ratings.includes(e.rating)))
      && (!tags.length || tags.every((t) => e.tags.includes(t)))
      && (!pinnedOnly || e.pinned)
      && entryMatches(e, bodies?.get(e.id), tokens));
    const newest = (a: JournalEntry, b: JournalEntry) => b.dateKey.localeCompare(a.dateKey) || b.createdAt - a.createdAt;
    return out.sort((a, b) =>
      sort === 'longest' ? b.wordCount - a.wordCount
        : sort === 'best' ? (b.rating ?? 0) - (a.rating ?? 0) || newest(a, b)
          : sort === 'oldest' ? a.dateKey.localeCompare(b.dateKey) || a.createdAt - b.createdAt
            : newest(a, b));
  }, [journal, month, moods, ratings, tags, pinnedOnly, tokens, bodies, sort]);

  const sections = React.useMemo(() => {
    // ranked orders are one list: month headings would repeat as the dates jump about
    if (sort === 'longest' || sort === 'best') {
      return visible.length ? [{ title: sort === 'best' ? 'Best days first' : 'Longest first', data: visible }] : [];
    }
    const groups: { title: string; data: JournalEntry[] }[] = [];
    for (const e of visible) {
      const title = keyToDate(e.dateKey).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
      const last = groups[groups.length - 1];
      if (last && last.title === title) last.data.push(e);
      else groups.push({ title, data: [e] });
    }
    return groups;
  }, [visible, sort]);

  const months = React.useMemo(() => {
    const counts = new Map<string, number>();
    journal.forEach((e) => counts.set(e.dateKey.slice(0, 7), (counts.get(e.dateKey.slice(0, 7)) || 0) + 1));
    return [...counts.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [journal]);

  const filterCount = (month ? 1 : 0) + moods.length + ratings.length + tags.length;
  const summary = [
    month ? keyToDate(month + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) : '',
    moods.length ? moods.map((m) => MOODS.find((x) => x.value === m)?.label).join(', ') : '',
    ratings.length ? [...ratings].sort((a, b) => b - a).map((r) => r + (r === 1 ? ' star' : ' stars')).join(', ') : '',
    tags.length ? tags.length + (tags.length === 1 ? ' tag' : ' tags') : '',
    pinnedOnly ? 'pinned' : '',
  ].filter(Boolean).join(', ');
  // the count only when there is one to give: an empty list's own note says that nothing matches
  const filterLine = [visible.length ? visible.length + (visible.length === 1 ? ' entry' : ' entries') : '', summary]
    .filter(Boolean).join(', ');
  const clearAll = () => { setMonth(null); setMoods([]); setRatings([]); setTags([]); setPinnedOnly(false); setQ(''); };

  // One open per visit: a second tap on the way out would step back past the Journal too. A request the Journal never
  // took (the archive left some other way) is dropped once the archive has gone, after the Journal has had its moment
  // to take it, so it never takes the Journal over later
  const sent = React.useRef<ReturnType<typeof requestJournalOpen> | null>(null);
  const open = React.useCallback((dateKey: string, id?: string) => {
    if (sent.current) return;
    tick();
    sent.current = requestJournalOpen(dateKey, id);
    // back only when the Journal is the page underneath (it opened the archive); from Sift or a link the archive stands
    // alone, and back would land somewhere else
    if (fromJournal && router.canGoBack()) router.back();
    else openTool('journal');
  }, [router, fromJournal]);
  React.useEffect(() => () => {
    const req = sent.current;
    if (req) setTimeout(() => clearJournalOpenRequest(req), 1500);
  }, []);
  // an archive still standing when it comes back into view (it was left by the Journal's own path) is a new visit
  useFocusEffect(React.useCallback(() => { sent.current = null; }, []));
  const openMenu = React.useCallback((e: JournalEntry) => setMenu(e), []);

  // a new filter or order is a different list: its rows come up from a faint start together, so the change reads as
  // one step instead of rows jumping about. A search narrows as it is typed, so it answers at once, with no dip
  const listKey = [month, moods.join(), ratings.join(), tags.join(), pinnedOnly, sort].join('|');
  const dip = useSharedValue(1);
  const shownList = React.useRef(listKey);
  React.useEffect(() => {
    if (shownList.current === listKey) return;
    shownList.current = listKey;
    if (level === 'none') return;
    dip.value = 0.3;
    dip.value = withTiming(1, { duration: level === 'full' ? 240 : 180, easing: EASE_OUT });
  }, [listKey, level]);

  const snippet = (e: JournalEntry) => {
    const text = bodies?.get(e.id);
    if (!tokens.length || !text) return e.excerpt;
    const low = text.toLowerCase();
    const at = Math.min(...tokens.map((t) => { const i = low.indexOf(t); return i < 0 ? Infinity : i; }));
    if (!isFinite(at) || at < 80) return text.replace(/\s+/g, ' ').slice(0, 200);
    // a little before the match, from the start of a word
    let from = at - 60;
    while (from > 0 && !/\s/.test(text[from - 1])) from--;
    return '…' + text.slice(from, at + 160).replace(/\s+/g, ' ');
  };

  const shareEntry = async (e: JournalEntry) => {
    const body = await readBody(e.id);
    // the share sheet takes the app out of view; coming back from it never locks the journal
    expectAway(() => Share.share({ message: [formatJournalDate(e.dateKey), e.title, body.trim()].filter(Boolean).join('\n\n') }))
      .catch(() => {});
  };
  const confirmDelete = (e: JournalEntry) => {
    Alert.alert('Delete this entry?', 'You can restore it from Recently deleted for 30 days.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { toastTrashed(useStore.getState().trashJournalEntry(e.id)); } },
    ]);
  };

  const s = React.useMemo(() => journalStats(journal, cutoff), [journal, cutoff]);
  const today = todayKey();
  const echoes = React.useMemo(() => onThisDay(journal, today), [journal, today]);
  const heat = React.useMemo(() => {
    const words = new Map<string, number>();
    journal.forEach((e) => words.set(e.dateKey, (words.get(e.dateKey) || 0) + e.wordCount + 1));
    const now = keyToDate(today);
    const monday = shiftKey(today, -((now.getDay() + 6) % 7));
    return Array.from({ length: HEAT_WEEKS }, (_, w) =>
      Array.from({ length: 7 }, (__, d) => {
        const key = shiftKey(monday, (w - HEAT_WEEKS + 1) * 7 + d);
        return { key, words: key > today ? -1 : words.get(key) || 0 };
      }));
  }, [journal, today]);

  const well = React.useMemo(
    () => (theme === 'minimal' ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border } : { backgroundColor: C.inset, ...NEU.insetLow }),
    [theme],
  );
  const marked = React.useMemo(() => new Set(journal.map((e) => e.dateKey)), [journal]);
  // a stat of zero says nothing, so it is left out rather than shown as a nought
  const glances = [
    { value: s.days, label: s.days === 1 ? 'day' : 'days' },
    { value: s.current, label: 'day streak' },
    { value: s.best, label: 'best streak' },
    { value: s.words, label: 'words' },
  ].filter((g) => g.value > 0);
  // the last 30 days, each with its mood and its rating, for the strip; built only while the stats are open
  const series = React.useMemo(() => (stats ? moodSeries(journal, 30, today) : []), [stats, journal, today]);
  const anyMood = series.some((d) => d.mood != null || d.rating != null);
  // one line on good days and focus, once there are enough of each to say it honestly (and Deep Work is in use)
  const focusOff = (archivedTools || []).includes('focus');
  const link = React.useMemo(
    () => (stats && !focusOff ? moodFocusLink(journal, sessions, 60, today) : null),
    [stats, focusOff, journal, sessions, today],
  );
  const linkLine = link
    ? link.goodMin - link.otherMin >= 10
      ? 'On your best days you focused about ' + link.goodMin + ' min, against ' + link.otherMin + ' on the others.'
      : link.otherMin - link.goodMin >= 10
        ? 'Your best days came with less focus: about ' + link.goodMin + ' min, against ' + link.otherMin + ' on the others.'
        : 'You focused about as much on your best days as on the others.'
    : '';

  // what is in the archive, or in the month picked: the search and the other filters are said under the chips, so the
  // header's count does not change with every letter typed. No entries, no line
  const inMonth = React.useMemo(() => (month ? journal.filter((e) => e.dateKey.startsWith(month)).length : 0), [journal, month]);
  const counted = month ? inMonth : journal.length;
  // the month picked, or the whole archive
  const exp = useExport('journal', () => (month ? { range: 'custom', ...monthRange(month, todayKey()) } : { range: 'all' }));
  const tool = useToolHeader({
    title: 'Journal',
    mode: 'page',
    context: contextLine(
      month && [{ em: keyToDate(month + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) }],
      counted > 0 && counted + (counted === 1 ? ' entry' : ' entries'),
    ),
    // with nothing in the archive the stats have nothing to show, so no button offers them
    actions: journal.length ? [{
      icon: stats ? 'stats-chart' : 'stats-chart-outline',
      label: stats ? 'Hide stats' : 'Show stats',
      color: stats ? C.gold : undefined,
      onPress: () => setStats(!stats),
    }, exp.action] : undefined,
  });

  const listHead = (
    <View>
      {tool.hero}
      <Field value={q} onChangeText={setQ} placeholder="Search entries" autoCapitalize="none" returnKeyType="search" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -6 }} contentContainerStyle={{ paddingHorizontal: 6, paddingVertical: 12 }}>
        <Chip icon="options-outline" label={filterCount ? 'Filters ' + filterCount : 'Filters'} active={filterCount > 0} onPress={() => setFilters(true)} />
        <Chip icon="pin-outline" label="Pinned" active={pinnedOnly} onPress={() => setPinnedOnly(!pinnedOnly)} />
        <Chip icon="swap-vertical-outline" label={SORT_LABEL[sort]} onPress={() => setSort(NEXT_SORT[sort])} />
      </ScrollView>
      {summary || tokens.length ? (
        // the line that counts the entries and offers Clear fades in where it appears, once a filter is on
        <Appear>
          <Row style={{ justifyContent: 'space-between', marginTop: -4, marginBottom: 10 }}>
            <Text style={[T.caption, { flex: 1 }]} numberOfLines={1}>
              {filterLine.charAt(0).toUpperCase() + filterLine.slice(1)}
            </Text>
            <Bouncy onPress={clearAll} scaleTo={0.92} radius={8} hitSlop={13} accessibilityRole="button" style={st.linkBox}>
              <Text style={[st.link, { color: C.accent }]}>Clear</Text>
            </Bouncy>
          </Row>
        </Appear>
      ) : null}
      {stats && journal.length ? (
        // the stats open where they stand, rising a short way in; they sit above the list, so they never cover a row
        <Animated.View entering={swapIn(level)}>
        <Card pad={16}>
          <Row>
            {glances.map((g, i) => (
              <React.Fragment key={g.label}>
                {i > 0 ? <View style={st.vDivider} /> : null}
                <Glance value={g.value} label={g.label} />
              </React.Fragment>
            ))}
          </Row>
          {s.avgRating != null ? (
            <Text style={[T.caption, { textAlign: 'center', marginTop: 12 }]}>
              Average day {s.avgRating.toFixed(1)} of 5  ·  {s.ratedDays} rated {s.ratedDays === 1 ? 'day' : 'days'}
            </Text>
          ) : null}
          {anyMood ? (
            <View style={{ marginTop: 16 }} accessible accessibilityLabel="Mood and rating over the last 30 days">
              <Text style={T.kicker}>Last 30 days</Text>
              <View style={st.strip}>
                {series.map((d) => {
                  const v = d.rating ?? d.mood;
                  return (
                    <View key={d.dateKey} style={st.stripCol}>
                      {v != null ? (
                        <View
                          style={[st.stripBar, {
                            height: 6 + (v - 1) * 6, backgroundColor: C.gold, opacity: d.rating != null ? 0.35 + v * 0.13 : 0.3,
                          }]}
                        />
                      ) : (
                        <View style={[st.stripDot, { backgroundColor: theme === 'minimal' ? MIN.hairline : C.hairline }]} />
                      )}
                    </View>
                  );
                })}
              </View>
              <Text style={[T.caption, { marginTop: 6 }]}>Taller for a better day; fainter where only a mood was set</Text>
            </View>
          ) : null}
          {linkLine ? <Text style={[T.caption, { marginTop: 12, color: C.textDim }]}>{linkLine}</Text> : null}
          <View style={st.heat}>
            {heat.map((week, w) => (
              <View key={w} style={{ gap: 3 }}>
                {week.map((d) => (
                  <View
                    key={d.key}
                    style={[
                      st.heatCell,
                      d.words < 0 ? { opacity: 0 } : d.words === 0 ? { backgroundColor: theme === 'minimal' ? MIN.hairline : C.hairline }
                        : { backgroundColor: C.gold, opacity: d.words < 150 ? 0.3 : d.words < 400 ? 0.6 : 1 },
                    ]}
                  />
                ))}
              </View>
            ))}
          </View>
          {echoes.length ? (
            <View style={{ marginTop: 14 }}>
              <Text style={T.kicker}>On this day</Text>
              {/* each line is a row a finger can find, not a strip of small text */}
              {echoes.slice(0, 3).map((e) => (
                <Pressable key={e.id} onPress={() => open(e.dateKey, e.id)} accessibilityRole="button" style={st.echoRow}>
                  <Text style={st.echo} numberOfLines={1}>
                    {formatJournalDate(e.dateKey)}: {e.title || e.excerpt || 'Untitled'}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </Card>
        </Animated.View>
      ) : null}
    </View>
  );

  const empty = journal.length === 0 ? (
    <EmptyState icon="journal-outline" title="Your first page is waiting" actionLabel="Write today" onAction={() => open(journalDayFor(new Date(), cutoff))} />
  ) : !filterCount && !pinnedOnly ? (
    // only the search is narrowing the list, so the note speaks of the search
    <EmptyState icon="search-outline" title="Nothing matches that search" actionLabel="Clear search" onAction={clearAll} />
  ) : (
    <EmptyState icon="search-outline" title="Nothing matches those filters" actionLabel="Clear filters" onAction={clearAll} />
  );

  return (
    <ScreenBG>
      {tool.bar}
      <AnimatedSectionList
        sections={sections}
        keyExtractor={(e) => e.id}
        stickySectionHeadersEnabled
        keyboardShouldPersistTaps="handled"
        {...tool.scrollProps}
        ListHeaderComponent={listHead}
        ListEmptyComponent={empty}
        contentContainerStyle={{ padding: S.pad, paddingTop: tool.padTop, paddingBottom: 40 + (tabMode ? 0 : insets.bottom) }}
        renderSectionHeader={({ section }) => <Text style={[st.section, { backgroundColor: bgFor(theme) }]}>{section.title}</Text>}
        renderItem={({ item: e, index, section }) => (
          <EntryRow
            e={e} first={index === 0} last={index === section.data.length - 1} enter={firstPaint.current}
            tokens={tokens} snippet={snippet(e)} day={dayLines.get(e.dateKey) || ''} well={well} dip={dip}
            onOpen={open} onMenu={openMenu}
          />
        )}
      />

      <Sheet visible={filters} onClose={() => setFilters(false)} title="Filters">
        <Text style={st.sheetLabel}>Month</Text>
        <Row style={{ flexWrap: 'wrap' }}>
          <Chip small label="Any" active={!month} onPress={() => setMonth(null)} />
          {months.map(([m, n]) => (
            <Chip
              key={m} small active={month === m} onPress={() => setMonth(month === m ? null : m)}
              label={keyToDate(m + '-01').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) + ' · ' + n}
            />
          ))}
        </Row>
        <Hairline />
        <Text style={st.sheetLabel}>Mood</Text>
        <Row style={{ flexWrap: 'wrap' }}>
          {MOODS.map((m) => (
            <Chip
              key={m.value} small icon={m.icon} label={m.label} color={C.gold} active={moods.includes(m.value)}
              onPress={() => setMoods(moods.includes(m.value) ? moods.filter((x) => x !== m.value) : [...moods, m.value])}
            />
          ))}
        </Row>
        <Hairline />
        <Text style={st.sheetLabel}>Rating</Text>
        <Row style={{ flexWrap: 'wrap' }}>
          {[5, 4, 3, 2, 1].map((r) => (
            <Chip
              key={r} small icon="star" label={String(r)} color={C.gold} active={ratings.includes(r)}
              onPress={() => setRatings(ratings.includes(r) ? ratings.filter((x) => x !== r) : [...ratings, r])}
            />
          ))}
        </Row>
        {journalTags.length ? (
          <>
            <Hairline />
            <Text style={st.sheetLabel}>Tags</Text>
            <Row style={{ flexWrap: 'wrap' }}>
              {journalTags.map((t) => (
                <Chip key={t} small label={t} color={C.gold} active={tags.includes(t)} onPress={() => setTags(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t])} />
              ))}
            </Row>
          </>
        ) : null}
        <Hairline />
        <Text style={st.sheetLabel}>Sort</Text>
        <SegmentedControl
          size="sm" stretch value={sort} onChange={(k) => setSort(k as Sort)}
          options={[{ key: 'newest', label: 'Newest' }, { key: 'oldest', label: 'Oldest' }, { key: 'longest', label: 'Longest' }, { key: 'best', label: 'Best' }]}
        />
        <PillButton label="Show entries" onPress={() => setFilters(false)} style={{ marginTop: 16 }} />
      </Sheet>

      <DotMenu
        visible={!!menu}
        onClose={() => setMenu(null)}
        items={menu ? [
          { label: 'Open', icon: 'journal-outline', onPress: () => open(menu.dateKey, menu.id) },
          { label: menu.pinned ? 'Unpin' : 'Pin', icon: menu.pinned ? 'pin' : 'pin-outline', onPress: () => patchJournalEntry(menu.id, { pinned: !menu.pinned }) },
          { label: 'Change day', icon: 'calendar-outline', onPress: () => setMoveEntry(menu) },
          { label: 'Share as text', icon: 'share-outline', onPress: () => shareEntry(menu) },
          { label: 'Delete entry', icon: 'trash-outline', color: C.danger, onPress: () => confirmDelete(menu) },
        ] : []}
      />

      <Sheet visible={!!moveEntry} onClose={() => setMoveEntry(null)} title="Move to which day?">
        {moveEntry ? (
          <JournalCalendar
            value={moveEntry.dateKey}
            maxKey={today}
            marked={marked}
            onPick={(key) => { patchJournalEntry(moveEntry.id, { dateKey: key }); setMoveEntry(null); }}
          />
        ) : null}
      </Sheet>
      {exp.sheet}
    </ScreenBG>
  );
}

const fmtCount = (n: number) => n.toLocaleString('en-IN');

function Glance({ value, label }: { value: number; label: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      {/* a figure that changes while the stats are open counts to its new value */}
      <CountUp value={value} format={fmtCount} style={st.glanceValue} />
      <Text style={st.glanceLabel}>{label}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  link: { fontFamily: F.semi, fontSize: 13, letterSpacing: TRACK.small },
  linkBox: { marginLeft: 12, paddingHorizontal: 2 },
  rate: { flexDirection: 'row', alignItems: 'center', marginLeft: 6 },
  rateText: { color: C.gold, fontFamily: F.semi, fontSize: 12, letterSpacing: TRACK.fine, marginLeft: 2, fontVariant: ['tabular-nums'] },
  // a sticky month spans the whole width, so the card's side shadows pass under it instead of beside it
  section: {
    ...T.kicker, marginHorizontal: -S.pad, paddingHorizontal: S.pad, paddingTop: 14, paddingBottom: 8,
  },
  entry: { alignItems: 'flex-start', paddingVertical: 14 },
  dayWell: { width: 46, paddingVertical: 7, borderRadius: 14, alignItems: 'center' },
  dayName: { color: C.textFaint, fontFamily: F.smSemi, fontSize: 11, letterSpacing: TRACK.fine },
  dayNum: { color: C.text, fontFamily: F.bold, fontSize: 18, letterSpacing: TRACK.title, fontVariant: ['tabular-nums'], marginTop: 1 },
  excerpt: { color: C.textDim, fontFamily: F.sm, fontSize: 13, letterSpacing: TRACK.small, lineHeight: 19, marginTop: 4 },
  vDivider: { width: StyleSheet.hairlineWidth, backgroundColor: C.hairline, alignSelf: 'stretch' },
  glanceValue: { ...T.numStat, color: C.gold },
  glanceLabel: { color: C.textFaint, fontFamily: F.smMed, fontSize: 11, marginTop: 3, letterSpacing: TRACK.fine },
  heat: { flexDirection: 'row', gap: 3, justifyContent: 'center', marginTop: 16 },
  heatCell: { width: 12, height: 12, borderRadius: 3 },
  // 30 thin columns sharing the card's width, bars standing on one base line
  strip: { flexDirection: 'row', alignItems: 'flex-end', height: 32, marginTop: 10, gap: 2 },
  stripCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: 32 },
  stripBar: { width: '100%', maxWidth: 7, borderRadius: 2 },
  stripDot: { width: 4, height: 4, borderRadius: 2 },

  echo: { color: C.textDim, fontFamily: F.sm, fontSize: 13, letterSpacing: TRACK.small },
  echoRow: { minHeight: 44, justifyContent: 'center' },
  sheetLabel: { ...T.label, marginTop: 10, marginBottom: 8 },
});
