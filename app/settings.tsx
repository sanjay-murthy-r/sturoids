import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, Linking, AppState } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { C, F, MIN, S, T, ThemeMode, AnimLevel, ACCENT_CHOICES, neuInset, neuRaised } from '../src/theme';
import { useStore, exportSnapshot, importSnapshot, readRecoveryCopy, deleteRecoveryCopy, flushSaves } from '../src/store';
import { compareVersions, todayKey } from '../src/utils';
import { ScreenBG, Card, SectionTitle, Field, PillButton, Row, Hairline, Toggle, InfoDot, NeuHeader, Sheet, useTheme } from '../src/components/UI';
import { toast } from '../src/components/Toast';
import { Bouncy, CHANGE, EASE_OUT, FadeSwap, rowIn, useAnimLevel, useBuilt } from '../src/components/Motion';
import { tick } from '../src/haptics';
import { SegmentedControl } from '../src/components/SegmentedControl';
import { PinSheet } from '../src/components/LockGate';
import { journalForBackup, restoreBodies } from '../src/journal';
import { estimateBackupBytes, openBackup, restoredPath, writeBackup } from '../src/backup';
import { deviceAuthAvailable, isOpen, markOpen, pinStatus, removePin } from '../src/lock';
import { ensurePermission, rescheduleAllReminders } from '../src/notifications';
import { TOOLS, Tool, ToolKey, colorOf, normaliseArchived, normaliseSlots, toolByKey } from '../src/tools';
import { ToolArchiveSheet } from '../src/components/ToolArchiveSheet';

// keep this fallback in step with app.json — it also seeds the update check's comparison below
const APP_VERSION = Constants.expoConfig?.version || '1.5.0';

const THEMES: { key: ThemeMode; label: string; desc: string }[] = [
  { key: 'default', label: 'Default', desc: 'Soft grey neumorphism, one continuous material' },
  { key: 'minimal', label: 'Minimalistic', desc: 'High contrast, flat, maximum legibility' },
];


const ANIMS: { key: AnimLevel; label: string; desc: string }[] = [
  { key: 'none', label: 'Off', desc: 'No motion at all' },
  { key: 'some', label: 'Some', desc: 'Feedback only: taps and state changes' },
  { key: 'full', label: 'Everything', desc: 'Entrances, pages and lists move too' },
];

const GRACE_OPTIONS = [{ key: '0', label: 'Immediately' }, { key: '90', label: '90 s' }, { key: '300', label: '5 min' }];

/** how long typing may pause before the words reach the store */
const DRAFT_PAUSE_MS = 300;

/** The last value that was not null, so a sheet keeps what it shows while it closes. */
function useHeld<T>(value: T | null): T | null {
  const held = useRef(value);
  if (value != null) held.current = value;
  return held.current;
}

/**
 * A setting typed as words. They stay in the field while they are typed and reach the store after a short pause, as
 * the field is left, as the page closes and as the app goes to the background, so a keystroke re-renders the field
 * and never the whole page (or Today behind it). A change made elsewhere (Today's name sheet, a restored backup)
 * shows here, unless words are still on their way.
 */
function useSettingDraft(key: 'name' | 'githubRepo') {
  const stored = useStore((s) => s.settings[key]);
  const [draft, setDraft] = useState(stored);
  const draftRef = useRef(stored);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commit = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const s = useStore.getState();
    if (s.settings[key] !== draftRef.current) s.setSetting(key, draftRef.current);
  }, [key]);
  useEffect(() => {
    if (timer.current || stored === draftRef.current) return;
    draftRef.current = stored;
    setDraft(stored);
  }, [stored]);
  // the page closing mid-word still keeps the word; leaving the app writes it at once
  useEffect(() => commit, [commit]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active' && timer.current) {
        commit();
        flushSaves();
      }
    });
    return () => sub.remove();
  }, [commit]);
  const change = useCallback((v: string) => {
    draftRef.current = v;
    setDraft(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(commit, DRAFT_PAUSE_MS);
  }, [commit]);
  return { draft, change, commit };
}

/**
 * The chosen option's dot. It comes up out of its well as it is chosen (a spring at full motion: the one thing under
 * the finger), and the dot it replaces fades back into its own well instead of vanishing. Drawn in its state on its
 * first paint, so opening Settings pops nothing.
 */
