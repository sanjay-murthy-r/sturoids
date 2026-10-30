// A Deep Work session, put right afterwards: opened from the quiet "Edit details" on the toast a session leaves as it
// is saved, and from a session's row in the focus history. It changes only what a student would want to change about a
// session already done: the time it really was (a break that was not paused taken off, or a stretch that was missed
// put on), what it was on, when it ended, how it went, what got done in it (ticking today's ToDos and tasks as done
// too) and a line about it. Nothing is written until Save; closing the sheet leaves the session as it was.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { create } from 'zustand';
import { Ionicons } from '@expo/vector-icons';
import Animated from 'react-native-reanimated';
import { C, F, S, T, TRACK } from '../theme';
import { FocusSession, useStore } from '../store';
import { todayKey } from '../utils';
import { Chip, Field, PillButton, Row, Sheet, TimeField } from './UI';
import { SubjectSuggest } from './SubjectSuggest';
import { glide, rowIn, rowOut, useAnimLevel } from './Motion';
import { toast } from './Toast';
import { tick } from '../haptics';
import { todayItems } from '../widgets/logic';

/** Which session the editor is open on (null: closed); `n` makes each opening a fresh sheet. */
export const useSessionEditor = create<{ id: string | null; open: boolean; n: number }>(() => ({ id: null, open: false, n: 0 }));

/** Opens the editor on a logged session. */
export function openSessionEditor(id: string) {
  if (!useStore.getState().sessions.some((s) => s.id === id)) return;
  useSessionEditor.setState((s) => ({ id, open: true, n: s.n + 1 }));
}
const closeEditor = () => useSessionEditor.setState({ open: false });

/** Mounted once, in the root layout. */
export function SessionEditorHost() {
  const { id, open, n } = useSessionEditor();
  if (!id || n === 0) return null;
  return <SessionEditor key={n} id={id} visible={open} onClose={closeEditor} />;
}

const MAX_MIN = 720;
const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (ms: number) => { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const minsText = (m: number) => (m >= 60 ? Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '') : m + ' min');
const RATINGS: { key: 1 | 2 | 3; label: string }[] = [
  { key: 1, label: 'Scattered' }, { key: 2, label: 'Steady' }, { key: 3, label: 'Deep' },
];

