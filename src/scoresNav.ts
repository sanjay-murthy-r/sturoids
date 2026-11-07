import { create } from 'zustand';

/**
 * Where the Scores tool should go next, asked for from another screen: the exam form opens the exam it just added.
 * The Scores screen takes the request and clears it, so it is followed once.
 */
export const useScoresNav = create<{ open: string | null; at: number }>(() => ({ open: null, at: 0 }));

/**
 * How long a request waits for Scores. An exam added from Sift with Scores never opened leaves its request behind;
 * opening Scores minutes later must not jump to that exam, so a request this old is dropped instead of followed.
 */
const STALE_MS = 5000;

export function openScoreNode(id: string) {
  useScoresNav.setState({ open: id, at: Date.now() });
}

export function takeScoreNode(): string | null {
  const { open: id, at } = useScoresNav.getState();
  if (id) useScoresNav.setState({ open: null });
  return id && Date.now() - at <= STALE_MS ? id : null;
}
