/**
 * The trailer, rendered in-engine (headless, Dawn) at 4K: SORA fighting, the
 * cameras close beside her (the combo, a dash, kiếm khí, the streak, the
 * Heaven Pierce, Sen Bão, a level-up), each frame piped straight into ffmpeg. Every sound the game makes is logged
 * with its time, for tools/trailer-finish.ts to mix.
 *
 *   node tools/run.mjs tools/trailer.ts                 4K, 30 fps -> tools/.out/trailer/video.mp4
 *   node tools/run.mjs tools/trailer.ts --preview       first/middle/last frame of each shot, 960x540 PNGs
 *   node tools/run.mjs tools/trailer.ts --only s09      one shot (with the others simulated, not drawn)
 *
 * The shot list (and the cards laid over it) is SHOTS below; docs/trailer.md
 * has the script.
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { setup } from "./dawn";

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const preview = process.argv.includes("--preview");
const only = arg("--only", "");
const [W, H] = (preview ? "960x540" : arg("--size", "3840x2160")).split("x").map(Number);
const FPS = 30;
const out = process.argv.includes("--preview") ? "tools/.out/trailer-p" : "tools/.out/trailer";
mkdirSync(out, { recursive: true });

const env = await setup(W, H);
const { THREE, fs, post, framing, tick, grab, renderer } = env;
const { WorldData } = await import("../src/battle/world/data");
const { Explore } = await import("../src/battle/world/explore");
const { buildCreatures } = await import("../src/battle/world/creature");

const read = (p: string) => {
  const b = readFileSync(p);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const manifest = JSON.parse(readFileSync("src/battle/gen/world-ninh-binh.json", "utf8"));
const data = new WorldData(manifest, read("assets/world/ninh-binh.bin"), read("assets/world/ninh-binh-tex.bin"));
const cman = JSON.parse(readFileSync("src/battle/gen/creatures.json", "utf8"));
const cblobs: Record<string, ArrayBuffer> = {};
for (const name of Object.keys(cman.creatures)) cblobs[name] = read(`assets/creatures/${name}.bin`);

type V3 = [number, number, number];
type Cam = { eye: V3; at: V3; tan: number } | null;
let cam: Cam = null;
let draw = true;
const player = {
  fs,
  post,
  renderer,
  view: framing,
  // 60 Hz simulation, 30 fps film: two steps a frame
  pace() {
    return 2;
  },
  renderPosed(pose: () => void) {
    tick();
    pose();
    if (cam) fs.setCamera(new THREE.Vector3(...cam.eye), new THREE.Vector3(...cam.at), cam.tan, framing);
    if (draw) post.render();
    return true;
  },
};

let clock = 0;
const sounds: { t: number; n: string }[] = [];
const game = new Explore(
  player as never,
  data,
  { hud: () => {}, pop: () => {}, sound: (n) => sounds.push({ t: clock, n }) },
  buildCreatures(cman, cblobs),
);
// what the trailer reaches into
const g = game as unknown as {
  combat: { energy: number };
  level: number;
  levelUp(): void;
  daylight(dt: number, snap?: boolean): void;
  duskTarget(): number;
  objective(): { at: { x: number; y: number } } | null;
  camera: { reset(a: unknown): void; heading(): number };
  step(): void;
};
game.start(true);
await game.warm((o) => renderer.compileAsync(o, fs.camera, fs.scene));
await renderer.compileAsync(fs.scene, fs.camera);

const hero = game.hero;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => t * t * (3 - 2 * t);
/** SORA's heading when a shot starts: the cameras keep to it, so they do not swing as she turns to strike */
let base = 0;
const heading = () => Math.atan2(hero.forward.y, hero.forward.x);
/** round SORA: `a0`..`a1` radians about her (0 = in front of where she faced), `r` out, `h` up, looking at her */
const orbit = (a0: number, a1: number, r0: number, h: number, look = 0.8, tan = 0.36, r1 = r0) => (u: number): Cam => {
  const a = base + lerp(a0, a1, ease(u));
  const r = lerp(r0, r1, ease(u));
  const p = hero.pos;
  return { eye: [p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, hero.groundZ + h], at: [p.x, p.y, hero.groundZ + look], tan };
};
const monsters = () => (game as unknown as { monsters: { remove(): void; pack: number }[] }).monsters;
const ARENA = new THREE.Vector3(6, -30, 0);

interface Shot {
  id: string;
  seconds: number;
  /** before the first frame */
  enter?: () => void;
  /** each frame (`i`, and `u` 0..1 through the shot): the buttons pressed, and the camera (null = the game's own) */
  frame?: (u: number, i: number) => Cam;
}

