import React from 'react';
import { Alert, AppState, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import Animated, { Easing, FadeIn, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';
import { C, F, S, T, TRACK } from '../theme';
import { useStore, JournalEntry, flushSaves } from '../store';
import { todayKey } from '../utils';
import {
  Chip, DotMenu, Field, GateHeader, Hairline, IconBtn, PillButton, ProgressBar, Row, ScreenBG, Sheet, Toggle, useTheme,
  useToolHeader,
} from '../components/UI';
import { SegmentedControl } from '../components/SegmentedControl';
import { Bouncy, EASE_OUT, Enter, FadeSwap, shiftIn, useAnimLevel } from '../components/Motion';
import { PinSheet, ToolGate } from '../components/LockGate';
import { JournalCalendar } from '../components/JournalCalendar';
import {
  MOODS, countWords, deleteEntry, formatJournalDate, journalDateParts, journalDayFor, promptFor, readBody, relativeDay, saveEntry,
  shiftKey, takeJournalOpenRequest, onBodiesRestored,
} from '../journal';
import { useToolNav } from '../toolNav';
import { tap, tick } from '../haptics';
import { ensurePermission, rescheduleAllReminders } from '../notifications';
import { markOpen, pinStatus } from '../lock';
import { useKeyboardOpen } from '../hooks/useKeyboard';
import { useNow } from '../hooks/useNow';
import { DayCheckout } from '../components/DayCheckout';
import { QuickTaskSheet } from '../components/QuickTaskSheet';

type Mood = JournalEntry['mood'];
type Rating = JournalEntry['rating'];
interface Draft {
  id: string | null; dateKey: string; title: string; body: string;
  mood: Mood; rating: Rating; checkoutSkipped: boolean; tags: string[]; promptId?: string; dirty: boolean;
  /** the stored entry's updatedAt as this page last loaded or saved it: a different one means it changed elsewhere */
  seen?: number;
}

const SAVE_DEBOUNCE_MS = 400;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
/** the check-out offers itself only after a real page has been written */
const CHECKOUT_MIN_WORDS = 30;

export function JournalScreen({ mode }: { mode: 'tab' | 'stack' }) {
  const tabMode = mode === 'tab';
  return (
    <ToolGate tool="journal" guard={tabMode} header={<GateHeader title="Journal" tab={tabMode} />}>
      <WritingSpace tabMode={tabMode} />
    </ToolGate>
  );
}

function WritingSpace({ tabMode }: { tabMode: boolean }) {
  const insets = useSafeAreaInsets();
  useTheme(); // repaints on a new accent
  const level = useAnimLevel();
  const nav = useToolNav();
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const journal = useStore((s) => s.journal);
  const patchJournalEntry = useStore((s) => s.patchJournalEntry);

  const [dateKey, setDateKey] = React.useState(() => journalDayFor(new Date(), settings.journalCutoffHour));
  const [entryId, setEntryId] = React.useState<string | null>(null);
  const [title, setTitle] = React.useState('');
  const [body, setBody] = React.useState('');
  const [mood, setMood] = React.useState<Mood>(undefined);
  const [rating, setRating] = React.useState<Rating>(undefined);
  const [skipped, setSkipped] = React.useState(false);
  // the check-out card: offered by itself after writing ('offered'), or opened from the day button ('asked')
  const [checkout, setCheckout] = React.useState<null | 'offered' | 'asked'>(null);
  const [edited, setEdited] = React.useState(false);
  const [taskSheet, setTaskSheet] = React.useState(false);
  const [taskTitle, setTaskTitle] = React.useState('');
  const [tags, setTags] = React.useState<string[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [saveFailed, setSaveFailed] = React.useState(false);
  const [dateSheet, setDateSheet] = React.useState(false);
  const [menu, setMenu] = React.useState(false);
  const [tagSheet, setTagSheet] = React.useState(false);
  const [prefs, setPrefs] = React.useState(false);
  const [pinFlow, setPinFlow] = React.useState(false);
  // each page loaded is a new page: it counts up so the page can arrive with its own entrance
  const [page, setPage] = React.useState(0);
  const turnDir = React.useRef<0 | 1 | -1>(0);

  const draft = React.useRef<Draft>({
    id: null, dateKey, title: '', body: '', mood: undefined, rating: undefined, checkoutSkipped: false, tags: [], dirty: false,
  });
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = React.useRef<Promise<void>>(Promise.resolve());
  const booted = React.useRef(false);
  const autoDay = React.useRef(true); // the page follows the journal day until the user picks one
  const bodyRef = React.useRef<TextInput>(null);
  // what is selected in the page, to start a task with it, and whether the page had the keyboard, to give it back
  const selection = React.useRef({ start: 0, end: 0 });
  const bodyFocused = React.useRef(false);
  const refocus = React.useRef(false);
  const keyboardOpen = useKeyboardOpen();

  // ---- motion: chrome recedes while typing, a small tick confirms each save ----
  const dim = useSharedValue(0);
  const saved = useSharedValue(0);
  const idle = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // with only some motion the chrome fades back and nothing travels
  const drift = level === 'full' ? 6 : 0;
  const headStyle = useAnimatedStyle(() => ({ opacity: 1 - 0.6 * dim.value, transform: [{ translateY: -drift * dim.value }] }));
  const footStyle = useAnimatedStyle(() => ({ opacity: 1 - 0.6 * dim.value, transform: [{ translateY: drift * dim.value }] }));
  const tickStyle = useAnimatedStyle(() => ({ opacity: saved.value }));
  const markTyping = () => {
    if (level === 'none') return;
    dim.value = withTiming(1, { duration: 220, easing: EASE_OUT });
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(() => { dim.value = withTiming(0, { duration: level === 'full' ? 420 : 200, easing: Easing.inOut(Easing.quad) }); }, 1400);
  };

  // ---- the page turns the way time runs: a later day arrives from the right, an earlier one from the left. The page
  // is keyed on its load, so the entrance runs as the new words mount (setting shared values beforehand moved the old
  // page for a frame before the new one had rendered) ----
  const pageEnter = level === 'none' ? undefined
    : level === 'some' ? FadeIn.duration(180).easing(EASE_OUT)
      : turnDir.current ? shiftIn(turnDir.current * 22) : FadeIn.duration(240).easing(EASE_OUT);

  // ---- saving: serialised, so two flushes can never create the same entry twice ----
  // set while a save is on its way, so a store change it causes is never mistaken for one made elsewhere
  const saving = React.useRef(false);
  const runFlush = React.useCallback(async () => {
    const d = draft.current;
    if (!d.dirty) return;
    d.dirty = false;
    saving.current = true;
    const empty = !d.title.trim() && !d.body.trim() && d.mood == null && d.rating == null && d.tags.length === 0;
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
        id: d.id ?? undefined, dateKey: d.dateKey, title: d.title, body: d.body, mood: d.mood, rating: d.rating,
        checkoutSkipped: d.checkoutSkipped, tags: d.tags, promptId: d.promptId,
      });
      if (draft.current === d && !d.id) {
        d.id = id;
        setEntryId(id);
      }
      d.seen = useStore.getState().journal.find((x) => x.id === id)?.updatedAt;
      setSaveFailed(false);
      if (level !== 'none') {
        saved.value = withSequence(
          withTiming(1, { duration: 160, easing: EASE_OUT }),
          withDelay(700, withTiming(0, { duration: 300, easing: Easing.in(Easing.quad) })),
        );
      }
    } catch {
      d.dirty = true;
      setSaveFailed(true);
    } finally {
      saving.current = false;
    }
  }, [level]);

  const flush = React.useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    queue.current = queue.current.then(runFlush);
    return queue.current;
  }, [runFlush]);

  const schedule = React.useCallback(() => {
    draft.current.dirty = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { flush(); }, SAVE_DEBOUNCE_MS);
  }, [flush]);

  /** Loads a page. `dir` is the way the page turns: 1 for a later day, -1 for an earlier one, 0 in place. */
  const loadEntry = React.useCallback(async (key: string, id: string | null, dir: 0 | 1 | -1 = 0) => {
    const meta = id ? useStore.getState().journal.find((e) => e.id === id) : undefined;
    const text = meta ? await readBody(meta.id) : '';
    turnDir.current = dir;
    setPage((n) => n + 1);
    draft.current = {
      id: meta?.id ?? null, dateKey: key, title: meta?.title ?? '', body: text,
      mood: meta?.mood, rating: meta?.rating, checkoutSkipped: !!meta?.checkoutSkipped,
      tags: meta?.tags ?? [], promptId: meta?.promptId, dirty: false, seen: meta?.updatedAt,
    };
    setDateKey(key);
    setEntryId(meta?.id ?? null);
    setTitle(draft.current.title);
    setBody(text);
    setMood(meta?.mood);
    setRating(meta?.rating);
    setSkipped(!!meta?.checkoutSkipped);
    // a page opened afresh has not been written in on this visit, so it offers no check-out
    setEdited(false);
    setCheckout(null);
    setTags(draft.current.tags);
    setLoaded(true);
  }, []);

  const openDay = React.useCallback(async (key: string, id?: string | null) => {
    await flush();
    const from = draft.current.dateKey;
    const day = useStore.getState().journal.filter((e) => e.dateKey === key).sort((a, b) => a.createdAt - b.createdAt);
    await loadEntry(key, id === undefined ? day[0]?.id ?? null : id, key > from ? 1 : key < from ? -1 : 0);
  }, [flush, loadEntry]);

  useFocusEffect(React.useCallback(() => {
    const req = takeJournalOpenRequest();
    if (req) {
      autoDay.current = false;
      openDay(req.dateKey, req.entryId ?? undefined);
    } else if (!booted.current) {
      openDay(journalDayFor(new Date(), useStore.getState().settings.journalCutoffHour));
    } else if (autoDay.current) {
      // back from another tab: a page that follows the day moves along once the cutoff has passed
      const day = journalDayFor(new Date(), useStore.getState().settings.journalCutoffHour);
      if (day !== draft.current.dateKey) openDay(day);
    }
    booted.current = true;
    return () => { flush(); };
  }, [openDay, flush]));

  // leaving the app saves; coming back on a new journal day moves an untouched page along
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      // the entry lands in the store only once its file is written, so storage is written after that, not before
      if (s !== 'active') { flush().then(flushSaves); return; }
      const day = journalDayFor(new Date(), useStore.getState().settings.journalCutoffHour);
      if (autoDay.current && day !== draft.current.dateKey) openDay(day);
    });
    return () => {
      sub.remove();
      if (idle.current) clearTimeout(idle.current);
      flush().then(flushSaves);
    };
  }, [flush, openDay]);

  // an entry deleted elsewhere (the archive) leaves a blank page for its day; one changed elsewhere (a restored
  // backup) reloads when nothing typed is waiting, so a later keystroke never writes the old text back over it; one
  // moved to another day takes the page with it
  React.useEffect(() => {
    if (!entryId) return;
    const e = journal.find((x) => x.id === entryId);
    const idleNow = !draft.current.dirty && !timer.current && !saving.current;
    if (!e) {
      if (!draft.current.dirty) loadEntry(draft.current.dateKey, null);
    } else if (idleNow && e.updatedAt !== draft.current.seen) {
      loadEntry(e.dateKey, e.id);
    } else if (e.dateKey !== draft.current.dateKey) {
      autoDay.current = false;
      draft.current.dateKey = e.dateKey;
      setDateKey(e.dateKey);
    }
  }, [journal, entryId, loadEntry]);

  // a restore writes the texts after the index: once they are in, an idle page reads its text again
  React.useEffect(() => onBodiesRestored(() => {
    const d = draft.current;
    if (d.id && !d.dirty && !timer.current && !saving.current) loadEntry(d.dateKey, d.id);
  }), [loadEntry]);

  // ---- edits ----
  // writing tucks the check-out away; the next time the keyboard goes down it may offer itself again
  const wrote = () => { if (!edited) setEdited(true); if (checkout) setCheckout(null); };
  const onTitle = (t: string) => { setTitle(t); draft.current.title = t; schedule(); markTyping(); wrote(); };
  const onBody = (t: string) => { setBody(t); draft.current.body = t; schedule(); markTyping(); wrote(); };
  const pickMood = (m: Mood) => {
    setMood(m);
    draft.current.mood = m;
    schedule();
  };
  const pickRating = (r: Rating) => {
    setRating(r);
    draft.current.rating = r;
    schedule();
  };
  const skipCheckout = () => {
    tick();
    setCheckout(null);
    setSkipped(true);
    draft.current.checkoutSkipped = true;
    schedule();
  };
  const toggleTag = React.useCallback((t: string) => {
    tap();
    const next = draft.current.tags.includes(t) ? draft.current.tags.filter((x) => x !== t) : [...draft.current.tags, t];
    setTags(next);
    draft.current.tags = next;
    schedule();
  }, [schedule]);

  const prompt = promptFor(dateKey);
  const showPrompt = loaded && settings.journalPromptsOn && !body.trim();
  const usePrompt = () => {
    tap();
    draft.current.promptId = prompt.id;
    onBody(prompt.text + '\n\n' + body);
    setTimeout(() => bodyRef.current?.focus(), 60);
  };

  const today = todayKey();
  const dayEntries = React.useMemo(
    () => journal.filter((e) => e.dateKey === dateKey).sort((a, b) => a.createdAt - b.createdAt),
    [journal, dateKey],
  );
  const at = entryId ? dayEntries.findIndex((e) => e.id === entryId) : -1;
  const words = countWords(body);
  const goal = settings.journalWordGoal;
  // the whole date never fits one line beside the buttons, so the day leads and the weekday sits under it
  const parts = journalDateParts(dateKey);
  const hint = dayEntries.length > 1 && at >= 0
    ? 'Entry ' + (at + 1) + ' of ' + dayEntries.length
    : relativeDay(dateKey);
  const sub = parts.weekday + (hint ? ' · ' + hint : '');
  const marked = React.useMemo(() => new Set(journal.map((e) => e.dateKey)), [journal]);
  const current = entryId ? journal.find((e) => e.id === entryId) : undefined;
  const tasksArchived = settings.archivedTools.includes('tasks');

  // The check-out offers itself only while every one of these holds, so it can never be spent where nobody sees it:
  // the setting is on, the keyboard is down, this page was written in on this visit and has a real page of words,
  // it has no mood or rating yet, it was never skipped, and no other entry that day has been rated.
  const ratedSameDay = dayEntries.some((e) => e.id !== entryId && !!e.rating);
  const offer = settings.journalCheckout && loaded && !keyboardOpen && edited && words >= CHECKOUT_MIN_WORDS
    && !mood && !rating && !skipped && !ratedSameDay;
  React.useEffect(() => {
    if (offer && !checkout) setCheckout('offered');
  }, [offer]);
  // the keyboard coming up tucks the card away
  React.useEffect(() => {
    if (keyboardOpen && checkout) setCheckout(null);
  }, [keyboardOpen]);
  // a mood and a rating together finish it: the card stays a moment to show both, then leaves
  React.useEffect(() => {
    if (!checkout || !mood || !rating) return undefined;
    const t = setTimeout(() => setCheckout(null), 900);
    return () => clearTimeout(t);
  }, [checkout, mood, rating]);

  const dayIcon = mood ? MOODS.find((m) => m.value === mood)?.icon || 'partly-sunny-outline' : rating ? 'star' : 'partly-sunny-outline';
  const openTask = () => {
    tick();
    // words selected in the page start the task; the page gets its keyboard back after
    const { start, end } = selection.current;
    const a = Math.max(0, Math.min(start, end, body.length));
    const b = Math.max(0, Math.min(Math.max(start, end), body.length));
    const picked = body.slice(a, b).split('\n').map((l) => l.trim()).find(Boolean) || '';
    setTaskTitle(picked.slice(0, 140));
    refocus.current = bodyFocused.current;
    setTaskSheet(true);
  };

  const openArchive = async () => { tick(); await flush(); nav.openArchive(); };
  const pickDay = React.useCallback((key: string) => { setDateSheet(false); autoDay.current = false; openDay(key); }, [openDay]);

  // the menu reads the page when an action runs, so typing never rebuilds it
  const shareText = () => {
    const d = draft.current;
    const text = [formatJournalDate(d.dateKey), d.title.trim(), d.body.trim()].filter(Boolean).join('\n\n');
    Share.share({ message: text });
  };
  const confirmDelete = () => {
    if (!entryId) return;
    Alert.alert('Delete this entry?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          // join the save queue first: a save already under way finishes before the delete, never after it
          await flush();
          const id = draft.current.id ?? entryId;
          draft.current.dirty = false;
          await deleteEntry(id);
          const rest = useStore.getState().journal.filter((e) => e.dateKey === dateKey).sort((a, b) => a.createdAt - b.createdAt);
          loadEntry(dateKey, rest[0]?.id ?? null);
        },
      },
    ]);
  };

  const setLock = React.useCallback(async (on: boolean) => {
    // the page is open, so the PIN has already been given: turning the lock off here asks nothing more
    if (!on) {
      setSetting('journalLocked', false);
      return;
    }
    if ((await pinStatus()) === 'set') {
      setSetting('journalLocked', true);
      markOpen('journal');
      return;
    }
    // no PIN on this phone yet, or only an older code: one is chosen first
    setPinFlow(true);
  }, [setSetting]);

  // ---- the day button's tint eases over instead of switching ----
  const dayLit = !!(mood || rating || checkout);
  const tint = useSharedValue(dayLit ? 1 : 0);
  React.useEffect(() => {
    tint.value = level === 'none' ? (dayLit ? 1 : 0) : withTiming(dayLit ? 1 : 0, { duration: 200, easing: EASE_OUT });
  }, [dayLit, level]);
  const tintStyle = useAnimatedStyle(() => ({ opacity: tint.value }));

  const hasText = !!(title.trim() || body.trim());
  const pinned = !!current?.pinned;
  const currentId = current?.id;
  // the sheets and the menu are built only when what they show changes, never on a keystroke
  const menuSheet = React.useMemo(() => (
    <DotMenu
      visible={menu}
      onClose={() => setMenu(false)}
      items={[
        ...(entryId ? [{ label: 'New entry for this day', icon: 'add-outline', onPress: async () => { await flush(); loadEntry(dateKey, null); } }] : []),
        ...(dayEntries.length > 1 && at >= 0 ? [{ label: 'Next entry on this day', icon: 'swap-horizontal-outline', onPress: async () => { await flush(); loadEntry(dateKey, dayEntries[(at + 1) % dayEntries.length].id); } }] : []),
        ...(currentId ? [{ label: pinned ? 'Unpin' : 'Pin', icon: pinned ? 'pin' : 'pin-outline', onPress: () => patchJournalEntry(currentId, { pinned: !pinned }) }] : []),
        ...(hasText ? [
          { label: 'Share as text', icon: 'share-outline', onPress: shareText },
          {
            label: 'Copy text', icon: 'copy-outline',
            onPress: () => Clipboard.setStringAsync([draft.current.title.trim(), draft.current.body.trim()].filter(Boolean).join('\n\n')),
          },
        ] : []),
        { label: 'Journal settings', icon: 'options-outline', onPress: () => setPrefs(true) },
        ...(entryId ? [{ label: 'Delete entry', icon: 'trash-outline', color: C.danger, onPress: confirmDelete }] : []),
      ]}
    />
  ), [menu, entryId, dateKey, dayEntries, at, currentId, pinned, hasText, flush, loadEntry]);
  const dateSheetEl = React.useMemo(() => (
    <Sheet visible={dateSheet} onClose={() => setDateSheet(false)} title="Which day?">
      <Row style={{ marginBottom: 12 }}>
        <Chip label="Yesterday" icon="arrow-undo-outline" active={dateKey === shiftKey(today, -1)} onPress={() => pickDay(shiftKey(today, -1))} />
        <Chip label="Today" icon="today-outline" active={dateKey === today} onPress={() => pickDay(today)} />
      </Row>
      <JournalCalendar value={dateKey} onPick={pickDay} marked={marked} maxKey={today} />
    </Sheet>
  ), [dateSheet, dateKey, today, marked, pickDay]);
  const tagSheetEl = React.useMemo(() => (
    <TagSheet visible={tagSheet} onClose={() => setTagSheet(false)} tags={tags} onToggle={toggleTag} />
  ), [tagSheet, tags, toggleTag]);
  const prefsEl = React.useMemo(() => (
    <JournalPrefs visible={prefs} onClose={() => setPrefs(false)} onLock={setLock} />
  ), [prefs, setLock]);
  const taskSheetEl = React.useMemo(() => (
    <QuickTaskSheet
      visible={taskSheet}
      onClose={() => setTaskSheet(false)}
      onClosed={() => {
        if (refocus.current) setTimeout(() => bodyRef.current?.focus(), 80);
        refocus.current = false;
      }}
      initialTitle={taskTitle}
    />
  ), [taskSheet, taskTitle]);
  const pinSheetEl = React.useMemo(() => (
    <PinSheet
      visible={pinFlow}
      mode="set"
      tint={C.gold}
      onClose={() => setPinFlow(false)}
      onDone={() => {
        setPinFlow(false);
        setSetting('journalLocked', true);
        markOpen('journal');
      }}
    />
  ), [pinFlow, setSetting]);

  // The header speaks of today, whichever day the page is on: whether today is written, and the run of days written
  // in a row. No live dot: nothing here is happening this minute. The minute ticker (only while this screen is in
  // front) turns "today" over when the journal day does, at its cutoff hour.
  const now = useNow();
  const todayDay = journalDayFor(now, settings.journalCutoffHour);
  const writtenDays = React.useMemo(() => new Set(journal.filter((e) => e.wordCount > 0).map((e) => e.dateKey)), [journal]);
  // The run of days written, ending today (or yesterday while today is still blank), counted from the journal's own
  // day: before the cutoff hour the calendar has already turned over and the journal has not, and a calendar count
  // would lose the run in those small hours
  const streak = React.useMemo(() => {
    let run = 0;
    let key = writtenDays.has(todayDay) ? todayDay : shiftKey(todayDay, -1);
    while (writtenDays.has(key)) { run++; key = shiftKey(key, -1); }
    return run;
  }, [writtenDays, todayDay]);
  const todayLine = writtenDays.has(todayDay) ? 'Written today' : streak > 1 ? 'Today not written yet' : '';
  const line = [todayLine, streak > 1 ? streak + ' day streak' : ''].filter(Boolean).join(' · ');
  // The line reads at rest. With the keyboard up the page is being written, and the line's first words (a line that
  // appears pushes the page down) or a changed fact (a dip under the title) would move things under the writer's eye.
  const [lineHeld, setLineHeld] = React.useState(line);
  React.useEffect(() => { if (!keyboardOpen) setLineHeld(line); }, [keyboardOpen, line]);
  const tool = useToolHeader({
    title: 'Journal',
    mode: tabMode ? 'tab' : 'page',
    context: lineHeld,
    actions: [
      { icon: 'albums-outline', label: 'Archive', onPress: openArchive },
      { icon: 'ellipsis-horizontal', label: 'More', onPress: () => setMenu(true) },
    ],
    // the bar recedes while typing, as the footer does, and comes back when the writing pauses. Only what it holds
    // recedes: on a tab it lies over the page, and a ground gone faint would let the writing show through it
    contentStyle: headStyle,
  });

  return (
    <ScreenBG guard={tabMode}>
      {tool.bar}

      {/* the page and the footer rise with the screen on every visit, as every other tool does; a page turn (below)
          is its own entrance, inside the surface. The header's hero is the first thing in the page's scroll, so it
          rises with it */}
      <Enter index={0} style={st.page}>
        <Animated.ScrollView
          {...tool.scrollProps}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: S.pad, paddingTop: tool.padTop, paddingBottom: 40 }}
        >
          {tool.hero}
          <Animated.View key={page} entering={pageEnter}>
            {/* the page's own heading: its date, in the serif, with the weekday under it. A new day's date dips out and
                comes back with the page, instead of changing under it in one frame */}
            <Bouncy onPress={() => { tick(); setDateSheet(true); }} scaleTo={0.97} radius={14} style={st.dateBtn}>
              <FadeSwap swapKey={dateKey + '|' + sub} style={st.dateWords}>
                <Text style={st.date} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{parts.day}</Text>
                <Text style={[T.caption, { marginTop: 1 }]} numberOfLines={1}>{sub}</Text>
              </FadeSwap>
            </Bouncy>
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
              onSelectionChange={(e) => { selection.current = e.nativeEvent.selection; }}
              onFocus={() => { bodyFocused.current = true; }}
              onBlur={() => { bodyFocused.current = false; }}
              editable={loaded}
              placeholder="Start writing"
              placeholderTextColor={C.textFaint}
              multiline
              scrollEnabled={false}
              textAlignVertical="top"
              style={st.body}
            />
          </Animated.View>
        </Animated.ScrollView>
      </Enter>

      {checkout ? (
        <DayCheckout
          dateKey={dateKey}
          mood={mood}
          rating={rating}
          offered={checkout === 'offered'}
          onMood={pickMood}
          onRating={pickRating}
          onSkip={skipCheckout}
          onDone={() => setCheckout(null)}
        />
      ) : null}
      <Enter index={1}>
        <View style={[st.foot, { paddingBottom: 10 + (tabMode ? 0 : insets.bottom) }]}>
          {/* the word goal sits with the count it measures, and stays at full strength while the rest of the footer
              recedes: it is what you look at while you write */}
          {goal > 0 ? (
            <View style={st.goal}>
              <ProgressBar value={Math.min(1, words / goal)} height={4} color={C.gold} />
            </View>
          ) : null}
          <Animated.View style={[st.footRow, footStyle]}>
            <Row style={{ flex: 1 }}>
              <Bouncy
                onPress={() => { tick(); setCheckout(checkout ? null : 'asked'); }}
                scaleTo={0.9}
                radius={17}
                style={st.dayWell}
                accessibilityRole="button"
                accessibilityLabel={'How the day went' + (mood ? ', ' + MOODS.find((m) => m.value === mood)?.label : '') + (rating ? ', ' + rating + ' of 5 stars' : '')}
              >
                <Animated.View pointerEvents="none" style={[st.dayTint, { backgroundColor: C.gold + '24' }, tintStyle]} />
                <Ionicons name={dayIcon as any} size={18} color={mood || rating ? C.gold : C.textFaint} />
              </Bouncy>
              <IconBtn
                name={tags.length ? 'pricetag' : 'pricetag-outline'} size={19} pad={8} color={tags.length ? C.gold : C.textDim}
                onPress={() => setTagSheet(true)} accessibilityLabel={tags.length ? 'Tags, ' + tags.length : 'Add tags'}
              />
              {tasksArchived ? null : (
                <IconBtn name="checkbox-outline" size={19} pad={8} color={C.textDim} onPress={openTask} accessibilityLabel="Add a task" />
              )}
            </Row>
            <View style={{ alignItems: 'flex-end' }}>
              <FadeSwap swapKey={saveFailed ? 'failed' : 'count'}>
                <Text
                  style={[st.words, saveFailed && { color: C.danger }]}
                  onPress={saveFailed ? () => { flush(); } : undefined}
                  suppressHighlighting
                >
                  {/* an empty page states no count at all */}
                  {saveFailed ? 'Not saved, tap to retry' : words ? words + (words === 1 ? ' word' : ' words') : ' '}
                </Text>
              </FadeSwap>
              <Animated.View style={[st.tick, { backgroundColor: C.accent }, tickStyle]} />
            </View>
          </Animated.View>
        </View>
      </Enter>

      {dateSheetEl}
      {menuSheet}
      {tagSheetEl}
      {prefsEl}
      {taskSheetEl}
      {pinSheetEl}
    </ScreenBG>
  );
}

