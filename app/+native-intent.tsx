import { parseAppLink } from '../src/appLinks';

// What the system hands the router when the app is opened by a link.
// - A share reaches the app through the native module (the share intake reads it, src/shareIntake.tsx); a link that
//   only names a share is not a page, so it opens Today at launch and changes nothing while the app is already open.
// - The app's own links (sturoids://search, sturoids://open?tool=…&item=…, from the app shortcuts and the phone
//   widgets) are actions, not pages: the router stays where it is (Today at launch) and the action is carried out once
//   the app is up (src/actions.ts).
// - Every other link goes where it says.

const SHARE_LINK = 'dataUrl=';

export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string {
  try {
    if (typeof path === 'string' && path.includes(SHARE_LINK)) return initial ? '/' : '';
    const link = parseAppLink(path);
    if (link) {
      // required here, not imported: this file is read before the app's modules are wanted
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      (require('../src/actions') as typeof import('../src/actions')).queueAppLink(link);
      return initial ? '/' : '';
    }
    return path;
  } catch {
    return initial ? '/' : '';
  }
}
