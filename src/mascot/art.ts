// The companion's drawing: Sprout (a little plant with two leaves for hands) and Pip (a round, soft blob with nub arms),
// each made of parts on one 18 by 16 grid of squares, so a part can move on its own: the eyes and mouth change with
// what it feels, a leaf or an arm takes a pose (resting, out, raised, swung), the feet shuffle as it walks, a book comes
// out for Deep Work, and what it wears sits on top. Everything is symmetric about the grid's middle (between columns 8
// and 9), so the right side is the left one mirrored. Pure: the screen (src/components/Mascot.tsx) draws the squares.

export type Kind = 'sprout' | 'pip';
export const COLS = 18;
export const ROWS = 16;

/** One square: its column, its row, and its colour's letter in the palette. */
export type Cell = [number, number, string];

export type Eyes = 'open' | 'blink' | 'happy' | 'up' | 'left' | 'right' | 'read' | 'sleepy' | 'focus' | 'wide';
export type Mouth = 'none' | 'smile' | 'grin' | 'o' | 'flat';
/** a leaf's (Sprout) or an arm's (Pip) pose */
export type Limb = 'rest' | 'out' | 'up' | 'swing' | 'down';
export type Feet = 'stand' | 'step' | 'tuck';
export type Book = 'none' | 'open' | 'turn';

export interface Pose {
  eyes: Eyes;
  mouth: Mouth;
  /** the limb on the viewer's left, and on the right */
  l: Limb;
  r: Limb;
  feet: Feet;
  book: Book;
  blush: boolean;
  /** Pip's headphones are on (only with the headphones among its gear) */
  phones: boolean;
}

export const REST: Pose = { eyes: 'open', mouth: 'none', l: 'rest', r: 'rest', feet: 'stand', book: 'none', blush: false, phones: false };

const mirror = (cells: Cell[]): Cell[] => cells.map(([c, r, k]) => [COLS - 1 - c, r, k]);
const row = (r: number, from: number, to: number, k: string): Cell[] => {
  const out: Cell[] = [];
  for (let c = from; c <= to; c++) out.push([c, r, k]);
  return out;
};

/* ---------------------------------------------------------------- bodies */

const SPROUT_BODY: Cell[] = [
  ...row(8, 5, 12, 'b'),
  [4, 9, 'b'], [5, 9, 'h'], [6, 9, 'h'], ...row(9, 7, 13, 'b'),
  [4, 10, 'b'], [5, 10, 'h'], ...row(10, 6, 12, 'b'), [13, 10, 's'],
  ...row(11, 4, 12, 'b'), [13, 11, 's'],
  ...row(12, 4, 12, 'b'), [13, 12, 's'],
  ...row(13, 4, 12, 'b'), [13, 13, 's'],
  ...row(14, 5, 12, 's'),
  // the stem, two squares wide, between the leaves
  [8, 6, 'g'], [9, 6, 'g'], [8, 7, 'g'], [9, 7, 'g'],
];

const PIP_BODY: Cell[] = [
  ...row(7, 6, 11, 'b'),
  [4, 8, 'b'], [5, 8, 'h'], [6, 8, 'h'], ...row(8, 7, 13, 'b'),
  [3, 9, 'b'], [4, 9, 'h'], ...row(9, 5, 13, 'b'), [14, 9, 's'],
  ...row(10, 3, 13, 'b'), [14, 10, 's'],
  ...row(11, 2, 14, 'b'), [15, 11, 's'],
  ...row(12, 2, 14, 'b'), [15, 12, 's'],
  ...row(13, 3, 13, 'b'), [14, 13, 's'],
  ...row(14, 4, 13, 's'),
];

const FEET: Record<Feet, Cell[]> = {
  stand: [[5, 15, 's'], [6, 15, 's'], [11, 15, 's'], [12, 15, 's']],
  // mid-step: the feet come in under the body
  step: [[6, 15, 's'], [7, 15, 's'], [10, 15, 's'], [11, 15, 's']],
  // lifted (carried, or in the air): nothing touches
  tuck: [[6, 14, 's'], [11, 14, 's']],
};

