import React from 'react';
import { Alert, Modal, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { ACCENT_CHOICES, C, F, T, TRACK, bgFor } from '../theme';
import { useStore } from '../store';
import {
  MAX_PROFILES, PROFILE_NAME_MAX, ProfileInfo, activeProfile, addProfile, cancelSwitch, cleanName, closeToFinish,
  profileInitial, profileName, removeProfile, renameProfile, switchProfile, useProfiles,
} from '../profiles';
import { DotMenu, Field, IconBtn, ListCard, ListRow, PillButton, SectionTitle, Sheet, useTheme } from './UI';
import { Bouncy, CHANGE, EASE_OUT, useAnimLevel } from './Motion';
import { toast } from './Toast';
import { PinSheet } from './LockGate';
import { profileHasPin } from '../lock';
import { tap, tick } from '../haptics';

// Profiles on screen: the switcher sheet (Today's greeting held, Settings' Switch), the Profiles section of Settings'
// Account page, the sheets they open, and the overlay that covers the app while it restarts into another profile.

/** The profiles, with the one in use as it is this moment (its name and accent live in its own settings). */
function useProfileList(): ProfileInfo[] {
  const list = useProfiles((s) => s.list);
  const name = useStore((s) => s.settings.name);
  const accent = useStore((s) => s.settings.accent);
  return React.useMemo(() => {
    const live = (p: ProfileInfo): ProfileInfo => ({ ...p, name: cleanName(name), color: accent || p.color });
    if (!list.some((p) => p.id === activeProfile)) {
      return [...list, live({ id: activeProfile, name: '', color: accent, email: null, createdAt: 0 })];
    }
    return list.map((p) => (p.id === activeProfile ? live(p) : p));
  }, [list, name, accent]);
}

/** "Priya's profile", or "that profile" for one with no name. */
const theirs = (p: ProfileInfo) => (p.name.trim() ? p.name.trim() + "'s profile" : 'that profile');

/** A profile's avatar: its initial in its colour, on a tint of it. */
export function ProfileAvatar({ profile, size = 36 }: { profile: ProfileInfo; size?: number }) {
  const initial = profileInitial(profile);
  return (
    <View style={[st.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: profile.color + '38' }]}>
      {initial ? (
        <Text style={{ color: profile.color, fontFamily: F.semi, fontSize: Math.round(size * 0.42) }} maxFontSizeMultiplier={1.2}>
          {initial}
        </Text>
      ) : (
        <Ionicons name="person" size={Math.round(size * 0.46)} color={profile.color} />
      )}
    </View>
  );
}

/** What a profile's row shows: its avatar, its name, its account, and "In use" on the one in use. */
function ProfileLine({ profile, end }: { profile: ProfileInfo; end?: React.ReactNode }) {
  const active = profile.id === activeProfile;
  return (
    <>
      <ProfileAvatar profile={profile} />
      <View style={st.lineText}>
        <Text style={st.name} numberOfLines={1}>{profileName(profile)}</Text>
        <Text style={st.sub} numberOfLines={1}>{profile.email || 'Not signed in'}</Text>
      </View>
      {active ? <Text style={[st.inUse, { color: C.accent }]} numberOfLines={1}>In use</Text> : end}
    </>
  );
}

const rowLabel = (p: ProfileInfo) =>
  profileName(p) + ', ' + (p.email || 'not signed in') + (p.id === activeProfile ? ', in use' : '');

/** One of the switcher's actions: an icon and its words, flat on the sheet. */
function SheetAction({ icon, label, onPress, last }: { icon: any; label: string; onPress: () => void; last?: boolean }) {
  return (
    <Bouncy onPress={onPress} scaleTo={1} sink={false} radius={14} style={[st.sheetRow, last && st.sheetRowLast]} accessibilityRole="button">
      <View style={st.actionIcon}>
        <Ionicons name={icon} size={20} color={C.textDim} />
      </View>
      <Text style={[T.body, st.actionText]} numberOfLines={1}>{label}</Text>
    </Bouncy>
  );
}

type Next = { kind: 'confirm'; profile: ProfileInfo } | { kind: 'add' } | { kind: 'manage' };

/**
 * The switcher: every profile on the phone, the one in use marked; another opens a confirm, and the app restarts into
 * it. Then "Add a profile" (while there is room) and "Manage profiles" (Settings, Account).
 */
