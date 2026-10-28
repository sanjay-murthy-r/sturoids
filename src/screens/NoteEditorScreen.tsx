import React, { useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, Alert, Share, Keyboard, AppState, Modal, useWindowDimensions,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle, useSharedValue, withRepeat, withTiming, Easing, cancelAnimation, FadeIn, FadeOut, runOnJS,
} from 'react-native-reanimated';
import * as ImagePicker from 'expo-image-picker';
import { Image as CachedImage } from 'expo-image';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { useVideoPlayer, VideoView } from 'expo-video';
import { C, F, MIN, S, T, TRACK, neuInset, neuPressedInner, neuRaised, NEU, writingFace } from '../theme';
import { columnWidth } from '../layout';
import { useStore, Attachment, Note, flushSaves } from '../store';
import { fmtClockTime, todayKey, yesterdayKey } from '../utils';
import {
  ScreenBG, Sheet, Chip, Row, IconBtn, NeuIconBtn, PillButton, DotMenu, EmptyState, GateHeader, Field, useTheme, useToolHeader,
} from '../components/UI';
import { SubjectSuggest } from '../components/SubjectSuggest';
import { tick } from '../haptics';
import { toast } from '../components/Toast';
import { NoteGate, PinSheet, ToolGate } from '../components/LockGate';
import { expectAway, markOpen, noteScope, pinStatus } from '../lock';
import { Bouncy, EASE_OUT, Enter, glide, rowIn, rowOut, useAnimLevel, useBuilt } from '../components/Motion';
import { voiceAvailable, startVoice, VoiceSession } from '../voice';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NOT_KEPT, keepFile, viewUri } from '../attachments';

import { toastTrashed } from '../trashToast';
import { useToday } from '../hooks/useNow';
import { useKeyboardOpen } from '../hooks/useKeyboard';
import { FolderNameSheet, isBlankNote } from './NotesListScreen';
import { takeFreshNote } from '../freshNotes';

/** a line of the body: the Writing font sets it (26 in the sans, 27 in the serif); the room kept while dictating counts in it */
const LINE_H = 26;
const FREE_LINES = 9; // keep ~8-10 lines of breathing room while dictating
/**
 * The title and the words live in the editor while they are typed, and reach the store after this pause. A keystroke
 * used to write the store, which re-rendered every screen watching the notes (the list under this page among them).
 */
const COMMIT_PAUSE_MS = 300;

const countWords = (text: string) => {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
};

// a picked file is kept in the app's own folder (attachments.ts keepFile), as a shared one is
const persistFile = keepFile;

/** A line's own mark, as the toolbar writes it: a bullet, an open box or a ticked one, then two spaces. */
const LINE_MARK = /^([•☐☑✓])[ \t]*/;

/**
 * When a note was last written to, for the header: the time today, the word yesterday, the date after that. Nothing
 * when it is not known, so the header says nothing rather than a date from 1970.
 */
function editedLine(updatedAt: number, today: string, hour24: boolean): string {
  const d = new Date(updatedAt);
  if (!updatedAt || isNaN(d.getTime())) return '';
  const key = todayKey(d);
  if (key === today) return 'Edited today, ' + fmtClockTime(d.getHours() * 60 + d.getMinutes(), hour24);
  if (key === yesterdayKey()) return 'Edited yesterday';
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return 'Edited ' + d.toLocaleDateString('en-IN', opts);
}

/**
 * Raised mic button — carves in while listening and breathes a pulse ring. With only some motion the ring holds still,
 * and with motion off nothing moves.
 */
function MicButton({ listening, onPress }: { listening: boolean; onPress: () => void }) {
  const theme = useTheme();
  const level = useAnimLevel();
  const scale = useSharedValue(1);
  const pulse = useSharedValue(0);
  const on = useSharedValue(listening ? 1 : 0);

  React.useEffect(() => {
    cancelAnimation(pulse);
    if (level === 'none') {
      scale.value = 1;
      pulse.value = 0;
      on.value = listening ? 1 : 0;
      return;
    }
    on.value = withTiming(listening ? 1 : 0, { duration: 160, easing: EASE_OUT });
    // the button eases up and back, as everything else in the note does
    if (listening) {
      scale.value = withTiming(1.06, { duration: 160, easing: EASE_OUT });
      pulse.value = 0;
      if (level === 'full') {
        pulse.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.out(Easing.quad) }), -1, false);
      }
    } else {
      pulse.value = withTiming(0, { duration: 150 });
      scale.value = withTiming(1, { duration: 140, easing: EASE_OUT });
    }
  }, [listening, level]);

  const micStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: on.value * (1 - pulse.value) * 0.5,
    transform: [{ scale: 1 + pulse.value * 0.7 }],
  }));

  return (
    <Animated.View style={micStyle}>
      <Bouncy
        onPress={onPress}
        scaleTo={0.9}
        radius={22}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={listening ? 'Stop dictation' : 'Dictate'}
        style={[
          st.micBtn,
          theme === 'minimal'
            ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: listening ? C.danger : MIN.border }
            : { backgroundColor: C.card, ...neuRaised('low') },
        ]}
      >
        <Animated.View pointerEvents="none" style={[st.pulseRing, ringStyle]} />
        {listening && theme !== 'minimal' ? (
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: 22, backgroundColor: C.inset, ...neuPressedInner() }]} />
        ) : null}
        <Ionicons name={listening ? 'mic' : 'mic-outline'} size={22} color={listening ? C.danger : C.accent} />
      </Bouncy>
    </Animated.View>
  );
}

/** A note: behind the Notes lock when that is on, and behind its own lock when the note is locked. */
export function NoteEditorScreen({ mode }: { mode: 'tab' | 'stack' }) {
  const { id } = useLocalSearchParams<{ id: string }>();
  const locked = useStore((s) => s.notes.find((n) => n.id === id)?.locked === true);
  const folder = useStore((s) => s.notes.find((n) => n.id === id)?.folder ?? 'Note');
  // a lock screen wears the header without its line, so nothing of a locked note shows
  const header = <GateHeader title={folder} tab={false} />;
  return (
    <ToolGate tool="notes" guard={false} header={header}>
      <NoteGate id={id ?? ''} locked={locked} header={header}>
        <NoteEditor mode={mode} />
      </NoteGate>
    </ToolGate>
  );
}

