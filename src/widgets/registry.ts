// Every widget Today's board knows: its type, the tool it belongs to, its sizes and its component. Today's own sections
// (flow) come first, as the board has always shown them; the tiles follow, grouped by tool, as the gallery lists them.

import type { WidgetSize } from '../store';
import type { ToolKey } from '../tools';
import type { WidgetDef } from './types';
import { PlanWidget } from './PlanWidget';
import { GlanceWidget } from './GlanceWidget';
import { ComingWidget } from './ComingWidget';
import { QuickAccessWidget } from './QuickAccessWidget';
import { JournalNudgeWidget } from './JournalNudgeWidget';
import { TodayListWidget } from './TodayListWidget';
import { HabitsWidget } from './HabitsWidget';
import { FocusBarsWidget } from './FocusBarsWidget';
import { DayRingWidget } from './DayRingWidget';
import { AtGlanceWidget } from './AtGlanceWidget';
import { NextUpWidget } from './NextUpWidget';
import { ChecklistWidget } from './ChecklistWidget';
import { DeadlinesWidget } from './DeadlinesWidget';
import { SessionWidget } from './SessionWidget';
import { FocusWeekWidget } from './FocusWeekWidget';
import { NowNextWidget } from './NowNextWidget';
import { BlocksWidget } from './BlocksWidget';
import { HabitGridWidget } from './HabitGridWidget';
import { NewNoteWidget } from './NewNoteWidget';
import { PinnedNotesWidget, RecentNotesWidget } from './NotesWidgets';
import { MoodStripWidget, WriteTodayWidget } from './JournalWidgets';
import { CountdownWidget, ResultsWidget, SubjectTrendWidget } from './ScoresWidgets';
import { ContinueWatchingWidget, WatchListWidget } from './VaultWidgets';
import { LastAnswersWidget } from './LastAnswersWidget';

const M: readonly WidgetSize[] = ['M'];
const S: readonly WidgetSize[] = ['S'];
const L: readonly WidgetSize[] = ['L'];

