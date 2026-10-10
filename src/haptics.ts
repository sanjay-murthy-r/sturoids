import * as Haptics from 'expo-haptics';
import { useStore } from './store';
import { osReducesMotion } from './components/Motion';

// Haptics ride the same master switch as motion: only at animLevel 'full', and never while the phone itself asks for
// no motion (read live, so turning that on mid-session stops the buzz at once).
const on = () => useStore.getState().settings.animLevel === 'full' && !osReducesMotion();

/** Selection tick — toggles, segmented controls, tab presses, calc keys. */
export const tick = () => { if (on()) Haptics.selectionAsync().catch(() => {}); };

/** Light impact — FABs, sheet opens. */
export const tap = () => { if (on()) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); };
