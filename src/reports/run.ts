// Progress reports on the phone: reads the store (this profile's, as every store read is), builds with the pure code in
// ./build, and hands the file to the share sheet. Every screen's Export and the report page go through exportSummary.

import * as FileSystem from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useStore } from '../store';
import { loadBodies } from '../journal';
import { ALL_NOTES, expectAway, isOpen, noteScope } from '../lock';
import { activeProfile, useProfiles } from '../profiles';
import { todayKey } from '../utils';
import {
  RangeKind, Report, ReportOptions, ReportSource, SectionKey, DateRange, buildReport, earliestKey, rangeOf, reportCsv,
  reportFileName, reportHtml,
} from './build';

/**
 * What an export makes: the full progress report (every part picked, one PDF), or one summary on its own for one
 * range. The report is one option among many, never the only file the app makes.
 */
export type SummaryKind =
  | 'report' | 'todos' | 'longterm' | 'habits' | 'focus' | 'planner' | 'journal' | 'scores' | 'subject' | 'day';

/** The single summaries, in the order the Reports page lists them ('subject' and 'day' are reached from their own pages). */
export const SINGLE_KINDS: readonly SummaryKind[] = ['todos', 'longterm', 'habits', 'focus', 'planner', 'journal', 'scores'];

export interface SummaryOpts {
  /** the range, by kind; `from` and `to` name a custom one, `from` alone the day for 'day' */
  range?: RangeKind;
  from?: string;
  to?: string;
  /** the report's sections ('report' only; every other kind has its own) */
  sections?: SectionKey[];
  /** the journal entries' own words go in: only ever because the owner ticked it */
  includeJournalText?: boolean;
  subject?: string;
  examId?: string;
  examIds?: string[];
  scopeLabel?: string;
  title?: string;
}

/**
 * Each kind's title, its short name (the chip that switches to it), what it is (the Reports page's row), its sections,
 * the range it covers when the screen names none, and whether a range means anything for it (the Planner's week is
 * the same plan every week; one day is one day).
 */
export const KIND_INFO: Record<SummaryKind, {
  title: string; short: string; sub: string; sections: SectionKey[]; range: RangeKind; ranged: boolean; tool: string | null;
  icon: string;
}> = {
  report: {
    title: 'Progress report', short: 'Full report', sub: 'Everything in one PDF: pick the range and the parts',
    sections: ['overview', 'tasks', 'habits', 'focus', 'planner', 'journal', 'scores', 'notes'], range: 'week', ranged: true, tool: null,
    icon: 'documents-outline',
  },
  todos: { title: 'ToDos summary', short: 'ToDos', sub: 'What was ticked, day by day', sections: ['todos'], range: 'week', ranged: true, tool: 'tasks', icon: 'checkbox-outline' },
  longterm: { title: 'Long-term tasks summary', short: 'Long-term tasks', sub: 'Done, open and overdue, with their steps', sections: ['longterm'], range: '30d', ranged: true, tool: 'tasks', icon: 'flag-outline' },
  habits: { title: 'Habits summary', short: 'Habits', sub: 'Streaks and a day-by-day grid', sections: ['habits'], range: '30d', ranged: true, tool: 'planner', icon: 'repeat-outline' },
  focus: { title: 'Deep Work summary', short: 'Deep Work', sub: 'Minutes by day and by subject', sections: ['focus'], range: '30d', ranged: true, tool: 'focus', icon: 'timer-outline' },
  planner: { title: 'Planner week', short: 'Planner week', sub: 'The week as planned, hours by subject', sections: ['planner'], range: 'week', ranged: false, tool: 'planner', icon: 'calendar-outline' },
  journal: { title: 'Journal mood', short: 'Journal', sub: 'Moods, ratings, entries and words, never the text unless you ask', sections: ['journal'], range: '30d', ranged: true, tool: 'journal', icon: 'book-outline' },
  scores: { title: 'Scores summary', short: 'Scores', sub: 'Results and how they moved', sections: ['scores'], range: 'all', ranged: true, tool: 'scores', icon: 'ribbon-outline' },
  subject: { title: 'Subject summary', short: 'Subject', sub: 'One subject across Deep Work, the Planner, Scores and Notes', sections: ['focus', 'planner', 'scores', 'notes'], range: 'all', ranged: true, tool: null, icon: 'school-outline' },
  day: { title: 'Your day', short: 'Day', sub: 'One day of the journal record', sections: ['tasks', 'habits', 'focus', 'journal'], range: 'day', ranged: false, tool: null, icon: 'today-outline' },
};

/** The summary's name: the subject's own for a subject. */
export const kindTitle = (kind: SummaryKind, opts: SummaryOpts = {}) =>
  opts.title || (kind === 'subject' && opts.subject ? opts.subject : KIND_INFO[kind].title);

export const sectionsFor = (kind: SummaryKind, opts: SummaryOpts = {}): SectionKey[] =>
  (kind === 'report' && opts.sections ? opts.sections : KIND_INFO[kind].sections);

/** Whether the journal is shut right now (locked and not unlocked this session). */
export const journalShut = () => !!useStore.getState().settings.journalLocked && !isOpen('journal');
/** Whether the Notes tool is shut right now. */
export const notesShut = () => !!useStore.getState().settings.notesLocked && !isOpen('notes');

