/** Walk SORA along a route (steered like the demo's thumb) and report where she ends and how high: the demo's paths, checked headless. */
import { readFileSync } from "node:fs";

import { setup } from "./dawn";

const env = await setup(320, 180);
const { THREE, fs, post, framing, tick, renderer } = env;
const { WorldData } = await import("../src/battle/world/data");
const { Explore } = await import("../src/battle/world/explore");
const read = (p: string) => {
  const b = readFileSync(p);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const manifest = JSON.parse(readFileSync("src/battle/gen/world-ninh-binh.json", "utf8"));
const data = new WorldData(manifest, read("assets/world/ninh-binh.bin"), read("assets/world/ninh-binh-tex.bin"));
const player = { fs, post, renderer, view: framing, pace: () => 1, renderPosed(p: () => void) { tick(); p(); post.render(); return true; } };
const game = new Explore(player as never, data, {}, null);
game.start(true);
const route = JSON.parse(process.argv[2]) as { x: number; y: number }[];
const [sx, sy] = JSON.parse(process.argv[3]) as [number, number];
game.hero.place(new THREE.Vector3(sx, sy, 0), 90);
let t = 0;
for (let i = 0; i < 200; i++) game.frame((t += 1 / 60) * 1000);
const pts = [...route];
let i = 0;
for (; i < 60 * 30 && pts.length; i++) {
  const h = game.hero.pos;
  while (pts.length && Math.hypot(pts[0].x - h.x, pts[0].y - h.y) < 1.6) pts.shift();
  if (!pts.length) break;
  const dx = pts[0].x - h.x;
  const dy = pts[0].y - h.y;
  const len = Math.hypot(dx, dy);
  const yaw = game.camera.heading();
  const fx = Math.cos(yaw);
  const fy = Math.sin(yaw);
  const wx = dx / len;
  const wy = dy / len;
  game.setStick(fy * wx - fx * wy, fx * wx + fy * wy);
  game.frame((t += 1 / 60) * 1000);
  if (i % 60 === 0) console.log(`${(i / 60).toFixed(0)}s at ${h.x.toFixed(1)},${h.y.toFixed(1)} z ${h.z.toFixed(2)} -> ${pts[0].x},${pts[0].y}`);
}
const h = game.hero.pos;
console.log(`${pts.length ? "STUCK" : "arrived"} after ${(i / 60).toFixed(1)} s at ${h.x.toFixed(1)},${h.y.toFixed(1)} z ${h.z.toFixed(2)}`);
process.exit(0);
