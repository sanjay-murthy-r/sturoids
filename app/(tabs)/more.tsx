import React from 'react';
import { View, Text, StyleSheet, Pressable, useWindowDimensions } from 'react-native';
import Animated from 'react-native-reanimated';
import { useScrollToTop } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { C, F, MIN, S, T, TRACK, ThemeMode, neuInset, neuRaised } from '../../src/theme';
import { WIDE_AT, WIDE_MAX } from '../../src/layout';
import { rightClick } from '../../src/web/rightClick';
import { ScreenBG, ListCard, ListRow, SectionTitle, DotMenu, useTheme, useToolHeader } from '../../src/components/UI';
import { Enter, FadeSwap, useFocusKey } from '../../src/components/Motion';
import { ToolArchiveSheet } from '../../src/components/ToolArchiveSheet';
import { toast } from '../../src/components/Toast';
import { useStore } from '../../src/store';
import { TOOLS, Tool, ToolKey, colorOf, normaliseArchived, normaliseSlots } from '../../src/tools';
import { openPage, openTool } from '../../src/toolNav';
import { openReport } from '../../src/reports';
import { openSift } from '../../src/search/store';
import { useSiftAnchor } from '../../src/search/anchor';
import { BACKUP_ATTENTION_TEXT, useBackupAttention } from '../../src/cloud';
import { useOpen } from '../../src/lock';
import { useCheerful } from '../../src/components/Cheer';

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
const ToolRow = React.memo(function ToolRow({ tool, count, locked, open, onOpen, onMenu }: {
  tool: Tool; count: number; locked: boolean;
  /** a locked tool unlocked for now (its PIN entered this visit): the lock shows open */
  open?: boolean;
  onOpen: (key: ToolKey) => void; onMenu: (tool: Tool) => void;
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
        <Ionicons name={open ? 'lock-open-outline' : 'lock-closed-outline'} size={15} color={open ? C.accent : C.textFaint} style={{ marginRight: 8 }} />
      ) : null}
      {count ? (
        <Text style={st.count} accessibilityLabel={countOf ? count + ' ' + countOf[count === 1 ? 0 : 1] : undefined}>{count}</Text>
      ) : null}
      <Ionicons name="chevron-forward" size={18} color={C.textFaint} />
    </ListRow>
  );
});

/**
 * A tool as a tile, for a wide screen (a tablet, the PC): the list's row grown into a card of a grid, so a wide window
 * shows every tool at once instead of one long narrow column. A pointer over it lifts it a little; a right click opens
 * its menu, as a long press does.
 */
