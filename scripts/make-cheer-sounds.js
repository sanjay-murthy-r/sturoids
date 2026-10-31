// Makes Cheerful's sounds (assets/sounds/cheer-*.wav), the ones picked in the Sift and sound study: short, musical,
// made here from first principles so nothing is licensed or downloaded. Plucked strings are Karplus-Strong; bells,
// kalimba, marimba and celesta are struck partials with their own decays; a soft room is a small Schroeder reverb.
// The random parts are seeded, so the files come out the same every run. Usage: node scripts/make-cheer-sounds.js

const fs = require('fs');
const path = require('path');

const RATE = 44100;
let seed = 7;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const N = (n) => 440 * Math.pow(2, (n - 69) / 12);

function track(seconds) { return new Float32Array(Math.ceil(seconds * RATE)); }

/** a plucked string (Karplus-Strong) added at time t */
function pluck(out, t, f, dur, { bright = 0.55, damp = 0.996, vol = 0.5 } = {}) {
  const p = Math.max(2, Math.round(RATE / f));
  const buf = new Float32Array(p);
  let lp = 0;
  for (let i = 0; i < p; i++) { lp += (rnd() * 2 - 1 - lp) * bright; buf[i] = lp; }
  const start = Math.floor(t * RATE);
  const n = Math.floor(dur * RATE);
  let ix = 0;
  for (let i = 0; i < n && start + i < out.length; i++) {
    const a = buf[ix];
    const c = buf[(ix + 1) % p];
    buf[ix] = damp * 0.5 * (a + c);
    const fade = i > n - 600 ? (n - i) / 600 : 1;
    out[start + i] += a * vol * fade;
    ix = (ix + 1) % p;
  }
}

/** a struck tone from partials [ratio, amplitude, decay share]: reaches -60 dB at its decay */
function tone(out, t, f, { parts = [[1, 1, 1]], att = 0.004, dec = 1, vol = 0.3, glideTo = null, glideMs = 60 } = {}) {
  const start = Math.floor(t * RATE);
  for (const [ratio, amp, k] of parts) {
    const d = dec * (k || 1);
    const n = Math.floor((att + d) * RATE);
    let ph = 0;
    for (let i = 0; i < n && start + i < out.length; i++) {
      const s = i / RATE;
      let fr = f * ratio;
      if (glideTo) fr = f * ratio * Math.pow(glideTo / f, Math.min(1, s / (glideMs / 1000)));
      ph += (2 * Math.PI * fr) / RATE;
      const env = s < att ? s / att : Math.exp((-6.9 * (s - att)) / d);
      out[start + i] += Math.sin(ph) * vol * amp * env;
    }
  }
}

/** band-passed noise (RBJ biquad), for a wood click */
function noise(out, t, dur, { freq = 1800, q = 2, vol = 0.25 } = {}) {
  const w = (2 * Math.PI * freq) / RATE;
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0; const b2 = -alpha / a0; const a1 = (-2 * Math.cos(w)) / a0; const a2 = (1 - alpha) / a0;
  let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
  const start = Math.floor(t * RATE);
  const n = Math.floor(dur * RATE);
  for (let i = 0; i < n && start + i < out.length; i++) {
    const s = i / RATE;
    const x = rnd() * 2 - 1;
    const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    const env = s < 0.004 ? s / 0.004 : Math.exp((-6.9 * s) / dur);
    out[start + i] += y * vol * env;
  }
}

/** a warm pad: detuned triangles through a lowpass that opens and closes */
function pad(out, t, notes, { dur = 2, vol = 0.08, att = 0.14 } = {}) {
  const start = Math.floor(t * RATE);
  const n = Math.floor(dur * RATE);
  for (const nn of notes) {
    for (const cents of [-6, 6]) {
      const f = N(nn) * Math.pow(2, cents / 1200);
      let ph = 0; let lp = 0;
      for (let i = 0; i < n && start + i < out.length; i++) {
        const s = i / RATE;
        ph = (ph + f / RATE) % 1;
        const tri = 4 * Math.abs(ph - 0.5) - 1;
        const cut = s < att + 0.2 ? 900 + 1500 * (s / (att + 0.2)) : 2400 * Math.exp((-1.2 * (s - att - 0.2)) / dur) + 600;
        lp += (tri - lp) * (1 - Math.exp((-2 * Math.PI * cut) / RATE));
        const env = s < att ? s / att : Math.exp((-6.9 * (s - att)) / (dur - att));
        out[start + i] += lp * vol * env;
      }
    }
  }
}

/** a small room: four combs into two allpasses, mixed in */
function room(dry, wet = 0.2) {
  const combs = [1116, 1188, 1277, 1356].map((l) => ({ b: new Float32Array(l), i: 0, f: 0.78, lp: 0 }));
  const aps = [556, 441].map((l) => ({ b: new Float32Array(l), i: 0 }));
  const out = new Float32Array(dry.length);
  for (let n = 0; n < dry.length; n++) {
    const x = dry[n] * 0.18;
    let s = 0;
    for (const c of combs) {
      const y = c.b[c.i];
      c.lp = y * 0.6 + c.lp * 0.4;
      c.b[c.i] = x + c.lp * c.f;
      c.i = (c.i + 1) % c.b.length;
      s += y;
    }
    for (const a of aps) {
      const y = a.b[a.i];
      const v = s + y * 0.5;
      a.b[a.i] = v;
      a.i = (a.i + 1) % a.b.length;
      s = y - v * 0.5;
    }
    out[n] = dry[n] + s * wet;
  }
  return out;
}

