import React, { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { create, all } from 'mathjs';
import * as Clipboard from 'expo-clipboard';
import { C, F, MIN, S, neuRaised } from '../src/theme';
import { useStore } from '../src/store';
import { ScreenBG, Sheet, Row, PillButton, Inset, Chip, IconBtn, NeuHeader, useTheme } from '../src/components/UI';
import { SegmentedControl } from '../src/components/SegmentedControl';
import { Bouncy } from '../src/components/Motion';
import { tick } from '../src/haptics';

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

export default function Calculator() {
  const theme = useTheme();
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
    } catch {
      pushCalc(expr, 'Error');
      setJustEvaluated(false);
    }
  };

  return (
    <ScreenBG>
      <NeuHeader title="Calculator" />
      <View style={{ flex: 1, padding: S.pad, paddingTop: 8 }}>
        {/* display — carved into the material */}
        <Inset pad={16} style={{ borderRadius: S.radius, marginBottom: 14, overflow: 'visible' }}>
          <Row style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <Row style={{ flexShrink: 1 }}>
              <SegmentedControl
                size="sm"
                options={[{ key: 'deg', label: 'DEG' }, { key: 'rad', label: 'RAD' }]}
                value={deg ? 'deg' : 'rad'}
                onChange={(k) => setDeg(k === 'deg')}
                style={{ alignSelf: 'center', marginRight: 8, marginBottom: 8 }}
              />
              <Chip small label="SCI" active={sciNotation} color={C.amber} onPress={() => setSciNotation(!sciNotation)} />
              <Chip small label="ƒ(x)" active={sci} color={C.violet} onPress={() => setSci(!sci)} />
            </Row>
            <IconBtn name="time-outline" size={20} pad={6} onPress={() => setHistSheet(true)} />
          </Row>
          <ScrollView style={{ maxHeight: 90 }} contentContainerStyle={{ justifyContent: 'flex-end' }}>
            <Text style={st.expr} selectable>{expr || '0'}</Text>
          </ScrollView>
          <Text style={[st.preview, { color: C.accent }]} numberOfLines={1}>{justEvaluated ? ' ' : preview ? `= ${preview}` : ' '}</Text>
        </Inset>

        {/* keys — rows tighten when the sci pad is out so everything fits */}
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          {sci && SCI.map((row, i) => (
            <Row key={`s${i}`} style={{ gap: 8, marginBottom: 6 }}>
              {row.map((k) => (
                <Key key={k} label={k.replace('(', '')} pad={8} small onPress={() => press(k)} color={C.violet} />
              ))}
            </Row>
          ))}
          {BASIC.map((row, i) => (
            <Row key={i} style={{ gap: 8, marginBottom: sci ? 6 : 8 }}>
              {row.map((k) => (
                <Key
                  key={k} label={k} pad={sci ? 11 : 16} onPress={() => press(k)}
                  onLongPress={k === '⌫' ? () => { tick(); setExpr(''); setJustEvaluated(false); } : undefined}
                  color={['÷', '×', '−', '+'].includes(k) ? C.accent : ['C', '⌫'].includes(k) ? C.danger : C.text}
                />
              ))}
            </Row>
          ))}
          <Bouncy
            onPress={() => { tick(); equals(); }}
            onLongPress={async () => {
              const out = justEvaluated ? expr : preview;
              if (out) { await Clipboard.setStringAsync(out); tick(); }
            }}
            radius={16}
            scaleTo={0.96}
            style={[
              st.equals,
              sci && { paddingVertical: 10 },
              theme === 'minimal'
                ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: C.accent }
                : {
                    backgroundColor: C.accent,
                    boxShadow: `3px -5.2px 9px rgba(128,139,159,0.36), -3px 5.2px 13px rgba(24,26,30,0.42), 0 0 10px ${C.accent}66`,
                  },
            ]}
          >
            <Text style={{ color: theme === 'minimal' ? C.accent : '#2C2D30', fontSize: 26, fontFamily: F.semi }}>=</Text>
          </Bouncy>
        </View>
      </View>

      {/* history */}
      <Sheet visible={histSheet} onClose={() => setHistSheet(false)} title="History">
        {history.length === 0 ? (
          <Text style={{ color: C.textFaint }}>Past calculations appear here — tap one to reuse its result.</Text>
        ) : (
          history.map((h) => (
            <Bouncy
              key={h.id} style={st.histRow} radius={14} scaleTo={0.98}
              onPress={() => { if (h.result !== 'Error') { setExpr((e) => e + h.result); setHistSheet(false); } }}
            >
              <Text style={{ color: C.textDim, fontSize: 13 }} numberOfLines={1}>{h.expr}</Text>
              <Text style={{ color: h.result === 'Error' ? C.danger : C.text, fontSize: 16, fontFamily: F.semi }} numberOfLines={1}>
                = {h.result}
              </Text>
            </Bouncy>
          ))
        )}
        {history.length > 0 && (
          <PillButton label="Clear history" color={C.danger} outline onPress={clearCalcHistory} style={{ marginTop: 10 }} />
        )}
      </Sheet>
    </ScreenBG>
  );
}

/** Raised neumorphic key — sinks + carves in on press, with a haptic tick. */
function Key({ label, onPress, onLongPress, color, small, pad }: {
  label: string; onPress: () => void; onLongPress?: () => void; color: string; small?: boolean; pad?: number;
}) {
  const theme = useTheme();
  return (
    <Bouncy
      onPress={() => { tick(); onPress(); }}
      onLongPress={onLongPress}
      radius={16}
      scaleTo={0.94}
      style={[
        st.key,
        { paddingVertical: pad ?? (small ? 10 : 16) },
        theme === 'minimal'
          ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: MIN.border }
          : { backgroundColor: C.card, ...neuRaised('low') },
      ]}
    >
      <Text style={{ color, fontSize: small ? 15 : 22, fontFamily: F.med }}>{label}</Text>
    </Bouncy>
  );
}

const st = StyleSheet.create({
  expr: { color: C.text, fontSize: 32, fontFamily: F.semi, textAlign: 'right', fontVariant: ['tabular-nums'] },
  preview: { fontSize: 16, fontFamily: F.reg, textAlign: 'right', marginTop: 4, fontVariant: ['tabular-nums'] },
  key: {
    flex: 1, paddingVertical: 16, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
  },
  equals: {
    paddingVertical: 14, borderRadius: 16, alignItems: 'center', marginBottom: 10,
  },
  histRow: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.border },
});