/** SORA fights: scripted presses on a pack brought to her (the brawl benchmark, spawning only) */
const SHOTS: Shot[] = [
  {
    id: "s01-open",
    seconds: 3,
    enter: () => {
      hero.place(ARENA.clone(), 180);
      g.camera.reset(hero);
      game.brawl(3, false);
      // the packs arrive and close in (simulated, not filmed)
      for (let i = 0; i < 150; i++) g.step();
    },
    // close in front of her: the combo, blade by blade
    frame: (u, i) => {
      if (i % 9 === 0) game.attack();
      return orbit(-0.55, 0.15, 2.6, 1.0, 0.75)(u);
    },
  },
  {
    id: "s02-combo",
    seconds: 3.5,
    frame: (u, i) => {
      if (i % 9 === 0 && i < 90) game.attack();
      if (i === 64) game.dash();
      return orbit(1.0, 2.0, 5.2, 2.3, 0.7)(u);
    },
  },
  {
    id: "s03-bolt",
    seconds: 3,
    // from her side, the crescents flying off across the picture
    frame: (u, i) => {
      if (i % 22 === 0) game.shoot();
      return orbit(1.25, 1.6, 5.8, 1.9, 0.9)(u);
    },
  },
  {
    id: "s04-streak",
    seconds: 2.4,
    frame: (u, i) => {
      if (i === 2) game.skill();
      return orbit(1.45, 1.2, 5.2, 1.1, 0.8)(u);
    },
  },
  {
    id: "s05-pierce",
    seconds: 4,
    enter: () => {
      g.combat.energy = 100;
      game.ult();
    },
    frame: orbit(0.9, 1.6, 7.5, 3.0, 1.4, 0.42),
  },
  {
    id: "s06-tempest",
    seconds: 5,
    enter: () => {
      g.combat.energy = 200;
      game.ult();
    },
    // from above: the rings of blades, then the lotus opening round her
    frame: orbit(-0.5, 0.35, 7.5, 4.0, 1.0, 0.42),
  },
  {
    id: "s07-level",
    seconds: 2.2,
    enter: () => {
      g.level += 1;
      g.levelUp();
    },
    frame: orbit(0.25, -0.15, 3.6, 1.4, 1.0),
  },
  {
    id: "s08-title",
    seconds: 4,
    enter: () => {
      game.brawl(0);
      for (const m of monsters()) m.remove();
    },
    // pushing in on her face for the title
    frame: orbit(-0.25, 0.05, 3.4, 1.05, 0.8, 0.36, 2.5),
  },
];
// ---------------------------------------------------------------- film it
const ff = preview
  ? null
  : spawn(
      "ffmpeg",
      ["-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", env.ext === "bgra" ? "bgra" : "rgba", "-s", `${W}x${H}`, "-r", String(FPS), "-i", "-",
        "-c:v", "hevc_videotoolbox", "-b:v", "90M", "-tag:v", "hvc1", "-pix_fmt", "yuv420p", `${out}/video.mp4`],
      { stdio: ["pipe", "inherit", "inherit"] },
    );
const write = (buf: Buffer) =>
  new Promise<void>((done) => {
    if (!ff || ff.stdin.write(buf)) done();
    else ff.stdin.once("drain", done);
  });

const timeline: { id: string; start: number; seconds: number }[] = [];
let t0 = performance.now();
for (const shot of SHOTS) {
  const frames = Math.round(shot.seconds * FPS);
  timeline.push({ id: shot.id, start: clock, seconds: frames / FPS });
  shot.enter?.();
  base = heading();
  const filmed = !only || shot.id.startsWith(only);
  for (let i = 0; i < frames; i++) {
    const u = frames > 1 ? i / (frames - 1) : 0;
    cam = shot.frame ? shot.frame(u, i) : null;
    const keep = preview ? i === 0 || i === (frames >> 1) || i === frames - 1 : filmed;
    draw = keep;
    game.frame(clock * 1000 + 1);
    if (keep) {
      await env.device.queue.onSubmittedWorkDone();
      const img = await grab();
      if (preview) writeFileSync(`${out}/${shot.id}-${i}.${env.ext}`, img);
      else await write(img);
    }
    clock += 1 / FPS;
  }
  console.log(`[trailer] ${shot.id} done at ${clock.toFixed(1)} s (${((performance.now() - t0) / 1000).toFixed(0)} s wall)`);
}
if (ff) {
  ff.stdin.end();
  await new Promise((done) => ff.on("close", done));
}
writeFileSync(`${out}/timeline.json`, JSON.stringify({ fps: FPS, width: W, height: H, shots: timeline, sounds }, null, 1));
writeFileSync(`${out}/size.txt`, `${W}x${H}\n`);
console.log(`[trailer] ${clock.toFixed(1)} s, ${sounds.length} sounds, ${((performance.now() - t0) / 1000).toFixed(0)} s to film`);
t0 = 0;
process.exit(0);
