import React, { useState } from 'react';
import { View, Text, StyleSheet, Linking, Alert, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { C, F, MIN, S, T, TRACK, neuRaised } from '../theme';
import { useStore, AiLink } from '../store';
import { uid } from '../utils';
import { ScreenBG, Card, Sheet, Field, PillButton, Row, IconBtn, useTheme, useToolHeader, EmptyState } from '../components/UI';
import Animated from 'react-native-reanimated';
import { toast } from '../components/Toast';
import { Appear, Enter, glide, rowOut, useAnimLevel, useEntrance } from '../components/Motion';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WIDE_AT, columnWidth } from '../layout';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { aiLogoFor } from '../aiLogos';
import { siteName, siteUrl } from '../quickAccess';

/** between launchers on a wide window */
const GRID_GAP = 14;

function domainOf(url: string): string {
  try { return new URL(url).hostname; } catch { return ''; }
}

/**
 * The tool's own mark, drawn straight on the material with nothing behind it (a known tool, from src/aiLogos.ts); any
 * other site shows its favicon, and a link with neither shows a sparkle.
 */
function LinkIcon({ link }: { link: AiLink }) {
  const theme = useTheme();
  const [failed, setFailed] = useState(false);
  const logo = aiLogoFor(link.url);
  const domain = domainOf(link.url);
  if (logo) {
    return (
      <View style={st.logoBox} accessible accessibilityLabel={link.label + ' logo'}>
        <Svg width={34} height={34} viewBox="0 0 24 24">
          {logo.gradient ? (
            <Defs>
              <LinearGradient id={'g' + link.id} x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor={logo.gradient[0]} />
                <Stop offset="1" stopColor={logo.gradient[1]} />
              </LinearGradient>
            </Defs>
          ) : null}
          <Path d={logo.d} fill={logo.gradient ? 'url(#g' + link.id + ')' : logo.color} />
        </Svg>
      </View>
    );
  }
  if (failed || !domain) {
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

/**
 * One launcher in the grid. It rises in with the screen the first time; a removed one fades as it goes and the rest
 * glide into its place, and moving one swaps two places with a glide instead of a jump. The glide and the fade sit on
 * an outer layer, the entrance on an inner one, so the two never fight over the same view.
 */
function LinkTile({ link: l, index, edit, style, onOpen, onMove, onRemove }: {
  link: AiLink; index: number; edit: boolean; style: any;
  onOpen: (l: AiLink) => void; onMove: (i: number, dir: -1 | 1) => void; onRemove: (id: string) => void;
}) {
  const level = useAnimLevel();
  const entrance = useEntrance(index);
  return (
    <Animated.View style={style} exiting={rowOut(level)} layout={glide(level)}>
      <Animated.View style={entrance}>
        <Card pad={0} onPress={() => (edit ? undefined : onOpen(l))}>
          <View style={{ alignItems: 'center', paddingVertical: 18 }}>
            <LinkIcon link={l} />
            <Text style={{ color: C.text, fontFamily: F.semi, marginTop: 10, fontSize: 14, letterSpacing: TRACK.small }} numberOfLines={1}>
              {l.label}
            </Text>
            <Text style={[T.caption, { marginTop: 2 }]} numberOfLines={1}>{domainOf(l.url)}</Text>
            {edit && (
              // the edit keys fade in where they open, rather than appearing in one frame
              <Appear>
                <Row style={{ marginTop: 8 }}>
                  <IconBtn name="chevron-back" size={18} onPress={() => onMove(index, -1)} accessibilityLabel={'Move ' + l.label + ' earlier'} />
                  <IconBtn name="chevron-forward" size={18} onPress={() => onMove(index, 1)} accessibilityLabel={'Move ' + l.label + ' later'} />
                  <IconBtn name="trash-outline" size={18} color={C.danger}
                    onPress={() => onRemove(l.id)} accessibilityLabel={'Remove ' + l.label} />
                </Row>
              </Appear>
            )}
          </View>
        </Card>
      </Animated.View>
    </Animated.View>
  );
}

export function AiLinksScreen({ mode }: { mode: 'tab' | 'stack' }) {
  useTheme(); // the tray's tick is the accent, so a new one repaints it
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  const aiLinks = useStore((s) => s.aiLinks);
  const setAiLinks = useStore((s) => s.setAiLinks);
  const [edit, setEdit] = useState(false);
  const [about, setAbout] = useState(false);
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

  const remove = (id: string) => setAiLinks(useStore.getState().aiLinks.filter((x) => x.id !== id));

  const add = () => {
    const u = siteUrl(url);
    if (!u) {
      Alert.alert('Check the address', url.trim() ? 'That is not a web address. Try something like claude.ai' : "Type the tool's address first.");
      return;
    }
    setAiLinks([...aiLinks, { id: uid(), label: label.trim() || siteName(u), url: u, custom: true }]);
    setLabel(''); setUrl(''); setAddSheet(false);
  };

  // two launchers a row on a phone, three on a wide window
  const wide = winW >= WIDE_AT;
  const itemW = wide ? (columnWidth(winW, mode === 'tab') - S.pad * 2 - GRID_GAP * 2) / 3 : 0;

  // the tool's two controls live in the header's tray, so nothing floats under it: what the launchers are, and editing
  // them (the pencil turns to a tick in the accent while the keys are out). No context line: there is nothing to say
  const header = useToolHeader({
    title: 'AI Quick-Links',
    mode: mode === 'tab' ? 'tab' : 'page',
    actions: [
      { icon: 'information-circle-outline', label: 'About quick-links', onPress: () => setAbout(true) },
      {
        icon: edit ? 'checkmark' : 'create-outline', label: edit ? 'Done editing' : 'Edit links',
        color: edit ? C.accent : undefined, onPress: () => setEdit(!edit),
      },
    ],
  });

  return (
    <ScreenBG guard={mode === 'tab'}>
      {header.bar}
      <Animated.ScrollView
        {...header.scrollProps}
        contentContainerStyle={{ padding: S.pad, paddingTop: header.padTop, paddingBottom: 40 + (mode === 'tab' ? 0 : insets.bottom) }}
      >
        {/* the hero is the first tile's own entrance, so the title and the launchers rise as one */}
        <Enter index={0}>{header.hero}</Enter>

        <View style={wide ? st.gridWide : st.grid}>
          {aiLinks.map((l, i) => (
            <LinkTile
              key={l.id} link={l} index={i} edit={edit} style={wide ? { width: itemW } : st.item}
              onOpen={open} onMove={move} onRemove={remove}
            />
          ))}
        </View>

        {aiLinks.length === 0 ? (
          <EmptyState
            icon="sparkles-outline" title="Add your first tool" body="Keep the assistants you study with one tap away."
            actionLabel="Add link" onAction={() => setAddSheet(true)}
          />
        ) : null}
        {edit && aiLinks.length > 0 && (
          <Appear>
            <PillButton label="Add link" icon="add" onPress={() => setAddSheet(true)} />
          </Appear>
        )}
      </Animated.ScrollView>

      <Sheet visible={about} onClose={() => setAbout(false)} title="AI Quick-Links">
        <Text style={T.body}>
          One-tap launchers for your AI tools. Each opens its app when it is installed, the browser otherwise. Tap the pencil to reorder, remove or add your own links.
        </Text>
      </Sheet>

      <Sheet visible={addSheet} onClose={() => setAddSheet(false)} title="Add AI tool">
        <Field value={label} onChangeText={setLabel} placeholder="Name, e.g. NotebookLM" autoFocus />
        <Field value={url} onChangeText={setUrl} placeholder="Address, e.g. notebooklm.google.com" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
        <PillButton label="Add" onPress={add} />
      </Sheet>
    </ScreenBG>
  );
}

const st = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  item: { width: '48%' },
  gridWide: { flexDirection: 'row', flexWrap: 'wrap', columnGap: GRID_GAP },
  logoBox: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  fallbackIcon: {
    width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
  },
});
