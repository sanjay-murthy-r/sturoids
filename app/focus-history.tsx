import React from 'react';
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { C, F, MIN, S, T, TRACK, bgFor } from '../src/theme';
import { useStore } from '../src/store';
import type { FocusSession } from '../src/store';
import { fmtClockTime, focusMinutesByDay, focusStreak, todayKey, yesterdayKey } from '../src/utils';
import {
  ArrivalPulse, Card, Chip, EmptyState, Field, IconBtn, ListRow, ListSlice, PillButton, Row, ScreenBG, SectionTitle, Sheet,
  contextLine, useTheme, useToolHeader,
} from '../src/components/UI';
import { monthRange, useExport } from '../src/reports';
import { Enter, FadeSwap } from '../src/components/Motion';
import { toast } from '../src/components/Toast';
import { JournalCalendar } from '../src/components/JournalCalendar';
import { SubjectSuggest } from '../src/components/SubjectSuggest';
import { useToday } from '../src/hooks/useNow';
import { tap, tick } from '../src/haptics';
import { fmtMins, sessionDay, sessionLength } from '../src/screens/FocusScreen';
import { monthGrid, shiftMonthKey } from '../src/toolLogic';
import { openSessionEditor } from '../src/components/SessionEditor';

/** The list the header's scroll offset follows: Reanimated hands the offset to its handler on the UI thread. */
const AnimatedSectionList = Animated.createAnimatedComponent(SectionList) as typeof SectionList;

/** what a week's bar is called when its sessions had no subject */
const NO_SUBJECT = 'No subject';
/** the daily goals offered, in minutes; 0 is no goal */
const GOALS = [0, 30, 60, 90, 120, 180];
/** the lengths offered when logging a session by hand */
const QUICK_MIN = [25, 50, 90];
/** the longest session logged or edited by hand (the store's own limit) */
const MAX_MIN = 720;
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** The Monday that starts the week of `today` (a day key), as a day key: weeks run Monday to Sunday, as the Planner's do. */
function weekStart(today: string): string {
  const d = new Date(today + 'T00:00:00');
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return todayKey(d);
}

