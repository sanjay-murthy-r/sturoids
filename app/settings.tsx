import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Alert, Linking, AppState, BackHandler, Pressable, AccessibilityInfo } from 'react-native';
import Animated, { Easing, LayoutAnimationConfig, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { C, F, MIN, S, T, TRACK, ThemeMode, AnimLevel, ACCENT_CHOICES, bgFor, neuInset, neuRaised } from '../src/theme';
import {
  useStore, exportSnapshot, importSnapshot, readSnapshot, applySnapshot, readRecoveryCopy, deleteRecoveryCopy, flushSaves,
  savedSize, savesFailing, subscribeSaveProblems, SAVE_WARN_CHARS, ReadSnapshot,
} from '../src/store';
import { compareVersions, todayKey } from '../src/utils';
import { ScreenBG, Card, SectionTitle, Field, PillButton, Row, Hairline, Toggle, InfoDot, NeuHeader, Sheet, ListCard, ListRow, DotMenu, EdgeScroll, useTheme } from '../src/components/UI';
import { toast } from '../src/components/Toast';
import { Bouncy, CHANGE, EASE_OUT, FadeSwap, rowIn, useAnimLevel, useBuilt, useEntrance } from '../src/components/Motion';
import { tick } from '../src/haptics';
import { SegmentedControl } from '../src/components/SegmentedControl';
import { PinSheet } from '../src/components/LockGate';
import { journalForBackup, restoreBodies } from '../src/journal';
import { BackupOpened, estimateBackupBytes, openBackup, restoredPath, writeBackup } from '../src/backup';
import { deviceAuthAvailable, isOpen, markOpen, pinStatus, removePin } from '../src/lock';
import { ensurePermission, rescheduleAllReminders } from '../src/notifications';
import { afterReplace, sweepUnusedFiles } from '../src/wipe';
import { TOOLS, Tool, ToolKey, colorOf, normaliseArchived, normaliseSlots, toolByKey } from '../src/tools';
import { ToolArchiveSheet } from '../src/components/ToolArchiveSheet';
import { CloudSection, DeleteSection, ago, dayOf, locksNeedPin } from '../src/components/CloudCard';
import { useCloud } from '../src/cloud';

// keep this fallback in step with app.json — it also seeds the update check's comparison below
const APP_VERSION = Constants.expoConfig?.version || '1.6.0';

/** When the last backup file was made, kept apart from the data so it never reaches the cloud's fingerprint. */
const LAST_EXPORT_KEY = 'sturoids-last-export';

const THEMES: { key: ThemeMode; label: string; desc: string }[] = [
  { key: 'default', label: 'Default', desc: 'Soft grey with raised surfaces' },
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
  // two balanced rows (four over three), centred, so no swatch is ever left alone on a line of its own
  const half = Math.ceil(ACCENT_CHOICES.length / 2);
  const rows = [ACCENT_CHOICES.slice(0, half), ACCENT_CHOICES.slice(half)];
  return (
    <Card>
      <View style={{ gap: 12 }}>
        {rows.map((r, i) => (
          <Row key={i} style={{ justifyContent: 'center', gap: 12 }}>
            {r.map((a) => (
              <Swatch key={a.key} choice={a} active={accent === a.color} onPick={pick} />
            ))}
          </Row>
        ))}
      </View>
      <FadeSwap swapKey={name}>
        <Text style={st.hint}>{name}. Recolours highlights, links and controls everywhere.</Text>
      </FadeSwap>
    </Card>
  );
});

/**
 * A photo from the gallery, cropped square and made small (256 px, a JPEG of a few dozen KB) so it can live in the
 * settings and travel with backups and the cloud. Null when nothing was picked.
 */
async function pickPhoto(): Promise<string | null> {
  // required here: the picker and the resizer stay off the startup path
  const ImagePicker = require('expo-image-picker') as typeof import('expo-image-picker');
  const Manipulator = require('expo-image-manipulator') as typeof import('expo-image-manipulator');
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 });
  if (res.canceled || !res.assets?.[0]) return null;
  const small = await Manipulator.manipulateAsync(
    res.assets[0].uri, [{ resize: { width: 256, height: 256 } }],
    { compress: 0.72, format: Manipulator.SaveFormat.JPEG, base64: true },
  );
  return small.base64 ? 'data:image/jpeg;base64,' + small.base64 : null;
}

/** Up to two initials from a name, or from the part of an email before the @. */
function initialsOf(name: string, email: string | null): string {
  const words = (name.trim() || (email || '').split('@')[0].replace(/[._-]+/g, ' ')).split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] || '').slice(0, 1)).toUpperCase();
}

/** The profile photo, or initials on a tint of the accent when there is none. */
function Avatar({ size }: { size: number }) {
  useTheme(); // the initials' tint is the accent
  const level = useAnimLevel();
  const avatar = useStore((s) => s.settings.avatar);
  const name = useStore((s) => s.settings.name);
  const email = useCloud((c) => c.email);
  const initials = initialsOf(name, email);
  return (
    <View style={[st.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: C.accent + '26' }]}>
      {avatar ? (
        <Image source={{ uri: avatar }} style={{ width: size, height: size }} contentFit="cover" transition={level === 'none' ? 0 : 180} />
      ) : initials ? (
        <Text style={{ color: C.accent, fontFamily: F.semi, fontSize: Math.round(size * 0.38) }}>{initials}</Text>
      ) : (
        <Ionicons name="person" size={Math.round(size * 0.46)} color={C.accent} />
      )}
    </View>
  );
}

