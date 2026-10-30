// Every setting Sift can find, as a plain list. Each label is written exactly as Settings shows it (app/settings.tsx,
// src/components/CloudCard.tsx, src/components/ProfileSwitcher.tsx): scripts/test-search.js checks that each one still
// appears there, so this list cannot drift from the page. An id is `page:slug(label)`, which a result opens as
// /settings?page=…&row=…, and Settings scrolls to that row and pulses it once.

import { Range, SearchIndex, highlight } from './engine';

export type SettingsPage =
  | 'account' | 'appearance' | 'tools' | 'motion' | 'time' | 'deepwork' | 'privacy' | 'backup' | 'trash' | 'updates' | 'delete';

export interface SettingRow {
  /** `page:slug(label)` */
  id: string;
  page: SettingsPage;
  /** as Settings shows it */
  label: string;
  /** a line under it in the results */
  caption?: string;
  /** other words it is found by */
  keywords?: string;
}

/** Settings' page titles, as its list shows them. */
export const SETTINGS_PAGE_TITLES: Record<SettingsPage, string> = {
  account: 'Account', appearance: 'Appearance', tools: 'Tabs and tools', motion: 'Motion and start screen',
  time: 'Time and reminders', deepwork: 'Deep Work', privacy: 'Privacy and locks', backup: 'Backup',
  trash: 'Recently deleted', updates: 'Updates', delete: 'Delete',
};

