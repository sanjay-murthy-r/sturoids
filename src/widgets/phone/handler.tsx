// The phone widgets' task handler: Android asks it to draw a widget when one is added, resized or due its half-hourly
// update, and it may run with the app closed (a headless task). It reads the active profile's saved rows (rows.ts),
// never the store, and draws. Taps never come here: every tap is a link (OPEN_URI / OPEN_APP) the system opens in
// the app, which carries out the action itself (src/actions.ts), so this handler never writes anything.

import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import { isPhoneWidget } from './model';
import { readPhoneData } from './rows';
import { fallbackWidget, renderPhoneWidget } from './widgets';

export async function phoneWidgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  const { widgetInfo, widgetAction, renderWidget } = props;
  if (widgetAction === 'WIDGET_DELETED' || widgetAction === 'WIDGET_CLICK') return;
  const name = widgetInfo.widgetName;
  if (!isPhoneWidget(name)) {
    renderWidget(fallbackWidget());
    return;
  }
  try {
    const data = await readPhoneData();
    renderWidget(renderPhoneWidget(name, data, { width: widgetInfo.width, height: widgetInfo.height }, new Date()));
  } catch {
    // a widget always shows something calm, never the launcher's "Can't load widget"
    try {
      renderWidget(fallbackWidget());
    } catch {
      // nothing more can be drawn
    }
  }
}
