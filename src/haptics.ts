import * as Haptics from 'expo-haptics';
import { useStore } from './store';

// Haptics ride the same master switch as motion: only at animLevel 'full'.
const on = () => useStore.getState().settings.animLevel === 'full';

/** Selection tick — toggles, segmented controls, tab presses, calc keys. */
export const tick = () => { if (on()) Haptics.selectionAsync().catch(() => {}); };

/** Light impact — FABs, sheet opens. */
export const tap = () => { if (on()) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); };
