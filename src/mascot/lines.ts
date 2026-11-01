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

/*
 * ---------------------------------------------------------------- its voice
 *
 * A toddler's: delighted, easily amazed, a little wobbly in its spelling, proud of its things, and never once telling
 * anyone what to do. No advice, no reminders to rest or drink water: it is company, not a coach. When it is fussed
 * over (tapped a lot, carried about) it comes out with happy babble.
 */

/* ---------------------------------------------------------------- hellos */

/** hellos for any time of day, so the hello at the same hour every day still changes */
const HELLO_ANY = [
  L('hy1', 'hiii! u came!'),
  L('hy2', 'oh! hello! i was just... standing.'),
  L('hy3', 'yay yay yay. u.'),
  L('hy4', 'hewwo! i missed u. three lots.'),
  L('hy5', 'knock knock! (oh wait. thats my job)'),
  L('hy6', 'u here! best part of the day.'),
  L('hy7', 'hello! i practised my wave.'),
  L('hy8', 'ooh, a visitor! its u!'),
  L('hy9', 'hi! i kept the header warm.'),
  L('hy10', 'there u are! (i looked here)'),
  L('hy11', 'hiya! i checked everything. twice.'),
  L('hy12', 'hello hello! *tiny happy jump*'),
];
const HELLO_MORNING = [
  L('hm1', 'good mowning!!'),
  L('hm2', 'sun is up. me is up. u is up!'),
  L('hm3', 'mornin! i woke up first.'),
  L('hm4', 'ooh u here! best mowning.'),
  L('hm5', 'mowning! leafs still stretchy.', 'sprout'),
  L('hm6', 'i had sunshine for breakfast. nom.', 'sprout'),
  L('hm7', 'mowning! i bounced out of bed.', 'pip'),
  L('hm8', 'hello hello hello. (one spare)'),
  L('hm9', 'a new day? i love new days.'),
];
const HELLO_AFTERNOON = [
  L('ha1', 'hiii! afternoon! sounds fancy.'),
  L('ha2', 'u came back! i guarded the header.'),
  L('ha3', 'afternoon sun is yummy.', 'sprout'),
  L('ha4', 'hi! i was being so still.', 'pip'),
  L('ha5', 'yay, u! i saved u a spot.'),
  L('ha6', 'i counted the buttons. (there is some)'),
];
const HELLO_EVENING = [
  L('he1', 'evenin! the sky is juice colour.'),
  L('he2', 'hiii. it getting dark. cozy.'),
  L('he3', 'evening! leafs not floppy yet.', 'sprout'),
  L('he4', 'hi! i saved my last bounces.', 'pip'),
  L('he5', 'ooh u here! evening buddies.'),
];
const HELLO_LATE = [
  L('hl1', 'soooo dark. we is night owls. hoot.'),
  L('hl2', 'shhh. everybody sleeping. but us.'),
  L('hl3', 'hi! i was not sleeping. (just blinking slow)'),
  L('hl4', 'spooky night. good thing u here.'),
];
const HELLO_WEEKDAY: Record<number, Line[]> = {
  1: [L('wd1a', 'mundee! sounds like fun day.')],
  5: [L('wd5a', 'fwiday! fwiiiday. i like it.')],
  6: [L('wd6a', 'saturday! no school bell. (ding? no ding)')],
  0: [L('wd0a', 'sun-day. it has sun IN it. wow.')],
};
const BACK = [
  L('bk1', 'u was gone {away} sleeps! i waited.'),
  L('bk2', 'U BACK! *happy wiggle*'),
  L('bk3', 'hi! i did not touch anything. (one thing)'),
  L('bk4', 'i watered the app for u.', 'sprout'),
  L('bk5', '{away} days of bounces! so tired.', 'pip'),
];
const FIRST = [L('fs1', "hi! i'm {name}. i live up here now!")];
const RUN = [
  L('rn1', '{run} days in a row!! besties.'),
  L('rn2', '{run} days! i ran out of leafs.', 'sprout'),
  L('rn3', '{run} days! (i has no fingers)', 'pip'),
];

/** special days (Tamil Nadu's own among them) */
const DAYS: Record<string, Line[]> = {
  '01-01': [L('d0101', 'happy new yeaw!! it look new.')],
  '01-14': [L('d0114', 'happy pongal!! (a tiny bit for me?)')],
  '01-15': [L('d0115', 'pongal again! two pongals!')],
  '01-26': [L('d0126', 'happy republic day! flag flag!')],
  '04-14': [L('d0414', 'puthandu vazhthukal!!')],
  '08-15': [L('d0815', 'happy independence day!')],
  '09-05': [L('d0905', "happy teachers' day!")],
  '11-14': [L('d1114', "children's day! thats me! and u!")],
};
/** Deepavali moves each year */
const DEEPAVALI: Record<number, string> = { 2026: '11-08', 2027: '10-29', 2028: '10-17', 2029: '11-05', 2030: '10-26' };

