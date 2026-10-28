import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { C, CHROME_FONT_MAX, F, S, T, TRACK, BLOCK_COLORS } from '../theme';
import { useStore, PlannerBlock, PlannerWeek, Habit } from '../store';
import {
  DAY_NAMES, DayName, dayName, toMinutes, fmtClockTime, todayKey, streaks, indexAfterNeighbours, blockOnNow, cleanDays,
  daysLabel, habitDueOn,
} from '../utils';
import { indexScores, topExams } from '../scores';
import { openScoreNode } from '../scoresNav';
import { useSubjects } from '../subjects';
import { blockFocusParams, clashIn, colorForSubject, fmtDayShort, nextDateOf, repeatsOf } from '../blocks';
import { ALL_DAYS, DayToggles, toggledDay } from '../components/DayToggles';
import { toastTrashed } from '../trashToast';
import { useBringIntoView } from '../hooks/useBringIntoView';
import { useNow, useToday } from '../hooks/useNow';
import { habitSince } from '../journal';
import {
  ScreenBG, SectionTitle, Sheet, Field, PillButton, EmptyState, Row, Chip, IconBtn, CheckCircle, useTheme, useToolHeader,
  contextLine, ListCard, ListRow, TimeField, TimeWheel, Toggle, ArrivalPulse,
} from '../components/UI';
import { useExport } from '../reports';
import { defaultTime } from '../components/TimeWheel';
import { Ionicons } from '@expo/vector-icons';
import { Wheel } from '../components/Wheel';
import {
  Bouncy, CHANGE, EASE_OUT, Enter, FadeSwap, glide, rowIn, rowOut, useAnimLevel, useBuilt, useFocusKey, useLoop,
} from '../components/Motion';
import { slideIn, useSwapIn } from '../components/Swap';
import { tick } from '../haptics';
import { rescheduleAllReminders, turnOnReminders } from '../notifications';
import { openTool } from '../toolNav';
import { toast } from '../components/Toast';
import { TWO_COL_AT, WIDE_MAX, columnWidth } from '../layout';

const FULL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
/** a day's name in a sentence: the wheel shows the short one, a title, a toast or an alert says it in full */
const fullDay = (d: DayName) => FULL_DAYS[DAY_NAMES.indexOf(d)];
/** the wheel's labels, made once, so the wheel is never handed a new function on the minute */
const dayLabel = (i: number) => ({ full: FULL_DAYS[i], short: DAY_NAMES[i] });

/**
 * a stored HH:MM as the clock reads (12 or 24 hours, the setting's choice), and a block's end of 24:00 as midnight; a
 * time that cannot be read shows as saved
 */
const clock = (hhmm: string, hour24: boolean) => {
  const m = toMinutes(hhmm);
  return m < 0 ? hhmm : m >= 1440 ? 'midnight' : fmtClockTime(m, hour24);
};

/** minutes since midnight as 'HH:MM' (1440 is '24:00') */
const hhmmOf = (m: number) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');

/** each block colour's name, for a screen reader: a swatch is only a colour */
const COLOR_NAMES: Record<string, string> = {
  '#9DBCE3': 'Blue', '#9AD6B0': 'Green', '#E3C08D': 'Amber', '#E39EAC': 'Rose',
  '#745FF2': 'Violet', '#83DBD6': 'Teal', '#C2D392': 'Lime', '#D5C68E': 'Sand',
};

