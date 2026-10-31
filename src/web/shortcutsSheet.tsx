// The PC's keyboard shortcuts, listed in a sheet: ? away from a text field (or Ctrl+/) opens it. On a phone it is never
// opened, so it never draws.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { create } from 'zustand';
import { C, F, MIN, TRACK } from '../theme';
import { Sheet, useTheme } from '../components/UI';
import { SHORTCUT_LIST } from './pc';

const useShortcuts = create<{ open: boolean }>(() => ({ open: false }));

export const openShortcuts = () => useShortcuts.setState({ open: true });
export const shortcutsOpen = () => useShortcuts.getState().open;

/** Mounted once, in the root layout: each shortcut with its keys as small caps beside what it does. */
export function ShortcutsHost() {
  const open = useShortcuts((s) => s.open);
  const theme = useTheme();
  const cap = theme === 'minimal'
    ? { backgroundColor: MIN.inset, borderColor: MIN.border }
    : { backgroundColor: C.inset, borderColor: C.outline };
  return (
    <Sheet visible={open} onClose={() => useShortcuts.setState({ open: false })} title="Keyboard shortcuts">
      {SHORTCUT_LIST.map((s, i) => (
        <View
          key={i} style={[st.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.hairline }]}
          accessible accessibilityLabel={s.keys.join(' ') + ', ' + s.what}
        >
          <Text style={st.what}>{s.what}</Text>
          <View style={st.keys}>
            {s.keys.map((k, j) => <Text key={j} style={[st.cap, cap]}>{k}</Text>)}
          </View>
        </View>
      ))}
    </Sheet>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11 },
  what: { flex: 1, minWidth: 0, color: C.text, fontFamily: F.reg, fontSize: 14, letterSpacing: TRACK.small, marginRight: 12 },
  keys: { flexDirection: 'row', gap: 6 },
  cap: {
    color: C.textDim, fontFamily: F.smMed, fontSize: 12, letterSpacing: TRACK.fine, borderWidth: 1, borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden', minWidth: 28, textAlign: 'center',
  },
});
