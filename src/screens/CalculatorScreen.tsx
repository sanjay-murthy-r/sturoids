import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView, InteractionManager, useWindowDimensions } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { C, F, MIN, NEU, S, T, TRACK, neuPressedInner, neuRaised, oneLine } from '../theme';
import { useStore } from '../store';
import { ScreenBG, Sheet, Row, PillButton, Inset, Chip, IconBtn, NeuHeader, useTheme } from '../components/UI';
import { SegmentedControl } from '../components/SegmentedControl';
import { toast } from '../components/Toast';
import {
  ARRIVE, Bouncy, EASE_EXIT, EASE_OUT, FadeSwap, RISE_OUT, SINK_IN, glide, rowIn, rowOut, useAnimLevel, useBuilt,
} from '../components/Motion';
import { tick } from '../haptics';
import { M, closeBrackets, fmt, makeScope, math, shown, toEngine } from '../calcEngine';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RAIL_W, TWO_COL_AT, WIDE_AT, WIDE_MAX } from '../layout';
import { useRail } from '../hooks/useRail';

/** A sum that is only a number: it has nothing to preview, and "=" on it has nothing to answer. */
const BARE = /^[−-]?(\d+\.?\d*|\.\d+)(×10\^[−-]?\d+)?$/;

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
 * The sum as it was left, in memory only (a sum is never saved): a page closed and opened again comes back with its sum
 * and its answer. The switches (DEG or RAD, the functions, the notation) are settings, kept for good. `fromAns` marks a
 * sum that carries on from the answer at its start.
 */
