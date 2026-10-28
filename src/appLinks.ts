// The app's own links (sturoids://…), from app shortcuts and phone widgets, read into what they ask for. Pure, with no
// imports, so scripts/test-links.js checks it in Node. app/+native-intent.tsx reads a link with this and src/actions.ts
// carries it out once the app is up.
//
//   sturoids://search                     opens Sift (sturoids://search?q=words opens it on those words)
//   sturoids://new-note                   a new note, opened
//   sturoids://add-todo                   the "Add a task" sheet (?title= fills it)
//   sturoids://start-focus                Deep Work on its last length
//   sturoids://open?tool=<key>&item=<id>  a tool, on one of its things; any other query parts go along to the tool

export type AppLink =
  | { kind: 'action'; action: 'search' | 'new-note' | 'add-todo' | 'start-focus'; query?: string }
  | { kind: 'open'; tool: string; params: Record<string, string> };

export const APP_SCHEME = 'sturoids';

const ACTION_HOSTS = ['search', 'new-note', 'add-todo', 'start-focus'] as const;

function decode(v: string): string {
  try {
    return decodeURIComponent(v.replace(/\+/g, ' '));
  } catch {
    return v;
  }
}

/**
 * What an app link asks for, or null when it is not one of the app's own (an ordinary page path, a share's link, junk).
 * Accepts the link as Android hands it over (sturoids://open?…), and as a path (/open?…, open?…).
 */
export function parseAppLink(raw: unknown): AppLink | null {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s || s.length > 2000) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(s);
  if (scheme) {
    if (scheme[1].toLowerCase() !== APP_SCHEME) return null;
    s = s.slice(scheme[0].length);
  }
  s = s.replace(/^\/+/, '');
  const hashAt = s.indexOf('#');
  if (hashAt >= 0) s = s.slice(0, hashAt);
  const qAt = s.indexOf('?');
  const name = (qAt >= 0 ? s.slice(0, qAt) : s).replace(/\/+$/, '').toLowerCase();
  const query: Record<string, string> = {};
  if (qAt >= 0) {
    for (const part of s.slice(qAt + 1).split('&')) {
      if (!part) continue;
      const eq = part.indexOf('=');
      const k = decode(eq >= 0 ? part.slice(0, eq) : part).trim();
      if (!k || !/^[a-zA-Z][\w-]{0,31}$/.test(k) || k in query) continue;
      query[k] = decode(eq >= 0 ? part.slice(eq + 1) : '').slice(0, 500);
    }
  }
  if ((ACTION_HOSTS as readonly string[]).includes(name)) {
    const q = name === 'search' ? query.q : name === 'add-todo' ? query.title : undefined;
    const link: AppLink = { kind: 'action', action: name as (typeof ACTION_HOSTS)[number] };
    if (q && q.trim()) link.query = q.trim();
    return link;
  }
  if (name === 'open') {
    const tool = (query.tool || '').trim();
    if (!/^[a-z][a-zA-Z0-9]{0,31}$/.test(tool)) return null;
    const params: Record<string, string> = {};
    for (const k of Object.keys(query)) if (k !== 'tool' && query[k] !== '') params[k] = query[k];
    return { kind: 'open', tool, params };
  }
  return null;
}
