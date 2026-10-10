#!/usr/bin/env node
/*
 * Writes assets/sounds/chime.wav: the soft chime at the end of a Deep Work block, played by the app (src/chime.ts) and
 * by the notification channel when the app is away. Synthesised, so it is the app's own sound and can be made again.
 *   - 1.4 s, 44.1 kHz, mono, 16-bit PCM
 *   - two sine partials, 880 Hz and 1320 Hz (a fifth above), the upper one quieter and shorter, like a struck bell
 *   - a gentle attack (25 ms), an exponential decay, and a short fade at the very end so it never clicks
 *   - quiet: the peak sits at about -12 dBFS
 * Usage: node scripts/make-chime.js
 */
const fs = require('fs');
const path = require('path');

const RATE = 44100;
const SECONDS = 1.4;
const PEAK_DBFS = -12;
const ATTACK_S = 0.025;
const FADE_S = 0.06;
const PARTIALS = [
  // frequency, relative level, decay time constant in seconds
  { hz: 880, level: 1, tau: 0.42 },
  { hz: 1320, level: 0.42, tau: 0.24 },
];

const n = Math.round(RATE * SECONDS);
const wave = new Float64Array(n);
let peak = 0;
for (let i = 0; i < n; i++) {
  const t = i / RATE;
  // a raised-cosine attack, so the start is soft rather than a tap
  const attack = t < ATTACK_S ? 0.5 - 0.5 * Math.cos((Math.PI * t) / ATTACK_S) : 1;
  const left = SECONDS - t;
  const fade = left < FADE_S ? 0.5 - 0.5 * Math.cos((Math.PI * left) / FADE_S) : 1;
  let v = 0;
  for (const p of PARTIALS) v += p.level * Math.exp(-t / p.tau) * Math.sin(2 * Math.PI * p.hz * t);
  wave[i] = v * attack * fade;
  peak = Math.max(peak, Math.abs(wave[i]));
}

const target = Math.pow(10, PEAK_DBFS / 20);
const scale = (target / peak) * 32767;
const data = Buffer.alloc(n * 2);
for (let i = 0; i < n; i++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(wave[i] * scale))), i * 2);

const header = Buffer.alloc(44);
header.write('RIFF', 0, 'ascii');
header.writeUInt32LE(36 + data.length, 4);
header.write('WAVE', 8, 'ascii');
header.write('fmt ', 12, 'ascii');
header.writeUInt32LE(16, 16); // PCM format chunk size
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 2, 28); // bytes per second
header.writeUInt16LE(2, 32); // bytes per frame
header.writeUInt16LE(16, 34); // bits per sample
header.write('data', 36, 'ascii');
header.writeUInt32LE(data.length, 40);

const out = path.join(__dirname, '..', 'assets', 'sounds', 'chime.wav');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([header, data]));
console.log('wrote ' + path.relative(process.cwd(), out) + ' (' + (44 + data.length) + ' bytes, ' + SECONDS + ' s, peak ' + PEAK_DBFS + ' dBFS)');