/** The photo and the name the greeting uses. What is typed stays in the field until a pause (see useSettingDraft). */
const ProfileCard = React.memo(function ProfileCard() {
  const name = useSettingDraft('name');
  const avatar = useStore((s) => s.settings.avatar);
  const setSetting = useStore((s) => s.setSetting);
  const [menu, setMenu] = useState(false);
  const choose = async () => {
    try {
      const uri = await pickPhoto();
      if (uri) { setSetting('avatar', uri); tick(); }
    } catch (e: any) {
      Alert.alert('Could not use that photo', String(e?.message || e));
    }
  };
  return (
    <Card>
      <View style={{ alignItems: 'center', marginBottom: 16 }}>
        <Bouncy
          onPress={() => (avatar ? setMenu(true) : choose())} radius={48} scaleTo={0.95}
          accessibilityRole="button" accessibilityLabel={avatar ? 'Change or remove your photo' : 'Add a photo'}
        >
          <Avatar size={88} />
        </Bouncy>
        {/* 13 px words with a slop that makes the touch about 44 tall */}
        <Pressable onPress={() => (avatar ? setMenu(true) : choose())} hitSlop={14} accessibilityRole="button">
          <Text style={[st.link, { color: C.accent, marginTop: 10 }]}>{avatar ? 'Change photo' : 'Add a photo'}</Text>
        </Pressable>
      </View>
      <Text style={st.label}>Name (used in the greeting)</Text>
      <Field
        value={name.draft} onChangeText={name.change} onBlur={name.commit} placeholder="Your name"
        autoCapitalize="words" autoComplete="name" textContentType="name"
      />
      <DotMenu
        visible={menu} onClose={() => setMenu(false)}
        items={[
          { label: 'Choose another photo', icon: 'images-outline', onPress: choose },
          { label: 'Remove photo', icon: 'trash-outline', color: C.danger, onPress: () => setSetting('avatar', '') },
        ]}
      />
    </Card>
  );
});

/** Settings' top: the photo, the name, the account and how the backup stands. Opens the Account page. */
const ProfileHeader = React.memo(function ProfileHeader({ onOpen }: { onOpen: () => void }) {
  useTheme();
  const name = useStore((s) => s.settings.name);
  const hour24 = useStore((s) => s.settings.hour24);
  // only what the header shows: a file's progress or the usage figure never re-renders it
  const cloudStatus = useCloud((c) => c.status);
  const email = useCloud((c) => c.email);
  const ready = useCloud((c) => c.ready);
  const lastSyncedAt = useCloud((c) => c.lastSyncedAt);
  const reason = useCloud((c) => c.reason);
  const lost = useCloud((c) => c.lost);
  // "Backed up 12 min ago" moves on while Settings is open
  const [, setMinute] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setMinute((n) => n + 1), 30 * 1000);
    return () => clearInterval(t);
  }, []);
  const signedIn = cloudStatus !== 'signed-out' && !!email;
  // after a launch, a signed-in student sees their account while the app looks at the cloud, never "Not signed in"
  const checking = !ready && !!email;
  const status = checking ? 'Checking backup'
    : !signedIn ? (lost ? 'You were signed out. Sign in to keep backing up.' : 'Sign in to back up to the cloud')
      : cloudStatus === 'choice'
        ? (reason === 'newer' ? 'A newer copy in the cloud needs your choice' : 'Your cloud copy can bring your data back')
        : cloudStatus === 'error' ? 'Backup needs attention'
          : cloudStatus === 'syncing' ? 'Backing up'
            : lastSyncedAt ? 'Backed up ' + ago(lastSyncedAt, hour24) : 'Not backed up yet';
  const tone = checking || (!signedIn && !lost) ? C.textFaint
    : !signedIn || cloudStatus === 'choice' || cloudStatus === 'error' ? C.amber : C.green;
  // the line dips and comes back when what it says changes, not each time "12 min ago" moves on
  const statusKey = checking ? 'checking' : !signedIn ? (lost ? 'lost' : 'out')
    : cloudStatus + ':' + (reason || '') + ':' + (cloudStatus === 'idle' ? String(lastSyncedAt) : '');
  return (
    <Card hero onPress={onOpen} pad={18}>
      <Row style={{ alignItems: 'center' }}>
        <Avatar size={60} />
        <View style={{ flex: 1, marginLeft: 16 }}>
          <Text style={T.head} numberOfLines={1}>{name.trim() || 'Your profile'}</Text>
          <Text style={[T.caption, { marginTop: 2 }]} numberOfLines={1}>{signedIn || checking ? email : 'Not signed in'}</Text>
          <Row style={{ alignItems: 'center', marginTop: 6 }}>
            <View style={[st.statusDot, { backgroundColor: tone }]} />
            <FadeSwap swapKey={statusKey}>
              <Text style={[T.caption, { color: C.textDim }]} numberOfLines={1}>{status}</Text>
            </FadeSwap>
          </Row>
        </View>
        <Ionicons name="chevron-forward" size={18} color={C.textFaint} />
      </Row>
    </Card>
  );
});

