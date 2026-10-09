import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, InteractionManager, useWindowDimensions } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { create, all } from 'mathjs';
import * as Clipboard from 'expo-clipboard';
import { C, F, MIN, NEU, S, T, TRACK, neuPressedInner, neuRaised } from '../theme';
import { useStore } from '../store';
import { ScreenBG, Sheet, Row, PillButton, Inset, Chip, IconBtn, NeuHeader, useTheme } from '../components/UI';
import { SegmentedControl } from '../components/SegmentedControl';
import { toast } from '../components/Toast';
import {
  ARRIVE, Bouncy, EASE_EXIT, EASE_OUT, FadeSwap, RISE_OUT, SINK_IN, glide, rowIn, rowOut, useAnimLevel, useBuilt,
} from '../components/Motion';
import { tick } from '../haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RAIL_W, TWO_COL_AT, WIDE_AT, WIDE_MAX } from '../layout';

// Precise engine: BigNumber arithmetic — 0.1 + 0.2 is exactly 0.3 here.
const math = create(all, { number: 'BigNumber', precision: 40 });

const M = math as any;

/** the largest factorial worked out: 10000! takes a few milliseconds, a million would hold the screen for seconds */
const MAX_FACTORIAL = 10000;

/** A sum the engine can read but the calculator will not answer: a factorial too large, or tan where it has no value. */
const unfit = (kind: 'large' | 'undefined') => Object.assign(new Error(kind), { unfit: kind });

// Built on first use, not when the module loads: the module loads with the app (a tab slot can hold the calculator),
// and the first evaluation builds mathjs's parser, which would add to every cold start.
let engine: { d2r: any; r2d: any; tiny: any } | null = null;
function ready() {
  if (engine) return engine;
  const factorial = M.factorial;
  // the ! operator reads the engine's own factorial, so the limit sits there and covers (5000+6000)! as well
  math.import({
    factorial: (x: any) => {
      if (M.isBigNumber(x) ? x.gt(MAX_FACTORIAL) : x > MAX_FACTORIAL) throw unfit('large');
      return factorial(x);
    },
  }, { override: true });
  engine = { d2r: math.evaluate('pi / 180'), r2d: math.evaluate('180 / pi'), tiny: M.bignumber('1e-30') };
  return engine;
}

/**
 * sin, cos and tan of an exact angle land on 0 rather than on what the 40-digit pi leaves over (sin 180 is 0, not
 * 1.7e-40). Compared with decimal.js itself: mathjs's own comparisons count anything within 1e-15 as equal.
 */
function snap(v: any) {
  return M.isBigNumber(v) && v.abs().lt(ready().tiny) ? M.bignumber(0) : v;
}

function makeScope(deg: boolean, ans: any) {
  const { d2r, r2d } = ready();
  const rad = (x: any) => (deg ? M.multiply(x, d2r) : x);
  const scope: Record<string, any> = {
    Ans: ans ?? 0,
    sin: (x: any) => snap(M.sin(rad(x))),
    cos: (x: any) => snap(M.cos(rad(x))),
    // tan 90 has no value: its cos is 0 there, where the engine would give a huge number instead
    tan: (x: any) => {
      const r = rad(x);
      const c = snap(M.cos(r));
      if (M.isBigNumber(c) && c.isZero()) throw unfit('undefined');
      return snap(M.tan(r));
    },
  };
  if (deg) {
    scope.asin = (x: any) => M.multiply(M.asin(x), r2d);
    scope.acos = (x: any) => M.multiply(M.acos(x), r2d);
    scope.atan = (x: any) => M.multiply(M.atan(x), r2d);
  }
  return scope;
}