function SessionEditor({ id, visible, onClose }: { id: string; visible: boolean; onClose: () => void }) {
  const level = useAnimLevel();
  // the session as it was when the sheet opened: what the sheet shows is a draft of it
  const [base] = React.useState<FocusSession | null>(() => useStore.getState().sessions.find((s) => s.id === id) ?? null);
  const hour24 = useStore((s) => s.settings.hour24);
  const dailies = useStore((s) => s.dailyTasks);
  const missions = useStore((s) => s.missions);
  const [min, setMin] = React.useState(() => Math.max(1, Math.round((base?.netSeconds ?? 60) / 60)));
  const [minText, setMinText] = React.useState(String(min));
  const [subject, setSubject] = React.useState(base?.subject ?? '');
  const [end, setEnd] = React.useState(base ? hhmm(base.endedAt) : '');
  const [rating, setRating] = React.useState<1 | 2 | 3 | null>(base?.rating ?? null);
  const [tasks, setTasks] = React.useState<string[]>(base?.taskTitles ?? []);
  const [newTask, setNewTask] = React.useState('');
  const [note, setNote] = React.useState(base?.note ?? '');
  // today's ToDos and tasks ticked here: done in the store as the session is saved
  const [ticked, setTicked] = React.useState<{ kind: 'daily' | 'mission'; id: string; title: string }[]>([]);
  // what the closing toast says, once the sheet has gone
  const said = React.useRef<(() => void) | null>(null);

  if (!base) return null;
  const timedMin = Math.max(1, Math.round((base.timedSeconds ?? base.netSeconds) / 60));
  const isToday = base.dateKey === todayKey();
  const open = isToday
    ? todayItems(dailies, missions, base.dateKey).filter((t) => !t.done && !tasks.includes(t.title))
    : [];

  const setMinutes = (m: number) => {
    const v = Math.max(1, Math.min(MAX_MIN, Math.round(m)));
    setMin(v);
    setMinText(String(v));
  };
  const typeMinutes = (v: string) => {
    const digits = v.replace(/[^0-9]/g, '').slice(0, 3);
    setMinText(digits);
    const n = parseInt(digits, 10);
    if (n >= 1 && n <= MAX_MIN) setMin(n);
  };
  const addTask = (title: string) => {
    const t = title.trim().replace(/\s+/g, ' ');
    if (!t) return;
    tick();
    setTasks((list) => (list.includes(t) ? list : [...list, t]));
    setNewTask('');
  };
  const tickToday = (t: { kind: 'daily' | 'mission'; id: string; title: string }) => {
    addTask(t.title);
    setTicked((list) => [...list, t]);
  };
  const dropTask = (t: string) => {
    tick();
    setTasks((list) => list.filter((x) => x !== t));
    setTicked((list) => list.filter((x) => x.title !== t));
  };

  const save = () => {
    const st = useStore.getState();
    let endedAt: number | undefined;
    const m = /^(\d{2}):(\d{2})$/.exec(end);
    if (m && end !== hhmm(base.endedAt)) {
      const [y, mo, d] = base.dateKey.split('-').map(Number);
      endedAt = new Date(y, mo - 1, d, Number(m[1]), Number(m[2])).getTime();
    }
    st.updateSession(id, {
      subject, note, rating, taskTitles: tasks,
      ...(min * 60 !== base.netSeconds && min !== Math.round(base.netSeconds / 60) ? { minutes: min } : {}),
      ...(endedAt !== undefined ? { endedAt } : {}),
    });
    // today's ToDos and tasks picked as done here are ticked, only ever forward
    for (const t of ticked) {
      if (t.kind === 'daily') {
        const x = st.dailyTasks.find((d) => d.id === t.id);
        if (x && x.doneOn !== todayKey()) st.toggleDaily(t.id);
      } else {
        const x = st.missions.find((d) => d.id === t.id);
        if (x && !x.done) st.toggleMission(t.id);
      }
    }
    tick();
    said.current = () => toast('Session updated');
    onClose();
  };

  const remove = () => {
    const out = useStore.getState().removeSession(id);
    if (!out) { onClose(); return; }
    said.current = () => toast('Session deleted', { label: 'Undo', onPress: () => useStore.getState().restoreSession(out.session, out.index) });
    onClose();
  };

  const started = hhmm((() => {
    const mm = /^(\d{2}):(\d{2})$/.exec(end);
    const [y, mo, d] = base.dateKey.split('-').map(Number);
    const endMs = mm ? new Date(y, mo - 1, d, Number(mm[1]), Number(mm[2])).getTime() : base.endedAt;
    return endMs - min * 60_000;
  })());
  const clock = (t: string) => {
    if (hour24) return t;
    const [h, mi] = t.split(':').map(Number);
    return ((h % 12) || 12) + ':' + pad(mi) + (h < 12 ? ' am' : ' pm');
  };

  return (
    <Sheet
      visible={visible} onClose={onClose} title="Session details"
      onClosed={() => { const s = said.current; said.current = null; s?.(); }}
    >
      {/* the time it really was: a stretch off for a break that ran on, or one on for a stretch that was missed */}
      <Text style={st.label}>Focused time</Text>
      <Row style={{ alignItems: 'center', gap: 10 }}>
        <Pressable onPress={() => { tick(); setMinutes(min - 1); }} hitSlop={8} style={st.step} accessibilityRole="button" accessibilityLabel="A minute less">
          <Ionicons name="remove" size={18} color={C.text} />
        </Pressable>
        <Field
          value={minText} onChangeText={typeMinutes} keyboardType="number-pad" maxLength={3}
          onBlur={() => setMinText(String(min))}
          style={{ width: 72, marginBottom: 0, textAlign: 'center', fontVariant: ['tabular-nums'] }} accessibilityLabel="Minutes focused"
        />
        <Pressable onPress={() => { tick(); setMinutes(min + 1); }} hitSlop={8} style={st.step} accessibilityRole="button" accessibilityLabel="A minute more">
          <Ionicons name="add" size={18} color={C.text} />
        </Pressable>
        <Text style={[T.caption, { flex: 1 }]} numberOfLines={2}>
          {clock(started)} to {clock(end || hhmm(base.endedAt))}
        </Text>
      </Row>
      <View style={st.chips}>
        {[5, 10, 15].map((k) => (
          <Chip key={k} small label={'− ' + k + ' min'} onPress={() => setMinutes(min - k)} />
        ))}
        {min !== timedMin && !base.manual ? (
          <Animated.View entering={rowIn(level)} exiting={rowOut(level)}>
            <Chip small icon="refresh" label={'Timed ' + minsText(timedMin)} onPress={() => setMinutes(timedMin)} />
          </Animated.View>
        ) : null}
      </View>

      <Field label="Subject" value={subject} onChangeText={setSubject} placeholder="No subject" maxLength={60} style={{ marginTop: 18, marginBottom: 0 }} />
      <SubjectSuggest value={subject} max={5} onPick={setSubject} style={{ marginTop: 10 }} />

      <TimeField label="Ended at" value={end} onChange={setEnd} style={{ marginTop: 18 }} />

      <Text style={[st.label, { marginTop: 4 }]}>How it went</Text>
      <View style={st.chips}>
        {RATINGS.map((r) => (
          <Chip key={r.key} small label={r.label} active={rating === r.key} onPress={() => setRating(rating === r.key ? null : r.key)} />
        ))}
      </View>

      <Text style={[st.label, { marginTop: 18 }]}>What got done</Text>
      <Animated.View layout={glide(level)}>
        {tasks.map((t) => (
          <Animated.View key={t} entering={rowIn(level)} exiting={rowOut(level)} layout={glide(level)} style={st.taskRow}>
            <Ionicons name="checkmark-circle" size={18} color={C.green} />
            <Text style={st.taskText} numberOfLines={2}>{t}</Text>
            <Pressable onPress={() => dropTask(t)} hitSlop={10} accessibilityRole="button" accessibilityLabel={'Take off ' + t}>
              <Ionicons name="close" size={16} color={C.textFaint} />
            </Pressable>
          </Animated.View>
        ))}
      </Animated.View>
      <Field
        value={newTask} onChangeText={setNewTask} placeholder="Add something you finished" maxLength={140}
        returnKeyType="done" blurOnSubmit={false} onSubmitEditing={() => addTask(newTask)} style={{ marginTop: 4, marginBottom: 0 }}
      />
      {open.length ? (
        <>
          <Text style={[T.caption, { marginTop: 10 }]}>From today's list, ticked as done too</Text>
          <View style={st.chips}>
            {open.slice(0, 8).map((t) => (
              <Chip key={t.kind + t.id} small icon="add" label={t.title} onPress={() => tickToday({ kind: t.kind, id: t.id, title: t.title })} />
            ))}
          </View>
        </>
      ) : null}

      <Field
        label="Note" value={note} onChangeText={setNote} placeholder="A line about it" maxLength={500} multiline
        style={{ marginTop: 18, marginBottom: 0 }}
      />

      <PillButton label="Save" icon="checkmark" onPress={save} style={{ marginTop: 22 }} />
      <Pressable onPress={remove} hitSlop={12} style={st.delete} accessibilityRole="button">
        <Text style={[st.deleteText, { color: C.danger }]}>Delete session</Text>
      </Pressable>
    </Sheet>
  );
}

const st = StyleSheet.create({
  label: { color: C.textFaint, fontFamily: F.smMed, fontSize: 12, letterSpacing: TRACK.fine, marginLeft: 2, marginBottom: 8 },
  step: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: C.outline,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: 10 },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, paddingHorizontal: 2 },
  taskText: { flex: 1, minWidth: 0, color: C.text, fontFamily: F.reg, fontSize: 14, letterSpacing: TRACK.small },
  delete: { alignSelf: 'center', marginTop: S.gap, paddingVertical: 6 },
  deleteText: { fontFamily: F.semi, fontSize: 13, letterSpacing: TRACK.small },
});
