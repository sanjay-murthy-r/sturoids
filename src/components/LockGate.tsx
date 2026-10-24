import React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { allowScreenCaptureAsync, preventScreenCaptureAsync } from 'expo-screen-capture';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Easing, FadeIn, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming,
} from 'react-native-reanimated';
import { AnimLevel, C, CHROME_FONT_MAX, F, MIN, NEU, S, T, TRACK, oneLine } from '../theme';
import { Field, PillButton, ScreenBG, Sheet, useTheme } from './UI';
import { Bouncy, EASE_OUT, FadeSwap, useAnimLevel } from './Motion';
import { useStore } from '../store';
import { useProfiles } from '../profiles';
import { tap, tick } from '../haptics';
import {
  ALL_NOTES, LEGACY_MAX, LEGACY_MIN, PIN_LEN, deviceAuthAvailable, markOpen, noteScope, pinCooldownMs, pinStatus,
  profileHasPin, setPin, unlockWithScreenLock, useOpen, verifyPin, verifyProfilePin,
} from '../lock';
import type { LockScope } from '../lock';

/** a phone keypad: three columns, the key left of 0 is the screen lock (or OK for an older, longer code) */
const ROWS = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['side', '0', 'del']] as const;
const KEY_GAP_X = 26;
const KEY_GAP_Y = 14;
const KEY_MAX = 72;
/** what TalkBack says for the keys that show an icon; a digit says itself */
const KEY_LABEL: Record<string, string> = { del: 'Delete digit', ok: 'Done', bio: 'Use screen lock' };

/**
 * The cloud module, loaded only when it is needed: the keypad is on the way into the journal and Notes, and the cloud
 * (with its network client) is kept off every screen's first load.
 */
const cloudModule = () => require('../cloud') as typeof import('../cloud');
/** how long the account's password check may take before the keypad says to connect to the internet */
const CHECK_WAIT_MS = 20_000;

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
 *
 * Under the keys, while a PIN is asked for, a quiet "Forgot PIN": signed in to the cloud, the account's password lets
 * the owner choose a new PIN (the locks stay on, and backing out before the new PIN is confirmed changes nothing);
 * signed out, it says what the way out is.
 */
