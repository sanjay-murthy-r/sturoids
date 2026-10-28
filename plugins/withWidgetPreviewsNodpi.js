// The widget picker's pictures (app.json, each widget's previewImage) are drawn large, so the picker can scale them down
// sharply on any screen. The widget library copies them into res/drawable, which Android reads as mdpi and would scale
// up three or four times over on a modern phone before the picker scales them down again: a picture of a few hundred
// kilobytes held as tens of megabytes. This moves them into res/drawable-nodpi, used as drawn. Runs last of all the
// native changes (a finalized mod), after the library has copied them.
const fs = require('fs');
const path = require('path');
const { withFinalizedMod } = require('expo/config-plugins');

module.exports = function withWidgetPreviewsNodpi(config) {
  return withFinalizedMod(config, [
    'android',
    async (cfg) => {
      const res = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res');
      const from = path.join(res, 'drawable');
      const to = path.join(res, 'drawable-nodpi');
      if (!fs.existsSync(from)) return cfg;
      for (const f of fs.readdirSync(from)) {
        if (!/_preview\.png$/.test(f)) continue;
        fs.mkdirSync(to, { recursive: true });
        fs.copyFileSync(path.join(from, f), path.join(to, f));
        fs.unlinkSync(path.join(from, f));
      }
      return cfg;
    },
  ]);
};
