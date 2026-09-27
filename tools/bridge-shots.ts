/**
 * The bridge over the river (headless, Dawn): seen from the bank, SORA
 * crossing it, and SORA pushing against its railings (she must stay on the
 * deck; the log gives how far off the centre line she got).
 *
 *   node tools/run.mjs tools/bridge-shots.ts
 *   ./tools/to-png.sh tools/.out/bridge
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { setup } from "./dawn";

const env = await setup(1280, 720);
const { THREE, fs, post, framing, tick, grab, renderer } = env;
const { WorldData } = await import("../src/battle/world/data");
const { Explore } = await import("../src/battle/world/explore");

const read = (p: string) => {
  const b = readFileSync(p);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const manifest = JSON.parse(readFileSync("src/battle/gen/world-ninh-binh.json", "utf8"));
const data = new WorldData(manifest, read("assets/world/ninh-binh.bin"), read("assets/world/ninh-binh-tex.bin"));
type V3 = [number, number, number];
let cam: { eye: V3; at: V3 } | null = null;
const player = {
  fs,
  post,
  renderer,
  view: framing,
  pace: () => 1,
  renderPosed(pose: () => void) {
    tick();
    pose();
    if (cam) fs.setCamera(new THREE.Vector3(...cam.eye), new THREE.Vector3(...cam.at), 0.42, framing);
    post.render();
    return true;
  },
};
const game = new Explore(player as never, data, {}, null);
game.start(true);
await renderer.compileAsync(fs.scene, fs.camera);
const out = "tools/.out/bridge";
mkdirSync(out, { recursive: true });
let n = 0;
let t = 0;
const step = () => game.frame((t += 1 / 60) * 1000);
const shoot = async () => {
  await env.device.queue.onSubmittedWorkDone();
  writeFileSync(`${out}/s${String(n++).padStart(2, "0")}.${env.ext}`, await grab());
};
const [[ax, ay], [bx, by]] = manifest.markers.find((m: { type: string }) => m.type === "bridge")?.line ?? (manifest as { bridge: [[number, number], [number, number]] }).bridge;
const mid = new THREE.Vector3((ax + bx) / 2, (ay + by) / 2, 0);
const len = Math.hypot(bx - ax, by - ay);
const along = new THREE.Vector2(bx - ax, by - ay).normalize();
const across = new THREE.Vector2(-along.y, along.x);
const ground = (x: number, y: number) => game.world.ground.at(x, y);
const hero = game.hero;
for (let i = 0; i < 180; i++) step();
// from the bank, side on, and from further along the river
const gz = ground(mid.x, mid.y);
for (const [ox, oy, h] of [
  [across.x * 16 - along.x * 6, across.y * 16 - along.y * 6, 4],
  [-across.x * 14 + along.x * 10, -across.y * 14 + along.y * 10, 6],
]) {
  cam = { eye: [mid.x + ox, mid.y + oy, gz + h], at: [mid.x, mid.y, gz + 1.2] };
  for (let i = 0; i < 4; i++) step();
  await shoot();
}
cam = null;
// SORA walks onto the deck, then pushes across it, both ways
const start = new THREE.Vector3(ax - along.x * 3, ay - along.y * 3, 0);
hero.place(start, (Math.atan2(along.x, -along.y) * 180) / Math.PI);
game.camera.reset(hero);
const stickTo = (wx: number, wy: number) => {
  const yaw = game.camera.heading();
  game.setStick(wx * Math.sin(yaw) - wy * Math.cos(yaw), wx * Math.cos(yaw) + wy * Math.sin(yaw));
};
let worst = 0;
let sink = 0;
for (let i = 0; i < 60 * 9; i++) {
  const s = i / 60;
  // on along the deck; at 3 s and 6 s a hard push to either side
  const side = s > 3 && s < 4.5 ? 1 : s > 6 && s < 7.5 ? -1 : 0;
  stickTo(along.x * (side ? 0.3 : 1) + across.x * side, along.y * (side ? 0.3 : 1) + across.y * side);
  step();
  const u = (hero.pos.x - ax) * along.x + (hero.pos.y - ay) * along.y;
  if (u > 1 && u < len - 1) worst = Math.max(worst, Math.abs((hero.pos.x - ax) * across.x + (hero.pos.y - ay) * across.y));
  // her feet against the deck's own height there (she must walk on it, not sink into it)
  const d = manifest.deck as { a: number[]; b: number[]; rise: number } | undefined;
  if (d) {
    const ddx = d.b[0] - d.a[0];
    const ddy = d.b[1] - d.a[1];
    const tt = ((hero.pos.x - d.a[0]) * ddx + (hero.pos.y - d.a[1]) * ddy) / (ddx * ddx + ddy * ddy);
    if (tt > 0.05 && tt < 0.95) sink = Math.max(sink, d.a[2] + (d.b[2] - d.a[2]) * tt + d.rise * Math.sin(Math.PI * tt) - hero.pos.z);
  }
  if (i === 150 || i === 250 || i === 400) await shoot();
}
console.log(`bridge ${len.toFixed(1)} m; SORA at most ${worst.toFixed(2)} m off its centre line, at most ${sink.toFixed(2)} m below the deck`);
writeFileSync(`${out}/size.txt`, "1280x720\n");
process.exit(0);
