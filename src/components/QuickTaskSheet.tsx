import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { C, F, T, TRACK } from '../theme';
import { useStore, DailyTask } from '../store';
import { todayKey } from '../utils';
import { shiftKey } from '../journal';
import { fmtExamDate } from '../scores';
import { Sheet, Field, PillButton, Chip, Row } from './UI';
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

/**
 * Saves a ToDo's new title. The store has no rename yet, so the ToDo is taken out and put back where it stood in the
 * same moment: one render, and its id, its tick and its place all stay.
 */
function renameDaily(id: string, title: string) {
  const s = useStore.getState();
  const index = s.dailyTasks.findIndex((t) => t.id === id);
  if (index < 0) return;
  const task = s.dailyTasks[index];
  s.removeDaily(id);
  s.restoreDaily({ ...task, title }, index);
}

/**
 * Adding a task from anywhere: a ToDo for today's list, or a long-term task with a deadline picked from a few
 * chips or the calendar. Once it closes, a toast confirms it with Undo. With `editing` it opens on that ToDo instead,
 * its kind fixed, and saving it says so once the sheet has gone.
 */
export function QuickTaskSheet({ visible, onClose, onClosed, initialKind = 'daily', initialTitle = '', editing = null }: {
  visible: boolean; onClose: () => void;
  /** runs after the sheet has gone, and after its toast */
  onClosed?: () => void;
  initialKind?: TaskKind; initialTitle?: string;
  /** the ToDo being edited; none for a new task */
  editing?: DailyTask | null;
}) {
  const addDaily = useStore((s) => s.addDaily);
  const addMission = useStore((s) => s.addMission);
  const removeDaily = useStore((s) => s.removeDaily);
  const removeMission = useStore((s) => s.removeMission);
  const [kind, setKind] = React.useState<TaskKind>(initialKind);
  const [title, setTitle] = React.useState(initialTitle);
  const [due, setDue] = React.useState(() => shiftKey(todayKey(), 7));
  const [calendar, setCalendar] = React.useState(false);
  const added = React.useRef<{ kind: TaskKind; id: string } | null>(null);
  const saved = React.useRef(false);
  // One task per opening. Return can land in the same frame as the button, and the sheet still takes a tap while it
  // leaves: either would add the task twice, and Undo would take back only one of them.
  const done = React.useRef(false);

  React.useEffect(() => {
    if (!visible) return;
    done.current = false;
    setKind(editing ? 'daily' : initialKind);
    setTitle(editing ? editing.title : initialTitle);
    setDue(shiftKey(todayKey(), 7));
    setCalendar(false);
  }, [visible]);

  const add = () => {
    if (done.current) return;
    const t = title.trim();
    if (!t) return;
    done.current = true;
    if (editing) {
      if (t !== editing.title) {
        renameDaily(editing.id, t);
        saved.current = true;
      }
    } else {
      const id = kind === 'daily' ? addDaily(t) : addMission(t, due);
      added.current = { kind, id };
    }
    onClose();
  };

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
          toast('ToDo saved');
        }
        saved.current = false;
        onClosed?.();
      }}
      title={editing ? 'Edit ToDo' : 'Add to Tasks'}
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
          <FadeSwap swapKey={kind}>
            <Text style={[T.caption, { marginBottom: 12 }]}>
              {kind === 'daily' ? "Goes on today's list." : 'Stays until it is done, with a deadline.'}
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
      {kind === 'mission' ? (
        <DuePicker due={due} calendar={calendar} onDue={setDue} onCalendar={setCalendar} />
      ) : null}
      {editing ? <PillButton label="Save" onPress={add} /> : <PillButton label="Add" icon="add-outline" onPress={add} />}
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
  label: { color: C.textFaint, fontFamily: F.med, fontSize: 12, letterSpacing: TRACK.fine, marginLeft: 2, marginBottom: 8 },
});
