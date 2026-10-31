// What the companion says, and when it may. Lines come in pools, by moment (a hello, a tick, a session done, a tap) and
// by what is true right now (the time of day and the weekday, ToDos left and the next one, an exam coming up, minutes of
// focus and the subject), so most of what it says is about the user's own day, said with a little wit. A line once said
// rests for weeks before it can come back, so months of daily use do not wear it thin. Most of the time it says nothing
// at all: a few words by itself a day at most (as Settings allows), never close together, never during Deep Work.
// Pure apart from the memory it keeps (see Memory), so it is tested on its own.

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
  /** today's ToDos: how many are due, how many are still open, and the first one still open */
  due: number;
  left: number;
  next: string | null;
  /** the soonest exam coming up, and in how many days (0 today) */
  exam: { title: string; days: number } | null;
  /** minutes of Deep Work today, and the subject of the latest session */
  focusMin: number;
  subject?: string | null;
  /** days since it was last seen (0 the same day, 1 yesterday); its run of days in a row; whether today is its first */
  away: number;
  run: number;
  first: boolean;
  gear: string[];
};

/** A line: its id (for resting it once said), its words, and the companion who says it (both when left out). */
type Line = { id: string; text: string; who?: Kind };
const L = (id: string, text: string, who?: Kind): Line => ({ id, text, who });

/* ---------------------------------------------------------------- hellos */

const HELLO_MORNING = [
  L('hm1', 'Morning. The day is still in its wrapper.'),
  L('hm2', 'Good morning. Slow start or dramatic start?'),
  L('hm3', 'Morning! Fresh page. No crossings-out yet.'),
  L('hm4', 'Up already? Respect.'),
  L('hm5', 'Good morning. I already did my photosynthesis.', 'sprout'),
  L('hm6', 'Morning. My leaves are still loading.', 'sprout'),
  L('hm7', 'Morning! I bounced out of bed. Literally.', 'pip'),
  L('hm8', 'Morning. Breakfast first. That is the rule.'),
  L('hm9', 'Good morning. One good thing today is plenty.'),
  L('hm10', 'Morning! I saved you the comfy spot on the header.'),
  L('hm11', 'Ah, morning. The quietest hour for clever thoughts.'),
  L('hm12', 'Good morning. Water first, then worries.'),
];
const HELLO_AFTERNOON = [
  L('ha1', 'Afternoon. Half the day gone, the better half left.'),
  L('ha2', 'Oh, hi. Post-lunch brain? Me too.'),
  L('ha3', 'Afternoon light is my favourite flavour.', 'sprout'),
  L('ha4', 'Hi! I was practising sitting still. Nailed it.', 'pip'),
  L('ha5', 'Afternoon. Good time for one small thing.'),
  L('ha6', 'Hey. The day is still yours, I checked.'),
  L('ha7', 'Afternoon! Did you drink water, or just think about it?'),
  L('ha8', 'Hello again. I kept the list warm for you.'),
];
const HELLO_EVENING = [
  L('he1', 'Evening. How did today treat you?'),
  L('he2', 'Hi. Evenings are for finishing soft.'),
  L('he3', 'Evening! My leaves fold up soon. Not yet though.', 'sprout'),
  L('he4', 'Hi! I saved some bounce for the evening.', 'pip'),
  L('he5', 'Evening. Whatever today was, it counts.'),
  L('he6', 'Hey. The quiet part of the day. My favourite.'),
  L('he7', 'Evening. One last thing, or none at all. Both fine.'),
  L('he8', 'Good evening. Even the notifications are tired.'),
];
const HELLO_LATE = [
  L('hl1', "It's late. Be kind to tomorrow-you."),
  L('hl2', 'Night owl mode? Hoot hoot.'),
  L('hl3', "Still up? I'll keep you company."),
  L('hl4', 'Even the Wi-Fi is asleep.'),
  L('hl5', 'Shh. Everyone else is asleep.'),
  L('hl6', 'Midnight study? Short, then bed. Deal?'),
];
const HELLO_WEEKDAY: Record<number, Line[]> = {
  1: [L('wd1a', 'Monday again? It keeps happening.'), L('wd1b', 'New week. Clean slate, same snacks.')],
  5: [L('wd5a', 'Friday! The week is almost a story now.'), L('wd5b', 'Friday. Finish light.')],
  6: [L('wd6a', 'Saturday. Rest counts as homework too.'), L('wd6b', 'Weekend. A little study, a lot of air?')],
  0: [L('wd0a', 'A slow Sunday is allowed. Officially.'), L('wd0b', 'Sunday. Good day to peek at next week.')],
};
const BACK = [
  L('bk1', "You're back! I watered the app while you were gone.", 'sprout'),
  L('bk2', 'Hey, {away} days! I kept everything just as you left it.'),
  L('bk3', 'Oh! Welcome back. I may have napped a little.'),
  L('bk4', 'There you are. No catching up needed. Just today.'),
  L('bk5', 'You were gone {away} days. I counted. Bounce count: many.', 'pip'),
];
const FIRST = [L('fs1', "Hi, I'm {name}. I live up here. I'll be quiet, mostly.")];
const RUN = [L('rn1', "{run} days in a row. We're basically a routine now."), L('rn2', '{run} days straight. I would give you a medal, but I am a plant.', 'sprout'), L('rn3', '{run} days in a row! I did a bounce for each.', 'pip')];

