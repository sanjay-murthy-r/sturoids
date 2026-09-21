import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { C, F, MIN, S, T, neuInset } from '../../src/theme';
import { ScreenBG, ListCard, ListRow, SectionTitle, DotMenu, useTheme } from '../../src/components/UI';
import { Enter, useFocusKey } from '../../src/components/Motion';
import { ToolArchiveSheet } from '../../src/components/ToolArchiveSheet';
import { toast } from '../../src/components/Toast';
import { useStore } from '../../src/store';
import { TOOLS, Tool, ToolKey, colorOf, normaliseArchived, normaliseSlots } from '../../src/tools';
import { openTool } from '../../src/toolNav';

/**
 * Every tool that is neither in a bar slot nor archived, then the archived ones behind one row, then Settings. A tool
 * opened from here is a full page with a back button; moving it into a slot (Settings, Tools) takes it off this list.
 */
export default function More() {
  const insets = useSafeAreaInsets();
  const fk = useFocusKey();
  const router = useRouter();
  const theme = useTheme();
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
  const tools = TOOLS.filter((t) => !slots.includes(t.key) && !archived.includes(t.key));
  const archivedTools = TOOLS.filter((t) => archived.includes(t.key));
  // the menu keeps its tool while it closes, so its rows never empty out mid-animation
  const [menuFor, setMenuFor] = React.useState<Tool | null>(null);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [archiveSheet, setArchiveSheet] = React.useState(false);
  // a locked tool shows no count: even how many pages it holds stays private
  const counts: Partial<Record<ToolKey, number>> = {
    notes: notesLocked ? 0 : notes, vault: videos, journal: journalLocked ? 0 : journalCount,
  };
  const lockedTool = (key: ToolKey) => (key === 'journal' && journalLocked) || (key === 'notes' && notesLocked);
  // the icon sits in a carved well: a raised boss on a raised card doubled the depth
  const well =
    theme === 'minimal'
      ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border }
      : { backgroundColor: C.inset, ...neuInset('low') };

  const archive = (t: Tool) => {
    if (setToolArchived(t.key, true)) toast(t.label + ' archived. Restore it from Archived at the end of this list.');
    else toast('End the Deep Work session first.');
  };

  return (
    <ScreenBG guard>
      <ScrollView key={fk} contentContainerStyle={{ padding: S.pad, paddingTop: insets.top + 20, paddingBottom: 40 }}>
        <Text style={T.kicker}>Toolbox</Text>
        <Text style={[T.display, { marginTop: 4, marginBottom: 16 }]}>More</Text>

        <Enter index={0}>
          <ListCard>
            {tools.map((t) => {
              const count = counts[t.key];
              return (
                <ListRow key={t.key} onPress={() => openTool(t.key)} onLongPress={() => { setMenuFor(t); setMenuOpen(true); }} style={{ paddingVertical: 12 }}>
                  <View style={[st.iconWell, well]}>
                    <Ionicons name={t.icon as any} size={22} color={colorOf(t.colorKey)} />
                  </View>
                  <View style={{ flex: 1, marginLeft: 14 }}>
                    <Text style={st.title} numberOfLines={1}>{t.label}</Text>
                    <Text style={[T.caption, { marginTop: 2 }]} numberOfLines={1}>{t.desc}</Text>
                  </View>
                  {lockedTool(t.key) ? (
                    <Ionicons name="lock-closed-outline" size={15} color={C.textFaint} style={{ marginRight: 8 }} />
                  ) : null}
                  {count ? <Text style={st.count}>{count}</Text> : null}
                  <Ionicons name="chevron-forward" size={18} color={C.textFaint} />
                </ListRow>
              );
            })}
            {archivedTools.length ? (
              <ListRow key="archived" onPress={() => setArchiveSheet(true)} style={{ paddingVertical: 12 }}>
                <View style={[st.iconWell, well]}>
                  <Ionicons name="archive-outline" size={21} color={C.textDim} />
                </View>
                <View style={{ flex: 1, marginLeft: 14 }}>
                  <Text style={st.title}>Archived</Text>
                  <Text style={[T.caption, { marginTop: 2 }]} numberOfLines={1}>{archivedTools.map((t) => t.label).join(', ')}</Text>
                </View>
                <Text style={st.count}>{archivedTools.length}</Text>
                <Ionicons name="chevron-forward" size={18} color={C.textFaint} />
              </ListRow>
            ) : null}
          </ListCard>
        </Enter>

        {/* system, deliberately separated: settings is not a tool */}
        <SectionTitle>System</SectionTitle>
        <Enter index={1}>
          <ListCard>
            <ListRow key="settings" onPress={() => router.push('/settings')} style={{ paddingVertical: 12 }}>
              <View style={[st.iconWell, well]}>
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
      </ScrollView>

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
  iconWell: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  title: { color: C.text, fontFamily: F.semi, fontSize: 17, letterSpacing: -0.1 },
  count: { color: C.textFaint, fontFamily: F.med, fontSize: 13, marginRight: 8, fontVariant: ['tabular-nums'] },
});