export function ProfileSwitcher({ visible, onClose, onManage }: {
  visible: boolean; onClose: () => void;
  /** opens Settings' Account page, where profiles are renamed and deleted */
  onManage: () => void;
}) {
  useTheme();
  const list = useProfileList();
  // what a tap chose runs once the sheet has closed, so the next sheet never rises over this one
  const next = React.useRef<Next | null>(null);
  const [confirm, setConfirm] = React.useState<ProfileInfo | null>(null);
  const [adding, setAdding] = React.useState(false);
  const choose = (n: Next) => { next.current = n; onClose(); };
  const closed = () => {
    const n = next.current;
    next.current = null;
    if (!n) return;
    if (n.kind === 'confirm') setConfirm(n.profile);
    else if (n.kind === 'add') setAdding(true);
    else onManage();
  };
  const room = list.length < MAX_PROFILES;
  return (
    <>
      <Sheet visible={visible} onClose={onClose} onClosed={closed} title="Profiles">
        {list.map((p) => (p.id === activeProfile ? (
          <View key={p.id} style={st.sheetRow} accessible accessibilityLabel={rowLabel(p)}>
            <ProfileLine profile={p} />
          </View>
        ) : (
          <Bouncy
            key={p.id} onPress={() => choose({ kind: 'confirm', profile: p })}
            scaleTo={1} sink={false} radius={14} style={st.sheetRow}
            accessibilityRole="button" accessibilityLabel={rowLabel(p)} accessibilityHint="Switches to this profile"
          >
            <ProfileLine profile={p} end={<Ionicons name="chevron-forward" size={18} color={C.textFaint} />} />
          </Bouncy>
        )))}
        {room ? <SheetAction icon="add" label="Add a profile" onPress={() => choose({ kind: 'add' })} /> : null}
        <SheetAction icon="settings-outline" label="Manage profiles" onPress={() => choose({ kind: 'manage' })} last />
      </Sheet>
      <ConfirmSwitchSheet profile={confirm} onClose={() => setConfirm(null)} />
      <AddProfileSheet visible={adding} onClose={() => setAdding(false)} />
    </>
  );
}

/** "Switch to Priya?": Switch restarts the app into that profile. */
export function ConfirmSwitchSheet({ profile, onClose }: { profile: ProfileInfo | null; onClose: () => void }) {
  useTheme();
  // the profile stays named while the sheet closes
  const held = React.useRef<ProfileInfo | null>(profile);
  if (profile) held.current = profile;
  const p = held.current;
  const go = React.useRef(false);
  const named = !!p?.name.trim();
  return (
    <Sheet
      visible={!!profile} onClose={onClose}
      title={p ? (named ? 'Switch to ' + p.name.trim() + '?' : 'Switch to this profile?') : ''}
      onClosed={() => {
        if (!go.current || !p) return;
        go.current = false;
        tap();
        void switchProfile(p.id);
      }}
    >
      <Text style={st.body}>
        {'Sturoids restarts into ' + (p ? theirs(p) : 'that profile') + '. Reminders ring only for the profile in use.'}
      </Text>
      <PillButton label="Switch" onPress={() => { go.current = true; onClose(); }} style={{ marginTop: 18 }} />
      <PillButton label="Cancel" outline color={C.textDim} onPress={onClose} style={{ marginTop: 12 }} />
    </Sheet>
  );
}

/** A colour for a new profile: flat, a ring in its own colour on the chosen one (as Appearance's accents). */
function Swatch({ color, label, active, onPick }: { color: string; label: string; active: boolean; onPick: () => void }) {
  const level = useAnimLevel();
  const on = useSharedValue(active ? 1 : 0);
  React.useEffect(() => {
    on.value = level === 'none' ? (active ? 1 : 0) : withTiming(active ? 1 : 0, CHANGE);
  }, [active, level]);
  const ringStyle = useAnimatedStyle(() => ({ opacity: on.value }));
  const markStyle = useAnimatedStyle(() => ({ opacity: on.value, transform: [{ scale: 0.6 + 0.4 * on.value }] }));
  return (
    <Bouncy
      onPress={() => { tick(); onPick(); }} scaleTo={0.85} radius={22} style={st.swatchWell}
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: active }}
    >
      <Animated.View pointerEvents="none" style={[st.swatchRing, { borderColor: color }, ringStyle]} />
      <View style={[st.swatchDisc, { backgroundColor: color }]}>
        <Animated.View style={markStyle}>
          <Ionicons name="checkmark" size={14} color={C.onAccent} />
        </Animated.View>
      </View>
    </Bouncy>
  );
}