/** special days (Tamil Nadu's own among them) */
const DAYS: Record<string, Line[]> = {
  '01-01': [L('d0101', 'Happy new year! New notebook energy.')],
  '01-14': [L('d0114', 'Happy Pongal! Something sweet today?')],
  '01-15': [L('d0115', 'Pongal greetings. Sugarcane and good marks.')],
  '01-26': [L('d0126', 'Happy Republic Day.')],
  '04-14': [L('d0414', 'Puthandu vazhthukal! Happy Tamil New Year.')],
  '08-15': [L('d0815', 'Happy Independence Day.')],
  '09-05': [L('d0905', "Happy Teachers' Day. Thank one today?")],
  '11-14': [L('d1114', "Happy Children's Day. That's you, sort of.")],
};
/** Deepavali moves each year */
const DEEPAVALI: Record<number, string> = { 2026: '11-08', 2027: '10-29', 2028: '10-17', 2029: '11-05', 2030: '10-26' };

/* ---------------------------------------------------------------- by itself */

const IDLE_ANY = [
  L('i1', 'Tiny steps still move you. Ask any snail.'),
  L('i2', "You're doing better than your to-do list thinks."),
  L('i3', 'Drink some water. I just did. Showing off, really.'),
  L('i4', 'Shoulders down. They creep up when you focus.'),
  L('i5', 'Hm. Just thinking. About nothing. Very busy.'),
  L('i6', 'Remember to blink. I just did. Twice.'),
  L('i7', 'Studying is future-you collecting gifts.'),
  L('i8', 'Mistakes are just practice in a fake moustache.'),
  L('i9', 'Look away from the screen for a bit. Far away. Further.'),
  L('i10', 'Not every day has to be a great day. Some can be okay.'),
  L('i11', 'If it feels hard, your brain is lifting weights.'),
  L('i12', "A break isn't quitting. It's a pit stop."),
  L('i13', 'One question at a time. Even the big ones.'),
  L('i14', 'Nobody remembers everything. That is why notes exist.'),
  L('i15', 'Sit up a little. There. Very scholarly.'),
  L('i16', 'Reading it twice still counts as reading it.'),
  L('i17', 'The hardest part is starting. The rest is just doing.'),
  L('i18', 'I believe in you. Statistically, it is working.'),
];
const IDLE_SPROUT = [
  L('s1', 'I grew a millimetre today. Probably. Do not measure.', 'sprout'),
  L('s2', "I'm mostly water and optimism.", 'sprout'),
  L('s3', 'If I stand very still, I am basically a houseplant.', 'sprout'),
  L('s4', 'Roots first, then leaves. Learning works the same.', 'sprout'),
  L('s5', 'I tried photosynthesising faster. It does not work.', 'sprout'),
  L('s6', 'Rain is just the sky doing my chores.', 'sprout'),
  L('s7', 'I leaned toward the light again. Old habit.', 'sprout'),
  L('s8', 'Some days you sprout. Some days you stay potted. Both fine.', 'sprout'),
  L('s9', 'My leaves are my hands. Typing is hard.', 'sprout'),
];
const IDLE_PIP = [
  L('p1', 'I bounced into a wall earlier. On purpose. Mostly.', 'pip'),
  L('p2', 'Round is a great shape. No corners to bump.', 'pip'),
  L('p3', 'I hummed a whole song in my head. It was a banger.', 'pip'),
  L('p4', "Practising my serious face. Nope. Can't.", 'pip'),
  L('p5', 'Being small makes everything an adventure.', 'pip'),
  L('p6', 'If I roll, I go faster. I am not allowed to roll.', 'pip'),
  L('p7', 'Soft on the outside. Determined on the inside.', 'pip'),
  L('p8', 'I counted my bounces today. Lost count at bounce.', 'pip'),
];
const IDLE_GEAR: Record<string, Line[]> = {
  ladybug: [L('g1', 'Dot landed on me again. I am an airport now.', 'sprout'), L('g2', 'Dot says hi. Dot is shy. Dot is also a ladybug.', 'sprout')],
  firefly: [L('g3', 'My firefly only comes out at night. Like some students.', 'sprout')],
  bloom: [L('g4', 'My bud opens as your list shrinks. No pressure. Some pressure.', 'sprout')],
  glasses: [L('g5', 'These glasses make me look clever. They are not prescription.'), L('g6', 'I wear glasses so people think I read. I do read.')],
  balloon: [L('g7', 'My balloon floats higher when your day goes well. Science.', 'pip')],
  phones: [L('g8', 'My headphones are mostly for looking cool.', 'pip')],
};

