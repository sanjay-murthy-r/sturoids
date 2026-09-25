import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C, F, S, T } from '../theme';
import { useStore } from '../store';
import { ScoreTag, TAG_COLORS, tagUse, tagsOf } from '../scores';
import { Chip, Field, IconBtn, PillButton, Row, Sheet, Hairline } from './UI';
import { tick } from '../haptics';

/**
 * A tag reads as its own colour, translucent: the flat chip every small choice in the app uses, always in its "on"
 * tint so a tag looks the same wherever it appears.
 */
export function TagChip({ tag, onPress, dim }: { tag: ScoreTag; onPress?: () => void; dim?: boolean }) {
  return <Chip small label={tag.label} color={tag.color} active={!dim} onPress={onPress} />;
}

/** The tags a node or a learning carries, in one wrapping row. Nothing is drawn when it carries none. */
export function TagRow({ ids, onPress, style }: { ids?: string[]; onPress?: (id: string) => void; style?: any }) {
  const tags = useStore((s) => s.scoreTags);
  const mine = tagsOf(ids, tags);
  if (!mine.length) return null;
  return (
    <View style={[st.row, style]}>
      {mine.map((t) => <TagChip key={t.id} tag={t} onPress={onPress ? () => onPress(t.id) : undefined} />)}
    </View>
  );
}

/**
 * Picking tags: every tag made so far as a chip, the picked ones in their colour, and a line for a new one. A name
 * already in use picks that tag instead of making a second one.
 */
export function TagPicker({ value, onChange, label = 'Tags' }: {
  value: string[]; onChange: (ids: string[]) => void; label?: string;
}) {
  const tags = useStore((s) => s.scoreTags);
  const addScoreTag = useStore((s) => s.addScoreTag);
  const [draft, setDraft] = React.useState('');

  const toggle = (id: string) => {
    tick();
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  };
  const add = () => {
    const name = draft.trim();
    if (!name) return;
    const id = addScoreTag(name);
    setDraft('');
    if (id && !value.includes(id)) onChange([...value, id]);
  };

  return (
    <>
      <Text style={st.label}>{label}</Text>
      {tags.length ? (
        <View style={st.row}>
          {tags.map((t) => (
            <Chip
              key={t.id} small label={t.label} color={t.color} active={value.includes(t.id)}
              onPress={() => toggle(t.id)}
            />
          ))}
        </View>
      ) : (
        <Text style={[T.caption, { marginBottom: 8 }]}>None yet. Make one below, like Careless or Formulae.</Text>
      )}
      <Row style={{ alignItems: 'flex-start' }}>
        <Field
          value={draft} onChangeText={setDraft} placeholder="New tag" maxLength={40}
          style={{ flex: 1, marginBottom: 14 }} onSubmitEditing={add} returnKeyType="done"
        />
        <IconBtn name="add-circle" color={draft.trim() ? C.accent : C.textFaint} size={26} style={{ marginLeft: 8, marginTop: 6 }} onPress={add} />
      </Row>
    </>
  );
}

