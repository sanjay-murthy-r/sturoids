// Sturoids for Windows: the app's web build (expo export -p web, copied into ./app) in a window of its own.
//
// It is served from a fixed local address (http://127.0.0.1:47823), never from files: the app's saved data lives in
// the page's database, which belongs to the page's origin, so the origin must be the same every launch; and YouTube's
// player only plays inside a page served over http. Only one copy runs at a time (a second launch brings the first
// forward), so the address is always free for it.

const { app, BrowserWindow, Menu, ipcMain, shell, session } = require('electron');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');

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

/**
 * A report's PDF (the page's Export PDF): the report's HTML is laid out in a window that is never shown and printed to
 * A4 there, so the file holds the report, not the app's window. Only the app's own page may ask, one report at a time.
 * The page is kept in a file for the moment it takes (a long report is too big to go in an address), and its fonts are
 * waited for a little.
 *
 * The window has a session of its own, kept in memory: it may read its own file and the report's fonts (Google Fonts)
 * and nothing else, so no other file of the computer and no other address reaches the PDF, nothing is downloaded and
 * nothing is granted. Whatever happens, the window goes after a minute at most.
 */
const PAPER_MAX = 32 * 1024 * 1024; // characters of HTML: far past the longest report
const PAPER_FONTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;
const paperFiles = new Set(); // the files a paper window may read, lower-cased paths
let paperSession = null;
let printing = false;

function paperSes() {
  if (paperSession) return paperSession;
  paperSession = session.fromPartition('sturoids-paper');
  paperSession.webRequest.onBeforeRequest((details, done) => {
    const url = details.url;
    let ok = PAPER_FONTS.test(url) || url.startsWith('data:');
    if (!ok && url.startsWith('file:')) {
      try {
        ok = paperFiles.has(fileURLToPath(url).toLowerCase());
      } catch {
        ok = false;
      }
    }
    done({ cancel: !ok });
  });
  paperSession.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
  paperSession.setPermissionCheckHandler(() => false);
  paperSession.on('will-download', (_ev, item) => item.cancel());
  return paperSession;
}

const later = (ms) => new Promise((r) => setTimeout(r, ms));
function inTime(p, ms, what) {
  let t;
  return Promise.race([p, new Promise((_, no) => { t = setTimeout(() => no(new Error(what + ' took too long')), ms); })]).finally(() => clearTimeout(t));
}

async function printToPDF(e, html) {
  const own = 'http://127.0.0.1:' + PORT + '/';
  if (!win || e.sender !== win.webContents || e.senderFrame !== win.webContents.mainFrame || !String(e.senderFrame?.url || '').startsWith(own)) {
    throw new Error('Not allowed');
  }
  if (typeof html !== 'string' || !html || html.length > PAPER_MAX) throw new Error('The report is too big to print');
  if (printing) throw new Error('A report is already being printed');
  printing = true;
  const file = path.join(app.getPath('temp'), 'sturoids-report-' + process.pid + '-' + crypto.randomBytes(8).toString('hex') + '.html');
  const key = path.normalize(file).toLowerCase();
  let paper = null;
  try {
    paper = new BrowserWindow({
      show: false,
      width: 794,
      height: 1123,
      // javascript stays on only so the fonts can be waited for: the report has no scripts, and its session reaches
      // nothing but its own file and the fonts
      webPreferences: { session: paperSes(), contextIsolation: true, sandbox: true, nodeIntegration: false, javascript: true, webSecurity: true, spellcheck: false },
    });
    // the report has no links to follow and opens nothing
    paper.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    paper.webContents.on('will-navigate', (ev) => ev.preventDefault());
    paper.webContents.on('will-redirect', (ev) => ev.preventDefault());
    const pages = paper;
    await fs.promises.writeFile(file, html, { encoding: 'utf8', flag: 'wx' });
    paperFiles.add(key);
    return await inTime((async () => {
      // a font that never answers holds the page's loading open: after a while it is printed as it stands
      const loading = pages.loadFile(file);
      const late = await Promise.race([loading.then(() => false), later(15000).then(() => true)]);
      if (late) {
        loading.catch(() => {});
        pages.webContents.stop();
      }
      await Promise.race([
        pages.webContents.executeJavaScript('document.fonts ? document.fonts.ready.then(() => true) : true'),
        later(4000),
      ]).catch(() => {});
      const pdf = await pages.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true });
      return pdf.toString('base64');
    })(), 60000, 'Printing the report');
  } finally {
    printing = false;
    paperFiles.delete(key);
    if (paper && !paper.isDestroyed()) paper.destroy();
    fs.promises.unlink(file).catch(() => {});
  }
}

/*
 * Updates are not installed from here: a quiet install of the assisted installer could not be made reliable (it needs
 * elevation when Sturoids was installed for everyone, and it gave no sign of life for a minute while it ran). Settings,
 * Updates, finds a newer version and opens its installer's download in the browser; running it updates Sturoids in
 * place, keeping everything.
 */

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
    ipcMain.handle('print-to-pdf', printToPDF);
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
