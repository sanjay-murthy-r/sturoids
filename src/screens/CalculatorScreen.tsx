import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, useWindowDimensions } from 'react-native';
import Animated, { Easing, FadeIn, withTiming } from 'react-native-reanimated';
import { create, all } from 'mathjs';
import * as Clipboard from 'expo-clipboard';
import { C, F, MIN, NEU, S, T, neuRaised } from '../theme';
import { useStore } from '../store';
import { ScreenBG, Sheet, Row, PillButton, Inset, Chip, IconBtn, NeuHeader, useTheme } from '../components/UI';
import { SegmentedControl } from '../components/SegmentedControl';
import { toast } from '../components/Toast';
import { Bouncy, EASE_OUT, FadeSwap, glide, rowIn, rowOut, useAnimLevel, useBuilt } from '../components/Motion';
import { tick } from '../haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RAIL_W, TWO_COL_AT, WIDE_AT, WIDE_MAX } from '../layout';

// Precise engine: BigNumber arithmetic — 0.1 + 0.2 is exactly 0.3 here.
const math = create(all, { number: 'BigNumber', precision: 40 });
const D2R = math.evaluate('pi / 180');
const R2D = math.evaluate('180 / pi');

const M = math as any;

function makeScope(deg: boolean, ans: any) {
  const scope: Record<string, any> = { Ans: ans ?? 0 };
  if (deg) {
    scope.sin = (x: any) => M.sin(M.multiply(x, D2R));
    scope.cos = (x: any) => M.cos(M.multiply(x, D2R));
    scope.tan = (x: any) => M.tan(M.multiply(x, D2R));
    scope.asin = (x: any) => M.multiply(M.asin(x), R2D);
    scope.acos = (x: any) => M.multiply(M.acos(x), R2D);
    scope.atan = (x: any) => M.multiply(M.atan(x), R2D);
  }
  return scope;
}