function RadioDot({ active, minimal }: { active: boolean; minimal: boolean }) {
  const level = useAnimLevel();
  const on = useSharedValue(active ? 1 : 0);
  const scale = useSharedValue(1);
  const was = useRef(active);
  useEffect(() => {
    if (was.current === active) return;
    was.current = active;
    if (level === 'none') {
      on.value = active ? 1 : 0;
      scale.value = 1;
      return;
    }
    if (active) {
      on.value = withTiming(1, CHANGE);
      if (level === 'full') {
        scale.value = 0.7;
        scale.value = withSpring(1, { damping: 16, stiffness: 300, mass: 0.6 });
      } else {
        scale.value = 0.85;
        scale.value = withTiming(1, { duration: 180, easing: EASE_OUT });
      }
    } else {
      on.value = withTiming(0, { duration: 160, easing: EASE_OUT });
    }
  }, [active, level]);
  const aStyle = useAnimatedStyle(() => ({ opacity: on.value, transform: [{ scale: scale.value }] }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[st.radioDot, { backgroundColor: C.accent }, minimal ? null : (neuRaised('low') as object), aStyle]}
    />
  );
}

/** One option of a radio list, memoised: a pick re-renders the two rows it changes. */
const OptionRow = React.memo(function OptionRow({ k, label, desc, active, first, onPick }: {
  k: string; label: string; desc: string; active: boolean; first: boolean; onPick: (k: string) => void;
}) {
  // the dot and the minimal well's rim are in the accent: the row follows a new accent and theme itself
  const theme = useTheme();
  return (
    <View>
      {first ? null : <Hairline />}
      <Bouncy
        onPress={() => { tick(); onPick(k); }} scaleTo={0.98} radius={S.radiusSm} style={st.optRow}
        accessibilityRole="button" accessibilityState={{ selected: active }}
      >
        <View
          style={[
            st.radioWell,
            theme === 'minimal'
              ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: active ? C.accent : MIN.border }
              : { backgroundColor: C.inset, ...neuInset('low') },
          ]}
        >
          <RadioDot active={active} minimal={theme === 'minimal'} />
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={[T.body, { fontFamily: active ? F.semi : F.med }]}>{label}</Text>
          <Text style={[T.caption, { marginTop: 1 }]}>{desc}</Text>
        </View>
      </Bouncy>
    </View>
  );
});

/**
 * Radio list. Declared at module scope: a component defined inside Settings'
 * render would be a NEW component type every render, remounting the whole list
 * (and every press/pop animation in it) on each settings change.
 */
function OptionPickerBase<K extends string>({
  options, value, onPick,
}: { options: { key: K; label: string; desc: string }[]; value: K; onPick: (k: K) => void }) {
  return (
    <View>
      {options.map((o, i) => (
        <OptionRow
          key={o.key} k={o.key} label={o.label} desc={o.desc} active={value === o.key} first={i === 0}
          onPick={onPick as (k: string) => void}
        />
      ))}
    </View>
  );
}
const OptionPicker = React.memo(OptionPickerBase) as typeof OptionPickerBase;

/**
 * One accent. Flat: a ring in its own colour marks the chosen one, and the ring and the tick cross over as the choice
 * moves, instead of jumping.
 */
const Swatch = React.memo(function Swatch({ choice, active, onPick }: {
  choice: { key: string; label: string; color: string }; active: boolean; onPick: (color: string) => void;
}) {
  const level = useAnimLevel();
  const on = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    on.value = level === 'none' ? (active ? 1 : 0) : withTiming(active ? 1 : 0, CHANGE);
  }, [active, level]);
  const ringStyle = useAnimatedStyle(() => ({ opacity: on.value }));
  const markStyle = useAnimatedStyle(() => ({ opacity: on.value, transform: [{ scale: 0.6 + 0.4 * on.value }] }));
  return (
    <Bouncy
      onPress={() => { tick(); onPick(choice.color); }}
      scaleTo={0.85}
      radius={22}
      style={st.swatchWell}
      accessibilityRole="button" accessibilityLabel={choice.label} accessibilityState={{ selected: active }}
    >
      <Animated.View pointerEvents="none" style={[st.swatchRing, { borderColor: choice.color }, ringStyle]} />
      <View style={[st.swatchDisc, { backgroundColor: choice.color }]}>
        <Animated.View style={markStyle}>
          <Ionicons name="checkmark" size={14} color={C.onAccent} />
        </Animated.View>
      </View>
    </Bouncy>
  );
});

