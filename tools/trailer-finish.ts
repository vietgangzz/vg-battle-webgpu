/**
 * Finishes the trailer filmed by tools/trailer.ts: lays the few cards over
 * the footage (the two ultimates' names, the title; rendered at 4K with
 * ImageMagick, faded in and out), mixes the sound (every sound the fight
 * made, at the moment it made it, with a whoosh and a boom under each
 * ultimate and the title), and encodes the 4K master and a 1080p copy.
 *
 *   node tools/run.mjs tools/trailer-finish.ts
 *   -> tools/.out/trailer/little-giant-trailer-4k.mp4, little-giant-trailer-1080p.mp4
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const dir = "tools/.out/trailer";
const cards = `${dir}/cards`;
mkdirSync(cards, { recursive: true });
const tl = JSON.parse(readFileSync(`${dir}/timeline.json`, "utf8")) as {
  fps: number;
  width: number;
  height: number;
  shots: { id: string; start: number; seconds: number }[];
  sounds: { t: number; n: string }[];
};
const W = tl.width;
const H = tl.height;
const k = W / 3840;
const total = tl.shots.reduce((s, x) => Math.max(s, x.start + x.seconds), 0);
const shot = (id: string) => {
  const s = tl.shots.find((x) => x.id.startsWith(id));
  if (!s) throw new Error(`no shot ${id}`);
  return s;
};

const run = (cmd: string, args: string[]) => {
  const r = spawnSync(cmd, args, { stdio: ["ignore", "pipe", "inherit"], maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`${cmd} failed`);
  return r.stdout;
};

// ---------------------------------------------------------------- the cards
const SERIF = "../vg-showcase-demo/world/fonts/PlayfairDisplay.ttf";
const UI = "assets/fonts/Manrope-SemiBold.ttf";
const LIME = "#D5F64B";
const IVORY = "#F5F3E8";
const px = (n: number) => String(Math.round(n * k));
/** an ImageMagick offset: "+12-40" (a plain "+-40" is not one) */
const at = (x: number, y: number) => {
  const sx = Math.round(x * k);
  const sy = Math.round(y * k);
  return `${sx < 0 ? "-" : "+"}${Math.abs(sx)}${sy < 0 ? "-" : "+"}${Math.abs(sy)}`;
};
/** Manrope has no Vietnamese diacritics: anything beyond ASCII is set in the serif */
const fontFor = (text: string, font: string) => (/[^\x00-\x7F]/.test(text) ? SERIF : font);

interface Card {
  file: string;
  start: number;
  end: number;
}
const list: Card[] = [];

/** text lines on a transparent 4K frame, over a soft dark shadow of themselves; `gravity` and offset place them */
function card(name: string, start: number, end: number, lines: { text: string; size: number; font: string; fill: string; spacing?: number }[], gravity: string, x: number, y: number, extra: string[] = []) {
  const file = `${cards}/${name}.png`;
  const layer = (ink: string | null) => {
    const out: string[] = [];
    let dy = 0;
    for (const l of lines) {
      if (l.text)
        out.push(
          "(", "+size", "-background", "none", "-font", fontFor(l.text, l.font), "-pointsize", px(l.size), "-kerning", px(l.spacing ?? 0), "-fill", ink ?? l.fill, `label:${l.text}`, ")",
          "-gravity", gravity, "-geometry", at(x, y + dy), "-composite",
        );
      // (under a South gravity the offset counts up from the bottom edge: the next line sits higher)
      dy += l.size * 1.35;
    }
    return out;
  };
  const shadow = `${cards}/${name}-shadow.png`;
  run("magick", ["-size", `${W}x${H}`, "xc:none", ...layer("#000000"), "-channel", "A", "-evaluate", "multiply", "0.75", "+channel", "-blur", `0x${px(16)}`, shadow]);
  run("magick", ["-size", `${W}x${H}`, "xc:none", shadow, "-compose", "over", "-composite", ...extra, ...layer(null), file]);
  list.push({ file, start, end });
}

const s = (id: string) => shot(id);
// only the two ultimates are named, low in the frame (SORA and the effect stay clear), after their flash
const skillCard = (name: string, start: number, end: number, title: string) =>
  card(name, start, end, [{ text: title, size: 150, font: UI, fill: IVORY, spacing: 26 }], "South", 0, 250);
skillCard("c01-pierce", s("s05").start + 1.3, s("s05").start + s("s05").seconds - 0.2, "HEAVEN PIERCE");
skillCard("c02-tempest", s("s06").start + 1.9, s("s06").start + s("s06").seconds - 0.2, "SEN BÃO");

// the title over her close-up: the vgang wordmark and the name, nothing else
{
  const t = s("s08");
  const wm = `${cards}/wordmark.png`;
  run("rsvg-convert", ["-w", px(620), "../vg-showcase-demo/battle/assets/wordmark_lime.svg", "-o", wm]);
  const file = `${cards}/c03-title.png`;
  run("magick", [
    "-size", `${W}x${H}`, "gradient:#00000000-#000000b0",
    "(", wm, ")", "-gravity", "South", "-geometry", at(0, 470), "-composite",
    "(", "+size", "-background", "none", "-font", UI, "-pointsize", px(210), "-kerning", px(40), "-fill", IVORY, "label:LITTLE GIANT", ")", "-gravity", "South", "-geometry", at(0, 190), "-composite",
    file,
  ]);
  list.push({ file, start: t.start + 0.9, end: total + 1 });
}

// --cards: only the cards (to look at them)
if (process.argv.includes("--cards")) process.exit(0);