/** One category of Settings: its icon, its name, what it is set to now, and a way in. The list card draws the seams. */
function CategoryRow({ icon, title, summary, onPress, danger }: {
  icon: any; title: string; summary: string; onPress: () => void; danger?: boolean;
}) {
  return (
    <ListRow onPress={() => { tick(); onPress(); }} style={st.catRow}>
      <Ionicons name={icon} size={21} color={danger ? C.danger : C.textDim} />
      <View style={{ flex: 1, marginLeft: 14 }}>
        <Text style={[T.body, { fontFamily: F.med }, danger && { color: C.danger }]}>{title}</Text>
        <FadeSwap swapKey={summary}>
          <Text style={[T.caption, { marginTop: 1 }]} numberOfLines={1}>{summary}</Text>
        </FadeSwap>
      </View>
      <Ionicons name="chevron-forward" size={17} color={C.textFaint} />
    </ListRow>
  );
}

/**
 * The list's entrance the first time Settings opens. Whether it plays is decided once, as the list mounts: the list
 * stays mounted under an open page, so coming back from one never replays it, and a render before the stack's
 * transition starts (the PIN's state arriving) never turns it off.
 */
function Arrive({ first, index, children }: { first: boolean; index: number; children: React.ReactNode }) {
  const [play] = useState(first);
  const entrance = useEntrance(index, play);
  return <Animated.View style={entrance}>{children}</Animated.View>;
}

/** How far a page travels as it comes in or leaves, and how far the list under it drifts the other way. */
const PAGE_DRIFT = 28;
const LIST_DRIFT = 18;
/** What a page arrives on and the list returns on: quick to answer, long to settle. */
const PUSH_OUT = Easing.bezier(0.16, 1, 0.3, 1);
/** A page comes in from the right, a short way, up to full strength; at some motion it only fades in. */
const PAGE_IN = { duration: 320, easing: PUSH_OUT };
const PAGE_IN_SOME = { duration: 180, easing: EASE_OUT };
/** Going back, it leaves to the right, quicker than it came, gathering speed as it goes; at some motion it fades. */
const PAGE_OUT = { duration: 220, easing: Easing.in(Easing.quad) };
const PAGE_OUT_SOME = { duration: 160, easing: Easing.in(Easing.quad) };

type Page = 'account' | 'appearance' | 'tools' | 'motion' | 'time' | 'deepwork' | 'privacy' | 'backup' | 'updates' | 'delete';

const PAGE_TITLES: Record<Page, string> = {
  account: 'Account', appearance: 'Appearance', tools: 'Tabs and tools', motion: 'Motion and start screen',
  time: 'Time and reminders', deepwork: 'Deep Work', privacy: 'Privacy and locks', backup: 'Backup', updates: 'Updates',
  delete: 'Delete',
};
const isPage = (p: unknown): p is Page => typeof p === 'string' && Object.prototype.hasOwnProperty.call(PAGE_TITLES, p);

/** Pages that open with a heading: it sits close under the bar. A page that opens with a card keeps the full gap. */
const CARD_FIRST: Page[] = ['account', 'delete'];

/**
 * What a backup is, for the dialog that asks before it replaces everything: "From 3 Oct: 42 notes, 120 journal entries,
 * 18 exams, 6 attachments. " Only what it holds is named; a count of nothing is left out.
 */
function describeBackup(read: ReadSnapshot): string {
  const d = read.data || {};
  const count = (n: number, one: string, many: string) => (n > 0 ? n + ' ' + (n === 1 ? one : many) : '');
  const notes: any[] = Array.isArray(d.notes) ? d.notes : [];
  const parts = [
    count(notes.length, 'note', 'notes'),
    count(Array.isArray(d.journal) ? d.journal.length : 0, 'journal entry', 'journal entries'),
    count(Array.isArray(d.scores) ? d.scores.filter((n: any) => n?.kind === 'exam').length : 0, 'exam', 'exams'),
    count(notes.reduce((sum, n) => sum + (Array.isArray(n?.attachments) ? n.attachments.length : 0), 0), 'attachment', 'attachments'),
  ].filter(Boolean);
  const at = read.exportedAt ? Date.parse(read.exportedAt) : NaN;
  const year = Number.isFinite(at) ? new Date(at).getFullYear() : 0;
  const when = Number.isFinite(at) ? 'From ' + dayOf(at) + (year !== new Date().getFullYear() ? ' ' + year : '') : '';
  if (when && parts.length) return when + ': ' + parts.join(', ') + '. ';
  if (when) return when + '. ';
  if (parts.length) return 'It holds ' + parts.join(', ') + '. ';
  return '';
}