export function PlannerScreen({ mode }: { mode: 'tab' | 'stack' }) {
  const insets = useSafeAreaInsets();
  const fk = useFocusKey();
  const level = useAnimLevel();
  const built = useBuilt();
  useTheme(); // repaints on a new accent: the day and the NOW badge read it

  const planner = useStore((s) => s.planner);
  const removeBlock = useStore((s) => s.removeBlock);
  const restorePlanner = useStore((s) => s.restorePlanner);

  const habits = useStore((s) => s.habits);
  const toggleHabitToday = useStore((s) => s.toggleHabitToday);
  const toggleHabitDay = useStore((s) => s.toggleHabitDay);
  const trashHabit = useStore((s) => s.trashHabit);
  // a change made from a sheet says so once the sheet has gone, where its Undo can be seen
  const afterSheet = React.useRef<(() => void) | null>(null);
  const runAfterSheet = useCallback(() => { const f = afterSheet.current; afterSheet.current = null; f?.(); }, []);
  const hour24 = useStore((s) => s.settings.hour24);
  // the alerts ring only while reminders as a whole are on, so the bell looks on only then
  const alertsOn = useStore((s) => s.settings.blockAlerts && s.settings.remindersEnabled);
  // an archived Deep Work takes the way into it out of the blocks, as Today does
  const deepWork = useStore((s) => !(s.settings.archivedTools || []).includes('focus'));

  const [day, setDay] = useState<DayName>(dayName());
  const dayRef = React.useRef(day);
  dayRef.current = day;
  // which way the last day change went: the new day's blocks come in from that side
  const dayDir = React.useRef(0);
  const [blockSheet, setBlockSheet] = useState(false);
  const [editing, setEditing] = useState<PlannerBlock | null>(null);
  const [copySheet, setCopySheet] = useState(false);
  const [tplSheet, setTplSheet] = useState(false);
  const [habitSheet, setHabitSheet] = useState(false);
  const [habitEdit, setHabitEdit] = useState<Habit | null>(null);
  const [remindEdit, setRemindEdit] = useState<Habit | null>(null);

  const blocks = useMemo(
    () => [...planner[day]].sort((a, b) => toMinutes(a.start) - toMinutes(b.start)),
    [planner, day]
  );
  const today = useToday();
  // tick every 30s so the NOW badge appears/clears while the screen sits open
  const now = useNow();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const viewingToday = day === dayName();
  const dayIdx = DAY_NAMES.indexOf(day);
  const todayIdx = DAY_NAMES.indexOf(dayName(now));

  // the header speaks of today, whichever day the wheel is on. Of two blocks that overlap (allowed, on purpose), the one
  // that ends first is the one on now. Blocks cannot be ticked off, so there is no count of done ones to give.
  const todayBlocks = planner[dayName(now)] ?? [];
  const onNow = useMemo(() => blockOnNow(todayBlocks, nowMin), [todayBlocks, nowMin]);
  // with nothing on: the next block today, and once today's are over, where tomorrow starts
  const nextToday = useMemo(() => {
    let next: PlannerBlock | null = null;
    for (const b of todayBlocks) {
      if (toMinutes(b.start) > nowMin && (!next || toMinutes(b.start) < toMinutes(next.start))) next = b;
    }
    return next;
  }, [todayBlocks, nowMin]);
  const tomorrowBlocks = planner[dayName(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))] ?? [];
  const tomorrowFrom = useMemo(() => {
    const starts = tomorrowBlocks.map((b) => toMinutes(b.start)).filter((m) => m >= 0);
    return starts.length ? Math.min(...starts) : -1;
  }, [tomorrowBlocks]);

  // the blocks follow the wheel: the new day's blocks arrive from the side the new day came from. They are a new
  // view with its own entrance, so the old day's blocks never flash sideways before the new ones replace them.
  const goTo = useCallback((next: DayName) => {
    const from = DAY_NAMES.indexOf(dayRef.current);
    const i = DAY_NAMES.indexOf(next);
    if (i === from) return;
    dayDir.current = (i - from + 7) % 7 <= 3 ? 1 : -1;
    setDay(next);
  }, []);
  // The date a day was picked on. A day picked today holds for the rest of today; the tab stays built (Today preloads
  // it), so on a later day it goes back to that day's own instead of showing whichever day it was left on.
  const pickedOn = React.useRef(today);
  const pickDay = useCallback((i: number) => {
    const next = DAY_NAMES[i];
    if (!next) return;
    pickedOn.current = todayKey();
    goTo(next);
  }, [goTo]);
  const backToToday = useCallback(() => {
    const key = todayKey();
    if (pickedOn.current === key) return;
    pickedOn.current = key;
    goTo(dayName());
  }, [goTo]);
  useFocusEffect(backToToday);
  React.useEffect(() => { backToToday(); }, [today, backToToday]);

  // Arrivals from Sift: a day (`day`, Mon to Sun) and on it a block or a habit (`item`), brought into view with one
  // pulse; or the week templates (`sheet`). Each param is cleared once followed, so the same link works again. Declared
  // after the focus's way back to today, so an arrival's day wins over it.
  const params = useLocalSearchParams<{ day?: string; item?: string; sheet?: string }>();
  const router = useRouter();
  const [arrive, setArrive] = useState<string | null>(null);
  useFocusEffect(useCallback(() => {
    const clear: Record<string, undefined> = {};
    let target = (DAY_NAMES as readonly string[]).includes(params.day || '') ? params.day as DayName : undefined;
    if (params.day) clear.day = undefined;
    if (params.item) {
      // a block with no day given is found on its own day
      if (!target) {
        const week = useStore.getState().planner;
        target = DAY_NAMES.find((d) => (week[d] || []).some((b) => b.id === params.item));
      }
      setArrive(params.item);
      clear.item = undefined;
    }
    if (target) { pickedOn.current = todayKey(); goTo(target); }
    if (params.sheet === 'templates') { setTplSheet(true); clear.sheet = undefined; }
    if (Object.keys(clear).length) router.setParams(clear);
  }, [params.day, params.item, params.sheet, goTo]));
  // the pulse is given once; after it the same item can be arrived at again
  React.useEffect(() => {
    if (!arrive) return undefined;
    const t = setTimeout(() => setArrive(null), 2000);
    return () => clearTimeout(t);
  }, [arrive]);
  const dayIn = useMemo(
    () => (built.current ? slideIn(level, dayDir.current * 16) : undefined),
    [day, level]
  );
  // the first habit turning the empty note into a list, or the last one turning it back, swaps in place
  const habitsIn = useSwapIn(habits.length === 0 ? 'none' : 'list');

  // the way back to today fades in once you have moved off it, and out again when you return
  const away = dayIdx !== todayIdx;
  const todayLink = useSharedValue(away ? 1 : 0);
  React.useEffect(() => {
    todayLink.value = level === 'none' ? (away ? 1 : 0) : withTiming(away ? 1 : 0, CHANGE);
  }, [away, level]);
  const todayLinkStyle = useAnimatedStyle(() => ({ opacity: todayLink.value }));

  const openAdd = () => { setEditing(null); setBlockSheet(true); };
  const openEdit = useCallback((b: PlannerBlock) => { setEditing(b); setBlockSheet(true); }, []);

  // a deleted block can come back: the toast's Undo puts it back into its day beside the block it followed
  const deleteBlock = useCallback((b: PlannerBlock) => {
    const list = useStore.getState().planner[day] || [];
    const before = list.slice(0, Math.max(0, list.findIndex((x) => x.id === b.id))).map((x) => x.id);
    removeBlock(day, b.id);
    toast('Deleted ' + b.subject, {
      label: 'Undo',
      onPress: () => {
        const week = useStore.getState().planner;
        const cur = week[day] || [];
        if (cur.some((x) => x.id === b.id)) return;
        const next = [...cur];
        next.splice(indexAfterNeighbours(before, cur.map((x) => x.id)), 0, b);
        restorePlanner({ ...week, [day]: next });
      },
    });
  }, [day, removeBlock, restorePlanner]);

  // a habit goes to Recently deleted, streak and all; the toast's Undo puts it back where it was
  const deleteHabit = useCallback((h: Habit) => {
    const moved = toastTrashed(trashHabit(h.id), () => { void rescheduleAllReminders(); });
    // re-run the scheduler after the delete, or the habit's daily reminder keeps firing for a habit that is not here
    if (moved) void rescheduleAllReminders();
  }, [trashHabit]);

  const openHabit = useCallback((h: Habit | null) => { setHabitEdit(h); setHabitSheet(true); }, []);

  // The bell in the tray: on, a notification comes five minutes before each block. Turning it on with reminders off
  // asks for permission and turns them on; refused, it stays off, so the bell never looks on for alerts that cannot ring.
  const busyBell = React.useRef(false);
  const toggleAlerts = useCallback(async () => {
    if (busyBell.current) return;
    const { settings, setSetting } = useStore.getState();
    if (settings.blockAlerts && settings.remindersEnabled) {
      setSetting('blockAlerts', false);
      toast('Block alerts off');
      return;
    }
    busyBell.current = true;
    try {
      setSetting('blockAlerts', true);
      const ok = settings.remindersEnabled || await turnOnReminders();
      if (!ok) {
        useStore.getState().setSetting('blockAlerts', false);
        return;
      }
      toast('Block alerts on, 5 minutes before each block');
    } finally {
      busyBell.current = false;
    }
  }, []);

  const tabMode = mode === 'tab';
  // a sideways tablet sets the day's blocks and the streaks side by side; a phone keeps its one column exactly
  const { width: winW } = useWindowDimensions();
  const twoCol = columnWidth(winW, tabMode, WIDE_MAX) >= TWO_COL_AT;
  // the dot is for a block in progress this minute: nothing else says "now" in the header
  const anySheet = blockSheet || copySheet || tplSheet || habitSheet || !!remindEdit;
  const exp = useExport(['habits', 'planner'], { range: '30d' });
  const scrollRef = React.useRef<Animated.ScrollView>(null);
  const header = useToolHeader({ scrollRef,
    title: 'Planner',
    mode: tabMode ? 'tab' : 'page',
    // the header pull opens Sift only while the planner is calm: no sheet up over it
    pull: !anySheet,
    context: contextLine(
      onNow
        ? [{ em: onNow.subject }, ' until ' + clock(onNow.end, hour24)]
        : nextToday
          ? ['Next ', { em: nextToday.subject }, ' at ' + clock(nextToday.start, hour24)]
          : tomorrowFrom >= 0 && 'Tomorrow from ' + fmtClockTime(tomorrowFrom, hour24),
    ),
    live: onNow != null,
    // the bell stands in the tray, and the day's other actions fold under the overflow beside it
    actions: [
      {
        icon: alertsOn ? 'notifications' : 'notifications-outline',
        label: 'Block alerts',
        on: alertsOn,
        color: alertsOn ? C.accent : undefined,
        onPress: () => { void toggleAlerts(); },
      },
      { icon: 'copy-outline', label: 'Copy this day', onPress: () => setCopySheet(true) },
      { icon: 'albums-outline', label: 'Week templates', onPress: () => setTplSheet(true) },
      exp.action,
    ],
  });
  // a block or a habit Sift opened is brought into view
  const { topRef, bring } = useBringIntoView({
    scrollTo: (y, animated) => scrollRef.current?.scrollTo({ y, animated }),
    scrollY: header.scrollY, padTop: header.padTop, barH: header.barH, still: level === 'none',
  });

  // blocks: the day's own entrance is for a day change; the screen's rises with the rest, every visit
  const blocksPart = (
    <Enter index={1} style={twoCol ? st.col : undefined}>
      <Animated.View key={day} entering={dayIn}>
        <DayBlocks
          day={day} blocks={blocks} hour24={hour24} nowMin={viewingToday ? nowMin : -1} deepWork={deepWork}
          arrive={arrive} onArrive={bring} onEdit={openEdit} onDelete={deleteBlock}
        />
      </Animated.View>
      {/* the wheel names the day, so the button's label never changes while the blocks slide */}
      <PillButton label="Add block" icon="add" onPress={openAdd} style={{ marginTop: 4 }} />
    </Enter>
  );
  // in two columns the streaks' heading sits level with the top of the day's blocks
  const streaksPart = (
    <Enter index={2} style={twoCol ? [st.col, { marginTop: -S.section }] : undefined}>
      <SectionTitle
        right={
          <Pressable onPress={() => openHabit(null)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Add a habit">
            <Text style={{ color: C.accent, fontSize: 13, letterSpacing: TRACK.small, fontFamily: F.semi }}>+ Habit</Text>
          </Pressable>
        }
      >
        Streaks
      </SectionTitle>
      <Animated.View key={habits.length === 0 ? 'none' : 'list'} entering={habitsIn}>
        {habits.length === 0 ? (
          <EmptyState compact icon="repeat-outline" title="No habits yet" body="Habits for the days you choose, each with its streak." />
        ) : (
          <ListCard>
            {habits.map((h) => (
              <HabitRow
                key={h.id} h={h} today={today} hour24={hour24} arrive={arrive === h.id} onArrive={bring}
                onToggle={toggleHabitToday} onToggleDay={toggleHabitDay} onEdit={openHabit} onRemind={setRemindEdit}
                onDelete={deleteHabit}
              />
            ))}
          </ListCard>
        )}
      </Animated.View>
    </Enter>
  );

  return (
    <ScreenBG guard={tabMode} maxWidth={twoCol ? WIDE_MAX : undefined}>
      {header.bar}
      <Animated.ScrollView
        key={fk}
        ref={scrollRef}
        {...header.scrollProps}
        contentContainerStyle={{ padding: S.pad, paddingTop: header.padTop, paddingBottom: 44 + (tabMode ? 0 : insets.bottom) }}
        showsVerticalScrollIndicator={false}
      >
        <View ref={topRef} collapsable={false} />
        {/* the day: drag the wheel or tap a day beside it, and the blocks follow in the same direction. The header's
            hero rises with it, in the screen's first entrance */}
        <Enter index={0}>
          {header.hero}
          <View style={st.wheelWrap}>
            <Wheel
              loop
              count={7}
              index={dayIdx}
              onChange={pickDay}
              label={dayLabel}
              spacing={96}
              minScale={0.6}
              colorOn={C.accent}
              colorOff={C.textFaint}
              height={64}
              textStyle={st.dayText}
              accessibilityLabel="Day"
            />
            <DateLine dayIdx={dayIdx} today={today} />
            <Animated.View style={[st.todayLink, todayLinkStyle]} pointerEvents={away ? 'auto' : 'none'}>
              <Pressable onPress={() => pickDay(todayIdx)} disabled={!away} hitSlop={12} style={st.todayPress}>
                <Text style={[st.todayText, { color: C.accent }]}>Today</Text>
              </Pressable>
            </Animated.View>
          </View>
        </Enter>

        {twoCol ? (
          <View style={st.pair}>
            {blocksPart}
            {streaksPart}
          </View>
        ) : (
          <>
            {blocksPart}
            {streaksPart}
          </>
        )}
      </Animated.ScrollView>

      <BlockSheet
        visible={blockSheet} day={day} editing={editing} onClose={() => setBlockSheet(false)} onClosed={runAfterSheet}
        onSaved={(message, undo) => { afterSheet.current = () => toast(message, undo ? { label: 'Undo', onPress: undo } : undefined); }}
      />

      <CopySheet
        visible={copySheet}
        day={day}
        onClose={() => setCopySheet(false)}
        onClosed={runAfterSheet}
        onCopied={(label, before) => {
          afterSheet.current = () => toast('Copied ' + fullDay(day) + ' to ' + label, { label: 'Undo', onPress: () => restorePlanner(before) });
        }}
      />

      <TemplatesSheet
        visible={tplSheet}
        onClose={() => setTplSheet(false)}
        onClosed={runAfterSheet}
        onApplied={(name, before) => {
          afterSheet.current = () => toast('Applied ' + name + ' to the week', { label: 'Undo', onPress: () => restorePlanner(before) });
        }}
      />

      <HabitSheet visible={habitSheet} editing={habitEdit} onClose={() => setHabitSheet(false)} />

      <ReminderSheet habit={remindEdit} onClose={() => setRemindEdit(null)} />
      {exp.sheet}
    </ScreenBG>
  );
}

