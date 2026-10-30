import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Alert, Linking, AppState, BackHandler, Pressable, AccessibilityInfo, Keyboard, TextInput, Platform,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  FadeIn, FadeOut,
  Easing, LayoutAnimationConfig, runOnJS, useAnimatedRef, useAnimatedScrollHandler, useAnimatedStyle, useDerivedValue,
  useSharedValue, withSpring, withTiming,
} from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import Constants from 'expo-constants';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  C, CHROME_FONT_MAX, F, MIN, S, T, TRACK, ThemeMode, AnimLevel, ACCENT_CHOICES, WritingFont, bgFor, neuInset, neuRaised, shadowsSupported,
  wellFor, writingFace,
} from '../src/theme';
import {
  useStore, DEFAULT_UPDATE_REPO, exportSnapshot, importSnapshot, readSnapshot, applySnapshot, readRecoveryCopy, deleteRecoveryCopy, flushSaves,
  savedSize, savesFailing, subscribeSaveProblems, SAVE_WARN_CHARS, ReadSnapshot, TrashItem, TrashKind, trashDaysLeft,
} from '../src/store';
import { compareVersions, fmtShortDate, todayKey } from '../src/utils';
import { openPage } from '../src/toolNav';
import { useToday } from '../src/hooks/useNow';
import { SignatureStill } from '../src/components/Signature';
import {
  ScreenBG, Card, SectionTitle, Field, PillButton, Row, Hairline, Toggle, InfoDot, NeuHeader, Sheet, ListCard, ListRow, DotMenu,
  EdgeScroll, EmptyState, RowIcon, useTheme, ScrollEdge, edgeStrength, ArrivalPulse, IconBtn, PullArea, useContentPull,
} from '../src/components/UI';
import { toast } from '../src/components/Toast';
import { Release, downloadAndInstall, installKind, isNewer, isRepo, latestRelease, openRelease } from '../src/updates';
import { Bouncy, CHANGE, EASE_OUT, FadeSwap, rowIn, useAnimLevel, useBuilt, useEntrance, useLoop } from '../src/components/Motion';
import { tap, tick } from '../src/haptics';
import { SegmentedControl } from '../src/components/SegmentedControl';
import { PinSheet } from '../src/components/LockGate';
import { journalForBackup, restoreBodies } from '../src/journal';
import { BackupOpened, estimateBackupBytes, openBackup, restoredPath, writeBackup } from '../src/backup';
import { deviceAuthAvailable, isOpen, markOpen, pinStatus, removePin } from '../src/lock';
import { ensurePermission, rescheduleAllReminders, turnOnReminders } from '../src/notifications';
import { afterReplace, sweepUnusedFiles } from '../src/wipe';
import { TOOLS, Tool, ToolKey, colorOf, normaliseArchived, normaliseSlots, toolByKey } from '../src/tools';
import { ToolArchiveSheet } from '../src/components/ToolArchiveSheet';
import { CloudSection, DeleteSection, ago, dayOf, locksNeedPin } from '../src/components/CloudCard';
import { isFollowCopy, useCloud } from '../src/cloud';
import { useProfiles } from '../src/profiles';
import { ProfileAvatar, ProfileSwitcher, ProfilesSection, useActiveProfile } from '../src/components/ProfileSwitcher';
import { LAST_EXPORT_KEY } from '../src/backupNudge';
import { useBackupAttention } from '../src/cloud';
import { SettingsPage, settingId } from '../src/search/settingsIndex';
import { openSift } from '../src/search/store';
import { useSiftAnchor } from '../src/search/anchor';
import { useBringIntoView } from '../src/hooks/useBringIntoView';
import { TWO_COL_AT, WIDE_MAX } from '../src/layout';
import { startMakeover } from '../src/components/Makeover';
import { CHEER } from '../src/components/Cheer';

/** the list's column when Settings shows two panes */
const SPLIT_LIST_W = 380;

// keep this fallback in step with app.json — it also seeds the update check's comparison below
const APP_VERSION = Constants.expoConfig?.version || '1.7.0';

// When the last backup file was made (LAST_EXPORT_KEY, src/backupNudge.ts) is kept apart from the data, so it never
// reaches the cloud's fingerprint; Today's one-time backup card reads it too. Per profile.

const THEMES: { key: ThemeMode; label: string; desc: string }[] = [
  { key: 'default', label: 'Default', desc: 'Soft grey with raised surfaces' },
  { key: 'minimal', label: 'Minimalistic', desc: 'High contrast, flat, maximum legibility' },
];
/** the themes as offered here: a phone that cannot draw shadows shows Minimal for Default too, and Default says so */
const SHOWN_THEMES = shadowsSupported ? THEMES
  : THEMES.map((t) => (t.key === 'default' ? { ...t, desc: "This phone can't draw its shadows, so Minimal is used." } : t));


const ANIMS: { key: AnimLevel; label: string; desc: string }[] = [
  { key: 'none', label: 'Off', desc: 'No motion at all' },
  { key: 'some', label: 'Some', desc: 'Feedback only: taps and state changes' },
  { key: 'full', label: 'Everything', desc: 'Entrances, pages and lists move too' },
];

const PULL_OPTIONS = [{ key: 'top', label: 'Top bar' }, { key: 'anywhere', label: 'Anywhere' }, { key: 'off', label: 'Off' }];
const PULL_SAYS: Record<string, string> = {
  top: 'Pull down on the bar at the top of a tab.',
  anywhere: 'Pull down on the bar, or anywhere on Settings and More once they are at their top. A scroll never counts.',
  off: 'Sift opens only from its field and its button.',
};
const NAV_OPTIONS = [{ key: 'side', label: 'Side rail' }, { key: 'bottom', label: 'Bottom bar' }];
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

const WRITING_FONTS: { key: WritingFont; label: string }[] = [{ key: 'sans', label: 'Sans' }, { key: 'serif', label: 'Serif' }];

/**
 * The face what you write is set in (a note's body, a journal page), like a chat app's font setting: Sans or Serif,
 * with a line set in the chosen face under the choice, which dips and comes back in the new one.
 */
