import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { C, S, T } from '../../src/theme';
import { ScreenBG, GlassCard, Row } from '../../src/components/UI';
import { useStore } from '../../src/store';

const ITEMS = [
  { label: 'Notes', desc: 'Text + voice, folders & tags', icon: 'document-text-outline', route: '/notes', color: C.green },
  { label: 'Calculator', desc: 'Precise scientific calc', icon: 'calculator-outline', route: '/calculator', color: C.amber },
  { label: 'Desmos', desc: 'Graphing calculator', icon: 'analytics-outline', route: '/desmos', color: C.teal },
  { label: 'Vault', desc: 'YouTube study library', icon: 'play-circle-outline', route: '/vault', color: C.pink },
  { label: 'AI Quick-Links', desc: 'Claude, ChatGPT, Gemini…', icon: 'sparkles-outline', route: '/ai-links', color: C.violet },
  { label: 'Settings', desc: 'Theme, backup, updates', icon: 'settings-outline', route: '/settings', color: C.accent },
] as const;

export default function More() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const notes = useStore((s) => s.notes.length);
  const videos = useStore((s) => s.vaultVideos.length);

  return (
    <ScreenBG>
      <ScrollView contentContainerStyle={{ padding: S.pad, paddingTop: insets.top + 14, paddingBottom: 40 }}>
        <Text style={st.h1}>More</Text>
        {ITEMS.map((it) => (
          <GlassCard key={it.label} pad={14} onPress={() => router.push(it.route as any)}>
            <Row>
              <View style={[st.iconWrap, { backgroundColor: it.color + '1E', borderColor: it.color + '55' }]}>
                <Ionicons name={it.icon as any} size={22} color={it.color} />
              </View>
              <View style={{ flex: 1, marginLeft: 14 }}>
                <Text style={{ color: C.text, fontSize: 16, fontWeight: '700' }}>
                  {it.label}
                  {it.label === 'Notes' && notes > 0 ? <Text style={{ color: C.textFaint, fontSize: 13 }}>  {notes}</Text> : null}
                  {it.label === 'Vault' && videos > 0 ? <Text style={{ color: C.textFaint, fontSize: 13 }}>  {videos}</Text> : null}
                </Text>
                <Text style={{ color: C.textDim, fontSize: 12, marginTop: 2 }}>{it.desc}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={C.textFaint} />
            </Row>
          </GlassCard>
        ))}
      </ScrollView>
    </ScreenBG>
  );
}

const st = StyleSheet.create({
  h1: { ...(T.display as object), marginBottom: 16 } as any,
  iconWrap: {
    width: 44, height: 44, borderRadius: 14, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
});
