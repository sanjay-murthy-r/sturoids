import React from 'react';
import { Text, StyleSheet, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C, F, T, TRACK } from '../theme';
import { useStore, DailyTask, Mission, MissionEarly, TaskRemind } from '../store';
import { todayKey, toMinutes, fmtClockTime, cleanDays, daysLabel, daysUntil } from '../utils';
import { shiftKey } from '../journal';
import { fmtExamDate } from '../scores';
import { turnOnReminders } from '../notifications';
import { Sheet, Field, PillButton, Chip, Row, TimeField } from './UI';
import { DayToggles, toggledDay } from './DayToggles';
import { tick } from '../haptics';
import { SegmentedControl } from './SegmentedControl';
import { JournalCalendar } from './JournalCalendar';
import { Appear, FadeSwap } from './Motion';
import { toast } from './Toast';
import { cheer } from '../cheerSound';

export type TaskKind = 'daily' | 'mission';

const DUE: { days: number; label: string }[] = [
  { days: 0, label: 'Today' }, { days: 1, label: 'Tomorrow' }, { days: 3, label: 'In 3 days' },
  { days: 7, label: 'In a week' }, { days: 14, label: 'In 2 weeks' },
];

const KINDS: { key: TaskKind; label: string }[] = [{ key: 'daily', label: 'ToDo' }, { key: 'mission', label: 'Long-term' }];

/** the reminder a task with a time can have; '' is none */
const REMINDS: { key: TaskRemind | ''; label: string }[] = [
  { key: '', label: 'Off' }, { key: 'morning', label: 'Morning of' }, { key: 'hour', label: 'An hour before' },
];
/** a morning reminder rings at 8 am, as the scheduler sets it */
const MORNING_MIN = 8 * 60;
/** a long-term task's early reminders ring at 6 pm, as the scheduler sets them */
const EARLY_MIN = 18 * 60;
/** a long-term task's early reminders, each shown while its day is still to come */
const EARLY: { key: MissionEarly; label: string; days: number }[] = [
  { key: '3d', label: '3 days before', days: 3 }, { key: '1d', label: '1 day before', days: 1 },
];

/** How a ToDo comes back: a one-off, every day, or on the weekdays picked. */
type RepeatMode = 'off' | 'daily' | 'days';
const REPEATS: { key: RepeatMode; label: string }[] = [
  { key: 'off', label: 'Off' }, { key: 'daily', label: 'Every day' }, { key: 'days', label: 'Some days' },
];
/** the days a ToDo starts on when "Some days" is first picked: the school week */
const WEEKDAYS = [0, 1, 2, 3, 4];

/** a 13 pt text link reaches a 44 dp target without moving anything around it */
const LINK_SLOP = { top: 14, bottom: 14, left: 10, right: 10 };

/**
 * A time of day said shortly, as a row's "by 5 pm" says it: the whole hour without its minutes on a 12-hour clock
 * ("5 pm", "5:30 pm"), the 24-hour clock as it reads ("17:00"), and the end of the day as "midnight".
 */
export function shortClock(hhmm: string, hour24: boolean): string {
  const m = toMinutes(hhmm);
  if (m < 0) return hhmm;
  if (m >= 1440) return 'midnight';
  if (hour24) return fmtClockTime(m, true);
  const h = Math.floor(m / 60);
  const min = m % 60;
  return (h % 12 || 12) + (min ? ':' + String(min).padStart(2, '0') : '') + (h >= 12 ? ' pm' : ' am');
}

const isMission = (t: DailyTask | Mission): t is Mission => 'deadline' in t;

/** minutes since midnight as 'HH:MM' */
const hhmmOf = (m: number) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');

/** When a reminder rings, said under its choice: a sentence for the task's kind, or why a morning one cannot. */
function ringsLine(kind: TaskKind, repeat: RepeatMode, time: string, remind: TaskRemind, hour24: boolean): string {
  const due = toMinutes(time);
  if (due < 0) return '';
  const when = kind === 'mission' ? ' on the day it is due.'
    : repeat === 'days' ? ' on each of its days it is still open.'
      : repeat === 'daily' ? ' each day it is still open.' : ' each day until it is ticked.';
  if (remind === 'morning') {
    return due > MORNING_MIN ? 'Rings at ' + shortClock(hhmmOf(MORNING_MIN), hour24) + when : 'Due too early for a morning reminder.';
  }
  const at = due - 60;
  // an hour before a time just after midnight falls on the evening before
  if (at < 0) return 'Rings at ' + shortClock(hhmmOf(at + 1440), hour24) + ' the evening before.';
  return 'Rings at ' + shortClock(hhmmOf(at), hour24) + when;
}

