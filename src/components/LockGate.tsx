import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { allowScreenCaptureAsync, preventScreenCaptureAsync } from 'expo-screen-capture';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { C, F, MIN, NEU, T } from '../theme';
import { PillButton, Sheet, useTheme } from './UI';
import { Bouncy, useAnimLevel } from './Motion';
import { tap, tick } from '../haptics';
import { markUnlocked, pinCooldownMs, setPin, unlockWithDevice, useUnlocked, verifyPin, deviceAuthAvailable } from '../lock';

const PIN_LEN = 6;
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

/**
 * Six carved wells and a keypad. `enter` checks the app PIN; `set` asks for a new PIN twice and stores it.
 */
export function PinSheet({ visible, mode, onClose, onDone }: {
  visible: boolean; mode: 'enter' | 'set'; onClose: () => void; onDone: () => void;
}) {
  const theme = useTheme();
  const level = useAnimLevel();
  const [digits, setDigits] = React.useState('');
  const [first, setFirst] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState('');
  const [coolS, setCoolS] = React.useState(0);
  const busy = React.useRef(false);
  const shake = useSharedValue(0);
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));
  // with no fingerprint, face or screen lock on the phone, the PIN is the only way back in: say so before it is set
  const [pinOnly, setPinOnly] = React.useState(false);
  React.useEffect(() => {
    if (!visible || mode !== 'set') return undefined;
    let live = true;
    deviceAuthAvailable().then((ok) => { if (live) setPinOnly(!ok); });
    return () => { live = false; };
  }, [visible, mode]);

  React.useEffect(() => {
    if (!visible) return;
    setDigits('');
    setFirst(null);
    setMessage('');
    setCoolS(Math.ceil(pinCooldownMs() / 1000));
  }, [visible]);

  React.useEffect(() => {
    if (coolS <= 0) return undefined;
    const t = setTimeout(() => setCoolS(Math.ceil(pinCooldownMs() / 1000)), 500);
    return () => clearTimeout(t);
  }, [coolS]);

  const reject = (text: string) => {
    setMessage(text);
    setDigits('');
    if (level !== 'none') {
      shake.value = withSequence(
        withTiming(-8, { duration: 50 }), withTiming(8, { duration: 50 }),
        withTiming(-5, { duration: 50 }), withTiming(0, { duration: 60 }),
      );
    }
  };

  const complete = async (pin: string) => {
    if (busy.current) return;
    busy.current = true;
    try {
      if (mode === 'enter') {
        const r = await verifyPin(pin);
        if (r === 'ok') onDone();
        else if (r === 'cooldown') {
          setDigits('');
          setMessage('');
          setCoolS(Math.ceil(pinCooldownMs() / 1000));
        } else reject('Wrong PIN');
      } else if (first == null) {
        setFirst(pin);
        setDigits('');
        setMessage('');
      } else if (first === pin) {
        await setPin(pin);
        onDone();
      } else {
        setFirst(null);
        reject("PINs don't match");
      }
    } finally {
      busy.current = false;
    }
  };

  const press = (k: string) => {
    if (coolS > 0 || busy.current) return;
    if (k === 'del') {
      tick();
      setDigits((d) => d.slice(0, -1));
      return;
    }
    if (!k || digits.length >= PIN_LEN) return;
    tap();
    const next = digits + k;
    setDigits(next);
    if (next.length === PIN_LEN) setTimeout(() => complete(next), 80);
  };

  const title = mode === 'enter' ? 'Enter PIN' : first == null ? 'Set a 6-digit PIN' : 'Confirm PIN';
  const status = coolS > 0 ? 'Try again in ' + coolS + 's' : message;
  const well = theme === 'minimal'
    ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border }
    : { backgroundColor: C.inset, ...NEU.insetHairline };
  const key = theme === 'minimal'
    ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: MIN.border }
    : { backgroundColor: C.card, ...NEU.raisedLow };

  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <Animated.View style={[st.dots, shakeStyle]}>
        {Array.from({ length: PIN_LEN }, (_, i) => (
          <View key={i} style={[st.dotWell, well]}>
            {i < digits.length ? <View style={[st.dot, { backgroundColor: C.accent }]} /> : null}
          </View>
        ))}
      </Animated.View>
      {mode === 'set' && pinOnly ? (
        <Text style={[T.caption, { textAlign: 'center', marginBottom: 6 }]}>
          This phone has no screen lock, so this PIN is the only way in. If you forget it, locked pages stay locked.
        </Text>
      ) : null}
      <Text style={[T.caption, st.status, status ? { color: coolS > 0 ? C.textFaint : C.danger } : null]}>
        {status || ' '}
      </Text>
      <View style={st.pad}>
        {KEYS.map((k, i) =>
          k === '' ? (
            <View key={i} style={st.keySpace} />
          ) : (
            <Bouncy
              key={i}
              onPress={() => press(k)}
              scaleTo={0.92}
              radius={32}
              style={[st.key, key, coolS > 0 ? { opacity: 0.45 } : null]}
            >
              {k === 'del' ? (
                <Ionicons name="backspace-outline" size={22} color={C.textDim} />
              ) : (
                <Text style={st.keyText}>{k}</Text>
              )}
            </Bouncy>
          ),
        )}
      </View>
    </Sheet>
  );
}