/* ---------------------------------------------------------------- limbs (the left one; the right is mirrored) */

/** Sprout's left leaf: 'l' leaf, 'L' its shaded underside */
const LEAF: Record<Limb, Cell[]> = {
  rest: [[4, 4, 'l'], [5, 4, 'l'], [6, 4, 'l'], [5, 5, 'L'], [6, 5, 'l'], [7, 5, 'l']],
  out: [[2, 5, 'l'], [3, 5, 'l'], [4, 5, 'l'], [5, 5, 'l'], [6, 5, 'l'], [7, 5, 'l'], [3, 6, 'L'], [4, 6, 'L'], [5, 6, 'L']],
  up: [[6, 1, 'l'], [5, 2, 'l'], [6, 2, 'l'], [7, 2, 'l'], [5, 3, 'l'], [6, 3, 'L'], [7, 3, 'l'], [6, 4, 'l'], [7, 4, 'L'], [7, 5, 'l']],
  // raised and swung outward: a wave goes up, swing, up, swing
  swing: [[3, 1, 'l'], [4, 1, 'l'], [3, 2, 'l'], [4, 2, 'L'], [5, 2, 'l'], [4, 3, 'l'], [5, 3, 'L'], [6, 3, 'l'], [6, 4, 'l'], [7, 4, 'l'], [7, 5, 'l']],
  down: [[5, 6, 'l'], [6, 6, 'l'], [7, 6, 'l'], [3, 7, 'L'], [4, 7, 'L'], [5, 7, 'l']],
};

/** Pip's left arm, a little nub */
const ARM: Record<Limb, Cell[]> = {
  rest: [[1, 12, 'b'], [1, 13, 's']],
  out: [[0, 11, 'b'], [1, 11, 'b'], [1, 12, 's']],
  up: [[1, 8, 'b'], [1, 9, 'b'], [1, 10, 'b'], [2, 10, 's']],
  swing: [[0, 8, 'b'], [0, 9, 'b'], [1, 9, 's'], [1, 10, 'b']],
  down: [[2, 13, 'b'], [2, 14, 's']],
};

/* ---------------------------------------------------------------- the face (the same place on both) */

const EYES: Record<Eyes, Cell[]> = {
  open: [[6, 10, 'd'], [6, 11, 'd'], [11, 10, 'd'], [11, 11, 'd']],
  blink: [[6, 11, 'd'], [11, 11, 'd']],
  // pleased: each eye a little arch
  happy: [[5, 11, 'd'], [6, 10, 'd'], [7, 11, 'd'], [10, 11, 'd'], [11, 10, 'd'], [12, 11, 'd']],
  up: [[6, 9, 'd'], [6, 10, 'd'], [11, 9, 'd'], [11, 10, 'd']],
  left: [[5, 10, 'd'], [5, 11, 'd'], [10, 10, 'd'], [10, 11, 'd']],
  right: [[7, 10, 'd'], [7, 11, 'd'], [12, 10, 'd'], [12, 11, 'd']],
  // looking down at a page
  read: [[6, 10, 'd'], [11, 10, 'd']],
  sleepy: [[5, 11, 'd'], [6, 11, 'd'], [11, 11, 'd'], [12, 11, 'd']],
  // open, with brows set: concentrating
  focus: [[6, 10, 'd'], [6, 11, 'd'], [11, 10, 'd'], [11, 11, 'd'], [5, 9, 'd'], [6, 9, 'd'], [11, 9, 'd'], [12, 9, 'd']],
  wide: [[6, 9, 'd'], [6, 10, 'd'], [6, 11, 'd'], [11, 9, 'd'], [11, 10, 'd'], [11, 11, 'd']],
};

const MOUTH: Record<Mouth, Cell[]> = {
  none: [],
  smile: [[7, 12, 'd'], [10, 12, 'd'], [8, 13, 'd'], [9, 13, 'd']],
  grin: [[7, 12, 'd'], [8, 12, 'd'], [9, 12, 'd'], [10, 12, 'd'], [8, 13, 'm'], [9, 13, 'm']],
  o: [[8, 12, 'd'], [9, 12, 'd'], [8, 13, 'd'], [9, 13, 'd']],
  flat: [[8, 13, 'd'], [9, 13, 'd']],
};

