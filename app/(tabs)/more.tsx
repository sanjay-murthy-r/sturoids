import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { useScrollToTop } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { C, F, MIN, S, T, TRACK, ThemeMode, neuInset } from '../../src/theme';
import { ScreenBG, ListCard, ListRow, SectionTitle, DotMenu, useTheme, useToolHeader } from '../../src/components/UI';
import { Enter, FadeSwap, useFocusKey } from '../../src/components/Motion';
import { ToolArchiveSheet } from '../../src/components/ToolArchiveSheet';
import { toast } from '../../src/components/Toast';
import { useStore } from '../../src/store';
import { TOOLS, Tool, ToolKey, colorOf, normaliseArchived, normaliseSlots } from '../../src/tools';
import { openPage, openTool } from '../../src/toolNav';

/** what a tool's count is of, so a screen reader hears "12 notes" rather than a bare number */
const COUNT_OF: Partial<Record<ToolKey, [string, string]>> = {
  notes: ['note', 'notes'], vault: ['lecture saved', 'lectures saved'], journal: ['journal page', 'journal pages'],
};

/** the icon sits in a carved well: a raised boss on a raised card doubled the depth */
const wellFor = (theme: ThemeMode) =>
  (theme === 'minimal'
    ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border }
    : { backgroundColor: C.inset, ...neuInset('low') });

/**
 * One tool of the list, memoised: a count changing elsewhere re-renders its own row, not the list. It follows the
 * theme and the accent itself (a tool's colour can be the accent), since a memoised row is not repainted by the page.
 */
const ToolRow = React.memo(function ToolRow({ tool, count, locked, onOpen, onMenu }: {
  tool: Tool; count: number; locked: boolean; onOpen: (key: ToolKey) => void; onMenu: (tool: Tool) => void;
}) {
  const theme = useTheme();
  const countOf = COUNT_OF[tool.key];
  return (
    <ListRow onPress={() => onOpen(tool.key)} onLongPress={() => onMenu(tool)} style={st.row}>
      <View style={[st.iconWell, wellFor(theme)]}>
        <Ionicons name={tool.icon as any} size={22} color={colorOf(tool.colorKey)} />
      </View>
      <View style={{ flex: 1, marginLeft: 14 }}>
        <Text style={st.title} numberOfLines={1}>{tool.label}</Text>
        <Text style={[T.caption, { marginTop: 2 }]} numberOfLines={1}>{tool.desc}</Text>
      </View>
      {locked ? (
        <Ionicons name="lock-closed-outline" size={15} color={C.textFaint} style={{ marginRight: 8 }} />
      ) : null}
      {count ? (
        <Text style={st.count} accessibilityLabel={countOf ? count + ' ' + countOf[count === 1 ? 0 : 1] : undefined}>{count}</Text>
      ) : null}
      <Ionicons name="chevron-forward" size={18} color={C.textFaint} />
    </ListRow>
  );
});

/**
 * The row behind which the archived tools wait. Restoring one from its sheet (which leaves this row in view above it)
 * changes the names and the count in place, so they dip out and come back as the new words.
 */
const ArchivedRow = React.memo(function ArchivedRow({ names, count, onPress }: {
  names: string; count: number; onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <ListRow onPress={onPress} style={st.row}>
      <View style={[st.iconWell, wellFor(theme)]}>
        <Ionicons name="archive-outline" size={21} color={C.textDim} />
      </View>
      <View style={{ flex: 1, marginLeft: 14 }}>
        <Text style={st.title}>Archived</Text>
        <FadeSwap swapKey={names} style={{ marginTop: 2 }}>
          <Text style={T.caption} numberOfLines={1}>{names}</Text>
        </FadeSwap>
      </View>
      <FadeSwap swapKey={String(count)}>
        <Text style={st.count}>{count}</Text>
      </FadeSwap>
      <Ionicons name="chevron-forward" size={18} color={C.textFaint} />
    </ListRow>
  );
});

/**
 * Every tool that is neither in a bar slot nor archived, then the archived ones behind one row, then Settings. A tool
 * opened from here is a full page with a back button; moving it into a slot (Settings, Tools) takes it off this list.
 */
