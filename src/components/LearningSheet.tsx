import React from 'react';
import { Text } from 'react-native';
import { C, T } from '../theme';
import { useStore } from '../store';
import { Learning } from '../scores';
import { Field, PillButton, Sheet } from './UI';
import { TagPicker } from './ScoreTags';

export type LearningTarget =
  | { mode: 'new'; nodeId: string }
  | { mode: 'edit'; learning: Learning };

/**
 * One learning from an exam: a line or two in your own words, with tags. It is kept with the exam and shows in the
 * notebook, where the same tags filter it.
 */
export function LearningSheet({ target, onClose, title }: {
  target: LearningTarget | null; onClose: () => void;
  /** the exam's name, for the sheet's own title */
  title?: string;
}) {
  const addLearning = useStore((s) => s.addLearning);
  const patchLearning = useStore((s) => s.patchLearning);
  const [shown, setShown] = React.useState<LearningTarget | null>(null);
  const [text, setText] = React.useState('');
  const [tags, setTags] = React.useState<string[]>([]);
  const [problem, setProblem] = React.useState(false);

  React.useEffect(() => {
    if (!target) return;
    setShown(target);
    setProblem(false);
    setText(target.mode === 'edit' ? target.learning.text : '');
    setTags(target.mode === 'edit' ? target.learning.tags : []);
  }, [target]);

  const save = () => {
    if (!text.trim()) { setProblem(true); return; }
    if (shown?.mode === 'edit') patchLearning(shown.learning.id, { text, tags });
    else if (shown) addLearning({ nodeId: shown.nodeId, text, tags });
    onClose();
  };

  return (
    <Sheet
      visible={!!target}
      onClose={onClose}
      title={shown?.mode === 'edit' ? 'Edit learning' : title ? 'Learning from ' + title : 'New learning'}
    >
      <Field
        value={text}
        onChangeText={(v) => { setText(v); setProblem(false); }}
        placeholder="What will you do differently next time?"
        multiline
        autoFocus={shown?.mode === 'new'}
        maxLength={600}
        style={{ minHeight: 76 }}
      />
      {problem ? <Text style={{ color: C.danger, ...T.caption, marginTop: -8, marginBottom: 12 }}>Write the learning first.</Text> : null}
      <TagPicker value={tags} onChange={setTags} />
      <PillButton label={shown?.mode === 'edit' ? 'Save' : 'Add learning'} onPress={save} />
    </Sheet>
  );
}
