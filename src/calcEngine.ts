import { create, all } from 'mathjs';

// The calculator's engine, shared by the Calculator and by Sift's inline maths, so a sum typed in either gives the same
// answer. Precise: BigNumber arithmetic, so 0.1 + 0.2 is exactly 0.3 here.

export const math = create(all, { number: 'BigNumber', precision: 40 });

export const M = math as any;

/** the largest factorial worked out: 10000! takes a few milliseconds, a million would hold the screen for seconds */
export const MAX_FACTORIAL = 10000;

/** A sum the engine can read but the calculator will not answer: a factorial too large, or tan where it has no value. */
export const unfit = (kind: 'large' | 'undefined') => Object.assign(new Error(kind), { unfit: kind });

// Built on first use, not when the module loads: the module loads with the app (a tab slot can hold the calculator),
// and the first evaluation builds mathjs's parser, which would add to every cold start.
let engine: { d2r: any; r2d: any; tiny: any } | null = null;
export function ready() {
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
export function snap(v: any) {
  return M.isBigNumber(v) && v.abs().lt(ready().tiny) ? M.bignumber(0) : v;
}

export function makeScope(deg: boolean, ans: any) {
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

export function toEngine(expr: string): string {
  return expr
    // ×10^ makes one number, as on any scientific calculator: 1÷6.02×10^23 divides by the whole of 6.02×10^23
    .replace(/(\d+(?:\.\d*)?|\.\d+)×10\^([−-]?\d+)/g, (_, m: string, x: string) => '(' + m + 'e' + x.replace('−', '-') + ')')
    .replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-')
    .replace(/π/g, 'pi').replace(/√\(/g, 'sqrt(');
}

/** Every bracket a sum leaves open is closed at its end: each function key types its own, as on a scientific calculator. */
export function closeBrackets(s: string): string {
  let open = 0;
  for (const ch of s) {
    if (ch === '(') open++;
    else if (ch === ')' && open > 0) open--;
  }
  return open > 0 ? s + ')'.repeat(open) : s;
}

/** An answer from the engine, in plain digits and e-notation (what is copied). Big and small answers only go to e-notation past 10^14 and 10^-9. */
export function fmt(v: any, sciNotation: boolean): string {
  return sciNotation
    // 1.2e+5, not 1.20000000000e+5
    ? math.format(v, { notation: 'exponential', precision: 12 }).replace(/\.?0+e/, 'e')
    : math.format(v, { precision: 14, lowerExp: -9, upperExp: 14 });
}

/** An answer as the keypad writes it: its minus sign and its ×10^, not a hyphen and e-notation. */
export function shown(ascii: string): string {
  return ascii.replace(/-/g, '−').replace(/e\+?(−?\d+)$/, '×10^$1');
}

/** A keypad sum as the engine reads it: ln( is the natural log and log( base ten, as the keys say. */
export function engineSum(sum: string): string {
  return toEngine(sum.replace(/ln\(/g, '__LN__(').replace(/log\(/g, 'log10(').replace(/__LN__\(/g, 'log('));
}

/* ---------------------------------------------------------------- maths typed into Sift */

/** Words a typed sum may hold, written the keypad's way. */
const FUNCS = ['asin', 'acos', 'atan', 'sin', 'cos', 'tan', 'sqrt', 'abs', 'ln', 'log'];

/**
 * A query written as a sum, in the keypad's own signs ("12*7+3" is 12×7+3, "15% of 80" is 15%×80, "sqrt 2" is √(2)), or
 * null when it is not plainly a sum: a bare number, a date, a word that is not a function.
 */
export function keypadSum(q: string): string | null {
  let s = String(q ?? '').trim().toLowerCase();
  if (!s || s.length > 80 || !/\d/.test(s)) return null;
  // a date or a phone number is not a sum, though it reads as one: this keeps Enter in Sift from opening the Calculator
  // on "2024-10-28" or "555-1234" (a spaced "2024 - 10" and a fraction like "3/4" stay sums)
  if (/^\d{4}-\d{1,2}-\d{1,2}$|^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$|^\d+(-\d+){2,}$|^\d{3}-\d{4}$|^\+\d/.test(s)) return null;
  // "15% of 80", "15 % of 80"
  s = s.replace(/(\d)\s*%\s*of\s*/g, '$1%×');
  // a function written with a space ("sqrt 2", "sin 30") takes its bracket
  s = s.replace(new RegExp('\\b(' + FUNCS.join('|') + ')\\s+(?=[\\d.(π]|pi\\b)', 'g'), '$1(');
  s = s.replace(/√\s*(?=[\d.π])/g, 'sqrt(');
  s = s.replace(/√\s*\(/g, 'sqrt(');
  s = s.replace(new RegExp('\\b(' + FUNCS.join('|') + ')\\(', 'g'), (_, f: string) => (f === 'sqrt' ? '√(' : f + '('));
  // 12 x 7, 12x7
  s = s.replace(/(\d)\s*[x×]\s*(?=[\d.(√π])/g, '$1×');
  s = s.replace(/\bpi\b/g, 'π');
  s = s.replace(/\*\*/g, '^').replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−').replace(/\s+/g, '');
  s = s.replace(/mod/g, ' mod ');
  // what is left must be the keypad's: digits, signs, brackets, the functions, π and e
  const rest = s.replace(/asin\(|acos\(|atan\(|sin\(|cos\(|tan\(|abs\(|ln\(|log\(|√\(| mod /g, '');
  if (!/^[\d.+−×÷^()%!πe]+$/.test(rest)) return null;
  // an operation, or a function: a number on its own is not a sum
  if (!/[+−×÷^%!√(]|mod/.test(s.replace(/^−/, ''))) return null;
  // "e" only as Euler's number, never stuck to a number as in 1e5 (which is fine) or in a word
  if (/[a-df-z]/.test(rest)) return null;
  return s;
}

/**
 * The answer to a typed sum, as the keypad shows it, with the sum in keypad signs (what the Calculator is opened with), or
 * null when the query is not a sum or has no answer to show.
 */
export function quickMath(q: string, deg = true): { expr: string; answer: string } | null {
  const sum = keypadSum(q);
  if (!sum) return null;
  try {
    const raw = math.evaluate(engineSum(closeBrackets(sum)), makeScope(deg, null));
    const v = typeof raw === 'number' ? M.bignumber(raw) : raw;
    if (!M.isBigNumber(v) || !v.isFinite()) return null;
    return { expr: sum, answer: shown(fmt(v, false)) };
  } catch {
    return null;
  }
}