export default function More() {
  const fk = useFocusKey();
  const theme = useTheme();
  // a tap on More in the bar, with More already open, takes the list back to its top
  const scrollRef = React.useRef<any>(null);
  useScrollToTop(scrollRef);
  const rawSlots = useStore((s) => s.settings.tabSlots);
  const rawArchived = useStore((s) => s.settings.archivedTools);
  const notes = useStore((s) => s.notes.length);
  const videos = useStore((s) => s.vaultVideos.length);
  const journalCount = useStore((s) => s.journal.length);
  const journalLocked = useStore((s) => s.settings.journalLocked);
  const notesLocked = useStore((s) => s.settings.notesLocked === true);
  const setToolArchived = useStore((s) => s.setToolArchived);
  const slots = React.useMemo(() => normaliseSlots(rawSlots), [rawSlots]);
  const archived = React.useMemo(() => normaliseArchived(rawArchived, slots), [rawArchived, slots]);
  const tools = React.useMemo(() => TOOLS.filter((t) => !slots.includes(t.key) && !archived.includes(t.key)), [slots, archived]);
  const archivedTools = React.useMemo(() => TOOLS.filter((t) => archived.includes(t.key)), [archived]);
  // the menu keeps its tool while it closes, so its rows never empty out mid-animation
  const [menuFor, setMenuFor] = React.useState<Tool | null>(null);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [archiveSheet, setArchiveSheet] = React.useState(false);
  // a locked tool shows no count: even how many pages it holds stays private
  const counts: Partial<Record<ToolKey, number>> = {
    notes: notesLocked ? 0 : notes, vault: videos, journal: journalLocked ? 0 : journalCount,
  };
  const lockedTool = (key: ToolKey) => (key === 'journal' && journalLocked) || (key === 'notes' && notesLocked);
  const openMenu = React.useCallback((t: Tool) => { setMenuFor(t); setMenuOpen(true); }, []);
  const openArchive = React.useCallback(() => setArchiveSheet(true), []);
  // the page is a list: its header is the big title alone, with no line of context and nothing live
  const header = useToolHeader({ title: 'More', mode: 'tab' });

  // an archive can be undone from its toast; Archived, at the end of the list, keeps it otherwise
  const archive = (t: Tool) => {
    if (setToolArchived(t.key, true)) toast(t.label + ' archived', { label: 'Undo', onPress: () => { setToolArchived(t.key, false); } });
    else toast('End the Deep Work session first.');
  };

  return (
    <ScreenBG guard>
      {header.bar}
      <Animated.ScrollView
        key={fk}
        ref={scrollRef}
        {...header.scrollProps}
        contentContainerStyle={{ padding: S.pad, paddingTop: header.padTop, paddingBottom: 40 }}
      >
        {/* the title rises with the list, in the screen's first entrance. A tool archived or restored folds out of or
            into the card, and the rows after it glide (ListCard) */}
        <Enter index={0}>
          {header.hero}
          <ListCard>
            {tools.map((t) => (
              <ToolRow
                key={t.key} tool={t} count={counts[t.key] || 0} locked={lockedTool(t.key)}
                onOpen={openTool} onMenu={openMenu}
              />
            ))}
            {archivedTools.length ? (
              <ArchivedRow
                key="archived" names={archivedTools.map((t) => t.label).join(', ')} count={archivedTools.length}
                onPress={openArchive}
              />
            ) : null}
          </ListCard>
        </Enter>

        {/* system, deliberately separated: settings is not a tool; its title rises with its card */}
        <Enter index={1}>
          <SectionTitle>System</SectionTitle>
          <ListCard>
            <ListRow key="settings" onPress={() => openPage('/settings')} style={st.row}>
              <View style={[st.iconWell, wellFor(theme)]}>
                <Ionicons name="settings-outline" size={21} color={C.accent} />
              </View>
              <View style={{ flex: 1, marginLeft: 14 }}>
                <Text style={st.title}>Settings</Text>
                <Text style={[T.caption, { marginTop: 2 }]} numberOfLines={1}>Theme, tools, reminders and backup</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={C.textFaint} />
            </ListRow>
          </ListCard>
        </Enter>
      </Animated.ScrollView>

      <DotMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        items={menuFor ? [
          { label: 'Open', icon: 'open-outline', onPress: () => openTool(menuFor.key) },
          { label: 'Archive', icon: 'archive-outline', onPress: () => archive(menuFor) },
        ] : []}
      />
      <ToolArchiveSheet visible={archiveSheet} onClose={() => setArchiveSheet(false)} />
    </ScreenBG>
  );
}

const st = StyleSheet.create({
  row: { paddingVertical: 12 },
  iconWell: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  title: { color: C.text, fontFamily: F.semi, fontSize: 17, letterSpacing: TRACK.title },
  count: { color: C.textFaint, fontFamily: F.med, fontSize: 13, letterSpacing: TRACK.small, marginRight: 8, fontVariant: ['tabular-nums'] },
});