const kept = {
  expr: '', justEvaluated: false, fromAns: false, ans: null as any, ansText: '', ansAscii: '',
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
/** a key's label is set on a line 1.2 of its size with no font padding (see keyLabel): its own height is its padding and that line */
const LINE = 1.2;
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
// ^ is on the number pad already, so the functions have % in its place (50% is 0.5, 100+20% is 120)
const SCI: string[][] = [
  ['sin(', 'cos(', 'tan(', '√('],
  ['asin(', 'acos(', 'atan(', '%'],
  ['ln(', 'log(', 'π', 'e'],
  ['!', '×10^', 'abs(', 'mod'],
];
/**
 * The function keys whose label is not what they type: Inter Tight draws the superscript minus and one and the small
 * modifier x (U+207B, U+00B9, U+02E3, checked in its cmap), so the inverses read as a textbook writes them. What a key
 * types is unchanged; the rest show what they type without the bracket.
 */
const SCI_LABEL: Record<string, string> = {
  'asin(': 'sin⁻¹', 'acos(': 'cos⁻¹', 'atan(': 'tan⁻¹', '×10^': '×10ˣ', 'abs(': '|x|',
};
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
  const equals = 2 * (sci ? 10 : 14) + 26 * line;
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
  const setSetting = useStore((s) => s.setSetting);
  // the switches are remembered: the angle, the functions' keys and the notation answers are written in
  const deg = useStore((s) => s.settings.calcAngle) !== 'rad';
  const sci = useStore((s) => s.settings.calcFunctions);
  const sciNotation = useStore((s) => s.settings.calcSci);

  // the sum starts as it was left (see kept)
  const [expr, setExpr] = useState(kept.expr);
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

  // The caret: the display is a text field that never opens the keyboard. Tapped, it takes a caret (or a selection)
  // where the finger lands, and the keys write there; with the caret at the end, or the field never tapped, they go on
  // at the end as they always have. Read through the ref, since two quick keys come before a render.
  const [sel, setSel] = useState({ start: kept.expr.length, end: kept.expr.length });
  const selRef = useRef(sel);
  const focusedRef = useRef(false);
  // The caret a key has just set, until the field reports it back. The field reports each step of an update (the text
  // replaced, which moves its caret, then the caret placed), and those reports reach here a moment later: two quick
  // keys can both be pressed first, and the first one's reports would then put the caret back where it left it, so the
  // next key lands one place behind. While a key's caret is on its way, only the report that matches it is taken; a
  // report that never comes lets go after a short while.
  const awaited = useRef<{ start: number; end: number; until: number } | null>(null);
  const placeCaret = useCallback((at: number) => {
    const v = { start: at, end: at };
    selRef.current = v;
    // an untapped field reports nothing, and needs no waiting for
    awaited.current = focusedRef.current ? { ...v, until: Date.now() + 400 } : null;
    setSel(v);
  }, []);
  const onSelection = useCallback((s: { start: number; end: number }) => {
    const w = awaited.current;
    if (w) {
      const caughtUp = s.start === w.start && s.end === w.end;
      if (!caughtUp && Date.now() < w.until) return;
      awaited.current = null;
    }
    selRef.current = s;
    setSel(s);
  }, []);

  /**
   * Sets the sum, with the caret at `caret` (the end unless given; null leaves it where the field put it). The sum
   * carries on from the answer while it still starts with the answer and an operator follows it.
   */
  const write = useCallback((next: string, evaluated: boolean, fromAns = live.current.fromAns, caret: number | null = next.length) => {
    const s = live.current;
    const after = next[s.ansText.length];
    s.fromAns = fromAns && !evaluated && next.startsWith(s.ansText) && after !== undefined && !/[\d.]/.test(after);
    s.expr = next;
    s.justEvaluated = evaluated;
    Object.assign(kept, s);
    setExpr(next);
    setJustEvaluated(evaluated);
    if (caret != null) placeCaret(caret);
  }, [placeCaret]);

  // Sift's inline maths opens the calculator with its sum (?expr=): the sum is written in, untapped, its answer shown in
  // the preview, and the param is cleared after, so the same link works again
  const params = useLocalSearchParams<{ expr?: string }>();
  const router = useRouter();
  useFocusEffect(useCallback(() => {
    const raw = typeof params.expr === 'string' ? params.expr : '';
    if (!raw) return;
    const sum = raw.replace(/[^\S ]+/g, '').replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−').slice(0, 200);
    focusedRef.current = false;
    setEvalError(null);
    write(sum, false, false);
    router.setParams({ expr: undefined });
  }, [params.expr, write]));

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
    // a caret placed inside the sum, or a selection, takes the key there
    const len = s.expr.length;
    const a = Math.min(len, selRef.current.start, selRef.current.end);
    const b = Math.min(len, Math.max(selRef.current.start, selRef.current.end));
    if (focusedRef.current && (a !== b || a < len)) { editAt(k, a, b); return; }
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

  /** The operator a piece of a sum ends with, if any. */
  const endOp = (x: string) => ['×10^', ...BINARY].find((op) => x.endsWith(op));

  /**
   * A key at the caret, or over a selection from `from` to `to`: the same rules as at the end, read from what stands
   * before the caret. ⌫ takes what stands before it (a function's name, mod or ×10^ whole), or the selection; an
   * answer cut into becomes ordinary digits.
   */
  const editAt = (k: string, from: number, to: number) => {
    const s = live.current;
    let before = s.expr.slice(0, from);
    const after = s.expr.slice(to);
    if (k === '⌫') {
      if (from === to) {
        if (!before) return;
        const t = TOKENS.find((x) => before.endsWith(x));
        before = before.slice(0, before.length - (t ? t.length : 1));
      }
    } else {
      // a second point in the number the caret stands in would leave a sum that cannot be read
      if (k === '.' && ((before.match(/[\d.]*$/)?.[0] ?? '') + (after.match(/^[\d.]*/)?.[0] ?? '')).includes('.')) return;
      if (BINARY.includes(k)) {
        if (!before && k !== '−') return;
        const op = endOp(before);
        if (k === '−') {
          if (op === '−') return;
        } else {
          for (let o = op; o; o = endOp(before)) before = before.slice(0, before.length - o.length);
        }
      }
      before += k;
    }
    write(before + after, false, s.fromAns, before.length);
  };

  /** Text the field took in itself (a paste, a hardware keyboard): the keypad's own signs, on one line. */
  const typed = (text: string) => {
    setEvalError(null);
    // the field placed its own caret for what it took in: its next report is the one to follow
    awaited.current = null;
    write(text.replace(/[\r\n]/g, '').replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−'), false, live.current.fromAns, null);
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
    // the answer comes in a fresh field, untapped: the next key goes on from the end
    focusedRef.current = false;
    write(r.text, true, false);
    setAnswers((n) => n + 1);
  };

  // long press on "=": the answer in plain digits and e-notation, which any other app can read
  const copyAnswer = useCallback(async () => {
    const s = live.current;
    const out = s.justEvaluated ? s.ansAscii : answerRef.current?.ascii;
    if (!out) return;
    try {
      await Clipboard.setStringAsync(out);
    } catch {
      // the clipboard said no: nothing was copied, so nothing says it was
      return;
    }
    tick();
    // a haptic only answers at full motion: the copy says so in words too
    toast('Copied ' + out);
  }, []);

  const setAngle = (k: string) => setSetting('calcAngle', k === 'rad' ? 'rad' : 'deg');

  const toggleNotation = () => {
    const next = !sciNotation;
    setSetting('calcSci', next);
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
    setSetting('calcFunctions', on);
    setFlips((n) => n + 1);
  }, [setSetting]);
  const toggleFns = () => {
    if (dipping.current) return;
    if (level === 'none') { setSetting('calcFunctions', !sci); return; }
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
  const rail = useRail();
  const split = wide && width > height && width - (mode === 'tab' && rail ? RAIL_W : 0) >= TWO_COL_AT;
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
  // the controls row's room and its parts, measured in this window (see controls)
  const [ctl, setCtl] = useState({ rowW: 0, segW: 0, notW: 0, fnW: 0, histW: 0 });
  const keyMin = wide ? KEY_MIN : KEY_MIN_PHONE;
  const keyH = fitted
    ? Math.floor(Math.max(keyMin, Math.min(KEY_MAX, (pad.w - 24) / 4, (pad.h - gaps - eqH) / rows)))
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
    // what is being typed stays in sight: the display follows the end of a sum that has outgrown it, unless the caret
    // stands further in, where the finger put it
    if (!focusedRef.current || selRef.current.end >= live.current.expr.length) dispScroll.current?.scrollToEnd({ animated: false });
  };

  // the line under the sum, and what a screen reader says as it changes: the answer as it is worked out, or why not
  const line = evalError ?? (justEvaluated ? ' ' : preview ? `= ${preview}` : ' ');
  const lineSaid = evalError ?? (justEvaluated ? 'Equals ' + spoken(expr) : preview ? 'Equals ' + spoken(preview) : undefined);

  const display = (
    // display — carved into the material
    <Inset pad={compact ? 12 : 16} style={{ borderRadius: S.radius, marginBottom: 12, overflow: 'visible' }}>
      <ScrollView
        ref={dispScroll}
        style={{ maxHeight: split ? 140 : compact ? 78 : 90, minHeight: exprSize < baseSize ? lineH.current[lineFor] : undefined }}
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' }}
        onContentSizeChange={onDisplaySize}
        keyboardShouldPersistTaps="always"
      >
        <Animated.View key={answers} entering={answers > 0 && level !== 'none' ? answerIn(level === 'full') : undefined}>
          {/* tapped, the sum takes a caret; the system keyboard never opens, the keypad below types */}
          <TextInput
            value={expr}
            selection={{ start: Math.min(sel.start, expr.length), end: Math.min(sel.end, expr.length) }}
            onSelectionChange={(e) => onSelection(e.nativeEvent.selection)}
            onFocus={() => { focusedRef.current = true; awaited.current = null; }}
            onBlur={() => { focusedRef.current = false; awaited.current = null; }}
            onChangeText={typed}
            showSoftInputOnFocus={false}
            multiline
            scrollEnabled={false}
            placeholder="0"
            placeholderTextColor={C.text}
            underlineColorAndroid="transparent"
            cursorColor={C.accent}
            selectionColor={C.accent + '55'}
            textAlign="right"
            style={[st.expr, { fontSize: exprSize }]}
            accessibilityLabel={'Sum, ' + spoken(expr || '0')}
            accessibilityHint="Tap to place the cursor"
          />
        </Animated.View>
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

  // The controls are one row that never wraps, every part 32 high and centred on one line. Where the row would not fit
  // (the narrowest phone at a large font size) the Functions chip keeps its icon and drops its word: the row's room and
  // its parts are measured, with the chip's labelled width taken while it shows its word. A width taken at another font
  // size corrects itself: the word comes back, is measured again, and goes again if it still does not fit.
  const ctlGaps = CTL_GAP * (split ? 3 : 4); // a gap either side of the spacer too: three, or four with the history button
  const fnFits = !(ctl.fnW > 0 && ctl.rowW > 0 && ctl.segW + ctl.notW + (split ? 0 : ctl.histW) + ctlGaps + ctl.fnW > ctl.rowW);
  const measured = (part: keyof typeof ctl) => (e: { nativeEvent: { layout: { width: number } } }) => {
    const w = Math.round(e.nativeEvent.layout.width);
    // the Functions chip's width counts only while it shows its word: without it, it is not the width the word needs
    if (part === 'fnW' && !fnFits) return;
    setCtl((c) => (c[part] === w ? c : { ...c, [part]: w }));
  };
  const controls = (
    // controls sit under the display, so the well holds only the sum and its answer
    <View style={st.controls} onLayout={measured('rowW')}>
      <View onLayout={measured('segW')}>
        <SegmentedControl
          size="sm"
          height={CTL_H}
          options={[{ key: 'deg', label: 'DEG' }, { key: 'rad', label: 'RAD' }]}
          value={deg ? 'deg' : 'rad'}
          onChange={setAngle}
        />
      </View>
      <View onLayout={measured('fnW')}>
        <Chip
          small icon="grid-outline" label={fnFits ? 'Functions' : ''} active={sci} onPress={toggleFns}
          accessibilityLabel="Functions" style={st.ctlChip}
        />
      </View>
      {/* how answers are written, not which keys show: so it says so, in the one accent */}
      <View onLayout={measured('notW')}>
        <Chip
          small textFace label="×10ⁿ" active={sciNotation} onPress={toggleNotation}
          accessibilityLabel="Scientific notation" style={st.ctlChip}
        />
      </View>
      <View style={st.ctlSpace} />
      {split ? null : (
        <View onLayout={measured('histW')}>
          <IconBtn name="time-outline" size={20} pad={6} onPress={() => setHistSheet(true)} accessibilityLabel="History" />
        </View>
      )}
    </View>
  );

  // a keypad fitted to its height that is too short for them even at the smallest keys scrolls instead of pushing over the
  // display; it rests at its foot, where the digits and the equals key are, and the functions are a scroll up
  const cramped = fitted && (pad.h - gaps - eqH) / rows < keyMin;
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
                  key={k} label={SCI_LABEL[k] ?? k.replace('(', '')} value={k} pad={8} small onKey={onKey} color={C.accent}
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
        <Text maxFontSizeMultiplier={KEY_SCALE_MAX} style={[st.equalsText, { color: theme === 'minimal' ? C.accent : C.onAccent }]}>
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
          // a key pressed here must not take the caret out of the display
          keyboardShouldPersistTaps="always"
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
    <Text style={{ color: C.textFaint, fontFamily: F.sm, fontSize: 13, letterSpacing: TRACK.small }}>Past calculations appear here. Tap one to reuse its result.</Text>
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
            <Text style={st.histSum} numberOfLines={1} ellipsizeMode="middle">{h.expr}</Text>
            <Text style={[st.histResult, h.result === 'Error' && { color: C.danger }]}>= {h.result}</Text>
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
  /** drawn in place of the label: an icon reads as a key where the ⌫ sign would read as text */
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
        <Text maxFontSizeMultiplier={KEY_SCALE_MAX} style={[small ? st.keyLabelSmall : st.keyLabel, { color }]}>
          {label}
        </Text>
      )}
    </Press>
  );
});

