/**
 * The trailer, rendered in-engine (headless, Dawn) at 4K: the valley's
 * landmarks from cinematic cameras, SORA, and live gameplay (the brawl
 * benchmark's auto-fight, the Heaven Pierce, the Lotus Tempest, a level-up),
 * each frame piped straight into ffmpeg. Every sound the game makes is logged
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
const out = "tools/.out/trailer";
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
const ground = (x: number, y: number) => game.world.ground.at(x, y);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => t * t * (3 - 2 * t);
const mix = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
/** a camera gliding from one place to another over the shot, looking at a point that may move too */
const glide = (eye0: V3, eye1: V3, at0: V3, at1: V3, tan = 0.36) => (u: number): Cam => ({ eye: mix(eye0, eye1, ease(u)), at: mix(at0, at1, ease(u)), tan });
/** a drone circling a point: angles `a0`..`a1` (radians, world), `r` out, `z` up, looking at `at` */
const circle = (at: V3, r: number, z: number, a0: number, a1: number, tan = 0.4, zEnd = z) => (u: number): Cam => {
  const a = lerp(a0, a1, ease(u));
  return { eye: [at[0] + Math.cos(a) * r, at[1] + Math.sin(a) * r, lerp(z, zEnd, ease(u))], at, tan };
};
/** round SORA: `a0`..`a1` radians about her (0 = in front), at `r` metres and `h` up */
const orbit = (a0: number, a1: number, r: number, h: number, look = 0.8, tan = 0.36) => (u: number): Cam => {
  const f = Math.atan2(hero.forward.y, hero.forward.x);
  const a = f + lerp(a0, a1, ease(u));
  const p = hero.pos;
  return { eye: [p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, hero.groundZ + h], at: [p.x, p.y, hero.groundZ + look], tan };
};
/** SORA `back` metres short of the way to the objective, facing it, the camera behind her */
const faceObjective = (back = 0) => {
  const o = g.objective();
  if (!o) return;
  const dx = o.at.x - hero.pos.x;
  const dy = o.at.y - hero.pos.y;
  const d = Math.hypot(dx, dy) || 1;
  const yaw = (Math.atan2(dx, -dy) * 180) / Math.PI;
  hero.place(new THREE.Vector3(hero.pos.x - (dx / d) * back, hero.pos.y - (dy / d) * back, 0), yaw);
  g.camera.reset(hero);
};
const SPAWN = new THREE.Vector3(-104, -37, 0);
/** the fight: a meadow on the south bank, the thủy đình behind (she faces north, toward it) */
const ARENA = new THREE.Vector3(6, -30, 0);

interface Shot {
  id: string;
  seconds: number;
  /** before the first frame */
  enter?: () => void;
  /** each frame: the camera (null = the game's own), `u` 0..1 through the shot */
  frame?: (u: number) => Cam;
}

const SHOTS: Shot[] = [
  // ---- act one: the place
  { id: "s01-aerial", seconds: 6, frame: glide([-119, -95, 44.5], [-107, -84, 40], [-10, 20, 0], [0, 26, 0], 0.4) },
  { id: "s02-river", seconds: 5, frame: glide([-24, -25, 2.9], [-7, -20.5, 2.4], [12, -7.5, 4.6], [12, -7.5, 4.2]) },
  // the drone round the thủy đình, low over the lotus and the water
  { id: "s02b-lake", seconds: 7, frame: circle([12, -7.5, 3.6], 21, 12, -Math.PI / 2 - 1.1, -Math.PI / 2 + 0.45, 0.4, 9) },
  { id: "s03-village", seconds: 4, frame: glide([-78, -58, 15], [-85, -52, 12], [-104, -37, 1.5], [-106, -36, 1]) },
  {
    id: "s04-sora",
    seconds: 4.5,
    enter: () => {
      hero.place(SPAWN.clone(), 150);
      g.camera.reset(hero);
    },
    frame: orbit(-0.9, 0.7, 2.9, 1.25),
  },
  {
    id: "s05-run",
    seconds: 1.9,
    enter: () => {
      faceObjective(12);
      game.setStick(0, 1);
      game.setSprint(true);
    },
  },
  // the drone round the pagoda hill: the hall, the gate, the bell tower, the stupas on the crown
  {
    id: "s05b-hill",
    seconds: 7,
    enter: () => {
      game.setStick(0, 0);
      game.setSprint(false);
    },
    frame: circle([66, 79, 14], 36, 34, -2.95, -1.05, 0.42, 28),
  },
  {
    id: "s06-temple",
    seconds: 5.5,
    enter: () => {
      game.setStick(0, 0);
      game.setSprint(false);
    },
    frame: glide([49, 57, 13.2], [56, 66, 16.4], [61.2, 73, 15.6], [61.2, 73, 15.2]),
  },
  { id: "s07-hall", seconds: 3, frame: glide([62.6, 75.2, 16.4], [64.2, 77.6, 16.9], [70, 84, 17.4], [70, 84, 17.6]) },
  // ---- act two: the fight
  {
    id: "s08-fight",
    seconds: 8,
    enter: () => {
      hero.place(ARENA.clone(), 180);
      g.camera.reset(hero);
      game.brawl(3);
      // two seconds for the packs to arrive (simulated, not filmed)
      for (let i = 0; i < 120; i++) g.step();
    },
    // the ultimates wait for their own shots
    frame: () => {
      g.combat.energy = Math.min(g.combat.energy, 90);
      return null;
    },
  },
  {
    id: "s09-orbit",
    seconds: 4,
    frame: (u) => {
      g.combat.energy = Math.min(g.combat.energy, 90);
      return orbit(0.6, 2.2, 6.5, 2.2, 1.0)(u);
    },
  },
  {
    id: "s10-pierce",
    seconds: 4.5,
    enter: () => {
      g.combat.energy = 100;
      game.ult();
    },
  },
  {
    id: "s11-tempest",
    seconds: 6.5,
    enter: () => {
      g.combat.energy = 200;
      game.ult();
    },
    // from above: the ring of blades, then the lotus opening on the ground
    frame: orbit(Math.PI - 0.5, Math.PI + 0.4, 9.5, 5.2, 1.0, 0.42),
  },
  {
    id: "s12-levelup",
    seconds: 3,
    enter: () => {
      g.level += 1;
      g.levelUp();
    },
  },
  // ---- the close: dusk over the water, the title
  {
    id: "s13-dusk",
    seconds: 6,
    enter: () => {
      game.brawl(0);
      g.duskTarget = () => 0.85;
      g.daylight(0, true);
    },
    frame: glide([36, -25.5, 3.6], [28.5, -21.5, 3.1], [12, -7.5, 4.8], [12, -7.5, 4.4]),
  },
  { id: "s14-title", seconds: 7, frame: glide([28, 38, 27], [35, 47, 24.5], [64, 76, 14], [65, 78, 14]) },
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
  const filmed = !only || shot.id.startsWith(only);
  for (let i = 0; i < frames; i++) {
    const u = frames > 1 ? i / (frames - 1) : 0;
    cam = shot.frame ? shot.frame(u) : null;
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
