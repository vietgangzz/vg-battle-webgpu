/**
 * Every stage's scenery, built in code: the crimson plain's torii and stone
 * lanterns, and Vietnam's landscapes — the karst towers of Tràng An rising out
 * of a jade river with sampans and lotus, Hạ Long's islets and junks at
 * sunset, the ridge path above a sea of clouds on Fansipan.
 *
 * Static pieces are merged per material across the whole stage (a stage is a
 * dozen draw calls); boats are kept apart so they can ride the swell.
 */
import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import type { Materials, MatName } from "./shading";

export interface Part {
  geo: THREE.BufferGeometry;
  mat: MatName;
  outline?: boolean;
}

// ---------------------------------------------------------------- helpers
export function mulberry(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth 1D value noise in [0, 1]. */
function noise1(x: number, seed: number) {
  const h = (i: number) => {
    const s = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return h(i) * (1 - u) + h(i + 1) * u;
}

const fbm1 = (x: number, seed: number) => noise1(x, seed) * 0.55 + noise1(x * 2.1, seed + 7) * 0.3 + noise1(x * 4.3, seed + 13) * 0.15;

const place = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
  g.rotateX(rx).rotateY(ry).rotateZ(rz);
  return g.translate(x, y, z);
};

/** Z-up cylinder standing on z = z0. */
const post = (r0: number, r1: number, h: number, z0 = 0, seg = 16) => place(new THREE.CylinderGeometry(r1, r0, h, seg), 0, 0, z0 + h / 2, Math.PI / 2);

const box = (w: number, d: number, h: number, x = 0, y = 0, z = 0) => place(new THREE.BoxGeometry(w, d, h), x, y, z + h / 2);

/** A box whose top ends curl up (torii kasagi, Vietnamese roof ridges). */
function curvedBeam(len: number, h: number, depth: number, lift: number, segs = 24) {
  const g = new THREE.BoxGeometry(len, depth, h, segs, 1, 1);
  const p = g.getAttribute("position");
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) / (len / 2);
    p.setZ(i, p.getZ(i) + lift * u * u * u * u);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * A hipped roof with upturned corners (mái cong): a flattened pyramid whose
 * eaves lift at the four corners, like the pagodas of the north.
 */
function roof(w: number, d: number, h: number, curl: number) {
  const g = new THREE.CylinderGeometry(0.02, 1, 1, 4, 3, false);
  g.rotateY(Math.PI / 4);
  g.rotateX(Math.PI / 2);
  const p = g.getAttribute("position");
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i) + 0.5;
    // eave corners (low, far from the centre) sweep up
    const corner = Math.pow(Math.abs(x * y) * 2, 1.5) * (1 - z);
    p.setXYZ(i, x * w * 0.72, y * d * 0.72, z * h + corner * curl);
  }
  g.computeVertexNormals();
  return g;
}

