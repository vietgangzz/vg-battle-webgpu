/**
 * The title screen's backdrop (the golden-hour flight round the valley), at a
 * few points along its loop (headless, Dawn).
 *
 *   node tools/run.mjs tools/backdrop-shots.ts --size 1280x720
 *   ./tools/to-png.sh tools/.out/backdrop
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { setup } from "./dawn";

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const [W, H] = arg("--size", "1280x720").split("x").map(Number);
const out = arg("--out", "tools/.out/backdrop");
const env = await setup(W, H);
const { fs, post, framing, tick, grab, renderer } = env;
const { WorldData } = await import("../src/battle/world/data");
const { Explore } = await import("../src/battle/world/explore");

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
const game = new Explore(player as never, data, {});
mkdirSync(out, { recursive: true });
game.backdrop(0);
await renderer.compileAsync(fs.scene, fs.camera);
let n = 0;
for (const s of [0, 23, 46, 70, 93, 116]) {
  for (let k = 0; k < 3; k++) game.backdrop(s * 1000 + k * 16);
  await env.device.queue.onSubmittedWorkDone();
  writeFileSync(`${out}/s${String(n++).padStart(2, "0")}.${env.ext}`, await grab());
}
writeFileSync(`${out}/size.txt`, `${W}x${H}\n`);
process.exit(0);
