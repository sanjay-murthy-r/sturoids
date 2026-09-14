import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, Linking } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { C, F, MIN, S, T, ThemeMode, AnimLevel, ACCENT_CHOICES, neuInset, neuRaised } from '../src/theme';
import { useStore, exportSnapshot, importSnapshot, readRecoveryCopy, deleteRecoveryCopy } from '../src/store';
import { compareVersions, todayKey } from '../src/utils';
import { ScreenBG, Card, SectionTitle, Field, PillButton, Row, Hairline, Toggle, Chip, InfoDot, NeuHeader, Sheet, useTheme } from '../src/components/UI';
import { Bouncy, Pop } from '../src/components/Motion';
import { tick } from '../src/haptics';
import { SegmentedControl } from '../src/components/SegmentedControl';
import { PinSheet } from '../src/components/LockGate';
import { journalForBackup, restoreBodies } from '../src/journal';
import {
  deviceAuthAvailable, hasPin, isUnlocked, lockProtectionAvailable, markUnlocked, removePin, unlockWithDevice,
} from '../src/lock';
import { ensurePermission, rescheduleAllReminders } from '../src/notifications';
import { TOOLS, ToolKey, colorOf, normaliseSlots, toolByKey } from '../src/tools';

// keep this fallback in step with app.json — it also seeds the update check's comparison below
const APP_VERSION = Constants.expoConfig?.version || '1.3.0';

const THEMES: { key: ThemeMode; label: string; desc: string }[] = [
  { key: 'default', label: 'Default', desc: 'Soft grey neumorphism — one continuous material' },
  { key: 'minimal', label: 'Minimalistic', desc: 'High contrast, flat, maximum legibility' },
];

const ANIMS: { key: AnimLevel; label: string; desc: string }[] = [
  { key: 'none', label: 'Off', desc: 'No motion at all' },
  { key: 'some', label: 'Some', desc: 'Feedback only — taps & state changes' },
  { key: 'full', label: 'Everything', desc: 'Bouncy springs on all the things' },
];

/**
 * Radio list. Declared at module scope: a component defined inside Settings'
 * render would be a NEW component type every render, remounting the whole list
 * (and every press/pop animation in it) on each settings change.
 */
function OptionPicker<K extends string>({
  options, value, onPick,
}: { options: { key: K; label: string; desc: string }[]; value: K; onPick: (k: K) => void }) {
  const theme = useTheme();
  return (
    <View>
      {options.map((o, i) => {
        const active = value === o.key;
        return (
          <View key={o.key}>
            {i > 0 && <Hairline />}
            <Bouncy onPress={() => { tick(); onPick(o.key); }} scaleTo={0.98} radius={S.radiusSm} style={st.optRow}>
              <View
                style={[
                  st.radioWell,
                  theme === 'minimal'
                    ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: active ? C.accent : MIN.border }
                    : { backgroundColor: C.inset, ...neuInset('low') },
                ]}
              >
                {active && (
                  <Pop dep={value}>
                    <View
                      style={[
                        st.radioDot,
                        { backgroundColor: C.accent },
                        theme === 'minimal' ? null : (neuRaised('low') as object),
                      ]}
                    />
                  </Pop>
                )}
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[T.body, { fontFamily: active ? F.semi : F.med }]}>{o.label}</Text>
                <Text style={[T.caption, { marginTop: 1 }]}>{o.desc}</Text>
              </View>
            </Bouncy>
          </View>
        );
      })}
    </View>
  );
}

