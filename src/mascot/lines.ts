// What the companion says, and when it may. Lines come in pools, by moment (a hello, a tick, a session done) and by
// what is true right now (the time of day, the day of the week, ToDos left, an exam coming up, minutes of focus today),
// and a line once said rests for weeks before it can come back, so months of daily use do not wear it thin. Most of the
// time it says nothing at all: a few words by itself a day at most (as Settings allows), never in a row, never while
// Deep Work runs. Spoken to, it answers. Pure apart from the memory it keeps (see Memory), so it is tested on its own.

import type { Kind } from './art';

export type Ctx = {
  kind: Kind;
  name: string;
  /** local hour, 0 to 23, and weekday, 0 Sunday to 6 Saturday */
  hour: number;
  weekday: number;
  /** 'MM-DD' */
  date: string;
  year: number;
  /** today's ToDos: how many are due, and how many are still open; the first one still open */
  due: number;
  left: number;
  next: string | null;
  /** the soonest exam coming up, and in how many days (0 today) */
  exam: { title: string; days: number } | null;
  /** minutes of Deep Work today */
  focusMin: number;
  /** days since it was last seen (0 the same day, 1 yesterday); its run of days in a row; whether today is its first */
  away: number;
  run: number;
  first: boolean;
  gear: string[];
};

/** A line: its id (for resting it once said), its words, and the companions who say it. */
type Line = { id: string; text: string; who?: Kind };
const L = (id: string, text: string, who?: Kind): Line => ({ id, text, who });

/* ---------------------------------------------------------------- pools */

const HELLO_MORNING = [
  L('hm1', 'Morning. The day is still wide open.'),
  L('hm2', 'Good morning. Slow start or quick start?'),
  L('hm3', 'Hey. Fresh page today.'),
  L('hm4', 'Morning! I saved you a spot.'),
  L('hm5', 'Up early. I like that.'),
  L('hm6', 'Good morning. I already had my sunlight.', 'sprout'),
  L('hm7', 'Morning. My leaves are still waking up.', 'sprout'),
  L('hm8', 'Morning! I bounced out of bed.', 'pip'),
  L('hm9', 'Good morning. Rise and mostly shine.'),
  L('hm10', 'Morning. One good thing today is plenty.'),
  L('hm11', 'Hello, morning person.'),
  L('hm12', 'Morning. Breakfast first, then the world.'),
];
const HELLO_AFTERNOON = [
  L('ha1', 'Afternoon. Halfway through already.'),
  L('ha2', 'Oh, hi. How is the day treating you?'),
  L('ha3', 'Hey. Good time for one small thing.'),
  L('ha4', 'Afternoon light is my favourite kind.', 'sprout'),
  L('ha5', 'Hi! I was just practising sitting still.', 'pip'),
  L('ha6', 'Afternoon. Water break?'),
  L('ha7', 'Hello again. The day is still yours.'),
  L('ha8', 'Hey you. Post-lunch slump? Me too.'),
];
const HELLO_EVENING = [
  L('he1', 'Evening. How did today go?'),
  L('he2', 'Hi. Evenings are good for thinking.'),
  L('he3', "Evening. Let's finish soft."),
  L('he4', 'Hey. The quiet part of the day.'),
  L('he5', 'Evening! My leaves fold up soon.', 'sprout'),
  L('he6', 'Hi! I saved some bounce for the evening.', 'pip'),
  L('he7', 'Good evening. Whatever today was, it counts.'),
  L('he8', 'Evening. One last thing, or none at all.'),
];
const HELLO_LATE = [
  L('hl1', "It's late. Be kind to tomorrow-you."),
  L('hl2', 'Night owl tonight?'),
  L('hl3', "Still up? I'll keep you company."),
  L('hl4', "Late one. Don't forget to sleep, okay?"),
  L('hl5', 'Shh. Everyone else is asleep.'),
  L('hl6', 'Midnight study? Short and sweet, then bed.'),
];
const HELLO_WEEKDAY: Record<number, Line[]> = {
  1: [L('wd1a', 'New week. No pressure, just a start.'), L('wd1b', 'Monday. Small steps count most today.')],
  5: [L('wd5a', 'Friday. You made it through the week.'), L('wd5b', 'Friday! Finish light.')],
  6: [L('wd6a', 'Saturday. Rest counts too.'), L('wd6b', 'Weekend. A little study, a lot of air?')],
  0: [L('wd0a', 'A slow Sunday is allowed.'), L('wd0b', 'Sunday. Good day to look at the week ahead.')],
};
const BACK = [
  L('bk1', "You're back! I missed you a little."),
  L('bk2', 'Hey, it has been {away} days. Good to see you.'),
  L('bk3', 'Oh! Welcome back.'),
  L('bk4', 'There you are. I kept everything just as you left it.'),
  L('bk5', 'Back again. No catching up needed, just today.'),
];
const FIRST = [L('fs1', "Hi, I'm {name}. I'll be around, quietly.")];
const RUN = [L('rn1', "That's {run} days in a row we've hung out."), L('rn2', '{run} days in a row. I like our routine.')];

