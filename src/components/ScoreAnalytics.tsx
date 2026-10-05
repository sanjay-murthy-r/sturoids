import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, useWindowDimensions } from 'react-native';
import Animated from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { C, F, MIN, S, T, TRACK, neuRaised } from '../theme';
import { useStore } from '../store';
import { ScoreIndex, ScoreTag, TAG_COLORS, categoriesOf, fmtExamDate, fmtMark, fmtPct, indexScores } from '../scores';
import {
  ALL, NONE, CategoryRow, ExamPoint, Range, Scope, SeriesStats, SubjectCallouts, SubjectStat,
  categoryRows, columnLabels, defaultRange, defaultScope, examPoints, fmtPoints, inRange, insightLine,
  recentNote, seriesStats, steadyText, subjectCallouts, subjectStats, trendText, trendWord,
} from '../analytics';
import { Card, Chip, EmptyState, ListCard, ListRow, PillButton, SectionTitle, useTheme } from './UI';
import { Bouncy, CountUp, Enter, FadeSwap, useAnimLevel, useAppear } from './Motion';
import { SegmentedControl } from './SegmentedControl';
import { Sparkline } from './Sparkline';
import { ChartKey, GrowBar, Heatmap, ShareBar, SubjectTrendChart, TrendChart, useSeen, seriesColor } from './ScoreCharts';
import { tick } from '../haptics';
import { WIDE_AT } from '../layout';

// Scores analytics: how the exams in one category (or all of them) are going, drawn from src/analytics.ts. Every
// figure is worked out there; this file only lays them out. A sentence about nothing (no change, no spread) is left
// out rather than said.

const plural = (n: number, one: string, many = one + 's') => n + ' ' + (n === 1 ? one : many);
const round1 = (v: number) => Math.round(v * 10) / 10;
const pointsWord = (v: number) => (Math.abs(round1(v)) === 1 ? 'point' : 'points');
const fmtRank = (n: number) => n.toLocaleString('en-IN');

/** bars start filling once their section has begun to rise */
const BAR_DELAY = 220;

/**
 * How far a figure moved: a caret and the size, green when it is better and muted red when it is worse, "no change"
 * in the faint colour. `better` says which way is good (a lower rank is better).
 */
function Delta({ value, better = 'up', format, large, style }: {
  value: number; better?: 'up' | 'down'; format?: (n: number) => string; large?: boolean; style?: any;
}) {
  const r = round1(value);
  if (r === 0) return <Text style={[large ? st.deltaLarge : st.delta, { color: C.textFaint }, style]}>no change</Text>;
  const good = better === 'up' ? r > 0 : r < 0;
  const color = good ? C.green : C.danger;
  return (
    <View style={[st.deltaRow, style]}>
      <Ionicons name={good ? 'caret-up' : 'caret-down'} size={large ? 14 : 11} color={color} />
      <Text style={[large ? st.deltaLarge : st.delta, { color }]}>{format ? format(Math.abs(r)) : Math.abs(r)}</Text>
    </View>
  );
}

/* ---------------------------------------------------------------- the teaser on the Scores page */

/**
 * The Scores page's way in: one true line about the view Analytics opens on, where it comes from, and a small line
 * of the latest results. Nothing is drawn until some exam has marks.
 */
export function AnalyticsTeaser({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  const scores = useStore((s) => s.scores);
  const tags = useStore((s) => s.scoreTags);
  const t = useMemo(() => {
    const ix = indexScores(scores);
    const marked = examPoints(ix, tags, ALL);
    if (!marked.length) return null;
    const scope = defaultScope(ix, tags);
    const all = scope === ALL ? marked : examPoints(ix, tags, scope);
    const stats = seriesStats(inRange(all, defaultRange(all.length)));
    if (!stats) return null;
    const cats = categoryRows(ix, tags).filter((r) => r.scope !== NONE).length;
    const where = scope === ALL
      ? (cats ? plural(cats, 'category', 'categories') : 'All exams')
      : tags.find((x) => x.id === scope)?.label || 'All exams';
    return {
      line: insightLine(stats),
      caption: where + '  ·  ' + plural(all.length, 'marked exam'),
      spark: all.slice(-8).map((p) => p.pct),
    };
  }, [scores, tags]);
  if (!t) return null;
  return (
    <Bouncy
      onPress={() => { tick(); onPress(); }}
      radius={S.radius}
      accessibilityRole="button"
      accessibilityLabel={'Analytics. ' + t.line + '. ' + t.caption.replace('  ·  ', ', ')}
      style={[
        st.teaser,
        theme === 'minimal'
          ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: MIN.border }
          : { backgroundColor: C.card, ...neuRaised('high') },
      ]}
    >
      <View style={st.teaserRow}>
        <View style={{ flex: 1 }}>
          <Text style={T.kicker}>Analytics</Text>
          <Text style={st.teaserLine} numberOfLines={2}>{t.line}</Text>
          <Text style={[T.caption, { marginTop: 4 }]} numberOfLines={1}>{t.caption}</Text>
        </View>
        {t.spark.length > 1 ? (
          <View style={st.teaserSpark}>
            <Sparkline values={t.spark} height={40} />
          </View>
        ) : null}
        <Ionicons name="chevron-forward" size={18} color={C.textFaint} style={{ marginLeft: 10 }} />
      </View>
    </Bouncy>
  );
}