function toEngine(expr: string): string {
  return expr
    .replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-')
    .replace(/π/g, 'pi').replace(/√\(/g, 'sqrt(').replace(/×10\^/g, '*10^');
}

/** a wide window's calculator column: a keypad with a phone's proportions, larger */
const CALC_MAX = 480;
/** a wide window's key heights: fitted to the room, within these */
const KEY_MIN = 44;
const KEY_MAX = 88;
/** a function key's height, as a share of a number key's */
const SCI_SHARE = 0.8;
/** the equals key's height on a wide window, with and without the functions out */
const EQ_H = 56;
const EQ_H_SCI = 48;
/** the keypad's width beside the display on a sideways tablet */
const SPLIT_PAD_W = 440;

const BASIC: string[][] = [
  ['C', '⌫', '(', ')'],
  ['7', '8', '9', '÷'],
  ['4', '5', '6', '×'],
  ['1', '2', '3', '−'],
  ['0', '.', '^', '+'],
];
const SCI: string[][] = [
  ['sin(', 'cos(', 'tan(', '√('],
  ['asin(', 'acos(', 'atan(', '^'],
  ['ln(', 'log(', 'π', 'e'],
  ['!', '×10^', 'abs(', 'mod'],
];
const OPS = ['÷', '×', '−', '+'];

/** On equals, the answer lifts from the preview line into the main one, the way the old rise did. */
const answerIn = (travel: boolean) => () => {
  'worklet';
  const ease = { duration: travel ? 320 : 200, easing: Easing.out(Easing.cubic) };
  return {
    initialValues: { opacity: 0.6, transform: [{ translateY: travel ? 24 : 0 }] },
    animations: { opacity: withTiming(1, ease), transform: [{ translateY: withTiming(0, ease) }] },
  };
};

export function CalculatorScreen({ mode }: { mode: 'tab' | 'stack' }) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { width, height } = useWindowDimensions();
  // the keypad's box, measured on a wide window to fit the keys to it
  const [pad, setPad] = useState({ w: 0, h: 0 });
  const pushCalc = useStore((s) => s.pushCalc);
  const history = useStore((s) => s.calcHistory);
  const clearCalcHistory = useStore((s) => s.clearCalcHistory);

  const [expr, setExpr] = useState('');
  const [deg, setDeg] = useState(true);
  const [sci, setSci] = useState(false);
  const [sciNotation, setSciNotation] = useState(false);
  const [histSheet, setHistSheet] = useState(false);
  const ansRef = useRef<any>(null);
  const [justEvaluated, setJustEvaluated] = useState(false);
  // "=" on an expression that cannot be evaluated says so where the answer would be, briefly
  const [evalError, setEvalError] = useState(false);
  const errTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (errTimer.current) clearTimeout(errTimer.current); }, []);

  // on equals, the answer lifts from the preview line into the main one. The line is keyed on each answer, so the rise
  // runs as the answer mounts (a shared value set beforehand moved the old sum for a frame first)
  const level = useAnimLevel();
  const built = useBuilt();
  const [answers, setAnswers] = useState(0);

  const fmt = (v: any) =>
    math.format(v, sciNotation ? { notation: 'exponential', precision: 12 } : { precision: 14 });

  const evalExpr = (raw: string) => {
    // keypad: ln( = natural log, log( = base-10. mathjs: log( = natural, log10( = base-10.
    const src = raw.replace(/ln\(/g, '__LN__(').replace(/log\(/g, 'log10(').replace(/__LN__\(/g, 'log(');
    return math.evaluate(toEngine(src), makeScope(deg, ansRef.current));
  };

  const preview = useMemo(() => {
    if (!expr.trim()) return '';
    try {
      const v = evalExpr(expr);
      if (v === undefined || typeof v === 'function') return '';
      return fmt(v);
    } catch {
      return '';
    }
  }, [expr, deg, sciNotation]);

  const press = (k: string) => {
    setEvalError(false);
    if (k === 'C') { setExpr(''); setJustEvaluated(false); return; }
    // editing the result breaks the "untouched '=' output" invariant — the next
    // keypress must append, not restart
    if (k === '⌫') { setExpr((e) => e.slice(0, -1)); setJustEvaluated(false); return; }
    if (k === 'mod') k = ' mod ';
    setExpr((e) => {
      // start fresh after '=' unless continuing with an operator
      const continuing = ['+', '−', '×', '÷', '^', '!', ' mod '].includes(k);
      const base = justEvaluated && !continuing ? '' : e;
      return base + k;
    });
    setJustEvaluated(false);
  };

  const equals = () => {
    if (!expr.trim()) return;
    try {
      const v = evalExpr(expr);
      if (v === undefined || typeof v === 'function') throw new Error('bad');
      const out = fmt(v);
      ansRef.current = v;
      pushCalc(expr, out);
      setExpr(out);
      setJustEvaluated(true);
      setAnswers((n) => n + 1);
    } catch {
      // no "Error" row in the history: the expression stays, and the preview line explains
      setJustEvaluated(false);
      setEvalError(true);
      if (errTimer.current) clearTimeout(errTimer.current);
      errTimer.current = setTimeout(() => setEvalError(false), 1200);
    }
  };

  // A phone keeps its keypad exactly as it was. A wide window sets the calculator in a column of its own width with
  // keys fitted to the height it has; a sideways tablet sets the display, the controls and the history on the left
  // and the keypad on the right.
  const wide = width >= WIDE_AT;
  const split = wide && width > height && width - (mode === 'tab' ? RAIL_W : 0) >= TWO_COL_AT;
  const rows = BASIC.length + (sci ? SCI.length * SCI_SHARE : 0);
  const gaps = sci ? (SCI.length + BASIC.length) * 6 : BASIC.length * 8;
  const eqH = sci ? EQ_H_SCI : EQ_H;
  const keyH = wide && pad.h > 0
    ? Math.floor(Math.max(KEY_MIN, Math.min(KEY_MAX, (pad.w - 24) / 4, (pad.h - gaps - eqH - 10) / rows)))
    : undefined;

  // every key goes through one stable handler, so a keypress re-renders the display and not the thirty keys
  const pressRef = useRef(press);
  pressRef.current = press;
  const onKey = useCallback((k: string) => pressRef.current(k), []);
  const clearAll = useCallback(() => { tick(); setExpr(''); setJustEvaluated(false); }, []);

  const display = (
    // display — carved into the material
    <Inset pad={16} style={{ borderRadius: S.radius, marginBottom: 12, overflow: 'visible' }}>
      <ScrollView style={{ maxHeight: split ? 140 : 90 }} contentContainerStyle={{ justifyContent: 'flex-end' }}>
        <Animated.Text
          key={answers}
          entering={answers > 0 && level !== 'none' ? answerIn(level === 'full') : undefined}
          style={st.expr}
          selectable
        >
          {expr || '0'}
        </Animated.Text>
      </ScrollView>
      {/* "Can't evaluate" dips in over the preview and back out, instead of flashing */}
      <FadeSwap swapKey={evalError ? 'error' : 'preview'}>
        <Text style={[st.preview, { color: evalError ? C.danger : C.accent }]} numberOfLines={1}>{evalError ? "Can't evaluate" : justEvaluated ? ' ' : preview ? `= ${preview}` : ' '}</Text>
      </FadeSwap>
    </Inset>
  );

  const controls = (
    // controls sit under the display, so the well holds only the sum and its answer
    <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
      <Row style={{ flexShrink: 1, flexWrap: 'wrap' }}>
        <SegmentedControl
          size="sm"
          options={[{ key: 'deg', label: 'DEG' }, { key: 'rad', label: 'RAD' }]}
          value={deg ? 'deg' : 'rad'}
          onChange={(k) => setDeg(k === 'deg')}
          style={{ marginRight: 8, marginBottom: 8 }}
        />
        <Chip small label="SCI" active={sciNotation} color={C.amber} onPress={() => setSciNotation(!sciNotation)} />
        <Chip small icon="grid-outline" label="Functions" active={sci} onPress={() => setSci(!sci)} />
      </Row>
      {split ? null : <IconBtn name="time-outline" size={20} pad={6} onPress={() => setHistSheet(true)} accessibilityLabel="History" />}
    </Row>
  );

  // a wide window fits the keys to its height; one too short for them even at the smallest keys scrolls the keypad
  // instead of pushing it over the display. A phone keeps its keypad exactly as it was.
  const cramped = wide && pad.h > 0 && (pad.h - gaps - eqH - 10) / rows < KEY_MIN;
  const keyRows = (
    <>
      {/* the functions come up in their own rows as they open; the number keys stay where they are */}
      {sci && (
        <Animated.View entering={built.current && level !== 'none' ? FadeIn.duration(level === 'full' ? 240 : 180).easing(EASE_OUT) : undefined}>
          {SCI.map((row, i) => (
            <Row key={`s${i}`} style={{ gap: 8, marginBottom: 6 }}>
              {row.map((k) => (
                <Key
                  key={k} label={k.replace('(', '')} value={k} pad={8} small onKey={onKey} color={C.accent}
                  height={keyH ? Math.round(keyH * SCI_SHARE) : undefined}
                />
              ))}
            </Row>
          ))}
        </Animated.View>
      )}
      {BASIC.map((row, i) => (
        <Row key={i} style={{ gap: 8, marginBottom: sci ? 6 : 8 }}>
          {row.map((k) => (
            <Key
              key={k} label={k} value={k} pad={sci ? 11 : 16} onKey={onKey}
              onLongPress={k === '⌫' ? clearAll : undefined}
              color={OPS.includes(k) ? C.accent : k === 'C' || k === '⌫' ? C.danger : C.text}
              height={keyH}
            />
          ))}
        </Row>
      ))}
      <Bouncy
        onPress={() => { tick(); equals(); }}
        onLongPress={async () => {
          const out = justEvaluated ? expr : preview;
          if (!out) return;
          await Clipboard.setStringAsync(out);
          tick();
          // a haptic only answers at full motion: the copy says so in words too
          toast('Copied ' + out);
        }}
        radius={16}
        scaleTo={0.96}
        style={[
          st.equals,
          sci && { paddingVertical: 10 },
          wide && { height: eqH, paddingVertical: 0, justifyContent: 'center' },
          theme === 'minimal'
            ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: C.accent }
            : { backgroundColor: C.accent, ...NEU.raisedMid },
        ]}
      >
        <Text style={{ color: theme === 'minimal' ? C.accent : C.onAccent, fontSize: 26, fontFamily: F.semi }}>=</Text>
      </Bouncy>
    </>
  );
  const keypad = !wide ? (
    // keys — rows tighten when the sci pad is out so everything fits
    <View style={{ flex: 1, justifyContent: 'flex-end' }}>{keyRows}</View>
  ) : (
    <View
      style={{ flex: 1 }}
      onLayout={(e) => {
        const { width: w, height: h } = e.nativeEvent.layout;
        if (Math.abs(w - pad.w) > 0.5 || Math.abs(h - pad.h) > 0.5) setPad({ w, h });
      }}
    >
      {cramped ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' }}>{keyRows}</ScrollView>
      ) : (
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>{keyRows}</View>
      )}
    </View>
  );

  const reuse = useCallback((result: string) => { setExpr((e) => e + result); setHistSheet(false); }, []);
  const historyRows = <HistoryRows history={history} onPick={reuse} />;
  const historyEmpty = (
    <Text style={{ color: C.textFaint, fontFamily: F.reg, fontSize: 13 }}>Past calculations appear here. Tap one to reuse its result.</Text>
  );

  const bodyPad = { padding: S.pad, paddingTop: 8, paddingBottom: S.pad + (mode === 'tab' ? 0 : insets.bottom) };

  return (
    <ScreenBG guard={mode === 'tab'} maxWidth={split ? WIDE_MAX : CALC_MAX}>
      <NeuHeader title="Calculator" variant={mode === 'tab' ? 'tab' : 'page'} compact />
      {split ? (
        <View style={[st.split, bodyPad]}>
          <View style={st.splitSide}>
            {display}
            {controls}
            <View style={st.histHead}>
              <Text style={T.kicker}>History</Text>
              {history.length > 0 ? (
                <Bouncy onPress={clearCalcHistory} scaleTo={0.92} radius={8} hitSlop={8} accessibilityRole="button">
                  <Text style={st.histClear}>Clear</Text>
                </Bouncy>
              ) : null}
            </View>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 8 }}>
              {history.length === 0 ? historyEmpty : historyRows}
            </ScrollView>
          </View>
          <View style={st.splitPad}>{keypad}</View>
        </View>
      ) : (
        <View style={[{ flex: 1 }, bodyPad]}>
          {display}
          {controls}
          {keypad}
        </View>
      )}

      {/* history */}
      <Sheet visible={histSheet} onClose={() => setHistSheet(false)} title="History">
        {history.length === 0 ? historyEmpty : historyRows}
        {history.length > 0 && (
          <PillButton label="Clear history" color={C.danger} outline onPress={clearCalcHistory} style={{ marginTop: 10 }} />
        )}
      </Sheet>
    </ScreenBG>
  );
}

