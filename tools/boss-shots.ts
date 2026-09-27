/**
 * The tiger lord and his soldiers, staged headless (Dawn), a few frames each:
 *
 *   node tools/run.mjs tools/boss-shots.ts --lineup     the lord and his soldiers side by side, close, in the light
 *   node tools/run.mjs tools/boss-shots.ts --boss       SORA walks into the pagoda courtyard: his roar, the fight, his rage
 *   node tools/run.mjs tools/boss-shots.ts --camp 0     she walks into a camp: his soldiers answer, wave on wave
 *   ./tools/to-png.sh tools/.out/boss
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { setup } from "./dawn";

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const [W, H] = arg("--size", "1280x720").split("x").map(Number);
const out = arg("--out", "tools/.out/boss");
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
let cam: { eye: V3; at: V3; tan: number } | null = null;
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
    if (cam) fs.setCamera(new THREE.Vector3(...cam.eye), new THREE.Vector3(...cam.at), cam.tan, framing);
    post.render();
    return true;
  },
};
const log: string[] = [];
const game = new Explore(player as never, data, { hud: () => {}, pop: (p) => log.push(`pop ${p.kind} ${Math.round(p.value)}`) }, buildCreatures(cman, cblobs));
game.start(true);
await game.warm((o) => renderer.compileAsync(o, fs.camera, fs.scene));
await renderer.compileAsync(fs.scene, fs.camera);

interface M {
  kind: string;
  state: string;
  hp: number;
  maxHp: number;
  raged: boolean;
  pos: InstanceType<typeof THREE.Vector3>;
  groundZ: number;
  camp: number;
  alive: boolean;
  place(x: number, y: number, ground: number, level: number, yaw: number): void;
}
const g = game as unknown as { monsters: M[]; phase: string; hud: { boss: { hp: number; max: number; name: string } | null } };
const hero = game.hero;
const ground = (x: number, y: number) => game.world.ground.at(x, y);
mkdirSync(out, { recursive: true });
let n = 0;
const shoot = async (label: string) => {
  await env.device.queue.onSubmittedWorkDone();
  writeFileSync(`${out}/s${String(n++).padStart(2, "0")}.${env.ext}`, await grab());
  log.push(`shot ${n - 1} ${label}`);
};
const walkTo = (x: number, y: number, stop: number) => {
  const dx = x - hero.pos.x;
  const dy = y - hero.pos.y;
  const d = Math.hypot(dx, dy);
  const go = d > stop ? 1 : 0;
  const yaw = game.camera.heading();
  const wx = (dx / d) * go;
  const wy = (dy / d) * go;
  game.setStick(wx * Math.sin(yaw) - wy * Math.cos(yaw), wx * Math.cos(yaw) + wy * Math.sin(yaw));
};
const state = () =>
  g.monsters
    .filter((m) => m.alive && m.pos.distanceTo(hero.pos) < 30)
    .map((m) => `${m.kind}:${m.state}${m.raged ? "*" : ""} hp${m.hp.toFixed(0)}/${m.maxHp} d${m.pos.distanceTo(hero.pos).toFixed(1)}`)
    .join("  ");

let t = 0;
const step = () => {
  game.frame(t * 1000);
  t += 1 / 60;
};

if (process.argv.includes("--lineup")) {
  // an open lawn by the river, the three facing the camera
  const x = 6;
  const y = -30;
  hero.place(new THREE.Vector3(x - 30, y, 0), 0);
  for (let i = 0; i < 90; i++) step();
  const pick = (kind: string) => g.monsters.find((m) => m.kind === kind && !m.alive)!;
  const row: [string, number][] = [
    ["goblin", -2.6],
    ["gremlin", -1.3],
    ["tiger", 0.6],
    ["dwarf", 2.6],
  ];
  // all facing the camera (yaw 0 looks down -y), SORA at the left end for scale
  for (const [kind, dx] of row) pick(kind).place(x + dx, y, ground(x + dx, y), 3, 0);
  hero.place(new THREE.Vector3(x - 4.2, y, 0), 0);
  const z = ground(x, y);
  for (const [label, eye, at, tan] of [
    ["lineup", [x + 0.4, y - 9.5, z + 2.2], [x, y, z + 1.4], 0.42],
    ["lord close", [x + 1.2, y - 4.2, z + 2.6], [x, y, z + 2.1], 0.38],
  ] as [string, V3, V3, number][]) {
    cam = { eye, at, tan };
    for (let i = 0; i < 20; i++) step();
    await shoot(label);
  }
} else if (process.argv.includes("--boss")) {
  const b = manifest.markers.find((k: { type: string }) => k.type === "boss");
  const [bx, by] = b.at;
  // start 26 m out, on the side the boss faces
  const a = ((b.yaw ?? 0) * Math.PI) / 180;
  hero.place(new THREE.Vector3(bx + Math.cos(a) * 26, by + Math.sin(a) * 26, 0), 0);
  const shots = [0.5, 1.5, 1.9, 2.6, 4.5, 6.2, 8.0, 10.0, 11.2, 12.0, 13.5, 15.0];
  let woke = -1;
  for (; t < 60; ) {
    const tiger = g.monsters.find((m) => m.kind === "tiger")!;
    const since = woke < 0 ? -1 : t - woke;
    if (woke < 0) walkTo(bx, by, 0);
    else if (since > 3) walkTo(tiger.pos.x, tiger.pos.y, 3.4);
    else game.setStick(0, 0);
    if (woke < 0 && g.phase === "bossIntro") {
      woke = t;
      log.push(`${t.toFixed(1)} woke the lord`);
    }
    if (since > 3 && tiger.pos.distanceTo(hero.pos) < 4.2 && Math.floor(t * 60) % 18 === 0) game.attack();
    // a quick path to his rage: take him to just over half (the blows do the rest)
    if (since > 9 && since < 9.02) tiger.hp = tiger.maxHp * 0.52;
    // keep SORA standing for the pictures
    hero.hp = Math.max(hero.hp, 60);
    step();
    if (since >= 0 && Math.floor(since * 60) % 60 === 0) log.push(`${since.toFixed(1)} ${g.phase} boss ${g.hud.boss?.name ?? "-"} ${g.hud.boss?.hp ?? "-"}/${g.hud.boss?.max ?? "-"}  ${state()}`);
    if (since >= 0 && shots.length && since >= shots[0]) await shoot(`boss ${shots.shift()!.toFixed(1)}s ${state()}`);
    if (since > 16) break;
  }
} else {
  const ci = Number(arg("--camp", "0"));
  const c = manifest.markers.filter((k: { type: string }) => k.type === "camp")[ci];
  const [cx, cy] = c.at;
  hero.place(new THREE.Vector3(cx - 22, cy, 0), 0);
  const shots = [1.0, 2.5, 5.0, 9.0, 14.0, 20.0, 26.0];
  let woke = -1;
  for (; t < 90; ) {
    const since = woke < 0 ? -1 : t - woke;
    const near = g.monsters.filter((m) => m.alive && m.camp >= 0).sort((p, q) => p.pos.distanceTo(hero.pos) - q.pos.distanceTo(hero.pos))[0];
    if (woke < 0) walkTo(cx, cy, 0);
    else if (near) walkTo(near.pos.x, near.pos.y, 2.6);
    else game.setStick(0, 0);
    if (woke < 0 && g.phase === "camp") {
      woke = t;
      log.push(`${t.toFixed(1)} camp woke`);
    }
    if (near && near.pos.distanceTo(hero.pos) < 3.2 && Math.floor(t * 60) % 16 === 0) game.attack();
    hero.hp = Math.max(hero.hp, 60);
    step();
    if (since >= 0 && Math.floor(since * 60) % 90 === 0) log.push(`${since.toFixed(1)} ${g.phase}  ${state()}`);
    if (since >= 0 && shots.length && since >= shots[0]) await shoot(`camp ${shots.shift()!.toFixed(1)}s`);
    if (since > 28 || (since > 3 && g.phase === "roam")) {
      log.push(`${since.toFixed(1)} ${g.phase} (camp over)`);
      break;
    }
  }
}
writeFileSync(`${out}/size.txt`, `${W}x${H}\n`);
console.log(log.join("\n"));
process.exit(0);