/** Extrude a cross-section (y, z pairs) along the road (world x). */
function strip(section: [number, number][], x0: number, x1: number) {
  const shape = new THREE.Shape(section.map(([y, z]) => new THREE.Vector2(y, z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: x1 - x0, bevelEnabled: false, steps: Math.ceil((x1 - x0) / 4) });
  // shape (u, v) extruded along z  ->  world (x = z, y = u, z = v)
  g.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, x0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- the crimson plain (the film's night)
function torii(s = 1): Part[] {
  const w = 3.3 * s;
  const H = 5.4 * s;
  return [
    { geo: post(0.3 * s, 0.26 * s, H).translate(-w, 0, 0), mat: "lacquer", outline: true },
    { geo: post(0.3 * s, 0.26 * s, H).translate(w, 0, 0), mat: "lacquer", outline: true },
    { geo: post(0.42 * s, 0.42 * s, 0.5 * s).translate(-w, 0, 0), mat: "ink" },
    { geo: post(0.42 * s, 0.42 * s, 0.5 * s).translate(w, 0, 0), mat: "ink" },
    { geo: place(new THREE.BoxGeometry(2 * w + 1.4 * s, 0.34 * s, 0.34 * s), 0, 0, H - 1.2 * s), mat: "lacquer", outline: true },
    { geo: place(curvedBeam(2 * w + 2.2 * s, 0.36 * s, 0.5 * s, 0.45 * s), 0, 0, H - 0.1 * s), mat: "lacquer", outline: true },
    { geo: place(curvedBeam(2 * w + 2.8 * s, 0.3 * s, 0.62 * s, 0.6 * s), 0, 0, H + 0.26 * s), mat: "ink", outline: true },
    { geo: place(new THREE.BoxGeometry(0.7 * s, 0.14 * s, 0.9 * s), 0, 0, H - 0.6 * s), mat: "ink" },
    { geo: place(new THREE.BoxGeometry(0.5 * s, 0.16 * s, 0.66 * s), 0, -0.02 * s, H - 0.6 * s), mat: "lacquer" },
  ];
}

function stoneLantern(light: MatName, stone: MatName = "stone"): Part[] {
  return [
    { geo: post(0.42, 0.36, 0.22), mat: stone, outline: true },
    { geo: post(0.16, 0.14, 1.0, 0.22, 10), mat: stone, outline: true },
    { geo: place(new THREE.CylinderGeometry(0.38, 0.3, 0.14, 6), 0, 0, 1.29, Math.PI / 2), mat: stone },
    { geo: place(new THREE.BoxGeometry(0.46, 0.46, 0.46), 0, 0, 1.59), mat: light },
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sy) => ({ geo: place(new THREE.BoxGeometry(0.1, 0.1, 0.5), sx * 0.24, sy * 0.24, 1.59), mat: stone }))),
    { geo: place(new THREE.ConeGeometry(0.62, 0.42, 6), 0, 0, 2.03, Math.PI / 2), mat: stone, outline: true },
    { geo: place(new THREE.SphereGeometry(0.1, 10, 8), 0, 0, 2.3), mat: stone },
  ];
}

function rock(seed: number, h: number, r: number, mat: MatName = "stone"): Part[] {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.getAttribute("position");
  const rnd = mulberry(seed);
  const jitter = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!jitter.has(key)) jitter.set(key, 0.75 + rnd() * 0.5);
    const k = jitter.get(key)!;
    p.setXYZ(i, p.getX(i) * r * k, p.getY(i) * r * k * 0.8, (p.getZ(i) * 0.5 + 0.5) * h * k);
  }
  g.computeVertexNormals();
  return [{ geo: g.rotateZ(rnd() * Math.PI), mat, outline: true }];
}

function pillar(seed: number): Part[] {
  const rnd = mulberry(seed);
  const h = 2.4 + rnd() * 1.6;
  return [
    { geo: post(0.5, 0.46, 0.3), mat: "stone", outline: true },
    { geo: post(0.36, 0.34, h, 0.3, 12), mat: "stone", outline: true },
    { geo: place(new THREE.CylinderGeometry(0.34, 0.34, 1.6, 12), 1.2, 0.3, 0.34, 0, 0, Math.PI / 2 + 0.2), mat: "stone", outline: true },
    { geo: place(new THREE.TorusGeometry(0.4, 0.06, 6, 20), 0, 0, 0.3 + h * 0.8), mat: "moss" },
  ];
}

function shards(seed: number): Part[] {
  const rnd = mulberry(seed);
  const out: Part[] = [];
  for (let i = 0; i < 5; i++) {
    const g = new THREE.OctahedronGeometry(0.25 + rnd() * 0.35, 0);
    g.scale(1, 1, 1.6 + rnd());
    out.push({ geo: place(g, (rnd() - 0.5) * 2.4, (rnd() - 0.5) * 1.4, 2.2 + rnd() * 2.8, rnd() * 3, rnd() * 3, rnd() * 3), mat: "stone", outline: true });
  }
  return out;
}

// ---------------------------------------------------------------- Vietnam
/**
 * A karst tower (núi đá vôi): a sheer limestone column, swelling and pinched by
 * noise, crowned and hung with jungle.
 */