/** Managing the tags themselves: what each one is called, its colour, and letting one go. */
export function TagManagerSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const tags = useStore((s) => s.scoreTags);
  const scores = useStore((s) => s.scores);
  const learnings = useStore((s) => s.learnings);
  const addScoreTag = useStore((s) => s.addScoreTag);
  const patchScoreTag = useStore((s) => s.patchScoreTag);
  const removeScoreTag = useStore((s) => s.removeScoreTag);
  const [edit, setEdit] = React.useState<ScoreTag | null>(null);
  const [name, setName] = React.useState('');
  const [taken, setTaken] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const use = React.useMemo(() => tagUse(tags, scores, learnings), [tags, scores, learnings]);

  const open = (t: ScoreTag) => { setEdit(t); setName(t.label); setTaken(false); };
  const saveName = () => {
    if (!edit) return;
    if (name.trim() && name.trim() !== edit.label && !patchScoreTag(edit.id, { label: name })) { setTaken(true); return; }
    setTaken(false);
    setEdit(null);
  };

  return (
    <>
      <Sheet visible={visible} onClose={onClose} title="Tags">
        {tags.length === 0 ? (
          <Text style={[T.caption, { marginBottom: 12 }]}>
            Tags sort exams, subjects and learnings. Make one here, or while you add an exam.
          </Text>
        ) : null}
        {tags.map((t, i) => (
          <View key={t.id}>
            {i > 0 ? <Hairline /> : null}
            <Pressable onPress={() => open(t)} style={st.manageRow} accessibilityRole="button">
              <View style={[st.dot, { backgroundColor: t.color + '2E', borderColor: t.color + '99' }]} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[T.body, { fontFamily: F.med }]} numberOfLines={1}>{t.label}</Text>
                <Text style={T.caption}>
                  {use.get(t.id) ? 'on ' + use.get(t.id) + (use.get(t.id) === 1 ? ' thing' : ' things') : 'not used yet'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={17} color={C.textFaint} />
            </Pressable>
          </View>
        ))}
        <Row style={{ alignItems: 'flex-start', marginTop: tags.length ? 16 : 0 }}>
          <Field
            value={draft} onChangeText={setDraft} placeholder="New tag" maxLength={40}
            style={{ flex: 1, marginBottom: 0 }}
            onSubmitEditing={() => { addScoreTag(draft); setDraft(''); }}
            returnKeyType="done"
          />
          <IconBtn
            name="add-circle" color={draft.trim() ? C.accent : C.textFaint} size={26}
            style={{ marginLeft: 8, marginTop: 6 }}
            onPress={() => { addScoreTag(draft); setDraft(''); }}
          />
        </Row>
      </Sheet>

      <Sheet visible={!!edit} onClose={() => setEdit(null)} title={edit ? edit.label : 'Tag'}>
        <Field label="Name" value={name} onChangeText={(v) => { setName(v); setTaken(false); }} maxLength={40} />
        {taken ? <Text style={st.problem}>Another tag already has that name.</Text> : null}
        <Text style={st.label}>Colour</Text>
        <View style={st.row}>
          {TAG_COLORS.map((c) => {
            const on = edit?.color === c;
            return (
              <Pressable
                key={c}
                onPress={() => { if (edit) { tick(); patchScoreTag(edit.id, { color: c }); setEdit({ ...edit, color: c }); } }}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={'Colour ' + c}
                style={[st.swatch, { backgroundColor: c + '2E', borderColor: on ? c : c + '55', borderWidth: on ? 2 : 1 }]}
              >
                {on ? <Ionicons name="checkmark" size={15} color={c} /> : null}
              </Pressable>
            );
          })}
        </View>
        <PillButton label="Save" onPress={saveName} style={{ marginTop: 4 }} />
        <PillButton
          label="Delete tag" color={C.danger} outline style={{ marginTop: 10 }}
          onPress={() => { if (edit) { removeScoreTag(edit.id); setEdit(null); } }}
        />
        <Text style={[T.caption, { marginTop: 10 }]}>
          Deleting a tag takes it off every exam and learning carrying it. Nothing else is removed.
        </Text>
      </Sheet>
    </>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 },
  label: { color: C.textFaint, fontFamily: F.med, fontSize: 12, letterSpacing: 0.2, marginLeft: 2, marginBottom: 8 },
  problem: { color: C.danger, fontFamily: F.med, fontSize: 12, lineHeight: 17, marginTop: -8, marginBottom: 12 },
  manageRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 2 },
  dot: { width: 26, height: 26, borderRadius: 13, borderWidth: 1 },
  swatch: {
    width: 34, height: 34, borderRadius: 17, marginRight: 10, marginBottom: 10,
    alignItems: 'center', justifyContent: 'center',
  },
});
