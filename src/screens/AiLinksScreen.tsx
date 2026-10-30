import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Linking, Alert, BackHandler, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { C, F, MIN, S, T, TRACK, neuRaised } from '../theme';
import { useStore, AiLink } from '../store';
import { uid } from '../utils';
import { ScreenBG, Card, Sheet, Field, PillButton, Row, IconBtn, useTheme, useToolHeader, EmptyState } from '../components/UI';
import Animated from 'react-native-reanimated';
import { toast } from '../components/Toast';
import { Appear, Enter, glide, rowOut, useAnimLevel, useEntrance, useTabReturns } from '../components/Motion';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WIDE_AT, columnWidth } from '../layout';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { aiLogoFor, aiNameFor } from '../aiLogos';
import { sameSite, siteHost, siteName, siteUrl } from '../quickAccess';

/** between launchers, across and down, on a phone and on a wide window */
const GRID_GAP = S.gap;
/** a second tap on the same launcher within this is the same tap: one browser tab, not two */
const OPEN_AGAIN_MS = 800;
/** a subdomain that says nothing of the tool: chat.mistral.ai is Mistral, not Chat */
const GENERIC_LABELS = ['www', 'app', 'chat', 'm', 'beta'];

function domainOf(url: string): string {
  try { return new URL(url).hostname; } catch { return ''; }
}

/**
 * A name for a tool added without one: the tool's own when the app knows it, else the address's first label
 * (scholar.google.com is Scholar, not Google), else the site's name.
 */
function toolName(url: string): string {
  const known = aiNameFor(url);
  if (known) return known;
  const first = siteHost(url).split('.')[0];
  if (first && !GENERIC_LABELS.includes(first)) return first.charAt(0).toUpperCase() + first.slice(1);
  return siteName(url);
}

/** favicons that would not load this session: their tiles show the sparkle at once, also when a tile is built again */
const NO_FAVICON = new Set<string>();

/**
 * The tool's own mark, drawn straight on the material with nothing behind it (a known tool, from src/aiLogos.ts); any
 * other site shows its favicon, and a link with neither shows a sparkle. The tile names the tool, so the mark is not
 * read out on its own.
 */