function karst(seed: number, h: number, r: number, round = 0.3): Part[] {
  const rnd = mulberry(seed);
  const seg = 14;
  const rows = 10;
  const g = new THREE.CylinderGeometry(1, 1, 1, seg, rows, false);
  g.rotateX(Math.PI / 2);
  const p = g.getAttribute("position");
  const tilt = (rnd() - 0.5) * 0.25;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const u = p.getZ(i) + 0.5;
    const a = Math.atan2(y, x);
    // bulges and fluting, a waist, and a domed crown
    let k = 0.8 + 0.4 * noise1(a * 2.2 + u * 3, seed) + 0.12 * Math.sin(a * 5 + seed);
    k *= 1 - 0.22 * Math.sin(u * Math.PI * 0.9) * (0.5 + rnd() * 0.01);
    const crown = u > 1 - round ? Math.sqrt(Math.max(0, 1 - Math.pow((u - (1 - round)) / round, 2))) : 1;
    const rr = r * k * (0.35 + 0.65 * crown) * (1.15 - 0.3 * u);
    p.setXYZ(i, Math.cos(a) * rr + tilt * u * h, Math.sin(a) * rr, u * h);
  }
  g.computeVertexNormals();
  const out: Part[] = [{ geo: g, mat: "limestone" }];
  // jungle: a cap on the crown, and clumps clinging to the ledges
  const n = 4 + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) {
    const cap = i === 0;
    const z = cap ? h * 0.97 : h * (0.45 + rnd() * 0.45);
    const a = rnd() * Math.PI * 2;
    const rad = cap ? r * 0.65 : r * (0.3 + rnd() * 0.25);
    const b = new THREE.IcosahedronGeometry(rad, 1);
    b.scale(1, 1, cap ? 0.55 : 0.7);
    const off = cap ? 0 : r * 0.72;
    out.push({ geo: place(b, Math.cos(a) * off + tilt * (z / h) * h, Math.sin(a) * off, z), mat: "jungle" });
  }
  return out;
}

/** A far mountain range: a wall of peaks along x, facing the road. */
function range(x0: number, x1: number, y: number, h: number, seed: number, mat: MatName, jag = 0.5): Part {
  const n = Math.ceil((x1 - x0) / 3);
  const pos: number[] = [];
  const idx: number[] = [];
  const depth = h * 0.6;
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const top = h * (0.35 + 0.65 * fbm1(x / (h * 1.4), seed)) + jag * h * 0.15 * (noise1(x * 0.5, seed + 3) - 0.5);
    pos.push(x, y, -12, x, y + depth * 0.3, top * 0.6, x, y + depth, top);
  }
  for (let i = 0; i < n; i++) {
    const a = i * 3;
    const b = (i + 1) * 3;
    idx.push(a, b, a + 1, b, b + 1, a + 1, a + 1, b + 1, a + 2, b + 1, b + 2, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geo: g, mat };
}

/** Tam quan: the three-bay pagoda gate, two tiers of upturned tile roofs, a gilded plaque. */
function pagodaGate(s = 1, roofMat: MatName = "tile"): Part[] {
  const out: Part[] = [];
  const H = 4.2 * s;
  for (const x of [-3.2, -1.3, 1.3, 3.2]) {
    out.push({ geo: post(0.3 * s, 0.26 * s, H).translate(x * s, 0, 0), mat: "wood", outline: true });
    out.push({ geo: box(0.7 * s, 0.7 * s, 0.4 * s, x * s, 0, 0), mat: "plaster" });
  }
  // the lower side roofs and the tall middle roof
  out.push({ geo: place(roof(3.2 * s, 2.2 * s, 1.0 * s, 0.6 * s), -2.25 * s, 0, H - 0.5 * s), mat: roofMat, outline: true });
  out.push({ geo: place(roof(3.2 * s, 2.2 * s, 1.0 * s, 0.6 * s), 2.25 * s, 0, H - 0.5 * s), mat: roofMat, outline: true });
  out.push({ geo: box(3.0 * s, 0.5 * s, 1.1 * s, 0, 0, H), mat: "plaster" });
  out.push({ geo: place(roof(4.2 * s, 2.6 * s, 1.3 * s, 0.8 * s), 0, 0, H + 0.95 * s), mat: roofMat, outline: true });
  out.push({ geo: place(curvedBeam(4.4 * s, 0.18 * s, 0.26 * s, 0.5 * s), 0, 0, H + 2.2 * s), mat: roofMat });
  out.push({ geo: box(1.3 * s, 0.14 * s, 0.6 * s, 0, -0.3 * s, H + 0.25 * s), mat: "gold" });
  // lanterns under the eaves
  for (const x of [-2.25, 2.25]) out.push({ geo: place(new THREE.SphereGeometry(0.22 * s, 10, 8).scale(1, 1, 1.3), x * s, -0.2 * s, H - 0.9 * s), mat: "red" });
  return out;
}