/** The accent swatches and the line naming the one in use, which dips and comes back with the new name. */
const AccentCard = React.memo(function AccentCard() {
  const accent = useStore((s) => s.settings.accent);
  const setSetting = useStore((s) => s.setSetting);
  const pick = useCallback((color: string) => setSetting('accent', color), [setSetting]);
  const name = ACCENT_CHOICES.find((a) => a.color === accent)?.label || 'Custom';
  return (
    <Card>
      <Row style={{ flexWrap: 'wrap', gap: 12 }}>
        {ACCENT_CHOICES.map((a) => (
          <Swatch key={a.key} choice={a} active={accent === a.color} onPick={pick} />
        ))}
      </Row>
      <FadeSwap swapKey={name}>
        <Text style={st.hint}>{name}. Recolours highlights, links and controls everywhere.</Text>
      </FadeSwap>
    </Card>
  );
});

/** The name the greeting uses. What is typed stays in this card until a pause (see useSettingDraft). */
const ProfileCard = React.memo(function ProfileCard() {
  const name = useSettingDraft('name');
  return (
    <Card>
      <Text style={st.label}>Name (used in the greeting)</Text>
      <Field value={name.draft} onChangeText={name.change} onBlur={name.commit} placeholder="Your name" />
    </Card>
  );
});

/** One bar slot, memoised: a new tool in it dips in where the old one was. */
const SlotRow = React.memo(function SlotRow({ index, toolKey, onOpen }: {
  index: number; toolKey: ToolKey; onOpen: (i: number) => void;
}) {
  useTheme(); // a tool's colour can be the accent
  const tool = toolByKey(toolKey);
  return (
    <View>
      {index > 0 && <Hairline />}
      <Bouncy onPress={() => { tick(); onOpen(index); }} scaleTo={0.98} radius={S.radiusSm} style={st.slotRow}>
        <Text style={st.slotIndex}>Slot {index + 1}</Text>
        <FadeSwap swapKey={toolKey} style={st.slotTool}>
          <Ionicons name={(tool?.icon || 'ellipse-outline') as any} size={19} color={colorOf(tool?.colorKey)} />
          <Text style={[T.body, { flex: 1, marginLeft: 10, fontFamily: F.med }]} numberOfLines={1}>{tool?.label}</Text>
        </FadeSwap>
        <Ionicons name="chevron-forward" size={17} color={C.textFaint} />
      </Bouncy>
    </View>
  );
});

/** One tool a slot can hold, memoised. */
const PickRow = React.memo(function PickRow({ tool, first, active, elsewhere, archived, onPick }: {
  tool: Tool; first: boolean; active: boolean;
  /** the slot it is in now, or -1 */
  elsewhere: number;
  archived: boolean;
  onPick: (key: ToolKey) => void;
}) {
  useTheme(); // the tick and a tool's colour can be the accent
  return (
    <View>
      {first ? null : <Hairline />}
      <Bouncy onPress={() => onPick(tool.key)} scaleTo={0.98} radius={S.radiusSm} style={st.pickRow}>
        <Ionicons name={tool.icon as any} size={20} color={colorOf(tool.colorKey)} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={[T.body, { fontFamily: active ? F.semi : F.med }]}>{tool.label}</Text>
          <Text style={[T.caption, { marginTop: 1 }]} numberOfLines={1}>
            {elsewhere >= 0 && !active
              ? 'Now in slot ' + (elsewhere + 1) + '. Picking it swaps the two.'
              : archived ? 'Archived. Picking it restores it.' : tool.desc}
          </Text>
        </View>
        {active ? <Ionicons name="checkmark" size={18} color={C.accent} /> : null}
      </Bouncy>
    </View>
  );
});

/**
 * The bar's three slots, what is archived, and the sheets that change them. It follows the slots itself, so a pick
 * re-renders this section and not the whole page.
 */
