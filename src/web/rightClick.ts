import { Platform } from 'react-native';

/**
 * On the PC, a right click does what a long press does on the phone (a row's menu, pinning in Sift, a tile's edit
 * mode), in place of the browser's own menu. Spread onto a Pressable (or anything that passes its props to one) that has
 * an `onLongPress`; on the phone it adds nothing.
 */
export function rightClick(fn?: (() => void) | null): { onContextMenu?: (e: any) => void } {
  if (Platform.OS !== 'web' || !fn) return {};
  return {
    onContextMenu: (e: any) => {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      fn();
    },
  };
}
