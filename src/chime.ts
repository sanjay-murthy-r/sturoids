import { AppState, Vibration } from 'react-native';
import type { AudioPlayer } from 'expo-audio';
import { useStore } from './store';

// The end of a Deep Work block, felt and heard. The buzz always plays, at every motion level: it is how a phone lying
// face down says the block is over. The soft chime (assets/sounds/chime.wav, made by scripts/make-chime.js) plays only
// while the user keeps it on and the app is in front; away, the notification's channel carries the same sound.

/** wait, buzz, wait, buzz: the same pattern as the notification channel's */
const PATTERN = [0, 180, 120, 180];

let player: AudioPlayer | null = null;

/** The one player, made the first time a block ends, never at launch. */
function chimePlayer(): AudioPlayer {
  if (player) return player;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const audio = require('expo-audio') as typeof import('expo-audio');
  // a short sound lowers other audio for a moment rather than stopping it
  audio.setAudioModeAsync({ interruptionModeAndroid: 'duckOthers', shouldPlayInBackground: false }).catch(() => {});
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  player = audio.createAudioPlayer(require('../assets/sounds/chime.wav'));
  return player;
}

/** A countdown block has ended while the app is open: the buzz, and the chime when it is on. */
export function playSessionEnd(): void {
  try {
    Vibration.vibrate(PATTERN);
  } catch {
    // no vibrator
  }
  if (!useStore.getState().settings.focusChime || AppState.currentState !== 'active') return;
  try {
    const p = chimePlayer();
    // a player that has played once rests at its end: it starts again from the top
    p.seekTo(0).catch(() => {}).then(() => p.play()).catch(() => {});
  } catch {
    // no audio here: the buzz has said it
  }
}
