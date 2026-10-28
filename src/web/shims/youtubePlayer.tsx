// react-native-youtube-iframe on the PC version: YouTube's own player in the page (its IFrame Player API), behind the
// same props and the same ref the Vault's player screen uses on a phone.
import React from 'react';
import { View } from 'react-native';

declare global {
  interface Window { YT?: any; onYouTubeIframeAPIReady?: () => void }
}

let api: Promise<any> | null = null;
function loadApi(): Promise<any> {
  if (api) return api;
  api = new Promise((resolve) => {
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT);
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    document.head.appendChild(s);
  });
  return api;
}

export interface YoutubeIframeRef {
  getCurrentTime: () => Promise<number>;
  getDuration: () => Promise<number>;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getVideoUrl: () => Promise<string>;
  isMuted: () => Promise<boolean>;
  getVolume: () => Promise<number>;
  getPlaybackRate: () => Promise<number>;
  getAvailablePlaybackRates: () => Promise<number[]>;
}

interface Props {
  width?: number; height: number; videoId?: string; play?: boolean; mute?: boolean;
  onReady?: () => void; onError?: (e: string) => void; onChangeState?: (s: string) => void;
  onFullScreenChange?: (f: boolean) => void; onPlaybackRateChange?: (r: number) => void;
  initialPlayerParams?: { start?: number; end?: number; loop?: boolean; controls?: boolean; rel?: boolean; [k: string]: any };
  webViewProps?: any; webViewStyle?: any;
}

const STATES: Record<number, string> = { [-1]: 'unstarted', 0: 'ended', 1: 'playing', 2: 'paused', 3: 'buffering', 5: 'video cued' };
const ERRORS: Record<number, string> = { 2: 'invalid_parameter', 5: 'HTML5_error', 100: 'video_not_found', 101: 'embed_not_allowed', 150: 'embed_not_allowed' };

const YoutubePlayer = React.forwardRef<YoutubeIframeRef, Props>(function YoutubePlayer(props, ref) {
  const host = React.useRef<HTMLDivElement | null>(null);
  const player = React.useRef<any>(null);
  const ready = React.useRef(false);
  const cb = React.useRef(props);
  cb.current = props;

  React.useImperativeHandle(ref, () => ({
    getCurrentTime: async () => player.current?.getCurrentTime?.() ?? 0,
    getDuration: async () => player.current?.getDuration?.() ?? 0,
    seekTo: (s: number, ahead: boolean) => player.current?.seekTo?.(s, ahead),
    getVideoUrl: async () => player.current?.getVideoUrl?.() ?? '',
    isMuted: async () => !!player.current?.isMuted?.(),
    getVolume: async () => player.current?.getVolume?.() ?? 100,
    getPlaybackRate: async () => player.current?.getPlaybackRate?.() ?? 1,
    getAvailablePlaybackRates: async () => player.current?.getAvailablePlaybackRates?.() ?? [1],
  }), []);

  React.useEffect(() => {
    let live = true;
    const onFs = () => cb.current.onFullScreenChange?.(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    loadApi().then((YT) => {
      if (!live || !host.current) return;
      const mount = document.createElement('div');
      host.current.innerHTML = '';
      host.current.appendChild(mount);
      const p = props.initialPlayerParams || {};
      player.current = new YT.Player(mount, {
        width: '100%', height: '100%', videoId: props.videoId,
        playerVars: {
          playsinline: 1, rel: p.rel ? 1 : 0, modestbranding: 1, controls: p.controls === false ? 0 : 1,
          ...(p.start ? { start: Math.floor(p.start) } : null), ...(p.end ? { end: Math.floor(p.end) } : null),
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            ready.current = true;
            if (cb.current.play) player.current.playVideo();
            cb.current.onReady?.();
          },
          onStateChange: (e: any) => cb.current.onChangeState?.(STATES[e.data] ?? String(e.data)),
          onError: (e: any) => cb.current.onError?.(ERRORS[e.data] ?? 'HTML5_error'),
          onPlaybackRateChange: (e: any) => cb.current.onPlaybackRateChange?.(e.data),
        },
      });
    });
    return () => {
      live = false;
      document.removeEventListener('fullscreenchange', onFs);
      try { player.current?.destroy?.(); } catch { /* already gone */ }
      player.current = null;
      ready.current = false;
    };
    // a new video builds a new player, as on a phone
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.videoId]);

  React.useEffect(() => {
    if (!ready.current || !player.current) return;
    if (props.play) player.current.playVideo?.();
    else player.current.pauseVideo?.();
  }, [props.play]);

  return (
    <View style={{ width: props.width, height: props.height, backgroundColor: '#000' }}>
      {React.createElement('div', { ref: host, style: { width: '100%', height: '100%' } })}
    </View>
  );
});

export default YoutubePlayer;
