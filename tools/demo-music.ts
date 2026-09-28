/**
 * The showcase reel's score, synthesised from nothing (no samples, so nothing
 * to license): đàn tranh plucks and a sáo line over taiko, bass and pads, in
 * D minor pentatonic at 120 bpm, cut to the reel's own beats:
 *
 *   0-6.5 s    the menu and the village: a drone, the tranh picking alone
 *   6.5-15.7   the ambush: taiko and bass come in; the Heaven Pierce (13.1) lands on a boom
 *   15.7-25.9  over the bridge: a breath (the sáo sings), then a drum roll into the tiger lord's roar
 *   25.9-41.2  the duel: everything, faster and higher, a riser into the lotus tempest
 *   41.2-44.5  the tempest, the lotus (43.1) on a gong, and a major chord to end
 *
 *   node tools/run.mjs tools/demo-music.ts <out.wav> [cue=seconds ...]
 *
 * Cues (seconds of the reel) move the moments: intro, fight, pierce, bridge, lord, duel, tempest, lotus, end.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const out = process.argv[2];
const CUE: Record<string, number> = { intro: 0.5, fight: 6.5, pierce: 13.1, bridge: 15.7, lord: 25.95, duel: 26.5, tempest: 41.2, lotus: 43.1, end: 44.5 };
for (const a of process.argv.slice(3)) {
  const [k, v] = a.split("=");
  CUE[k] = Number(v);
}
const SR = 48000;
const N = Math.ceil((CUE.end + 0.5) * SR);
const L = new Float32Array(N);
const R = new Float32Array(N);
const BEAT = 0.5;

// a reproducible noise
let seed = 7;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const noise = () => rnd() * 2 - 1;

/** Lay `f(t)` (a mono voice, t in seconds from its start) into the mix from `at` for `dur` s, at `gain`, panned (-1..1). */
const voice = (at: number, dur: number, gain: number, pan: number, f: (t: number) => number) => {
  const i0 = Math.round(at * SR);
  const n = Math.round(dur * SR);
  const gl = gain * Math.cos(((pan + 1) * Math.PI) / 4);
  const gr = gain * Math.sin(((pan + 1) * Math.PI) / 4);
  for (let i = 0; i < n; i++) {
    const j = i0 + i;
    if (j < 0 || j >= N) continue;
    const s = f(i / SR);
    L[j] += s * gl;
    R[j] += s * gr;
  }
};

// ---------------------------------------------------------------- the pitches (D minor pentatonic, and a few for the chords)
const NOTE: Record<string, number> = {};
const NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
for (let o = 1; o <= 6; o++) NAMES.forEach((n, i) => (NOTE[`${n}${o}`] = 440 * 2 ** ((o - 4) + (i - 9) / 12)));
const n = (s: string) => NOTE[s];

// ---------------------------------------------------------------- the instruments
/** The đàn tranh: a bright plucked string, its partials dying high to low; `bend` lifts it a little after the pluck, as a hand pressing the string. */
const tranh = (at: number, note: string, vel = 1, pan = 0, bend = 0) =>
  voice(at, 1.8, 0.16 * vel, pan, (t) => {
    const f = n(note) * (1 + bend * (1 - Math.exp(-t * 7)));
    let s = 0;
    for (let k = 1; k <= 8; k++) s += (Math.sin(2 * Math.PI * f * k * t + k) / k ** 1.1) * Math.exp(-t * (1.6 + k * 0.9));
    return s * Math.min(1, t * 400);
  });

/** The sáo: a breathy bamboo flute, a slow vibrato coming in as the note holds. */
const sao = (at: number, note: string, dur: number, vel = 1, pan = 0.15) =>
  voice(at, dur + 0.2, 0.11 * vel, pan, (t) => {
    const vib = 1 + 0.006 * Math.sin(2 * Math.PI * 5.2 * t) * Math.min(1, t / 0.5);
    const f = n(note) * vib;
    const env = Math.min(1, t / 0.08) * Math.min(1, Math.max(0, (dur + 0.2 - t) / 0.2));
    const tone = Math.sin(2 * Math.PI * f * t) + 0.18 * Math.sin(4 * Math.PI * f * t) + 0.06 * Math.sin(6 * Math.PI * f * t);
    return (tone + noise() * 0.05) * env;
  });