/** special days (Tamil Nadu's own among them) */
const DAYS: Record<string, Line[]> = {
  '01-01': [L('d0101', 'Happy new year! New notebook energy.')],
  '01-14': [L('d0114', 'Happy Pongal! Something sweet today?')],
  '01-15': [L('d0115', 'Pongal greetings. Sugarcane and good marks.')],
  '01-26': [L('d0126', 'Happy Republic Day.')],
  '04-14': [L('d0414', 'Happy Tamil New Year! Puthandu vazhthukal.')],
  '08-15': [L('d0815', 'Happy Independence Day.')],
  '09-05': [L('d0905', "Happy Teachers' Day. Thank one today?")],
  '11-14': [L('d1114', "Happy Children's Day. That's you, sort of.")],
};
/** Deepavali moves each year */
const DEEPAVALI: Record<number, string> = { 2026: '11-08', 2027: '10-29', 2028: '10-17', 2029: '11-05', 2030: '10-26' };

const IDLE_ANY = [
  L('i1', 'Tiny steps still move you.'),
  L('i2', "You're doing better than you think."),
  L('i3', 'Drink some water. I just did.'),
  L('i4', 'Shoulders down. They creep up when you focus.'),
  L('i5', 'Hm. Just thinking.'),
  L('i6', "I'm here if you need cheering."),
  L('i7', 'Remember to blink. I just did.'),
  L('i8', 'Studying is future-you collecting gifts.'),
  L('i9', 'Mistakes are just practice wearing a disguise.'),
  L('i10', 'Nice day for getting one thing done.'),
  L('i11', 'Ever notice how quiet it gets when you focus?'),
  L('i12', 'Reading a page twice is still reading.'),
  L('i13', 'The hardest part is starting. After that it is just doing.'),
  L('i14', 'Some days are for big steps. Some are for not stepping back.'),
  L('i15', 'Look away from the screen for a second. Far away.'),
  L('i16', 'Not every day has to be a great day.'),
  L('i17', 'If it feels hard, you are probably learning.'),
  L('i18', 'Your notes are getting good, you know.'),
  L('i19', "A break isn't quitting. It's refuelling."),
  L('i20', 'One question at a time.'),
  L('i21', 'Nobody remembers everything. That is what notes are for.'),
  L('i22', 'Sit up a little. There we go.'),
];
const IDLE_SPROUT = [
  L('s1', 'I grew a millimetre today. Probably.', 'sprout'),
  L('s2', 'Leaves feel extra green today.', 'sprout'),
  L('s3', "I'm mostly water and optimism.", 'sprout'),
  L('s4', 'Sunlight, water, a little encouragement. My whole routine.', 'sprout'),
  L('s5', "If I stand very still I'm basically a houseplant.", 'sprout'),
  L('s6', 'Roots first, then leaves. Learning is the same.', 'sprout'),
  L('s7', 'Small and steady. That is how trees started.', 'sprout'),
  L('s8', "I tried photosynthesising faster. Doesn't work.", 'sprout'),
  L('s9', 'Rain is just the sky watering me.', 'sprout'),
  L('s10', 'I like it here, by your notes.', 'sprout'),
  L('s11', 'Some days you sprout. Some days you just stay potted.', 'sprout'),
  L('s12', 'I leaned toward the light again. Habit.', 'sprout'),
];
const IDLE_PIP = [
  L('p1', 'I bounced into a wall earlier. On purpose.', 'pip'),
  L('p2', 'Round is a great shape. No corners to worry about.', 'pip'),
  L('p3', 'I hummed a whole song in my head.', 'pip'),
  L('p4', "I'm practising my serious face. Nope.", 'pip'),
  L('p5', 'Do clouds feel this soft? I hope so.', 'pip'),
  L('p6', 'Being small makes everything an adventure.', 'pip'),
  L('p7', 'Squish. Sorry, just stretching.', 'pip'),
  L('p8', 'I counted my bounces today. Lost count.', 'pip'),
  L('p9', 'If I roll, I go faster. I am not allowed to roll.', 'pip'),
  L('p10', "Soft on the outside, determined on the inside.", 'pip'),
];
const IDLE_GEAR: Record<string, Line[]> = {
  ladybug: [L('g1', 'Do you think ladybugs study?', 'sprout'), L('g2', 'Dot says hi. Dot is shy.', 'sprout'), L('g3', 'Dot landed on me again. I am a landing pad now.', 'sprout')],
  firefly: [L('g4', 'My firefly only comes out at night. Like some students.', 'sprout')],
  bloom: [L('g5', 'My bud opens when your list gets done. No pressure.', 'sprout')],
  glasses: [L('g6', 'These glasses make me look clever, right?'), L('g7', 'I wear glasses so people think I read. I do read.')],
  balloon: [L('g8', 'My balloon goes up as your day gets done.', 'pip')],
  phones: [L('g9', 'My headphones are mostly for looking cool.', 'pip')],
};

