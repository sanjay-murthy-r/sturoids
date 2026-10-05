import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C, F, MIN, NEU, TRACK, bgFor } from '../theme';
import { PillButton, useTheme } from './UI';

function Fallback({ onRestart }: { onRestart: () => void }) {
  const theme = useTheme();
  return (
    <View style={[st.wrap, { backgroundColor: bgFor(theme) }]}>
      <View
        style={[
          st.well,
          theme === 'minimal'
            ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border }
            : { backgroundColor: C.inset, ...NEU.insetLow },
        ]}
      >
        <Ionicons name="alert-circle-outline" size={28} color={C.textDim} />
      </View>
      <Text style={st.title}>Something went wrong.</Text>
      <Text style={st.body}>Your data is safe on this phone.</Text>
      <PillButton label="Restart" icon="refresh-outline" onPress={onRestart} style={{ marginTop: 22, minWidth: 180 }} />
    </View>
  );
}

/** A screen that throws while rendering shows a calm way back instead of a blank app. Restart remounts the app. */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null; generation: number }> {
  state = { error: null as Error | null, generation: 0 };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.warn('[app] a screen failed to render', error);
  }

  render() {
    if (this.state.error) {
      return <Fallback onRestart={() => this.setState((s) => ({ error: null, generation: s.generation + 1 }))} />;
    }
    return <React.Fragment key={this.state.generation}>{this.props.children}</React.Fragment>;
  }
}

const st = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  well: { width: 76, height: 76, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  title: { color: C.text, fontFamily: F.semi, fontSize: 17, letterSpacing: TRACK.title, marginTop: 18 },
  body: { color: C.textFaint, fontFamily: F.reg, fontSize: 13, letterSpacing: TRACK.small, lineHeight: 19, marginTop: 6, textAlign: 'center' },
});