function toEngine(expr: string): string {
  return expr
    // ×10^ makes one number, as on any scientific calculator: 1÷6.02×10^23 divides by the whole of 6.02×10^23
    .replace(/(\d+(?:\.\d*)?|\.\d+)×10\^([−-]?\d+)/g, (_, m: string, x: string) => '(' + m + 'e' + x.replace('−', '-') + ')')
    .replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-')
    .replace(/π/g, 'pi').replace(/√\(/g, 'sqrt(');
}

/** Every bracket a sum leaves open is closed at its end: each function key types its own, as on a scientific calculator. */
function closeBrackets(s: string): string {
  let open = 0;
  for (const ch of s) {
    if (ch === '(') open++;
    else if (ch === ')' && open > 0) open--;
  }
  return open > 0 ? s + ')'.repeat(open) : s;
}

/** A sum that is only a number: it has nothing to preview, and "=" on it has nothing to answer. */
const BARE = /^[−-]?(\d+\.?\d*|\.\d+)(×10\^[−-]?\d+)?$/;

/** An answer from the engine, in plain digits and e-notation (what is copied). Big and small answers only go to e-notation past 10^14 and 10^-9. */
function fmt(v: any, sciNotation: boolean): string {
  return sciNotation
    // 1.2e+5, not 1.20000000000e+5
    ? math.format(v, { notation: 'exponential', precision: 12 }).replace(/\.?0+e/, 'e')
    : math.format(v, { precision: 14, lowerExp: -9, upperExp: 14 });
}

/** An answer as the keypad writes it: its minus sign and its ×10^, not a hyphen and e-notation. */
function shown(ascii: string): string {
  return ascii.replace(/-/g, '−').replace(/e\+?(−?\d+)$/, '×10^$1');
}

/** A sum or an answer as a screen reader says it: the keypad's signs read as words. */
function spoken(s: string): string {
  return s
    .replace(/×10\^/g, ' times ten to the power ').replace(/×/g, ' times ').replace(/÷/g, ' divided by ')
    .replace(/[−-]/g, ' minus ').replace(/\+/g, ' plus ').replace(/\^/g, ' to the power ')
    .replace(/√/g, 'square root ').replace(/π/g, 'pi')
    .replace(/\s+/g, ' ').trim();
}

/** What "=" says instead of an answer. */
const FAIL = {
  zero: "Can't divide by zero",
  real: 'No real answer',
  bracket: 'Missing a bracket',
  large: 'Too large',
  other: "Can't evaluate",
};

/** The operators between two numbers: one typed after another takes its place. */
const BINARY = ['+', '−', '×', '÷', '^', ' mod '];
/** The keys that carry on from an answer rather than starting a new sum. */
const CONTINUE = [...BINARY, '!', '%', '×10^'];
/** What ⌫ takes away whole: a function's name with its bracket, the spaced mod, the exponent key. Longest first. */
const TOKENS = ['asin(', 'acos(', 'atan(', 'sin(', 'cos(', 'tan(', 'abs(', 'log(', 'ln(', '√(', ' mod ', '×10^', 'π'];

/**
 * The calculator as it was left, in memory only (a sum is never saved): a page closed and opened again comes back with
 * its sum, its answer and its switches. `fromAns` marks a sum that carries on from the answer at its start.
 */
const kept = {
  expr: '', justEvaluated: false, fromAns: false, ans: null as any, ansText: '', ansAscii: '',
  deg: true, sci: false, sciNotation: false,
};
type Sum = Pick<typeof kept, 'expr' | 'justEvaluated' | 'fromAns' | 'ans' | 'ansText' | 'ansAscii'>;

type Outcome = { value: any; ascii: string; text: string } | { fail: string };

/** a wide window's calculator column: a keypad with a phone's proportions, larger */
const CALC_MAX = 480;
/** a wide window's key heights: fitted to the room, within these */
const KEY_MIN = 44;
const KEY_MAX = 88;
/** a phone too short for its keypad as it is fits the keys to the room, no lower than this; below it the keypad scrolls */
const KEY_MIN_PHONE = 40;
/** the text face's line is 1.3 of its size, and a little more on Android: a key's own height is its padding and one line */
const LINE = 1.35;
/** how far a key's label follows a large system font: further and it would no longer fit a fitted key */
const KEY_SCALE_MAX = 1.3;
/** how long a key is held before its long press (⌫ clears, = copies): the same half second a press had before */
const LONG_PRESS_MS = 500;
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
// ^ is on the number pad already, so the functions have % in its place (50% is 0.5, 100+20% is 120). Labels stay plain:
// Geist has no superscript minus or x and y, so sin⁻¹ or xʸ would be drawn in another face
const SCI: string[][] = [
  ['sin(', 'cos(', 'tan(', '√('],
  ['asin(', 'acos(', 'atan(', '%'],
  ['ln(', 'log(', 'π', 'e'],
  ['!', '×10^', 'abs(', 'mod'],
];
const OPS = ['÷', '×', '−', '+'];

/** What a screen reader says for a key whose label is a sign; a digit says itself. */
const KEY_SPEECH: Record<string, string> = {
  C: 'Clear', '⌫': 'Delete', '(': 'Open bracket', ')': 'Close bracket', '.': 'Point',
  '÷': 'Divide', '×': 'Times', '−': 'Minus', '+': 'Plus', '^': 'Power', '%': 'Percent',
  'sin(': 'Sine', 'cos(': 'Cosine', 'tan(': 'Tangent', '√(': 'Square root',
  'asin(': 'Inverse sine', 'acos(': 'Inverse cosine', 'atan(': 'Inverse tangent',
  'ln(': 'Natural log', 'log(': 'Log', 'π': 'Pi', '!': 'Factorial', '×10^': 'Times ten to the power', 'abs(': 'Absolute value', mod: 'Modulo',
};

/**
 * The height a phone's keypad takes with every key at its own padding (see the keys and the equals key below). The
 * labels grow with the system font, as far as KEY_SCALE_MAX, and the keys with them.
 */
function naturalPadH(sci: boolean, scale: number) {
  const line = LINE * scale;
  const gap = sci ? 6 : 8;
  const key = 2 * (sci ? 11 : 16) + 22 * line;
  const fn = 2 * 8 + 15 * line;
  const equals = 2 * (sci ? 10 : 14) + 26 * line + 10;
  return BASIC.length * (key + gap) + (sci ? SCI.length * (fn + 6) : 0) + equals;
}

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
  const { width, height, fontScale } = useWindowDimensions();
  // the keypad's box, measured to fit the keys to it, and the window it was measured in
  const [pad, setPad] = useState({ w: 0, h: 0, at: '' });
  const pushCalc = useStore((s) => s.pushCalc);
  const history = useStore((s) => s.calcHistory);
  const clearCalcHistory = useStore((s) => s.clearCalcHistory);

  // everything starts as it was left (see kept)
  const [expr, setExpr] = useState(kept.expr);
  const [deg, setDeg] = useState(kept.deg);
  const [sci, setSci] = useState(kept.sci);
  const [sciNotation, setSciNotation] = useState(kept.sciNotation);
  const [histSheet, setHistSheet] = useState(false);
  const [justEvaluated, setJustEvaluated] = useState(kept.justEvaluated);
  // the sum as the keys read and write it: a key reads this rather than the last render, since two thumbs can press
  // twice before the screen has rendered once
  const live = useRef<Sum>({
    expr: kept.expr, justEvaluated: kept.justEvaluated, fromAns: kept.fromAns,
    ans: kept.ans, ansText: kept.ansText, ansAscii: kept.ansAscii,
  });
  // "=" on an expression that cannot be evaluated says why where the answer would be, briefly
  const [evalError, setEvalError] = useState<string | null>(null);
  const errTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (errTimer.current) clearTimeout(errTimer.current); }, []);

  // the engine is built once the screen has settled, so the first key pressed does not wait for it
  useEffect(() => {
    const job = InteractionManager.runAfterInteractions(() => {
      try { math.evaluate('1 + 1', makeScope(true, null)); } catch { /* the first key builds it instead */ }
    });
    return () => job.cancel();
  }, []);

  // on equals, the answer lifts from the preview line into the main one. The line is keyed on each answer, so the rise
  // runs as the answer mounts (a shared value set beforehand moved the old sum for a frame first)
  const level = useAnimLevel();
  const [answers, setAnswers] = useState(0);

  /** Sets the sum. It carries on from the answer while it still starts with the answer and an operator follows it. */
  const write = useCallback((next: string, evaluated: boolean, fromAns = live.current.fromAns) => {
    const s = live.current;
    const after = next[s.ansText.length];
    s.fromAns = fromAns && !evaluated && next.startsWith(s.ansText) && after !== undefined && !/[\d.]/.test(after);
    s.expr = next;
    s.justEvaluated = evaluated;
    Object.assign(kept, s);
    setExpr(next);
    setJustEvaluated(evaluated);
  }, []);

  const evalExpr = (raw: string) => {
    const s = live.current;
    // a sum that carries on from an answer works from the answer itself, all 40 digits of it, rather than the 14 the
    // display shows: 1÷3 = then ×3 = is 1, not 0.99999999999999
    let src = s.fromAns && raw.startsWith(s.ansText) ? 'Ans' + raw.slice(s.ansText.length) : raw;
    // keypad: ln( = natural log, log( = base-10. mathjs: log( = natural, log10( = base-10.
    src = src.replace(/ln\(/g, '__LN__(').replace(/log\(/g, 'log10(').replace(/__LN__\(/g, 'log(');
    return math.evaluate(toEngine(src), makeScope(deg, s.ans));
  };

  /** A sum's answer, or what keeps it from having one. */
  const solve = (sum: string): Outcome => {
    try {
      const raw = evalExpr(sum);
      const v = typeof raw === 'number' ? M.bignumber(raw) : raw;
      // √(−4) and ln(−1) come back complex, 1÷0 infinite, 0÷0 and asin(2) NaN: none of them is an answer to show,
      // to keep in the history or to carry on from
      if (M.isComplex(v)) return { fail: FAIL.real };
      if (!M.isBigNumber(v)) return { fail: FAIL.other };
      if (!v.isFinite()) {
        if (sum.includes('÷')) return { fail: FAIL.zero };
        return { fail: v.isNaN() && /a(sin|cos)\(/.test(sum) ? FAIL.real : FAIL.other };
      }
      const ascii = fmt(v, sciNotation);
      return { value: v, ascii, text: shown(ascii) };
    } catch (err: any) {
      if (err?.unfit === 'large') return { fail: FAIL.large };
      // open brackets are closed before this, so a bracket still wrong is a closing one with no opening
      return { fail: sum.split(')').length > sum.split('(').length ? FAIL.bracket : FAIL.other };
    }
  };

  const outcome = useMemo(() => {
    const sum = closeBrackets(expr);
    return sum.trim() ? solve(sum) : null;
  }, [expr, deg, sciNotation]);
  const answer = outcome && 'text' in outcome ? outcome : null;
  // the preview adds something once there is an operation: under a bare number it would only repeat it
  const preview = answer && !BARE.test(expr) ? answer.text : '';
  const answerRef = useRef(answer);
  answerRef.current = answer;

  const press = (key: string) => {
    const k = key === 'mod' ? ' mod ' : key;
    const s = live.current;
    setEvalError(null);
    if (k === 'C') { write('', false, false); return; }
    if (k === '⌫') {
      // a function's name, mod and ×10^ go whole, leaving no "si" or " mo" behind. Cutting into an answer makes it
      // ordinary digits, which the next key adds to rather than replaces
      const t = TOKENS.find((x) => s.expr.endsWith(x));
      write(s.expr.slice(0, s.expr.length - (t ? t.length : 1)), false);
      return;
    }
    if (s.justEvaluated) {
      // an operator carries on from the answer; anything else starts a new sum
      if (!CONTINUE.includes(k)) { write(k, false, false); return; }
      // a negative answer raised to a power is bracketed, since that is how Ans takes it: −3 then ^2 reads (−3)^2, 9
      if (k === '^' && s.ansText.startsWith('−')) s.ansText = '(' + s.ansText + ')';
      write(s.ansText + k, false, true);
      return;
    }
    let e = s.expr;
    // a second point in one number would leave a sum that cannot be read
    if (k === '.' && /\d*\.\d*$/.test(e)) return;
    if (BINARY.includes(k)) {
      // a sum starts with a number or a sign, never with ×, ÷, ^ or mod
      if (!e && k !== '−') return;
      const end = (x: string) => ['×10^', ...BINARY].find((op) => x.endsWith(op));
      const op = end(e);
      // a minus after an operator is a sign (5×−3, 6.02×10^−23), and a second one adds nothing
      if (k === '−') {
        if (op === '−') return;
      } else {
        // any other operator after one takes its place, with a sign that followed it
        for (let o = op; o; o = end(e)) e = e.slice(0, e.length - o.length);
      }
    }
    write(e + k, false);
  };

  const fail = (why: string) => {
    setEvalError(why);
    if (errTimer.current) clearTimeout(errTimer.current);
    errTimer.current = setTimeout(() => setEvalError(null), 1200);
  };

  const equals = () => {
    const s = live.current;
    // an answer on screen is answered already: no second history row and no second rise
    if (s.justEvaluated || !s.expr.trim()) return;
    const sum = closeBrackets(s.expr);
    const r = solve(sum);
    // no "Error" row in the history: the expression stays, and the preview line says what is wrong
    if ('fail' in r) { fail(r.fail); return; }
    // "7 = 7" says nothing, and the history holds 100 sums
    if (BARE.test(sum) && r.text === sum) return;
    s.ans = r.value;
    s.ansText = r.text;
    s.ansAscii = r.ascii;
    pushCalc(sum, r.text);
    write(r.text, true, false);
    setAnswers((n) => n + 1);
  };

  // long press on "=": the answer in plain digits and e-notation, which any other app can read
  const copyAnswer = useCallback(async () => {
    const s = live.current;
    const out = s.justEvaluated ? s.ansAscii : answerRef.current?.ascii;
    if (!out) return;
    await Clipboard.setStringAsync(out);
    tick();
    // a haptic only answers at full motion: the copy says so in words too
    toast('Copied ' + out);
  }, []);

  const setAngle = (k: string) => {
    kept.deg = k === 'deg';
    setDeg(kept.deg);
  };

  const toggleNotation = () => {
    const next = !sciNotation;
    kept.sciNotation = next;
    setSciNotation(next);
    // an answer on screen takes the new notation at once, worked from the answer itself rather than its shown digits
    const s = live.current;
    if (s.justEvaluated && s.ans != null) {
      s.ansAscii = fmt(s.ans, next);
      s.ansText = shown(s.ansAscii);
      write(s.ansText, true, false);
    }
  };

  // Opening or closing the functions changes every key's size and the rows' gaps. The keypad dips out, changes while
  // it cannot be seen, and comes back, so only its opacity moves; with no motion it simply changes.
  const padFade = useSharedValue(1);
  const padFadeStyle = useAnimatedStyle(() => ({ opacity: padFade.value }));
  const dipping = useRef(false);
  // counts the flips made while dipped, so the keypad comes back up once the flip has rendered
  const [flips, setFlips] = useState(0);
  const setFns = useCallback((on: boolean) => {
    kept.sci = on;
    setSci(on);
    setFlips((n) => n + 1);
  }, []);
  const toggleFns = () => {
    if (dipping.current) return;
    if (level === 'none') { kept.sci = !sci; setSci(!sci); return; }
    dipping.current = true;
    const next = !sci;
    padFade.value = withTiming(0, { duration: 110, easing: EASE_EXIT }, () => { runOnJS(setFns)(next); });
  };
  useEffect(() => {
    if (!flips) return;
    // the keys have their new sizes: the keypad comes back up
    dipping.current = false;
    padFade.value = withTiming(1, { duration: 200, easing: EASE_OUT });
  }, [flips]);

  // A phone with room for its keypad keeps it exactly as it was. A wide window sets the calculator in a column of its own
  // width with keys fitted to the height it has; a sideways tablet sets the display, the controls and the history on
  // the left and the keypad on the right. A phone too short for its keys (a 360 x 640 screen, the tab bar and the
  // functions taking their share) fits them to the room it has the same way.
  const wide = width >= WIDE_AT;
  const split = wide && width > height && width - (mode === 'tab' ? RAIL_W : 0) >= TWO_COL_AT;
  // the keys' labels follow a large system font as far as KEY_SCALE_MAX, and the keys' natural heights with them
  const scale = Math.min(fontScale, KEY_SCALE_MAX);
  const at = `${width}x${height}@${fontScale}`;
  // A phone whose keys have to be fitted to their room sets the display closer first (less padding, a smaller sum), and
  // only a keypad too tall even then scrolls. That is read from the keypad's measured room, not the window's height, so
  // a tab slot's bar counts; once chosen it holds for this window and this keypad, so the room the closer display
  // gives back never talks it out of it.
  const [closer] = useState(() => new Set<string>());
  const closerKey = at + (sci ? '+fn' : '');
  if (!wide && pad.h > 0 && pad.at === at && pad.h < naturalPadH(sci, scale)) closer.add(closerKey);
  const compact = !wide && closer.has(closerKey);
  const rows = BASIC.length + (sci ? SCI.length * SCI_SHARE : 0);
  const gaps = sci ? (SCI.length + BASIC.length) * 6 : BASIC.length * 8;
  const eqH = sci ? EQ_H_SCI : EQ_H;
  const fitted = pad.h > 0 && (wide || pad.h < naturalPadH(sci, scale));
  const keyMin = wide ? KEY_MIN : KEY_MIN_PHONE;
  const keyH = fitted
    ? Math.floor(Math.max(keyMin, Math.min(KEY_MAX, (pad.w - 24) / 4, (pad.h - gaps - eqH - 10) / rows)))
    : undefined;

  // every key goes through one stable handler, so a keypress re-renders the display and not the thirty keys
  const pressRef = useRef(press);
  pressRef.current = press;
  const onKey = useCallback((k: string) => pressRef.current(k), []);
  const clearAll = useCallback(() => { tick(); pressRef.current('C'); }, []);
  const equalsRef = useRef(equals);
  equalsRef.current = equals;
  const onEquals = useCallback(() => { tick(); equalsRef.current(); }, []);

  // A long sum steps its size down on a phone, so most stay on one or two lines. A stepped line keeps the height of an
  // ordinary one, so the display, and the keys fitted under it, do not change size as the sum steps down.
  const baseSize = compact ? 30 : 34;
  const exprSize = wide ? baseSize : Math.min(baseSize, expr.length >= 18 ? 24 : expr.length >= 12 ? 28 : baseSize);
  const lineFor = `${baseSize}@${fontScale}`;
  const lineH = useRef<Record<string, number>>({});
  const dispScroll = useRef<ScrollView>(null);
  const onDisplaySize = (_w: number, h: number) => {
    if (exprSize === baseSize && h > 0 && !(h >= lineH.current[lineFor])) lineH.current[lineFor] = h;
    // what is being typed stays in sight: the display follows the end of a sum that has outgrown it
    dispScroll.current?.scrollToEnd({ animated: false });
  };

  // the line under the sum, and what a screen reader says as it changes: the answer as it is worked out, or why not
  const line = evalError ?? (justEvaluated ? ' ' : preview ? `= ${preview}` : ' ');
  const lineSaid = evalError ?? (justEvaluated ? 'Equals ' + spoken(expr) : preview ? 'Equals ' + spoken(preview) : undefined);

  const display = (
    // display — carved into the material
    <Inset pad={compact ? 12 : 16} style={{ borderRadius: S.radius, marginBottom: compact ? 8 : 12, overflow: 'visible' }}>
      <ScrollView
        ref={dispScroll}
        style={{ maxHeight: split ? 140 : compact ? 78 : 90, minHeight: exprSize < baseSize ? lineH.current[lineFor] : undefined }}
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' }}
        onContentSizeChange={onDisplaySize}
      >
        <Animated.Text
          key={answers}
          entering={answers > 0 && level !== 'none' ? answerIn(level === 'full') : undefined}
          style={[st.expr, { fontSize: exprSize }]}
          selectable
        >
          {expr || '0'}
        </Animated.Text>
      </ScrollView>
      {/* what is wrong dips in over the preview and back out, instead of flashing */}
      <FadeSwap swapKey={evalError ? 'error ' + evalError : 'preview'}>
        <Text
          style={[st.preview, { color: evalError ? C.danger : C.accent }]} numberOfLines={1}
          accessibilityLiveRegion="polite" accessibilityLabel={lineSaid}
        >
          {line}
        </Text>
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
          onChange={setAngle}
          style={{ marginRight: 8, marginBottom: 8 }}
        />
        {/* how answers are written, not which keys show: so it says so, in the one accent */}
        <Chip small label="Sci notation" active={sciNotation} onPress={toggleNotation} />
        <Chip small icon="grid-outline" label="Functions" active={sci} onPress={toggleFns} />
      </Row>
      {split ? null : <IconBtn name="time-outline" size={20} pad={6} onPress={() => setHistSheet(true)} accessibilityLabel="History" />}
    </Row>
  );

  // a keypad fitted to its height that is too short for them even at the smallest keys scrolls instead of pushing over the
  // display; it rests at its foot, where the digits and the equals key are, and the functions are a scroll up
  const cramped = fitted && (pad.h - gaps - eqH - 10) / rows < keyMin;
  const padScroll = useRef<ScrollView>(null);
  // each key reaches half way into the gap above and below it, so a press that lands between two rows still counts
  const rowGap = sci ? 6 : 8;
  const keyRows = (
    <>
      {/* the functions take their rows above the number keys, which tighten to make room; both change while the
          keypad is dipped out of sight (see toggleFns) */}
      {sci && (
        <View>
          {SCI.map((row, i) => (
            <Row key={`s${i}`} style={{ gap: 8, marginBottom: 6 }}>
              {row.map((k) => (
                <Key
                  key={k} label={k.replace('(', '')} value={k} pad={8} small onKey={onKey} color={C.accent}
                  height={keyH ? Math.round(keyH * SCI_SHARE) : undefined} slop={3}
                />
              ))}
            </Row>
          ))}
        </View>
      )}
      {BASIC.map((row, i) => (
        <Row key={i} style={{ gap: 8, marginBottom: rowGap }}>
          {row.map((k) => (
            <Key
              key={k} label={k} value={k} pad={sci ? 11 : 16} onKey={onKey}
              onLongPress={k === '⌫' ? clearAll : undefined}
              icon={k === '⌫' ? 'backspace-outline' : undefined}
              color={OPS.includes(k) ? C.accent : k === 'C' || k === '⌫' ? C.danger : C.text}
              height={keyH} slop={rowGap / 2}
            />
          ))}
        </Row>
      ))}
      <Press
        onPress={onEquals}
        onLongPress={copyAnswer}
        radius={16}
        scaleTo={0.96}
        slop={rowGap / 2}
        label="Equals"
        hint="Hold to copy"
        style={[
          st.equals,
          sci && { paddingVertical: 10 },
          (wide || fitted) && { height: eqH, paddingVertical: 0, justifyContent: 'center' },
          theme === 'minimal'
            ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: C.accent }
            : { backgroundColor: C.accent, ...NEU.raisedMid },
        ]}
      >
        <Text
          maxFontSizeMultiplier={KEY_SCALE_MAX}
          style={{ color: theme === 'minimal' ? C.accent : C.onAccent, fontSize: 26, letterSpacing: TRACK.large, fontFamily: F.semi }}
        >
          =
        </Text>
      </Press>
    </>
  );
  // keys: rows tighten when the sci pad is out so everything fits. The box is measured: a wide window or a short phone
  // fits its keys to it
  const keypad = (
    <Animated.View
      style={[{ flex: 1 }, padFadeStyle]}
      onLayout={(e) => {
        const { width: w, height: h } = e.nativeEvent.layout;
        if (Math.abs(w - pad.w) > 0.5 || Math.abs(h - pad.h) > 0.5 || pad.at !== at) setPad({ w, h, at });
      }}
    >
      {cramped ? (
        <ScrollView
          ref={padScroll} style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' }}
          onContentSizeChange={() => padScroll.current?.scrollToEnd({ animated: false })}
        >
          {keyRows}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>{keyRows}</View>
      )}
    </Animated.View>
  );

  // A past result becomes the sum when there is none, or only an answer; otherwise it joins the sum as a number of its
  // own, after a × where it would run into a number, and in brackets when it is negative
  const reuse = useCallback((result: string) => {
    const s = live.current;
    const r = shown(result); // results kept before answers used the keypad's own signs
    if (!s.expr || s.justEvaluated) write(r, false, false);
    else write(s.expr + (/[\d.)πe!%]$/.test(s.expr) ? '×' : '') + (r.startsWith('−') ? '(' + r + ')' : r), false);
    setEvalError(null);
    setHistSheet(false);
  }, [write]);
  const historyRows = <HistoryRows history={history} onPick={reuse} />;
  const historyEmpty = (
    <Text style={{ color: C.textFaint, fontFamily: F.reg, fontSize: 13, letterSpacing: TRACK.small }}>Past calculations appear here. Tap one to reuse its result.</Text>
  );

  // Clearing the history can be taken back while its toast is up. From the sheet the toast waits for the sheet to have
  // closed, since a toast under a sheet is covered by it.
  const afterSheet = useRef<(() => void) | null>(null);
  const clearHistory = useCallback((fromSheet: boolean) => {
    const before = useStore.getState().calcHistory;
    if (!before.length) return;
    clearCalcHistory();
    const say = () => toast('History cleared', {
      label: 'Undo',
      onPress: () => {
        // sums worked out since then stay on top
        const now = useStore.getState().calcHistory;
        const ids = new Set(now.map((h) => h.id));
        useStore.setState({ calcHistory: [...now, ...before.filter((h) => !ids.has(h.id))].slice(0, HISTORY_MAX) });
      },
    });
    if (fromSheet) {
      afterSheet.current = say;
      setHistSheet(false);
    } else say();
  }, [clearCalcHistory]);

  const bodyPad = { padding: S.pad, paddingTop: 8, paddingBottom: S.pad + (mode === 'tab' ? 0 : insets.bottom) };

  return (
    <ScreenBG guard={mode === 'tab'} maxWidth={split ? WIDE_MAX : CALC_MAX}>
      {/* a full-screen tool: the bar only, its title always showing, with no hero to push the keypad down */}
      <NeuHeader title="Calculator" variant={mode === 'tab' ? 'tab' : 'page'} />
      {split ? (
        <View style={[st.split, bodyPad]}>
          <View style={st.splitSide}>
            {display}
            {controls}
            <View style={st.histHead}>
              <Text style={T.kicker}>History</Text>
              {history.length > 0 ? (
                <Bouncy onPress={() => clearHistory(false)} scaleTo={0.92} radius={8} hitSlop={12} accessibilityRole="button" accessibilityLabel="Clear history">
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
      <Sheet
        visible={histSheet} onClose={() => setHistSheet(false)} title="History"
        onClosed={() => { const run = afterSheet.current; afterSheet.current = null; run?.(); }}
      >
        {history.length === 0 ? historyEmpty : historyRows}
        {history.length > 0 && (
          <PillButton label="Clear history" color={C.danger} outline onPress={() => clearHistory(true)} style={{ marginTop: 10 }} />
        )}
      </Sheet>
    </ScreenBG>
  );
}

/** how many past sums the store keeps (see pushCalc) */
const HISTORY_MAX = 100;
/** the rows a list is built with; the rest follow once a sheet has risen, so a long history never holds up its rise */
const FIRST_ROWS = 30;

/**
 * Past sums, newest first. One that arrives while the list is in view (a split screen's history) fades in above the
 * rest as they glide down; clearing lets them fade together. A list that opens (the sheet) is simply there.
 */
const HistoryRows = React.memo(function HistoryRows({ history, onPick }: {
  history: { id: string; expr: string; result: string }[]; onPick: (result: string) => void;
}) {
  const level = useAnimLevel();
  const built = useBuilt();
  const [all, setAll] = useState(history.length <= FIRST_ROWS);
  useEffect(() => {
    if (all) return undefined;
    const t = setTimeout(() => setAll(true), ARRIVE.duration + 40);
    return () => clearTimeout(t);
  }, [all]);
  const enter = built.current ? rowIn(level) : undefined;
  return (
    <>
      {(all ? history : history.slice(0, FIRST_ROWS)).map((h, i) => (
        // the rows added after the rise are out of sight below the first ones: they need no fade
        <Animated.View key={h.id} entering={i < FIRST_ROWS ? enter : undefined} exiting={rowOut(level)} layout={glide(level)}>
          <Bouncy
            style={st.histRow} radius={14} scaleTo={0.98}
            onPress={() => { if (h.result !== 'Error') onPick(h.result); }}
            accessibilityRole="button"
            accessibilityLabel={spoken(h.expr) + ' equals ' + spoken(h.result) + ', reuse result'}
          >
            <Text style={{ color: C.textDim, fontFamily: F.reg, fontSize: 13, letterSpacing: TRACK.small }} numberOfLines={1}>{h.expr}</Text>
            <Text style={{ color: h.result === 'Error' ? C.danger : C.text, fontSize: 16, letterSpacing: TRACK.title, fontFamily: F.semi }} numberOfLines={1}>
              = {h.result}
            </Text>
          </Bouncy>
        </Animated.View>
      ))}
    </>
  );
});

const TAP_ACTIONS = [{ name: 'activate' }];
const HOLD_ACTIONS = [{ name: 'activate' }, { name: 'longpress' }];

/**
 * A keypad key's press. Each key has a tap of its own, so two thumbs pressing two keys at once both type: on the old
 * keys one press held the screen's only responder until every finger was up, and the second key was lost. It sinks and
 * carves in while held, as every press in the app does (nothing moves with no motion), and a long press, when there is
 * one, takes over after half a second. A screen reader activates it as a button.
 */
function Press({ onPress, onLongPress, slop, radius, scaleTo, style, label, hint, children }: {
  onPress: () => void; onLongPress?: () => void;
  /** how far above and below the key a press still counts */
  slop: number;
  radius: number; scaleTo: number; style: any; label?: string; hint?: string; children: React.ReactNode;
}) {
  const level = useAnimLevel();
  const still = level === 'none';
  const p = useSharedValue(0); // 0 = rest, 1 = pressed
  // set while a long press holds the key down, so the tap it cancelled does not lift it early
  const held = useSharedValue(false);
  const sinkStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - (1 - scaleTo) * p.value }, { translateY: p.value * 1.5 }] as const,
  }));
  const carveStyle = useAnimatedStyle(() => ({ opacity: p.value }));
  const tapRef = useRef(onPress);
  tapRef.current = onPress;
  const holdRef = useRef(onLongPress);
  holdRef.current = onLongPress;
  const fire = useCallback(() => tapRef.current(), []);
  const fireHold = useCallback(() => holdRef.current?.(), []);
  const holds = !!onLongPress;
  const gesture = useMemo(() => {
    const tap = Gesture.Tap()
      // a slow press still types its key, as it did before
      .maxDuration(60000)
      .shouldCancelWhenOutside(true)
      .hitSlop({ vertical: slop })
      .onBegin(() => {
        'worklet';
        if (!still) p.value = withTiming(1, SINK_IN);
      })
      .onEnd((_e, success) => {
        'worklet';
        if (success) runOnJS(fire)();
      })
      .onFinalize(() => {
        'worklet';
        if (!still && !held.value) p.value = withSpring(0, RISE_OUT);
      });
    if (!holds) return tap;
    const hold = Gesture.LongPress()
      .minDuration(LONG_PRESS_MS)
      .hitSlop({ vertical: slop })
      .onStart(() => {
        'worklet';
        held.value = true;
        if (!still) p.value = withTiming(1, SINK_IN);
        runOnJS(fireHold)();
      })
      .onFinalize(() => {
        'worklet';
        if (!held.value) return;
        held.value = false;
        if (!still) p.value = withSpring(0, RISE_OUT);
      });
    return Gesture.Exclusive(hold, tap);
  }, [still, slop, holds, fire, fireHold]);
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        accessible
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={hint}
        accessibilityActions={holds ? HOLD_ACTIONS : TAP_ACTIONS}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'activate') fire();
          else if (e.nativeEvent.actionName === 'longpress') fireHold();
        }}
        style={[style, sinkStyle]}
      >
        {children}
        {/* pressed state = the kit's carved inner panel, not a flat dim */}
        <Animated.View
          pointerEvents="none"
          style={[st.carve, { backgroundColor: C.pressDim, borderRadius: radius, ...neuPressedInner() }, carveStyle]}
        />
      </Animated.View>
    </GestureDetector>
  );
}

