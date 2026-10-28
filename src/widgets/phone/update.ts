// Keeps the phone widgets in step while the app runs. They are pictures the launcher holds, so the app redraws the
// ones on the home screen whenever what they show may have changed:
// - once the saved data has loaded;
// - after a change to anything they read, once the changes pause (2 s, so typing a note never redraws per letter);
// - when the app goes to the background (what was just done shows on the home screen at once) and comes back;
// - as the day turns over at midnight, and every few minutes while the app is open (the day ring and now lines move).
// A widget is redrawn only when what it shows changed since it was last drawn. Beyond that the system asks every 30
// minutes, through the task handler (handler.tsx), which reads the saved rows itself.
//
// Started from boot.ts once the app's own screen is up, never in a headless task: it reads the running store.

import { AppState, AppStateStatus } from 'react-native';
import { PHONE_ROWS, PHONE_WIDGET_NAMES, PhoneData, PhoneRow, PhoneWidgetName, cleanData, gateOf, modelFor, paletteOf } from './model';

const QUIET_MS = 2000;
const TICK_MS = 5 * 60 * 1000;

type WidgetLib = typeof import('react-native-android-widget');

function lib(): WidgetLib | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('react-native-android-widget') as WidgetLib;
  } catch {
    return null;
  }
}

/** what each widget on the home screen was last drawn from, by its id */
const drawn = new Map<number, string>();
let running = false;
/** set once the saved data has loaded into the store: before that the store holds a fresh install's empty values */
let ready = false;
let busy = false;
let again = false;

/** The store's rows as the widgets read them (the same shape the task handler reads from storage). */
function currentData(): PhoneData {
  // required here: this file is loaded by boot.ts before the app needs the store
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { useStore } = require('../../store') as typeof import('../../store');
  const s: any = useStore.getState();
  const rows: Partial<Record<PhoneRow, unknown>> = {};
  for (const k of PHONE_ROWS) rows[k] = s[k];
  return cleanData(rows);
}

/** Redraws every phone widget whose content changed. Safe to call often: calls while one runs fold into one more. */
export async function updatePhoneWidgets(force = false): Promise<void> {
  const L = lib();
  if (!L || !ready) return;
  if (busy) {
    again = true;
    return;
  }
  busy = true;
  try {
    const { renderPhoneWidget } = require('./widgets') as typeof import('./widgets');
    const data = currentData();
    const now = new Date();
    const look = JSON.stringify(paletteOf(data.settings));
    for (const name of PHONE_WIDGET_NAMES) {
      let infos: { widgetId: number; width: number; height: number }[] = [];
      try {
        infos = await L.getWidgetInfo(name);
      } catch {
        continue;
      }
      if (!infos.length) continue;
      const gate = gateOf(name as PhoneWidgetName, data);
      const model = gate ? null : modelFor(name as PhoneWidgetName, data, now);
      const sig = look + '|' + JSON.stringify(gate) + '|' + JSON.stringify(model);
      for (const info of infos) {
        const key = sig + '|' + info.width + 'x' + info.height;
        if (!force && drawn.get(info.widgetId) === key) continue;
        try {
          await L.requestWidgetUpdateById({
            widgetName: name,
            widgetId: info.widgetId,
            renderWidget: (i) => renderPhoneWidget(name as PhoneWidgetName, data, { width: i.width, height: i.height }, now, gate ? undefined : model),
          });
          drawn.set(info.widgetId, key);
        } catch {
          drawn.delete(info.widgetId);
        }
      }
    }
  } catch {
    // a widget that cannot be drawn now is drawn on the next change or the system's next update
  } finally {
    busy = false;
    if (again) {
      again = false;
      setTimeout(() => updatePhoneWidgets(), 0);
    }
  }
}

let quietTimer: ReturnType<typeof setTimeout> | null = null;
function soon() {
  if (quietTimer) clearTimeout(quietTimer);
  quietTimer = setTimeout(() => {
    quietTimer = null;
    updatePhoneWidgets();
  }, QUIET_MS);
}

let midnightTimer: ReturnType<typeof setTimeout> | null = null;
function armMidnight() {
  if (midnightTimer) clearTimeout(midnightTimer);
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
  midnightTimer = setTimeout(() => {
    updatePhoneWidgets();
    armMidnight();
  }, Math.max(1000, next.getTime() - now.getTime()));
}

let tick: ReturnType<typeof setInterval> | null = null;
function setTicking(on: boolean) {
  if (on && !tick) tick = setInterval(() => updatePhoneWidgets(), TICK_MS);
  if (!on && tick) {
    clearInterval(tick);
    tick = null;
  }
}

/** Starts keeping the phone widgets in step with the app. Once per process; later calls do nothing. */
export function startPhoneWidgetUpdates() {
  if (running || !lib()) return;
  running = true;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const store = require('../../store') as typeof import('../../store');
  store.onHydrationSettled(() => {
    // a load that failed leaves the store on empty values: the widgets keep what the saved rows drew instead
    if (!store.useStore.persist.hasHydrated()) return;
    ready = true;
    updatePhoneWidgets(true);
    // only the collections the widgets read: a change elsewhere (the Desmos graph, the calculator) redraws nothing
    let last: any = store.useStore.getState();
    store.useStore.subscribe((s: any) => {
      const prev = last;
      last = s;
      for (const k of PHONE_ROWS) {
        if (s[k] !== prev[k]) {
          soon();
          return;
        }
      }
    });
  });
  AppState.addEventListener('change', (next: AppStateStatus) => {
    if (next === 'background') {
      // what was just done shows on the home screen as the user gets there
      if (quietTimer) {
        clearTimeout(quietTimer);
        quietTimer = null;
      }
      setTicking(false);
      updatePhoneWidgets();
    } else if (next === 'active') {
      setTicking(true);
      armMidnight();
      updatePhoneWidgets();
    }
  });
  setTicking(true);
  armMidnight();
}
