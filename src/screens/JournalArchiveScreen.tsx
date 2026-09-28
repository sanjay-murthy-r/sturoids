import React from 'react';
import { Alert, ScrollView, SectionList, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { C, F, MIN, NEU, S, T, bgFor } from '../theme';
import { useStore, JournalEntry } from '../store';
import { todayKey } from '../utils';
import {
  Card, Chip, DotMenu, EmptyState, Field, Hairline, IconBtn, ListRow, ListSlice, NeuHeader, PillButton, Row, ScreenBG, Sheet, useTheme,
} from '../components/UI';
import { SegmentedControl } from '../components/SegmentedControl';
import { ToolGate } from '../components/LockGate';
import { JournalCalendar } from '../components/JournalCalendar';
import {
  MOODS, deleteEntry, entryMatches, formatJournalDate, journalDayFor, journalStats, keyToDate, loadBodies, onThisDay,
  readBody, requestJournalOpen, searchTokens, shiftKey,
} from '../journal';
import { openTool } from '../toolNav';
import { tick } from '../haptics';
import { Bouncy, CountUp, EASE_OUT, riseIn, useAnimLevel } from '../components/Motion';

type Sort = 'newest' | 'oldest' | 'longest' | 'best';
const SORT_LABEL: Record<Sort, string> = { newest: 'Newest', oldest: 'Oldest', longest: 'Longest', best: 'Best days' };
const NEXT_SORT: Record<Sort, Sort> = { newest: 'oldest', oldest: 'longest', longest: 'best', best: 'newest' };
const HEAT_WEEKS = 12;

export function JournalArchiveScreen({ mode }: { mode: 'tab' | 'stack' }) {
  return (
    <ToolGate tool="journal" guard={mode === 'tab'} header={<NeuHeader title="Journal" />}>
      <Archive tabMode={mode === 'tab'} />
    </ToolGate>
  );
}

const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function Highlighted({ text, tokens, style, lines }: { text: string; tokens: string[]; style: any; lines?: number }) {
  if (!tokens.length) return <Text style={style} numberOfLines={lines}>{text}</Text>;
  const parts = text.split(new RegExp('(' + tokens.map(escapeRe).join('|') + ')', 'ig'));
  return (
    <Text style={style} numberOfLines={lines}>
      {parts.map((p, i) => (i % 2 ? <Text key={i} style={{ color: C.accent, fontFamily: F.semi }}>{p}</Text> : p))}
    </Text>
  );
}

/** One entry in the archive, memoised: a filter or a pin re-renders the rows that changed, not every row. */
const EntryRow = React.memo(function EntryRow({ e, first, last, enter, tokens, snippet, well, dip, onOpen, onMenu }: {
  e: JournalEntry; first: boolean; last: boolean; enter: boolean; tokens: string[]; snippet: string; well: object;
  dip: SharedValue<number>; onOpen: (dateKey: string, id?: string) => void; onMenu: (e: JournalEntry) => void;
}) {
  useTheme(); // a memo row: its search matches follow a new accent, which its props never carry
  const d = keyToDate(e.dateKey);
  const moodIcon = MOODS.find((m) => m.value === e.mood)?.icon;
  // the words and the tags; an entry with neither (a mood alone) states no count of nothing
  const caption = [
    e.wordCount ? e.wordCount + (e.wordCount === 1 ? ' word' : ' words') : '',
    e.tags.map((t) => '#' + t).join(' '),
  ].filter(Boolean).join(', ');
  const dipStyle = useAnimatedStyle(() => ({ opacity: dip.value }));
  return (
    <ListSlice first={first} last={last} enter={enter}>
      <Animated.View style={dipStyle}>
        <ListRow onPress={() => onOpen(e.dateKey, e.id)} onLongPress={() => { tick(); onMenu(e); }} style={st.entry}>
          <View style={[st.dayWell, well]}>
            <Text style={st.dayName}>{d.toLocaleDateString('en-IN', { weekday: 'short' })}</Text>
            <Text style={st.dayNum}>{d.getDate()}</Text>
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Row>
              <Highlighted text={e.title || e.excerpt.split(/[.!?\n]/)[0] || 'Untitled'} tokens={tokens} style={[T.title, { flex: 1 }]} lines={1} />
              {e.pinned ? <Ionicons name="pin" size={14} color={C.gold} style={{ marginLeft: 6 }} /> : null}
              {moodIcon ? <Ionicons name={moodIcon as any} size={15} color={C.gold} style={{ marginLeft: 6 }} /> : null}
              {e.rating ? (
                <View style={st.rate}>
                  <Ionicons name="star" size={12} color={C.gold} />
                  <Text style={st.rateText}>{e.rating}</Text>
                </View>
              ) : null}
            </Row>
            {e.excerpt ? <Highlighted text={snippet} tokens={tokens} style={st.excerpt} lines={2} /> : null}
            {caption ? <Text style={[T.caption, { marginTop: 6 }]} numberOfLines={1}>{caption}</Text> : null}
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
  const clearAll = () => { setMonth(null); setMoods([]); setRatings([]); setTags([]); setPinnedOnly(false); setQ(''); };

  const open = React.useCallback((dateKey: string, id?: string) => {
    tick();
    requestJournalOpen(dateKey, id);
    if (router.canGoBack()) router.back();
    else openTool('journal');
  }, [router]);
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
    dip.value = withTiming(1, { duration: 240, easing: EASE_OUT });
  }, [listKey, level]);

  const snippet = (e: JournalEntry) => {
    const text = bodies?.get(e.id);
    if (!tokens.length || !text) return e.excerpt;
    const low = text.toLowerCase();
    const at = Math.min(...tokens.map((t) => { const i = low.indexOf(t); return i < 0 ? Infinity : i; }));
    if (!isFinite(at) || at < 80) return text.replace(/\s+/g, ' ').slice(0, 200);
    return '...' + text.slice(at - 60, at + 160).replace(/\s+/g, ' ');
  };

  const shareEntry = async (e: JournalEntry) => {
    const body = await readBody(e.id);
    Share.share({ message: [formatJournalDate(e.dateKey), e.title, body.trim()].filter(Boolean).join('\n\n') });
  };
  const confirmDelete = (e: JournalEntry) => {
    Alert.alert('Delete this entry?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { deleteEntry(e.id); } },
    ]);
  };

  const s = React.useMemo(() => journalStats(journal), [journal]);
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
    { value: s.entries, label: 'entries' },
    { value: s.current, label: 'day streak' },
    { value: s.words, label: 'words' },
  ].filter((g) => g.value > 0);

  const header = (
    <View>
      <Field value={q} onChangeText={setQ} placeholder="Search entries" autoCapitalize="none" returnKeyType="search" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -6 }} contentContainerStyle={{ paddingHorizontal: 6, paddingVertical: 12 }}>
        <Chip icon="options-outline" label={filterCount ? 'Filters ' + filterCount : 'Filters'} active={filterCount > 0} onPress={() => setFilters(true)} />
        <Chip icon="pin-outline" label="Pinned" active={pinnedOnly} onPress={() => setPinnedOnly(!pinnedOnly)} />
        <Chip icon="swap-vertical-outline" label={SORT_LABEL[sort]} onPress={() => setSort(NEXT_SORT[sort])} />
      </ScrollView>
      {summary || tokens.length ? (
        <Row style={{ justifyContent: 'space-between', marginTop: -4, marginBottom: 10 }}>
          <Text style={[T.caption, { flex: 1 }]} numberOfLines={1}>
            {visible.length} {visible.length === 1 ? 'entry' : 'entries'}{summary ? ', ' + summary : ''}
          </Text>
          <Bouncy onPress={clearAll} scaleTo={0.92} radius={8} hitSlop={8} accessibilityRole="button" style={st.linkBox}>
            <Text style={[st.link, { color: C.accent }]}>Clear</Text>
          </Bouncy>
        </Row>
      ) : null}
      {stats && journal.length ? (
        // the stats open where they stand, rising a short way in; they sit above the list, so they never cover a row
        <Animated.View entering={level === 'none' ? undefined : riseIn}>
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
              {echoes.slice(0, 3).map((e) => (
                <Text key={e.id} style={st.echo} numberOfLines={1} onPress={() => open(e.dateKey, e.id)}>
                  {formatJournalDate(e.dateKey)}: {e.title || e.excerpt || 'Untitled'}
                </Text>
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
  ) : (
    <EmptyState icon="search-outline" title="Nothing matches those filters" actionLabel="Clear filters" onAction={clearAll} />
  );

  return (
    <ScreenBG>
      <NeuHeader
        title="Journal"
        right={<IconBtn name={stats ? 'stats-chart' : 'stats-chart-outline'} color={stats ? C.gold : C.textDim} onPress={() => setStats(!stats)} accessibilityLabel={stats ? 'Hide stats' : 'Show stats'} />}
      />
      <SectionList
        sections={sections}
        keyExtractor={(e) => e.id}
        stickySectionHeadersEnabled
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        contentContainerStyle={{ padding: S.pad, paddingTop: 8, paddingBottom: 40 + (tabMode ? 0 : insets.bottom) }}
        renderSectionHeader={({ section }) => <Text style={[st.section, { backgroundColor: bgFor(theme) }]}>{section.title}</Text>}
        renderItem={({ item: e, index, section }) => (
          <EntryRow
            e={e} first={index === 0} last={index === section.data.length - 1} enter={firstPaint.current}
            tokens={tokens} snippet={snippet(e)} well={well} dip={dip} onOpen={open} onMenu={openMenu}
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
              label={keyToDate(m + '-01').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) + ' ' + n}
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
  link: { fontFamily: F.semi, fontSize: 13 },
  linkBox: { marginLeft: 12, paddingHorizontal: 2 },
  rate: { flexDirection: 'row', alignItems: 'center', marginLeft: 6 },
  rateText: { color: C.gold, fontFamily: F.semi, fontSize: 12, marginLeft: 2, fontVariant: ['tabular-nums'] },
  // a sticky month spans the whole width, so the card's side shadows pass under it instead of beside it
  section: {
    ...T.kicker, marginHorizontal: -S.pad, paddingHorizontal: S.pad, paddingTop: 14, paddingBottom: 8,
  },
  entry: { alignItems: 'flex-start', paddingVertical: 14 },
  dayWell: { width: 46, paddingVertical: 7, borderRadius: 14, alignItems: 'center' },
  dayName: { color: C.textFaint, fontFamily: F.semi, fontSize: 11, letterSpacing: 0.6 },
  dayNum: { color: C.text, fontFamily: F.bold, fontSize: 18, fontVariant: ['tabular-nums'], marginTop: 1 },
  excerpt: { color: C.textDim, fontFamily: F.reg, fontSize: 13, lineHeight: 19, marginTop: 4 },
  vDivider: { width: StyleSheet.hairlineWidth, backgroundColor: C.hairline, alignSelf: 'stretch' },
  glanceValue: { ...T.numStat, color: C.gold },
  glanceLabel: { color: C.textFaint, fontFamily: F.med, fontSize: 11, marginTop: 3, letterSpacing: 0.4 },
  heat: { flexDirection: 'row', gap: 3, justifyContent: 'center', marginTop: 16 },
  heatCell: { width: 12, height: 12, borderRadius: 3 },
  echo: { color: C.textDim, fontFamily: F.reg, fontSize: 13, marginTop: 6 },
  sheetLabel: { ...T.label, marginTop: 10, marginBottom: 8 },
});
