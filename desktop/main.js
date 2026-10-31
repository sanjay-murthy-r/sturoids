// Sturoids for Windows: the app's web build (expo export -p web, copied into ./app) in a window of its own.
//
// It is served from a fixed local address (http://127.0.0.1:47823), never from files: the app's saved data lives in
// the page's database, which belongs to the page's origin, so the origin must be the same every launch; and YouTube's
// player only plays inside a page served over http. Only one copy runs at a time (a second launch brings the first
// forward), so the address is always free for it.

const { app, BrowserWindow, Menu, shell, session, ipcMain } = require('electron');
const http = require('http');
const https = require('https');
const os = require('os');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 47823;
const ROOT = path.join(__dirname, 'app');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf',
  '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
  '.map': 'application/json',
};

/** Serves the web build; any path that is not a file is the app's own page (its router reads the address). */
function serve() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let rel = decodeURIComponent((req.url || '/').split('?')[0]);
      let file = path.normalize(path.join(ROOT, rel));
      if (!file.startsWith(ROOT)) file = path.join(ROOT, 'index.html');
      fs.stat(file, (err, st) => {
        if (err || !st.isFile()) file = path.join(ROOT, 'index.html');
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
        fs.createReadStream(file).pipe(res);
      });
    });
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

/** The window's last size and place, kept between launches. */
const boundsFile = () => path.join(app.getPath('userData'), 'window.json');
function readBounds() {
  try {
    return JSON.parse(fs.readFileSync(boundsFile(), 'utf8'));
  } catch {
    return null;
  }
}

let win = null;

function createWindow() {
  const kept = readBounds();
  win = new BrowserWindow({
    width: kept?.width || 1360,
    height: kept?.height || 860,
    x: kept?.x,
    y: kept?.y,
    minWidth: 420,
    minHeight: 560,
    backgroundColor: '#262624',
    title: 'Sturoids',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, spellcheck: true, preload: path.join(__dirname, 'preload.js') },
  });
  if (kept?.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  const keep = () => {
    if (!win) return;
    try {
      fs.writeFileSync(boundsFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }));
    } catch {
      // the next launch opens at the default size
    }
  };
  win.on('close', keep);
  // a link to anywhere but the app opens in the default browser, as it does from the phone app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('http://127.0.0.1:' + PORT)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
  win.loadURL('http://127.0.0.1:' + PORT + '/');
}

/* ---------------------------------------------------------------- updates */

// A new version is fetched in the background (the page asks, having found it on GitHub), then installed quietly by the
// installer's own silent mode: at once if the user says so (Sturoids closes and opens again on the new version), or
// otherwise as Sturoids is closed, so the next launch is simply the new version. No window, no questions.

/** only GitHub's own addresses are fetched from */
const TRUSTED = /^https:\/\/(github\.com|objects\.githubusercontent\.com|release-assets\.githubusercontent\.com)\//;
let staged = null; // { file, version }
let installing = false;

function fetchTo(url, file, hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > 6 || !TRUSTED.test(url)) { reject(new Error('untrusted address')); return; }
    https.get(url, { headers: { 'User-Agent': 'Sturoids' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        fetchTo(res.headers.location, file, hops + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error('status ' + res.statusCode)); return; }
      const out = fs.createWriteStream(file + '.part');
      res.pipe(out);
      out.on('finish', () => out.close(() => { fs.rename(file + '.part', file, (e) => (e ? reject(e) : resolve())); }));
      out.on('error', reject);
    }).on('error', reject);
  });
}

ipcMain.handle('stage-update', async (_e, url, version) => {
  if (typeof url !== 'string' || typeof version !== 'string' || !/^[\w.-]{1,32}$/.test(version)) return false;
  if (staged && staged.version === version && fs.existsSync(staged.file)) return true;
  const file = path.join(os.tmpdir(), 'Sturoids-Setup-' + version + '.exe');
  try {
    await fetchTo(url, file);
    staged = { file, version };
    return true;
  } catch {
    return false;
  }
});
ipcMain.handle('staged-version', () => (staged && fs.existsSync(staged.file) ? staged.version : null));

/** Runs the waiting installer quietly; `reopen` opens the new version once it is in. */
function runInstaller(reopen) {
  if (!staged || installing || !fs.existsSync(staged.file)) return false;
  installing = true;
  const args = ['/S'];
  if (reopen) args.push('--force-run');
  try {
    spawn(staged.file, args, { detached: true, stdio: 'ignore' }).unref();
    return true;
  } catch {
    installing = false;
    return false;
  }
}
ipcMain.handle('install-now', () => {
  if (!runInstaller(true)) return false;
  setTimeout(() => app.quit(), 300);
  return true;
});
// closing Sturoids with a version waiting installs it, quietly, for next time
app.on('will-quit', () => { if (staged && !installing) runInstaller(false); });

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(async () => {
    // Windows shows the app's notifications (reminders) under its own name
    app.setAppUserModelId('com.sanjay.sturoids');
    Menu.setApplicationMenu(null);
    // Desmos refuses to be shown inside another page; inside the app's own frame it is let in
    session.defaultSession.webRequest.onHeadersReceived({ urls: ['https://*.desmos.com/*'] }, (details, done) => {
      const headers = { ...details.responseHeaders };
      for (const k of Object.keys(headers)) {
        const low = k.toLowerCase();
        if (low === 'x-frame-options') delete headers[k];
        if (low === 'content-security-policy') headers[k] = headers[k].map((v) => v.replace(/frame-ancestors[^;]*;?/gi, ''));
      }
      done({ responseHeaders: headers });
    });
    // the page may ask to show notifications (reminders); nothing else is granted
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'notifications' || permission === 'clipboard-sanitized-write' || permission === 'fullscreen'));
    try {
      await serve();
    } catch (e) {
      const { dialog } = require('electron');
      dialog.showErrorBox('Sturoids could not start', 'Another program is using the port Sturoids needs (' + PORT + '). Close it and try again.');
      app.quit();
      return;
    }
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
