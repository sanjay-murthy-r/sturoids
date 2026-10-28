// Run on the web build copied into the desktop app (desktop/app), before electron-builder packs it. Expo's web export
// keeps the fonts and pictures that come from packages (Ionicons, the Inter Tight, Schibsted and Source Serif faces,
// the navigation's icons) under assets/node_modules/, and electron-builder leaves any folder named node_modules out of
// what it packs: the Windows app then had no icon font and none of the app's faces, so every icon showed as a box
// and every word and sign fell back to the system's font. The folder is renamed and every reference to it rewritten.
//
//   node scripts/desktop-assets.js [desktop/app]

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..', 'desktop', 'app'));
const from = path.join(root, 'assets', 'node_modules');
const to = path.join(root, 'assets', 'pkg');
const TEXT = new Set(['.js', '.html', '.css', '.json', '.map']);

if (!fs.existsSync(from)) {
  console.log('desktop-assets: nothing under assets/node_modules');
  process.exit(0);
}
fs.rmSync(to, { recursive: true, force: true });
fs.renameSync(from, to);

let files = 0;
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (TEXT.has(path.extname(e.name))) {
      const s = fs.readFileSync(p, 'utf8');
      if (!s.includes('assets/node_modules/')) continue;
      fs.writeFileSync(p, s.split('assets/node_modules/').join('assets/pkg/'));
      files++;
    }
  }
};
walk(root);
console.log('desktop-assets: moved the packages\' assets to assets/pkg, ' + files + ' file(s) rewritten');
