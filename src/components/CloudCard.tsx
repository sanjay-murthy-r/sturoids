import React from 'react';
import { View, Text, StyleSheet, Alert, Pressable } from 'react-native';
import { C, F, T } from '../theme';
import { useStore } from '../store';
import {
  QUOTA_BYTES, changePassword, deleteAccount, deleteCloudCopy, initCloud, keepThisPhone, restoreFromCloud, setAuto,
  signIn, signOut, signUp, syncNow, useCloud, describe,
} from '../cloud';
import { eraseThisPhone } from '../wipe';
import { pinStatus } from '../lock';
import { Card, Field, Hairline, InfoDot, PillButton, Row, SectionTitle, Sheet, Toggle } from './UI';
import { FadeSwap } from './Motion';
import { SegmentedControl } from './SegmentedControl';
import { PinSheet } from './LockGate';
import { toast } from './Toast';
import { tap } from '../haptics';

/** "just now", "12 min ago", "3 h ago", or the day and time. */
function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 6 * 3600) return Math.floor(s / 3600) + ' h ago';
  const d = new Date(at);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ', '
    + d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

const mb = (bytes: number) => (bytes < 1024 * 1024 ? '<1' : String(Math.round(bytes / (1024 * 1024))));

/** Anything locked (the journal, the Notes tool, a note) with a PIN set: then the PIN guards what could reveal it. */
async function locksNeedPin() {
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
  const c = useCloud();
  const [mode, setMode] = React.useState<'in' | 'up'>('in');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState<null | 'auth' | 'restore'>(null);
  const [error, setError] = React.useState('');
  const [info, setInfo] = React.useState('');
  const [pinFor, setPinFor] = React.useState<null | 'auth'>(null);
  const [pwOpen, setPwOpen] = React.useState(false);
  const [, tick] = React.useState(0);

  React.useEffect(() => { initCloud().catch(() => {}); }, []);
  // "12 min ago" moves on while Settings is open
  React.useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30 * 1000);
    return () => clearInterval(t);
  }, []);

  const submit = async (pinOk = false) => {
    setError('');
    setInfo('');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setError('That does not look like an email address.'); return; }
    if (password.length < 6) { setError('Use a password of at least 6 characters.'); return; }
    // signing in sends locked pages to the cloud, so it asks for the PIN when anything is locked, like an export
    if (!pinOk && (await locksNeedPin())) { setPinFor('auth'); return; }
    setBusy('auth');
    try {
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
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(null);
    }
  };

  const restore = () => {
    Alert.alert(
      'Bring the cloud copy here?',
      'It replaces everything on this phone with the copy in the cloud. Calculator history is cleared and a running Deep Work session ends.',
      [
        { text: 'Cancel', style: 'cancel' },
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
              setBusy(null);
            }
          },
        },
      ],
    );
  };

  const keepHere = () => {
    Alert.alert(
      "Keep this phone's data?",
      "It replaces the copy in the cloud with this phone's data. What only the other copy has is lost.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Keep this phone', style: 'destructive', onPress: () => { keepThisPhone().catch(() => {}); } },
      ],
    );
  };

  const leave = () => {
    Alert.alert('Sign out?', 'This phone keeps its data, and the cloud keeps its copy. Backing up stops until you sign in again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', onPress: () => { signOut().then(() => toast('Signed out')); } },
    ]);
  };

  const signedIn = c.status !== 'signed-out' && !!c.email;
  const syncing = c.status === 'syncing';
  const statusLine = syncing
    ? c.progress != null && c.progress < 1 ? 'Sending attachments, ' + Math.round(c.progress * 100) + '%' : 'Backing up'
    : c.status === 'error' ? c.error || 'Something went wrong.'
      : c.lastSyncedAt ? 'Backed up ' + ago(c.lastSyncedAt) + (c.pending && !c.auto ? '. Changes waiting.' : '')
        : 'Not backed up yet';

  return (
    <>
      {title ? (
        <SectionTitle right={<InfoDot text="An account keeps a copy of everything in your own private space in the cloud: only you can read it, and it comes back on a new phone. Attachments go up to 20 MB each, 120 MB in all. Your data stays on this phone too." />}>
          {title}
        </SectionTitle>
      ) : null}

      {signedIn && c.status === 'choice' && c.remote ? (
        <Card>
          <Text style={st.title}>{c.lastSyncedAt ? 'A newer copy is in the cloud' : 'There is a copy in the cloud'}</Text>
          <Text style={[T.caption, { marginTop: 4 }]}>
            {'From ' + (c.remote.device || 'another phone') + ', ' + ago(new Date(c.remote.updatedAt).getTime())
              + '. Bring it here to replace this phone\'s data, or keep this phone\'s data and replace the cloud copy.'}
          </Text>
          <PillButton label="Bring it here" icon="cloud-download-outline" onPress={restore} style={{ marginTop: 16 }} />
          <PillButton label="Keep this phone's data" icon="phone-portrait-outline" outline onPress={keepHere} style={{ marginTop: 10 }} />
        </Card>
      ) : null}

      {signedIn ? (
        <Card>
          <Text style={T.caption}>Signed in as</Text>
          <Text style={[st.title, { marginTop: 2 }]} numberOfLines={1}>{c.email}</Text>
          <FadeSwap swapKey={c.status + ':' + (c.error || '') + ':' + (syncing ? '' : String(c.lastSyncedAt))}>
            <Text style={[T.caption, { marginTop: 6 }, c.status === 'error' && { color: C.danger }]}>{statusLine}</Text>
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

          <PillButton
            label={syncing ? 'Backing up' : 'Back up now'} icon="cloud-upload-outline"
            onPress={() => { if (!syncing) syncNow().then(() => { if (useCloud.getState().status === 'idle') toast('Backed up'); }); }}
            style={{ marginTop: 16 }}
          />
          <PillButton
            label={busy === 'restore' ? 'Bringing it here' : 'Bring the cloud copy here'} icon="cloud-download-outline"
            color={C.amber} outline onPress={() => { if (!busy) restore(); }} style={{ marginTop: 10 }}
          />
          <View style={st.links}>
            <Pressable onPress={() => setPwOpen(true)} hitSlop={8} accessibilityRole="button">
              <Text style={[st.link, { color: C.accent }]}>Change password</Text>
            </Pressable>
            <Pressable onPress={leave} hitSlop={8} accessibilityRole="button">
              <Text style={[st.link, { color: C.textDim }]}>Sign out</Text>
            </Pressable>
          </View>
        </Card>
      ) : (
        <Card>
          <Text style={[T.label, { marginBottom: 14 }]}>
            Keep a copy of everything in the cloud, private to your account, and bring it to a new phone.
          </Text>
          <SegmentedControl
            size="sm" stretch style={{ marginBottom: 16 }}
            options={[{ key: 'in', label: 'Sign in' }, { key: 'up', label: 'Create account' }]}
            value={mode} onChange={(k) => { setMode(k as 'in' | 'up'); setError(''); setInfo(''); }}
          />
          <Field
            label="Email" value={email} onChangeText={(v) => { setEmail(v); if (error) setError(''); }}
            autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" textContentType="emailAddress"
            placeholder="you@example.com"
          />
          <Field
            label="Password" value={password} onChangeText={(v) => { setPassword(v); if (error) setError(''); }}
            secureTextEntry autoCapitalize="none" autoCorrect={false}
            autoComplete={mode === 'up' ? 'new-password' : 'current-password'} textContentType={mode === 'up' ? 'newPassword' : 'password'}
            placeholder={mode === 'up' ? 'At least 6 characters' : ''} returnKeyType="go" onSubmitEditing={() => submit()}
          />
          {error ? <Text style={st.problem}>{error}</Text> : info ? <Text style={st.info}>{info}</Text> : null}
          <PillButton
            label={busy === 'auth' ? (mode === 'up' ? 'Creating account' : 'Signing in') : mode === 'up' ? 'Create account' : 'Sign in'}
            icon={mode === 'up' ? 'person-add-outline' : 'log-in-outline'}
            onPress={() => { if (!busy) submit(); }} style={{ marginTop: 6 }}
          />
        </Card>
      )}

      <PinSheet
        visible={!!pinFor} mode="enter" onClose={() => setPinFor(null)}
        onDone={() => { setPinFor(null); submit(true); }}
      />
      <PasswordSheet visible={pwOpen} onClose={() => setPwOpen(false)} />
    </>
  );
}

