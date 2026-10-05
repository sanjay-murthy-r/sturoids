import React from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { allowScreenCaptureAsync, preventScreenCaptureAsync } from 'expo-screen-capture';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Easing, FadeIn, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming,
} from 'react-native-reanimated';
import { AnimLevel, C, F, MIN, NEU, S, T, TRACK } from '../theme';
import { ScreenBG, Sheet, useTheme } from './UI';
import { Bouncy, EASE_OUT, FadeSwap, useAnimLevel } from './Motion';
import { useStore } from '../store';
import { tap, tick } from '../haptics';
import {
  ALL_NOTES, LEGACY_MAX, LEGACY_MIN, PIN_LEN, deviceAuthAvailable, markOpen, noteScope, pinCooldownMs, pinStatus,
  setPin, unlockWithScreenLock, useOpen, verifyPin,
} from '../lock';
import type { LockScope } from '../lock';

/** a phone keypad: three columns, the key left of 0 is the screen lock (or OK for an older, longer code) */
const ROWS = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['side', '0', 'del']] as const;
const KEY_GAP_X = 26;
const KEY_GAP_Y = 14;
const KEY_MAX = 72;

type Stage = 'enter' | 'legacy' | 'choose' | 'confirm';

/** A digit's dot fills its well from the centre, quickly, and empties the same way a little quicker. */
const dotIn = () => {
  'worklet';
  const ease = { duration: 150, easing: Easing.out(Easing.cubic) };
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.4 }] },
    animations: { opacity: withTiming(1, ease), transform: [{ scale: withTiming(1, ease) }] },
  };
};
const dotOut = () => {
  'worklet';
  const ease = { duration: 110, easing: Easing.in(Easing.quad) };
  return {
    initialValues: { opacity: 1, transform: [{ scale: 1 }] },
    animations: { opacity: withTiming(0, ease), transform: [{ scale: withTiming(0.5, ease) }] },
  };
};
/** the page a gate opens onto comes up as the gate dissolves: shorter with only some motion */
const pageIn = (level: AnimLevel) => FadeIn.duration(level === 'full' ? 320 : 200).easing(EASE_OUT);

/**
 * The PIN keypad: the prompt, four wells, a status line, and a phone keypad in three columns. `enter` checks the PIN;
 * `set` chooses one, asking for the current PIN first when there is one. A code from before the PIN was four digits
 * is asked for once, then a new PIN is chosen in its place. `onScreenLock` puts the phone's own lock on the key left
 * of 0. The keypad starts over each time it becomes `active`.
 */
