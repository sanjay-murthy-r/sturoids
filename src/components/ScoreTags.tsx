import React from 'react';
import { View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C, F, S, T, TRACK } from '../theme';
import { useStore } from '../store';
import { ScoreTag, TAG_COLORS, categoriesOf, plainTagsOf, promoteToCategory, tagUse, tagsOf } from '../scores';
import { Appear } from './Motion';
import { Chip, Field, IconBtn, PillButton, Row, Sheet, Hairline, Toggle } from './UI';
import { tick } from '../haptics';

/** What each of the tag pastels is called, in TAG_COLORS' order, for a screen reader. */
const COLOR_NAMES = ['Mint', 'Sand', 'Rose', 'Aqua', 'Sky', 'Lime', 'Straw', 'Denim'];

/**
 * A tag reads as its own colour, translucent: the flat chip every small choice in the app uses, always in its "on"
 * tint so a tag looks the same wherever it appears. One that only shows (on a row, on an exam's card) is a plain pill
 * with the same tint and edge: it never takes a touch, so a tap or a long press on it reaches the row beneath, and a
 * notebook of a few hundred learnings mounts no animated hooks for its tags.
 */
export function TagChip({ tag, onPress, dim }: { tag: ScoreTag; onPress?: () => void; dim?: boolean }) {
  if (onPress || dim) return <Chip small label={tag.label} color={tag.color} active={!dim} onPress={onPress} />;
  return (
    <View style={[st.pill, { backgroundColor: tag.color + '1F', borderColor: tag.color + '66' }]}>
      <Text style={[st.pillText, { color: tag.color }]} numberOfLines={1}>{tag.label}</Text>
    </View>
  );
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

/** A node's tags as small dots in their colours, for a list row where chips would crowd it (at most four). */
export function TagDots({ ids }: { ids?: string[] }) {
  const tags = useStore((s) => s.scoreTags);
  const mine = tagsOf(ids, tags).slice(0, 4);
  if (!mine.length) return null;
  return (
    <View style={st.dots} accessible accessibilityLabel={'Tagged ' + mine.map((t) => t.label).join(', ')}>
      {mine.map((t) => <View key={t.id} style={[st.smallDot, { backgroundColor: t.color + '38', borderColor: t.color + 'B3' }]} />)}
    </View>
  );
}

/**
 * Picking tags: every tag made so far as a chip, the picked ones in their colour, and a line for a new one. A name
 * already in use picks that tag instead of making a second one. Categories are not offered: an exam's category is
 * chosen on its own, in the exam form.
 */
export function TagPicker({ value, onChange, label = 'Tags', categoryHint = false }: {
  value: string[]; onChange: (ids: string[]) => void; label?: string;
  /** the picker sits under a Category section (the exam form), so a category's name can point there */
  categoryHint?: boolean;
}) {
  const all = useStore((s) => s.scoreTags);
  const tags = React.useMemo(() => plainTagsOf(all), [all]);
  const addScoreTag = useStore((s) => s.addScoreTag);
  const [draft, setDraft] = React.useState('');
  const [clash, setClash] = React.useState('');

  const toggle = (id: string) => {
    tick();
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  };
  const add = () => {
    const name = draft.trim();
    if (!name) return;
    const id = addScoreTag(name);
    // a name a category already has cannot be a plain tag too
    if (useStore.getState().scoreTags.find((t) => t.id === id)?.category) {
      setClash(name + (categoryHint ? ' is a category. Pick it under Category.' : ' is a category. Give the tag another name.'));
      return;
    }
    setDraft('');
    setClash('');
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
          value={draft} onChangeText={(v) => { setDraft(v); if (clash) setClash(''); }} placeholder="New tag" maxLength={40}
          style={{ flex: 1, marginBottom: clash ? 0 : 14 }} onSubmitEditing={add} returnKeyType="done"
        />
        <IconBtn name="add-circle" color={draft.trim() ? C.accent : C.textFaint} size={26} style={{ marginLeft: 8, marginTop: 6 }} onPress={add} accessibilityLabel="Add this tag" />
      </Row>
      {clash ? <Appear><Text style={[st.problem, { marginTop: 6, marginBottom: 14 }]}>{clash}</Text></Appear> : null}
    </>
  );
}

/**
 * Managing categories and tags: what each one is called, its colour, whether it is an exam category, and letting one
 * go. Categories come first; an exam sits in one at most, and Analytics compares the exams inside each.
 */
export function TagManagerSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const tags = useStore((s) => s.scoreTags);
  const scores = useStore((s) => s.scores);
  const learnings = useStore((s) => s.learnings);
  const addScoreTag = useStore((s) => s.addScoreTag);
  const patchScoreTag = useStore((s) => s.patchScoreTag);
  const removeScoreTag = useStore((s) => s.removeScoreTag);
  const restoreScoreTag = useStore((s) => s.restoreScoreTag);
  // the tag sheet keeps its tag while it closes, so its title and its Delete button never change on the way out
  const [edit, setEdit] = React.useState<ScoreTag | null>(null);
  const [editOpen, setEditOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [taken, setTaken] = React.useState<'' | 'taken' | 'empty'>('');
  // what making a tag a category left out: said here, in the sheet, where a toast would be hidden behind it
  const [dropNote, setDropNote] = React.useState('');
  const [draft, setDraft] = React.useState('');
  const [catDraft, setCatDraft] = React.useState('');
  // the last delete and its Undo. A sheet is its own window and would cover a toast, so the Undo is offered here, in
  // the list the tag left, until the manager is next opened
  const [gone, setGone] = React.useState<null | { label: string; category: boolean; undo: () => void }>(null);
  React.useEffect(() => { if (visible) setGone(null); }, [visible]);
  const use = React.useMemo(() => tagUse(tags, scores, learnings), [tags, scores, learnings]);
  const cats = categoriesOf(tags);
  const plain = plainTagsOf(tags);

  const open = (t: ScoreTag) => { setEdit(t); setEditOpen(true); setName(t.label); setTaken(''); setDropNote(''); };
  const saveName = () => {
    if (!edit) return;
    if (!name.trim()) { setTaken('empty'); return; }
    if (name.trim() !== edit.label && !patchScoreTag(edit.id, { label: name })) { setTaken('taken'); return; }
    setTaken('');
    setEditOpen(false);
  };

  // Deleting takes the tag off everything carrying it. The store notes what carried it, and an Undo puts it back: the
  // same tag (a category again), with its colour and its place in the list, on the same exams, subjects and learnings,
  // in the same place among their tags.
  const deleteTag = (t: ScoreTag) => {
    const removed = removeScoreTag(t.id);
    if (!removed) return; // a second tap while the sheet closes
    setGone({ label: t.label, category: !!t.category, undo: () => restoreScoreTag(removed) });
    setEditOpen(false);
  };

  // where the tag was, a line that says it went and takes it back
  const undoLine = (category: boolean) => (gone && gone.category === category ? (
    <Appear style={st.undoRow}>
      <Text style={[T.caption, { flex: 1 }]} numberOfLines={1}>Deleted {gone.label}</Text>
      <Pressable
        onPress={() => { tick(); gone.undo(); setGone(null); }}
        hitSlop={{ top: 13, bottom: 13, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel={'Undo deleting ' + gone.label}
      >
        <Text style={[st.link, { color: C.accent }]}>Undo</Text>
      </Pressable>
    </Appear>
  ) : null);

  const row = (t: ScoreTag, i: number, isCat: boolean) => (
    <View key={t.id}>
      {i > 0 ? <Hairline /> : null}
      <Pressable onPress={() => open(t)} style={st.manageRow} accessibilityRole="button">
        <View style={[st.dot, { backgroundColor: t.color + '2E', borderColor: t.color + '99' }]} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={[T.body, { fontFamily: F.med }]} numberOfLines={1}>{t.label}</Text>
          <Text style={T.caption}>
            {isCat
              ? use.get(t.id) ? use.get(t.id) + (use.get(t.id) === 1 ? ' exam' : ' exams') : 'no exams yet'
              : use.get(t.id) ? 'on ' + use.get(t.id) + (use.get(t.id) === 1 ? ' thing' : ' things') : 'not used yet'}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={17} color={C.textFaint} />
      </Pressable>
    </View>
  );
  const addLine = (value: string, set: (v: string) => void, category: boolean) => (
    <Row style={{ alignItems: 'flex-start', marginTop: 12 }}>
      <Field
        value={value} onChangeText={set} placeholder={category ? 'New category' : 'New tag'} maxLength={40}
        style={{ flex: 1, marginBottom: 0 }}
        onSubmitEditing={() => { addScoreTag(value, { category }); set(''); }}
        returnKeyType="done"
      />
      <IconBtn
        name="add-circle" color={value.trim() ? C.accent : C.textFaint} size={26}
        style={{ marginLeft: 8, marginTop: 6 }}
        onPress={() => { tick(); addScoreTag(value, { category }); set(''); }}
        accessibilityLabel={category ? 'Add this category' : 'Add this tag'}
      />
    </Row>
  );

  return (
    <>
      <Sheet visible={visible} onClose={onClose} title="Categories and tags">
        <Text style={st.section}>Categories</Text>
        {cats.length === 0 ? (
          <Text style={[T.caption, { marginBottom: 4 }]}>
            A category keeps like with like, such as JEE Main mocks apart from unit tests. An exam sits in one, and Analytics compares the exams inside each.
          </Text>
        ) : cats.map((t, i) => row(t, i, true))}
        {undoLine(true)}
        {addLine(catDraft, setCatDraft, true)}

        <Text style={[st.section, { marginTop: 28 }]}>Tags</Text>
        {plain.length === 0 ? (
          <Text style={[T.caption, { marginBottom: 4 }]}>
            Tags sort exams, subjects and learnings, like Careless or Formulae. Make one here, or while you add an exam.
          </Text>
        ) : plain.map((t, i) => row(t, i, false))}
        {undoLine(false)}
        {addLine(draft, setDraft, false)}
      </Sheet>

      <Sheet visible={editOpen} onClose={() => setEditOpen(false)} title={edit ? edit.label : 'Tag'}>
        <Field label="Name" value={name} onChangeText={(v) => { setName(v); setTaken(''); }} maxLength={40} />
        {taken ? (
          <Appear>
            <Text style={st.problem}>{taken === 'empty' ? 'Give the tag a name.' : 'Another tag already has that name.'}</Text>
          </Appear>
        ) : null}
        <Row style={{ alignItems: 'center', marginBottom: 6 }}>
          <View style={{ flex: 1, marginRight: 12 }}>
            <Text style={[T.body, { fontFamily: F.med }]}>Exam category</Text>
            <Text style={T.caption}>
              {edit?.category
                ? 'Exams carrying it are compared in Analytics.'
                : 'Make it a category: exams carrying it are compared in Analytics.'}
            </Text>
          </View>
          <Toggle
            value={!!edit?.category}
            label="Exam category"
            onChange={(v) => {
              if (!edit) return;
              tick();
              const st0 = useStore.getState();
              const dropped = v && !edit.category ? promoteToCategory(st0.scores, st0.scoreTags, edit.id).dropped : 0;
              patchScoreTag(edit.id, { category: v });
              setEdit({ ...edit, category: v || undefined });
              setDropNote(!dropped ? ''
                : dropped === 1
                  ? 'One exam was already in another category. It stays there, without ' + edit.label + '.'
                  : dropped + ' exams were already in another category. They stay there, without ' + edit.label + '.');
            }}
          />
        </Row>
        {dropNote ? <Appear><Text style={[T.caption, { marginBottom: 6 }]}>{dropNote}</Text></Appear> : null}
        <Text style={[st.label, { marginTop: 14 }]}>Colour</Text>
        <View style={st.row}>
          {TAG_COLORS.map((c, i) => {
            const on = edit?.color === c;
            return (
              <Pressable
                key={c}
                onPress={() => { if (edit) { tick(); patchScoreTag(edit.id, { color: c }); setEdit({ ...edit, color: c }); } }}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={COLOR_NAMES[i] || 'Colour'}
                accessibilityState={{ selected: on }}
                style={[st.swatch, { backgroundColor: c + '2E', borderColor: on ? c : c + '55', borderWidth: on ? 2 : 1 }]}
              >
                {on ? <Ionicons name="checkmark" size={15} color={c} /> : null}
              </Pressable>
            );
          })}
        </View>
        <PillButton label="Save" onPress={saveName} style={{ marginTop: 4 }} />
        <PillButton
          label={edit?.category ? 'Delete category' : 'Delete tag'} color={C.danger} outline style={{ marginTop: 10 }}
          onPress={() => {
            if (!edit) return;
            const n = use.get(edit.id) || 0;
            const go = () => deleteTag(edit);
            // a tag no exam or learning carries goes at once; one in use asks first, since it comes off all of them
            if (!n) { go(); return; }
            Alert.alert(
              'Delete ' + edit.label + '?',
              edit.category
                ? 'It comes off the ' + (n === 1 ? 'one exam' : n + ' exams') + ' in it. The exams themselves stay.'
                : 'It comes off the ' + (n === 1 ? 'one exam or learning' : n + ' exams and learnings') + ' carrying it. Nothing else is removed.',
              [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: go }],
            );
          }}
        />
        <Text style={[T.caption, { marginTop: 10 }]}>
          {edit?.category
            ? 'Deleting a category takes it off every exam in it. The exams and their marks stay.'
            : 'Deleting a tag takes it off every exam and learning carrying it. Nothing else is removed.'}
        </Text>
      </Sheet>
    </>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 },
  // a small chip's measure, its 1 dp edge taken from the padding as the chip's edge layer takes it
  pill: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, marginRight: 10, marginBottom: 10 },
  pillText: { fontFamily: F.smSemi, fontSize: 12, letterSpacing: TRACK.fine },
  undoRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 2 },
  link: { fontFamily: F.semi, fontSize: 13, letterSpacing: TRACK.small, marginLeft: 12 },
  section: { color: C.textFaint, fontFamily: F.smSemi, fontSize: 11, letterSpacing: TRACK.caps, textTransform: 'uppercase', marginBottom: 8, marginLeft: 2 },
  label: { color: C.textFaint, fontFamily: F.smMed, fontSize: 12, letterSpacing: TRACK.fine, marginLeft: 2, marginBottom: 8 },
  problem: { color: C.danger, fontFamily: F.smMed, fontSize: 12, letterSpacing: TRACK.fine, lineHeight: 17, marginTop: -8, marginBottom: 12 },
  manageRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 2 },
  dot: { width: 26, height: 26, borderRadius: 13, borderWidth: 1 },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 6 },
  smallDot: { width: 8, height: 8, borderRadius: 4, borderWidth: 1 },
  swatch: {
    width: 34, height: 34, borderRadius: 17, marginRight: 10, marginBottom: 10,
    alignItems: 'center', justifyContent: 'center',
  },
});