const CHEEKS: Cell[] = [[5, 12, 'p'], [12, 12, 'p']];
const BLUSH: Cell[] = [[4, 12, 'p'], [5, 12, 'p'], [12, 12, 'p'], [13, 12, 'p']];

/** an open book held up in front, its pages ('K'), their shade ('q') and cover ('k') */
const BOOK: Record<Book, Cell[]> = {
  none: [],
  // a small open book held up under the eyes: two white pages with a line of print on each and the gutter between
  // them, the blue cover's edge below
  open: [
    [5, 11, 'K'], [6, 11, 'K'], [7, 11, 'K'], [8, 11, 'q'], [9, 11, 'q'], [10, 11, 'K'], [11, 11, 'K'], [12, 11, 'K'],
    [4, 12, 'K'], [5, 12, 'n'], [6, 12, 'n'], [7, 12, 'K'], [8, 12, 'q'], [9, 12, 'q'], [10, 12, 'K'], [11, 12, 'n'], [12, 12, 'n'], [13, 12, 'K'],
    ...row(13, 4, 13, 'k'),
  ],
  // the right page lifting as it turns, its shadow on the page under it
  turn: [
    [5, 11, 'K'], [6, 11, 'K'], [7, 11, 'K'], [8, 11, 'q'], [9, 11, 'q'], [10, 11, 'q'], [11, 11, 'q'],
    [10, 10, 'K'], [11, 10, 'K'], [12, 10, 'K'],
    [4, 12, 'K'], [5, 12, 'n'], [6, 12, 'n'], [7, 12, 'K'], [8, 12, 'q'], [9, 12, 'q'], [10, 12, 'K'], [11, 12, 'K'], [12, 12, 'K'], [13, 12, 'K'],
    ...row(13, 4, 13, 'k'),
  ],
};

/* ---------------------------------------------------------------- gear */

export interface Gear { key: string; name: string; line: string; for: Kind[] }

/**
 * What it can wear or keep with it. Each one does something: the ladybug lives its own little life around Sprout, the
 * firefly glows only after dark, the bud opens as the day's ToDos get done, the glasses come on to read, the
 * headphones go on for Deep Work, the balloon bobs about and shows how the day is going.
 */
export const GEAR: Gear[] = [
  { key: 'ladybug', name: 'Ladybug', line: 'Dot flits about and lands on a leaf now and then', for: ['sprout'] },
  { key: 'firefly', name: 'Firefly', line: 'A soft light that keeps it company after dark', for: ['sprout'] },
  { key: 'bloom', name: 'Bud', line: "Opens, petal by petal, as today's ToDos get done", for: ['sprout'] },
  { key: 'glasses', name: 'Reading glasses', line: 'Pushed up to think, worn to read', for: ['sprout', 'pip'] },
  { key: 'bow', name: 'Bow', line: 'A ribbon bow, in a shade that suits it', for: ['pip'] },
  { key: 'phones', name: 'Headphones', line: 'On for Deep Work, and for humming along', for: ['pip'] },
  { key: 'balloon', name: 'Balloon', line: 'Floats higher as the day gets done', for: ['pip'] },
];
export const gearFor = (kind: Kind) => GEAR.filter((g) => g.for.includes(kind));
/** the ladybug and the firefly are each a friend that flies about: one at a time */
export const FLIERS = ['ladybug', 'firefly'];

/**
 * Reading glasses, half-rimmed: a brow bar over each eye and the frame's sides, the lens a pale tint with a glint in
 * its upper corner, so the eye (drawn after, in the middle of the lens) sits inside the glass instead of filling it.
 * The two frames meet over the nose.
 */
