/**
 * Plays the stage headless with a scripted player and writes frames: checks
 * the road renders, the ambushes spring, the moves connect and the effects land.
 *
 *   node tools/run.mjs tools/play-game.ts --size 960x768 --shots 3,12,30 --until 120
 *   ./tools/to-png.sh tools/.out/game
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { setup } from "./dawn";

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const [W, H] = arg("--size", "960x768").split("x").map(Number);
const out = arg("--out", "tools/.out/game");
const until = Number(arg("--until", "120"));
const shots = arg("--shots", "").split(",").filter(Boolean).map(Number);
/** also shoot a frame this long after every hit */
const onHit = Number(arg("--on-hit", "-1"));
const every = Number(arg("--every", "0"));

const env = await setup(W, H);
const { Adventure } = await import("../src/battle/game/adventure");
const { fs, post, framing, tick, grab } = env;

const player = {
  fs,
  post,
  view: framing,
  renderPosed(pose: () => void) {
    tick();
    pose();
    post.render();
    return true;
  },
};
const log: string[] = [];
let t = 0;
const pending: number[] = [...shots];
let lastHud = "";
const game = new Adventure(player as never, {
  hud: (s) => {
    const k = `${s.phase} hp=${s.hp} boss=${s.boss?.hp ?? "-"} ${s.banner} ${s.wave} combo=${s.combo}`;
    if (k !== lastHud) log.push(`${t.toFixed(2)} ${k}`);
    lastHud = k;
  },
  sound: (n) => {
    if (onHit >= 0 && ["hit", "heavy", "clash", "wave"].includes(n)) pending.push(t + onHit);
  },
  finisher: (s) => log.push(`${t.toFixed(2)} finisher from ${s}`),
});
game.start();

mkdirSync(out, { recursive: true });
const dt = 1 / 60;
let n = 0;
let press = 0;
let nextShot = every || Infinity;
for (t = 0; t <= until; t += dt) {
  const hero = game.hero;
  const foe = hero.target;
  // walk the road; fight whatever is near; spend the skill and the ultimate when they are up
  if (foe && foe.pos.distanceTo(hero.pos) < 6) {
    const dx = foe.pos.x - hero.pos.x;
    const dy = foe.pos.y - hero.pos.y;
    const d = Math.hypot(dx, dy);
    game.setStick(d > 2.4 ? Math.sign(dx) : 0, d > 2.4 ? -dy / d : 0);
    if (d < 3 && t >= press) {
      game.attack();
      press = t + 0.38;
      if (Math.random() < 0.08) game.skill();
      game.ult();
    }
  } else {
    game.setStick(1, -hero.pos.y * 0.2);
  }
  if (game.phase === "broken") game.finish();
  if (game.phase === "defeat") game.start(true);
  game.frame(t * 1000);
  if (t >= nextShot) {
    pending.push(t);
    nextShot += every;
  }
  pending.sort((a, b) => a - b);
  if (pending.length && t >= pending[0]) {
    while (pending.length && t >= pending[0]) pending.shift();
    await env.device.queue.onSubmittedWorkDone();
    writeFileSync(`${out}/s${String(n++).padStart(2, "0")}.${env.ext}`, await grab());
    log.push(`${t.toFixed(2)} shot s${String(n - 1).padStart(2, "0")} ${game.phase} x=${hero.pos.x.toFixed(1)}`);
  }
  if (game.phase === "results") break;
}
writeFileSync(`${out}/size.txt`, `${W}x${H}\n`);
console.log(log.join("\n"));
process.exit(0);
