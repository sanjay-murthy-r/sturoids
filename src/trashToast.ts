import { useStore } from './store';
import { toast } from './components/Toast';
import { openPage } from './toolNav';

/** Opens Settings on Recently deleted. */
export function openRecentlyDeleted() {
  openPage('/settings', { page: 'trash' });
}

/** What the toast's words do: they open Recently deleted, where the thing now is. */
const TO_TRASH = { onMessage: openRecentlyDeleted, hint: 'Opens Recently deleted' };

/**
 * What a delete into Recently deleted says. `trashId` is what the trash action returned: null means Recently deleted
 * could not take it this launch, and the thing stayed where it was. Otherwise the toast's Undo puts it back, and
 * `onBack` runs once it is back; its words open Recently deleted. True when it moved.
 */
export function toastTrashed(trashId: string | null, onBack?: () => void): boolean {
  if (!trashId) {
    toast("Couldn't move it to Recently deleted");
    return false;
  }
  toast('Moved to Recently deleted', {
    label: 'Undo',
    onPress: () => {
      const s = useStore.getState();
      const kind = s.trash.find((t) => t.id === trashId)?.kind;
      // a part goes back into its video or note, which may have been deleted since
      if (s.restoreFromTrash(trashId) === 'parent-missing') {
        toast(kind === 'attachment' ? 'Restore the note first.' : 'Restore the video first.');
        return;
      }
      onBack?.();
    },
  }, TO_TRASH);
  return true;
}

/**
 * The same for several things moved at once (Clear done): one toast, `message` its words, and one Undo that puts them
 * all back in the reverse order they went, so each lands at the place it had. True when any moved.
 */
export function toastTrashedMany(trashIds: (string | null)[], message: string, onBack?: () => void): boolean {
  const moved = trashIds.filter((x): x is string => !!x);
  if (moved.length <= 1) return toastTrashed(moved[0] ?? null, onBack);
  toast(message, {
    label: 'Undo',
    onPress: () => {
      for (let i = moved.length - 1; i >= 0; i--) useStore.getState().restoreFromTrash(moved[i]);
      onBack?.();
    },
  }, TO_TRASH);
  return true;
}