export const WIDGETS: readonly WidgetDef[] = [
  // Today's own sections
  { type: 'plan', tool: 'planner', title: 'Next block', desc: 'The block on now or next, with Start', sizes: M, flow: true, Component: PlanWidget },
  { type: 'glance', tool: null, title: 'Glance', desc: 'Tasks left, habits and minutes focused', sizes: M, flow: true, Component: GlanceWidget },
  { type: 'coming', tool: null, title: 'Coming up', desc: 'Exams within a month, tasks within a week', sizes: M, flow: true, Component: ComingWidget },
  { type: 'quick', tool: null, title: 'Quick access', desc: 'Your shortcuts and one-tap actions', sizes: M, flow: true, ownHold: true, Component: QuickAccessWidget },
  { type: 'journalNudge', tool: 'journal', title: 'Journal nudge', desc: "A line when today's page is empty", sizes: M, flow: true, Component: JournalNudgeWidget },
  { type: 'todayList', tool: 'tasks', title: "Today's list", desc: 'ToDos and tasks due today', sizes: M, flow: true, ownHold: true, Component: TodayListWidget },
  { type: 'habits', tool: 'planner', title: 'Habits', desc: "Today's habits, ticked in place", sizes: M, flow: true, Component: HabitsWidget },
  { type: 'focusBars', tool: 'focus', title: 'Focus, 7 days', desc: 'Minutes focused each day this week', sizes: M, flow: true, Component: FocusBarsWidget },
  // the app's own
  { type: 'dayRing', tool: null, title: 'Day ring', desc: 'ToDos done and focus against the goal', sizes: S, Component: DayRingWidget },
  { type: 'atGlance', tool: null, title: 'At a glance', desc: 'Next block, three ToDos, habit dots', sizes: M, Component: AtGlanceWidget },
  // Tasks
  { type: 'nextUp', tool: 'tasks', title: 'Next up', desc: 'The most urgent thing, with a big tick', sizes: S, Component: NextUpWidget },
  { type: 'checklist', tool: 'tasks', title: 'Checklist', desc: "Four of today's ToDos, ticked in place", sizes: M, Component: ChecklistWidget },
  { type: 'deadlines', tool: 'tasks', title: 'Deadlines', desc: 'Long-term tasks with days left and steps', sizes: M, Component: DeadlinesWidget },
  // Deep Work
  { type: 'session', tool: 'focus', title: 'Session', desc: 'A live timer, or lengths to start one', sizes: M, Component: SessionWidget },
  { type: 'focusWeek', tool: 'focus', title: 'Focus week', desc: 'Seven days by subject, streak, best day', sizes: L, Component: FocusWeekWidget },
  // Planner
  { type: 'nowNext', tool: 'planner', title: 'Now / Next', desc: 'The block on now and the time left', sizes: S, Component: NowNextWidget },
  { type: 'blocks', tool: 'planner', title: "Today's blocks", desc: 'The day as a line of time', sizes: M, Component: BlocksWidget },
  { type: 'habitGrid', tool: 'planner', title: 'Habit grid', desc: 'Habits by the last seven days', sizes: M, Component: HabitGridWidget },
  // Notes
  { type: 'newNote', tool: 'notes', title: 'New note', desc: 'One tap to write, with the last title', sizes: S, Component: NewNoteWidget },
  { type: 'pinnedNotes', tool: 'notes', title: 'Pinned', desc: 'Up to three pinned notes', sizes: M, Component: PinnedNotesWidget },
  { type: 'recentNotes', tool: 'notes', title: 'Recent notes', desc: 'Five recent notes with a line each', sizes: L, Component: RecentNotesWidget },
  // Journal
  { type: 'writeToday', tool: 'journal', title: 'Write today', desc: "Today's page and its prompt", sizes: S, Component: WriteTodayWidget },
  { type: 'moodStrip', tool: 'journal', title: 'Mood strip', desc: 'Two weeks of moods and ratings', sizes: M, Component: MoodStripWidget },
  // Scores
  { type: 'countdown', tool: 'scores', title: 'Countdown', desc: 'Days to the next exam', sizes: S, Component: CountdownWidget },
  { type: 'results', tool: 'scores', title: 'Results', desc: 'The last three results and their trend', sizes: M, Component: ResultsWidget },
  { type: 'subjectTrend', tool: 'scores', title: 'Subject trend', desc: "One subject's results as a line", sizes: L, Component: SubjectTrendWidget },
  // YT Vault
  { type: 'continueWatching', tool: 'vault', title: 'Continue watching', desc: 'Carry on where you left off', sizes: M, Component: ContinueWatchingWidget },
  { type: 'watchList', tool: 'vault', title: 'Watch list', desc: 'Three recent lectures', sizes: L, Component: WatchListWidget },
  // Calculator
  { type: 'lastAnswers', tool: 'calculator', title: 'Last answers', desc: 'Your last three sums, a tap from use', sizes: M, Component: LastAnswersWidget },
];

const BY_TYPE = new Map(WIDGETS.map((w) => [w.type, w]));

export const widgetDef = (type: string): WidgetDef | undefined => BY_TYPE.get(type);

/** the types the board keeps when it cleans a saved layout */
export const WIDGET_TYPES: readonly string[] = WIDGETS.map((w) => w.type);

export const sizesOf = (type: string): readonly WidgetSize[] | null => BY_TYPE.get(type)?.sizes ?? null;

/** Whether a widget shows: its tool is not archived (the app's own always show). */
export const widgetShown = (def: WidgetDef, archived: ReadonlySet<string>) => !def.tool || !archived.has(def.tool as ToolKey);

/** The gallery's groups, in the order above: the app's own, then each tool's. */
export function galleryGroups(archived: ReadonlySet<string>): { tool: ToolKey | null; defs: WidgetDef[] }[] {
  const out: { tool: ToolKey | null; defs: WidgetDef[] }[] = [];
  for (const def of WIDGETS) {
    if (!widgetShown(def, archived)) continue;
    const g = out.find((x) => x.tool === def.tool);
    if (g) g.defs.push(def);
    else out.push({ tool: def.tool, defs: [def] });
  }
  return out;
}
