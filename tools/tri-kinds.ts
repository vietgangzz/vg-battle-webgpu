/** Triangles per instance and instance counts of every mesh in the valley and SORA. */
import { readFileSync } from "node:fs";

import { setup } from "./dawn";

const env = await setup(320, 180);
const { fs, post, framing, tick, renderer } = env;
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
const rows: [string, number, number][] = [];
fs.scene.traverse((o) => {
  const m = o as unknown as { isMesh?: boolean; isInstancedMesh?: boolean; count?: number; name: string; visible: boolean; geometry?: { index?: { count: number } | null; attributes: { position: { count: number } }; instanceCount?: number } };
  if (!m.isMesh || !m.geometry) return;
  const g = m.geometry;
  const per = (g.index ? g.index.count : g.attributes.position.count) / 3;
  const inst = m.isInstancedMesh ? m.count ?? 1 : g.instanceCount && g.instanceCount !== Infinity ? g.instanceCount : 1;
  if (per * inst > 5000) rows.push([m.name + (m.visible ? "" : " (hidden)"), per, inst]);
});
rows.sort((a, b) => b[1] * b[2] - a[1] * a[2]);
console.log(rows.slice(0, 30).map(([n, p, i]) => `${((p * i) / 1e3).toFixed(0).padStart(6)}k  ${String(Math.round(p)).padStart(7)} x ${String(i).padStart(5)}  ${n}`).join("\n"));
process.exit(0);
