import React, { useMemo, useState } from 'react';
import { Alert, FlatList, Text, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useToolNav } from '../toolNav';
import { Ionicons } from '@expo/vector-icons';
import { C, F, MIN, S, T, TRACK, neuRaised } from '../theme';
import { useStore, Note } from '../store';
import {
  ScreenBG, Field, EmptyState, ListRow, ListSlice, Row, Chip, Sheet, PillButton, DotMenu, GateHeader, useTheme, useToolHeader,
  contextLine,
} from '../components/UI';
import { ARRIVE, Bouncy, EASE_OUT, Enter, FADE_IN, glide, useAnimLevel } from '../components/Motion';
import { tap } from '../haptics';
import { deleteAttachmentFiles } from '../attachments';
import { ToolGate } from '../components/LockGate';
import { fmtClockTime, todayKey, yesterdayKey } from '../utils';
import { useToday } from '../hooks/useNow';
import { useKeyboardOpen } from '../hooks/useKeyboard';

/**
 * Notes made here with New note that nobody has written in yet. The note's page takes one away again if it is still
 * blank when the page closes, so backing out never leaves an "Untitled" row behind.
 */
const freshNotes = new Set<string>();
/** True once, for a note New note made, the first time its page closes. */
export function takeFreshNote(id: string): boolean {
  return freshNotes.delete(id);
}

/** A second tap on a row or on New note while the first one's page is on its way is the same tap. */
const PUSH_GAP_MS = 600;

/**
 * Whether a sheet that has just opened has finished rising, so its field takes the keyboard then: a keyboard that
 * comes up while the panel is still moving resizes the window under it, and the panel jumps in mid-flight.
 */
export function useRisen(visible: boolean) {
  const level = useAnimLevel();
  const [risen, setRisen] = useState(false);
  React.useEffect(() => {
    if (!visible) { setRisen(false); return undefined; }
    const wait = level === 'full' ? ARRIVE.duration + 60 : level === 'some' ? FADE_IN.duration + 40 : 0;
    if (!wait) { setRisen(true); return undefined; }
    const t = setTimeout(() => setRisen(true), wait);
    return () => clearTimeout(t);
  }, [visible, level]);
  return risen;
}

/** When a note was last written to, for its row: the time today, "Yesterday", then the date, with the year when it is not this one. */
function rowWhen(updatedAt: number, today: string, hour24: boolean): string {
  const d = new Date(updatedAt);
  if (!updatedAt || isNaN(d.getTime())) return '';
  const key = todayKey(d);
  if (key === today) return fmtClockTime(d.getHours() * 60 + d.getMinutes(), hour24);
  if (key === yesterdayKey()) return 'Yesterday';
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-IN', opts);
}

/** Notes, behind the Notes lock when it is on. A single note locks from inside the note. */
export function NotesListScreen({ mode }: { mode: 'tab' | 'stack' }) {
  return (
    <ToolGate tool="notes" guard={mode === 'tab'} header={<GateHeader title="Notes" tab={mode === 'tab'} />}>
      <NotesList mode={mode} />
    </ToolGate>
  );
}

/** The last value that was not null, so a sheet or a menu keeps what it shows while it closes. */
function useHeld<T>(value: T | null): T | null {
  const held = React.useRef(value);
  if (value != null) held.current = value;
  return held.current;
}

/**
 * A folder's name: a new one, or a new name for one. It keeps its own draft, so typing re-renders the sheet and not
 * the list under it; `check` names what is wrong with a name ('' when it is fine). The field takes the keyboard once
 * the sheet has risen.
 */