export default function Settings() {
  const theme = useTheme();
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const [checking, setChecking] = useState(false);

  const slots = normaliseSlots(settings.tabSlots);
  const [slotPicker, setSlotPicker] = useState<number | null>(null);
  const setSlot = (i: number, key: ToolKey) => {
    const next = [...slots];
    const j = next.indexOf(key);
    if (j >= 0 && j !== i) next[j] = next[i]; // swap so no destination repeats
    next[i] = key;
    setSetting('tabSlots', normaliseSlots(next));
  };

  const toggleReminders = async (v: boolean) => {
    if (v) {
      const ok = await ensurePermission();
      if (!ok) { Alert.alert('Permission needed', 'Allow notifications in system settings first.'); return; }
    }
    setSetting('remindersEnabled', v);
    setTimeout(rescheduleAllReminders, 200);
  };

  const exportData = async (confirmed = false) => {
    // a backup carries locked pages in full, so making one asks for the owner, like turning a lock off
    const s = useStore.getState();
    const carriesLocked = s.settings.journalLocked || s.notes.some((n) => n.locked);
    if (carriesLocked && !confirmed && !(await confirmOwner('export'))) return;
    try {
      const snap = exportSnapshot();
      // journal text lives in files, so the backup carries it inline
      const json = JSON.stringify({ ...snap, journal: await journalForBackup(snap.journal) }, null, 2);
      const uri = FileSystem.cacheDirectory + 'sturoids-backup-' + todayKey() + '.json';
      await FileSystem.writeAsStringAsync(uri, json);
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/json' });
      else Alert.alert('Saved', 'Backup written to:\n' + uri);
    } catch (e: any) {
      Alert.alert('Export failed', String(e?.message || e));
    }
  };

  const importData = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      const json = await FileSystem.readAsStringAsync(res.assets[0].uri);
      Alert.alert(
        'Replace everything?',
        'This replaces all current data with the backup. Calculator history is cleared and any running Deep Work session ends.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Replace', style: 'destructive',
            onPress: async () => {
              const ok = importSnapshot(json);
              if (ok) {
                try {
                  await restoreBodies(JSON.parse(json)?.journal);
                } catch {
                  // the index is restored either way; text that fails to write stays in the backup file
                }
                rescheduleAllReminders();
              }
              Alert.alert(
                ok ? 'Imported' : 'Not a Sturoids backup',
                ok ? 'Your data is restored.' : 'That file could not be read as a backup.'
              );
            },
          },
        ]
      );
    } catch (e: any) {
      Alert.alert('Import failed', String(e?.message || e));
    }
  };

  // a copy of saved data that could not be opened (see store.ts): share it, restore it, or let it go
  const [recovery, setRecovery] = useState<string | null>(null);
  useEffect(() => {
    readRecoveryCopy().then(setRecovery);
  }, []);

  const shareRecovery = async () => {
    if (!recovery) return;
    try {
      const uri = FileSystem.cacheDirectory + 'sturoids-kept-copy-' + todayKey() + '.json';
      await FileSystem.writeAsStringAsync(uri, recovery);
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/json' });
      else Alert.alert('Saved', 'Copy written to:\n' + uri);
    } catch (e: any) {
      Alert.alert('Could not share the copy', String(e?.message || e));
    }
  };

  const restoreRecovery = () => {
    if (!recovery) return;
    Alert.alert(
      'Restore the kept copy?',
      'This replaces all current data with the copy. Calculator history is cleared and any running Deep Work session ends.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore', style: 'destructive',
          onPress: async () => {
            const ok = importSnapshot(recovery);
            if (ok) {
              rescheduleAllReminders();
              await deleteRecoveryCopy();
              setRecovery(null);
            }
            Alert.alert(
              ok ? 'Restored' : 'Still could not be opened',
              ok ? 'Your data is back.' : 'Keep the copy and try again after updating the app.'
            );
          },
        },
      ]
    );
  };

  const discardRecovery = () => {
    Alert.alert('Delete the kept copy?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          await deleteRecoveryCopy();
          setRecovery(null);
        },
      },
    ]);
  };

  // ---- privacy: the journal lock, the app PIN, and how soon an open session closes ----
  const lockedNotes = useStore((s) => s.notes.filter((n) => n.locked).length);
  const [pinSet, setPinSet] = useState(false);
  const [deviceLock, setDeviceLock] = useState(false);
  const [pinStep, setPinStep] = useState<null | { mode: 'enter' | 'set'; then: 'journal-on' | 'journal-off' | 'change' | 'remove' | 'export' }>(null);
  const refreshLockInfo = () => {
    hasPin().then(setPinSet);
    deviceAuthAvailable().then(setDeviceLock);
  };
  useEffect(refreshLockInfo, []);

  /** Asks for the owner before a lock is weakened. Resolves true when it is already confirmed. */
  const confirmOwner = async (then: 'journal-off' | 'change' | 'remove' | 'export'): Promise<boolean> => {
    if (isUnlocked()) return true;
    const r = await unlockWithDevice('Confirm it is you');
    if (r === 'unlocked') return true;
    if (r === 'needs-pin') setPinStep({ mode: 'enter', then });
    return false;
  };

  const setJournalLock = async (on: boolean) => {
    if (!on) {
      if (await confirmOwner('journal-off')) setSetting('journalLocked', false);
      return;
    }
    if (await lockProtectionAvailable()) setSetting('journalLocked', true);
    else setPinStep({ mode: 'set', then: 'journal-on' });
  };

  const changePin = async () => {
    if (pinSet && !(await confirmOwner('change'))) return;
    setPinStep({ mode: 'set', then: 'change' });
  };

  const dropPin = () => {
    const remove = async () => {
      if (!(await confirmOwner('remove'))) return;
      await removePin();
      refreshLockInfo();
    };
    if (!deviceLock && (settings.journalLocked || lockedNotes > 0)) {
      Alert.alert(
        'Remove the PIN?',
        'This phone has no screen lock, so locked content will open without asking.',
        [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: remove }],
      );
    } else {
      remove();
    }
  };

  const pinDone = async () => {
    const step = pinStep;
    setPinStep(null);
    if (!step) return;
    if (step.mode === 'enter') {
      markUnlocked();
      if (step.then === 'journal-off') setSetting('journalLocked', false);
      else if (step.then === 'change') setTimeout(() => setPinStep({ mode: 'set', then: 'change' }), 350);
      else if (step.then === 'remove') { await removePin(); refreshLockInfo(); }
      else if (step.then === 'export') exportData(true);
      return;
    }
    refreshLockInfo();
    if (step.then === 'journal-on') setSetting('journalLocked', true);
  };

  const checkUpdate = async () => {
    const repo = settings.githubRepo.trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
      Alert.alert('Set the repo first', 'Enter it as owner/repo once the app is on GitHub Releases.');
      return;
    }
    setChecking(true);
    try {
      const r = await fetch('https://api.github.com/repos/' + repo + '/releases/latest');
      if (!r.ok) throw new Error('GitHub said ' + r.status);
      const j = await r.json();
      const latest = String(j.tag_name || '');
      if (compareVersions(latest, APP_VERSION) > 0) {
        Alert.alert(latest + ' available', 'Download the new APK from GitHub?', [
          { text: 'Later', style: 'cancel' },
          { text: 'Open', onPress: () => Linking.openURL(j.html_url) },
        ]);
      } else {
        Alert.alert('Up to date', "You're on v" + APP_VERSION + ' — nothing newer on Releases.');
      }
    } catch (e: any) {
      Alert.alert('Check failed', String(e?.message || e));
    } finally {
      setChecking(false);
    }
  };

  return (
    <ScreenBG>
      <NeuHeader title="Settings" />
      <ScrollView contentContainerStyle={{ padding: S.pad, paddingTop: 4, paddingBottom: 40 }}>
        <SectionTitle>Profile</SectionTitle>
        <Card>
          <Text style={st.label}>Name (used in the greeting)</Text>
          <Field value={settings.name} onChangeText={(v) => setSetting('name', v)} placeholder="Your name" />
        </Card>

        <SectionTitle>Appearance</SectionTitle>
        <Card pad={10}>
          <OptionPicker options={THEMES} value={settings.theme} onPick={(k) => setSetting('theme', k)} />
        </Card>

        <SectionTitle>Accent colour</SectionTitle>
        <Card>
          <Row style={{ flexWrap: 'wrap', gap: 12 }}>
            {ACCENT_CHOICES.map((a) => {
              const active = settings.accent === a.color;
              return (
                <Bouncy
                  key={a.key}
                  onPress={() => { tick(); setSetting('accent', a.color); }}
                  scaleTo={0.85}
                  radius={22}
                  style={[
                    st.swatchWell,
                    theme === 'minimal'
                      ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: active ? a.color : MIN.border }
                      : active
                        ? { backgroundColor: C.inset, ...neuInset('mid') }
                        : { backgroundColor: C.card, ...neuRaised('low') },
                  ]}
                >
                  <View style={[st.swatchDisc, { backgroundColor: a.color }]}>
                    {active && <Ionicons name="checkmark" size={14} color={C.onAccent} />}
                  </View>
                </Bouncy>
              );
            })}
          </Row>
          <Text style={st.hint}>
            {ACCENT_CHOICES.find((a) => a.color === settings.accent)?.label || 'Custom'} — recolours highlights, links and controls everywhere.
          </Text>
        </Card>

        <SectionTitle right={<InfoDot text="Today and More stay fixed. Tools placed in a slot open as tabs; the rest live in More." />}>
          Tab bar
        </SectionTitle>
        <Card pad={6}>
          {slots.map((key, i) => {
            const tool = toolByKey(key);
            return (
              <View key={i}>
                {i > 0 && <Hairline />}
                <Bouncy onPress={() => { tick(); setSlotPicker(i); }} scaleTo={0.98} radius={S.radiusSm} style={st.slotRow}>
                  <Text style={st.slotIndex}>Slot {i + 1}</Text>
                  <Ionicons name={(tool?.icon || 'ellipse-outline') as any} size={19} color={colorOf(tool?.colorKey)} />
                  <Text style={[T.body, { flex: 1, marginLeft: 10, fontFamily: F.med }]} numberOfLines={1}>{tool?.label}</Text>
                  <Ionicons name="chevron-forward" size={17} color={C.textFaint} />
                </Bouncy>
              </View>
            );
          })}
        </Card>
        <Sheet visible={slotPicker !== null} onClose={() => setSlotPicker(null)} title="Choose a tool">
          {TOOLS.map((t, k) => {
            const active = slotPicker !== null && slots[slotPicker] === t.key;
            const elsewhere = slots.indexOf(t.key);
            return (
              <View key={t.key}>
                {k > 0 && <Hairline />}
                <Bouncy
                  onPress={() => {
                    if (slotPicker !== null && !active) { tick(); setSlot(slotPicker, t.key); }
                    setSlotPicker(null);
                  }}
                  scaleTo={0.98}
                  radius={S.radiusSm}
                  style={st.pickRow}
                >
                  <Ionicons name={t.icon as any} size={20} color={colorOf(t.colorKey)} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={[T.body, { fontFamily: active ? F.semi : F.med }]}>{t.label}</Text>
                    <Text style={[T.caption, { marginTop: 1 }]} numberOfLines={1}>
                      {elsewhere >= 0 && !active ? 'Now in slot ' + (elsewhere + 1) + '. Picking it swaps the two.' : t.desc}
                    </Text>
                  </View>
                  {active ? <Ionicons name="checkmark" size={18} color={C.accent} /> : null}
                </Bouncy>
              </View>
            );
          })}
        </Sheet>

        <SectionTitle>Animations</SectionTitle>
        <Card pad={10}>
          <OptionPicker options={ANIMS} value={settings.animLevel} onPick={(k) => setSetting('animLevel', k)} />
        </Card>

        <SectionTitle>Time & reminders</SectionTitle>
        <Card>
          <Row style={{ justifyContent: 'space-between', marginBottom: 12 }}>
            <Text style={T.body}>24-hour time</Text>
            <Toggle value={settings.hour24} onChange={(v) => setSetting('hour24', v)} color={C.accent} />
          </Row>
          <Hairline />
          <Row style={{ justifyContent: 'space-between', marginTop: 12 }}>
            <Row>
              <Text style={T.body}>All reminders (master)</Text>
              <InfoDot text="The master switch for every notification. Habit times live in Planner → Streaks; ToDo nudges in Tasks → bell icon." />
            </Row>
            <Toggle value={settings.remindersEnabled} onChange={toggleReminders} color={C.green} />
          </Row>
        </Card>

        <SectionTitle>Privacy</SectionTitle>
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={[T.body, { fontFamily: F.med }]}>Lock journal</Text>
              <Text style={[T.caption, { marginTop: 2 }]}>
                {lockedNotes > 0
                  ? lockedNotes + (lockedNotes === 1 ? ' note is locked too.' : ' notes are locked too.')
                  : 'Single notes lock from their menu.'}
              </Text>
            </View>
            <Toggle value={settings.journalLocked} onChange={setJournalLock} color={C.gold} />
          </Row>
          <Hairline />
          <Text style={[st.label, { marginTop: 10, marginBottom: 8 }]}>Re-lock after</Text>
          <SegmentedControl
            size="sm"
            stretch
            value={String(settings.lockGraceSec)}
            onChange={(k) => setSetting('lockGraceSec', Number(k))}
            options={[{ key: '0', label: 'Immediately' }, { key: '90', label: '90 s' }, { key: '300', label: '5 min' }]}
          />
          <Hairline />
          <Row style={{ justifyContent: 'space-between', marginTop: 10 }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={[T.body, { fontFamily: F.med }]}>App PIN</Text>
              <Text style={[T.caption, { marginTop: 2 }]}>
                {pinSet
                  ? 'Asked for when fingerprint or face is not available.'
                  : deviceLock
                    ? 'Optional. Your screen lock already protects locked content.'
                    : 'Needed for locks, because this phone has no screen lock.'}
              </Text>
            </View>
            <PillButton small outline label={pinSet ? 'Change PIN' : 'Set PIN'} onPress={changePin} />
          </Row>
          {pinSet ? (
            <PillButton small outline color={C.danger} label="Remove PIN" onPress={dropPin} style={{ marginTop: 10, alignSelf: 'flex-end' }} />
          ) : null}
          <Text style={[T.caption, { marginTop: 14 }]}>
            Locks hide content behind your fingerprint, face or PIN. Backups still include everything, so keep them somewhere safe.
          </Text>
        </Card>
        <PinSheet visible={!!pinStep} mode={pinStep?.mode ?? 'enter'} onClose={() => setPinStep(null)} onDone={pinDone} />

        <SectionTitle right={<InfoDot text="Everything is stored locally on this phone — no accounts. Export a JSON backup before changing phones; importing replaces all current data." />}>
          Data — you own it
        </SectionTitle>
        <Card>
          <PillButton label="Export backup (JSON)" icon="download-outline" onPress={() => exportData()} style={{ marginBottom: 10 }} />
          <PillButton label="Import backup" icon="push-outline" color={C.amber} outline onPress={importData} />
          {recovery ? (
            <View style={st.recovery}>
              <Text style={st.recoveryTitle}>A copy of data that could not be opened</Text>
              <Text style={st.recoveryBody}>
                It was set aside so nothing is lost. Share it to keep it safe, or restore it after updating the app.
              </Text>
              <PillButton label="Share copy" icon="share-outline" outline onPress={shareRecovery} style={{ marginTop: 12 }} />
              <PillButton label="Restore copy" icon="refresh-outline" color={C.amber} outline onPress={restoreRecovery} style={{ marginTop: 10 }} />
              <PillButton label="Delete copy" icon="trash-outline" color={C.danger} outline onPress={discardRecovery} style={{ marginTop: 10 }} />
            </View>
          ) : null}
        </Card>

        <SectionTitle right={<InfoDot text="Sideloaded APKs don't auto-update. This checks the GitHub Releases of the repo below for a newer version tag and links you to the download." />}>
          Updates
        </SectionTitle>
        <Card>
          <Text style={st.label}>GitHub repo (owner/repo)</Text>
          <Field value={settings.githubRepo} onChangeText={(v) => setSetting('githubRepo', v)}
            placeholder="e.g. sanjay/sturoids" autoCapitalize="none" />
          <PillButton label={checking ? 'Checking…' : 'Check for updates'} icon="cloud-download-outline" onPress={checkUpdate} />
        </Card>

        <Text style={[T.caption, { textAlign: 'center', marginTop: 16 }]}>
          Sturoids v{APP_VERSION} · local-first · made for focused work
        </Text>
      </ScrollView>
    </ScreenBG>
  );
}

const st = StyleSheet.create({
  recovery: {
    marginTop: 16, paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.hairline,
  },
  recoveryTitle: { ...T.label, color: C.text },
  recoveryBody: { ...T.caption, marginTop: 4 },
  slotRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 10 },
  slotIndex: { width: 58, color: C.textFaint, fontFamily: F.med, fontSize: 12, letterSpacing: 0.2 },
  pickRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 4 },
  label: { color: C.textDim, fontFamily: F.med, fontSize: 13, marginBottom: 8 },
  hint: { color: C.textFaint, fontSize: 12, marginTop: 10, lineHeight: 17 },
  optRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 6 },
  radioWell: {
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  swatchWell: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
  },
  swatchDisc: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
  },
});
