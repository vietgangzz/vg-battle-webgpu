/**
 * The valley's JavaScript cost per frame: SORA runs a loop through the village
 * and the fields (monsters waking, the meadow regrowing) while every frame's
 * CPU time is measured apart from the GPU's. Run under `node --cpu-prof` to see
 * where it goes.
 *
 *   node tools/run.mjs tools/explore-profile.ts --frames 900
 */
import { readFileSync } from "node:fs";

import { setup } from "./dawn";

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const frames = Number(arg("--frames", "900"));
const env = await setup(960, 540);
const { THREE, fs, post, framing, tick, renderer } = env;
const { WorldData } = await import("../src/battle/world/data");
const { Explore } = await import("../src/battle/world/explore");
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
let cpuRender = 0;
const player = {
  fs,
  post,
  view: framing,
  renderPosed(pose: () => void) {
    tick();
    pose();
    const t = performance.now();
    post.render();
    cpuRender += performance.now() - t;
    return true;
  },
};
const game = new Explore(player as never, data, {}, buildCreatures(cman, cblobs));
game.start(true);
await renderer.compileAsync(fs.scene, fs.camera);
game.setSprint(true);
const times: number[] = [];
let t = 3;
for (let i = 0; i < 180; i++) game.frame((t += 1 / 60) * 1000);
cpuRender = 0;
for (let i = 0; i < frames; i++) {
  // run a wide loop round the village and out into the fields
  const a = i / 240;
  game.setStick(Math.sin(a) * 0.3, 1);
  const c0 = performance.now();
  game.frame((t += 1 / 60) * 1000);
  times.push(performance.now() - c0);
  await env.device.queue.onSubmittedWorkDone();
}
// the meadow regrowing round a moving camera: one refill's cost
{
  const meadow = (game.world as unknown as { meadow: { fill(c: unknown): void } }).meadow;
  const cam = new THREE.Vector3(-100, -30, 3);
  const m0 = performance.now();
  for (let i = 0; i < 50; i++) {
    cam.x += 2.6;
    meadow.fill(cam);
  }
  console.log(`meadow refill: ${((performance.now() - m0) / 50).toFixed(2)} ms each`);
}
times.sort((p, q) => p - q);
const avg = times.reduce((p, q) => p + q, 0) / times.length;
console.log(
  `JS per frame: avg ${avg.toFixed(2)} ms, median ${times[times.length >> 1].toFixed(2)}, p95 ${times[Math.floor(times.length * 0.95)].toFixed(2)}, max ${times[times.length - 1].toFixed(2)}; of which render submit avg ${(cpuRender / frames).toFixed(2)} ms`,
);
void THREE;
process.exit(0);
