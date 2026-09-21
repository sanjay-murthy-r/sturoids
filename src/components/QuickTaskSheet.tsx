import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { C, F, T } from '../theme';
import { useStore } from '../store';
import { todayKey } from '../utils';
import { shiftKey } from '../journal';
import { fmtExamDate } from '../scores';
import { Sheet, Field, PillButton, Chip, Row } from './UI';
import { SegmentedControl } from './SegmentedControl';
import { JournalCalendar } from './JournalCalendar';
import { toast } from './Toast';

export type TaskKind = 'daily' | 'mission';

const DUE: { days: number; label: string }[] = [
  { days: 0, label: 'Today' }, { days: 1, label: 'Tomorrow' }, { days: 3, label: 'In 3 days' },
  { days: 7, label: 'In a week' }, { days: 14, label: 'In 2 weeks' },
];

/**
 * Adding a task from anywhere: a ToDo for today's list, or a long-term task with a deadline picked from a few
 * chips or the calendar. Once it closes, a toast confirms it with Undo.
 */
export function QuickTaskSheet({ visible, onClose, onClosed, initialKind = 'daily', initialTitle = '' }: {
  visible: boolean; onClose: () => void;
  /** runs after the sheet has gone, and after its toast */
  onClosed?: () => void;
  initialKind?: TaskKind; initialTitle?: string;
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

  React.useEffect(() => {
    if (!visible) return;
    setKind(initialKind);
    setTitle(initialTitle);
    setDue(shiftKey(todayKey(), 7));
    setCalendar(false);
  }, [visible]);

  const add = () => {
    const t = title.trim();
    if (!t) return;
    const id = kind === 'daily' ? addDaily(t) : addMission(t, due);
    added.current = { kind, id };
    onClose();
  };

  const today = todayKey();
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
        }
        onClosed?.();
      }}
      title="Add to Tasks"
    >
      <SegmentedControl
        size="sm"
        stretch
        style={{ marginBottom: 8 }}
        options={[{ key: 'daily', label: 'ToDo' }, { key: 'mission', label: 'Long-term' }]}
        value={kind}
        onChange={(k) => setKind(k as TaskKind)}
      />
      <Text style={[T.caption, { marginBottom: 12 }]}>
        {kind === 'daily' ? "Goes on today's list." : 'Stays until it is done, with a deadline.'}
      </Text>
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
        <>
          <Text style={st.label}>Due</Text>
          <Row style={{ flexWrap: 'wrap' }}>
            {DUE.map((x) => {
              const key = shiftKey(today, x.days);
              return <Chip key={x.days} small label={x.label} active={!calendar && due === key} onPress={() => { setDue(key); setCalendar(false); }} />;
            })}
            <Chip small icon="calendar-outline" label="Pick a day" active={calendar} onPress={() => setCalendar(!calendar)} />
          </Row>
          <Text style={[T.caption, { marginBottom: calendar ? 10 : 14 }]}>Due {fmtExamDate(due, true)}</Text>
          {calendar ? (
            <View style={{ marginBottom: 14 }}>
              <JournalCalendar value={due} minKey={today} onPick={(k) => { setDue(k); setCalendar(false); }} />
            </View>
          ) : null}
        </>
      ) : null}
      <PillButton label="Add" icon="add-outline" onPress={add} />
    </Sheet>
  );
}

const st = StyleSheet.create({
  label: { color: C.textFaint, fontFamily: F.med, fontSize: 12, letterSpacing: 0.2, marginLeft: 2, marginBottom: 8 },
});
