import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { C, F, S, TRACK, oneLine } from '../theme';
import { PlannerWeek, useStore } from '../store';
import { fmtExamDate, fmtPct, indexScores, resultTable, topExams, upcoming, whenOf } from '../scores';
import { openScoreNode } from '../scoresNav';
import { subjectSummary, subjectsOf } from '../subjects';
import { openTool } from '../toolNav';
import { Kicker, TILE_TEXT_MAX, Tile, TileNote, kit, useBoardToday } from './kit';
import { daysBetween } from './logic';
import type { WidgetProps } from './types';

const openExam = (id: string) => { openScoreNode(id); openTool('scores'); };

/** Countdown: the next exam, how many days off, in a big figure. Opens the exam. */
export function CountdownWidget({ size }: WidgetProps) {
  const today = useBoardToday();
  const scores = useStore((s) => s.scores);
  const next = React.useMemo(() => upcoming(indexScores(scores), null, today)[0] ?? null, [scores, today]);
  if (!next) {
    return (
      <Tile size={size} onPress={() => openTool('scores')} label="No exams coming up" hint="Opens Scores">
        <TileNote icon="ribbon-outline" title="No exams ahead" body="A dated exam counts down here." />
      </Tile>
    );
  }
  const days = daysBetween(today, next.date as string);
  const title = next.title.trim() || 'An exam';
  const figure = days <= 0 ? 'Today' : String(days);
  return (
    <Tile
      size={size} onPress={() => openExam(next.id)} pad={16} hint="Opens the exam"
      label={title + (days <= 0 ? ', today' : days === 1 ? ', tomorrow' : ', in ' + days + ' days')}
    >
      <Kicker color={days <= 1 ? C.amber : C.accent}>Next exam</Kicker>
      <View style={st.stage}>
        <Text style={[kit.big, days <= 0 && st.bigToday]} maxFontSizeMultiplier={TILE_TEXT_MAX}>{figure}</Text>
        {days > 0 ? <Text style={kit.sub} maxFontSizeMultiplier={TILE_TEXT_MAX}>{days === 1 ? 'day to go' : 'days to go'}</Text> : null}
      </View>
      <Text style={kit.name} numberOfLines={1} maxFontSizeMultiplier={TILE_TEXT_MAX}>{title}</Text>
      <Text style={kit.sub} numberOfLines={1} maxFontSizeMultiplier={TILE_TEXT_MAX}>{fmtExamDate(next.date as string)}</Text>
    </Tile>
  );
}

