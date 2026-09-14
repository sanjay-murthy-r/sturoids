import { SlotStack } from '../../../src/screens/SlotScreen';

// a page opened straight into this slot still has the tool beneath it
export const unstable_settings = { initialRouteName: 'index' };

export default function Slot2Layout() {
  return <SlotStack index={1} />;
}
