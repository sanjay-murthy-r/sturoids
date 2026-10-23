import React from 'react';
import { View, Text, StyleSheet, Alert, Pressable, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C, F, T, TRACK } from '../theme';
import { useStore, exportSnapshot, hasAnyUserData } from '../store';
import {
  QUOTA_BYTES, changePassword, deleteAccount, deleteCloudCopy, initCloud, keepThisPhone, mobileDataCost, resetPasswordWithCode,
  restoreFromCloud, sendResetCode, setAuto, signIn, signOut, signUp, syncNow, useCloud, describe, isoTime,
} from '../cloud';
import { eraseThisPhone } from '../wipe';
import { pinStatus } from '../lock';
import { fmtClockTime } from '../utils';
import { Card, Field, Hairline, InfoDot, PillButton, Row, SectionTitle, Sheet, Toggle, useTheme } from './UI';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { Appear, FadeSwap, useLoop } from './Motion';
import { useSwapIn } from './Swap';
import { SegmentedControl } from './SegmentedControl';
import { PinSheet } from './LockGate';
import { toast } from './Toast';
import { tap } from '../haptics';

/** The day of a moment, as "3 Oct". */
export function dayOf(at: number): string {
  return new Date(at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** "just now", "12 min ago", "3 h ago", or the day and the time, on the clock the user chose. */
export function ago(at: number, hour24: boolean, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 6 * 3600) return Math.floor(s / 3600) + ' h ago';
  const d = new Date(at);
  return dayOf(at) + ', ' + fmtClockTime(d.getHours() * 60 + d.getMinutes(), hour24);
}

const mb = (bytes: number) => (bytes < 1024 * 1024 ? 'under 1' : String(Math.round(bytes / (1024 * 1024))));

/** ", with 14 attachments", or nothing for a copy that has none. */
const withFiles = (n: number) => (n > 0 ? ', with ' + n + (n === 1 ? ' attachment' : ' attachments') : '');

const looksLikeEmail = (v: string) => /^\S+@\S+\.\S+$/.test(v.trim());

/** how long a reset step may wait for the cloud before it is taken for no connection, so a button never hangs */
const RESET_WAIT_MS = 20 * 1000;

/** The cloud's answer, or 'offline' once the wait is over. */
function inTime<R extends string>(work: Promise<R>): Promise<R | 'offline'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work.catch(() => 'offline' as const),
    new Promise<'offline'>((resolve) => { timer = setTimeout(() => resolve('offline'), RESET_WAIT_MS); }),
  ]).finally(() => clearTimeout(timer));
}

/** said when a reset step could not reach the cloud */
const RESET_OFFLINE = "You're offline, or the cloud did not answer. Connect to the internet, then try again.";

/**
 * Anything locked (the journal, the Notes tool, a note) with a PIN set: then the PIN guards what could reveal or
 * replace it (an export, a restore, signing in, erasing).
 */
export async function locksNeedPin() {
  const s = useStore.getState();
  const anyLock = s.settings.journalLocked || s.settings.notesLocked || s.notes.some((n) => n.locked);
  return anyLock && (await pinStatus()) !== 'none';
}

/**
 * Settings, Account: sign in or create an account; then the email, the backup's state, automatic backing up,
 * backing up now, bringing the cloud copy here, changing the password and signing out, and a choice whenever the
 * cloud holds a copy this phone has not seen. Deleting lives in DeleteSection, at the end of Settings.
 */