/** Raised neumorphic key — sinks + carves in on press, with a haptic tick. Memoised: a keypress re-renders no key. */
const Key = React.memo(function Key({ label, value, onKey, onLongPress, color, small, pad, height, icon, slop }: {
  label: string;
  /** what the key types, handed to `onKey` */
  value: string;
  onKey: (k: string) => void; onLongPress?: () => void; color: string; small?: boolean; pad?: number;
  /** a wide window's key height, fitted to the room; a phone's key takes its height from its padding */
  height?: number;
  /** drawn in place of the label: Geist has no ⌫, which would come from another face */
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  slop: number;
}) {
  const theme = useTheme();
  const size = small ? 15 : 22;
  return (
    <Press
      onPress={() => { tick(); onKey(value); }}
      onLongPress={onLongPress}
      radius={16}
      scaleTo={0.94}
      slop={slop}
      label={KEY_SPEECH[value]}
      hint={value === '⌫' ? 'Hold to clear all' : undefined}
      style={[
        st.key,
        height ? { height, paddingVertical: 0 } : { paddingVertical: pad ?? (small ? 10 : 16) },
        theme === 'minimal'
          ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: MIN.border }
          : { backgroundColor: C.card, ...neuRaised('low') },
      ]}
    >
      {icon ? (
        <Ionicons name={icon} size={size} color={color} maxFontSizeMultiplier={KEY_SCALE_MAX} />
      ) : (
        <Text
          maxFontSizeMultiplier={KEY_SCALE_MAX}
          style={{ color, fontSize: size, fontFamily: F.med, letterSpacing: small ? TRACK.body : TRACK.large }}
        >
          {label}
        </Text>
      )}
    </Press>
  );
});

const st = StyleSheet.create({
  expr: { color: C.text, fontSize: 34, letterSpacing: TRACK.display, fontFamily: F.semi, textAlign: 'right', fontVariant: ['tabular-nums'] },
  preview: { fontSize: 16, letterSpacing: TRACK.body, fontFamily: F.reg, textAlign: 'right', marginTop: 4, fontVariant: ['tabular-nums'] },
  key: {
    flex: 1, paddingVertical: 16, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
  },
  equals: {
    paddingVertical: 14, borderRadius: 16, alignItems: 'center', marginBottom: 10,
  },
  carve: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  histRow: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  split: { flex: 1, flexDirection: 'row', gap: 28 },
  splitSide: { flex: 1, minWidth: 0 },
  splitPad: { width: SPLIT_PAD_W },
  histHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, marginBottom: 6 },
  histClear: { color: C.danger, fontFamily: F.semi, fontSize: 13, letterSpacing: TRACK.small },
});
