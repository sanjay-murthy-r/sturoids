import React from 'react';
import { View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useAnimatedStyle } from 'react-native-reanimated';
import { setSiftAnchor, siftAnchorOut, siftAnchorOwner } from './store';

/**
 * A page's own search bar (More's, Settings'): while the page is in front and `active`, Sift's field lifts out of it and
 * goes back into it (SearchOverlay). The bar hides on the UI thread in the frame the field takes its place and shows
 * again in the frame the field lands back, so there is only ever one of it. Put `ref` and `style` on the bar (an
 * Animated view that does not collapse).
 */
export function useSiftAnchor(owner: string, active = true) {
  const ref = React.useRef<View>(null);
  const focused = useIsFocused();
  React.useEffect(() => {
    if (!active || !focused) return undefined;
    return setSiftAnchor({
      owner,
      measure: (cb) => {
        const v = ref.current;
        if (!v) { cb(null); return; }
        v.measureInWindow((x, y, w, h) => cb({ x, y, w, h }));
      },
    });
  }, [owner, active, focused]);
  const style = useAnimatedStyle(() => ({ opacity: siftAnchorOwner.value === owner && siftAnchorOut.value > 0.5 ? 0 : 1 }), [owner]);
  return { ref, style };
}
