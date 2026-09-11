import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { C, F, MIN, S, T, neuRaised } from '../../src/theme';
import { ScreenBG, Card, Row, SectionTitle, useTheme } from '../../src/components/UI';
import { Enter, useFocusKey } from '../../src/components/Motion';
import { useStore } from '../../src/store';

const FEATURES = [
  { label: 'Notes', desc: 'Text, voice, images & files', icon: 'document-text-outline', route: '/notes', color: C.green },
  { label: 'Calculator', desc: 'Precise scientific calc', icon: 'calculator-outline', route: '/calculator', color: C.amber },
  { label: 'Desmos', desc: 'Graphing calculator', icon: 'analytics-outline', route: '/desmos', color: C.teal },
  { label: 'YT Vault', desc: 'YouTube study library', icon: 'play-circle-outline', route: '/vault', color: C.pink },
  { label: 'AI Quick-Links', desc: 'Claude, ChatGPT, Gemini…', icon: 'sparkles-outline', route: '/ai-links', color: C.violet },
] as const;

export default function More() {
  const insets = useSafeAreaInsets();
  const fk = useFocusKey();
  const router = useRouter();
  const theme = useTheme();
  const notes = useStore((s) => s.notes.length);
  const videos = useStore((s) => s.vaultVideos.length);
  const tile =
    theme === 'minimal'
      ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: MIN.border }
      : { backgroundColor: C.card, ...neuRaised('low') };

  return (
    <ScreenBG guard>
      <ScrollView key={fk} contentContainerStyle={{ padding: S.pad, paddingTop: insets.top + 20, paddingBottom: 40 }}>
        <Text style={T.kicker}>Toolbox</Text>
        <Text style={[T.display, { marginTop: 4, marginBottom: 16 }]}>More</Text>

        {FEATURES.map((it, i) => (
          <Enter key={it.label} index={i}>
            <Card pad={14} onPress={() => router.push(it.route as any)}>
              <Row>
                <View style={[st.iconWrap, tile]}>
                  <Ionicons name={it.icon as any} size={22} color={it.color} />
                </View>
                <View style={{ flex: 1, marginLeft: 14 }}>
                  <Text style={{ color: C.text, fontSize: 16, fontFamily: F.semi, letterSpacing: -0.2 }}>
                    {it.label}
                    {it.label === 'Notes' && notes > 0 ? <Text style={{ color: C.textFaint, fontSize: 13 }}>  {notes}</Text> : null}
                    {it.label === 'YT Vault' && videos > 0 ? <Text style={{ color: C.textFaint, fontSize: 13 }}>  {videos}</Text> : null}
                  </Text>
                  <Text style={[T.caption, { marginTop: 2 }]}>{it.desc}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={C.textFaint} />
              </Row>
            </Card>
          </Enter>
        ))}

        {/* system — deliberately separated: settings is not a feature */}
        <SectionTitle>System</SectionTitle>
        <Enter index={5}>
          <Card pad={14} onPress={() => router.push('/settings')}>
            <Row>
              <View style={[st.settingsIcon, tile]}>
                <Ionicons name="settings-sharp" size={20} color={C.accent} />
              </View>
              <View style={{ flex: 1, marginLeft: 14 }}>
                <Text style={{ color: C.text, fontSize: 15, fontFamily: F.semi }}>Settings</Text>
                <Text style={[T.caption, { marginTop: 2 }]}>Theme · animations · reminders · backup · updates</Text>
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
  iconWrap: {
    width: 44, height: 44, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  settingsIcon: {
    width: 38, height: 38, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
});