/** One bar slot, memoised: a new tool in it dips in where the old one was. */
const SlotRow = React.memo(function SlotRow({ index, toolKey, onOpen }: {
  index: number; toolKey: ToolKey; onOpen: (i: number) => void;
}) {
  useTheme(); // a tool's colour can be the accent
  const tool = toolByKey(toolKey);
  return (
    <View>
      {index > 0 && <Hairline />}
      <Bouncy
        onPress={() => { tick(); onOpen(index); }} scaleTo={0.98} radius={S.radiusSm} style={st.slotRow}
        accessibilityRole="button" accessibilityLabel={'Slot ' + (index + 1) + ', ' + (tool?.label || 'empty')}
      >
        <Text style={st.slotIndex} numberOfLines={1}>Slot {index + 1}</Text>
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
      <Bouncy
        onPress={() => onPick(tool.key)} scaleTo={0.98} radius={S.radiusSm} style={st.pickRow}
        accessibilityRole="button" accessibilityLabel={tool.label} accessibilityState={{ selected: active }}
      >
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
        Tab bar slots
      </SectionTitle>
      <Card pad={6}>
        {slots.map((key, i) => <SlotRow key={i} index={i} toolKey={key} onOpen={openSlot} />)}
        <Hairline />
        <Bouncy
          onPress={() => { tick(); setArchiveSheet(true); }} scaleTo={0.98} radius={S.radiusSm} style={st.slotRow}
          accessibilityRole="button" accessibilityLabel={'Archived tools, ' + archivedLine}
        >
          <Text style={st.slotIndex} numberOfLines={1}>Archived</Text>
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
  // set at the tap, so a second tap while GitHub answers starts no second check
  const checkingRef = useRef(false);

  const checkUpdate = async () => {
    if (checkingRef.current) return;
    // what is in the field is what is checked, and it is kept, even if the pause has not come yet
    repoDraft.commit();
    const repo = repoDraft.draft.trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
      toast('Enter the repo as owner/repo first.');
      return;
    }
    checkingRef.current = true;
    setChecking(true);
    // a check that hangs on a poor connection gives up after a while instead of saying "Checking" for ever
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10 * 1000);
    try {
      const r = await fetch('https://api.github.com/repos/' + repo + '/releases/latest', { signal: ctrl.signal });
      if (r.status === 404) throw Object.assign(new Error('That repo has no releases yet.'), { shown: true });
      if (r.status === 403 || r.status === 429) throw Object.assign(new Error('GitHub is busy. Try again in a few minutes.'), { shown: true });
      if (!r.ok) throw new Error('status ' + r.status);
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
      Alert.alert('Check failed', e?.shown ? e.message
        : e?.name === 'AbortError' ? 'GitHub did not answer in time. Try again.'
          : 'Could not reach GitHub. Check your connection and try again.');
    } finally {
      clearTimeout(timer);
      checkingRef.current = false;
      setChecking(false);
    }
  };

  return (
    <Card>
      <Text style={st.label}>GitHub repo (owner/repo)</Text>
      <Field value={repoDraft.draft} onChangeText={repoDraft.change} onBlur={repoDraft.commit}
        placeholder="e.g. sanjay/sturoids" autoCapitalize="none" autoCorrect={false}
        returnKeyType="go" onSubmitEditing={checkUpdate} />
      <PillButton label={checking ? 'Checking…' : 'Check for updates'} icon="cloud-download-outline" onPress={checkUpdate} />
    </Card>
  );
});

