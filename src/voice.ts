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

/**
 * On-device speech recognition (English) with LIVE interim transcripts.
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
    const perm = await M.requestPermissionsAsync();
    if (!perm.granted) { onError('Microphone permission was denied.'); return null; }

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
      lang: 'en-IN',
      interimResults: true,
      continuous: true,
      requiresOnDeviceRecognition: false,
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