/** A taiko: the head's thump falling in pitch, and the slap of the stick. */
const taiko = (at: number, vel = 1, pitch = 1, pan = 0) => {
  let lp = 0;
  voice(at, 0.9, 0.55 * vel, pan, (t) => {
    const f = (58 + 90 * Math.exp(-t * 28)) * pitch;
    const body = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 5.5);
    lp += (noise() - lp) * 0.08;
    return body + lp * Math.exp(-t * 40) * 1.4;
  });
};

/** The rim of a small drum. */
const rim = (at: number, vel = 1, pan = 0.25) => {
  let prev = 0;
  voice(at, 0.09, 0.2 * vel, pan, (t) => {
    const x = noise();
    const hp = x - prev;
    prev = x;
    return (hp * 0.7 + Math.sin(2 * Math.PI * 820 * t) * 0.5) * Math.exp(-t * 60);
  });
};

/** A shaker. */
const shaker = (at: number, vel = 1, pan = -0.3) => {
  let prev = 0;
  voice(at, 0.06, 0.07 * vel, pan, (t) => {
    const x = noise();
    const hp = x - prev;
    prev = x;
    return hp * Math.exp(-t * 70) * Math.min(1, t * 900);
  });
};

/** The bass: a round low note. */
const bass = (at: number, note: string, dur: number, vel = 1) =>
  voice(at, dur, 0.3 * vel, 0, (t) => {
    const f = n(note);
    const env = Math.min(1, t / 0.01) * Math.exp(-t * 2.2) * Math.min(1, Math.max(0, (dur - t) / 0.04));
    return (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(4 * Math.PI * f * t) + 0.1 * Math.sin(6 * Math.PI * f * t)) * env;
  });

/** A pad: detuned saws, softened, swelling in and out over [at, at + dur]. */
const pad = (at: number, notes: string[], dur: number, vel = 1) => {
  for (const [v, note] of notes.entries()) {
    for (const det of [-0.006, 0, 0.007]) {
      let lp = 0;
      let ph = rnd();
      const f = n(note) * (1 + det);
      voice(at, dur, (0.035 * vel) / notes.length ** 0.5, (v % 2 ? 0.4 : -0.4) + det * 20, (t) => {
        ph = (ph + f / SR) % 1;
        lp += (ph * 2 - 1 - lp) * 0.035;
        const env = Math.min(1, t / 0.8) * Math.min(1, Math.max(0, (dur - t) / 1.0));
        return lp * env;
      });
    }
  }
};

/** A gong: inharmonic partials, beating, dying slowly. */
const gong = (at: number, vel = 1) =>
  voice(at, 4.5, 0.22 * vel, 0, (t) => {
    const f = 92;
    let s = 0;
    const parts = [1, 1.47, 2.09, 2.56, 3.18, 3.9, 4.73];
    parts.forEach((p, k) => (s += (Math.sin(2 * Math.PI * f * p * t * (1 + 0.002 * Math.sin(t * 3 + k))) / (1 + k * 0.6)) * Math.exp(-t * (0.6 + k * 0.35))));
    return s * Math.min(1, t * 200);
  });

/** A boom: a sub-bass drop with a burst, for the big blows. */
const boom = (at: number, vel = 1) => {
  let lp = 0;
  voice(at, 2.2, 0.7 * vel, 0, (t) => {
    const f = 38 + 70 * Math.exp(-t * 9);
    lp += (noise() - lp) * 0.05;
    return Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 1.8) + lp * Math.exp(-t * 7) * 0.8;
  });
};

/** A riser: noise opening up and a whistle climbing, over [at, at + dur]. */
const riser = (at: number, dur: number, vel = 1) => {
  let lp = 0;
  let ph = 0;
  voice(at, dur, 0.18 * vel, 0, (t) => {
    const u = t / dur;
    lp += (noise() - lp) * (0.01 + 0.3 * u * u);
    const f = 300 * 2 ** (u * 2.5);
    ph += f / SR;
    return (lp * 1.6 + Math.sin(2 * Math.PI * ph) * 0.25) * u * u;
  });
};

