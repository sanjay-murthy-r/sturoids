#!/usr/bin/env node
/*
 * Checks for the app's own links (src/appLinks.ts), run against the real source in Node: sturoids://search, new-note,
 * add-todo, start-focus and open?tool=&item=, as Android hands them over and as paths; what is not one of the app's
 * links (another scheme, a page path, a share's link, junk) is left alone. Also checks that every app shortcut the
 * config plugin writes (plugins/withAppShortcuts.js) opens a link the app understands.
 * Usage: node scripts/test-links.js   (exit 1 on any failure)
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { createRequire } = require('module');

const ROOT = path.join(__dirname, '..');
const projectRequire = createRequire(path.join(ROOT, 'package.json'));
const ts = projectRequire('typescript');

function loadTs(rel) {
  const file = path.join(ROOT, rel);
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  });
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(projectRequire, mod, mod.exports);
  return mod.exports;
}

let failed = 0;
let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (e) {
    failed += 1;
    console.error('FAIL ' + name + '\n  ' + (e && e.message ? e.message.split('\n').join('\n  ') : e));
  }
}

const { parseAppLink } = loadTs('src/appLinks.ts');

test('actions, as Android hands them over', () => {
  assert.deepEqual(parseAppLink('sturoids://search'), { kind: 'action', action: 'search' });
  assert.deepEqual(parseAppLink('sturoids://new-note'), { kind: 'action', action: 'new-note' });
  assert.deepEqual(parseAppLink('sturoids://add-todo'), { kind: 'action', action: 'add-todo' });
  assert.deepEqual(parseAppLink('sturoids://start-focus'), { kind: 'action', action: 'start-focus' });
  assert.deepEqual(parseAppLink('STUROIDS://Search/'), { kind: 'action', action: 'search' });
});

test('actions, as paths', () => {
  assert.deepEqual(parseAppLink('/search'), { kind: 'action', action: 'search' });
  assert.deepEqual(parseAppLink('new-note'), { kind: 'action', action: 'new-note' });
  assert.deepEqual(parseAppLink('//add-todo#x'), { kind: 'action', action: 'add-todo' });
});

test('a query rides along: search words, a ToDo title', () => {
  assert.deepEqual(parseAppLink('sturoids://search?q=physics%20mock'), { kind: 'action', action: 'search', query: 'physics mock' });
  assert.deepEqual(parseAppLink('sturoids://search?q=chem+lab'), { kind: 'action', action: 'search', query: 'chem lab' });
  assert.deepEqual(parseAppLink('sturoids://add-todo?title=%20Buy%20pens%20'), { kind: 'action', action: 'add-todo', query: 'Buy pens' });
  // blank words, or words on an action that takes none, are dropped
  assert.deepEqual(parseAppLink('sturoids://search?q=%20%20'), { kind: 'action', action: 'search' });
  assert.deepEqual(parseAppLink('sturoids://new-note?q=hello'), { kind: 'action', action: 'new-note' });
  // a broken escape stays as written, never throws
  assert.deepEqual(parseAppLink('sturoids://search?q=100%'), { kind: 'action', action: 'search', query: '100%' });
});

test('open a tool, on one of its things, with the rest of the query going along', () => {
  assert.deepEqual(parseAppLink('sturoids://open?tool=tasks'), { kind: 'open', tool: 'tasks', params: {} });
  assert.deepEqual(parseAppLink('sturoids://open?tool=notes&item=n_123'), { kind: 'open', tool: 'notes', params: { item: 'n_123' } });
  assert.deepEqual(
    parseAppLink('sturoids://open?tool=vault&item=v1&t=95'),
    { kind: 'open', tool: 'vault', params: { item: 'v1', t: '95' } },
  );
  assert.deepEqual(
    parseAppLink('/open?tool=journal&item=2026-10-26&entry=e1&'),
    { kind: 'open', tool: 'journal', params: { item: '2026-10-26', entry: 'e1' } },
  );
  // empty parts go, the first of a repeated part wins
  assert.deepEqual(parseAppLink('sturoids://open?tool=focus&item=&minutes=25&minutes=90'), { kind: 'open', tool: 'focus', params: { minutes: '25' } });
});

test('an open link with no tool, or a tool name that could not be one, is nothing', () => {
  assert.equal(parseAppLink('sturoids://open'), null);
  assert.equal(parseAppLink('sturoids://open?item=x'), null);
  assert.equal(parseAppLink('sturoids://open?tool=../settings'), null);
  assert.equal(parseAppLink('sturoids://open?tool=Tasks%20now'), null);
});

test('query keys that are not names are skipped', () => {
  assert.deepEqual(parseAppLink('sturoids://open?tool=tasks&__proto__=1&1x=2&item=a'), { kind: 'open', tool: 'tasks', params: { item: 'a' } });
});

test('not the app\'s own links: left to the router', () => {
  assert.equal(parseAppLink('https://example.com/search'), null);
  assert.equal(parseAppLink('exp+sturoids://expo-development-client/?url=x'), null);
  assert.equal(parseAppLink('/settings?page=trash'), null);
  assert.equal(parseAppLink('/notes/abc'), null);
  assert.equal(parseAppLink('/'), null);
  assert.equal(parseAppLink(''), null);
  assert.equal(parseAppLink('   '), null);
  assert.equal(parseAppLink(null), null);
  assert.equal(parseAppLink(42), null);
  assert.equal(parseAppLink('sturoids://search'.padEnd(2100, 'x')), null);
});

test('every app shortcut opens a link the app understands, with its own drawable and labels', () => {
  const { SHORTCUTS } = require(path.join(ROOT, 'plugins', 'withAppShortcuts.js'));
  assert.ok(Array.isArray(SHORTCUTS) && SHORTCUTS.length === 4);
  const ids = new Set();
  for (const s of SHORTCUTS) {
    assert.match(s.id, /^[a-z_]+$/, s.id);
    assert.ok(!ids.has(s.id), 'repeated id ' + s.id);
    ids.add(s.id);
    const link = parseAppLink(s.link);
    assert.ok(link && link.kind === 'action', s.link);
    assert.ok(s.short.length <= 10, 'short label too long: ' + s.short);
    assert.ok(s.long.length <= 25, 'long label too long: ' + s.long);
    assert.match(s.icon, /^M[\d.,\-MmLlHhVvAaZzCc\s]+$/);
  }
  assert.deepEqual(SHORTCUTS.map((s) => parseAppLink(s.link).action), ['search', 'new-note', 'add-todo', 'start-focus']);
});

test('app.json carries the scheme, the shortcuts plugin and the share filters', () => {
  const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8')).expo;
  assert.equal(app.scheme, 'sturoids');
  const names = app.plugins.map((p) => (Array.isArray(p) ? p[0] : p));
  assert.ok(names.includes('./plugins/withAppShortcuts.js'));
  const share = app.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-share-intent');
  assert.ok(share, 'expo-share-intent plugin');
  assert.deepEqual(share[1].androidIntentFilters, ['text/*', 'image/*', 'application/pdf']);
  assert.deepEqual(share[1].androidMultiIntentFilters, ['image/*', 'application/pdf']);
});

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