/**
 * When a long-term task's reminders ring, said under them in one sentence: the early ones at 6 pm, then the one on the
 * day (the morning of it, with or without a time, or an hour before its time).
 */
export function missionRingsLine(early: readonly MissionEarly[], remind: TaskRemind | '', time: string, hour24: boolean): string {
  const six = shortClock(hhmmOf(EARLY_MIN), hour24);
  const parts: string[] = [];
  if (early.includes('3d')) parts.push(six + ' three days before');
  // after "6 pm three days before" the hour is not said again
  if (early.includes('1d')) parts.push(early.includes('3d') ? 'the day before' : six + ' the day before');
  const due = toMinutes(time);
  let note = '';
  if (remind === 'morning') {
    if (due < 0 || due > MORNING_MIN) parts.push(shortClock(hhmmOf(MORNING_MIN), hour24) + ' on the day');
    else note = 'Due too early for a morning reminder.';
  } else if (remind === 'hour' && due >= 0) {
    const at = due - 60;
    parts.push(at < 0 ? shortClock(hhmmOf(at + 1440), hour24) + ' the evening before' : shortClock(hhmmOf(at), hour24) + ' on the day');
  }
  if (!parts.length) return note;
  const list = parts.length === 1 ? parts[0] : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
  return 'Rings at ' + list + '.' + (note ? ' ' + note : '');
}

/**
 * Adding a task from anywhere: a ToDo for today's list (once, or every day), or a long-term task with a deadline picked
 * from a few chips or the calendar. Either can be given a time it is due by, and then a reminder. Once it closes, a
 * toast confirms it with Undo. With `editing` it opens on that ToDo or long-term task instead, its kind fixed, and
 * saving a change says so once the sheet has gone.
 */
