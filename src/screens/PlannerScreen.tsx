import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useFocusEffect } from 'expo-router';
import { C, F, S, T, TRACK, BLOCK_COLORS } from '../theme';
import { useStore, PlannerBlock, PlannerWeek, Habit } from '../store';
import { DAY_NAMES, DayName, dayName, toMinutes, fmtClockTime, todayKey, streaks, indexAfterNeighbours } from '../utils';
import { useNow, useToday } from '../hooks/useNow';
import {
  ScreenBG, SectionTitle, Sheet, Field, PillButton, EmptyState, Row, Chip, IconBtn, CheckCircle, useTheme, useToolHeader,
  contextLine, ListCard, ListRow,
} from '../components/UI';
import { Ionicons } from '@expo/vector-icons';
import { Wheel } from '../components/Wheel';
import {
  Bouncy, CHANGE, Enter, FadeSwap, glide, rowIn, rowOut, useAnimLevel, useBuilt, useFocusKey,
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

/** a stored HH:MM as the clock reads (12 or 24 hours, the setting's choice); a time that cannot be read shows as saved */
const clock = (hhmm: string, hour24: boolean) => {
  const m = toMinutes(hhmm);
  return m < 0 ? hhmm : fmtClockTime(m, hour24);
};

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
  const removeHabit = useStore((s) => s.removeHabit);
  const restoreHabit = useStore((s) => s.restoreHabit);
  // a change made from a sheet says so once the sheet has gone, where its Undo can be seen
  const afterSheet = React.useRef<(() => void) | null>(null);
  const runAfterSheet = useCallback(() => { const f = afterSheet.current; afterSheet.current = null; f?.(); }, []);
  const hour24 = useStore((s) => s.settings.hour24);
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
  const onNow = useMemo(() => {
    let cur: PlannerBlock | null = null;
    for (const b of todayBlocks) {
      if (toMinutes(b.start) <= nowMin && nowMin < toMinutes(b.end) && (!cur || toMinutes(b.end) < toMinutes(cur.end))) cur = b;
    }
    return cur;
  }, [todayBlocks, nowMin]);
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

  const deleteHabit = useCallback(async (h: Habit) => {
    const all = useStore.getState().habits;
    const before = all.slice(0, Math.max(0, all.findIndex((x) => x.id === h.id))).map((x) => x.id);
    removeHabit(h.id);
    toast('Deleted ' + h.title, {
      label: 'Undo',
      onPress: () => {
        // beside the neighbour it had, even if the list changed while the toast was up
        restoreHabit(h, indexAfterNeighbours(before, useStore.getState().habits.map((x) => x.id)));
        void rescheduleAllReminders();
      },
    });
    // re-run the scheduler after the delete, or the habit's daily reminder keeps firing for a habit that no longer exists
    await rescheduleAllReminders();
  }, [removeHabit, restoreHabit]);

  const openHabit = useCallback((h: Habit | null) => { setHabitEdit(h); setHabitSheet(true); }, []);

  const tabMode = mode === 'tab';
  // a sideways tablet sets the day's blocks and the streaks side by side; a phone keeps its one column exactly
  const { width: winW } = useWindowDimensions();
  const twoCol = columnWidth(winW, tabMode, WIDE_MAX) >= TWO_COL_AT;
  // the dot is for a block in progress this minute: nothing else says "now" in the header
  const header = useToolHeader({
    title: 'Planner',
    mode: tabMode ? 'tab' : 'page',
    context: contextLine(
      onNow
        ? [{ em: onNow.subject }, ' until ' + fmtClockTime(toMinutes(onNow.end), hour24)]
        : nextToday
          ? ['Next ', { em: nextToday.subject }, ' at ' + fmtClockTime(toMinutes(nextToday.start), hour24)]
          : tomorrowFrom >= 0 && 'Tomorrow from ' + fmtClockTime(tomorrowFrom, hour24),
    ),
    live: onNow != null,
    actions: [
      { icon: 'copy-outline', label: 'Copy this day', onPress: () => setCopySheet(true) },
      { icon: 'albums-outline', label: 'Week templates', onPress: () => setTplSheet(true) },
    ],
  });

  // blocks: the day's own entrance is for a day change; the screen's rises with the rest, every visit
  const blocksPart = (
    <Enter index={1} style={twoCol ? st.col : undefined}>
      <Animated.View key={day} entering={dayIn}>
        <DayBlocks
          day={day} blocks={blocks} hour24={hour24} nowMin={viewingToday ? nowMin : -1} deepWork={deepWork}
          onEdit={openEdit} onDelete={deleteBlock}
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
          <EmptyState compact icon="repeat-outline" title="No habits yet" body="Daily habits, each with its streak." />
        ) : (
          <ListCard>
            {habits.map((h) => (
              <HabitRow
                key={h.id} h={h} today={today} hour24={hour24}
                onToggle={toggleHabitToday} onEdit={openHabit} onRemind={setRemindEdit} onDelete={deleteHabit}
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
        {...header.scrollProps}
        contentContainerStyle={{ padding: S.pad, paddingTop: header.padTop, paddingBottom: 44 + (tabMode ? 0 : insets.bottom) }}
        showsVerticalScrollIndicator={false}
      >
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

      <BlockSheet visible={blockSheet} day={day} editing={editing} onClose={() => setBlockSheet(false)} />

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
    </ScreenBG>
  );
}

/**
 * The day's blocks. Built afresh for each day (the day's own entrance brings them in); on the same day, a first block
 * added to an empty day fades in rather than appearing in one frame.
 */
function DayBlocks({ day, blocks, hour24, nowMin, deepWork, onEdit, onDelete }: {
  day: DayName; blocks: PlannerBlock[]; hour24: boolean;
  /** the minute of the day, when the day shown is today; -1 on any other day */
  nowMin: number;
  /** Deep Work is in use (not archived), so a block is a way into it */
  deepWork: boolean;
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
            past={nowMin >= 0 && toMinutes(b.end) <= nowMin}
            onEdit={onEdit} onDelete={onDelete}
          />
        ))}
      </ListCard>
      {/* said once for the list, not on every row */}
      {deepWork ? <Text style={st.blocksHint}>Tap a block to start Deep Work on it.</Text> : null}
    </Animated.View>
  );
}

