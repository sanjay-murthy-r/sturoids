import React from 'react';
import { Stack, useNavigation } from 'expo-router';
import { StackActions } from '@react-navigation/native';
import { bgFor } from '../theme';
import { useStore } from '../store';
import { ToolKey, normaliseSlots } from '../tools';
import { ScreenMode, SlotProvider } from '../toolNav';
import { noteTransitionStart, pageTransition, useAnimLevel } from '../components/Motion';

type SlotTool = React.ComponentType<{ mode: ScreenMode }>;

/**
 * The screen each tool shows at the root of a bar slot, loaded the first time a slot shows it: a slot loads only its
 * own tool, never the other nine (the calculator's maths engine, say) with it. Every tool must register here (a missing
 * one fails to compile rather than leaving a blank tab), and its own pages get a route in every slot folder beside
 * `note/[id].tsx` and `video/[id].tsx`.
 */
export const SLOT_SCREENS: Record<ToolKey, () => SlotTool> = {
  tasks: () => (require('./TasksScreen') as typeof import('./TasksScreen')).TasksScreen,
  focus: () => (require('./FocusScreen') as typeof import('./FocusScreen')).FocusScreen,
  planner: () => (require('./PlannerScreen') as typeof import('./PlannerScreen')).PlannerScreen,
  notes: () => (require('./NotesListScreen') as typeof import('./NotesListScreen')).NotesListScreen,
  journal: () => (require('./JournalScreen') as typeof import('./JournalScreen')).JournalScreen,
  scores: () => (require('./ScoresScreen') as typeof import('./ScoresScreen')).ScoresScreen,
  calculator: () => (require('./CalculatorScreen') as typeof import('./CalculatorScreen')).CalculatorScreen,
  desmos: () => (require('./DesmosScreen') as typeof import('./DesmosScreen')).DesmosScreen,
  vault: () => (require('./VaultLibraryScreen') as typeof import('./VaultLibraryScreen')).VaultLibraryScreen,
  ai: () => (require('./AiLinksScreen') as typeof import('./AiLinksScreen')).AiLinksScreen,
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
  // the tool's module loads here, once (a later call reads it from the module cache)
  const Tool = key ? SLOT_SCREENS[key]() : undefined;
  return Tool ? <Tool key={key} mode="tab" /> : null;
}
