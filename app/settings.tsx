import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, Linking } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { C, F, MIN, S, T, ThemeMode, AnimLevel, ACCENT_CHOICES, neuInset, neuRaised } from '../src/theme';
import { useStore, exportSnapshot, importSnapshot } from '../src/store';
import { compareVersions, todayKey } from '../src/utils';
import { ScreenBG, Card, SectionTitle, Field, PillButton, Row, Hairline, Toggle, Chip, InfoDot, NeuHeader, useTheme } from '../src/components/UI';
import { DEFAULT_TAB_SLOTS, TAB_SLOT_OPTIONS } from '../src/components/NeuTabBar';
import { Bouncy, Pop } from '../src/components/Motion';
import { tick } from '../src/haptics';
import { ensurePermission, rescheduleAllReminders } from '../src/notifications';
import { normaliseSlots } from '../src/tools';

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

  const slots: string[] = settings.tabSlots || DEFAULT_TAB_SLOTS;
  const setSlot = (i: number, key: string) => {
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

  const exportData = async () => {
    try {
      const json = JSON.stringify(exportSnapshot(), null, 2);
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
            onPress: () => {
              const ok = importSnapshot(json);
              if (ok) rescheduleAllReminders();
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

        <SectionTitle right={<InfoDot text="Today and More stay fixed — pick the three tabs in between. Choosing a tool that isn't a tab (like Calculator) turns that slot into a one-tap shortcut." />}>
          Tab bar
        </SectionTitle>
        <Card>
          {[0, 1, 2].map((i) => (
            <View key={i} style={{ marginTop: 12 }}>
              <Text style={st.label}>Slot {i + 1}</Text>
              <Row style={{ flexWrap: 'wrap' }}>
                {TAB_SLOT_OPTIONS.map((o) => (
                  <Chip key={o.key} small label={o.label} active={slots[i] === o.key} onPress={() => setSlot(i, o.key)} />
                ))}
              </Row>
            </View>
          ))}
        </Card>

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

        <SectionTitle right={<InfoDot text="Everything is stored locally on this phone — no accounts. Export a JSON backup before changing phones; importing replaces all current data." />}>
          Data — you own it
        </SectionTitle>
        <Card>
          <PillButton label="Export backup (JSON)" icon="download-outline" onPress={exportData} style={{ marginBottom: 10 }} />
          <PillButton label="Import backup" icon="push-outline" color={C.amber} outline onPress={importData} />
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