function NoteEditor({ mode }: { mode: 'tab' | 'stack' }) {
  const insets = useSafeAreaInsets();
  const [lockPin, setLockPin] = useState(false);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const level = useAnimLevel();
  const built = useBuilt();
  const stored = useStore((s) => s.notes.find((n) => n.id === id));
  // a note deleted from here keeps its page while the page leaves, instead of flashing "Note not found" on its way out
  const lastNote = useRef<Note | undefined>(stored);
  const leaving = useRef(false);
  if (stored) lastNote.current = stored;
  const note = stored ?? (leaving.current ? lastNote.current : undefined);
  const updateNote = useStore((s) => s.updateNote);
  const folders = useStore((s) => s.noteFolders);
  const addDaily = useStore((s) => s.addDaily);
  const addMission = useStore((s) => s.addMission);
  const addAttachment = useStore((s) => s.addAttachment);

  const [lineSheet, setLineSheet] = useState(false);
  const [folderSheet, setFolderSheet] = useState(false);
  const [listening, setListening] = useState(false);
  const [liveText, setLiveText] = useState('');
  const voiceRef = useRef<VoiceSession | null>(null);
  /** set from the first tap until dictation has started, so a second quick tap never starts it twice */
  const voiceStarting = useRef(false);
  const alive = useRef(true);
  const selRef = useRef({ start: 0, end: 0 });
  const bodyRef = useRef<TextInput>(null);
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const lastPush = useRef(0);
  const scrollRef = useRef<Animated.ScrollView>(null);
  const sizesRef = useRef({ content: 0, viewport: 0 });
  const [toolMenu, setToolMenu] = useState(false);
  // the toast waits for the sheet to go: a sheet is a window of its own and would cover it. A hook, so it sits above the
  // "Note not found" return: a note that vanishes from the store (a restored backup) must not change the hook count
  const promoted = React.useRef<{ kind: 'daily' | 'mission'; id: string } | null>(null);
  // whether the words have the caret: without it, dictation and the line buttons work at the end of the note, never
  // at a caret left at its very start
  const bodyFocus = useRef(false);
  // where the native caret is sent after a change made from here (dictation, a line mark): set for one render only
  const [caretTo, setCaretTo] = useState<{ start: number; end: number } | null>(null);
  React.useEffect(() => { if (caretTo) setCaretTo(null); }, [caretTo]);
  const [viewing, setViewing] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState(false);
  const [metaSheet, setMetaSheet] = useState(false);
  const newFolderNext = useRef(false);

  // a dictation still running when the note closes is stopped, never left listening
  React.useEffect(() => () => {
    alive.current = false;
    voiceRef.current?.stop();
  }, []);
  // nor is one left listening behind another tab (a note in a bar slot stays open there), or with the app put away
  const shown = useRef(true);
  const stopVoice = React.useCallback(() => {
    voiceRef.current?.stop();
    voiceRef.current = null;
    setListening(false);
    setLiveText('');
  }, []);
  useFocusEffect(React.useCallback(() => {
    shown.current = true;
    return () => { shown.current = false; stopVoice(); };
  }, [stopVoice]));
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => { if (next === 'background') stopVoice(); });
    return () => sub.remove();
  }, [stopVoice]);

  // ---- the draft: what is typed shows at once, and reaches the store after a pause ----
  const [title, setTitle] = useState(stored?.title ?? '');
  const [body, setBodyText] = useState(stored?.body ?? '');
  const draft = useRef({ title: stored?.title ?? '', body: stored?.body ?? '' });
  // the words the store and the draft last agreed on: a stored note whose words differ from these was changed under the
  // page (a restored backup, a newer copy the cloud brought quietly, a revision sheet written again from the Vault)
  const synced = useRef<{ title: string; body: string } | null>(stored ? { title: stored.title, body: stored.body } : null);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The page takes the stored words: what was typed and not yet committed is dropped, never written over them. */
  const adopt = React.useCallback((n: Note) => {
    if (commitTimer.current) { clearTimeout(commitTimer.current); commitTimer.current = null; }
    const changedUnder = synced.current != null;
    synced.current = { title: n.title, body: n.body };
    draft.current = { title: n.title, body: n.body };
    // an undo would bring back words from before the change, so its steps start again from here
    if (changedUnder) { undoStack.current = []; redoStack.current = []; }
    setTitle(n.title);
    setBodyText(n.body);
  }, []);
  const commit = React.useCallback(() => {
    if (commitTimer.current) { clearTimeout(commitTimer.current); commitTimer.current = null; }
    const s = useStore.getState();
    const n = s.notes.find((x) => x.id === id);
    if (!n) return;
    const was = synced.current;
    // changed under the page since the two last agreed: the stored words win
    if (was && (n.title !== was.title || n.body !== was.body)) { adopt(n); return; }
    const d = draft.current;
    synced.current = { title: d.title, body: d.body };
    if (n.title !== d.title || n.body !== d.body) s.updateNote(n.id, { title: d.title, body: d.body });
  }, [id, adopt]);
  const scheduleCommit = React.useCallback(() => {
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(commit, COMMIT_PAUSE_MS);
  }, [commit]);
  // the draft follows the stored note: one that turns up after the page was built (the store still loading), and one
  // changed from outside while it sits open (a restored backup, a quiet follow of the cloud), even with typing still
  // waiting, so the waiting words are never committed over the newer ones. The page's own commits are no change from
  // outside: they leave the stored words as `synced` already says
  React.useEffect(() => {
    if (!stored) return;
    const was = synced.current;
    if (was && was.title === stored.title && was.body === stored.body) return;
    adopt(stored);
  }, [stored?.id, stored?.title, stored?.body, adopt]);
  // closing the note writes what is waiting, and so does leaving the app, straight through to storage
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') { commit(); flushSaves(); }
    });
    // closing the note (not just backgrounding) must also flush past the save debounce, or a quick
    // back-then-kill can lose the last edit before the store's own pause finishes writing it out
    return () => { sub.remove(); commit(); flushSaves(); };
  }, [commit]);
  // a note New note made and nobody wrote in goes again when its page is closed. Only a close counts: a lock that
  // comes down over the page takes the editor away too, and the note must still be there once it is opened
  const navigation = useNavigation();
  React.useEffect(() => navigation.addListener('beforeRemove', () => {
    commit();
    if (!id || !takeFreshNote(id)) return;
    const s = useStore.getState();
    const n = s.notes.find((x) => x.id === id);
    if (n && isBlankNote(n)) {
      leaving.current = true;
      s.deleteNote(n.id);
    }
  }), [navigation, commit, id]);

  // a line offered as a task is its words: the bullet or box the toolbar put in front of it stays in the note. They are
  // read only while the sheet is open (not on every keystroke), and a closing sheet keeps the lines it opened with
  const linesFrom = useRef('');
  if (lineSheet) linesFrom.current = body;
  const lines = useMemo(
    () => linesFrom.current.split('\n').map((l) => l.trim().replace(/^[•☐☑✓]\s*/, '').trim()).filter((l) => l.length > 2),
    [linesFrom.current]
  );
  const words = useMemo(() => countWords(body), [body]);

  const noteId = note?.id ?? '';
  // A removed attachment goes to Recently deleted, and its file stays on the phone until it is deleted for good there.
  // Undo puts the same attachment back where it stood
  const removeOne = React.useCallback((attId: string) => {
    toastTrashed(useStore.getState().trashAttachment(noteId, attId));
  }, [noteId]);
  const viewPhoto = React.useCallback((uri: string) => { Keyboard.dismiss(); setViewing(uri); }, []);

  const toggleLock = async () => {
    if (!note) return;
    Keyboard.dismiss();
    // the note is open, so its PIN has been given (or it was never locked): the lock comes off without asking again
    if (note.locked) {
      updateNote(note.id, { locked: false }, { touch: false });
      toast('The note is no longer locked.');
      return;
    }
    if ((await pinStatus()) === 'set') {
      updateNote(note.id, { locked: true }, { touch: false });
      markOpen(noteScope(note.id));
      toast('Note locked. Your PIN opens it.');
      return;
    }
    // no PIN on this phone yet, or only an older code: one is chosen first, then the note locks
    setLockPin(true);
  };

  /** Nothing typed, nothing attached: deleting it keeps nothing in Recently deleted, as closing a blank new note does. */
  const blankNow = () => !!note && isBlankNote({ ...draft.current, attachments: note.attachments });

  const deleteThis = () => {
    if (!note) return;
    // what was typed goes with it, so the note comes back from Recently deleted as it was last seen
    commit();
    if (blankNow()) {
      takeFreshNote(note.id);
      leaving.current = true;
      useStore.getState().deleteNote(note.id);
      router.back();
      return;
    }
    // Recently deleted could not take it: the note stays, and so does its page
    if (!toastTrashed(useStore.getState().trashNote(note.id))) return;
    // the page keeps showing the note while it leaves
    leaving.current = true;
    router.back();
  };

  // The header: the folder is the bar's title, and the line under it says when the note was last written to. That line
  // reads at rest: with the keyboard up the note is being typed in, and a time ticking over under the title would only
  // draw the eye. The lock stays in the bar, where its state shows; the rest are in the menu beside it.
  const hour24 = useStore((s) => s.settings.hour24);
  // the body is set in the Writing font (Settings, Appearance); the title keeps its serif
  const writingFont = useStore((s) => s.settings.writingFont);
  const bodyStyle = React.useMemo(() => [st.body, writingFace(writingFont)], [writingFont]);
  const liveStyle = React.useMemo(() => [st.liveInline, writingFace(writingFont)], [writingFont]);
  const today = useToday();
  const keyboardOpen = useKeyboardOpen();
  const edited = note ? editedLine(note.updatedAt, today, hour24) : '';
  const [editedHeld, setEditedHeld] = useState(edited);
  React.useEffect(() => { if (!keyboardOpen) setEditedHeld(edited); }, [keyboardOpen, edited]);
  const header = useToolHeader({ scrollRef, scrollMemory: 'keep',
    title: note?.folder ?? 'Note',
    mode: 'page',
    context: editedHeld,
    actions: note ? [
      {
        icon: note.locked ? 'lock-closed' : 'lock-open-outline', label: note.locked ? 'Unlock note' : 'Lock note',
        color: note.locked ? C.gold : undefined, onPress: toggleLock,
      },
      {
        icon: note.pinned ? 'pin' : 'pin-outline', label: note.pinned ? 'Unpin note' : 'Pin note',
        onPress: () => updateNote(note.id, { pinned: !note.pinned }, { touch: false }),
      },
      { icon: 'folder-outline', label: 'Move to folder', onPress: () => setFolderSheet(true) },
      ...(note.locked ? [] : [{
        icon: 'share-outline' as const, label: 'Share note',
        // an untitled note shares its words alone, with no blank lines in front; coming back never locks the note
        onPress: () => { expectAway(() => Share.share({ message: [title.trim(), body.trim()].filter(Boolean).join('\n\n') })).catch(() => {}); },
      }]),
      {
        icon: 'trash-outline', label: 'Delete note', color: C.danger,
        onPress: () => (blankNow() ? deleteThis() : Alert.alert('Delete note', 'You can restore it from Recently deleted for 30 days.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: deleteThis },
        ])),
      },
    ] : undefined,
  });

  if (!note) {
    // the text face, like every other empty page (a bare Text fell back to the system font)
    return (
      <ScreenBG>
        {header.bar}
        <EmptyState icon="document-text-outline" title="Note not found" body="It may have been deleted." />
      </ScreenBG>
    );
  }

  /**
   * The live body, straight from the draft. Voice callbacks are registered
   * ONCE per recording session, so any `body` they close over is frozen
   * at record-start — every later utterance would rebuild the note from that
   * stale baseline and erase what came in between (the dictation-erases-text
   * bug). Everything that mutates the body must read through here instead.
   */
  const liveBody = () => draft.current.body;

  /** The words change now; the store hears of it after a pause. */
  const writeBody = (v: string) => {
    draft.current.body = v;
    setBodyText(v);
    scheduleCommit();
  };

  const setBody = (v: string, pushHistory = true) => {
    if (pushHistory && Date.now() - lastPush.current > 800) {
      undoStack.current.push(liveBody());
      if (undoStack.current.length > 60) undoStack.current.shift();
      redoStack.current = [];
      lastPush.current = Date.now();
    }
    writeBody(v);
  };

  const undo = () => {
    const prev = undoStack.current.pop();
    if (prev === undefined) return;
    redoStack.current.push(liveBody());
    writeBody(prev);
  };
  const redo = () => {
    const next = redoStack.current.pop();
    if (next === undefined) return;
    undoStack.current.push(liveBody());
    writeBody(next);
  };

  /**
   * Where a change made from here goes: the caret while the words have it (clamped, as the tracked selection may
   * predate an insert), otherwise the end of the note.
   */
  const insertionPoint = (b: string) => {
    if (!bodyFocus.current) return { start: b.length, end: b.length };
    const start = Math.min(selRef.current.start, b.length);
    return { start, end: Math.min(Math.max(selRef.current.end, start), b.length) };
  };
  /** Changes the words and sends the native caret to `caret`, where the tracked one already is. */
  const writeAt = (next: string, caret: number) => {
    setBody(next);
    selRef.current = { start: caret, end: caret };
    setCaretTo({ start: caret, end: caret });
  };

  /** A dictated phrase, set apart from the word before it by a space. */
  const insertPhrase = (phrase: string) => {
    const b = liveBody(); // NOT the closed-over note.body — see liveBody()
    const { start, end } = insertionPoint(b);
    const text = (start > 0 && !/\s/.test(b[start - 1]) ? ' ' : '') + phrase;
    writeAt(b.slice(0, start) + text + b.slice(end), start + text.length);
  };

  /**
   * The bullet and box buttons toggle the mark of the caret's line (the last line when the words have no caret). The
   * box goes from none to open to ticked and back to none; the bullet goes on and off; one mark replaces the other
   * instead of stacking in front of it.
   */
  const markLine = (kind: 'bullet' | 'box') => {
    const b = liveBody();
    const { start } = insertionPoint(b);
    const lineStart = start === 0 ? 0 : b.lastIndexOf('\n', start - 1) + 1;
    const m = LINE_MARK.exec(b.slice(lineStart));
    const had = m ? m[1] : '';
    const next = kind === 'bullet'
      ? (had === '•' ? '' : '•')
      : had === '☐' ? '☑' : had === '☑' || had === '✓' ? '' : '☐';
    const mark = next ? next + '  ' : '';
    const oldLen = m ? m[0].length : 0;
    const shift = mark.length - oldLen;
    const caret = Math.max(lineStart + mark.length, start + shift);
    writeAt(b.slice(0, lineStart) + mark + b.slice(lineStart + oldLen), bodyFocus.current ? caret : b.length + shift);
  };

  /** While dictating, keep the writing edge visible with ~9 free lines below it. */
  const autoScroll = () => {
    const { content, viewport } = sizesRef.current;
    if (!viewport) return;
    const target = Math.max(0, content - viewport + FREE_LINES * LINE_H);
    scrollRef.current?.scrollTo({ y: target, animated: true });
  };

  const toggleVoice = async () => {
    if (voiceStarting.current) return;
    if (listening) {
      voiceRef.current?.stop();
      setListening(false);
      setLiveText('');
      return;
    }
    if (!voiceAvailable()) {
      Alert.alert('Voice input', 'Speech recognition ships with the installed APK build (it cannot run inside Expo Go).');
      return;
    }
    voiceStarting.current = true;
    try {
      const session = await startVoice(
        (finalText) => {
          setLiveText('');
          insertPhrase(finalText);
          setTimeout(autoScroll, 60);
        },
        (interim) => setLiveText(interim),
        () => { setListening(false); setLiveText(''); },
        (msg) => { setListening(false); setLiveText(''); Alert.alert('Voice input', msg); }
      );
      if (!session) return;
      // the note closed, or went behind another tab, while the microphone was being set up: stop at once instead of
      // listening unseen
      if (!alive.current || !shown.current) { session.stop(); return; }
      voiceRef.current = session;
      setListening(true);
    } finally {
      voiceStarting.current = false;
    }
  };

  // The pickers and the camera take the app out of view; coming back from them never locks the note or the Notes tool
  const pickMedia = async () => {
    try {
      const res = await expectAway(() => ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        quality: 0.85,
        allowsMultipleSelection: true,
        selectionLimit: 5,
      }));
      if (res.canceled) return;
      let lost = false;
      for (const a of res.assets) {
        const name = a.fileName || (a.type === 'video' ? 'video.mp4' : 'image.jpg');
        const stored = await persistFile(a.uri, name);
        if (!stored.kept) lost = true;
        addAttachment(note.id, { kind: a.type === 'video' ? 'video' : 'image', uri: stored.uri, name });
      }
      if (lost) toast(NOT_KEPT);
    } catch (e: any) {
      toast('Could not attach that file');
    }
  };

  /** A photo of the board, straight from the camera into the note. */
  const takePhoto = async () => {
    try {
      const res = await expectAway(() => ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 }));
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      const name = a.fileName || 'photo.jpg';
      const stored = await persistFile(a.uri, name);
      addAttachment(note.id, { kind: 'image', uri: stored.uri, name });
      if (!stored.kept) toast(NOT_KEPT);
    } catch (e: any) {
      toast(/permission/i.test(String(e?.code) + String(e?.message))
        ? 'Allow the camera in the phone\'s settings to take a photo.'
        : 'Could not take a photo');
    }
  };

  const pickFile = async () => {
    try {
      const res = await expectAway(() => DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true }));
      if (res.canceled || !res.assets?.[0]) return;
      const f = res.assets[0];
      const stored = await persistFile(f.uri, f.name || 'file');
      addAttachment(note.id, { kind: 'file', uri: stored.uri, name: f.name || 'file' });
      if (!stored.kept) toast(NOT_KEPT);
    } catch (e: any) {
      toast('Could not attach that file');
    }
  };

  const promote =(line: string, kind: 'daily' | 'mission') => {
    const id = kind === 'daily' ? addDaily(line) : addMission(line, todayKey());
    promoted.current = { kind, id };
    setLineSheet(false);
  };
  const promotedToast = () => {
    const p = promoted.current;
    promoted.current = null;
    if (!p) return;
    toast(p.kind === 'daily' ? 'Added to ToDos' : 'Added to long-term tasks, due today', {
      label: 'Undo',
      onPress: () => (p.kind === 'daily' ? useStore.getState().removeDaily(p.id) : useStore.getState().removeMission(p.id)),
    });
  };

  // the note's column: the window on a phone, a capped column on a wide window
  const colW = columnWidth(width, mode === 'tab');
  // The toolbar's ten targets need 402dp. Narrower, undo and redo move into a menu (the rest need 372dp); under 376dp
  // the photo, camera and file buttons go into it too
  const tools: 'all' | 'media' | 'menu' = colW >= 408 ? 'all' : colW >= 376 ? 'media' : 'menu';
  const mediaW = (colW - S.pad * 2 - 10) / 2;
  const menuItems = [
    ...(tools === 'menu' ? [
      { label: 'Add a photo or video', icon: 'image-outline', onPress: pickMedia },
      { label: 'Take a photo', icon: 'camera-outline', onPress: takePhoto },
      { label: 'Attach a file', icon: 'attach-outline', onPress: pickFile },
    ] : []),
    { label: 'Undo', icon: 'arrow-undo-outline', onPress: undo },
    { label: 'Redo', icon: 'arrow-redo-outline', onPress: redo },
  ];

  return (
    <ScreenBG>
      {header.bar}
      <Animated.ScrollView
        ref={scrollRef}
        {...header.scrollProps}
        contentContainerStyle={{ padding: S.pad, paddingTop: header.padTop, paddingBottom: 170 + (mode === 'tab' ? 0 : insets.bottom) }}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={(w, h) => { sizesRef.current.content = h; if (listening) autoScroll(); }}
        onLayout={(e) => { sizesRef.current.viewport = e.nativeEvent.layout.height; }}
      >
        {/* the note rises with its page, as the Journal's page and the Vault's rows do */}
        <Enter index={0}>
          {header.hero}
          {/* a long title wraps instead of running off sideways; Enter goes on to the words */}
          <TextInput
            value={title}
            onChangeText={(v) => { draft.current.title = v; setTitle(v); scheduleCommit(); }}
            placeholder="Title"
            placeholderTextColor={C.textFaint}
            style={st.title}
            multiline
            scrollEnabled={false}
            textAlignVertical="top"
            maxLength={200}
            blurOnSubmit
            returnKeyType="next"
            onSubmitEditing={() => bodyRef.current?.focus()}
          />
          {/* the date is the header's now; the count keeps its line when there are no words, so the first one typed
              does not push the page down */}
          <Text style={[T.caption, st.words]}>
            {words ? words + (words === 1 ? ' word' : ' words') : ' '}
          </Text>
          {/* the note's subject (one list across the app) and its tags: what the search and the subject's page find it by */}
          <View style={st.meta}>
            <Chip
              small icon="school-outline" label={note.subject || 'Subject'} active={!!note.subject}
              onPress={() => setMetaSheet(true)} accessibilityLabel={note.subject ? 'Subject, ' + note.subject : 'Add a subject'}
            />
            {(note.tags || []).map((t) => (
              <Chip key={t} small label={'#' + t} onPress={() => setMetaSheet(true)} accessibilityLabel={'Tag ' + t} />
            ))}
            <Chip small icon="pricetag-outline" label={note.tags?.length ? '' : 'Tag'} onPress={() => setMetaSheet(true)} accessibilityLabel="Add a tag" />
          </View>

          {note.attachments.length > 0 && (
            <Attachments items={note.attachments} width={mediaW} onRemove={removeOne} onView={viewPhoto} live={built.current} />
          )}

          <TextInput
            ref={bodyRef}
            value={body}
            onChangeText={(v) => setBody(v)}
            onSelectionChange={(e) => { selRef.current = e.nativeEvent.selection; }}
            onFocus={() => { bodyFocus.current = true; }}
            onBlur={() => { bodyFocus.current = false; }}
            selection={caretTo ?? undefined}
            placeholder="Write…"
            placeholderTextColor={C.textFaint}
            selectionColor={C.accent}
            multiline
            textAlignVertical="top"
            style={bodyStyle}
          />
          {listening && (
            <Text style={liveStyle}>
              {liveText || '…'}
            </Text>
          )}
        </Enter>
      </Animated.ScrollView>

      {/* live transcript strip */}
      {listening && (
        // the strip floats over the page, so it can fade in and out where it stands without moving anything
        <Animated.View
          entering={level === 'none' ? undefined : FadeIn.duration(level === 'full' ? 220 : 160).easing(EASE_OUT)}
          exiting={level === 'none' ? undefined : FadeOut.duration(150)}
          style={[st.liveBar, { bottom: 66 + (mode === 'tab' ? 0 : insets.bottom) }, theme === 'minimal' && { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border, boxShadow: undefined }]}
        >
          <View style={st.liveDot} />
          <Text style={st.liveBarText} numberOfLines={2}>
            {liveText || 'Listening…'}
          </Text>
        </Animated.View>
      )}

      {/* editor toolbar */}
      <View style={[st.toolbar, { paddingBottom: 9 + (mode === 'tab' ? 0 : insets.bottom) }, theme === 'minimal' && { backgroundColor: MIN.card, borderColor: MIN.border, boxShadow: undefined }]}>
        <MicButton listening={listening} onPress={toggleVoice} />
        <IconBtn name="ellipse-outline" size={20} pad={6} onPress={() => markLine('bullet')} accessibilityLabel="Bullet" />
        <IconBtn name="checkbox-outline" size={20} pad={6} onPress={() => markLine('box')} accessibilityLabel="Checkbox, then tick it" />
        <IconBtn name="checkmark-done-outline" size={20} pad={6} onPress={() => setLineSheet(true)} accessibilityLabel="Promote a line to a task" />
        <View style={{ flex: 1 }} />
        {tools === 'menu' ? null : (
          <>
            <NeuIconBtn name="image-outline" dim={40} size={19} color={C.accent} onPress={pickMedia} accessibilityLabel="Add a photo or video" />
            <NeuIconBtn name="camera-outline" dim={40} size={19} color={C.accent} onPress={takePhoto} accessibilityLabel="Take a photo" />
            <NeuIconBtn name="attach-outline" dim={40} size={19} color={C.accent} onPress={pickFile} accessibilityLabel="Attach a file" />
          </>
        )}
        {tools === 'all' ? (
          <>
            <IconBtn name="arrow-undo-outline" size={20} pad={6} onPress={undo} accessibilityLabel="Undo" />
            <IconBtn name="arrow-redo-outline" size={20} pad={6} onPress={redo} accessibilityLabel="Redo" />
          </>
        ) : (
          <NeuIconBtn name="ellipsis-horizontal" dim={40} size={19} color={C.textDim} onPress={() => setToolMenu(true)} accessibilityLabel="More tools" />
        )}
      </View>

      <Sheet visible={lineSheet} onClose={() => setLineSheet(false)} onClosed={promotedToast} title="Promote a line to a task">
        {lines.length === 0 ? (
          <Text style={T.caption}>Write a few lines first.</Text>
        ) : (
          lines.slice(0, 30).map((l, i) => (
            <View key={i} style={{ marginBottom: 12 }}>
              <Text style={[T.body, { marginBottom: 5 }]} numberOfLines={1}>{l}</Text>
              <Row>
                <PillButton small label="→ ToDo" color={C.green} onPress={() => promote(l, 'daily')} style={{ marginRight: 8 }} />
                <PillButton small label="→ Task" color={C.amber} onPress={() => promote(l, 'mission')} />
              </Row>
            </View>
          ))
        )}
      </Sheet>

      <Sheet
        visible={folderSheet}
        onClose={() => setFolderSheet(false)}
        // a new folder is named in its own sheet, once this one has gone
        onClosed={() => { if (newFolderNext.current) { newFolderNext.current = false; setNewFolder(true); } }}
        title="Move to folder"
      >
        <Row style={{ flexWrap: 'wrap' }}>
          {folders.map((f) => (
            <Chip key={f} label={f} active={note.folder === f}
              onPress={() => { updateNote(note.id, { folder: f }, { touch: false }); setFolderSheet(false); }} />
          ))}
          <Chip icon="add" label="New folder" onPress={() => { newFolderNext.current = true; setFolderSheet(false); }} />
        </Row>
      </Sheet>
      <FolderNameSheet
        visible={newFolder}
        onClose={() => setNewFolder(false)}
        title="New folder"
        initial=""
        label="Create and move"
        check={(name) => (!name ? 'Give the folder a name.' : folders.includes(name) ? 'There is already a folder with that name.' : '')}
        onSave={(name) => {
          useStore.getState().addNoteFolder(name);
          updateNote(note.id, { folder: name }, { touch: false });
          setNewFolder(false);
        }}
      />
      <NoteMetaSheet visible={metaSheet} onClose={() => setMetaSheet(false)} note={note} />
      <DotMenu visible={toolMenu} onClose={() => setToolMenu(false)} items={menuItems} />
      <PhotoViewer uri={viewing} onClose={() => setViewing(null)} />

      <PinSheet
        visible={lockPin}
        mode="set"
        tint={C.green}
        onClose={() => setLockPin(false)}
        onDone={() => {
          setLockPin(false);
          updateNote(note.id, { locked: true }, { touch: false });
          markOpen(noteScope(note.id));
          toast('Note locked. Your PIN opens it.');
        }}
      />
    </ScreenBG>
  );
}

