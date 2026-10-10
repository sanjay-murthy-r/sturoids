import React from 'react';
import { SectionList, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, F, MIN, S, T, TRACK, bgFor } from '../src/theme';
import { useStore } from '../src/store';
import type { FocusSession } from '../src/store';
import { fmtClockTime, todayKey } from '../src/utils';
import {
  Card, EmptyState, IconBtn, ListRow, ListSlice, ScreenBG, SectionTitle, contextLine, useTheme, useToolHeader,
} from '../src/components/UI';
import { Enter } from '../src/components/Motion';
import { toast } from '../src/components/Toast';
import { useToday } from '../src/hooks/useNow';
import { fmtMins, sessionDay, sessionLength } from '../src/screens/FocusScreen';

/** The list the header's scroll offset follows: Reanimated hands the offset to its handler on the UI thread. */
const AnimatedSectionList = Animated.createAnimatedComponent(SectionList) as typeof SectionList;

/** what a week's bar is called when its sessions had no subject */
const NO_SUBJECT = 'No subject';

/** The Monday that starts the week of `today` (a day key), as a day key: weeks run Monday to Sunday, as the Planner's do. */
function weekStart(today: string): string {
  const d = new Date(today + 'T00:00:00');
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return todayKey(d);
}

interface DayGroup { key: string; title: string; total: number; data: FocusSession[] }

/** One logged session in the history, with its delete key. Memoised: deleting one row repaints only its neighbours. */
const SessionRow = React.memo(function SessionRow({ s, first, last, enter, hour24, onDelete }: {
  s: FocusSession; first: boolean; last: boolean; enter: boolean; hour24: boolean; onDelete: (id: string) => void;
}) {
  const ended = new Date(s.endedAt);
  const at = fmtClockTime(ended.getHours() * 60 + ended.getMinutes(), hour24);
  const title = sessionLength(s.netSeconds) + (s.subject ? ' · ' + s.subject : '');
  const caption = ['Ended ' + at, s.taskTitles.join(', ')].filter(Boolean).join(' · ');
  // settled as the row mounts: a row of the first screenful rises with the page, and later renders never take it back
  const [rise] = React.useState(enter);
  return (
    <ListSlice first={first} last={last} enter={rise}>
      <ListRow style={st.row}>
        <View style={st.rowText} accessible accessibilityLabel={title + ', ' + caption}>
          <Text style={st.rowTitle} numberOfLines={1}>{title}</Text>
          <Text style={[T.caption, { marginTop: 2 }]} numberOfLines={1}>{caption}</Text>
        </View>
        <IconBtn name="trash-outline" size={18} onPress={() => onDelete(s.id)} accessibilityLabel={'Delete ' + title} />
      </ListRow>
    </ListSlice>
  );
});

/**
 * Every Deep Work session, opened from Deep Work's "See all". At the top, this week's focus per subject as flat bars;
 * under it, the sessions by day, newest first, each with its day's total. A delete can be taken back from its toast.
 */