/* ---------------------------------------------------------------- by itself */

const IDLE_ANY = [
  L('i1', 'i found a pixel. i keep it.'),
  L('i2', 'hi search button. (it said nothing)'),
  L('i3', 'hmmm. thinking about... snacks.'),
  L('i4', 'one, two, fwee, five!'),
  L('i5', 'clicky clicky. u type so fast.'),
  L('i6', 'i am helping! (sitting very nicely)'),
  L('i7', 'i am small. but brave.'),
  L('i8', 'la la la. oh u heard that.'),
  L('i9', 'welcome to my house. (the header)'),
  L('i10', 'u look smart today!'),
  L('i11', 'i like it when u is here.'),
  L('i12', 'blink. blink. practising.'),
];
const IDLE_SPROUT = [
  L('s1', 'i growed a tiny bit. dont measure.', 'sprout'),
  L('s2', 'leafs are my hands. see? wave.', 'sprout'),
  L('s3', 'i eat sunshine. u eat... noodles?', 'sprout'),
  L('s4', 'raindrops tickle. hehe.', 'sprout'),
  L('s5', 'i leaned to the light. oops.', 'sprout'),
  L('s6', 'one day i be a big tree.', 'sprout'),
];
const IDLE_PIP = [
  L('p1', 'i bounced into the wall. sowwy wall.', 'pip'),
  L('p2', 'round is the best shape.', 'pip'),
  L('p3', 'boing. boing. bouncy day.', 'pip'),
  L('p4', 'serious face. ...it went squishy.', 'pip'),
  L('p5', 'i am not allowed to roll.', 'pip'),
  L('p6', 'i am soft. (no poking)', 'pip'),
];
const IDLE_GEAR: Record<string, Line[]> = {
  ladybug: [
    L('g1', 'dis is Dot. Dot is my fren.', 'sprout'),
    L('g2', 'Dot sat on me. i am a Dot chair.', 'sprout'),
    L('g3', 'Dot! come back! ...ok good.', 'sprout'),
  ],
  firefly: [L('g4', 'my night bug is shy.', 'sprout'), L('g5', 'blinky bug! i blink too.', 'sprout')],
  bloom: [L('g6', 'my flower gonna pop!! soon.', 'sprout'), L('g7', 'i has a bud. it mine.', 'sprout')],
  glasses: [L('g8', 'glasses! i see EVERYTHING. (i do not)'), L('g9', 'two plus two is... fish?')],
  bow: [L('g10', 'look at my bow!! i feel nice.', 'pip'), L('g11', 'is my bow wonky? (dont tell)', 'pip')],
  phones: [L('g12', 'la la la. its a good one.', 'pip'), L('g13', 'wait. do i has ears?', 'pip')],
  balloon: [L('g14', 'my baloon!! hold it gently.', 'pip'), L('g15', 'good day, baloon goes up! magic.', 'pip')],
};

/* ---------------------------------------------------------------- about the day */

const CTX_MANY = [
  L('c1', '{left} todos! dat is a lot of numbew.'),
  L('c2', 'next is {next}! ooh.'),
  L('c3', 'i counted ur list. {left}!'),
];
const CTX_FEW = [
  L('c4', 'only {left} left! almost winning!'),
  L('c5', 'just {next} left! the last one!'),
];
const CTX_CLEAR = [
  L('c6', 'ur list is empty! like my tummy.'),
  L('c7', 'no more todos! u did them all!'),
];
const CTX_EXAM_FAR = [L('e1', '{exam} in {days} sleeps!'), L('e2', '{exam} in {days} days! (i cheer loud)')];
const CTX_EXAM_NEAR = [L('e3', '{exam} in {days} sleeps! u know lots.'), L('e4', '{exam} soon! u gonna be so good.')];
const CTX_EXAM_TOMORROW = [L('e5', '{exam} tomorrow!! leafs crossed.', 'sprout'), L('e6', '{exam} tomorrow!! luck bounce!', 'pip')];
const CTX_EXAM_TODAY = [L('e7', 'today is {exam}!! u got dis.'), L('e8', 'big day! {exam}! go go go!')];
const CTX_FOCUS = [
  L('f1', '{focusMin} minnits of focus! wow.'),
  L('f2', '{focusMin} minnits of thinking! (my brain tired)'),
];
const CTX_SUBJECT = [L('f3', 'u did {subject}! sounds hard. u smart.')];
const CTX_FOCUS_BIG = [L('f4', 'so much focus! (pretend medal for u)')];