/**
 * The day's blocks. Built afresh for each day (the day's own entrance brings them in); on the same day, a first block
 * added to an empty day fades in rather than appearing in one frame.
 */
function DayBlocks({ day, blocks, hour24, nowMin, deepWork, arrive, onArrive, onEdit, onDelete }: {
  day: DayName; blocks: PlannerBlock[]; hour24: boolean;
  /** the minute of the day, when the day shown is today; -1 on any other day */
  nowMin: number;
  /** Deep Work is in use (not archived), so a block is a way into it */
  deepWork: boolean;
  /** the block or habit Sift opened, if any */
  arrive: string | null;
  onArrive: (view: View | null) => void;
  onEdit: (b: PlannerBlock) => void; onDelete: (b: PlannerBlock) => void;
}) {
  const level = useAnimLevel();
  const built = useBuilt();
  if (blocks.length === 0) {
    return <EmptyState compact icon="calendar-outline" title={'No blocks on ' + fullDay(day)} body="Add subjects with start and end times below." />;
  }
  return (
    <Animated.View entering={built.current ? rowIn(level) : undefined}>
      <ListCard>
        {blocks.map((b) => (
          <BlockRow
            key={b.id} b={b} hour24={hour24} deepWork={deepWork}
            isNow={nowMin >= 0 && toMinutes(b.start) <= nowMin && nowMin < toMinutes(b.end)}
            progress={nowMin >= 0 ? blockProgress(b, nowMin) : 0}
            past={nowMin >= 0 && toMinutes(b.end) <= nowMin}
            arrive={arrive === b.id} onArrive={onArrive}
            onEdit={onEdit} onDelete={onDelete}
          />
        ))}
      </ListCard>
      {/* said once for the list, not on every row */}
      {deepWork ? <Text style={st.blocksHint}>Tap a block to start Deep Work on it.</Text> : null}
    </Animated.View>
  );
}

/** How far a block has run at a minute of the day: 0 before it and after it, up to 1 at its end. */
function blockProgress(b: PlannerBlock, nowMin: number): number {
  const start = toMinutes(b.start);
  const end = toMinutes(b.end);
  if (!(end > start) || nowMin < start || nowMin >= end) return 0;
  return (nowMin - start) / (end - start);
}

/**
 * The block on now: a hairline along the foot of its row that fills as the block runs, a step each minute (the step
 * eases over 0.6 s with every animation on). Not a loop, only a living gauge; it takes no touches. Moves by transform.
 */
function BlockProgress({ progress }: { progress: number }) {
  const level = useAnimLevel();
  const [w, setW] = React.useState(0);
  const p = useSharedValue(progress);
  React.useEffect(() => {
    p.value = level === 'full' ? withTiming(progress, { duration: 600, easing: EASE_OUT }) : progress;
  }, [progress, level]);
  const fill = useAnimatedStyle(() => ({ transform: [{ translateX: (p.value - 1) * w }] }));
  return (
    <View
      pointerEvents="none" style={st.blockGauge} onLayout={(e) => setW(e.nativeEvent.layout.width)}
      importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
    >
      <Animated.View style={[st.blockGaugeFill, { backgroundColor: C.accent + '99' }, fill]} />
    </View>
  );
}

/** One block of the day. Memoised, so the minute turning re-renders only the block on now (its NOW badge and its gauge). */
const BlockRow = React.memo(function BlockRow({ b, hour24, isNow, progress, past, deepWork, arrive, onArrive, onEdit, onDelete }: {
  b: PlannerBlock; hour24: boolean; isNow: boolean;
  /** how far the block on now has run, 0 to 1; 0 for any other */
  progress: number;
  /** today's block that has ended: it steps back, so what is still to come stands out */
  past: boolean;
  deepWork: boolean;
  /** Sift opened this block: it is brought into view and pulses once */
  arrive: boolean;
  onArrive: (view: View | null) => void;
  onEdit: (b: PlannerBlock) => void; onDelete: (b: PlannerBlock) => void;
}) {
  useTheme(); // a memo row: it follows a new accent itself, since its props do not change with one
  const ref = useArrival(arrive, onArrive);
  const span = clock(b.start, hour24) + ' – ' + clock(b.end, hour24);
  const body = (
    <>
      <View style={[st.colorBar, { backgroundColor: b.color }]} />
      <View style={{ flex: 1 }}>
        <Text style={[T.title, past && { color: C.textDim }]}>{b.subject}</Text>
        <Text style={[T.caption, st.span]}>{span}</Text>
      </View>
      {isNow && (
        <View style={[st.nowPill, { borderColor: C.accent + '66', backgroundColor: C.accent + '1A' }]}>
          <Text style={[st.nowText, { color: C.accent }]}>NOW</Text>
        </View>
      )}
      <IconBtn name="create-outline" size={18} onPress={() => onEdit(b)} accessibilityLabel={'Edit ' + b.subject} />
      <IconBtn name="trash-outline" size={18} onPress={() => onDelete(b)} accessibilityLabel={'Delete ' + b.subject} />
      {isNow ? <BlockProgress progress={progress} /> : null}
    </>
  );
  const pulse = <ArrivalPulse active={arrive} radius={14} delay={PULSE_DELAY} />;
  if (!deepWork) {
    return (
      <View ref={ref} collapsable={false}>
        <ListRow style={{ paddingVertical: 12 }}>{body}</ListRow>
        {pulse}
      </View>
    );
  }
  // Deep Work opens set to the block's length, or to what is left of it while it is on
  const start = () => openTool('focus', blockFocusParams(b, isNow));
  // a list row's own shape and carve, with the name a screen reader needs
  return (
    <View ref={ref} collapsable={false}>
      <Bouncy
        onPress={start} scaleTo={1} sink={false} radius={14} style={st.blockRow}
        accessibilityRole="button" accessibilityLabel={'Start Deep Work on ' + b.subject + ', ' + span}
      >
        {body}
      </Bouncy>
      {pulse}
    </View>
  );
});

