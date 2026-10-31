// The one door between the app's page and the desktop: updates. The page asks for a release's installer to be fetched
// in the background, and to be installed now (Sturoids closes, installs quietly and opens again) or when it is next
// closed. Nothing else of the computer is reachable from the page.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sturoidsDesktop', {
  /** Fetches the installer at `url` (a GitHub release file) for version `version`; resolves true once it is ready. */
  stageUpdate: (url, version) => ipcRenderer.invoke('stage-update', url, version),
  /** The version fetched and waiting, or null. */
  stagedVersion: () => ipcRenderer.invoke('staged-version'),
  /** Closes Sturoids, installs the waiting version quietly and opens it again. */
  installNow: () => ipcRenderer.invoke('install-now'),
});