const monthName = (month: string) => new Date(month + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

interface DayGroup { key: string; title: string; total: number; data: FocusSession[] }

/** One logged session in the history, with its delete key. Memoised: deleting one row repaints only its neighbours. */
const SessionRow = React.memo(function SessionRow({ s, first, last, enter, hour24, arrive, onEdit, onDelete }: {
  s: FocusSession; first: boolean; last: boolean; enter: boolean; hour24: boolean; arrive: boolean;
  onEdit: (s: FocusSession) => void; onDelete: (id: string) => void;
}) {
  const ended = new Date(s.endedAt);
  const at = fmtClockTime(ended.getHours() * 60 + ended.getMinutes(), hour24);
  const title = sessionLength(s.netSeconds) + (s.subject ? ' · ' + s.subject : '');
  const how = s.rating === 3 ? 'Deep' : s.rating === 2 ? 'Steady' : s.rating === 1 ? 'Scattered' : '';
  const caption = [
    s.manual ? 'Logged by hand' : 'Ended ' + at, how, (s.tags ?? []).join(', '), s.taskTitles.join(', '), s.note ?? '',
  ].filter(Boolean).join(' · ');
  // settled as the row mounts: a row of the first screenful rises with the page, and later renders never take it back
  const [rise] = React.useState(enter);
  return (
    <ListSlice first={first} last={last} enter={rise}>
      <View>
        <ListRow style={st.row} onPress={() => onEdit(s)} accessibilityHint="Opens its details, to change them">
          <View style={st.rowText} accessible accessibilityLabel={title + ', ' + caption}>
            <Text style={st.rowTitle} numberOfLines={1}>{title}</Text>
            <Text style={[T.caption, { marginTop: 2 }]} numberOfLines={1}>{caption}</Text>
          </View>
          <IconBtn name="trash-outline" size={18} onPress={() => onDelete(s.id)} accessibilityLabel={'Delete ' + title} />
        </ListRow>
        <ArrivalPulse active={arrive} radius={12} />
      </View>
    </ListSlice>
  );
});

/**
 * Every Deep Work session, opened from Deep Work's "See all" (or Sift, at one session: `session`, which is scrolled to
 * and pulses once). At the top, the daily goal with its streak, the month at a glance, and this week's focus per
 * subject; under them, the sessions by day, newest first. A session is logged by hand ("Log a session") or changed by
 * tapping it; a delete can be taken back from its toast.
 */
export default function FocusHistoryPage() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const router = useRouter();
  const sessions = useStore((s) => s.sessions);
  const hour24 = useStore((s) => s.settings.hour24);
  const goal = useStore((s) => s.settings.focusGoalMin) || 0;
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
    // and per tag: a session counts once under each of its tags
    const byTag = new Map<string, { k: string; name: string; secs: number }>();
    for (const s of sessions) {
      if (s.dateKey < from || s.dateKey > today) continue;
      for (const t of s.tags ?? []) {
        const k = t.toLowerCase();
        const had = byTag.get(k);
        if (had) { had.secs += s.netSeconds; had.name = t; } else byTag.set(k, { k, name: t, secs: s.netSeconds });
      }
    }
    const tagRows = [...byTag.values()].sort((a, b) => b.secs - a.secs);
    return {
      rows, total: rows.reduce((a, r) => a + r.secs, 0), max: rows.length ? rows[0].secs : 0,
      tagRows, tagMax: tagRows.length ? tagRows[0].secs : 0,
    };
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

  // minutes per day, for the month and the streak; a day counts for the streak once it meets the goal (any focus without one)
  const perDay = React.useMemo(() => focusMinutesByDay(sessions), [sessions]);
  const streak = React.useMemo(() => focusStreak(sessions, goal > 0 ? goal : 1), [sessions, goal]);

  const remove = React.useCallback((id: string) => {
    const gone = useStore.getState().removeSession(id);
    if (!gone) return;
    toast('Session deleted', { label: 'Undo', onPress: () => useStore.getState().restoreSession(gone.session, gone.index) });
  }, []);

  // ---- logging and editing ----
  const [logOpen, setLogOpen] = React.useState(false);
  // a session's details open in the session editor, the same one a saved session's toast opens
  const openEdit = React.useCallback((s: FocusSession) => { tick(); openSessionEditor(s.id); }, []);

  // ---- arriving at one session (Sift, Deep Work's recent rows) ----
  const params = useLocalSearchParams<{ session?: string }>();
  const listRef = React.useRef<SectionList<FocusSession, DayGroup>>(null);
  const [arrive, setArrive] = React.useState<string | null>(null);
  // the session being arrived at, for the second step of a scroll that missed (read in the list's callback)
  const arriveRef = React.useRef<string | null>(null);
  const daysRef = React.useRef(days);
  daysRef.current = days;
  const scrollToSession = React.useCallback((id: string) => {
    const list = daysRef.current;
    const sectionIndex = list.findIndex((d) => d.data.some((s) => s.id === id));
    if (sectionIndex < 0) return;
    const itemIndex = list[sectionIndex].data.findIndex((s) => s.id === id);
    // item 0 of a section is its header: rows are counted from 1
    listRef.current?.scrollToLocation({ sectionIndex, itemIndex: itemIndex + 1, viewPosition: 0.4, animated: true });
  }, []);
  useFocusEffect(React.useCallback(() => {
    const id = params.session;
    if (!id) return undefined;
    router.setParams({ session: undefined } as any);
    if (!useStore.getState().sessions.some((s) => s.id === id)) return undefined;
    // once the page has laid out its first rows
    arriveRef.current = id;
    const t = setTimeout(() => { scrollToSession(id); setArrive(id); }, 350);
    // the second step gets one chance, not every later scroll
    const done = setTimeout(() => { if (arriveRef.current === id) arriveRef.current = null; }, 1500);
    return () => { clearTimeout(t); clearTimeout(done); };
  }, [params.session]));
  React.useEffect(() => {
    if (!arrive) return undefined;
    const t = setTimeout(() => setArrive(null), 2000);
    return () => clearTimeout(t);
  }, [arrive]);

  const allSecs = React.useMemo(() => sessions.reduce((a, s) => a + s.netSeconds, 0), [sessions]);
  const allMin = Math.round(allSecs / 60);
  // the month in view (read when exporting, after it is declared below)
  const exp = useExport('focus', () => ({ range: 'custom', ...monthRange(month, today) }));
  const tool = useToolHeader({ scrollRef: listRef,
    title: 'Sessions',
    mode: 'page',
    // how many there are and how long they come to; nothing at all with none
    context: contextLine(
      sessions.length > 0 && sessions.length + (sessions.length === 1 ? ' session' : ' sessions'),
      allMin > 0 && fmtMins(allMin) + ' in all',
    ),
    actions: [{ icon: 'add', label: 'Log a session', onPress: () => setLogOpen(true) }, exp.action],
  });

  // ---- the month ----
  const [month, setMonth] = React.useState(() => today.slice(0, 7));
  const thisMonth = today.slice(0, 7);
  const grid = React.useMemo(() => monthGrid(month), [month]);
  const monthMax = React.useMemo(() => {
    let m = 0;
    for (const w of grid) for (const k of w) if (k) m = Math.max(m, perDay.get(k) || 0);
    return m;
  }, [grid, perDay]);
  const monthTotal = React.useMemo(() => grid.flat().reduce((a, k) => a + (k ? perDay.get(k) || 0 : 0), 0), [grid, perDay]);
  // a day's tint: up to the goal (or the month's best day without one), so a day at the goal reads full
  const scale = goal > 0 ? goal : Math.max(1, monthMax);
  const openDay = (key: string) => {
    const at = daysRef.current.findIndex((d) => d.key === key);
    if (at < 0) return;
    tick();
    listRef.current?.scrollToLocation({ sectionIndex: at, itemIndex: 0, viewPosition: 0, animated: true });
  };

  const track = theme === 'minimal' ? MIN.inset : C.inset;
  const streakLine = streak.current > 0 || streak.best > 0
    ? [
      streak.current > 0 ? streak.current + (streak.current === 1 ? ' day' : ' days') + (goal > 0 ? ' at your goal' : ' in a row') : '',
      streak.best > streak.current ? 'best ' + streak.best : streak.best > 1 && streak.current === streak.best ? 'your best yet' : '',
    ].filter(Boolean).join(' · ')
    : '';
  const head = (
    <Enter index={0}>
      {tool.hero}

      <SectionTitle>Daily goal</SectionTitle>
      <Card>
        <View style={st.goalChips}>
          {GOALS.map((g) => (
            <Chip
              key={g} small label={g ? fmtMins(g) : 'Off'} active={goal === g}
              onPress={() => { tick(); useStore.getState().setSetting('focusGoalMin', g); }}
            />
          ))}
        </View>
        <FadeSwap swapKey={streakLine + '|' + goal}>
          <Text style={[T.caption, { marginTop: 10 }]}>
            {streakLine
              ? (streakLine.charAt(0).toUpperCase() + streakLine.slice(1))
              : goal > 0 ? 'A day counts once its sessions add up to ' + fmtMins(goal) + '.' : 'Set a goal and Today shows how close you are.'}
          </Text>
        </FadeSwap>
      </Card>

      <SectionTitle
        right={(
          <Row style={{ gap: 2 }}>
            <IconBtn name="chevron-back" size={18} pad={6} onPress={() => { tick(); setMonth(shiftMonthKey(month, -1)); }} accessibilityLabel="The month before" />
            <IconBtn
              name="chevron-forward" size={18} pad={6} color={month >= thisMonth ? C.textFaint : C.textDim}
              onPress={() => { if (month < thisMonth) { tick(); setMonth(shiftMonthKey(month, 1)); } }}
              accessibilityLabel="The month after"
            />
          </Row>
        )}
      >
        {monthName(month)}
      </SectionTitle>
      <Card>
        <View style={st.weekRow}>
          {WEEKDAYS.map((d, i) => <Text key={i} style={st.weekday}>{d}</Text>)}
        </View>
        {grid.map((w, wi) => (
          <View key={wi} style={st.weekRow}>
            {w.map((k, di) => {
              if (!k) return <View key={di} style={st.cell} />;
              const min = perDay.get(k) || 0;
              const met = goal > 0 && min >= goal;
              const future = k > today;
              return (
                <Pressable
                  key={k} style={st.cell} disabled={!min} onPress={() => openDay(k)}
                  accessibilityRole={min ? 'button' : undefined}
                  accessibilityLabel={new Date(k + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long' }) + (min ? ', ' + fmtMins(min) : '')}
                >
                  <View
                    style={[
                      st.dayDot,
                      { backgroundColor: min ? C.accent : track, opacity: min ? 0.25 + 0.75 * Math.min(1, min / scale) : future ? 0.4 : 1 },
                      met && { borderWidth: 1.5, borderColor: C.accent },
                    ]}
                  />
                  <Text style={[st.dayNum, k === today && { color: C.accent }, future && { color: C.textFaint }]}>
                    {Number(k.slice(8))}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ))}
        <Text style={[T.caption, { marginTop: 8 }]}>
          {monthTotal > 0 ? fmtMins(monthTotal) + ' this month' + (goal > 0 ? '. A ring marks a day at your goal.' : '') : 'Nothing focused this month.'}
        </Text>
      </Card>

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
      {week.tagRows.length > 0 ? (
        <View style={st.week}>
          <SectionTitle>This week by tag</SectionTitle>
          <Card>
            {week.tagRows.map((r, i) => (
              <View key={'t:' + r.k} style={i > 0 ? st.barGap : undefined} accessible accessibilityLabel={r.name + ', ' + sessionLength(r.secs)}>
                <View style={st.barHead}>
                  <Text style={st.barName} numberOfLines={1}>{r.name}</Text>
                  <Text style={st.barValue}>{sessionLength(r.secs)}</Text>
                </View>
                <View style={[st.track, { backgroundColor: track }]}>
                  <View style={[st.fill, { width: `${Math.max(2, Math.round((r.secs / week.tagMax) * 100))}%`, backgroundColor: C.amber }]} />
                </View>
              </View>
            ))}
          </Card>
        </View>
      ) : null}
      <View style={st.logRow}>
        <PillButton small label="Log a session" icon="add" onPress={() => setLogOpen(true)} />
      </View>
    </Enter>
  );

  return (
    <ScreenBG>
      {tool.bar}
      <AnimatedSectionList
        ref={listRef as any}
        sections={days}
        keyExtractor={(s) => s.id}
        stickySectionHeadersEnabled
        {...tool.scrollProps}
        ListHeaderComponent={head}
        ListEmptyComponent={<EmptyState icon="time-outline" title="No sessions yet" body="Finished sessions land here, and so do the ones you log." />}
        contentContainerStyle={{ padding: S.pad, paddingTop: tool.padTop, paddingBottom: 40 + insets.bottom }}
        // a session far down the list is reached in two steps: near it first, then to it once its rows exist
        onScrollToIndexFailed={(info) => {
          listRef.current?.getScrollResponder()?.scrollTo({ y: info.averageItemLength * info.index, animated: false });
          const id = arriveRef.current;
          arriveRef.current = null;
          if (id) setTimeout(() => scrollToSession(id), 120);

        }}
        renderSectionHeader={({ section }) => (
          <View style={[st.dayHead, { backgroundColor: bgFor(theme) }]}>
            <Text style={T.kicker} accessibilityRole="header">{section.title}</Text>
            <Text style={T.caption}>{sessionLength(section.total)}</Text>
          </View>
        )}
        renderItem={({ item, index, section }) => (
          <SessionRow
            s={item} first={index === 0} last={index === section.data.length - 1} enter={firstPaint.current}
            hour24={hour24} arrive={arrive === item.id} onEdit={openEdit} onDelete={remove}
          />
        )}
      />

      <LogSheet visible={logOpen} onClose={() => setLogOpen(false)} today={today} />
      {exp.sheet}
    </ScreenBG>
  );
}

/** Minutes as typed: a whole number from 1 to 720, or null. */
const minutesOf = (raw: string) => {
  const n = parseInt(raw.replace(/[^\d]/g, ''), 10);
  return n >= 1 && n <= MAX_MIN ? n : null;
};

/**
 * Logging a session by hand: the day (today, yesterday or one picked, never ahead), how long, and its subject, which
 * offers the ones the app knows. It joins the history and the streak as any session does, marked as logged by hand.
 */
function LogSheet({ visible, onClose, today }: { visible: boolean; onClose: () => void; today: string }) {
  const [day, setDay] = React.useState(today);
  const [calendar, setCalendar] = React.useState(false);
  const [minutes, setMinutes] = React.useState('');
  const [subject, setSubject] = React.useState('');
  const [problem, setProblem] = React.useState('');
  const said = React.useRef<null | (() => void)>(null);
  React.useEffect(() => {
    if (!visible) return;
    setDay(today); setCalendar(false); setMinutes(''); setSubject(''); setProblem('');
  }, [visible]);
  const yesterday = yesterdayKey();
  const save = () => {
    const min = minutesOf(minutes);
    if (min == null) { setProblem('Minutes from 1 to 720, like 45.'); return; }
    const id = useStore.getState().addManualSession({ dateKey: day, minutes: min, subject });
    if (!id) { setProblem('That day is still to come. Pick today or a day before.'); return; }
    tap();
    said.current = () => toast('Logged ' + fmtMins(min), {
      label: 'Undo', onPress: () => { useStore.getState().removeSession(id); },
    });
    onClose();
  };
  return (
    <Sheet
      visible={visible} onClose={onClose} title="Log a session"
      onClosed={() => { const s = said.current; said.current = null; s?.(); }}
    >
      <Text style={st.label}>Day</Text>
      <View style={st.goalChips}>
        <Chip small label="Today" active={day === today && !calendar} onPress={() => { setDay(today); setCalendar(false); }} />
        <Chip small label="Yesterday" active={day === yesterday && !calendar} onPress={() => { setDay(yesterday); setCalendar(false); }} />
        <Chip small icon="calendar-outline" label={day !== today && day !== yesterday ? sessionDay(day) : 'Pick a day'} active={calendar || (day !== today && day !== yesterday)} onPress={() => setCalendar(!calendar)} />
      </View>
      {calendar ? (
        <View style={{ marginTop: 12 }}>
          <JournalCalendar value={day} maxKey={today} onPick={(k) => { setDay(k); setCalendar(false); }} />
        </View>
      ) : null}
      <Text style={[st.label, { marginTop: 20 }]}>How long</Text>
      <Row style={{ alignItems: 'flex-end', gap: 12 }}>
        <Field
          value={minutes} onChangeText={(v) => { setMinutes(v); setProblem(''); }} placeholder="Minutes" keyboardType="number-pad"
          maxLength={3} style={{ width: 110, marginBottom: 0, fontVariant: ['tabular-nums'] }} accessibilityLabel="Minutes"
        />
        <View style={[st.goalChips, { flex: 1 }]}>
          {QUICK_MIN.map((m) => (
            <Chip key={m} small label={fmtMins(m)} active={minutesOf(minutes) === m} onPress={() => { setMinutes(String(m)); setProblem(''); }} />
          ))}
        </View>
      </Row>
      <Field
        label="Subject" value={subject} onChangeText={setSubject} placeholder="Like Physics (optional)" maxLength={60}
        style={{ marginTop: 20, marginBottom: 0 }}
      />
      <SubjectSuggest value={subject} max={5} onPick={setSubject} style={{ marginTop: 10 }} />
      {problem ? <Text style={st.problem}>{problem}</Text> : null}
      <PillButton label="Log it" icon="checkmark" onPress={save} style={{ marginTop: 22 }} />
    </Sheet>
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
  goalChips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  weekRow: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', color: C.textFaint, fontFamily: F.smMed, fontSize: 11, letterSpacing: TRACK.fine, marginBottom: 6 },
  // each day a 44 dp target: its dot, and its date under it
  cell: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingVertical: 3 },
  dayDot: { width: 18, height: 18, borderRadius: 9 },
  dayNum: { color: C.textDim, fontFamily: F.med, fontSize: 11, marginTop: 3, fontVariant: ['tabular-nums'] },
  logRow: { flexDirection: 'row', marginTop: S.gap, marginBottom: 4 },
  label: { color: C.textFaint, fontFamily: F.smMed, fontSize: 12, letterSpacing: TRACK.fine, marginLeft: 2, marginBottom: 8 },
  problem: { color: C.danger, fontFamily: F.smMed, fontSize: 12, letterSpacing: TRACK.fine, lineHeight: 17, marginTop: 10 },
  // a sticky day spans the whole width, so the card's side shadows pass under it instead of beside it
  dayHead: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline',
    marginHorizontal: -S.pad, paddingHorizontal: S.pad, paddingTop: 14, paddingBottom: 8,
  },
  row: { paddingVertical: 12 },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { color: C.text, fontFamily: F.semi, fontSize: 14, letterSpacing: TRACK.small },
});