const LENS_LEFT: Cell[] = [
  [5, 9, 'G'], [6, 9, 'G'], [7, 9, 'G'], [4, 10, 'G'], [8, 10, 'G'], [4, 11, 'G'],
  [5, 10, 'W'], [7, 10, 'T'], [5, 11, 'T'], [7, 11, 'T'],
];
const GLASSES: Cell[] = [...LENS_LEFT, ...LENS_LEFT.map(([c, r, k]): Cell => [COLS - 1 - c, r, k === 'W' ? 'T' : k]), [10, 10, 'W'], [12, 10, 'T']];

const BOW: Cell[] = [
  [9, 4, 'a'], [10, 4, 'a'], [12, 4, 'a'], [13, 4, 'a'],
  [9, 5, 'a'], [10, 5, 'A'], [11, 5, 'A'], [12, 5, 'A'], [13, 5, 'a'],
  [10, 6, 'a'], [12, 6, 'a'],
];

const PHONES: Cell[] = [
  ...row(5, 5, 12, 'H'), [4, 6, 'H'], [13, 6, 'H'], [3, 7, 'H'], [14, 7, 'H'],
  [1, 9, 'H'], [2, 9, 'a'], [1, 10, 'H'], [2, 10, 'a'],
  [16, 9, 'H'], [15, 9, 'a'], [16, 10, 'H'], [15, 10, 'a'],
];

/** the bud on Sprout's stem, in four stages: closed, a pink tip, opening, open */
export function budCells(stage: number): Cell[] {
  const stem: Cell[] = [[8, 5, 'g'], [9, 5, 'g']];
  if (stage <= 0) return [...stem, [8, 4, 'u'], [9, 4, 'u']];
  if (stage === 1) return [...stem, [8, 4, 'u'], [9, 4, 'u'], [8, 3, 'P'], [9, 3, 'P']];
  if (stage === 2) return [...stem, [8, 4, 'u'], [9, 4, 'u'], [8, 3, 'Y'], [9, 3, 'Y'], [7, 3, 'P'], [10, 3, 'P'], [8, 2, 'P'], [9, 2, 'P']];
  return [
    ...stem, [8, 4, 'P'], [9, 4, 'P'], [8, 3, 'Y'], [9, 3, 'Y'], [8, 2, 'Y'], [9, 2, 'Y'],
    [7, 2, 'P'], [10, 2, 'P'], [7, 3, 'P'], [10, 3, 'P'], [8, 1, 'P'], [9, 1, 'P'],
  ];
}

/* ---------------------------------------------------------------- colours */

export type Palette = Record<string, string>;
export interface ColorSet { key: string; name: string; pal: Palette }

const FIXED: Palette = {
  // the book, the glasses, the headphones' band, the bud
  K: '#FFF8EE', q: '#D8CDBD', n: '#A9A3B8', k: '#4F7FD1', G: '#8A6A50', H: '#3B3550', u: '#A8D86E', P: '#FF8FB1', Y: '#FFC86B',
  // a lens: a cool tint over the face, and its glint
  T: 'rgba(235,246,255,0.34)', W: '#FFFFFF',
};

const sproutSet = (key: string, name: string, b: string, s: string, h: string, l: string, L: string, extra: Palette = {}): ColorSet => ({
  key, name, pal: { ...FIXED, b, s, h, l, L, g: L, d: '#14302A', p: '#FF9BB8', m: '#E2557A', a: '#FF8FB1', A: '#E5617F', ...extra },
});
const pipSet = (key: string, name: string, b: string, s: string, h: string, a: string, A: string, extra: Palette = {}): ColorSet => ({
  key, name, pal: { ...FIXED, b, s, h, d: '#2A1820', p: '#FF6F96', m: '#E2557A', a, A, ...extra },
});