// ---------------------------------------------------------------- the score
const bars = (from: number, to: number) => {
  const out: number[] = [];
  for (let b = CUE.intro + Math.ceil((from - CUE.intro) / (4 * BEAT) - 1e-6) * 4 * BEAT; b < to - 1e-6; b += 4 * BEAT) out.push(b);
  return out;
};

// the intro: a drone, the tranh alone, rising into the fight
pad(0, ["D3", "A3", "D4"], CUE.fight + 0.6, 0.9);
const lick = ["D4", "A3", "C4", "D4", "F4", "D4", "C4", "A3"];
for (const b of bars(CUE.intro, CUE.fight))
  lick.forEach((note, i) => tranh(b + i * BEAT * 0.5, note, i % 4 === 0 ? 1 : 0.7, i % 2 ? 0.35 : -0.35, i === 4 ? 0.03 : 0));
riser(CUE.fight - 1.5, 1.5, 0.6);

// the ambush: taiko, bass, the tranh doubled up
const prog1 = [["D3", "F3", "A3"], ["C3", "G3", "C4"], ["Bb2", "F3", "D4"], ["C3", "G3", "E4"]];
const roots1 = ["D2", "C2", "Bb1", "C2"];
bars(CUE.fight, CUE.bridge).forEach((b, k) => {
  pad(b, prog1[k % 4], 2.1, 0.8);
  for (const [i, v] of [[0, 1], [1.5, 0.6], [2, 0.8], [3.5, 0.7]] as const) taiko(b + i * BEAT, v, 1, 0);
  for (const i of [1, 3]) rim(b + i * BEAT, 0.9);
  for (let i = 0; i < 8; i++) shaker(b + i * BEAT * 0.5, i % 2 ? 0.6 : 1);
  for (let i = 0; i < 8; i++) bass(b + i * BEAT * 0.5, roots1[k % 4], 0.24, i % 2 ? 0.7 : 1);
  const riff = ["D5", "C5", "A4", "C5", "D5", "F5", "D5", "C5", "A4", "G4", "A4", "C5", "D5", "C5", "A4", "G4"];
  riff.forEach((note, i) => tranh(b + i * BEAT * 0.25, note, i % 4 === 0 ? 0.8 : 0.5, i % 2 ? 0.45 : -0.2));
});
// the Heaven Pierce
riser(CUE.pierce - 1.2, 1.2, 0.5);
boom(CUE.pierce, 1);
gong(CUE.pierce, 0.8);

// over the bridge: a breath, the sáo
const bridgeBars = bars(CUE.bridge, CUE.lord);
pad(CUE.bridge - 0.3, ["D3", "A3", "F4"], CUE.lord - CUE.bridge + 0.3, 1.0);
bridgeBars.forEach((b, k) => {
  taiko(b, 0.45, 0.9, -0.2);
  if (k % 2) taiko(b + 2 * BEAT, 0.3, 0.9, 0.2);
  for (let i = 0; i < 4; i++) shaker(b + i * BEAT, 0.5);
  bass(b, k % 2 ? "Bb1" : "D2", 1.8, 0.6);
});
const tune: [string, number][] = [
  ["A4", 1],
  ["G4", 0.5],
  ["F4", 0.5],
  ["D4", 1.5],
  ["C4", 0.5],
  ["D4", 0.5],
  ["F4", 0.5],
  ["G4", 0.5],
  ["A4", 0.5],
  ["C5", 1.5],
  ["A4", 0.5],
  ["G4", 1],
  ["A4", 2],
];
{
  let t = (bridgeBars[0] ?? CUE.bridge) + 0.25;
  for (const [note, beats] of tune) {
    if (t + beats * BEAT > CUE.lord - 2.4) break;
    sao(t, note, beats * BEAT * 0.95, 1);
    t += beats * BEAT;
  }
}
// the drums gather into his roar
for (let i = 0; i < 16; i++) {
  const u = i / 16;
  taiko(CUE.lord - 2.2 + 2.2 * (1 - (1 - u) ** 1.6), 0.35 + 0.5 * u, 1 + u * 0.2, (i % 2) * 0.4 - 0.2);
}
riser(CUE.lord - 2.2, 2.2, 0.7);
boom(CUE.lord, 1);
gong(CUE.lord, 1);

