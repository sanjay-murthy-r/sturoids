import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, InteractionManager, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  FadeIn, FadeOut, ZoomIn, ZoomOut, runOnJS, useAnimatedStyle, useSharedValue, withSpring,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { C, F, MIN, S, T, neuInset } from '../../src/theme';
import { useStore, QuickItem, FocusSession, Habit, PlannerWeek } from '../../src/store';
import { uid, fmtDate, todayKey, dayName, DAY_NAMES, toMinutes, fmtClockTime, daysUntil } from '../../src/utils';
import {
  ScreenBG, Card, SectionTitle, CheckCircle, Sheet, Field, PillButton, EmptyState, Row, Hairline, Chip, IconBtn,
  ListCard, ListRow, ProgressBar, StrikeText, useTheme,
} from '../../src/components/UI';
import { CountUp, Enter, Bouncy, Pop, RISE_OUT, useAnimLevel, useFocusKey } from '../../src/components/Motion';
import { tap } from '../../src/haptics';
import { ROUTE_CATALOG, launchExternal, siteHost, siteName, siteUrl } from '../../src/quickAccess';
import { ToolKey, colorOf, toolByKey } from '../../src/tools';
import { openTool } from '../../src/toolNav';
import { useGreeting } from '../../src/greeting';
import { useIntro } from '../../src/intro';
import { journalDayFor } from '../../src/journal';
import { indexScores, upcoming, groupSummary, fmtPct, fromToday } from '../../src/scores';
import { useNow } from '../../src/hooks/useNow';
import { TWO_COL_AT, WIDE_AT, WIDE_MAX, columnWidth } from '../../src/layout';

// what the greeting is told about a tool that is archived: nothing, so it never speaks of what the user put away
const NO_SESSIONS: FocusSession[] = [];
const NO_HABITS: Habit[] = [];
const NO_PLAN = {} as PlannerWeek;


/** A shortcut to an archived tool stays in the saved list but is not shown. */
const hiddenTile = (q: QuickItem, archived: ReadonlySet<string>) => q.kind === 'tool' && archived.has(q.target);