export const COLOR_SETS: Record<Kind, ColorSet[]> = {
  sprout: [
    sproutSet('mint', 'Mint', '#7EE0C3', '#58BFA2', '#B6F2E0', '#9CDB6E', '#6FB84A'),
    sproutSet('fern', 'Fern', '#6CC48A', '#4E9F69', '#A6E3B8', '#C4E86B', '#8DB83C'),
    sproutSet('peach', 'Peach', '#FFB38A', '#E58E66', '#FFD6BF', '#8FD16A', '#5FA544', { d: '#3A1F14' }),
    sproutSet('lilac', 'Lilac', '#B9A6F5', '#9580D9', '#DCD2FF', '#8ED6A0', '#5DAE74', { d: '#231A3D' }),
    sproutSet('sky', 'Sky', '#8CC8FF', '#62A3E0', '#C4E3FF', '#A8E07A', '#74B54C', { d: '#14243A' }),
    sproutSet('sakura', 'Sakura', '#FFC2D4', '#EE9CB4', '#FFE1EA', '#8FD18A', '#5DA95A', { d: '#3A1A24', p: '#FF7FA3' }),
    // dark, with light eyes and glowing teal leaves: lovely after dark
    sproutSet('midnight', 'Midnight', '#3D4A7A', '#2B3560', '#5E6EA8', '#7EE0C3', '#4FB394', { d: '#F7F4EE', p: '#FF8FB1' }),
  ],
  pip: [
    pipSet('blush', 'Blush', '#FF9BB8', '#E57898', '#FFC5D6', '#8CC8FF', '#5E9FE0'),
    pipSet('lemon', 'Lemon', '#FFD76B', '#E8B848', '#FFEAA8', '#FF8FB1', '#E5617F', { p: '#FF9B7A' }),
    pipSet('lavender', 'Lavender', '#B9A6F5', '#9580D9', '#DCD2FF', '#FFC86B', '#E8A93E', { d: '#231A3D' }),
    pipSet('mint', 'Mint', '#7EE0C3', '#58BFA2', '#B6F2E0', '#FF8FB1', '#E5617F', { d: '#14302A' }),
    pipSet('coral', 'Coral', '#FF8F75', '#E06D55', '#FFC0B0', '#7EE0C3', '#4FB394', { p: '#FF5F7E' }),
    pipSet('cocoa', 'Cocoa', '#B58A6A', '#926A4E', '#D4B091', '#FFC86B', '#E8A93E', { d: '#1D1712', p: '#F08A9A' }),
    pipSet('cloud', 'Cloud', '#EDEBF5', '#C9C5DA', '#FFFFFF', '#B9A6F5', '#9580D9', { d: '#2A2440' }),
  ],
};

export const colorSet = (kind: Kind, key: string): ColorSet =>
  COLOR_SETS[kind].find((c) => c.key === key) ?? COLOR_SETS[kind][0];

export const NAMES: Record<Kind, string> = { sprout: 'Sprout', pip: 'Pip' };

/* ---------------------------------------------------------------- putting it together */

/**
 * Every square of the companion in this pose, back to front: limbs behind the body for Pip's raised arms, the body,
 * the face, the book, then what it wears. Later squares cover earlier ones.
 */
export function compose(kind: Kind, pose: Pose, gear: string[], bud: number): Cell[] {
  const has = (k: string) => gear.includes(k);
  const limbs = kind === 'sprout' ? LEAF : ARM;
  const out: Cell[] = [];
  if (kind === 'sprout' && has('bloom')) out.push(...budCells(bud));
  out.push(...(kind === 'sprout' ? SPROUT_BODY : PIP_BODY));
  out.push(...FEET[pose.feet]);
  out.push(...(pose.blush ? BLUSH : CHEEKS));
  if (has('glasses')) out.push(...GLASSES);
  out.push(...EYES[pose.eyes]);
  if (pose.book === 'none') out.push(...MOUTH[pose.mouth]);
  if (kind === 'pip' && has('bow')) out.push(...BOW);
  if (kind === 'pip' && has('phones') && pose.phones) out.push(...PHONES);
  out.push(...BOOK[pose.book]);
  // leaves are drawn last (they are in front of the stem and the bud); a book is held by them, so they rest on it
  out.push(...limbs[pose.l], ...mirror(limbs[pose.r]));
  return out;
}