/* ---------------------------------------------------------------- the page */

interface ScopeChip { scope: Scope; label: string; color?: string }

/** Which exams Analytics looks at (a category, all of them, or those in none) and how far back. */
export interface AnalyticsView { scope: Scope; range: Range }

/**
 * A view measured against the exams as they are now. `null` is the page's own opening view: the category of the latest
 * marked exam, as far back as is worth looking. A category deleted or emptied since it was picked falls back to every
 * exam, and a range as long as the series is the whole series. The page draws from this, and the Scores header words
 * its line from the same result, so the two can never disagree about what is in scope.
 */
export function resolveView(ix: ScoreIndex, tags: ScoreTag[], view: AnalyticsView | null) {
  const cats = categoriesOf(tags);
  const overview = categoryRows(ix, tags);
  const chips: ScopeChip[] = [{ scope: ALL, label: 'All exams' }];
  for (const r of overview) if (r.scope !== NONE) chips.push({ scope: r.scope, label: r.label, color: r.color || undefined });
  if (cats.length && overview.some((r) => r.scope === NONE)) chips.push({ scope: NONE, label: 'No category' });
  const opening = defaultScope(ix, tags);
  const asked: AnalyticsView = view ?? { scope: opening, range: defaultRange(examPoints(ix, tags, opening).length) };
  const scope = chips.some((c) => c.scope === asked.scope) ? asked.scope : ALL;
  const label = chips.find((c) => c.scope === scope)?.label || 'All exams';
  const all = examPoints(ix, tags, scope);
  const range: Range = all.length <= 5 || (asked.range === 10 && all.length <= 10) ? 'all' : asked.range;
  return { cats, overview, chips, scope, label, all, range, pts: inRange(all, range) };
}

/**
 * The Analytics page's content, for the Scores screen to place under its header and inside its scroll. The view
 * lives in the screen (`view`, `onView`), which words its header from it; `hero` is the header's first block, carried
 * in the page's first entrance.
 */
