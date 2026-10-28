// Sift's engine: pure TypeScript, no React and no store, so the Node tests run it as it is (scripts/test-search.js).
//
// Documents come in collections (the ToDos, the notes, the settings). A collection is indexed once and kept until its
// source changes identity (zustand makes a new array on every change), and inside it each document is prepared once
// and kept while its own source object is unchanged, so one edited note re-reads one note, never the whole library.
// A query is matched term by term against each collection's sorted tokens, in tiers (exact, prefix, word start inside
// a compound, substring, a typo, an acronym or a subsequence, a related word), with bounded fuzzy work per term.

/* ---------------------------------------------------------------- documents */

export interface SearchDoc<P = unknown> {
  /** unique across every collection, such as 'note:abc' */
  key: string;
  /** what it is, for priors and filters: 'tool', 'action', 'setting', 'note', … */
  kind: string;
  /** the results section it is listed under */
  section: string;
  title: string;
  subtitle?: string;
  /** tags, the subject, the folder (weighted 0.8) */
  tags?: string;
  /** the text (0.45) */
  body?: string;
  /** keywords and anything else worth finding it by (0.3) */
  meta?: string;
  /** when it last changed or happened, in ms; recent things rank a little higher */
  at?: number;
  payload: P;
}

export const FIELD_WEIGHT = { title: 1, tags: 0.8, body: 0.45, meta: 0.3 } as const;

/** Kinds that rank a little higher for a short query: what you came to open or do, not what you wrote. */
const QUICK_KINDS = new Set(['tool', 'action', 'setting']);

/* ---------------------------------------------------------------- normalising */