async function openFile(a: Attachment) {
  try {
    // the share sheet offers the apps that can open the file; coming back from it never locks the note
    if (await Sharing.isAvailableAsync()) await expectAway(() => Sharing.shareAsync(a.uri));
  } catch {
    toast('Could not open ' + a.name);
  }
}

/** How far a picture can be looked into, the step a double tap takes, and how far down a pull puts it away. */
const ZOOM_MAX = 5;
const ZOOM_TAP = 2.5;
const PULL_CLOSE = 120;
const VIEW_EASE = { duration: 220, easing: EASE_OUT };

/**
 * An attached picture across the whole screen, drawn whole so a photo of a board or a page can be read. Pinch or
 * double tap to look closer, drag to move about it while closer, and pull it down (or press back) to put it away. It
 * fades in and out on an ease; with motion off it is simply there, and every settle is a step.
 */
function PhotoViewer({ uri, onClose }: { uri: string | null; onClose: () => void }) {
  const level = useAnimLevel();
  const still = level === 'none';
  const insets = useSafeAreaInsets();
  const { width: w, height: h } = useWindowDimensions();
  const [shown, setShown] = useState<string | null>(uri);
  const fade = useSharedValue(0);
  const scale = useSharedValue(1);
  const from = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const pull = useSharedValue(0);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const requestClose = React.useCallback(() => closeRef.current(), []);
  const gone = React.useCallback(() => setShown(null), []);

  React.useEffect(() => {
    if (uri) {
      setShown(uri);
      scale.value = 1; x.value = 0; y.value = 0; pull.value = 0;
      fade.value = still ? 1 : withTiming(1, VIEW_EASE);
    } else if (still) {
      fade.value = 0;
      setShown(null);
    } else {
      fade.value = withTiming(0, { duration: 160, easing: Easing.in(Easing.quad) }, (fin) => { if (fin) runOnJS(gone)(); });
    }
  }, [uri]);

  const gesture = React.useMemo(() => {
    const to = (v: number) => {
      'worklet';
      return still ? v : withTiming(v, VIEW_EASE);
    };
    // a closer picture can be moved only as far as its edges
    const clamp = (v: number, s: number, side: number) => {
      'worklet';
      const m = (side * (s - 1)) / 2;
      return Math.min(m, Math.max(-m, v));
    };
    const pinch = Gesture.Pinch()
      .onStart(() => { from.value = scale.value; })
      .onUpdate((e) => { scale.value = Math.min(ZOOM_MAX, Math.max(0.8, from.value * e.scale)); })
      .onEnd(() => {
        const s = Math.max(1, scale.value);
        scale.value = to(s);
        x.value = to(clamp(x.value, s, w));
        y.value = to(clamp(y.value, s, h));
      });
    const pan = Gesture.Pan()
      .averageTouches(true)
      .onStart(() => { startX.value = x.value; startY.value = y.value; })
      .onUpdate((e) => {
        if (scale.value > 1.01) {
          x.value = startX.value + e.translationX;
          y.value = startY.value + e.translationY;
        } else {
          pull.value = Math.max(0, e.translationY);
        }
      })
      .onEnd((e) => {
        if (scale.value > 1.01) {
          x.value = to(clamp(x.value, scale.value, w));
          y.value = to(clamp(y.value, scale.value, h));
        } else if (pull.value > PULL_CLOSE || e.velocityY > 900) {
          runOnJS(requestClose)();
        } else {
          pull.value = to(0);
        }
      });
    // a double tap looks closer at the point tapped, and a second one steps back out
    const twice = Gesture.Tap()
      .numberOfTaps(2)
      .maxDelay(260)
      .onEnd((e) => {
        if (scale.value > 1.01) {
          scale.value = to(1);
          x.value = to(0);
          y.value = to(0);
          return;
        }
        scale.value = to(ZOOM_TAP);
        x.value = to(clamp((w / 2 - e.x) * (ZOOM_TAP - 1), ZOOM_TAP, w));
        y.value = to(clamp((h / 2 - e.y) * (ZOOM_TAP - 1), ZOOM_TAP, h));
      });
    return Gesture.Race(twice, Gesture.Simultaneous(pinch, pan));
  }, [w, h, still, requestClose]);

  // the ground thins as a pull takes the picture down, which shrinks a little with it
  const ground = useAnimatedStyle(() => ({ opacity: fade.value * (1 - Math.min(0.6, pull.value / 400)) }));
  const picture = useAnimatedStyle(() => ({
    opacity: fade.value,
    transform: [
      { translateX: x.value },
      { translateY: y.value + pull.value },
      { scale: scale.value * (1 - Math.min(0.15, pull.value / 1200)) },
    ] as const,
  }));
  const chrome = useAnimatedStyle(() => ({ opacity: fade.value }));

  if (!shown) return null;
  return (
    <Modal visible transparent statusBarTranslucent animationType="none" onRequestClose={onClose}>
      {/* a modal is its own window: gestures inside it need their own root */}
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: C.ambient }, ground]} />
        <GestureDetector gesture={gesture}>
          <Animated.View style={[StyleSheet.absoluteFill, picture]}>
            <CachedImage
              source={{ uri: shown }} style={{ width: w, height: h }} contentFit="contain" cachePolicy="memory"
              accessible accessibilityLabel="Attached picture"
            />
          </Animated.View>
        </GestureDetector>
        <Animated.View style={[st.viewerClose, { top: insets.top + 8 }, chrome]}>
          <IconBtn name="close" size={24} color={C.text} onPress={onClose} accessibilityLabel="Close the picture" />
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