/** A button that waits for its field: dimmed and untouchable until there is something to act on. */
function WaitingPill({ ready, label, onPress, style }: { ready: boolean; label: string; onPress: () => void; style?: any }) {
  return (
    <View
      style={[{ opacity: ready ? 1 : 0.45 }, style]} pointerEvents={ready ? 'auto' : 'none'}
      accessibilityState={{ disabled: !ready }}
    >
      <PillButton label={label} onPress={onPress} />
    </View>
  );
}

/** A new profile: its name and colour. It is made and switched to once the sheet has closed. */
export function AddProfileSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  useTheme();
  const list = useProfiles((s) => s.list);
  const [name, setName] = React.useState('');
  const [color, setColor] = React.useState(ACCENT_CHOICES[0].color);
  const go = React.useRef<{ name: string; color: string } | null>(null);
  // each opening starts empty, on a colour no profile uses yet where there is one
  React.useEffect(() => {
    if (!visible) return;
    setName('');
    const used = new Set(useProfiles.getState().list.map((p) => p.color.toLowerCase()));
    setColor((ACCENT_CHOICES.find((a) => !used.has(a.color.toLowerCase())) ?? ACCENT_CHOICES[0]).color);
  }, [visible]);
  const ready = !!cleanName(name);
  const create = () => {
    if (!ready) return;
    go.current = { name, color };
    onClose();
  };
  const half = Math.ceil(ACCENT_CHOICES.length / 2);
  const rows = [ACCENT_CHOICES.slice(0, half), ACCENT_CHOICES.slice(half)];
  return (
    <Sheet
      visible={visible} onClose={onClose} title="Add a profile"
      onClosed={() => {
        const g = go.current;
        go.current = null;
        if (!g) return;
        addProfile(g.name, g.color).then((r) => {
          if (r === 'full') toast('This phone holds up to ' + MAX_PROFILES + ' profiles');
          else if (r === 'error') toast('Could not add the profile. Try again');
        }).catch(() => toast('Could not add the profile. Try again'));
      }}
    >
      <Field
        label="Name" value={name} onChangeText={setName} placeholder="Who is this profile for?" autoFocus
        maxLength={PROFILE_NAME_MAX} autoCapitalize="words" returnKeyType="done" onSubmitEditing={create}
      />
      <Text style={st.label}>Colour</Text>
      <View style={{ gap: 12 }}>
        {rows.map((r, i) => (
          <View key={i} style={st.swatchRow}>
            {r.map((a) => (
              <Swatch key={a.key} color={a.color} label={a.label} active={color === a.color} onPick={() => setColor(a.color)} />
            ))}
          </View>
        ))}
      </View>
      <Text style={[st.caption, { marginTop: 18 }]}>
        A new profile starts empty, with its own ToDos, notes, journal, settings and cloud account.
      </Text>
      {list.length >= MAX_PROFILES ? (
        <Text style={[st.caption, { marginTop: 8 }]}>{'This phone holds up to ' + MAX_PROFILES + ' profiles.'}</Text>
      ) : null}
      <WaitingPill ready={ready && list.length < MAX_PROFILES} label="Create and switch" onPress={create} style={{ marginTop: 18 }} />
    </Sheet>
  );
}

/** A profile's new name. */
function RenameSheet({ profile, onClose }: { profile: ProfileInfo | null; onClose: () => void }) {
  useTheme();
  const held = React.useRef<ProfileInfo | null>(profile);
  if (profile) held.current = profile;
  const [name, setName] = React.useState('');
  React.useEffect(() => { if (profile) setName(profile.name); }, [profile]);
  const ready = !!cleanName(name);
  const save = () => {
    const p = held.current;
    if (!ready || !p) return;
    onClose();
    renameProfile(p.id, name).then((r) => { if (r === 'error') toast('Could not rename the profile. Try again'); }).catch(() => {});
  };
  return (
    <Sheet visible={!!profile} onClose={onClose} title="Rename profile">
      <Field
        value={name} onChangeText={setName} placeholder="Name" autoFocus maxLength={PROFILE_NAME_MAX}
        autoCapitalize="words" returnKeyType="done" onSubmitEditing={save}
      />
      <WaitingPill ready={ready} label="Save" onPress={save} />
    </Sheet>
  );
}