/**
 * Shows `children` only while they are unlocked. While locked it renders a carved lock well instead, never the
 * content underneath, so the app switcher shows nothing. Device authentication starts on its own once each time
 * the gate is focused; after a cancel it waits for Unlock.
 */
/**
 * While locked content is open and in front, Android keeps it out of screenshots and the recent apps preview.
 * Each gate holds its own key, so closing one never lifts the shield another still needs.
 */
function Shielded({ children }: { children: React.ReactNode }) {
  const key = 'sturoids-lock' + React.useId();
  useFocusEffect(React.useCallback(() => {
    preventScreenCaptureAsync(key).catch(() => {});
    return () => { allowScreenCaptureAsync(key).catch(() => {}); };
  }, [key]));
  return <>{children}</>;
}

export function LockGate({ locked, title, children }: { locked: boolean; title: string; children: React.ReactNode }) {
  const theme = useTheme();
  const unlocked = useUnlocked();
  const open = !locked || unlocked;
  const [pinOpen, setPinOpen] = React.useState(false);
  const tried = React.useRef(false);

  const attempt = React.useCallback(async () => {
    const r = await unlockWithDevice();
    if (r === 'needs-pin') setPinOpen(true);
  }, []);

  React.useEffect(() => {
    if (open) tried.current = false;
  }, [open]);

  useFocusEffect(React.useCallback(() => {
    if (open || tried.current) return;
    tried.current = true;
    attempt();
  }, [open, attempt]));

  if (open) return locked ? <Shielded>{children}</Shielded> : <>{children}</>;

  return (
    <View style={st.gate}>
      <View
        style={[
          st.lockWell,
          theme === 'minimal'
            ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border }
            : { backgroundColor: C.inset, ...NEU.insetLow },
        ]}
      >
        <Ionicons name="lock-closed-outline" size={28} color={C.accent} />
      </View>
      <Text style={[T.title, { marginTop: 18 }]}>{title}</Text>
      <Text style={[T.caption, { marginTop: 6, textAlign: 'center' }]}>Unlock with fingerprint or PIN</Text>
      <PillButton label="Unlock" icon="lock-open-outline" onPress={attempt} style={{ marginTop: 22, minWidth: 180 }} />
      <PinSheet
        visible={pinOpen}
        mode="enter"
        onClose={() => setPinOpen(false)}
        onDone={() => {
          setPinOpen(false);
          markUnlocked();
        }}
      />
    </View>
  );
}

const st = StyleSheet.create({
  gate: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingBottom: 40 },
  lockWell: { width: 76, height: 76, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 14, marginTop: 6 },
  dotWell: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  status: { textAlign: 'center', marginTop: 12, minHeight: 17 },
  pad: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center',
    rowGap: 14, columnGap: 22, marginTop: 14, paddingBottom: 6,
  },
  key: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  keySpace: { width: 64, height: 64 },
  keyText: { color: C.text, fontFamily: F.med, fontSize: 24, fontVariant: ['tabular-nums'] },
});