/** Bảo tháp: a small tiered stupa. */
function stupa(s = 1, roofMat: MatName = "tile"): Part[] {
  const out: Part[] = [{ geo: box(1.8 * s, 1.8 * s, 0.4 * s), mat: "plaster", outline: true }];
  let z = 0.4 * s;
  for (let i = 0; i < 4; i++) {
    const w = (1.3 - i * 0.22) * s;
    out.push({ geo: box(w, w, 0.8 * s, 0, 0, z), mat: "plaster", outline: true });
    out.push({ geo: place(roof(w * 1.6, w * 1.6, 0.4 * s, 0.25 * s), 0, 0, z + 0.7 * s), mat: roofMat, outline: true });
    z += 1.05 * s;
  }
  out.push({ geo: place(new THREE.ConeGeometry(0.18 * s, 0.9 * s, 8), 0, 0, z + 0.4 * s, Math.PI / 2), mat: "gold" });
  return out;
}

/** A sampan (thuyền đò) with a rower in a conical hat. */
function sampan(seed: number): Part[] {
  const rnd = mulberry(seed);
  const hull = curvedBeam(3.4, 0.4, 0.95, 0.35, 16);
  const inner = curvedBeam(3.0, 0.2, 0.7, 0.28, 12);
  const out: Part[] = [
    { geo: place(hull, 0, 0, 0.05), mat: "darkwood", outline: true },
    { geo: place(inner, 0, 0, 0.28), mat: "wood" },
  ];
  const x = 1.0 * (rnd() < 0.5 ? -1 : 1);
  out.push({ geo: post(0.13, 0.11, 0.55, 0.3, 8).translate(x, 0, 0), mat: "cloth" });
  out.push({ geo: place(new THREE.SphereGeometry(0.11, 10, 8), x, 0, 0.98), mat: "hat" });
  out.push({ geo: place(new THREE.ConeGeometry(0.34, 0.18, 16), x, 0, 1.1, Math.PI / 2), mat: "hat", outline: true });
  // the oar
  out.push({ geo: place(new THREE.CylinderGeometry(0.025, 0.025, 1.9, 6), x - 0.25, 0.25, 0.7, 0.9, 0, 0.3), mat: "wood" });
  return out;
}

/** A Hạ Long junk: a high-sterned hull and battened sails the colour of the sunset. */
function junk(seed: number): Part[] {
  const rnd = mulberry(seed);
  const out: Part[] = [
    { geo: place(curvedBeam(7, 1.1, 2.2, 0.9, 20), 0, 0, 0.2), mat: "darkwood", outline: true },
    { geo: box(2.4, 1.6, 1.0, -1.8, 0, 1.2), mat: "wood", outline: true },
    { geo: place(roof(2.8, 2.0, 0.5, 0.2), -1.8, 0, 2.2), mat: "darkwood" },
  ];
  const masts = [1.4, -0.6];
  masts.forEach((mx, i) => {
    const h = i === 0 ? 7 : 5.5;
    out.push({ geo: post(0.07, 0.06, h, 1.1, 6).translate(mx, 0, 0), mat: "darkwood" });
    const sail = new THREE.PlaneGeometry(h * 0.55, h * 0.8, 1, 5);
    sail.rotateX(Math.PI / 2);
    // battens bow the cloth
    const p = sail.getAttribute("position");
    for (let k = 0; k < p.count; k++) p.setY(k, p.getY(k) + Math.sin((p.getX(k) / (h * 0.55) + 0.5) * Math.PI) * 0.35);
    sail.computeVertexNormals();
    out.push({ geo: place(sail, mx - h * 0.2, 0.05, 1.5 + h * 0.42, 0, 0, (rnd() - 0.5) * 0.3), mat: "sail", outline: true });
  });
  return out;
}

