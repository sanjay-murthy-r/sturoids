import React from 'react';
import { View } from 'react-native';

/**
 * A page's own search bar (More's, Settings'). Sift opens over it the same way it opens from anywhere else (a fade and
 * a short settle, nothing lifting out of the bar), so the bar itself stays exactly as it is underneath: it never hides
 * or moves, and there is nothing to be left half-shown. Put `ref` and `style` on the bar.
 */
export function useSiftAnchor(_owner: string, _active = true) {
  const ref = React.useRef<View>(null);
  return { ref, style: NONE };
}

const NONE = {};
