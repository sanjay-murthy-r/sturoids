// Pure helpers for the tools' screens (Scores, Notes, the Vault, Deep Work's history): no React, no React Native and no
// store, so the Node tests run them as they are (scripts/test-tools.js).

import type { Mission, Note } from './store';
import { ScoreIndex, ScoreNode, resultOf } from './scores';
import { todayKey, youTubeLinksIn, isYouTubePlaylist } from './utils';
import { Range, highlight, queryTerms, snippet as bodySnippet } from './search/engine';

/* ---------------------------------------------------------------- days */

/**
 * Minutes from `now` until the clock next reads `at` (minutes of the day), worked to the second and rounded to the
 * nearest minute: a time just gone is tomorrow's, and the answer is at least one.
 */
export function minutesUntil(at: number, now: Date = new Date()): number {
  let diff = at * 60 - (now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds());
  if (diff <= 0) diff += 86400;
  return Math.max(1, Math.round(diff / 60));
}

/** A day key `days` from `key`. */
export function shiftDay(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return todayKey(new Date(y, m - 1, d + days));
}

/** A month key ('YYYY-MM') `months` from `month`. */
export function shiftMonthKey(month: string, months: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + months, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

/**
 * A month as weeks, Monday first: each week seven cells, a day key or null for a day of the month before or after.
 * Always whole weeks, four to six of them.
 */
export function monthGrid(month: string): (string | null)[][] {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const days = new Date(y, m, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const cells: (string | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(todayKey(new Date(y, m - 1, d)));
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/* ---------------------------------------------------------------- exams */

/** The subjects an exam is split into (exam-kind children), in the order they were made. */
export function examParts(ix: ScoreIndex, examId: string): ScoreNode[] {
  return (ix.children.get(examId) || []).filter((k) => k.kind === 'exam').sort((a, b) => a.createdAt - b.createdAt);
}

/** Whether an exam is still to come for studying: dated, today or later, and not marked. */
export function examAhead(ix: ScoreIndex, n: ScoreNode, today: string): boolean {
  return n.kind === 'exam' && !!n.date && /^\d{4}-\d{2}-\d{2}$/.test(n.date) && n.date >= today && !resultOf(n, ix);
}

/** What "Study for this" can open Focus on: each subject's name, or the exam's own name when it has no subjects. */
export function studySubjects(ix: ScoreIndex, exam: ScoreNode): string[] {
  const names = examParts(ix, exam.id).map((p) => p.title.trim()).filter(Boolean);
  const seen = new Set<string>();
  const out = names.filter((n) => {
    const k = n.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (out.length) return out;
  const own = exam.title.trim();
  return own ? [own] : [];
}

/** One long-term task "Add revision tasks" makes. */
export interface RevisionTask { title: string; deadline: string }

/**
 * The revision tasks for a dated exam: one per subject ("Revise Physics for Mock 7"), or one for the exam itself when it
 * has no subjects ("Revise for Mock 7"), each due the day before the exam (today when that day has gone). A task with
 * the same name (any case) already open, or already due that day, is left out, so tapping twice adds nothing twice.
 */
export function revisionPlan(ix: ScoreIndex, exam: ScoreNode, missions: readonly Pick<Mission, 'title' | 'deadline' | 'done'>[], today: string): RevisionTask[] {
  if (!exam.date || !/^\d{4}-\d{2}-\d{2}$/.test(exam.date)) return [];
  const eve = shiftDay(exam.date, -1);
  const deadline = eve < today ? today : eve;
  const name = exam.title.trim() || 'the exam';
  const parts = examParts(ix, exam.id).map((p) => p.title.trim()).filter(Boolean);
  const titles = parts.length ? parts.map((p) => 'Revise ' + p + ' for ' + name) : ['Revise for ' + name];
  const have = new Set(missions.filter((m) => !m.done).map((m) => m.title.trim().toLowerCase()));
  const out: RevisionTask[] = [];
  for (const title of titles) {
    const k = title.toLowerCase();
    if (have.has(k)) continue;
    have.add(k);
    out.push({ title, deadline });
  }
  return out;
}

/* ---------------------------------------------------------------- notes search */

/** A note the search found: where its words matched, for the title and a short window of the text. */
export interface NoteHit {
  titleRanges: Range[];
  /** a window of the text around the first match, or null when the text did not match (or the note is locked) */
  snippet: { text: string; ranges: Range[] } | null;
}

/**
 * Whether a note matches a search: every word of the query, in any order, found in its title, its text, its tags, its
 * subject or its folder, each forgiving as Sift is (a prefix, a stem, a near spelling). A locked note is searched by
 * its title, tags, subject and folder only: its text never surfaces outside the note. Null when it does not match.
 */
export function matchNote(n: Pick<Note, 'title' | 'body' | 'tags' | 'subject' | 'folder' | 'locked'>, query: string): NoteHit | null {
  const terms = queryTerms(query);
  if (!terms.length) return { titleRanges: [], snippet: null };
  const title = n.title || '';
  const body = n.locked ? '' : n.body || '';
  const meta = [n.folder, n.subject, ...(n.tags || [])].filter(Boolean).join(' ');
  for (const t of terms) {
    if (highlight(title, [t]).length) continue;
    if (meta && highlight(meta, [t]).length) continue;
    // the text is the longest field: only looked through for a word the others did not have
    if (body && highlight(body, [t]).length) continue;
    return null;
  }
  return { titleRanges: highlight(title, terms), snippet: body ? bodySnippet(body, terms, 90) : null };
}

/** A text cut into runs, each matched or not, for drawing the matched words in the accent. */
export function splitRanges(text: string, ranges: readonly Range[]): { text: string; on: boolean }[] {
  const out: { text: string; on: boolean }[] = [];
  let at = 0;
  for (const [a, b] of ranges) {
    if (a < at || b <= a || a >= text.length) continue;
    if (a > at) out.push({ text: text.slice(at, a), on: false });
    out.push({ text: text.slice(a, Math.min(b, text.length)), on: true });
    at = Math.min(b, text.length);
  }
  if (at < text.length) out.push({ text: text.slice(at), on: false });
  return out;
}

/* ---------------------------------------------------------------- videos from a paste or a share */

/** What a pasted or shared text holds for the Vault. */
export interface VideoPaste {
  /** videos not in the Vault yet, each once, as clean links */
  fresh: { videoId: string; url: string }[];
  /** videos already in the Vault */
  have: number;
  /** a playlist link and no video */
  playlist: boolean;
}

export function videosIn(text: string, inVault: (videoId: string) => boolean): VideoPaste {
  const links = youTubeLinksIn(text);
  const fresh = links.filter((l) => !inVault(l.videoId));
  return { fresh, have: links.length - fresh.length, playlist: !links.length && isYouTubePlaylist(text) };
}

/** What the Vault says of a playlist link, on paste and on share. */
export const PLAYLIST_SAID = "Playlists can't be added yet. Share or paste one video's link.";

/* ---------------------------------------------------------------- focus */

/** A day's focus against the daily goal, 0 to 1 (1 once it is met); null with no goal. */
export function goalShare(minutes: number, goalMin: number): number | null {
  if (!(goalMin > 0)) return null;
  return Math.max(0, Math.min(1, minutes / goalMin));
}
