/**
 * The stage's set dressing, built in code and shaded like the film's own cast:
 * the Little Giants' three-band toon ramp under the same light rig (TypeGPU),
 * a rim of the rival's red, and ink outlines from an inverted hull.
 *
 * Torii gates mark the way, stone lanterns glow lime (SORA's side) or crimson
 * (KAGE's), cracked pillars and jagged stones line the road, shards hang in the
 * air. Also here: the energy orbs defeated shadows leave behind, and the
 * barrier walls that seal an ambush.
 */
import * as t3 from "@typegpu/three";
import * as THREE from "three/webgpu";
import * as TSL from "three/tsl";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { d, std } from "typegpu";

import { diffuse } from "../runtime/lighting";

type RGB = [number, number, number];

/** Linear colours, matched to the film's palette (lib/mascot.py SKINS). */
const PAL = {
  lacquer: { base: [0.5, 0.012, 0.02] as RGB, shade: [0.12, 0, 0.005] as RGB, rim: [1, 0.15, 0.08] as RGB, rimK: 0.5 },
  ink: { base: [0.03, 0.032, 0.038] as RGB, shade: [0.006, 0.006, 0.009] as RGB, rim: [1, 0.12, 0.08] as RGB, rimK: 1.2 },
  stone: { base: [0.11, 0.1, 0.105] as RGB, shade: [0.022, 0.02, 0.024] as RGB, rim: [1, 0.3, 0.24] as RGB, rimK: 0.55 },
  moss: { base: [0.2, 0.42, 0.04] as RGB, shade: [0.03, 0.08, 0.01] as RGB, rim: [1, 1, 0.8] as RGB, rimK: 0.35 },
};
const LIME: RGB = [0.66, 0.92, 0.07];
const RED: RGB = [1, 0.05, 0.04];

/** Three-band cel shading (mascot.toon): shadow / half / lit, a warm fill, a crisp rim. */
function toon(p: (typeof PAL)[keyof typeof PAL]) {
  const B = d.vec3f(...p.base);
  const S = d.vec3f(...p.shade);
  const R = d.vec3f(...p.rim);
  const rimK = p.rimK;
  const m = new THREE.MeshBasicNodeMaterial();
  m.colorNode = t3.toTSL(() => {
    "use gpu";
    const n = std.normalize(t3.normalWorld.$);
    const pw = t3.positionWorld.$;
    const v = std.normalize(std.sub(t3.cameraPosition.$, pw));
    const e = diffuse(pw, n, false);
    const lum = e.x * 0.2126 + e.y * 0.7152 + e.z * 0.0722;
    const band = std.select(std.select(d.f32(1), d.f32(0.55), lum < 0.22), d.f32(0), lum < 0.06);
    let col = std.add(std.mix(S, B, band), std.mul(std.mul(e, B), 0.1));
    const facing = 1 - std.abs(std.dot(n, v));
    col = std.add(col, std.mul(R, std.smoothstep(0.72, 0.93, facing) * rimK));
    return d.vec4f(col, 1);
  }) as THREE.NodeMaterial["colorNode"];
  m.fog = false;
  return m;
}

/** Light-emitting surface, bright enough for the bloom to take. */
function glow(c: RGB, strength: number) {
  const m = new THREE.MeshBasicNodeMaterial();
  m.colorNode = TSL.vec4(c[0] * strength, c[1] * strength, c[2] * strength, 1);
  m.fog = false;
  return m;
}

/** Ink outline: the back faces pushed out along the normals, drawn black. */
function hull(thickness: number) {
  const m = new THREE.MeshBasicNodeMaterial();
  m.colorNode = TSL.vec4(0, 0, 0, 1);
  m.positionNode = TSL.positionLocal.add(TSL.normalLocal.mul(thickness));
  m.side = THREE.BackSide;
  m.fog = false;
  return m;
}

const MAT = {
  lacquer: toon(PAL.lacquer),
  ink: toon(PAL.ink),
  stone: toon(PAL.stone),
  moss: toon(PAL.moss),
  lime: glow(LIME, 7),
  red: glow(RED, 7),
  outline: hull(0.025),
};

type Part = { geo: THREE.BufferGeometry; mat: keyof typeof MAT; outline?: boolean };

const place = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
  g.rotateX(rx).rotateY(ry).rotateZ(rz);
  return g.translate(x, y, z);
};

/** Z-up cylinder standing on z = z0. */
const post = (r0: number, r1: number, h: number, z0 = 0, seg = 16) => place(new THREE.CylinderGeometry(r1, r0, h, seg), 0, 0, z0 + h / 2, Math.PI / 2);

/** A box whose top ends curl up (the torii's kasagi). */
function curvedBeam(len: number, h: number, depth: number, lift: number) {
  const g = new THREE.BoxGeometry(len, depth, h, 24, 1, 1);
  const p = g.getAttribute("position");
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) / (len / 2);
    p.setZ(i, p.getZ(i) + lift * u * u * u * u);
  }
  g.computeVertexNormals();
  return g;
}