const WritingFontCard = React.memo(function WritingFontCard() {
  const font = useStore((s) => s.settings.writingFont);
  const setSetting = useStore((s) => s.setSetting);
  const pick = useCallback((k: WritingFont) => setSetting('writingFont', k), [setSetting]);
  const kind: WritingFont = font === 'serif' ? 'serif' : 'sans';
  return (
    <Card>
      <SegmentedControl stretch value={kind} onChange={pick} options={WRITING_FONTS} />
      <FadeSwap swapKey={kind} style={st.writingSample}>
        <Text style={[writingFace(kind), { color: C.text }]}>The quick notes you keep, set the way you read them.</Text>
      </FadeSwap>
      <Text style={st.hint}>For what you write in Notes and the Journal.</Text>
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

/** The profile photo, or its initial on a tint of the accent when there is none (the switcher's own avatar). */
function Avatar({ size }: { size: number }) {
  useTheme(); // the tint is the accent
  const email = useCloud((c) => c.email);
  const me = useActiveProfile(email);
  return <ProfileAvatar profile={me} size={size} />;
}

/** The photo and the name the greeting uses. What is typed stays in the field until a pause (see useSettingDraft). */
const ProfileCard = React.memo(function ProfileCard() {
  useTheme(); // the photo link is in the accent
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
        autoCapitalize="words" autoComplete="name" textContentType="name" maxLength={30}
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

/**
 * Settings' top: the photo, the name, the account and how the backup stands. Opens the Account page. With more than one
 * profile on the phone, a Switch pill on its right opens the profile switcher.
 */
const ProfileHeader = React.memo(function ProfileHeader({ onOpen, onSwitch }: { onOpen: () => void; onSwitch: () => void }) {
  useTheme();
  const name = useStore((s) => s.settings.name);
  const several = useProfiles((p) => p.list.length > 1);
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
  // while a backup runs, the cloud's mark pulses (full to half strength over 1.2 s); still otherwise
  const syncPulse = useLoop(signedIn && cloudStatus === 'syncing', 1200);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: 1 - 0.5 * syncPulse.value }));
  return (
    <Card hero onPress={onOpen} pad={18}>
      <Row style={{ alignItems: 'center' }}>
        <Avatar size={60} />
        <View style={{ flex: 1, marginLeft: 16 }}>
          <Text style={T.head} numberOfLines={1}>{name.trim() || 'Your profile'}</Text>
          <Text style={[T.caption, { marginTop: 2 }]} numberOfLines={1}>{signedIn || checking ? email : 'Not signed in'}</Text>
          <Row style={{ alignItems: 'center', marginTop: 6 }}>
            <Animated.View style={[st.statusDot, { backgroundColor: tone }, pulseStyle]} />
            <FadeSwap swapKey={statusKey}>
              <Text style={[T.caption, { color: C.textDim }]} numberOfLines={1}>{status}</Text>
            </FadeSwap>
          </Row>
        </View>
        {several ? (
          <PillButton label="Switch" small outline onPress={onSwitch} style={{ marginLeft: 12 }} />
        ) : (
          <Ionicons name="chevron-forward" size={18} color={C.textFaint} />
        )}
      </Row>
    </Card>
  );
});

/** One category of Settings: its icon, its name, what it is set to now, and a way in. The list card draws the seams. */
function CategoryRow({ icon, title, summary, onPress, danger, current }: {
  icon: any; title: string; summary: string; onPress: () => void; danger?: boolean;
  /** the page open beside the list (two panes) */
  current?: boolean;
}) {
  return (
    <ListRow onPress={() => { tick(); onPress(); }} style={[st.catRow, st.twoLineRow]}>
      <RowIcon name={icon} size={21} color={danger ? C.danger : current ? C.accent : C.textDim} />
      <View style={{ flex: 1, marginLeft: 14 }}>
        <Text style={[T.body, { fontFamily: F.med }, danger && { color: C.danger }, current && { color: C.accent }]}>{title}</Text>
        <FadeSwap swapKey={summary}>
          <Text style={[T.caption, { marginTop: 1 }]} numberOfLines={1}>{summary}</Text>
        </FadeSwap>
      </View>
      <Ionicons name="chevron-forward" size={17} color={C.textFaint} style={st.rowEnd} />
    </ListRow>
  );
}

/** Makeover: Elite or Cheerful, each a card that shows its spirit. Choosing one plays the switch, full screen. */
function MakeoverCard() {
  const theme = useTheme();
  const mood = useStore((s) => s.settings.mood);
  const opt = (key: 'elite' | 'cheerful', title: string, line: string, icon: any, tint: string) => {
    const on = mood === key;
    const face = theme === 'minimal'
      ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: on ? C.accent : MIN.border }
      : { backgroundColor: C.card, ...(on ? neuInset('low') : neuRaised('low')) };
    return (
      <Pressable
        key={key} onPress={() => { if (!on) startMakeover(key); }}
        accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={title + '. ' + line}
        style={({ pressed }) => [st.moodCard, face, pressed && !on && { transform: [{ scale: 0.98 }] }]}
      >
        <View style={[st.moodIcon, { backgroundColor: tint + '22' }]}>
          <Ionicons name={icon} size={20} color={tint} />
        </View>
        <Text style={[T.body, { fontFamily: F.semi, marginTop: 10 }, on && { color: C.accent }]}>{title}</Text>
        <Text style={[T.caption, { marginTop: 2 }]} numberOfLines={2}>{line}</Text>
        {on ? <Ionicons name="checkmark-circle" size={18} color={C.accent} style={st.moodTick} /> : null}
      </Pressable>
    );
  };
  return (
    <View style={{ flexDirection: 'row', gap: 12 }}>
      {opt('elite', 'Elite', 'Calm, formal, precise', 'diamond-outline', C.accent)}
      {opt('cheerful', 'Cheerful', 'Colour, sparks and confetti', 'sparkles-outline', CHEER.pink)}
    </View>
  );
}

/* ---------------------------------------------------------------- a setting a link points at */

/** The row a link (Sift, Settings' own search) asked for, and a new `n` each time it is asked for, so it pulses again. */
type Target = { id: string; n: string } | null;

const TargetContext = React.createContext<{ target: Target; bring: (v: View | null) => void }>({ target: null, bring: () => {} });

const sid = (page: SettingsPage, label: string) => settingId(page, label);

/**
 * A place a setting can be found by its id (src/search/settingsIndex.ts): when a link asks for one of `ids`, the page
 * scrolls it into view and it pulses once. Wraps a row, or a whole card or section for rows kept inside it.
 */
function Anchor({ ids, radius = S.radiusSm, children }: { ids: string[]; radius?: number; children: React.ReactNode }) {
  const { target, bring } = React.useContext(TargetContext);
  const ref = useRef<View>(null);
  const hit = !!target && ids.includes(target.id);
  const n = hit ? target!.n : '';
  useEffect(() => {
    if (!hit) return undefined;
    // once the page has laid out under its own entrance
    const t = setTimeout(() => bring(ref.current), 120);
    return () => clearTimeout(t);
  }, [hit, n]);
  return (
    <View ref={ref} collapsable={false}>
      {children}
      {hit ? <ArrivalPulse key={n} active radius={radius} delay={380} /> : null}
    </View>
  );
}

/** A page's scroll: EdgeScroll's, with its offset and its ref kept for bringing a linked row into view. */
function PageScroll({ children, scrollRef, y, pull = null, ...props }: React.ComponentProps<typeof Animated.ScrollView> & {
  scrollRef: React.RefObject<Animated.ScrollView | null>; y: { value: number };
  /** the content pull round the scroll view itself (not round this pair, whose edge sits beside it) */
  pull?: ReturnType<typeof useContentPull> | null;
}) {
  const level = useAnimLevel();
  const onScroll = useAnimatedScrollHandler((e) => { y.value = e.contentOffset.y; });
  const at = useDerivedValue(() => edgeStrength(y.value, level));
  return (
    <>
      <PullArea gesture={pull}>
        <Animated.ScrollView {...props} ref={scrollRef as any} onScroll={onScroll} scrollEventThrottle={16}>{children}</Animated.ScrollView>
      </PullArea>
      <ScrollEdge at={at} />
    </>
  );
}

/**
 * The field at the top of Settings' list: a carved well with the glyph and the words, as More's is. A tap opens Sift with
 * its Settings filter on, where every setting can be found and opened at its row (Sift is the one search in the app).
 */
function SettingsSiftField({ active }: { active: boolean }) {
  const theme = useTheme();
  // only the list's bar: on a page of Settings, Sift arrives its usual way
  const anchor = useSiftAnchor('settings', active);
  const well = theme === 'minimal' ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border } : { backgroundColor: C.inset, ...neuInset('low') };
  return (
    <Animated.View ref={anchor.ref} style={anchor.style} collapsable={false}>
    <Pressable
      onPress={() => { tap(); openSift('other', { scope: 'settings' }); }}
      accessibilityRole="search" accessibilityLabel="Search settings" accessibilityHint="Opens Sift on its Settings filter"
      style={({ pressed }) => [st.searchWell, well, pressed && { opacity: 0.8 }]}
    >
      <Ionicons name="search" size={15} color={C.textFaint} />
      <Text style={st.searchText} numberOfLines={1} maxFontSizeMultiplier={CHROME_FONT_MAX}>Search settings</Text>
    </Pressable>
    </Animated.View>
  );
}

/** Deep Work's daily goal: off, or an hour or more. A goal set elsewhere (the history) shows as its own choice. */
const GOALS: { key: string; label: string }[] = [
  { key: '0', label: 'Off' }, { key: '60', label: '1 h' }, { key: '120', label: '2 h' }, { key: '180', label: '3 h' },
  { key: '240', label: '4 h' },
];
const goalLabel = (min: number) => (min % 60 ? Math.floor(min / 60) + ' h ' + (min % 60) : min / 60 + ' h');

