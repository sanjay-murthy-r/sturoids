// The one door between the app's page and the desktop: making a report's PDF. The page hands over the report's HTML and
// gets the PDF back; nothing else of the computer is reachable from the page. (Updates on the PC are a download of the
// installer, opened in the browser from Settings, so there is no bridge for them.)

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sturoidsDesktop', {
  /** Lays out `html` as A4 pages and resolves with the PDF, base64. */
  printToPDF: (html) => ipcRenderer.invoke('print-to-pdf', String(html)),
});