export function CloudSection({ title = 'Account' }: { title?: string | null }) {
  useTheme(); // the links and switches take the accent
  const c = useCloud();
  const hour24 = useStore((s) => s.settings.hour24);
  const wifiOnly = useStore((s) => s.settings.attachmentsWifiOnly);
  const setSetting = useStore((s) => s.setSetting);
  const [mode, setMode] = React.useState<'in' | 'up'>('in');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  // a new account's password is typed twice, since it is typed unseen and there is no way to reset it
  const [again, setAgain] = React.useState('');
  const [busy, setBusy] = React.useState<null | 'auth' | 'restore' | 'keep'>(null);
  // set the moment a tap starts something, so a second tap before the screen catches up starts nothing
  const busyRef = React.useRef(false);
  const [error, setError] = React.useState('');
  const [info, setInfo] = React.useState('');
  const [pinFor, setPinFor] = React.useState<null | 'auth' | 'restore' | 'reset'>(null);
  const [pwOpen, setPwOpen] = React.useState(false);
  const [resetOpen, setResetOpen] = React.useState(false);
  // from the tap on "Back up now" until the backup starts: the attachments waiting for Wi-Fi are being sized
  const [sizing, setSizing] = React.useState(false);
  const sizingRef = React.useRef(false);
  const [, tick] = React.useState(0);
  const passwordRef = React.useRef<TextInput>(null);
  const againRef = React.useRef<TextInput>(null);
  const signedIn = c.status !== 'signed-out' && !!c.email;
  // signing in turns the form into the account's card, and signing out turns it back: the new card comes up in its
  // place. Until the launch's look at the cloud is done, neither shows, so a signed-in student never sees the form
  const accountIn = useSwapIn(!c.ready ? 'wait' : signedIn ? 'in' : 'out');

  React.useEffect(() => { initCloud().catch(() => {}); }, []);
  // "12 min ago" moves on while Settings is open
  React.useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30 * 1000);
    return () => clearInterval(t);
  }, []);

  const submit = async (pinOk = false) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setError('');
    setInfo('');
    try {
      if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setError('That does not look like an email address.'); return; }
      if (password.length < 6) { setError('Use a password of at least 6 characters.'); return; }
      if (mode === 'up' && password !== again) { setError('The two passwords do not match.'); return; }
      // signing in sends locked pages to the cloud, so it asks for the PIN when anything is locked, like an export
      if (!pinOk && (await locksNeedPin())) { setPinFor('auth'); return; }
      setBusy('auth');
      if (mode === 'up') {
        const r = await signUp(email, password);
        if (r === 'confirm') {
          setMode('in');
          setInfo('Check your email and open the link we sent, then sign in here.');
        }
      } else {
        await signIn(email, password);
      }
      setPassword('');
      setAgain('');
    } catch (e) {
      setError(describe(e));
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  /** Bringing the cloud copy here replaces locked pages too, so the PIN is asked for first, as for erasing. */
  const restore = async (pinOk = false) => {
    if (busyRef.current) return;
    if (!pinOk && (await locksNeedPin())) { setPinFor('restore'); return; }
    busyRef.current = true;
    const release = () => { busyRef.current = false; };
    Alert.alert(
      'Bring the cloud copy here?',
      'It replaces everything on this phone with the copy in the cloud. Calculator history is cleared and a running Deep Work session ends.',
      [
        { text: 'Cancel', style: 'cancel', onPress: release },
        {
          text: 'Replace', style: 'destructive',
          onPress: async () => {
            setBusy('restore');
            try {
              const { missing } = await restoreFromCloud();
              tap();
              Alert.alert('Restored', missing
                ? 'Your data is here. ' + (missing === 1 ? 'One attachment' : missing + ' attachments') + ' could not be brought down.'
                : 'Your data is here.');
            } catch (e) {
              Alert.alert('Could not restore', describe(e));
            } finally {
              release();
              setBusy(null);
            }
          },
        },
      ],
    );
  };

  const keepHere = () => {
    if (busyRef.current) return;
    busyRef.current = true;
    const release = () => { busyRef.current = false; };
    // said plainly when keeping would empty the cloud: a phone holding none of the user's data, or one that could not
    // open it
    const body = c.reason === 'rescue'
      ? 'This phone could not open its data and started fresh. Keeping it replaces the copy in the cloud, and everything in that copy is lost.'
      : !hasAnyUserData(exportSnapshot())
        ? 'This phone holds none of your data, so keeping it would empty the copy in the cloud. Everything in that copy is lost.'
        : "It replaces the copy in the cloud with this phone's data. What only the other copy has is lost.";
    Alert.alert(
      "Keep this phone's data?",
      body,
      [
        { text: 'Cancel', style: 'cancel', onPress: release },
        {
          text: 'Keep this phone', style: 'destructive',
          onPress: async () => {
            setBusy('keep');
            try {
              await keepThisPhone();
              if (useCloud.getState().status === 'idle') { tap(); toast('Backed up'); }
            } finally {
              release();
              setBusy(null);
            }
          },
        },
      ],
    );
  };

  const backUpNow = async () => {
    if (c.status === 'syncing' || sizingRef.current) return;
    if (c.status === 'choice') { toast('Choose which copy to keep first.'); return; }
    sizingRef.current = true;
    setSizing(true);
    // on mobile data with attachments kept for Wi-Fi, a backup asked for by hand asks once whether to send them now
    const cost = await mobileDataCost().catch(() => null);
    const go = (mobileData: boolean) => {
      sizingRef.current = false;
      setSizing(false);
      syncNow(false, mobileData ? { mobileData: true } : {}).then(() => {
        const st = useCloud.getState().status;
        if (st === 'idle') toast('Backed up');
        else if (st === 'choice') toast('Choose which copy to keep first.');
      });
    };
    if (!cost) { go(false); return; }
    Alert.alert(
      'Send ' + mb(cost.bytes) + ' MB of attachments over mobile data?',
      'Your data backs up either way. ' + (cost.files === 1 ? 'The attachment' : 'The ' + cost.files + ' attachments')
        + ' can wait for Wi-Fi instead.',
      [
        { text: 'Wait for Wi-Fi', style: 'cancel', onPress: () => go(false) },
        { text: 'Send now', onPress: () => go(true) },
      ],
      { cancelable: true, onDismiss: () => { sizingRef.current = false; setSizing(false); } },
    );
  };

  /** A reset signs this phone in, which sends locked pages to the cloud: the PIN comes first, as it does for signing in. */
  const forgot = async () => {
    if (busyRef.current) return;
    if (await locksNeedPin()) setPinFor('reset');
    else setResetOpen(true);
  };

  const leave = () => {
    Alert.alert('Sign out?', 'This phone keeps its data, and the cloud keeps its copy. Backing up stops here until you sign in again. Your other phones stay signed in.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', onPress: () => { signOut().then(() => toast('Signed out')); } },
    ]);
  };

  const syncing = c.status === 'syncing';
  // a percentage that counts up is set in the text face's tabular figures, so it does not shift as it counts
  const counting = syncing && c.progress != null && c.progress < 1;
  const statusLine = syncing
    ? counting ? 'Sending attachments, ' + Math.round((c.progress as number) * 100) + '%' : 'Backing up'
    : c.status === 'error' ? c.error || 'Something went wrong.'
      : c.lastSyncedAt ? 'Backed up ' + ago(c.lastSyncedAt, hour24) + (c.pending && !c.auto ? '. Changes waiting.' : '')
        : 'Not backed up yet';
  // while a backup runs, the status line pulses (full to half strength over 1.2 s); still otherwise
  const syncPulse = useLoop(signedIn && syncing, 1200);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: 1 - 0.5 * syncPulse.value }));
  const remote = c.remote;
  // the cloud's own time has microseconds and an offset, which not every engine's Date reads: read by hand, as cloud.ts does
  const remoteAt = remote ? isoTime(remote.updatedAt) : NaN;
  const from = remote
    ? (remote.device || 'another phone') + (Number.isFinite(remoteAt) ? ', ' + ago(remoteAt, hour24) : '') + withFiles(remote.files)
    : '';
  const choiceTitle = c.reason === 'rescue' ? 'This phone could not open its data'
    : c.reason === 'empty' ? 'This phone holds none of your data'
      : c.lastSyncedAt ? 'A newer copy is in the cloud' : 'There is a copy in the cloud';
  const choiceBody = c.reason === 'rescue' || c.reason === 'empty'
    ? 'The copy in the cloud, from ' + from + ', can bring it back. Backing up waits until you choose.'
    : 'From ' + from + ". Bring it here to replace this phone's data, or keep this phone's data and replace the cloud copy.";

  return (
    <>
      {title ? (
        <SectionTitle right={<InfoDot text="An account keeps a copy of everything in your own private space in the cloud: only you can read it, and it comes back on a new phone. Attachments go up to 20 MB each, 120 MB in all. Your data stays on this phone too." />}>
          {title}
        </SectionTitle>
      ) : null}

      {signedIn && c.status === 'choice' && remote ? (
        <Appear>
          <Card>
            <Text style={st.title}>{choiceTitle}</Text>
            <Text style={[T.caption, { marginTop: 4 }]}>{choiceBody}</Text>
            <PillButton
              label={busy === 'restore' ? 'Bringing it here' : 'Bring it here'} icon="cloud-download-outline"
              onPress={() => { if (!busy) restore(); }} style={{ marginTop: 16 }}
            />
            <PillButton
              label={busy === 'keep' ? 'Backing up' : "Keep this phone's data"} icon="phone-portrait-outline" outline
              onPress={() => { if (!busy) keepHere(); }} style={{ marginTop: 10 }}
            />
          </Card>
        </Appear>
      ) : null}

      <Animated.View key={!c.ready ? 'wait' : signedIn ? 'in' : 'out'} entering={accountIn}>
        {!c.ready ? null : signedIn ? (
          <Card>
            <Text style={T.caption}>Signed in as</Text>
            <Text style={[st.title, { marginTop: 2 }]} numberOfLines={1}>{c.email}</Text>
            <FadeSwap swapKey={c.status + ':' + (c.error || '') + ':' + (syncing ? '' : String(c.lastSyncedAt))}>
              <Animated.Text
                style={[T.caption, { marginTop: 6 }, counting && st.counting, c.status === 'error' && { color: C.danger }, pulseStyle]}
              >
                {statusLine}
              </Animated.Text>
            </FadeSwap>
            {c.note ? <Text style={[T.caption, { marginTop: 3 }]}>{c.note}</Text> : null}
            {c.usedBytes != null && c.usedBytes > 0 ? (
              <Text style={[T.caption, { marginTop: 3 }]}>Attachments use {mb(c.usedBytes)} of {mb(QUOTA_BYTES)} MB</Text>
            ) : null}

            <Hairline />
            <Row style={{ justifyContent: 'space-between', marginVertical: 12 }}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={[T.body, { fontFamily: F.med }]}>Back up automatically</Text>
                <Text style={[T.caption, { marginTop: 2 }]}>A little after each change, and when you leave the app.</Text>
              </View>
              <Toggle value={c.auto} onChange={(v) => { setAuto(v); }} color={C.accent} label="Back up automatically" />
            </Row>
            <Hairline />
            <Row style={{ justifyContent: 'space-between', marginVertical: 12 }}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={[T.body, { fontFamily: F.med }]}>Attachments on Wi-Fi only</Text>
                <Text style={[T.caption, { marginTop: 2 }]}>Your data backs up on any connection. Attachments wait for Wi-Fi.</Text>
              </View>
              <Toggle
                value={wifiOnly} onChange={(v) => setSetting('attachmentsWifiOnly', v)} color={C.accent}
                label="Attachments on Wi-Fi only"
              />
            </Row>
            <Hairline />

            <PillButton
              label={syncing || sizing ? 'Backing up' : 'Back up now'} icon="cloud-upload-outline"
              onPress={backUpNow}
              style={{ marginTop: 16 }}
            />
            {/* nothing to bring when the last look found no copy (after deleting the cloud data, say) */}
            {c.hasCopy === false ? null : (
              <PillButton
                label={busy === 'restore' ? 'Bringing it here' : 'Bring the cloud copy here'} icon="cloud-download-outline"
                color={C.amber} outline onPress={() => { if (!busy) restore(); }} style={{ marginTop: 10 }}
              />
            )}
            <View style={st.links}>
              <Pressable onPress={() => setPwOpen(true)} hitSlop={8} accessibilityRole="button" style={st.linkHit}>
                <Text style={[st.link, { color: C.accent }]}>Change password</Text>
              </Pressable>
              <Pressable onPress={leave} hitSlop={8} accessibilityRole="button" style={st.linkHit}>
                <Text style={[st.link, { color: C.textDim }]}>Sign out</Text>
              </Pressable>
            </View>
          </Card>
        ) : (
          <Card>
            {c.lost ? (
              <Text style={[st.info, { marginTop: 0, marginBottom: 14, color: C.amber }]}>
                You were signed out on this phone. Sign in to keep backing up.
              </Text>
            ) : null}
            <Text style={[T.label, { marginBottom: 14 }]}>
              Keep a copy of everything in the cloud, private to your account, and bring it to a new phone.
            </Text>
            <SegmentedControl
              size="sm" stretch style={{ marginBottom: 16 }}
              options={[{ key: 'in', label: 'Sign in' }, { key: 'up', label: 'Create account' }]}
              value={mode} onChange={(k) => { setMode(k as 'in' | 'up'); setError(''); setInfo(''); setAgain(''); }}
            />
            <Field
              label="Email" value={email} onChangeText={(v) => { setEmail(v); if (error) setError(''); }}
              autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" textContentType="emailAddress"
              placeholder="you@example.com" returnKeyType="next" submitBehavior="submit"
              onSubmitEditing={() => passwordRef.current?.focus()}
            />
            <Field
              ref={passwordRef}
              label="Password" value={password} onChangeText={(v) => { setPassword(v); if (error) setError(''); }}
              secureTextEntry autoCapitalize="none" autoCorrect={false}
              autoComplete={mode === 'up' ? 'new-password' : 'current-password'} textContentType={mode === 'up' ? 'newPassword' : 'password'}
              placeholder={mode === 'up' ? 'At least 6 characters' : ''}
              returnKeyType={mode === 'up' ? 'next' : 'go'} submitBehavior={mode === 'up' ? 'submit' : 'blurAndSubmit'}
              onSubmitEditing={() => (mode === 'up' ? againRef.current?.focus() : submit())}
            />
            {mode === 'up' ? (
              <Field
                ref={againRef}
                label="Password again" value={again} onChangeText={(v) => { setAgain(v); if (error) setError(''); }}
                secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword"
                returnKeyType="go" onSubmitEditing={() => submit()}
              />
            ) : null}
            {/* a problem, or a word of news, dips in and out rather than appearing in one frame */}
            <FadeSwap swapKey={error ? 'e:' + error : info ? 'i:' + info : ''}>
              {error ? <Text style={st.problem}>{error}</Text> : info ? <Text style={st.info}>{info}</Text> : null}
            </FadeSwap>
            <PillButton
              label={busy === 'auth' ? (mode === 'up' ? 'Creating account' : 'Signing in') : mode === 'up' ? 'Create account' : 'Sign in'}
              icon={mode === 'up' ? 'person-add-outline' : 'log-in-outline'}
              onPress={() => { if (!busy) submit(); }} style={{ marginTop: 6 }}
            />
            {mode === 'in' ? (
              <View style={[st.links, { justifyContent: 'center' }]}>
                <Pressable onPress={() => { if (!busy) forgot(); }} hitSlop={8} accessibilityRole="button" style={st.linkHit}>
                  <Text style={[st.link, { color: C.accent }]}>Forgot password</Text>
                </Pressable>
              </View>
            ) : null}
          </Card>
        )}
      </Animated.View>

      <PinSheet
        visible={!!pinFor} mode="enter" onClose={() => setPinFor(null)}
        onDone={() => {
          const step = pinFor;
          setPinFor(null);
          if (step === 'restore') restore(true);
          // the PIN sheet says nothing when it has gone: the reset sheet waits out its leave (about 220 ms) before it rises
          else if (step === 'reset') setTimeout(() => setResetOpen(true), 260);
          else submit(true);
        }}
      />
      <PasswordSheet visible={pwOpen} onClose={() => setPwOpen(false)} />
      <ResetSheet visible={resetOpen} startEmail={email} onClose={() => setResetOpen(false)} />
    </>
  );
}

