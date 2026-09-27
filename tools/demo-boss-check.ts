/**
 * The showcase demo's fight with the tiger lord, played headless with the
 * demo's own timings and dodge rule (the thumbs replaced by direct calls):
 * reports each dodge (and whether the dash went), the blows she takes, his
 * health, his rage and the finishing blow, with a few frames.
 *
 *   node tools/run.mjs tools/demo-boss-check.ts [x,y,yaw]     the fight, SORA at (x, y) (off the bridge), the lord called to meet her
 *   node tools/run.mjs tools/demo-boss-check.ts --soldiers x,y,yaw   the ambush on the towpath instead: the camera over it
 *   ./tools/to-png.sh tools/.out/demo-boss
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { setup } from "./dawn";

const out = "tools/.out/demo-boss";
const env = await setup(1426, 1003);
const { fs, post, framing, tick, grab, renderer } = env;
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
const player = { fs, post, renderer, view: framing, pace: () => 1, renderPosed(p: () => void) { tick(); p(); post.render(); return true; } };
const log: string[] = [];
const game = new Explore(player as never, data, { hud: () => {}, sound: (n) => log.push(`  ${T().toFixed(2)} sound ${n}`), pop: (p) => p.kind === "parry" && log.push(`  ${T().toFixed(2)} PARRIED`) }, buildCreatures(cman, cblobs));
game.start(true);
await game.warm((o) => renderer.compileAsync(o, fs.camera, fs.scene));
await renderer.compileAsync(fs.scene, fs.camera);
mkdirSync(out, { recursive: true });

const hero = game.hero;
let t = 0;
const T = () => t;
const step = () => {
  game.frame(t * 1000);
  t += 1 / 60;
};
let n = 0;
const shoot = async (label: string) => {
  await env.device.queue.onSubmittedWorkDone();
  writeFileSync(`${out}/s${String(n++).padStart(2, "0")}.${env.ext}`, await grab());
  log.push(`shot ${n - 1} ${label}`);
};

game.demoSetup();
for (let i = 0; i < 200; i++) step();
// SORA off the far end of the bridge (or at x,y,yaw), the lord called to meet her there
const [sx, sy, syaw] = (process.argv[2]?.startsWith("--") ? "-23.2,12.5,100" : (process.argv[2] ?? "-23.2,12.5,100")).split(",").map(Number);
let knob = { x: 0, y: 0 };
const steer = (goal: { x: number; y: number } | null, ease: number) => {
  let want = { x: 0, y: 0 };
  if (goal) {
    const dx = goal.x - hero.pos.x;
    const dy = goal.y - hero.pos.y;
    const len = Math.hypot(dx, dy) || 1;
    const yaw = game.camera.heading();
    const fx = Math.cos(yaw);
    const fy = Math.sin(yaw);
    want = { x: fy * (dx / len) - fx * (dy / len), y: fx * (dx / len) + fy * (dy / len) };
  }
  knob = { x: knob.x + (want.x - knob.x) * ease, y: knob.y + (want.y - knob.y) * ease };
  game.setStick(knob.x, knob.y);
};

if (process.argv[2] === "--soldiers") {
  // the demo's ambush: two packs round her, her blade, kiếm khí and the Heaven Pierce, the camera left to follow
  const [x, y, yaw] = process.argv[3].split(",").map(Number);
  const { Vector3 } = env.THREE;
  hero.place(new Vector3(x, y, 0), yaw);
  game.camera.reset(hero);
  for (let i = 0; i < 30; i++) step();
  game.brawl(2, false);
  const t0 = t;
  const shots = [1.2, 2.2, 2.95, 4.2, 5.6, 6.8];
  const taps: [number, () => void][] = [
    ...[0.8, 1.15, 1.5, 2.85].map((k) => [k, () => game.attack()] as [number, () => void]),
    [2.0, () => game.skill()],
    [2.6, () => game.jump()],
    [3.3, () => game.dash()],
    [3.7, () => game.shoot()],
    [4.1, () => game.charge(1)],
    [4.7, () => game.ult()],
  ];
  while (t - t0 < 7.2) {
    for (const tp of taps.filter(([k]) => t - t0 >= k)) {
      taps.splice(taps.indexOf(tp), 1);
      tp[1]();
    }
    const foe = hero.target;
    if (foe && Math.hypot(foe.pos.x - hero.pos.x, foe.pos.y - hero.pos.y) > 2.6) steer(foe.pos, 0.1);
    else steer(null, 0.1);
    step();
    if (hero.action && hero.action.t < 1 / 60 + 1e-6) log.push(`${(t - t0).toFixed(2)} move ${hero.action.def.name}`);
    if (shots.length && t - t0 >= shots[0]) await shoot(`${shots.shift()}s`);
  }
  console.log(log.filter((l) => !l.includes("sound")).join("\n"));
  process.exit(0);
}
hero.place(new env.THREE.Vector3(sx, sy, 0), syaw);
game.camera.reset(hero);
for (let i = 0; i < 30; i++) step();
game.demoLordNear(1000);
let tb = -1;
let dodgeSide = 1;
let dodgeDir = { x: 0, y: 0 };
let dodgeUntil = 0;
let dodgeReady = 0;
let parryNext = false;
let swings = 0;
let lastState = "";
let parrying = false;
const due: { at: number; run: () => void }[] = [];
const at = (s: number, run: () => void) => due.push({ at: s, run });
const near = (m: number) => {
  const l = game.demoLord();
  return !!l && Math.hypot(l.pos.x - hero.pos.x, l.pos.y - hero.pos.y) < m && t > dodgeUntil && !l.attacking;
};
let hp = hero.hp;
const shots = [2, 5, 8, 11, 14.3, 15.2];
let killed = -1;
for (; t < 120; ) {
  const lord = game.demoLord();
  if (lord && tb < 0) {
    tb = t;
    log.push(`${t.toFixed(2)} the lord is out`);
    at(tb + 0.3, () => game.shoot());
    at(tb + 0.75, () => game.setSprint(true));
    at(tb + 2.0, () => game.setSprint(false));
    const tapIf = (k: number, ok: () => boolean, run: () => void) => at(tb + k - 0.14, () => ok() && at(t + 0.14, run));
    for (const k of [2.1, 2.45, 2.8, 3.95, 4.3, 6.05, 6.6, 6.95, 9.0, 9.35, 9.7, 11.25, 11.8, 12.15, 12.5]) tapIf(k, () => near(4), () => game.attack());
    for (const k of [3.3, 8.4, 13.45]) tapIf(k, () => near(7), () => game.skill());
    for (const k of [5.8, 11.0]) tapIf(k, () => near(4), () => game.jump());
    for (const k of [5.2, 10.4]) tapIf(k, () => !near(4), () => game.shoot());
    at(tb + 7.4, () => {
      const l = game.demoLord();
      if (l && l.hp > l.maxHp * 0.5) game.demoWear(l.maxHp * 0.49);
    });
    at(tb + 13.4, () => game.charge(2));
    const ult = (k: number, tries: number) =>
      at(k, () => {
        game.ult();
        log.push(`${(t - tb).toFixed(2)} ult pressed`);
        at(t + 0.4, () => tries > 1 && game.demoCharged() && ult(t + 0.05, tries - 1));
      });
    ult(tb + 14.0, 8);
  }
  for (const d of due.filter((x) => x.at <= t)) {
    due.splice(due.indexOf(d), 1);
    d.run();
  }
  let goal: { x: number; y: number } | null = null;
  let ease = 0.1;
  if (lord) {
    const dx = hero.pos.x - lord.pos.x;
    const dy = hero.pos.y - lord.pos.y;
    const d = Math.hypot(dx, dy) || 1;
    if (lord.attacking && d < 5.5 && t >= dodgeReady && ++swings % 3 === 0) {
      dodgeReady = t + 1.3;
      log.push(`${(t - tb).toFixed(2)} takes it`);
    } else if (lord.attacking && d < 5.5 && t >= dodgeReady && (parryNext = swings % 3 === 2 && !hero.busy)) {
      dodgeReady = t + 1.3;
      parrying = true;
      game.demoHoldOff();
      dodgeUntil = t + 1.0;
      log.push(`${(t - tb).toFixed(2)} PARRY waiting, blow in ${lord.blowIn.toFixed(2)}`);
    } else if (lord.attacking && d < 5.5 && t >= dodgeReady) {
      dodgeSide = -dodgeSide;
      dodgeDir = { x: (dx / d) * 0.45 - (dy / d) * 0.9 * dodgeSide, y: (dy / d) * 0.45 + (dx / d) * 0.9 * dodgeSide };
      dodgeUntil = t + 0.45;
      dodgeReady = t + 1.3;
      log.push(`${(t - tb).toFixed(2)} DODGE d${d.toFixed(1)} her move ${hero.action?.def.name ?? "-"}`);
      at(t + 0.06, () => game.dash());
      at(t + 0.26, () => game.dash());
      at(t + 0.4, () => log.push(`   … ${hero.action?.def.name === "dash" ? "dashed" : `no dash (${hero.action?.def.name ?? "-"})`}`));
    }
    if (parrying && lord.blowIn <= 0.17) {
      parrying = false;
      dodgeUntil = t + 0.55;
      if (!hero.busy) at(t + 0.02, () => game.setGuard(true));
      at(t + 0.45, () => game.setGuard(false));
    } else if (parrying && !lord.attacking) parrying = false;
    if (parrying || (parryNext && t < dodgeUntil)) {
      // standing, facing him
    } else if (t < dodgeUntil) {
      goal = { x: hero.pos.x + dodgeDir.x * 4, y: hero.pos.y + dodgeDir.y * 4 };
      ease = 0.4;
    } else if (d > 2.9) goal = lord.pos;
  }
  steer(goal, ease);
  step();
  {
    // his moves as they begin (charge, combo blows)
    const st = (game as unknown as { tiger: { state: string } | null }).tiger?.state ?? "-";
    if (tb >= 0 && st !== lastState && ["charge", "attack", "roar"].includes(st)) log.push(`${(t - tb).toFixed(2)} lord ${st}`);
    lastState = st;
  }
  if (hero.hp < hp - 0.5) {
    const l = game.demoLord();
    const face = l ? Math.abs(((hero.yaw - (Math.atan2(l.pos.y - hero.pos.y, l.pos.x - hero.pos.x) * 180) / Math.PI + 540) % 360) - 180) : -1;
    log.push(`${(t - tb).toFixed(2)} she is hit ${(hp - hero.hp).toFixed(0)} (guard ${hero.guardHeld} since ${(t - hero.guardSince).toFixed(2)}?, off his bearing ${face.toFixed(0)}°, busy ${hero.busy})`);
  }
  hp = hero.hp;
  const l2 = game.demoLord();
  if (tb >= 0 && !l2 && killed < 0) {
    killed = t;
    log.push(`${(t - tb).toFixed(2)} he falls`);
  }
  if (tb >= 0 && Math.floor((t - tb) * 60) % 60 === 0 && l2) log.push(`${(t - tb).toFixed(1)} lord hp ${l2.hp.toFixed(0)}/${l2.maxHp} ${l2.attacking ? "swinging" : ""}`);
  if (tb >= 0 && shots.length && t - tb >= shots[0]) await shoot(`${shots.shift()}s`);
  if (killed > 0 && t > killed + 2) break;
}
writeFileSync(`${out}/size.txt`, "1426x1003\n");
console.log(log.join("\n"));
process.exit(0);