/* ---------------------------------------------------------------- moments */

const TICK = [
  L('t1', 'yay!'), L('t2', 'boop! gone.'), L('t3', 'tick tick!'), L('t4', 'ooh shiny tick.'), L('t5', 'u did it!!'),
  L('t6', 'one less!'), L('t7', 'bye bye todo!'), L('t8', 'wheee!'), L('t9', 'yesss.'),
  L('t10', '*quiet leaf clap*', 'sprout'), L('t11', 'happy bounce!', 'pip'), L('t12', 'woo!'),
];
const START = [
  L('st1', 'shhh. study time.'), L('st2', 'i read too! (the pictures)'), L('st3', 'quiet mode. shhhh.'),
  L('st4', 'book is upside down. fixed it!'), L('st5', 'headphones on. very serious.', 'pip'),
];
const DONE_SHORT = [L('ds1', 'a small study! still a study!'), L('ds2', 'done! quick like a bunny.')];
const DONE_MID = [
  L('dm1', 'we did it!! i read a whole page.'), L('dm2', 'high leaf!!', 'sprout'), L('dm3', 'high five! (high nub)', 'pip'),
  L('dm4', 'study done! u was so focused.'),
];
const DONE_LONG = [L('dl1', 'a BIG study! i read my book twice.'), L('dl2', 'so long! u is a study champion.')];
const DAY = [
  L('dy1', 'ALL DONE?! yaaaaay!'), L('dy2', 'the whole list! u did a magic.'),
  L('dy3', 'my flower popped!! look!', 'sprout'), L('dy4', 'my baloon is in the sky!!', 'pip'),
  L('dy5', 'happy dance! (i only know one)'), L('dy6', 'no more todos. u is the best.'),
];
const STREAK = [L('sk1', 'so many days in a row!!'), L('sk2', 'streak! streak! yay!')];
const WAVE = [L('wv1', 'hiii!'), L('wv2', 'hewwo!'), L('wv3', 'hi hi!'), L('wv4', 'wave wave!'), L('wv5', 'oh! hi!')];
const BYE = [L('by1', 'bye bye! knock for me ok?'), L('by2', 'going on a walk! knock knock!'), L('by3', 'byeee! (right behind the door)')];
const BACKIN = [L('bi1', 'who dat? oh it u!!'), L('bi2', 'coming coming coming!'), L('bi3', 'u knocked!! i came!'), L('bi4', 'ding dong! it me!')];
const IDEA = [L('id1', 'i had a thinky! ...it went away.'), L('id2', 'idea!! ...banana? no.'), L('id3', 'oh! i know! ...i forgot.')];
const SHH = [L('sh1', 'shhh. reading.'), L('sh2', 'shh, good page.'), L('sh3', 'shhh. (my book has a dragon)')];

/* ---------------------------------------------------------------- fussed over */

const TAP_ONE = [
  L('tp1', 'hehe!'), L('tp2', 'boop.'), L('tp3', 'that tickle!'), L('tp4', 'yes? hi?'), L('tp5', 'eep!'),
  L('tp6', 'u poked me! *poke back*'), L('tp7', 'hewwo?'), L('tp8', 'mlem.'),
];
const TAP_MANY = [L('tm1', 'hehe stoppp'), L('tm2', 'bwah!'), L('tm3', 'nyeh? again?'), L('tm4', 'boop boop boop')];
const TAP_DIZZY = [L('tz1', 'everyfing spinny...'), L('tz2', 'wobble. two of u now.'), L('tz3', 'blblblbl.'), L('tz4', 'where am i. oh. header.')];
const CARRY = [L('cy1', 'wheeee!'), L('cy2', 'up up up!'), L('cy3', 'whoa whoa whoa'), L('cy4', 'flyyyy!', 'sprout'), L('cy5', 'floaty floaty...', 'pip'), L('cy6', 'aaaa! fun!')];
const LAND = [L('ld1', 'landed! ta-da.'), L('ld2', 'again again!'), L('ld3', 'i flewed!', 'sprout'), L('ld4', 'thank u baloon!', 'pip'), L('ld5', 'whew.')];

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

/** the longest a bubble's words run before they are said in two */
export const BEAT_MAX = 34;

/**
 * A line as the bubbles it is said in, one after another: a bracketed aside comes as its own little bubble straight
 * after the words before it (without its brackets), and a stretch still too long for one small bubble splits at the end
 * of a sentence nearest its middle.
 */