/**
 * The note's pictures, videos and files. Kept apart from the editor so a keystroke never re-renders a video; one added
 * later fades in where it lands, one removed fades as it goes, and the rest glide to their places.
 */
const Attachments = React.memo(function Attachments({ items, width, onRemove, onView, live }: {
  items: Attachment[]; width: number; onRemove: (id: string) => void;
  /** a picture tapped: it opens across the whole screen */
  onView: (uri: string) => void;
  /** the note was already open when these arrived: the first one fades in too */
  live: boolean;
}) {
  useTheme(); // repaints a file's accent on a new accent
  const level = useAnimLevel();
  const built = useBuilt();
  const enter = built.current || live ? rowIn(level) : undefined;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
      {items.map((a) => (
        <Animated.View key={a.id} entering={enter} exiting={rowOut(level)} layout={glide(level)}>
          {a.kind === 'image' && (
            <AttachedImage uri={viewUri(a.uri)} width={width} onPress={() => onView(viewUri(a.uri))} />
          )}
          {a.kind === 'video' && <AttachedVideo uri={viewUri(a.uri)} name={a.name} width={width} />}
          {a.kind === 'file' && (
            <Bouncy onPress={() => openFile(a)} style={[st.fileRow, { borderColor: C.accent + '44', backgroundColor: C.accent + '18' }]}>
              <Ionicons name="document-attach-outline" size={18} color={C.accent} />
              <Text style={{ color: C.accent, fontFamily: F.med, marginLeft: 8, fontSize: 13, letterSpacing: TRACK.small, maxWidth: width * 1.6 }} numberOfLines={1}>
                {a.name}
              </Text>
            </Bouncy>
          )}
          <IconBtn
            name="close-circle" size={20} color={C.danger}
            style={{ position: 'absolute', top: -6, right: -6 }}
            onPress={() => onRemove(a.id)}
            accessibilityLabel="Remove attachment"
          />
        </Animated.View>
      ))}
    </View>
  );
});