const MARIMBA = [[1, 1, 1], [3.99, 0.22, 0.18], [9.9, 0.05, 0.06]];
const KALIMBA = [[1, 1, 1], [5.4, 0.12, 0.12], [2, 0.12, 0.35]];
const CELESTA = [[1, 1, 1], [2, 0.3, 0.5], [4.01, 0.12, 0.3]];
const BELL = [[1, 1, 1], [2.01, 0.45, 0.6], [2.76, 0.32, 0.45], [5.4, 0.16, 0.25], [8.93, 0.08, 0.14]];
const GLASS = [[1, 1, 1], [2.32, 0.3, 0.6], [4.25, 0.12, 0.35]];

const SOUNDS = {
  // ticking something off: a small glass tap
  tick: { secs: 0.7, peak: -9, wet: 0.16, make: (o) => tone(o, 0.005, N(91), { parts: GLASS, dec: 0.35, vol: 0.18 }) },
  // adding something: a wood click with a breath of marimba under it
  add: { secs: 0.4, peak: -10, wet: 0.08, make: (o) => { noise(o, 0.002, 0.035, { freq: 2100, q: 6, vol: 0.32 }); tone(o, 0.002, N(72), { parts: MARIMBA, dec: 0.08, vol: 0.08 }); } },
  // a Deep Work session starts: two kalimba notes, a fifth apart
  start: { secs: 1.8, peak: -6, wet: 0.2, make: (o) => { tone(o, 0.005, N(74), { parts: KALIMBA, dec: 0.9, vol: 0.24 }); tone(o, 0.165, N(81), { parts: KALIMBA, dec: 1.1, vol: 0.22 }); } },
  // a session done: the kalimba tune, and as its last note rings, a warm chord opens under it and carries it home.
  // The tune is in G (D G B D B); the chord is G with its ninth, so the final B sits in it as its third
  done: {
    secs: 3.4, peak: -4, wet: 0.24,
    make: (o) => {
      [74, 79, 83, 86, 83].forEach((n, i) => tone(o, 0.005 + i * 0.13, N(n), { parts: KALIMBA, dec: 0.9, vol: 0.2 }));
      // the last note lands at 0.525 s; the chord swells in a breath after, as that note rings
      pad(o, 0.62, [55, 62, 67, 71, 74], { dur: 2.6, vol: 0.05, att: 0.22 });
      tone(o, 0.66, N(79), { parts: CELESTA, dec: 1.6, vol: 0.07, att: 0.02 });
    },
  },
  // every ToDo for today done: two light ukulele strums and a ringing third
  day: {
    secs: 2.8, peak: -4, wet: 0.2,
    make: (o) => {
      [[67, 60, 64, 69], [67, 60, 64, 69]].forEach((ch, j) => ch.forEach((n, i) => pluck(o, 0.005 + j * 0.24 + i * 0.018, N(n), 1.6, { bright: 0.6, vol: 0.28 })));
      [67, 72, 76, 79].forEach((n, i) => pluck(o, 0.565 + i * 0.022, N(n), 2.2, { bright: 0.6, vol: 0.28 }));
    },
  },
  // a streak milestone: a bell with a little shimmer over it
  streak: {
    secs: 2.2, peak: -6, wet: 0.24,
    make: (o) => { tone(o, 0.005, N(84), { parts: BELL, dec: 1.6, vol: 0.14 }); [96, 100, 103].forEach((n, i) => tone(o, 0.085 + i * 0.05, N(n), { dec: 0.4, vol: 0.04 })); },
  },
  // switching to Cheerful: a light celesta run up
  makeover: {
    secs: 1.6, peak: -6, wet: 0.24,
    make: (o) => [72, 76, 79, 83, 84, 88, 91, 95, 96].forEach((n, i) => tone(o, 0.005 + i * 0.045, N(n), { parts: CELESTA, dec: 0.7, vol: 0.07 + i * 0.004 })),
  },
};

const dir = path.join(__dirname, '..', 'assets', 'sounds');
fs.mkdirSync(dir, { recursive: true });
for (const [name, s] of Object.entries(SOUNDS)) {
  seed = 7;
  const dry = track(s.secs);
  s.make(dry);
  const wave = room(dry, s.wet);
  // a short fade at the very end, so nothing clicks off
  const tail = Math.floor(0.03 * RATE);
  for (let i = 0; i < tail; i++) wave[wave.length - 1 - i] *= i / tail;
  let peak = 0;
  for (const v of wave) peak = Math.max(peak, Math.abs(v));
  const scale = (Math.pow(10, s.peak / 20) / (peak || 1)) * 32767;
  const data = Buffer.alloc(wave.length * 2);
  for (let i = 0; i < wave.length; i++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(wave[i] * scale))), i * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  const out = path.join(dir, 'cheer-' + name + '.wav');
  fs.writeFileSync(out, Buffer.concat([header, data]));
  console.log('wrote ' + path.relative(process.cwd(), out) + ' (' + Math.round((44 + data.length) / 1024) + ' KB)');
}