const CTX_LEFT = [
  L('c1', '{left} left on today\'s list. One at a time.'),
  L('c2', 'Pick the smallest one first?'),
  L('c3', "Next on the list: {next}. If you're up for it."),
  L('c4', '{left} to go. You have time.'),
];
const CTX_FEW = [L('c5', 'Just {left} to go.'), L('c6', 'Almost there. {left} left.')];
const CTX_DONE = [
  L('c7', "List's clear. Anything now is a bonus."),
  L('c8', 'All done today. You could just rest.'),
  L('c9', 'Nothing left on the list. Nice feeling, right?'),
];
const CTX_LATE_LEFT = [L('c10', 'Whatever is left can wait for morning.'), L('c11', "It's late. The list will still be there tomorrow.")];
const CTX_EXAM_FAR = [L('e1', '{exam} in {days} days. Plenty of time if we start small.'), L('e2', '{exam} is {days} days away. A little each day.')];
const CTX_EXAM_NEAR = [L('e3', '{exam} in {days} days. Revision mode?'), L('e4', '{days} days to {exam}. You know more than you think.')];
const CTX_EXAM_TOMORROW = [L('e5', '{exam} is tomorrow. Early night, okay?'), L('e6', '{exam} tomorrow. Light revision, then sleep.')];
const CTX_EXAM_TODAY = [L('e7', '{exam} today. Breathe. You prepared.'), L('e8', 'Exam day. Go show them.')];
const CTX_FOCUS = [L('f1', '{focusMin} minutes of focus today. That adds up.'), L('f2', '{focusMin} minutes of Deep Work so far. Lovely.')];
const CTX_FOCUS_BIG = [L('f3', 'Over two hours of Deep Work today. Proper.'), L('f4', 'That is a lot of focus today. Rest your eyes.')];
const CTX_NO_FOCUS = [L('f5', 'No Deep Work yet today. Even ten minutes counts.'), L('f6', 'A short session later, maybe?')];

/* ---------------------------------------------------------------- moments */

