// The Calculator widget's keypad, the pure part: what each key does to the sum on the home screen, and the answer shown
// as it is typed. The sum is the keypad's own (×, ÷, −, π, √(), the same the Calculator writes, so a tap on the display
// opens the Calculator with it, carried on there. Worked by the same engine as the Calculator (calcEngine.ts), so a sum
// gives the same answer in both.


/** What one Calculator widget holds between taps: its sum, and whether that sum is an answer just given by "=". */
export interface CalcPad { expr: string; done: boolean }

export const EMPTY_PAD: CalcPad = { expr: '', done: false };

/** The keys, as the widget sends them. */
export type CalcKey =
  | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.'
  | '+' | '−' | '×' | '÷' | '%' | '(' | ')' | 'C' | 'DEL' | '=';

export const CALC_KEYS: readonly CalcKey[] = [
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '+', '−', '×', '÷', '%', '(', ')', 'C', 'DEL', '=',
];
export const isCalcKey = (v: unknown): v is CalcKey => typeof v === 'string' && (CALC_KEYS as readonly string[]).includes(v);

const OPS = ['+', '−', '×', '÷'];
/** a sum longer than this takes no more keys: the widget's line is short, and the Calculator is a tap away */
export const PAD_MAX = 60;

/** The answer to a sum as the keypad writes it, or '' when it is not yet a sum with an answer. */
export function padAnswer(expr: string, deg = true): string {
  const s = expr.replace(/[+−×÷(]+$/, '');
  if (!s || !/\d/.test(s)) return '';
  try {
    // the engine (mathjs) loads with the first sum, never with the module: the updater reads this file at the app's start
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { M, closeBrackets, engineSum, fmt, makeScope, math, shown } = require('../../calcEngine') as typeof import('../../calcEngine');
    const raw = math.evaluate(engineSum(closeBrackets(s)), makeScope(deg, null));
    const v = typeof raw === 'number' ? M.bignumber(raw) : raw;
    if (!M.isBigNumber(v) || !v.isFinite()) return '';
    return shown(fmt(v, false));
  } catch {
    return '';
  }
}

/** Whether the answer is worth showing under a sum: the sum does something (a bare number is its own answer). */
export const showsAnswer = (expr: string) => /[+−×÷%()]/.test(expr.replace(/^−/, ''));

/** The pad after one key. */
export function pressKey(pad: CalcPad, key: CalcKey): CalcPad {
  let expr = pad.expr;
  if (key === 'C') return EMPTY_PAD;
  if (key === 'DEL') return { expr: pad.done ? '' : expr.slice(0, -1), done: false };
  if (key === '=') {
    if (!expr) return pad;
    const a = padAnswer(expr);
    // a sum with no answer stays as it was, to be put right
    return a ? { expr: a, done: true } : pad;
  }
  // a digit after an answer starts a new sum; a sign carries the answer on
  if (pad.done && !OPS.includes(key) && key !== '%' && key !== ')') expr = '';
  const last = expr.slice(-1);
  if (OPS.includes(key)) {
    if (!expr) return key === '−' ? { expr: '−', done: false } : pad;
    // a sign after a sign takes its place (but a minus may follow ×, ÷ or a bracket, as a negative number)
    if (OPS.includes(last)) {
      if (key === '−' && (last === '×' || last === '÷')) return grow(expr + key);
      const trimmed = expr.replace(/[+−×÷]+$/, '');
      return trimmed ? grow(trimmed + key) : pad;
    }
    if (last === '(' && key !== '−') return pad;
  }
  if (key === '.') {
    // one point to a number
    const num = /[\d.]*$/.exec(expr)?.[0] ?? '';
    if (num.includes('.')) return pad;
    return grow(expr + (num ? '.' : '0.'));
  }
  if (key === ')') {
    const open = (expr.match(/\(/g) || []).length - (expr.match(/\)/g) || []).length;
    if (open <= 0 || OPS.includes(last) || last === '(') return pad;
  }
  if (key === '%' && (!expr || OPS.includes(last) || last === '(' || last === '%')) return pad;
  // a bracket or a digit after a closed bracket or a % multiplies, as on paper
  if ((key === '(' || /\d/.test(key)) && (last === ')' || last === '%')) return grow(expr + '×' + key);
  if (key === '(' && /[\d.]/.test(last)) return grow(expr + '×(');
  // a leading zero is replaced by the digit after it (07 is 7)
  if (/\d/.test(key) && /(^|[+−×÷(])0$/.test(expr)) return grow(expr.slice(0, -1) + key);
  return grow(expr + key);
}

const grow = (expr: string): CalcPad => ({ expr: expr.slice(0, PAD_MAX), done: false });

/** A stored pad, checked: anything else reads as empty. */
export function cleanPad(raw: unknown): CalcPad {
  if (!raw || typeof raw !== 'object') return EMPTY_PAD;
  const r = raw as Record<string, unknown>;
  const expr = typeof r.expr === 'string' ? r.expr.slice(0, PAD_MAX) : '';
  if (!/^[\d.+−×÷%()^]*$/.test(expr)) return EMPTY_PAD;
  return { expr, done: r.done === true && !!expr };
}