const ToolTile = React.memo(function ToolTile({ icon, iconColor, label, desc, count, locked, open, onPress, onMenu, width }: {
  icon: string; iconColor: string; label: string; desc: string; count?: number; locked?: boolean; open?: boolean;
  onPress: () => void; onMenu?: () => void; width: number;
}) {
  const theme = useTheme();
  const face = theme === 'minimal'
    ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: MIN.border }
    : { backgroundColor: C.card, ...neuRaised('mid') };
  return (
    <Pressable
      onPress={onPress} onLongPress={onMenu} {...rightClick(onMenu)} delayLongPress={420}
      accessibilityRole="button" accessibilityLabel={label + ', ' + desc}
      style={(state: any) => [
        st.tile, face, { width },
        state.hovered && { transform: [{ translateY: -2 }], borderColor: theme === 'minimal' ? C.accent + '66' : undefined },
        state.pressed && { transform: [{ scale: 0.98 }], opacity: 0.92 },
      ]}
    >
      <View style={st.tileTop}>
        <View style={[st.iconWell, wellFor(theme)]}>
          <Ionicons name={icon as any} size={22} color={iconColor} />
        </View>
        <View style={{ flex: 1 }} />
        {locked ? <Ionicons name={open ? 'lock-open-outline' : 'lock-closed-outline'} size={15} color={open ? C.accent : C.textFaint} style={{ marginRight: 6 }} /> : null}
        {count ? <Text style={st.count}>{count}</Text> : null}
      </View>
      <Text style={[st.title, { marginTop: 14 }]} numberOfLines={1}>{label}</Text>
      <Text style={[T.caption, { marginTop: 3 }]} numberOfLines={2}>{desc}</Text>
    </Pressable>
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
  // unlocked for now (the PIN entered this visit): the lock shows open until it locks again
  const notesOpen = useOpen('notes');
  const journalOpen = useOpen('journal');
  const openTool_ = (key: ToolKey) => (key === 'notes' ? notesOpen : key === 'journal' ? journalOpen : false);
  const openMenu = React.useCallback((t: Tool) => { setMenuFor(t); setMenuOpen(true); }, []);
  const openArchive = React.useCallback(() => setArchiveSheet(true), []);
  // the page is a list: its header is the big title alone, with no line of context and nothing live
  // a pull down anywhere on the list, once it is at its top, opens Sift too (Settings' choice)
  const header = useToolHeader({ scrollRef, title: 'More', mode: 'tab', contentPull: 'all' });
  // a wide window lays the tools out as a grid of tiles, as many across as fit
  const winW = useWindowDimensions().width;
  const [areaW, setAreaW] = React.useState(0);
  const grid = winW >= WIDE_AT && areaW > 0;
  const cols = Math.max(2, Math.min(4, Math.floor((areaW + S.gap) / (220 + S.gap))));
  const tileW = grid ? Math.floor((areaW - S.gap * (cols - 1)) / cols) : 0;
  // the backup paused or lost: the Settings row says so in amber, and opens Account straight away
  const attention = useBackupAttention();

  // an archive can be undone from its toast; Archived, at the end of the list, keeps it otherwise
  const archive = (t: Tool) => {
    if (setToolArchived(t.key, true)) toast(t.label + ' archived', { label: 'Undo', onPress: () => { setToolArchived(t.key, false); } });
    else toast('End the Deep Work session first.');
  };

  return (
    <ScreenBG guard maxWidth={winW >= WIDE_AT ? WIDE_MAX : undefined}>
      {header.bar}
      {header.pullArea(<Animated.ScrollView
        key={fk}
        ref={scrollRef}
        {...header.scrollProps}
        contentContainerStyle={{ padding: S.pad, paddingTop: header.padTop, paddingBottom: 40 }}
      >
        {/* the title rises with the list, in the screen's first entrance. A tool archived or restored folds out of or
            into the card, and the rows after it glide (ListCard) */}
        <Enter index={0}>
          {header.hero}
          <View onLayout={(e) => setAreaW(e.nativeEvent.layout.width)}>
            <SiftField theme={theme} />
          </View>
          {grid ? (
            <View style={st.grid}>
              {tools.map((t) => (
                <ToolTile
                  key={t.key} width={tileW} icon={t.icon} iconColor={colorOf(t.colorKey)} label={t.label} desc={t.desc}
                  count={counts[t.key] || 0} locked={lockedTool(t.key)} open={openTool_(t.key)} onPress={() => openTool(t.key)} onMenu={() => openMenu(t)}
                />
              ))}
              {archivedTools.length ? (
                <ToolTile
                  key="archived" width={tileW} icon="archive-outline" iconColor={C.textDim} label="Archived"
                  desc={archivedTools.map((t) => t.label).join(', ')} count={archivedTools.length} onPress={openArchive}
                />
              ) : null}
            </View>
          ) : (
          <ListCard>
            {tools.map((t) => (
              <ToolRow
                key={t.key} tool={t} count={counts[t.key] || 0} locked={lockedTool(t.key)} open={openTool_(t.key)}
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
          )}
        </Enter>

        {/* system, deliberately separated: settings is not a tool; its title rises with its card */}
        <Enter index={1}>
          <SectionTitle>System</SectionTitle>
          {grid ? (
            <View style={st.grid}>
              <ToolTile
                width={tileW} icon="settings-outline" iconColor={attention === 'ok' ? C.accent : C.amber} label="Settings"
                desc={attention === 'ok' ? 'Theme, tools, reminders and backup' : BACKUP_ATTENTION_TEXT[attention]}
                onPress={() => (attention === 'ok' ? openPage('/settings') : openPage('/settings', { page: 'account' }))}
              />
              <ToolTile
                width={tileW} icon="document-text-outline" iconColor={C.accent} label="Reports & exports"
                desc="One summary, or the full progress report, as PDF or CSV" onPress={openReport}
              />
            </View>
          ) : (
          <ListCard>
            <ListRow
              key="settings" style={st.row}
              onPress={() => (attention === 'ok' ? openPage('/settings') : openPage('/settings', { page: 'account' }))}
            >
              <View style={[st.iconWell, wellFor(theme)]}>
                <Ionicons name="settings-outline" size={21} color={C.accent} />
              </View>
              <View style={{ flex: 1, marginLeft: 14 }}>
                <Text style={st.title}>Settings</Text>
                <FadeSwap swapKey={attention} style={{ marginTop: 2 }}>
                  {attention === 'ok' ? (
                    <Text style={T.caption} numberOfLines={1}>Theme, tools, reminders and backup</Text>
                  ) : (
                    <View style={st.attnRow}>
                      <View style={[st.attnDot, { backgroundColor: C.amber }]} />
                      <Text style={[T.caption, { color: C.amber, flexShrink: 1 }]} numberOfLines={1}>{BACKUP_ATTENTION_TEXT[attention]}</Text>
                    </View>
                  )}
                </FadeSwap>
              </View>
              <Ionicons name="chevron-forward" size={18} color={C.textFaint} />
            </ListRow>
            <ListRow key="report" style={st.row} onPress={openReport}>
              <View style={[st.iconWell, wellFor(theme)]}>
                <Ionicons name="document-text-outline" size={21} color={C.accent} />
              </View>
              <View style={{ flex: 1, marginLeft: 14 }}>
                <Text style={st.title}>Reports & exports</Text>
                <Text style={[T.caption, { marginTop: 2 }]} numberOfLines={1}>One summary, or the full progress report, as PDF or CSV</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={C.textFaint} />
            </ListRow>
          </ListCard>
          )}
        </Enter>
      </Animated.ScrollView>)}

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

/**
 * What looks like a search field at the top of the list: a carved well with the glyph and Sift's own words. A tap opens
 * Sift over the app (every scope), where the real field takes the keyboard.
 */
function SiftField({ theme }: { theme: ThemeMode }) {
  const anchor = useSiftAnchor('more');
  // Cheerful: the well lets the page's colour through a little, as the bars do
  const cheerful = useCheerful();
  return (
    <Animated.View ref={anchor.ref} style={anchor.style} collapsable={false}>
    <Pressable
      onPress={() => openSift('more')}
      accessibilityRole="search"
      accessibilityLabel="Sift through everything"
      accessibilityHint="Opens Sift, the search across the whole app"
      style={({ pressed }) => [st.sift, wellFor(theme), cheerful && theme !== 'minimal' && { backgroundColor: C.inset + 'CC' }, pressed && { opacity: 0.8 }]}
    >
      <Ionicons name="search" size={18} color={C.textFaint} />
      <Text style={st.siftText} numberOfLines={1}>Sift through everything</Text>
    </Pressable>
    </Animated.View>
  );
}

const st = StyleSheet.create({
  row: { paddingVertical: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: S.gap },
  tile: { borderRadius: S.radius, padding: S.cardPad, minHeight: 138 },
  tileTop: { flexDirection: 'row', alignItems: 'center' },
  sift: {
    height: 48, borderRadius: 16, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 10,
    marginBottom: S.gap + 4,
  },
  siftText: { flex: 1, color: C.textFaint, fontFamily: F.reg, fontSize: 15, letterSpacing: TRACK.body },
  attnRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  attnDot: { width: 6, height: 6, borderRadius: 3 },
  iconWell: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  title: { color: C.text, fontFamily: F.semi, fontSize: 17, letterSpacing: TRACK.title },
  count: { color: C.textFaint, fontFamily: F.med, fontSize: 13, letterSpacing: TRACK.small, marginRight: 8, fontVariant: ['tabular-nums'] },
});
