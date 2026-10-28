// The phone widgets' task handler: Android asks it to draw a widget when one is added, resized or due its half-hourly
// update, and it may run with the app closed (a headless task). It reads the active profile's saved rows (rows.ts),
// never the store, and draws. Taps are links (OPEN_URI / OPEN_APP) the system opens in the app, which carries out the
// action itself (src/actions.ts); the one tap that comes here is a Calculator key, which the widget works out itself
// (calc.ts) and keeps under its own key, so this handler never writes the app's data.

import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import { isPhoneWidget } from './model';
import { readPad, readPhoneData, writePad } from './rows';
import { isCalcKey, pressKey } from './calc';
import { fallbackWidget, renderPhoneWidget } from './widgets';

export async function phoneWidgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  const { widgetInfo, widgetAction, renderWidget } = props;
  const name = widgetInfo.widgetName;
  if (widgetAction === 'WIDGET_DELETED') {
    if (name === 'Calculator') await writePad(widgetInfo.widgetId, null);
    return;
  }
  if (!isPhoneWidget(name)) {
    renderWidget(fallbackWidget());
    return;
  }
  try {
    if (name === 'Calculator') {
      let pad = await readPad(widgetInfo.widgetId);
      if (widgetAction === 'WIDGET_CLICK') {
        const key = (props.clickActionData as any)?.key;
        if (props.clickAction !== 'CALC' || !isCalcKey(key)) return;
        pad = pressKey(pad, key);
        await writePad(widgetInfo.widgetId, pad);
      }
      // only the look is read for a key: the rest of the app's rows would slow every tap
      const data = await readPhoneData(['settings']);
      renderWidget(renderPhoneWidget(name, data, { width: widgetInfo.width, height: widgetInfo.height }, new Date(), pad));
      return;
    }
    if (widgetAction === 'WIDGET_CLICK') return;
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
