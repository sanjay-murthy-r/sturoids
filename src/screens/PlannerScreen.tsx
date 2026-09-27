import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { C, F, S, T, BLOCK_COLORS } from '../theme';
import { useStore, PlannerBlock, PlannerWeek, Habit } from '../store';
import { DAY_NAMES, DayName, dayName, toMinutes, fmtClockTime, todayKey, streaks, indexAfterNeighbours } from '../utils';
import { useNow } from '../hooks/useNow';
import {
  ScreenBG, SectionTitle, Sheet, Field, PillButton, EmptyState, Row, Chip, IconBtn, CheckCircle, useTheme, NeuHeader,
  ListCard, ListRow,
} from '../components/UI';
import { Ionicons } from '@expo/vector-icons';
import { Wheel } from '../components/Wheel';
import {
  Bouncy, CHANGE, Enter, FadeSwap, rowIn, shiftIn, useAnimLevel, useBuilt, useFocusKey,
} from '../components/Motion';
import { tick } from '../haptics';
import { rescheduleAllReminders, ensurePermission } from '../notifications';
import { openTool } from '../toolNav';
import { toast } from '../components/Toast';

const FULL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function PlannerScreen({ mode }: { mode: 'tab' | 'stack' }) {
  const insets = useSafeAreaInsets();
  const fk = useFocusKey();
  const level = useAnimLevel();
  const built = useBuilt();
  useTheme(); // repaints on a new accent: the day and the NOW badge read it

  const planner = useStore((s) => s.planner);
  const removeBlock = useStore((s) => s.removeBlock);
  const copyDay = useStore((s) => s.copyDay);
  const restorePlanner = useStore((s) => s.restorePlanner);

  const habits = useStore((s) => s.habits);
  const toggleHabitToday = useStore((s) => s.toggleHabitToday);
  const removeHabit = useStore((s) => s.removeHabit);
  const restoreHabit = useStore((s) => s.restoreHabit);
  // a change made from a sheet says so once the sheet has gone, where its Undo can be seen
  const afterSheet = React.useRef<(() => void) | null>(null);
  const runAfterSheet = useCallback(() => { const f = afterSheet.current; afterSheet.current = null; f?.(); }, []);
  const hour24 = useStore((s) => s.settings.hour24);

  const [day, setDay] = useState<DayName>(dayName());
  // which way the last day change went: the new day's blocks come in from that side
  const dayDir = React.useRef(0);
  const [blockSheet, setBlockSheet] = useState(false);
  const [editing, setEditing] = useState<PlannerBlock | null>(null);
  const [copySheet, setCopySheet] = useState(false);
  const [tplSheet, setTplSheet] = useState(false);
  const [habitSheet, setHabitSheet] = useState(false);
  const [remindEdit, setRemindEdit] = useState<Habit | null>(null);

  const blocks = useMemo(
    () => [...planner[day]].sort((a, b) => toMinutes(a.start) - toMinutes(b.start)),
    [planner, day]
  );
  const today = todayKey();
  // tick every 30s so the NOW badge appears/clears while the screen sits open
  const now = useNow();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const viewingToday = day === dayName();
  const dayIdx = DAY_NAMES.indexOf(day);
  const todayIdx = DAY_NAMES.indexOf(dayName(now));

  // the blocks follow the wheel: the new day's blocks arrive from the side the new day came from. They are a new
  // view with its own entrance, so the old day's blocks never flash sideways before the new ones replace them.
  const pickDay = (i: number) => {
    const next = DAY_NAMES[i];
    if (!next || next === day) return;
    dayDir.current = (i - dayIdx + 7) % 7 <= 3 ? 1 : -1;
    setDay(next);
  };
  const dayIn = useMemo(
    () => (built.current && level !== 'none' ? shiftIn(dayDir.current * 16) : undefined),
    [day, level]
  );

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
    const before = all.slice(0, all.findIndex((x) => x.id === h.id)).map((x) => x.id);
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

  const tabMode = mode === 'tab';
  const plannerActions = (
    <Row>
      <IconBtn name="copy-outline" color={C.textDim} onPress={() => setCopySheet(true)} accessibilityLabel="Copy this day" />
      <IconBtn name="albums-outline" color={C.textDim} onPress={() => setTplSheet(true)} accessibilityLabel="Week templates" />
    </Row>
  );

  return (
    <ScreenBG guard={tabMode}>
      {!tabMode && <NeuHeader title="Planner" right={plannerActions} />}
      <ScrollView
        key={fk}
        contentContainerStyle={{ padding: S.pad, paddingTop: tabMode ? insets.top + 20 : 8, paddingBottom: 44 + (tabMode ? 0 : insets.bottom) }}
        showsVerticalScrollIndicator={false}
      >
        {tabMode && (
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={T.display}>Planner</Text>
            {plannerActions}
          </Row>
        )}

        {/* the day: drag the wheel or tap a day beside it, and the blocks follow in the same direction */}
        <Enter index={0}>
          <View style={st.wheelWrap}>
            <Wheel
              loop
              count={7}
              index={dayIdx}
              onChange={pickDay}
              label={(i) => ({ full: FULL_DAYS[i], short: DAY_NAMES[i] })}
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

        {/* blocks */}
        <Animated.View key={day} entering={dayIn}>
          <DayBlocks
            day={day} blocks={blocks} hour24={hour24} nowMin={viewingToday ? nowMin : -1}
            onEdit={openEdit} onDelete={deleteBlock}
          />
        </Animated.View>
        <PillButton label={`Add block to ${day}`} icon="add" onPress={openAdd} style={{ marginTop: 4 }} />

        {/* streaks */}
        <SectionTitle
          right={
            <Pressable onPress={() => setHabitSheet(true)} hitSlop={8}>
              <Text style={{ color: C.accent, fontSize: 13, fontFamily: F.semi }}>+ Habit</Text>
            </Pressable>
          }
        >
          Streaks
        </SectionTitle>
        {habits.length === 0 ? (
          <EmptyState compact icon="repeat-outline" title="No habits yet" body="Daily habits with streak counters. Small, repeatable, honest." />
        ) : (
          <Enter index={2}>
            <ListCard>
              {habits.map((h) => (
                <HabitRow
                  key={h.id} h={h} today={today}
                  onToggle={toggleHabitToday} onRemind={setRemindEdit} onDelete={deleteHabit}
                />
              ))}
            </ListCard>
          </Enter>
        )}
      </ScrollView>

      <BlockSheet visible={blockSheet} day={day} editing={editing} onClose={() => setBlockSheet(false)} />

      {/* copy day sheet */}
      <Sheet visible={copySheet} onClose={() => setCopySheet(false)} onClosed={runAfterSheet} title={`Copy ${day} to…`}>
        <Row style={{ flexWrap: 'wrap' }}>
          {DAY_NAMES.filter((d) => d !== day).map((d) => (
            <Chip
              key={d} label={d}
              onPress={() => {
                const before = useStore.getState().planner;
                copyDay(day, d);
                afterSheet.current = () => toast('Copied ' + day + ' to ' + d, { label: 'Undo', onPress: () => restorePlanner(before) });
                setCopySheet(false);
              }}
            />
          ))}
        </Row>
        <Text style={[T.caption, { marginTop: 8 }]}>Replaces the target day's blocks.</Text>
      </Sheet>

      <TemplatesSheet
        visible={tplSheet}
        onClose={() => setTplSheet(false)}
        onClosed={runAfterSheet}
        onApplied={(name, before) => {
          afterSheet.current = () => toast('Applied ' + name + ' to the week', { label: 'Undo', onPress: () => restorePlanner(before) });
        }}
      />

      <HabitSheet visible={habitSheet} onClose={() => setHabitSheet(false)} />

      <ReminderSheet habit={remindEdit} onClose={() => setRemindEdit(null)} />
    </ScreenBG>
  );
}