/* ---------------------------------------------------------------- about the day */

const CTX_MANY = [
  L('c1', '{left} ToDos left. I counted twice. Still {left}.'),
  L('c2', '{left} things on the list. We could pick the smallest and feel great.'),
  L('c3', 'Next up: {next}. If you are up for it.'),
  L('c4', '{left} to go. One at a time, like eating a pizza.'),
];
const CTX_FEW = [
  L('c5', 'Just {left} to go. I can see the finish line from here.'),
  L('c6', 'Only {next} stands between you and glory.'),
  L('c7', '{left} left. Nearly there. I am vibrating.', 'pip'),
];
const CTX_CLEAR = [
  L('c8', 'List clear. Anything now is a bonus round.'),
  L('c9', 'Nothing left today. That feeling is called pride.'),
  L('c10', 'All done! You could just rest. Revolutionary.'),
];
const CTX_LATE_LEFT = [L('c11', 'Whatever is left can wait for morning. It will not run away.'), L('c12', "It's late. The list keeps. You need sleep.")];
const CTX_EXAM_FAR = [L('e1', '{exam} in {days} days. Plenty of time, if we start small.'), L('e2', '{exam} is {days} days off. A little a day beats a lot at once.')];
const CTX_EXAM_NEAR = [
  L('e3', '{exam} in {days} days. Revision mode: engaged.'),
  L('e4', '{days} days to {exam}. You know more than you think.'),
  L('e5', '{exam} in {days} days. Formulas will not learn themselves. Sadly.'),
];
const CTX_EXAM_TOMORROW = [L('e6', '{exam} is tomorrow. Light revision, early night.'), L('e7', '{exam} tomorrow. Sleep is part of the syllabus.')];
const CTX_EXAM_TODAY = [L('e8', '{exam} today. Breathe. You prepared for this.'), L('e9', 'Exam day! Go show {exam} who is boss.')];
const CTX_FOCUS = [
  L('f1', '{focusMin} minutes of focus today. My leaves are impressed. Both of them.', 'sprout'),
  L('f2', '{focusMin} minutes of Deep Work so far. I did {focusMin} bounces in your honour.', 'pip'),
  L('f3', '{focusMin} focused minutes. That adds up, you know.'),
];
const CTX_SUBJECT = [L('f4', 'More {subject} today? Your brain is getting {subject}-shaped.'), L('f5', 'That {subject} session earlier? Chef\'s kiss.')];
const CTX_FOCUS_BIG = [L('f6', 'Over two hours of Deep Work today. Rest your eyes, legend.'), L('f7', 'That is a lot of focus today. Go stare at a tree.')];
const CTX_NO_FOCUS = [L('f8', 'No Deep Work yet today. Ten minutes still counts.'), L('f9', 'A short session later? I will bring my book.')];

