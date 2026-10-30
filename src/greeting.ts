import React from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useStore, FocusSession, Habit, PlannerWeek } from './store';
import { dayName, streaks, todayKey, toMinutes } from './utils';

// The Today greeting is about the work, never the time of day. One deterministic rule list, first
// match wins, so the same state always says the same thing.

/** A run of the greeting; `name` runs take the accent colour. */
export interface GreetingPart {
  text: string;
  name?: boolean;
}

export interface Greeting {
  /**
   * Which sentence this is ('soon:Physics', 'clear'), and not its words: a figure inside it (the minutes to a block) can
   * change in place, and only a new sentence makes the line dip out and back.
   */
  kind: string;
  parts: GreetingPart[];
  /** a second, quieter line, only when there is something worth adding */
  sub?: string;
}

export interface GreetingContext {
  name: string;
  now: Date;
  /** nothing had ever been opened before this launch */
  firstLaunch: boolean;
  /** when the app was last opened before this foreground */
  prevOpenedAt?: number;
  listTotal: number;
  listDone: number;
  sessionsToday: number;
  focusMinutesToday: number;
  /** a habit done today whose streak just reached a milestone */
  streakMilestone?: number;
  /** today's planner block that is on now or next */
  next?: { subject: string; now: boolean; startsInMin: number } | null;
  /** today had blocks and every one has ended */
  planDoneToday: boolean;
}

const MILESTONES = [7, 14, 21, 30, 50, 100];
const SOON_MIN = 20;
const DEEP_MIN = 120;
const AWAY_DAYS = 3;
/** a return after less than this is the same visit (a permission prompt, a picker, a share sheet) */
const RETURN_AFTER_MS = 60_000;

