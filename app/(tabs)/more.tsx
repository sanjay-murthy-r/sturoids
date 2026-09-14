import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { C, F, MIN, S, T, neuInset } from '../../src/theme';
import { ScreenBG, Card, Row, SectionTitle, useTheme } from '../../src/components/UI';
import { Enter, useFocusKey } from '../../src/components/Motion';
import { useStore } from '../../src/store';
import { TOOLS, ToolKey, colorOf, normaliseSlots } from '../../src/tools';
import { openTool } from '../../src/toolNav';

/**
 * Every tool that is not in a bar slot, then Settings. A tool opened from here is a full page with a
 * back button; moving it into a slot (Settings, Tab bar) takes it off this list.
 */
export default function More() {
  const insets = useSafeAreaInsets();
  const fk = useFocusKey();
  const router = useRouter();
  const theme = useTheme();
  const rawSlots = useStore((s) => s.settings.tabSlots);
  const notes = useStore((s) => s.notes.length);
  const videos = useStore((s) => s.vaultVideos.length);
  const journalCount = useStore((s) => s.journal.length);
  const journalLocked = useStore((s) => s.settings.journalLocked);
  const slots = React.useMemo(() => normaliseSlots(rawSlots), [rawSlots]);
  const tools = TOOLS.filter((t) => !slots.includes(t.key));
  // a locked journal shows no count: even the number of entries stays private
  const counts: Partial<Record<ToolKey, number>> = { notes, vault: videos, journal: journalLocked ? 0 : journalCount };
  // the icon sits in a carved well: a raised boss on a raised card doubled the depth
  const well =
    theme === 'minimal'
      ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border }
      : { backgroundColor: C.inset, ...neuInset('low') };

  return (
    <ScreenBG guard>
      <ScrollView key={fk} contentContainerStyle={{ padding: S.pad, paddingTop: insets.top + 20, paddingBottom: 40 }}>
        <Text style={T.kicker}>Toolbox</Text>
        <Text style={[T.display, { marginTop: 4, marginBottom: 16 }]}>More</Text>

        {tools.map((t, i) => {
          const count = counts[t.key];
          return (
            <Enter key={t.key} index={i}>
              <Card pad={14} onPress={() => openTool(t.key)}>
                <Row>
                  <View style={[st.iconWell, well]}>
                    <Ionicons name={t.icon as any} size={22} color={colorOf(t.colorKey)} />
                  </View>
                  <View style={{ flex: 1, marginLeft: 14 }}>
                    <Text style={st.title} numberOfLines={1}>{t.label}</Text>
                    <Text style={[T.caption, { marginTop: 2 }]} numberOfLines={1}>{t.desc}</Text>
                  </View>
                  {t.key === 'journal' && journalLocked ? (
                    <Ionicons name="lock-closed-outline" size={15} color={C.textFaint} style={{ marginRight: 8 }} />
                  ) : null}
                  {count ? <Text style={st.count}>{count}</Text> : null}
                  <Ionicons name="chevron-forward" size={18} color={C.textFaint} />
                </Row>
              </Card>
            </Enter>
          );
        })}

        {/* system, deliberately separated: settings is not a tool */}
        <SectionTitle>System</SectionTitle>
        <Enter index={tools.length}>
          <Card pad={14} onPress={() => router.push('/settings')}>
            <Row>
              <View style={[st.iconWell, well]}>
                <Ionicons name="settings-outline" size={21} color={C.accent} />
              </View>
              <View style={{ flex: 1, marginLeft: 14 }}>
                <Text style={st.title}>Settings</Text>
                <Text style={[T.caption, { marginTop: 2 }]} numberOfLines={1}>Theme, tab bar, reminders and backup</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={C.textFaint} />
            </Row>
          </Card>
        </Enter>
      </ScrollView>
    </ScreenBG>
  );
}

const st = StyleSheet.create({
  iconWell: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  title: { color: C.text, fontFamily: F.semi, fontSize: 17, letterSpacing: -0.1 },
  count: { color: C.textFaint, fontFamily: F.med, fontSize: 13, marginRight: 8, fontVariant: ['tabular-nums'] },
});
