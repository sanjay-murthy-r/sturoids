import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, ActivityIndicator, AppState, BackHandler, Linking, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';
import { useFocusEffect, useRouter } from 'expo-router';
import Animated, { Easing, FadeOut } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { C, MIN, bgFor, neuRaised } from '../theme';
import { NeuHeader, ScreenBG, useTheme, EmptyState } from '../components/UI';
import { Bouncy, useAnimLevel } from '../components/Motion';
import { toast } from '../components/Toast';
import { useStore } from '../store';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const DESMOS = 'https://www.desmos.com/calculator';
/** how long the first load may take before the plate gives way to a way to try again */
const SLOW_MS = 15000;
/** how long the plate waits for the calculator to turn dark and take back its graph before it lifts anyway */
const SETTLE_MS = 3000;
/** a graph sent to be kept is written once the sends settle, never on each one */
const KEEP_MS = 800;

/**
 * Runs in every Desmos page. It waits for the page's own calculator (`window.Calc`), turns it dark, and says it is
 * ready, with whether this is the bare calculator (a graph opened from an account has its own home on Desmos). The
 * app then hands back the kept graph (`__sturoidsRestore`) and lifts the plate. `__sturoidsPost` sends the bare
 * calculator's graph to be kept: the app asks for it as the tool is left or the app goes away, and the page sends it
 * as it is hidden or left for another page, and as it settles after each change once the kept graph is back (a page
 * closed by Back is gone before it could answer the app). `__sturoidsReplace` puts a graph brought in from elsewhere on
 * screen. Any of it failing leaves an ordinary Desmos.
 */