export function QuickTaskSheet({ visible, onClose, onClosed, initialKind = 'daily', initialTitle = '', editing = null }: {
  visible: boolean; onClose: () => void;
  /** runs after the sheet has gone, and after its toast */
  onClosed?: () => void;
  initialKind?: TaskKind; initialTitle?: string;
  /** the ToDo or long-term task being edited; none for a new task */
  editing?: DailyTask | Mission | null;
}) {
  const addDaily = useStore((s) => s.addDaily);
  const addMission = useStore((s) => s.addMission);
  const updateDaily = useStore((s) => s.updateDaily);
  const updateMission = useStore((s) => s.updateMission);
  const removeDaily = useStore((s) => s.removeDaily);
  const removeMission = useStore((s) => s.removeMission);
  const hour24 = useStore((s) => s.settings.hour24);
  const remindersEnabled = useStore((s) => s.settings.remindersEnabled);
  const [kind, setKind] = React.useState<TaskKind>(initialKind);
  const [title, setTitle] = React.useState(initialTitle);
  const [due, setDue] = React.useState(() => shiftKey(todayKey(), 7));
  const [calendar, setCalendar] = React.useState(false);
  // how a ToDo comes back: off, it is a one-off that goes once it is ticked and its day is over; every day; or on the
  // weekdays picked
  const [repeat, setRepeat] = React.useState<RepeatMode>('off');
  const [days, setDays] = React.useState<number[]>(WEEKDAYS);
  const [lastDay, setLastDay] = React.useState(false);
  // the time it is due by ('' for none), and the reminder on it
  const [time, setTime] = React.useState('');
  const [remind, setRemind] = React.useState<TaskRemind | ''>('');
  // a long-term task's early reminders, days before it is due
  const [early, setEarly] = React.useState<MissionEarly[]>([]);
  // the time's field shows once "Add a time" is tapped, or from the start for a task that has one
  const [timeOpen, setTimeOpen] = React.useState(false);
  const added = React.useRef<{ kind: TaskKind; id: string } | null>(null);
  const saved = React.useRef('');
  // One task per opening. Return can land in the same frame as the button, and the sheet still takes a tap while it
  // leaves: either would add the task twice, and Undo would take back only one of them.
  const done = React.useRef(false);
  // the kind as it is now, for the time's callback, which keeps its identity
  const kindRef = React.useRef(kind);
  kindRef.current = kind;

  React.useEffect(() => {
    if (!visible) return;
    done.current = false;
    const m = editing && isMission(editing) ? editing : null;
    const t = editing && !isMission(editing) ? editing : null;
    setKind(editing ? (m ? 'mission' : 'daily') : initialKind);
    setTitle(editing ? editing.title : initialTitle);
    setDue(m ? m.deadline : shiftKey(todayKey(), 7));
    setCalendar(false);
    setRepeat(t?.repeat === 'daily' ? (t.days?.length ? 'days' : 'daily') : 'off');
    setDays(t?.days?.length ? [...t.days] : WEEKDAYS);
    setLastDay(false);
    setTime(editing?.time ?? '');
    // a long-term task's morning reminder needs no time; a ToDo's reminder hangs on its time
    setRemind(m ? m.remind ?? '' : t?.time ? t.remind ?? '' : '');
    setEarly(m?.early ? [...m.early] : []);
    setTimeOpen(!!editing?.time);
  }, [visible]);

  const pickTime = React.useCallback((v: string) => {
    setTime(v);
    // a reminder hangs on its time: cleared, the time takes its reminder with it (a long-term task's morning one stays)
    if (!v) setRemind((r) => (r === 'morning' && kindRef.current === 'mission' ? r : ''));
  }, []);

  const pickRepeat = (r: RepeatMode) => { setRepeat(r); setLastDay(false); };
  const toggleDay = (d: number) => {
    tick();
    const next = toggledDay(days, d);
    if (!next) { setLastDay(true); return; }
    setDays(next);
    setLastDay(false);
  };
  // kept in the order the scheduler reads them: three days before, then the day before
  const toggleEarly = (e: MissionEarly) => {
    setEarly((x) => (x.includes(e) ? x.filter((y) => y !== e) : EARLY.map((o) => o.key).filter((k) => k === e || x.includes(k))));
  };
  // a long-term task's reminder on its day: the morning of it or an hour before (one or the other; tapped again, off)
  const toggleRemind = (r: TaskRemind) => setRemind((x) => (x === r ? '' : r));

  // the early reminders whose moment is still to come for the deadline picked
  const left = daysUntil(due);
  const earlyShown = EARLY.filter((e) => left > e.days || (left === e.days && !pastEarlyToday()));
  const isLong = kind === 'mission';
  const shownEarly = early.filter((e) => earlyShown.some((o) => o.key === e));
  // a long-term task's morning reminder rings with or without a time; any other reminder needs one
  const remNow: TaskRemind | '' = remind && (time || (isLong && remind === 'morning')) ? remind : '';

  const add = () => {
    if (done.current) return;
    const t = title.trim();
    if (!t) return;
    done.current = true;
    const at = time;
    const rem: TaskRemind | null = remNow || null;
    const earlyKeep = isLong ? shownEarly : [];
    const repeatOn = repeat !== 'off';
    const daysKeep = repeat === 'days' ? cleanDays(days) ?? null : null;
    const wasEarly = editing && isMission(editing) ? editing.early ?? [] : [];
    // a reminder newly set (a new one, or one moved to another time) asks for permission and turns reminders on, as
    // every reminder in the app does
    const newReminder = (!!rem && (!editing || rem !== (editing.remind ?? null) || at !== (editing.time ?? '')))
      || earlyKeep.some((e) => !wasEarly.includes(e));
    const timeChanged = !!editing && (at !== (editing.time ?? '') || rem !== (editing.remind ?? null));
    if (editing && isMission(editing)) {
      if (t !== editing.title || due !== editing.deadline || timeChanged || earlyKeep.join() !== wasEarly.join()) {
        updateMission(editing.id, { title: t, deadline: due, time: at || null, remind: rem, early: earlyKeep.length ? earlyKeep : null });
        saved.current = 'Task saved';
      }
    } else if (editing) {
      const task = editing as DailyTask;
      const rep = repeatOn ? 'daily' : null;
      if (t !== task.title || rep !== (task.repeat ?? null) || (daysKeep || []).join() !== (task.days || []).join() || timeChanged) {
        // updateDaily clears an earlier day's tick when the ToDo becomes a one-off, so it stays open
        updateDaily(task.id, { title: t, repeat: rep, days: daysKeep, time: at || null, remind: rem });
        saved.current = 'ToDo saved';
      }
    } else if (kind === 'daily') {
      const id = addDaily(t, {
        ...(repeatOn ? { repeat: 'daily' as const } : {}),
        ...(daysKeep ? { days: daysKeep } : {}),
        ...(at ? { time: at } : {}),
        ...(rem ? { remind: rem } : {}),
      });
      added.current = { kind, id };
      cheer('add');
    } else {
      const id = addMission(t, due);
      if (at || rem || earlyKeep.length) {
        updateMission(id, { time: at || null, remind: rem, early: earlyKeep.length ? earlyKeep : null });
      }
      added.current = { kind, id };
      cheer('add');
    }
    onClose();
    if (newReminder && !useStore.getState().settings.remindersEnabled) void turnOnReminders();
  };

  const showRings = isLong ? !!(shownEarly.length || remNow) : !!(time && remind);
  const rings = !showRings ? ''
    : isLong ? missionRingsLine(shownEarly, remNow, time, hour24)
      : ringsLine(kind, repeat, time, remind as TaskRemind, hour24);
  const caption = isLong
    ? 'Stays until it is done, with a deadline.'
    : repeat === 'daily' ? 'Comes back to your list every day.'
      : repeat === 'days' ? 'Comes back on the days you pick.' : 'Stays on your list until it is ticked.';
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      onClosed={() => {
        const a = added.current;
        added.current = null;
        if (a) {
          toast(a.kind === 'daily' ? 'Added to ToDos' : 'Added to long-term tasks', {
            label: 'Undo',
            onPress: () => (a.kind === 'daily' ? removeDaily(a.id) : removeMission(a.id)),
          });
        } else if (saved.current) {
          toast(saved.current);
        }
        saved.current = '';
        onClosed?.();
      }}
      title={editing ? (isMission(editing) ? 'Edit task' : 'Edit ToDo') : 'Add to Tasks'}
    >
      {/* an edit keeps the task's kind, so there is no choice to offer */}
      {editing ? null : (
        <>
          <SegmentedControl
            size="sm"
            stretch
            style={{ marginBottom: 8 }}
            options={KINDS}
            value={kind}
            onChange={(k) => setKind(k)}
          />
          <FadeSwap swapKey={kind + ':' + repeat}>
            <Text style={[T.caption, { marginBottom: 12 }]}>{caption}</Text>
          </FadeSwap>
        </>
      )}
      <Field
        value={title}
        onChangeText={setTitle}
        placeholder={kind === 'daily' ? 'e.g. 50 PYQs' : 'e.g. Full mock test + analysis'}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={add}
        maxLength={140}
      />
      {kind === 'daily' ? (
        <View>
          <Text style={st.label}>Repeat</Text>
          <Row style={{ flexWrap: 'wrap' }}>
            {REPEATS.map((r) => (
              <Chip key={r.key} small label={r.label} active={repeat === r.key} onPress={() => pickRepeat(r.key)} />
            ))}
          </Row>
          {repeat === 'days' ? (
            <Appear>
              <DayToggles value={days} onToggle={toggleDay} label="Repeat on" style={{ marginTop: 4 }} />
              <Text style={[T.caption, st.daysCaption]} accessibilityLiveRegion="polite">
                {lastDay ? 'At least one day' : daysLabel(days)}
              </Text>
            </Appear>
          ) : <View style={st.repeatGap} />}
        </View>
      ) : (
        <DuePicker due={due} calendar={calendar} onDue={setDue} onCalendar={setCalendar} />
      )}
      {timeOpen ? (
        <Appear>
          <TimeField label="Due by" value={time} onChange={pickTime} clearable />
          {time && !isLong ? (
            <Appear>
              <Text style={st.label}>Reminder</Text>
              <Row style={{ flexWrap: 'wrap' }}>
                {REMINDS.map((r) => (
                  <Chip key={r.label} small label={r.label} active={remind === r.key} onPress={() => setRemind(r.key)} />
                ))}
              </Row>
            </Appear>
          ) : null}
        </Appear>
      ) : (
        <Pressable
          onPress={() => setTimeOpen(true)} hitSlop={LINK_SLOP} style={st.timeLink}
          accessibilityRole="button" accessibilityLabel="Add a time it is due by"
        >
          <Ionicons name="time-outline" size={15} color={C.accent} />
          <Text style={[st.linkText, { color: C.accent }]}>Add a time</Text>
        </Pressable>
      )}
      {/* a long-term task's reminders need no time: days before it, and the morning of its day */}
      {isLong ? (
        <Appear>
          <Text style={st.label}>Reminders</Text>
          <Row style={{ flexWrap: 'wrap' }}>
            {earlyShown.map((e) => (
              <Chip
                key={e.key} small label={e.label} active={early.includes(e.key)} onPress={() => toggleEarly(e.key)}
                accessibilityRole="checkbox" accessibilityState={{ checked: early.includes(e.key) }}
              />
            ))}
            <Chip
              small label="Morning of" active={remind === 'morning'} onPress={() => toggleRemind('morning')}
              accessibilityRole="checkbox" accessibilityState={{ checked: remind === 'morning' }}
            />
            {time ? (
              <Chip
                small label="An hour before" active={remind === 'hour'} onPress={() => toggleRemind('hour')}
                accessibilityRole="checkbox" accessibilityState={{ checked: remind === 'hour' }}
              />
            ) : null}
          </Row>
        </Appear>
      ) : null}
      {/* the help line crosses over as the choice changes, and is gone with none */}
      {isLong || time ? (
        <FadeSwap swapKey={showRings ? rings : 'off'}>
          {showRings && rings ? <Text style={[T.caption, st.rings]}>{rings}</Text> : <View style={st.ringsGap} />}
        </FadeSwap>
      ) : null}
      {editing ? <PillButton label="Save" onPress={add} /> : <PillButton label="Add" icon="add-outline" onPress={add} />}
      {showRings && !remindersEnabled ? (
        <Text style={[T.caption, { marginTop: 10 }]}>
          Reminders are off in Settings. A reminder set here asks for notification permission and switches them on.
        </Text>
      ) : null}
    </Sheet>
  );
}