export function PinPad({ mode, tint, onDone, onScreenLock, active = true, other }: {
  mode: 'enter' | 'set'; tint: string; onDone: () => void; onScreenLock?: () => void; active?: boolean;
  /** another profile whose PIN is asked for (before it is deleted from here): no forgot link, no screen lock */
  other?: { id: string; name: string };
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
  // a forgotten PIN being replaced: the account's password checked out and a new PIN is being chosen. `resetFrom` is
  // the step to go back to if the owner backs out
  const [resetting, setResetting] = React.useState(false);
  const resetFrom = React.useRef<Stage>('enter');
  const [forgot, setForgot] = React.useState<{ email: string } | null>(null);
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
    setResetting(false);
    setForgot(null);
    setStage(null);
    (other ? profileHasPin(other.id).then((has): 'set' | 'none' => (has ? 'set' : 'none')) : pinStatus()).then((st) => {
      if (!live) return;
      // another profile with no PIN has nothing to check
      if (other) {
        if (st === 'none') onDone();
        else setStage('enter');
        return;
      }
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
        const r = other ? await verifyProfilePin(other.id, code) : await verifyPin(code);
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
        setResetting(false);
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

  // a wait after wrong PINs holds only the steps that check one; choosing a new PIN after the account's password is not
  // held by it (the new PIN ends the wait)
  const checking = !other && (stage === 'enter' || stage === 'legacy');
  const waitS = checking ? coolS : 0;

  const forgotPin = () => {
    tick();
    const c = cloudModule().useCloud.getState();
    // before the cloud has looked at its saved session, the account it last had stands in; the password check says
    // whether this phone is still signed in to it
    if (c.email && (c.status !== 'signed-out' || !c.ready)) {
      setForgot({ email: c.email });
      return;
    }
    Alert.alert(
      'Forgot your PIN?',
      // the button is named for the profile when the phone holds several (CloudCard's DeleteSection)
      'Only a cloud account can reset the PIN. Without one, the way out is Settings, Delete, '
        + (useProfiles.getState().list.length > 1 ? 'Delete everything in this profile.' : 'Delete everything on this phone.'),
    );
  };
  // the password checked out and its sheet has gone: the new PIN is chosen as a first one would be
  const startReset = () => {
    if (stage) resetFrom.current = stage;
    setResetting(true);
    setDigits('');
    setFirst('');
    setMessage('');
    setStage('choose');
  };
  const cancelReset = () => {
    tick();
    setResetting(false);
    setDigits('');
    setFirst('');
    setMessage('');
    setCoolS(Math.ceil(pinCooldownMs() / 1000));
    setStage(resetFrom.current);
  };

  const len = stage === 'legacy' ? LEGACY_MAX : PIN_LEN;
  const press = (k: string) => {
    if (waitS > 0 || busy.current || !stage) return;
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

  const screenKey = !other && !!onScreenLock && mode === 'enter' && stage === 'enter';
  const prompt = !stage ? ' '
    : stage === 'enter' ? (other ? 'Enter ' + (other.name || 'that profile') + "'s PIN" : mode === 'set' ? 'Enter your current PIN' : 'Enter your PIN')
      : stage === 'legacy' ? 'Enter your old PIN or passcode'
        : stage === 'choose' ? (fresh ? 'Choose a 4-digit PIN' : 'Choose a new 4-digit PIN')
          : 'Enter it again';
  const hint = stage === 'legacy' ? 'PINs are now four digits. After this, you choose a new one.'
    : resetting ? 'Your password checked out. Choose a new PIN and enter it twice.'
      : stage === 'choose' && fresh ? 'It opens locked notes, and the journal and Notes when they are locked. Only this phone keeps it. If it is forgotten, a cloud account can reset it.'
        : screenKey ? 'Or use your screen lock.'
          : '';
  // the waits grow to an hour after many wrong PINs, so a long one counts in minutes
  const status = waitS > 0 ? 'Try again in ' + (waitS < 60 ? waitS + ' s' : Math.ceil(waitS / 60) + ' min') : message;
  // while the PIN's state is being read, or a wait is on, the keys rest dimmed; they ease back up when they can be used
  const resting = waitS > 0 || !stage;
  // the quiet link under the keys: Forgot PIN while one is asked for, Cancel while a forgotten one is being replaced
  const link = resetting ? 'Cancel' : checking ? 'Forgot PIN' : '';
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
      {/* TalkBack reads the wells as one count, not as a row of empty shapes */}
      <Animated.View
        style={[st.dots, shakeStyle]}
        accessible
        accessibilityLabel={stage === 'legacy'
          ? digits.length + (digits.length === 1 ? ' digit entered' : ' digits entered')
          : digits.length + ' of ' + PIN_LEN + ' digits entered'}
      >
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
      <FadeSwap swapKey={waitS > 0 ? 'wait' : message}>
        <Text
          accessibilityLiveRegion="polite"
          style={[T.caption, st.status, waitS > 0 && st.counting, status ? { color: waitS > 0 ? C.textFaint : C.danger } : null]}
        >
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
                  accessibilityRole="button"
                  accessibilityLabel={KEY_LABEL[kind] ?? kind}
                  accessibilityState={resting || off ? { disabled: true } : undefined}
                >
                  {kind === 'del' ? (
                    <Ionicons name="backspace-outline" size={24} color={C.textDim} />
                  ) : kind === 'ok' ? (
                    <Ionicons name="checkmark" size={26} color={tint} />
                  ) : kind === 'bio' ? (
                    <Ionicons name="finger-print-outline" size={26} color={tint} />
                  ) : (
                    // fixed chrome: a key is a fixed circle, so its digit grows with the phone's font size only up to 1.3
                    <Text style={st.keyText} maxFontSizeMultiplier={CHROME_FONT_MAX}>{kind}</Text>
                  )}
                </Bouncy>
              );
            })}
          </View>
        ))}
      </Animated.View>
      {/* the slot keeps its height whether or not a link is in it, so the keys never move */}
      <View style={st.linkSlot}>
        {link ? (
          <FadeSwap swapKey={link}>
            <Pressable
              onPress={resetting ? cancelReset : forgotPin} hitSlop={10}
              accessibilityRole="button" accessibilityLabel={link}
              style={({ pressed }) => [st.link, pressed && { opacity: 0.55 }]}
            >
              <Text style={st.linkText} maxFontSizeMultiplier={CHROME_FONT_MAX}>{link}</Text>
            </Pressable>
          </FadeSwap>
        ) : null}
      </View>
      <ForgotSheet
        email={forgot?.email ?? ''} visible={!!forgot} onClose={() => setForgot(null)} onVerified={startReset}
      />
    </View>
  );
}