// the duel: all of it, faster and higher
const prog2 = [["D3", "F3", "A3"], ["Bb2", "F3", "D4"], ["F3", "A3", "C4"], ["C3", "G3", "E4"]];
const roots2 = ["D2", "Bb1", "F2", "C2"];
bars(CUE.duel, CUE.tempest).forEach((b, k) => {
  pad(b, prog2[k % 4], 2.1, 1);
  for (const [i, v] of [[0, 1.1], [0.75, 0.5], [1.5, 0.7], [2, 1], [2.75, 0.5], [3, 0.6], [3.5, 0.8]] as const) taiko(b + i * BEAT, v, i === 0 ? 0.9 : 1.1, (i * 0.3) % 0.6 - 0.3);
  for (const i of [1, 3]) rim(b + i * BEAT, 1);
  for (let i = 0; i < 16; i++) shaker(b + i * BEAT * 0.25, i % 4 === 0 ? 1 : 0.5);
  for (let i = 0; i < 8; i++) bass(b + i * BEAT * 0.5, roots2[k % 4], 0.22, i % 2 ? 0.75 : 1.1);
  const riff = k % 2
    ? ["D5", "F5", "G5", "A5", "G5", "F5", "D5", "C5", "D5", "F5", "A5", "C6", "A5", "G5", "F5", "D5"]
    : ["A4", "C5", "D5", "F5", "D5", "C5", "A4", "C5", "D5", "C5", "A4", "G4", "A4", "C5", "D5", "F5"];
  riff.forEach((note, i) => tranh(b + i * BEAT * 0.25, note, i % 4 === 0 ? 0.9 : 0.55, i % 2 ? 0.5 : -0.3, i % 8 === 7 ? 0.04 : 0));
  if (k % 4 === 0 && b > CUE.duel + 1) gong(b, 0.45);
});
riser(CUE.tempest - 2.4, 2.4, 1);
for (let i = 0; i < 12; i++) taiko(CUE.tempest - 1.2 + i * 0.1, 0.4 + i * 0.05, 1.2, (i % 2) * 0.4 - 0.2);

// the tempest, the lotus, and the end on a major chord
boom(CUE.tempest, 1.1);
gong(CUE.tempest, 1);
pad(CUE.tempest, ["D3", "F#3", "A3", "D4"], CUE.end - CUE.tempest + 0.4, 1.4);
bass(CUE.tempest, "D2", 2.5, 1);
["D5", "F#5", "A5", "D6"].forEach((note, i) => tranh(CUE.tempest + 0.15 + i * 0.09, note, 0.9, i % 2 ? 0.4 : -0.4, 0.02));
boom(CUE.lotus, 0.8);
gong(CUE.lotus, 1.2);
["A4", "D5", "F#5", "A5", "D6"].forEach((note, i) => tranh(CUE.lotus + 0.1 + i * 0.12, note, 0.8, i % 2 ? 0.35 : -0.35));

// ---------------------------------------------------------------- out: a gentle fade at the very end, then ffmpeg makes the wav
const fadeFrom = Math.round((CUE.end - 0.9) * SR);
for (let i = fadeFrom; i < N; i++) {
  const g = Math.max(0, 1 - (i - fadeFrom) / (0.9 * SR));
  L[i] *= g;
  R[i] *= g;
}
const inter = new Float32Array(N * 2);
for (let i = 0; i < N; i++) {
  inter[i * 2] = L[i];
  inter[i * 2 + 1] = R[i];
}
writeFileSync(out + ".f32", Buffer.from(inter.buffer));
spawnSync(
  "ffmpeg",
  ["-v", "error", "-y", "-f", "f32le", "-ar", String(SR), "-ac", "2", "-i", out + ".f32", "-af", "acompressor=threshold=-16dB:ratio=2.5:attack=8:release=200:makeup=1.5,alimiter=limit=0.9", "-t", CUE.end.toFixed(3), out],
  { stdio: "inherit" },
);
console.log(`score written: ${CUE.end.toFixed(1)} s`);
