#!/usr/bin/env node
/*
 * Type guard for the app's text styles. Fails (exit 1) when a .tsx file under app/ or src/:
 *   - sets fontWeight anywhere (Android fake-bolds a family paired with a weight; pick an F.* face instead)
 *   - uses a fractional fontSize, or one under 11
 *   - sets fontSize in a style object that has no fontFamily, unless that object sits in a style array next to
 *     a T.* token, an st.* style or a `style` prop that brings the family
 * Usage: node scripts/lint-type.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIRS = ['app', 'src'];
const problems = [];

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const stat = fs.statSync(p);
    if (stat.isDirectory()) walk(p, out);
    else if (name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const lineOf = (src, index) => src.slice(0, index).split('\n').length;

/** The `{ ... }` object literal that encloses `index`, as [start, end], or null. */
function enclosingObject(src, index) {
  let depth = 0;
  let start = -1;
  for (let i = index; i >= 0; i--) {
    const ch = src[i];
    if (ch === '}') depth++;
    else if (ch === '{') {
      if (depth === 0) { start = i; break; }
      depth--;
    }
  }
  if (start < 0) return null;
  depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return [start, i];
    }
  }
  return null;
}

for (const file of DIRS.flatMap((d) => walk(path.join(ROOT, d), []))) {
  const src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');

  for (const m of src.matchAll(/\bfontWeight\s*:/g)) {
    problems.push(`${rel}:${lineOf(src, m.index)}  fontWeight is not allowed; use an F.* face`);
  }

  for (const m of src.matchAll(/\bfontSize\s*:\s*([0-9.]+)/g)) {
    const size = Number(m[1]);
    if (!Number.isInteger(size)) problems.push(`${rel}:${lineOf(src, m.index)}  fractional fontSize ${m[1]}; use the type scale`);
    else if (size < 11) problems.push(`${rel}:${lineOf(src, m.index)}  fontSize ${size} is under 11`);
  }

  for (const m of src.matchAll(/\bfontSize\s*:/g)) {
    const obj = enclosingObject(src, m.index);
    if (!obj) continue;
    const body = src.slice(obj[0], obj[1] + 1);
    if (/\bfontFamily\s*:/.test(body) || /\.\.\.\(?T\./.test(body)) continue;
    // an object inside a style array that already carries a family from a token, a sheet style or a prop
    const before = src.slice(Math.max(0, obj[0] - 160), obj[0]);
    const open = before.lastIndexOf('[');
    if (open >= 0 && before.lastIndexOf(']') < open && /\b(T\.|st\.|style\b)/.test(before.slice(open))) continue;
    problems.push(`${rel}:${lineOf(src, m.index)}  fontSize without a fontFamily in the same style`);
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\nlint-type: ${problems.length} problem${problems.length === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log('lint-type: ok');
