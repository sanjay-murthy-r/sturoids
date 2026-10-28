// The app's shortcuts: hold the app's icon and Search, New note, Add ToDo and Start focus are offered (Android's static
// shortcuts). Each opens one of the app's own links (sturoids://search …), which app/+native-intent.tsx reads and
// src/actions.ts carries out. This writes res/xml/shortcuts.xml, a vector icon for each, their labels in strings.xml,
// and the manifest's pointer to them on the main activity. Works from the next APK.
const fs = require('fs');
const path = require('path');
const { AndroidConfig, withAndroidManifest, withDangerousMod, withStringsXml } = require('expo/config-plugins');

/** id, the link it opens, its label (short, at most 10 letters as Android asks, and long), and the icon's path (24 x 24, Ionicons outline shapes, simplified) */
const SHORTCUTS = [
  {
    id: 'search', link: 'sturoids://search', short: 'Search', long: 'Search everything',
    icon: 'M10.5,4a6.5,6.5 0,1 0,0 13a6.5,6.5 0,1 0,0 -13zM10.5,5.8a4.7,4.7 0,1 1,0 9.4a4.7,4.7 0,1 1,0 -9.4zM15.4,16.7l1.3,-1.3l3.9,3.9l-1.3,1.3z',
  },
  {
    id: 'new_note', link: 'sturoids://new-note', short: 'New note', long: 'Write a new note',
    icon: 'M6,3h8l4,4v14H6zM7.8,4.8v14.4h8.4V8.2h-3.4V4.8zM9.5,11.2h5v1.6h-5zM9.5,14.6h5v1.6h-5z',
  },
  {
    id: 'add_todo', link: 'sturoids://add-todo', short: 'Add ToDo', long: 'Add a ToDo',
    icon: 'M12,3a9,9 0,1 0,0 18a9,9 0,1 0,0 -18zM12,4.8a7.2,7.2 0,1 1,0 14.4a7.2,7.2 0,1 1,0 -14.4zM11.1,7.8h1.8v3.3h3.3v1.8h-3.3v3.3h-1.8v-3.3H7.8v-1.8h3.3z',
  },
  {
    id: 'start_focus', link: 'sturoids://start-focus', short: 'Focus', long: 'Start a Deep Work session',
    icon: 'M12,4.5a8.25,8.25 0,1 0,0 16.5a8.25,8.25 0,1 0,0 -16.5zM12,6.3a6.45,6.45 0,1 1,0 12.9a6.45,6.45 0,1 1,0 -12.9zM11.1,8.5h1.8v4.6l2.9,1.7l-0.9,1.5l-3.8,-2.2zM9.5,1.8h5v1.6h-5z',
  },
];

/** the icons' colours: Sturoids' material behind the accent's glyph, as the launcher draws a shortcut */
const ICON_BG = '#30302E';
const ICON_FG = '#9588F9';

const iconXml = (d) => `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="48dp" android:height="48dp" android:viewportWidth="48" android:viewportHeight="48">
    <path android:fillColor="${ICON_BG}" android:pathData="M24,0a24,24 0,1 0,0 48a24,24 0,1 0,0 -48z"/>
    <group android:translateX="12" android:translateY="12">
        <path android:fillColor="${ICON_FG}" android:pathData="${d}"/>
    </group>
</vector>
`;

const shortcutsXml = (pkg) => `<?xml version="1.0" encoding="utf-8"?>
<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">
${SHORTCUTS.map((s) => `    <shortcut
        android:shortcutId="${s.id}"
        android:enabled="true"
        android:icon="@drawable/ic_shortcut_${s.id}"
        android:shortcutShortLabel="@string/shortcut_${s.id}_short"
        android:shortcutLongLabel="@string/shortcut_${s.id}_long">
        <intent
            android:action="android.intent.action.VIEW"
            android:targetPackage="${pkg}"
            android:targetClass="${pkg}.MainActivity"
            android:data="${s.link}" />
    </shortcut>`).join('\n')}
</shortcuts>
`;

function withShortcutFiles(config) {
  return withDangerousMod(config, ['android', async (cfg) => {
    const pkg = cfg.android && cfg.android.package;
    if (!pkg) throw new Error('withAppShortcuts: android.package is not set');
    const res = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res');
    fs.mkdirSync(path.join(res, 'xml'), { recursive: true });
    fs.mkdirSync(path.join(res, 'drawable'), { recursive: true });
    fs.writeFileSync(path.join(res, 'xml', 'shortcuts.xml'), shortcutsXml(pkg));
    for (const s of SHORTCUTS) fs.writeFileSync(path.join(res, 'drawable', `ic_shortcut_${s.id}.xml`), iconXml(s.icon));
    return cfg;
  }]);
}

function withShortcutStrings(config) {
  return withStringsXml(config, (cfg) => {
    let xml = cfg.modResults;
    for (const s of SHORTCUTS) {
      xml = AndroidConfig.Strings.setStringItem(
        [
          { $: { name: `shortcut_${s.id}_short`, translatable: 'false' }, _: s.short },
          { $: { name: `shortcut_${s.id}_long`, translatable: 'false' }, _: s.long },
        ],
        xml,
      );
    }
    cfg.modResults = xml;
    return cfg;
  });
}

function withShortcutMeta(config) {
  return withAndroidManifest(config, (cfg) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(cfg.modResults);
    const meta = (activity['meta-data'] = activity['meta-data'] || []);
    if (!meta.some((m) => m.$ && m.$['android:name'] === 'android.app.shortcuts')) {
      meta.push({ $: { 'android:name': 'android.app.shortcuts', 'android:resource': '@xml/shortcuts' } });
    }
    return cfg;
  });
}

module.exports = function withAppShortcuts(config) {
  return withShortcutMeta(withShortcutStrings(withShortcutFiles(config)));
};
module.exports.SHORTCUTS = SHORTCUTS;