const COMBINING = /[̀-ͯ]/g;
/** spaces, punctuation and symbols: everything that splits words */
const SPLIT = /[\s!-/:-@[-`{-~ -¿ -⁯←-⯿　-〿×÷]+/;

/** Lower case, accents taken off (NFKD), as one string. */
export function fold(s: string): string {
  return String(s ?? '').toLowerCase().normalize('NFKD').replace(COMBINING, '');
}

/**
 * The folded text with, for each of its characters, the index of the character in `s` it came from: a match found in
 * the folded text maps back to the words as written, for highlighting.
 */
export function foldWithMap(s: string): { text: string; map: number[] } {
  let text = '';
  const map: number[] = [];
  const src = String(s ?? '');
  for (let i = 0; i < src.length; i++) {
    const f = src[i].toLowerCase().normalize('NFKD').replace(COMBINING, '');
    for (let k = 0; k < f.length; k++) map.push(i);
    text += f;
  }
  return { text, map };
}

/** The words of a text, folded, in order (duplicates kept). */
export function words(s: string): string[] {
  return fold(s).split(SPLIT).filter(Boolean);
}

/**
 * Light stemming: plurals (s, es, ies), -ing and -ed, with a doubled consonant undone (planned, running). Words of three
 * letters or fewer, and anything with a digit, stay as written.
 */
export function stem(w: string): string {
  if (w.length <= 3 || /\d/.test(w)) return w;
  const undouble = (x: string) => (/([b-df-hj-np-tv-z])\1$/.test(x) && !/(ll|ss|zz|ff)$/.test(x) ? x.slice(0, -1) : x);
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (w.endsWith('ied') && w.length > 4) return w.slice(0, -3) + 'y';
  if (w.endsWith('ing') && w.length > 5) return undouble(w.slice(0, -3));
  if (w.endsWith('ed') && w.length > 4 && !w.endsWith('eed')) return undouble(w.slice(0, -2));
  if (/(ss|sh|ch|x|z)es$/.test(w) && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('s') && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

/**
 * The optimal-string-alignment distance (Damerau–Levenshtein with adjacent swaps), or max + 1 as soon as it is sure to
 * be more than `max`: bounded work for the typo tier.
 */
export function editDistance(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let prev2 = new Array<number>(lb + 1).fill(0);
  let prev = new Array<number>(lb + 1);
  let cur = new Array<number>(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    let rowMin = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    const t = prev2;
    prev2 = prev;
    prev = cur;
    cur = t;
  }
  return prev[lb];
}

const bigrams = (w: string): Set<string> => {
  const out = new Set<string>();
  for (let i = 0; i + 1 < w.length; i++) out.add(w.slice(i, i + 2));
  return out;
};

function isSubsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (let j = 0; j < hay.length && i < needle.length; j++) if (hay[j] === needle[i]) i++;
  return i === needle.length;
}

/* ---------------------------------------------------------------- related words */

/** Words that mean the same here, both ways: a match through one of them scores 0.7 of a direct one. */
export const SYNONYMS: string[][] = [
  ['exam', 'test', 'mock', 'quiz', 'paper'],
  ['todo', 'task'],
  ['diary', 'journal'],
  ['dark', 'theme', 'appearance'],
  ['notification', 'reminder', 'alert'],
  ['password', 'account', 'sign in'],
  ['photo', 'picture', 'avatar'],
  ['focus', 'deep work', 'pomodoro', 'timer'],
  ['video', 'lecture', 'youtube', 'vault'],
  ['marks', 'score', 'grade', 'result'],
  ['maths', 'calculator', 'graph', 'desmos'],
  ['delete', 'trash', 'recently deleted'],
  ['font', 'type', 'writing font'],
];

/** term (a single folded, stemmed word) → the other phrases of its groups, each as its words */
const RELATED = (() => {
  const out = new Map<string, string[][]>();
  for (const group of SYNONYMS) {
    const phrases = group.map((p) => words(p).map(stem));
    phrases.forEach((ph, i) => {
      if (ph.length !== 1) return;
      const others = phrases.filter((_, k) => k !== i);
      const list = out.get(ph[0]) ?? [];
      list.push(...others);
      out.set(ph[0], list);
    });
  }
  return out;
})();

/* ---------------------------------------------------------------- the index */

interface Prepared<P> {
  doc: SearchDoc<P>;
  /** token → the best field weight it appears with in this document */
  tokens: Map<string, number>;
  /** the title's initials, for acronyms ("ptp" for Physics test paper) */
  initials: string;
  /** joined tokens of hyphenated or slashed words, with where each part starts: "e-mail" adds "email" at [0, 1] */
  compounds: Map<string, number[]>;
}

function addTokens(into: Map<string, number>, text: string | undefined, weight: number, compounds: Map<string, number[]>) {
  if (!text) return;
  const folded = fold(text);
  for (const w of folded.split(SPLIT)) {
    if (!w) continue;
    for (const t of w === stem(w) ? [w] : [w, stem(w)]) {
      if ((into.get(t) ?? 0) < weight) into.set(t, weight);
    }
  }
  // hyphenated and slashed words are found whole too ("email" finds "e-mail"), with their parts' starts kept
  const re = /[a-z0-9]+(?:[-/'][a-z0-9]+)+/g;
  for (let m = re.exec(folded); m; m = re.exec(folded)) {
    const parts = m[0].split(/[-/']/);
    const joined = parts.join('');
    const starts: number[] = [];
    let at = 0;
    for (const p of parts) { starts.push(at); at += p.length; }
    compounds.set(joined, starts);
    if ((into.get(joined) ?? 0) < weight) into.set(joined, weight);
  }
}

export function prepareDoc<P>(doc: SearchDoc<P>): Prepared<P> {
  const tokens = new Map<string, number>();
  const compounds = new Map<string, number[]>();
  addTokens(tokens, doc.title, FIELD_WEIGHT.title, compounds);
  addTokens(tokens, doc.tags, FIELD_WEIGHT.tags, compounds);
  addTokens(tokens, doc.body, FIELD_WEIGHT.body, compounds);
  addTokens(tokens, doc.meta, FIELD_WEIGHT.meta, compounds);
  const initials = words(doc.title).map((w) => w[0]).join('');
  return { doc, tokens, initials, compounds };
}

interface Collection<P> {
  src: unknown;
  version: unknown;
  docs: Prepared<P>[];
  /** sorted, unique */
  sorted: string[];
  /** token → [doc index, weight] pairs */
  post: Map<string, { d: number; w: number }[]>;
  compounds: Map<string, number[]>;
}

function assemble<P>(src: unknown, version: unknown, docs: Prepared<P>[]): Collection<P> {
  const post = new Map<string, { d: number; w: number }[]>();
  const compounds = new Map<string, number[]>();
  docs.forEach((p, d) => {
    for (const [t, w] of p.tokens) {
      const list = post.get(t);
      if (list) list.push({ d, w });
      else post.set(t, [{ d, w }]);
    }
    for (const [t, s] of p.compounds) compounds.set(t, s);
  });
  return { src, version, docs, sorted: [...post.keys()].sort(), post, compounds };
}

function lowerBound(sorted: string[], key: string): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < key) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** How far the fuzzy tiers may go for one term in one collection. */
const MAX_PREFIX = 400;
const MAX_FUZZY_CHECKS = 4000;

/** The candidate tokens of one collection for one query term, each with its tier's score. */
function candidates(col: Collection<unknown>, term: string): Map<string, number> {
  const out = new Map<string, number>();
  const put = (t: string, s: number) => { if ((out.get(t) ?? 0) < s) out.set(t, s); };
  const st = stem(term);
  for (const t of term === st ? [term] : [term, st]) {
    if (col.post.has(t)) put(t, 1);
    // prefix: as you type, "phy" finds physics
    let n = 0;
    for (let i = lowerBound(col.sorted, t); i < col.sorted.length && n < MAX_PREFIX; i++, n++) {
      const tok = col.sorted[i];
      if (!tok.startsWith(t)) break;
      if (tok !== t) put(tok, 0.9);
    }
  }
  if (term.length < 3) return out;
  // a word start inside a compound (0.8), or anywhere inside a word (0.6)
  for (const tok of col.sorted) {
    if (tok.length <= term.length) continue;
    const at = tok.indexOf(term);
    if (at <= 0) continue;
    const starts = col.compounds.get(tok);
    put(tok, starts && starts.includes(at) ? 0.8 : 0.6);
  }
  // a typo: one edit for 4 to 7 letters, two from 8, only against words of a like length that share the first letter
  // or a pair of letters; then an acronym-like subsequence ("cmstry" for chemistry)
  const typo = term.length >= 4 && !/\d/.test(term);
  const maxD = term.length >= 8 ? 2 : 1;
  const grams = typo ? bigrams(term) : null;
  let checks = 0;
  for (const tok of col.sorted) {
    if (out.has(tok)) continue;
    if (typo && checks < MAX_FUZZY_CHECKS && Math.abs(tok.length - term.length) <= maxD) {
      let near = tok[0] === term[0];
      if (!near && grams) for (const g of bigrams(tok)) if (grams.has(g)) { near = true; break; }
      if (near) {
        checks++;
        const d = editDistance(term, tok, maxD);
        if (d <= maxD) { put(tok, d === 1 ? 0.5 : 0.4); continue; }
      }
    }
    if (tok[0] === term[0] && tok.length > term.length && tok.length <= term.length * 3 && isSubsequence(term, tok)) put(tok, 0.35);
  }
  return out;
}

/** exact and prefix only, for the words of a related phrase */
function strictCandidates(col: Collection<unknown>, word: string): Map<string, number> {
  const out = new Map<string, number>();
  if (col.post.has(word)) out.set(word, 1);
  let n = 0;
  for (let i = lowerBound(col.sorted, word); i < col.sorted.length && n < MAX_PREFIX; i++, n++) {
    const tok = col.sorted[i];
    if (!tok.startsWith(word)) break;
    if (tok !== word && !out.has(tok)) out.set(tok, 0.9);
  }
  return out;
}

/** Per document, the best score of one set of candidates (tier × the field weight it was found in). */
function scoreDocs(col: Collection<unknown>, cand: Map<string, number>, into: Float64Array, scale = 1) {
  for (const [tok, tier] of cand) {
    const list = col.post.get(tok);
    if (!list) continue;
    for (const { d, w } of list) {
      const s = tier * w * scale;
      if (s > into[d]) into[d] = s;
    }
  }
}

/* ---------------------------------------------------------------- results */

export interface Hit<P> {
  doc: SearchDoc<P>;
  score: number;
  /** whether every term matched it (false: it came from the OR fallback) */
  all: boolean;
}

export interface ResultSection<P> {
  section: string;
  hits: Hit<P>[];
  /** how many more there were past the section's cap */
  more: number;
  best: number;
}

export interface SearchResult<P> {
  terms: string[];
  /** the one result that leads the rest by 15% or more */
  top: Hit<P> | null;
  sections: ResultSection<P>[];
  total: number;
  /** when nothing matched: the nearest indexed words in place of the query's */
  didYouMean?: string;
}

export interface SearchOptions<P> {
  /** a document left out (a scope chip, a lock) */
  filter?: (doc: SearchDoc<P>) => boolean;
  /** how many times a result has been opened from search */
  usage?: (key: string) => number;
  now?: number;
  /** results kept per section (5) */
  perSection?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The terms of a query: its words, folded, each once. */
export function queryTerms(q: string): string[] {
  return [...new Set(words(q))];
}

/**
 * The search index: collections set from their sources, searched together. Setting a collection whose source is the
 * same object (and version) as last time does nothing; otherwise only documents whose own source object changed are
 * prepared again.
 */
export class SearchIndex<P = unknown> {
  private cols = new Map<string, Collection<P>>();
  /** per collection, each source object's prepared documents (one object can feed two collections differently) */
  private caches = new Map<string, WeakMap<object, { v: unknown[]; prepared: Prepared<P>[] }>>();

  /**
   * `items` is the collection's source (its identity is what is compared); each item becomes zero or more documents
   * through `toDocs`. `version` is anything else the documents depend on (a lock, a loaded text), and `itemVersion` the
   * same for one item.
   */
  setCollection<T>(
    key: string, items: readonly T[], toDocs: (item: T) => SearchDoc<P>[] | SearchDoc<P> | null,
    version: unknown = 0, itemVersion?: (item: T) => unknown,
  ): void {
    const old = this.cols.get(key);
    if (old && old.src === items && old.version === version) return;
    const docs: Prepared<P>[] = [];
    let cache = this.caches.get(key);
    if (!cache) { cache = new WeakMap(); this.caches.set(key, cache); }
    for (const item of items) {
      const iv = itemVersion ? itemVersion(item) : 0;
      const v = [version, iv];
      const cacheable = item !== null && typeof item === 'object';
      const hit = cacheable ? cache.get(item as unknown as object) : undefined;
      if (hit && hit.v[0] === v[0] && hit.v[1] === v[1]) {
        docs.push(...hit.prepared);
        continue;
      }
      const made = toDocs(item);
      const list = (made == null ? [] : Array.isArray(made) ? made : [made]).map(prepareDoc);
      if (cacheable) cache.set(item as unknown as object, { v, prepared: list });
      docs.push(...list);
    }
    this.cols.set(key, assemble(items, version, docs));
  }

  /** Takes a collection out (a tool archived, a lock closed). */
  dropCollection(key: string): void {
    this.cols.delete(key);
  }

  hasCollection(key: string): boolean {
    return this.cols.has(key);
  }

  get size(): number {
    let n = 0;
    for (const c of this.cols.values()) n += c.docs.length;
    return n;
  }

  /** Every document, for a listing with no query. */
  all(): SearchDoc<P>[] {
    const out: SearchDoc<P>[] = [];
    for (const c of this.cols.values()) for (const p of c.docs) out.push(p.doc);
    return out;
  }

  /** A document by its key. */
  get(key: string): SearchDoc<P> | undefined {
    for (const c of this.cols.values()) for (const p of c.docs) if (p.doc.key === key) return p.doc;
    return undefined;
  }

  search(q: string, opts: SearchOptions<P> = {}): SearchResult<P> {
    const terms = queryTerms(q);
    const empty: SearchResult<P> = { terms, top: null, sections: [], total: 0 };
    if (!terms.length) return empty;
    const now = opts.now ?? Date.now();
    const shortQ = q.trim().length <= 4;
    const all: Hit<P>[] = [];
    const any: Hit<P>[] = [];
    const matchedTerm = new Array<boolean>(terms.length).fill(false);

    for (const col of this.cols.values()) {
      const n = col.docs.length;
      if (!n) continue;
      const per = terms.map((term, ti) => {
        const scores = new Float64Array(n);
        const cand = candidates(col as Collection<unknown>, term);
        scoreDocs(col as Collection<unknown>, cand, scores);
        // an acronym of the title
        if (term.length >= 2 && !/\d/.test(term)) {
          for (let d = 0; d < n; d++) {
            const ini = col.docs[d].initials;
            if (ini.length >= term.length && ini.startsWith(term) && scores[d] < 0.35) scores[d] = 0.35;
          }
        }
        // a related word, at 0.7 of its own score: every word of the related phrase must be there
        const related = RELATED.get(stem(term)) ?? RELATED.get(term);
        if (related) {
          for (const phrase of related) {
            let joint: Float64Array | null = null;
            for (const w of phrase) {
              const s = new Float64Array(n);
              scoreDocs(col as Collection<unknown>, strictCandidates(col as Collection<unknown>, w), s);
              if (!joint) joint = s;
              else for (let d = 0; d < n; d++) joint[d] = Math.min(joint[d], s[d]);
            }
            if (joint) for (let d = 0; d < n; d++) { const v = joint[d] * 0.7; if (v > scores[d]) scores[d] = v; }
          }
        }
        for (let d = 0; d < n; d++) if (scores[d] > 0) { matchedTerm[ti] = true; break; }
        return scores;
      });

      for (let d = 0; d < n; d++) {
        let sum = 0;
        let hits = 0;
        for (const s of per) if (s[d] > 0) { sum += s[d]; hits++; }
        if (!hits) continue;
        const doc = col.docs[d].doc;
        if (opts.filter && !opts.filter(doc)) continue;
        let score = sum;
        if (doc.at) score *= 1 + 0.25 * Math.exp(-Math.max(0, now - doc.at) / (30 * DAY_MS));
        const used = opts.usage ? opts.usage(doc.key) : 0;
        if (used > 0) score *= 1 + 0.15 * Math.log2(1 + used);
        if (shortQ && QUICK_KINDS.has(doc.kind)) score *= 1.15;
        if (hits === terms.length) all.push({ doc, score, all: true });
        else any.push({ doc, score: score * 0.5, all: false });
      }
    }

    // every term must match; with fewer than three such results the rest join at half their score
    let hits = all;
    if (all.length < 3 && terms.length > 1) hits = all.concat(any);
    if (!hits.length) {
      return { ...empty, didYouMean: this.suggest(terms, matchedTerm) };
    }
    hits.sort((a, b) => b.score - a.score || (b.doc.at ?? 0) - (a.doc.at ?? 0));

    let top: Hit<P> | null = null;
    if (hits.length === 1 || hits[0].score >= hits[1].score * 1.15) top = hits[0];
    const rest = top ? hits.slice(1) : hits;
    const cap = opts.perSection ?? 5;
    const bySection = new Map<string, Hit<P>[]>();
    for (const h of rest) {
      const list = bySection.get(h.doc.section);
      if (list) list.push(h);
      else bySection.set(h.doc.section, [h]);
    }
    const sections: ResultSection<P>[] = [];
    for (const [section, list] of bySection) {
      // inside a section: by score, then the more recent first
      list.sort((a, b) => b.score - a.score || (b.doc.at ?? 0) - (a.doc.at ?? 0));
      sections.push({ section, hits: list.slice(0, cap), more: Math.max(0, list.length - cap), best: list[0].score });
    }
    sections.sort((a, b) => b.best - a.best);
    return { terms, top, sections, total: hits.length };
  }

  /** The query with each term that matched nothing replaced by the nearest indexed word, two edits at most. */
  private suggest(terms: string[], matched: boolean[]): string | undefined {
    let changed = false;
    const out = terms.map((t, i) => {
      if (matched[i] || t.length < 3) return t;
      let best: { tok: string; d: number; n: number } | null = null;
      for (const col of this.cols.values()) {
        for (const tok of col.sorted) {
          if (Math.abs(tok.length - t.length) > 2) continue;
          const d = editDistance(t, tok, 2);
          if (d > 2) continue;
          const n = col.post.get(tok)?.length ?? 0;
          if (!best || d < best.d || (d === best.d && n > best.n)) best = { tok, d, n };
        }
      }
      if (!best) return t;
      changed = true;
      return best.tok;
    });
    return changed ? out.join(' ') : undefined;
  }
}

/* ---------------------------------------------------------------- highlighting */

export type Range = [number, number];

function mergeRanges(r: Range[]): Range[] {
  if (r.length < 2) return r;
  const s = [...r].sort((a, b) => a[0] - b[0]);
  const out: Range[] = [s[0]];
  for (let i = 1; i < s.length; i++) {
    const last = out[out.length - 1];
    if (s[i][0] <= last[1]) last[1] = Math.max(last[1], s[i][1]);
    else out.push(s[i]);
  }
  return out;
}

/** Where a folded word matches a term, inside the word: a prefix, a stem, a substring or a near spelling. */
function matchInWord(word: string, term: string): Range | null {
  if (word.startsWith(term)) return [0, term.length];
  if (stem(word) === stem(term)) return [0, word.length];
  if (term.length >= 3) {
    const at = word.indexOf(term);
    if (at > 0) return [at, at + term.length];
  }
  if (term.length >= 4 && !/\d/.test(term)) {
    const maxD = term.length >= 8 ? 2 : 1;
    if (editDistance(term, word, maxD) <= maxD) return [0, word.length];
  }
  return null;
}

/** The ranges of `text` (as written) that the query's terms match, for drawing them in the accent. */
export function highlight(text: string, terms: string[]): Range[] {
  if (!text || !terms.length) return [];
  const { text: f, map } = foldWithMap(text);
  const out: Range[] = [];
  const re = /[^\s!-/:-@[-`{-~ -¿ -⁯←-⯿　-〿×÷]+/g;
  for (let m = re.exec(f); m; m = re.exec(f)) {
    for (const t of terms) {
      const r = matchInWord(m[0], t);
      if (!r) continue;
      const a = map[m.index + r[0]];
      const b = map[m.index + r[1] - 1] + 1;
      out.push([a, b]);
      break;
    }
  }
  return mergeRanges(out);
}

/**
 * A short window of a body around its first match (about `width` characters), with ellipses where it was cut, and the
 * matches in it. Null when nothing in the body matches.
 */
export function snippet(body: string | undefined, terms: string[], width = 70): { text: string; ranges: Range[] } | null {
  if (!body || !terms.length) return null;
  const flat = body.replace(/\s+/g, ' ').trim();
  const ranges = highlight(flat, terms);
  if (!ranges.length) return null;
  const first = ranges[0][0];
  let start = Math.max(0, first - Math.round(width * 0.35));
  // start at a word
  if (start > 0) {
    const sp = flat.indexOf(' ', start);
    if (sp >= 0 && sp < first) start = sp + 1;
  }
  let end = Math.min(flat.length, start + width);
  if (end < flat.length) {
    const sp = flat.lastIndexOf(' ', end);
    if (sp > Math.max(first, start + width / 2)) end = sp;
  }
  const lead = start > 0 ? '…' : '';
  const tail = end < flat.length ? '…' : '';
  const text = lead + flat.slice(start, end) + tail;
  const shift = lead.length - start;
  const inside = ranges
    .filter(([a, b]) => a >= start && b <= end)
    .map(([a, b]) => [a + shift, b + shift] as Range);
  return { text, ranges: inside };
}

/* ---------------------------------------------------------------- dates in the query */

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

const keyOf = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
};

