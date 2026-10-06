import React, { useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, Alert, Share, Keyboard, AppState, useWindowDimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useAnimatedStyle, useSharedValue, withRepeat, withSpring, withTiming, Easing, cancelAnimation, FadeIn, FadeOut,
} from 'react-native-reanimated';
import * as ImagePicker from 'expo-image-picker';
import { Image as CachedImage } from 'expo-image';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useVideoPlayer, VideoView } from 'expo-video';
import { C, F, MIN, S, T, TRACK, neuInset, neuPressedInner, neuRaised, NEU } from '../theme';
import { columnWidth } from '../layout';
import { useStore, Attachment, Note, flushSaves } from '../store';
import { fmtClockTime, todayKey, uid, yesterdayKey } from '../utils';
import { ScreenBG, Sheet, Chip, Row, IconBtn, NeuIconBtn, PillButton, DotMenu, GateHeader, useTheme, useToolHeader } from '../components/UI';
import { toast } from '../components/Toast';
import { NoteGate, PinSheet, ToolGate } from '../components/LockGate';
import { markOpen, noteScope, pinStatus } from '../lock';
import { Bouncy, EASE_OUT, glide, rowIn, rowOut, useAnimLevel, useBuilt } from '../components/Motion';
import { voiceAvailable, startVoice, VoiceSession } from '../voice';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ATT_DIR, deleteAttachmentFiles } from '../attachments';
import { useToday } from '../hooks/useNow';
import { useKeyboardOpen } from '../hooks/useKeyboard';

const LINE_H = 24;
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

/**
 * Copies a picked file into the app's own attachments folder, where Android never clears it. When the copy fails (a
 * full phone, usually) the note keeps the picker's copy for now and `kept` is false, so the user is told to re-attach
 * it once there is room: the picker's copy lives in a cache Android may clear.
 */
