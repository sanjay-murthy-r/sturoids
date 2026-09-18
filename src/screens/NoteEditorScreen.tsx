import React, { useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TextInput, Alert, Share, Image, useWindowDimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useAnimatedStyle, useSharedValue, withRepeat, withSpring, withTiming, Easing, cancelAnimation,
} from 'react-native-reanimated';
import * as ImagePicker from 'expo-image-picker';
import { Image as CachedImage } from 'expo-image';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useVideoPlayer, VideoView } from 'expo-video';
import { C, F, MIN, S, T, neuInset, neuPressedInner, neuRaised, NEU } from '../theme';
import { useStore, Attachment } from '../store';
import { todayKey, uid } from '../utils';
import { ScreenBG, Sheet, Chip, Row, IconBtn, NeuHeader, NeuIconBtn, PillButton, DotMenu, useTheme } from '../components/UI';
import { toast } from '../components/Toast';
import { LockGate, PinSheet } from '../components/LockGate';
import { lockProtectionAvailable, markUnlocked, useUnlocked } from '../lock';
import { Bouncy } from '../components/Motion';
import { voiceAvailable, startVoice, VoiceSession } from '../voice';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ATT_DIR, deleteAttachmentFiles } from '../attachments';

const LINE_H = 24;
const FREE_LINES = 9; // keep ~8-10 lines of breathing room while dictating

async function persistFile(uri: string, name: string): Promise<string> {
  try {
    await FileSystem.makeDirectoryAsync(ATT_DIR, { intermediates: true }).catch(() => {});
    const dest = ATT_DIR + uid() + '-' + name.replace(/[^\w.\-]/g, '_');
    await FileSystem.copyAsync({ from: uri, to: dest });
    return dest;
  } catch {
    return uri;
  }
}

