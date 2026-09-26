import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Linking, Alert, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { C, F, MIN, S, T, neuRaised } from '../theme';
import { useStore, AiLink } from '../store';
import { uid } from '../utils';
import { ScreenBG, Card, Sheet, Field, PillButton, Row, IconBtn, InfoDot, NeuHeader, useTheme, EmptyState } from '../components/UI';
import { toast } from '../components/Toast';
import { Enter } from '../components/Motion';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WIDE_AT, columnWidth } from '../layout';

/** between launchers on a wide window */
const GRID_GAP = 14;

function domainOf(url: string): string {
  try { return new URL(url).hostname; } catch { return ''; }
}

/** Real site logo via favicon service; custom links get a generic badge. */
function LinkIcon({ link }: { link: AiLink }) {
  const theme = useTheme();
  const [failed, setFailed] = useState(false);
  const domain = domainOf(link.url);
  if (link.custom || failed || !domain) {
    return (
      <View
        style={[
          st.fallbackIcon,
          theme === 'minimal'
            ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: MIN.border }
            : { backgroundColor: C.card, ...neuRaised('low') },
        ]}
      >
        <Ionicons name="sparkles" size={22} color={C.accent} />
      </View>
    );
  }
  return (
    <Image
      source={{ uri: 'https://www.google.com/s2/favicons?domain=' + domain + '&sz=128' }}
      style={{ width: 40, height: 40, borderRadius: 10 }}
      cachePolicy="memory-disk"
      transition={220}
      onError={() => setFailed(true)}
    />
  );
}

export function AiLinksScreen({ mode }: { mode: 'tab' | 'stack' }) {
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  const aiLinks = useStore((s) => s.aiLinks);
  const setAiLinks = useStore((s) => s.setAiLinks);
  const [edit, setEdit] = useState(false);
  const [addSheet, setAddSheet] = useState(false);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');

  const open = async (l: AiLink) => {
    try { await Linking.openURL(l.url); }
    catch { toast('Could not open ' + l.url); }
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
    setAiLinks([...aiLinks, { id: uid(), label: label.trim(), url: u, custom: true }]);
    setLabel(''); setUrl(''); setAddSheet(false);
  };

  // two launchers a row on a phone, three on a wide window
  const wide = winW >= WIDE_AT;
  const itemW = wide ? (columnWidth(winW, mode === 'tab') - S.pad * 2 - GRID_GAP * 2) / 3 : 0;

  return (
    <ScreenBG guard={mode === 'tab'}>
      <NeuHeader
        title="AI Quick-Links"
        variant={mode === 'tab' ? 'tab' : 'page'}
        right={<InfoDot text="One-tap launchers for your AI tools. Opens the app when it's installed, the browser otherwise. Edit to reorder, remove, or add your own links." />}
      />
      <ScrollView contentContainerStyle={{ padding: S.pad, paddingTop: 8, paddingBottom: 40 + (mode === 'tab' ? 0 : insets.bottom) }}>
        <Row style={{ justifyContent: 'flex-end', marginBottom: 12 }}>
          <PillButton small label={edit ? 'Done' : 'Edit'} outline onPress={() => setEdit(!edit)} />
        </Row>

        <View style={wide ? st.gridWide : st.grid}>
          {aiLinks.map((l, i) => (
            <Enter key={l.id} index={i} style={wide ? { width: itemW } : st.item}>
              <Card pad={0} onPress={() => (edit ? undefined : open(l))}>
                <View style={{ alignItems: 'center', paddingVertical: 18 }}>
                  <LinkIcon link={l} />
                  <Text style={{ color: C.text, fontFamily: F.semi, marginTop: 10, fontSize: 14 }} numberOfLines={1}>
                    {l.label}
                  </Text>
                  <Text style={[T.caption, { marginTop: 2 }]} numberOfLines={1}>{domainOf(l.url)}</Text>
                  {edit && (
                    <Row style={{ marginTop: 8 }}>
                      <IconBtn name="chevron-back" size={18} onPress={() => move(i, -1)} accessibilityLabel={'Move ' + l.label + ' earlier'} />
                      <IconBtn name="chevron-forward" size={18} onPress={() => move(i, 1)} accessibilityLabel={'Move ' + l.label + ' later'} />
                      <IconBtn name="trash-outline" size={18} color={C.danger}
                        onPress={() => setAiLinks(aiLinks.filter((x) => x.id !== l.id))} accessibilityLabel={'Remove ' + l.label} />
                    </Row>
                  )}
                </View>
              </Card>
            </Enter>
          ))}
        </View>

        {aiLinks.length === 0 ? (
          <EmptyState
            icon="sparkles-outline" title="Add your first tool" body="Keep the assistants you study with one tap away."
            actionLabel="Add link" onAction={() => setAddSheet(true)}
          />
        ) : null}
        {edit && aiLinks.length > 0 && <PillButton label="Add link" icon="add" onPress={() => setAddSheet(true)} />}
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
  gridWide: { flexDirection: 'row', flexWrap: 'wrap', columnGap: GRID_GAP },
  fallbackIcon: {
    width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
  },
});