/**
 * The day's blocks. Built afresh for each day (the day's own entrance brings them in); on the same day, a first block
 * added to an empty day fades in rather than appearing in one frame.
 */
function DayBlocks({ day, blocks, hour24, nowMin, onEdit, onDelete }: {
  day: DayName; blocks: PlannerBlock[]; hour24: boolean;
  /** the minute of the day, when the day shown is today; -1 on any other day */
  nowMin: number;
  onEdit: (b: PlannerBlock) => void; onDelete: (b: PlannerBlock) => void;
}) {
  const level = useAnimLevel();
  const built = useBuilt();
  if (blocks.length === 0) {
    return <EmptyState compact icon="calendar-outline" title={'No blocks on ' + day} body="Add subjects with start and end times below." />;
  }
  return (
    <Animated.View entering={built.current ? rowIn(level) : undefined}>
      <ListCard>
        {blocks.map((b) => (
          <BlockRow
            key={b.id} b={b} hour24={hour24}
            isNow={nowMin >= 0 && toMinutes(b.start) <= nowMin && nowMin < toMinutes(b.end)}
            onEdit={onEdit} onDelete={onDelete}
          />
        ))}
      </ListCard>
    </Animated.View>
  );
}

/** One block of the day. Memoised, so the minute turning re-renders only a block whose NOW badge changes. */
const BlockRow = React.memo(function BlockRow({ b, hour24, isNow, onEdit, onDelete }: {
  b: PlannerBlock; hour24: boolean; isNow: boolean; onEdit: (b: PlannerBlock) => void; onDelete: (b: PlannerBlock) => void;
}) {
  useTheme(); // a memo row: it follows a new accent itself, since its props do not change with one
  return (
    <ListRow onPress={() => openTool('focus', { subject: b.subject })} style={{ paddingVertical: 12 }}>
      <View style={[st.colorBar, { backgroundColor: b.color }]} />
      <View style={{ flex: 1 }}>
        <Text style={T.title}>{b.subject}</Text>
        <Text style={[T.caption, { marginTop: 2, fontVariant: ['tabular-nums'] }]}>
          {fmtClockTime(toMinutes(b.start), hour24)} – {fmtClockTime(toMinutes(b.end), hour24)}
          <Text style={{ color: C.textFaint }}>{'   tap for Deep Work'}</Text>
        </Text>
      </View>
      {isNow && (
        <View style={[st.nowPill, { borderColor: C.accent + '66', backgroundColor: C.accent + '1A' }]}>
          <Text style={[st.nowText, { color: C.accent }]}>NOW</Text>
        </View>
      )}
      <IconBtn name="create-outline" size={18} onPress={() => onEdit(b)} accessibilityLabel={'Edit ' + b.subject} />
      <IconBtn name="trash-outline" size={18} onPress={() => onDelete(b)} accessibilityLabel={'Delete ' + b.subject} />
    </ListRow>
  );
});