/**
 * A row a link opened: once it has laid out (and the day it is on has come in), the screen brings it into view, and
 * then it pulses once.
 */
function useArrival(arrive: boolean, onArrive: (view: View | null) => void) {
  const ref = React.useRef<View>(null);
  const cb = React.useRef(onArrive);
  cb.current = onArrive;
  React.useEffect(() => {
    if (!arrive) return undefined;
    const t = setTimeout(() => cb.current(ref.current), 320);
    return () => clearTimeout(t);
  }, [arrive]);
  return ref;
}

/** the pulse waits for the scroll that brings its row into view */
const PULSE_DELAY = 640;

/** at most this many of the date's parts under the wheel; the rest are counted */
const DATE_PARTS_MAX = 3;

/**
 * A quiet line under the wheel: the next date the picked weekday falls on, and what is due then, e.g.
 * "Fri 31 Oct · Chem mock · Lab report due". Each exam and long-term task in it opens itself. An archived tool's are
 * left out. Its own part, so the minute turning never re-renders it; the date turns over with `today`.
 */
const DateLine = React.memo(function DateLine({ dayIdx, today }: { dayIdx: number; today: string }) {
  useTheme(); // a memo part: its links are in the accent
  const scores = useStore((s) => s.scores);
  const missions = useStore((s) => s.missions);
  const archived = useStore((s) => s.settings.archivedTools);
  const date = useMemo(() => nextDateOf(dayIdx, new Date(today + 'T00:00:00')), [dayIdx, today]);
  const key = todayKey(date);
  const parts = useMemo(() => {
    const off = archived || [];
    const out: { id: string; label: string; open: () => void }[] = [];
    if (!off.includes('scores')) {
      for (const n of topExams(indexScores(scores))) {
        if (n.date !== key) continue;
        const id = n.id;
        out.push({ id, label: n.title.trim() || 'Exam', open: () => { openScoreNode(id); openTool('scores'); } });
      }
    }
    if (!off.includes('tasks')) {
      for (const m of missions) {
        if (m.done || m.deadline !== key) continue;
        const id = m.id;
        out.push({ id, label: (m.title.trim() || 'Task') + ' due', open: () => openTool('tasks', { item: id }) });
      }
    }
    return out;
  }, [scores, missions, archived, key]);
  const shown = parts.slice(0, DATE_PARTS_MAX);
  const more = parts.length - shown.length;
  return (
    <View style={st.dateLine}>
      <Text style={st.dateText} maxFontSizeMultiplier={CHROME_FONT_MAX}>{fmtDayShort(date)}</Text>
      {shown.map((p) => (
        <React.Fragment key={p.id}>
          <Text style={st.dateDot} importantForAccessibility="no" maxFontSizeMultiplier={CHROME_FONT_MAX}> · </Text>
          <Pressable onPress={p.open} hitSlop={12} accessibilityRole="link" accessibilityLabel={'Open ' + p.label} style={st.datePart}>
            <Text style={[st.dateText, { color: C.accent }]} numberOfLines={1} maxFontSizeMultiplier={CHROME_FONT_MAX}>{p.label}</Text>
          </Pressable>
        </React.Fragment>
      ))}
      {more > 0 ? (
        <Text style={st.dateText} maxFontSizeMultiplier={CHROME_FONT_MAX}>{' · ' + more + ' more'}</Text>
      ) : null}
    </View>
  );
});

/**
 * One habit with its streak, and its last seven days beneath. Memoised, and its streak is worked out only when its
 * dates, its weekdays or the day change, so ticking one habit re-renders that habit alone. The streak line never states
 * a zero: a habit with no streak yet shows none. A habit kept on some weekdays says which, and on a day it is not due it
 * reads as a rest day (its tick still counts). A long press opens it for editing.
 */
const HabitRow = React.memo(function HabitRow({ h, today, hour24, arrive, onArrive, onToggle, onToggleDay, onEdit, onRemind, onDelete }: {
  h: Habit; today: string; hour24: boolean;
  /** Sift opened this habit: it is brought into view and pulses once */
  arrive: boolean;
  onArrive: (view: View | null) => void;
  onToggle: (id: string) => void; onToggleDay: (id: string, dateKey: string) => void;
  onEdit: (h: Habit) => void; onRemind: (h: Habit) => void; onDelete: (h: Habit) => void;
}) {
  useTheme(); // a memo row: it follows a new accent itself, since its props do not change with one
  const ref = useArrival(arrive, onArrive);
  // the current streak counts back from today, so a new day can end it with no tick at all; rest days pass by
  const { current, best } = useMemo(() => streaks(h.doneDates, h.days), [h.doneDates, h.days, today]);
  const done = h.doneDates.includes(today);
  const due = habitDueOn(h, today);
  // a run of two or more that today could still end: its flame flickers until the tick lands
  const atRisk = due && !done && current >= 2;
  const daysText = h.days?.length ? daysLabel(h.days) : '';
  // a current streak that is also the best says so once
  const streakText = current > 0 && current === best
    ? current + ' current'
    : [current > 0 ? current + ' current' : '', best > 0 ? best + ' best' : ''].filter(Boolean).join(' · ');
  const time = h.remindTime ? clock(h.remindTime, hour24) : '';
  return (
    // the row holds its own tick, its week and its buttons, each reached on its own by a screen reader; the row itself
    // is the long press that edits it, and says so
    <View ref={ref} collapsable={false}>
      <ListRow style={st.habitRow} onLongPress={() => onEdit(h)} accessibilityHint="Double tap and hold to edit">
        <Row>
          <CheckCircle done={done} onPress={() => onToggle(h.id)} label={h.title + ', today' + (due ? '' : ', rest day')} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={[T.title, !due && { color: C.textDim }]}>{h.title}</Text>
            {!due || streakText || time || daysText ? (
              // the streak's figures dip and come back as the tick lands, instead of jumping. Each part keeps its icon with
              // it, so a narrow phone wraps the line between parts
              <FadeSwap swapKey={streakText + (due ? '' : '|rest')}>
                <View style={st.subLine}>
                  {!due ? <Text style={T.caption}>Rest day</Text> : null}
                  {streakText ? (
                    <View style={st.subPart}>
                      <Flame atRisk={atRisk} />
                      <Text style={T.caption}>{streakText}</Text>
                    </View>
                  ) : null}
                  {time ? (
                    <View style={st.subPart}>
                      <Ionicons name="alarm-outline" size={13} color={C.textFaint} style={st.subIcon} />
                      <Text style={T.caption}>{time}</Text>
                    </View>
                  ) : null}
                  {daysText ? (
                    <View style={st.subPart}>
                      <Ionicons name="calendar-outline" size={13} color={C.textFaint} style={st.subIcon} />
                      <Text style={[T.caption, st.subText]}>{daysText}</Text>
                    </View>
                  ) : null}
                </View>
              </FadeSwap>
            ) : null}
          </View>
          <IconBtn
            name="alarm-outline" size={18}
            color={time ? C.accent : C.textFaint}
            onPress={() => onRemind(h)}
            accessibilityLabel={time ? 'Reminder at ' + time : 'Set a reminder'}
          />
          <IconBtn name="trash-outline" size={18} onPress={() => onDelete(h)} accessibilityLabel={'Delete ' + h.title} />
        </Row>
        <WeekStrip id={h.id} title={h.title} doneDates={h.doneDates} days={h.days} today={today} onToggleDay={onToggleDay} />
      </ListRow>
      <ArrivalPulse active={arrive} radius={14} delay={PULSE_DELAY} />
    </View>
  );
});

