/**
 * Where the picture flickers (headless, Dawn): the camera glides along the
 * river a few centimetres a frame, and every pixel whose brightness keeps
 * flipping up and down from frame to frame (not the steady drift of a moving
 * picture) is counted. Writes the first frame and a heat map of the flips.
 *
 *   node tools/run.mjs tools/flicker.ts [--x -40 --y -16 --yaw 0] [--frames 40]
 *   -> tools/.out/flicker/frame.png, heat.png
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { setup } from "./dawn";

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const W = 960;
const H = 540;
const env = await setup(W, H);
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
const x0 = Number(arg("--x", "-40"));
const y0 = Number(arg("--y", "-16"));
const yaw = (Number(arg("--yaw", "0")) * Math.PI) / 180;
const frames = Number(arg("--frames", "40"));
const g = game.world.ground.at(x0, y0);
game.hero.place(new THREE.Vector3(x0 - 40, y0 - 40, 0), 0);
let t = 0;
for (let i = 0; i < 200; i++) game.frame((t += 1 / 60) * 1000);
const lum: Float32Array[] = [];
let first: Buffer | null = null;
for (let i = 0; i < frames; i++) {
  // gliding along at a walk (5 cm a frame), a little above the ground, looking down the river
  const s = i * 0.05;
  const ex = x0 + Math.cos(yaw + Math.PI / 2) * s;
  const ey = y0 + Math.sin(yaw + Math.PI / 2) * s;
  cam = { eye: [ex, ey, g + 3.2], at: [ex + Math.cos(yaw) * 20, ey + Math.sin(yaw) * 20, g] };
  game.frame((t += 1 / 60) * 1000);
  await env.device.queue.onSubmittedWorkDone();
  const img = await grab();
  if (!first) first = img;
  const l = new Float32Array(W * H);
  const bgra = env.ext === "bgra";
  for (let p = 0; p < W * H; p++) {
    const r = img[p * 4 + (bgra ? 2 : 0)];
    const gg = img[p * 4 + 1];
    const b = img[p * 4 + (bgra ? 0 : 2)];
    l[p] = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
  }
  lum.push(l);
}
// flips: the change from one frame to the next reverses sign, both steps large
const heat = new Float32Array(W * H);
for (let i = 2; i < lum.length; i++) {
  const a = lum[i - 2];
  const b = lum[i - 1];
  const c = lum[i];
  for (let p = 0; p < W * H; p++) {
    const d1 = b[p] - a[p];
    const d2 = c[p] - b[p];
    if (d1 * d2 < 0 && Math.abs(d1) > 14 && Math.abs(d2) > 14) heat[p] += 1;
  }
}
let total = 0;
for (let p = 0; p < W * H; p++) total += heat[p];
const out = "tools/.out/flicker";
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/frame.${env.ext}`, first!);
const rgb = Buffer.alloc(W * H * 3);
for (let p = 0; p < W * H; p++) {
  const k = Math.min(1, heat[p] / (frames * 0.25));
  const base = (lum[0][p] / 255) * 0.35;
  rgb[p * 3] = Math.round(255 * Math.min(1, base + k));
  rgb[p * 3 + 1] = Math.round(255 * base * (1 - k));
  rgb[p * 3 + 2] = Math.round(255 * base * (1 - k));
}
writeFileSync(`${out}/heat.rgb`, rgb);
spawnSync("magick", ["-size", `${W}x${H}`, "-depth", "8", `rgb:${out}/heat.rgb`, `${out}/heat.png`]);
spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", env.ext, "-s", `${W}x${H}`, "-i", `${out}/frame.${env.ext}`, `${out}/frame.png`]);
console.log(`flips per frame: ${(total / (frames - 2)).toFixed(0)} pixels of ${W * H}`);
process.exit(0);
