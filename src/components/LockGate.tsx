import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { allowScreenCaptureAsync, preventScreenCaptureAsync } from 'expo-screen-capture';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Easing, FadeIn, ZoomIn, ZoomOut, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming,
} from 'react-native-reanimated';
import { C, F, MIN, NEU, T } from '../theme';
import { PillButton, ScreenBG, Sheet, useTheme } from './UI';
import { Bouncy, useAnimLevel } from './Motion';
import { useStore } from '../store';
import { tap, tick } from '../haptics';
import {
  PASS_MAX, PASS_MIN, deviceAuthAvailable, hasJournalPass, journalPassCooldownMs, markJournalUnlocked, markUnlocked,
  pinCooldownMs, setJournalPass, setPin, unlockWithDevice, useJournalUnlocked, useUnlocked, verifyJournalPass, verifyPin,
} from '../lock';

const PIN_LEN = 6;
const PAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'ok', '0', 'del'];

/**
 * Carved wells and a keypad. `enter` checks a code, `set` asks for a new one twice and stores it. The app PIN is
 * six digits and submits itself; a journal passcode is four to eight, so it grows a well per digit and waits for OK.
 */
export function PinSheet({ visible, mode, kind = 'pin', onClose, onDone }: {
  visible: boolean; mode: 'enter' | 'set'; kind?: 'pin' | 'journal'; onClose: () => void; onDone: () => void;
}) {
  const theme = useTheme();
  const level = useAnimLevel();
  const journal = kind === 'journal';
  const min = journal ? PASS_MIN : PIN_LEN;
  const max = journal ? PASS_MAX : PIN_LEN;
  const tint = journal ? C.gold : C.accent;
  const cooldownMs = journal ? journalPassCooldownMs : pinCooldownMs;
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
    if (!visible || mode !== 'set' || journal) return undefined;
    let live = true;
    deviceAuthAvailable().then((ok) => { if (live) setPinOnly(!ok); });
    return () => { live = false; };
  }, [visible, mode, journal]);

  React.useEffect(() => {
    if (!visible) return;
    setDigits('');
    setFirst(null);
    setMessage('');
    setCoolS(Math.ceil(cooldownMs() / 1000));
  }, [visible]);

  React.useEffect(() => {
    if (coolS <= 0) return undefined;
    const t = setTimeout(() => setCoolS(Math.ceil(cooldownMs() / 1000)), 500);
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

  const complete = async (code: string) => {
    if (busy.current) return;
    busy.current = true;
    try {
      if (mode === 'enter') {
        const r = journal ? await verifyJournalPass(code) : await verifyPin(code);
        if (r === 'ok') onDone();
        else if (r === 'cooldown') {
          setDigits('');
          setMessage('');
          setCoolS(Math.ceil(cooldownMs() / 1000));
        } else reject(journal ? 'Wrong passcode' : 'Wrong PIN');
      } else if (first == null) {
        setFirst(code);
        setDigits('');
        setMessage('');
      } else if (first === code) {
        if (journal) await setJournalPass(code);
        else await setPin(code);
        onDone();
      } else {
        setFirst(null);
        reject(journal ? 'Those do not match' : "PINs don't match");
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
    if (k === 'ok') {
      if (digits.length >= min) { tap(); complete(digits); }
      return;
    }
    if (digits.length >= max) return;
    tap();
    const next = digits + k;
    setDigits(next);
    if (next.length === max) setTimeout(() => complete(next), 80);
  };

  const title = mode === 'enter'
    ? (journal ? 'Enter your passcode' : 'Enter PIN')
    : first == null
      ? (journal ? 'Set a passcode' : 'Set a 6-digit PIN')
      : (journal ? 'Confirm passcode' : 'Confirm PIN');
  const status = coolS > 0 ? 'Try again in ' + coolS + 's' : message;
  const wells = Math.max(min, digits.length);
  const well = theme === 'minimal'
    ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border }
    : { backgroundColor: C.inset, ...NEU.insetHairline };
  const keyFace = theme === 'minimal'
    ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: MIN.border }
    : { backgroundColor: C.card, ...NEU.raisedLow };

  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <Animated.View style={[st.dots, shakeStyle]}>
        {Array.from({ length: wells }, (_, i) => (
          <Animated.View
            key={i}
            entering={level === 'none' || i < min ? undefined : ZoomIn.duration(160)}
            exiting={level === 'none' || i < min ? undefined : ZoomOut.duration(120)}
            style={[st.dotWell, well]}
          >
            {i < digits.length ? (
              <Animated.View
                entering={level === 'none' ? undefined : ZoomIn.duration(150)}
                style={[st.dot, { backgroundColor: tint }]}
              />
            ) : null}
          </Animated.View>
        ))}
      </Animated.View>
      {mode === 'set' && journal ? (
        <Text style={[T.caption, st.note]}>
          Four to eight digits, then OK. Only a scrambled copy is kept on this phone, so a forgotten passcode cannot be
          brought back.
        </Text>
      ) : null}
      {mode === 'set' && pinOnly ? (
        <Text style={[T.caption, st.note]}>
          This phone has no screen lock, so this PIN is the only way in. If you forget it, locked pages stay locked.
        </Text>
      ) : null}
      <Text style={[T.caption, st.status, status ? { color: coolS > 0 ? C.textFaint : C.danger } : null]}>
        {status || ' '}
      </Text>
      <View style={st.pad}>
        {PAD.map((k) => {
          if (k === 'ok' && !journal) return <View key={k} style={st.keySpace} />;
          const off = coolS > 0 || (k === 'ok' && digits.length < min);
          return (
            <Bouncy
              key={k}
              onPress={() => press(k)}
              scaleTo={0.92}
              radius={32}
              style={[st.key, keyFace, off ? { opacity: 0.45 } : null]}
            >
              {k === 'del' ? (
                <Ionicons name="backspace-outline" size={22} color={C.textDim} />
              ) : k === 'ok' ? (
                <Ionicons name="checkmark" size={24} color={tint} />
              ) : (
                <Text style={st.keyText}>{k}</Text>
              )}
            </Bouncy>
          );
        })}
      </View>
    </Sheet>
  );
}

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

