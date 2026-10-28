// The live preview of an export: the figures the file will hold, rebuilt as the data, the range or the locks change.
// Shared by the export sheet (one summary, or the full report) so what is previewed is exactly what is exported.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { C, F, S, T, TRACK } from '../theme';
import { useStore } from '../store';
import { ALL_NOTES, useOpen } from '../lock';
import { useProfiles } from '../profiles';
import { useToday } from '../hooks/useNow';
import { Card, Hairline } from '../components/UI';
import { Report, buildReport } from './build';
import { SummaryKind, SummaryOpts, reportOptions, sourceOf } from './run';

/** The report these options make, kept up to date with every slice it reads and the locks. */
export function useLiveReport(kind: SummaryKind, opts: SummaryOpts): Report {
  const today = useToday();
  const journalOpen = useOpen('journal');
  const notesOpen = useOpen('notes');
  const allNotesOpen = useOpen(ALL_NOTES);
  const dailyTasks = useStore((s) => s.dailyTasks);
  const missions = useStore((s) => s.missions);
  const doneLog = useStore((s) => s.doneLog);
  const habits = useStore((s) => s.habits);
  const sessions = useStore((s) => s.sessions);
  const planner = useStore((s) => s.planner);
  const journal = useStore((s) => s.journal);
  const scores = useStore((s) => s.scores);
  const scoreTags = useStore((s) => s.scoreTags);
  const notes = useStore((s) => s.notes);
  const settings = useStore((s) => s.settings);
  const profiles = useProfiles((s) => s.list);
  const sig = JSON.stringify(opts);
  return React.useMemo(() => {
    const src = sourceOf();
    return buildReport(src, reportOptions(kind, opts, src));
    // every slice the report reads, the locks and the options rebuild it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, sig, dailyTasks, missions, doneLog, habits, sessions, planner, journal, scores, scoreTags, notes, settings,
    journalOpen, notesOpen, allNotesOpen, profiles, today]);
}

/** The preview card: the wordmark, the title, whose and which days, then each part's headline figures. */
export function ReportPreview({ report, flat = false }: { report: Report; flat?: boolean }) {
  const single = report.sections.length === 1;
  const body = (
    <>
      <Text style={T.kicker}>Sturoids</Text>
      <Text style={st.title}>{report.title}</Text>
      <Text style={T.caption}>{[report.profile, report.range.label].filter(Boolean).join(' · ')}</Text>
      {report.sections.length === 0 ? (
        <Text style={[T.caption, { marginTop: S.gap }]}>Pick at least one part to put in.</Text>
      ) : report.sections.map((s) => (
        <View key={s.key} style={{ marginTop: S.gap }}>
          <Hairline />
          {single ? null : <Text style={st.secTitle}>{s.title}</Text>}
          {s.summary.length ? (
            <View style={st.stats}>
              {s.summary.slice(0, s.key === 'overview' || single ? 8 : 4).map((x) => (
                <View key={x.label} style={st.stat}>
                  <Text style={st.statValue} numberOfLines={2}>{x.value}</Text>
                  <Text style={T.caption} numberOfLines={2}>{x.label}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={[T.caption, { marginTop: S.gap }]}>{s.empty || 'Nothing to show yet.'}</Text>
          )}
          {single ? <Text style={[T.caption, { marginTop: S.gap }]}>{blurb(report)}</Text> : null}
        </View>
      ))}
    </>
  );
  if (flat) return <View style={st.flat}>{body}</View>;
  return <Card>{body}</Card>;
}

/** What else the file holds beyond the figures: "Also in the file: a chart and 2 tables." */
function blurb(r: Report): string {
  const b = r.sections[0]?.blocks || [];
  const charts = b.filter((x) => x.t === 'bars' || x.t === 'line' || x.t === 'grid' || x.t === 'strip').length;
  const tables = b.filter((x) => x.t === 'table').length;
  const parts = [
    charts ? (charts === 1 ? 'a chart' : charts + ' charts') : '',
    tables ? (tables === 1 ? 'a table' : tables + ' tables') : '',
  ].filter(Boolean);
  return parts.length ? 'Also in the file: ' + parts.join(' and ') + '.' : 'The file holds these figures.';
}

const st = StyleSheet.create({
  flat: { paddingVertical: 4 },
  title: { color: C.text, fontFamily: F.head, fontSize: 22, lineHeight: 29, letterSpacing: TRACK.display, marginTop: 6, marginBottom: 2 },
  secTitle: { color: C.text, fontFamily: F.semi, fontSize: 15, letterSpacing: TRACK.title, marginTop: S.gap },
  stats: { flexDirection: 'row', flexWrap: 'wrap', marginTop: S.gap, rowGap: 12 },
  stat: { width: '50%', paddingRight: 12 },
  statValue: { color: C.text, fontFamily: F.med, fontSize: 17, letterSpacing: TRACK.title },
});