/**
 * One habit with its streak. Memoised, and its streak is worked out only when its dates change, so ticking one habit
 * re-renders that habit alone. The streak line never states a zero: a habit with no streak yet shows none.
 */
const HabitRow = React.memo(function HabitRow({ h, today, onToggle, onRemind, onDelete }: {
  h: Habit; today: string; onToggle: (id: string) => void; onRemind: (h: Habit) => void; onDelete: (h: Habit) => void;
}) {
  useTheme(); // a memo row: it follows a new accent itself, since its props do not change with one
  const { current, best } = useMemo(() => streaks(h.doneDates), [h.doneDates]);
  const done = h.doneDates.includes(today);
  const streakText = [current > 0 ? current + ' current' : '', best > 0 ? best + ' best' : ''].filter(Boolean).join(' · ');
  return (
    <ListRow style={{ paddingVertical: 12 }}>
      <CheckCircle done={done} onPress={() => onToggle(h.id)} label={h.title + ', today'} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={T.title}>{h.title}</Text>
        {streakText || h.remindTime ? (
          // the streak's figures dip and come back as the tick lands, instead of jumping
          <FadeSwap swapKey={streakText}>
            <Row style={{ marginTop: 3 }}>
              {streakText ? (
                <>
                  <Ionicons name="flame-outline" size={13} color={C.textFaint} style={{ marginRight: 4 }} />
                  <Text style={T.caption}>{streakText}</Text>
                </>
              ) : null}
              {h.remindTime ? (
                <>
                  <Ionicons name="alarm-outline" size={13} color={C.textFaint} style={{ marginLeft: streakText ? 10 : 0 }} />
                  <Text style={[T.caption, { marginLeft: 4 }]}>{h.remindTime}</Text>
                </>
              ) : null}
            </Row>
          </FadeSwap>
        ) : null}
      </View>
      <IconBtn
        name="alarm-outline" size={18}
        color={h.remindTime ? C.accent : C.textFaint}
        onPress={() => onRemind(h)}
        accessibilityLabel={h.remindTime ? 'Reminder at ' + h.remindTime : 'Set a reminder'}
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
      accessibilityRole="button" accessibilityState={{ selected: active }}
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
  // each opening starts from the block being edited, or from blank
  React.useEffect(() => {
    if (!visible) return;
    setSubj(editing ? editing.subject : '');
    setStart(editing ? editing.start : '');
    setEnd(editing ? editing.end : '');
    setColor(editing ? editing.color : BLOCK_COLORS[0]);
  }, [visible]);

  const submit = () => {
    const s = start.trim(), e = end.trim(), t = subj.trim();
    if (!t) { Alert.alert('Missing subject', 'Give the block a subject.'); return; }
    if (toMinutes(s) < 0 || toMinutes(e) < 0) { Alert.alert('Time format', 'Use 24h HH:MM, e.g. 16:00'); return; }
    if (toMinutes(e) <= toMinutes(s)) { Alert.alert('Time order', 'End must be after start.'); return; }
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
      Alert.alert(
        'Overlaps ' + clash.subject,
        clash.subject + ' runs ' + clash.start + ' to ' + clash.end + ' on ' + day + '. Save this block anyway?',
        [{ text: 'Cancel', style: 'cancel' }, { text: 'Save anyway', onPress: save }],
      );
      return;
    }
    save();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={editing ? 'Edit block' : `New block for ${day}`}>
      <Field label="Subject" value={subj} onChangeText={setSubj} placeholder="e.g. Physics" autoFocus />
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

/** Week templates: save the week under a name, apply one, delete one. The name being typed lives here. */
function TemplatesSheet({ visible, onClose, onClosed, onApplied }: {
  visible: boolean; onClose: () => void; onClosed: () => void;
  /** a template was applied over `before`: the week as it was, for the Undo said once the sheet has gone */
  onApplied: (name: string, before: PlannerWeek) => void;
}) {
  const weekTemplates = useStore((s) => s.weekTemplates);
  const saveTemplate = useStore((s) => s.saveTemplate);
  const applyTemplate = useStore((s) => s.applyTemplate);
  const deleteTemplate = useStore((s) => s.deleteTemplate);
  const [tplName, setTplName] = useState('');
  const names = Object.keys(weekTemplates);
  return (
    <Sheet visible={visible} onClose={onClose} onClosed={onClosed} title="Week templates">
      {names.length === 0 && (
        <Text style={[T.caption, { marginBottom: 10 }]}>
          Save the whole week ("Exam week", "Normal week") and switch anytime.
        </Text>
      )}
      {names.map((name) => (
        <Row key={name} style={{ paddingVertical: 8 }}>
          <Text style={[T.body, { flex: 1 }]}>{name}</Text>
          <PillButton
            small label="Apply" style={{ marginRight: 8 }}
            onPress={() => {
              const before = useStore.getState().planner;
              applyTemplate(name);
              onApplied(name, before);
              onClose();
            }}
          />
          <IconBtn
            name="trash-outline" size={18} accessibilityLabel={'Delete template ' + name}
            onPress={() => Alert.alert('Delete ' + name + '?', 'The template goes. The week you are planning stays as it is.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => deleteTemplate(name) },
            ])}
          />
        </Row>
      ))}
      <Row style={{ marginTop: 10 }}>
        <Field value={tplName} onChangeText={setTplName} placeholder="Save current week as…" style={{ flex: 1, marginBottom: 0 }} />
        <PillButton
          small label="Save" style={{ marginLeft: 8 }}
          onPress={() => { if (tplName.trim()) { saveTemplate(tplName.trim()); setTplName(''); } }}
        />
      </Row>
    </Sheet>
  );
}

/** A new habit. What is typed lives here, so a keystroke re-renders the sheet alone. */
function HabitSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const addHabit = useStore((s) => s.addHabit);
  const remindersEnabled = useStore((s) => s.settings.remindersEnabled);
  const [habitTitle, setHabitTitle] = useState('');
  const [habitTime, setHabitTime] = useState('');
  const submit = async () => {
    const t = habitTitle.trim();
    if (!t) return;
    const typed = habitTime.trim();
    const time = /^\d{1,2}:\d{2}$/.test(typed) && toMinutes(typed) >= 0 ? typed : undefined;
    // a time that could never ring is said to be wrong, never saved looking like a working reminder
    if (typed && !time) { Alert.alert('Time format', 'Use 24h HH:MM, like 21:00, or leave it empty.'); return; }
    addHabit(t, time);
    setHabitTitle(''); setHabitTime(''); onClose();
    if (time && remindersEnabled) {
      await ensurePermission();
      await rescheduleAllReminders();
    }
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="New habit">
      <Field value={habitTitle} onChangeText={setHabitTitle} placeholder="e.g. Revise formula sheet" autoFocus />
      <Field value={habitTime} onChangeText={setHabitTime} placeholder="Reminder time 21:00 (optional)" keyboardType="numbers-and-punctuation" />
      <PillButton label="Add habit" onPress={submit} />
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
  React.useEffect(() => {
    if (!habit) return;
    setShown(habit);
    setDraft(habit.remindTime || '');
  }, [habit]);
  const save = async () => {
    if (!habit) return;
    const t = draft.trim();
    const valid = /^\d{1,2}:\d{2}$/.test(t) && toMinutes(t) >= 0;
    if (t && !valid) { Alert.alert('Time format', 'Use 24h HH:MM, like 21:00, or leave it empty to clear.'); return; }
    setHabitReminder(habit.id, valid ? t : undefined);
    onClose();
    if (remindersEnabled) {
      await ensurePermission();
      await rescheduleAllReminders();
    }
  };
  return (
    <Sheet visible={!!habit} onClose={onClose} title={`Reminder for ${shown?.title || 'this habit'}`}>
      <Field
        value={draft} onChangeText={setDraft}
        placeholder="24h HH:MM, e.g. 21:00 (empty = off)" keyboardType="numbers-and-punctuation" autoFocus
      />
      <PillButton label="Save" onPress={save} />
      {!remindersEnabled && (
        <Text style={[T.caption, { marginTop: 10 }]}>
          Reminders are off in Settings, so times are saved but stay silent until you turn them on.
        </Text>
      )}
    </Sheet>
  );
}

const st = StyleSheet.create({
  wheelWrap: { marginTop: 10, marginBottom: 18 },
  dayText: { fontFamily: F.head, fontSize: 24, lineHeight: 30, letterSpacing: -0.3 },
  todayLink: { alignSelf: 'center', marginTop: 2 },
  todayPress: { paddingHorizontal: 8, paddingVertical: 2 },
  todayText: { fontFamily: F.semi, fontSize: 13 },
  colorBar: { width: 4, height: 36, borderRadius: 2, marginRight: 12 },
  nowPill: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3, marginRight: 4 },
  nowText: { fontFamily: F.semi, fontSize: 11, letterSpacing: 1 },
  // flat: a ring in the block's own colour marks the chosen one
  swatchWell: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  swatchRing: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 20, borderWidth: 2 },
  swatchDisc: { width: 24, height: 24, borderRadius: 12 },
});
