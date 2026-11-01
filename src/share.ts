import { Platform, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { expectAway } from './lock';
import { toast } from './components/Toast';

/**
 * Shares some text: the phone's share sheet on Android. The PC app has no share sheet (the desktop window has no
 * navigator.share, and React Native's Share does nothing there), so the text is copied instead and a toast says so,
 * never a menu item that does nothing. A share sheet closed without choosing anything is not a failure.
 */
export async function shareMessage(message: string): Promise<void> {
  if (Platform.OS === 'web' && !(typeof navigator !== 'undefined' && typeof navigator.share === 'function')) {
    try {
      await Clipboard.setStringAsync(message);
      toast('Copied, paste it anywhere');
    } catch {
      toast('Could not copy the text');
    }
    return;
  }
  // the share sheet takes the app out of view; coming back from it never locks what was open
  await expectAway(() => Share.share({ message })).catch(() => {});
}
