// Run after every install (package.json "postinstall"), so the phone build (EAS) gets it too: places each home-screen
// widget's tap areas by their own left, top, width and height. The library works out a right padding from the width
// the launcher reports, and launchers (Samsung's, a tablet turned sideways) often report a width other than the one
// they show, which shifted the areas on the right of a widget (the Calculator's keys) away from what is drawn under
// them. Safe to run again: a file already changed is left as it is, and a missing library is skipped.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'node_modules', 'react-native-android-widget', 'android', 'src', 'main');

const edits = [
  {
    file: path.join(root, 'java', 'com', 'reactnativeandroidwidget', 'RNWidget.java'),
    from: 'RNWidgetUtil.dpToPx(appContext, RNWidgetUtil.getWidgetWidth(appContext, widgetId)) - offsetViewBounds.right,',
    to: '0, // Sturoids: the area takes its own width (below), not a right padding from the reported widget width',
  },
  {
    file: path.join(root, 'java', 'com', 'reactnativeandroidwidget', 'RNWidget.java'),
    from: 'clickableRemoteView.setInt(R.id.rn_widget_clickable_area, "setMinimumHeight", offsetViewBounds.height());',
    to:
      'clickableRemoteView.setInt(R.id.rn_widget_clickable_area, "setMinimumWidth", offsetViewBounds.width());\n' +
      '        clickableRemoteView.setInt(R.id.rn_widget_clickable_area, "setMinimumHeight", offsetViewBounds.height());',
    done: '"setMinimumWidth"',
  },
  {
    file: path.join(root, 'res', 'layout', 'rn_widget_clickable.xml'),
    from: 'android:id="@+id/rn_widget_clickable_area"\n        android:layout_width="match_parent"',
    to: 'android:id="@+id/rn_widget_clickable_area"\n        android:layout_width="wrap_content"',
  },
];

if (!fs.existsSync(root)) process.exit(0);
let failed = false;
for (const e of edits) {
  const text = fs.readFileSync(e.file, 'utf8').replace(/\r\n/g, '\n');
  if (text.includes(e.done || e.to)) continue;
  if (!text.includes(e.from)) {
    console.warn('patch-widgets: ' + path.basename(e.file) + ' has changed; its tap areas were not adjusted.');
    failed = true;
    continue;
  }
  fs.writeFileSync(e.file, text.replace(e.from, e.to));
}
if (!failed) console.log('patch-widgets: widget tap areas adjusted.');