const TICK = [
  L('t1', 'Nice.'), L('t2', 'One down.'), L('t3', 'Tick!'), L('t4', 'Look at that.'), L('t5', 'Satisfying, right?'),
  L('t6', "That one's done."), L('t7', 'Lighter already.'), L('t8', 'Neat.'), L('t9', 'Onward.'), L('t10', 'Good one.'),
  L('t11', 'Ooh.'), L('t12', 'Gone!'), L('t13', 'And another.'), L('t14', 'That felt good.'),
];
const START = [
  L('st1', "I'll study too."), L('st2', 'Quiet mode. Go.'), L('st3', "Got my book. Let's go."), L('st4', "Focus time. I'll be still."),
  L('st5', "I'll be right here, reading."), L('st6', "Let's do this together."), L('st7', 'Phone down, mind on.'),
  L('st8', 'See you on the other side.'), L('st9', 'Deep breath. Begin.'), L('st10', 'Headphones on.', 'pip'),
];
const DONE_SHORT = [L('ds1', 'Short and sweet. Still counts.'), L('ds2', 'A little session is still a session.'), L('ds3', 'Quick one! Good.')];
const DONE_MID = [
  L('dm1', 'Nice session.'), L('dm2', 'That was a good stretch of focus.'), L('dm3', 'Focus, well spent.'),
  L('dm4', 'Look at you go.'), L('dm5', 'Done! I finished a chapter too.'), L('dm6', 'Lovely. Water break?'),
];
const DONE_LONG = [
  L('dl1', 'That was a proper session.'), L('dl2', 'Long one! Stretch with me.'), L('dl3', 'Wow. Deep work, truly.'),
  L('dl4', 'That was impressive. Rest your eyes now.'),
];
const DAY = [
  L('dy1', 'Every ToDo, done. Proud of you.'), L('dy2', 'Whole list, gone. That feeling!'), L('dy3', 'Clean sweep.'),
  L('dy4', 'Today: complete.'), L('dy5', 'You did all of it. All of it!'), L('dy6', 'The list is empty and my heart is full.'),
  L('dy7', 'Done for today. Go do something nice.'), L('dy8', 'Look, my bud opened!', 'sprout'),
  L('dy9', "That's everything. Brilliant."), L('dy10', 'Nothing left. You earned the evening.'),
];
const STREAK = [L('sk1', 'That streak keeps growing!'), L('sk2', 'Day after day. That is a habit now.'), L('sk3', 'Another milestone. Keep it gentle, keep it going.'), L('sk4', 'Look at that streak.')];
const MAKEOVER = [L('mk1', "Oh, hello! I'm {name}."), L('mk2', 'Hi! {name} here. Nice to meet you properly.')];
const WAVE = [L('wv1', 'Hi!'), L('wv2', 'Hey hey.'), L('wv3', 'Hello, you.'), L('wv4', 'Oi! Hi.'), L('wv5', 'Hiya.'), L('wv6', 'There you are.')];
const BYE = [L('by1', 'See you tomorrow!'), L('by2', 'Bye for now.'), L('by3', 'Off I go. Back tomorrow.')];
const IDEA = [L('id1', 'Oh! I had an idea. ...Forgot it.'), L('id2', 'Aha! ...no, never mind.'), L('id3', 'Got it! I think.')];
const NAP = [L('np1', 'Mm? Oh, hello!'), L('np2', 'I was just resting my eyes.'), L('np3', "Oh! You're back.")];

/* ---------------------------------------------------------------- taps */

const TAP_ONE = [
  L('tp1', 'Hehe.'), L('tp2', 'Hi there!'), L('tp3', 'Boop.'), L('tp4', 'That tickles.'), L('tp5', 'Yes?'), L('tp6', 'Hm?'),
  L('tp7', "I'm awake!"), L('tp8', 'Still here!'), L('tp9', "I'm cheering for you."), L('tp10', 'Hold me to talk.'),
];
const TAP_MANY = [L('tm1', 'Okay, okay!'), L('tm2', 'Hehe, stop!'), L('tm3', 'Again?')];
const TAP_DIZZY = [L('tz1', 'Whoa. Dizzy.'), L('tz2', 'The room is spinning.'), L('tz3', "I'm going to sit down.")];