/**
 * Shows `children` only while they are unlocked. While locked it renders a carved lock well instead, never the
 * content underneath, so the app switcher shows nothing. Device authentication starts on its own once each time
 * the gate is focused; after a cancel it waits for Unlock.
 */
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

/**
 * The Journal's gate. Its passcode is the only way in, never the phone's own lock: entering it turns the lock open
 * and the gate dissolves into the page. A journal locked before passcodes existed still opens the way it did, and
 * Journal settings offers to set one.
 */
export function JournalGate({ header, guard, children }: {
  header: React.ReactNode; guard: boolean; children: React.ReactNode;
}) {
  const theme = useTheme();
  const level = useAnimLevel();
  const locked = useStore((s) => s.settings.journalLocked);
  const unlocked = useJournalUnlocked();
  const open = !locked || unlocked;
  const [shown, setShown] = React.useState(open);
  const [sheet, setSheet] = React.useState(false);
  const [pass, setPass] = React.useState<boolean | null>(null);
  const asked = React.useRef(false);
  const fromGate = React.useRef(false);
  const fade = useSharedValue(1);
  const turn = useSharedValue(0);
  const gateStyle = useAnimatedStyle(() => ({ opacity: fade.value }));
  const lockStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + 0.08 * turn.value }] }));

  React.useEffect(() => {
    if (!locked) return undefined;
    let live = true;
    hasJournalPass().then((p) => { if (live) setPass(p); });
    return () => { live = false; };
  }, [locked, shown]);

  const ask = React.useCallback(async () => {
    if (pass === false) {
      // locked before passcodes: the phone's own lock still opens it
      const r = await unlockWithDevice('Unlock the journal');
      if (r === 'needs-pin') setSheet(true);
      else if (r === 'unlocked') markJournalUnlocked();
      return;
    }
    setSheet(true);
  }, [pass]);

  useFocusEffect(React.useCallback(() => {
    if (open || pass === null || asked.current) return;
    asked.current = true;
    ask();
  }, [open, pass, ask]));

  React.useEffect(() => {
    if (open === shown) return undefined;
    if (!open) {
      fromGate.current = false;
      fade.value = 1;
      turn.value = 0;
      setShown(false);
      asked.current = false;
      return undefined;
    }
    fromGate.current = true;
    if (level === 'none') {
      setShown(true);
      return undefined;
    }
    // the lock turns, then the gate dissolves and the page arrives in its place
    turn.value = withSequence(withTiming(1, { duration: 170 }), withTiming(0, { duration: 240 }));
    fade.value = withDelay(180, withTiming(0, { duration: 240, easing: Easing.out(Easing.quad) }));
    const t = setTimeout(() => setShown(true), 430);
    return () => clearTimeout(t);
  }, [open, shown, level]);

  if (shown) {
    const page = fromGate.current && level !== 'none'
      ? <Animated.View entering={FadeIn.duration(320)} style={st.page}>{children}</Animated.View>
      : <View style={st.page}>{children}</View>;
    return locked ? <Shielded>{page}</Shielded> : page;
  }

  return (
    <ScreenBG guard={guard}>
      {header}
      <Animated.View style={[st.gate, gateStyle]}>
        <Animated.View
          style={[
            st.lockWell, lockStyle,
            theme === 'minimal'
              ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border }
              : { backgroundColor: C.inset, ...NEU.insetLow },
          ]}
        >
          <Ionicons name={open ? 'lock-open-outline' : 'lock-closed-outline'} size={28} color={C.gold} />
        </Animated.View>
        <Text style={[T.title, { marginTop: 18 }]}>Journal is locked</Text>
        <Text style={[T.caption, { marginTop: 6, textAlign: 'center' }]}>
          {pass === false ? 'Unlock with fingerprint or PIN' : 'Your passcode opens it'}
        </Text>
        <PillButton
          label="Unlock" icon="lock-open-outline" color={C.gold} onPress={ask}
          style={{ marginTop: 22, minWidth: 180 }}
        />
      </Animated.View>
      <PinSheet
        visible={sheet}
        mode="enter"
        kind={pass === false ? 'pin' : 'journal'}
        onClose={() => setSheet(false)}
        onDone={() => {
          setSheet(false);
          if (pass === false) markUnlocked();
          markJournalUnlocked();
        }}
      />
    </ScreenBG>
  );
}

const st = StyleSheet.create({
  page: { flex: 1 },
  gate: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingBottom: 40 },
  lockWell: { width: 76, height: 76, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 14, marginTop: 6 },
  dotWell: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  note: { textAlign: 'center', marginTop: 12 },
  status: { textAlign: 'center', marginTop: 12, minHeight: 17 },
  pad: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center',
    rowGap: 14, columnGap: 22, marginTop: 14, paddingBottom: 6,
  },
  key: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  keySpace: { width: 64, height: 64 },
  keyText: { color: C.text, fontFamily: F.med, fontSize: 24, fontVariant: ['tabular-nums'] },
});
