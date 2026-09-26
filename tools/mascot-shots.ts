/**
 * SORA up close in the valley (headless, Dawn): front, three-quarter, back,
 * running, and from the game's own camera, to judge the mascot's look.
 *
 *   node tools/run.mjs tools/mascot-shots.ts --size 1280x720
 *   ./tools/to-png.sh tools/.out/mascot
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { setup } from "./dawn";

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const [W, H] = arg("--size", "1280x720").split("x").map(Number);
const out = arg("--out", "tools/.out/mascot");
const env = await setup(W, H);
const { THREE, fs, post, framing, tick, grab, renderer } = env;
const { WorldData } = await import("../src/battle/world/data");
const { Explore } = await import("../src/battle/world/explore");

const manifest = JSON.parse(readFileSync("src/battle/gen/world-ninh-binh.json", "utf8"));
const bin = readFileSync("assets/world/ninh-binh.bin");
const data = new WorldData(manifest, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
// the shot's own camera, laid over the game's each frame (null: the game's)
let cam: { eye: [number, number, number]; at: [number, number, number]; tan: number } | null = null;
const player = {
  fs,
  post,
  view: framing,
  pace() {
    return 1;
  },
  renderPosed(pose: () => void) {
    tick();
    pose();
    if (cam) {
      const h = game.hero.pos;
      fs.setCamera(new THREE.Vector3(h.x + cam.eye[0], h.y + cam.eye[1], h.z + cam.eye[2]), new THREE.Vector3(h.x + cam.at[0], h.y + cam.at[1], h.z + cam.at[2]), cam.tan, framing);
    }
    if (process.argv.includes("--peek")) {
      const S = (globalThis as { __SH?: { node: { value: unknown } }[] }).__SH;
      console.log("at render", JSON.stringify(S?.[0].node.value), JSON.stringify(S?.[1].node.value));
    }
    if (process.argv.includes("--bigshadow")) {
      const S = (globalThis as { __SH?: { node: { value: { set: (...a: number[]) => void } } }[] }).__SH;
      S?.[0].node.value.set(game.hero.pos.x, game.hero.pos.y, 3, 1);
    }
    post.render();
    return true;
  },
};
const game = new Explore(player as never, data, {});
game.start(true);
await renderer.compileAsync(fs.scene, fs.camera);
mkdirSync(out, { recursive: true });
let t = 0;
const run = async (seconds: number, stick: [number, number]) => {
  game.setStick(stick[0], stick[1]);
  for (let i = 0; i < seconds * 60; i++) game.frame((t += 1 / 60) * 1000);
};
let n = 0;
const shot = async (c: typeof cam) => {
  cam = c;
  game.frame((t += 1 / 60) * 1000);
  await env.device.queue.onSubmittedWorkDone();
  writeFileSync(`${out}/s${String(n++).padStart(2, "0")}.${env.ext}`, await grab());
};
(globalThis as { __SH?: unknown }).__SH = (await import("../src/battle/world/shaders")).SHADOWS;
await run(3, [0, 0]);
if (process.argv.includes("--debug")) {
  const { SHADOWS } = await import("../src/battle/world/shaders");
  console.log("shadow0", SHADOWS[0].node.value, "hero", game.hero.pos, game.hero.groundZ);
  let terrain: import("three/webgpu").Mesh | null = null;
  fs.scene.traverse((o) => {
    if (o.name === "world:terrain") terrain = o as never;
  });
  const sh = await (renderer as unknown as { debug: { getShaderAsync: (s: unknown, c: unknown, m: unknown) => Promise<{ fragmentShader: string }> } }).debug.getShaderAsync(fs.scene, fs.camera, terrain);
  writeFileSync("/tmp/claude-501/terrain.wgsl", sh.fragmentShader);
  console.log("wgsl written", sh.fragmentShader.length);
}
// SORA faces along her yaw; put the lens in front of her
const f = game.hero.forward;
const front = (d: number, side: number, up: number): [number, number, number] => [f.x * d - f.y * side, f.y * d + f.x * side, up];
await shot({ eye: front(2.6, 0, 1.0), at: [0, 0, 0.75], tan: 0.42 });
await shot({ eye: front(2.2, 1.6, 1.3), at: [0, 0, 0.75], tan: 0.42 });
await shot({ eye: front(-2.6, 0.4, 1.2), at: [0, 0, 0.8], tan: 0.42 });
await shot({ eye: front(0.2, 2.8, 0.9), at: [0, 0, 0.75], tan: 0.42 });
// the way to the objective from afar (--guide): the stream of arrows and the beacon
if (process.argv.includes("--guide")) {
  const { PACKS } = await import("../src/battle/world/monsters");
  n = 30;
  for (const k of [0, 2, 5]) {
    const p = PACKS[k];
    const goal = (game as unknown as { objective(): { at: { x: number; y: number } } | null }).objective();
    const yaw = goal ? (Math.atan2(goal.at.x - p.x, -(goal.at.y - p.y)) * 180) / Math.PI : 0;
    game.hero.place(new THREE.Vector3(p.x, p.y, 0), yaw);
    game.camera.reset(game.hero);
    await run(1.2, [0, 0]);
    (globalThis as { __guideDebug?: boolean }).__guideDebug = true;
    await shot(null);
    (globalThis as { __guideDebug?: boolean }).__guideDebug = false;
  }
  process.exit(0);
}
// the headband all the way round, close: her right, back-right, back-left, left
if (process.argv.includes("--band")) {
  n = 20;
  for (const [d, side] of [[0.3, -1.7], [-1.2, -1.2], [-1.2, 1.2], [0.3, 1.7], [1.4, -0.9]] as const) await shot({ eye: front(d, side, 1.35), at: [0, 0, 1.0], tan: 0.3 });
  process.exit(0);
}
// running: side view mid-stride, then the game's own camera
await run(0.6, [0, 1]);
await shot({ eye: [3.2, 1.2, 1.0], at: [0, 0, 0.75], tan: 0.42 });
await run(0.23, [0, 1]);
await shot({ eye: [3.2, 1.2, 1.0], at: [0, 0, 0.75], tan: 0.42 });
await shot(null);
writeFileSync(`${out}/size.txt`, `${W}x${H}\n`);
process.exit(0);
