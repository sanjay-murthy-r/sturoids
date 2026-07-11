import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Linking, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C, S } from '../src/theme';
import { useStore, AiLink } from '../src/store';
import { uid } from '../src/utils';
import { ScreenBG, GlassCard, Sheet, Field, PillButton, Row, IconBtn } from '../src/components/UI';

export default function AiLinks() {
  const aiLinks = useStore((s) => s.aiLinks);
  const setAiLinks = useStore((s) => s.setAiLinks);
  const [edit, setEdit] = useState(false);
  const [addSheet, setAddSheet] = useState(false);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');

  const open = async (l: AiLink) => {
    try {
      // Android hands https URLs to the native app when one is installed (app links),
      // and falls back to the browser otherwise.
      await Linking.openURL(l.url);
    } catch {
      Alert.alert('Could not open', l.url);
    }
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= aiLinks.length) return;
    const next = [...aiLinks];
    [next[i], next[j]] = [next[j], next[i]];
    setAiLinks(next);
  };

  const add = () => {
    const u = url.trim();
    if (!label.trim() || !/^https?:\/\//.test(u)) {
      Alert.alert('Check fields', 'Name + full URL starting with https://');
      return;
    }
    setAiLinks([...aiLinks, { id: uid(), label: label.trim(), url: u }]);
    setLabel(''); setUrl(''); setAddSheet(false);
  };

  return (
    <ScreenBG>
      <ScrollView contentContainerStyle={{ padding: S.pad, paddingBottom: 40 }}>
        <Row style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <Text style={{ color: C.textDim, fontSize: 13, flex: 1 }}>
            Opens the app when installed, browser otherwise.
          </Text>
          <PillButton small label={edit ? 'Done' : 'Edit'} outline onPress={() => setEdit(!edit)} />
        </Row>

        <View style={st.grid}>
          {aiLinks.map((l, i) => (
            <GlassCard key={l.id} pad={0} style={st.item} onPress={() => (edit ? undefined : open(l))}>
              <View style={{ alignItems: 'center', paddingVertical: 18 }}>
                <Ionicons name="sparkles" size={24} color={C.violet} />
                <Text style={{ color: C.text, fontWeight: '700', marginTop: 8, fontSize: 14 }} numberOfLines={1}>
                  {l.label}
                </Text>
                {edit && (
                  <Row style={{ marginTop: 8 }}>
                    <IconBtn name="chevron-back" size={18} onPress={() => move(i, -1)} />
                    <IconBtn name="chevron-forward" size={18} onPress={() => move(i, 1)} />
                    <IconBtn name="trash-outline" size={18} color={C.danger}
                      onPress={() => setAiLinks(aiLinks.filter((x) => x.id !== l.id))} />
                  </Row>
                )}
              </View>
            </GlassCard>
          ))}
        </View>

        {edit && <PillButton label="Add link" icon="add" onPress={() => setAddSheet(true)} />}
      </ScrollView>

      <Sheet visible={addSheet} onClose={() => setAddSheet(false)} title="Add AI tool">
        <Field value={label} onChangeText={setLabel} placeholder="Name, e.g. NotebookLM" autoFocus />
        <Field value={url} onChangeText={setUrl} placeholder="https://…" autoCapitalize="none" keyboardType="url" />
        <PillButton label="Add" onPress={add} />
      </Sheet>
    </ScreenBG>
  );
}

const st = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  item: { width: '48%' },
});
