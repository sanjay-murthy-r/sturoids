import React, { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { create, all } from 'mathjs';
import { C, S } from '../src/theme';
import { useStore } from '../src/store';
import { ScreenBG, Sheet, Row, PillButton } from '../src/components/UI';

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
  ['0', '.', 'Ans', '+'],
];
const SCI: string[][] = [
  ['sin(', 'cos(', 'tan(', '√('],
  ['asin(', 'acos(', 'atan(', '^'],
  ['ln(', 'log(', 'π', 'e'],
  ['!', '×10^', 'abs(', 'mod'],
];

export default function Calculator() {
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
    if (k === '⌫') { setExpr((e) => e.slice(0, -1)); return; }
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
      <View style={{ flex: 1, padding: S.pad }}>
        {/* display */}
        <View style={st.display}>
          <Row style={{ justifyContent: 'space-between', marginBottom: 6 }}>
            <Row>
              <Pressable onPress={() => setDeg(!deg)} style={st.modeBtn}>
                <Text style={{ color: C.accent, fontWeight: '800', fontSize: 13 }}>{deg ? 'DEG' : 'RAD'}</Text>
              </Pressable>
              <Pressable onPress={() => setSciNotation(!sciNotation)} style={st.modeBtn}>
                <Text style={{ color: sciNotation ? C.amber : C.textFaint, fontWeight: '800', fontSize: 13 }}>SCI</Text>
              </Pressable>
              <Pressable onPress={() => setSci(!sci)} style={st.modeBtn}>
                <Text style={{ color: sci ? C.violet : C.textFaint, fontWeight: '800', fontSize: 13 }}>ƒ(x)</Text>
              </Pressable>
            </Row>
            <Pressable onPress={() => setHistSheet(true)} style={st.modeBtn}>
              <Text style={{ color: C.textDim, fontWeight: '700', fontSize: 13 }}>History</Text>
            </Pressable>
          </Row>
          <ScrollView style={{ maxHeight: 90 }} contentContainerStyle={{ justifyContent: 'flex-end' }}>
            <Text style={st.expr} selectable>{expr || '0'}</Text>
          </ScrollView>
          <Text style={st.preview} numberOfLines={1}>{justEvaluated ? ' ' : preview ? `= ${preview}` : ' '}</Text>
        </View>

        {/* keys */}
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          {sci && SCI.map((row, i) => (
            <Row key={`s${i}`} style={{ gap: 8, marginBottom: 8 }}>
              {row.map((k) => (
                <Key key={k} label={k.replace('(', '')} small onPress={() => press(k)} color={C.violet} />
              ))}
            </Row>
          ))}
          {BASIC.map((row, i) => (
            <Row key={i} style={{ gap: 8, marginBottom: 8 }}>
              {row.map((k) => (
                <Key
                  key={k} label={k} onPress={() => press(k)}
                  color={['÷', '×', '−', '+'].includes(k) ? C.accent : ['C', '⌫'].includes(k) ? C.danger : C.text}
                />
              ))}
            </Row>
          ))}
          <Pressable onPress={equals} style={st.equals}>
            <Text style={{ color: '#0A0F1E', fontSize: 26, fontWeight: '800' }}>=</Text>
          </Pressable>
        </View>
      </View>

      {/* history */}
      <Sheet visible={histSheet} onClose={() => setHistSheet(false)} title="History">
        {history.length === 0 ? (
          <Text style={{ color: C.textFaint }}>Past calculations appear here — tap one to reuse its result.</Text>
        ) : (
          history.map((h) => (
            <Pressable
              key={h.id} style={st.histRow}
              onPress={() => { if (h.result !== 'Error') { setExpr((e) => e + h.result); setHistSheet(false); } }}
            >
              <Text style={{ color: C.textDim, fontSize: 13 }} numberOfLines={1}>{h.expr}</Text>
              <Text style={{ color: h.result === 'Error' ? C.danger : C.text, fontSize: 16, fontWeight: '700' }} numberOfLines={1}>
                = {h.result}
              </Text>
            </Pressable>
          ))
        )}
        {history.length > 0 && (
          <PillButton label="Clear history" color={C.danger} outline onPress={clearCalcHistory} style={{ marginTop: 10 }} />
        )}
      </Sheet>
    </ScreenBG>
  );
}

function Key({ label, onPress, color, small }: { label: string; onPress: () => void; color: string; small?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[st.key, small && { paddingVertical: 10 }]}>
      <Text style={{ color, fontSize: small ? 15 : 22, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  display: {
    borderRadius: S.radius, borderWidth: 1, borderColor: C.border,
    backgroundColor: 'rgba(255,255,255,0.05)', padding: 16, marginBottom: 14,
  },
  modeBtn: { paddingVertical: 4, paddingHorizontal: 8 },
  expr: { color: C.text, fontSize: 32, fontWeight: '700', textAlign: 'right', fontVariant: ['tabular-nums'] },
  preview: { color: C.accent, fontSize: 16, textAlign: 'right', marginTop: 4, fontVariant: ['tabular-nums'] },
  key: {
    flex: 1, paddingVertical: 16, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: C.border,
  },
  equals: {
    paddingVertical: 14, borderRadius: 16, alignItems: 'center',
    backgroundColor: C.accent, marginBottom: 10,
  },
  histRow: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.border },
});