/** One block of the day. Memoised, so the minute turning re-renders only a block whose NOW badge changes. */
const BlockRow = React.memo(function BlockRow({ b, hour24, isNow, past, deepWork, onEdit, onDelete }: {
  b: PlannerBlock; hour24: boolean; isNow: boolean;
  /** today's block that has ended: it steps back, so what is still to come stands out */
  past: boolean;
  deepWork: boolean;
  onEdit: (b: PlannerBlock) => void; onDelete: (b: PlannerBlock) => void;
}) {
  useTheme(); // a memo row: it follows a new accent itself, since its props do not change with one
  const span = fmtClockTime(toMinutes(b.start), hour24) + ' – ' + fmtClockTime(toMinutes(b.end), hour24);
  const body = (
    <>
      <View style={[st.colorBar, { backgroundColor: b.color }]} />
      <View style={{ flex: 1 }}>
        <Text style={[T.title, past && { color: C.textDim }]}>{b.subject}</Text>
        <Text style={[T.caption, { marginTop: 2, fontVariant: ['tabular-nums'] }]}>{span}</Text>
      </View>
      {isNow && (
        <View style={[st.nowPill, { borderColor: C.accent + '66', backgroundColor: C.accent + '1A' }]}>
          <Text style={[st.nowText, { color: C.accent }]}>NOW</Text>
        </View>
      )}
      <IconBtn name="create-outline" size={18} onPress={() => onEdit(b)} accessibilityLabel={'Edit ' + b.subject} />
      <IconBtn name="trash-outline" size={18} onPress={() => onDelete(b)} accessibilityLabel={'Delete ' + b.subject} />
    </>
  );
  if (!deepWork) return <ListRow style={{ paddingVertical: 12 }}>{body}</ListRow>;
  // Deep Work opens set to the block's length, or to what is left of it while it is on
  const start = () => {
    const d = new Date();
    const m = d.getHours() * 60 + d.getMinutes();
    const end = toMinutes(b.end);
    openTool('focus', { subject: b.subject, minutes: isNow && m < end ? end - m : end - toMinutes(b.start) });
  };
  // a list row's own shape and carve, with the name a screen reader needs
  return (
    <Bouncy
      onPress={start} scaleTo={1} sink={false} radius={14} style={st.blockRow}
      accessibilityRole="button" accessibilityLabel={'Start Deep Work on ' + b.subject + ', ' + span}
    >
      {body}
    </Bouncy>
  );
});

/**
 * One habit with its streak. Memoised, and its streak is worked out only when its dates or the day change, so ticking
 * one habit re-renders that habit alone. The streak line never states a zero: a habit with no streak yet shows none.
 * A long press opens it for editing.
 */
