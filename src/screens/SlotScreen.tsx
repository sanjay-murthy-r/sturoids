import React from 'react';
import { Stack, useNavigation } from 'expo-router';
import { StackActions } from '@react-navigation/native';
import { bgFor } from '../theme';
import { useStore } from '../store';
import { ToolKey, normaliseSlots } from '../tools';
import { ScreenMode, SlotProvider } from '../toolNav';
import { TasksScreen } from './TasksScreen';
import { FocusScreen } from './FocusScreen';
import { PlannerScreen } from './PlannerScreen';
import { NotesListScreen } from './NotesListScreen';
import { CalculatorScreen } from './CalculatorScreen';
import { DesmosScreen } from './DesmosScreen';
import { VaultLibraryScreen } from './VaultLibraryScreen';
import { AiLinksScreen } from './AiLinksScreen';
import { JournalScreen } from './JournalScreen';
import { ScoresScreen } from './ScoresScreen';
import { noteTransitionStart, pageTransition, useAnimLevel } from '../components/Motion';

/**
 * The screen each tool shows at the root of a bar slot. Every tool must register here (a missing one fails to
 * compile rather than leaving a blank tab), and its own pages get a route in every slot folder beside
 * `note/[id].tsx` and `video/[id].tsx`.
 */
export const SLOT_SCREENS: Record<ToolKey, React.ComponentType<{ mode: ScreenMode }>> = {
  tasks: TasksScreen,
  focus: FocusScreen,
  planner: PlannerScreen,
  notes: NotesListScreen,
  journal: JournalScreen,
  scores: ScoresScreen,
  calculator: CalculatorScreen,
  desmos: DesmosScreen,
  vault: VaultLibraryScreen,
  ai: AiLinksScreen,
};

/** The Stack inside bar slot `index`: the tool at its root, the tool's own pages (a note, a video) above. */
export function SlotStack({ index }: { index: number }) {
  const theme = useStore((s) => s.settings.theme);
  // a page opening in a slot (a note, a video) comes in exactly as a full page does, over the slot while the bar stays
  // (see pageTransition); with motion off it is simply there
  const level = useAnimLevel();
  return (
    <SlotProvider slot={index}>
      <Stack
        screenListeners={noteTransitionStart}
        screenOptions={{
          headerShown: false,
          ...pageTransition(level),
          contentStyle: { backgroundColor: bgFor(theme) },
        }}
      />
    </SlotProvider>
  );
}

/** Root of bar slot `index`: whichever tool Settings put there, presented as a tab. */
export function SlotScreen({ index }: { index: number }) {
  const key = useStore((s) => normaliseSlots(s.settings.tabSlots)[index]);
  const navigation = useNavigation();
  const shown = React.useRef(key);
  React.useEffect(() => {
    if (shown.current === key) return;
    shown.current = key;
    // pages the previous tool opened in this slot (a note, a video) leave with it
    if ((navigation.getState()?.index ?? 0) > 0) navigation.dispatch(StackActions.popToTop());
  }, [key, navigation]);
  const Tool = key ? SLOT_SCREENS[key] : undefined;
  return Tool ? <Tool key={key} mode="tab" /> : null;
}