/**
 * A streak's flame. With the streak at risk (due today, not ticked yet, a run of two or more) it flickers very gently,
 * opacity and a hair of scale, until the tick lands; useLoop keeps it still with less motion, out of view or with the
 * app in the background.
 */
function Flame({ atRisk }: { atRisk: boolean }) {
  const flicker = useLoop(atRisk, 1800);
  const style = useAnimatedStyle(() => ({
    opacity: 1 - 0.4 * flicker.value,
    transform: [{ scale: 1 - 0.04 * flicker.value }],
  }));
  return (
    <Animated.View style={[st.subIcon, style]}>
      <Ionicons name="flame-outline" size={13} color={C.textFaint} />
    </Animated.View>
  );
}

/** The weekday names for a screen reader, Sunday first, as Date counts them. */
const SPOKEN_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * A habit's last seven days, today last: small flat cells, each a weekday's initial over a dot that fills when the day
 * was done. A day the habit is not due on is a fainter, smaller ring: a rest day, still tickable. Any of them ticks or
 * unticks its day, so a day missed by a tap can be put right. Today's initial is in the accent. Its own memoised part,
 * so it re-renders only when the habit's ticks, its weekdays or the date change.
 */
const WeekStrip = React.memo(function WeekStrip({ id, title, doneDates, days: dueDays, today, onToggleDay }: {
  id: string; title: string; doneDates: string[]; days?: number[]; today: string;
  onToggleDay: (id: string, dateKey: string) => void;
}) {
  useTheme(); // a memo part: today's initial is the accent, which its props do not change with
  const days = useMemo(() => {
    const [y, m, d] = today.split('-').map(Number);
    const done = new Set(doneDates);
    // a day before the habit existed was never due, as the journal counts it
    const since = habitSince({ id });
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(y, m - 1, d - 6 + i);
      const key = todayKey(date);
      return {
        key, initial: DAY_NAMES[(date.getDay() + 6) % 7][0], spoken: i === 5 ? 'yesterday' : SPOKEN_DAYS[date.getDay()],
        done: done.has(key), isToday: i === 6, rest: !habitDueOn({ days: dueDays }, date) || (!!since && key < since),
      };
    });
  }, [id, doneDates, dueDays, today]);
  return (
    <View style={st.strip}>
      {days.map((c) => (
        <DayCell key={c.key} {...c} onPress={() => { tick(); onToggleDay(id, c.key); }} habit={title} />
      ))}
    </View>
  );
});

/** One day of the strip: flat, its dot filling in green as the day is ticked; a rest day's ring is fainter and smaller. */
function DayCell({ initial, spoken, done, isToday, rest, habit, onPress }: {
  initial: string; spoken: string; done: boolean; isToday: boolean; rest: boolean; habit: string; onPress: () => void;
}) {
  const level = useAnimLevel();
  const fill = useSharedValue(done ? 1 : 0);
  React.useEffect(() => {
    fill.value = level === 'none' ? (done ? 1 : 0) : withTiming(done ? 1 : 0, CHANGE);
  }, [done, level]);
  // the dot grows as it fills with every animation on; with some, it only fades
  const grow = level === 'full';
  const dotStyle = useAnimatedStyle(() => ({
    opacity: fill.value, transform: [{ scale: grow ? 0.5 + 0.5 * fill.value : 1 }],
  }), [grow]);
  return (
    <Pressable
      onPress={onPress} hitSlop={{ top: 6, bottom: 6 }} style={({ pressed }) => [st.cell, pressed && { opacity: 0.6 }]}
      accessibilityRole="checkbox" accessibilityState={{ checked: done }}
      accessibilityLabel={habit + ', ' + (isToday ? 'today' : spoken) + (rest ? ', rest day' : '')}
    >
      <Text style={[st.cellDay, isToday && { color: C.accent, fontFamily: F.smSemi }]} maxFontSizeMultiplier={CHROME_FONT_MAX}>{initial}</Text>
      <View style={[st.cellDot, rest ? [st.cellRest, { borderColor: C.hairline }] : { borderColor: C.outline }]}>
        <Animated.View style={[st.cellFill, { backgroundColor: C.green }, dotStyle]} />
      </View>
    </Pressable>
  );
}

/** A block colour: flat, with a ring in its own colour that fades in round the chosen one. */
function Swatch({ color, active, onPress }: { color: string; active: boolean; onPress: () => void }) {
  const level = useAnimLevel();
  const on = useSharedValue(active ? 1 : 0);
  React.useEffect(() => {
    on.value = level === 'none' ? (active ? 1 : 0) : withTiming(active ? 1 : 0, CHANGE);
  }, [active, level]);
  const ringStyle = useAnimatedStyle(() => ({ opacity: on.value }));
  return (
    <Bouncy
      radius={20} scaleTo={0.88} onPress={onPress} style={st.swatchWell}
      accessibilityRole="button" accessibilityState={{ selected: active }} accessibilityLabel={COLOR_NAMES[color] ?? 'Colour'}
    >
      <Animated.View pointerEvents="none" style={[st.swatchRing, { borderColor: color }, ringStyle]} />
      <View style={[st.swatchDisc, { backgroundColor: color }]} />
    </Bouncy>
  );
}

/** "  Physics " and "physics" are one subject. */
const subjectKeyOf = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
/** at most this many subject suggestions under the block's subject */
const SUGGEST_MAX = 5;

/** The days a block was added to, and its new id on each: what Undo takes back. */
type AddedBlocks = { day: DayName; id: string }[];

/**
 * A new block, or an edit of one. What is typed lives here, so a keystroke re-renders the sheet alone, never the
 * day's blocks and the habits behind it. A new block can repeat on several days at once (Repeat on), each checked for
 * overlaps, and takes the colour its subject already has in the week. An edit of a block that repeats (the same
 * subject and times on other days) can change it on all of them.
 */
