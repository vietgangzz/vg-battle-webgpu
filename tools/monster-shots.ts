/**
 * Stages a fight with a wild pack (headless, Dawn) and grabs frames: the pack
 * idling, noticing SORA, closing in, a kiếm khí in flight, blows landing.
 *
 *   node tools/run.mjs tools/monster-shots.ts --pack 4 --size 1280x720
 *   ./tools/to-png.sh tools/.out/monsters
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { setup } from "./dawn";

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const [W, H] = arg("--size", "1280x720").split("x").map(Number);
const out = arg("--out", "tools/.out/monsters");
const packIndex = Number(arg("--pack", "4"));
const env = await setup(W, H);
const { THREE, fs, post, framing, tick, grab, renderer } = env;
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
const player = {
  fs,
  post,
  renderer,
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
const log: string[] = [];
const game = new Explore(player as never, data, { hud: () => {}, pop: (p) => log.push(`pop ${p.kind} ${p.value}`) }, buildCreatures(cman, cblobs));
game.start(true);
await renderer.compileAsync(fs.scene, fs.camera);
const pack = PACKS[packIndex];
// stand 20 m from the pack, facing it
if (process.argv.includes("--noink")) (post as unknown as { look: { ink: { value: number } } }).look.ink.value = 0;
if (process.argv.includes("--nosharp")) (post as unknown as { look: { sharpen: { value: number } } }).look.sharpen.value = 0;
if (process.argv.includes("--mrtcheck")) {
  const rows = new Map<string, number>();
  fs.scene.traverse((o) => {
    const mats = (o as import("three/webgpu").Mesh).material;
    if (!mats) return;
    for (const m of Array.isArray(mats) ? mats : [mats]) {
      const k = `${m.type} transparent=${m.transparent} blend=${m.blending} dw=${m.depthWrite} mrt=${!!(m as { mrtNode?: unknown }).mrtNode}`;
      rows.set(k, (rows.get(k) ?? 0) + 1);
    }
  });
  console.log([...rows].map(([k, v]) => `${v} ${k}`).join("\n"));
}
const hero = game.hero;
const from = new THREE.Vector3(pack.x - 20, pack.y - 6, 0);
hero.place(from, 0);
mkdirSync(out, { recursive: true });
let n = 0;
// --tempest: the lotus tempest in the middle of the pack (two full charges at 9 s), shot through its arc
const tempest = process.argv.includes("--tempest");
const shots = tempest ? [9.35, 9.6, 9.8, 10.0, 10.3, 10.9] : [3.2, 5.0, 6.2, 6.5, 6.8, 8.5, 10.5, 12.5];
let t = 0;
for (; t <= 13; t += 1 / 60) {
  const target = hero.target;
  const dx = pack.x - hero.pos.x;
  const dy = pack.y - hero.pos.y;
  const d = Math.hypot(dx, dy);
  // walk toward the pack until they notice, then throw kiếm khí from range, then close in
  const yaw = game.camera.heading();
  const go = t > 3.5 && d > (target ? 3 : 8) ? 1 : 0;
  const wx = (dx / d) * go;
  const wy = (dy / d) * go;
  game.setStick(wx * Math.sin(yaw) - wy * Math.cos(yaw), wx * Math.cos(yaw) + wy * Math.sin(yaw));
  if (t > 6 && t < 6.1) game.shoot();
  if (tempest && t > 9 && t < 9.02) {
    (game as unknown as { combat: { energy: number } }).combat.energy = 200;
    game.ult();
  } else if (t > 8 && target && hero.pos.distanceTo(target.pos) < 3.2 && Math.floor(t * 60) % 20 === 0 && !(tempest && t > 8.8)) game.attack();
  game.frame(t * 1000);
  if (Math.floor(t * 60) % 60 === 0) {
    const ms = (game as unknown as { monsters: { kind: string; pack: number; state: string; aggro: boolean; hp: number; pos: { x: number; y: number }; alive: boolean }[] }).monsters.filter((m) => m.pack === packIndex);
    log.push(`${t.toFixed(1)} ` + ms.map((m) => `${m.kind}:${m.state}${m.aggro ? "!" : ""} hp${m.hp.toFixed(0)} d${Math.hypot(m.pos.x - hero.pos.x, m.pos.y - hero.pos.y).toFixed(1)}`).join("  "));
  }
  if (shots.length && t >= shots[0]) {
    shots.shift();
    await env.device.queue.onSubmittedWorkDone();
    writeFileSync(`${out}/s${String(n++).padStart(2, "0")}.${env.ext}`, await grab());
    log.push(`${t.toFixed(1)} shot hero ${hero.pos.x.toFixed(0)},${hero.pos.y.toFixed(0)} hp ${hero.hp.toFixed(0)} lv ${game.level} xp ${game.xp}`);
  }
}
writeFileSync(`${out}/size.txt`, `${W}x${H}\n`);
console.log(log.join("\n"));
process.exit(0);