/** Nhà bè: a floating house on its raft, blue roof, lanterns lit. */
function floatingHouse(seed: number): Part[] {
  const rnd = mulberry(seed);
  const w = 4 + rnd() * 2;
  return [
    { geo: box(w + 1.5, 4.5, 0.35, 0, 0, -0.15), mat: "deck", outline: true },
    ...[-1, 1].map((sx) => ({ geo: place(new THREE.CylinderGeometry(0.35, 0.35, w + 1.2, 10), 0, sx * 1.8, -0.15, 0, 0, Math.PI / 2), mat: "roofBlue" as MatName })),
    { geo: box(w, 3, 2.2, 0, 0.3, 0.2), mat: "plaster", outline: true },
    { geo: place(roof(w * 1.3, 4.2, 1.3, 0.35), 0, 0.3, 2.35), mat: "roofBlue", outline: true },
    { geo: box(0.8, 0.1, 1.2, -w * 0.2, -1.22, 0.4), mat: "darkwood" },
    { geo: place(new THREE.SphereGeometry(0.18, 10, 8).scale(1, 1, 1.3), w * 0.3, -1.4, 1.9), mat: "amber" },
    { geo: place(new THREE.SphereGeometry(0.18, 10, 8).scale(1, 1, 1.3), -w * 0.4, -1.4, 1.9), mat: "red" },
  ];
}

function bamboo(seed: number): Part[] {
  const rnd = mulberry(seed);
  const out: Part[] = [];
  const n = 6 + Math.floor(rnd() * 5);
  for (let i = 0; i < n; i++) {
    const h = 4 + rnd() * 3.5;
    const x = (rnd() - 0.5) * 1.4;
    const y = (rnd() - 0.5) * 1.4;
    const lean = (rnd() - 0.5) * 0.3;
    out.push({ geo: place(new THREE.CylinderGeometry(0.05, 0.07, h, 6), x, y, h / 2, Math.PI / 2 + lean, 0, rnd() * 6), mat: "bamboo" });
    for (let k = 0; k < 3; k++) {
      const leaf = new THREE.OctahedronGeometry(0.6 + rnd() * 0.4, 0);
      leaf.scale(1.4, 0.5, 0.35);
      out.push({ geo: place(leaf, x + Math.sin(lean) * h * 0.8 + (rnd() - 0.5), y + (rnd() - 0.5), h * (0.7 + k * 0.12), 0, 0, rnd() * 6), mat: "leaf" });
    }
  }
  return out;
}

/** A broad tree (cây đa / cây gạo): a stout trunk under a cloud of leaves. */
function tree(seed: number, s = 1): Part[] {
  const rnd = mulberry(seed);
  const out: Part[] = [{ geo: post(0.35 * s, 0.22 * s, 3.2 * s, 0, 8), mat: "darkwood", outline: true }];
  for (let i = 0; i < 6; i++) {
    const b = new THREE.IcosahedronGeometry((1.1 + rnd() * 0.7) * s, 1);
    b.scale(1, 1, 0.75);
    out.push({ geo: place(b, (rnd() - 0.5) * 2.4 * s, (rnd() - 0.5) * 2 * s, (3.3 + rnd() * 1.3) * s), mat: "leaf", outline: true });
  }
  return out;
}

