import { create } from 'zustand';

/**
 * Where the Scores tool should go next, asked for from another screen: the exam form opens the exam it just added.
 * The Scores screen takes the request and clears it, so it is followed once.
 */
export const useScoresNav = create<{ open: string | null }>(() => ({ open: null }));

export function openScoreNode(id: string) {
  useScoresNav.setState({ open: id });
}

export function takeScoreNode(): string | null {
  const id = useScoresNav.getState().open;
  if (id) useScoresNav.setState({ open: null });
  return id;
}