function LinkIcon({ link }: { link: AiLink }) {
  const theme = useTheme();
  const level = useAnimLevel();
  const logo = aiLogoFor(link.url);
  const domain = domainOf(link.url);
  const [failed, setFailed] = useState(() => NO_FAVICON.has(domain));
  if (logo) {
    return (
      <View style={st.logoBox} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
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
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
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
      // the favicon fades in with the motion setting: briefly with some, not at all with none
      transition={level === 'none' ? 0 : level === 'some' ? 180 : 220}
      onError={() => { NO_FAVICON.add(domain); setFailed(true); }}
      accessible={false}
    />
  );
}

/**
 * One launcher in the grid. It rises in with the screen the first time; a removed one fades as it goes and the rest
 * glide into its place, and moving one swaps two places with a glide instead of a jump. The glide and the fade sit on
 * an outer layer, the entrance on an inner one, so the two never fight over the same view. Memoised, with steady
 * handlers: typing in the Add sheet, or a change to one launcher, repaints none of the others.
 */
const LinkTile = React.memo(function LinkTile({ link: l, index, count, edit, style, onOpen, onMove, onRemove }: {
  link: AiLink; index: number; count: number; edit: boolean; style: any;
  onOpen: (l: AiLink) => void; onMove: (i: number, dir: -1 | 1) => void; onRemove: (id: string) => void;
}) {
  useTheme(); // the tile's inks follow the theme
  const level = useAnimLevel();
  const entrance = useEntrance(index);
  const first = index === 0;
  const last = index === count - 1;
  return (
    <Animated.View style={style} exiting={rowOut(level)} layout={glide(level)}>
      <Animated.View style={entrance}>
        {/* while the edit keys are out the tile is a plain surface: a tap on it opens nothing, so it does not sink */}
        <Card pad={0} onPress={edit ? undefined : () => onOpen(l)}>
          <View style={st.tile}>
            <LinkIcon link={l} />
            <Text style={{ color: C.text, fontFamily: F.semi, marginTop: 10, fontSize: 14, letterSpacing: TRACK.small }} numberOfLines={1}>
              {l.label}
            </Text>
            <Text style={[T.caption, { marginTop: 2 }]} numberOfLines={1}>{siteHost(l.url)}</Text>
            {edit && (
              // the edit keys fade in where they open, rather than appearing in one frame. The first launcher can go
              // no earlier and the last no later: those arrows rest dimmed and do nothing
              <Appear>
                <Row style={{ marginTop: 8 }}>
                  <IconBtn
                    name="chevron-back" size={18} style={first ? st.spent : undefined}
                    onPress={first ? undefined : () => onMove(index, -1)} accessibilityLabel={'Move ' + l.label + ' earlier'}
                  />
                  <IconBtn
                    name="chevron-forward" size={18} style={last ? st.spent : undefined}
                    onPress={last ? undefined : () => onMove(index, 1)} accessibilityLabel={'Move ' + l.label + ' later'}
                  />
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
});

export function AiLinksScreen({ mode }: { mode: 'tab' | 'stack' }) {
  useTheme(); // the tray's tick is the accent, so a new one repaints it
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  const aiLinks = useStore((s) => s.aiLinks);
  const setAiLinks = useStore((s) => s.setAiLinks);
  const [edit, setEdit] = useState(false);
  const [about, setAbout] = useState(false);
  const [addSheet, setAddSheet] = useState(false);

  // a quick second tap on a launcher is the same tap, which would otherwise open the tool twice
  const lastOpen = useRef({ id: '', at: 0 });
  const open = useCallback(async (l: AiLink) => {
    const now = Date.now();
    if (lastOpen.current.id === l.id && now - lastOpen.current.at < OPEN_AGAIN_MS) return;
    lastOpen.current = { id: l.id, at: now };
    try { await Linking.openURL(l.url); }
    catch { toast('Could not open ' + l.url); }
  }, []);

  const move = useCallback((i: number, dir: -1 | 1) => {
    const list = useStore.getState().aiLinks;
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    setAiLinks(next);
  }, [setAiLinks]);

  // a removed launcher can come back: the toast's Undo puts it back in its place. A built-in one could otherwise only
  // return by typing its address again
  const remove = useCallback((id: string) => {
    const list = useStore.getState().aiLinks;
    const at = list.findIndex((x) => x.id === id);
    if (at < 0) return;
    const gone = list[at];
    setAiLinks(list.filter((x) => x.id !== id));
    toast('Removed ' + gone.label, {
      label: 'Undo',
      onPress: () => {
        const now = useStore.getState().aiLinks;
        if (now.some((x) => x.id === gone.id)) return;
        const next = [...now];
        next.splice(Math.min(at, next.length), 0, gone);
        setAiLinks(next);
      },
    });
  }, [setAiLinks]);

  // while the edit keys are out, back puts them away before it leaves the screen
  const editRef = useRef(edit);
  editRef.current = edit;
  useFocusEffect(useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!editRef.current) return false;
      setEdit(false);
      return true;
    });
    return () => sub.remove();
  }, []));
  // a tab left while editing is back to its launchers when it is next opened: put away once it is out of sight
  useTabReturns(() => setEdit(false));

  // two launchers a row on a phone, three on a wide window, the same gap across as down
  const wide = winW >= WIDE_AT;
  const cols = wide ? 3 : 2;
  const itemStyle = useMemo(
    // whole points, so a row of them never comes out a hair too wide and wraps
    () => ({ width: Math.floor((columnWidth(winW, mode === 'tab') - S.pad * 2 - GRID_GAP * (cols - 1)) / cols) }),
    [winW, mode, cols],
  );

  // the tool's two controls live in the header's tray, so nothing floats under it: what the launchers are, and editing
  // them (the pencil turns to a tick in the accent while the keys are out). No context line: there is nothing to say
  const header = useToolHeader({ contentPull: 'all',
    title: 'AI Quick-Links',
    mode: mode === 'tab' ? 'tab' : 'page',
    // the header pull opens Sift, except while the links are being edited
    pull: !edit,
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
      {header.pullArea(<Animated.ScrollView
        {...header.scrollProps}
        contentContainerStyle={{ padding: S.pad, paddingTop: header.padTop, paddingBottom: 40 + (mode === 'tab' ? 0 : insets.bottom) }}
      >
        {/* the hero is the first tile's own entrance, so the title and the launchers rise as one */}
        <Enter index={0}>{header.hero}</Enter>

        <View style={st.grid}>
          {aiLinks.map((l, i) => (
            <LinkTile
              key={l.id} link={l} index={i} count={aiLinks.length} edit={edit} style={itemStyle}
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
      </Animated.ScrollView>)}

      <Sheet visible={about} onClose={() => setAbout(false)} title="AI Quick-Links">
        <Text style={T.body}>
          One-tap launchers for your AI tools. Each opens its app when it is installed, the browser otherwise. Tap the pencil to reorder, remove or add your own links.
        </Text>
      </Sheet>

      <AddLinkSheet visible={addSheet} onClose={() => setAddSheet(false)} />
    </ScreenBG>
  );
}

/**
 * The Add sheet's form. It keeps its own state, so typing repaints the form and not the launchers behind it. The
 * address comes first, as the one thing needed; Return moves on to the name, and from the name adds the tool.
 */
function AddLinkSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const setAiLinks = useStore((s) => s.setAiLinks);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const nameField = useRef<TextInput>(null);
  // Field hands its props, a ref among them (React 19 passes a function component its ref as a prop), to its
  // TextInput; its props type does not name the ref, so it goes in as a spread
  const nameRef = { ref: nameField } as object;

  const add = () => {
    const u = siteUrl(url);
    if (!u) {
      Alert.alert('Check the address', url.trim() ? 'That is not a web address. Try something like claude.ai.' : "Type the tool's address first.");
      return;
    }
    const list = useStore.getState().aiLinks;
    const there = list.find((x) => sameSite(x.url, u));
    if (there) {
      Alert.alert('Already in your links', there.label + ' opens this address.');
      return;
    }
    setAiLinks([...list, { id: uid(), label: label.trim() || toolName(u), url: u, custom: true }]);
    setLabel(''); setUrl(''); onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Add AI tool">
      <Field
        value={url} onChangeText={setUrl} placeholder="Address, e.g. notebooklm.google.com" autoFocus
        autoCapitalize="none" autoCorrect={false} keyboardType="url"
        returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => nameField.current?.focus()}
      />
      <Field
        {...nameRef} value={label} onChangeText={setLabel} placeholder="Name (optional), e.g. NotebookLM"
        returnKeyType="done" onSubmitEditing={add}
      />
      <PillButton label="Add" onPress={add} />
    </Sheet>
  );
}

const st = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: GRID_GAP },
  // names and addresses that run long stop short of the card's edges
  tile: { alignItems: 'center', paddingVertical: 18, paddingHorizontal: 12 },
  // an arrow with nowhere to go
  spent: { opacity: 0.35 },
  logoBox: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  fallbackIcon: {
    width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
  },
});