export default function FocusHistoryPage() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const sessions = useStore((s) => s.sessions);
  const hour24 = useStore((s) => s.settings.hour24);
  // the week and the day names turn over at midnight
  const today = useToday();

  // the first screenful rises as one card; rows that mount later (scrolling) are simply there
  const firstPaint = React.useRef(true);
  React.useEffect(() => { firstPaint.current = false; }, []);

  // this week's seconds per subject, the most first. Subjects are matched without case, under the latest spelling
  const week = React.useMemo(() => {
    const from = weekStart(today);
    const bySubject = new Map<string, { k: string; name: string; secs: number; last: number }>();
    for (const s of sessions) {
      if (s.dateKey < from || s.dateKey > today) continue;
      const raw = (s.subject || '').trim();
      const name = raw || NO_SUBJECT;
      const k = raw.toLowerCase();
      const had = bySubject.get(k);
      if (!had) bySubject.set(k, { k, name, secs: s.netSeconds, last: s.endedAt });
      else {
        had.secs += s.netSeconds;
        if (s.endedAt > had.last) { had.last = s.endedAt; had.name = name; }
      }
    }
    const rows = [...bySubject.values()].sort((a, b) => b.secs - a.secs);
    return { rows, total: rows.reduce((a, r) => a + r.secs, 0), max: rows.length ? rows[0].secs : 0 };
  }, [sessions, today]);

  // the sessions by the day they began, newest day first and the latest session first within it. Built again on a new
  // day too, since the titles say Today and Yesterday
  const days = React.useMemo(() => {
    const groups = new Map<string, FocusSession[]>();
    for (const s of sessions) {
      const list = groups.get(s.dateKey);
      if (list) list.push(s);
      else groups.set(s.dateKey, [s]);
    }
    const out: DayGroup[] = [];
    for (const [key, list] of groups) {
      list.sort((a, b) => b.endedAt - a.endedAt);
      out.push({ key, title: sessionDay(key), total: list.reduce((a, s) => a + s.netSeconds, 0), data: list });
    }
    return out.sort((a, b) => b.key.localeCompare(a.key));
  }, [sessions, today]);

  const remove = React.useCallback((id: string) => {
    const gone = useStore.getState().removeSession(id);
    if (!gone) return;
    toast('Session deleted', { label: 'Undo', onPress: () => useStore.getState().restoreSession(gone.session, gone.index) });
  }, []);

  const allSecs = React.useMemo(() => sessions.reduce((a, s) => a + s.netSeconds, 0), [sessions]);
  const allMin = Math.round(allSecs / 60);
  const tool = useToolHeader({
    title: 'Sessions',
    mode: 'page',
    // how many there are and how long they come to; nothing at all with none
    context: contextLine(
      sessions.length > 0 && sessions.length + (sessions.length === 1 ? ' session' : ' sessions'),
      allMin > 0 && fmtMins(allMin) + ' in all',
    ),
  });

  const track = theme === 'minimal' ? MIN.inset : C.inset;
  const head = (
    <Enter index={0}>
      {tool.hero}
      {week.rows.length > 0 ? (
        <View style={st.week}>
          <SectionTitle right={<Text style={T.caption}>{sessionLength(week.total)}</Text>}>This week</SectionTitle>
          <Card>
            {week.rows.map((r, i) => (
              <View
                key={'s:' + r.k} style={i > 0 ? st.barGap : undefined}
                accessible accessibilityLabel={r.name + ', ' + sessionLength(r.secs)}
              >
                <View style={st.barHead}>
                  <Text style={[st.barName, !r.k && { color: C.textDim }]} numberOfLines={1}>{r.name}</Text>
                  <Text style={st.barValue}>{sessionLength(r.secs)}</Text>
                </View>
                {/* flat: a plain track and a plain fill, no depth, so a column of them stays quiet */}
                <View style={[st.track, { backgroundColor: track }]}>
                  <View style={[st.fill, { width: `${Math.max(2, Math.round((r.secs / week.max) * 100))}%`, backgroundColor: C.accent }]} />
                </View>
              </View>
            ))}
          </Card>
        </View>
      ) : null}
    </Enter>
  );

  return (
    <ScreenBG>
      {tool.bar}
      <AnimatedSectionList
        sections={days}
        keyExtractor={(s) => s.id}
        stickySectionHeadersEnabled
        {...tool.scrollProps}
        ListHeaderComponent={head}
        ListEmptyComponent={<EmptyState icon="time-outline" title="No sessions yet" body="Finished sessions land here." />}
        contentContainerStyle={{ padding: S.pad, paddingTop: tool.padTop, paddingBottom: 40 + insets.bottom }}
        renderSectionHeader={({ section }) => (
          <View style={[st.dayHead, { backgroundColor: bgFor(theme) }]}>
            <Text style={T.kicker} accessibilityRole="header">{section.title}</Text>
            <Text style={T.caption}>{sessionLength(section.total)}</Text>
          </View>
        )}
        renderItem={({ item, index, section }) => (
          <SessionRow
            s={item} first={index === 0} last={index === section.data.length - 1} enter={firstPaint.current}
            hour24={hour24} onDelete={remove}
          />
        )}
      />
    </ScreenBG>
  );
}

const st = StyleSheet.create({
  week: { marginBottom: S.gap },
  barGap: { marginTop: S.gap },
  barHead: { flexDirection: 'row', alignItems: 'baseline', marginBottom: 7 },
  barName: { flex: 1, minWidth: 0, color: C.text, fontFamily: F.med, fontSize: 14, letterSpacing: TRACK.small, marginRight: 10 },
  barValue: { color: C.textDim, fontFamily: F.reg, fontSize: 13, letterSpacing: TRACK.small, fontVariant: ['tabular-nums'] },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  // a sticky day spans the whole width, so the card's side shadows pass under it instead of beside it
  dayHead: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline',
    marginHorizontal: -S.pad, paddingHorizontal: S.pad, paddingTop: 14, paddingBottom: 8,
  },
  row: { paddingVertical: 12 },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { color: C.text, fontFamily: F.semi, fontSize: 14, letterSpacing: TRACK.small },
});