/* ---------------------------------------------------------------- moments */

const TICK = [
  L('t1', 'Nice.'), L('t2', 'One down!'), L('t3', 'Tick! Satisfying.'), L('t4', 'Look at you go.'), L('t5', 'Gone. Poof.'),
  L('t6', 'That one never stood a chance.'), L('t7', 'Lighter already.'), L('t8', 'Neat.'), L('t9', 'Onward!'), L('t10', 'Smooth.'),
  L('t11', 'Ooh, crisp tick.'), L('t12', 'And another!'), L('t13', 'The list fears you.'), L('t14', 'That felt good, right?'),
];
const START = [
  L('st1', "I'll study too. Quietly."), L('st2', 'Quiet mode. Go.'), L('st3', "Got my book. Let's go."),
  L('st4', "Focus time. I'll be a very still plant.", 'sprout'), L('st5', 'Headphones on. Silent bounce mode.', 'pip'),
  L('st6', "Let's do this together."), L('st7', 'Phone down, brain up.'), L('st8', 'See you on the other side.'),
  L('st9', 'Deep breath. Begin.'),
];
const DONE_SHORT = [L('ds1', 'Short and sweet. Still counts.'), L('ds2', 'A little session is still a session.'), L('ds3', 'Quick one! Good warm-up.')];
const DONE_MID = [
  L('dm1', 'Nice session. I finished a chapter too.'), L('dm2', 'That was a good stretch of focus.'), L('dm3', 'Focus, well spent.'),
  L('dm4', 'Done! Water break?'), L('dm5', 'Look at that. Brain: fed.'),
];
const DONE_LONG = [
  L('dl1', 'That was a proper session. Stretch with me.'), L('dl2', 'Long one! I read my book twice.'), L('dl3', 'Wow. Deep work, truly deep.'),
  L('dl4', 'Impressive. Now rest your eyes. Doctor {name} says.'),
];
const DAY = [
  L('dy1', 'Every ToDo, done. Proud of you.'), L('dy2', 'Whole list, gone. Go do something nice.'), L('dy3', 'Clean sweep!'),
  L('dy4', 'Today: completed it.'), L('dy5', 'You did all of it. ALL of it.'), L('dy6', 'The list is empty and my heart is full.'),
  L('dy7', 'Look, my bud opened!', 'sprout'), L('dy8', 'My balloon is touching the sky!', 'pip'),
  L('dy9', "That's everything. Brilliant."), L('dy10', 'Nothing left. You earned the evening.'),
];
const STREAK = [L('sk1', 'That streak keeps growing!'), L('sk2', 'Day after day. That is a habit now.'), L('sk3', 'Another milestone. Gentle and steady.'), L('sk4', 'Look at that streak go.')];
const WAVE = [L('wv1', 'Hi!'), L('wv2', 'Hey hey.'), L('wv3', 'Hello, you.'), L('wv4', 'Oi! Hi.'), L('wv5', 'Hiya.'), L('wv6', 'There you are.')];
const BYE = [L('by1', 'Off for a bit. Knock if you need me!'), L('by2', 'Bye for now. My door is right there.'), L('by3', 'Going for a walk. Knock knock when you want me.')];
const BACKIN = [L('bi1', 'You knocked! Hi again.'), L('bi2', 'Coming, coming!'), L('bi3', 'Back already? I missed you too.'), L('bi4', 'Who is there? Oh, it is you!')];
const IDEA = [L('id1', 'I had an idea. It left.'), L('id2', 'Aha! ...no, never mind.'), L('id3', 'Eureka! Wait. Not quite.'), L('id4', 'Big idea incoming. Still loading.')];
const NAP = [L('np1', 'Mm? Oh, hello!'), L('np2', 'I was resting my eyes. Both of them.'), L('np3', 'Not sleeping. Thinking. With my eyes closed.')];
const SHH = [L('sh1', 'Shh. Studying.'), L('sh2', 'Shh, chapter seven.'), L('sh3', 'Focus! Me too.')];