export default function Today() {
  const insets = useSafeAreaInsets();
  const fk = useFocusKey();
  const router = useRouter();
  const theme = useTheme();
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const dailyTasks = useStore((s) => s.dailyTasks);
  const toggleDaily = useStore((s) => s.toggleDaily);
  const missions = useStore((s) => s.missions);
  const toggleMission = useStore((s) => s.toggleMission);
  const habits = useStore((s) => s.habits);
  const toggleHabitToday = useStore((s) => s.toggleHabitToday);
  const planner = useStore((s) => s.planner);
  const sessions = useStore((s) => s.sessions);
  const quickAccess = useStore((s) => s.quickAccess);
  const journal = useStore((s) => s.journal);
  const noteCount = useStore((s) => s.notes.length);
  const videoCount = useStore((s) => s.vaultVideos.length);
  const deepWork = useStore((s) => s.deepWork);
  const scores = useStore((s) => s.scores);
  const setQuickAccess = useStore((s) => s.setQuickAccess);

  const [nameSheet, setNameSheet] = useState(false);
  const [nameDraft, setNameDraft] = useState(settings.name);
  const [qaEdit, setQaEdit] = useState(false);
  const [qaAddSheet, setQaAddSheet] = useState(false);
  const [siteDraft, setSiteDraft] = useState('');
  const [siteLabel, setSiteLabel] = useState('');
  const [siteError, setSiteError] = useState('');
  // the day's column, known ahead on a wide window (so two columns appear on the first frame), then measured
  const { width: dayWinW } = useWindowDimensions();
  const [areaW, setAreaW] = useState(() => columnWidth(dayWinW, true, WIDE_MAX));
  // the quick-access grid is laid out before the list decides the columns, so it estimates with the same width rule
  const twoColEst = areaW >= TWO_COL_AT;
  const now = useNow();

  const today = todayKey();

  // an archived tool steps out of Today entirely: its sections, its glance and its shortcuts
  const archived = useMemo(() => new Set<string>(settings.archivedTools), [settings.archivedTools]);
  const hideTasks = archived.has('tasks');
  const hidePlanner = archived.has('planner');
  const hideFocus = archived.has('focus');
  const hideJournal = archived.has('journal');
  const visibleQuick = useMemo(() => quickAccess.filter((q) => !hiddenTile(q, archived)), [quickAccess, archived]);

  // a deadline falls due as the day turns, so today is part of the answer
  const dueMissions = useMemo(
    () => missions.filter((m) => !m.done && daysUntil(m.deadline) <= 0),
    [missions, today]
  );
  const tasksLeft = dailyTasks.filter((t) => t.doneOn !== today).length + dueMissions.length;
  const habitsDone = habits.filter((h) => h.doneDates.includes(today)).length;
  const focusToday = Math.round(
    sessions.filter((s) => s.dateKey === today).reduce((a, s) => a + s.netSeconds, 0) / 60
  );

  // Worked out each minute, but the result keeps its identity while it is the same block with the same tag, so a new
  // minute re-renders only the text that shows the time, never the shortcuts that read the next block.
  const nextBlockNow = useMemo(() => {
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const dToday = dayName(now);
    const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
    const dTomorrow = dayName(tomorrow);
    const sorted = (d: typeof dToday) =>
      [...(planner[d] || [])].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
    // today's block comes first at any hour, so a late study block is never skipped for tomorrow's plan
    const current = sorted(dToday).find((b) => toMinutes(b.start) <= nowMin && toMinutes(b.end) > nowMin);
    if (current) return { block: current, tag: 'NOW' };
    const next = sorted(dToday).find((b) => toMinutes(b.start) > nowMin);
    if (next) return { block: next, tag: 'NEXT UP' };
    const first = sorted(dTomorrow)[0];
    if (first) return { block: first, tag: 'TOMORROW' };
    return null;
  }, [planner, now]);
  const nextBlockKey = nextBlockNow ? nextBlockNow.block.id + ':' + nextBlockNow.tag : '';
  const nextBlock = useMemo(() => nextBlockNow, [nextBlockKey, planner]);

  const weekBars = useMemo(() => {
    const out: { label: string; mins: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = todayKey(d);
      const mins = Math.round(sessions.filter((s) => s.dateKey === key).reduce((a, s) => a + s.netSeconds, 0) / 60);
      out.push({ label: DAY_NAMES[(d.getDay() + 6) % 7][0], mins });
    }
    return out;
  }, [sessions]);
  const maxMins = Math.max(30, ...weekBars.map((b) => b.mins));
  const weekTotal = weekBars.reduce((a, b) => a + b.mins, 0);

  const todayList = useMemo(() => [
    ...dailyTasks.map((t) => ({ kind: 'daily' as const, id: t.id, title: t.title, done: t.doneOn === today })),
    ...dueMissions.map((m) => ({ kind: 'mission' as const, id: m.id, title: m.title, done: m.done })),
  ], [dailyTasks, dueMissions, today]);
  const doneCount = todayList.filter((t) => t.done).length;

  const greeting = useGreeting({
    now, name: settings.name,
    sessions: hideFocus ? NO_SESSIONS : sessions,
    habits: hidePlanner ? NO_HABITS : habits,
    planner: hidePlanner ? NO_PLAN : planner,
    listTotal: hideTasks ? 0 : todayList.length,
    listDone: hideTasks ? 0 : doneCount,
    nextBlock: hidePlanner ? null : nextBlock,
  });

  // a quiet reminder of the Journal's page for today, never shown while the journal is locked
  const journalDay = journalDayFor(now, settings.journalCutoffHour);
  const journalNudge = !hideJournal && !settings.journalLocked && !journal.some((e) => e.dateKey === journalDay);

  // what a shortcut's wide tile says: a live fact about its tool. A shortcut with nothing to say stays a small tile,
  // and every tool always says the same kind of thing, so live changes never reshuffle the grid.
  const quickMetas = useMemo(() => {
    const count = (n: number, one: string, many: string) => n + ' ' + (n === 1 ? one : many);
    const dayEntries = journal.filter((e) => e.dateKey === journalDay);
    const out: Record<string, string | null> = {};
    for (const q of visibleQuick) {
      let meta: string | null = null;
      if (q.kind === 'tool') {
        switch (q.target as ToolKey) {
          case 'tasks':
            meta = todayList.length === 0 ? 'Nothing on the list' : tasksLeft ? count(tasksLeft, 'task left', 'tasks left') : 'All clear';
            break;
          case 'focus':
            meta = deepWork ? (deepWork.running ? 'Session running' : 'Session paused')
              : focusToday ? focusToday + ' min today' : 'No focus yet today';
            break;
          case 'planner':
            meta = !nextBlock ? 'Nothing planned'
              : nextBlock.tag === 'NOW' ? nextBlock.block.subject + ' now'
                : nextBlock.tag === 'TOMORROW' ? 'Tomorrow, ' + nextBlock.block.subject
                  : nextBlock.block.subject + ' at ' + fmtClockTime(toMinutes(nextBlock.block.start), settings.hour24);
            break;
          case 'notes':
            // locked Notes say nothing about what they hold
            meta = settings.notesLocked ? 'Locked' : noteCount ? count(noteCount, 'note', 'notes') : 'No notes yet';
            break;
          case 'journal':
            // a locked journal says nothing about its pages
            meta = settings.journalLocked ? 'Locked'
              : dayEntries.length ? count(dayEntries.reduce((a, e) => a + e.wordCount, 0), 'word', 'words')
                : journalDay === today ? "Today's page is empty" : "Yesterday's page is empty";
            break;
          case 'vault':
            meta = videoCount ? count(videoCount, 'lecture saved', 'lectures saved') : 'No lectures yet';
            break;
          case 'scores': {
            // the next exam coming up says the most; failing that, how the latest one went
            const ix = indexScores(scores);
            const next = upcoming(ix, null, today)[0];
            if (next) {
              meta = (next.title || 'An exam') + ' ' + fromToday(next.date as string, today).toLowerCase();
            } else {
              const sum = groupSummary(ix, null);
              meta = sum ? 'Latest ' + fmtPct(sum.latest.pct) : 'No exams yet';
            }
            break;
          }
        }
      } else if (q.kind === 'url') {
        // the address, so two shortcuts to one site's pages read apart
        meta = siteHost(q.target) || null;
      }
      out[q.id] = meta;
    }
    return out;
  }, [visibleQuick, todayList.length, tasksLeft, deepWork, focusToday, nextBlock, noteCount, videoCount, journal, journalDay, today,
    scores, settings.journalLocked, settings.notesLocked, settings.hour24]);

  // the grid's callbacks keep their identity, so the grid (and its drag gestures) re-renders only for its own changes
  const runQuick = useCallback((q: QuickItem) => {
    if (qaEdit) return;
    if (q.kind === 'tool') openTool(q.target as ToolKey);
    else if (q.kind === 'route') router.push(q.target as any);
    else launchExternal(q);
  }, [qaEdit, router]);
  const removeQuick = useCallback((id: string) => {
    setQuickAccess(useStore.getState().quickAccess.filter((q) => q.id !== id));
  }, [setQuickAccess]);
  // the grid reorders only what it shows: hidden tiles keep their places in the saved list, so restoring an archived
  // tool brings its shortcut back where it was
  const reorderQuick = useCallback((nextVisible: QuickItem[]) => {
    const { quickAccess: full, settings: s } = useStore.getState();
    const hidden = new Set<string>(s.archivedTools);
    if (full.filter((q) => !hiddenTile(q, hidden)).length !== nextVisible.length) return;
    let i = 0;
    setQuickAccess(full.map((q) => (hiddenTile(q, hidden) ? q : nextVisible[i++])));
  }, [setQuickAccess]);
  const openQaAdd = useCallback(() => {
    setSiteDraft('');
    setSiteLabel('');
    setSiteError('');
    setQaAddSheet(true);
  }, []);
  const addQuick = (item: Omit<QuickItem, 'id'>) => {
    if (quickAccess.some((q) => q.kind === item.kind && q.target === item.target)) return false;
    setQuickAccess([...quickAccess, { ...item, id: uid() }]);
    return true;
  };
  const addSite = () => {
    const url = siteUrl(siteDraft);
    if (!url) {
      setSiteError(siteDraft.trim() ? 'That is not a web address. Try something like khanacademy.org' : "Type the site's address first.");
      return;
    }
    if (!addQuick({ label: siteLabel.trim() || siteName(url), icon: 'globe-outline', color: 'teal', kind: 'url', target: url })) {
      setSiteError('That site is already in quick access.');
      return;
    }
    setSiteDraft(''); setSiteLabel(''); setSiteError('');
    setQaAddSheet(false);
  };

  // once the intro has gone and the screen is still, the other tabs are built one at a time, so a first visit
  // never waits for a screen to be made and nothing is built out of sight while the intro plays
  const navigation = useNavigation();
  const introDone = useIntro((s) => s.phase === 'done');
  useEffect(() => {
    if (!introDone) return undefined;
    const names = ['slot1', 'slot2', 'slot3', 'more'];
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const next = (i: number) => {
      if (!live || i >= names.length) return;
      InteractionManager.runAfterInteractions(() => {
        if (!live) return;
        try {
          (navigation as any).preload?.(names[i]);
        } catch {
          // a navigator that cannot preload builds the tab on its first visit instead
        }
        timer = setTimeout(() => next(i + 1), 700);
      });
    };
    timer = setTimeout(() => next(0), 1000);
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [introDone]);

  // the sections, placed in one column on a phone (and a tablet held upright), in two on a wide window
  const greetingBlock = (
        <Enter index={0}>
          <Pressable onPress={() => { setNameDraft(settings.name); setNameSheet(true); }}>
            <Text style={T.kicker}>{fmtDate(now)}</Text>
            <Text style={[T.display, { marginTop: 8, marginBottom: greeting.sub ? 6 : 24 }]}>
              {greeting.parts.map((part, i) => (
                <Text key={i} style={part.name ? { color: C.accent } : undefined}>{part.text}</Text>
              ))}
            </Text>
            {greeting.sub ? <Text style={[T.label, { marginBottom: 24 }]}>{greeting.sub}</Text> : null}
          </Pressable>
        </Enter>
  );

  const noBlocksToday = !nextBlock && !(planner[dayName(now)] || []).length;
  const planBlock = hidePlanner || (!nextBlock && !noBlocksToday) ? null : (
      <>
        {nextBlock && !hidePlanner && (
          <Enter index={1}>
            <Card hero pad={16} onPress={() => openTool('planner')}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Row style={{ flex: 1 }}>
                  <View style={[st.blockBar, { backgroundColor: nextBlock.block.color }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={T.title} numberOfLines={1}>{nextBlock.block.subject}</Text>
                    <Text style={[T.caption, { marginTop: 2, fontVariant: ['tabular-nums'] }]}>
                      {fmtClockTime(toMinutes(nextBlock.block.start), settings.hour24)} – {fmtClockTime(toMinutes(nextBlock.block.end), settings.hour24)}
                    </Text>
                  </View>
                </Row>
                <View style={[st.tagPill, { borderColor: C.accent + '55', backgroundColor: C.accent + '18' }]}>
                  <Text style={[st.tagText, { color: C.accent }]}>{nextBlock.tag}</Text>
                </View>
              </Row>
            </Card>
          </Enter>
        )}
        {!hidePlanner && !nextBlock && !(planner[dayName(now)] || []).length ? (
          <Enter index={1}>
            <Pressable
              onPress={() => openTool('planner')}
              style={[
                st.journalNudge,
                { marginTop: 0, marginBottom: S.gap },
                theme === 'minimal' ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border } : { backgroundColor: C.inset, ...neuInset('low') },
              ]}
            >
              <Ionicons name="calendar-outline" size={17} color={C.textFaint} />
              <Text style={st.journalNudgeText}>No blocks planned today</Text>
              <Text style={[st.link, { color: C.accent }]}>Plan</Text>
            </Pressable>
          </Enter>
        ) : null}
      </>
  );

  const glanceBlock = hideTasks && hidePlanner && hideFocus ? null : (
          <Enter index={2}>
            <Card pad={0}>
              <Row>
                {[
                  hideTasks ? null : <Glance key="tasks" value={tasksLeft} label="tasks left" color={C.accent} />,
                  hidePlanner ? null : <Glance key="habits" value={habitsDone} total={habits.length} label="habits" color={C.green} />,
                  hideFocus ? null : <Glance key="focus" value={focusToday} suffix=" min" label="focused" color={C.accent} />,
                ].filter(Boolean).map((cell, i) => (
                  <React.Fragment key={(cell as React.ReactElement).key}>
                    {i > 0 ? <View style={st.vDivider} /> : null}
                    {cell}
                  </React.Fragment>
                ))}
              </Row>
            </Card>
          </Enter>
  );

  const quickBlock = (
      <>
        <Enter index={3}>
          <SectionTitle
            right={
              <Pressable onPress={() => setQaEdit(!qaEdit)} hitSlop={8}>
                <Text style={[st.link, { color: C.accent }]}>{qaEdit ? 'Done' : 'Edit'}</Text>
              </Pressable>
            }
          >
            Quick access
          </SectionTitle>
        </Enter>
        <Enter index={3}>
          <QuickGrid
            items={visibleQuick}
            metas={quickMetas}
            edit={qaEdit}
            onRun={runQuick}
            onRemove={removeQuick}
            onReorder={reorderQuick}
            onAdd={openQaAdd}
            estimateW={twoColEst ? (areaW - S.pad * 2 - 28) / 2 : areaW - S.pad * 2}
          />
        </Enter>
      </>
  );

  const journalBlock = journalNudge ? (
          <Enter index={4}>
            <Pressable
              onPress={() => openTool('journal')}
              style={[
                st.journalNudge,
                theme === 'minimal' ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border } : { backgroundColor: C.inset, ...neuInset('low') },
              ]}
            >
              <Ionicons name="journal-outline" size={17} color={C.gold} />
              <Text style={st.journalNudgeText}>{journalDay === today ? "Today's page is empty" : "Yesterday's page is empty"}</Text>
              <Text style={[st.link, { color: C.gold }]}>Write</Text>
            </Pressable>
          </Enter>
  ) : null;

  const listBlock = hideTasks ? null : (
          <>
            <Enter index={4}>
              <SectionTitle
                right={
                  <Pressable onPress={() => openTool('tasks')} hitSlop={8}>
                    <Text style={[st.link, { color: C.accent }]}>All tasks →</Text>
                  </Pressable>
                }
              >
                Today {todayList.length > 0 ? '· ' + doneCount + '/' + todayList.length : ''}
              </SectionTitle>
              <View style={{ marginTop: 2, marginBottom: 16 }}>
                <ProgressBar value={doneCount / Math.max(1, todayList.length)} />
              </View>
            </Enter>
            <Enter index={4}>
              {todayList.length === 0 ? (
                <Card pad={6}>
                  <EmptyState compact icon="checkbox-outline" title="Nothing on the list yet" body="Add ToDos from Tasks." actionLabel="Open Tasks" onAction={() => openTool('tasks')} />
                </Card>
              ) : (
                <TodayList items={todayList} onToggleDaily={toggleDaily} onToggleMission={toggleMission} />
              )}
            </Enter>
          </>
  );

  const habitsBlock = habits.length > 0 && !hidePlanner && (
          <Enter index={5}>
            <SectionTitle>Habits</SectionTitle>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {habits.map((h) => {
                const done = h.doneDates.includes(today);
                return (
                  <Chip
                    key={h.id}
                    icon={done ? 'checkmark-circle' : 'ellipse-outline'}
                    label={h.title}
                    active={done}
                    color={C.green}
                    onPress={() => toggleHabitToday(h.id)}
                    small
                  />
                );
              })}
            </View>
          </Enter>
  );

  const weekBlock = hideFocus ? null : (
          <>
            <Enter index={6}>
              <SectionTitle>Focus this week</SectionTitle>
            </Enter>
            <Enter index={6}>
              <Card>
                <Row style={{ alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: 4 }}>
                  {weekBars.map((b, i) => (
                    <WeekBar key={i} label={b.label} mins={b.mins} maxMins={maxMins} isToday={i === 6} />
                  ))}
                </Row>
                <Hairline />
                <Text style={[T.caption, { textAlign: 'center', marginTop: 10 }]}>
                  {weekTotal > 0 ? (
                    <>
                      <CountUp value={weekTotal} style={{ color: C.accent, fontFamily: F.semi }}> min</CountUp> focused in the last 7 days
                    </>
                  ) : 'No focus logged this week yet.'}
                </Text>
              </Card>
            </Enter>
          </>
  );

  // two columns once a wide window gives the day room for them: what is planned and what is left on the left, the
  // shortcuts, the journal, habits and the week on the right
  const twoCol = areaW >= TWO_COL_AT && !!listBlock;
  return (
    <ScreenBG guard maxWidth={WIDE_MAX}>
      <ScrollView
        key={fk}
        onLayout={(e) => setAreaW(e.nativeEvent.layout.width)}
        contentContainerStyle={{ padding: S.pad, paddingTop: insets.top + 20, paddingBottom: 44 }}
        showsVerticalScrollIndicator={false}
      >
        {greetingBlock}
        {twoCol ? (
          <>
            {planBlock && glanceBlock ? (
              <View style={st.pair}>
                <View style={st.col}>{planBlock}</View>
                <View style={st.col}>{glanceBlock}</View>
              </View>
            ) : planBlock || glanceBlock}
            <View style={st.pair}>
              <View style={st.col}>{listBlock}</View>
              <View style={st.col}>{quickBlock}{journalBlock}{habitsBlock}{weekBlock}</View>
            </View>
          </>
        ) : (
          <>
            {planBlock}
            {glanceBlock}
            {quickBlock}
            {journalBlock}
            {listBlock}
            {habitsBlock}
            {weekBlock}
          </>
        )}
      </ScrollView>

      <Sheet visible={nameSheet} onClose={() => setNameSheet(false)} title="Your name">
        <Field value={nameDraft} onChangeText={setNameDraft} placeholder="What should the greeting call you?" autoFocus />
        <PillButton label="Save" onPress={() => { setSetting('name', nameDraft.trim()); setNameSheet(false); }} />
      </Sheet>

      <Sheet visible={qaAddSheet} onClose={() => setQaAddSheet(false)} title="Add to quick access">
        <Text style={st.sheetSection}>In-app</Text>
        <Row style={{ flexWrap: 'wrap' }}>
          {ROUTE_CATALOG.filter((r) => !(r.kind === 'tool' && archived.has(r.target)) && !quickAccess.some((q) => q.kind === r.kind && q.target === r.target)).map((r) => (
            <Chip key={r.kind + r.target} label={r.label} color={colorOf(r.color)} onPress={() => addQuick(r)} />
          ))}
        </Row>
        <Text style={st.sheetSection}>A website</Text>
        <Field
          label="Address" value={siteDraft} autoCapitalize="none" autoCorrect={false} keyboardType="url"
          onChangeText={(t) => { setSiteDraft(t); if (siteError) setSiteError(''); }}
          placeholder="khanacademy.org"
        />
        <Row style={{ alignItems: 'flex-end' }}>
          <Field
            label="Name" value={siteLabel} onChangeText={setSiteLabel}
            placeholder={siteUrl(siteDraft) ? siteName(siteUrl(siteDraft) as string) : 'Optional'}
            style={{ flex: 1, marginBottom: 0 }} returnKeyType="done" onSubmitEditing={addSite}
          />
          <PillButton small label="Add" style={{ marginLeft: 12 }} onPress={addSite} />
        </Row>
        <Text style={[T.caption, { marginTop: 10, color: siteError ? C.danger : C.textFaint }]}>
          {siteError || 'Opens in your default browser.'}
        </Text>
      </Sheet>
    </ScreenBG>
  );
}

function Glance({ value, total, label, color, suffix }: { value: number; total?: number; label: string; color: string; suffix?: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', paddingVertical: 16 }}>
      {total === 0 ? (
        <Text style={[st.glanceValue, { color }]}>–</Text>
      ) : (
        <CountUp value={value} style={[st.glanceValue, { color }]}>
          {total != null ? '/' + total : null}
          {suffix ? <Text style={{ fontSize: 13, fontFamily: F.semi }}>{suffix}</Text> : null}
        </CountUp>
      )}
      <Text style={st.glanceLabel}>{label}</Text>
    </View>
  );
}

/** Carved vertical trough with a sprung fill rising from the bottom. */
const BAR_SPRING = { damping: 20, stiffness: 240, mass: 0.8 };

/* ---------------- quick access: a bento of wide and small tiles, hold to drag ---------------- */
const QA_COLS = 4;
const QA_GAP = 8;
const QA_ROW_H = 80;
const QA_ADD_H = 52;

interface QaRect { x: number; y: number; w: number }

/** a wide window gives each column at least this much, so tiles keep a phone's proportions */
const QA_MIN_W = 88;

/**
 * Packs tiles into rows of `cols` columns (four on a phone), in their order: a shortcut with something to say spans two
 * columns, the rest one. A row that cannot take the next tile, and the last row, widen their own small tiles into the
 * gap, and a tile alone on the last row spans it, so no row ends with a hole.
 */
function packTiles(spans: number[], colW: number, cols: number): QaRect[] {
  const cells: { col: number; row: number; span: number }[] = [];
  let row = 0;
  let used = 0;
  let start = 0;
  const close = () => {
    const line = cells.slice(start);
    let gap = cols - used;
    if (line.length === 1) {
      line[0].span = cols;
      gap = 0;
    }
    for (let i = line.length - 1; i >= 0 && gap > 0; i--) {
      if (line[i].span === 1) { line[i].span = 2; gap--; }
    }
    let col = 0;
    for (const c of line) { c.col = col; col += c.span; }
  };
  spans.forEach((span) => {
    if (used + span > cols) {
      close();
      row++;
      used = 0;
      start = cells.length;
    }
    cells.push({ col: used, row, span });
    used += span;
  });
  if (cells.length) close();
  return cells.map((c) => ({
    x: c.col * (colW + QA_GAP),
    y: c.row * (QA_ROW_H + QA_GAP),
    w: c.span * colW + (c.span - 1) * QA_GAP,
  }));
}

function QuickTile({ q, meta, index, rect, wide, rects, isDragging, onDragState, onCross, onDrop, onRun, edit, onRemove, fadeIn }: {
  q: QuickItem; meta: string | null; index: number; rect: QaRect; wide: boolean; rects: SharedValue<QaRect[]>;
  isDragging: boolean; onDragState: (id: string) => void; onCross: (id: string, idx: number) => void; onDrop: () => void;
  onRun: (q: QuickItem) => void; edit: boolean; onRemove: (id: string) => void; fadeIn: boolean;
}) {
  const theme = useTheme();
  const level = useAnimLevel();
  const x = useSharedValue(rect.x);
  const y = useSharedValue(rect.y);
  const w = useSharedValue(rect.w);
  const sx = useSharedValue(0);
  const sy = useSharedValue(0);
  const lift = useSharedValue(0);
  const over = useSharedValue(-1);

  // live refs — the pan worklet is memoized, so JS callbacks go through here
  const idxRef = React.useRef(index); idxRef.current = index;
  const crossRef = React.useRef(onCross); crossRef.current = onCross;
  const dropRef = React.useRef(onDrop); dropRef.current = onDrop;
  const dragStateRef = React.useRef(onDragState); dragStateRef.current = onDragState;
  const crossStable = React.useCallback((id: string, idx: number) => {
    if (idx !== idxRef.current) crossRef.current(id, idx);
  }, []);
  const dropStable = React.useCallback(() => dropRef.current(), []);
  const dragStable = React.useCallback((id: string) => dragStateRef.current(id), []);

  React.useEffect(() => {
    // while dragging, the finger owns the tile: its place and its width both hold still until it lands, so a tile
    // that is about to change span never grows under the finger
    if (isDragging) return;
    if (level === 'none') {
      x.value = rect.x; y.value = rect.y; w.value = rect.w;
    } else {
      x.value = withSpring(rect.x, RISE_OUT);
      y.value = withSpring(rect.y, RISE_OUT);
      w.value = withSpring(rect.w, RISE_OUT);
    }
  }, [rect.x, rect.y, rect.w, isDragging, level]);

  // 420ms: long enough that a lingering tap never rearranges by accident,
  // short enough to still feel like a standard launcher hold-to-drag
  const pan = React.useMemo(() => Gesture.Pan()
    .activateAfterLongPress(420)
    .onStart(() => {
      lift.value = withSpring(1, RISE_OUT);
      sx.value = x.value; sy.value = y.value;
      over.value = -1;
      runOnJS(tap)();
      runOnJS(dragStable)(q.id);
    })
    .onUpdate((e) => {
      x.value = sx.value + e.translationX;
      y.value = sy.value + e.translationY;
      // the slot under the tile's centre, away from that slot's edges, so a tile that changes span on the move
      // never lands on a spot that sends it straight back
      const cx = x.value + w.value / 2;
      const cy = y.value + QA_ROW_H / 2;
      const rs = rects.value;
      let hit = -1;
      for (let i = 0; i < rs.length; i++) {
        const r = rs[i];
        const mx = r.w * 0.2;
        if (cx > r.x + mx && cx < r.x + r.w - mx && cy > r.y + QA_ROW_H * 0.2 && cy < r.y + QA_ROW_H * 0.8) {
          hit = i;
          break;
        }
      }
      if (hit !== over.value) {
        over.value = hit;
        if (hit >= 0) runOnJS(crossStable)(q.id, hit);
      }
    })
    .onFinalize(() => {
      lift.value = withSpring(0, RISE_OUT);
      runOnJS(dropStable)();
    }), [q.id]);

  const aStyle = useAnimatedStyle(() => ({
    width: w.value,
    transform: [
      { translateX: x.value },
      { translateY: y.value },
      { scale: 1 + lift.value * 0.05 },
    ] as const,
  }));

  const icon = (q.kind === 'tool' ? toolByKey(q.target)?.icon || q.icon : q.icon) as any;
  // neutral tiles: the colour lives only in the icon
  const surface = theme === 'minimal'
    ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border }
    : { backgroundColor: C.inset };

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[st.qaTile, { zIndex: isDragging ? 10 : 0, elevation: isDragging ? 10 : 0 }, aStyle]}>
        <Animated.View
          style={st.qaFill}
          entering={fadeIn && level !== 'none' ? FadeIn.duration(220) : undefined}
          // a removed shortcut shrinks away while the others slide into its place
          exiting={level === 'none' ? undefined : ZoomOut.duration(180)}
        >
          <Bouncy
            onPress={() => onRun(q)}
            radius={18}
            scaleTo={0.97}
            style={[st.qaFace, wide ? st.qaWide : st.qaSmall, wide && !meta && { justifyContent: 'center' }, wide && edit && { paddingRight: 26 }, surface]}
          >
            {wide ? (
              <>
                <Row>
                  <Ionicons name={icon} size={20} color={colorOf(q.color)} />
                  <Text style={st.qaLabel} numberOfLines={1}>{q.label}</Text>
                </Row>
                {meta ? <Text style={st.qaMeta} numberOfLines={2}>{meta}</Text> : null}
              </>
            ) : (
              <>
                <Ionicons name={icon} size={22} color={colorOf(q.color)} />
                <Text style={st.qaSmallLabel} numberOfLines={1}>{q.label}</Text>
              </>
            )}
          </Bouncy>
          {edit ? (
            <Animated.View
              entering={level === 'none' ? undefined : ZoomIn.duration(200)}
              exiting={level === 'none' ? undefined : ZoomOut.duration(140)}
              style={st.qaX}
            >
              <IconBtn name="close-circle" size={18} color={C.danger} pad={4} onPress={() => onRemove(q.id)} accessibilityLabel={'Remove ' + q.label} />
            </Animated.View>
          ) : null}
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

