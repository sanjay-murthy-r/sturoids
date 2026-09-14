import React from 'react';
import { Alert, AppState, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';
import { C, F, MIN, NEU, S, T } from '../theme';
import { useStore, JournalEntry } from '../store';
import { todayKey } from '../utils';
import {
  Chip, DotMenu, Field, Hairline, IconBtn, NeuHeader, NeuIconBtn, PillButton, ProgressBar, Row, ScreenBG, Sheet, Toggle, useTheme,
} from '../components/UI';
import { SegmentedControl } from '../components/SegmentedControl';
import { Bouncy, useAnimLevel } from '../components/Motion';
import { LockGate, PinSheet } from '../components/LockGate';
import { JournalCalendar } from '../components/JournalCalendar';
import {
  MOODS, countWords, deleteEntry, formatJournalDate, journalDayFor, promptFor, readBody, relativeDay, saveEntry,
  shiftKey, takeJournalOpenRequest,
} from '../journal';
import { useToolNav } from '../toolNav';
import { tap, tick } from '../haptics';
import { ensurePermission, rescheduleAllReminders } from '../notifications';
import { lockProtectionAvailable, markUnlocked, useUnlocked } from '../lock';

type Mood = JournalEntry['mood'];
interface Draft {
  id: string | null; dateKey: string; title: string; body: string;
  mood: Mood; tags: string[]; promptId?: string; dirty: boolean;
}

const SAVE_DEBOUNCE_MS = 400;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function JournalScreen({ mode }: { mode: 'tab' | 'stack' }) {
  const settings = useStore((s) => s.settings);
  const unlocked = useUnlocked();
  const tabMode = mode === 'tab';
  if (settings.journalLocked && !unlocked) {
    return (
      <ScreenBG guard={tabMode}>
        <NeuHeader title="Journal" variant={tabMode ? 'tab' : 'page'} />
        <LockGate locked title="Journal is locked"><View /></LockGate>
      </ScreenBG>
    );
  }
  return <WritingSpace tabMode={tabMode} />;
}

function WritingSpace({ tabMode }: { tabMode: boolean }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const theme = useTheme();
  const level = useAnimLevel();
  const nav = useToolNav();
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const journal = useStore((s) => s.journal);
  const journalTags = useStore((s) => s.journalTags);
  const setJournalTags = useStore((s) => s.setJournalTags);
  const patchJournalEntry = useStore((s) => s.patchJournalEntry);

  const [dateKey, setDateKey] = React.useState(() => journalDayFor(new Date(), settings.journalCutoffHour));
  const [entryId, setEntryId] = React.useState<string | null>(null);
  const [title, setTitle] = React.useState('');
  const [body, setBody] = React.useState('');
  const [mood, setMood] = React.useState<Mood>(undefined);
  const [tags, setTags] = React.useState<string[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [saveFailed, setSaveFailed] = React.useState(false);
  const [dateSheet, setDateSheet] = React.useState(false);
  const [menu, setMenu] = React.useState(false);
  const [tagSheet, setTagSheet] = React.useState(false);
  const [tagDraft, setTagDraft] = React.useState('');
  const [prefs, setPrefs] = React.useState(false);
  const [remindDraft, setRemindDraft] = React.useState(settings.journalReminderTime || '21:30');
  const [pinSetup, setPinSetup] = React.useState(false);

  const draft = React.useRef<Draft>({ id: null, dateKey, title: '', body: '', mood: undefined, tags: [], dirty: false });
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = React.useRef<Promise<void>>(Promise.resolve());
  const booted = React.useRef(false);
  const autoDay = React.useRef(true); // the page follows the journal day until the user picks one
  const bodyRef = React.useRef<TextInput>(null);

  // ---- motion: chrome recedes while typing, a small tick confirms each save ----
  const dim = useSharedValue(0);
  const saved = useSharedValue(0);
  const idle = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const headStyle = useAnimatedStyle(() => ({ opacity: 1 - 0.6 * dim.value, transform: [{ translateY: -6 * dim.value }] }));
  const footStyle = useAnimatedStyle(() => ({ opacity: 1 - 0.6 * dim.value, transform: [{ translateY: 6 * dim.value }] }));
  const tickStyle = useAnimatedStyle(() => ({ opacity: saved.value }));
  const markTyping = () => {
    if (level === 'none') return;
    dim.value = withTiming(1, { duration: 220 });
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(() => { dim.value = withTiming(0, { duration: 420 }); }, 1400);
  };

  // ---- saving: serialised, so two flushes can never create the same entry twice ----
  const runFlush = React.useCallback(async () => {
    const d = draft.current;
    if (!d.dirty) return;
    d.dirty = false;
    const empty = !d.title.trim() && !d.body.trim() && d.mood == null && d.tags.length === 0;
    try {
      if (empty) {
        if (d.id) {
          await deleteEntry(d.id);
          d.id = null;
          setEntryId(null);
        }
        return;
      }
      const id = await saveEntry({
        id: d.id ?? undefined, dateKey: d.dateKey, title: d.title, body: d.body, mood: d.mood, tags: d.tags, promptId: d.promptId,
      });
      if (draft.current === d && !d.id) {
        d.id = id;
        setEntryId(id);
      }
      setSaveFailed(false);
      if (level !== 'none') saved.value = withSequence(withTiming(1, { duration: 160 }), withDelay(700, withTiming(0, { duration: 300 })));
    } catch {
      d.dirty = true;
      setSaveFailed(true);
    }
  }, [level]);

  const flush = React.useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    queue.current = queue.current.then(runFlush);
    return queue.current;
  }, [runFlush]);

  const schedule = () => {
    draft.current.dirty = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { flush(); }, SAVE_DEBOUNCE_MS);
  };

  const loadEntry = React.useCallback(async (key: string, id: string | null) => {
    const meta = id ? useStore.getState().journal.find((e) => e.id === id) : undefined;
    const text = meta ? await readBody(meta.id) : '';
    draft.current = {
      id: meta?.id ?? null, dateKey: key, title: meta?.title ?? '', body: text,
      mood: meta?.mood, tags: meta?.tags ?? [], promptId: meta?.promptId, dirty: false,
    };
    setDateKey(key);
    setEntryId(meta?.id ?? null);
    setTitle(draft.current.title);
    setBody(text);
    setMood(meta?.mood);
    setTags(draft.current.tags);
    setLoaded(true);
  }, []);

  const openDay = React.useCallback(async (key: string, id?: string | null) => {
    await flush();
    const day = useStore.getState().journal.filter((e) => e.dateKey === key).sort((a, b) => a.createdAt - b.createdAt);
    await loadEntry(key, id === undefined ? day[0]?.id ?? null : id);
  }, [flush, loadEntry]);

  useFocusEffect(React.useCallback(() => {
    const req = takeJournalOpenRequest();
    if (req) {
      autoDay.current = false;
      openDay(req.dateKey, req.entryId ?? undefined);
    } else if (!booted.current) {
      openDay(journalDayFor(new Date(), useStore.getState().settings.journalCutoffHour));
    }
    booted.current = true;
    return () => { flush(); };
  }, [openDay, flush]));

  // leaving the app saves; coming back on a new journal day moves an untouched page along
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') { flush(); return; }
      const day = journalDayFor(new Date(), useStore.getState().settings.journalCutoffHour);
      if (autoDay.current && day !== draft.current.dateKey) openDay(day);
    });
    return () => {
      sub.remove();
      if (idle.current) clearTimeout(idle.current);
      flush();
    };
  }, [flush, openDay]);

  // an entry deleted elsewhere (the archive) leaves a blank page for its day
  React.useEffect(() => {
    if (entryId && !journal.some((e) => e.id === entryId) && !draft.current.dirty) loadEntry(draft.current.dateKey, null);
  }, [journal, entryId, loadEntry]);

  // ---- edits ----
  const onTitle = (t: string) => { setTitle(t); draft.current.title = t; schedule(); markTyping(); };
  const onBody = (t: string) => { setBody(t); draft.current.body = t; schedule(); markTyping(); };
  const pickMood = (m: Mood) => {
    tick();
    const next = draft.current.mood === m ? undefined : m;
    setMood(next);
    draft.current.mood = next;
    schedule();
  };
  const toggleTag = (t: string) => {
    tap();
    const next = draft.current.tags.includes(t) ? draft.current.tags.filter((x) => x !== t) : [...draft.current.tags, t];
    setTags(next);
    draft.current.tags = next;
    schedule();
  };
  const addTag = () => {
    const t = tagDraft.trim().toLowerCase().replace(/^#+/, '').replace(/\s+/g, '-');
    if (!t) return;
    if (!journalTags.includes(t)) setJournalTags([...journalTags, t].sort());
    if (!draft.current.tags.includes(t)) toggleTag(t);
    setTagDraft('');
  };

  const prompt = promptFor(dateKey);
  const showPrompt = loaded && settings.journalPromptsOn && !body.trim();
  const usePrompt = () => {
    tap();
    draft.current.promptId = prompt.id;
    onBody(prompt.text + '\n\n' + body);
    setTimeout(() => bodyRef.current?.focus(), 60);
  };

  const today = todayKey();
  const dayEntries = journal.filter((e) => e.dateKey === dateKey).sort((a, b) => a.createdAt - b.createdAt);
  const at = entryId ? dayEntries.findIndex((e) => e.id === entryId) : -1;
  const words = countWords(body);
  const goal = settings.journalWordGoal;
  const hint = dayEntries.length > 1 && at >= 0
    ? 'Entry ' + (at + 1) + ' of ' + dayEntries.length
    : relativeDay(dateKey) || (dateKey > today ? '' : ' ');
  const marked = React.useMemo(() => new Set(journal.map((e) => e.dateKey)), [journal]);
  const current = entryId ? journal.find((e) => e.id === entryId) : undefined;

  const openArchive = async () => { tick(); await flush(); nav.openArchive(); };
  const pickDay = (key: string) => { setDateSheet(false); autoDay.current = false; openDay(key); };

  const shareText = () => {
    const text = [formatJournalDate(dateKey), title.trim(), body.trim()].filter(Boolean).join('\n\n');
    Share.share({ message: text });
  };
  const confirmDelete = () => {
    if (!entryId) return;
    Alert.alert('Delete this entry?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          if (timer.current) { clearTimeout(timer.current); timer.current = null; }
          draft.current.dirty = false;
          await deleteEntry(entryId);
          const rest = useStore.getState().journal.filter((e) => e.dateKey === dateKey).sort((a, b) => a.createdAt - b.createdAt);
          loadEntry(dateKey, rest[0]?.id ?? null);
        },
      },
    ]);
  };

  const setLock = async (on: boolean) => {
    if (!on) { setSetting('journalLocked', false); return; }
    if (await lockProtectionAvailable()) {
      // the lock takes effect at once: the gate asks for the device's own lock before the page returns
      setSetting('journalLocked', true);
    } else {
      setPinSetup(true);
    }
  };
  const saveReminder = async (on: boolean) => {
    if (on) {
      if (!HHMM.test(remindDraft)) { Alert.alert('Use 24h HH:MM, e.g. 21:30'); return; }
      if (!(await ensurePermission())) { Alert.alert('Permission needed', 'Allow notifications in system settings first.'); return; }
    }
    setSetting('journalReminderTime', on ? remindDraft : '');
    setTimeout(rescheduleAllReminders, 150);
  };

  const well = theme === 'minimal' ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border } : { backgroundColor: C.inset, ...NEU.insetLow };
  const raised = theme === 'minimal' ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: C.gold } : { backgroundColor: C.card, ...NEU.raisedLow };

  return (
    <ScreenBG guard={tabMode}>
      <Animated.View style={[st.head, { paddingTop: insets.top + (tabMode ? 14 : 8) }, headStyle]}>
        <View style={st.side}>
          {tabMode ? null : <NeuIconBtn name="arrow-back" dim={38} size={19} color={C.textDim} onPress={() => router.back()} />}
        </View>
        <Bouncy onPress={() => { tick(); setDateSheet(true); }} scaleTo={0.97} radius={14} style={st.dateBtn}>
          <Text style={st.date} numberOfLines={1}>{formatJournalDate(dateKey)}</Text>
          <Text style={[T.caption, { marginTop: 1 }]}>{hint}</Text>
        </Bouncy>
        <View style={[st.side, { justifyContent: 'flex-end' }]}>
          <NeuIconBtn name="albums-outline" dim={38} size={18} color={C.textDim} onPress={openArchive} />
          <NeuIconBtn name="ellipsis-horizontal" dim={38} size={18} color={C.textDim} onPress={() => setMenu(true)} style={{ marginLeft: 8 }} />
        </View>
      </Animated.View>
      {goal > 0 ? (
        <View style={{ paddingHorizontal: S.pad + 4, marginBottom: 4 }}>
          <ProgressBar value={Math.min(1, words / goal)} height={4} color={C.gold} />
        </View>
      ) : null}

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: S.pad + 4, paddingTop: 8, paddingBottom: 40 }}>
        <TextInput
          value={title}
          onChangeText={onTitle}
          editable={loaded}
          placeholder="Title, if you want one"
          placeholderTextColor={C.textFaint}
          style={st.title}
          maxLength={120}
          returnKeyType="next"
          blurOnSubmit={false}
          onSubmitEditing={() => bodyRef.current?.focus()}
        />
        {showPrompt ? (
          <Bouncy onPress={usePrompt} scaleTo={0.98} radius={12} style={st.prompt}>
            <Ionicons name="bulb-outline" size={15} color={C.gold} />
            <Text style={st.promptText}>{prompt.text}</Text>
          </Bouncy>
        ) : null}
        <TextInput
          ref={bodyRef}
          value={body}
          onChangeText={onBody}
          editable={loaded}
          placeholder="Start writing"
          placeholderTextColor={C.textFaint}
          multiline
          scrollEnabled={false}
          textAlignVertical="top"
          style={st.body}
        />
      </ScrollView>

      <Animated.View style={[st.foot, { paddingBottom: 10 + (tabMode ? 0 : insets.bottom) }, footStyle]}>
        <Row style={{ flex: 1 }}>
          {MOODS.map((m) => {
            const active = mood === m.value;
            return (
              <Bouncy
                key={m.value}
                onPress={() => pickMood(m.value)}
                scaleTo={0.9}
                radius={17}
                style={[st.moodWell, active ? raised : well]}
              >
                <Ionicons name={m.icon as any} size={17} color={active ? C.gold : C.textFaint} accessibilityLabel={m.label} />
              </Bouncy>
            );
          })}
          <IconBtn name={tags.length ? 'pricetag' : 'pricetag-outline'} size={19} pad={8} color={tags.length ? C.gold : C.textDim} onPress={() => setTagSheet(true)} />
        </Row>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[st.words, saveFailed && { color: C.danger }]}>
            {saveFailed ? 'Not saved' : words + (words === 1 ? ' word' : ' words')}
          </Text>
          <Animated.View style={[st.tick, tickStyle]} />
        </View>
      </Animated.View>

      <Sheet visible={dateSheet} onClose={() => setDateSheet(false)} title="Which day?">
        <Row style={{ marginBottom: 12 }}>
          <Chip label="Yesterday" icon="arrow-undo-outline" active={dateKey === shiftKey(today, -1)} onPress={() => pickDay(shiftKey(today, -1))} />
          <Chip label="Today" icon="today-outline" active={dateKey === today} onPress={() => pickDay(today)} />
        </Row>
        <JournalCalendar value={dateKey} onPick={pickDay} marked={marked} maxKey={today} />
      </Sheet>

      <DotMenu
        visible={menu}
        onClose={() => setMenu(false)}
        items={[
          ...(entryId ? [{ label: 'New entry for this day', icon: 'add-outline', onPress: async () => { await flush(); loadEntry(dateKey, null); } }] : []),
          ...(dayEntries.length > 1 && at >= 0 ? [{ label: 'Next entry on this day', icon: 'swap-horizontal-outline', onPress: async () => { await flush(); loadEntry(dateKey, dayEntries[(at + 1) % dayEntries.length].id); } }] : []),
          ...(current ? [{ label: current.pinned ? 'Unpin' : 'Pin', icon: current.pinned ? 'pin' : 'pin-outline', onPress: () => patchJournalEntry(current.id, { pinned: !current.pinned }) }] : []),
          ...(title.trim() || body.trim() ? [
            { label: 'Share as text', icon: 'share-outline', onPress: shareText },
            { label: 'Copy text', icon: 'copy-outline', onPress: () => Clipboard.setStringAsync([title.trim(), body.trim()].filter(Boolean).join('\n\n')) },
          ] : []),
          { label: 'Journal settings', icon: 'options-outline', onPress: () => { setRemindDraft(settings.journalReminderTime || '21:30'); setPrefs(true); } },
          ...(entryId ? [{ label: 'Delete entry', icon: 'trash-outline', color: C.danger, onPress: confirmDelete }] : []),
        ]}
      />

      <Sheet visible={tagSheet} onClose={() => setTagSheet(false)} title="Tags">
        {journalTags.length ? (
          <Row style={{ flexWrap: 'wrap', marginBottom: 8 }}>
            {journalTags.map((t) => <Chip key={t} small label={t} active={tags.includes(t)} color={C.gold} onPress={() => toggleTag(t)} />)}
          </Row>
        ) : (
          <Text style={[T.caption, { marginBottom: 10 }]}>Tags group entries, like exams, family or sport.</Text>
        )}
        <Field value={tagDraft} onChangeText={setTagDraft} placeholder="New tag" autoCapitalize="none" onSubmitEditing={addTag} returnKeyType="done" />
        <PillButton label="Add tag" icon="add-outline" color={C.gold} onPress={addTag} />
      </Sheet>

      <Sheet visible={prefs} onClose={() => setPrefs(false)} title="Journal settings">
        <Text style={st.prefLabel}>Day starts at</Text>
        <SegmentedControl
          size="sm" stretch
          options={[9, 10, 11, 12].map((h) => ({ key: String(h), label: h + ':00' }))}
          value={String(settings.journalCutoffHour)}
          onChange={(k) => setSetting('journalCutoffHour', Number(k))}
        />
        <Text style={[T.caption, { marginTop: 6 }]}>Before this time, the Journal opens on yesterday's page.</Text>
        <Hairline />
        <Row style={st.prefRow}>
          <Text style={[T.body, { flex: 1 }]}>Daily prompt</Text>
          <Toggle value={settings.journalPromptsOn} onChange={(v) => setSetting('journalPromptsOn', v)} color={C.gold} />
        </Row>
        <Hairline />
        <Text style={st.prefLabel}>Word goal</Text>
        <SegmentedControl
          size="sm" stretch
          options={[0, 150, 300, 500].map((n) => ({ key: String(n), label: n ? String(n) : 'Off' }))}
          value={String(goal)}
          onChange={(k) => setSetting('journalWordGoal', Number(k))}
        />
        <Hairline />
        <Row style={st.prefRow}>
          <Text style={[T.body, { flex: 1 }]}>Reminder</Text>
          <Toggle value={!!settings.journalReminderTime} onChange={saveReminder} color={C.gold} />
        </Row>
        {settings.remindersEnabled ? (
          <Field value={remindDraft} onChangeText={setRemindDraft} placeholder="21:30" keyboardType="numbers-and-punctuation" maxLength={5} onEndEditing={() => { if (settings.journalReminderTime && HHMM.test(remindDraft)) saveReminder(true); }} />
        ) : (
          <Text style={[T.caption, { marginBottom: 6 }]}>Turn on reminders in Settings first.</Text>
        )}
        <Hairline />
        <Row style={st.prefRow}>
          <Text style={[T.body, { flex: 1 }]}>Lock journal</Text>
          <Toggle value={settings.journalLocked} onChange={setLock} color={C.gold} />
        </Row>
      </Sheet>

      <PinSheet
        visible={pinSetup}
        mode="set"
        onClose={() => setPinSetup(false)}
        onDone={() => { setPinSetup(false); setSetting('journalLocked', true); markUnlocked(); }}
      />
    </ScreenBG>
  );
}

const st = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingBottom: 8 },
  side: { width: 84, flexDirection: 'row', alignItems: 'center' },
  dateBtn: { flex: 1, alignItems: 'center', paddingVertical: 4 },
  date: { color: C.text, fontFamily: F.bold, fontSize: 20, letterSpacing: -0.3 },
  title: { color: C.text, fontFamily: F.semi, fontSize: 17, letterSpacing: -0.1, paddingVertical: 8 },
  prompt: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, marginBottom: 2 },
  promptText: { flex: 1, color: C.textDim, fontFamily: F.reg, fontSize: 14, lineHeight: 20 },
  body: { color: C.text, fontFamily: F.reg, fontSize: 16, lineHeight: 26, minHeight: 320, paddingTop: 6 },
  foot: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: S.pad, paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.hairline,
  },
  moodWell: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  words: { color: C.textFaint, fontFamily: F.med, fontSize: 12, fontVariant: ['tabular-nums'] },
  tick: { width: 16, height: 2, borderRadius: 1, backgroundColor: C.accent, marginTop: 4 },
  prefLabel: { ...T.label, marginTop: 10, marginBottom: 8 },
  prefRow: { paddingVertical: 10 },
});
