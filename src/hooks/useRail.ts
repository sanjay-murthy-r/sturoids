import { useWindowDimensions } from 'react-native';
import { useStore } from '../store';
import { WIDE_AT } from '../layout';

/** Whether the tabs stand in the side rail now: a wide window, with Settings keeping them at the side (the default). */
export function useRail(): boolean {
  const { width } = useWindowDimensions();
  const side = useStore((s) => s.settings.tabNav === 'side');
  return side && width >= WIDE_AT;
}