/** the controls row: every part this high, this far apart */
const CTL_H = 32;
const CTL_GAP = 8;

const st = StyleSheet.create({
  // Inter Tight Regular with its tabular figures: lighter and calmer than the keys around it (the calc-face pick). A
  // field: no padding of its own, so its right edge is the well's inner edge, as the preview's is
  expr: {
    color: C.text, fontSize: 34, letterSpacing: TRACK.display, fontFamily: F.reg, textAlign: 'right', fontVariant: ['tabular-nums'],
    padding: 0, margin: 0,
  },
  // the answer as it is worked out: digits, so Inter Tight with its tabular figures too
  preview: { fontSize: 16, letterSpacing: TRACK.body, fontFamily: F.reg, textAlign: 'right', marginTop: 4, fontVariant: ['tabular-nums'] },
  // one row under the display, 12 from it and 12 from the first keys, every part 32 high and centred on its line
  controls: { flexDirection: 'row', alignItems: 'center', gap: CTL_GAP, marginBottom: 12 },
  ctlChip: { height: CTL_H, paddingVertical: 0, marginRight: 0, marginBottom: 0, justifyContent: 'center' },
  ctlSpace: { flex: 1 },
  key: {
    flex: 1, paddingVertical: 16, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
  },
  // a key's label, the = included, drops Android's font padding and sits on a line 1.2 of its size, so the digits, the
  // signs and the ⌫ icon share one optical centre
  keyLabel: { ...oneLine(22), fontFamily: F.med, letterSpacing: TRACK.large },
  keyLabelSmall: { ...oneLine(15), fontFamily: F.med, letterSpacing: TRACK.body },
  equalsText: { ...oneLine(26), fontFamily: F.semi, letterSpacing: TRACK.large },
  // the space above the = is the keys' row gap, and below it the body's own padding
  equals: {
    paddingVertical: 14, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
  },
  carve: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  histRow: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  // the sum and its result share the row's left and right edges
  histSum: { color: C.textDim, fontFamily: F.sm, fontSize: 13, letterSpacing: TRACK.small, alignSelf: 'stretch' },
  histResult: {
    color: C.text, fontFamily: F.semi, fontSize: 16, letterSpacing: TRACK.title, fontVariant: ['tabular-nums'], alignSelf: 'stretch', marginTop: 2,
  },
  split: { flex: 1, flexDirection: 'row', gap: 28 },
  splitSide: { flex: 1, minWidth: 0 },
  splitPad: { width: SPLIT_PAD_W },
  histHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, marginBottom: 6 },
  histClear: { color: C.danger, fontFamily: F.semi, fontSize: 13, letterSpacing: TRACK.small },
});
