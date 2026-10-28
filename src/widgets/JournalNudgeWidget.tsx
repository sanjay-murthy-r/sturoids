import React from 'react';
import { C } from '../theme';
import { useStore } from '../store';
import { journalDayFor, shiftKey } from '../journal';
import { todayKey } from '../utils';
import { openTool } from '../toolNav';
import { FlowPlaceholder, NudgeRow, useBoardNow } from './kit';
import type { WidgetProps } from './types';

/** how far back a journal page still counts as the habit of writing, so the nudge to write today makes sense */
const JOURNAL_RECENT_DAYS = 14;

/**
 * The nudge to write: today's page (or, before the journal's day turns, yesterday's) has no words yet, for someone who
 * keeps the journal (a page written in the last two weeks). Never while the journal is locked.
 */
export function JournalNudgeWidget({ editing }: WidgetProps) {
  const now = useBoardNow();
  const today = todayKey(now);
  const locked = useStore((s) => s.settings.journalLocked);
  const cutoff = useStore((s) => s.settings.journalCutoffHour);
  const journalDay = journalDayFor(now, cutoff);
  // the words on the day's page as one number, so a save in the Journal re-renders this only when the count moves
  const words = useStore((s) => {
    let n = 0;
    for (const e of s.journal) if (e.dateKey === journalDay) n += e.wordCount || 0;
    return n;
  });
  const recentFrom = shiftKey(today, -JOURNAL_RECENT_DAYS);
  const recentFromMs = new Date(recentFrom + 'T00:00:00').getTime();
  const writesLately = useStore((s) => s.journal.some((e) => (e.wordCount || 0) > 0 && (e.dateKey >= recentFrom || e.updatedAt >= recentFromMs)));
  if (locked || words > 0 || !writesLately) {
    return editing ? <FlowPlaceholder title="Journal nudge" note="Asks for today's page when it is still empty." /> : null;
  }
  return (
    <NudgeRow
      icon="journal-outline" iconColor={C.gold} action="Write" actionColor={C.gold} onPress={() => openTool('journal')}
      text={journalDay === today ? "Today's page is empty" : "Yesterday's page is empty"}
    />
  );
}
