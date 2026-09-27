/**
 * Where the triangles go: one frame of the valley near the camp, every draw's
 * triangles by object and by pass (the scene, the river's mirror, the sun's
 * shadow map).
 *
 *   node tools/run.mjs tools/tri-census.ts
 */
import { readFileSync } from "node:fs";

import { setup } from "./dawn";

const env = await setup(1912, 880);
const { THREE, fs, post, framing, tick, renderer } = env;
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
const game = new Explore(player as never, data, {}, buildCreatures(cman, cblobs));
game.start(true);
await renderer.compileAsync(fs.scene, fs.camera);
const spots: [string, number, number, number][] = [
  ["spawn", -104, -37, 0],
  ["river bridge", -60, -20, 0],
  ["pagoda foot", 40, 60, 0],
];
const ro = renderer as unknown as { renderObject: (...a: unknown[]) => unknown; getRenderTarget: () => { width: number } | null };
const orig = ro.renderObject.bind(ro);
for (const [label, x, y, yaw] of spots) {
  game.hero.place(new THREE.Vector3(x, y, 0), yaw);
  let t = 0;
  for (let i = 0; i < 40; i++) game.frame((t += 1 / 60) * 1000);
  const rows = new Map<string, number>();
  ro.renderObject = (...a: unknown[]) => {
    const o = a[0] as { name?: string; type?: string; count?: number; isInstancedMesh?: boolean; geometry?: { index?: { count: number } | null; attributes: { position: { count: number } }; instanceCount?: number; drawRange?: { count: number } }; parent?: { name?: string; type?: string } };
    const g = o.geometry;
    const per = g ? (g.index ? g.index.count : g.attributes.position.count) / 3 : 0;
    const inst = o.isInstancedMesh ? o.count ?? 1 : g?.instanceCount && g.instanceCount !== Infinity ? g.instanceCount : 1;
    const rt = ro.getRenderTarget();
    const pass = rt ? (rt.width === 1024 ? "shadow" : rt.width < 1912 * 0.9 ? `rt${rt.width}` : "scene") : "screen";
    const key = `${pass.padEnd(7)} ${(o.name || `${o.type}<${o.parent?.name || o.parent?.type}`).replace(/@.*/, "@").slice(0, 50)}`;
    rows.set(key, (rows.get(key) ?? 0) + per * inst);
    return orig(...a);
  };
  game.frame((t += 1 / 60) * 1000);
  game.frame((t += 1 / 60) * 1000);
  ro.renderObject = orig;
  const total = [...rows.values()].reduce((p, q) => p + q, 0);
  console.log(`== ${label}: ${(total / 1e6).toFixed(2)}M triangles over two frames`);
  console.log([...rows].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([k, v]) => `${(v / 1e3).toFixed(0).padStart(7)}k ${k}`).join("\n"));
}
process.exit(0);