function pine(seed: number, s = 1): Part[] {
  const rnd = mulberry(seed);
  const h = (4 + rnd() * 3) * s;
  const out: Part[] = [{ geo: post(0.18 * s, 0.12 * s, h * 0.35, 0, 6), mat: "darkwood" }];
  for (let i = 0; i < 4; i++) {
    const r = (1.3 - i * 0.26) * s;
    out.push({ geo: place(new THREE.ConeGeometry(r, h * 0.36, 9), 0, 0, h * (0.32 + i * 0.17), Math.PI / 2), mat: "pine", outline: true });
  }
  return out;
}

/** Lotus pads floating near the bank, a few flowers open. */
function lotus(seed: number): Part[] {
  const rnd = mulberry(seed);
  const out: Part[] = [];
  for (let i = 0; i < 9; i++) {
    const r = 0.35 + rnd() * 0.35;
    out.push({ geo: place(new THREE.CylinderGeometry(r, r, 0.03, 14, 1, false, 0.3, Math.PI * 1.85), (rnd() - 0.5) * 4, (rnd() - 0.5) * 3, -0.06, Math.PI / 2), mat: "lotusPad" });
    if (rnd() < 0.4) {
      const x = (rnd() - 0.5) * 4;
      const y = (rnd() - 0.5) * 3;
      for (let k = 0; k < 6; k++) {
        const petal = new THREE.SphereGeometry(0.16, 8, 6);
        petal.scale(0.5, 0.35, 1.1);
        out.push({ geo: place(petal, x + Math.cos(k) * 0.12, y + Math.sin(k) * 0.12, 0.25, Math.sin(k) * 0.5, -Math.cos(k) * 0.5, 0), mat: "lotus" });
      }
    }
  }
  return out;
}

/** Red silk lanterns (đèn lồng) on a pole. */
function lanternPole(light: MatName = "red"): Part[] {
  return [
    { geo: post(0.07, 0.06, 2.8, 0, 6), mat: "darkwood" },
    { geo: box(0.9, 0.06, 0.06, 0.35, 0, 2.7), mat: "darkwood" },
    { geo: place(new THREE.SphereGeometry(0.26, 12, 10).scale(1, 1, 1.25), 0.72, 0, 2.2), mat: light },
    { geo: post(0.12, 0.12, 0.08, 2.52, 8).translate(0.72, 0, 0), mat: "gold" },
  ];
}

// ---------------------------------------------------------------- stage-sized pieces
export type PropKind =
  | "torii"
  | "greatTorii"
  | "lantern"
  | "redLantern"
  | "rock"
  | "pillar"
  | "shards"
  | "karst"
  | "islet"
  | "pagodaGate"
  | "goldGate"
  | "stupa"
  | "bamboo"
  | "tree"
  | "pine"
  | "lotus"
  | "lanternPole"
  | "amberPole"
  | "floatingHouse"
  | "mossRock"
  | "stoneLanternAmber";

export interface PropDef {
  kind: PropKind;
  x: number;
  y: number;
  z?: number;
  /** degrees about Z */
  rot?: number;
  scale?: number;
  seed?: number;
  /** karst and islet size */
  h?: number;
  r?: number;
}

function build(def: PropDef): Part[] {
  const seed = def.seed ?? Math.round(def.x * 7 + def.y * 13 + 101);
  switch (def.kind) {
    case "torii":
      return torii(1);
    case "greatTorii":
      return torii(1.6);
    case "lantern":
      return stoneLantern("lime");
    case "redLantern":
      return stoneLantern("red");
    case "stoneLanternAmber":
      return stoneLantern("amber", "limestone");
    case "rock":
      return rock(seed, 1.6 + (seed % 5) * 0.35, 0.7 + (seed % 3) * 0.2);
    case "mossRock":
      return rock(seed, 1.2 + (seed % 5) * 0.3, 0.8 + (seed % 3) * 0.25, "limestone");
    case "pillar":
      return pillar(seed);
    case "shards":
      return shards(seed);
    case "karst":
      return karst(seed, def.h ?? 30, def.r ?? 7);
    case "islet":
      return karst(seed, def.h ?? 16, def.r ?? 8, 0.55);
    case "pagodaGate":
      return pagodaGate(1);
    case "goldGate":
      return pagodaGate(1.2, "gold");
    case "stupa":
      return stupa(1);
    case "bamboo":
      return bamboo(seed);
    case "tree":
      return tree(seed);
    case "pine":
      return pine(seed);
    case "lotus":
      return lotus(seed);
    case "lanternPole":
      return lanternPole("red");
    case "amberPole":
      return lanternPole("amber");
    case "floatingHouse":
      return floatingHouse(seed);
  }
}