const FocusGoalCard = React.memo(function FocusGoalCard() {
  useTheme();
  const goal = useStore((s) => s.settings.focusGoalMin) || 0;
  const setSetting = useStore((s) => s.setSetting);
  const options = useMemo(() => {
    if (GOALS.some((g) => Number(g.key) === goal)) return GOALS;
    const own = { key: String(goal), label: goal < 60 ? goal + ' min' : goalLabel(goal) };
    return [...GOALS, own].sort((a, b) => Number(a.key) - Number(b.key));
  }, [goal]);
  return (
    <Card>
      <Text style={[T.body, { fontFamily: F.med }]}>Daily focus goal</Text>
      <Text style={[T.caption, { marginTop: 2, marginBottom: 14 }]}>
        {goal ? 'Today shows how far you are toward it, and the history counts the days in a row you reach it.'
          : 'Off. Set one and Today shows how far you are toward it.'}
      </Text>
      <SegmentedControl size="sm" stretch value={String(goal)} onChange={(k) => setSetting('focusGoalMin', Number(k))} options={options} />
    </Card>
  );
});

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

/** the creator's signature under the app's name, as wide as the name times this */
const COLOPHON_SIGN = 1.2;

/**
 * The end of the list, signed like a colophon: the app's name in the intro's wordmark face (the name, not the logo),
 * the creator's own signature under it, a little wider than the name and with no date (always his, never one recorded
 * on this phone), his name, smaller and quiet, and the version.
 */
const Colophon = React.memo(function Colophon() {
  useTheme();
  // the signature takes the name's measured width, so it follows the face and the phone's font size
  const [wordW, setWordW] = useState(0);
  return (
    <View style={st.colophon} accessible accessibilityLabel={'Sturoids, signed by Sanjay Murthy. Version ' + APP_VERSION}>
      <Text style={st.colophonName} onLayout={(e) => setWordW(Math.round(e.nativeEvent.layout.width))}>Sturoids</Text>
      <View style={st.colophonSign}>
        {wordW ? <SignatureStill width={Math.round(wordW * COLOPHON_SIGN)} hand={null} /> : null}
      </View>
      <Text style={st.colophonBy}>Sanjay Murthy</Text>
      <Text style={st.colophonVersion}>Version {APP_VERSION}</Text>
    </View>
  );
});

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

type Page = 'account' | 'appearance' | 'tools' | 'motion' | 'time' | 'deepwork' | 'privacy' | 'backup' | 'trash' | 'updates'
  | 'delete';

const PAGE_TITLES: Record<Page, string> = {
  account: 'Account', appearance: 'Appearance', tools: 'Tabs and tools', motion: 'Motion and start screen',
  time: 'Time and reminders', deepwork: 'Deep Work', privacy: 'Privacy and locks', backup: 'Backup',
  trash: 'Recently deleted', updates: 'Updates', delete: 'Delete',
};
const isPage = (p: unknown): p is Page => typeof p === 'string' && Object.prototype.hasOwnProperty.call(PAGE_TITLES, p);

/** Pages that open with a heading: it sits close under the bar. A page that opens with a card keeps the full gap. */
const CARD_FIRST: Page[] = ['delete'];

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
        onPress={() => onPick(tool.key)} scaleTo={0.98} radius={S.radiusSm} style={[st.pickRow, st.twoLineRow]}
        accessibilityRole="button" accessibilityLabel={tool.label} accessibilityState={{ selected: active }}
      >
        <RowIcon name={tool.icon as any} size={20} color={colorOf(tool.colorKey)} />
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

/**
 * Updates: the version running, one key to check GitHub for a newer release, and one to install it. On a phone the
 * new APK downloads here, a bar showing how far, and Android's installer takes it from there; on a PC the release's
 * installer opens in the browser. The repo it reads is Sturoids' own, shown under the version, and can be changed.
 */
type UpdateState =
  | { k: 'idle' } | { k: 'checking' } | { k: 'current' } | { k: 'available'; rel: Release }
  | { k: 'downloading'; rel: Release; p: number } | { k: 'handed'; rel: Release };

const UpdatesCard = React.memo(function UpdatesCard() {
  const theme = useTheme();
  const level = useAnimLevel();
  const repoDraft = useSettingDraft('githubRepo');
  const [state, setState] = useState<UpdateState>({ k: 'idle' });
  const [editRepo, setEditRepo] = useState(false);
  // set at the tap, so a second tap while GitHub answers (or while it downloads) starts nothing
  const busy = useRef(false);
  const repo = repoDraft.draft.trim() || DEFAULT_UPDATE_REPO;

  const check = async () => {
    if (busy.current) return;
    repoDraft.commit();
    if (!isRepo(repo)) {
      toast('Enter the repo as owner/repo first.');
      setEditRepo(true);
      return;
    }
    busy.current = true;
    setState({ k: 'checking' });
    try {
      const rel = await latestRelease(repo);
      setState(isNewer(rel, APP_VERSION) ? { k: 'available', rel } : { k: 'current' });
    } catch (e: any) {
      setState({ k: 'idle' });
      Alert.alert('Check failed', e?.shown ? e.message : 'Could not reach GitHub. Check your connection and try again.');
    } finally {
      busy.current = false;
    }
  };

  const install = async (rel: Release) => {
    if (busy.current) return;
    const kind = installKind(rel);
    if (kind !== 'apk') {
      openRelease(rel).catch(() => toast("Couldn't open GitHub"));
      return;
    }
    busy.current = true;
    tap();
    setState({ k: 'downloading', rel, p: 0 });
    try {
      let last = 0;
      await downloadAndInstall(rel, (p) => {
        // the bar moves in whole percents, so a fast download never re-renders the card on every packet
        if (Math.floor(p * 100) === Math.floor(last * 100)) return;
        last = p;
        setState({ k: 'downloading', rel, p });
      });
      setState({ k: 'handed', rel });
    } catch (e: any) {
      setState({ k: 'available', rel });
      Alert.alert('Install failed', e?.shown ? e.message : 'The update could not be downloaded. Check your connection and try again.');
    } finally {
      busy.current = false;
    }
  };

  const rel = state.k === 'available' || state.k === 'downloading' || state.k === 'handed' ? state.rel : null;
  const kind = rel ? installKind(rel) : 'page';
  const status = state.k === 'current' ? 'You have the newest version.'
    : state.k === 'handed' ? "Finish in Android's installer. Your data stays as it is."
      : rel ? 'Version ' + rel.version + ' is out.' : 'Checks GitHub for a newer release.';
  return (
    <Card>
      <View style={st.updHead}>
        <View style={{ flex: 1 }}>
          <Text style={[T.body, { fontFamily: F.med }]}>Sturoids {APP_VERSION}</Text>
          <FadeSwap swapKey={state.k + (rel?.version || '')}>
            <Text style={[T.caption, { marginTop: 2 }, state.k === 'available' ? { color: C.accent } : null]}>{status}</Text>
          </FadeSwap>
        </View>
        {state.k === 'checking' ? <Text style={[T.caption, { color: C.textFaint }]}>Checking…</Text> : null}
      </View>

      {rel && rel.notes && state.k === 'available' ? (
        <Animated.View entering={level === 'none' ? undefined : FadeIn.duration(220)}>
          <Text style={st.updNotes} numberOfLines={5}>{rel.notes}</Text>
        </Animated.View>
      ) : null}

      {state.k === 'downloading' ? (
        <Animated.View entering={level === 'none' ? undefined : FadeIn.duration(180)} style={st.updBarWrap}>
          <View style={[st.updBar, wellFor(theme, 'hairline')]}>
            <View style={[st.updFill, { width: `${Math.round(state.p * 100)}%`, backgroundColor: C.accent }]} />
          </View>
          <Text style={[T.caption, st.updPct]}>{'Downloading  ' + Math.round(state.p * 100) + '%'}</Text>
        </Animated.View>
      ) : null}

      <View style={st.updKeys}>
        {rel && state.k !== 'handed' ? (
          <PillButton
            label={state.k === 'downloading' ? 'Downloading…' : kind === 'apk' ? 'Install ' + rel.version : kind === 'exe' ? 'Download for PC' : 'Open on GitHub'}
            icon={kind === 'page' ? 'open-outline' : 'download-outline'} onPress={() => install(rel)}
          />
        ) : (
          <PillButton
            label={state.k === 'checking' ? 'Checking…' : 'Check for updates'} icon="cloud-download-outline"
            outline={state.k === 'handed'} onPress={check}
          />
        )}
      </View>

      {/* where it looks: Sturoids' own releases, unless another repo is typed in */}
      <Pressable onPress={() => setEditRepo((v) => !v)} hitSlop={8} style={st.updSource} accessibilityRole="button" accessibilityHint="Change the GitHub repo updates come from">
        <Ionicons name="logo-github" size={13} color={C.textFaint} />
        <Text style={[T.caption, { marginLeft: 6, flex: 1 }]} numberOfLines={1}>{repo}</Text>
        <Text style={[st.link, { color: C.textDim }]}>{editRepo ? 'Done' : 'Change'}</Text>
      </Pressable>
      {editRepo ? (
        <Animated.View entering={level === 'none' ? undefined : FadeIn.duration(180)}>
          <Field
            value={repoDraft.draft} onChangeText={repoDraft.change} onBlur={repoDraft.commit}
            placeholder={DEFAULT_UPDATE_REPO} autoCapitalize="none" autoCorrect={false}
            returnKeyType="go" onSubmitEditing={() => { setEditRepo(false); check(); }} style={{ marginTop: 10, marginBottom: 0 }}
          />
        </Animated.View>
      ) : null}
    </Card>
  );
});

