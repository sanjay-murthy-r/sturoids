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

/** The desktop app (Electron) has the page's speech API but no service behind it: no voice there. */
const inDesktopApp = typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent || '');

export function voiceAvailable(): boolean {
  return !inDesktopApp && !!(mod && mod.ExpoSpeechRecognitionModule);
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
 * The recogniser's listeners belong to the module, not to a session, so a session stopped and another started at
 * once would overlap: the old one's listeners would write its last phrase a second time, and its late 'end' would
 * take the new one's listeners away and show the mic off while it listened. A stopped session keeps here the promise
 * of its 'end', and its listeners; the next one waits for that (only so long) and drops any listeners still left.
 */
const END_WAIT_MS = 1500;
let ending: Promise<void> | null = null;
let lastSubs: any[] | null = null;
const dropSubs = (subs: any[]) => subs.forEach((s) => { try { s?.remove?.(); } catch {} });

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

    // the session before, if it is still on its way out
    if (ending) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([ending, new Promise<void>((r) => { timer = setTimeout(r, END_WAIT_MS); })]);
      clearTimeout(timer);
      ending = null;
    }
    if (lastSubs) { dropSubs(lastSubs); lastSubs = null; }

    const subs: any[] = [];
    let ended!: () => void;
    const endSeen = new Promise<void>((r) => { ended = r; });
    lastSubs = subs;
    subs.push(M.addListener('result', (e: any) => {
      try {
        const transcript = e?.results?.[0]?.transcript;
        if (!transcript) return;
        if (e?.isFinal) onFinal(transcript);
        else onInterim(transcript);
      } catch {}
    }));
    subs.push(M.addListener('end', () => {
      dropSubs(subs);
      if (lastSubs === subs) lastSubs = null;
      ended();
      onEnd();
    }));
    subs.push(M.addListener('error', (e: any) => {
      onError(e?.message || e?.error || 'Speech recognition error');
    }));

    try {
      M.start({
        lang,
        interimResults: true,
        continuous: true,
        requiresOnDeviceRecognition: onDevice,
        addsPunctuation: true,
      });
    } catch (e) {
      // it never started, so no 'end' will come to take its listeners away
      dropSubs(subs);
      if (lastSubs === subs) lastSubs = null;
      ended();
      throw e;
    }

    return {
      stop: () => {
        ending = endSeen;
        try { M.stop(); } catch {}
      },
    };
  } catch (e: any) {
    onError(String(e?.message || e));
    return null;
  }
}
