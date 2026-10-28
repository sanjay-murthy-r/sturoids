// expo-sharing on the PC version: there is no share sheet, so "share" saves the file through the browser's download
// (the desktop app asks where to save it). Backups and report exports go this way.
import { displayUrl } from './fileSystem';

export const isAvailableAsync = async () => true;

export async function shareAsync(uri: string, opts: { dialogTitle?: string; mimeType?: string } = {}) {
  let href = displayUrl(uri) || uri;
  if (href.startsWith('file:')) {
    // not loaded into the page yet: fetch it through the shim's own reader
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const FS = require('./fileSystem') as typeof import('./fileSystem');
    const b64 = await FS.readAsStringAsync(uri, { encoding: 'base64' });
    href = 'data:' + (opts.mimeType || 'application/octet-stream') + ';base64,' + b64;
  }
  const a = document.createElement('a');
  a.href = href;
  a.download = decodeURIComponent(uri.split('/').pop() || 'sturoids-file');
  document.body.appendChild(a);
  a.click();
  a.remove();
}