/**
 * Forgot password, by a code from the email: the address and Send code, then the 6-digit code with a new password
 * (twice, since it is typed unseen), then done, with this phone signed in. What goes wrong is said in the sheet, in
 * words that say what to do next. Closed halfway (to look up the code, say), it opens again where it was left.
 */
function ResetSheet({ visible, startEmail, onClose }: { visible: boolean; startEmail: string; onClose: () => void }) {
  useTheme(); // the links and the done mark take the accent
  const [step, setStep] = React.useState<'email' | 'code' | 'done'>('email');
  const [email, setEmail] = React.useState('');
  const [code, setCode] = React.useState('');
  const [next, setNext] = React.useState('');
  const [again, setAgain] = React.useState('');
  const [error, setError] = React.useState('');
  const [info, setInfo] = React.useState('');
  const [busy, setBusy] = React.useState<null | 'send' | 'reset'>(null);
  // set the moment a tap starts something, so a second tap before the screen catches up starts nothing
  const busyRef = React.useRef(false);
  const emailRef = React.useRef<TextInput>(null);
  const codeRef = React.useRef<TextInput>(null);
  const nextRef = React.useRef<TextInput>(null);
  const againRef = React.useRef<TextInput>(null);
  // A step the wait cut short ("offline") may still reach the cloud: its late answer wins. A reset that went through
  // signed this phone in, so the sheet says so instead of an error; a retry meanwhile waits for it rather than spending
  // the same code a second time.
  const late = React.useRef<Promise<string> | null>(null);
  const visibleRef = React.useRef(visible);
  visibleRef.current = visible;
  const stepRef = React.useRef(step);
  stepRef.current = step;
  React.useEffect(() => {
    if (!visible) return;
    setError('');
    // a reset that is over starts again from the address; one closed halfway keeps its place and its code
    if (step === 'done') {
      setStep('email');
      setCode('');
      setInfo('');
    }
    if (step === 'done' || (step === 'email' && !email.trim())) setEmail(startEmail.trim());
  }, [visible]);

  const send = async (resend = false) => {
    if (busyRef.current) return;
    const address = email.trim();
    if (!looksLikeEmail(address)) { setError('That does not look like an email address.'); return; }
    busyRef.current = true;
    setBusy('send');
    setError('');
    setInfo('');
    const sent = (again: boolean) => {
      setError('');
      setStep('code');
      setInfo((again ? 'A new code is on its way to ' : 'We sent a 6-digit code to ') + address
        + '. It can take a minute to arrive, so check spam too.');
      if (visibleRef.current) setTimeout(() => codeRef.current?.focus(), 60);
    };
    try {
      const work = sendResetCode(address);
      const r = await inTime(work);
      if (r === 'sent') {
        sent(resend);
      } else {
        setError(r === 'offline' ? RESET_OFFLINE : 'The code could not be sent. Wait a minute, then try again.');
        // the email may still go out after the wait: then the code step opens, as it would have
        if (r === 'offline') {
          work.then((v) => {
            if (v === 'sent' && !busyRef.current && stepRef.current === (resend ? 'code' : 'email')) sent(resend);
          }).catch(() => {});
        }
      }
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  const reset = async () => {
    if (busyRef.current) return;
    if (!/^\d{6}$/.test(code.replace(/\s+/g, ''))) { setError('Enter the 6-digit code from the email.'); return; }
    if (next.length < 6) { setError('Use a password of at least 6 characters.'); return; }
    if (next !== again) { setError('The two passwords do not match.'); return; }
    busyRef.current = true;
    setBusy('reset');
    setError('');
    const finish = () => {
      tap();
      // the password is not kept a moment longer than it is needed
      setNext('');
      setAgain('');
      setCode('');
      setInfo('');
      setError('');
      setStep('done');
      // closed meanwhile: the account card behind it has turned signed in, and this says why
      if (!visibleRef.current) toast('Password changed');
    };
    try {
      // a step cut short earlier is still on its way: its answer comes first, and only a refusal tries again
      const earlier = late.current;
      if (earlier) {
        if ((await inTime(earlier)) === 'ok') { late.current = null; finish(); return; }
        if (late.current === earlier) { setError(RESET_OFFLINE); return; }
      }
      const work = resetPasswordWithCode(email, code, next);
      const r = await inTime(work);
      if (r === 'ok') {
        finish();
        return;
      }
      if (r === 'offline') {
        late.current = work;
        work.then((v) => {
          if (late.current !== work) return;
          late.current = null;
          if (v === 'ok' && !busyRef.current && stepRef.current === 'code') finish();
        }).catch(() => {});
      }
      setError(
        r === 'wrong-code' ? "That code didn't work. It may be mistyped or out of date: check the email, or send a new code."
          : r === 'weak' ? 'The cloud turned that password down. Choose a longer one, of at least 6 characters.'
            : r === 'offline' ? RESET_OFFLINE
              : 'Something went wrong in the cloud. Wait a minute, then try again.',
      );
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  const clear = () => { if (error) setError(''); };

  return (
    <Sheet
      visible={visible} onClose={onClose} title={step === 'done' ? 'Password changed' : 'Reset your password'}
      // the first field takes the keyboard once the sheet is up, so the keyboard never rides the rise
      onRisen={() => { if (step === 'email') emailRef.current?.focus(); else if (step === 'code') codeRef.current?.focus(); }}
    >
      {step === 'email' ? (
        <>
          <Text style={[T.caption, { marginBottom: 16 }]}>
            Enter the email of your account. We send it a 6-digit code, and with it you choose a new password.
          </Text>
          <Field
            ref={emailRef}
            label="Email" value={email} onChangeText={(v) => { setEmail(v); clear(); }}
            autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" textContentType="emailAddress"
            placeholder="you@example.com" returnKeyType="send" onSubmitEditing={() => send()}
          />
        </>
      ) : step === 'code' ? (
        <>
          <Text style={[T.caption, { marginBottom: 16 }]}>{info}</Text>
          <Field
            ref={codeRef}
            label="Code from the email" value={code}
            onChangeText={(v) => { setCode(v.replace(/[^\d]/g, '').slice(0, 6)); clear(); }}
            keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" textContentType="oneTimeCode"
            placeholder="6 digits" returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => nextRef.current?.focus()}
          />
          <Field
            ref={nextRef}
            label="New password" value={next} onChangeText={(v) => { setNext(v); clear(); }}
            secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword"
            placeholder="At least 6 characters" returnKeyType="next" submitBehavior="submit"
            onSubmitEditing={() => againRef.current?.focus()}
          />
          <Field
            ref={againRef}
            label="The new password again" value={again} onChangeText={(v) => { setAgain(v); clear(); }}
            secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword"
            returnKeyType="done" onSubmitEditing={reset}
          />
        </>
      ) : (
        <View style={st.done}>
          <Ionicons name="checkmark-circle-outline" size={40} color={C.green} />
          <Text style={[T.body, { textAlign: 'center', marginTop: 10 }]}>
            Your new password is set, and this phone is signed in to your account.
          </Text>
        </View>
      )}
      {error ? <Text style={st.problem} accessibilityLiveRegion="polite">{error}</Text> : null}
      {step === 'email' ? (
        <PillButton
          label={busy === 'send' ? 'Sending code' : 'Send code'} icon="mail-outline"
          onPress={() => { if (!busy) send(); }} style={{ marginTop: 6 }}
        />
      ) : step === 'code' ? (
        <>
          <PillButton
            label={busy === 'reset' ? 'Changing password' : 'Change password'} icon="key-outline"
            onPress={() => { if (!busy) reset(); }} style={{ marginTop: 6 }}
          />
          <View style={st.links}>
            <Pressable onPress={() => { if (!busy) send(true); }} hitSlop={8} accessibilityRole="button" style={st.linkHit}>
              <Text style={[st.link, { color: C.accent }]}>{busy === 'send' ? 'Sending' : 'Send a new code'}</Text>
            </Pressable>
            <Pressable
              onPress={() => { if (!busy) { setStep('email'); setError(''); setInfo(''); setCode(''); } }}
              hitSlop={8} accessibilityRole="button" style={st.linkHit}
            >
              <Text style={[st.link, { color: C.textDim }]}>Use another email</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <PillButton label="Done" onPress={onClose} style={{ marginTop: 18 }} />
      )}
    </Sheet>
  );
}

/** Changing the password: the new one twice, so a typo never locks the account. */
function PasswordSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [next, setNext] = React.useState('');
  const [again, setAgain] = React.useState('');
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const done = React.useRef(false);
  const againRef = React.useRef<TextInput>(null);
  React.useEffect(() => {
    if (visible) { setNext(''); setAgain(''); setError(''); done.current = false; }
  }, [visible]);

  const save = async () => {
    if (next.length < 6) { setError('Use a password of at least 6 characters.'); return; }
    if (next !== again) { setError('The two passwords do not match.'); return; }
    setBusy(true);
    try {
      await changePassword(next);
      done.current = true;
      onClose();
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      visible={visible} onClose={onClose} title="Change password"
      onClosed={() => { if (done.current) toast('Password changed'); }}
    >
      <Field
        label="New password" value={next} onChangeText={(v) => { setNext(v); if (error) setError(''); }}
        secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword"
        placeholder="At least 6 characters" autoFocus returnKeyType="next" submitBehavior="submit"
        onSubmitEditing={() => againRef.current?.focus()}
      />
      <Field
        ref={againRef}
        label="The new password again" value={again} onChangeText={(v) => { setAgain(v); if (error) setError(''); }}
        secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword"
        returnKeyType="done" onSubmitEditing={save}
      />
      {error ? <Text style={st.problem}>{error}</Text> : null}
      <PillButton label={busy ? 'Saving' : 'Save password'} icon="key-outline" onPress={() => { if (!busy) save(); }} style={{ marginTop: 6 }} />
    </Sheet>
  );
}

/**
 * The end of Settings: deleting, each behind a dialog that says exactly what goes and what stays. The account's two
 * rows show only when signed in; erasing this phone is always there.
 */
export function DeleteSection({ title = 'Delete', onErased }: {
  title?: string | null;
  /** called once this phone has been erased, so the page can step back to a list that is fresh too */
  onErased?: () => void;
}) {
  const status = useCloud((c) => c.status);
  const email = useCloud((c) => c.email);
  const [busy, setBusy] = React.useState<null | 'account' | 'cloud' | 'phone'>(null);
  // held from the tap until its dialog is answered or its work is done, so a second tap opens no second dialog
  const busyRef = React.useRef(false);
  const release = () => { busyRef.current = false; };
  const [pinFor, setPinFor] = React.useState<null | 'phone'>(null);
  const signedIn = status !== 'signed-out' && !!email;

  const run = async (what: 'account' | 'cloud' | 'phone') => {
    setBusy(what);
    let erased = false;
    try {
      if (what === 'account') { await deleteAccount(); toast('Account deleted'); }
      else if (what === 'cloud') { await deleteCloudCopy(); toast('Cloud data deleted'); }
      else { await eraseThisPhone(); toast('Everything on this phone was deleted.'); erased = true; }
      tap();
    } catch (e) {
      Alert.alert('Could not delete', describe(e));
    } finally {
      release();
      setBusy(null);
    }
    if (erased) onErased?.();
  };

  const ask = (heading: string, body: string, action: string, what: 'account' | 'cloud' | 'phone') => {
    Alert.alert(heading, body, [
      { text: 'Cancel', style: 'cancel', onPress: release },
      { text: action, style: 'destructive', onPress: () => run(what) },
    ]);
  };
  const confirmAccount = () => {
    if (busyRef.current) return;
    busyRef.current = true;
    ask(
      'Delete your account?',
      'Your account, the copy in the cloud and every attachment there are deleted for good. This phone keeps its data. This cannot be undone.',
      'Delete account', 'account',
    );
  };
  const confirmCloud = () => {
    if (busyRef.current) return;
    busyRef.current = true;
    ask(
      'Delete your cloud data?',
      'The copy in the cloud and every attachment there are deleted, and automatic backup turns off. Your account and this phone\'s data stay. This cannot be undone.',
      'Delete cloud data', 'cloud',
    );
  };
  const confirmPhone = async (pinOk = false) => {
    if (busyRef.current) return;
    busyRef.current = true;
    // erasing takes locked pages with it, so the PIN is asked for first when anything is locked
    if (!pinOk && (await locksNeedPin())) { release(); setPinFor('phone'); return; }
    ask(
      'Delete everything on this phone?',
      'Tasks, notes, the journal, scores, lectures, habits, settings, attachments and the PIN are erased from this phone. '
        + (signedIn ? 'You are signed out here first, so the copy in the cloud stays and can be brought back. ' : '')
        + 'This cannot be undone.',
      'Delete everything', 'phone',
    );
  };

  return (
    <>
      {title ? <SectionTitle>{title}</SectionTitle> : null}
      <Card>
        {signedIn ? (
          <>
            <PillButton
              label={busy === 'account' ? 'Deleting account' : 'Delete my account'} icon="person-remove-outline"
              color={C.danger} outline onPress={() => { if (!busy) confirmAccount(); }}
            />
            <Text style={st.danger}>Your account and everything it keeps in the cloud.</Text>
            <PillButton
              label={busy === 'cloud' ? 'Deleting cloud data' : 'Delete my cloud data'} icon="cloud-offline-outline"
              color={C.danger} outline onPress={() => { if (!busy) confirmCloud(); }} style={{ marginTop: 16 }}
            />
            <Text style={st.danger}>The copy in the cloud. Your account stays.</Text>
          </>
        ) : null}
        <PillButton
          label={busy === 'phone' ? 'Deleting' : 'Delete everything on this phone'} icon="trash-outline"
          color={C.danger} outline onPress={() => { if (!busy) confirmPhone(); }} style={signedIn ? { marginTop: 16 } : undefined}
        />
        <Text style={st.danger}>Every tool's data and settings on this phone.</Text>
      </Card>
      <PinSheet
        visible={!!pinFor} mode="enter" onClose={() => setPinFor(null)}
        onDone={() => { setPinFor(null); confirmPhone(true); }}
      />
    </>
  );
}

const st = StyleSheet.create({
  title: { color: C.text, fontFamily: F.semi, fontSize: 16, letterSpacing: TRACK.title },
  problem: { color: C.danger, fontFamily: F.smMed, fontSize: 12, letterSpacing: TRACK.fine, lineHeight: 17, marginTop: -4, marginBottom: 12 },
  info: { color: C.textDim, fontFamily: F.smMed, fontSize: 12, letterSpacing: TRACK.fine, lineHeight: 17, marginTop: -4, marginBottom: 12 },
  counting: { fontFamily: F.reg, fontVariant: ['tabular-nums'] },
  // the links sit where they always did; their touch area reaches 44 above and below the words. At a large font size
  // the second goes under the first rather than off the edge of a narrow phone
  links: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, justifyContent: 'space-between', marginTop: 5, marginBottom: -13, paddingHorizontal: 4 },
  linkHit: { minHeight: 44, justifyContent: 'center' },
  link: { fontFamily: F.semi, fontSize: 13, letterSpacing: TRACK.small },
  danger: { color: C.textFaint, fontFamily: F.sm, fontSize: 12, letterSpacing: TRACK.fine, lineHeight: 17, marginTop: 8, marginLeft: 4 },
  done: { alignItems: 'center', paddingVertical: 8, paddingHorizontal: 8 },
});