/**
 * Asks for the cloud account's password before a forgotten PIN can be replaced. It checks it with the cloud, which
 * keeps the phone signed in; once it checks out, the sheet closes and the keypad moves on to choosing the new PIN.
 */
function ForgotSheet({ visible, email, onClose, onVerified }: {
  visible: boolean; email: string; onClose: () => void; onVerified: () => void;
}) {
  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const field = React.useRef<TextInput>(null);
  const passed = React.useRef(false);
  const running = React.useRef(false);
  React.useEffect(() => {
    if (!visible) return;
    passed.current = false;
    setPassword('');
    setError('');
    setBusy(false);
  }, [visible]);

  const check = async () => {
    if (running.current || !password) return;
    running.current = true;
    setBusy(true);
    setError('');
    let result: 'ok' | 'wrong' | 'signed-out' | 'offline';
    // a check that hangs on a poor connection is taken for no connection, so the sheet never sits on "Checking"
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      result = await Promise.race([
        cloudModule().verifyAccountPassword(password),
        new Promise<'offline'>((resolve) => { timer = setTimeout(() => resolve('offline'), CHECK_WAIT_MS); }),
      ]);
    } catch {
      result = 'offline';
    } finally {
      clearTimeout(timer);
    }
    running.current = false;
    setBusy(false);
    if (result === 'ok') {
      passed.current = true;
      onClose();
      return;
    }
    setError(result === 'wrong' ? "That password didn't match"
      : result === 'offline' ? 'Connect to the internet to check your password'
        : 'This phone is no longer signed in to your account. Sign in again under Settings, Account, then try again.');
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Reset your PIN"
      // the field takes the keyboard once the sheet is up, so the keyboard never rides the rise
      onRisen={() => field.current?.focus()}
      onClosed={() => {
        // the password is not kept a moment longer than the sheet
        setPassword('');
        if (passed.current) {
          passed.current = false;
          onVerified();
        }
      }}
    >
      <Text style={[T.body, st.forgotBody]}>
        {email ? 'Enter the password for ' + email + '.' : "Enter your cloud account's password."} Then choose a new PIN.
      </Text>
      <Field
        ref={field}
        label="Account password"
        value={password}
        onChangeText={(t) => { setPassword(t); if (error) setError(''); }}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="password"
        textContentType="password"
        returnKeyType="done"
        onSubmitEditing={check}
      />
      <Text accessibilityLiveRegion="polite" style={[T.caption, st.forgotError]}>{error || ' '}</Text>
      <PillButton label={busy ? 'Checking' : 'Check password'} onPress={check} />
    </Sheet>
  );
}

/** The keypad in a sheet: choosing a PIN, or confirming the owner before a lock is weakened. */
export function PinSheet({ visible, mode, tint = C.accent, onClose, onDone, onScreenLock, other }: {
  visible: boolean; mode: 'enter' | 'set'; tint?: string; onClose: () => void; onDone: () => void;
  onScreenLock?: () => void; other?: { id: string; name: string };
}) {
  return (
    <Sheet visible={visible} onClose={onClose}>
      <PinPad mode={mode} tint={tint} active={visible} onDone={onDone} onScreenLock={onScreenLock} other={other} />
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
  // a wait counts down each second: the text face's tabular figures keep it from shifting
  counting: { fontFamily: F.reg, fontVariant: ['tabular-nums'] },
  keypad: { marginTop: 14, gap: KEY_GAP_Y, paddingBottom: 6 },
  keyRow: { flexDirection: 'row', justifyContent: 'center', gap: KEY_GAP_X },
  key: { alignItems: 'center', justifyContent: 'center' },
  // a key's figure centres truly in its round key: no font padding, the line set to the size
  keyText: { ...oneLine(26), color: C.text, fontFamily: F.med, letterSpacing: TRACK.large, fontVariant: ['tabular-nums'] },
  linkSlot: { minHeight: 38, marginTop: 6, alignItems: 'center', justifyContent: 'center' },
  link: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  linkText: { color: C.textDim, fontFamily: F.med, fontSize: 13, letterSpacing: TRACK.small },
  forgotBody: { color: C.textDim, marginBottom: 16 },
  forgotError: { color: C.danger, marginTop: -6, marginBottom: 12, minHeight: 17 },
});