const HabitRow = React.memo(function HabitRow({ h, today, hour24, onToggle, onEdit, onRemind, onDelete }: {
  h: Habit; today: string; hour24: boolean;
  onToggle: (id: string) => void; onEdit: (h: Habit) => void; onRemind: (h: Habit) => void; onDelete: (h: Habit) => void;
}) {
  useTheme(); // a memo row: it follows a new accent itself, since its props do not change with one
  // the current streak counts back from today, so a new day can end it with no tick at all
  const { current, best } = useMemo(() => streaks(h.doneDates), [h.doneDates, today]);
  const done = h.doneDates.includes(today);
  // a current streak that is also the best says so once
  const streakText = current > 0 && current === best
    ? current + ' current'
    : [current > 0 ? current + ' current' : '', best > 0 ? best + ' best' : ''].filter(Boolean).join(' · ');
  const time = h.remindTime ? clock(h.remindTime, hour24) : '';
  return (
    <ListRow style={{ paddingVertical: 12 }} onLongPress={() => onEdit(h)}>
      <CheckCircle done={done} onPress={() => onToggle(h.id)} label={h.title + ', today'} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={T.title}>{h.title}</Text>
        {streakText || time ? (
          // the streak's figures dip and come back as the tick lands, instead of jumping
          <FadeSwap swapKey={streakText}>
            <Row style={{ marginTop: 3 }}>
              {streakText ? (
                <>
                  <Ionicons name="flame-outline" size={13} color={C.textFaint} style={{ marginRight: 4 }} />
                  <Text style={T.caption}>{streakText}</Text>
                </>
              ) : null}
              {time ? (
                <>
                  <Ionicons name="alarm-outline" size={13} color={C.textFaint} style={{ marginLeft: streakText ? 10 : 0 }} />
                  <Text style={[T.caption, { marginLeft: 4 }]}>{time}</Text>
                </>
              ) : null}
            </Row>
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
    </ListRow>
  );
});

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

/**
 * A new block, or an edit of one. What is typed lives here, so a keystroke re-renders the sheet alone, never the
 * day's blocks and the habits behind it.
 */
function BlockSheet({ visible, day, editing, onClose }: {
  visible: boolean; day: DayName; editing: PlannerBlock | null; onClose: () => void;
}) {
  const addBlock = useStore((s) => s.addBlock);
  const updateBlock = useStore((s) => s.updateBlock);
  const [subj, setSubj] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [color, setColor] = useState(BLOCK_COLORS[0]);
  const hour24 = useStore((s) => s.settings.hour24);
  // Set once the block is saved, or while the overlap question is up. A second tap while the sheet leaves, or Return
  // landing in the same frame as the button, finds it set: the block is never added twice, nor found clashing with itself.
  const busy = React.useRef(false);
  // each opening starts from the block being edited, or from blank
  React.useEffect(() => {
    if (!visible) return;
    busy.current = false;
    setSubj(editing ? editing.subject : '');
    setStart(editing ? editing.start : '');
    setEnd(editing ? editing.end : '');
    setColor(editing ? editing.color : BLOCK_COLORS[0]);
  }, [visible]);

  const submit = () => {
    if (busy.current) return;
    const s = start.trim(), e = end.trim(), t = subj.trim();
    if (!t) { Alert.alert('Missing subject', 'Give the block a subject.'); return; }
    if (toMinutes(s) < 0 || toMinutes(e) < 0) { Alert.alert('Time format', 'Use 24h HH:MM, e.g. 16:00'); return; }
    if (toMinutes(e) <= toMinutes(s)) { Alert.alert('Time order', 'End must be after start.'); return; }
    busy.current = true;
    const save = () => {
      if (editing) updateBlock(day, { ...editing, subject: t, start: s, end: e, color });
      else addBlock(day, { subject: t, start: s, end: e, color });
      onClose();
    };
    // two blocks at once would both claim "now": say so, and let a deliberate overlap through
    const clash = (useStore.getState().planner[day] || []).find((b) => (
      b.id !== editing?.id && toMinutes(b.start) < toMinutes(e) && toMinutes(s) < toMinutes(b.end)
    ));
    if (clash) {
      const answered = () => { busy.current = false; };
      Alert.alert(
        'Overlaps ' + clash.subject,
        clash.subject + ' runs ' + clock(clash.start, hour24) + ' to ' + clock(clash.end, hour24) + ' on ' + fullDay(day)
          + '. Save this block anyway?',
        [{ text: 'Cancel', style: 'cancel', onPress: answered }, { text: 'Save anyway', onPress: save }],
        { cancelable: true, onDismiss: answered },
      );
      return;
    }
    save();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={editing ? 'Edit block' : 'New block for ' + fullDay(day)}>
      <Field label="Subject" value={subj} onChangeText={setSubj} placeholder="e.g. Physics" autoFocus maxLength={40} />
      <Row style={{ gap: 14 }}>
        <Field label="Starts" value={start} onChangeText={setStart} placeholder="16:00" style={{ flex: 1 }} keyboardType="numbers-and-punctuation" />
        <Field label="Ends" value={end} onChangeText={setEnd} placeholder="17:30" style={{ flex: 1 }} keyboardType="numbers-and-punctuation" />
      </Row>
      <Row style={{ flexWrap: 'wrap', gap: 10, marginBottom: 12, marginTop: 2 }}>
        {BLOCK_COLORS.map((c) => (
          <Swatch key={c} color={c} active={color === c} onPress={() => { tick(); setColor(c); }} />
        ))}
      </Row>
      <PillButton label={editing ? 'Save' : 'Add block'} onPress={submit} />
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

/**
 * Saves a habit's new name and time. The store has no rename yet, so the habit is taken out and put back where it
 * stood in the same moment: one render, and its id, its ticks and so its streak all stay.
 */
function saveHabit(id: string, title: string, remindTime?: string) {
  const s = useStore.getState();
  const index = s.habits.findIndex((h) => h.id === id);
  if (index < 0) return;
  const h = s.habits[index];
  s.removeHabit(id);
  s.restoreHabit({ ...h, title, remindTime }, index);
}

/** A time typed for a reminder: HH:MM on a 24-hour clock, or nothing. */
const readTime = (typed: string) => (/^\d{1,2}:\d{2}$/.test(typed) && toMinutes(typed) >= 0 ? typed : undefined);

/**
 * A new habit, or an edit of one (its name and its reminder time). What is typed lives here, so a keystroke re-renders
 * the sheet alone.
 */
function HabitSheet({ visible, editing, onClose }: { visible: boolean; editing: Habit | null; onClose: () => void }) {
  const addHabit = useStore((s) => s.addHabit);
  const remindersEnabled = useStore((s) => s.settings.remindersEnabled);
  const [habitTitle, setHabitTitle] = useState('');
  const [habitTime, setHabitTime] = useState('');
  // one save per opening: a second tap while the sheet leaves, or Return with the button, never adds the habit twice
  const done = React.useRef(false);
  // an edit says so once the sheet has gone
  const saved = React.useRef(false);
  React.useEffect(() => {
    if (!visible) return;
    done.current = false;
    setHabitTitle(editing ? editing.title : '');
    setHabitTime(editing?.remindTime ?? '');
  }, [visible]);
  const submit = () => {
    if (done.current) return;
    const t = habitTitle.trim();
    if (!t) return;
    const typed = habitTime.trim();
    const time = readTime(typed);
    // a time that could never ring is said to be wrong, never saved looking like a working reminder
    if (typed && !time) { Alert.alert('Time format', 'Use 24h HH:MM, like 21:00, or leave it empty.'); return; }
    done.current = true;
    if (editing) {
      saveHabit(editing.id, t, time);
      saved.current = true;
    } else {
      addHabit(t, time);
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
      <Field
        value={habitTime} onChangeText={setHabitTime} placeholder="Reminder time, like 21:00 (optional)"
        keyboardType="numbers-and-punctuation"
      />
      <PillButton label={editing ? 'Save' : 'Add habit'} onPress={submit} />
      {!remindersEnabled && (
        <Text style={[T.caption, { marginTop: 10 }]}>
          Reminders are off in Settings. A time set here asks for notification permission and switches them on.
        </Text>
      )}
    </Sheet>
  );
}

/** A habit's reminder time. The time being typed lives here. */
function ReminderSheet({ habit, onClose }: { habit: Habit | null; onClose: () => void }) {
  const setHabitReminder = useStore((s) => s.setHabitReminder);
  const remindersEnabled = useStore((s) => s.settings.remindersEnabled);
  const [draft, setDraft] = useState('');
  // the sheet keeps the habit it was opened for while it closes, so its title never blanks on the way out
  const [shown, setShown] = useState<Habit | null>(habit);
  // one answer per opening, so a second tap while it leaves never asks for permission twice
  const done = React.useRef(false);
  React.useEffect(() => {
    if (!habit) return;
    done.current = false;
    setShown(habit);
    setDraft(habit.remindTime || '');
  }, [habit]);
  const save = () => {
    if (!habit || done.current) return;
    const t = draft.trim();
    const time = readTime(t);
    if (t && !time) { Alert.alert('Time format', 'Use 24h HH:MM, like 21:00, or leave it empty to clear.'); return; }
    done.current = true;
    setHabitReminder(habit.id, time);
    onClose();
    if (time) void turnOnReminders();
    else void rescheduleAllReminders();
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
      <Field
        value={draft} onChangeText={setDraft} placeholder="21:00" keyboardType="numbers-and-punctuation" autoFocus
        returnKeyType="done" onSubmitEditing={save}
      />
      <PillButton label="Save" onPress={save} />
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
  nowText: { fontFamily: F.semi, fontSize: 11, letterSpacing: TRACK.caps },
  // flat: a ring in the block's own colour marks the chosen one
  swatchWell: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  swatchRing: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 20, borderWidth: 2 },
  swatchDisc: { width: 24, height: 24, borderRadius: 12 },
});