export default function Settings() {
  const theme = useTheme(); // a new accent or theme repaints the page's toggles and pills, which take the accent as a prop
  const level = useAnimLevel();
  const router = useRouter();
  // Settings opens on its list of categories; each opens as its own page, a layer over the list within the screen, and
  // back returns to the list. The list stays mounted under the page, so it is as it was left (its scroll included).
  // A link can name the page to open on (/settings?page=backup), read once as Settings mounts
  const params = useLocalSearchParams<{ page?: string }>();
  const [page, setPage] = useState<Page | null>(() => (isPage(params.page) ? params.page : null));
  const open = useCallback((p: Page) => setPage(p), []);
  const pageRef = useRef(page);
  pageRef.current = page;
  const back = useCallback(() => {
    if (!pageRef.current) return false;
    setPage(null);
    return true;
  }, []);
  // the page in the layer: the one open now, or the last one, held while it leaves and let go once its exit is over
  const layerRef = useRef<Page | null>(page);
  if (page) layerRef.current = page;
  const layerPage = layerRef.current;
  const [, setLayerGone] = useState(0);
  const letLayerGo = useCallback(() => {
    if (pageRef.current) return; // a page opened again while the last one left
    layerRef.current = null;
    setLayerGone((n) => n + 1);
  }, []);
  // the list under an open page drifts a little left and fades as the page comes over it, and comes back as the page
  // leaves. A change of motion level under an open page just settles it, out of sight
  const listFade = useSharedValue(page ? 0 : 1);
  const listShift = useSharedValue(0);
  const listShown = useRef(page === null);
  // the page layer moves from wherever it is: a page left while it is still coming in turns back from there, instead
  // of jumping to full strength first. A page linked to is simply there, under the stack's own transition
  const pageFade = useSharedValue(page ? 1 : 0);
  const pageShift = useSharedValue(page || level !== 'full' ? 0 : PAGE_DRIFT);
  useEffect(() => {
    const shown = page === null;
    const turned = shown !== listShown.current;
    listShown.current = shown;
    const x = shown || level !== 'full' ? 0 : -LIST_DRIFT;
    const o = shown ? 1 : 0;
    if (!turned || level === 'none') {
      listShift.value = x;
      listFade.value = o;
    } else if (level === 'some') {
      listFade.value = withTiming(o, { duration: shown ? 180 : 160, easing: EASE_OUT });
    } else {
      const ease = { duration: shown ? 300 : 240, easing: PUSH_OUT };
      listShift.value = withTiming(x, ease);
      listFade.value = withTiming(o, ease);
    }
    if (!turned || level === 'none') {
      pageFade.value = shown ? 0 : 1;
      pageShift.value = shown && level === 'full' ? PAGE_DRIFT : 0;
      // a page settled away (motion off, or the level changed while it left) lets go of its layer at once
      if (shown && layerRef.current) letLayerGo();
    } else if (!shown) {
      // a page that is not on its way out yet starts a short way to the right
      if (pageFade.value === 0) pageShift.value = level === 'full' ? PAGE_DRIFT : 0;
      pageFade.value = withTiming(1, level === 'full' ? PAGE_IN : PAGE_IN_SOME);
      pageShift.value = withTiming(0, level === 'full' ? PAGE_IN : PAGE_IN_SOME);
    } else {
      const ease = level === 'full' ? PAGE_OUT : PAGE_OUT_SOME;
      pageFade.value = withTiming(0, ease, (finished) => { if (finished) runOnJS(letLayerGo)(); });
      if (level === 'full') pageShift.value = withTiming(PAGE_DRIFT, ease);
    }
    // a screen reader hears which page opened, since the row it was on is now hidden under the page
    if (turned && !shown) AccessibilityInfo.announceForAccessibility(PAGE_TITLES[page]);
  }, [page, level]);
  const listStyle = useAnimatedStyle(() => ({ opacity: listFade.value, transform: [{ translateX: listShift.value }] }));
  const pageStyle = useAnimatedStyle(() => ({ opacity: pageFade.value, transform: [{ translateX: pageShift.value }] }));
  useFocusEffect(useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', back);
    return () => sub.remove();
  }, [back]));
  // only what the list and its pages show: a file's progress or the usage figure never re-renders all of Settings
  const cloudStatus = useCloud((c) => c.status);
  const cloudEmail = useCloud((c) => c.email);
  const cloudAuto = useCloud((c) => c.auto);
  const cloudReason = useCloud((c) => c.reason);
  const cloudLost = useCloud((c) => c.lost);
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
      if (!ok) {
        // a way to the switch that is off, not only a word about it
        Alert.alert('Notifications are off', 'Allow notifications for Sturoids in the phone\'s settings, then turn reminders on here.', [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open settings', onPress: () => { Linking.openSettings().catch(() => {}); } },
        ]);
        return;
      }
    }
    setSetting('remindersEnabled', v);
    setTimeout(rescheduleAllReminders, 200);
  };

  // the PIN, given for this one backup: it authorises the export without opening anything
  const exportAllowed = useRef(false);

  // a backup with long videos takes a while to write or restore: its button shows how far along it is, and a stage
  // that cannot count ('preparing', 'reading') says what it is doing
  const [busy, setBusy] = useState<null | { kind: 'export' | 'import'; pct: number; stage?: 'preparing' | 'reading' }>(null);
  const busyRef = useRef(false);
  const progressOf = (kind: 'export' | 'import') => (share: number) => {
    const pct = Math.round(share * 100);
    setBusy((b) => (b && b.kind === kind && b.pct === pct && !b.stage ? b : { kind, pct }));
  };

  // when the last backup file was made, for students who back up with files alone
  const [lastExport, setLastExport] = useState<number | null>(null);
  useEffect(() => {
    AsyncStorage.getItem(LAST_EXPORT_KEY).then((v) => { if (v && Number(v) > 0) setLastExport(Number(v)); }).catch(() => {});
  }, []);
  // saves that fail, and data grown large for one storage row, are said on the Backup page
  const [saveTrouble, setSaveTrouble] = useState(savesFailing);
  useEffect(() => subscribeSaveProblems(setSaveTrouble), []);
  const signedIn = cloudStatus !== 'signed-out' && !!cloudEmail;
  // a replace sends the new data over the cloud copy too, once the usual short wait has passed
  const cloudLine = signedIn && cloudAuto ? ' The copy in the cloud is replaced too.' : '';

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
    // the slow part (every journal text read, the data written out, the attachments sized) comes before any
    // percentage can be counted, so the button says what it is doing from the tap
    setBusy({ kind: 'export', pct: 0, stage: 'preparing' });
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
      const now = Date.now();
      setLastExport(now);
      AsyncStorage.setItem(LAST_EXPORT_KEY, String(now)).catch(() => {});
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

  /**
   * Picks a backup file, reads and checks it, and only then asks whether to replace everything, saying when the backup
   * was made and what it holds. Busy from the tap until the import is done or dropped; the picker's copy of the file
   * is deleted either way.
   */
  const importData = async (pinOk = false) => {
    if (busyRef.current) return;
    // an import replaces locked pages too, so it asks for the PIN first whenever anything is locked, like an export
    if (!pinOk && (await locksNeedPin())) { setPinStep({ mode: 'enter', for: 'import' }); return; }
    // asked again: a second tap may have started something while the PIN's state was read
    if (busyRef.current) return;
    busyRef.current = true;
    let picked: string | null = null;
    const finish = () => {
      busyRef.current = false;
      setBusy(null);
      if (picked) FileSystem.deleteAsync(picked, { idempotent: true }).catch(() => {});
    };
    setBusy({ kind: 'import', pct: 0, stage: 'reading' });
    try {
      // some apps hand a .json file over as plain text or as bytes: reading it decides, not its label
      const res = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'text/plain', 'application/octet-stream'], copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) { finish(); return; }
      picked = res.assets[0].uri;
      const backup = await openBackup(picked);
      // parsed once, for the check and the journal's texts alike
      let parsed: any = null;
      try { parsed = JSON.parse(backup.json); } catch { /* said just below */ }
      const read = readSnapshot(parsed);
      if (!read) {
        finish();
        Alert.alert('Not a Sturoids backup', 'That file could not be read as a backup. Nothing was changed.');
        return;
      }
      Alert.alert(
        'Replace everything?',
        describeBackup(read) + 'This replaces all current data with the backup. Calculator history is cleared and any running Deep Work session ends.' + cloudLine,
        [
          { text: 'Cancel', style: 'cancel', onPress: finish },
          {
            text: 'Replace', style: 'destructive',
            onPress: () => {
              replaceWith(read, parsed, backup)
                .catch(() => Alert.alert('Import failed', 'Something went wrong while restoring. Try the import again.'))
                .finally(finish);
            },
          },
        ],
      );
    } catch {
      finish();
      Alert.alert('Import failed', 'That file could not be opened. Save it to the phone first, then try again.');
    }
  };

  /** Replaces everything with a backup already read: the data, the journal's texts, then the attachment files. */
  const replaceWith = async (read: ReadSnapshot, parsed: any, backup: BackupOpened) => {
    const startedAt = Date.now();
    try {
      applySnapshot(read);
    } catch {
      Alert.alert('Not a Sturoids backup', 'That file could not be read as a backup. Nothing was changed.');
      return;
    }
    afterReplace();
    let carried = 0;
    let complete = true;
    try {
      await restoreBodies(parsed?.journal);
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
    // what the replaced data left behind (its journal's texts, files no note uses now) goes once the new files are in
    sweepUnusedFiles(startedAt).catch(() => {});
    Alert.alert(
      'Imported',
      !complete ? 'Your data is restored, but the backup file ends early, so some attachments could not be restored.'
        : carried ? 'Your data is restored, with ' + carried + (carried === 1 ? ' attachment.' : ' attachments.')
          : 'Your data is restored.'
    );
  };

  // a copy of saved data that could not be opened (see store.ts): share it, restore it, or let it go
  const [recovery, setRecovery] = useState<string | null>(null);
  useEffect(() => {
    readRecoveryCopy().then(setRecovery);
  }, []);
  // the kept copy holds whatever was locked when it was set aside, which the data on screen cannot tell: with a PIN
  // set, sharing or restoring it asks for the PIN
  const copyNeedsPin = async () => (await pinStatus()) !== 'none';

  const shareRecovery = async (pinOk = false) => {
    if (!recovery) return;
    if (!pinOk && (await copyNeedsPin())) { setPinStep({ mode: 'enter', for: 'share-copy' }); return; }
    try {
      const uri = FileSystem.cacheDirectory + 'sturoids-kept-copy-' + todayKey() + '.json';
      await FileSystem.writeAsStringAsync(uri, recovery);
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/json' });
      else Alert.alert('Saved', 'Copy written to:\n' + uri);
    } catch (e: any) {
      Alert.alert('Could not share the copy', String(e?.message || e));
    }
  };

  const restoreRecovery = async (pinOk = false) => {
    if (!recovery) return;
    if (!pinOk && (await copyNeedsPin())) { setPinStep({ mode: 'enter', for: 'restore-copy' }); return; }
    Alert.alert(
      'Restore the kept copy?',
      'This replaces all current data with the copy. Calculator history is cleared and any running Deep Work session ends.' + cloudLine,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore', style: 'destructive',
          onPress: async () => {
            const startedAt = Date.now();
            const ok = importSnapshot(recovery);
            if (ok) {
              afterReplace();
              await deleteRecoveryCopy();
              setRecovery(null);
              sweepUnusedFiles(startedAt).catch(() => {});
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
    | 'change' | 'remove' | 'export' | 'import' | 'share-copy' | 'restore-copy';
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
      case 'import': importData(true); break;
      case 'share-copy': shareRecovery(true); break;
      case 'restore-copy': restoreRecovery(true); break;
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

  // ---- what each category is set to now, for its row on the list ----
  const slotNames = normaliseSlots(settings.tabSlots).map((k) => toolByKey(k)?.shortLabel || toolByKey(k)?.label).join(', ');
  // the data's one storage row grown past the point Settings warns at (see store.ts)
  const largeData = (savedSize() ?? 0) > SAVE_WARN_CHARS;
  const summaries: Record<Page, string> = {
    account: signedIn
      ? cloudStatus === 'choice'
        ? (cloudReason === 'newer' ? 'A newer copy in the cloud needs your choice' : 'Your cloud copy can bring your data back')
        : (cloudEmail as string)
      : cloudLost ? 'You were signed out on this phone' : 'Profile, photo and cloud backup',
    appearance: (THEMES.find((t) => t.key === settings.theme)?.label || 'Default') + ', '
      + (ACCENT_CHOICES.find((x) => x.color === settings.accent)?.label || 'custom') + ' accent',
    tools: slotNames,
    motion: settings.animLevel === 'none' ? 'No motion'
      : (settings.animLevel === 'some' ? 'Some motion, ' : 'Full motion, ')
        + (settings.introStyle === 'logo' ? 'logo first' : 'signature first'),
    time: (settings.hour24 ? '24-hour clock' : '12-hour clock') + ', reminders ' + (settings.remindersEnabled ? 'on' : 'off'),
    deepwork: 'Ambient screen: ' + [settings.ambientSeconds ? 'seconds' : '', settings.ambientClock ? 'time of day' : '']
      .filter(Boolean).join(' and ').replace(/^$/, 'minutes only'),
    // single locked notes count too; with the whole Notes tool locked, "Notes locked" already says it
    privacy: [
      settings.journalLocked ? 'Journal locked' : '',
      settings.notesLocked ? 'Notes locked' : lockedNotes ? lockedNotes + (lockedNotes === 1 ? ' note locked' : ' notes locked') : '',
    ].filter(Boolean).join(', ') || (pinState === 'none' ? 'Nothing locked' : 'Nothing locked, PIN set'),
    backup: saveTrouble ? 'Your latest changes could not be saved'
      : recovery ? 'A kept copy is waiting'
        : lastExport ? 'Last exported ' + dayOf(lastExport) : 'Export or import a backup file',
    updates: 'Version ' + APP_VERSION,
    delete: signedIn ? 'Your account, cloud data or this phone' : 'Everything on this phone',
  };

  const pageBody = (p: Page) => {
    switch (p) {
      case 'account':
        return (
          <>
            <ProfileCard />
            <CloudSection title="Cloud backup" />
          </>
        );
      case 'appearance':
        return (
          <>
            <SectionTitle>Theme</SectionTitle>
            <Card pad={12}>
              <OptionPicker options={THEMES} value={settings.theme} onPick={pickTheme} />
            </Card>
            <SectionTitle>Accent colour</SectionTitle>
            <AccentCard />
          </>
        );
      case 'tools':
        return <ToolsSection />;
      case 'motion':
        return (
          <>
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
          </>
        );
      case 'time':
        return (
          <>
            <SectionTitle>Clock and reminders</SectionTitle>
            <Card>
              <Row style={{ justifyContent: 'space-between', marginBottom: 12 }}>
                <Text style={T.body}>24-hour time</Text>
                <Toggle value={settings.hour24} onChange={(v) => setSetting('hour24', v)} color={C.accent} label="24-hour time" />
              </Row>
              <Hairline />
              <Row style={{ justifyContent: 'space-between', marginTop: 12 }}>
                <Row>
                  <Text style={T.body}>All reminders (master)</Text>
                  <InfoDot text="The master switch for every notification. Habit times live in Planner, Streaks; ToDo nudges in Tasks, the bell icon." />
                </Row>
                <Toggle value={settings.remindersEnabled} onChange={toggleReminders} color={C.green} label="All reminders" />
              </Row>
            </Card>
          </>
        );
      case 'deepwork':
        return (
          <>
            <SectionTitle>Ambient screen</SectionTitle>
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
          </>
        );
      case 'privacy':
        return (
          <>
            <SectionTitle>Locks</SectionTitle>
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
            </Card>
            <SectionTitle>App PIN</SectionTitle>
            <Card>
              <Row style={{ justifyContent: 'space-between' }}>
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
                Locks hide pages; they do not encrypt them. Backups still include everything, so keep them somewhere safe.
              </Text>
            </Card>
          </>
        );
      case 'backup':
        return (
          <>
            <SectionTitle right={<InfoDot text="Everything lives on this phone, and in the cloud when you sign in under Account. A backup file works without an account: it carries your notes' attachments too. Importing replaces all current data." />}>
              Backup file
            </SectionTitle>
            <Card>
              <PillButton
                label={busy?.kind === 'export'
                  ? busy.stage === 'preparing' ? 'Preparing backup' : 'Writing backup, ' + busy.pct + '%'
                  : 'Export a backup file'}
                icon="download-outline" onPress={() => exportData()}
              />
              {lastExport ? (
                <Text style={[T.caption, { marginTop: 8, marginLeft: 4 }]}>Last exported {dayOf(lastExport)}</Text>
              ) : null}
              <PillButton
                label={busy?.kind === 'import'
                  ? busy.stage === 'reading' ? 'Reading backup' : 'Restoring attachments, ' + busy.pct + '%'
                  : 'Import backup'}
                icon="push-outline" color={C.amber} outline onPress={() => importData()} style={{ marginTop: lastExport ? 14 : 10 }}
              />
              {saveTrouble || largeData ? (
                <Animated.View entering={arrive} style={st.recovery}>
                  <Text style={st.recoveryTitle}>
                    {saveTrouble ? 'Your latest changes could not be saved' : 'Your data is getting large for this phone'}
                  </Text>
                  <Text style={st.recoveryBody}>
                    {saveTrouble
                      ? 'This phone could not store your last changes. Export a backup file now, so nothing is lost.'
                      : 'Long notes and lecture notes add up in the one place this phone keeps your data. Export a backup file now and then to keep a copy.'}
                  </Text>
                </Animated.View>
              ) : null}
              {recovery ? (
                <Animated.View entering={arrive} style={st.recovery}>
                  <Text style={st.recoveryTitle}>A copy of data that could not be opened</Text>
                  <Text style={st.recoveryBody}>
                    It was set aside so nothing is lost. Share it to keep it safe, or restore it after updating the app.
                  </Text>
                  <PillButton label="Share copy" icon="share-outline" outline onPress={() => shareRecovery()} style={{ marginTop: 12 }} />
                  <PillButton label="Restore copy" icon="refresh-outline" color={C.amber} outline onPress={() => restoreRecovery()} style={{ marginTop: 10 }} />
                  <PillButton label="Delete copy" icon="trash-outline" color={C.danger} outline onPress={discardRecovery} style={{ marginTop: 10 }} />
                </Animated.View>
              ) : null}
            </Card>
          </>
        );
      case 'updates':
        return (
          <>
            <SectionTitle right={<InfoDot text="Sideloaded APKs don't auto-update. This checks the GitHub Releases of the repo below for a newer version tag and links you to the download." />}>
              Check for a new version
            </SectionTitle>
            <UpdatesCard />
          </>
        );
      case 'delete':
        // after an erase the page would hold one button over nothing: back to the list, which is fresh too
        return <DeleteSection title={null} onErased={back} />;
    }
  };

  const groups: { title: string; rows: { p: Page; icon: string; danger?: boolean }[] }[] = [
    { title: 'Look and feel', rows: [{ p: 'appearance', icon: 'color-palette-outline' }, { p: 'tools', icon: 'apps-outline' }, { p: 'motion', icon: 'sparkles-outline' }] },
    { title: 'Your day', rows: [{ p: 'time', icon: 'time-outline' }, { p: 'deepwork', icon: (toolByKey('focus')?.icon || 'hourglass-outline') }, { p: 'privacy', icon: 'lock-closed-outline' }] },
    { title: 'Data', rows: [{ p: 'account', icon: 'cloud-outline' }, { p: 'backup', icon: 'archive-outline' }, { p: 'updates', icon: 'cloud-download-outline' }] },
    { title: 'Delete', rows: [{ p: 'delete', icon: 'trash-outline', danger: true }] },
  ];

  return (
    <ScreenBG>
      {/* one bar for the list and every page: the title dips and comes back as the page changes, and back climbs page,
          list, out. Each layer's scroll draws its own edge under the bar (EdgeScroll), since two scrolls share it */}
      <NeuHeader title={page ? PAGE_TITLES[page] : 'Settings'} onBack={() => { if (!back()) router.back(); }} />
      <View style={st.body}>
        {/* the list never remounts: while a page is open it takes no touches and is hidden from screen readers */}
        <Animated.View
          style={[st.body, listStyle]}
          pointerEvents={page ? 'none' : 'auto'}
          importantForAccessibility={page ? 'no-hide-descendants' : 'auto'}
          accessibilityElementsHidden={!!page}
        >
          <EdgeScroll contentContainerStyle={st.scroll} keyboardShouldPersistTaps="handled">
            {/* the list rises in once, as Settings opens; coming back from a page it is simply there as it was left */}
            <Arrive first={!built.current} index={0}>
              <ProfileHeader onOpen={() => open('account')} />
            </Arrive>
            {groups.map((g, gi) => (
              <Arrive key={g.title} first={!built.current} index={gi + 1}>
                <SectionTitle>{g.title}</SectionTitle>
                <ListCard>
                  {g.rows.map((r) => (
                    <CategoryRow
                      key={r.p} icon={r.icon} danger={r.danger}
                      title={PAGE_TITLES[r.p]} summary={summaries[r.p]} onPress={() => open(r.p)}
                    />
                  ))}
                </ListCard>
              </Arrive>
            ))}
            <Text style={[T.caption, { textAlign: 'center', marginTop: 24 }]}>
              Sturoids v{APP_VERSION} · local-first · made for focused work
            </Text>
          </EdgeScroll>
        </Animated.View>
        {layerPage ? (
          // an open page is its own layer over the list, with its own scroll that starts at the top. It is opaque so the
          // list does not show through it, and what it holds from the start is simply there: only parts that turn up
          // later (see `arrive`) fade in. A page on its way out takes no touches, so the list under it answers at once
          <Animated.View
            style={[st.pageLayer, { backgroundColor: bgFor(theme) }, pageStyle]}
            pointerEvents={page ? 'auto' : 'none'}
            importantForAccessibility={page ? 'auto' : 'no-hide-descendants'}
            accessibilityElementsHidden={!page}
          >
            <LayoutAnimationConfig key={layerPage} skipEntering>
              <EdgeScroll style={st.body} contentContainerStyle={st.scroll} keyboardShouldPersistTaps="handled">
                {/* a page's first heading sits close under the header, like the list's first card; a page that opens
                    with a card keeps the full 12, so its top and its light are never cut off */}
                <View style={CARD_FIRST.includes(layerPage) ? undefined : { marginTop: -S.section + 10 }}>{pageBody(layerPage)}</View>
              </EdgeScroll>
            </LayoutAnimationConfig>
          </Animated.View>
        ) : null}
      </View>
      <PinSheet
        visible={!!pinStep} mode={pinStep?.mode ?? 'enter'} tint={pinTint}
        onClose={() => setPinStep(null)} onDone={pinDone}
      />
    </ScreenBG>
  );
}

const st = StyleSheet.create({
  body: { flex: 1 },
  // 12 under the bar, as every page of a tool sits
  scroll: { padding: S.pad, paddingTop: 12, paddingBottom: 40 },
  // an open page covers the list exactly (a layer within the body, below the header)
  pageLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  avatar: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  statusDot: { width: 7, height: 7, borderRadius: 3.5, marginRight: 7 },
  catRow: { paddingVertical: 13 },
  link: { fontFamily: F.semi, fontSize: 13, letterSpacing: TRACK.small },
  recovery: {
    marginTop: 16, paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.hairline,
  },
  recoveryTitle: { ...T.label, color: C.text },
  recoveryBody: { ...T.caption, marginTop: 4 },
  slotRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 10 },
  // at least 58 wide, wider rather than wrapping at a large font size
  slotIndex: { minWidth: 58, color: C.textFaint, fontFamily: F.med, fontSize: 12, letterSpacing: TRACK.fine },
  /** a slot's tool (its icon and its name), which dips and comes back as a new tool takes the slot */
  slotTool: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  archivedLine: { flex: 1, marginLeft: 10 },
  pickRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 4 },
  label: { color: C.textDim, fontFamily: F.med, fontSize: 13, letterSpacing: TRACK.small, marginBottom: 8 },
  hint: { color: C.textFaint, fontFamily: F.reg, fontSize: 12, letterSpacing: TRACK.fine, marginTop: 10, lineHeight: 17 },
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
