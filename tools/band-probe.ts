/** SORA's headband geometry by angle round the head (for thickening it along its own width). */
import { setup } from "./dawn";

const env = await setup(64, 64);
const band = env.fs.object("sora_band") as import("three/webgpu").Mesh;
const g = band.geometry;
const pos = g.getAttribute("position");
const nrm = g.getAttribute("normal");
console.log("verts", pos.count, "index", g.index?.count, "groups", JSON.stringify(g.groups));
g.computeBoundingBox();
console.log("bbox", g.boundingBox);
let cx = 0, cy = 0;
for (let i = 0; i < pos.count; i++) { cx += pos.getX(i); cy += pos.getY(i); }
cx /= pos.count; cy /= pos.count;
const bins = 24;
const st = Array.from({ length: bins }, () => ({ n: 0, zmin: 9, zmax: -9, rmin: 9, rmax: -9 }));
for (let i = 0; i < pos.count; i++) {
  const x = pos.getX(i) - cx, y = pos.getY(i) - cy, z = pos.getZ(i);
  const a = Math.atan2(y, x);
  const b = Math.floor(((a + Math.PI) / (2 * Math.PI)) * bins) % bins;
  const s = st[b];
  s.n++; s.zmin = Math.min(s.zmin, z); s.zmax = Math.max(s.zmax, z);
  const r = Math.hypot(x, y); s.rmin = Math.min(s.rmin, r); s.rmax = Math.max(s.rmax, r);
}
console.log("centre", cx.toFixed(3), cy.toFixed(3));
st.forEach((s, i) => console.log(((i / bins) * 360 - 180).toFixed(0).padStart(5), s.n, "z", s.zmin.toFixed(3), s.zmax.toFixed(3), "r", s.rmin.toFixed(3), s.rmax.toFixed(3)));
console.log("parent", band.parent?.name, "skinned", (band as { isSkinnedMesh?: boolean }).isSkinnedMesh, "nrm", !!nrm);
process.exit(0);
