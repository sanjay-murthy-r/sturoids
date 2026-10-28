// The app's own restart module on the PC version: a profile switch reloads the page, starting every module afresh.
export function restartApp(): boolean {
  if (typeof window === 'undefined') return false;
  setTimeout(() => window.location.reload(), 0);
  return true;
}