/** The tags sheet keeps its own draft, so typing a new tag re-renders only the sheet. */
function TagSheet({ visible, onClose, tags, onToggle }: {
  visible: boolean; onClose: () => void; tags: string[]; onToggle: (t: string) => void;
}) {
  const journalTags = useStore((s) => s.journalTags);
  const setJournalTags = useStore((s) => s.setJournalTags);
  const [draft, setDraft] = React.useState('');
  const addTag = () => {
    const t = draft.trim().toLowerCase().replace(/^#+/, '').replace(/\s+/g, '-');
    if (!t) return;
    if (!journalTags.includes(t)) setJournalTags([...journalTags, t].sort());
    if (!tags.includes(t)) onToggle(t);
    setDraft('');
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="Tags">
      {journalTags.length ? (
        <Row style={{ flexWrap: 'wrap', marginBottom: 8 }}>
          {journalTags.map((t) => <Chip key={t} small label={t} active={tags.includes(t)} color={C.gold} onPress={() => onToggle(t)} />)}
        </Row>
      ) : (
        <Text style={[T.caption, { marginBottom: 10 }]}>Tags group entries, like exams, family or sport.</Text>
      )}
      <Field value={draft} onChangeText={setDraft} placeholder="New tag" autoCapitalize="none" onSubmitEditing={addTag} returnKeyType="done" />
      <PillButton label="Add tag" icon="add-outline" color={C.gold} onPress={addTag} />
    </Sheet>
  );
}

/** The journal's own settings, with the reminder time's draft kept here rather than on the page. */
function JournalPrefs({ visible, onClose, onLock }: {
  visible: boolean; onClose: () => void; onLock: (on: boolean) => void;
}) {
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const [remindDraft, setRemindDraft] = React.useState(settings.journalReminderTime || '21:30');
  // each opening starts from the saved time
  React.useEffect(() => {
    if (visible) setRemindDraft(useStore.getState().settings.journalReminderTime || '21:30');
  }, [visible]);
  const saveReminder = async (on: boolean) => {
    if (on) {
      if (!HHMM.test(remindDraft)) { Alert.alert('Use 24h HH:MM, e.g. 21:30'); return; }
      if (!(await ensurePermission())) { Alert.alert('Permission needed', 'Allow notifications in system settings first.'); return; }
    }
    setSetting('journalReminderTime', on ? remindDraft : '');
    setTimeout(rescheduleAllReminders, 150);
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="Journal settings">
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
        <Toggle value={settings.journalPromptsOn} onChange={(v) => setSetting('journalPromptsOn', v)} color={C.gold} label="Writing prompts" />
      </Row>
      <Hairline />
      <Row style={st.prefRow}>
        <Text style={[T.body, { flex: 1 }]}>Ask how the day went</Text>
        <Toggle value={settings.journalCheckout} onChange={(v) => setSetting('journalCheckout', v)} color={C.gold} label="Ask how the day went" />
      </Row>
      <Text style={[T.caption, { marginBottom: 6 }]}>
        After you write, a quiet card asks for a mood and a star rating. Skip is always there, and the sun button in the corner opens it any time.
      </Text>
      <Hairline />
      <Text style={st.prefLabel}>Word goal</Text>
      <SegmentedControl
        size="sm" stretch
        options={[0, 150, 300, 500].map((n) => ({ key: String(n), label: n ? String(n) : 'Off' }))}
        value={String(settings.journalWordGoal)}
        onChange={(k) => setSetting('journalWordGoal', Number(k))}
      />
      <Hairline />
      <Row style={st.prefRow}>
        <Text style={[T.body, { flex: 1 }]}>Reminder</Text>
        <Toggle value={!!settings.journalReminderTime} onChange={saveReminder} color={C.gold} label="Daily journal reminder" />
      </Row>
      {settings.remindersEnabled ? (
        <Field value={remindDraft} onChangeText={setRemindDraft} placeholder="21:30" keyboardType="numbers-and-punctuation" maxLength={5} onEndEditing={() => { if (settings.journalReminderTime && HHMM.test(remindDraft)) saveReminder(true); }} />
      ) : (
        <Text style={[T.caption, { marginBottom: 6 }]}>Turn on reminders in Settings first.</Text>
      )}
      <Hairline />
      <Row style={st.prefRow}>
        <Text style={[T.body, { flex: 1 }]}>Lock journal</Text>
        <Toggle value={settings.journalLocked} onChange={onLock} color={C.gold} label="Lock the journal" />
      </Row>
      <Text style={[T.caption, { marginBottom: 6 }]}>
        {settings.journalLocked
          ? settings.journalScreenLock ? 'Your app PIN opens it, and so does your screen lock.' : 'Your app PIN opens it.'
          : 'Your 4-digit app PIN will open it.'}
        {' '}Settings, under Privacy, changes the PIN and whether your screen lock can open the journal.
      </Text>
    </Sheet>
  );
}

const st = StyleSheet.create({
  // the date is the page's heading: it starts where the page's text does, and is only as wide as it is
  dateBtn: { alignSelf: 'flex-start', maxWidth: '100%', paddingVertical: 4, marginBottom: 6 },
  date: { color: C.text, fontFamily: F.head, fontSize: 21, lineHeight: 27, letterSpacing: TRACK.large },
  title: { color: C.text, fontFamily: F.semi, fontSize: 17, letterSpacing: TRACK.title, paddingVertical: 8 },
  prompt: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, marginBottom: 2 },
  promptText: { flex: 1, color: C.textDim, fontFamily: F.reg, fontSize: 14, letterSpacing: TRACK.small, lineHeight: 20 },
  body: { color: C.text, fontFamily: F.reg, fontSize: 16, letterSpacing: TRACK.body, lineHeight: 26, minHeight: 320, paddingTop: 6 },
  foot: {
    paddingHorizontal: S.pad, paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.hairline,
  },
  goal: { marginBottom: 8 },
  footRow: { flexDirection: 'row', alignItems: 'center' },
  dayWell: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginRight: 4 },
  /** the day button's gold tint, a layer that fades in and out under the icon */
  dayTint: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 17 },
  /** the page's scroll: it fills what the footer leaves, and the bar too on a page (on a tab the bar lies over it) */
  page: { flex: 1 },
  dateWords: { alignItems: 'flex-start' },
  words: { color: C.textFaint, fontFamily: F.med, fontSize: 12, letterSpacing: TRACK.fine, fontVariant: ['tabular-nums'] },
  tick: { width: 16, height: 2, borderRadius: 1, marginTop: 4 },
  prefLabel: { ...T.label, marginTop: 10, marginBottom: 8 },
  prefRow: { paddingVertical: 10 },
});