/**
 * An attached picture, which a tap opens across the whole screen; when its file is gone, a carved placeholder says so
 * instead of an empty box.
 */
function AttachedImage({ uri, width, onPress }: { uri: string; width: number; onPress: () => void }) {
  const [failed, setFailed] = React.useState(false);
  const box = { width, height: width * 0.75, borderRadius: 14 };
  if (failed) {
    return (
      <View
        style={[box, { backgroundColor: C.inset, alignItems: 'center', justifyContent: 'center', ...NEU.insetLow }]}
        accessible accessibilityLabel="This picture could not be found"
      >
        <Ionicons name="image-outline" size={22} color={C.textFaint} />
        <Text style={[T.caption, { marginTop: 4 }]}>Could not be found</Text>
      </View>
    );
  }
  return (
    <Bouncy onPress={onPress} scaleTo={0.98} radius={14} accessibilityRole="button" accessibilityLabel="Open the picture">
      <CachedImage source={{ uri }} style={box} contentFit="cover" cachePolicy="memory" transition={180} onError={() => setFailed(true)} />
    </Bouncy>
  );
}

/**
 * An attached video. Until it is tapped it is a carved well with its name and a play mark, and no player, so a note
 * with several clips keeps no decoders alive while it is written in. A tap makes the player and starts it.
 */
