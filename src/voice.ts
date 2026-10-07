import { expectAway } from './lock';

// Guarded wrapper around expo-speech-recognition so the app still runs
// in environments without the native module (e.g. Expo Go).
let mod: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  mod = require('expo-speech-recognition');
} catch {
  mod = null;
}

export function voiceAvailable(): boolean {
  return !!(mod && mod.ExpoSpeechRecognitionModule);
}

export interface VoiceSession { stop: () => void }

const FALLBACK_LANG = 'en-IN';

/** The phone's own language, as a BCP 47 tag ('en-GB'), or the fallback when it cannot be read. */
function phoneLang(): string {
  try {
    const tag = Intl.DateTimeFormat().resolvedOptions().locale;
    return /^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(tag || '') ? tag : FALLBACK_LANG;
  } catch {
    return FALLBACK_LANG;
  }
}

/**
 * The language to listen in, and whether the phone can do it on the device itself. The phone's language when the
 * recogniser lists it (or, on an older phone that lists nothing, when it is a kind of English); en-IN otherwise.
 * On-device only when that language is installed for offline use, so the audio stays on the phone whenever it can.
 */
async function pickRecognizer(M: any): Promise<{ lang: string; onDevice: boolean }> {
  const want = phoneLang();
  let lang = FALLBACK_LANG;
  let installed: string[] = [];
  try {
    const { locales = [], installedLocales = [] } = await M.getSupportedLocales({});
    installed = installedLocales;
    const listed = (l: string) => locales.includes(l) || installedLocales.includes(l);
    if (locales.length || installedLocales.length) lang = listed(want) ? want : FALLBACK_LANG;
    else if (want.startsWith('en-')) lang = want;
  } catch {
    if (want.startsWith('en-')) lang = want;
  }
  let onDevice = false;
  try {
    onDevice = !!M.supportsOnDeviceRecognition?.() && installed.includes(lang);
  } catch {
    onDevice = false;
  }
  return { lang, onDevice };
}
let picked: Promise<{ lang: string; onDevice: boolean }> | null = null;

/**
 * Speech recognition with live interim transcripts, on the device when the phone can do it there.
 * onInterim fires continuously with the phrase being spoken;
 * onFinal fires when a phrase is committed.
 */
export async function startVoice(
  onFinal: (text: string) => void,
  onInterim: (text: string) => void,
  onEnd: () => void,
  onError: (message: string) => void
): Promise<VoiceSession | null> {
  if (!voiceAvailable()) return null;
  const M = mod.ExpoSpeechRecognitionModule;
  try {
    // the first time, Android asks in a dialog of its own, which takes the app out of view for a moment
    const perm = await expectAway(() => M.requestPermissionsAsync() as Promise<{ granted: boolean }>);
    if (!perm.granted) { onError('Microphone permission was denied.'); return null; }
    // asked once per launch: the answer only changes when a language is installed in the phone's settings
    if (!picked) picked = pickRecognizer(M);
    const { lang, onDevice } = await picked;

    const subs: any[] = [];
    subs.push(M.addListener('result', (e: any) => {
      try {
        const transcript = e?.results?.[0]?.transcript;
        if (!transcript) return;
        if (e?.isFinal) onFinal(transcript);
        else onInterim(transcript);
      } catch {}
    }));
    subs.push(M.addListener('end', () => {
      subs.forEach((s) => s?.remove?.());
      onEnd();
    }));
    subs.push(M.addListener('error', (e: any) => {
      onError(e?.message || e?.error || 'Speech recognition error');
    }));

    M.start({
      lang,
      interimResults: true,
      continuous: true,
      requiresOnDeviceRecognition: onDevice,
      addsPunctuation: true,
    });

    return {
      stop: () => { try { M.stop(); } catch {} },
    };
  } catch (e: any) {
    onError(String(e?.message || e));
    return null;
  }
}