/** The squares as runs: one rectangle for each stretch of a colour along a row, the later square winning. */
export function runs(cells: Cell[], pal: Palette, cols = COLS, rows = ROWS): { x: number; y: number; w: number; fill: string }[] {
  const grid = new Map<number, string>();
  for (const [c, r, k] of cells) if (c >= 0 && c < cols && r >= 0 && r < rows) grid.set(r * cols + c, pal[k] ?? pal.b);
  const out: { x: number; y: number; w: number; fill: string }[] = [];
  for (let r = 0; r < rows; r++) {
    let c = 0;
    while (c < cols) {
      const fill = grid.get(r * cols + c);
      if (!fill) { c++; continue; }
      let e = c + 1;
      while (e < cols && grid.get(r * cols + e) === fill) e++;
      out.push({ x: c, y: r, w: e - c, fill });
      c = e;
    }
  }
  return out;
}

/* ---------------------------------------------------------------- small props (each its own little grid) */

export interface Prop { grid: string[]; pal: Palette }

export const PROPS = {
  ladybug: { grid: ['.rrr', 'krkr', '.rrr'], pal: { r: '#E5484D', k: '#1E1414' } },
  bulb: { grid: ['.yyy.', 'yywyy', 'yyyyy', '.yyy.', '..g..', '.ggg.'], pal: { y: '#FFD86B', w: '#FFF6D0', g: '#A3A09A' } },
  zed: { grid: ['zzzz', '..z.', '.z..', 'zzzz'], pal: { z: '#B9B4D6' } },
  note: { grid: ['..nn', '..n.', '..n.', 'nnn.', 'nn..'], pal: { n: '#B9A6F5' } },
  heart: { grid: ['.h.h.', 'hhhhh', 'hhhhh', '.hhh.', '..h..'], pal: { h: '#FF8FB1' } },
  cloud: { grid: ['..ww..', '.wwwww', 'wwwwwww', '.wwwww.'], pal: { w: '#DCE7F2' } },
  drop: { grid: ['d', 'd'], pal: { d: '#8CC8FF' } },
  // Pip's umbrella, out of nowhere, for floating down when it is carried and let go
  umbrella: {
    grid: ['..aaAaa..', '.aaaAaaa.', 'aaaaAaaaa', 'a.a.h.a.a', '....h....', '....h....', '....h....', '...hh....'],
    pal: { h: '#5B463A' } as Palette,
  },
  balloon: { grid: ['.aaa.', 'ahaaa', 'aaaaa', 'aaaaa', '.aaa.', '..A..'], pal: {} as Palette },
} satisfies Record<string, Prop>;

/** A door, as it stands at the edge of the screen: closed, ajar, open (dark inside, the door folded to its hinge). */
export const DOOR: Record<'closed' | 'ajar' | 'open', string[]> = {
  closed: [
    '..ffffff..', '.fPPPPPPf.', 'fPPPPPPPPf', 'fPQQPPQQPf', 'fPQQPPQQPf', 'fPPPPPPPPf', 'fPPPPPPPPf',
    'fPPPPPPkPf', 'fPPPPPPPPf', 'fPQQPPQQPf', 'fPQQPPQQPf', 'fPPPPPPPPf', 'fPPPPPPPPf', 'ffffffffff',
  ],
  ajar: [
    '..ffffff..', '.fPPPoooe.', 'fPPPooooof', 'fPQPooooof', 'fPQPooooof', 'fPPPooooof', 'fPPPooooof',
    'fPPkooooof', 'fPPPooooof', 'fPQPooooof', 'fPQPooooof', 'fPPPooooof', 'fPPPOOOOOf', 'ffffffffff',
  ],
  open: [
    '..ffffff..', '.fPooooof.', 'fPPoooooof', 'fPPoooooof', 'fPPoooooof', 'fPPoooooof', 'fPPoooooof',
    'fPPoooooof', 'fPPoooooof', 'fPPoooooof', 'fPPoooooof', 'fPPoooooof', 'fPPOOOOOOf', 'ffffffffff',
  ],
};
export const DOOR_PAL: Palette = { f: '#A86F45', P: '#D9A273', Q: '#C48C5E', k: '#FFD27A', o: '#2B211C', O: '#5A4128', e: '#2B211C' };