/** Whether 6 pm has gone today: an early reminder that falls today has then passed. */
function pastEarlyToday(now: Date = new Date()): boolean {
  return now.getHours() * 60 + now.getMinutes() >= EARLY_MIN;
}

/**
 * The deadline: a few chips and a calendar. Its own memoised part, so typing the title never re-renders the chips,
 * and it fades in when Long-term is chosen.
 */
const DuePicker = React.memo(function DuePicker({ due, calendar, onDue, onCalendar }: {
  due: string; calendar: boolean; onDue: (k: string) => void; onCalendar: (open: boolean) => void;
}) {
  const today = todayKey();
  return (
    <Appear>
      <Text style={st.label}>Due</Text>
      <Row style={{ flexWrap: 'wrap' }}>
        {DUE.map((x) => {
          const key = shiftKey(today, x.days);
          return <Chip key={x.days} small label={x.label} active={!calendar && due === key} onPress={() => { onDue(key); onCalendar(false); }} />;
        })}
        <Chip small icon="calendar-outline" label="Pick a day" active={calendar} onPress={() => onCalendar(!calendar)} />
      </Row>
      <Text style={[T.caption, { marginBottom: calendar ? 10 : 14 }]}>Due {fmtExamDate(due, true)}</Text>
      {calendar ? (
        <Appear style={{ marginBottom: 14 }}>
          <JournalCalendar value={due} minKey={today} onPick={(k) => { onDue(k); onCalendar(false); }} />
        </Appear>
      ) : null}
    </Appear>
  );
});

const st = StyleSheet.create({
  label: { color: C.textFaint, fontFamily: F.smMed, fontSize: 12, letterSpacing: TRACK.fine, marginLeft: 2, marginBottom: 8 },
  // the days' caption sits under the circles, with a field's 14 and a little after it
  daysCaption: { marginTop: 8, marginBottom: 16, marginLeft: 2 },
  // the chips' row keeps its own gap below; a little more before what follows
  repeatGap: { height: 6 },
  timeLink: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, paddingLeft: 2, marginBottom: 18 },
  linkText: { fontFamily: F.semi, fontSize: 13, letterSpacing: TRACK.small },
  rings: { marginTop: -2, marginBottom: 14, marginLeft: 2 },
  ringsGap: { height: 4 },
});
