import React, { useMemo, useState } from 'react';
import { Alert, Text, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useToolNav } from '../toolNav';
import { Ionicons } from '@expo/vector-icons';
import { C, F, MIN, S, T, TRACK, neuRaised } from '../theme';
import { useStore, Note } from '../store';
import { ScreenBG, Field, EmptyState, ListRow, ListSlice, Row, Chip, Sheet, PillButton, DotMenu, NeuHeader, useTheme } from '../components/UI';
import { Bouncy, EASE_OUT, Enter, glide, useAnimLevel } from '../components/Motion';
import { tap } from '../haptics';
import { deleteAttachmentFiles } from '../attachments';
import { ToolGate } from '../components/LockGate';

/** Notes, behind the Notes lock when it is on. A single note locks from inside the note. */
export function NotesListScreen({ mode }: { mode: 'tab' | 'stack' }) {
  return (
    <ToolGate tool="notes" guard={mode === 'tab'} header={<NeuHeader title="Notes" variant={mode === 'tab' ? 'tab' : 'page'} />}>
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
 * the list under it; `check` names what is wrong with a name ('' when it is fine).
 */
function FolderNameSheet({ visible, onClose, title, initial, label, check, onSave }: {
  visible: boolean; onClose: () => void; title: string; initial: string; label: string;
  check: (name: string) => string; onSave: (name: string) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [problem, setProblem] = useState('');
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
      <Field
        value={draft} onChangeText={(v) => { setDraft(v); setProblem(''); }} placeholder="Folder name" autoFocus maxLength={40}
        onSubmitEditing={save}
      />
      {/* the caption token carries a colour of its own, so the danger ink goes after it */}
      {problem ? <Text style={{ ...T.caption, color: C.danger, marginTop: -8, marginBottom: 12 }}>{problem}</Text> : null}
      <PillButton label={label} onPress={save} />
    </Sheet>
  );
}

/** One note in the list, memoised: a change to one note re-renders its own row, not the screenful. */
const NoteRow = React.memo(function NoteRow({ note: n, first, last, dip, onOpen, onMenu }: {
  note: Note; first: boolean; last: boolean; dip: SharedValue<number>;
  onOpen: (id: string) => void; onMenu: (n: Note) => void;
}) {
  const dipStyle = useAnimatedStyle(() => ({ opacity: dip.value }));
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
            {!!n.body && !n.locked && <Text style={st.noteBody} numberOfLines={2}>{n.body}</Text>}
            <Text style={st.noteMeta} numberOfLines={1}>
              {n.folder}{n.subject ? ` · ${n.subject}` : ''} · {new Date(n.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            </Text>
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
  const filtered = useMemo(() => {
    const ql = settledQ.trim().toLowerCase();
    return notes
      .filter((n) => (folder ? n.folder === folder : true))
      // a locked note is found by its title only: its text never surfaces outside the note
      .filter((n) => !ql || n.title.toLowerCase().includes(ql) || (!n.locked && n.body.toLowerCase().includes(ql)))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
  }, [notes, settledQ, folder]);

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

  const newNote = () => {
    const id = addNote({ folder: folder || 'General' });
    nav.openNote(id);
  };
  const openNote = React.useCallback((id: string) => nav.openNote(id), [nav]);
  const openMenu = React.useCallback((n: Note) => { tap(); setMenuNote(n); }, []);
  const count = filtered.length;
  const renderItem = React.useCallback(({ item, index }: { item: Note; index: number }) => (
    <NoteRow
      note={item} first={index === 0} last={index === count - 1}
      dip={dip} onOpen={openNote} onMenu={openMenu}
    />
  ), [count, openNote, openMenu]);

  return (
    <ScreenBG guard={mode === 'tab'}>
      <NeuHeader title="Notes" variant={mode === 'tab' ? 'tab' : 'page'} />
      {/* the list rises as one surface, the search and the folders with its rows, on every visit: whatever rows are in
          the window then, however they got there */}
      <Enter index={0} style={{ flex: 1 }}>
        <Animated.FlatList
          data={filtered}
          keyExtractor={(n) => n.id}
          renderItem={renderItem}
          itemLayoutAnimation={sameList ? glide(level) : undefined}
          // Reanimated's list asks for a scroll event every frame unless told otherwise: the list only needs the default
          scrollEventThrottle={50}
          contentContainerStyle={{ padding: S.pad, paddingTop: 8, paddingBottom: 110 + (mode === 'tab' ? 0 : insets.bottom) }}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={10}
          windowSize={9}
          ListHeaderComponent={
            <>
              <Field value={q} onChangeText={setQ} placeholder="Search titles & bodies…" />
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
              <EmptyState icon="document-text-outline" title="No notes here yet" body="Folders, pins, search, voice, photos and files all live inside a note." actionLabel="New note" onAction={newNote} />
            )
          }
        />
      </Enter>

      <Bouncy
        radius={999}
        scaleTo={0.9}
        style={[
          st.fab,
          { bottom: mode === 'tab' ? 24 : insets.bottom + 20 },
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
  fab: {
    position: 'absolute', right: 20, bottom: 24, width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
  },
  note: { alignItems: 'flex-start', paddingVertical: 14 },
  noteTitle: { flex: 1, color: C.text, fontFamily: F.semi, fontSize: 16, letterSpacing: TRACK.title },
  noteBody: { color: C.textDim, fontFamily: F.reg, fontSize: 13, letterSpacing: TRACK.small, lineHeight: 18, marginTop: 4 },
  noteMeta: { color: C.textFaint, fontFamily: F.reg, fontSize: 11, letterSpacing: TRACK.fine, marginTop: 6 },
});
