// Metro, as Expo sets it up, with one addition for the PC version (the web build the desktop app wraps): modules that
// exist only on a phone are swapped, on web alone, for stand-ins in src/web/shims. The Android build resolves every
// module exactly as before.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const shim = (name) => path.join(__dirname, 'src', 'web', 'shims', name);
/** phone-only module -> its web stand-in */
const WEB_SHIMS = {
  '@react-native-async-storage/async-storage': shim('asyncStorage.ts'),
  'expo-file-system': shim('fileSystem.ts'),
  'expo-file-system/next': shim('fileSystem.ts'),
  'expo-secure-store': shim('secureStore.ts'),
  'expo-local-authentication': shim('localAuthentication.ts'),
  'expo-screen-capture': shim('screenCapture.ts'),
  'expo-brightness': shim('brightness.ts'),
  'expo-navigation-bar': shim('navigationBar.ts'),
  'expo-intent-launcher': shim('intentLauncher.ts'),
  'expo-sharing': shim('sharing.ts'),
  'expo-share-intent': shim('shareIntent.ts'),
  'expo-notifications': shim('notifications.ts'),
  'react-native-android-widget': shim('androidWidget.tsx'),
  'react-native-webview': shim('webView.tsx'),
  'react-native-youtube-iframe': shim('youtubePlayer.tsx'),
};

const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web') {
    const hit = WEB_SHIMS[moduleName];
    if (hit) return { type: 'sourceFile', filePath: hit };
    // the app's own native module (restarting into another profile): the page reloads instead
    if (/(^|\/)modules\/app-restart$/.test(moduleName)) return { type: 'sourceFile', filePath: shim('appRestart.ts') };
  }
  return upstream ? upstream(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