export function PinPad({ mode, tint, onDone, onScreenLock, active = true }: {
  mode: 'enter' | 'set'; tint: string; onDone: () => void; onScreenLock?: () => void; active?: boolean;
}) {
  const theme = useTheme();
  const level = useAnimLevel();
  const { width } = useWindowDimensions();
  const [stage, setStage] = React.useState<Stage | null>(null);
  const [fresh, setFresh] = React.useState(false);
  const [digits, setDigits] = React.useState('');
  const [first, setFirst] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [coolS, setCoolS] = React.useState(0);
  const busy = React.useRef(false);
  const shake = useSharedValue(0);
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));

  React.useEffect(() => {
    if (!active) return undefined;
    let live = true;
    setDigits('');
    setFirst('');
    setMessage('');
    setCoolS(Math.ceil(pinCooldownMs() / 1000));
    setStage(null);
    pinStatus().then((st) => {
      if (!live) return;
      setFresh(st === 'none');
      // with no PIN on this phone (a restored backup, say) there is nothing to check: a PIN is chosen instead
      setStage(st === 'legacy' ? 'legacy' : st === 'none' ? 'choose' : 'enter');
    });
    return () => { live = false; };
  }, [active, mode]);

  React.useEffect(() => {
    if (coolS <= 0) return undefined;
    const t = setTimeout(() => setCoolS(Math.ceil(pinCooldownMs() / 1000)), 500);
    return () => clearTimeout(t);
  }, [coolS]);

  const reject = (text: string) => {
    setMessage(text);
    setDigits('');
    if (level !== 'none') {
      const q = Easing.inOut(Easing.quad);
      shake.value = withSequence(
        withTiming(-8, { duration: 50, easing: q }), withTiming(8, { duration: 60, easing: q }),
        withTiming(-5, { duration: 55, easing: q }), withTiming(0, { duration: 70, easing: EASE_OUT }),
      );
    }
  };

  const complete = async (code: string) => {
    if (busy.current || !stage) return;
    busy.current = true;
    try {
      if (stage === 'enter' || stage === 'legacy') {
        const r = await verifyPin(code);
        if (r === 'cooldown') {
          setDigits('');
          setMessage('');
          setCoolS(Math.ceil(pinCooldownMs() / 1000));
        } else if (r === 'wrong') {
          reject(stage === 'legacy' ? 'That is not it' : 'Wrong PIN');
        } else if (stage === 'legacy' || mode === 'set') {
          setDigits('');
          setMessage('');
          setStage('choose');
        } else {
          onDone();
        }
      } else if (stage === 'choose') {
        setFirst(code);
        setDigits('');
        setMessage('');
        setStage('confirm');
      } else if (code === first) {
        await setPin(code);
        onDone();
      } else {
        setFirst('');
        setStage('choose');
        reject('Those did not match. Choose it again.');
      }
    } finally {
      busy.current = false;
    }
  };

  const len = stage === 'legacy' ? LEGACY_MAX : PIN_LEN;
  const press = (k: string) => {
    if (coolS > 0 || busy.current || !stage) return;
    if (k === 'del') {
      tick();
      setDigits((d) => d.slice(0, -1));
      return;
    }
    if (k === 'ok') {
      if (digits.length >= LEGACY_MIN) { tap(); complete(digits); }
      return;
    }
    if (k === 'bio') {
      tick();
      onScreenLock?.();
      return;
    }
    if (digits.length >= len) return;
    tap();
    const next = digits + k;
    setDigits(next);
    if (next.length === len) setTimeout(() => complete(next), 90);
  };

  const screenKey = !!onScreenLock && mode === 'enter' && stage === 'enter';
  const prompt = !stage ? ' '
    : stage === 'enter' ? (mode === 'set' ? 'Enter your current PIN' : 'Enter your PIN')
      : stage === 'legacy' ? 'Enter your old PIN or passcode'
        : stage === 'choose' ? (fresh ? 'Choose a 4-digit PIN' : 'Choose a new 4-digit PIN')
          : 'Enter it again';
  const hint = stage === 'legacy' ? 'PINs are now four digits. After this, you choose a new one.'
    : stage === 'choose' && fresh ? 'It opens locked notes, and the journal and Notes when they are locked. Only this phone keeps it, so it cannot be recovered if forgotten.'
      : screenKey ? 'Or use your screen lock.'
        : '';
  const status = coolS > 0 ? 'Try again in ' + coolS + ' s' : message;
  // while the PIN's state is being read, or a wait is on, the keys rest dimmed; they ease back up when they can be used
  const resting = coolS > 0 || !stage;
  const keysOn = useSharedValue(resting ? 0.45 : 1);
  React.useEffect(() => {
    keysOn.value = level === 'none' ? (resting ? 0.45 : 1) : withTiming(resting ? 0.45 : 1, { duration: 220, easing: EASE_OUT });
  }, [resting, level]);
  const keysStyle = useAnimatedStyle(() => ({ opacity: keysOn.value }));
  const wells = stage === 'legacy' ? Math.max(LEGACY_MIN, digits.length) : PIN_LEN;
  const key = Math.min(KEY_MAX, Math.floor((width - 2 * S.pad - 2 * KEY_GAP_X - 24) / 3));
  const well = theme === 'minimal'
    ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border }
    : { backgroundColor: C.inset, ...NEU.insetHairline };
  const keyFace = theme === 'minimal'
    ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: MIN.border }
    : { backgroundColor: C.card, ...NEU.raisedLow };

  return (
    <View style={st.pad}>
      {/* a new step (choose, then confirm) changes its words in place: they dip out and come back */}
      <FadeSwap swapKey={prompt}>
        <Text style={st.prompt}>{prompt}</Text>
      </FadeSwap>
      <FadeSwap swapKey={hint}>
        <Text style={[T.caption, st.hint]}>{hint}</Text>
      </FadeSwap>
      <Animated.View style={[st.dots, shakeStyle]}>
        {Array.from({ length: wells }, (_, i) => (
          <Animated.View
            key={i}
            entering={level === 'none' || i < LEGACY_MIN ? undefined : dotIn}
            exiting={level === 'none' || i < LEGACY_MIN ? undefined : dotOut}
            style={[st.dotWell, well]}
          >
            {i < digits.length ? (
              <Animated.View
                entering={level === 'none' ? undefined : dotIn}
                exiting={level === 'none' ? undefined : dotOut}
                style={[st.dot, { backgroundColor: tint }]}
              />
            ) : null}
          </Animated.View>
        ))}
      </Animated.View>
      {/* a wait counts down in place; a new message dips in */}
      <FadeSwap swapKey={coolS > 0 ? 'wait' : message}>
        <Text style={[T.caption, st.status, status ? { color: coolS > 0 ? C.textFaint : C.danger } : null]}>
          {status || ' '}
        </Text>
      </FadeSwap>
      <Animated.View style={[st.keypad, keysStyle]}>
        {ROWS.map((row, r) => (
          <View key={r} style={st.keyRow}>
            {row.map((k) => {
              const kind = k === 'side' ? (stage === 'legacy' ? 'ok' : screenKey ? 'bio' : '') : k;
              if (!kind) return <View key={k} style={{ width: key, height: key }} />;
              // the resting pad already dims every key; the OK key only adds its own dim when the pad is live
              const off = !resting && kind === 'ok' && digits.length < LEGACY_MIN;
              return (
                <Bouncy
                  key={k}
                  onPress={() => press(kind)}
                  scaleTo={0.92}
                  radius={key / 2}
                  style={[st.key, { width: key, height: key, borderRadius: key / 2 }, keyFace, off ? { opacity: 0.45 } : null]}
                >
                  {kind === 'del' ? (
                    <Ionicons name="backspace-outline" size={24} color={C.textDim} />
                  ) : kind === 'ok' ? (
                    <Ionicons name="checkmark" size={26} color={tint} />
                  ) : kind === 'bio' ? (
                    <Ionicons name="finger-print-outline" size={26} color={tint} />
                  ) : (
                    <Text style={st.keyText}>{kind}</Text>
                  )}
                </Bouncy>
              );
            })}
          </View>
        ))}
      </Animated.View>
    </View>
  );
}

