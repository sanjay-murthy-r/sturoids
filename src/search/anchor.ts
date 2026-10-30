import React from 'react';
import { View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useAnimatedStyle } from 'react-native-reanimated';
import { setSiftAnchor, siftShown, useSearch } from './store';

/**
 * A page's own search bar (More's, Settings'): while the page is in front and `active`, Sift opens out of it, its field
 * lifting from the bar's place and settling back there on the way out. The bar stands back while that field is up, so
 * there is only ever one of it. Put `ref` and `style` on the bar (an Animated view).
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
  const mine = useSearch((s) => s.anchorOwner === owner && s.anchor != null);
  const style = useAnimatedStyle(() => ({ opacity: mine && siftShown.value > 0.002 ? 0 : 1 }));
  return { ref, style };
}