/* ---------------------------------------------------------------- the memory */

/** What it remembers, kept on this device: lines said (by day), and how much it said today. */
export interface Memory {
  seen: Record<string, number>;
  day: string;
  said: number;
  lastAt: number;
  lastTickAt: number;
  hello: string;
  lastDay: string;
  run: number;
  firstDay: string;
}
export const freshMemory = (): Memory => ({ seen: {}, day: '', said: 0, lastAt: 0, lastTickAt: 0, hello: '', lastDay: '', run: 0, firstDay: '' });

/** Days since 1970, for resting lines and counting days in a row. */
export const dayNo = (key: string) => Math.floor(Date.parse(key + 'T00:00:00Z') / 86400000);

/** The line to say from a pool: one not said for a while (the longer the pool, the longer each rests), at random. */
export function choose(pool: Line[], ctx: Ctx, mem: Memory, today: number, rand = Math.random, strict = false): Line | null {
  const mine = pool.filter((l) => !l.who || l.who === ctx.kind);
  if (!mine.length) return null;
  // a line rests three days for each in its pool (two weeks at least, six weeks at most)
  const rest = Math.min(45, Math.max(14, mine.length * 3));
  const fresh = mine.filter((l) => !(l.id in mem.seen) || today - mem.seen[l.id] >= rest);
  if (!fresh.length && strict) return null;
  const from = fresh.length ? fresh : [...mine].sort((a, b) => (mem.seen[a.id] ?? -1) - (mem.seen[b.id] ?? -1)).slice(0, 2);
  return from[Math.floor(rand() * from.length)];
}

export function fill(text: string, ctx: Ctx, extra: Record<string, string | number> = {}): string {
  const v: Record<string, string | number> = {
    name: ctx.name, left: ctx.left, next: ctx.next ?? '', exam: ctx.exam?.title ?? '', days: ctx.exam?.days ?? 0,
    focusMin: ctx.focusMin, away: ctx.away, run: ctx.run, ...extra,
  };
  return text.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));
}

/** Notes a line as said today. */
export function remember(mem: Memory, id: string, today: number, now: number, spontaneous: boolean): Memory {
  return { ...mem, seen: { ...mem.seen, [id]: today }, said: mem.said + (spontaneous ? 1 : 0), lastAt: spontaneous ? now : mem.lastAt };
}

/** A new day for the memory: today's count starts over, and the days in a row go on or start again. */
export function newDay(mem: Memory, key: string): Memory {
  if (mem.day === key) return mem;
  const gap = mem.lastDay ? dayNo(key) - dayNo(mem.lastDay) : 0;
  // lines not said in three months are forgotten, so the memory stays small
  const keep: Record<string, number> = {};
  for (const [k, d] of Object.entries(mem.seen)) if (dayNo(key) - d < 90) keep[k] = d;
  return { ...mem, seen: keep, day: key, said: 0, run: gap === 1 ? mem.run + 1 : 1, lastDay: key, firstDay: mem.firstDay || key };
}

/* ---------------------------------------------------------------- what to say */

export type Moment = 'hello' | 'idle' | 'tick' | 'start' | 'done' | 'day' | 'streak' | 'makeover' | 'wave' | 'bye' | 'idea' | 'nap' | 'tap' | 'taps' | 'dizzy';