const PAGE_JS = `(function () {
  if (window.__sturoids) return;
  window.__sturoids = true;
  var post = function (m) { try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch (e) {} };
  var bare = function () { return /^\\/calculator\\/?$/.test(location.pathname); };
  var dark = function () { try { window.Calc.updateSettings({ invertedColors: true }); } catch (e) {} };
  window.__sturoidsPost = function () {
    try { if (window.Calc && bare()) post({ t: 'state', s: JSON.stringify(window.Calc.getState()) }); } catch (e) {}
  };
  var watching = false;
  var settled = null;
  var watch = function () {
    if (watching) return;
    watching = true;
    try {
      window.Calc.observeEvent('change', function () {
        if (settled) clearTimeout(settled);
        settled = setTimeout(function () { settled = null; window.__sturoidsPost(); }, 700);
      });
    } catch (e) {}
  };
  window.__sturoidsRestore = function (s) {
    var ok = !s;
    try { if (s && window.Calc && bare()) { window.Calc.setState(JSON.parse(s), { allowUndo: false }); ok = true; } } catch (e) {}
    dark();
    if (ok) watch();
    post({ t: 'shown' });
  };
  window.__sturoidsReplace = function (s) {
    try { if (window.Calc && bare()) { if (s) window.Calc.setState(JSON.parse(s), { allowUndo: false }); else window.Calc.setBlank(); } } catch (e) {}
    dark();
  };
  var tries = 0;
  (function wait() {
    if (window.Calc && typeof window.Calc.getState === 'function') {
      dark();
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') window.__sturoidsPost();
      });
      window.addEventListener('pagehide', function () { window.__sturoidsPost(); });
      post({ t: 'ready', bare: bare() });
      return;
    }
    if (++tries < 150) setTimeout(wait, 100);
    else post({ t: 'missing' });
  })();
})();
true;`;
/** asks the page for its graph, to be kept */
const ASK_STATE = 'window.__sturoidsPost && window.__sturoidsPost(); true;';

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

  // The plate lifts once the calculator is dark and has its graph back, or SETTLE_MS after the page has loaded or
  // said it is ready if it never says more (a Desmos that has changed): a step that fails never keeps the tool hidden.
  const attemptRef = useRef(attempt);
  attemptRef.current = attempt;
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reveal = useCallback(() => {
    if (settle.current) { clearTimeout(settle.current); settle.current = null; }
    setLoading(false);
  }, []);
  const revealSoon = useCallback((at: number) => {
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(() => { settle.current = null; if (attemptRef.current === at) setLoading(false); }, SETTLE_MS);
  }, []);
  useEffect(() => () => { if (settle.current) clearTimeout(settle.current); }, []);

  // The graph is kept for next time (desmosState): the page sends it as it settles after a change, as the tool is left
  // and as the app goes away, and it is written once those sends settle. A graph too big to keep leaves the one kept
  // before, and says so once.
  const pending = useRef<string | null>(null);
  const keepTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warned = useRef(false);
  // the graph this tool last kept, or found kept: any other one arriving in the store came from elsewhere
  const known = useRef(useStore.getState().desmosState);
  const flush = useCallback(() => {
    if (keepTimer.current) { clearTimeout(keepTimer.current); keepTimer.current = null; }
    const json = pending.current;
    pending.current = null;
    if (json == null) return;
    const before = known.current;
    known.current = json;
    if (!useStore.getState().setDesmosState(json)) {
      known.current = before;
      if (!warned.current) {
        warned.current = true;
        toast('This graph is too big to keep for next time.');
      }
    }
  }, []);
  // A graph brought in from elsewhere (a restore, an import, an erase, the cloud's newer copy) takes the place of the
  // one on screen, and what was waiting to be kept is dropped, so leaving the tool never writes the old graph back
  useEffect(() => useStore.subscribe((s, prev) => {
    if (s.desmosState === prev.desmosState || s.desmosState === known.current) return;
    known.current = s.desmosState;
    pending.current = null;
    if (keepTimer.current) { clearTimeout(keepTimer.current); keepTimer.current = null; }
    webRef.current?.injectJavaScript('window.__sturoidsReplace && window.__sturoidsReplace(' + JSON.stringify(s.desmosState) + '); true;');
  }), []);
  const keep = useCallback((json: string) => {
    pending.current = json;
    if (keepTimer.current) clearTimeout(keepTimer.current);
    // away from the app it is written at once, before the phone can put the app to sleep
    if (AppState.currentState !== 'active') { flush(); return; }
    keepTimer.current = setTimeout(flush, KEEP_MS);
  }, [flush]);
  // leaving: what is still waiting is written now
  useEffect(() => () => flush(), [flush]);
  const askState = useCallback(() => { webRef.current?.injectJavaScript(ASK_STATE); }, []);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => { if (next !== 'active') askState(); });
    return () => sub.remove();
  }, [askState]);

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    // only Desmos's own pages are listened to
    if (!inDesmos(e.nativeEvent.url || '')) return;
    let m: { t?: string; s?: unknown; bare?: boolean };
    try { m = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'state') {
      if (typeof m.s === 'string' && m.s.startsWith('{')) keep(m.s);
    } else if (m.t === 'ready') {
      // the bare calculator opens on the graph as it was left, set before the plate lifts; from then on the page sends
      // its graph as it settles after each change
      const saved = pending.current ?? useStore.getState().desmosState;
      if (m.bare) webRef.current?.injectJavaScript('window.__sturoidsRestore(' + JSON.stringify(saved || '') + '); true;');
      if (m.bare && saved) revealSoon(attemptRef.current);
      else reveal();
    } else if (m.t === 'shown' || m.t === 'missing') {
      reveal();
    }
  }, [keep, reveal, revealSoon]);
  // layered back: web history first, then the tool itself
  const goBack = useCallback(() => {
    if (canBack.current) { webRef.current?.goBack(); return true; }
    return false;
  }, []);
  useFocusEffect(useCallback(() => {
    // back on a tool that could not load: it tries again by itself, as the connection may well be back
    if (failedRef.current) retry();
    const sub = BackHandler.addEventListener('hardwareBackPress', goBack);
    return () => {
      sub.remove();
      // the tool is left (another tab, or the page closing): its graph is kept
      askState();
    };
  }, [goBack, retry, askState]));
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
              // later navigations inside Desmos keep the page in view: only the first load waits under the plate, until
              // the page says the calculator is ready (see onMessage), or a moment after it has loaded
              onLoadEnd={() => revealSoon(attempt)}
              injectedJavaScript={PAGE_JS}
              onMessage={onMessage}
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
              // the plate takes the touches meant for the page it hides: a tap on it never lands on an unseen graph
              <Animated.View
                pointerEvents="auto"
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