const ToolsSection = React.memo(function ToolsSection() {
  const rawSlots = useStore((s) => s.settings.tabSlots);
  const rawArchived = useStore((s) => s.settings.archivedTools);
  const setTabSlots = useStore((s) => s.setTabSlots);
  const slots = React.useMemo(() => normaliseSlots(rawSlots), [rawSlots]);
  const archived = React.useMemo(() => normaliseArchived(rawArchived, slots), [rawArchived, slots]);
  const [slotPicker, setSlotPicker] = useState<number | null>(null);
  const [archiveSheet, setArchiveSheet] = useState(false);
  // the picker keeps what it showed while it closes (the slot, its tick, the captions), so a pick never reshuffles the
  // list on its way out: the slot row behind it takes the new tool
  const view = useHeld(slotPicker !== null ? { slot: slotPicker, slots, archived } : null);
  // the slot being chosen for, read when a row is tapped; a second tap while the sheet leaves changes nothing
  const pickerRef = useRef<number | null>(null);
  pickerRef.current = slotPicker;
  const openSlot = useCallback((i: number) => setSlotPicker(i), []);
  const closePicker = useCallback(() => setSlotPicker(null), []);
  const pick = useCallback((key: ToolKey) => {
    const i = pickerRef.current;
    if (i === null) return;
    pickerRef.current = null;
    const next = normaliseSlots(useStore.getState().settings.tabSlots);
    if (next[i] !== key) {
      tick();
      const j = next.indexOf(key);
      if (j >= 0 && j !== i) next[j] = next[i]; // swap so no destination repeats
      next[i] = key;
      setTabSlots(next); // a slotted tool is restored if it was archived
    }
    setSlotPicker(null);
  }, [setTabSlots]);
  const archivedLine = archived.length ? archived.map((k) => toolByKey(k)?.label).join(', ') : 'Nothing archived';

  return (
    <>
      <SectionTitle right={<InfoDot text="Today and More stay fixed. Tools placed in a slot open as tabs; the rest live in More. Archived tools stay out of sight until you restore them." />}>
        Tools
      </SectionTitle>
      <Card pad={6}>
        {slots.map((key, i) => <SlotRow key={i} index={i} toolKey={key} onOpen={openSlot} />)}
        <Hairline />
        <Bouncy onPress={() => { tick(); setArchiveSheet(true); }} scaleTo={0.98} radius={S.radiusSm} style={st.slotRow}>
          <Text style={st.slotIndex}>Archived</Text>
          <Ionicons name="archive-outline" size={19} color={C.textDim} />
          <FadeSwap swapKey={archivedLine} style={st.archivedLine}>
            <Text style={[T.body, { fontFamily: F.med }]} numberOfLines={1}>{archivedLine}</Text>
          </FadeSwap>
          <Ionicons name="chevron-forward" size={17} color={C.textFaint} />
        </Bouncy>
      </Card>
      <ToolArchiveSheet manage visible={archiveSheet} onClose={() => setArchiveSheet(false)} />
      <Sheet visible={slotPicker !== null} onClose={closePicker} title="Choose a tool">
        {view ? TOOLS.map((t, k) => (
          <PickRow
            key={t.key} tool={t} first={k === 0} active={view.slots[view.slot] === t.key}
            elsewhere={view.slots.indexOf(t.key)} archived={view.archived.includes(t.key)} onPick={pick}
          />
        )) : null}
      </Sheet>
    </>
  );
});

/** The update check, with the repo it reads typed in place (see useSettingDraft). */
const UpdatesCard = React.memo(function UpdatesCard() {
  const repoDraft = useSettingDraft('githubRepo');
  const [checking, setChecking] = useState(false);

  const checkUpdate = async () => {
    // what is in the field is what is checked, and it is kept, even if the pause has not come yet
    repoDraft.commit();
    const repo = repoDraft.draft.trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
      toast('Enter the repo as owner/repo first.');
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
        toast('Up to date: v' + APP_VERSION + ' is the newest release.');
      }
    } catch (e: any) {
      Alert.alert('Check failed', String(e?.message || e));
    } finally {
      setChecking(false);
    }
  };

  return (
    <Card>
      <Text style={st.label}>GitHub repo (owner/repo)</Text>
      <Field value={repoDraft.draft} onChangeText={repoDraft.change} onBlur={repoDraft.commit}
        placeholder="e.g. sanjay/sturoids" autoCapitalize="none" />
      <PillButton label={checking ? 'Checking…' : 'Check for updates'} icon="cloud-download-outline" onPress={checkUpdate} />
    </Card>
  );
});