function AttachedVideo({ uri, name, width }: { uri: string; name: string; width: number }) {
  const [on, setOn] = React.useState(false);
  if (on) return <InlineVideo uri={uri} width={width} />;
  return (
    <Bouncy
      onPress={() => setOn(true)} scaleTo={0.98} radius={14} accessibilityRole="button" accessibilityLabel={'Play ' + name}
      style={[st.videoWell, { width, height: width * 0.62, backgroundColor: C.inset, ...NEU.insetLow }]}
    >
      <Ionicons name="play" size={22} color={C.accent} />
      <Text style={[T.caption, { marginTop: 6, maxWidth: width - 24 }]} numberOfLines={1}>{name}</Text>
    </Bouncy>
  );
}

function InlineVideo({ uri, width }: { uri: string; width: number }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = false; p.play(); });
  return (
    <VideoView
      player={player}
      style={{ width, height: width * 0.62, borderRadius: 14, backgroundColor: C.inset }}
      allowsFullscreen
      nativeControls
    />
  );
}

/** a tag as kept: one word or a few, no leading #, at most 30 characters */
const cleanTag = (raw: string) => raw.replace(/^#+/, '').replace(/\s+/g, ' ').trim().slice(0, 30);

/**
 * A note's subject and tags, in a sheet of their own so typing in it re-renders the sheet and not the note. The subject
 * offers the ones the app already knows (src/subjects.ts); a tag goes on with Enter and comes off with a tap. Both are
 * written as they change, without touching the note's edited time.
 */
function NoteMetaSheet({ visible, onClose, note }: { visible: boolean; onClose: () => void; note: Note }) {
  const updateNote = useStore((s) => s.updateNote);
  const [subject, setSubject] = useState(note.subject || '');
  const [tag, setTag] = useState('');
  React.useEffect(() => {
    if (!visible) return;
    setSubject(note.subject || '');
    setTag('');
  }, [visible]);
  const tags = note.tags || [];
  const saveSubject = (v: string) => {
    const name = v.replace(/\s+/g, ' ').trim();
    if (name === (note.subject || '')) return;
    updateNote(note.id, { subject: name || undefined }, { touch: false });
  };
  const addTag = () => {
    const t = cleanTag(tag);
    setTag('');
    if (!t || tags.some((x) => x.toLowerCase() === t.toLowerCase())) return;
    tick();
    updateNote(note.id, { tags: [...tags, t] }, { touch: false });
  };
  const close = () => {
    saveSubject(subject);
    const t = cleanTag(tag);
    if (t && !tags.some((x) => x.toLowerCase() === t.toLowerCase())) updateNote(note.id, { tags: [...tags, t] }, { touch: false });
    onClose();
  };
  return (
    <Sheet visible={visible} onClose={close} title="Subject and tags">
      <Field
        label="Subject" value={subject} onChangeText={setSubject} placeholder="Like Physics" maxLength={60}
        returnKeyType="done" onSubmitEditing={() => saveSubject(subject)} onBlur={() => saveSubject(subject)}
        style={{ marginBottom: 0 }}
      />
      <SubjectSuggest value={subject} max={6} onPick={(n) => { setSubject(n); saveSubject(n); }} style={{ marginTop: 10 }} />
      <Field
        label="Tags" value={tag} onChangeText={setTag} placeholder="Add a tag" maxLength={30} autoCapitalize="none"
        returnKeyType="done" submitBehavior="submit" onSubmitEditing={addTag} style={{ marginTop: 22, marginBottom: 0 }}
      />
      {tags.length ? (
        <View style={[st.meta, { marginTop: 12 }]}>
          {tags.map((t) => (
            <Chip
              key={t} small icon="close" label={'#' + t} accessibilityLabel={'Take off the tag ' + t}
              onPress={() => { tick(); updateNote(note.id, { tags: tags.filter((x) => x !== t) }, { touch: false }); }}
            />
          ))}
        </View>
      ) : (
        <Text style={[T.caption, { marginTop: 10 }]}>Tags help the search find the note.</Text>
      )}
      <PillButton label="Done" onPress={close} style={{ marginTop: 22 }} />
    </Sheet>
  );
}

const st = StyleSheet.create({
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: -4, marginBottom: 12 },

  // Source Serif's line box is tall (1.036 / -0.335 em): a 38 line keeps its ascenders clear on Android
  title: { color: C.text, fontFamily: F.head, fontSize: 30, lineHeight: 38, letterSpacing: TRACK.display, paddingVertical: 6 },
  // the face, size, line and tracking come from the Writing font (writingFace); these stand until it applies
  body: { color: C.text, fontFamily: F.reg, fontSize: 15, letterSpacing: TRACK.body, lineHeight: LINE_H, minHeight: 300, paddingTop: 4 },
  // only the upright faces ship, so Android would synthesise a slant: live text reads as faint instead
  liveInline: { color: C.textFaint, fontFamily: F.reg, fontSize: 15, letterSpacing: TRACK.body, lineHeight: LINE_H },
  // the count moves as the note is written, so its figures are the text face's tabular ones
  words: { marginBottom: 12, fontFamily: F.reg, fontVariant: ['tabular-nums'] },
  toolbar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 9,
    backgroundColor: C.card,
    borderTopWidth: 1.5, borderColor: C.lite,
    boxShadow: NEU.raisedMid.boxShadow,
    gap: 6,
  },
  micBtn: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
  },
  liveBar: {
    position: 'absolute', bottom: 66, left: 12, right: 12,
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.inset, ...neuInset('low'),
    borderRadius: 14,
    paddingHorizontal: 12, paddingVertical: 9,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.danger, marginRight: 10 },
  liveBarText: { color: C.textDim, fontFamily: F.sm, fontSize: 13, letterSpacing: TRACK.small, flex: 1 },
  pulseRing: {
    position: 'absolute', width: 44, height: 44, borderRadius: 22,
    borderWidth: 2, borderColor: C.danger,
  },
  fileRow: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1,
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
  },
  videoWell: { borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  viewerClose: { position: 'absolute', right: 12 },
});
