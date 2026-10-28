/**
 * Notes made with New note that nobody has written in yet. The note's page takes one away again if it is still blank
 * when the page closes, so backing out never leaves an "Untitled" row behind. Every way of making a blank note (the
 * Notes list, Sift, an app shortcut or widget link) marks it here.
 */
const freshNotes = new Set<string>();

/** Marks a note just made as blank and waiting for its first words. */
export function markFreshNote(id: string) {
  freshNotes.add(id);
}

/** True once, for a note marked fresh, the first time its page closes. */
export function takeFreshNote(id: string): boolean {
  return freshNotes.delete(id);
}
