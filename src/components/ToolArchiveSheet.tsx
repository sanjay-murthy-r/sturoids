import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { C, F, S, T, TRACK } from '../theme';
import { useStore } from '../store';
import { TOOLS, Tool, ToolKey, colorOf, normaliseArchived, normaliseSlots } from '../tools';
import { openTool } from '../toolNav';
import { Sheet, Hairline, Toggle, useTheme } from './UI';
import { Appear, Bouncy, glide, rowIn, rowOut, useAnimLevel, useBuilt } from './Motion';
import { tick } from '../haptics';

/**
 * One tool of the sheet, memoised: a toggle or a restore re-renders its own row, not the whole list. From Settings
 * (`manage`) it carries a switch; from More, a tap opens the tool as it is and Restore brings it back to More.
 */
const ArchiveRow = React.memo(function ArchiveRow({
  tool, first, manage, on, slot, sessionGoing, onToggle, onOpen, onRestore,
}: {
  tool: Tool; first: boolean; manage: boolean;
  /** archived now */
  on: boolean;
  /** its tab slot, or -1 */
  slot: number;
  sessionGoing: boolean;
  onToggle: (key: ToolKey, archived: boolean) => void;
  onOpen: (key: ToolKey) => void;
  onRestore: (key: ToolKey) => void;
}) {
  // a tool's colour can be the accent, and Restore is written in it: the row repaints when a new accent is picked
  useTheme();
  const blocked = !on && (slot >= 0 || (tool.key === 'focus' && sessionGoing));
  const caption = slot >= 0 ? 'In the tab bar, slot ' + (slot + 1) : tool.key === 'focus' && sessionGoing && !on ? 'A session is going' : tool.desc;
  const body = (
    <>
      <Ionicons name={tool.icon as any} size={20} color={colorOf(tool.colorKey)} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={[T.body, { fontFamily: F.med }]} numberOfLines={1}>{tool.label}</Text>
        <Text style={[T.caption, { marginTop: 1 }]} numberOfLines={1}>{caption}</Text>
      </View>
    </>
  );
  return (
    <View>
      {first ? null : <Hairline />}
      {manage ? (
        <View style={st.row}>
          {body}
          {blocked ? null : (
            <View style={st.toggle}>
              <Toggle value={on} onChange={(v) => onToggle(tool.key, v)} color={C.accent} label={'Archive ' + tool.label} />
            </View>
          )}
        </View>
      ) : (
        <View style={st.row}>
          <Bouncy onPress={() => onOpen(tool.key)} scaleTo={0.98} radius={S.radiusSm} style={st.open}>
            {body}
          </Bouncy>
          {/* Restore sinks and carves like every other press, instead of answering with nothing but a haptic */}
          <Bouncy
            onPress={() => onRestore(tool.key)} scaleTo={0.94} radius={999} hitSlop={6} style={st.restore}
            accessibilityRole="button" accessibilityLabel={'Restore ' + tool.label}
          >
            <Text style={[st.restoreText, { color: C.accent }]}>Restore</Text>
          </Bouncy>
        </View>
      )}
    </View>
  );
});

/**
 * The sheet's list. It is built each time the sheet opens, so the rows it opens with are simply there; a tool restored
 * from it fades out while the rows after it glide up, and the note that nothing is left fades in.
 */
function ArchiveList({ manage, onOpen }: { manage: boolean; onOpen: (key: ToolKey) => void }) {
  const level = useAnimLevel();
  const built = useBuilt();
  const rawSlots = useStore((s) => s.settings.tabSlots);
  const rawArchived = useStore((s) => s.settings.archivedTools);
  const sessionGoing = useStore((s) => !!s.deepWork);
  const setToolArchived = useStore((s) => s.setToolArchived);
  const slots = React.useMemo(() => normaliseSlots(rawSlots), [rawSlots]);
  const archived = React.useMemo(() => normaliseArchived(rawArchived, slots), [rawArchived, slots]);
  const tools = React.useMemo(() => (manage ? TOOLS : TOOLS.filter((t) => archived.includes(t.key))), [manage, archived]);
  const toggle = React.useCallback((key: ToolKey, v: boolean) => { setToolArchived(key, v); }, [setToolArchived]);
  const restore = React.useCallback((key: ToolKey) => { tick(); setToolArchived(key, false); }, [setToolArchived]);

  if (tools.length === 0) {
    return <Appear><Text style={[T.label, { paddingVertical: 12 }]}>Nothing is archived.</Text></Appear>;
  }
  return (
    <>
      {tools.map((t, i) => (
        <Animated.View key={t.key} entering={built.current ? rowIn(level) : undefined} exiting={rowOut(level)} layout={glide(level)}>
          <ArchiveRow
            tool={t} first={i === 0} manage={manage} on={archived.includes(t.key)} slot={slots.indexOf(t.key)}
            sessionGoing={sessionGoing} onToggle={toggle} onOpen={onOpen} onRestore={restore}
          />
        </Animated.View>
      ))}
    </>
  );
}

/**
 * Archived tools. From More it lists them, to open one or restore it; from Settings (`manage`) every tool can be
 * archived or restored. A tool in a tab slot cannot be archived, and neither can Deep Work while a session is going.
 */
export function ToolArchiveSheet({ visible, onClose, manage = false }: {
  visible: boolean; onClose: () => void; manage?: boolean;
}) {
  // a sheet is a window of its own and would cover the page it opens, so the tool opens once the sheet has gone
  const opening = React.useRef<ToolKey | null>(null);
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;
  const openRow = React.useCallback((key: ToolKey) => {
    opening.current = key;
    closeRef.current();
  }, []);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      onClosed={() => {
        const k = opening.current;
        opening.current = null;
        if (k) openTool(k);
      }}
      title={manage ? 'Archive tools' : 'Archived'}
    >
      <Text style={[T.caption, { marginBottom: 8 }]}>
        {manage
          ? 'An archived tool leaves More, quick access and Today, and its reminders pause, until you restore it. Nothing in it is deleted.'
          : 'Open one as it is, or restore it to More.'}
      </Text>
      <ArchiveList manage={manage} onOpen={openRow} />
    </Sheet>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 4 },
  open: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  // the text keeps its old place: 2 of margin and 10 of padding where it had 12 of margin
  restore: { marginLeft: 2, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999 },
  restoreText: { fontFamily: F.semi, fontSize: 13, letterSpacing: TRACK.small },
  toggle: { marginLeft: 12 },
});
