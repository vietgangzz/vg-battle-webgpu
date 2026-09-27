/**
 * The showcase demo's soundtrack: the sounds the game played during the run
 * (Documents/demo-sounds.json, written by ?demo=1), put back at the moments
 * they played in the edited video.
 *
 *   node tools/run.mjs tools/demo-sound.ts <demo-sounds.json> <out.wav> <explore-at> <cuts>
 *
 * explore-at: when the demo's tap on EXPLORE (its "explore" time) happens in
 * the raw recording (seconds). cuts: the recording's kept stretches in order,
 * "a-b,c-d,..." (seconds of the raw recording), laid end to end with the
 * given crossfade between them (the video's own edit).
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const [, , jsonPath, outPath, exploreAt, cutsArg, fadeArg] = process.argv;
const demo = JSON.parse(readFileSync(jsonPath, "utf8")) as { explore: number; sounds: [string, number][] };
const cuts = cutsArg.split(",").map((c) => c.split("-").map(Number) as [number, number]);
const fade = Number(fadeArg ?? "0.25");
const RATE = 48000;
const offset = Number(exploreAt) - demo.explore;

// a raw-recording time to the edited video's time (null if it was cut)
const toVideo = (t: number) => {
  let base = 0;
  for (const [a, b] of cuts) {
    if (t >= a && t <= b) return base + (t - a);
    base += b - a - fade;
  }
  return null;
};
const total = cuts.reduce((s, [a, b]) => s + (b - a), 0) - fade * (cuts.length - 1);

const decode = (file: string) => {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-f", "f32le", "-ac", "2", "-ar", String(RATE), "-"], { maxBuffer: 1 << 28 });
  return new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.byteLength / 4);
};
const mix = new Float32Array(Math.ceil((total + 1) * RATE) * 2);
const add = (src: Float32Array, at: number, gain: number) => {
  const o = Math.round(at * RATE) * 2;
  for (let i = 0; i < src.length; i++) {
    const j = o + i;
    if (j >= 0 && j < mix.length) mix[j] += src[i] * gain;
  }
};
// each sound at the level the game gives it, and none repeated within 50 ms (the voices overlap in the game too)
const GAIN: Record<string, number> = { swing: 0.55, hit: 0.75, heavy: 0.9, slam: 1, clash: 0.8, wave: 0.65, dash: 0.6, block: 0.35, down: 0.5 };
const bank: Record<string, Float32Array> = {};
const last: Record<string, number> = {};
let placed = 0;
for (const [n, t] of demo.sounds) {
  const v = toVideo(offset + t);
  if (v === null) continue;
  if (last[n] !== undefined && v - last[n] < 0.05) continue;
  last[n] = v;
  bank[n] ??= decode(`assets/sfx/${n}.m4a`);
  add(bank[n], v, GAIN[n] ?? 0.5);
  placed++;
}
writeFileSync(outPath + ".f32", Buffer.from(mix.buffer));
spawnSync(
  "ffmpeg",
  ["-v", "error", "-y", "-f", "f32le", "-ar", String(RATE), "-ac", "2", "-i", outPath + ".f32",
    "-af", "acompressor=threshold=-18dB:ratio=3:attack=4:release=160:makeup=2,alimiter=limit=0.89", "-t", total.toFixed(3), outPath],
  { stdio: "inherit" },
);
console.log(`${placed} of ${demo.sounds.length} sounds placed over ${total.toFixed(2)} s`);