/** Changing the password: the new one twice, so a typo never locks the account. */
function PasswordSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [next, setNext] = React.useState('');
  const [again, setAgain] = React.useState('');
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const done = React.useRef(false);
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
        placeholder="At least 6 characters" autoFocus
      />
      <Field
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
export function DeleteSection({ title = 'Delete' }: { title?: string | null }) {
  const c = useCloud();
  const [busy, setBusy] = React.useState<null | 'account' | 'cloud' | 'phone'>(null);
  const [pinFor, setPinFor] = React.useState<null | 'phone'>(null);
  const signedIn = c.status !== 'signed-out' && !!c.email;

  const run = async (what: 'account' | 'cloud' | 'phone') => {
    setBusy(what);
    try {
      if (what === 'account') { await deleteAccount(); toast('Account deleted'); }
      else if (what === 'cloud') { await deleteCloudCopy(); toast('Cloud data deleted'); }
      else { await eraseThisPhone(); toast('Everything on this phone was deleted'); }
      tap();
    } catch (e) {
      Alert.alert('Could not delete', describe(e));
    } finally {
      setBusy(null);
    }
  };

  const confirmAccount = () => Alert.alert(
    'Delete your account?',
    'Your account, the copy in the cloud and every attachment there are deleted for good. This phone keeps its data. This cannot be undone.',
    [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete account', style: 'destructive', onPress: () => run('account') }],
  );
  const confirmCloud = () => Alert.alert(
    'Delete your cloud data?',
    'The copy in the cloud and every attachment there are deleted, and automatic backup turns off. Your account and this phone\'s data stay. This cannot be undone.',
    [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete cloud data', style: 'destructive', onPress: () => run('cloud') }],
  );
  const confirmPhone = async (pinOk = false) => {
    // erasing takes locked pages with it, so the PIN is asked for first when anything is locked
    if (!pinOk && (await locksNeedPin())) { setPinFor('phone'); return; }
    Alert.alert(
      'Delete everything on this phone?',
      'Tasks, notes, the journal, scores, lectures, habits, settings, attachments and the PIN are erased from this phone. '
        + (signedIn ? 'You are signed out here first, so the copy in the cloud stays and can be brought back. ' : '')
        + 'This cannot be undone.',
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete everything', style: 'destructive', onPress: () => run('phone') }],
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
  title: { color: C.text, fontFamily: F.semi, fontSize: 16 },
  problem: { color: C.danger, fontFamily: F.med, fontSize: 12, lineHeight: 17, marginTop: -4, marginBottom: 12 },
  info: { color: C.textDim, fontFamily: F.med, fontSize: 12, lineHeight: 17, marginTop: -4, marginBottom: 12 },
  links: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 18, paddingHorizontal: 4 },
  link: { fontFamily: F.semi, fontSize: 13 },
  danger: { color: C.textFaint, fontFamily: F.reg, fontSize: 12, lineHeight: 17, marginTop: 8, marginLeft: 4 },
});