export function ScoreAnalytics({ view, onView, onOpenExam, onManageCategories, hero }: {
  view: AnalyticsView | null; onView: (v: AnalyticsView) => void;
  onOpenExam: (id: string) => void; onManageCategories: () => void; hero?: React.ReactNode;
}) {
  useTheme();
  const scores = useStore((s) => s.scores);
  const tags = useStore((s) => s.scoreTags);
  const ix = useMemo(() => indexScores(scores), [scores]);
  // the page's round: 0 until it is in view, then one more each time it comes into view, so its figures and bars play the same every visit
  const round = useSeen();
  const { width } = useWindowDimensions();

  const { cats, overview, chips, scope, label: scopeLabel, all, range, pts } = useMemo(() => resolveView(ix, tags, view), [ix, tags, view]);

  const data = useMemo(() => {
    const stats = seriesStats(pts);
    const subjects = subjectStats(ix, pts.map((p) => p.id));
    return { stats, subjects, callouts: subjectCallouts(subjects) };
  }, [ix, pts]);

  const pickScope = React.useCallback((next: Scope) => {
    if (next === scope) return;
    tick();
    onView({ scope: next, range: defaultRange(examPoints(ix, tags, next).length) });
  }, [ix, tags, scope, onView]);

  const { stats } = data;
  const ranges = all.length > 10
    ? [{ key: '5', label: 'Last 5' }, { key: '10', label: 'Last 10' }, { key: 'all', label: 'All' }]
    : [{ key: '5', label: 'Last 5' }, { key: 'all', label: 'All' }];
  const showOverview = scope === ALL && overview.some((r) => r.scope !== NONE);
  let enter = 0;
  // the header's hero rides in whichever block this page builds first, so the two rise as one
  let lead = hero;
  const first = () => { const h = lead; lead = null; return h; };

  return (
    <>
      {chips.length > 1 || all.length > 5 ? (
        <Enter index={enter++}>
          {first()}
          {chips.length > 1 ? (
            <View style={st.chipRow}>
              {chips.map((c) => (
                <Chip key={c.scope} label={c.label} color={c.color} active={c.scope === scope} onPress={() => pickScope(c.scope)} />
              ))}
            </View>
          ) : null}
          {all.length > 5 ? (
            <SegmentedControl
              size="sm"
              options={ranges}
              value={String(range)}
              onChange={(k) => onView({ scope, range: k === 'all' ? 'all' : (Number(k) as 5 | 10) })}
              style={{ marginBottom: 18 }}
            />
          ) : null}
        </Enter>
      ) : null}

      {!cats.length ? (
        <Enter index={enter++}>
          {first()}
          <Card pad={16}>
            <Text style={T.label}>
              Categories keep like with like, such as JEE Main mocks apart from unit tests. Put exams in one, and
              Analytics compares the exams inside each.
            </Text>
            <View style={{ flexDirection: 'row', marginTop: 12 }}>
              <PillButton small icon="add" label="Make a category" onPress={() => { tick(); onManageCategories(); }} />
            </View>
          </Card>
        </Enter>
      ) : null}

      {!stats ? (
        <Enter index={enter++}>
          {first()}
          <Card>
            <EmptyState
              compact
              icon="stats-chart-outline"
              title="Nothing marked here yet"
              body={(scope === ALL ? 'Exams' : scope === NONE ? 'Exams in no category' : 'Exams in ' + scopeLabel) + ' appear here once they have marks.'}
            />
          </Card>
        </Enter>
      ) : (
        <>
          <Enter index={enter++}>
            {first()}
            <Hero stats={stats} total={all.length} round={round} />
            {stats.n === 1 ? <OneMore /> : null}
          </Enter>

          {showOverview ? (
            <Enter index={enter++}>
              <ByCategory rows={overview} onPick={pickScope} />
            </Enter>
          ) : null}

          {stats.n > 1 ? (
            <Enter index={enter++}>
              <TrendSection pts={pts} stats={stats} onOpenExam={onOpenExam} />
            </Enter>
          ) : null}

          {stats.n > 1 ? (
            <Enter index={enter++}>
              <Figures stats={stats} cols={width >= WIDE_AT ? 3 : 2} />
            </Enter>
          ) : null}

          {stats.n > 2 ? (
            <Enter index={enter++}>
              <Distribution stats={stats} round={round} />
            </Enter>
          ) : null}

          {stats.rank || stats.percentile ? (
            <Enter index={enter++}>
              <RankCard stats={stats} />
            </Enter>
          ) : null}

          {data.subjects.length ? (
            <Subjects subjects={data.subjects} callouts={data.callouts} pts={pts} round={round} enter={enter} />
          ) : null}
        </>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- the headline */

/** A view with one marked exam has nothing to compare yet, so it says what would change that. */
function OneMore() {
  const appear = useAppear();
  return (
    <Animated.View style={appear}>
      <Text style={[T.label, st.oneMore]}>Mark another exam here to see how it moves.</Text>
    </Animated.View>
  );
}

const Hero = React.memo(function Hero({ stats, total, round }: { stats: SeriesStats; total: number; round: number }) {
  useTheme();
  const full = useAnimLevel() === 'full';
  const avg = round1(stats.mean);
  // a count that lands on a whole number settles as "72%", like every other result; on the way it keeps its tenths
  const format = React.useCallback((n: number) => (n === avg ? fmtPct(n) : n.toFixed(1) + '%'), [avg]);
  const across = stats.n === 1
    ? [stats.latest.title, fmtExamDate(stats.latest.when)].join('  ·  ')
    : 'across ' + (total > stats.n ? 'the last ' + stats.n + ' of ' + plural(total, 'marked exam') : plural(stats.n, 'marked exam'))
      + '  ·  median ' + fmtPct(stats.median);
  return (
    <Card hero pad={20}>
      <View style={st.heroRow}>
        <View style={{ flex: 1 }}>
          <Text style={T.kicker}>{stats.n === 1 ? 'Result' : 'Average'}</Text>
          {/* each round is a new count, from nothing as the page comes into view; with less than full motion the figure is simply there */}
          <CountUp key={round} value={round ? avg : 0} from={full ? 0 : undefined} decimals={1} format={format} style={st.heroPct} />
          <FadeSwap swapKey={across}>
            <Text style={T.caption} numberOfLines={2}>{across}</Text>
          </FadeSwap>
        </View>
        {stats.n > 1 ? (
          <FadeSwap swapKey={[stats.latest.id, stats.latest.pct, stats.delta, stats.best.pct].join('|')} style={st.heroSide}>
            <Text style={T.caption}>Latest</Text>
            <View style={st.sideRow}>
              <Text style={st.sideVal}>{fmtPct(stats.latest.pct)}</Text>
              {stats.delta != null ? <Delta value={stats.delta} style={{ marginLeft: 6, marginTop: 2 }} /> : null}
            </View>
            <Text style={[T.caption, { marginTop: 8 }]}>Best</Text>
            <Text style={st.sideVal}>{fmtPct(stats.best.pct)}</Text>
          </FadeSwap>
        ) : null}
      </View>
    </Card>
  );
});

/* ---------------------------------------------------------------- categories side by side */

function ByCategory({ rows, onPick }: { rows: CategoryRow[]; onPick: (s: Scope) => void }) {
  useTheme();
  return (
    <>
      <SectionTitle right={<Text style={T.caption}>Average</Text>}>By category</SectionTitle>
      <ListCard>
        {rows.map((r) => {
          const caption = r.marked
            ? plural(r.exams, 'exam') + '  ·  latest ' + fmtPct(r.latest as number)
            : plural(r.exams, 'exam') + ', none marked yet';
          return (
            <Bouncy
              key={r.scope}
              onPress={() => onPick(r.scope)}
              scaleTo={1}
              sink={false}
              radius={14}
              style={st.catRow}
              accessibilityRole="button"
              accessibilityLabel={r.label + ', ' + caption.replace('  ·  ', ', ') + (r.mean != null ? ', average ' + fmtPct(r.mean) : '')}
            >
              <View style={st.sideRow}>
                <View
                  style={[
                    st.catDot,
                    r.color ? { backgroundColor: r.color + '38', borderColor: r.color + 'B3' } : { borderColor: C.textFaint },
                  ]}
                />
                <Text style={[st.rowTitle, { flex: 1, marginLeft: 12 }]} numberOfLines={1}>{r.label}</Text>
                {r.series.length > 1 ? (
                  <View style={st.catSpark}>
                    <Sparkline values={r.series.slice(-8)} height={24} />
                  </View>
                ) : null}
                <Text style={[st.rowPct, st.catPct]}>{r.mean != null ? fmtPct(r.mean) : ''}</Text>
              </View>
              <View style={[st.sideRow, { marginTop: 4, marginLeft: 22 }]}>
                <Text style={T.caption} numberOfLines={1}>{caption}</Text>
                {r.delta != null ? <Delta value={r.delta} style={{ marginLeft: 6 }} /> : null}
              </View>
            </Bouncy>
          );
        })}
      </ListCard>
    </>
  );
}

/* ---------------------------------------------------------------- trend */

const TrendSection = React.memo(function TrendSection({ pts, stats, onOpenExam }: {
  pts: ExamPoint[]; stats: SeriesStats; onOpenExam: (id: string) => void;
}) {
  const theme = useTheme();
  // the pick is kept by exam, so a new view (another category, another range) simply drops it
  const [pickedId, setPickedId] = useState<string | null>(null);
  const index = pickedId ? pts.findIndex((p) => p.id === pickedId) : -1;
  const picked = index >= 0 ? pts[index] : null;
  const target = useMemo(() => {
    for (let i = pts.length - 1; i >= 0; i--) if (pts[i].target != null) return pts[i].target as number;
    return null;
  }, [pts]);
  const hasAverage = stats.moving.some((v) => v != null);
  const keyItems = [
    { label: 'Results', color: C.accent },
    ...(hasAverage ? [{ label: '3-exam average', color: C.textDim, dash: '6 4', opacity: 0.5, width: 1.5 }] : []),
    ...(target != null ? [{ label: 'Target ' + fmtPct(target), color: C.textFaint, dash: '2 4', opacity: 0.7, width: 1 }] : []),
  ];
  const recent = recentNote(stats);
  const steady = steadyText(stats.sd);
  const word = stats.slope != null ? trendWord(stats.slope) : null;
  const label = 'Results from ' + fmtPct(stats.worst.pct) + ' to ' + fmtPct(stats.best.pct) + ', latest ' + fmtPct(stats.latest.pct);
  const marks = picked && picked.score != null && picked.outOf != null ? fmtMark(picked.score) + ' / ' + fmtMark(picked.outOf) : '';

  return (
    <>
      <SectionTitle>Trend</SectionTitle>
      <Card>
        <TrendChart
          points={pts} moving={stats.moving} target={target}
          selected={index >= 0 ? index : null}
          onSelect={(i) => setPickedId(i == null ? null : pts[i].id)}
          accessibilityLabel={label}
        />
        {keyItems.length > 1 ? <ChartKey items={keyItems} style={{ marginTop: 12 }} /> : null}

        <FadeSwap swapKey={picked ? picked.id : 'none'} style={st.pickSlot}>
          {picked ? (
            <View style={st.pickRow}>
              <View style={{ flex: 1 }}>
                <Text style={st.rowTitle} numberOfLines={1}>{picked.title}</Text>
                <Text style={[T.caption, { marginTop: 2 }]} numberOfLines={1}>
                  {[fmtExamDate(picked.when), marks].filter(Boolean).join('  ·  ')}
                </Text>
              </View>
              <Text style={st.pickPct}>{fmtPct(picked.pct)}</Text>
              <Pressable
                onPress={() => { tick(); onOpenExam(picked.id); }}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={'Open ' + picked.title}
                style={{ marginLeft: 16 }}
              >
                <Text style={[st.link, { color: C.accent }]}>Open</Text>
              </Pressable>
            </View>
          ) : (
            <Text style={T.caption}>Tap a point to see that exam.</Text>
          )}
        </FadeSwap>

        {word || recent || steady ? (
          <FadeSwap swapKey={[stats.slope != null ? trendText(stats.slope) : '', recent, steady].join('|')}>
            <View style={[st.hair, { backgroundColor: theme === 'minimal' ? MIN.hairline : C.hairline }]} />
            {word ? (
              <View style={st.noteRow}>
                <Ionicons
                  name={word === 'rising' ? 'trending-up-outline' : word === 'falling' ? 'trending-down-outline' : 'arrow-forward-outline'}
                  size={17} color={C.accent}
                />
                <Text style={[T.body, st.noteText]}>{trendText(stats.slope as number)}</Text>
              </View>
            ) : null}
            {recent ? (
              <View style={st.noteRow}>
                <Ionicons name="time-outline" size={16} color={C.textFaint} />
                <Text style={[T.label, st.noteText]}>{recent}</Text>
              </View>
            ) : null}
            {steady ? (
              <View style={st.noteRow}>
                <Ionicons name="pulse-outline" size={16} color={C.textFaint} />
                <Text style={[T.label, st.noteText]}>{steady}</Text>
              </View>
            ) : null}
          </FadeSwap>
        ) : null}
      </Card>
    </>
  );
});

/* ---------------------------------------------------------------- figures */

interface Tile { label: string; value: React.ReactNode; unit?: string; sub?: string }

/** Flat figures in rows of `cols`, a hairline between rows: a label, the figure, and at most one quiet line under it. */
function FigureGrid({ tiles, cols }: { tiles: Tile[]; cols: number }) {
  const theme = useTheme();
  const rows: Tile[][] = [];
  for (let i = 0; i < tiles.length; i += cols) rows.push(tiles.slice(i, i + cols));
  return (
    <View>
      {rows.map((row, r) => (
        <View key={r}>
          {r > 0 ? <View style={[st.gridHair, { backgroundColor: theme === 'minimal' ? MIN.hairline : C.hairline }]} /> : null}
          <View style={{ flexDirection: 'row' }}>
            {row.map((t) => (
              <View key={t.label} style={[st.tile, { width: `${100 / cols}%` }]}>
                <Text style={T.caption} numberOfLines={1}>{t.label}</Text>
                <View style={st.tileValueRow}>
                  {typeof t.value === 'string' ? (
                    <Text style={st.tileValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{t.value}</Text>
                  ) : t.value}
                  {t.unit ? <Text style={st.tileUnit} numberOfLines={1}>{t.unit}</Text> : null}
                </View>
                {t.sub ? <Text style={[T.caption, { marginTop: 2 }]} numberOfLines={1}>{t.sub}</Text> : null}
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const Figures = React.memo(function Figures({ stats: s, cols }: { stats: SeriesStats; cols: number }) {
  useTheme();
  const tiles: Tile[] = [
    { label: 'Median', value: fmtPct(s.median) },
    { label: 'Spread', value: fmtMark(round1(s.sd)), unit: pointsWord(s.sd) },
    { label: 'Best', value: fmtPct(s.best.pct), sub: s.best.title },
    { label: 'Lowest', value: fmtPct(s.worst.pct), sub: s.worst.title },
  ];
  if (s.form != null) {
    tiles.push({
      label: 'Latest vs usual', value: fmtPoints(s.form), unit: pointsWord(s.form),
      sub: round1(s.form) !== 0 ? 'on the average before it' : undefined,
    });
  }
  if (s.targets.set) tiles.push({ label: 'Targets met', value: s.targets.met + ' of ' + s.targets.set });
  if (s.streak && s.streak.count >= 2) {
    tiles.push({ label: 'Streak', value: String(s.streak.count), unit: s.streak.dir === 'up' ? 'rises in a row' : 'falls in a row' });
  }
  if (s.projection) {
    tiles.push({
      label: 'Next at this pace', value: fmtPct(s.projection.value),
      sub: fmtPct(s.projection.low) + ' to ' + fmtPct(s.projection.high),
    });
  }
  return (
    <>
      <SectionTitle>Figures</SectionTitle>
      <Card>
        <FadeSwap swapKey={tiles.map((t) => t.label + ':' + t.value + (t.sub || '')).join('|')}>
          <FigureGrid tiles={tiles} cols={cols} />
        </FadeSwap>
        {s.projection ? (
          <Text style={[T.caption, { marginTop: 12 }]}>A straight line through your results: a guide, not a promise.</Text>
        ) : null}
      </Card>
    </>
  );
});

/* ---------------------------------------------------------------- distribution */

const Distribution = React.memo(function Distribution({ stats, round }: { stats: SeriesStats; round: number }) {
  useTheme();
  // highest band first, read down like a table of results
  const bands = [...stats.bands].reverse();
  const max = Math.max(1, ...bands.map((b) => b.count));
  return (
    <>
      <SectionTitle>Distribution</SectionTitle>
      <Card>
        {bands.map((b, i) => (
          <View
            key={b.label}
            style={[st.bandRow, i > 0 && { marginTop: 12 }, !b.count && { opacity: 0.45 }]}
            accessible
            accessibilityLabel={b.label + ': ' + plural(b.count, 'exam')}
          >
            <Text style={[st.bandLabel, { color: b.count ? C.textDim : C.textFaint }]} numberOfLines={1}>{b.label}</Text>
            <View style={{ flex: 1 }}>
              <GrowBar value={b.count / max} height={8} play={round > 0} round={round} delay={BAR_DELAY + i * 40} />
            </View>
            <Text style={[st.bandCount, { color: b.count ? C.text : C.textFaint }]}>{b.count}</Text>
          </View>
        ))}
      </Card>
    </>
  );
});

/* ---------------------------------------------------------------- rank and percentile */

const RankCard = React.memo(function RankCard({ stats }: { stats: SeriesStats }) {
  const theme = useTheme();
  const r = stats.rank;
  const p = stats.percentile;
  const both = !!(r && p);
  const rankTiles: Tile[] = r ? [
    // a figure from an older exam says which one, so it never reads as today's standing
    {
      label: 'Latest', value: fmtRank(r.latest),
      sub: r.latestId !== stats.latest.id ? 'as of ' + r.latestTitle : r.n > 1 ? 'from ' + fmtRank(r.first) : undefined,
    },
    ...(r.n > 1 ? [{ label: 'Best', value: fmtRank(r.best) }] : []),
    ...(r.change != null ? [{ label: 'Last change', value: <Delta large value={r.change} better="down" format={fmtRank} style={st.tileDelta} /> }] : []),
  ] : [];
  const pctTiles: Tile[] = p ? [
    { label: 'Latest', value: fmtMark(p.latest), sub: p.latestId !== stats.latest.id ? 'as of ' + p.latestTitle : undefined },
    ...(p.n > 1 ? [{ label: 'Average', value: fmtMark(round1(p.mean)) }, { label: 'Best', value: fmtMark(p.best) }] : []),
  ] : [];
  return (
    <>
      <SectionTitle>{both ? 'Rank and percentile' : r ? 'Rank' : 'Percentile'}</SectionTitle>
      <Card>
        {r ? (
          <>
            {both ? <Text style={[T.label, { marginBottom: 2 }]}>Rank</Text> : null}
            <FigureGrid tiles={rankTiles} cols={3} />
          </>
        ) : null}
        {both ? <View style={[st.hair, { backgroundColor: theme === 'minimal' ? MIN.hairline : C.hairline }]} /> : null}
        {p ? (
          <>
            {both ? <Text style={[T.label, { marginBottom: 2 }]}>Percentile</Text> : null}
            <FigureGrid tiles={pctTiles} cols={3} />
          </>
        ) : null}
      </Card>
    </>
  );
});

/* ---------------------------------------------------------------- subjects */

/** A flat key that picks a subject's line out: its colour as a dot, an outline at rest, a tint of its colour when on. */
function KeyChip({ label, color, active, onPress }: { label: string; color: string; active: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Bouncy
      onPress={onPress}
      scaleTo={0.94}
      radius={999}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: active }}
      accessibilityLabel={'Pick out ' + label}
      style={[
        st.keyChip,
        active ? { backgroundColor: color + '1F', borderColor: color + '66' } : { borderColor: theme === 'minimal' ? MIN.border : C.outline },
      ]}
    >
      <View style={st.sideRow}>
        <View style={[st.keyDot, { backgroundColor: color }]} />
        <Text style={[st.keyChipText, { color: active ? color : C.textDim }]} numberOfLines={1}>{label}</Text>
      </View>
    </Bouncy>
  );
}

const Subjects = React.memo(function Subjects({ subjects, callouts, pts, round, enter }: {
  subjects: SubjectStat[]; callouts: SubjectCallouts; pts: ExamPoint[]; round: number;
  /** the first entrance index these sections take */
  enter: number;
}) {
  useTheme();
  const [focus, setFocus] = useState<string[]>([]);
  // each subject keeps one pastel for the whole page, in the order the list shows them
  const colors = useMemo(() => new Map(subjects.map((s, i) => [s.key, seriesColor(i)])), [subjects]);
  const colorOf = (key: string) => colors.get(key) || TAG_COLORS[0];

  const heat = useMemo(() => {
    const last = pts.slice(-8);
    const labels = columnLabels(last);
    const from = pts.length - last.length;
    return {
      columns: last.map((p, i) => ({ id: p.id, label: labels[i] })),
      rows: subjects
        .map((s) => ({ key: s.key, name: s.name, cells: s.cells.slice(from).map((c) => (c ? c.pct : null)) }))
        .filter((r) => r.cells.some((v) => v != null)),
    };
  }, [subjects, pts]);
  const series = useMemo(
    () => subjects.map((s) => ({ key: s.key, name: s.name, color: colorOf(s.key), values: s.cells.map((c) => (c ? c.pct : null)) })),
    [subjects, colors],
  );
  const lost = useMemo(() => [...subjects].filter((s) => s.lost > 0).sort((a, b) => b.lost - a.lost), [subjects]);
  const liveFocus = focus.filter((k) => colors.has(k));
  const showLines = subjects.length > 1 && pts.length > 1 && subjects.some((s) => s.n > 1);

  const calls = [
    callouts.strongest && { key: 'strongest', icon: 'ribbon-outline', label: 'Strongest', s: callouts.strongest, value: fmtPct(callouts.strongest.mean), unit: 'average' },
    callouts.weakest && { key: 'weakest', icon: 'flag-outline', label: 'Needs work', s: callouts.weakest, value: fmtPct(callouts.weakest.mean), unit: 'average' },
    callouts.improving && { key: 'improving', icon: 'trending-up-outline', label: 'Improving', s: callouts.improving, value: fmtPoints(callouts.improving.slope as number), unit: 'points an exam' },
    callouts.slipping && { key: 'slipping', icon: 'trending-down-outline', label: 'Slipping', s: callouts.slipping, value: fmtPoints(callouts.slipping.slope as number), unit: 'points an exam' },
    callouts.costliest && { key: 'costliest', icon: 'pie-chart-outline', label: 'Most marks lost', s: callouts.costliest, value: Math.round(callouts.costliest.lostShare * 100) + '%', unit: 'of marks lost' },
  ].filter(Boolean) as { key: string; icon: any; label: string; s: SubjectStat; value: string; unit: string }[];

  let at = enter;
  return (
    <>
      <Enter index={at++}>
        <SectionTitle>Subjects</SectionTitle>
        {calls.length ? (
          <ListCard>
            {calls.map((c) => (
              <ListRow key={c.key} style={{ paddingVertical: 12 }}>
                <Ionicons name={c.icon} size={19} color={C.accent} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={T.caption}>{c.label}</Text>
                  <Text style={[st.rowTitle, { marginTop: 1 }]} numberOfLines={1}>{c.s.name}</Text>
                </View>
                <View style={st.rowRight}>
                  <Text style={st.rowPct}>{c.value}</Text>
                  <Text style={T.caption}>{c.unit}</Text>
                </View>
              </ListRow>
            ))}
          </ListCard>
        ) : null}
        <ListCard>
          {subjects.map((s, i) => {
            const word = s.slope != null ? trendWord(s.slope) : null;
            return (
              <ListRow key={s.key} style={{ paddingVertical: 12 }}>
                <View style={{ flex: 1 }}>
                  <View style={st.subHead}>
                    <View style={[st.keyDot, { backgroundColor: colorOf(s.key), marginRight: 10 }]} />
                    <Text style={[st.rowTitle, { flex: 1 }]} numberOfLines={1}>{s.name}</Text>
                    {word ? (
                      <Ionicons
                        name={word === 'rising' ? 'trending-up' : word === 'falling' ? 'trending-down' : 'arrow-forward'}
                        size={15}
                        color={word === 'rising' ? C.green : word === 'falling' ? C.danger : C.textFaint}
                        style={{ marginLeft: 8 }}
                        accessibilityLabel={word}
                      />
                    ) : null}
                    <Text style={st.partPct}>{fmtPct(s.mean)}</Text>
                  </View>
                  <GrowBar value={s.mean / 100} play={round > 0} round={round} delay={BAR_DELAY + Math.min(i, 8) * 50} />
                  <View style={[st.sideRow, { marginTop: 6 }]}>
                    <Text style={T.caption}>Latest {fmtPct(s.latest)}</Text>
                    {s.delta != null ? <Delta value={s.delta} style={{ marginLeft: 6 }} /> : null}
                    <Text style={T.caption}>{'  ·  ' + plural(s.n, 'exam')}</Text>
                  </View>
                </View>
              </ListRow>
            );
          })}
        </ListCard>
      </Enter>

      {subjects.length > 1 && lost.length ? (
        <Enter index={at++}>
          <SectionTitle>Where marks go</SectionTitle>
          <Card>
            <ShareBar parts={lost.map((s) => ({ key: s.key, color: colorOf(s.key), share: s.lostShare }))} play={round > 0} round={round} delay={BAR_DELAY} />
            <View style={{ marginTop: 16 }}>
              {lost.map((s, i) => (
                <View key={s.key} style={[st.sideRow, i > 0 && { marginTop: 10 }]}>
                  <View style={[st.keyDot, { backgroundColor: colorOf(s.key), marginRight: 10 }]} />
                  <Text style={[T.body, { flex: 1 }]} numberOfLines={1}>{s.name}</Text>
                  <Text style={st.legendPct}>{Math.round(s.lostShare * 100)}%</Text>
                  <Text style={[T.caption, st.legendMarks]} numberOfLines={1}>{fmtMark(round1(s.lost))} lost</Text>
                </View>
              ))}
            </View>
          </Card>
        </Enter>
      ) : null}

      {heat.rows.length && heat.columns.length ? (
        <Enter index={at++}>
          <SectionTitle>Exam by exam</SectionTitle>
          <Card>
            <Heatmap
              rows={heat.rows}
              columns={heat.columns}
              accessibilityLabel={heat.rows.map((r) => r.name + ' ' + r.cells.filter((v) => v != null).map((v) => Math.round(v as number) + '%').join(', ')).join('; ')}
            />
          </Card>
        </Enter>
      ) : null}

      {showLines ? (
        <Enter index={at++}>
          <SectionTitle>Subject trends</SectionTitle>
          <Card>
            <View style={st.keyChips}>
              {series.map((s) => (
                <KeyChip
                  key={s.key} label={s.name} color={s.color} active={liveFocus.includes(s.key)}
                  onPress={() => { tick(); setFocus((cur) => (cur.includes(s.key) ? cur.filter((k) => k !== s.key) : [...cur, s.key])); }}
                />
              ))}
            </View>
            <SubjectTrendChart
              series={series}
              focus={liveFocus}
              accessibilityLabel={'Subject results over ' + plural(pts.length, 'exam') + ': ' + subjects.map((s) => s.name + ' latest ' + fmtPct(s.latest)).join(', ')}
            />
            {liveFocus.length ? null : <Text style={[T.caption, { marginTop: 10 }]}>Tap a subject to pick out its line.</Text>}
          </Card>
        </Enter>
      ) : null}
    </>
  );
});

const st = StyleSheet.create({
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 },
  teaser: { borderRadius: S.radius, marginBottom: S.gap, padding: 20 },
  teaserRow: { flexDirection: 'row', alignItems: 'center' },
  teaserLine: { color: C.text, fontFamily: F.med, fontSize: 16, letterSpacing: TRACK.body, lineHeight: 22, marginTop: 8 },
  teaserSpark: { width: 76, marginLeft: 14 },
  heroRow: { flexDirection: 'row', alignItems: 'flex-start' },
  heroPct: { ...T.numDisplay, lineHeight: 52, letterSpacing: -1, marginTop: 6 },
  heroSide: { alignItems: 'flex-end', marginLeft: 16 },
  sideVal: { ...T.numStat, fontSize: 17, lineHeight: 22, letterSpacing: TRACK.title, marginTop: 2 },
  sideRow: { flexDirection: 'row', alignItems: 'center' },
  oneMore: { color: C.textDim, paddingHorizontal: 4, marginTop: 2, marginBottom: 6 },
  rowTitle: { color: C.text, fontFamily: F.semi, fontSize: 16, letterSpacing: TRACK.title },
  rowRight: { alignItems: 'flex-end', marginLeft: 12 },
  rowPct: { ...T.numStat, fontSize: 18, lineHeight: 22, letterSpacing: TRACK.title },
  partPct: { ...T.numStat, fontSize: 16, lineHeight: 20, letterSpacing: TRACK.title, marginLeft: 12 },
  delta: { fontFamily: F.semi, fontSize: 12, letterSpacing: TRACK.fine, marginLeft: 2, fontVariant: ['tabular-nums'] },
  deltaLarge: { fontFamily: F.med, fontSize: 18, letterSpacing: TRACK.title, lineHeight: 26, marginLeft: 3, fontVariant: ['tabular-nums'] },
  deltaRow: { flexDirection: 'row', alignItems: 'center' },
  link: { fontFamily: F.semi, fontSize: 13, letterSpacing: TRACK.small },
  catRow: { paddingVertical: 12, paddingHorizontal: 12, borderRadius: 14 },
  catDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1 },
  catSpark: { width: 52, marginLeft: 12 },
  catPct: { marginLeft: 12, minWidth: 58, textAlign: 'right' },
  pickSlot: { minHeight: 44, marginTop: 14, justifyContent: 'center' },
  pickRow: { flexDirection: 'row', alignItems: 'center' },
  pickPct: { ...T.numStat, fontSize: 17, lineHeight: 22, letterSpacing: TRACK.title, marginLeft: 12 },
  hair: { height: StyleSheet.hairlineWidth, marginVertical: 14 },
  noteRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4, marginBottom: 6 },
  noteText: { flex: 1, marginLeft: 10 },
  gridHair: { height: StyleSheet.hairlineWidth },
  tile: { paddingVertical: 12, paddingRight: 12 },
  tileValueRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 4 },
  tileValue: { ...T.numStat, lineHeight: 28, flexShrink: 1 },
  tileUnit: { color: C.textFaint, fontFamily: F.reg, fontSize: 12, letterSpacing: TRACK.fine, marginLeft: 5, flexShrink: 1 },
  tileDelta: { minHeight: 28 },
  bandRow: { flexDirection: 'row', alignItems: 'center' },
  bandLabel: { width: 78, fontFamily: F.med, fontSize: 13, letterSpacing: TRACK.small },
  bandCount: { width: 32, textAlign: 'right', fontFamily: F.med, fontSize: 15, letterSpacing: TRACK.body, fontVariant: ['tabular-nums'] },
  subHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  legendPct: { fontFamily: F.semi, fontSize: 14, letterSpacing: TRACK.small, color: C.text, marginLeft: 12, fontVariant: ['tabular-nums'] },
  legendMarks: { width: 84, textAlign: 'right', marginLeft: 8 },
  keyChips: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
  keyChip: {
    paddingVertical: 6, paddingHorizontal: 11, borderRadius: 999, borderWidth: 1,
    marginRight: 8, marginBottom: 8, overflow: 'hidden',
  },
  keyDot: { width: 8, height: 8, borderRadius: 4 },
  keyChipText: { fontFamily: F.med, fontSize: 12, marginLeft: 7, letterSpacing: TRACK.fine, maxWidth: 160, flexShrink: 1 },
});