/** The keypad in a sheet: choosing a PIN, or confirming the owner before a lock is weakened. */
export function PinSheet({ visible, mode, tint = C.accent, onClose, onDone, onScreenLock }: {
  visible: boolean; mode: 'enter' | 'set'; tint?: string; onClose: () => void; onDone: () => void;
  onScreenLock?: () => void;
}) {
  return (
    <Sheet visible={visible} onClose={onClose}>
      <PinPad mode={mode} tint={tint} active={visible} onDone={onDone} onScreenLock={onScreenLock} />
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
 * A lock screen in place of a page: the lock, what is locked, and the keypad right there, never the content
 * underneath, so the app switcher shows nothing. When the owner allowed it, the phone's screen lock is offered
 * once each time the page comes into view. Unlocking turns the lock open and the gate dissolves into the page.
 */
function LockPage({ scope, alsoOpenedBy, locked, screenLock, title, reason, tint, header, guard, children }: {
  scope: LockScope; alsoOpenedBy?: LockScope; locked: boolean; screenLock: boolean; title: string; reason: string;
  tint: string; header: React.ReactNode; guard: boolean; children: React.ReactNode;
}) {
  const theme = useTheme();
  const level = useAnimLevel();
  const sessionOpen = useOpen(scope);
  const openedAbove = useOpen(alsoOpenedBy ?? scope);
  const open = !locked || sessionOpen || openedAbove;
  const [shown, setShown] = React.useState(open);
  const [deviceOk, setDeviceOk] = React.useState(false);
  const asked = React.useRef(false);
  const fromGate = React.useRef(false);
  const fade = useSharedValue(1);
  const turn = useSharedValue(0);
  const gateStyle = useAnimatedStyle(() => ({ opacity: fade.value }));
  const lockStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + 0.08 * turn.value }] }));

  React.useEffect(() => {
    if (!screenLock) { setDeviceOk(false); return undefined; }
    let live = true;
    deviceAuthAvailable().then((ok) => { if (live) setDeviceOk(ok); });
    return () => { live = false; };
  }, [screenLock]);

  const tryScreenLock = React.useCallback(async () => {
    if (await unlockWithScreenLock(reason)) markOpen(scope);
  }, [scope, reason]);

  useFocusEffect(React.useCallback(() => {
    if (!open && deviceOk && !asked.current) {
      asked.current = true;
      tryScreenLock();
    }
    // leaving the page re-arms it, so it is offered again next time the page comes into view, as intended,
    // instead of only once for as long as this screen happens to stay mounted (tabs never unmount)
    return () => { asked.current = false; };
  }, [open, deviceOk, tryScreenLock]));

  React.useEffect(() => {
    if (open === shown) return undefined;
    if (!open) {
      fromGate.current = false;
      fade.value = 1;
      turn.value = 0;
      asked.current = false;
      setShown(false);
      return undefined;
    }
    fromGate.current = true;
    if (level === 'none') {
      setShown(true);
      return undefined;
    }
    // the lock turns, then the gate dissolves and the page arrives in its place
    turn.value = withSequence(
      withTiming(1, { duration: 170, easing: EASE_OUT }), withTiming(0, { duration: 240, easing: Easing.inOut(Easing.quad) }),
    );
    fade.value = withDelay(180, withTiming(0, { duration: 240, easing: EASE_OUT }));
    const t = setTimeout(() => setShown(true), 430);
    return () => clearTimeout(t);
  }, [open, shown, level]);

  if (shown) {
    const page = fromGate.current && level !== 'none'
      ? <Animated.View entering={pageIn(level)} style={st.page}>{children}</Animated.View>
      : <View style={st.page}>{children}</View>;
    return locked ? <Shielded>{page}</Shielded> : page;
  }

  // a PIN given for the Notes tool also opens its locked notes: the same owner has just proved it
  const unlockWithPin = () => {
    markOpen(scope);
    if (scope === 'notes') markOpen(ALL_NOTES);
  };

  return (
    <ScreenBG guard={guard}>
      {header}
      <Animated.View style={[st.page, gateStyle]}>
        <ScrollView contentContainerStyle={st.lockScroll} bounces={false} showsVerticalScrollIndicator={false}>
          <Animated.View
            style={[
              st.lockWell, lockStyle,
              theme === 'minimal'
                ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border }
                : { backgroundColor: C.inset, ...NEU.insetLow },
            ]}
          >
            <Ionicons name={open ? 'lock-open-outline' : 'lock-closed-outline'} size={24} color={tint} />
          </Animated.View>
          <Text style={st.lockTitle}>{title}</Text>
          <PinPad
            mode="enter" tint={tint} active={!open} onDone={unlockWithPin}
            onScreenLock={deviceOk ? tryScreenLock : undefined}
          />
        </ScrollView>
      </Animated.View>
    </ScreenBG>
  );
}