export default function Settings() {
  useTheme(); // a new accent or theme repaints the page's toggles and pills, which take the accent as a prop
  const level = useAnimLevel();
  // parts that turn up after the first paint (the screen-lock choices, a kept copy, Remove PIN) fade in where they
  // stand. They leave at once: this page's cards do not glide, so a fading ghost would lie over the lines moving up
  const built = useBuilt();
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const pickTheme = useCallback((k: ThemeMode) => setSetting('theme', k), [setSetting]);
  const pickAnim = useCallback((k: AnimLevel) => setSetting('animLevel', k), [setSetting]);

  const toggleReminders = async (v: boolean) => {
    if (v) {
      const ok = await ensurePermission();
      if (!ok) { toast('Allow notifications in system settings first.'); return; }
    }
    setSetting('remindersEnabled', v);
    setTimeout(rescheduleAllReminders, 200);
  };

  // the PIN, given for this one backup: it authorises the export without opening anything
  const exportAllowed = useRef(false);

  // a backup with long videos takes a while to write or restore: its button shows how far along it is
  const [busy, setBusy] = useState<null | { kind: 'export' | 'import'; pct: number }>(null);
  const busyRef = useRef(false);
  const progressOf = (kind: 'export' | 'import') => (share: number) => {
    const pct = Math.round(share * 100);
    setBusy((b) => (b && b.kind === kind && b.pct === pct ? b : { kind, pct }));
  };

  const exportData = async () => {
    if (busyRef.current) return;
    // a backup carries locked pages in full, so it asks for the PIN whenever anything is locked
    const s = useStore.getState();
    const anyLock = s.settings.journalLocked || s.settings.notesLocked || s.notes.some((n) => n.locked);
    if (anyLock && !exportAllowed.current && (await pinStatus()) !== 'none') {
      setPinStep({ mode: 'enter', for: 'export' });
      return;
    }
    exportAllowed.current = false;
    busyRef.current = true;
    try {
      const snap = exportSnapshot();
      // journal text lives in files, so the backup carries it inline; the notes' attachments follow the data
      const json = JSON.stringify({ ...snap, journal: await journalForBackup(snap.journal) }, null, 2);
      const need = await estimateBackupBytes(json, snap.notes);
      const free = await FileSystem.getFreeDiskStorageAsync().catch(() => Number.MAX_SAFE_INTEGER);
      // the backup is written to this phone before it is shared, so it needs the room, with a little to spare
      if (need + 10 * 1024 * 1024 > free) {
        Alert.alert('Not enough space', 'This backup needs about ' + Math.ceil(need / (1024 * 1024)) + ' MB free, with its attachments.');
        return;
      }
      // an earlier backup left in the cache can be large now: only the newest is kept
      const cached = await FileSystem.readDirectoryAsync(FileSystem.cacheDirectory || '').catch(() => [] as string[]);
      await Promise.all(cached.filter((n) => n.startsWith('sturoids-backup-'))
        .map((n) => FileSystem.deleteAsync(FileSystem.cacheDirectory + n, { idempotent: true }).catch(() => {})));
      const uri = FileSystem.cacheDirectory + 'sturoids-backup-' + todayKey() + '.json';
      setBusy({ kind: 'export', pct: 0 });
      const written = await writeBackup(uri, json, snap.notes, progressOf('export'));
      setBusy(null);
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/json' });
      else Alert.alert('Saved', 'Backup written to:\n' + uri);
      if (written.missing) {
        toast(written.missing === 1
          ? 'One attachment was no longer on this phone, so it is not in the backup.'
          : written.missing + ' attachments were no longer on this phone, so they are not in the backup.');
      }
    } catch (e: any) {
      Alert.alert('Export failed', String(e?.message || e));
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  const importData = async () => {
    if (busyRef.current) return;
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      const backup = await openBackup(res.assets[0].uri);
      Alert.alert(
        'Replace everything?',
        'This replaces all current data with the backup. Calculator history is cleared and any running Deep Work session ends.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Replace', style: 'destructive',
            onPress: async () => {
              if (busyRef.current) return;
              busyRef.current = true;
              const ok = importSnapshot(backup.json);
              let carried = 0;
              let complete = true;
              try {
                if (ok) {
                  try {
                    await restoreBodies(JSON.parse(backup.json)?.journal);
                  } catch {
                    // the index is restored either way; text that fails to write stays in the backup file
                  }
                  if (backup.hasFiles) {
                    // each note's attachments come back into the app's own folder, and the notes point at them
                    const byId = new Map(useStore.getState().notes.flatMap((n) => n.attachments).map((a) => [a.id, a]));
                    setBusy({ kind: 'import', pct: 0 });
                    const restored = await backup.restoreFiles((id) => {
                      const a = byId.get(id);
                      return a ? restoredPath(a) : null;
                    }, progressOf('import'));
                    useStore.getState().relinkAttachments(restored.files);
                    carried = Object.keys(restored.files).length;
                    complete = restored.complete;
                  }
                  rescheduleAllReminders();
                }
              } finally {
                busyRef.current = false;
                setBusy(null);
              }
              Alert.alert(
                ok ? 'Imported' : 'Not a Sturoids backup',
                !ok ? 'That file could not be read as a backup.'
                  : !complete ? 'Your data is restored, but the backup file ends early, so some attachments could not be restored.'
                    : carried ? 'Your data is restored, with ' + carried + (carried === 1 ? ' attachment.' : ' attachments.')
                      : 'Your data is restored.'
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

  // ---- privacy: what is locked, what may open it, the app PIN, and how soon an open lock closes again ----
  const lockedNotes = useStore((s) => s.notes.filter((n) => n.locked).length);
  const [pinState, setPinState] = useState<'set' | 'legacy' | 'none'>('none');
  // until the PIN's state has been read, its line is shown as it was; only a later change dips and swaps it
  const [pinKnown, setPinKnown] = useState(false);
  const [deviceLock, setDeviceLock] = useState(false);
  /** what a PIN step is for decides what happens once it is done */
  type PinFor = 'journal-on' | 'notes-on' | 'journal-off' | 'notes-off' | 'journal-screen' | 'notes-screen'
    | 'change' | 'remove' | 'export';
  const [pinStep, setPinStep] = useState<null | { mode: 'enter' | 'set'; for: PinFor }>(null);
  const refreshLockInfo = () => {
    pinStatus().then((s) => {
      setPinState(s);
      setPinKnown(true);
    });
    deviceAuthAvailable().then(setDeviceLock);
  };
  useEffect(refreshLockInfo, []);

  const setToolLock = async (tool: 'journal' | 'notes', on: boolean) => {
    const key = tool === 'journal' ? 'journalLocked' : 'notesLocked';
    const status = await pinStatus();
    if (on) {
      // locking asks nothing, but a lock needs a PIN to open it: one is chosen first when there is none yet
      if (status === 'set') {
        setSetting(key, true);
        markOpen(tool);
      } else {
        setPinStep({ mode: 'set', for: tool === 'journal' ? 'journal-on' : 'notes-on' });
      }
      return;
    }
    // taking a lock off asks for the PIN, unless that lock is open right now or there is nothing to check against
    if (isOpen(tool) || status === 'none') setSetting(key, false);
    else setPinStep({ mode: 'enter', for: tool === 'journal' ? 'journal-off' : 'notes-off' });
  };

  const setScreenLock = async (tool: 'journal' | 'notes', on: boolean) => {
    const key = tool === 'journal' ? 'journalScreenLock' : 'notesScreenLock';
    // one way in fewer asks nothing; another way in is the owner's call, confirmed with the PIN
    if (!on || (await pinStatus()) === 'none') setSetting(key, on);
    else setPinStep({ mode: 'enter', for: tool === 'journal' ? 'journal-screen' : 'notes-screen' });
  };

  const pinDone = () => {
    const step = pinStep;
    setPinStep(null);
    refreshLockInfo();
    if (!step) return;
    switch (step.for) {
      case 'journal-on': setSetting('journalLocked', true); markOpen('journal'); break;
      case 'notes-on': setSetting('notesLocked', true); markOpen('notes'); break;
      case 'journal-off': setSetting('journalLocked', false); break;
      case 'notes-off': setSetting('notesLocked', false); break;
      case 'journal-screen': setSetting('journalScreenLock', true); break;
      case 'notes-screen': setSetting('notesScreenLock', true); break;
      case 'remove': removePin().then(refreshLockInfo); break;
      case 'export': exportAllowed.current = true; exportData(); break;
      case 'change': toast('Your new PIN is set.'); break;
    }
  };
  const pinTint = pinStep?.for.startsWith('journal') ? C.gold : pinStep?.for.startsWith('notes') ? C.green : C.accent;
  const pinInUse = settings.journalLocked || settings.notesLocked === true || lockedNotes > 0;
  const pinLine = (
    <Text style={[T.caption, { marginTop: 2 }]}>
      {pinState === 'set'
        ? 'Four digits. It opens everything that locks.'
        : pinState === 'legacy'
          ? 'Your older PIN or passcode works once more; then you choose a 4-digit PIN.'
          : 'Chosen the first time something locks.'}
    </Text>
  );
  const arrive = built.current ? rowIn(level) : undefined;

  return (
    <ScreenBG>
      <NeuHeader title="Settings" />
      <ScrollView contentContainerStyle={{ padding: S.pad, paddingTop: 4, paddingBottom: 40 }}>
        <SectionTitle>Profile</SectionTitle>
        <ProfileCard />

        <SectionTitle>Appearance</SectionTitle>
        <Card pad={12}>
          <OptionPicker options={THEMES} value={settings.theme} onPick={pickTheme} />
        </Card>

        <SectionTitle>Accent colour</SectionTitle>
        <AccentCard />

        <ToolsSection />

        <SectionTitle>Animations</SectionTitle>
        <Card pad={12}>
          <OptionPicker options={ANIMS} value={settings.animLevel} onPick={pickAnim} />
        </Card>

        <SectionTitle>Start screen</SectionTitle>
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={[T.body, { fontFamily: F.med }]}>Disable the big signature</Text>
              <Text style={[T.caption, { marginTop: 2 }]}>
                The logo and the words come first; the signature is written below them, a little faster.
              </Text>
            </View>
            <Toggle
              value={settings.introStyle === 'logo'}
              onChange={(v) => setSetting('introStyle', v ? 'logo' : 'signed')}
              color={C.accent}
              label="Disable the big signature"
            />
          </Row>
        </Card>

        <SectionTitle>Time & reminders</SectionTitle>
        <Card>
          <Row style={{ justifyContent: 'space-between', marginBottom: 12 }}>
            <Text style={T.body}>24-hour time</Text>
            <Toggle value={settings.hour24} onChange={(v) => setSetting('hour24', v)} color={C.accent} label="24-hour time" />
          </Row>
          <Hairline />
          <Row style={{ justifyContent: 'space-between', marginTop: 12 }}>
            <Row>
              <Text style={T.body}>All reminders (master)</Text>
              <InfoDot text="The master switch for every notification. Habit times live in Planner → Streaks; ToDo nudges in Tasks → bell icon." />
            </Row>
            <Toggle value={settings.remindersEnabled} onChange={toggleReminders} color={C.green} label="All reminders" />
          </Row>
        </Card>

        <SectionTitle>Deep Work</SectionTitle>
        <Card>
          <Row style={{ justifyContent: 'space-between', marginBottom: 10 }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={[T.body, { fontFamily: F.med }]}>Seconds on the ambient screen</Text>
              <Text style={[T.caption, { marginTop: 2 }]}>Off, it shows whole minutes.</Text>
            </View>
            <Toggle value={settings.ambientSeconds} onChange={(v) => setSetting('ambientSeconds', v)} color={C.accent} label="Seconds on the ambient screen" />
          </Row>
          <Hairline />
          <Row style={{ justifyContent: 'space-between', marginTop: 10 }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={[T.body, { fontFamily: F.med }]}>Time of day on the ambient screen</Text>
              <Text style={[T.caption, { marginTop: 2 }]}>Shown small, above the timer.</Text>
            </View>
            <Toggle value={settings.ambientClock} onChange={(v) => setSetting('ambientClock', v)} color={C.accent} label="Time of day on the ambient screen" />
          </Row>
        </Card>

        <SectionTitle>Privacy</SectionTitle>
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={[T.body, { fontFamily: F.med }]}>Lock the journal</Text>
              <Text style={[T.caption, { marginTop: 2 }]}>Your app PIN opens it.</Text>
            </View>
            <Toggle value={settings.journalLocked} onChange={(v) => setToolLock('journal', v)} color={C.gold} label="Lock the journal" />
          </Row>
          <Hairline />
          <Row style={{ justifyContent: 'space-between', marginTop: 10 }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={[T.body, { fontFamily: F.med }]}>Lock Notes</Text>
              <FadeSwap swapKey={String(lockedNotes)}>
                <Text style={[T.caption, { marginTop: 2 }]}>
                  {'The whole tool. A single note locks from inside the note'
                    + (lockedNotes ? '; ' + lockedNotes + (lockedNotes === 1 ? ' is locked now.' : ' are locked now.') : '.')}
                </Text>
              </FadeSwap>
            </View>
            <Toggle value={settings.notesLocked === true} onChange={(v) => setToolLock('notes', v)} color={C.green} label="Lock Notes" />
          </Row>
          {deviceLock ? (
            <Animated.View entering={arrive}>
              <Hairline />
              <Text style={[st.label, { marginTop: 10, marginBottom: 4 }]}>Your screen lock can also open</Text>
              <Row style={{ justifyContent: 'space-between', marginTop: 6 }}>
                <Text style={T.body}>The journal</Text>
                <Toggle value={settings.journalScreenLock === true} onChange={(v) => setScreenLock('journal', v)} color={C.gold} label="Screen lock opens the journal" />
              </Row>
              <Row style={{ justifyContent: 'space-between', marginTop: 10 }}>
                <Text style={T.body}>Notes</Text>
                <Toggle value={settings.notesScreenLock === true} onChange={(v) => setScreenLock('notes', v)} color={C.green} label="Screen lock opens Notes" />
              </Row>
              <Text style={[T.caption, { marginTop: 8 }]}>
                Fingerprint, face or the phone's own PIN, as well as the app PIN. A locked single note always asks for the
                app PIN.
              </Text>
            </Animated.View>
          ) : null}
          <Hairline />
          <Row style={{ justifyContent: 'space-between', marginTop: 10 }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={[T.body, { fontFamily: F.med }]}>App PIN</Text>
              {pinKnown ? <FadeSwap swapKey={pinState}>{pinLine}</FadeSwap> : pinLine}
            </View>
            <PillButton
              small outline label={pinState === 'none' ? 'Set PIN' : 'Change PIN'}
              onPress={() => setPinStep({ mode: 'set', for: 'change' })}
            />
          </Row>
          {pinState !== 'none' && !pinInUse ? (
            <Animated.View entering={arrive} style={{ marginTop: 10, alignSelf: 'flex-end' }}>
              <PillButton small outline color={C.danger} label="Remove PIN" onPress={() => setPinStep({ mode: 'enter', for: 'remove' })} />
            </Animated.View>
          ) : null}
          <Hairline />
          <Text style={[st.label, { marginTop: 10, marginBottom: 8 }]}>Re-lock after</Text>
          <SegmentedControl
            size="sm"
            stretch
            value={String(settings.lockGraceSec)}
            onChange={(k) => setSetting('lockGraceSec', Number(k))}
            options={GRACE_OPTIONS}
          />
          <Text style={[T.caption, { marginTop: 14 }]}>
            Locks hide pages, they do not encrypt them. Backups still include everything, so keep them somewhere safe.
          </Text>
        </Card>
        <PinSheet
          visible={!!pinStep} mode={pinStep?.mode ?? 'enter'} tint={pinTint}
          onClose={() => setPinStep(null)} onDone={pinDone}
        />

        <SectionTitle right={<InfoDot text="Everything is stored locally on this phone, with no accounts. Export a backup before changing phones: it carries your notes' attachments too. Importing replaces all current data." />}>
          Data
        </SectionTitle>
        <Card>
          <PillButton
            label={busy?.kind === 'export' ? 'Writing backup, ' + busy.pct + '%' : 'Export backup (JSON)'}
            icon="download-outline" onPress={() => exportData()} style={{ marginBottom: 10 }}
          />
          <PillButton
            label={busy?.kind === 'import' ? 'Restoring attachments, ' + busy.pct + '%' : 'Import backup'}
            icon="push-outline" color={C.amber} outline onPress={importData}
          />
          {recovery ? (
            <Animated.View entering={arrive} style={st.recovery}>
              <Text style={st.recoveryTitle}>A copy of data that could not be opened</Text>
              <Text style={st.recoveryBody}>
                It was set aside so nothing is lost. Share it to keep it safe, or restore it after updating the app.
              </Text>
              <PillButton label="Share copy" icon="share-outline" outline onPress={shareRecovery} style={{ marginTop: 12 }} />
              <PillButton label="Restore copy" icon="refresh-outline" color={C.amber} outline onPress={restoreRecovery} style={{ marginTop: 10 }} />
              <PillButton label="Delete copy" icon="trash-outline" color={C.danger} outline onPress={discardRecovery} style={{ marginTop: 10 }} />
            </Animated.View>
          ) : null}
        </Card>

        <SectionTitle right={<InfoDot text="Sideloaded APKs don't auto-update. This checks the GitHub Releases of the repo below for a newer version tag and links you to the download." />}>
          Updates
        </SectionTitle>
        <UpdatesCard />

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
  /** a slot's tool (its icon and its name), which dips and comes back as a new tool takes the slot */
  slotTool: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  archivedLine: { flex: 1, marginLeft: 10 },
  pickRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 4 },
  label: { color: C.textDim, fontFamily: F.med, fontSize: 13, marginBottom: 8 },
  hint: { color: C.textFaint, fontFamily: F.reg, fontSize: 12, marginTop: 10, lineHeight: 17 },
  optRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 6 },
  // the dot is raised inside a carved well, so the well clips its light and shadow at the rim
  radioWell: {
    width: 22, height: 22, borderRadius: 11, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  // flat: a ring in the swatch's own colour marks the chosen one
  swatchWell: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
  },
  swatchRing: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 22, borderWidth: 2 },
  swatchDisc: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
  },
});