/** The pool for a moment, in this context. */
export function poolFor(m: Moment, ctx: Ctx, extra: { minutes?: number } = {}): Line[] {
  switch (m) {
    case 'hello': {
      if (ctx.first) return FIRST;
      const special = DAYS[ctx.date] ?? (DEEPAVALI[ctx.year] === ctx.date ? [L('dvl' + ctx.year, 'Happy Deepavali! Light and sweets today.')] : null);
      if (special) return special;
      if (ctx.away >= 2) return BACK;
      if ([7, 30, 60, 90, 120, 180, 365].includes(ctx.run)) return RUN;
      const h = ctx.hour;
      const time = h >= 5 && h < 12 ? HELLO_MORNING : h >= 12 && h < 17 ? HELLO_AFTERNOON : h >= 17 && h < 22 ? HELLO_EVENING : HELLO_LATE;
      return [...time, ...(HELLO_WEEKDAY[ctx.weekday] ?? [])];
    }
    case 'idle': return [...idleFacts(ctx), ...idleOwn(ctx)];
    case 'tick': return TICK;
    case 'start': return START;
    case 'done': {
      const min = extra.minutes ?? 25;
      return min < 15 ? DONE_SHORT : min >= 50 ? DONE_LONG : DONE_MID;
    }
    case 'day': return DAY.filter((l) => l.id !== 'dy8' || ctx.gear.includes('bloom'));
    case 'streak': return STREAK;
    case 'makeover': return MAKEOVER;
    case 'wave': return WAVE;
    case 'bye': return BYE;
    case 'idea': return IDEA;
    case 'nap': return NAP;
    case 'tap': return TAP_ONE;
    case 'taps': return TAP_MANY;
    case 'dizzy': return TAP_DIZZY;
  }
}

/** What is true today and worth a word: the list, an exam coming up, the focus so far. */
function idleFacts(ctx: Ctx): Line[] {
  const late = ctx.hour >= 22 || ctx.hour < 5;
  const facts: Line[] = [];
  if (ctx.exam) {
    const d = ctx.exam.days;
    facts.push(...(d === 0 ? CTX_EXAM_TODAY : d === 1 ? CTX_EXAM_TOMORROW : d <= 6 ? CTX_EXAM_NEAR : d <= 21 ? CTX_EXAM_FAR : []));
  }
  if (ctx.due > 0) {
    if (ctx.left === 0) facts.push(...CTX_DONE);
    else if (late) facts.push(...CTX_LATE_LEFT);
    else if (ctx.left <= 2) facts.push(...CTX_FEW);
    else facts.push(...CTX_LEFT.filter((l) => l.id !== 'c3' || !!ctx.next));
  }
  if (ctx.focusMin >= 120) facts.push(...CTX_FOCUS_BIG);
  else if (ctx.focusMin >= 45) facts.push(...CTX_FOCUS);
  else if (ctx.focusMin === 0 && ctx.hour >= 14 && ctx.hour < 21) facts.push(...CTX_NO_FOCUS);
  return facts;
}

/** Its own musings, and a word about what it keeps. */
function idleOwn(ctx: Ctx): Line[] {
  const own = [...IDLE_ANY, ...(ctx.kind === 'sprout' ? IDLE_SPROUT : IDLE_PIP)];
  for (const g of ctx.gear) own.push(...(IDLE_GEAR[g] ?? []));
  return own;
}

/**
 * What it might say by itself now: about half the time something true today (when there is a fact it has not said
 * lately), otherwise a thought of its own.
 */
export function chooseIdle(ctx: Ctx, mem: Memory, today: number, rand = Math.random): Line | null {
  const facts = idleFacts(ctx);
  if (facts.length && rand() < 0.5) {
    const f = choose(facts, ctx, mem, today, rand, true);
    if (f) return f;
  }
  return choose(idleOwn(ctx), ctx, mem, today, rand);
}

/** How many lines it may say by itself in a day, and how long it waits between them, at each Settings choice. */
export const BUDGET = { often: { lines: 6, gapMin: 20 }, some: { lines: 3, gapMin: 50 }, asked: { lines: 0, gapMin: 0 } };

/** Whether it may say something by itself now. */
export function maySpeak(mem: Memory, talk: keyof typeof BUDGET, now: number): boolean {
  const b = BUDGET[talk];
  return mem.said < b.lines && now - mem.lastAt >= b.gapMin * 60 * 1000;
}

/* ---------------------------------------------------------------- spoken to */

export type Act = 'wave' | 'cheer' | 'nap' | 'droop' | 'heart' | 'think' | 'dance' | 'blush' | 'yawn' | 'nod';
export interface Reply { text: string; act?: Act; focus?: boolean }