function BlockSheet({ visible, day, editing, onClose, onClosed, onSaved }: {
  visible: boolean; day: DayName; editing: PlannerBlock | null; onClose: () => void;
  onClosed: () => void;
  /** said once the sheet has gone: what was done, and how to undo it (null for a plain change on the day shown) */
  onSaved: (message: string, undo: (() => void) | null) => void;
}) {
  const addBlock = useStore((s) => s.addBlock);
  const updateBlock = useStore((s) => s.updateBlock);
  const subjects = useSubjects();
  const [subj, setSubj] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [color, setColor] = useState(BLOCK_COLORS[0]);
  // the days a new block goes on; the day shown to begin with, and at least one always stays on
  const [repeatDays, setRepeatDays] = useState<number[]>([DAY_NAMES.indexOf(day)]);
  const [lastDay, setLastDay] = useState(false);
  // an edit changes the block on every day it repeats too
  const [everyDay, setEveryDay] = useState(false);
  // a colour picked by hand is kept; until then a new block follows its subject's colour
  const colorPicked = React.useRef(false);
  const hour24 = useStore((s) => s.settings.hour24);
  // Set once the block is saved, or while the overlap question is up. A second tap while the sheet leaves, or Return
  // landing in the same frame as the button, finds it set: the block is never added twice, nor found clashing with itself.
  const busy = React.useRef(false);
  // each opening starts from the block being edited, or from blank
  React.useEffect(() => {
    if (!visible) return;
    busy.current = false;
    colorPicked.current = !!editing;
    setSubj(editing ? editing.subject : '');
    setStart(editing ? editing.start : '');
    setEnd(editing ? editing.end : '');
    setColor(editing ? editing.color : BLOCK_COLORS[0]);
    setRepeatDays([DAY_NAMES.indexOf(day)]);
    setLastDay(false);
    setEveryDay(false);
  }, [visible]);

  // the same block on other days, as it was when the sheet opened: what "every day it repeats" changes with it
  const planner = useStore((s) => s.planner);
  const repeats = useMemo(() => (editing && visible ? repeatsOf(planner, day, editing) : []), [editing, visible, day, planner]);

  const pickSubject = (v: string) => {
    setSubj(v);
    if (colorPicked.current) return;
    const c = colorForSubject(useStore.getState().planner, v, day);
    if (c) setColor(c);
  };
  // the subjects in use elsewhere (Focus, notes, the week, Scores), most used first, narrowed by what is typed
  const typed = subjectKeyOf(subj);
  const suggestions = useMemo(
    () => subjects.filter((n) => { const k = subjectKeyOf(n); return k !== typed && k.startsWith(typed); }).slice(0, SUGGEST_MAX),
    [subjects, typed],
  );

  // a start picked with no end yet gives the block an hour, kept inside the day, so most blocks need one turn of the wheel
  const pickStart = (v: string) => {
    setStart(v);
    const from = toMinutes(v);
    if (from >= 0 && toMinutes(end) < 0) setEnd(hhmmOf(Math.min(from + 60, 1440)));
  };
  const toggleRepeat = (i: number) => {
    tick();
    const next = toggledDay(repeatDays, i);
    if (!next) { setLastDay(true); return; }
    setRepeatDays(next);
    setLastDay(false);
  };

  const submit = () => {
    if (busy.current) return;
    const s = start, e = end, t = subj.trim();
    if (!t) { Alert.alert('Missing subject', 'Give the block a subject.'); return; }
    if (toMinutes(s) < 0 || toMinutes(e) < 0) { Alert.alert('Missing time', 'Pick when the block starts and ends.'); return; }
    if (toMinutes(e) <= toMinutes(s)) { Alert.alert('Time order', 'End must be after start.'); return; }
    busy.current = true;
    const week = useStore.getState().planner;
    // the days and blocks this save touches: an edit's own block (and its repeats, when asked), or a new block's days
    const edits: { day: DayName; id: string }[] = editing
      ? [{ day, id: editing.id }, ...(everyDay ? repeats.map((r) => ({ day: r.day as DayName, id: r.id })) : [])]
      : [];
    const adds: DayName[] = editing ? [] : DAY_NAMES.filter((_, i) => repeatDays.includes(i));
    const save = (skip: readonly DayName[]) => {
      const fields = { subject: t, start: s, end: e, color };
      if (editing) {
        const olds: { day: DayName; block: PlannerBlock }[] = [];
        for (const x of edits) {
          if (skip.includes(x.day)) continue;
          const old = (useStore.getState().planner[x.day] || []).find((b) => b.id === x.id);
          if (!old) continue;
          olds.push({ day: x.day, block: old });
          updateBlock(x.day, { ...old, ...fields });
        }
        // a change on other days too says so, and can be taken back block by block
        if (olds.length > 1) {
          onSaved('Changed ' + t + ' on ' + olds.length + ' days', () => {
            for (const o of olds) {
              if ((useStore.getState().planner[o.day] || []).some((b) => b.id === o.block.id)) updateBlock(o.day, o.block);
            }
          });
        }
      } else {
        const days = adds.filter((d) => !skip.includes(d));
        const added: AddedBlocks = [];
        for (const d of days) {
          const had = new Set((useStore.getState().planner[d] || []).map((b) => b.id));
          addBlock(d, fields);
          const fresh = (useStore.getState().planner[d] || []).find((b) => !had.has(b.id));
          if (fresh) added.push({ day: d, id: fresh.id });
        }
        // a block added to the day shown alone is there to see; on other days it says where it went
        if (added.length && !(added.length === 1 && added[0].day === day)) {
          onSaved(
            'Added ' + t + ' to ' + (added.length === 1 ? fullDay(added[0].day) : added.length + ' days'),
            () => { for (const a of added) useStore.getState().removeBlock(a.day, a.id); },
          );
        }
      }
      onClose();
    };
    // two blocks at once would both claim "now": say so for each day, and let a deliberate overlap through
    const ignore = edits.map((x) => x.id);
    const clashes = (editing ? edits.map((x) => x.day) : adds)
      .map((d) => ({ day: d, b: clashIn(week[d], s, e, ignore) }))
      .filter((x): x is { day: DayName; b: PlannerBlock } => !!x.b);
    if (clashes.length) {
      const answered = () => { busy.current = false; };
      const all = editing ? edits.length : adds.length;
      const message = clashes.length === 1
        ? clashes[0].b.subject + ' runs ' + clock(clashes[0].b.start, hour24) + ' to ' + clock(clashes[0].b.end, hour24) + ' on '
          + fullDay(clashes[0].day) + '. Save this block anyway?'
        : clashes.map((c) => c.b.subject + ' on ' + c.day + ', ' + clock(c.b.start, hour24) + ' to ' + clock(c.b.end, hour24)).join('\n')
          + '\n\nSave this block anyway?';
      const buttons: { text: string; style?: 'cancel'; onPress: () => void }[] = [
        { text: 'Cancel', style: 'cancel', onPress: answered },
      ];
      // some days are clear: the block can go on those alone
      if (clashes.length < all) buttons.push({ text: 'Skip those days', onPress: () => save(clashes.map((c) => c.day)) });
      buttons.push({ text: 'Save anyway', onPress: () => save([]) });
      Alert.alert(
        clashes.length === 1 ? 'Overlaps ' + clashes[0].b.subject : 'Overlaps on ' + clashes.length + ' days',
        message, buttons, { cancelable: true, onDismiss: answered },
      );
      return;
    }
    save([]);
  };

  const n = repeatDays.length;
  const repeatCaption = lastDay ? 'At least one day' : n === 1 ? 'Only ' + fullDay(DAY_NAMES[repeatDays[0]]) : daysLabel(repeatDays);
  return (
    <Sheet visible={visible} onClose={onClose} onClosed={onClosed} title={editing ? 'Edit block' : 'New block for ' + fullDay(day)}>
      <Field label="Subject" value={subj} onChangeText={pickSubject} placeholder="e.g. Physics" autoFocus maxLength={40} />
      {suggestions.length ? (
        <Row style={st.suggest}>
          {suggestions.map((name) => (
            <Chip key={name} small label={name} onPress={() => { tick(); pickSubject(name); }} accessibilityHint="Uses this subject" />
          ))}
        </Row>
      ) : null}
      {/* the end may be midnight, the end of the day; a start never is */}
      <Row style={{ gap: 14, alignItems: 'flex-start' }}>
        <TimeField label="Starts" value={start} onChange={pickStart} placeholder="Pick a time" style={{ flex: 1 }} />
        <TimeField label="Ends" value={end} onChange={setEnd} placeholder="Pick a time" allowEndOfDay style={{ flex: 1 }} />
      </Row>
      <Row style={{ flexWrap: 'wrap', gap: 10, marginBottom: 12, marginTop: 2 }}>
        {BLOCK_COLORS.map((c) => (
          <Swatch key={c} color={c} active={color === c} onPress={() => { tick(); colorPicked.current = true; setColor(c); }} />
        ))}
      </Row>
      {editing ? (
        repeats.length ? (
          <View style={st.everyDay}>
            <Row>
              <Text style={[T.body, { flex: 1 }]}>Change it on every day it repeats</Text>
              <Toggle value={everyDay} onChange={setEveryDay} label="Change it on every day it repeats" />
            </Row>
            <Text style={[T.caption, { marginTop: 4 }]}>
              {'Also on ' + repeats.map((r) => r.day).filter((d, i, a) => a.indexOf(d) === i).join(', ')}
            </Text>
          </View>
        ) : null
      ) : (
        <>
          <Text style={st.repeatLabel} importantForAccessibility="no">Repeat on</Text>
          <DayToggles value={repeatDays} onToggle={toggleRepeat} label="Repeat on" />
          <Text style={[T.caption, st.repeatCaption]} accessibilityLiveRegion="polite">{repeatCaption}</Text>
        </>
      )}
      <PillButton
        label={editing ? 'Save' : n > 1 ? 'Add to ' + n + ' days' : 'Add block'}
        onPress={submit}
      />
    </Sheet>
  );
}

