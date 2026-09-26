/**
 * Renders the Ninh Bình valley from a few viewpoints (headless, Dawn), to
 * judge the art without a device.
 *
 *   node tools/run.mjs tools/world-shots.ts --size 1280x800
 *   ./tools/to-png.sh tools/.out/world
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { setup } from "./dawn";

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const [W, H] = arg("--size", "1280x800").split("x").map(Number);
const out = arg("--out", "tools/.out/world");
const env = await setup(W, H);
const { THREE, fs, post, framing, tick, grab, renderer } = env;
const { WorldData } = await import("../src/battle/world/data");
const { World } = await import("../src/battle/world/world");
const { MORNING } = await import("../src/battle/world/look");
const { applyLook } = await import("../src/battle/game/environment");
const { Actor } = await import("../src/battle/game/actor");

const manifest = JSON.parse(readFileSync("src/battle/gen/world-ninh-binh.json", "utf8"));
const bin = readFileSync("assets/world/ninh-binh.bin");
const data = new WorldData(manifest, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
const t0 = performance.now();
const world = new World(data, fs);
console.log("world built", Math.round(performance.now() - t0), "ms");
world.group.visible = true;
applyLook(fs, MORNING);

// SORA for scale, and the film's own world out of the way
const sora = new Actor(fs, "hero");
fs.setExternal(sora.objects, true);
fs.setExternal(["kage_body", "kage_eye0", "kage_eye1", "kage_band", "kage_hand_r", "kage_hand_l", "kage_blade", "kage_tail0", "kage_tail1"], true);
for (const n of ["kage_body", "kage_eye0", "kage_eye1", "kage_band", "kage_hand_r", "kage_hand_l", "kage_blade", "kage_tail0", "kage_tail1"]) fs.object(n).visible = false;
const spawn = manifest.markers.find((m: { type: string }) => m.type === "spawn");

type View = { name: string; eye: [number, number, number]; at: [number, number, number]; sora?: [number, number] };
const hz = (x: number, y: number) => world.ground.at(x, y);
/** The game's own framing: behind SORA's shoulder, looking where she faces. */
const follow = (name: string, x: number, y: number, dir: number, back = 6.5, up = 2.6): View => {
  const fx = Math.cos(dir);
  const fy = Math.sin(dir);
  const z = hz(x, y);
  return { name, sora: [x, y], eye: [x - fx * back, y - fy * back, z + up], at: [x + fx * 9, y + fy * 9, z + 1.4] };
};
const views: View[] = [
  follow("village", -104, -30, 0.6),
  follow("towpath", -76, -16, 0.1),
  follow("bridge", -24, -26, 1.45),
  follow("terraces", -12, 34, 0.75),
  follow("pagoda", 46, 58, 0.72),
  { name: "valley", eye: [-120, -95, 45], at: [-10, 20, 0] },
];

const bytesPerRow = Math.ceil((W * 4) / 256) * 256;
void bytesPerRow;
mkdirSync(out, { recursive: true });
fs.pose([100], [null]);
await renderer.compileAsync(fs.scene, fs.camera);
let i = 0;
for (const v of views) {
  const [sx, sy] = v.sora ?? [spawn.at[0], spawn.at[1]];
  sora.place(new THREE.Vector3(sx, sy, hz(sx, sy)), Math.atan2(v.eye[0] - sx, -(v.eye[1] - sy)) * (180 / Math.PI));
  sora.pos.z = hz(sx, sy);
  sora.rig.apply(sora);
  world.update(new THREE.Vector3(...v.eye));
  for (let k = 0; k < 3; k++) {
    tick();
    fs.pose([100], [null]);
    fs.setCamera(new THREE.Vector3(...v.eye), new THREE.Vector3(...v.at), 0.38, framing);
    post.update(100);
    post.render();
  }
  await env.device.queue.onSubmittedWorkDone();
  const t = performance.now();
  tick();
  post.render();
  await env.device.queue.onSubmittedWorkDone();
  const ms = performance.now() - t;
  writeFileSync(`${out}/s${String(i++).padStart(2, "0")}.${env.ext}`, await grab());
  console.log(v.name, ms.toFixed(1), "ms");
}
writeFileSync(`${out}/size.txt`, `${W}x${H}\n`);
process.exit(0);