/**
 * Past sums, newest first. One that arrives while the list is in view (a split screen's history) fades in above the
 * rest as they glide down; clearing lets them fade together. A list that opens (the sheet) is simply there.
 */
const HistoryRows = React.memo(function HistoryRows({ history, onPick }: {
  history: { id: string; expr: string; result: string }[]; onPick: (result: string) => void;
}) {
  const level = useAnimLevel();
  const built = useBuilt();
  const enter = built.current ? rowIn(level) : undefined;
  return (
    <>
      {history.map((h) => (
        <Animated.View key={h.id} entering={enter} exiting={rowOut(level)} layout={glide(level)}>
          <Bouncy
            style={st.histRow} radius={14} scaleTo={0.98}
            onPress={() => { if (h.result !== 'Error') onPick(h.result); }}
          >
            <Text style={{ color: C.textDim, fontFamily: F.reg, fontSize: 13 }} numberOfLines={1}>{h.expr}</Text>
            <Text style={{ color: h.result === 'Error' ? C.danger : C.text, fontSize: 16, fontFamily: F.semi }} numberOfLines={1}>
              = {h.result}
            </Text>
          </Bouncy>
        </Animated.View>
      ))}
    </>
  );
});

/** Raised neumorphic key — sinks + carves in on press, with a haptic tick. Memoised: a keypress re-renders no key. */
const Key = React.memo(function Key({ label, value, onKey, onLongPress, color, small, pad, height }: {
  label: string;
  /** what the key types, handed to `onKey` */
  value: string;
  onKey: (k: string) => void; onLongPress?: () => void; color: string; small?: boolean; pad?: number;
  /** a wide window's key height, fitted to the room; a phone's key takes its height from its padding */
  height?: number;
}) {
  const theme = useTheme();
  return (
    <Bouncy
      onPress={() => { tick(); onKey(value); }}
      onLongPress={onLongPress}
      radius={16}
      scaleTo={0.94}
      style={[
        st.key,
        height ? { height, paddingVertical: 0 } : { paddingVertical: pad ?? (small ? 10 : 16) },
        theme === 'minimal'
          ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: MIN.border }
          : { backgroundColor: C.card, ...neuRaised('low') },
      ]}
    >
      <Text style={{ color, fontSize: small ? 15 : 22, fontFamily: F.med }}>{label}</Text>
    </Bouncy>
  );
});

const st = StyleSheet.create({
  expr: { color: C.text, fontSize: 34, fontFamily: F.semi, textAlign: 'right', fontVariant: ['tabular-nums'] },
  preview: { fontSize: 16, fontFamily: F.reg, textAlign: 'right', marginTop: 4, fontVariant: ['tabular-nums'] },
  key: {
    flex: 1, paddingVertical: 16, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
  },
  equals: {
    paddingVertical: 14, borderRadius: 16, alignItems: 'center', marginBottom: 10,
  },
  histRow: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  split: { flex: 1, flexDirection: 'row', gap: 28 },
  splitSide: { flex: 1, minWidth: 0 },
  splitPad: { width: SPLIT_PAD_W },
  histHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, marginBottom: 6 },
  histClear: { color: C.danger, fontFamily: F.semi, fontSize: 13 },
});