/** A label as an id part: lower case, words joined by hyphens, nothing else. */
export function slug(label: string): string {
  return String(label ?? '')
    .toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export const settingId = (page: SettingsPage, label: string) => page + ':' + slug(label);

type Def = [label: string, caption?: string, keywords?: string];

const DEFS: Record<SettingsPage, Def[]> = {
  account: [
    ['Account', 'Profiles, your name and photo, cloud backup', 'profile sign in login'],
    ['Profiles', 'Switch, add or rename a profile', 'switch user people family'],
    ['Name and photo', 'What the greeting calls you', 'name photo picture avatar profile'],
    ['Cloud backup', 'Keep a copy in your own private space', 'cloud sync supabase sign in login account email'],
    ['Back up automatically', 'Changes back up as you go', 'auto sync cloud'],
    ['Attachments on Wi-Fi only', 'Mobile data is never used for files', 'wifi mobile data attachments files'],
    ['Back up now', undefined, 'sync cloud upload'],
    ['Change password', undefined, 'password account security'],
  ],
  appearance: [
    ['Appearance', 'Theme, accent colour and writing font', 'look style colours'],
    ['Theme', 'Default or Minimalistic', 'dark theme minimal contrast look'],
    ['Accent colour', 'The colour of what is picked out', 'color accent iris aqua sky rose amber mint terracotta'],
    ['Writing font', 'Sans or Serif, for Notes and the Journal', 'font serif sans typeface writing'],
  ],
  tools: [
    ['Tabs and tools', 'What sits in the tab bar', 'tab bar slots tools'],
    ['Tab bar slots', 'Choose the three tools in the bar', 'tabs bar slots swap tools'],
    ['Archived', 'Tools kept out of sight', 'archive hide restore tools'],
    ['Pull down to search', 'Top bar, anywhere or off', 'pull gesture swipe down search sift open'],
    ['Tab bar on wide screens', 'A side rail or a bottom bar', 'tablet pc navigation rail bottom vertical horizontal tabs arrows'],
  ],
  motion: [
    ['Motion and start screen', 'Animations and the intro', 'motion animation intro'],
    ['Animations', 'Off, Some or Everything', 'motion animation reduce'],
    ['Start screen', 'The intro as the app opens', 'intro splash signature start'],
    ['Disable the big signature', 'The logo and the words come first', 'intro signature logo'],
    ['Tap to skip the intro', 'A tap goes straight to Today', 'intro skip tap'],
    ['Your signature', 'Record your own for the start screen', 'signature record handwriting intro'],
  ],
  time: [
    ['Time and reminders', 'The clock and notifications', 'time clock reminders notifications'],
    ['24-hour time', undefined, 'clock 24 hour time format'],
    ['All reminders (master)', 'The switch for every notification', 'reminders notifications master alerts'],
    ['Exam reminders', 'The evening before each dated exam', 'exam reminders notifications evening'],
  ],
  deepwork: [
    ['Deep Work', 'The chime and the ambient screen', 'focus timer pomodoro'],
    ['Chime when a block ends', 'A soft chime as well as the buzz', 'sound chime focus block end'],
    ['Ambient screen', 'The dark screen while a block runs', 'ambient screen focus black'],
    ['Seconds on the ambient screen', undefined, 'seconds ambient timer'],
    ['Time of day on the ambient screen', undefined, 'clock time ambient'],
  ],
  privacy: [
    ['Privacy and locks', 'Locks and the app PIN', 'privacy lock pin'],
    ['Lock the journal', 'Your app PIN opens it', 'lock journal pin private diary'],
    ['Lock Notes', 'The whole tool behind the PIN', 'lock notes pin private'],
    ['Your screen lock can also open', 'Fingerprint, face or the phone PIN', 'fingerprint face biometric screen lock'],
    ['App PIN', 'Set, change or remove it', 'pin code password lock'],
    ['Re-lock after', 'How long away before it locks again', 'relock grace timeout lock'],
  ],
  backup: [
    ['Backup', 'Export or import a backup file', 'backup export import file'],
    ['Backup file', 'Everything, with attachments', 'backup file export import'],
    ['Export a backup file', undefined, 'export save backup file download'],
    ['Import backup', 'Replaces all current data', 'import restore backup file'],
  ],
  trash: [
    ['Recently deleted', 'Kept for 30 days', 'trash bin deleted restore undo'],
    ['Empty Recently deleted', 'Delete everything in it for good', 'trash empty bin'],
  ],
  updates: [
    ['Updates', 'Check for a new version', 'update version apk release'],
    ['Check for a new version', 'From the GitHub releases', 'update version github release apk download'],
  ],
  delete: [
    ['Delete', 'Your account, cloud data or this phone', 'erase wipe reset delete'],
    ['Delete my account', 'Your account and its cloud copy', 'delete account erase'],
    ['Delete my cloud data', 'The copy in the cloud', 'delete cloud erase'],
    ['Delete everything on this phone', undefined, 'erase wipe reset phone'],
  ],
};

/** Every setting, page by page in the order Settings lists them. */
export const SETTINGS_INDEX: SettingRow[] = (Object.keys(DEFS) as SettingsPage[]).flatMap((page) =>
  DEFS[page].map(([label, caption, keywords]) => ({ id: settingId(page, label), page, label, caption, keywords })));

/** A setting by its id. */
export const settingById = (id: string): SettingRow | undefined => SETTINGS_INDEX.find((r) => r.id === id);

/** Whether a row is a page's own entry (its label is the page's title), not a row inside it. */
export const isPageRow = (r: SettingRow) => r.label === SETTINGS_PAGE_TITLES[r.page];

/* ---------------------------------------------------------------- Settings' own search */

let settingsIndex: SearchIndex<SettingRow> | null = null;
function index(): SearchIndex<SettingRow> {
  if (settingsIndex) return settingsIndex;
  settingsIndex = new SearchIndex<SettingRow>();
  settingsIndex.setCollection('settings', SETTINGS_INDEX, (r) => ({
    key: 'setting:' + r.id, kind: 'setting', section: r.page, title: r.label, subtitle: r.caption,
    tags: SETTINGS_PAGE_TITLES[r.page], meta: r.keywords, payload: r,
  }));
  return settingsIndex;
}

/** One page's matching rows in Settings' own search, best first, with the label's matched ranges for the accent. */
export interface SettingsMatch {
  page: SettingsPage;
  title: string;
  rows: { row: SettingRow; ranges: Range[] }[];
}

/**
 * Settings' own search: the rows that match, grouped by page (pages in the order of their best match), with the
 * ranges of each label to draw in the accent. Empty for an empty query.
 */
export function searchSettings(q: string): SettingsMatch[] {
  const res = index().search(q, { perSection: 50 });
  const hits = res.top ? [res.top, ...res.sections.flatMap((s) => s.hits)] : res.sections.flatMap((s) => s.hits);
  const byPage = new Map<SettingsPage, SettingsMatch>();
  for (const h of hits) {
    const r = h.doc.payload;
    let m = byPage.get(r.page);
    if (!m) { m = { page: r.page, title: SETTINGS_PAGE_TITLES[r.page], rows: [] }; byPage.set(r.page, m); }
    m.rows.push({ row: r, ranges: highlight(r.label, res.terms) });
  }
  return [...byPage.values()];
}
