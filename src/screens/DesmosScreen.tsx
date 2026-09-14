import React, { useCallback, useRef } from 'react';
import { View, ActivityIndicator, BackHandler } from 'react-native';
import { WebView } from 'react-native-webview';
import { useFocusEffect, useRouter } from 'expo-router';
import { C, MIN, bgFor, neuRaised } from '../theme';
import { NeuHeader, useTheme } from '../components/UI';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function DesmosScreen({ mode }: { mode: 'tab' | 'stack' }) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const router = useRouter();
  const bg = bgFor(theme);
  const webRef = useRef<WebView>(null);
  const canBack = useRef(false);
  // layered back: web history first, then the tool itself
  const goBack = useCallback(() => {
    if (canBack.current) { webRef.current?.goBack(); return true; }
    return false;
  }, []);
  useFocusEffect(useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', goBack);
    return () => sub.remove();
  }, [goBack]));
  return (
    <View style={{ flex: 1, backgroundColor: bg, paddingBottom: mode === 'tab' ? 0 : insets.bottom }}>
      <NeuHeader
        title="Desmos"
        variant={mode === 'tab' ? 'tab' : 'page'}
        compact
        onBack={() => { if (!goBack()) router.back(); }}
      />
      <WebView
        ref={webRef}
        onNavigationStateChange={(s) => { canBack.current = s.canGoBack; }}
        source={{ uri: 'https://www.desmos.com/calculator' }}
        style={{ flex: 1, backgroundColor: bg }}
        javaScriptEnabled
        domStorageEnabled // lets Desmos remember the session's graph state
        startInLoadingState
        renderLoading={() => (
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: bg }}>
            <View
              style={[
                { width: 96, height: 96, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
                theme === 'minimal'
                  ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: MIN.border }
                  : { backgroundColor: C.card, ...neuRaised('mid') },
              ]}
            >
              <ActivityIndicator size="large" color={C.accent} />
            </View>
          </View>
        )}
      />
    </View>
  );
}
