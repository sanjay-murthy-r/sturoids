import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C, F, S, T } from '../theme';
import { useStore } from '../store';
import { TOOLS, ToolKey, colorOf, normaliseArchived, normaliseSlots } from '../tools';
import { openTool } from '../toolNav';
import { Sheet, Hairline, Toggle } from './UI';
import { Bouncy } from './Motion';
import { tick } from '../haptics';

/**
 * Archived tools. From More it lists them, to open one or restore it; from Settings (`manage`) every tool can be
 * archived or restored. A tool in a tab slot cannot be archived, and neither can Deep Work while a session is going.
 */
export function ToolArchiveSheet({ visible, onClose, manage = false }: {
  visible: boolean; onClose: () => void; manage?: boolean;
}) {
  const rawSlots = useStore((s) => s.settings.tabSlots);
  const rawArchived = useStore((s) => s.settings.archivedTools);
  const sessionGoing = useStore((s) => !!s.deepWork);
  const setToolArchived = useStore((s) => s.setToolArchived);
  const slots = React.useMemo(() => normaliseSlots(rawSlots), [rawSlots]);
  const archived = React.useMemo(() => normaliseArchived(rawArchived, slots), [rawArchived, slots]);
  // a sheet is a window of its own and would cover the page it opens, so the tool opens once the sheet has gone
  const opening = React.useRef<ToolKey | null>(null);
  const tools = manage ? TOOLS : TOOLS.filter((t) => archived.includes(t.key));

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
      {tools.length === 0 ? (
        <Text style={[T.label, { paddingVertical: 12 }]}>Nothing is archived.</Text>
      ) : (
        tools.map((t, i) => {
          const on = archived.includes(t.key);
          const slot = slots.indexOf(t.key);
          const blocked = !on && (slot >= 0 || (t.key === 'focus' && sessionGoing));
          const caption = slot >= 0 ? 'In the tab bar, slot ' + (slot + 1) : t.key === 'focus' && sessionGoing && !on ? 'A session is going' : t.desc;
          const body = (
            <>
              <Ionicons name={t.icon as any} size={20} color={colorOf(t.colorKey)} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[T.body, { fontFamily: F.med }]} numberOfLines={1}>{t.label}</Text>
                <Text style={[T.caption, { marginTop: 1 }]} numberOfLines={1}>{caption}</Text>
              </View>
            </>
          );
          return (
            <View key={t.key}>
              {i > 0 && <Hairline />}
              {manage ? (
                <View style={st.row}>
                  {body}
                  {blocked ? null : (
                    <View style={st.toggle}>
                      <Toggle value={on} onChange={(v) => setToolArchived(t.key, v)} color={C.accent} label={'Archive ' + t.label} />
                    </View>
                  )}
                </View>
              ) : (
                <View style={st.row}>
                  <Bouncy
                    onPress={() => { opening.current = t.key; onClose(); }}
                    scaleTo={0.98}
                    radius={S.radiusSm}
                    style={st.open}
                  >
                    {body}
                  </Bouncy>
                  <Pressable
                    onPress={() => { tick(); setToolArchived(t.key, false); }}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={'Restore ' + t.label}
                  >
                    <Text style={[st.restore, { color: C.accent }]}>Restore</Text>
                  </Pressable>
                </View>
              )}
            </View>
          );
        })
      )}
    </Sheet>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 4 },
  open: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  restore: { fontFamily: F.semi, fontSize: 13, marginLeft: 12 },
  toggle: { marginLeft: 12 },
});