function daysBetween(then: number, now: Date): number {
  const a = new Date(then);
  a.setHours(0, 0, 0, 0);
  const b = new Date(now);
  b.setHours(0, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export function pickGreeting(c: GreetingContext): Greeting {
  // "Lead, Name." with the name in the accent, or the nameless line
  const say = (lead: string, nameless = lead + '.'): GreetingPart[] =>
    c.name ? [{ text: lead + ', ' }, { text: c.name, name: true }, { text: '.' }] : [{ text: nameless }];

  if (c.firstLaunch) return { kind: 'hello', parts: say('Hello'), sub: "Let's set up your day." };
  if (c.streakMilestone) return { kind: 'streak:' + c.streakMilestone, parts: say(c.streakMilestone + ' days strong') };
  if (c.listTotal > 0 && c.listDone === c.listTotal) return { kind: 'clear', parts: say('All clear') };
  if (c.next?.now) return { kind: 'on:' + c.next.subject, parts: say(c.next.subject + ' is on') };
  if (c.next && c.next.startsInMin > 0 && c.next.startsInMin <= SOON_MIN) {
    return { kind: 'soon:' + c.next.subject, parts: say(c.next.subject + ' in ' + c.next.startsInMin + ' min') };
  }
  if (c.focusMinutesToday >= DEEP_MIN) return { kind: 'deep', parts: say('Deep in it') };
  if (c.sessionsToday > 0) return { kind: 'back', parts: say('Back at it') };
  const left = c.listTotal - c.listDone;
  if (c.planDoneToday && left > 0) return { kind: 'plan-done', parts: say('Plan done'), sub: left + ' still on the list.' };
  if (c.prevOpenedAt != null && daysBetween(c.prevOpenedAt, c.now) >= AWAY_DAYS) {
    return { kind: 'away', parts: say('Good to see you', 'Welcome back.') };
  }
  if (c.prevOpenedAt != null && todayKey(new Date(c.prevOpenedAt)) === todayKey(c.now)) {
    return { kind: 'again', parts: say('Back again') };
  }
  return { kind: 'go', parts: say("Let's go") };
}

/** Cheerful's picture for each kind of greeting */
const CHEER_EMOJI: Record<string, string> = {
  hello: '👋', streak: '🔥', clear: '🎉', on: '📚', soon: '⏰', deep: '🧠', back: '💪', 'plan-done': '✅', away: '🌼',
  again: '😊', go: '🚀',
};

// ---------- visits ----------
// A visit is a cold start, or a return after RETURN_AFTER_MS in the background. What the greeting
// knows about the previous visit is read once per visit, before this visit's own stamp is written,
// and kept at module level so a Today remount never reads its own stamp back.

interface Visit {
  firstLaunch: boolean;
  prevOpenedAt?: number;
}

let visit: Visit | null = null;
let stamped = false;
let backgroundedAt: number | null = null;
let appStateSub: { remove: () => void } | null = null;
const listeners = new Set<() => void>();
/** the open times this phone last wrote, so times brought in from elsewhere (an erase, a restore) can be told apart */
let own: { first: number; last: number } | null = null;

function readVisit(): Visit {
  const { settings } = useStore.getState();
  return { firstLaunch: settings.firstOpenedAt == null, prevOpenedAt: settings.lastOpenedAt };
}

function stampVisit() {
  const { settings, setSetting } = useStore.getState();
  const now = Date.now();
  own = { first: settings.firstOpenedAt ?? now, last: now };
  setSetting('lastOpenedAt', now);
  if (settings.firstOpenedAt == null) setSetting('firstOpenedAt', now);
}

/**
 * Every erase and restore replaces the whole store, open times included. An erase leaves none, so this is a first
 * launch again, stamped as one; a restore brings the backup's, so this phone puts its own back, and the next return
 * never says "Good to see you" to someone who was here a minute ago.
 */
function followReplacements() {
  // set while the times are being written back, so those writes are not taken for another replacement
  let writing = false;
  useStore.subscribe((s, prev) => {
    const { firstOpenedAt, lastOpenedAt } = s.settings;
    if (writing || !own || (firstOpenedAt === prev.settings.firstOpenedAt && lastOpenedAt === prev.settings.lastOpenedAt)) return;
    if (firstOpenedAt === own.first && lastOpenedAt === own.last) return;
    writing = true;
    try {
      if (firstOpenedAt == null) {
        visit = { firstLaunch: true };
        stampVisit();
        listeners.forEach((l) => l());
      } else {
        const { setSetting } = useStore.getState();
        if (firstOpenedAt !== own.first) setSetting('firstOpenedAt', own.first);
        if (lastOpenedAt !== own.last) setSetting('lastOpenedAt', own.last);
      }
    } finally {
      writing = false;
    }
  });
}

function trackVisits() {
  if (appStateSub) return;
  followReplacements();
  appStateSub = AppState.addEventListener('change', (next: AppStateStatus) => {
    if (next === 'active') {
      if (backgroundedAt != null && Date.now() - backgroundedAt >= RETURN_AFTER_MS) {
        visit = readVisit();
        stampVisit();
        listeners.forEach((l) => l());
      }
      backgroundedAt = null;
    } else if (backgroundedAt == null) {
      backgroundedAt = Date.now();
    }
  });
}

type NextBlock = { block: { subject: string; start: string }; tag: string } | null;

/** The greeting for Today. Inputs are what Today already selects from the store. */
export function useGreeting(input: {
  now: Date;
  name: string;
  sessions: FocusSession[];
  habits: Habit[];
  planner: PlannerWeek;
  listTotal: number;
  listDone: number;
  nextBlock: NextBlock;
}): Greeting {
  if (!visit) visit = readVisit(); // read only; the stamp is written after render
  const [epoch, bump] = React.useReducer((x: number) => x + 1, 0);

  React.useEffect(() => {
    if (!stamped) {
      stamped = true;
      stampVisit();
    }
    trackVisits();
    listeners.add(bump);
    return () => {
      listeners.delete(bump);
    };
  }, []);

  const { now, name, sessions, habits, planner, listTotal, listDone, nextBlock } = input;
  const cheerful = useStore((st) => st.settings.mood === 'cheerful');
  const g = useGreetingInner();
  // Cheerful: the line ends with a little picture of its own feeling
  return React.useMemo(() => {
    if (!cheerful) return g;
    const e = CHEER_EMOJI[g.kind.split(':')[0]];
    return e ? { ...g, parts: [...g.parts, { text: ' ' + e }] } : g;
  }, [g, cheerful]);

  function useGreetingInner(): Greeting {
  return React.useMemo(() => {
    const v = visit || readVisit();
    const today = todayKey(now);
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const todays = sessions.filter((s) => s.dateKey === today);

    let milestone: number | undefined;
    for (const h of habits) {
      if (!h.doneDates.includes(today)) continue;
      const current = streaks(h.doneDates, h.days).current;
      if (MILESTONES.includes(current) && (milestone == null || current > milestone)) milestone = current;
    }

    const blocks = planner[dayName(now)] || [];
    const planDoneToday = blocks.length > 0 && blocks.every((b) => toMinutes(b.end) <= nowMin);
    const next = nextBlock && nextBlock.tag !== 'TOMORROW'
      ? { subject: nextBlock.block.subject, now: nextBlock.tag === 'NOW', startsInMin: toMinutes(nextBlock.block.start) - nowMin }
      : null;

    return pickGreeting({
      name: name.trim(),
      now,
      firstLaunch: v.firstLaunch,
      prevOpenedAt: v.prevOpenedAt,
      listTotal,
      listDone,
      sessionsToday: todays.length,
      focusMinutesToday: Math.round(todays.reduce((a, s) => a + s.netSeconds, 0) / 60),
      streakMilestone: milestone,
      next,
      planDoneToday,
    });
  }, [now, name, sessions, habits, planner, listTotal, listDone, nextBlock, epoch]);
  }
}
