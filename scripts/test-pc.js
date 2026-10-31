#!/usr/bin/env node
/*
 * Checks for the PC version's pure parts, run against the real source in Node: src/web/pc.ts (which key does what, and
 * how a confirmation's buttons are read, Cancel and closing without a choice included).
 * Usage: node scripts/test-pc.js   (exit 1 on any failure)
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { createRequire } = require('module');

const ROOT = path.join(__dirname, '..');
const projectRequire = createRequire(path.join(ROOT, 'package.json'));
const ts = projectRequire('typescript');

function load(file) {
  const registry = new Map();
  const go = (f) => {
    if (registry.has(f)) return registry.get(f).exports;
    const { outputText } = ts.transpileModule(fs.readFileSync(f, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    });
    const mod = { exports: {} };
    registry.set(f, mod);
    const req = (spec) => {
      if (spec.startsWith('.')) {
        const base = path.resolve(path.dirname(f), spec);
        const hit = [base + '.ts', base + '.tsx', path.join(base, 'index.ts')].find((p) => fs.existsSync(p));
        if (!hit) throw new Error('cannot resolve ' + spec);
        return go(hit);
      }
      return projectRequire(spec);
    };
    new Function('require', 'module', 'exports', outputText)(req, mod, mod.exports);
    return mod.exports;
  };
  return go(file);
}

const pc = load(path.join(ROOT, 'src', 'web', 'pc.ts'));

let failed = 0;
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failed++; console.error('FAIL', name, '\n ', e.message); }
}

const key = (k, o = {}) => pc.shortcutOf({ key: k, ctrl: false, meta: false, shift: false, alt: false, typing: false, ...o });

// ---------- shortcutOf ----------
test('Ctrl+K and Cmd+K open Sift, in a field too', () => {
  assert.equal(key('k', { ctrl: true }), 'sift');
  assert.equal(key('K', { meta: true, typing: true }), 'sift');
});
test('a bare / opens Sift only away from a field', () => {
  assert.equal(key('/'), 'sift');
  assert.equal(key('/', { typing: true }), null);
});
test('Ctrl+1 to Ctrl+5 go to the bar, and nothing past it', () => {
  assert.deepEqual(['1', '2', '3', '4', '5'].map((d) => key(d, { ctrl: true })), ['tab1', 'tab2', 'tab3', 'tab4', 'tab5']);
  assert.equal(key('6', { ctrl: true }), null);
  assert.equal(key('0', { ctrl: true }), null);
  // a bare digit is typed, never taken
  assert.equal(key('1'), null);
});
test('Ctrl+N adds a ToDo and Ctrl+Shift+N writes a note, whatever the case of the letter', () => {
  assert.equal(key('n', { ctrl: true }), 'add-todo');
  assert.equal(key('N', { ctrl: true, shift: true }), 'new-note');
});
test('Ctrl+Shift+F starts Deep Work; Ctrl+F alone is left to the page', () => {
  assert.equal(key('F', { ctrl: true, shift: true }), 'start-focus');
  assert.equal(key('f', { ctrl: true }), null);
});
test('Ctrl+, opens Settings', () => {
  assert.equal(key(',', { ctrl: true }), 'settings');
});
test('? lists the shortcuts away from a field, and Ctrl+/ anywhere', () => {
  assert.equal(key('?', { shift: true }), 'help');
  assert.equal(key('?', { shift: true, typing: true }), null);
  assert.equal(key('/', { ctrl: true, typing: true }), 'help');
});
test('Alt with any of them is left alone, and so are plain letters', () => {
  assert.equal(key('k', { ctrl: true, alt: true }), null);
  assert.equal(key('n'), null);
  assert.equal(key('Escape'), null);
  assert.equal(key('Enter', { ctrl: true }), null);
});
test('every shortcut listed names its keys and what it does', () => {
  assert.ok(pc.SHORTCUT_LIST.length >= 8);
  for (const s of pc.SHORTCUT_LIST) {
    assert.ok(s.keys.length > 0 && s.keys.every((k) => typeof k === 'string' && k.length > 0));
    assert.ok(s.what.length > 0);
  }
});

// ---------- alertButtons ----------
test('no buttons is one OK, which closing the sheet also chooses', () => {
  const r = pc.alertButtons();
  assert.deepEqual(r.list.map((b) => b.text), ['OK']);
  assert.equal(r.dismiss, 0);
  assert.equal(pc.alertButtons([]).dismiss, 0);
});
test('closing counts as Cancel wherever it stands', () => {
  const r = pc.alertButtons([{ text: 'Delete', style: 'destructive' }, { text: 'Cancel', style: 'cancel' }]);
  assert.deepEqual(r.list.map((b) => b.text), ['Delete', 'Cancel']);
  assert.equal(r.dismiss, 1);
});
test('two choices and no Cancel: closing chooses neither', () => {
  assert.equal(pc.alertButtons([{ text: 'Bring it here' }, { text: 'Keep this one' }]).dismiss, -1);
});
test('a single button with its own action is what closing runs', () => {
  let ran = 0;
  const r = pc.alertButtons([{ text: 'Got it', onPress: () => { ran++; } }]);
  assert.equal(r.dismiss, 0);
  r.list[r.dismiss].onPress();
  assert.equal(ran, 1);
});
test('the buttons given are not changed', () => {
  const given = [{ text: 'Cancel', style: 'cancel' }, { text: 'Clear', style: 'destructive' }];
  const r = pc.alertButtons(given);
  assert.notEqual(r.list, given);
  assert.equal(given.length, 2);
});

console.log(passed + ' passed' + (failed ? ', ' + failed + ' failed' : ''));
process.exit(failed ? 1 : 0);