const weekdayOf = (w: string): number => {
  if (w.length < 3) return -1;
  return WEEKDAYS.findIndex((d) => d.startsWith(w) || (w === 'tues' && d === 'tuesday') || (w === 'thur' && d === 'thursday') || (w === 'thurs' && d === 'thursday'));
};
const monthOf = (w: string): number => (w.length < 3 ? -1 : MONTHS.findIndex((m) => m.startsWith(w)));

/**
 * A query that is a day: today, tomorrow, yesterday, a weekday ("fri", "next monday"), or a date ("23 oct", "oct 23",
 * "23/10", "23 october 2026"). A weekday alone is the next one from today, today included; "next" is the first after
 * today. Null for anything else.
 */
export function parseDay(q: string, now = new Date()): { key: string; date: Date } | null {
  const w = words(q);
  if (!w.length || w.length > 3) return null;
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const at = (days: number) => {
    const d = new Date(base);
    d.setDate(d.getDate() + days);
    return { key: keyOf(d), date: d };
  };
  const s = w.join(' ');
  if (s === 'today') return at(0);
  if (s === 'tomorrow' || s === 'tmrw' || s === 'tmr') return at(1);
  if (s === 'yesterday') return at(-1);
  const todayIdx = (base.getDay() + 6) % 7;
  const next = w[0] === 'next' || w[0] === 'this' ? w[0] : null;
  const dayWord = next ? w.slice(1) : w;
  if (dayWord.length === 1) {
    const i = weekdayOf(dayWord[0]);
    if (i >= 0) {
      let diff = (i - todayIdx + 7) % 7;
      if (next === 'next' && diff === 0) diff = 7;
      return at(diff);
    }
  }
  if (next) return null;
  // 23/10, 23/10/2026, 23.10
  const slash = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/.exec(q.trim());
  if (slash) return dateOf(+slash[1], +slash[2] - 1, slash[3] ? +slash[3] : undefined, base);
  // 23 oct, oct 23, 23 october 2026
  let day = -1;
  let month = -1;
  let year: number | undefined;
  for (const x of w) {
    const n = /^(\d{1,2})(st|nd|rd|th)?$/.exec(x);
    if (n && day < 0) { day = +n[1]; continue; }
    if (/^\d{4}$/.test(x) && year == null) { year = +x; continue; }
    const m = monthOf(x);
    if (m >= 0 && month < 0) { month = m; continue; }
    return null;
  }
  if (day < 0 || month < 0) return null;
  return dateOf(day, month, year, base);
}

function dateOf(day: number, month: number, year: number | undefined, base: Date): { key: string; date: Date } | null {
  const y = year == null ? base.getFullYear() : year < 100 ? 2000 + year : year;
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  const d = new Date(y, month, day);
  if (d.getMonth() !== month) return null;
  return { key: keyOf(d), date: d };
}
