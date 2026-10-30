// A page's own arrangement: which of its sections show, and in what order. A page names its sections once
// (useSections), lays them out in the order it is handed, and puts an "Arrange" key in its bar; the sheet here moves a
// section up or down and puts it away or brings it back. Kept in the settings (settings.pageLayout), so it travels with
// the profile and the cloud.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { create } from 'zustand';
import { C, F, S, TRACK } from '../theme';
import { PageLayout, useStore } from '../store';
import { IconBtn, PillButton, Sheet, Toggle } from './UI';
import { glide, useAnimLevel } from './Motion';
import { tick } from '../haptics';

export interface SectionDef {
  key: string;
  label: string;
  /** a line saying what it is, under its name in the sheet */
  hint?: string;
  /** a section the page cannot do without: it can move, but never be put away */
  fixed?: boolean;
}

/** The order a page's sections show in, given its arrangement: chosen order first, new sections in their usual place. */
export function arranged(defs: SectionDef[], layout?: PageLayout): { order: string[]; hidden: Set<string> } {
  const known = new Set(defs.map((d) => d.key));
  const order = (layout?.order ?? []).filter((k) => known.has(k));
  defs.forEach((d, i) => {
    if (order.includes(d.key)) return;
    // after the section that comes before it usually, or first
    const before = defs.slice(0, i).reverse().find((x) => order.includes(x.key));
    order.splice(before ? order.indexOf(before.key) + 1 : 0, 0, d.key);
  });
  const hidden = new Set((layout?.hidden ?? []).filter((k) => known.has(k) && !defs.find((d) => d.key === k)?.fixed));
  return { order, hidden };
}

/**
 * A page's sections as arranged: `shown` is their keys in order without the ones put away; `pos(key)` is a section's
 * place (for a flex `order`-free layout, sort by it); `arrange` is the bar's key for the sheet.
 */
export function useSections(page: string, title: string, defs: SectionDef[]) {
  const layout = useStore((s) => s.settings.pageLayout[page]);
  const { order, hidden } = React.useMemo(() => arranged(defs, layout), [layout, defs]);
  const shown = React.useMemo(() => order.filter((k) => !hidden.has(k)), [order, hidden]);
  const arrange = React.useMemo(() => ({
    icon: 'options-outline' as const,
    label: 'Arrange this page',
    onPress: () => openArrange(page, title, defs),
  }), [page, title, defs]);
  return { shown, has: (k: string) => shown.includes(k), arrange };
}

/** Lays children out in the page's order: each child carries its section's key as `key`. Missing keys are left out. */
export function InOrder({ shown, children }: { shown: string[]; children: React.ReactNode }) {
  const level = useAnimLevel();
  const byKey = new Map<string, React.ReactElement>();
  React.Children.forEach(children, (c) => { if (React.isValidElement(c) && c.key != null) byKey.set(String(c.key).replace(/^\.\$/, ''), c); });
  return (
    <>
      {shown.map((k) => {
        const el = byKey.get(k);
        // a section that moved glides to its new place
        return el ? <Animated.View key={k} layout={glide(level)}>{el}</Animated.View> : null;
      })}
    </>
  );
}

const useArrange = create<{ page: string; title: string; defs: SectionDef[]; open: boolean; n: number }>(
  () => ({ page: '', title: '', defs: [], open: false, n: 0 }),
);

export function openArrange(page: string, title: string, defs: SectionDef[]) {
  useArrange.setState((s) => ({ page, title, defs, open: true, n: s.n + 1 }));
}

/** Mounted once, in the root layout. */
export function ArrangeHost() {
  const { page, title, defs, open, n } = useArrange();
  if (!n) return null;
  return <ArrangeSheet key={n} page={page} title={title} defs={defs} visible={open} onClose={() => useArrange.setState({ open: false })} />;
}

function ArrangeSheet({ page, title, defs, visible, onClose }: { page: string; title: string; defs: SectionDef[]; visible: boolean; onClose: () => void }) {
  const level = useAnimLevel();
  const layout = useStore((s) => s.settings.pageLayout[page]);
  const setSetting = useStore((s) => s.setSetting);
  const { order, hidden } = arranged(defs, layout);
  const save = (next: PageLayout) => {
    const all = useStore.getState().settings.pageLayout;
    setSetting('pageLayout', { ...all, [page]: next });
  };
  const move = (k: string, by: -1 | 1) => {
    const i = order.indexOf(k);
    const j = i + by;
    if (j < 0 || j >= order.length) return;
    tick();
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    save({ order: next, hidden: [...hidden] });
  };
  const show = (k: string, on: boolean) => {
    const h = new Set(hidden);
    if (on) h.delete(k); else h.add(k);
    save({ order, hidden: [...h] });
  };
  const reset = () => {
    tick();
    const all = { ...useStore.getState().settings.pageLayout };
    delete all[page];
    setSetting('pageLayout', all);
  };
  const changed = !!layout && (layout.hidden.length > 0 || order.some((k, i) => defs[i]?.key !== k));
  return (
    <Sheet visible={visible} onClose={onClose} title={'Arrange ' + title}>
      <Text style={st.lede}>Show what you use, in the order you use it.</Text>
      {order.map((k, i) => {
        const d = defs.find((x) => x.key === k)!;
        const on = !hidden.has(k);
        return (
          <Animated.View key={k} layout={glide(level)} style={[st.row, !on && { opacity: 0.55 }]}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={st.name} numberOfLines={1}>{d.label}</Text>
              {d.hint ? <Text style={st.hint} numberOfLines={1}>{d.hint}</Text> : null}
            </View>
            <IconBtn name="chevron-up" size={18} pad={7} color={i === 0 ? C.textFaint : C.textDim} onPress={() => move(k, -1)} accessibilityLabel={'Move ' + d.label + ' up'} />
            <IconBtn name="chevron-down" size={18} pad={7} color={i === order.length - 1 ? C.textFaint : C.textDim} onPress={() => move(k, 1)} accessibilityLabel={'Move ' + d.label + ' down'} />
            <View style={{ width: 8 }} />
            {d.fixed ? <View style={{ width: 52 }} /> : <Toggle value={on} onChange={(v) => show(k, v)} label={'Show ' + d.label} />}
          </Animated.View>
        );
      })}
      <View style={st.foot}>
        {changed ? <PillButton label="Back to usual" outline color={C.textDim} onPress={reset} style={{ flex: 1 }} /> : null}
        <PillButton label="Done" onPress={onClose} style={{ flex: 1 }} />
      </View>
    </Sheet>
  );
}

const st = StyleSheet.create({
  lede: { color: C.textFaint, fontFamily: F.sm, fontSize: 13, letterSpacing: TRACK.fine, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 54, paddingVertical: 6 },
  name: { color: C.text, fontFamily: F.med, fontSize: 15, letterSpacing: TRACK.body },
  hint: { color: C.textFaint, fontFamily: F.sm, fontSize: 12, letterSpacing: TRACK.fine, marginTop: 1 },
  foot: { flexDirection: 'row', gap: 10, marginTop: S.pad },
});
