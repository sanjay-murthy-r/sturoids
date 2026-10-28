// A phone widget shown inside the app exactly as the home screen draws it (the widget library renders the same tree to
// a picture), for the widget gallery and the Clock's in-app preview. Taps on it open what the widget's taps open.
// Redrawn each minute, and whenever what it reads changes.

import React from 'react';
import { Linking, View } from 'react-native';
import { useStore } from '../../store';
import { PHONE_ROWS, PhoneRow, PhoneWidgetName, cleanData } from './model';
import { renderPhoneWidget } from './widgets';

type WidgetLib = typeof import('react-native-android-widget');
function lib(): WidgetLib | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('react-native-android-widget') as WidgetLib;
  } catch {
    return null;
  }
}

/** The size a widget of each kind is previewed at, in dp: S two cells square, M four by two, L four by four. */
export function previewBox(name: PhoneWidgetName): { width: number; height: number } {
  const wide = ['AtAGlance', 'Checklist', 'Deadlines', 'Session', 'TodaysBlocks', 'HabitGrid', 'Pinned', 'MoodStrip', 'OnThisDay', 'Results', 'ContinueWatching'];
  const large = ['Agenda', 'FocusWeek', 'RecentNotes', 'SubjectTrend', 'WatchList'];
  if (large.includes(name)) return { width: 320, height: 320 };
  if (wide.includes(name)) return { width: 320, height: 152 };
  return { width: 152, height: 152 };
}

export function PhoneWidgetPreview({ name, width, height }: { name: PhoneWidgetName; width?: number; height?: number }) {
  const L = lib();
  const box = previewBox(name);
  const w = width ?? box.width;
  const h = height ?? box.height;
  // one selector per row the widgets read (a constant list, so the hooks keep their order): a change elsewhere
  // re-renders nothing here
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const values = PHONE_ROWS.map((k) => useStore((s: any) => s[k]));
  const [minute, setMinute] = React.useState(() => Math.floor(Date.now() / 60000));
  React.useEffect(() => {
    const t = setInterval(() => setMinute(Math.floor(Date.now() / 60000)), 15000);
    return () => clearInterval(t);
  }, []);
  const data = React.useMemo(() => {
    const picked: Partial<Record<PhoneRow, unknown>> = {};
    PHONE_ROWS.forEach((k, i) => {
      picked[k] = values[i];
    });
    return cleanData(picked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, values);
  const render = React.useCallback(
    (size: { width: number; height: number }) => renderPhoneWidget(name, data, size, new Date(minute * 60000)),
    [name, data, minute],
  );
  if (!L) return <View style={{ width: w, height: h }} />;
  const { WidgetPreview } = L;
  return (
    <WidgetPreview
      renderWidget={render}
      width={w}
      height={h}
      onClick={({ clickAction, clickActionData }) => {
        const uri = clickAction === 'OPEN_URI' ? (clickActionData as any)?.uri : null;
        if (typeof uri === 'string' && uri) Linking.openURL(uri).catch(() => {});
      }}
    />
  );
}

/** The Clock as the home screen shows it. */
export const PhoneClockPreview = (props: { width?: number; height?: number }) => <PhoneWidgetPreview name="Clock" {...props} />;
