import React from 'react';
import { Text, StyleSheet, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C, F, T, TRACK } from '../theme';
import { useStore, DailyTask, Mission, TaskRemind } from '../store';
import { todayKey, toMinutes, fmtClockTime } from '../utils';
import { shiftKey } from '../journal';
import { fmtExamDate } from '../scores';
import { turnOnReminders } from '../notifications';
import { Sheet, Field, PillButton, Chip, Row, TimeField, Toggle } from './UI';
import { SegmentedControl } from './SegmentedControl';
import { JournalCalendar } from './JournalCalendar';
import { Appear, FadeSwap } from './Motion';
import { toast } from './Toast';

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
function ringsLine(kind: TaskKind, repeat: boolean, time: string, remind: TaskRemind, hour24: boolean): string {
  const due = toMinutes(time);
  if (due < 0) return '';
  const when = kind === 'mission' ? ' on the day it is due.' : repeat ? ' each day it is still open.' : ' each day until it is ticked.';
  if (remind === 'morning') {
    return due > MORNING_MIN ? 'Rings at ' + shortClock(hhmmOf(MORNING_MIN), hour24) + when : 'Due too early for a morning reminder.';
  }
  const at = due - 60;
  // an hour before a time just after midnight falls on the evening before
  if (at < 0) return 'Rings at ' + shortClock(hhmmOf(at + 1440), hour24) + ' the evening before.';
  return 'Rings at ' + shortClock(hhmmOf(at), hour24) + when;
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
  // a ToDo that comes back every day; off, it is a one-off that goes once it is ticked and its day is over
  const [daily, setDaily] = React.useState(false);
  // the time it is due by ('' for none), and the reminder on it
  const [time, setTime] = React.useState('');
  const [remind, setRemind] = React.useState<TaskRemind | ''>('');
  // the time's field shows once "Add a time" is tapped, or from the start for a task that has one
  const [timeOpen, setTimeOpen] = React.useState(false);
  const added = React.useRef<{ kind: TaskKind; id: string } | null>(null);
  const saved = React.useRef('');
  // One task per opening. Return can land in the same frame as the button, and the sheet still takes a tap while it
  // leaves: either would add the task twice, and Undo would take back only one of them.
  const done = React.useRef(false);

  React.useEffect(() => {
    if (!visible) return;
    done.current = false;
    setKind(editing ? (isMission(editing) ? 'mission' : 'daily') : initialKind);
    setTitle(editing ? editing.title : initialTitle);
    setDue(editing && isMission(editing) ? editing.deadline : shiftKey(todayKey(), 7));
    setCalendar(false);
    setDaily(!!editing && !isMission(editing) && editing.repeat === 'daily');
    setTime(editing?.time ?? '');
    setRemind(editing?.time ? editing.remind ?? '' : '');
    setTimeOpen(!!editing?.time);
  }, [visible]);

  const pickTime = React.useCallback((v: string) => {
    setTime(v);
    // a reminder hangs on its time: cleared, the time takes its reminder with it
    if (!v) setRemind('');
  }, []);

  const add = () => {
    if (done.current) return;
    const t = title.trim();
    if (!t) return;
    done.current = true;
    const at = time;
    const rem: TaskRemind | null = at && remind ? remind : null;
    // a reminder newly set (a new one, or one moved to another time) asks for permission and turns reminders on, as
    // every reminder in the app does
    const newReminder = !!rem && (!editing || rem !== (editing.remind ?? null) || at !== (editing.time ?? ''));
    const timeChanged = !!editing && (at !== (editing.time ?? '') || rem !== (editing.remind ?? null));
    if (editing && isMission(editing)) {
      if (t !== editing.title || due !== editing.deadline || timeChanged) {
        updateMission(editing.id, { title: t, deadline: due, time: at || null, remind: rem });
        saved.current = 'Task saved';
      }
    } else if (editing) {
      const task = editing as DailyTask;
      const repeat = daily ? 'daily' : null;
      if (t !== task.title || repeat !== (task.repeat ?? null) || timeChanged) {
        // updateDaily clears an earlier day's tick when the ToDo becomes a one-off, so it stays open
        updateDaily(task.id, { title: t, repeat, time: at || null, remind: rem });
        saved.current = 'ToDo saved';
      }
    } else if (kind === 'daily') {
      const id = addDaily(t, {
        ...(daily ? { repeat: 'daily' as const } : {}),
        ...(at ? { time: at } : {}),
        ...(rem ? { remind: rem } : {}),
      });
      added.current = { kind, id };
    } else {
      const id = addMission(t, due);
      if (at) updateMission(id, { time: at, remind: rem });
      added.current = { kind, id };
    }
    onClose();
    if (newReminder && !useStore.getState().settings.remindersEnabled) void turnOnReminders();
  };

  const showRings = !!(time && remind);
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
          <FadeSwap swapKey={kind + (daily ? ':daily' : '')}>
            <Text style={[T.caption, { marginBottom: 12 }]}>
              {kind === 'mission'
                ? 'Stays until it is done, with a deadline.'
                : daily ? 'Comes back to your list every day.' : 'Stays on your list until it is ticked.'}
            </Text>
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
        <Row style={st.switchRow}>
          <Text style={[T.body, { flex: 1 }]}>Every day</Text>
          <Toggle value={daily} onChange={setDaily} label="Every day" />
        </Row>
      ) : (
        <DuePicker due={due} calendar={calendar} onDue={setDue} onCalendar={setCalendar} />
      )}
      {timeOpen ? (
        <Appear>
          <TimeField label="Due by" value={time} onChange={pickTime} clearable />
          {time ? (
            <Appear>
              <Text style={st.label}>Reminder</Text>
              <Row style={{ flexWrap: 'wrap' }}>
                {REMINDS.map((r) => (
                  <Chip key={r.label} small label={r.label} active={remind === r.key} onPress={() => setRemind(r.key)} />
                ))}
              </Row>
              {/* the help line crosses over as the choice changes, and is gone with Off */}
              <FadeSwap swapKey={showRings ? remind + time + daily : 'off'}>
                {showRings ? (
                  <Text style={[T.caption, st.rings]}>{ringsLine(kind, daily, time, remind as TaskRemind, hour24)}</Text>
                ) : <View style={st.ringsGap} />}
              </FadeSwap>
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
      {editing ? <PillButton label="Save" onPress={add} /> : <PillButton label="Add" icon="add-outline" onPress={add} />}
      {showRings && !remindersEnabled ? (
        <Text style={[T.caption, { marginTop: 10 }]}>
          Reminders are off in Settings. A reminder set here asks for notification permission and switches them on.
        </Text>
      ) : null}
    </Sheet>
  );
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
  // the switch sits under the title's field, with a field's 14 below it
  switchRow: { marginTop: 2, marginBottom: 16, paddingLeft: 2 },
  timeLink: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, paddingLeft: 2, marginBottom: 18 },
  linkText: { fontFamily: F.semi, fontSize: 13, letterSpacing: TRACK.small },
  rings: { marginTop: -2, marginBottom: 14, marginLeft: 2 },
  ringsGap: { height: 4 },
});
