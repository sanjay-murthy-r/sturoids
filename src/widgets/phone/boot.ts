// The phone widgets' start, from the app's entry (index.js), before the router:
// - the task handler is registered in every launch, the headless ones Android starts to draw a widget with the app
//   closed included;
// - the app's own updater (update.ts) starts only once the app's screen is in the foreground, so a headless launch
//   never loads the store. A headless launch that the user then opens into gets it at that moment.

import { AppState } from 'react-native';

let started = false;

function startWhenShown() {
  if (started) return;
  started = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    (require('./update') as typeof import('./update')).startPhoneWidgetUpdates();
  } catch {
    // widgets are an extra: the app runs without them
  }
}

export function bootPhoneWidgets() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { registerWidgetTaskHandler } = require('react-native-android-widget') as typeof import('react-native-android-widget');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { phoneWidgetTaskHandler } = require('./handler') as typeof import('./handler');
    registerWidgetTaskHandler(phoneWidgetTaskHandler);
  } catch {
    // an install without the widget library (the APK before 2.0): nothing to draw
    return;
  }
  if (AppState.currentState === 'active') {
    startWhenShown();
    return;
  }
  const sub = AppState.addEventListener('change', (s) => {
    if (s !== 'active') return;
    sub.remove();
    startWhenShown();
  });
}
