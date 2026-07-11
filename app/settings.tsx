import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Switch, Alert, Pressable, Linking } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import Constants from 'expo-constants';
import { C, S, GlassIntensity } from '../src/theme';
import { useStore, exportSnapshot, importSnapshot } from '../src/store';
import { compareVersions, todayKey } from '../src/utils';
import { ScreenBG, GlassCard, SectionTitle, Field, PillButton, Row, Chip } from '../src/components/UI';
import { ensurePermission, rescheduleHabitReminders } from '../src/notifications';

const APP_VERSION = Constants.expoConfig?.version || '1.0.0';

export default function Settings() {
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const habits = useStore((s) => s.habits);
  const [checking, setChecking] = useState(false);

  const toggleReminders = async (v: boolean) => {
    if (v) {
      const ok = await ensurePermission();
      if (!ok) { Alert.alert('Permission needed', 'Allow notifications in system settings to get habit reminders.'); return; }
    }
    setSetting('remindersEnabled', v);
    rescheduleHabitReminders(habits, v);
  };

  const exportData = async () => {
    try {
      const json = JSON.stringify(exportSnapshot(), null, 2);
      const uri = FileSystem.cacheDirectory + `student-hub-backup-${todayKey()}.json`;
      await FileSystem.writeAsStringAsync(uri, json);
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/json' });
      else Alert.alert('Saved', `Backup written to:\n${uri}`);
    } catch (e: any) {
      Alert.alert('Export failed', String(e?.message || e));
    }
  };

  const importData = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      const json = await FileSystem.readAsStringAsync(res.assets[0].uri);
      Alert.alert('Import backup', 'This replaces ALL current data with the backup. Continue?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Replace', style: 'destructive',
          onPress: () => {
            const ok = importSnapshot(json);
            Alert.alert(ok ? 'Imported' : 'Invalid file',
              ok ? 'Your data is restored.' : 'That file is not a Student Hub backup.');
          },
        },
      ]);
    } catch (e: any) {
      Alert.alert('Import failed', String(e?.message || e));
    }
  };

  const checkUpdate = async () => {
    const repo = settings.githubRepo.trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
      Alert.alert('Set the repo first', 'Enter it as owner/repo — e.g. sanjay/student-hub — once the app is on GitHub Releases.');
      return;
    }
    setChecking(true);
    try {
      const r = await fetch(`https://api.github.com/repos/${repo}/releases/latest`);
      if (!r.ok) throw new Error(`GitHub said ${r.status}`);
      const j = await r.json();
      const latest = String(j.tag_name || '');
      if (compareVersions(latest, APP_VERSION) > 0) {
        Alert.alert(`${latest} available`, 'Download the new APK from GitHub?', [
          { text: 'Later', style: 'cancel' },
          { text: 'Open', onPress: () => Linking.openURL(j.html_url) },
        ]);
      } else {
        Alert.alert('Up to date', `You're on v${APP_VERSION} — nothing newer on Releases.`);
      }
    } catch (e: any) {
      Alert.alert('Check failed', String(e?.message || e));
    } finally {
      setChecking(false);
    }
  };

  return (
    <ScreenBG>
      <ScrollView contentContainerStyle={{ padding: S.pad, paddingBottom: 40 }}>
        <SectionTitle>Profile</SectionTitle>
        <GlassCard>
          <Text style={st.label}>Name (used in the greeting)</Text>
          <Field value={settings.name} onChangeText={(v) => setSetting('name', v)} placeholder="Your name" />
        </GlassCard>

        <SectionTitle>Theme</SectionTitle>
        <GlassCard>
          <Text style={st.label}>Glass intensity</Text>
          <Row style={{ marginBottom: 4 }}>
            {(['off', 'subtle', 'full'] as GlassIntensity[]).map((g) => (
              <Chip key={g} label={g[0].toUpperCase() + g.slice(1)} active={settings.glassIntensity === g}
                onPress={() => setSetting('glassIntensity', g)} />
            ))}
          </Row>
          <Text style={st.hint}>Off is the escape hatch for low-end phones; Full is the bubbbly look.</Text>
        </GlassCard>

        <SectionTitle>Clock</SectionTitle>
        <GlassCard>
          <Row style={{ marginBottom: 10 }}>
            <Chip label="Digital" active={settings.clockStyle === 'digital'} onPress={() => setSetting('clockStyle', 'digital')} />
            <Chip label="Analogue" active={settings.clockStyle === 'analog'} onPress={() => setSetting('clockStyle', 'analog')} />
          </Row>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={{ color: C.text, fontSize: 15 }}>24-hour time</Text>
            <Switch value={settings.hour24} onValueChange={(v) => setSetting('hour24', v)}
              trackColor={{ true: C.accent + '88', false: 'rgba(255,255,255,0.15)' }} thumbColor={settings.hour24 ? C.accent : '#ccc'} />
          </Row>
        </GlassCard>

        <SectionTitle>Reminders</SectionTitle>
        <GlassCard>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={{ color: C.text, fontSize: 15 }}>Habit reminders</Text>
            <Switch value={settings.remindersEnabled} onValueChange={toggleReminders}
              trackColor={{ true: C.green + '88', false: 'rgba(255,255,255,0.15)' }} thumbColor={settings.remindersEnabled ? C.green : '#ccc'} />
          </Row>
          <Text style={st.hint}>Per-habit times are set when adding a habit in Planner → Streaks.</Text>
        </GlassCard>

        <SectionTitle>Data — you own it</SectionTitle>
        <GlassCard>
          <PillButton label="Export backup (JSON)" icon="download-outline" onPress={exportData} style={{ marginBottom: 10 }} />
          <PillButton label="Import backup" icon="push-outline" color={C.amber} outline onPress={importData} />
          <Text style={st.hint}>Everything local, no accounts — so back up before changing phones.</Text>
        </GlassCard>

        <SectionTitle>Updates</SectionTitle>
        <GlassCard>
          <Text style={st.label}>GitHub repo (owner/repo)</Text>
          <Field value={settings.githubRepo} onChangeText={(v) => setSetting('githubRepo', v)}
            placeholder="e.g. sanjay/student-hub" autoCapitalize="none" />
          <PillButton label={checking ? 'Checking…' : 'Check for updates'} icon="cloud-download-outline" onPress={checkUpdate} />
          <Text style={st.hint}>Sideloaded APKs don't auto-update; this checks GitHub Releases for a newer tag.</Text>
        </GlassCard>

        <Text style={{ color: C.textFaint, textAlign: 'center', marginTop: 16, fontSize: 12 }}>
          Student Hub v{APP_VERSION} · local-first · made for focused work
        </Text>
      </ScrollView>
    </ScreenBG>
  );
}

const st = StyleSheet.create({
  label: { color: C.textDim, fontSize: 13, marginBottom: 8 },
  hint: { color: C.textFaint, fontSize: 12, marginTop: 8, lineHeight: 17 },
});
