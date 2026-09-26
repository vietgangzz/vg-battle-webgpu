/**
 * The cost of a fight (headless, Dawn): SORA beside a wild pack, slashing,
 * casting and throwing kiếm khí for several seconds while each frame's CPU and
 * GPU time is measured, against the same seconds spent just walking.
 *
 *   node tools/run.mjs tools/fight-profile.ts --pack 4
 */
import { readFileSync } from "node:fs";

import { setup } from "./dawn";

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const packIndex = Number(arg("--pack", "4"));
const env = await setup(Number(arg("--w", "1280")), Number(arg("--h", "720")));
const { THREE, fs, post, framing, tick, renderer } = env;
const { WorldData } = await import("../src/battle/world/data");
const { Explore } = await import("../src/battle/world/explore");
const { PACKS } = await import("../src/battle/world/monsters");
const { buildCreatures } = await import("../src/battle/world/creature");

const manifest = JSON.parse(readFileSync("src/battle/gen/world-ninh-binh.json", "utf8"));
const bin = readFileSync("assets/world/ninh-binh.bin");
const data = new WorldData(manifest, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
const cman = JSON.parse(readFileSync("src/battle/gen/creatures.json", "utf8"));
const cblobs: Record<string, ArrayBuffer> = {};
for (const name of Object.keys(cman.creatures)) {
  const b = readFileSync(`assets/creatures/${name}.bin`);
  cblobs[name] = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}
let pops = 0;
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
    post.render();
    return true;
  },
};
const game = new Explore(player as never, data, { pop: () => pops++ }, buildCreatures(cman, cblobs));
game.start(true);
await game.warm((o) => renderer.compileAsync(o, fs.camera, fs.scene));
await renderer.compileAsync(fs.scene, fs.camera);
let t = 3;
for (let i = 0; i < 180; i++) game.frame((t += 1 / 60) * 1000);
const pack = PACKS[packIndex];
game.hero.place(new THREE.Vector3(pack.x - 9, pack.y, 0), 90);

const measure = async (label: string, seconds: number, act: (i: number) => void) => {
  const cpu: number[] = [];
  const gpu: number[] = [];
  for (let i = 0; i < seconds * 60; i++) {
    act(i);
    const c0 = performance.now();
    game.frame((t += 1 / 60) * 1000);
    const c1 = performance.now();
    await env.device.queue.onSubmittedWorkDone();
    cpu.push(c1 - c0);
    gpu.push(performance.now() - c1);
  }
  const avg = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
  const p95 = (a: number[]) => [...a].sort((p, q) => p - q)[Math.floor(a.length * 0.95)];
  console.log(`${label}: cpu avg ${avg(cpu).toFixed(2)} p95 ${p95(cpu).toFixed(2)} max ${Math.max(...cpu).toFixed(1)} | gpu-wait avg ${avg(gpu).toFixed(2)} p95 ${p95(gpu).toFixed(2)}`);
};
// walk in: they notice, close in
await measure("approach", 3, () => game.setStick(0, 0.8));
game.setStick(0, 0);
// fight: slash in a rhythm, the skill, kiếm khí, the ultimate when it is ready
await measure("fight", 8, (i) => {
  if (i % 18 === 0) game.attack();
  if (i % 90 === 30) game.skill();
  if (i % 50 === 10) game.shoot();
  if (i % 120 === 60) game.ult();
  if (i % 70 === 40) game.dash();
});
await measure("after", 3, () => game.setStick(0.3, 0));
console.log(`pops ${pops}, level ${game.level}`);
process.exit(0);
