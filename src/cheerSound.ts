import { AppState, Platform, Vibration } from 'react-native';
import type { AudioPlayer } from 'expo-audio';
import { useStore } from './store';
import { tick } from './haptics';

// Cheerful's sounds and haptics, one of each per moment, as picked in the sound study: short, musical, and only in
// Cheerful, with the app in front and its sounds on (Settings, Appearance). Elite stays silent. The files are made by
// scripts/make-cheer-sounds.js; each player is made the first time its moment comes, never at launch.

export type CheerMoment = 'tick' | 'add' | 'start' | 'done' | 'day' | 'streak' | 'makeover';

/* eslint-disable @typescript-eslint/no-var-requires */
const FILES: Record<CheerMoment, number> = {
  tick: require('../assets/sounds/cheer-tick.wav'),
  add: require('../assets/sounds/cheer-add.wav'),
  start: require('../assets/sounds/cheer-start.wav'),
  done: require('../assets/sounds/cheer-done.wav'),
  day: require('../assets/sounds/cheer-day.wav'),
  streak: require('../assets/sounds/cheer-streak.wav'),
  makeover: require('../assets/sounds/cheer-makeover.wav'),
};
/* eslint-enable @typescript-eslint/no-var-requires */

/** each moment's haptic, as in the study: off, on, off, on… in ms (Android plays the pattern; elsewhere one tap) */
const HAPTIC: Record<CheerMoment, number[]> = {
  tick: [0, 12],
  add: [0, 8],
  start: [0, 18],
  done: [0, 24, 70, 34],
  day: [0, 18, 40, 18, 40, 60],
  streak: [0, 14, 30, 40],
  makeover: [0, 10, 30, 10, 30, 50],
};
/** how loud each plays, against the others (the tick is the most frequent, so the quietest) */
const VOLUME: Record<CheerMoment, number> = { tick: 0.55, add: 0.6, start: 0.8, done: 0.9, day: 0.9, streak: 0.85, makeover: 0.8 };

const players: Partial<Record<CheerMoment, AudioPlayer>> = {};
let moded = false;

function player(m: CheerMoment): AudioPlayer {
  const audio = require('expo-audio') as typeof import('expo-audio');
  if (!moded) {
    moded = true;
    // a short sound lowers other audio for a moment instead of stopping it
    audio.setAudioModeAsync({ interruptionModeAndroid: 'duckOthers', shouldPlayInBackground: false }).catch(() => {});
  }
  const p = players[m] ?? (players[m] = audio.createAudioPlayer(FILES[m]));
  return p;
}

/** Whether a moment in Cheerful should sound now. */
export function cheerOn(): boolean {
  const s = useStore.getState().settings;
  return s.mood === 'cheerful';
}

/** One of Cheerful's moments: its haptic, and its sound when sounds are on. Nothing in Elite. */
export function cheer(m: CheerMoment) {
  const s = useStore.getState().settings;
  if (s.mood !== 'cheerful') return;
  try {
    if (Platform.OS === 'android') Vibration.vibrate(HAPTIC[m]);
    else tick();
  } catch {
    // no vibrator
  }
  if (!s.cheerSounds || AppState.currentState !== 'active') return;
  try {
    const p = player(m);
    p.volume = VOLUME[m];
    p.seekTo(0).catch(() => {}).then(() => p.play()).catch(() => {});
  } catch {
    // no audio here: the haptic has said it
  }
}
