import { useStore } from './store';
import { toast } from './components/Toast';

/**
 * What a delete into Recently deleted says. `trashId` is what the trash action returned: null means Recently deleted
 * could not take it this launch, and the thing stayed where it was. Otherwise the toast's Undo puts it back, and
 * `onBack` runs once it is back. True when it moved.
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
  });
  return true;
}