/** Asks twice, then deletes another profile and everything it keeps on this phone. */
function confirmDelete(p: ProfileInfo) {
  const named = p.name.trim();
  Alert.alert(
    named ? 'Delete ' + named + "'s profile?" : 'Delete this profile?',
    'Everything in it on this phone is deleted: ToDos, notes, journal, files and settings. Its cloud backup, if any, stays in the cloud.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: () => Alert.alert('Delete it for good?', 'This cannot be undone.', [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete profile', style: 'destructive',
            onPress: () => {
              removeProfile(p.id).then((r) => {
                if (r === 'ok') { tap(); toast('Profile deleted'); }
                else Alert.alert('Could not delete the profile', 'Other profiles were not touched. Try again in a moment.');
              }).catch(() => {});
            },
          },
        ]),
      },
    ],
  );
}

/**
 * Settings, Account: every profile on the phone as a list, the one in use marked. Another opens a confirm to switch to
 * it; held, or its ellipsis, renames or deletes it (the first profile is never deleted here: Delete everything is for
 * that). Then "Add a profile" while there is room.
 */
export function ProfilesSection() {
  useTheme();
  const list = useProfileList();
  const [confirm, setConfirm] = React.useState<ProfileInfo | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [menuFor, setMenuFor] = React.useState<ProfileInfo | null>(null);
  const [renaming, setRenaming] = React.useState<ProfileInfo | null>(null);
  // a profile that keeps a PIN is deleted from here only with that PIN: its locked notes and journal are its own
  const [pinFor, setPinFor] = React.useState<ProfileInfo | null>(null);
  const askToDelete = (p: ProfileInfo) => {
    profileHasPin(p.id).then((has) => { if (has) setPinFor(p); else confirmDelete(p); }).catch(() => setPinFor(p));
  };
  // the menu keeps its profile while it closes
  const menuHeld = React.useRef<ProfileInfo | null>(null);
  if (menuFor) menuHeld.current = menuFor;
  const m = menuHeld.current;
  const room = list.length < MAX_PROFILES;
  return (
    <>
      <SectionTitle>Profiles</SectionTitle>
      <ListCard>
        {[
          ...list.map((p) => {
            const active = p.id === activeProfile;
            return (
              <ListRow
                key={p.id}
                onPress={active ? undefined : () => setConfirm(p)}
                onLongPress={active ? undefined : () => setMenuFor(p)}
                accessibilityRole={active ? undefined : 'button'} accessibilityLabel={rowLabel(p)}
                accessibilityHint={active ? undefined : 'Switches to this profile. Hold for more'}
              >
                <ProfileLine
                  profile={p}
                  end={<IconBtn name="ellipsis-horizontal" size={20} color={C.textDim} onPress={() => setMenuFor(p)} accessibilityLabel={'More for ' + profileName(p)} style={st.more} />}
                />
              </ListRow>
            );
          }),
          ...(room ? [
            <ListRow key="add" onPress={() => setAdding(true)} accessibilityRole="button" accessibilityLabel="Add a profile">
              <View style={[st.avatar, st.addMark, { borderColor: C.outline }]}>
                <Ionicons name="add" size={20} color={C.accent} />
              </View>
              <Text style={[st.name, st.lineText]} numberOfLines={1}>Add a profile</Text>
            </ListRow>,
          ] : []),
        ]}
      </ListCard>
      <Text style={[st.caption, st.sectionNote]}>
        Each profile keeps its own ToDos, notes, journal, settings and cloud account. Only the profile in use rings reminders.
      </Text>
      <DotMenu
        visible={!!menuFor} onClose={() => setMenuFor(null)} title={m ? profileName(m) : undefined}
        items={m ? [
          { label: 'Rename', icon: 'create-outline', onPress: () => setRenaming(m) },
          ...(m.id === 'main' ? [] : [{ label: 'Delete profile', icon: 'trash-outline', color: C.danger, onPress: () => askToDelete(m) }]),
        ] : []}
      />
      <RenameSheet profile={renaming} onClose={() => setRenaming(null)} />
      <PinSheet
        visible={!!pinFor} mode="enter" tint={C.danger} onClose={() => setPinFor(null)}
        other={pinFor ? { id: pinFor.id, name: pinFor.name.trim() } : undefined}
        onDone={() => {
          const p = pinFor;
          setPinFor(null);
          // the keypad's sheet is gone before the confirm opens over the page
          if (p) setTimeout(() => confirmDelete(p), 320);
        }}
      />
      <ConfirmSwitchSheet profile={confirm} onClose={() => setConfirm(null)} />
      <AddProfileSheet visible={adding} onClose={() => setAdding(false)} />
    </>
  );
}