/**
 * Copy the day's blocks to other days: pick any of the rest of the week, then copy once, with one Undo for them all.
 * The days picked live here.
 */
function CopySheet({ visible, day, onClose, onClosed, onCopied }: {
  visible: boolean; day: DayName; onClose: () => void; onClosed: () => void;
  /** copied over `before` (the week as it was) to the days `to` names, for the Undo said once the sheet has gone */
  onCopied: (to: string, before: PlannerWeek) => void;
}) {
  const copyDay = useStore((s) => s.copyDay);
  const empty = useStore((s) => (s.planner[day] || []).length === 0);
  const [targets, setTargets] = useState<DayName[]>([]);
  // one copy per opening: a second tap while the sheet leaves would take the copied week for the one to undo to
  const done = React.useRef(false);
  React.useEffect(() => {
    if (!visible) return;
    done.current = false;
    setTargets([]);
  }, [visible]);
  const n = targets.length;
  const copy = () => {
    if (done.current || n === 0) return;
    done.current = true;
    const before = useStore.getState().planner;
    for (const d of targets) copyDay(day, d);
    onCopied(n === 1 ? fullDay(targets[0]) : n + ' days', before);
    onClose();
  };
  return (
    <Sheet visible={visible} onClose={onClose} onClosed={onClosed} title={'Copy ' + fullDay(day)}>
      {empty ? (
        // an empty day copied would only clear the days it went to
        <Text style={[T.body, { color: C.textDim, marginBottom: 8 }]}>Nothing on {fullDay(day)} to copy.</Text>
      ) : (
        <>
          <Row style={{ flexWrap: 'wrap' }}>
            {DAY_NAMES.filter((d) => d !== day).map((d) => (
              <Chip
                key={d} label={d} active={targets.includes(d)}
                onPress={() => { tick(); setTargets((x) => (x.includes(d) ? x.filter((y) => y !== d) : [...x, d])); }}
              />
            ))}
          </Row>
          <Text style={[T.caption, { marginTop: 8, marginBottom: 14 }]}>Replaces the blocks on the days you pick.</Text>
          {/* quiet until a day is picked */}
          <PillButton
            label={n === 0 ? 'Copy' : n === 1 ? 'Copy to ' + fullDay(targets[0]) : 'Copy to ' + n + ' days'}
            color={n === 0 ? C.textFaint : undefined}
            onPress={copy}
          />
        </>
      )}
    </Sheet>
  );
}

/** Week templates: save the week under a name, apply one, delete one. The name being typed lives here. */
function TemplatesSheet({ visible, onClose, onClosed, onApplied }: {
  visible: boolean; onClose: () => void; onClosed: () => void;
  /** a template was applied over `before`: the week as it was, for the Undo said once the sheet has gone */
  onApplied: (name: string, before: PlannerWeek) => void;
}) {
  const weekTemplates = useStore((s) => s.weekTemplates);
  const saveTemplate = useStore((s) => s.saveTemplate);
  const applyTemplate = useStore((s) => s.applyTemplate);
  const [tplName, setTplName] = useState('');
  // one template applied per opening: a second tap while the sheet leaves would take the applied week for the one to undo to
  const applied = React.useRef(false);
  React.useEffect(() => { if (visible) applied.current = false; }, [visible]);
  const names = Object.keys(weekTemplates);
  const apply = useCallback((name: string) => {
    if (applied.current) return;
    applied.current = true;
    const before = useStore.getState().planner;
    applyTemplate(name);
    onApplied(name, before);
    onClose();
  }, [applyTemplate, onApplied, onClose]);
  const save = () => {
    const name = tplName.trim();
    if (!name) return;
    const keep = () => { saveTemplate(name); setTplName(''); };
    // a name already taken would replace that template without a word
    if (weekTemplates[name]) {
      Alert.alert('Replace ' + name + '?', 'The template saved under this name becomes the week you are planning now.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Replace', onPress: keep },
      ]);
      return;
    }
    keep();
  };
  return (
    <Sheet visible={visible} onClose={onClose} onClosed={onClosed} title="Week templates">
      {names.length === 0 && (
        <Text style={[T.caption, { marginBottom: 10 }]}>
          Save the whole week ("Exam week", "Normal week") and switch anytime.
        </Text>
      )}
      <TemplateRows names={names} onApply={apply} />
      <Row style={{ marginTop: 10 }}>
        <Field
          value={tplName} onChangeText={setTplName} placeholder="Save current week as…" maxLength={30}
          style={{ flex: 1, marginBottom: 0 }}
        />
        <PillButton small label="Save" style={{ marginLeft: 8 }} onPress={save} />
      </Row>
    </Sheet>
  );
}

/**
 * The saved templates. Built each time the sheet opens, so the ones there are simply there; one saved or deleted while
 * it is open fades in or out, and the rest glide to their places.
 */
function TemplateRows({ names, onApply }: { names: string[]; onApply: (name: string) => void }) {
  const level = useAnimLevel();
  const built = useBuilt();
  const deleteTemplate = useStore((s) => s.deleteTemplate);
  return (
    <>
      {names.map((name) => (
        <Animated.View key={name} entering={built.current ? rowIn(level) : undefined} exiting={rowOut(level)} layout={glide(level)}>
          <Row style={{ paddingVertical: 8 }}>
            <Text style={[T.body, { flex: 1 }]} numberOfLines={1}>{name}</Text>
            <PillButton small label="Apply" style={{ marginRight: 8 }} onPress={() => onApply(name)} />
            <IconBtn
              name="trash-outline" size={18} accessibilityLabel={'Delete template ' + name}
              onPress={() => Alert.alert('Delete ' + name + '?', 'The template goes. The week you are planning stays as it is.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => deleteTemplate(name) },
              ])}
            />
          </Row>
        </Animated.View>
      ))}
    </>
  );
}

/** Saves a habit's new name, time and weekdays in place: its id, its ticks and so its streak all stay. */
function saveHabit(id: string, title: string, remindTime?: string, days?: number[]) {
  const s = useStore.getState();
  const h = s.habits.find((x) => x.id === id);
  if (!h) return;
  if (h.title !== title) s.renameHabit(id, title);
  if ((h.remindTime || undefined) !== remindTime) s.setHabitReminder(id, remindTime);
  if ((h.days || []).join() !== (cleanDays(days) || []).join()) s.setHabitDays(id, days);
}

/** A reminder's time from the wheel: a time of day, or nothing ('' is none). */
const readTime = (picked: string) => {
  const m = toMinutes(picked);
  return m >= 0 && m < 1440 ? picked : undefined;
};

/**
 * A new habit, or an edit of one (its name, its reminder time and the weekdays it repeats on). What is typed lives here,
 * so a keystroke re-renders the sheet alone.
 */