/* ---------------------------------------------------------------- taps */

const TAP_ONE = [
  L('tp1', 'Hehe.'), L('tp2', 'Boop.'), L('tp3', 'That tickles.'), L('tp4', 'Yes, hello?'), L('tp5', "I'm awake! I promise."),
  L('tp6', "I'm cheering for you. Silently. Loudly inside."), L('tp7', 'Hold me and I will go for a walk.'),
];
const TAP_MANY = [L('tm1', 'Okay, okay!'), L('tm2', 'Hehe, stop!'), L('tm3', 'Again?'), L('tm4', 'I am not a button! Okay, a bit.')];
const TAP_DIZZY = [L('tz1', 'Whoa. Two of you now.'), L('tz2', 'The room is spinning.'), L('tz3', 'I need to sit down. I am sitting.')];

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

const clip = (s: string, n = 28) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

export function fill(text: string, ctx: Ctx, extra: Record<string, string | number> = {}): string {
  const v: Record<string, string | number> = {
    name: ctx.name, left: ctx.left, next: clip(ctx.next ?? ''), exam: clip(ctx.exam?.title ?? '', 24), days: ctx.exam?.days ?? 0,
    focusMin: ctx.focusMin, subject: clip(ctx.subject ?? '', 18), away: ctx.away, run: ctx.run, ...extra,
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

export type Moment =
  | 'hello' | 'idle' | 'tick' | 'start' | 'done' | 'day' | 'streak' | 'wave' | 'bye' | 'back' | 'idea' | 'nap' | 'shh'
  | 'tap' | 'taps' | 'dizzy';

/** The pool for a moment, in this context. */
export function poolFor(m: Moment, ctx: Ctx, extra: { minutes?: number } = {}): Line[] {
  switch (m) {
    case 'hello': {
      if (ctx.first) return FIRST;
      const special = DAYS[ctx.date] ?? (DEEPAVALI[ctx.year] === ctx.date ? [L('dvl' + ctx.year, 'Happy Deepavali! Light, sweets, and maybe one ToDo.')] : null);
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
    case 'day': return DAY.filter((l) => (l.id !== 'dy7' || ctx.gear.includes('bloom')) && (l.id !== 'dy8' || ctx.gear.includes('balloon')));
    case 'streak': return STREAK;
    case 'wave': return WAVE;
    case 'bye': return BYE;
    case 'back': return BACKIN;
    case 'idea': return IDEA;
    case 'nap': return NAP;
    case 'shh': return SHH;
    // a tap: about half the time, a word about the day (when there is one)
    case 'tap': { const f = idleFacts(ctx); return f.length && Math.random() < 0.5 ? f : TAP_ONE; }
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
    if (ctx.left === 0) facts.push(...CTX_CLEAR);
    else if (late) facts.push(...CTX_LATE_LEFT);
    else if (ctx.left <= 2) facts.push(...CTX_FEW.filter((l) => l.id !== 'c6' || (!!ctx.next && ctx.left === 1)));
    else facts.push(...CTX_MANY.filter((l) => l.id !== 'c3' || !!ctx.next));
  }
  if (ctx.focusMin >= 120) facts.push(...CTX_FOCUS_BIG);
  else if (ctx.focusMin >= 30) facts.push(...CTX_FOCUS, ...(ctx.subject ? CTX_SUBJECT : []));
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
