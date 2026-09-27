import React, { useCallback, useRef, useState } from 'react';
import { View, ActivityIndicator, BackHandler, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { useFocusEffect, useRouter } from 'expo-router';
import Animated, { Easing, FadeOut } from 'react-native-reanimated';
import { C, MIN, bgFor, neuRaised } from '../theme';
import { NeuHeader, ScreenBG, useTheme, EmptyState } from '../components/UI';
import { useAnimLevel } from '../components/Motion';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function DesmosScreen({ mode }: { mode: 'tab' | 'stack' }) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const level = useAnimLevel();
  const router = useRouter();
  const bg = bgFor(theme);
  const webRef = useRef<WebView>(null);
  const canBack = useRef(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // the first load of each attempt: the plate covers the page until Desmos has drawn, then fades off it
  const [loading, setLoading] = useState(true);
  // layered back: web history first, then the tool itself
  const goBack = useCallback(() => {
    if (canBack.current) { webRef.current?.goBack(); return true; }
    return false;
  }, []);
  useFocusEffect(useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', goBack);
    return () => sub.remove();
  }, [goBack]));
  // the material every tool sits on, without the tab fling, which would fight the graph's own pan
  return (
    <ScreenBG guard={mode === 'tab'} fling={false} maxWidth={null}>
      <View style={{ flex: 1, backgroundColor: bg, paddingBottom: mode === 'tab' ? 0 : insets.bottom }}>
        <NeuHeader
          title="Desmos"
          variant={mode === 'tab' ? 'tab' : 'page'}
          compact
          onBack={() => { if (!goBack()) router.back(); }}
        />
        {failed ? (
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <EmptyState
              icon="cloud-offline-outline" title="Desmos needs a connection." body="Check your internet, then try again."
              actionLabel="Retry" onAction={() => { setFailed(false); setLoading(true); setAttempt((a) => a + 1); }}
            />
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            <WebView
              key={attempt}
              ref={webRef}
              onError={() => setFailed(true)}
              // later navigations inside Desmos keep the page in view: only the first load waits under the plate
              onLoadEnd={() => setLoading(false)}
              onNavigationStateChange={(s) => { canBack.current = s.canGoBack; }}
              source={{ uri: 'https://www.desmos.com/calculator' }}
              style={{ flex: 1, backgroundColor: bg }}
              javaScriptEnabled
              domStorageEnabled // lets Desmos remember the session's graph state
            />
            {loading ? (
              <Animated.View
                pointerEvents="none"
                exiting={level === 'none' ? undefined : FadeOut.duration(level === 'full' ? 280 : 180).easing(Easing.out(Easing.quad))}
                style={[StyleSheet.absoluteFill, st.cover, { backgroundColor: bg }]}
              >
                <View
                  style={[
                    st.plate,
                    theme === 'minimal'
                      ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: MIN.border }
                      : { backgroundColor: C.card, ...neuRaised('mid') },
                  ]}
                >
                  <ActivityIndicator size="large" color={C.accent} />
                </View>
              </Animated.View>
            ) : null}
          </View>
        )}
      </View>
    </ScreenBG>
  );
}

const st = StyleSheet.create({
  cover: { alignItems: 'center', justifyContent: 'center' },
  plate: { width: 96, height: 96, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
});