function HabitSheet({ visible, editing, onClose }: { visible: boolean; editing: Habit | null; onClose: () => void }) {
  const addHabit = useStore((s) => s.addHabit);
  const remindersEnabled = useStore((s) => s.settings.remindersEnabled);
  const [habitTitle, setHabitTitle] = useState('');
  const [habitTime, setHabitTime] = useState('');
  // the weekdays it is due on; at least one always stays on, and a tap on the last one says so
  const [days, setDays] = useState<number[]>([...ALL_DAYS]);
  const [lastDay, setLastDay] = useState(false);
  // one save per opening: a second tap while the sheet leaves, or Return with the button, never adds the habit twice
  const done = React.useRef(false);
  // an edit says so once the sheet has gone
  const saved = React.useRef(false);
  React.useEffect(() => {
    if (!visible) return;
    done.current = false;
    setHabitTitle(editing ? editing.title : '');
    setHabitTime(editing?.remindTime ?? '');
    setDays(editing?.days?.length ? [...editing.days] : [...ALL_DAYS]);
    setLastDay(false);
  }, [visible]);
  const toggleDay = (i: number) => {
    tick();
    const next = toggledDay(days, i);
    if (!next) { setLastDay(true); return; }
    setDays(next);
    setLastDay(false);
  };
  const submit = () => {
    if (done.current) return;
    const t = habitTitle.trim();
    if (!t) return;
    const time = readTime(habitTime);
    done.current = true;
    if (editing) {
      saveHabit(editing.id, t, time, days);
      saved.current = true;
    } else {
      addHabit(t, time, days);
    }
    onClose();
    // a time newly set turns reminders on, asking for permission; a rename alone leaves reminders as they were
    if (time && time !== editing?.remindTime) void turnOnReminders();
    else if (editing) void rescheduleAllReminders();
  };
  return (
    <Sheet
      visible={visible} onClose={onClose} title={editing ? 'Edit habit' : 'New habit'}
      onClosed={() => {
        if (!saved.current) return;
        saved.current = false;
        toast('Habit saved');
      }}
    >
      <Field
        value={habitTitle} onChangeText={setHabitTitle} placeholder="e.g. Revise formula sheet" autoFocus maxLength={80}
      />
      <TimeField label="Reminder" value={habitTime} onChange={setHabitTime} placeholder="No reminder" clearable />
      <Text style={st.repeatLabel} importantForAccessibility="no">Repeat</Text>
      <DayToggles value={days} onToggle={toggleDay} label="Repeat" />
      <Text style={[T.caption, st.repeatCaption]} accessibilityLiveRegion="polite">
        {lastDay ? 'At least one day' : daysLabel(days)}
      </Text>
      <PillButton label={editing ? 'Save' : 'Add habit'} onPress={submit} />
      {!remindersEnabled && (
        <Text style={[T.caption, { marginTop: 10 }]}>
          Reminders are off in Settings. A time set here asks for notification permission and switches them on.
        </Text>
      )}
    </Sheet>
  );
}

/**
 * A habit's reminder time, on the time wheel itself: the alarm on a habit's row comes straight here, one step from the
 * time. The time being turned to lives here.
 */
function ReminderSheet({ habit, onClose }: { habit: Habit | null; onClose: () => void }) {
  const setHabitReminder = useStore((s) => s.setHabitReminder);
  const remindersEnabled = useStore((s) => s.settings.remindersEnabled);
  const hour24 = useStore((s) => s.settings.hour24);
  const [draft, setDraft] = useState('');
  // the sheet keeps the habit it was opened for while it closes, so its title never blanks on the way out
  const [shown, setShown] = useState<Habit | null>(habit);
  // one answer per opening, so a second tap while it leaves never asks for permission twice
  const done = React.useRef(false);
  React.useEffect(() => {
    if (!habit) return;
    done.current = false;
    setShown(habit);
    // a habit with no reminder yet starts the wheels on the next whole hour
    setDraft(readTime(habit.remindTime || '') ?? defaultTime());
  }, [habit]);
  const save = () => {
    if (!habit || done.current) return;
    const time = readTime(draft);
    if (!time) return;
    done.current = true;
    setHabitReminder(habit.id, time);
    onClose();
    void turnOnReminders();
  };
  const turnOff = () => {
    if (!habit || done.current) return;
    done.current = true;
    setHabitReminder(habit.id, undefined);
    onClose();
    void rescheduleAllReminders();
  };
  return (
    <Sheet visible={!!habit} onClose={onClose} title={`Reminder for ${shown?.title || 'this habit'}`}>
      <TimeWheel value={draft} onChange={setDraft} hour24={hour24} />
      <PillButton label="Save" onPress={save} style={{ marginTop: 20 }} />
      {shown?.remindTime ? (
        <Pressable onPress={turnOff} hitSlop={12} style={st.turnOff} accessibilityRole="button">
          <Text style={[st.todayText, { color: C.accent }]}>Turn off</Text>
        </Pressable>
      ) : null}
      {!remindersEnabled && (
        <Text style={[T.caption, { marginTop: 10 }]}>
          Reminders are off in Settings. A time set here asks for notification permission and switches them on.
        </Text>
      )}
    </Sheet>
  );
}

const st = StyleSheet.create({
  wheelWrap: { marginBottom: 18 },
  dayText: { fontFamily: F.semi, fontSize: 22, lineHeight: 28, letterSpacing: TRACK.large },
  todayLink: { alignSelf: 'center', marginTop: 2 },
  todayPress: { paddingHorizontal: 8, paddingVertical: 2 },
  todayText: { fontFamily: F.semi, fontSize: 13, letterSpacing: TRACK.small },
  // two columns on a sideways tablet, set as Today sets its own
  pair: { flexDirection: 'row', alignItems: 'flex-start', gap: 28 },
  col: { flex: 1, minWidth: 0 },
  // a list row's shape (ListRow), for the block row that carries its own name for a screen reader
  blockRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 12, borderRadius: 14 },
  // under the card (which keeps S.gap below it), nearer the list it speaks of than the button
  blocksHint: { ...T.caption, marginTop: -4, marginBottom: 14, paddingHorizontal: 4 },
  turnOff: { alignSelf: 'center', marginTop: 16, paddingHorizontal: 8, paddingVertical: 4 },
  colorBar: { width: 4, height: 36, borderRadius: 2, marginRight: 12 },
  nowPill: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3, marginRight: 4 },
  nowText: { fontFamily: F.smSemi, fontSize: 11, letterSpacing: TRACK.caps },
  // the block on now: a 2 dp gauge along the foot of its row, inset from the corners, filled by sliding its bar in
  blockGauge: { position: 'absolute', left: 14, right: 14, bottom: 0, height: 2, borderRadius: 1, overflow: 'hidden' },
  blockGaugeFill: { width: '100%', height: 2, borderRadius: 1 },
  // a block's times line up from row to row: tabular figures, so Inter Tight
  span: { marginTop: 2, fontFamily: F.reg, fontVariant: ['tabular-nums'] },
  // flat: a ring in the block's own colour marks the chosen one
  swatchWell: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  swatchRing: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 20, borderWidth: 2 },
  swatchDisc: { width: 24, height: 24, borderRadius: 12 },
  // a habit: its own line on top, its week beneath
  habitRow: { flexDirection: 'column', alignItems: 'stretch', paddingVertical: 12 },
  // the week starts under the habit's name, past its tick (30 across) and the gap after it
  strip: { flexDirection: 'row', marginTop: 10, marginLeft: 42, marginRight: 4 },
  // flat: no surface of its own, only a press that dims
  cell: { flex: 1, alignItems: 'center', paddingVertical: 4, borderRadius: 10 },
  cellDay: { color: C.textFaint, fontFamily: F.smMed, fontSize: 11, letterSpacing: TRACK.fine, marginBottom: 5 },
  cellDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1, overflow: 'hidden' },
  // a rest day: a fainter ring a little smaller, centred where a due day's dot sits
  cellRest: { width: 8, height: 8, borderRadius: 4, marginVertical: 1 },
  cellFill: { position: 'absolute', top: -1, left: -1, right: -1, bottom: -1, borderRadius: 5 },
  // a habit's sub-line: its parts wrap whole, each with its icon
  subLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 10, rowGap: 2, marginTop: 3 },
  // a part is as wide as the line at most: a long list of days wraps inside its own part
  subPart: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  subText: { flexShrink: 1 },
  subIcon: { marginRight: 4 },
  // the habit sheet's Repeat row: seven circles spread across the sheet, the field label's look above them
  repeatLabel: { color: C.textFaint, fontFamily: F.smMed, fontSize: 12, letterSpacing: TRACK.fine, marginLeft: 2, marginBottom: 8, marginTop: 4 },
  repeatCaption: { marginTop: 8, marginBottom: 18, marginLeft: 2 },
  // the subjects already in use, under the block's subject: flat chips, nearer the field they fill
  suggest: { flexWrap: 'wrap', marginTop: -4, marginBottom: 6 },
  // an edit's "every day it repeats": a switch row with the days under it, a field's gap after
  everyDay: { marginTop: 2, marginBottom: 18, paddingLeft: 2 },
  // the line under the wheel: the picked weekday's next date and what falls on it, centred, wrapping between parts
  dateLine: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', marginTop: 2, paddingHorizontal: 8 },
  dateText: { ...T.caption },
  dateDot: { ...T.caption, color: C.textFaint },
  datePart: { flexShrink: 1 },
});
