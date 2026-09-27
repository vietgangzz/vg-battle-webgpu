/**
 * SORA struck (headless, Dawn): a pack closes on her and the frames right after
 * each blow that lands on her are kept, at the screen's own aspect (--size),
 * to see the hurt effects whole.
 *
 *   node tools/run.mjs tools/hurt-shots.ts --size 1400x986
 *   ./tools/to-png.sh tools/.out/hurt
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { setup } from "./dawn";

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const [W, H] = arg("--size", "1400x986").split("x").map(Number);
const env = await setup(W, H);
const { THREE, fs, post, framing, tick, grab, renderer } = env;
const { WorldData } = await import("../src/battle/world/data");
const { Explore } = await import("../src/battle/world/explore");
const { PACKS } = await import("../src/battle/world/monsters");
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
const player = { fs, post, renderer, view: framing, pace: () => 1, renderPosed(p: () => void) { tick(); p(); post.render(); return true; } };
const game = new Explore(player as never, data, {}, buildCreatures(cman, cblobs));
game.start(true);
await renderer.compileAsync(fs.scene, fs.camera);
const out = "tools/.out/hurt";
mkdirSync(out, { recursive: true });
const pack = PACKS[4];
game.hero.place(new THREE.Vector3(pack.x - 6, pack.y, 0), 90);
game.brawl(2, false);
let t = 0;
let n = 0;
let last = game.hero.hp;
const after: number[] = [];
for (let i = 0; i < 60 * 25 && n < 8; i++) {
  game.frame((t += 1 / 60) * 1000);
  game.hero.hp = Math.max(game.hero.hp, 40);
  if (game.hero.hp < last - 0.5) after.push(i + 2, i + 6, i + 12);
  last = game.hero.hp;
  if (after.length && i >= after[0]) {
    after.shift();
    await env.device.queue.onSubmittedWorkDone();
    writeFileSync(`${out}/s${String(n++).padStart(2, "0")}.${env.ext}`, await grab());
  }
}
writeFileSync(`${out}/size.txt`, `${W}x${H}\n`);
console.log(`${n} frames after blows`);
process.exit(0);