/** Whether exporting this asks for the PIN first: it covers the journal, and the journal is shut. */
export function needsPin(kind: SummaryKind, opts: SummaryOpts = {}): boolean {
  if (kind === 'day') return false;
  return sectionsFor(kind, opts).includes('journal') && journalShut();
}

/** What is locked and so left out of this export right now: "the journal", "notes", "locked notes". */
export function shutParts(kind: SummaryKind, opts: SummaryOpts = {}): string[] {
  if (kind === 'day') return [];
  const secs = sectionsFor(kind, opts);
  const out: string[] = [];
  if (secs.includes('journal') && journalShut()) out.push('the journal');
  if (secs.includes('notes')) {
    if (notesShut()) out.push('notes');
    else if (!isOpen(ALL_NOTES) && useStore.getState().notes.some((n) => n.locked)) out.push('locked notes');
  }
  return out;
}

/** Whose report it is: the profile's name, or the name the greeting uses. */
export function reportOwner(): string {
  const p = useProfiles.getState().list.find((x) => x.id === activeProfile);
  return (p?.name || '').trim() || (useStore.getState().settings.name || '').trim();
}

export function sourceOf(s = useStore.getState()): ReportSource {
  return {
    dailyTasks: s.dailyTasks, missions: s.missions, doneLog: s.doneLog, habits: s.habits, sessions: s.sessions,
    planner: s.planner, journal: s.journal, scores: s.scores, scoreTags: s.scoreTags, notes: s.notes,
  };
}

/** The range a kind and its options cover, as of today. */
export function rangeFor(kind: SummaryKind, opts: SummaryOpts = {}, src: ReportSource = sourceOf(), today = todayKey()): DateRange {
  const k = opts.range ?? (opts.from && opts.to ? 'custom' : KIND_INFO[kind].range);
  return rangeOf(k, today, { from: opts.from, to: opts.to, earliest: earliestKey(src, today) });
}

/** The options buildReport takes, as the locks stand right now; the journal's texts are added by makeReport. */
export function reportOptions(kind: SummaryKind, opts: SummaryOpts = {}, src: ReportSource = sourceOf()): ReportOptions {
  const s = useStore.getState();
  return {
    range: rangeFor(kind, opts, src),
    sections: sectionsFor(kind, opts),
    profile: reportOwner(),
    title: kindTitle(kind, opts),
    journalOpen: !journalShut(),
    notesOpen: !notesShut(),
    noteOpen: (id) => isOpen(noteScope(id)) || isOpen(ALL_NOTES),
    archived: s.settings.archivedTools || [],
    subject: opts.subject,
    examId: opts.examId,
    examIds: opts.examIds,
    scopeLabel: opts.scopeLabel,
  };
}

/** The report, with the journal's texts read in when the owner asked for them and the journal is open. */
export async function makeReport(kind: SummaryKind, opts: SummaryOpts = {}): Promise<Report> {
  const src = sourceOf();
  const o = reportOptions(kind, opts, src);
  if (opts.includeJournalText && o.journalOpen && o.sections.includes('journal')) {
    const ids = src.journal.filter((e) => e.dateKey >= o.range.from && e.dateKey <= o.range.to).map((e) => e.id);
    o.journalText = await loadBodies(ids);
  }
  return buildReport(src, o);
}

export type ExportFormat = 'pdf' | 'csv';
export type ExportResult = 'ok' | 'unavailable' | 'error';

/** A4 in points, as expo-print measures a page. */
const A4 = { width: 595, height: 842 };

/**
 * Exports one summary (or the whole report) as a PDF or a CSV and opens the share sheet with it. The caller asks for
 * the PIN first when needsPin says so; a journal still shut here is simply left out.
 */
export async function exportSummary(kind: SummaryKind, opts: SummaryOpts & { format: ExportFormat }): Promise<ExportResult> {
  try {
    if (!(await Sharing.isAvailableAsync())) return 'unavailable';
    const report = await makeReport(kind, opts);
    const name = reportFileName(report);
    const dir = FileSystem.cacheDirectory + 'reports/';
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
    if (opts.format === 'csv') {
      const uri = dir + name + '.csv';
      await FileSystem.writeAsStringAsync(uri, reportCsv(report));
      await expectAway(() => Sharing.shareAsync(uri, { mimeType: 'text/csv', dialogTitle: report.title, UTI: 'public.comma-separated-values-text' }));
      return 'ok';
    }
    const printed = await Print.printToFileAsync({ html: reportHtml(report), ...A4 });
    // the printer names its file at random: the share sheet shows the real name
    const uri = dir + name + '.pdf';
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    let shareUri = printed.uri;
    try {
      await FileSystem.moveAsync({ from: printed.uri, to: uri });
      shareUri = uri;
    } catch {
      // keep the printer's own name
    }
    await expectAway(() => Sharing.shareAsync(shareUri, { mimeType: 'application/pdf', dialogTitle: report.title, UTI: 'com.adobe.pdf' }));
    return 'ok';
  } catch {
    return 'error';
  }
}
