import React from 'react';
import { Alert, AppState, Platform, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import Animated, { Easing, FadeIn, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';
import { C, F, S, T, TRACK, writingFace } from '../theme';
import { useStore, JournalEntry, FocusSession, Habit, flushSaves, trashedEntryIds } from '../store';
import { toastTrashed } from '../trashToast';
import { fmtClockTime, todayKey, toMinutes } from '../utils';
import {
  Chip, DotMenu, Field, GateHeader, Hairline, IconBtn, PillButton, ProgressBar, Row, ScreenBG, Sheet, Toggle, useTheme,
  useToolHeader,
} from '../components/UI';
import type { ToolAction } from '../components/UI';
import { SegmentedControl } from '../components/SegmentedControl';
import { Wheel } from '../components/Wheel';
import { toast } from '../components/Toast';
import { Bouncy, EASE_OUT, Enter, FadeSwap, shiftIn, useAnimLevel } from '../components/Motion';
import { PinSheet, ToolGate } from '../components/LockGate';
import { ExportButton } from '../reports';
import { JournalCalendar } from '../components/JournalCalendar';
import {
  MOODS, countWords, dayFacts, dayRecord, deleteEntry, formatJournalDate, journalDateParts, journalDayFor,
  journalDayIsYesterday, journalStreak, promptFor, readBody, relativeDay, saveEntry, shiftKey, takeJournalOpenRequest,
  onBodiesRestored,
} from '../journal';
import type { DayFact, DayHabit, DayRecord } from '../journal';
import { useToolNav } from '../toolNav';
import { tap, tick } from '../haptics';
import { ensurePermission, rescheduleAllReminders } from '../notifications';
import { expectAway, markOpen, pinStatus } from '../lock';
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

/** Whether an entry is in Recently deleted: its page is never saved again, which would bring it back. */
const isTrashed = (id: string) => trashedEntryIds(useStore.getState().trash).includes(id);

/** each fact of the day line, with its icon */
const FACT_ICONS: Record<DayFact['kind'], React.ComponentProps<typeof Ionicons>['name']> = {
  done: 'checkmark-done-outline',
  habits: 'repeat-outline',
  focus: 'hourglass-outline',
};
/** nothing of an archived tool reaches the day line */
const NO_HABITS: Habit[] = [];
const NO_SESSIONS: FocusSession[] = [];

/** the reminder's wheel turns in quarter hours, round the clock */
const REMIND_STEP = 15;
const REMIND_STOPS = (24 * 60) / REMIND_STEP;
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
  // Arrivals: Sift opens the journal's settings sheet (`sheet=settings`). The param is cleared once followed, so the
  // same link works again
  const router = useRouter();
  const params = useLocalSearchParams<{ sheet?: string }>();
  useFocusEffect(React.useCallback(() => {
    if (params.sheet !== 'settings') return;
    setPrefs(true);
    router.setParams({ sheet: undefined } as any);
  }, [params.sheet]));
  // each page loaded is a new page: it counts up so the page can arrive with its own entrance
  const [page, setPage] = React.useState(0);
  const turnDir = React.useRef<0 | 1 | -1>(0);

  const draft = React.useRef<Draft>({
    id: null, dateKey, title: '', body: '', mood: undefined, rating: undefined, checkoutSkipped: false, tags: [], dirty: false,
  });
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = React.useRef<Promise<void>>(Promise.resolve());
  const booted = React.useRef(false);
  // The page follows the journal day. A pick of another day (the date sheet, the archive, an entry moved) holds for
  // the rest of the journal day it was made on; a pick of the journal day itself follows the day again
  const autoDay = React.useRef(true);
  const chosenOn = React.useRef('');
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
    // an entry moved to Recently deleted is never written again: a save would put it back in the journal, and a page
    // cleared of its words would delete the text Recently deleted keeps for it
    if (d.id && isTrashed(d.id)) return;
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
      // moved to Recently deleted while its text was being written: the save put it back, so it leaves again (its
      // file keeps the newer words for a restore)
      if (isTrashed(id)) {
        useStore.getState().removeJournalEntry(id);
        return;
      }
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

  const journalDayNow = () => journalDayFor(new Date(), useStore.getState().settings.journalCutoffHour);
  /** Notes a day the page was taken to on purpose, and whether that leaves the page following the journal day. */
  const chose = React.useCallback((key: string) => {
    const day = journalDayNow();
    autoDay.current = key === day;
    chosenOn.current = day;
  }, []);
  /**
   * On coming back (another tab, the app): a page that follows the day moves along once the cutoff has passed. A day
   * picked on an earlier journal day lets go too, unless something typed is still waiting, and the page follows again.
   */
  const catchUp = React.useCallback(() => {
    const day = journalDayNow();
    if (autoDay.current) {
      if (day !== draft.current.dateKey) openDay(day);
      return;
    }
    if (day !== chosenOn.current && !draft.current.dirty && !timer.current) {
      autoDay.current = true;
      openDay(day);
    }
  }, [openDay]);

  useFocusEffect(React.useCallback(() => {
    const req = takeJournalOpenRequest();
    if (req) {
      chose(req.dateKey);
      openDay(req.dateKey, req.entryId ?? undefined);
    } else if (!booted.current) {
      openDay(journalDayNow());
    } else {
      catchUp();
    }
    booted.current = true;
    return () => { flush(); };
  }, [openDay, flush, chose, catchUp]));

  // leaving the app saves; coming back on a new journal day moves an untouched page along
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      // the entry lands in the store only once its file is written, so storage is written after that, not before
      if (s !== 'active') { flush().then(flushSaves); return; }
      catchUp();
    });
    return () => {
      sub.remove();
      if (idle.current) clearTimeout(idle.current);
      flush().then(flushSaves);
    };
  }, [flush, catchUp]);

  // an entry deleted elsewhere (the archive) leaves a blank page for its day; one changed elsewhere (a restored
  // backup) reloads when nothing typed is waiting, so a later keystroke never writes the old text back over it; one
  // moved to another day takes the page with it
  React.useEffect(() => {
    if (!entryId) return;
    const e = journal.find((x) => x.id === entryId);
    const idleNow = !draft.current.dirty && !timer.current && !saving.current;
    if (!e) {
      // one moved to Recently deleted lets the page go even with typing waiting, which no save may write back
      if (isTrashed(entryId)) {
        if (timer.current) { clearTimeout(timer.current); timer.current = null; }
        draft.current.dirty = false;
        loadEntry(draft.current.dateKey, null);
      } else if (!draft.current.dirty) loadEntry(draft.current.dateKey, null);
    } else if (idleNow && e.updatedAt !== draft.current.seen) {
      loadEntry(e.dateKey, e.id);
    } else if (e.dateKey !== draft.current.dateKey) {
      chose(e.dateKey);
      draft.current.dateKey = e.dateKey;
      setDateKey(e.dateKey);
    }
  }, [journal, entryId, loadEntry, chose]);

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

  // what follows from the day alone is worked out once per day, not on every keystroke
  const prompt = React.useMemo(() => promptFor(dateKey), [dateKey]);
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
  // the count follows the words a beat behind, so a long entry never makes each keystroke count the whole page
  const settledBody = React.useDeferredValue(body);
  const words = React.useMemo(() => countWords(settledBody), [settledBody]);
  const goal = settings.journalWordGoal;
  // the whole date never fits one line beside the buttons, so the day leads and the weekday sits under it
  const parts = React.useMemo(() => journalDateParts(dateKey), [dateKey]);
  const relative = React.useMemo(() => relativeDay(dateKey), [dateKey, today]);
  const hint = dayEntries.length > 1 && at >= 0
    ? 'Entry ' + (at + 1) + ' of ' + dayEntries.length
    : relative;
  const sub = parts.weekday + (hint ? ' · ' + hint : '');
  const marked = React.useMemo(() => new Set(journal.map((e) => e.dateKey)), [journal]);
  const current = entryId ? journal.find((e) => e.id === entryId) : undefined;
  const tasksArchived = settings.archivedTools.includes('tasks');
  const plannerArchived = settings.archivedTools.includes('planner');
  const focusArchived = settings.archivedTools.includes('focus');

  // ---- the day's record beside the page: what was ticked, the habits and the time focused that day. An archived tool
  // says nothing here, as on Today ----
  const dayLog = useStore((s) => (tasksArchived ? undefined : s.doneLog[dateKey]));
  const allHabits = useStore((s) => (plannerArchived ? NO_HABITS : s.habits));
  const sessions = useStore((s) => (focusArchived ? NO_SESSIONS : s.sessions));
  const record = React.useMemo(() => dayRecord(dateKey, dayLog, allHabits, sessions), [dateKey, dayLog, allHabits, sessions]);
  const facts = React.useMemo(() => dayFacts(record), [record]);
  const [daySheet, setDaySheet] = React.useState(false);

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

  // a second tap while the archive is on its way in is the same tap, never a second archive
  const archiveAt = React.useRef(0);
  const openArchive = React.useCallback(async () => {
    const t = Date.now();
    if (t - archiveAt.current < 600) return;
    archiveAt.current = t;
    tick();
    await flush();
    nav.openArchive();
  }, [flush, nav]);
  const pickDay = React.useCallback((key: string) => { setDateSheet(false); chose(key); openDay(key); }, [openDay, chose]);

  // the menu reads the page when an action runs, so typing never rebuilds it
  const shareText = () => {
    const d = draft.current;
    const text = [formatJournalDate(d.dateKey), d.title.trim(), d.body.trim()].filter(Boolean).join('\n\n');
    // the share sheet takes the app out of view; coming back from it never locks the journal
    expectAway(() => Share.share({ message: text })).catch(() => {});
  };
  const confirmDelete = () => {
    if (!entryId) return;
    Alert.alert('Delete this entry?', 'You can restore it from Recently deleted for 30 days.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          // join the save queue first: a save already under way finishes before the move, never after it, and the
          // entry goes with its latest words
          await flush();
          if (timer.current) { clearTimeout(timer.current); timer.current = null; }
          const id = draft.current.id ?? entryId;
          const key = draft.current.dateKey;
          const trashId = useStore.getState().trashJournalEntry(id);
          // Recently deleted could not take it: the entry stays, and so does its page
          if (!trashId) { toastTrashed(null); return; }
          draft.current.dirty = false;
          // back from an Undo, it takes its page again if the page has nothing else on it
          toastTrashed(trashId, () => {
            const d = draft.current;
            if (d.dateKey === key && !d.id && !d.dirty && !timer.current) loadEntry(key, id);
          });
          const rest = useStore.getState().journal.filter((e) => e.dateKey === key).sort((a, b) => a.createdAt - b.createdAt);
          loadEntry(key, rest[0]?.id ?? null);
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
            // Android before 13 says nothing of its own when something is copied
            onPress: () => {
              Clipboard.setStringAsync([draft.current.title.trim(), draft.current.body.trim()].filter(Boolean).join('\n\n'))
                .then(() => toast('Copied'))
                .catch(() => {});
            },
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
  // ---- a tag held in the sheet: rename it, or delete it from every entry, one sheet at a time ----
  const [tagMenu, setTagMenu] = React.useState<string | null>(null);
  const [tagRename, setTagRename] = React.useState<string | null>(null);
  const heldTag = React.useRef<string | null>(null);
  const tagFromSheet = React.useRef<string | null>(null);
  if (tagMenu) heldTag.current = tagMenu;
  /** The page's tags follow a change made to every entry, so its next save never writes the old ones back. */
  const setPageTags = React.useCallback((next: string[]) => {
    draft.current.tags = next;
    setTags(next);
  }, []);
  const renameTag = React.useCallback((from: string, to: string) => {
    const s = useStore.getState();
    const swap = (list: string[]) => [...new Set(list.map((x) => (x === from ? to : x)))];
    s.setJournalTags(swap(s.journalTags).sort());
    s.journal.forEach((e) => { if (e.tags.includes(from)) s.patchJournalEntry(e.id, { tags: swap(e.tags) }); });
    if (draft.current.tags.includes(from)) setPageTags(swap(draft.current.tags));
  }, [setPageTags]);
  const deleteTag = React.useCallback((t: string) => {
    const s = useStore.getState();
    const touched = s.journal.filter((e) => e.tags.includes(t)).map((e) => e.id);
    const page = draft.current;
    const onPage = page.tags.includes(t);
    s.setJournalTags(s.journalTags.filter((x) => x !== t));
    touched.forEach((id) => {
      const e = s.journal.find((x) => x.id === id);
      if (e) s.patchJournalEntry(id, { tags: e.tags.filter((x) => x !== t) });
    });
    if (onPage) setPageTags(page.tags.filter((x) => x !== t));
    toast('Deleted the ' + t + ' tag', {
      label: 'Undo',
      onPress: () => {
        const now = useStore.getState();
        if (!now.journalTags.includes(t)) now.setJournalTags([...now.journalTags, t].sort());
        touched.forEach((id) => {
          const e = now.journal.find((x) => x.id === id);
          if (e && !e.tags.includes(t)) now.patchJournalEntry(id, { tags: [...e.tags, t] });
        });
        if (onPage && draft.current === page && !page.tags.includes(t)) setPageTags([...page.tags, t]);
      },
    });
  }, [setPageTags]);
  const tagSheetEl = React.useMemo(() => (
    <TagSheet
      visible={tagSheet} onClose={() => setTagSheet(false)} tags={tags} onToggle={toggleTag}
      onHold={(t) => { tick(); tagFromSheet.current = t; setTagSheet(false); }}
      onClosed={() => {
        const t = tagFromSheet.current;
        tagFromSheet.current = null;
        if (t) setTagMenu(t);
      }}
    />
  ), [tagSheet, tags, toggleTag]);
  const tagMenuEl = React.useMemo(() => (
    <DotMenu
      visible={!!tagMenu}
      onClose={() => setTagMenu(null)}
      items={heldTag.current ? [
        { label: 'Rename', icon: 'create-outline', onPress: () => setTagRename(heldTag.current) },
        { label: 'Delete tag', icon: 'trash-outline', color: C.danger, onPress: () => { if (heldTag.current) deleteTag(heldTag.current); } },
      ] : []}
    />
  ), [tagMenu, deleteTag]);
  const tagRenameEl = React.useMemo(() => (
    <TagRenameSheet
      tag={tagRename}
      onClose={() => setTagRename(null)}
      onSave={(from, to) => { setTagRename(null); if (to !== from) renameTag(from, to); }}
    />
  ), [tagRename, renameTag]);
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
  // habits are ticked from the sheet only on today's own page; an earlier day's record reads as it was
  const canTick = dateKey === today;
  const daySheetEl = React.useMemo(() => (
    <DaySheet
      visible={daySheet} onClose={() => setDaySheet(false)} dateKey={dateKey} record={record} habits={allHabits}
      canTick={canTick}
    />
  ), [daySheet, dateKey, record, allHabits, canTick]);
  // the writing face picked in Settings: the body only, the title keeps its own
  const bodyStyle = React.useMemo(() => [st.body, writingFace(settings.writingFont)], [settings.writingFont]);
  const factsText = facts.map((f) => f.text).join(', ');
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
  const cutoff = settings.journalCutoffHour;
  const todayDay = journalDayFor(now, cutoff);
  const writtenToday = React.useMemo(() => journal.some((e) => e.dateKey === todayDay && e.wordCount > 0), [journal, todayDay]);
  // the same run the archive's stats count, from the journal's own day
  const streak = React.useMemo(() => journalStreak(journal, cutoff, now).current, [journal, cutoff, now]);
  // between midnight and the cutoff the journal's day is the calendar's yesterday, and the page under this line says
  // "Yesterday": the line names it the same way
  const lateNight = journalDayIsYesterday(now, cutoff);
  const todayLine = writtenToday
    ? (lateNight ? "Yesterday's page written" : 'Written today')
    : streak > 1 ? (lateNight ? "Yesterday's page not written yet" : 'Today not written yet') : '';
  const line = [todayLine, streak > 1 ? streak + ' day streak' : ''].filter(Boolean).join(' · ');
  // The line reads at rest. With the keyboard up the page is being written, and the line's first words (a line that
  // appears pushes the page down) or a changed fact (a dip under the title) would move things under the writer's eye.
  const [lineHeld, setLineHeld] = React.useState(line);
  React.useEffect(() => { if (!keyboardOpen) setLineHeld(line); }, [keyboardOpen, line]);
  const openMenu = React.useCallback(() => setMenu(true), []);
  const actions = React.useMemo<ToolAction[]>(() => [
    { icon: 'albums-outline', label: 'Archive', onPress: openArchive },
    { icon: 'ellipsis-horizontal', label: 'More', onPress: openMenu },
  ], [openArchive, openMenu]);
  const tool = useToolHeader({
    title: 'Journal',
    mode: tabMode ? 'tab' : 'page',
    context: lineHeld,
    actions,
    // the bar recedes while typing, as the footer does, and comes back when the writing pauses. Only what it holds
    // recedes: on a tab it lies over the page, and a ground gone faint would let the writing show through it
    contentStyle: headStyle,
    // the page is being written in: a drag on its header never opens Sift here
    pull: false,
  });

  // the bar and the hero are kept while their inputs hold, so a keystroke never rebuilds them
  const toolBar = React.useMemo(() => tool.bar, [actions, tabMode, headStyle]);
  const toolHero = React.useMemo(() => tool.hero, [lineHeld, tabMode]);
  // Android keeps a caret it brings into view clear of a scroll's fading edge: while the page is written in on a tab,
  // an edge as tall as the bar keeps the line being written out from under the bar that lies over the page
  const [writing, setWriting] = React.useState(false);
  const caretMargin = tabMode && writing && Platform.OS === 'android' ? tool.barH : 0;

  return (
    <ScreenBG guard={tabMode}>
      {toolBar}

      {/* the page and the footer rise with the screen on every visit, as every other tool does; a page turn (below)
          is its own entrance, inside the surface. The header's hero is the first thing in the page's scroll, so it
          rises with it */}
      <Enter index={0} style={st.page}>
        <Animated.ScrollView
          {...tool.scrollProps}
          keyboardShouldPersistTaps="handled"
          fadingEdgeLength={caretMargin}
          contentContainerStyle={{ paddingHorizontal: S.pad, paddingTop: tool.padTop, paddingBottom: 40 }}
        >
          {toolHero}
          <Animated.View key={page} entering={pageEnter}>
            {/* the page's own heading: its date, in the serif, with the weekday under it. A new day's date dips out and
                comes back with the page, instead of changing under it in one frame */}
            <Bouncy onPress={() => { tick(); setDateSheet(true); }} scaleTo={0.97} radius={14} style={st.dateBtn}>
              <FadeSwap swapKey={dateKey + '|' + sub} style={st.dateWords}>
                {/* in a bar slot the serif is the tool's title just above, so the date is in the text face there */}
                <Text style={tabMode ? st.dateSlot : st.date} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{parts.day}</Text>
                <Text style={[T.caption, { marginTop: 1 }]} numberOfLines={1}>{sub}</Text>
              </FadeSwap>
            </Bouncy>
            {/* the day line: what else the day held, each fact only when there is one; it opens the day's record */}
            {facts.length ? (
              <Pressable
                onPress={() => { tick(); setDaySheet(true); }}
                hitSlop={DAY_LINE_SLOP}
                style={({ pressed }) => [st.dayLine, pressed && { opacity: 0.6 }]}
                accessibilityRole="button" accessibilityLabel={'Your day: ' + factsText} accessibilityHint="Opens what the day held"
              >
                <FadeSwap swapKey={factsText} style={st.dayFacts}>
                  {facts.map((f, i) => (
                    <View key={f.kind} style={st.dayFact}>
                      <Ionicons name={FACT_ICONS[f.kind]} size={13} color={C.textFaint} style={st.dayFactIcon} />
                      <Text style={st.dayFactText}>{f.text}</Text>
                      {/* the arrow rides with the last fact, so a narrow phone never leaves it alone on a line */}
                      {i === facts.length - 1 ? <Ionicons name="chevron-forward" size={13} color={C.textFaint} style={st.dayChev} /> : null}
                    </View>
                  ))}
                </FadeSwap>
              </Pressable>
            ) : null}
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
              onFocus={() => setWriting(true)}
              onBlur={() => setWriting(false)}
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
              onFocus={() => { bodyFocused.current = true; setWriting(true); }}
              onBlur={() => { bodyFocused.current = false; setWriting(false); }}
              editable={loaded}
              placeholder="Start writing"
              placeholderTextColor={C.textFaint}
              multiline
              scrollEnabled={false}
              textAlignVertical="top"
              style={bodyStyle}
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
                hitSlop={5}
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
                {/* the retry reaches past its small words to a full finger's height, without moving the footer */}
                <Pressable
                  disabled={!saveFailed}
                  onPress={() => { flush(); }}
                  hitSlop={{ top: 14, bottom: 14, left: 10, right: 10 }}
                  accessibilityRole={saveFailed ? 'button' : undefined}
                >
                  <Text style={[st.words, saveFailed && { color: C.danger }]}>
                    {/* an empty page states no count at all */}
                    {saveFailed ? 'Not saved, tap to retry' : words ? words + (words === 1 ? ' word' : ' words') : ' '}
                  </Text>
                </Pressable>
              </FadeSwap>
              <Animated.View style={[st.tick, { backgroundColor: C.accent }, tickStyle]} />
            </View>
          </Animated.View>
        </View>
      </Enter>

      {dateSheetEl}
      {menuSheet}
      {tagSheetEl}
      {tagMenuEl}
      {tagRenameEl}
      {prefsEl}
      {taskSheetEl}
      {pinSheetEl}
      {daySheetEl}
    </ScreenBG>
  );
}

/** the day line reaches a finger's height without moving the page */
const DAY_LINE_SLOP = { top: 8, bottom: 8, left: 6, right: 6 };

/**
 * "Your day": what the page's day held besides the writing. Done (the ToDos and long-term tasks ticked that day, as they
 * were called then), Habits (every one due that day, ticked or not, then any ticked on a rest day) and Focus (the
 * sessions). An empty section is left out. On today's page a habit is ticked here, on the Planner's own record; an
 * earlier day reads as it was. A habit shown since the sheet opened stays while it is open, so one unticked on a rest
 * day never leaves under the finger.
 */
function DaySheet({ visible, onClose, dateKey, record, habits, canTick }: {
  visible: boolean; onClose: () => void; dateKey: string; record: DayRecord; habits: Habit[]; canTick: boolean;
}) {
  const toggleHabitDay = useStore((s) => s.toggleHabitDay);
  const shown = React.useRef(new Set<string>());
  const wasVisible = React.useRef(false);
  if (visible && !wasVisible.current) shown.current = new Set();
  wasVisible.current = visible;
  const list = React.useMemo<DayHabit[]>(() => {
    const here = new Set(record.habits.map((x) => x.habit.id));
    const kept = habits
      .filter((h) => shown.current.has(h.id) && !here.has(h.id))
      .map((h) => ({ habit: h, due: false, done: (h.doneDates || []).includes(dateKey) }));
    const out = [...record.habits, ...kept];
    out.forEach((x) => shown.current.add(x.habit.id));
    return out;
  }, [record, habits, dateKey, visible]);
  const title = formatJournalDate(dateKey);
  const sections: React.ReactNode[] = [];
  if (record.done.length) {
    sections.push(
      <View key="done">
        <Text style={st.daySection}>Done</Text>
        {record.done.map((d) => (
          <View
            key={(d.long ? 'task:' : 'todo:') + d.id} style={st.dayRow}
            accessible accessibilityLabel={(d.title || 'Untitled') + (d.long ? ', long-term task' : '') + ', done'}
          >
            <Ionicons name="checkmark-circle" size={18} color={d.long ? C.amber : C.green} />
            <Text style={st.dayRowText} numberOfLines={2}>{d.title || 'Untitled'}</Text>
            {d.long ? <Text style={st.dayRowNote}>Long-term</Text> : null}
          </View>
        ))}
      </View>,
    );
  }
  if (list.length) {
    sections.push(
      <View key="habits">
        <Text style={st.daySection}>Habits</Text>
        {list.map(({ habit, due, done }) => {
          const body = (
            <>
              <Ionicons name={done ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={done ? C.green : C.textFaint} />
              <Text style={[st.dayRowText, !due && { color: C.textDim }]} numberOfLines={2}>{habit.title}</Text>
              {!due ? <Text style={st.dayRowNote}>Rest day</Text> : null}
            </>
          );
          const spoken = habit.title + (due ? '' : ', rest day');
          return canTick ? (
            <Pressable
              key={habit.id}
              onPress={() => { tick(); toggleHabitDay(habit.id, dateKey); }}
              style={({ pressed }) => [st.dayRow, pressed && { opacity: 0.6 }]}
              accessibilityRole="checkbox" accessibilityState={{ checked: done }} accessibilityLabel={spoken}
            >
              {body}
            </Pressable>
          ) : (
            <View key={habit.id} style={st.dayRow} accessible accessibilityLabel={spoken + (done ? ', done' : ', not done')}>
              {body}
            </View>
          );
        })}
      </View>,
    );
  }
  if (record.sessions.length) {
    sections.push(
      <View key="focus">
        <Text style={st.daySection}>Focus</Text>
        {record.sessions.map((x) => {
          const min = Math.max(1, Math.round((Number(x.netSeconds) || 0) / 60));
          const what = x.subject || x.taskTitles?.[0] || 'Deep Work';
          return (
            <View key={x.id} style={st.dayRow} accessible accessibilityLabel={what + ', ' + min + (min === 1 ? ' minute' : ' minutes')}>
              <Ionicons name="hourglass-outline" size={18} color={C.textFaint} />
              <Text style={st.dayRowText} numberOfLines={1}>{what}</Text>
              <Text style={st.dayMin}>{min} min</Text>
            </View>
          );
        })}
      </View>,
    );
  }
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      {sections.map((sec, i) => (i === 0 ? sec : <View key={'gap' + i} style={st.daySectionGap}>{sec}</View>))}
      {sections.length ? <ExportButton inline kind="day" opts={{ from: dateKey }} label="Export this day" /> : null}
    </Sheet>
  );
}

/** A tag as the journal keeps it: lower case, no leading #, a hyphen for each run of spaces. */
const tagOf = (text: string) => text.trim().toLowerCase().replace(/^#+/, '').replace(/\s+/g, '-');

/** The tags sheet keeps its own draft, so typing a new tag re-renders only the sheet. A tag held opens its menu. */
function TagSheet({ visible, onClose, onClosed, tags, onToggle, onHold }: {
  visible: boolean; onClose: () => void; onClosed?: () => void; tags: string[]; onToggle: (t: string) => void;
  onHold: (t: string) => void;
}) {
  const journalTags = useStore((s) => s.journalTags);
  const setJournalTags = useStore((s) => s.setJournalTags);
  const [draft, setDraft] = React.useState('');
  const addTag = () => {
    const t = tagOf(draft);
    if (!t) return;
    if (!journalTags.includes(t)) setJournalTags([...journalTags, t].sort());
    if (!tags.includes(t)) onToggle(t);
    setDraft('');
  };
  return (
    <Sheet visible={visible} onClose={onClose} onClosed={onClosed} title="Tags">
      {journalTags.length ? (
        <>
          <Row style={{ flexWrap: 'wrap', marginBottom: 4 }}>
            {journalTags.map((t) => (
              <Chip key={t} small label={t} active={tags.includes(t)} color={C.gold} onPress={() => onToggle(t)} onLongPress={() => onHold(t)} />
            ))}
          </Row>
          <Text style={[T.caption, { marginBottom: 10 }]}>Hold a tag to rename or delete it.</Text>
        </>
      ) : (
        <Text style={[T.caption, { marginBottom: 10 }]}>Tags group entries, like exams, family or sport.</Text>
      )}
      <Field value={draft} onChangeText={setDraft} placeholder="New tag" autoCapitalize="none" onSubmitEditing={addTag} returnKeyType="done" />
      <PillButton label="Add tag" icon="add-outline" color={C.gold} onPress={addTag} />
    </Sheet>
  );
}

/** A new name for a tag, with its own draft. A name another tag already has joins the two. */
function TagRenameSheet({ tag, onClose, onSave }: {
  tag: string | null; onClose: () => void; onSave: (from: string, to: string) => void;
}) {
  const [draft, setDraft] = React.useState(tag ?? '');
  const shown = React.useRef(tag);
  if (tag) shown.current = tag;
  React.useEffect(() => { if (tag) setDraft(tag); }, [tag]);
  const save = () => {
    const to = tagOf(draft);
    if (tag && to) onSave(tag, to);
  };
  return (
    <Sheet visible={!!tag} onClose={onClose} title={'Rename ' + (shown.current ?? 'tag')}>
      <Field value={draft} onChangeText={setDraft} placeholder="Tag name" autoCapitalize="none" maxLength={40} onSubmitEditing={save} returnKeyType="done" />
      <PillButton label="Rename" color={C.gold} onPress={save} />
    </Sheet>
  );
}

/** The journal's own settings, with the reminder time's draft kept here rather than on the page. */
function JournalPrefs({ visible, onClose, onLock }: {
  visible: boolean; onClose: () => void; onLock: (on: boolean) => void;
}) {
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const hour24 = settings.hour24;
  const [remindDraft, setRemindDraft] = React.useState(settings.journalReminderTime || '21:30');
  // each opening starts from the saved time
  React.useEffect(() => {
    if (visible) setRemindDraft(useStore.getState().settings.journalReminderTime || '21:30');
  }, [visible]);
  const saveReminder = async (on: boolean, time = remindDraft) => {
    if (on && !(await ensurePermission())) { Alert.alert('Permission needed', 'Allow notifications in system settings first.'); return; }
    setSetting('journalReminderTime', on ? time : '');
    setTimeout(rescheduleAllReminders, 150);
  };
  // the time turns on a wheel in quarter hours, written the way the rest of the app writes times; a time saved
  // between two stops shows at the nearer one until the wheel is turned
  const remindStop = Math.round(Math.max(0, toMinutes(remindDraft)) / REMIND_STEP) % REMIND_STOPS;
  const stopLabel = React.useCallback((i: number) => ({ full: fmtClockTime(i * REMIND_STEP, hour24) }), [hour24]);
  const turnTo = React.useCallback((i: number) => {
    const m = i * REMIND_STEP;
    const hhmm = String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
    setRemindDraft(hhmm);
    if (useStore.getState().settings.journalReminderTime) {
      setSetting('journalReminderTime', hhmm);
      setTimeout(rescheduleAllReminders, 150);
    }
  }, [setSetting]);
  // with reminders off app-wide nothing could fire, so the switch rests off and cannot be moved until they are on
  const canRemind = settings.remindersEnabled;
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
        <Text style={[T.body, { flex: 1 }, !canRemind && { color: C.textFaint }]}>Reminder</Text>
        <View
          pointerEvents={canRemind ? 'auto' : 'none'}
          style={canRemind ? undefined : st.off}
          accessibilityState={canRemind ? undefined : { disabled: true }}
        >
          <Toggle
            value={canRemind && !!settings.journalReminderTime} onChange={(on) => { saveReminder(on); }} color={C.gold}
            label="Daily journal reminder"
          />
        </View>
      </Row>
      {canRemind ? (
        <Wheel
          loop
          count={REMIND_STOPS}
          index={remindStop}
          onChange={turnTo}
          label={stopLabel}
          spacing={hour24 ? 92 : 108}
          minScale={0.6}
          colorOn={settings.journalReminderTime ? C.gold : C.textDim}
          colorOff={C.textFaint}
          height={56}
          textStyle={st.remindText}
          accessibilityLabel="Reminder time"
        />
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
  // Source Serif's line box is tall: 28 keeps an ascender clear on Android
  date: { color: C.text, fontFamily: F.head, fontSize: 21, lineHeight: 28, letterSpacing: TRACK.large },
  /** the date in a bar slot: Inter Tight SemiBold 20 */
  dateSlot: { ...T.head },
  title: { color: C.text, fontFamily: F.semi, fontSize: 17, letterSpacing: TRACK.title, paddingVertical: 8 },
  prompt: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, marginBottom: 2 },
  promptText: { flex: 1, color: C.textDim, fontFamily: F.reg, fontSize: 14, letterSpacing: TRACK.small, lineHeight: 20 },
  // the face, size, line and tracking come from the Writing font (writingFace)
  body: { color: C.text, minHeight: 320, paddingTop: 6 },
  // the day line: under the date, quiet, its facts wrapping whole on a narrow phone
  dayLine: { alignSelf: 'flex-start', maxWidth: '100%', paddingVertical: 4, marginTop: -2, marginBottom: 4 },
  dayFacts: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 12, rowGap: 4 },
  dayFact: { flexDirection: 'row', alignItems: 'center' },
  dayFactIcon: { marginRight: 4 },
  dayChev: { marginLeft: 2 },
  dayFactText: { color: C.textDim, fontFamily: F.sm, fontSize: 12, lineHeight: 17, letterSpacing: TRACK.fine },
  // Your day: a kicker over each section, rows a finger's height
  daySection: { ...T.kicker, marginBottom: 4 },
  daySectionGap: { marginTop: 18 },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44, paddingVertical: 6 },
  dayRowText: { ...T.body, flex: 1 },
  dayRowNote: { ...T.caption },
  // a session's minutes line up down the list: tabular figures, so Inter Tight
  dayMin: { color: C.textDim, fontFamily: F.reg, fontSize: 13, letterSpacing: TRACK.small, fontVariant: ['tabular-nums'] },
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
  /** a switch that cannot be moved yet */
  off: { opacity: 0.4 },
  remindText: { fontFamily: F.semi, fontSize: 20, lineHeight: 26, letterSpacing: TRACK.large, fontVariant: ['tabular-nums'] },
});