function torii(scale = 1): Part[] {
  const s = scale;
  const w = 3.3 * s;
  const H = 5.4 * s;
  return [
    { geo: post(0.3 * s, 0.26 * s, H).translate(-w, 0, 0), mat: "lacquer", outline: true },
    { geo: post(0.3 * s, 0.26 * s, H).translate(w, 0, 0), mat: "lacquer", outline: true },
    { geo: post(0.42 * s, 0.42 * s, 0.5 * s).translate(-w, 0, 0), mat: "ink" },
    { geo: post(0.42 * s, 0.42 * s, 0.5 * s).translate(w, 0, 0), mat: "ink" },
    // nuki: the tie beam through the posts
    { geo: place(new THREE.BoxGeometry(2 * w + 1.4 * s, 0.34 * s, 0.34 * s), 0, 0, H - 1.2 * s), mat: "lacquer", outline: true },
    // shimaki + kasagi: the lacquered lintel under the black curled cap
    { geo: place(curvedBeam(2 * w + 2.2 * s, 0.36 * s, 0.5 * s, 0.45 * s), 0, 0, H - 0.1 * s), mat: "lacquer", outline: true },
    { geo: place(curvedBeam(2 * w + 2.8 * s, 0.3 * s, 0.62 * s, 0.6 * s), 0, 0, H + 0.26 * s), mat: "ink", outline: true },
    // gakuzuka: the plaque between the beams
    { geo: place(new THREE.BoxGeometry(0.7 * s, 0.14 * s, 0.9 * s), 0, 0, H - 0.6 * s), mat: "ink" },
    { geo: place(new THREE.BoxGeometry(0.5 * s, 0.16 * s, 0.66 * s), 0, -0.02 * s, H - 0.6 * s), mat: "lacquer" },
  ];
}

function lantern(light: "lime" | "red"): Part[] {
  return [
    { geo: post(0.42, 0.36, 0.22), mat: "stone", outline: true },
    { geo: post(0.16, 0.14, 1.0, 0.22, 10), mat: "stone", outline: true },
    { geo: place(new THREE.CylinderGeometry(0.38, 0.3, 0.14, 6), 0, 0, 1.29, Math.PI / 2), mat: "stone" },
    // the fire box: stone frame, glowing windows
    { geo: place(new THREE.BoxGeometry(0.46, 0.46, 0.46), 0, 0, 1.59), mat: light },
    ...[-1, 1].flatMap((sx) =>
      [-1, 1].map((sy) => ({ geo: place(new THREE.BoxGeometry(0.1, 0.1, 0.5), sx * 0.24, sy * 0.24, 1.59), mat: "stone" as const })),
    ),
    // roof and jewel
    { geo: place(new THREE.ConeGeometry(0.62, 0.42, 6), 0, 0, 2.03, Math.PI / 2), mat: "stone", outline: true },
    { geo: place(new THREE.SphereGeometry(0.1, 10, 8), 0, 0, 2.3), mat: "stone" },
  ];
}

/** A jagged standing stone (seeded, so each one differs). */
function rock(seed: number, h = 2.2, r = 0.9): Part[] {
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
  return [{ geo: g.rotateZ(rnd() * Math.PI), mat: "stone", outline: true }];
}

/** A cracked pillar, its top section fallen beside it. */
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

/** Stones hanging in the air above the road (they bob; see Stage.update). */
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

export type PropKind = "torii" | "greatTorii" | "lantern" | "redLantern" | "rock" | "pillar" | "shards";

export interface PropDef {
  kind: PropKind;
  x: number;
  y: number;
  /** degrees about Z */
  rot?: number;
  scale?: number;
  seed?: number;
}

function build(def: PropDef): Part[] {
  const seed = def.seed ?? Math.round(def.x * 7 + def.y * 13);
  switch (def.kind) {
    case "torii":
      return torii(1);
    case "greatTorii":
      return torii(1.6);
    case "lantern":
      return lantern("lime");
    case "redLantern":
      return lantern("red");
    case "rock":
      return rock(seed, 1.6 + (seed % 5) * 0.35, 0.7 + (seed % 3) * 0.2);
    case "pillar":
      return pillar(seed);
    case "shards":
      return shards(seed);
  }
}

/** One prop: its parts merged per material, plus one outline hull. */
export function makeProp(def: PropDef) {
  const group = new THREE.Group();
  const parts = build(def);
  const byMat = new Map<keyof typeof MAT, THREE.BufferGeometry[]>();
  const hullParts: THREE.BufferGeometry[] = [];
  for (const p of parts) {
    const geo = p.geo.index ? p.geo.toNonIndexed() : p.geo;
    for (const name of Object.keys(geo.attributes)) if (name !== "position" && name !== "normal") geo.deleteAttribute(name);
    const list = byMat.get(p.mat) ?? [];
    list.push(geo);
    byMat.set(p.mat, list);
    if (p.outline) hullParts.push(geo);
  }
  for (const [mat, geos] of byMat) group.add(new THREE.Mesh(mergeGeometries(geos), MAT[mat]));
  if (hullParts.length) group.add(new THREE.Mesh(mergeGeometries(hullParts), MAT.outline));
  group.position.set(def.x, def.y, 0);
  group.rotation.z = ((def.rot ?? 0) * Math.PI) / 180;
  group.scale.setScalar(def.scale ?? 1);
  group.userData.kind = def.kind;
  return group;
}