async function persistFile(uri: string, name: string): Promise<{ uri: string; kept: boolean }> {
  try {
    await FileSystem.makeDirectoryAsync(ATT_DIR, { intermediates: true }).catch(() => {});
    const dest = ATT_DIR + uid() + '-' + name.replace(/[^\w.\-]/g, '_');
    await FileSystem.copyAsync({ from: uri, to: dest });
    return { uri: dest, kept: true };
  } catch {
    return { uri, kept: false };
  }
}
const NOT_KEPT = 'Attached, but the phone is too full to keep a copy. Free some space and attach it again.';

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
    if (listening) {
      scale.value = withSpring(1.06, { damping: 14, stiffness: 220 });
      pulse.value = 0;
      if (level === 'full') {
        pulse.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.out(Easing.quad) }), -1, false);
      }
    } else {
      pulse.value = withTiming(0, { duration: 150 });
      scale.value = withSpring(1, { damping: 16, stiffness: 240 });
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
  const deleteNote = useStore((s) => s.deleteNote);
  const folders = useStore((s) => s.noteFolders);
  const addDaily = useStore((s) => s.addDaily);
  const addMission = useStore((s) => s.addMission);
  const addAttachment = useStore((s) => s.addAttachment);
  const removeAttachment = useStore((s) => s.removeAttachment);

  const [lineSheet, setLineSheet] = useState(false);
  const [folderSheet, setFolderSheet] = useState(false);
  const [listening, setListening] = useState(false);
  const [liveText, setLiveText] = useState('');
  const voiceRef = useRef<VoiceSession | null>(null);
  /** set from the first tap until dictation has started, so a second quick tap never starts it twice */
  const voiceStarting = useRef(false);
  const alive = useRef(true);
  const selRef = useRef({ start: 0, end: 0 });
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const lastPush = useRef(0);
  const scrollRef = useRef<Animated.ScrollView>(null);
  const sizesRef = useRef({ content: 0, viewport: 0 });
  const [toolMenu, setToolMenu] = useState(false);
  // the toast waits for the sheet to go: a sheet is a window of its own and would cover it. A hook, so it sits above the
  // "Note not found" return: a note that vanishes from the store (a restored backup) must not change the hook count
  const promoted = React.useRef<{ kind: 'daily' | 'mission'; id: string } | null>(null);

  // a dictation still running when the note closes is stopped, never left listening
  React.useEffect(() => () => {
    alive.current = false;
    voiceRef.current?.stop();
  }, []);

  // ---- the draft: what is typed shows at once, and reaches the store after a pause ----
  const [title, setTitle] = useState(stored?.title ?? '');
  const [body, setBodyText] = useState(stored?.body ?? '');
  const draft = useRef({ title: stored?.title ?? '', body: stored?.body ?? '' });
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commit = React.useCallback(() => {
    if (commitTimer.current) { clearTimeout(commitTimer.current); commitTimer.current = null; }
    const s = useStore.getState();
    const n = s.notes.find((x) => x.id === id);
    if (!n) return;
    const d = draft.current;
    if (n.title !== d.title || n.body !== d.body) s.updateNote(n.id, { title: d.title, body: d.body });
  }, [id]);
  const scheduleCommit = React.useCallback(() => {
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(commit, COMMIT_PAUSE_MS);
  }, [commit]);
  // the draft follows the stored note whenever nothing typed is waiting to be committed: a note that turns up after
  // the page was built (the store still loading), and a note changed from outside while it sits open (a restored
  // backup), so a later keystroke never writes the old text back over it
  React.useEffect(() => {
    if (!stored || commitTimer.current) return;
    if (draft.current.title === stored.title && draft.current.body === stored.body) return;
    draft.current = { title: stored.title, body: stored.body };
    setTitle(stored.title);
    setBodyText(stored.body);
  }, [stored?.id, stored?.title, stored?.body]);
  // closing the note writes what is waiting, and so does leaving the app, straight through to storage
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') { commit(); flushSaves(); }
    });
    // closing the note (not just backgrounding) must also flush past the save debounce, or a quick
    // back-then-kill can lose the last edit before the store's own pause finishes writing it out
    return () => { sub.remove(); commit(); flushSaves(); };
  }, [commit]);

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
  const removeOne = React.useCallback(
    (attId: string) => deleteAttachmentFiles(removeAttachment(noteId, attId)),
    [noteId, removeAttachment],
  );

  const toggleLock = async () => {
    if (!note) return;
    Keyboard.dismiss();
    // the note is open, so its PIN has been given (or it was never locked): the lock comes off without asking again
    if (note.locked) {
      updateNote(note.id, { locked: false });
      toast('The note is no longer locked.');
      return;
    }
    if ((await pinStatus()) === 'set') {
      updateNote(note.id, { locked: true });
      markOpen(noteScope(note.id));
      toast('Note locked. Your PIN opens it.');
      return;
    }
    // no PIN on this phone yet, or only an older code: one is chosen first, then the note locks
    setLockPin(true);
  };

  const deleteThis = () => {
    if (!note) return;
    // the page keeps showing the note while it leaves; what was typed is dropped with it
    leaving.current = true;
    if (commitTimer.current) { clearTimeout(commitTimer.current); commitTimer.current = null; }
    router.back();
    deleteAttachmentFiles(deleteNote(note.id));
  };

  // The header: the folder is the bar's title, and the line under it says when the note was last written to. That line
  // reads at rest: with the keyboard up the note is being typed in, and a time ticking over under the title would only
  // draw the eye. The lock stays in the bar, where its state shows; the rest are in the menu beside it.
  const hour24 = useStore((s) => s.settings.hour24);
  const today = useToday();
  const keyboardOpen = useKeyboardOpen();
  const edited = note ? editedLine(note.updatedAt, today, hour24) : '';
  const [editedHeld, setEditedHeld] = useState(edited);
  React.useEffect(() => { if (!keyboardOpen) setEditedHeld(edited); }, [keyboardOpen, edited]);
  const header = useToolHeader({
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
        onPress: () => updateNote(note.id, { pinned: !note.pinned }),
      },
      { icon: 'folder-outline', label: 'Move to folder', onPress: () => setFolderSheet(true) },
      ...(note.locked ? [] : [{ icon: 'share-outline' as const, label: 'Share note', onPress: () => { Share.share({ message: title + '\n\n' + body }); } }]),
      {
        icon: 'trash-outline', label: 'Delete note', color: C.danger,
        onPress: () => Alert.alert('Delete note', 'This cannot be undone.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: deleteThis },
        ]),
      },
    ] : undefined,
  });

  if (!note) {
    return (
      <ScreenBG>
        {header.bar}
        <Text style={{ color: C.textDim, textAlign: 'center', marginTop: 60 }}>Note not found.</Text>
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

  const insertAtCursor = (text: string) => {
    const b = liveBody();
    // clamp — the tracked selection may predate external inserts (dictation)
    const start = Math.min(selRef.current.start, b.length);
    const end = Math.min(Math.max(selRef.current.end, start), b.length);
    setBody(b.slice(0, start) + text + b.slice(end));
    const pos = start + text.length;
    selRef.current = { start: pos, end: pos };
  };

  const prefixLine = (prefix: string) => {
    const b = liveBody();
    const start = Math.min(selRef.current.start, b.length);
    const lineStart = b.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
    setBody(b.slice(0, lineStart) + prefix + b.slice(lineStart));
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
          const b = liveBody(); // NOT the closed-over note.body — see liveBody()
          insertAtCursor((b && !b.endsWith(' ') && !b.endsWith('\n') ? ' ' : '') + finalText);
          setTimeout(autoScroll, 60);
        },
        (interim) => setLiveText(interim),
        () => { setListening(false); setLiveText(''); },
        (msg) => { setListening(false); setLiveText(''); Alert.alert('Voice input', msg); }
      );
      if (!session) return;
      // the note closed while the microphone was being set up: stop at once instead of listening unseen
      if (!alive.current) { session.stop(); return; }
      voiceRef.current = session;
      setListening(true);
    } finally {
      voiceStarting.current = false;
    }
  };

  const pickMedia = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        quality: 0.85,
        allowsMultipleSelection: true,
        selectionLimit: 5,
      });
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
      toast('Could not attach that file.');
    }
  };

  const pickFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      const f = res.assets[0];
      const stored = await persistFile(f.uri, f.name || 'file');
      addAttachment(note.id, { kind: 'file', uri: stored.uri, name: f.name || 'file' });
      if (!stored.kept) toast(NOT_KEPT);
    } catch (e: any) {
      toast('Could not attach that file.');
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
  // under 372dp the nine toolbar targets overflow: media, file, undo and redo move into a menu
  const narrow = colW < 372;
  const mediaW = (colW - S.pad * 2 - 10) / 2;

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
        {header.hero}
        <TextInput
          value={title}
          onChangeText={(v) => { draft.current.title = v; setTitle(v); scheduleCommit(); }}
          placeholder="Title"
          placeholderTextColor={C.textFaint}
          style={st.title}
        />
        {/* the date is the header's now; the count keeps its line when there are no words, so the first one typed
            does not push the page down */}
        <Text style={[T.caption, { marginBottom: 12 }]}>
          {words ? words + (words === 1 ? ' word' : ' words') : ' '}
        </Text>

        {note.attachments.length > 0 && (
          <Attachments items={note.attachments} width={mediaW} onRemove={removeOne} live={built.current} />
        )}

        <TextInput
          value={body}
          onChangeText={(v) => setBody(v)}
          onSelectionChange={(e) => { selRef.current = e.nativeEvent.selection; }}
          placeholder="Write…"
          placeholderTextColor={C.textFaint}
          selectionColor={C.accent}
          multiline
          textAlignVertical="top"
          style={st.body}
        />
        {listening && (
          <Text style={st.liveInline}>
            {liveText || '…'}
          </Text>
        )}
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
        <IconBtn name="ellipse-outline" size={20} pad={6} onPress={() => prefixLine('•  ')} accessibilityLabel="Bullet" />
        <IconBtn name="checkbox-outline" size={20} pad={6} onPress={() => prefixLine('☐  ')} accessibilityLabel="Checkbox" />
        <IconBtn name="checkmark-done-outline" size={20} pad={6} onPress={() => setLineSheet(true)} accessibilityLabel="Promote a line to a task" />
        <View style={{ flex: 1 }} />
        {narrow ? (
          <NeuIconBtn name="ellipsis-horizontal" dim={40} size={19} color={C.textDim} onPress={() => setToolMenu(true)} accessibilityLabel="More tools" />
        ) : (
          <>
            <NeuIconBtn name="image-outline" dim={40} size={19} color={C.accent} onPress={pickMedia} accessibilityLabel="Add a photo or video" />
            <NeuIconBtn name="attach-outline" dim={40} size={19} color={C.accent} onPress={pickFile} accessibilityLabel="Attach a file" />
            <IconBtn name="arrow-undo-outline" size={20} pad={6} onPress={undo} accessibilityLabel="Undo" />
            <IconBtn name="arrow-redo-outline" size={20} pad={6} onPress={redo} accessibilityLabel="Redo" />
          </>
        )}
      </View>

      <Sheet visible={lineSheet} onClose={() => setLineSheet(false)} onClosed={promotedToast} title="Promote a line to a task">
        {lines.length === 0 ? (
          <Text style={{ color: C.textFaint }}>Write a few lines first.</Text>
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

      <Sheet visible={folderSheet} onClose={() => setFolderSheet(false)} title="Move to folder">
        <Row style={{ flexWrap: 'wrap' }}>
          {folders.map((f) => (
            <Chip key={f} label={f} active={note.folder === f}
              onPress={() => { updateNote(note.id, { folder: f }); setFolderSheet(false); }} />
          ))}
        </Row>
      </Sheet>
      <DotMenu
        visible={toolMenu}
        onClose={() => setToolMenu(false)}
        items={[
          { label: 'Add a photo or video', icon: 'image-outline', onPress: pickMedia },
          { label: 'Attach a file', icon: 'attach-outline', onPress: pickFile },
          { label: 'Undo', icon: 'arrow-undo-outline', onPress: undo },
          { label: 'Redo', icon: 'arrow-redo-outline', onPress: redo },
        ]}
      />

      <PinSheet
        visible={lockPin}
        mode="set"
        tint={C.green}
        onClose={() => setLockPin(false)}
        onDone={() => {
          setLockPin(false);
          updateNote(note.id, { locked: true });
          markOpen(noteScope(note.id));
          toast('Note locked. Your PIN opens it.');
        }}
      />
    </ScreenBG>
  );
}

async function openFile(a: Attachment) {
  try {
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(a.uri);
  } catch {
    toast('Could not open ' + a.name);
  }
}

/**
 * The note's pictures, videos and files. Kept apart from the editor so a keystroke never re-renders a video; one added
 * later fades in where it lands, one removed fades as it goes, and the rest glide to their places.
 */
const Attachments = React.memo(function Attachments({ items, width, onRemove, live }: {
  items: Attachment[]; width: number; onRemove: (id: string) => void;
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
            <AttachedImage uri={a.uri} width={width} />
          )}
          {a.kind === 'video' && <InlineVideo uri={a.uri} width={width} />}
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

/** An attached picture; when its file is gone, a carved placeholder says so instead of an empty box. */
function AttachedImage({ uri, width }: { uri: string; width: number }) {
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
  return <CachedImage source={{ uri }} style={box} contentFit="cover" cachePolicy="memory" transition={180} onError={() => setFailed(true)} />;
}

function InlineVideo({ uri, width }: { uri: string; width: number }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = false; });
  return (
    <VideoView
      player={player}
      style={{ width, height: width * 0.62, borderRadius: 14, backgroundColor: C.inset }}
      allowsFullscreen
      nativeControls
    />
  );
}

const st = StyleSheet.create({
  title: { color: C.text, fontFamily: F.head, fontSize: 30, lineHeight: 36, letterSpacing: TRACK.display, paddingVertical: 6 },
  body: { color: C.text, fontFamily: F.reg, fontSize: 15, letterSpacing: TRACK.body, lineHeight: LINE_H, minHeight: 300, paddingTop: 4 },
  // only the upright Geist ships, so Android would synthesise a slant: live text reads as faint instead
  liveInline: { color: C.textFaint, fontFamily: F.reg, fontSize: 15, letterSpacing: TRACK.body, lineHeight: LINE_H },
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
  liveBarText: { color: C.textDim, fontFamily: F.reg, fontSize: 13, letterSpacing: TRACK.small, flex: 1 },
  pulseRing: {
    position: 'absolute', width: 44, height: 44, borderRadius: 22,
    borderWidth: 2, borderColor: C.danger,
  },
  fileRow: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1,
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
  },
});