export function FolderNameSheet({ visible, onClose, title, initial, label, check, onSave }: {
  visible: boolean; onClose: () => void; title: string; initial: string; label: string;
  check: (name: string) => string; onSave: (name: string) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [problem, setProblem] = useState('');
  const risen = useRisen(visible);
  React.useEffect(() => {
    if (!visible) return;
    setDraft(initial);
    setProblem('');
  }, [visible, initial]);
  const save = () => {
    const name = draft.trim();
    const wrong = check(name);
    if (wrong) { setProblem(wrong); return; }
    onSave(name);
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      {/* made again once the sheet has risen, and only then asks for the keyboard */}
      <Field
        key={risen ? 'risen' : 'rising'}
        value={draft} onChangeText={(v) => { setDraft(v); setProblem(''); }} placeholder="Folder name" autoFocus={risen} maxLength={40}
        onSubmitEditing={save}
      />
      {/* the caption token carries a colour of its own, so the danger ink goes after it */}
      {problem ? <Text style={{ ...T.caption, color: C.danger, marginTop: -8, marginBottom: 12 }}>{problem}</Text> : null}
      <PillButton label={label} onPress={save} />
    </Sheet>
  );
}

/** One note in the list, memoised: a change to one note re-renders its own row, not the screenful. */
const NoteRow = React.memo(function NoteRow({ note: n, first, last, dip, showFolder, today, hour24, onOpen, onMenu }: {
  note: Note; first: boolean; last: boolean; dip: SharedValue<number>;
  /** off while the list shows one folder, whose name every row would only repeat */
  showFolder: boolean;
  today: string; hour24: boolean;
  onOpen: (id: string) => void; onMenu: (n: Note) => void;
}) {
  const dipStyle = useAnimatedStyle(() => ({ opacity: dip.value }));
  const meta = [showFolder ? n.folder : '', n.subject ?? '', rowWhen(n.updatedAt, today, hour24)].filter(Boolean).join(' · ');
  return (
    <ListSlice first={first} last={last}>
      <Animated.View style={dipStyle}>
        <ListRow onPress={() => onOpen(n.id)} onLongPress={() => onMenu(n)} style={st.note}>
          <View style={{ flex: 1 }}>
            <Row>
              <Text style={st.noteTitle} numberOfLines={1}>{n.title || 'Untitled'}</Text>
              {n.pinned && <Ionicons name="pin" size={14} color={C.amber} style={{ marginLeft: 6 }} />}
              {n.locked && <Ionicons name="lock-closed" size={13} color={C.textFaint} style={{ marginLeft: 6 }} />}
            </Row>
            {/* two lines show, so a long pasted note never has its whole text laid out for them */}
            {!!n.body && !n.locked && <Text style={st.noteBody} numberOfLines={2}>{n.body.slice(0, 240)}</Text>}
            {meta ? <Text style={st.noteMeta} numberOfLines={1}>{meta}</Text> : null}
          </View>
        </ListRow>
      </Animated.View>
    </ListSlice>
  );
});

function NotesList({ mode }: { mode: 'tab' | 'stack' }) {
  const nav = useToolNav();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const level = useAnimLevel();
  const notes = useStore((s) => s.notes);
  const folders = useStore((s) => s.noteFolders);
  const addNote = useStore((s) => s.addNote);
  const addNoteFolder = useStore((s) => s.addNoteFolder);
  const updateNote = useStore((s) => s.updateNote);
  const deleteNote = useStore((s) => s.deleteNote);
  const renameNoteFolder = useStore((s) => s.renameNoteFolder);
  const deleteNoteFolder = useStore((s) => s.deleteNoteFolder);

  const [q, setQ] = useState('');
  const [folder, setFolder] = useState<string | null>(null);
  const [folderSheet, setFolderSheet] = useState(false);
  const [menuNote, setMenuNote] = useState<Note | null>(null);
  // hold a folder chip to rename or delete it; General always stays
  const [folderMenu, setFolderMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  // the menus and the rename sheet keep what they show while they close, instead of emptying on the way out
  const heldNote = useHeld(menuNote);
  const heldFolder = useHeld(folderMenu);
  const heldRenaming = useHeld(renaming);

  // typing stays immediate; the search over every note runs on the settled text
  const settledQ = React.useDeferredValue(q);
  // each note's words in lower case, kept until the note changes, so a search lowercases only what changed since the
  // last one and never every long pasted note again
  const lowered = React.useRef(new Map<string, { at: number; title: string; body: string }>());
  const filtered = useMemo(() => {
    const ql = settledQ.trim().toLowerCase();
    let index = lowered.current;
    if (ql) {
      const next = new Map<string, { at: number; title: string; body: string }>();
      for (const n of notes) {
        const old = index.get(n.id);
        next.set(n.id, old && old.at === n.updatedAt ? old : { at: n.updatedAt, title: n.title.toLowerCase(), body: n.body.toLowerCase() });
      }
      lowered.current = index = next;
    }
    return notes
      .filter((n) => (folder ? n.folder === folder : true))
      // a locked note is found by its title only: its text never surfaces outside the note
      .filter((n) => {
        if (!ql) return true;
        const l = index.get(n.id);
        return !!l && (l.title.includes(ql) || (!n.locked && l.body.includes(ql)));
      })
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
  }, [notes, settledQ, folder]);

  // a folder that is gone (a restored backup, an import) lets go of the filter, never leaving an empty list with no chip lit
  React.useEffect(() => {
    if (folder && !folders.includes(folder)) setFolder(null);
  }, [folder, folders]);

  // a pin, an unpin or a delete moves rows within the same list: they glide to their new places. A new search or
  // folder is a different list, so its rows are simply there (a glide would send every row sliding at once)
  const filterKey = (folder ?? '') + '|' + settledQ;
  const lastFilter = React.useRef(filterKey);
  const sameList = lastFilter.current === filterKey;
  React.useEffect(() => { lastFilter.current = filterKey; });
  // another folder's notes come up from a faint start, so the change reads as one step instead of a jump
  const dip = useSharedValue(1);
  const shownFolder = React.useRef(folder);
  React.useEffect(() => {
    if (shownFolder.current === folder) return;
    shownFolder.current = folder;
    if (level === 'none') return;
    dip.value = 0.3;
    dip.value = withTiming(1, { duration: level === 'full' ? 240 : 180, easing: EASE_OUT });
  }, [folder, level]);

  // one page per tap: a second tap within the gap (a double tap, or a tap while the page is still coming in) is ignored,
  // so it never stacks two copies of a note or makes two new ones
  const pushedAt = React.useRef(0);
  const once = React.useCallback((go: () => void) => {
    const t = Date.now();
    if (t - pushedAt.current < PUSH_GAP_MS) return;
    pushedAt.current = t;
    go();
  }, []);
  const newNote = () => once(() => {
    const id = addNote({ folder: folder || 'General' });
    // still blank when its page closes, it goes again
    freshNotes.add(id);
    nav.openNote(id);
  });
  // The header counts the notes in the folder you are in, or all of them, and not the search's matches: a line that
  // changed with every letter typed would only flicker. No notes, no line.
  const inFolder = useMemo(() => (folder ? notes.filter((n) => n.folder === folder).length : 0), [notes, folder]);
  const total = folder ? inFolder : notes.length;
  const tabMode = mode === 'tab';
  const header = useToolHeader({
    title: 'Notes',
    mode: tabMode ? 'tab' : 'page',
    context: contextLine(
      total > 0 && (folder
        ? [total + (total === 1 ? ' note in ' : ' notes in '), { em: folder }]
        : total + (total === 1 ? ' note' : ' notes')),
    ),
  });

  const openNote = React.useCallback((id: string) => once(() => nav.openNote(id)), [nav, once]);
  const openMenu = React.useCallback((n: Note) => { tap(); setMenuNote(n); }, []);

  // On a tab the bar lies over the top of the list, and Android brings a field it focuses into view against the list's
  // own edge, which is under the bar. A search field tapped while the list is partly scrolled is moved down to just
  // below the bar instead of staying half under it
  const listRef = React.useRef<FlatList<Note>>(null);
  const searchY = React.useRef(0);
  const onSearchFocus = () => {
    if (!tabMode) return;
    const want = Math.max(0, header.padTop + searchY.current - header.barH - 8);
    if (header.scrollY.value > want) listRef.current?.scrollToOffset({ offset: want, animated: level !== 'none' });
  };

  // the button steps aside while the keyboard is up, so it never sits over the results of a search
  const keyboardOpen = useKeyboardOpen();
  const fabOn = useSharedValue(1);
  React.useEffect(() => {
    const to = keyboardOpen ? 0 : 1;
    fabOn.value = level === 'none' ? to : withTiming(to, { duration: keyboardOpen ? 140 : 200, easing: EASE_OUT });
  }, [keyboardOpen, level]);
  const fabStyle = useAnimatedStyle(() => ({ opacity: fabOn.value }));
  const count = filtered.length;
  const today = useToday();
  const hour24 = useStore((s) => s.settings.hour24);
  const showFolder = !folder;
  const renderItem = React.useCallback(({ item, index }: { item: Note; index: number }) => (
    <NoteRow
      note={item} first={index === 0} last={index === count - 1}
      dip={dip} showFolder={showFolder} today={today} hour24={hour24} onOpen={openNote} onMenu={openMenu}
    />
  ), [count, showFolder, today, hour24, openNote, openMenu]);

  return (
    <ScreenBG guard={tabMode}>
      {header.bar}
      {/* the list rises as one surface, the header's hero, the search and the folders with its rows, on every visit:
          whatever rows are in the window then, however they got there */}
      <Enter index={0} style={{ flex: 1 }}>
        <Animated.FlatList
          ref={listRef}
          data={filtered}
          keyExtractor={(n) => n.id}
          renderItem={renderItem}
          itemLayoutAnimation={sameList ? glide(level) : undefined}
          // the header follows the list's offset, on the UI thread
          {...header.scrollProps}
          contentContainerStyle={{ padding: S.pad, paddingTop: header.padTop, paddingBottom: 110 + (tabMode ? 0 : insets.bottom) }}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={10}
          windowSize={9}
          ListHeaderComponent={
            <>
              {header.hero}
              <View onLayout={(e) => { searchY.current = e.nativeEvent.layout.y; }}>
                <Field value={q} onChangeText={setQ} placeholder="Search notes" onFocus={onSearchFocus} />
              </View>
              {/* the scroller runs to the screen edges, so chip shadows are never clipped at its bounds */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ marginBottom: 2, marginHorizontal: -S.pad }}
                contentContainerStyle={{ paddingVertical: 10, paddingHorizontal: S.pad }}
              >
                <Chip label="All" active={!folder} onPress={() => setFolder(null)} />
                {folders.map((f) => (
                  <Chip
                    key={f} label={f} active={folder === f} onPress={() => setFolder(f)}
                    onLongPress={f === 'General' ? undefined : () => setFolderMenu(f)}
                  />
                ))}
                <Chip icon="add" label="Folder" onPress={() => setFolderSheet(true)} />
              </ScrollView>
            </>
          }
          ListEmptyComponent={
            settledQ.trim() ? (
              // a search that finds nothing says so, instead of offering a new note as if the folder were empty
              <EmptyState icon="search-outline" title="No notes match that search" body="Search looks through titles, and through the text of notes that are not locked." />
            ) : (
              <EmptyState icon="document-text-outline" title="No notes here yet" body="Photos, files, voice and checklists live inside a note." actionLabel="New note" onAction={newNote} />
            )
          }
        />
      </Enter>

      <Animated.View
        pointerEvents={keyboardOpen ? 'none' : 'box-none'}
        importantForAccessibility={keyboardOpen ? 'no-hide-descendants' : 'auto'}
        accessibilityElementsHidden={keyboardOpen}
        style={[st.fabSpot, { bottom: tabMode ? 24 : insets.bottom + 20 }, fabStyle]}
      >
        <Bouncy
          radius={999}
          scaleTo={0.9}
          style={[
            st.fab,
            theme === 'minimal'
              ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: C.green }
              : { backgroundColor: C.card, ...neuRaised('high') },
          ]}
          onPress={() => { tap(); newNote(); }}
          accessibilityRole="button"
          accessibilityLabel="New note"
        >
          <Ionicons name="add" size={30} color={C.green} />
        </Bouncy>
      </Animated.View>

      <DotMenu
        visible={!!menuNote}
        onClose={() => setMenuNote(null)}
        items={heldNote ? [
          {
            label: heldNote.pinned ? 'Unpin' : 'Pin to top',
            icon: heldNote.pinned ? 'pin' : 'pin-outline',
            onPress: () => updateNote(heldNote.id, { pinned: !heldNote.pinned }),
          },
          {
            label: 'Delete note',
            icon: 'trash-outline',
            color: C.danger,
            onPress: () =>
              Alert.alert('Delete note', 'This cannot be undone.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => deleteAttachmentFiles(deleteNote(heldNote.id)) },
              ]),
          },
        ] : []}
      />

      <DotMenu
        visible={!!folderMenu}
        onClose={() => setFolderMenu(null)}
        items={heldFolder ? [
          { label: 'Rename', icon: 'create-outline', onPress: () => setRenaming(heldFolder) },
          {
            label: 'Delete folder',
            icon: 'trash-outline',
            color: C.danger,
            onPress: () => {
              const name = heldFolder;
              const inside = useStore.getState().notes.filter((n) => n.folder === name).length;
              const go = () => { deleteNoteFolder(name); if (folder === name) setFolder(null); };
              if (!inside) { go(); return; }
              Alert.alert(
                'Delete ' + name + '?',
                (inside === 1 ? 'Its note moves' : 'Its ' + inside + ' notes move') + ' to General. No note is deleted.',
                [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete folder', style: 'destructive', onPress: go }],
              );
            },
          },
        ] : []}
      />

      <FolderNameSheet
        visible={!!renaming}
        onClose={() => setRenaming(null)}
        title={'Rename ' + (heldRenaming || 'folder')}
        initial={heldRenaming || ''}
        label="Save"
        check={(next) => (!next ? 'Give the folder a name.'
          : next !== renaming && folders.includes(next) ? 'There is already a folder with that name.' : '')}
        onSave={(next) => {
          if (!renaming) return;
          renameNoteFolder(renaming, next);
          if (folder === renaming) setFolder(next);
          setRenaming(null);
        }}
      />

      <FolderNameSheet
        visible={folderSheet}
        onClose={() => setFolderSheet(false)}
        title="New folder"
        initial=""
        label="Create"
        check={(name) => (!name ? 'Give the folder a name.' : folders.includes(name) ? 'There is already a folder with that name.' : '')}
        onSave={(name) => { addNoteFolder(name); setFolderSheet(false); }}
      />
    </ScreenBG>
  );
}

const st = StyleSheet.create({
  /** where the new-note button sits; it fades here while the keyboard is up */
  fabSpot: { position: 'absolute', right: 20 },
  fab: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  note: { alignItems: 'flex-start', paddingVertical: 14 },
  noteTitle: { flex: 1, color: C.text, fontFamily: F.semi, fontSize: 16, letterSpacing: TRACK.title },
  noteBody: { color: C.textDim, fontFamily: F.reg, fontSize: 13, letterSpacing: TRACK.small, lineHeight: 18, marginTop: 4 },
  noteMeta: { color: C.textFaint, fontFamily: F.reg, fontSize: 11, letterSpacing: TRACK.fine, marginTop: 6 },
});