/** What each kind of deleted thing is called and drawn as, and what it is called while it stands behind the PIN. */
const TRASH_KINDS: Record<TrashKind, { icon: string; label: string; locked: string }> = {
  note: { icon: 'document-text-outline', label: 'Note', locked: 'Locked note' },
  journal: { icon: 'journal-outline', label: 'Journal entry', locked: 'Locked entry' },
  video: { icon: 'play-circle-outline', label: 'Video', locked: 'Locked video' },
  timedNote: { icon: 'chatbox-ellipses-outline', label: 'Note on a video', locked: 'Locked note' },
  bookmark: { icon: 'bookmark-outline', label: 'Bookmark', locked: 'Locked bookmark' },
  attachment: { icon: 'attach-outline', label: 'Attachment', locked: 'Locked attachment' },
  habit: { icon: 'flame-outline', label: 'Habit', locked: 'Locked habit' },
  mission: { icon: 'flag-outline', label: 'Long-term task', locked: 'Locked task' },
  exam: { icon: 'ribbon-outline', label: 'Exam', locked: 'Locked exam' },
};

/** A deleted thing's name on its row: what it was called, or only its kind while it is locked. */
const kindOf = (t: TrashItem) => TRASH_KINDS[t.kind] ?? TRASH_KINDS.note;
const trashTitle = (t: TrashItem) => (t.locked ? kindOf(t).locked : t.title.trim() || 'Untitled');

/** The PIN pad's tint for a locked item: the colour of the tool it came from. */
const trashTint = (t: TrashItem) => (t.kind === 'journal' ? C.gold : t.kind === 'note' || t.kind === 'attachment' ? C.green : C.accent);

/** "Today", "Yesterday", or the day ("3 Oct", with the year when it is not this one). */
function deletedOn(at: number, now = new Date()): string {
  const key = todayKey(new Date(at));
  if (key === todayKey(now)) return 'Today';
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (key === todayKey(y)) return 'Yesterday';
  const year = new Date(at).getFullYear();
  return dayOf(at) + (year !== now.getFullYear() ? ' ' + year : '');
}

/** One deleted thing: its kind's icon, its name, and how long it has left. A tap offers Restore and Delete now. */
const TrashRow = React.memo(function TrashRow({ item, onOpen }: {
  item: TrashItem; onOpen: (id: string) => void;
  /** today's date: the days left are counted again when it turns over */
  today: string;
}) {
  useTheme();
  const kind = kindOf(item);
  const title = trashTitle(item);
  const left = trashDaysLeft(item);
  const days = left + (left === 1 ? ' day left' : ' days left');
  const caption = item.locked ? days : kind.label + ' · ' + days;
  return (
    <ListRow
      onPress={() => { tick(); onOpen(item.id); }} style={[st.trashRow, st.twoLineRow]}
      accessibilityLabel={title + ', ' + (item.locked ? '' : kind.label + ', ') + days} accessibilityHint="Restore it, or delete it now"
    >
      <RowIcon name={kind.icon as any} size={20} color={C.textDim} />
      <View style={{ flex: 1, marginLeft: 14 }}>
        <Text style={[T.body, { fontFamily: F.med }]} numberOfLines={1}>{title}</Text>
        <Text style={[T.caption, { marginTop: 1 }]} numberOfLines={1}>{caption}</Text>
      </View>
      <Ionicons name="ellipsis-horizontal" size={17} color={C.textFaint} style={st.rowEnd} />
    </ListRow>
  );
});

/**
 * Recently deleted: what was deleted in the last 30 days, grouped by the day it was deleted, newest first. Each thing
 * can be restored or deleted now, and the whole page emptied. A locked thing shows only its kind, and the PIN is asked
 * for before it is restored or deleted (or before an empty that takes one with it).
 */
const TrashSection = React.memo(function TrashSection() {
  useTheme();
  const trash = useStore((s) => s.trash);
  const [menuId, setMenuId] = useState<string | null>(null);
  // the menu keeps naming its item while it closes, even once the item has gone
  const menuItem = useHeld(menuId ? trash.find((t) => t.id === menuId) ?? null : null);
  const [pinFor, setPinFor] = useState<null | { tint: string; run: () => void }>(null);
  const pinHeld = useHeld(pinFor);
  // Today and Yesterday, and the days left, move on at midnight while the page stays open
  const today = useToday();
  const groups = useMemo(() => {
    const out: { label: string; items: TrashItem[] }[] = [];
    for (const t of [...trash].sort((a, b) => b.deletedAt - a.deletedAt)) {
      const label = deletedOn(t.deletedAt);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(t);
      else out.push({ label, items: [t] });
    }
    return out;
  }, [trash, today]);

  const find = (id: string) => useStore.getState().trash.find((t) => t.id === id);
  /** runs at once, or once the PIN is given when the item is locked and a PIN is set */
  const withPin = async (locked: boolean, tint: string, run: () => void) => {
    if (locked && (await pinStatus()) !== 'none') setPinFor({ tint, run });
    else run();
  };

  const restore = (id: string) => {
    const item = find(id);
    if (!item) return;
    withPin(item.locked, trashTint(item), () => {
      // gone meanwhile (an Undo elsewhere put it back, or it was purged), so there is nothing to say
      if (!find(id)) return;
      if (useStore.getState().restoreFromTrash(id) === 'parent-missing') {
        toast(item.kind === 'attachment' ? 'Restore the note first.' : 'Restore the video first.');
        return;
      }
      tap();
      toast('Restored');
      // a habit, a long-term task or an exam brings its reminders back with it
      if (item.kind === 'habit' || item.kind === 'mission' || item.kind === 'exam') rescheduleAllReminders().catch(() => {});
    });
  };

  const deleteNow = (id: string) => {
    const item = find(id);
    if (!item) return;
    Alert.alert('Delete it for good?', '"' + trashTitle(item) + '" cannot be restored after this.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: () => withPin(item.locked, trashTint(item), () => useStore.getState().deleteFromTrash(id)),
      },
    ]);
  };

  const emptyAll = () => {
    const n = useStore.getState().trash.length;
    if (!n) return;
    Alert.alert(
      'Empty Recently deleted?',
      (n === 1 ? 'The item here is' : 'All ' + n + ' items here are') + ' deleted for good. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Empty', style: 'destructive',
          onPress: () => withPin(useStore.getState().trash.some((t) => t.locked), C.accent, () => useStore.getState().emptyTrash()),
        },
      ],
    );
  };

  return (
    <>
      {groups.length ? (
        <>
          {groups.map((g) => (
            <View key={g.label}>
              <SectionTitle>{g.label}</SectionTitle>
              <ListCard>
                {g.items.map((t) => <TrashRow key={t.id} item={t} onOpen={setMenuId} today={today} />)}
              </ListCard>
            </View>
          ))}
          <Text style={[T.caption, st.trashNote]}>Deleted things stay here for 30 days, then they are deleted for good.</Text>
          <PillButton label="Empty Recently deleted" icon="trash-outline" color={C.danger} outline onPress={emptyAll} style={{ marginTop: 14 }} />
        </>
      ) : (
        <EmptyState
          icon="trash-bin-outline" title="Nothing recently deleted"
          body="Notes, journal entries, videos, habits, long-term tasks and exams you delete stay here for 30 days, then they are deleted for good."
        />
      )}
      <DotMenu
        visible={!!menuId} onClose={() => setMenuId(null)} title={menuItem ? trashTitle(menuItem) : undefined}
        items={menuItem ? [
          { label: 'Restore', icon: 'arrow-undo-outline', onPress: () => restore(menuItem.id) },
          { label: 'Delete now', icon: 'trash-outline', color: C.danger, onPress: () => deleteNow(menuItem.id) },
        ] : []}
      />
      <PinSheet
        visible={!!pinFor} mode="enter" tint={pinHeld?.tint ?? C.accent}
        onClose={() => setPinFor(null)}
        onDone={() => {
          const step = pinFor;
          setPinFor(null);
          step?.run();
        }}
      />
    </>
  );
});

