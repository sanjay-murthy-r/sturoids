import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, ActivityIndicator, BackHandler, Linking, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { useFocusEffect, useRouter } from 'expo-router';
import Animated, { Easing, FadeOut } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { C, MIN, bgFor, neuRaised } from '../theme';
import { NeuHeader, ScreenBG, useTheme, EmptyState } from '../components/UI';
import { Bouncy, useAnimLevel } from '../components/Motion';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const DESMOS = 'https://www.desmos.com/calculator';
/** how long the first load may take before the plate gives way to a way to try again */
const SLOW_MS = 15000;

/** Whether a page belongs in the tool: Desmos's own, and the blank and data pages a page makes for itself. */
function inDesmos(url: string): boolean {
  const m = /^https?:\/\/([^/?#:]+)/i.exec(url);
  if (!m) return true;
  const host = m[1].toLowerCase();
  return host === 'desmos.com' || host.endsWith('.desmos.com');
}

/** Hands a page that is not Desmos's to the phone's browser: Google, for one, will not sign in inside an app. */
function openOutside(url: string) {
  Linking.openURL(url).catch(() => {});
}

export function DesmosScreen({ mode }: { mode: 'tab' | 'stack' }) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const level = useAnimLevel();
  const router = useRouter();
  const bg = bgFor(theme);
  const webRef = useRef<WebView>(null);
  const canBack = useRef(false);
  // the Desmos page on show, for the tray's "Open in browser"
  const pageUrl = useRef(DESMOS);
  const [failed, setFailed] = useState(false);
  const failedRef = useRef(false);
  failedRef.current = failed;
  const [attempt, setAttempt] = useState(0);
  // after a failed load, one more try from what the WebView has kept of an earlier visit (a classroom with no
  // signal); every other load goes to the network as usual, so updates still arrive
  const [cacheOnly, setCacheOnly] = useState(false);
  // the first load of each attempt: the plate covers the page until Desmos has drawn, then fades off it
  const [loading, setLoading] = useState(true);
  // a first load still going after SLOW_MS: the plate makes way for a way to try again
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!loading) return undefined;
    const t = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(t);
  }, [loading, attempt]);
  const retry = useCallback(() => {
    setFailed(false);
    setCacheOnly(false);
    setLoading(true);
    setAttempt((a) => a + 1);
  }, []);
  // layered back: web history first, then the tool itself
  const goBack = useCallback(() => {
    if (canBack.current) { webRef.current?.goBack(); return true; }
    return false;
  }, []);
  useFocusEffect(useCallback(() => {
    // back on a tool that could not load: it tries again by itself, as the connection may well be back
    if (failedRef.current) retry();
    const sub = BackHandler.addEventListener('hardwareBackPress', goBack);
    return () => sub.remove();
  }, [goBack, retry]));
  // the material every tool sits on, without the tab fling, which would fight the graph's own pan
  return (
    <ScreenBG guard={mode === 'tab'} fling={false} maxWidth={null}>
      <View style={{ flex: 1, backgroundColor: bg, paddingBottom: mode === 'tab' ? 0 : insets.bottom }}>
        {/* a full-screen tool has no scroll to link and nothing to introduce: just the bar, its title always showing */}
        <NeuHeader
          title="Desmos"
          variant={mode === 'tab' ? 'tab' : 'page'}
          onBack={() => { if (!goBack()) router.back(); }}
          right={(
            // one flat button in the tray, drawn as the tray's own: saving graphs with a Google account needs the browser
            <Bouncy
              onPress={() => openOutside(pageUrl.current)} scaleTo={1} sink={false} radius={18} hitSlop={4}
              accessibilityLabel="Open in browser" accessibilityRole="button" style={st.trayBtn}
            >
              <Ionicons name="open-outline" size={19} color={C.textDim} />
            </Bouncy>
          )}
        />
        {failed ? (
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <EmptyState
              icon="cloud-offline-outline" title="Desmos needs a connection" body="Check your internet, then try again."
              actionLabel="Retry" onAction={retry}
            />
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            <WebView
              key={attempt}
              ref={webRef}
              cacheMode={cacheOnly ? 'LOAD_CACHE_ONLY' : 'LOAD_DEFAULT'}
              onError={() => {
                if (cacheOnly) { setFailed(true); return; }
                setCacheOnly(true);
                setLoading(true);
                setAttempt((a) => a + 1);
              }}
              // Android ends a heavy page's renderer now and then while the app is away. The WebView survives it but
              // the page does not, so a fresh one loads under the plate instead of leaving the tool blank for good
              onRenderProcessGone={() => { setLoading(true); setAttempt((a) => a + 1); }}
              // later navigations inside Desmos keep the page in view: only the first load waits under the plate
              onLoadEnd={() => setLoading(false)}
              onNavigationStateChange={(s) => {
                canBack.current = s.canGoBack;
                if (inDesmos(s.url) && /^https?:/i.test(s.url)) pageUrl.current = s.url;
              }}
              // Desmos stays in the tool; a link to anywhere else, or a page that opens a window of its own, goes to
              // the browser rather than taking the tool's place
              onShouldStartLoadWithRequest={(req) => {
                if (inDesmos(req.url)) return true;
                openOutside(req.url);
                return false;
              }}
              onOpenWindow={(e) => openOutside(e.nativeEvent.targetUrl)}
              source={{ uri: DESMOS }}
              style={{ flex: 1, backgroundColor: bg }}
              javaScriptEnabled
              domStorageEnabled // lets Desmos remember the session's graph state
            />
            {loading ? (
              <Animated.View
                pointerEvents={slow ? 'auto' : 'none'}
                exiting={level === 'none' ? undefined : FadeOut.duration(level === 'full' ? 280 : 180).easing(Easing.out(Easing.quad))}
                style={[StyleSheet.absoluteFill, st.cover, { backgroundColor: bg }]}
              >
                {slow ? (
                  <View style={st.slow}>
                    <EmptyState
                      icon="hourglass-outline" title="Desmos is taking a while" body="The connection may be slow. Try again, or keep waiting."
                      actionLabel="Retry" onAction={retry}
                    />
                  </View>
                ) : (
                  <View
                    accessible
                    accessibilityLabel="Loading Desmos"
                    style={[
                      st.plate,
                      theme === 'minimal'
                        ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: MIN.border }
                        : { backgroundColor: C.card, ...neuRaised('mid') },
                    ]}
                  >
                    <ActivityIndicator size="large" color={C.accent} />
                  </View>
                )}
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
  slow: { alignSelf: 'stretch' },
  // the size of a button in the header's tray
  trayBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
