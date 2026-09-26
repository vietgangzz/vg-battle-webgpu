/**
 * Finishes the trailer filmed by tools/trailer.ts: lays the title cards over
 * the footage (rendered at 4K with ImageMagick, faded in and out), mixes the
 * sound (the film's score, twice: a rise into SORA's reveal and one under the
 * close; and every sound the fight made, at the moment it made it), and
 * encodes the 4K master and a 1080p copy for sharing.
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

// a lime rule under a lower third
const lowerThird = (name: string, start: number, end: number, title: string, sub: string) =>
  card(
    name,
    start,
    end,
    // (bottom-up: the small line under the title)
    [
      { text: sub, size: 44, font: UI, fill: LIME, spacing: 10 },
      { text: title, size: 92, font: SERIF, fill: IVORY, spacing: 6 },
    ],
    "SouthWest",
    200,
    170,
    ["-fill", LIME, "-draw", `rectangle ${px(160)},${H - Math.round(470 * k)} ${px(172)},${H - Math.round(170 * k)}`],
  );
const centre = (name: string, start: number, end: number, title: string, sub: string, size = 170) =>
  card(
    name,
    start,
    end,
    [
      { text: title, size, font: UI, fill: IVORY, spacing: 28 },
      { text: sub, size: 54, font: UI, fill: LIME, spacing: 14 },
    ],
    "Center",
    0,
    -60,
  );

const s = (id: string) => shot(id);
centre("c01-studio", 0.8, 5.2, "VGANG STUDIO", "PRESENTS", 120);
lowerThird("c02-place", s("s02-").start + 0.4, s("s02-").start + s("s02-").seconds - 0.2, "Tràng An · Ninh Bình", "A WORLD HERITAGE VALLEY IN VIỆT NAM");
lowerThird("c03-thuydinh", s("s02b").start + 1.0, s("s02b").start + s("s02b").seconds - 0.4, "Thủy Đình", "THE WATER PAVILION");
centre("c04-sora", s("s04").start + 0.9, s("s04").start + s("s04").seconds - 0.1, "SORA", "THE LITTLE GIANT");
lowerThird("c05-hill", s("s05b").start + 1.0, s("s05b").start + s("s05b").seconds - 0.4, "Chùa Tràng An", "PAGODAS · BAMBOO · KARST · RIVERS");
centre("c06-journey", s("s07").start + 0.2, s("s07").start + s("s07").seconds, "A JOURNEY ACROSS VIỆT NAM", "", 120);
centre("c07-fight", s("s08").start + 0.6, s("s08").start + 3.2, "FIGHT THE SHADOWS", "SLASH · DASH · KIẾM KHÍ", 150);
centre("c08-pierce", s("s10").start + 0.2, s("s10").start + 2.4, "HEAVEN PIERCE", "", 150);
centre("c09-tempest", s("s11").start + 1.4, s("s11").start + 4.4, "SEN BÃO", "LOTUS TEMPEST · CHARGE IT TWICE", 190);
centre("c10-level", s("s12").start + 0.3, s("s12").start + s("s12").seconds - 0.1, "LEVEL UP", "SIX SKILLS TO MASTER", 150);
lowerThird("c11-tech", s("s13").start + 0.6, s("s13").start + s("s13").seconds - 0.3, "React Native · WebGPU", "RENDERED LIVE · 60 FPS ON IPHONE");

// the title: dimmed frame, the vgang wordmark, the name
{
  const t = s("s14");
  const wm = `${cards}/wordmark.png`;
  run("rsvg-convert", ["-w", px(900), "../vg-showcase-demo/battle/assets/wordmark_lime.svg", "-o", wm]);
  const file = `${cards}/c12-title.png`;
  run("magick", [
    "-size", `${W}x${H}`, "radial-gradient:#00000055-#000000c8",
    "(", wm, ")", "-gravity", "Center", "-geometry", at(0, -330), "-composite",
    "(", "+size", "-background", "none", "-font", UI, "-pointsize", px(230), "-kerning", px(40), "-fill", IVORY, "label:LITTLE GIANT", ")", "-gravity", "Center", "-geometry", at(0, 20), "-composite",
    "(", "+size", "-background", "none", "-font", SERIF, "-pointsize", px(66), "-kerning", px(18), "-fill", LIME, "label:A JOURNEY ACROSS VIỆT NAM", ")", "-gravity", "Center", "-geometry", at(0, 210), "-composite",
    "(", "+size", "-background", "none", "-font", UI, "-pointsize", px(46), "-kerning", px(16), "-fill", IVORY, "label:COMING SOON  -  VGANG.STUDIO", ")", "-gravity", "Center", "-geometry", at(0, 420), "-composite",
    file,
  ]);
  list.push({ file, start: t.start + 1.2, end: total + 1 });
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
// the score: quiet, then a long rise. Once rising into SORA's reveal, once under the close.
const score = decode("assets/film/sfx.m4a");
const scoreLen = score.length / 2 / RATE;
const reveal = s("s04").start + 1.0;
add(score, reveal - scoreLen, 3.2, 0, 1.2);
add(score, total - scoreLen + 0.6, 3.2, 2.0, 1.5);
// the fight's own sounds, where they happened (from the fight on; a name at most every 60 ms)
const GAIN: Record<string, number> = { swing: 0.45, hit: 0.7, heavy: 0.85, slam: 1, clash: 0.8, wave: 0.6, dash: 0.5, block: 0.4, down: 0.5 };
const bank: Record<string, Float32Array> = {};
const last: Record<string, number> = {};
const fightFrom = s("s08").start;
for (const e of tl.sounds) {
  if (e.t < fightFrom || e.t > s("s13").start) continue;
  if (last[e.n] !== undefined && e.t - last[e.n] < 0.06) continue;
  last[e.n] = e.t;
  bank[e.n] ??= decode(`assets/sfx/${e.n}.m4a`);
  add(bank[e.n], e.t, GAIN[e.n] ?? 0.5);
}
// a boom on the title
add(decode("assets/sfx/slam.m4a"), s("s14").start + 1.2, 1.1);
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
filters.push(`${last_}fade=t=in:st=0:d=0.8,fade=t=out:st=${(total - 1.2).toFixed(2)}:d=1.2,format=yuv420p[vout]`);
filters.push(`[1:a]afade=t=out:st=${(total - 1.5).toFixed(2)}:d=1.5,loudnorm=I=-14:TP=-1.0:LRA=11[aout]`);
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
