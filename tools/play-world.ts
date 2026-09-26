/**
 * Plays the Ninh Bình valley headless: a scripted SORA walks the route
 * (shrines, camps, the bridge, the terraces, the pagoda) and fights what she
 * meets. Checks exploring, camps, the boss and the results end to end.
 *
 *   node tools/run.mjs tools/play-world.ts --size 900x640 --every 12 --until 400
 *   ./tools/to-png.sh tools/.out/world-play
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { setup } from "./dawn";

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const [W, H] = arg("--size", "900x640").split("x").map(Number);
const out = arg("--out", "tools/.out/world-play");
const until = Number(arg("--until", "400"));
const every = Number(arg("--every", "0"));
const shots = arg("--shots", "").split(",").filter(Boolean).map(Number);

const env = await setup(W, H);
const { fs, post, framing, tick, grab, renderer } = env;
const { WorldData } = await import("../src/battle/world/data");
const { Explore } = await import("../src/battle/world/explore");
const { buildCreatures } = await import("../src/battle/world/creature");
const cman = JSON.parse(readFileSync("src/battle/gen/creatures.json", "utf8"));
const cblobs: Record<string, ArrayBuffer> = {};
for (const name of Object.keys(cman.creatures)) {
  const b = readFileSync(`assets/creatures/${name}.bin`);
  cblobs[name] = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}
const creatures = buildCreatures(cman, cblobs);

const manifest = JSON.parse(readFileSync("src/battle/gen/world-ninh-binh.json", "utf8"));
const bin = readFileSync("assets/world/ninh-binh.bin");
const data = new WorldData(manifest, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
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
let t = 0;
const log: string[] = [];
let lastHud = "";
const game = new Explore(player as never, data, {
  hud: (s) => {
    const k = `${s.phase} hp=${s.hp} ${s.banner} ${s.toast} shrines=${s.objectives.shrines} camps=${s.objectives.camps} spirits=${s.objectives.spirits} boss=${s.boss?.hp ?? "-"} lv=${s.level} xp=${s.xp}/${s.xpNext}`;
    if (k !== lastHud) log.push(`${t.toFixed(1)} ${k}`);
    lastHud = k;
  },
}, creatures);
game.start(true);
await renderer.compileAsync(fs.scene, fs.camera);

const mk = (name: string) => manifest.markers.find((m: { name: string }) => m.name === name).at as [number, number];
const route: [number, number][] = [
  mk("shrine-village"),
  mk("camp-bank"),
  [-44, -24],
  mk("shrine-bridge"),
  [-25, -22],
  [-24, -14],
  [-23, 6],
  [-22, 12],
  mk("camp-bridge"),
  [-6, 38],
  mk("shrine-terraces"),
  mk("camp-terraces"),
  [48, 62],
  [58, 71],
  mk("boss"),
];
let leg = 0;
let lastPos: { distanceTo(p: unknown): number } | null = null;
let press = 0;
mkdirSync(out, { recursive: true });
const pending = [...shots];
let nextShot = every || Infinity;
let n = 0;
for (t = 0; t <= until; t += 1 / 60) {
  const hero = game.hero;
  const foe = hero.target ?? (game.phase === "boss" ? game.boss : null);
  let goal: [number, number] = route[Math.min(leg, route.length - 1)];
  if (foe && hero.pos.distanceTo(foe.pos) < 9) goal = [foe.pos.x, foe.pos.y];
  const dx = goal[0] - hero.pos.x;
  const dy = goal[1] - hero.pos.y;
  const d = Math.hypot(dx, dy);
  if (!foe && d < 2.5 && leg < route.length - 1) leg++;
  // stuck against something for a while: log it and take the next leg
  if (Math.floor(t * 60) % 180 === 0) {
    if (lastPos && hero.pos.distanceTo(lastPos) < 0.3 && !foe && game.phase === "roam") {
      log.push(`${t.toFixed(1)} stuck at ${hero.pos.x.toFixed(1)},${hero.pos.y.toFixed(1)} (leg ${leg})`);
      leg = Math.min(leg + 1, route.length - 1);
    }
    lastPos = hero.pos.clone();
  }
  // steer: the stick is relative to the camera's heading
  const yaw = game.camera.heading();
  const wx = d > (foe ? 2.3 : 0.5) ? dx / d : 0;
  const wy = d > (foe ? 2.3 : 0.5) ? dy / d : 0;
  game.setStick(wx * Math.sin(yaw) - wy * Math.cos(yaw), wx * Math.cos(yaw) + wy * Math.sin(yaw));
  // sprint on the long walks
  game.setSprint(!foe && d > 8);
  // from range, throw kiếm khí
  const near = hero.target;
  if (near && hero.pos.distanceTo(near.pos) > 4.5 && hero.pos.distanceTo(near.pos) < 16 && t > press) {
    game.shoot();
    press = t + 0.5;
  }
  if (foe && hero.pos.distanceTo(foe.pos) < 3.2 && t > press) {
    game.attack();
    press = t + 0.38;
    game.ult();
  }
  if (game.phase === "defeat") game.start(false);
  game.frame(t * 1000);
  if (t >= nextShot) {
    pending.push(t);
    nextShot += every;
  }
  if (pending.length && t >= pending[0]) {
    while (pending.length && t >= pending[0]) pending.shift();
    await env.device.queue.onSubmittedWorkDone();
    writeFileSync(`${out}/s${String(n++).padStart(2, "0")}.${env.ext}`, await grab());
    log.push(`${t.toFixed(1)} shot s${String(n - 1).padStart(2, "0")} ${game.phase} at ${hero.pos.x.toFixed(0)},${hero.pos.y.toFixed(0)},${hero.pos.z.toFixed(1)} leg ${leg}`);
  }
  if (game.phase === "results") break;
}
writeFileSync(`${out}/size.txt`, `${W}x${H}\n`);
console.log(log.join("\n"));
process.exit(0);