// ---------------------------------------------------------------- the sound
const RATE = 48000;
const decode = (file: string) => {
  const raw = run("ffmpeg", ["-v", "error", "-i", file, "-f", "f32le", "-ac", "2", "-ar", String(RATE), "-"]);
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
};
const mixBuf = new Float32Array(Math.ceil((total + 1) * RATE) * 2);
const add = (src: Float32Array, at: number, gain: number, fadeIn = 0, fadeOut = 0) => {
  const o = Math.round(at * RATE) * 2;
  const n = src.length / 2;
  for (let i = 0; i < n; i++) {
    const j = o + i * 2;
    if (j < 0 || j + 1 >= mixBuf.length) continue;
    let g = gain;
    if (fadeIn && i < fadeIn * RATE) g *= i / (fadeIn * RATE);
    if (fadeOut && i > n - fadeOut * RATE) g *= (n - i) / (fadeOut * RATE);
    mixBuf[j] += src[i * 2] * g;
    mixBuf[j + 1] += src[i * 2 + 1] * g;
  }
};
/** a synthesised sound: `fn(t)` for `seconds` (mono, both channels) */
const synth = (seconds: number, fn: (t: number) => number) => {
  const n = Math.round(seconds * RATE);
  const b = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) b[i * 2] = b[i * 2 + 1] = fn(i / RATE);
  return b;
};
let seed = 7;
const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
/** a low boom: a sine falling from 90 to 40 Hz, a fast knock and a long tail */
const boom = synth(1.8, (t) => Math.sin(2 * Math.PI * (40 * t + 25 * (1 - Math.exp(-t * 6)))) * Math.exp(-t * 2.4) * Math.min(1, t * 400));
/** a rising whoosh into an ultimate: noise swelling, brighter as it climbs */
let lp = 0;
const riser = synth(1.3, (t) => {
  const k = t / 1.3;
  lp += (noise() - lp) * (0.02 + 0.35 * k * k);
  return lp * k * k * 1.6;
});
// the fight's own sounds, where they happened (a name at most every 60 ms)
const GAIN: Record<string, number> = { swing: 0.5, hit: 0.75, heavy: 0.9, slam: 1, clash: 0.8, wave: 0.65, dash: 0.55, block: 0.3, down: 0.5 };
const bank: Record<string, Float32Array> = {};
const last: Record<string, number> = {};
for (const e of tl.sounds) {
  if (e.t > s("s08").start + 0.3) continue;
  if (last[e.n] !== undefined && e.t - last[e.n] < 0.06) continue;
  last[e.n] = e.t;
  bank[e.n] ??= decode(`assets/sfx/${e.n}.m4a`);
  add(bank[e.n], e.t, GAIN[e.n] ?? 0.5);
}
// the weight under the ultimates and the title
add(riser, s("s05").start - 1.0, 0.5);
add(boom, s("s05").start + 1.05, 0.9);
add(riser, s("s06").start - 0.9, 0.55);
add(boom, s("s06").start + 1.1, 1.0);
add(boom, s("s08").start + 0.9, 0.8);
writeFileSync(`${dir}/mix.f32`, Buffer.from(mixBuf.buffer));

// ---------------------------------------------------------------- picture + cards + sound
const inputs = ["-i", `${dir}/video.mp4`, "-f", "f32le", "-ar", String(RATE), "-ac", "2", "-i", `${dir}/mix.f32`];
const filters: string[] = [];
let last_ = "[0:v]";
list.forEach((c, i) => {
  const dur = c.end - c.start;
  inputs.push("-loop", "1", "-t", dur.toFixed(3), "-i", c.file);
  const n = i + 2;
  filters.push(
    `[${n}:v]format=rgba,fade=t=in:st=0:d=0.45:alpha=1,fade=t=out:st=${Math.max(0, dur - 0.5).toFixed(3)}:d=0.5:alpha=1,setpts=PTS-STARTPTS+${c.start.toFixed(3)}/TB[c${i}]`,
    `${last_}[c${i}]overlay=eof_action=pass:format=auto[v${i}]`,
  );
  last_ = `[v${i}]`;
});
filters.push(`${last_}fade=t=in:st=0:d=0.25,fade=t=out:st=${(total - 1.2).toFixed(2)}:d=1.2,format=yuv420p[vout]`);
// a gentle glue and a limiter (no loudness normaliser: its gain rode the quiet opening up)
filters.push(`[1:a]afade=t=out:st=${(total - 1.5).toFixed(2)}:d=1.5,acompressor=threshold=-20dB:ratio=3:attack=4:release=150:makeup=2,alimiter=limit=0.89[aout]`);
const master = `${dir}/little-giant-trailer-4k.mp4`;
run("ffmpeg", [
  "-y", "-v", "error", ...inputs,
  "-filter_complex", filters.join(";"),
  "-map", "[vout]", "-map", "[aout]",
  "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-profile:v", "high", "-level", "5.2", "-r", String(tl.fps),
  "-c:a", "aac", "-b:a", "320k", "-ar", String(RATE), "-t", total.toFixed(3), "-movflags", "+faststart", master,
]);
run("ffmpeg", ["-y", "-v", "error", "-i", master, "-vf", "scale=1920:1080:flags=lanczos", "-c:v", "libx264", "-preset", "slow", "-crf", "22", "-c:a", "copy", "-movflags", "+faststart", `${dir}/little-giant-trailer-1080p.mp4`]);
console.log(`[trailer] ${total.toFixed(1)} s, ${list.length} cards -> ${master}`);
