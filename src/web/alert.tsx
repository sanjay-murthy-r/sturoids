// The PC version's confirmations. React Native's Alert has nothing to show on the web (its alert() does nothing), so on
// the PC every question the app asks (clear the done tasks, delete a tag in use, a block that overlaps) and every
// "missing time" said with one went unseen, and the button that asked did nothing at all. On the web alone, Alert.alert
// is taken over here: each one waits its turn in a small queue and is asked in a sheet, its buttons as the app's own.
// On a phone nothing changes: the host draws nothing and Alert stays the system's.

import React from 'react';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';
import { create } from 'zustand';
import { C, F, TRACK } from '../theme';
import { PillButton, Sheet } from '../components/UI';
import { AlertButtonLike, alertButtons } from './pc';

interface Asked {
  n: number;
  title: string;
  message?: string;
  buttons: AlertButtonLike[];
  /** the button closing the sheet without a choice counts as, or -1 */
  dismiss: number;
  onDismiss?: () => void;
}

const useAsked = create<{ queue: Asked[]; n: number }>(() => ({ queue: [], n: 0 }));

/** Puts a question in the queue: it is asked once the ones before it have been answered. */
function ask(title: string, message?: string, buttons?: readonly AlertButtonLike[] | null, options?: { onDismiss?: () => void }) {
  const { list, dismiss } = alertButtons(buttons);
  const s = useAsked.getState();
  const n = s.n + 1;
  useAsked.setState({
    n, queue: [...s.queue, { n, title: String(title ?? ''), message: message ? String(message) : undefined, buttons: list, dismiss, onDismiss: options?.onDismiss }],
  });
}

let installed = false;
/** On the web, Alert.alert asks in the app's own sheet from now on. Called once, as this file loads; elsewhere nothing. */
function installWebAlert() {
  if (installed || Platform.OS !== 'web') return;
  installed = true;
  (Alert as any).alert = ask;
}
installWebAlert();

/**
 * Mounted once, in the root layout. The question at the head of the queue shows in a sheet: its title, what it says,
 * and its buttons along the foot, Cancel quiet and a destructive one in the danger colour. The button chosen runs once
 * the sheet has gone, so whatever it opens next (another question, a toast, a sheet) is never behind it. Closing the
 * sheet another way (the backdrop, Escape) counts as Cancel, or the only button there is.
 */
export function AlertHost() {
  const queue = useAsked((s) => s.queue);
  const head = queue[0] ?? null;
  const [open, setOpen] = React.useState(false);
  // what was chosen for the question on screen: a button's index, or -1 for closing it without one
  const chosen = React.useRef<number | null>(null);
  const shown = React.useRef<Asked | null>(null);
  React.useEffect(() => {
    if (head && shown.current?.n !== head.n) {
      shown.current = head;
      chosen.current = null;
      setOpen(true);
    }
  }, [head?.n]);
  if (Platform.OS !== 'web') return null;
  const asked = shown.current;
  if (!asked) return null;
  const close = (index: number) => {
    if (chosen.current != null) return;
    chosen.current = index;
    setOpen(false);
  };
  const closed = () => {
    const was = shown.current;
    const at = chosen.current ?? -1;
    shown.current = null;
    chosen.current = null;
    // the next question in line is asked after this one has run its answer, in case the answer asks again first
    useAsked.setState((s) => ({ queue: s.queue.filter((q) => q.n !== was?.n) }));
    if (!was) return;
    const pick = at >= 0 ? at : was.dismiss;
    if (pick >= 0) was.buttons[pick]?.onPress?.();
    else was.onDismiss?.();
  };
  return (
    <Sheet visible={open} onClose={() => close(-1)} onClosed={closed} title={asked.title || undefined}>
      {asked.message ? <Text style={st.message}>{asked.message}</Text> : null}
      <View style={st.buttons}>
        {asked.buttons.map((b, i) => {
          const cancel = b.style === 'cancel';
          const danger = b.style === 'destructive';
          return (
            <PillButton
              key={i} small label={b.text || 'OK'} outline={cancel}
              color={danger ? C.danger : cancel ? C.textDim : C.accent}
              onPress={() => close(i)}
              style={st.button}
            />
          );
        })}
      </View>
    </Sheet>
  );
}

const st = StyleSheet.create({
  message: { color: C.textDim, fontFamily: F.reg, fontSize: 15, lineHeight: 22, letterSpacing: TRACK.body, marginTop: -6 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10, marginTop: 22 },
  button: { minWidth: 88 },
});