/** Seeded scatter: `n` props of a kind across a box. */
export function scatter(kind: PropKind, n: number, x: [number, number], y: [number, number], seed: number, extra: Partial<PropDef> = {}): PropDef[] {
  const rnd = mulberry(seed);
  return Array.from({ length: n }, (_, i) => ({
    kind,
    x: x[0] + rnd() * (x[1] - x[0]),
    y: y[0] + rnd() * (y[1] - y[0]),
    rot: rnd() * 360,
    seed: seed * 31 + i,
    ...extra,
    scale: (extra.scale ?? 1) * (0.8 + rnd() * 0.4),
    h: extra.h !== undefined ? extra.h * (0.6 + rnd() * 0.8) : undefined,
    r: extra.r !== undefined ? extra.r * (0.7 + rnd() * 0.6) : undefined,
  }));
}

/** The ground each stage stands on. */
export type Terrain =
  | { kind: "film" }
  | { kind: "river" }
  | { kind: "boardwalk" }
  | { kind: "ridge" };

function terrainParts(t: Terrain, x0: number, x1: number): Part[] {
  const a = x0 - 40;
  const b = x1 + 40;
  switch (t.kind) {
    case "film":
      return [];
    case "river":
      return [
        { geo: place(new THREE.PlaneGeometry(b - a + 400, 520), (a + b) / 2, 120, -0.14), mat: "water" },
        // the bank: grass shoulders, and the paved towpath on top
        { geo: strip([[-8, -0.7], [-5.4, -0.08], [-4.6, -0.02], [4.6, -0.02], [5.6, -0.1], [8.5, -0.75]], a, b), mat: "grass" },
        { geo: strip([[-4.3, -0.03], [-4.3, 0], [4.3, 0], [4.3, -0.03]], a, b), mat: "paving" },
      ];
    case "boardwalk": {
      const parts: Part[] = [{ geo: place(new THREE.PlaneGeometry(b - a + 400, 560), (a + b) / 2, 140, -0.35), mat: "water" }];
      // planks across the walk, on posts in the sea
      for (let x = a; x < b; x += 0.62) parts.push({ geo: box(0.55, 8.2, 0.12, x, 0, -0.12), mat: "deck" });
      for (let x = a; x < b; x += 3) {
        parts.push({ geo: post(0.12, 0.12, 1.2, -1.3, 6).translate(x, 4.2, 0), mat: "darkwood" });
        parts.push({ geo: post(0.12, 0.12, 1.2, -1.3, 6).translate(x, -4.2, 0), mat: "darkwood" });
      }
      parts.push({ geo: box(b - a, 0.14, 0.14, (a + b) / 2, 4.2, 0.55), mat: "darkwood" });
      return parts;
    }
    case "ridge":
      return [
        { geo: place(new THREE.PlaneGeometry(b - a + 600, 700), (a + b) / 2, 150, -9), mat: "cloudSea" },
        { geo: strip([[-26, -14], [-12, -5], [-6.5, -0.6], [-4.8, -0.03], [4.8, -0.03], [6.8, -0.8], [13, -5.5], [30, -15]], a, b), mat: "grass" },
        { geo: strip([[-4.4, -0.05], [-4.4, 0], [4.4, 0], [4.4, -0.05]], a, b), mat: "paving" },
      ];
  }
}

/** A stage's far backdrop: mountain walls and distant islets, beyond reach. */
export interface Backdrop {
  ranges?: { y: number; h: number; mat: MatName; seed: number; jag?: number }[];
}