// ---------------------------------------------------------------- pickups and walls

/** Energy orbs: small lime suns that drift up, then fly into SORA. */
export class Orbs {
  readonly group = new THREE.Group();
  private readonly items: { mesh: THREE.Mesh; vel: THREE.Vector3; age: number; live: boolean }[] = [];

  constructor(count = 32) {
    const geo = new THREE.IcosahedronGeometry(0.11, 2);
    const mat = glow(LIME, 9);
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      this.group.add(mesh);
      this.items.push({ mesh, vel: new THREE.Vector3(), age: 0, live: false });
    }
  }

  /** Burst `n` orbs from a point. */
  spawn(at: THREE.Vector3, n: number) {
    for (const it of this.items) {
      if (n <= 0) break;
      if (it.live) continue;
      n--;
      it.live = true;
      it.age = 0;
      it.mesh.visible = true;
      it.mesh.position.set(at.x, at.y, 0.7);
      const a = Math.random() * Math.PI * 2;
      it.vel.set(Math.cos(a) * 2.2, Math.sin(a) * 2.2, 3.5 + Math.random() * 2);
    }
  }

  /** Drift, then home in on `to`; returns how many were collected this step. */
  update(dt: number, to: THREE.Vector3) {
    let got = 0;
    const target = new THREE.Vector3(to.x, to.y, to.z + 0.7);
    for (const it of this.items) {
      if (!it.live) continue;
      it.age += dt;
      const p = it.mesh.position;
      if (it.age < 0.45) {
        it.vel.z -= 9 * dt;
        it.vel.multiplyScalar(Math.exp(-2 * dt));
      } else {
        // home in, faster and faster
        const dir = target.clone().sub(p);
        const dist = dir.length();
        if (dist < 0.35) {
          it.live = false;
          it.mesh.visible = false;
          got++;
          continue;
        }
        it.vel.lerp(dir.multiplyScalar((6 + it.age * 14) / dist), 1 - Math.exp(-8 * dt));
      }
      p.addScaledVector(it.vel, dt);
      const pulse = 1 + 0.25 * Math.sin(it.age * 18);
      it.mesh.scale.setScalar(pulse);
    }
    return got;
  }

  clear() {
    for (const it of this.items) {
      it.live = false;
      it.mesh.visible = false;
    }
  }
}

/**
 * The ambush walls: sheets of rising lime light across the road at both ends of
 * an arena, fading in when it seals and out when it is cleared.
 */
export class Barrier {
  readonly group = new THREE.Group();
  private readonly strength = t3.uniform(0, d.f32);
  private target = 0;
  private level = 0;

  constructor() {
    const strength = this.strength;
    const tint = d.vec3f(...LIME);
    const m = new THREE.MeshBasicNodeMaterial();
    m.colorNode = t3.toTSL(() => {
      "use gpu";
      const p = t3.positionLocal.$;
      const t = t3.time.$;
      // x across the road, z up the wall (0..1)
      const h = std.saturate(p.z);
      const stripes = std.pow(std.abs(std.sin(p.x * 3.1 + p.z * 1.4 - t * 2.3)), 12);
      const scan = std.pow(std.fract(p.z * 0.7 - t * 0.9), 6);
      const edge = std.smoothstep(0.9, 1, std.abs(p.x) / 4.2);
      const fade = (1 - h) * (1 - h);
      const k = (0.16 + stripes * 0.7 + scan * 0.9 + edge * 0.8) * fade * strength.$;
      return d.vec4f(std.mul(tint, k * 3), 1);
    }) as THREE.NodeMaterial["colorNode"];
    // additive: out = colour + destination
    m.transparent = true;
    m.depthWrite = false;
    m.side = THREE.DoubleSide;
    m.blending = THREE.AdditiveBlending;
    m.fog = false;
    const geo = new THREE.PlaneGeometry(8.4, 1, 24, 8);
    geo.translate(0, 0.5, 0).rotateX(Math.PI / 2);
    for (const side of [0, 1]) {
      const wall = new THREE.Mesh(geo, m);
      // the plane spans x across the road: turn it to cross the road (world y)
      wall.rotation.z = Math.PI / 2;
      wall.scale.set(1, 1, 4.2);
      wall.userData.side = side;
      this.group.add(wall);
    }
    this.group.visible = false;
  }

  /** Seal the stretch of road between x0 and x1 (or open it with null). */
  seal(span: [number, number] | null) {
    this.target = span ? 1 : 0;
    if (!span) return;
    this.group.children.forEach((w, i) => w.position.set(i === 0 ? span[0] : span[1], 0, 0));
  }

  update(dt: number) {
    this.level = THREE.MathUtils.damp(this.level, this.target, 5, dt);
    this.strength.node.value = this.level;
    this.group.visible = this.level > 0.01;
  }
}

function mulberry(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