/** The journal or the whole Notes tool, behind the app PIN and, when the owner allowed it, the screen lock. */
export function ToolGate({ tool, header, guard, children }: {
  tool: 'journal' | 'notes'; header: React.ReactNode; guard: boolean; children: React.ReactNode;
}) {
  const locked = useStore((s) => (tool === 'journal' ? s.settings.journalLocked : s.settings.notesLocked) === true);
  const screenLock = useStore((s) => (tool === 'journal' ? s.settings.journalScreenLock : s.settings.notesScreenLock) === true);
  return (
    <LockPage
      scope={tool} locked={locked} screenLock={screenLock}
      title={tool === 'journal' ? 'Journal is locked' : 'Notes are locked'}
      reason={tool === 'journal' ? 'Open the journal' : 'Open Notes'}
      tint={tool === 'journal' ? C.gold : C.green}
      header={header} guard={guard}
    >
      {children}
    </LockPage>
  );
}

/**
 * A single locked note: the app PIN only, never the screen lock. Each note opens on its own, so giving the PIN for
 * one leaves the others locked; only the PIN given at the Notes tool's lock opens them all.
 */
export function NoteGate({ id, locked, header, children }: {
  id: string; locked: boolean; header: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <LockPage
      scope={noteScope(id)} alsoOpenedBy={ALL_NOTES} locked={locked} screenLock={false} title="This note is locked"
      reason="Open the note" tint={C.green} header={header} guard={false}
    >
      {children}
    </LockPage>
  );
}

const st = StyleSheet.create({
  page: { flex: 1 },
  lockScroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: S.pad, paddingBottom: 28, paddingTop: 12 },
  lockWell: { width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  lockTitle: { ...T.title, marginTop: 14, marginBottom: 18, textAlign: 'center' },
  pad: { alignItems: 'center', alignSelf: 'stretch' },
  prompt: { color: C.text, fontFamily: F.semi, fontSize: 17, letterSpacing: TRACK.title, textAlign: 'center' },
  hint: { textAlign: 'center', marginTop: 6, minHeight: 36, maxWidth: 300 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 18, marginTop: 10 },
  dotWell: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  status: { textAlign: 'center', marginTop: 12, minHeight: 17 },
  keypad: { marginTop: 14, gap: KEY_GAP_Y, paddingBottom: 6 },
  keyRow: { flexDirection: 'row', justifyContent: 'center', gap: KEY_GAP_X },
  key: { alignItems: 'center', justifyContent: 'center' },
  keyText: { color: C.text, fontFamily: F.med, fontSize: 26, letterSpacing: TRACK.large, fontVariant: ['tabular-nums'] },
});