/**
 * Build a stage's scenery: the terrain, the backdrop and every prop, merged
 * per material into a handful of meshes (plus an ink hull for the near props).
 */
export function buildScenery(mats: Materials, terrain: Terrain, props: PropDef[], backdrop: Backdrop, span: [number, number]) {
  const group = new THREE.Group();
  const byMat = new Map<MatName, THREE.BufferGeometry[]>();
  const hulls: THREE.BufferGeometry[] = [];
  const add = (p: Part, m?: THREE.Matrix4) => {
    let geo = p.geo.index ? p.geo.toNonIndexed() : p.geo;
    for (const name of Object.keys(geo.attributes)) if (name !== "position" && name !== "normal") geo.deleteAttribute(name);
    if (!geo.getAttribute("normal")) geo.computeVertexNormals();
    if (m) geo = geo.applyMatrix4(m);
    const list = byMat.get(p.mat) ?? [];
    list.push(geo);
    byMat.set(p.mat, list);
    if (p.outline) hulls.push(geo);
  };
  for (const p of terrainParts(terrain, span[0], span[1])) add(p);
  for (const r of backdrop.ranges ?? []) add(range(span[0] - 260, span[1] + 260, r.y, r.h, r.seed, r.mat, r.jag));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 0, 1);
  for (const def of props) {
    q.setFromAxisAngle(up, ((def.rot ?? 0) * Math.PI) / 180);
    m.compose(new THREE.Vector3(def.x, def.y, def.z ?? 0), q, new THREE.Vector3().setScalar(def.scale ?? 1));
    // far pieces are never close enough to need ink outlines
    const far = Math.abs(def.y) > 18;
    for (const p of build(def)) add(far ? { ...p, outline: false } : p, m);
  }
  for (const [mat, geos] of byMat) {
    const mesh = new THREE.Mesh(mergeGeometries(geos), mats.get(mat));
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  if (hulls.length) group.add(new THREE.Mesh(mergeGeometries(hulls), mats.get("outline")));
  return group;
}

/** Boats that ride the swell (kept separate so each can move). */
export class Fleet {
  readonly group = new THREE.Group();
  private readonly boats: { obj: THREE.Group; x: number; y: number; phase: number; drift: number }[] = [];

  constructor(mats: Materials, defs: { kind: "sampan" | "junk"; x: number; y: number; rot?: number; drift?: number }[]) {
    defs.forEach((d, i) => {
      const obj = new THREE.Group();
      const parts = d.kind === "sampan" ? sampan(i * 17 + 3) : junk(i * 23 + 5);
      const byMat = new Map<MatName, THREE.BufferGeometry[]>();
      const hulls: THREE.BufferGeometry[] = [];
      for (const p of parts) {
        const geo = p.geo.index ? p.geo.toNonIndexed() : p.geo;
        for (const name of Object.keys(geo.attributes)) if (name !== "position" && name !== "normal") geo.deleteAttribute(name);
        byMat.set(p.mat, [...(byMat.get(p.mat) ?? []), geo]);
        if (p.outline) hulls.push(geo);
      }
      for (const [mat, geos] of byMat) obj.add(new THREE.Mesh(mergeGeometries(geos), mats.get(mat)));
      if (hulls.length && Math.abs(d.y) < 18) obj.add(new THREE.Mesh(mergeGeometries(hulls), mats.get("outline")));
      obj.rotation.z = ((d.rot ?? 0) * Math.PI) / 180;
      this.group.add(obj);
      this.boats.push({ obj, x: d.x, y: d.y, phase: i * 1.7, drift: d.drift ?? 0 });
    });
  }

  update(t: number) {
    for (const b of this.boats) {
      b.obj.position.set(b.x + b.drift * t, b.y, -0.1 + Math.sin(t * 0.9 + b.phase) * 0.06);
      b.obj.rotation.x = Math.sin(t * 0.7 + b.phase) * 0.03;
      b.obj.rotation.y = Math.sin(t * 0.55 + b.phase * 1.3) * 0.04;
    }
  }
}