/**
 * Covers the app while it restarts into another profile: the background, the profile's avatar and "Switching to
 * Priya". It takes every touch (Back included). When the app could not restart itself, a sheet asks to close and open
 * it again, or to stay.
 */
export function SwitchingOverlay() {
  const switching = useProfiles((s) => s.switching);
  const theme = useTheme();
  const level = useAnimLevel();
  const shown = useSharedValue(0);
  const on = !!switching;
  React.useEffect(() => {
    if (!on) { shown.value = 0; return; }
    shown.value = level === 'none' ? 1 : withTiming(1, { duration: 220, easing: EASE_OUT });
  }, [on]);
  const fade = useAnimatedStyle(() => ({ opacity: shown.value }));
  // the profile stays named while the overlay is up
  const held = React.useRef(switching);
  if (switching) held.current = switching;
  const s = held.current;
  if (!switching || !s) return null;
  return (
    <Modal visible transparent statusBarTranslucent animationType="none" onRequestClose={() => {}}>
      <Animated.View style={[StyleSheet.absoluteFill, st.overlay, { backgroundColor: bgFor(theme) }, fade]} accessibilityViewIsModal>
        <ProfileAvatar profile={s.to} size={72} />
        <Text style={[T.head, st.overlayText]} accessibilityLiveRegion="polite">
          {'Switching to ' + profileName(s.to)}
        </Text>
      </Animated.View>
      <Sheet visible={!!switching.stuck} onClose={cancelSwitch} title="Open Sturoids again">
        <Text style={st.body}>Close Sturoids and open it again to finish switching.</Text>
        <Text style={[st.caption, { marginTop: 8 }]}>If this shows again, close Sturoids from your recent apps first.</Text>
        <PillButton label="Close Sturoids" onPress={closeToFinish} style={{ marginTop: 18 }} />
        <PillButton label="Not now" outline color={C.textDim} onPress={cancelSwitch} style={{ marginTop: 12 }} />
      </Sheet>
    </Modal>
  );
}

const st = StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  addMark: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, backgroundColor: 'transparent' },
  lineText: { flex: 1, minWidth: 0, marginLeft: 14 },
  name: { color: C.text, fontFamily: F.med, fontSize: 15, lineHeight: 21, letterSpacing: TRACK.body },
  sub: { color: C.textFaint, fontFamily: F.sm, fontSize: 12, lineHeight: 17, letterSpacing: TRACK.fine, marginTop: 1 },
  inUse: { fontFamily: F.smMed, fontSize: 12, letterSpacing: TRACK.fine, marginLeft: 12 },
  // the ellipsis keeps a 44 target and reaches to the row's edge
  more: { marginLeft: 4, marginRight: -6 },
  sheetRow: {
    flexDirection: 'row', alignItems: 'center', minHeight: 60, paddingVertical: 12, paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.hairline,
  },
  sheetRowLast: { borderBottomWidth: 0 },
  actionIcon: { width: 36, alignItems: 'center' },
  actionText: { flex: 1, marginLeft: 14 },
  body: { ...T.body, color: C.textDim },
  label: { color: C.textDim, fontFamily: F.smMed, fontSize: 13, letterSpacing: TRACK.small, marginTop: 4, marginBottom: 12 },
  caption: { ...T.caption },
  sectionNote: { marginTop: 12, marginHorizontal: 4 },
  swatchRow: { flexDirection: 'row', justifyContent: 'center', gap: 12 },
  swatchWell: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  swatchRing: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 22, borderWidth: 2 },
  swatchDisc: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  overlay: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  overlayText: { marginTop: 18, textAlign: 'center' },
});