const pickOf = <T,>(a: T[], rand: () => number): T => a[Math.floor(rand() * a.length)];

/**
 * An answer to a message: what the words are about (a greeting, tiredness, a worry, a joke asked for, the list, an
 * exam), answered warmly and briefly, often with something it does. Not a chat bot: a friend with a few things to say.
 */
export function reply(msg: string, ctx: Ctx, rand = Math.random): Reply {
  const m = ' ' + msg.toLowerCase().replace(/[^a-z0-9\s']/g, ' ').replace(/\s+/g, ' ') + ' ';
  const has = (...w: string[]) => w.some((x) => m.includes(' ' + x + ' ') || (x.endsWith('*') && m.includes(' ' + x.slice(0, -1))));
  const sprout = ctx.kind === 'sprout';
  if (!m.trim()) return { text: pickOf(['Hm?', 'Yes?', "I'm listening."], rand) };
  if (has('vanakkam')) return { text: 'Vanakkam!', act: 'wave' };
  if (has('good night', 'goodnight', 'gn', 'night', 'sleep*', 'bed')) return { text: pickOf(['Good night. Sleep well.', 'Night night. Big day tomorrow?', 'Sleep is studying in disguise. Good night.'], rand), act: 'nap' };
  if (has('good morning', 'gm', 'morning')) return { text: pickOf(['Good morning!', 'Morning! Ready when you are.'], rand), act: 'wave' };
  if (has('hi', 'hello', 'hey', 'hii', 'hiii', 'heyy', 'yo', 'sup', 'hola')) return { text: pickOf(['Hi!', 'Hey you.', 'Hello hello.', 'Hiya!'], rand), act: 'wave' };
  if (has('bye', 'cya', 'later', 'goodbye')) return { text: pickOf(['Bye for now.', 'See you soon!'], rand), act: 'wave' };
  if (has('how are you', 'how r u', 'hru', 'wassup', 'whats up', "what's up", 'how you doing')) {
    return { text: sprout ? pickOf(['Green and growing. You?', 'Leafy and happy. How about you?'], rand) : pickOf(['Bouncy, thanks. You?', 'Round and well! And you?'], rand), act: 'nod' };
  }
  if (has('stress*', 'anxious', 'anxiety', 'scared', 'worried', 'worry', 'overwhelm*', 'panic*', 'nervous', 'pressure')) {
    return { text: pickOf(['One thing at a time. What is the smallest next step?', 'Breathe in for four, out for six. I will do it with you.', "It's a lot. You don't have to do it all today."], rand), act: 'nod', focus: rand() < 0.5 };
  }
  if (has('sad', 'cry*', 'upset', 'lonely', 'bad day', 'terrible', 'awful', 'depressed', 'hurt')) {
    return { text: pickOf(["I'm sorry today is heavy. I'm right here.", 'That sounds hard. Be gentle with yourself tonight.', 'Sending you a very small, very warm hug.'], rand), act: 'droop' };
  }
  if (has('tired', 'exhausted', 'sleepy', 'drained')) return { text: pickOf(['Rest is part of studying. Short break?', 'Ten minutes of rest, then see how you feel?'], rand), act: 'yawn' };
  if (has('bored', 'boring')) return { text: pickOf(['Tiny challenge: one ToDo in five minutes. Go!', 'Bored is your brain asking for something new. Switch subjects?'], rand), act: 'think' };
  if (has('happy', 'great', 'awesome', 'yay', 'amazing', 'good day', 'excited', 'did it', 'i did', 'passed', 'topped')) {
    return { text: sprout ? pickOf(['Yay! My leaves perked right up.', 'That makes me so happy!'], rand) : pickOf(['Yay! Bounce bounce.', 'That makes me so happy!'], rand), act: 'cheer' };
  }
  if (has('thank*', 'thx', 'ty', 'tysm')) return { text: pickOf(['Anytime.', 'Always.', 'Happy to help. Well, to cheer.'], rand), act: 'blush' };
  if (has('love', 'luv', 'cute', 'adorable', 'best')) return { text: pickOf(['Aww. You are my favourite.', 'Stop it, I am blushing.', 'I like you too.'], rand), act: 'heart' };
  if (has('stupid', 'dumb', 'hate', 'useless', 'annoying', 'shut up', 'go away')) {
    return { text: sprout ? pickOf(["Oof. Okay. I'll be over here, being a plant.", 'Fair. I will be quiet for a bit.'], rand) : pickOf(['Oof. Okay. Quiet Pip mode.', 'Fair. I will be quiet for a bit.'], rand), act: 'droop' };
  }
  if (has('joke', 'funny', 'laugh')) {
    return { text: pickOf([
      'Why did the student bring a ladder? For the higher marks.',
      'I told a chemistry joke. No reaction.',
      'Parallel lines have so much in common. Shame they never meet.',
      'Why was the maths book sad? Too many problems.',
      'I would tell you a UDP joke, but you might not get it.',
      'What do you call a sleeping dinosaur? A dino-snore.',
      sprout ? 'Why do plants hate maths? It gives them square roots.' : 'Why did the blob go to school? To get a little more shape.',
    ], rand), act: 'cheer' };
  }
  if (has('dance', 'party')) return { text: 'Watch this.', act: 'dance' };
  if (has('wave')) return { text: pickOf(['Hello!', 'Hi hi!'], rand), act: 'wave' };
  if (has('name', 'who are you', 'what are you')) return { text: sprout ? 'I am ' + ctx.name + '. A little plant who lives in your app.' : 'I am ' + ctx.name + '. Small, round, on your side.', act: 'nod' };
  if (has('exam*', 'test', 'tests')) {
    if (!ctx.exam) return { text: "No exams coming up that I know of. Add one in Exams and I'll keep count." };
    const d = ctx.exam.days;
    return { text: d === 0 ? ctx.exam.title + ' is today. You prepared. Go.' : ctx.exam.title + ' is in ' + d + (d === 1 ? ' day.' : ' days.') + (d <= 3 ? ' Light revision, early nights.' : ' Plenty of time if we start small.'), act: 'think' };
  }
  if (has('todo', 'todos', 'list', 'tasks', 'task', 'what next', 'what now', 'what should i do', 'next')) {
    if (!ctx.due) return { text: "Nothing on today's list. Add a ToDo and I'll cheer for it." };
    if (!ctx.left) return { text: 'Your list is clear today. Anything now is a bonus.', act: 'cheer' };
    return { text: 'Next up: ' + ctx.next + '. ' + (ctx.left === 1 ? 'The last one!' : ctx.left + ' left in all.'), act: 'nod' };
  }
  if (has('focus', 'study', 'studying', 'deep work', 'session', 'pomodoro')) {
    return { text: ctx.focusMin ? ctx.focusMin + ' minutes of focus today. Another session? I will study with you.' : 'Want to start a session? I will study with you.', focus: true, act: 'nod' };
  }
  if (has('hungry', 'food', 'eat', 'snack')) return { text: sprout ? 'I just had some sunlight. Go get a real snack.' : 'Snack break! Something with fruit in it?' };
  if (has('water', 'thirsty')) return { text: sprout ? 'Water! My favourite. Have a glass with me.' : 'Good idea. A glass of water for you.' };
  if (has('weather', 'rain*', 'sunny', 'hot', 'cold')) return { text: sprout ? 'Rain or sun, I am happy. Mostly rain.' : 'Whatever the weather, it is a good day to be indoors studying. Sorry.' };
  if (/\?\s*$/.test(msg.trim())) return { text: pickOf(['Hmm. Good question. I am only small, but I think you know.', 'I am not sure. What do you think?', 'Ask me something easier, like whether you are doing great. You are.'], rand), act: 'think' };
  return { text: pickOf(['Mm-hm.', "I'm listening.", 'Tell me more?', "I'm only small, but I'm on your side.", 'I like hearing from you.', 'Noted. Very important.'], rand), act: 'nod' };
}