/** Results: the last three marked exams, each with its percentage and how it moved from the one before. */
export function ResultsWidget({ size, editing, preview }: WidgetProps) {
  const scores = useStore((s) => s.scores);
  const rows = React.useMemo(() => {
    const ix = indexScores(scores);
    const { result, delta } = resultTable(ix);
    return topExams(ix)
      .filter((n) => result.get(n.id))
      .sort((a, b) => whenOf(b).localeCompare(whenOf(a)) || b.createdAt - a.createdAt)
      .slice(0, 3)
      .map((n) => ({ id: n.id, title: n.title.trim() || 'Exam', pct: result.get(n.id)!.pct, delta: delta.get(n.id) ?? null, when: whenOf(n) }));
  }, [scores]);
  if (!rows.length) {
    return (
      <Tile size={size} onPress={() => openTool('scores')} label="No results yet" hint="Opens Scores">
        <TileNote icon="ribbon-outline" title="No results yet" body="Marked exams show here with how they moved." />
      </Tile>
    );
  }
  return (
    <Tile size={size} pad={16}>
      <Pressable onPress={() => openTool('scores')} accessibilityRole="button" accessibilityHint="Opens Scores" hitSlop={8}>
        <Kicker>Results</Kicker>
      </Pressable>
      <View style={st.list}>
        {rows.map((r) => {
          const up = r.delta != null && r.delta > 0.05;
          const down = r.delta != null && r.delta < -0.05;
          const tint = up ? C.green : down ? C.danger : C.textFaint;
          return (
            <Pressable
              key={r.id} onPress={() => openExam(r.id)} disabled={editing || preview} style={st.row}
              accessibilityRole="button"
              accessibilityLabel={r.title + ', ' + fmtPct(r.pct) + (r.delta != null ? (up ? ', up ' : down ? ', down ' : ', level ') + fmtPct(Math.abs(r.delta)) : '')}
            >
              <Text style={kit.rowText} numberOfLines={1} maxFontSizeMultiplier={TILE_TEXT_MAX}>{r.title}</Text>
              <Text style={st.pct} maxFontSizeMultiplier={TILE_TEXT_MAX}>{fmtPct(r.pct)}</Text>
              <View style={st.delta}>
                {r.delta != null ? (
                  <Ionicons name={up ? 'arrow-up' : down ? 'arrow-down' : 'remove'} size={13} color={tint} />
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </Tile>
  );
}

const NO_PLAN = {} as PlannerWeek;

/**
 * Subject trend: one subject's results over time as a line, its latest and how it moved. The subject is the widget's
 * own (config.subject); a tap on its name steps to the next subject with results.
 */
export function SubjectTrendWidget({ size, config, setConfig, editing, preview }: WidgetProps) {
  const scores = useStore((s) => s.scores);
  const subjects = React.useMemo(() => {
    const data = { sessions: [], notes: [], planner: NO_PLAN, scores };
    return subjectsOf(data)
      .filter((x) => x.from.includes('scores'))
      .map((x) => ({ key: x.key, name: x.name, sum: subjectSummary(data, x.name) }))
      .filter((x) => x.sum.trend.length > 0);
  }, [scores]);
  const want = typeof config?.subject === 'string' ? config.subject : '';
  const at = Math.max(0, subjects.findIndex((x) => x.key === want));
  const pick = subjects[at];
  if (!pick) {
    return (
      <Tile size={size} onPress={() => openTool('scores')} label="No subject results yet" hint="Opens Scores">
        <TileNote icon="trending-up-outline" title="No subject results yet" body="Mark an exam's subjects and one's trend draws here." />
      </Tile>
    );
  }
  const trend = pick.sum.trend.slice(-10);
  const last = trend[trend.length - 1];
  const delta = pick.sum.lastDelta;
  const step = () => {
    if (subjects.length < 2) return;
    setConfig({ subject: subjects[(at + 1) % subjects.length].key });
  };
  return (
    <Tile size={size} pad={16}>
      <View style={st.trendHead}>
        <Kicker>Subject trend</Kicker>
        <Pressable
          onPress={step} disabled={editing || preview || subjects.length < 2} hitSlop={12}
          accessibilityRole="button" accessibilityLabel={'Subject, ' + pick.name}
          accessibilityHint={subjects.length > 1 ? 'Shows the next subject' : undefined}
          style={[st.subject, { borderColor: C.outline }]}
        >
          <Text style={st.subjectText} numberOfLines={1} maxFontSizeMultiplier={TILE_TEXT_MAX}>{pick.name}</Text>
          {subjects.length > 1 ? <Ionicons name="swap-horizontal" size={12} color={C.textFaint} style={{ marginLeft: 6 }} /> : null}
        </Pressable>
      </View>
      <View style={st.figures}>
        <Text style={kit.big} maxFontSizeMultiplier={TILE_TEXT_MAX}>{fmtPct(last.pct)}</Text>
        {delta != null ? (
          <Text style={[kit.sub, { color: delta > 0.05 ? C.green : delta < -0.05 ? C.danger : C.textFaint, marginLeft: 10 }]} maxFontSizeMultiplier={TILE_TEXT_MAX}>
            {(delta > 0 ? '+' : delta < 0 ? '−' : '') + fmtPct(Math.abs(delta)).replace('%', '') + ' pts'}
          </Text>
        ) : null}
      </View>
      <Pressable
        style={st.chart} onPress={() => openTool('scores')} disabled={editing || preview}
        accessibilityRole="button" accessibilityHint="Opens Scores"
        accessibilityLabel={pick.name + ' results: ' + trend.map((t) => fmtPct(t.pct)).join(', ')}
      >
        <TrendLine values={trend.map((t) => t.pct)} color={C.accent} />
      </Pressable>
      <Text style={kit.sub} numberOfLines={1} maxFontSizeMultiplier={TILE_TEXT_MAX}>
        {trend.length + (trend.length === 1 ? ' result' : ' results') + ' · latest ' + last.examTitle}
      </Text>
    </Tile>
  );
}

/** A still line of results, 0 to 100 %, with a dot on each and the last one filled. */
function TrendLine({ values, color }: { values: number[]; color: string }) {
  const [box, setBox] = React.useState({ w: 0, h: 0 });
  const pad = 6;
  const lo = Math.max(0, Math.min(...values) - 10);
  const hi = Math.min(100, Math.max(...values) + 10);
  const span = Math.max(1, hi - lo);
  const pts = values.map((v, i) => ({
    x: pad + (values.length === 1 ? (box.w - pad * 2) / 2 : (i / (values.length - 1)) * (box.w - pad * 2)),
    y: pad + (1 - (v - lo) / span) * (box.h - pad * 2),
  }));
  return (
    <View style={{ flex: 1 }} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {box.w > 0 ? (
        <Svg width={box.w} height={box.h}>
          {pts.length > 1 ? (
            <Polyline
              points={pts.map((p) => p.x + ',' + p.y).join(' ')} fill="none" stroke={color} strokeWidth={2}
              strokeLinejoin="round" strokeLinecap="round"
            />
          ) : null}
          {pts.map((p, i) => (
            <Circle
              key={i} cx={p.x} cy={p.y} r={i === pts.length - 1 ? 4 : 2.5}
              fill={i === pts.length - 1 ? color : C.card} stroke={color} strokeWidth={1.5}
            />
          ))}
        </Svg>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  stage: { flex: 1, justifyContent: 'center' },
  bigToday: { fontFamily: F.num, fontSize: 28 },
  list: { flex: 1, justifyContent: 'space-evenly', marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 30 },
  pct: { color: C.text, fontFamily: F.med, fontSize: 14, fontVariant: ['tabular-nums'], marginLeft: 8 },
  delta: { width: 20, alignItems: 'flex-end' },
  trendHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  subject: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 4, maxWidth: '60%',
  },
  subjectText: { color: C.textDim, fontFamily: F.smMed, ...oneLine(12), letterSpacing: TRACK.fine, flexShrink: 1 },
  figures: { flexDirection: 'row', alignItems: 'baseline', marginTop: 8 },
  chart: { flex: 1, marginVertical: 8, borderRadius: S.radiusSm },
});
