// expo-print on the PC version. Its own web build prints the app's window, whatever page was asked for, and hands back
// no file. In the desktop app the report is made into a real PDF instead: the desktop lays the page out in a window of
// its own that is never shown and prints it to A4, and the file is kept under the same file:// paths a phone uses, so
// the export moves and saves it exactly as it does there. In a plain browser there is no such door, so the page is
// printed from a frame of its own and the browser's print dialog offers Save as PDF; no file comes back then (an
// empty uri), and the export knows the dialog has done the saving.
import { cacheDirectory, writeAsStringAsync } from './fileSystem';

interface Desktop { printToPDF?: (html: string) => Promise<string> }
interface FileOptions { html?: string; width?: number; height?: number; base64?: boolean; [k: string]: any }

export const Orientation = { portrait: 'portrait', landscape: 'landscape' } as const;

const desktop = (): Desktop | undefined => (globalThis as any).sturoidsDesktop;

/** Prints the page from a hidden frame of its own: the print dialog shows the report, never the app behind it. */
function printInFrame(html: string): Promise<void> {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      // the dialog has closed by now (print waits for it); the frame goes a moment later, once it has let go
      setTimeout(() => frame.remove(), 1000);
      resolve();
    };
    frame.onload = () => {
      const w = frame.contentWindow;
      if (!w) return finish();
      // the report's fonts come from the web: wait for them a little, so the dialog shows the page as it is meant
      const fonts = (w.document as any).fonts?.ready ?? Promise.resolve();
      Promise.race([fonts, new Promise((r) => setTimeout(r, 2500))]).then(() => {
        try {
          w.focus();
          w.print();
        } finally {
          finish();
        }
      });
    };
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}

export async function printToFileAsync(opts: FileOptions = {}) {
  const html = opts.html || '';
  const desk = desktop();
  if (desk?.printToPDF) {
    const b64 = await desk.printToPDF(html);
    const uri = cacheDirectory + 'Print/' + Date.now().toString(36) + '.pdf';
    await writeAsStringAsync(uri, b64, { encoding: 'base64' });
    return { uri, numberOfPages: 0, base64: opts.base64 ? b64 : undefined };
  }
  await printInFrame(html);
  return { uri: '', numberOfPages: 0 };
}

export async function printAsync(opts: { html?: string; uri?: string; [k: string]: any } = {}) {
  if (opts.html) await printInFrame(opts.html);
  else window.print();
}

export async function selectPrinterAsync(): Promise<{ name: string; url: string }> {
  throw new Error('Choosing a printer is not available here.');
}

export default { Orientation, printToFileAsync, printAsync, selectPrinterAsync };