type TodayItem = { kind: 'daily' | 'mission'; id: string; title: string; done: boolean };

/** Today's list. Its own component, so the minute changing on Today leaves the rows alone. */
const TodayList = React.memo(function TodayList({ items, onToggleDaily, onToggleMission }: {
  items: TodayItem[]; onToggleDaily: (id: string) => void; onToggleMission: (id: string) => void;
}) {
  return (
    <ListCard>
      {items.map((t) => (
        <ListRow key={t.kind + t.id}>
          <CheckCircle
            done={t.done}
            color={t.kind === 'mission' ? C.amber : C.green}
            onPress={() => (t.kind === 'daily' ? onToggleDaily(t.id) : onToggleMission(t.id))}
            label={t.title}
          />
          <StrikeText done={t.done} style={st.taskText} wrapStyle={st.taskWrap} numberOfLines={1}>{t.title}</StrikeText>
          {t.kind === 'mission' && (
            <View style={st.missionPill}><Text style={st.missionPillText}>DUE</Text></View>
          )}
        </ListRow>
      ))}
    </ListCard>
  );
});

const QuickGrid = React.memo(function QuickGrid({ items, metas, edit, onRun, onRemove, onReorder, onAdd, estimateW }: {
  items: QuickItem[]; metas: Record<string, string | null>; edit: boolean; onRun: (q: QuickItem) => void;
  onRemove: (id: string) => void; onReorder: (items: QuickItem[]) => void; onAdd: () => void;
  /** the grid's width before it has measured itself: its column of Today */
  estimateW?: number;
}) {
  const { width: winW } = useWindowDimensions();
  const level = useAnimLevel();
  // the grid measures its own room (a column of Today on a wide window); until it has, it assumes the phone's
  const [boxW, setBoxW] = useState(0);
  const avail = boxW || estimateW || winW - S.pad * 2;
  // a phone always has four columns; a wide window fits as many as keep the tiles in a phone's proportions
  const cols = winW >= WIDE_AT ? Math.max(QA_COLS, Math.floor((avail + QA_GAP) / (QA_MIN_W + QA_GAP))) : QA_COLS;
  const colW = (avail - QA_GAP * (cols - 1)) / cols;
  const [dragId, setDragId] = useState<string | null>(null);
  const spanKey = items.map((q) => (metas[q.id] ? 2 : 1)).join('');
  const layout = useMemo(() => packTiles(spanKey.split('').map(Number), colW, cols), [spanKey, colW, cols]);
  // the drag worklets read the packed slots from here, so a reorder never rebuilds a gesture mid-drag
  const rects = useSharedValue<QaRect[]>(layout);
  useEffect(() => { rects.value = layout; }, [layout]);
  // shortcuts added after the first paint fade in; the grid's own entrance covers the first paint
  const painted = React.useRef(false);
  useEffect(() => { painted.current = true; }, []);

  // an empty grid always offers Add, so quick access never looks like nothing
  const showAdd = edit || items.length === 0;
  const tilesH = layout.length ? Math.max(...layout.map((r) => r.y)) + QA_ROW_H : 0;
  const addY = tilesH ? tilesH + QA_GAP : 0;
  const height = showAdd ? addY + QA_ADD_H : tilesH;
  const reorder = (id: string, idx: number) => {
    const from = items.findIndex((it) => it.id === id);
    if (from < 0 || idx === from || idx >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(idx, 0, moved);
    onReorder(next);
  };
  return (
    <View style={{ height, marginBottom: 6 }} onLayout={(e) => setBoxW(e.nativeEvent.layout.width)}>
      {items.map((q, i) => (
        <QuickTile
          key={q.id} q={q} meta={metas[q.id] ?? null} index={i} rect={layout[i]} wide={layout[i].w > colW + 1} rects={rects}
          isDragging={dragId === q.id}
          onDragState={setDragId}
          onCross={reorder}
          onDrop={() => setDragId(null)}
          onRun={onRun} edit={edit} onRemove={onRemove} fadeIn={painted.current}
        />
      ))}
      {showAdd && (
        <Animated.View
          entering={level === 'none' ? undefined : FadeIn.duration(200)}
          exiting={level === 'none' ? undefined : FadeOut.duration(140)}
          style={[st.qaAddWrap, { top: addY }]}
        >
          <Bouncy onPress={onAdd} radius={18} scaleTo={0.985} style={[st.qaAdd, { borderColor: C.borderBright }]}>
            <Ionicons name="add" size={18} color={C.textDim} />
            <Text style={st.qaAddText}>Add shortcut</Text>
          </Bouncy>
        </Animated.View>
      )}
    </View>
  );
});

function WeekBar({ label, mins, maxMins, isToday }: {
  label: string; mins: number; maxMins: number; isToday: boolean;
}) {
  const theme = useTheme();
  const level = useAnimLevel();
  const target = Math.max(4, (mins / maxMins) * 56);
  const h = useSharedValue(target);
  React.useEffect(() => {
    h.value = level === 'none' ? target : withSpring(target, BAR_SPRING);
  }, [target, level]);
  // a full-height fill rises from the trough floor: a transform, never a height
  const fillStyle = useAnimatedStyle(() => ({ transform: [{ translateY: 56 - h.value }] }));
  const fillColor = isToday ? C.accent : C.slate + '73';
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      {mins > 0 && (
        <Pop dep={mins}>
          <Text style={st.barValue}>{mins}</Text>
        </Pop>
      )}
      <View
        style={[
          st.barTrough,
          theme === 'minimal'
            ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border }
            : { backgroundColor: C.inset, ...neuInset('hairline') },
        ]}
      >
        <Animated.View
          style={[
            {
              width: '100%', height: 56, borderRadius: 8, backgroundColor: fillColor,
            },
            fillStyle,
          ]}
        />
      </View>
      <Text style={[st.barLabel, isToday && { color: C.accent, fontFamily: F.semi }]}>{label}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  pair: { flexDirection: 'row', alignItems: 'flex-start', gap: 28 },
  col: { flex: 1, minWidth: 0 },
  blockBar: { width: 4, height: 34, borderRadius: 2, marginRight: 12 },
  // accent colours are applied inline at the call site: a StyleSheet freezes
  // C.accent at import time and would never follow an accent change
  tagPill: {
    borderWidth: 1,
    borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, marginLeft: 10,
  },
  tagText: { fontFamily: F.bold, fontSize: 11, letterSpacing: 1.2 },
  vDivider: { width: StyleSheet.hairlineWidth, backgroundColor: C.hairline, alignSelf: 'stretch', marginVertical: 12 },
  glanceValue: { ...T.numStat },
  glanceLabel: { color: C.textFaint, fontFamily: F.med, fontSize: 11, marginTop: 3, letterSpacing: 0.4 },
  qaTile: { position: 'absolute', left: 0, top: 0, height: QA_ROW_H },
  qaFill: { flex: 1 },
  qaFace: { flex: 1, borderRadius: 18 },
  qaWide: { padding: 12, justifyContent: 'space-between' },
  qaSmall: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  qaLabel: { flex: 1, marginLeft: 8, color: C.text, fontFamily: F.med, fontSize: 13 },
  qaSmallLabel: { maxWidth: '100%', marginTop: 6, color: C.textDim, fontFamily: F.med, fontSize: 11 },
  qaMeta: { color: C.textFaint, fontFamily: F.reg, fontSize: 12, lineHeight: 15 },
  qaX: { position: 'absolute', top: 1, right: 1 },
  qaAddWrap: { position: 'absolute', left: 0, right: 0, height: QA_ADD_H },
  qaAdd: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 18, borderWidth: 1, borderStyle: 'dashed',
  },
  qaAddText: { color: C.textDim, fontFamily: F.med, fontSize: 13 },
  link: { fontFamily: F.semi, fontSize: 13 },
  journalNudge: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 14, paddingHorizontal: 16, borderRadius: S.radiusSm, marginTop: 18, marginBottom: 4,
  },
  journalNudgeText: { flex: 1, color: C.textDim, fontFamily: F.med, fontSize: 14 },
  taskWrap: { flex: 1, marginLeft: 12 },
  taskText: { color: C.text, fontFamily: F.reg, fontSize: 15, letterSpacing: 0.1 },
  missionPill: {
    backgroundColor: C.amber + '1C', borderColor: C.amber + '55', borderWidth: 1,
    borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, marginLeft: 8,
  },
  missionPillText: { color: C.amber, fontFamily: F.bold, fontSize: 11, letterSpacing: 1 },
  barValue: { color: C.textFaint, fontFamily: F.med, fontSize: 11, marginBottom: 4, fontVariant: ['tabular-nums'] },
  barLabel: { color: C.textFaint, fontFamily: F.med, fontSize: 11, marginTop: 7 },
  barTrough: {
    width: 16, height: 56, borderRadius: 8,
    overflow: 'hidden', justifyContent: 'flex-end',
  },
  sheetSection: {
    color: C.textFaint, fontFamily: F.semi, fontSize: 11,
    textTransform: 'uppercase', letterSpacing: 1.6, marginTop: 14, marginBottom: 8,
  },
});