export function beats(text: string): { text: string; aside: boolean }[] {
  const out: { text: string; aside: boolean }[] = [];
  const push = (t: string, aside: boolean) => {
    const v = t.replace(/\s+/g, ' ').trim();
    if (!v) return;
    if (aside || v.length <= BEAT_MAX) { out.push({ text: v, aside }); return; }
    // the sentence ends ('. ', '! ', '? ', '... ') that leave a fair piece on each side; the one nearest the middle
    let best = -1;
    const re = /[.!?…]+\s/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(v))) {
      const at = m.index + m[0].length;
      if (at >= 6 && v.length - at >= 6 && (best < 0 || Math.abs(at - v.length / 2) < Math.abs(best - v.length / 2))) best = at;
    }
    if (best < 0) { out.push({ text: v, aside }); return; }
    push(v.slice(0, best), false);
    push(v.slice(best), false);
  };
  let last = 0;
  const re = /\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    push(text.slice(last, m.index), false);
    push(m[1], true);
    last = m.index + m[0].length;
  }
  push(text.slice(last), false);
  return out;
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
  | 'hello' | 'idle' | 'tick' | 'start' | 'done' | 'day' | 'streak' | 'wave' | 'bye' | 'back' | 'idea' | 'shh'
  | 'tap' | 'taps' | 'dizzy' | 'carry' | 'land';

/** The pool for a moment, in this context. */
export function poolFor(m: Moment, ctx: Ctx, extra: { minutes?: number } = {}): Line[] {
  switch (m) {
    case 'hello': {
      if (ctx.first) return FIRST;
      const special = DAYS[ctx.date] ?? (DEEPAVALI[ctx.year] === ctx.date ? [L('dvl' + ctx.year, 'happy deepavali!! (quiet boom)')] : null);
      if (special) return special;
      if (ctx.away >= 2) return BACK;
      if ([7, 30, 60, 90, 120, 180, 365].includes(ctx.run)) return RUN;
      const h = ctx.hour;
      const time = h >= 5 && h < 12 ? HELLO_MORNING : h >= 12 && h < 17 ? HELLO_AFTERNOON : h >= 17 && h < 22 ? HELLO_EVENING : HELLO_LATE;
      return [...time, ...HELLO_ANY, ...(HELLO_WEEKDAY[ctx.weekday] ?? [])];
    }
    case 'idle': return [...idleFacts(ctx), ...idleOwn(ctx)];
    case 'tick': return TICK;
    case 'start': return START;
    case 'done': {
      const min = extra.minutes ?? 25;
      return min < 15 ? DONE_SHORT : min >= 50 ? DONE_LONG : DONE_MID;
    }
    case 'day': return DAY.filter((l) => (l.id !== 'dy3' || ctx.gear.includes('bloom')) && (l.id !== 'dy4' || ctx.gear.includes('balloon')));
    case 'streak': return STREAK;
    case 'wave': return WAVE;
    case 'bye': return BYE;
    case 'back': return BACKIN;
    case 'idea': return IDEA;
    case 'shh': return SHH;
    // a tap: about half the time, a word about the day (when there is one)
    case 'tap': { const f = idleFacts(ctx); return f.length && Math.random() < 0.5 ? f : TAP_ONE; }
    case 'taps': return TAP_MANY;
    case 'dizzy': return TAP_DIZZY;
    case 'carry': return CARRY;
    case 'land': return LAND;
  }
}

/** What is true today and worth a word: the list, an exam coming up, the focus so far. */
function idleFacts(ctx: Ctx): Line[] {
  const facts: Line[] = [];
  if (ctx.exam) {
    const d = ctx.exam.days;
    facts.push(...(d === 0 ? CTX_EXAM_TODAY : d === 1 ? CTX_EXAM_TOMORROW : d <= 6 ? CTX_EXAM_NEAR : d <= 21 ? CTX_EXAM_FAR : []));
  }
  if (ctx.due > 0) {
    if (ctx.left === 0) facts.push(...CTX_CLEAR);
    else if (ctx.left <= 2) facts.push(...CTX_FEW.filter((l) => l.id !== 'c5' || (!!ctx.next && ctx.left === 1)));
    else facts.push(...CTX_MANY.filter((l) => l.id !== 'c2' || !!ctx.next));
  }
  if (ctx.focusMin >= 120) facts.push(...CTX_FOCUS_BIG);
  else if (ctx.focusMin >= 30) facts.push(...CTX_FOCUS, ...(ctx.subject ? CTX_SUBJECT : []));
  return facts;
}

/** Its own musings, and a word about what it keeps. */
function idleOwn(ctx: Ctx): Line[] {
  const own = [...IDLE_ANY, ...(ctx.kind === 'sprout' ? IDLE_SPROUT : IDLE_PIP)];
  // it is proud of its things, so it talks about them a lot
  for (const g of ctx.gear) for (let k = 0; k < 3; k++) own.push(...(IDLE_GEAR[g] ?? []));
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
