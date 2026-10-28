// react-native-webview on the PC version: a page in a frame. Only what the app uses: a page by its address (Desmos) or
// by its HTML, its load and error callbacks, and messages the page posts to its parent.
import React from 'react';
import { View } from 'react-native';

export type WebViewMessageEvent = { nativeEvent: { data: string; url: string } };

interface Props {
  source?: { uri?: string; html?: string };
  style?: any;
  onLoadEnd?: (e: any) => void;
  onLoad?: (e: any) => void;
  onError?: (e: any) => void;
  onMessage?: (e: WebViewMessageEvent) => void;
  [k: string]: any;
}

export const WebView = React.forwardRef<any, Props>(function WebView({ source, style, onLoadEnd, onLoad, onError, onMessage }, ref) {
  const frame = React.useRef<HTMLIFrameElement | null>(null);
  const [key, setKey] = React.useState(0);
  React.useImperativeHandle(ref, () => ({
    // a page from another site cannot be reached into from here: what the app injects is left out
    injectJavaScript: (_js: string) => {},
    reload: () => setKey((k) => k + 1),
    goBack: () => { try { frame.current?.contentWindow?.history.back(); } catch { /* another site's history */ } },
    goForward: () => {},
    stopLoading: () => {},
    postMessage: (m: string) => frame.current?.contentWindow?.postMessage(m, '*'),
  }), []);
  React.useEffect(() => {
    if (!onMessage) return undefined;
    const on = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      onMessage({ nativeEvent: { data: typeof e.data === 'string' ? e.data : JSON.stringify(e.data), url: source?.uri || '' } });
    };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, [onMessage, source?.uri]);
  return (
    <View style={[{ flex: 1, overflow: 'hidden' }, style]}>
      {React.createElement('iframe', {
        key,
        ref: frame,
        src: source?.uri,
        srcDoc: source?.html,
        style: { border: 0, width: '100%', height: '100%', background: 'transparent' },
        allow: 'clipboard-read; clipboard-write; fullscreen',
        onLoad: (e: any) => { onLoad?.(e); onLoadEnd?.(e); },
        onError: (e: any) => onError?.(e),
      })}
    </View>
  );
});

export default WebView;