export default function Settings() {
  const theme = useTheme(); // a new accent or theme repaints the page's toggles and pills, which take the accent as a prop
  const level = useAnimLevel();
  const router = useRouter();
  // Settings opens on its list of categories; each opens as its own page, a layer over the list within the screen, and
  // back returns to the list. The list stays mounted under the page, so it is as it was left (its scroll included).
  // A link can name the page to open on (/settings?page=backup), and a row on it (&row=motion:animations, with a new
  // &n= each time, so the same row asked for again pulses again). Read as Settings mounts, and again whenever a link
  // reaches Settings while it is already open
  const params = useLocalSearchParams<{ page?: string; row?: string; n?: string }>();
  // a wide window (a tablet on its side, the PC) shows the list and a page side by side: the list stays, and a page
  // is always open beside it (Appearance to begin with)
  const winW = useWindowDimensions().width;
  const split = winW >= TWO_COL_AT;
  const splitRef = useRef(split);
  splitRef.current = split;
  const [page, setPage] = useState<Page | null>(() => (isPage(params.page) ? params.page : split ? 'appearance' : null));
  useEffect(() => { if (split && !page) setPage('appearance'); }, [split]);
  const [target, setTarget] = useState<Target>(() => (params.row ? { id: String(params.row), n: String(params.n ?? '0') } : null));
  const seenLink = useRef(String(params.page ?? '') + '|' + String(params.row ?? '') + '|' + String(params.n ?? ''));
  useEffect(() => {
    const key = String(params.page ?? '') + '|' + String(params.row ?? '') + '|' + String(params.n ?? '');
    if (key === seenLink.current) return;
    seenLink.current = key;
    if (isPage(params.page)) setPage(params.page);
    if (params.row) setTarget({ id: String(params.row), n: String(params.n ?? Date.now()) });
  }, [params.page, params.row, params.n]);
  const open = useCallback((p: Page) => setPage(p), []);
  // A pull down on the bar, or anywhere on the list or a page once it is at its top (Settings' choice), opens Sift on its
  // Settings filter. One progress for both, so the bar's pill follows either.
  const pullMode = useStore((s) => s.settings.siftPull);
  const pullProgress = useSharedValue(0);
  const openSettingsSift = useCallback(() => openSift('pull', { scope: 'settings' }), []);
  const listY = useSharedValue(0);
  const listScroll = useAnimatedRef<Animated.ScrollView>();
  const listPull = useContentPull(pullMode === 'anywhere' && !page, listY, pullProgress, openSettingsSift);
  // the page's scroll, so a linked row can be brought into view
  const pageScroll = useAnimatedRef<Animated.ScrollView>();
  const pageY = useSharedValue(0);
  const pagePull = useContentPull(pullMode === 'anywhere' && !!page, pageY, pullProgress, openSettingsSift);
  const { topRef: pageTop, bring } = useBringIntoView({
    scrollTo: (y, animated) => { (pageScroll.current as any)?.scrollTo?.({ y, animated }); },
    scrollY: pageY, padTop: 12, barH: 0, still: level === 'none',
  });
  const targetCtx = useMemo(() => ({ target, bring }), [target, bring]);
  const pageRef = useRef(page);
  pageRef.current = page;
  const back = useCallback(() => {
    // side by side, back leaves Settings: the page beside the list is not a level of its own
    if (!pageRef.current || splitRef.current) return false;
    setPage(null);
    setTarget(null);
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
  const severalProfiles = useProfiles((p) => p.list.length > 1);
  const attention = useBackupAttention();
  const [switcher, setSwitcher] = useState(false);
  // parts that turn up after the first paint (the screen-lock choices, a kept copy, Remove PIN) fade in where they
  // stand. They leave at once: this page's cards do not glide, so a fading ghost would lie over the lines moving up
  const built = useBuilt();
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const pickTheme = useCallback((k: ThemeMode) => setSetting('theme', k), [setSetting]);
  const pickAnim = useCallback((k: AnimLevel) => setSetting('animLevel', k), [setSetting]);

  // exam evenings ring only while the master switch is on: turning them on with it off asks for permission and turns it on
  const toggleExamReminders = async (v: boolean) => {
    if (v && !useStore.getState().settings.remindersEnabled && !(await turnOnReminders())) return;
    setSetting('examReminders', v);
  };

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
      // the PC version picks a file the page holds in memory: it is copied into the app's files first, where a backup
      // is read in pieces as on a phone
      if (Platform.OS === 'web' && !picked.startsWith('file:')) {
        const local = (FileSystem.cacheDirectory || '') + 'picked-backup.json';
        await FileSystem.copyAsync({ from: picked, to: local });
        picked = local;
      }
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
    // the copy a quiet follow of the cloud keeps for its Undo, for a few seconds, is not one of these
    readRecoveryCopy().then((raw) => setRecovery(isFollowCopy(raw) ? null : raw));
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
  const trashCount = useStore((s) => s.trash.length);
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
  // the start screen writes a signature recorded here
  const ownSignatureOn = settings.signatureSource === 'own' && !!settings.ownSignature;
  const signatureSummary = ownSignatureOn && settings.ownSignature
    ? 'Yours, recorded ' + fmtShortDate(todayKey(new Date(settings.ownSignature.recordedAt)))
    : 'The original';
  const summaries: Record<Page, string> = {
    account: signedIn && attention === 'paused' && cloudStatus !== 'choice'
      ? 'Backup paused, tap to fix'
      : signedIn
      ? cloudStatus === 'choice'
        ? (cloudReason === 'newer' ? 'A newer copy in the cloud needs your choice' : 'Your cloud copy can bring your data back')
        : (cloudEmail as string)
      : cloudLost ? 'You were signed out on this phone' : 'Profile, photo and cloud backup',
    appearance: (settings.mood === 'cheerful' ? 'Cheerful, ' : 'Elite, ') + (THEMES.find((t) => t.key === settings.theme)?.label || 'Default') + ', '
      + (ACCENT_CHOICES.find((x) => x.color === settings.accent)?.label || 'custom') + ' accent',
    tools: slotNames,
    motion: settings.animLevel === 'none' ? 'No motion'
      : (settings.animLevel === 'some' ? 'Some motion, ' : 'Full motion, ')
        + (settings.introStyle === 'logo'
          ? 'logo first' + (ownSignatureOn ? ', your signature' : '')
          : (ownSignatureOn ? 'your signature first' : 'signature first')),
    time: (settings.hour24 ? '24-hour clock' : '12-hour clock') + ', reminders ' + (settings.remindersEnabled ? 'on' : 'off'),
    deepwork: (settings.focusGoalMin ? 'Goal ' + goalLabel(settings.focusGoalMin) + ', ' : '')
      + (settings.focusChime ? 'Chime on' : 'Chime off') + ', ambient screen: '
      + ([settings.ambientSeconds ? 'seconds' : '', settings.ambientClock ? 'time of day' : ''].filter(Boolean).join(' and ') || 'minutes only'),
    // single locked notes count too; with the whole Notes tool locked, "Notes locked" already says it
    privacy: [
      settings.journalLocked ? 'Journal locked' : '',
      settings.notesLocked ? 'Notes locked' : lockedNotes ? lockedNotes + (lockedNotes === 1 ? ' note locked' : ' notes locked') : '',
    ].filter(Boolean).join(', ') || (pinState === 'none' ? 'Nothing locked' : 'Nothing locked, PIN set'),
    backup: saveTrouble ? 'Your latest changes could not be saved'
      : recovery ? 'A kept copy is waiting'
        : lastExport ? 'Last exported ' + dayOf(lastExport) : 'Export or import a backup file',
    trash: trashCount ? trashCount + (trashCount === 1 ? ' item' : ' items') : 'Empty',
    updates: 'Version ' + APP_VERSION,
    delete: signedIn
      ? (severalProfiles ? 'Your account, cloud data or this profile' : 'Your account, cloud data or this phone')
      : severalProfiles ? 'Everything in this profile' : 'Everything on this phone',
  };

  const pageBody = (p: Page) => {
    switch (p) {
      case 'account':
        return (
          <>
            <Anchor ids={[sid('account', 'Profiles')]}><ProfilesSection /></Anchor>
            <Anchor ids={[sid('account', 'Name and photo')]}>
              <SectionTitle>Name and photo</SectionTitle>
              <ProfileCard />
            </Anchor>
            <Anchor
              ids={['Cloud backup', 'Back up automatically', 'Attachments on Wi-Fi only', 'Back up now', 'Change password'].map((l) => sid('account', l))}
            >
              <CloudSection title="Cloud backup" />
            </Anchor>
          </>
        );
      case 'appearance':
        return (
          <>
            <Anchor ids={[sid('appearance', 'Makeover')]}>
              <SectionTitle right={<InfoDot text="Elite keeps the app calm and formal. Cheerful adds soft colour drifting behind the pages, sparks when you tick something, confetti when a session or a day is done, and gentle looping motion. Both work with the Default and Minimalistic themes, and with motion turned down they stay still." />}>
                Makeover
              </SectionTitle>
              <MakeoverCard />
            </Anchor>
            <Anchor ids={[sid('appearance', 'Theme')]}>
              <SectionTitle>Theme</SectionTitle>
              <Card pad={12}>
                <OptionPicker options={SHOWN_THEMES} value={settings.theme} onPick={pickTheme} />
              </Card>
            </Anchor>
            <Anchor ids={[sid('appearance', 'Accent colour')]}>
              <SectionTitle>Accent colour</SectionTitle>
              <AccentCard />
            </Anchor>
            <Anchor ids={[sid('appearance', 'Writing font')]}>
              <SectionTitle>Writing font</SectionTitle>
              <WritingFontCard />
            </Anchor>
          </>
        );
      case 'tools':
        return (
          <>
            <Anchor ids={[sid('tools', 'Tab bar slots'), sid('tools', 'Archived')]}><ToolsSection /></Anchor>
            <SectionTitle>Getting around</SectionTitle>
            <Card>
              <Anchor ids={[sid('tools', 'Pull down to search')]}>
                <Text style={[T.body, { fontFamily: F.med }]}>Pull down to search</Text>
                <Text style={[T.caption, { marginTop: 2, marginBottom: 10 }]}>{PULL_SAYS[settings.siftPull]}</Text>
                <SegmentedControl
                  size="sm" stretch value={settings.siftPull}
                  onChange={(k) => setSetting('siftPull', k as typeof settings.siftPull)} options={PULL_OPTIONS}
                />
              </Anchor>
              <Hairline />
              <Anchor ids={[sid('tools', 'Tab bar on wide screens')]}>
                <Text style={[T.body, { fontFamily: F.med, marginTop: 10 }]}>Tab bar on wide screens</Text>
                <Text style={[T.caption, { marginTop: 2, marginBottom: 10 }]}>
                  {settings.tabNav === 'side'
                    ? 'On a tablet or the PC the tabs sit down the left side, with arrows at the bottom right to step between tabs and pages.'
                    : 'On a tablet or the PC the tabs sit along the bottom, as on a phone; swipe sideways to change tab.'}
                </Text>
                <SegmentedControl
                  size="sm" stretch value={settings.tabNav}
                  onChange={(k) => setSetting('tabNav', k as typeof settings.tabNav)} options={NAV_OPTIONS}
                />
              </Anchor>
            </Card>
          </>
        );
      case 'motion':
        return (
          <>
            <Anchor ids={[sid('motion', 'Animations')]}>
              <SectionTitle>Animations</SectionTitle>
              <Card pad={12}>
                <OptionPicker options={ANIMS} value={settings.animLevel} onPick={pickAnim} />
              </Card>
            </Anchor>
            <SectionTitle>Start screen</SectionTitle>
            <Anchor ids={[sid('motion', 'Start screen')]} radius={S.radius}>
            <Card>
              <Anchor ids={[sid('motion', 'Disable the big signature')]}>
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
              </Anchor>
              <Hairline />
              <Anchor ids={[sid('motion', 'Tap to skip the intro')]}>
              <Row style={{ justifyContent: 'space-between', marginTop: 10 }}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={[T.body, { fontFamily: F.med }]}>Tap to skip the intro</Text>
                  <Text style={[T.caption, { marginTop: 2 }]}>A tap during the start screen goes straight to Today, in about half a second.</Text>
                </View>
                <Toggle
                  value={settings.introTapSkip} onChange={(v) => setSetting('introTapSkip', v)} color={C.accent}
                  label="Tap to skip the intro"
                />
              </Row>
              </Anchor>
              <Hairline />
              <Anchor ids={[sid('motion', 'Your signature')]}>
              {/* the third choice: whose signature the start screen writes, and recording your own */}
              <ListRow
                onPress={() => { tick(); openPage('/signature'); }} style={st.signatureRow}
                accessibilityLabel="Your signature" accessibilityHint={signatureSummary}
              >
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={[T.body, { fontFamily: F.med }]}>Your signature</Text>
                  <FadeSwap swapKey={signatureSummary}>
                    <Text style={[T.caption, { marginTop: 2 }]} numberOfLines={1}>{signatureSummary}</Text>
                  </FadeSwap>
                </View>
                <Ionicons name="chevron-forward" size={17} color={C.textFaint} />
              </ListRow>
              </Anchor>
            </Card>
            </Anchor>
          </>
        );
      case 'time':
        return (
          <>
            <SectionTitle>Clock and reminders</SectionTitle>
            <Card>
              <Anchor ids={[sid('time', '24-hour time')]}>
              <Row style={{ justifyContent: 'space-between', marginBottom: 12 }}>
                <Text style={T.body}>24-hour time</Text>
                <Toggle value={settings.hour24} onChange={(v) => setSetting('hour24', v)} color={C.accent} label="24-hour time" />
              </Row>
              </Anchor>
              <Hairline />
              <Anchor ids={[sid('time', 'All reminders (master)')]}>
              <Row style={{ justifyContent: 'space-between', marginTop: 12 }}>
                <Row>
                  <Text style={T.body}>All reminders (master)</Text>
                  <InfoDot text="The master switch for every notification. Habit times live in Planner, Streaks; ToDo nudges in Tasks, the bell icon." />
                </Row>
                <Toggle value={settings.remindersEnabled} onChange={toggleReminders} color={C.green} label="All reminders" />
              </Row>
              </Anchor>
              <Hairline />
              <Anchor ids={[sid('time', 'Exam reminders')]}>
              <Row style={{ justifyContent: 'space-between', marginTop: 12 }}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={T.body}>Exam reminders</Text>
                  <Text style={[T.caption, { marginTop: 2 }]}>
                    The evening before each dated exam, at {settings.hour24 ? '19:00' : '7 pm'}.
                  </Text>
                </View>
                <Toggle
                  value={settings.examReminders && settings.remindersEnabled} onChange={toggleExamReminders} color={C.accent}
                  label="Exam reminders"
                />
              </Row>
              </Anchor>
            </Card>
          </>
        );
      case 'deepwork':
        return (
          <>
            <SectionTitle>Your goal</SectionTitle>
            <Anchor ids={[sid('deepwork', 'Daily focus goal')]} radius={S.radius}>
              <FocusGoalCard />
            </Anchor>
            <SectionTitle>When a block ends</SectionTitle>
            <Anchor ids={[sid('deepwork', 'Chime when a block ends')]} radius={S.radius}>
            <Card>
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={[T.body, { fontFamily: F.med }]}>Chime when a block ends</Text>
                  <Text style={[T.caption, { marginTop: 2 }]}>The phone always buzzes. This adds a soft chime.</Text>
                </View>
                <Toggle value={settings.focusChime} onChange={(v) => setSetting('focusChime', v)} color={C.accent} label="Chime when a block ends" />
              </Row>
              <Hairline />
              <Anchor ids={[sid('deepwork', 'Drop sessions under a minute')]}>
              <Row style={{ justifyContent: 'space-between', marginTop: 10 }}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={[T.body, { fontFamily: F.med }]}>Drop sessions under a minute</Text>
                  <Text style={[T.caption, { marginTop: 2 }]}>A start by mistake or a quick try is not kept in the history.</Text>
                </View>
                <Toggle value={settings.focusDropShort} onChange={(v) => setSetting('focusDropShort', v)} color={C.accent} label="Drop sessions under a minute" />
              </Row>
              </Anchor>
            </Card>
            </Anchor>
            <SectionTitle>Ambient screen</SectionTitle>
            <Anchor ids={[sid('deepwork', 'Ambient screen')]} radius={S.radius}>
            <Card>
              <Anchor ids={[sid('deepwork', 'Seconds on the ambient screen')]}>
              <Row style={{ justifyContent: 'space-between', marginBottom: 10 }}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={[T.body, { fontFamily: F.med }]}>Seconds on the ambient screen</Text>
                  <Text style={[T.caption, { marginTop: 2 }]}>
                    {settings.ambientSeconds ? 'The timer counts each second.' : 'The timer shows whole minutes.'}
                  </Text>
                </View>
                <Toggle value={settings.ambientSeconds} onChange={(v) => setSetting('ambientSeconds', v)} color={C.accent} label="Seconds on the ambient screen" />
              </Row>
              </Anchor>
              <Hairline />
              <Anchor ids={[sid('deepwork', 'Time of day on the ambient screen')]}>
              <Row style={{ justifyContent: 'space-between', marginTop: 10 }}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={[T.body, { fontFamily: F.med }]}>Time of day on the ambient screen</Text>
                  <Text style={[T.caption, { marginTop: 2 }]}>Shown small, above the timer.</Text>
                </View>
                <Toggle value={settings.ambientClock} onChange={(v) => setSetting('ambientClock', v)} color={C.accent} label="Time of day on the ambient screen" />
              </Row>
              </Anchor>
            </Card>
            </Anchor>
          </>
        );
      case 'privacy':
        return (
          <>
            <SectionTitle>Locks</SectionTitle>
            <Card>
              <Anchor ids={[sid('privacy', 'Lock the journal')]}>
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={[T.body, { fontFamily: F.med }]}>Lock the journal</Text>
                  <Text style={[T.caption, { marginTop: 2 }]}>Your app PIN opens it.</Text>
                </View>
                <Toggle value={settings.journalLocked} onChange={(v) => setToolLock('journal', v)} color={C.gold} label="Lock the journal" />
              </Row>
              </Anchor>
              <Hairline />
              <Anchor ids={[sid('privacy', 'Lock Notes')]}>
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
              </Anchor>
              {deviceLock ? (
                <Animated.View entering={arrive}>
                  <Anchor ids={[sid('privacy', 'Your screen lock can also open')]}>
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
                  </Anchor>
                </Animated.View>
              ) : null}
            </Card>
            <SectionTitle>App PIN</SectionTitle>
            <Card>
              <Anchor ids={[sid('privacy', 'App PIN')]}>
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
              </Anchor>
              {pinState !== 'none' && !pinInUse ? (
                <Animated.View entering={arrive} style={{ marginTop: 10, alignSelf: 'flex-end' }}>
                  <PillButton small outline color={C.danger} label="Remove PIN" onPress={() => setPinStep({ mode: 'enter', for: 'remove' })} />
                </Animated.View>
              ) : null}
              <Hairline />
              <Anchor ids={[sid('privacy', 'Re-lock after')]}>
              <Text style={[st.label, { marginTop: 10, marginBottom: 8 }]}>Re-lock after</Text>
              <SegmentedControl
                size="sm"
                stretch
                value={String(settings.lockGraceSec)}
                onChange={(k) => setSetting('lockGraceSec', Number(k))}
                options={GRACE_OPTIONS}
              />
              </Anchor>
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
            <Anchor ids={['Backup file', 'Export a backup file', 'Import backup'].map((l) => sid('backup', l))} radius={S.radius}>
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
            </Anchor>
          </>
        );
      case 'trash':
        return <Anchor ids={[sid('trash', 'Empty Recently deleted')]}><TrashSection /></Anchor>;
      case 'updates':
        return (
          <>
            <SectionTitle right={<InfoDot text="Sideloaded APKs don't auto-update. This checks the GitHub Releases of the repo below for a newer version tag and links you to the download." />}>
              Check for a new version
            </SectionTitle>
            <Anchor ids={[sid('updates', 'Check for a new version')]} radius={S.radius}><UpdatesCard /></Anchor>
          </>
        );
      case 'delete':
        // after an erase the page would hold one button over nothing: back to the list, which is fresh too
        return (
          <Anchor ids={['Delete my account', 'Delete my cloud data', 'Delete everything on this phone'].map((l) => sid('delete', l))}>
            <DeleteSection title={null} onErased={back} />
          </Anchor>
        );
    }
  };

  const groups: { title: string; rows: { p: Page; icon: string; danger?: boolean }[] }[] = [
    { title: 'Look and feel', rows: [{ p: 'appearance', icon: 'color-palette-outline' }, { p: 'tools', icon: 'apps-outline' }, { p: 'motion', icon: 'sparkles-outline' }] },
    { title: 'Your day', rows: [{ p: 'time', icon: 'time-outline' }, { p: 'deepwork', icon: (toolByKey('focus')?.icon || 'hourglass-outline') }, { p: 'privacy', icon: 'lock-closed-outline' }] },
    {
      title: 'Data',
      rows: [
        { p: 'account', icon: 'cloud-outline' }, { p: 'backup', icon: 'archive-outline' }, { p: 'trash', icon: 'trash-bin-outline' },
        { p: 'updates', icon: 'cloud-download-outline' },
      ],
    },
    { title: 'Delete', rows: [{ p: 'delete', icon: 'trash-outline', danger: true }] },
  ];

  return (
    <ScreenBG maxWidth={split ? WIDE_MAX : undefined}>
      {/* one bar for the list and every page: the title dips and comes back as the page changes, and back climbs page,
          list, out. Each layer's scroll draws its own edge under the bar (EdgeScroll), since two scrolls share it */}
      <NeuHeader
        title={page && !split ? PAGE_TITLES[page] : 'Settings'} onBack={() => { if (!back()) router.back(); }}
        pull pullProgress={pullProgress} pullOpen={openSettingsSift}
      />
      <View style={st.body}>
        {/* the list never remounts: while a page is open it takes no touches and is hidden from screen readers */}
        <Animated.View
          style={split ? st.splitList : [st.body, listStyle]}
          pointerEvents={page && !split ? 'none' : 'auto'}
          importantForAccessibility={page && !split ? 'no-hide-descendants' : 'auto'}
          accessibilityElementsHidden={!!page && !split}
        >
          <PageScroll scrollRef={listScroll} y={listY} pull={listPull} style={st.body} contentContainerStyle={st.scroll} keyboardShouldPersistTaps="handled">
            {/* the list rises in once, as Settings opens; coming back from a page it is simply there as it was left */}
            <Arrive first={!built.current} index={0}>
              <SettingsSiftField active={!page || split} />
            </Arrive>
            <Arrive first={!built.current} index={0}>
              <ProfileHeader onOpen={() => open('account')} onSwitch={() => setSwitcher(true)} />
            </Arrive>
            {groups.map((g, gi) => (
              <Arrive key={g.title} first={!built.current} index={gi + 1}>
                <SectionTitle>{g.title}</SectionTitle>
                <ListCard>
                  {g.rows.map((r) => (
                    <CategoryRow
                      key={r.p} icon={r.icon} danger={r.danger}
                      title={PAGE_TITLES[r.p]} summary={summaries[r.p]} onPress={() => open(r.p)} current={split && page === r.p}
                    />
                  ))}
                </ListCard>
              </Arrive>
            ))}
            <Arrive first={!built.current} index={groups.length + 1}>
              <Colophon />
            </Arrive>
          </PageScroll>
        </Animated.View>
        {layerPage ? (
          // an open page is its own layer over the list, with its own scroll that starts at the top. It is opaque so the
          // list does not show through it, and what it holds from the start is simply there: only parts that turn up
          // later (see `arrive`) fade in. A page on its way out takes no touches, so the list under it answers at once
          <Animated.View
            style={[st.pageLayer, { backgroundColor: bgFor(theme) }, split && st.splitPage, pageStyle]}
            pointerEvents={page ? 'auto' : 'none'}
            importantForAccessibility={page ? 'auto' : 'no-hide-descendants'}
            accessibilityElementsHidden={!page}
          >
            <LayoutAnimationConfig key={layerPage} skipEntering>
              <PageScroll
                scrollRef={pageScroll} y={pageY} pull={pagePull} style={st.body} contentContainerStyle={st.scroll} keyboardShouldPersistTaps="handled"
              >
                <View ref={pageTop} collapsable={false} />
                {/* a page's first heading sits close under the header, like the list's first card; a page that opens
                    with a card keeps the full 12, so its top and its light are never cut off */}
                <TargetContext.Provider value={targetCtx}>
                  <View style={CARD_FIRST.includes(layerPage) ? undefined : { marginTop: -S.section + 10 }}>{pageBody(layerPage)}</View>
                </TargetContext.Provider>
              </PageScroll>
            </LayoutAnimationConfig>
          </Animated.View>
        ) : null}
      </View>
      <PinSheet
        visible={!!pinStep} mode={pinStep?.mode ?? 'enter'} tint={pinTint}
        onClose={() => setPinStep(null)} onDone={pinDone}
      />
      <ProfileSwitcher visible={switcher} onClose={() => setSwitcher(false)} onManage={() => open('account')} />
    </ScreenBG>
  );
}

const st = StyleSheet.create({
  body: { flex: 1 },
  // 12 under the bar, as every page of a tool sits
  scroll: { padding: S.pad, paddingTop: 12, paddingBottom: 40 },
  // an open page covers the list exactly (a layer within the body, below the header)
  pageLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  moodCard: { flex: 1, borderRadius: S.radius, padding: 14, minHeight: 118 },
  moodIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  moodTick: { position: 'absolute', top: 12, right: 12 },
  // two panes: the list a column on the left, the page beside it, read at a comfortable width
  splitList: { width: SPLIT_LIST_W, flexGrow: 0, flexShrink: 0, height: '100%' },
  splitPage: { left: SPLIT_LIST_W, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: C.hairline, paddingRight: 0 },
  // the search field: as tall as a row, its corners the cards' own; the cards below keep the list's rhythm from it
  // a slim bar: a pull down opens Sift too, so the field only needs to say it is there
  searchWell: {
    height: 36, borderRadius: 18, flexDirection: 'row', alignItems: 'center', paddingLeft: 14, paddingRight: 14,
    marginTop: 2, marginBottom: S.gap, overflow: 'hidden',
  },
  searchText: { flex: 1, marginLeft: 9, color: C.textFaint, fontFamily: F.reg, fontSize: 14, letterSpacing: TRACK.small },
  statusDot: { width: 7, height: 7, borderRadius: 3.5, marginRight: 7 },
  catRow: { paddingVertical: 13 },
  // level with the toggle's words above it; the press carves a little past them
  signatureRow: { paddingHorizontal: 8, marginHorizontal: -8, paddingVertical: 10, marginTop: 8 },
  colophon: { alignItems: 'center', marginTop: S.section * 1.5, paddingBottom: 8 },
  colophonName: { color: C.text, fontFamily: F.brand, fontSize: 26, lineHeight: 32, letterSpacing: 0.4 },
  colophonSign: { marginTop: 12 },
  colophonBy: { color: C.textFaint, fontFamily: F.smMed, fontSize: 13, letterSpacing: TRACK.small, marginTop: 12 },
  colophonVersion: { ...T.caption, fontSize: 11, marginTop: 4 },
  link: { fontFamily: F.semi, fontSize: 13, letterSpacing: TRACK.small },
  recovery: {
    marginTop: 16, paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.hairline,
  },
  recoveryTitle: { ...T.label, color: C.text },
  recoveryBody: { ...T.caption, marginTop: 4 },
  slotRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 10 },
  // at least 58 wide, wider rather than wrapping at a large font size
  slotIndex: { minWidth: 58, color: C.textFaint, fontFamily: F.smMed, fontSize: 12, letterSpacing: TRACK.fine },
  /** a slot's tool (its icon and its name), which dips and comes back as a new tool takes the slot */
  slotTool: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  archivedLine: { flex: 1, marginLeft: 10 },
  trashRow: { paddingVertical: 12 },
  trashNote: { marginTop: 18, marginHorizontal: 4 },
  pickRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 4 },
  label: { color: C.textDim, fontFamily: F.smMed, fontSize: 13, letterSpacing: TRACK.small, marginBottom: 8 },
  updHead: { flexDirection: 'row', alignItems: 'center' },
  updNotes: { color: C.textDim, fontFamily: F.sm, fontSize: 13, lineHeight: 19, letterSpacing: TRACK.fine, marginTop: 12 },
  updBarWrap: { marginTop: 16 },
  updBar: { height: 6, borderRadius: 3, overflow: 'hidden' },
  updFill: { height: '100%', borderRadius: 3 },
  updPct: { marginTop: 8, fontVariant: ['tabular-nums'] },
  updKeys: { flexDirection: 'row', marginTop: 18 },
  updSource: { flexDirection: 'row', alignItems: 'center', marginTop: 16, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.hairline },
  hint: { color: C.textFaint, fontFamily: F.sm, fontSize: 12, letterSpacing: TRACK.fine, marginTop: 10, lineHeight: 17 },
  // the writing font's sample: two lines' room, so the card keeps its height as the face changes on a phone
  writingSample: { marginTop: 16, minHeight: 54 },
  // a row of a title over a line: the icon sits on the title's line and the end mark in the row's middle
  twoLineRow: { alignItems: 'flex-start' },
  rowEnd: { alignSelf: 'center' },
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