/** Raised mic button — carves in while listening and breathes a pulse ring. */
function MicButton({ listening, onPress }: { listening: boolean; onPress: () => void }) {
  const theme = useTheme();
  const scale = useSharedValue(1);
  const pulse = useSharedValue(0);

  React.useEffect(() => {
    if (listening) {
      scale.value = withSpring(1.06, { damping: 14, stiffness: 220 });
      pulse.value = 0;
      pulse.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.out(Easing.quad) }), -1, false);
    } else {
      cancelAnimation(pulse);
      pulse.value = withTiming(0, { duration: 150 });
      scale.value = withSpring(1, { damping: 16, stiffness: 240 });
    }
  }, [listening]);

  const micStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: listening ? (1 - pulse.value) * 0.5 : 0,
    transform: [{ scale: 1 + pulse.value * 0.7 }],
  }));

  return (
    <Animated.View style={micStyle}>
      <Bouncy
        onPress={onPress}
        scaleTo={0.9}
        radius={22}
        hitSlop={6}
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

export function NoteEditorScreen({ mode }: { mode: 'tab' | 'stack' }) {
  const insets = useSafeAreaInsets();
  const unlocked = useUnlocked();
  const [lockPin, setLockPin] = useState(false);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const note = useStore((s) => s.notes.find((n) => n.id === id));
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
  const selRef = useRef({ start: 0, end: 0 });
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const lastPush = useRef(0);
  const scrollRef = useRef<ScrollView>(null);
  const sizesRef = useRef({ content: 0, viewport: 0 });
  const [toolMenu, setToolMenu] = useState(false);

  // a dictation still running when the note closes is stopped, never left listening
  React.useEffect(() => () => { voiceRef.current?.stop(); }, []);

  const lines = useMemo(
    () => (note?.body || '').split('\n').map((l) => l.trim()).filter((l) => l.length > 2),
    [note?.body]
  );

  if (!note) {
    return (
      <ScreenBG>
        <NeuHeader title="Note" />
        <Text style={{ color: C.textDim, textAlign: 'center', marginTop: 60 }}>Note not found.</Text>
      </ScreenBG>
    );
  }

  /**
   * The live body, straight from the store. Voice callbacks are registered
   * ONCE per recording session, so any `note.body` they close over is frozen
   * at record-start — every later utterance would rebuild the note from that
   * stale baseline and erase what came in between (the dictation-erases-text
   * bug). Everything that mutates the body must read through here instead.
   */
  const liveBody = () => useStore.getState().notes.find((n) => n.id === id)?.body ?? '';

  const setBody = (v: string, pushHistory = true) => {
    if (pushHistory && Date.now() - lastPush.current > 800) {
      undoStack.current.push(liveBody());
      if (undoStack.current.length > 60) undoStack.current.shift();
      redoStack.current = [];
      lastPush.current = Date.now();
    }
    updateNote(note.id, { body: v });
  };

  const undo = () => {
    const prev = undoStack.current.pop();
    if (prev === undefined) return;
    redoStack.current.push(liveBody());
    updateNote(note.id, { body: prev });
  };
  const redo = () => {
    const next = redoStack.current.pop();
    if (next === undefined) return;
    undoStack.current.push(liveBody());
    updateNote(note.id, { body: next });
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
    if (session) { voiceRef.current = session; setListening(true); }
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
      for (const a of res.assets) {
        const name = a.fileName || (a.type === 'video' ? 'video.mp4' : 'image.jpg');
        const stored = await persistFile(a.uri, name);
        addAttachment(note.id, { kind: a.type === 'video' ? 'video' : 'image', uri: stored, name });
      }
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
      addAttachment(note.id, { kind: 'file', uri: stored, name: f.name || 'file' });
    } catch (e: any) {
      toast('Could not attach that file.');
    }
  };

  const openFile = async (a: Attachment) => {
    try {
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(a.uri);
    } catch {
      toast('Could not open ' + a.name);
    }
  };

  const promote = (line: string, kind: 'daily' | 'mission') => {
    if (kind === 'daily') addDaily(line);
    else addMission(line, todayKey());
    setLineSheet(false);
  };

  if (note.locked && !unlocked) {
    return (
      <ScreenBG>
        <NeuHeader title={note.folder} />
        <LockGate locked title="This note is locked"><View /></LockGate>
      </ScreenBG>
    );
  }

  const toggleLock = async () => {
    // an open note means the session is unlocked, so the lock can come off without asking again
    if (note.locked) { updateNote(note.id, { locked: false }); return; }
    if (await lockProtectionAvailable()) updateNote(note.id, { locked: true });
    else setLockPin(true);
  };

  const words = note.body.trim() ? note.body.trim().split(/\s+/).length : 0;
  // under 372dp the nine toolbar targets overflow: media, file, undo and redo move into a menu
  const narrow = width < 372;
  const mediaW = (width - S.pad * 2 - 10) / 2;

  return (
    <ScreenBG>
      <NeuHeader
        title={note.folder}
        right={
          <Row>
            <IconBtn name={note.locked ? 'lock-closed' : 'lock-open-outline'} size={20} pad={6} color={note.locked ? C.gold : C.textDim}
              onPress={toggleLock} />
            <IconBtn name={note.pinned ? 'pin' : 'pin-outline'} size={20} pad={6} color={note.pinned ? C.gold : C.textDim}
              onPress={() => updateNote(note.id, { pinned: !note.pinned })} />
            <IconBtn name="folder-outline" size={20} pad={6} onPress={() => setFolderSheet(true)} />
            {!note.locked && (
              <IconBtn name="share-outline" size={20} pad={6} onPress={() => Share.share({ message: note.title + '\n\n' + note.body })} />
            )}
            <IconBtn name="trash-outline" size={20} pad={6} color={C.danger}
              onPress={() =>
                Alert.alert('Delete note', 'This cannot be undone.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: () => { deleteAttachmentFiles(deleteNote(note.id)); router.back(); } },
                ])
              } />
          </Row>
        }
      />
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ padding: S.pad, paddingBottom: 170 + (mode === 'tab' ? 0 : insets.bottom) }}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={(w, h) => { sizesRef.current.content = h; if (listening) autoScroll(); }}
        onLayout={(e) => { sizesRef.current.viewport = e.nativeEvent.layout.height; }}
      >
        <TextInput
          value={note.title}
          onChangeText={(v) => updateNote(note.id, { title: v })}
          placeholder="Title"
          placeholderTextColor={C.textFaint}
          style={st.title}
        />
        <Text style={[T.caption, { marginBottom: 12 }]}>
          {new Date(note.updatedAt).toLocaleString('en-IN')} · {words} words
        </Text>

        {note.attachments.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
            {note.attachments.map((a) => (
              <View key={a.id}>
                {a.kind === 'image' && (
                  <CachedImage source={{ uri: a.uri }} style={{ width: mediaW, height: mediaW * 0.75, borderRadius: 14 }} contentFit="cover" cachePolicy="memory" transition={180} />
                )}
                {a.kind === 'video' && <InlineVideo uri={a.uri} width={mediaW} />}
                {a.kind === 'file' && (
                  <Bouncy onPress={() => openFile(a)} style={[st.fileRow, { borderColor: C.accent + '44', backgroundColor: C.accent + '18' }]}>
                    <Ionicons name="document-attach-outline" size={18} color={C.accent} />
                    <Text style={{ color: C.accent, fontFamily: F.med, marginLeft: 8, fontSize: 13, maxWidth: mediaW * 1.6 }} numberOfLines={1}>
                      {a.name}
                    </Text>
                  </Bouncy>
                )}
                <IconBtn
                  name="close-circle" size={20} color={C.danger}
                  style={{ position: 'absolute', top: -6, right: -6 }}
                  onPress={() => deleteAttachmentFiles(removeAttachment(note.id, a.id))}
                />
              </View>
            ))}
          </View>
        )}

        <TextInput
          value={note.body}
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
      </ScrollView>

      {/* live transcript strip */}
      {listening && (
        <View style={[st.liveBar, { bottom: 66 + (mode === 'tab' ? 0 : insets.bottom) }, theme === 'minimal' && { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border, boxShadow: undefined }]}>
          <View style={st.liveDot} />
          <Text style={st.liveBarText} numberOfLines={2}>
            {liveText || 'Listening…'}
          </Text>
        </View>
      )}

      {/* editor toolbar */}
      <View style={[st.toolbar, { paddingBottom: 9 + (mode === 'tab' ? 0 : insets.bottom) }, theme === 'minimal' && { backgroundColor: MIN.card, borderColor: MIN.border, boxShadow: undefined }]}>
        <MicButton listening={listening} onPress={toggleVoice} />
        <IconBtn name="ellipse-outline" size={20} pad={6} onPress={() => prefixLine('•  ')} />
        <IconBtn name="checkbox-outline" size={20} pad={6} onPress={() => prefixLine('☐  ')} />
        <IconBtn name="checkmark-done-outline" size={20} pad={6} onPress={() => setLineSheet(true)} />
        <View style={{ flex: 1 }} />
        {narrow ? (
          <NeuIconBtn name="ellipsis-horizontal" dim={40} size={19} color={C.textDim} onPress={() => setToolMenu(true)} />
        ) : (
          <>
            <NeuIconBtn name="image-outline" dim={40} size={19} color={C.accent} onPress={pickMedia} />
            <NeuIconBtn name="attach-outline" dim={40} size={19} color={C.accent} onPress={pickFile} />
            <IconBtn name="arrow-undo-outline" size={20} pad={6} onPress={undo} />
            <IconBtn name="arrow-redo-outline" size={20} pad={6} onPress={redo} />
          </>
        )}
      </View>

      <Sheet visible={lineSheet} onClose={() => setLineSheet(false)} title="Promote a line to a task">
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
        onClose={() => setLockPin(false)}
        onDone={() => { setLockPin(false); updateNote(note.id, { locked: true }); markUnlocked(); }}
      />
    </ScreenBG>
  );
}

function InlineVideo({ uri, width }: { uri: string; width: number }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = false; });
  return (
    <VideoView
      player={player}
      style={{ width, height: width * 0.62, borderRadius: 14, backgroundColor: '#000' }}
      allowsFullscreen
      nativeControls
    />
  );
}

const st = StyleSheet.create({
  title: { color: C.text, fontFamily: F.bold, fontSize: 30, letterSpacing: -0.5, paddingVertical: 6 },
  body: { color: C.text, fontFamily: F.reg, fontSize: 15, lineHeight: LINE_H, minHeight: 300, paddingTop: 4 },
  // Rubik ships no italic, so Android would synthesise a slant: live text reads as faint instead
  liveInline: { color: C.textFaint, fontFamily: F.reg, fontSize: 15, lineHeight: LINE_H },
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
  liveBarText: { color: C.textDim, fontFamily: F.reg, fontSize: 13, flex: 1 },
  pulseRing: {
    position: 'absolute', width: 44, height: 44, borderRadius: 22,
    borderWidth: 2, borderColor: C.danger,
  },
  fileRow: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1,
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
  },
});
