/**
 * The meadow round the player: a dense carpet of grass tufts and wild flowers
 * that follows the camera, laid on the valley floor wherever it is green
 * (never on paths, water, paddies, bare rock or under a house).
 *
 * Tufts sit on a fixed world lattice with hashed jitter, so as the camera
 * moves the same tuft always grows in the same place; far from the camera
 * they thin out and shrink to nothing, so the edge of the meadow never pops.
 * The instances reuse the plant material (wind, toon light, near dither).
 */
import * as THREE from "three/webgpu";

import type { Heightfield, WorldData } from "./data";
import { plantMaterial } from "./shaders";

/** metres of meadow round the camera, and the lattice spacing */
const RADIUS = 28;
const CELL = 0.52;
/** rebuild when the camera has moved this far */
const STEP = 2.5;

// ---------------------------------------------------------------- the tuft
/**
 * A tuft of curved, tapering blades: dark at the root, free at the tip.
 * Attributes match the plant material: leaf (1 = leaf), ao (root dark), sway (0 root .. 1 tip).
 */
function tuftGeometry(blades: number, height: number, seed: number) {
  const pos: number[] = [];
  const nrm: number[] = [];
  const leaf: number[] = [];
  const ao: number[] = [];
  const sway: number[] = [];
  const idx: number[] = [];
  let r = seed;
  const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  const SEG = 3;
  for (let b = 0; b < blades; b++) {
    const yaw = rnd() * Math.PI * 2;
    const lean = 0.18 + rnd() * 0.35;
    const h = height * (0.6 + rnd() * 0.55);
    const w = 0.035 + rnd() * 0.02;
    const ox = (rnd() - 0.5) * 0.12;
    const oy = (rnd() - 0.5) * 0.12;
    const dx = Math.cos(yaw);
    const dy = Math.sin(yaw);
    // the blade's face is across its lean direction
    const px = -dy;
    const py = dx;
    const base = pos.length / 3;
    for (let s = 0; s <= SEG; s++) {
      const t = s / SEG;
      const bend = lean * t * t * h;
      const cx = ox + dx * bend;
      const cy = oy + dy * bend;
      const cz = h * t * (1 - lean * 0.25 * t);
      const half = w * (1 - t * 0.92);
      pos.push(cx - px * half, cy - py * half, cz, cx + px * half, cy + py * half, cz);
      // normals tip toward the sky and out along the lean (soft, like a meadow seen from afar)
      const nz = 0.75;
      nrm.push(dx * 0.5, dy * 0.5, nz, dx * 0.5, dy * 0.5, nz);
      leaf.push(1, 1);
      ao.push(0.25 + 0.75 * t, 0.25 + 0.75 * t);
      sway.push(t * t, t * t);
      if (s < SEG) {
        const i = base + s * 2;
        idx.push(i, i + 1, i + 3, i, i + 3, i + 2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute("leaf", new THREE.Float32BufferAttribute(leaf, 1));
  g.setAttribute("ao", new THREE.Float32BufferAttribute(ao, 1));
  g.setAttribute("sway", new THREE.Float32BufferAttribute(sway, 1));
  g.setIndex(idx);
  return g;
}

/** A wild flower: a thin stem and a flat five-petal head (leaf = 2 marks the petals). */
function flowerGeometry() {
  const pos: number[] = [];
  const nrm: number[] = [];
  const leaf: number[] = [];
  const ao: number[] = [];
  const sway: number[] = [];
  const idx: number[] = [];
  const H = 0.42;
  // stem: a thin card
  pos.push(-0.01, 0, 0, 0.01, 0, 0, 0.01, 0, H, -0.01, 0, H);
  for (let i = 0; i < 4; i++) nrm.push(0, -1, 0.3);
  leaf.push(1, 1, 1, 1);
  ao.push(0.3, 0.3, 1, 1);
  sway.push(0, 0, 1, 1);
  idx.push(0, 1, 2, 0, 2, 3);
  // head: a centre and five petal tips, tilted a little toward the sky
  const c = pos.length / 3;
  pos.push(0, 0, H + 0.015);
  nrm.push(0, 0, 1);
  leaf.push(2);
  ao.push(1);
  sway.push(1);
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    const r = k % 2 === 0 ? 0.11 : 0.045;
    pos.push(Math.cos(a) * r, Math.sin(a) * r, H + (k % 2 === 0 ? 0.01 : 0.02));
    nrm.push(0, 0, 1);
    leaf.push(2);
    ao.push(1);
    sway.push(1);
  }
  for (let k = 0; k < 10; k++) idx.push(c, c + 1 + k, c + 1 + ((k + 1) % 10));
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute("leaf", new THREE.Float32BufferAttribute(leaf, 1));
  g.setAttribute("ao", new THREE.Float32BufferAttribute(ao, 1));
  g.setAttribute("sway", new THREE.Float32BufferAttribute(sway, 1));
  g.setIndex(idx);
  return g;
}

// ---------------------------------------------------------------- where it grows
/** The terrain's paint masks (the exported terrain mesh is the heightfield's grid, row by row). */
class Masks {
  private readonly n: number;
  private readonly x0: number;
  private readonly cell: number;
  private readonly bad: Float32Array;

  constructor(data: WorldData) {
    const m = data.manifest;
    const hf = m.heightfield;
    this.n = hf.n;
    this.x0 = hf.x0;
    this.cell = hf.cell;
    const terrain = m.statics.find((s) => s.kind === "terrain");
    const me = terrain ? m.meshes[terrain.mesh] : null;
    this.bad = new Float32Array(this.n * this.n);
    if (!me) return;
    const read = (name: string) => (me.attrs[name] ? data.f32(me.attrs[name].o, me.count) : null);
    const path = read("path");
    const wet = read("wet");
    const rock = read("rock");
    const field = read("field");
    for (let i = 0; i < this.bad.length; i++) {
      this.bad[i] = Math.max(path?.[i] ?? 0, wet?.[i] ?? 0, rock?.[i] ?? 0, field?.[i] ?? 0);
    }
  }

  /** 0 = lush, 1 = no grass here */
  at(x: number, y: number) {
    const n = this.n;
    const i = Math.min(Math.max(Math.round((x - this.x0) / this.cell), 0), n - 1);
    const j = Math.min(Math.max(Math.round((y - this.x0) / this.cell), 0), n - 1);
    return this.bad[j * n + i];
  }
}

/** a stable hash of a lattice cell (0..1) */
const hash = (i: number, j: number, k: number) => {
  let h = (i * 374761393 + j * 668265263 + k * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

interface Layer {
  mesh: THREE.Mesh;
  geo: THREE.InstancedBufferGeometry;
  buf: THREE.InstancedInterleavedBuffer;
  cap: number;
}

export class Meadow {
  readonly group = new THREE.Group();
  private readonly grass: Layer;
  private readonly flowers: Layer;
  private readonly masks: Masks;
  private readonly last = new THREE.Vector2(1e9, 1e9);

  constructor(
    data: WorldData,
    private readonly ground: Heightfield,
    private readonly blocked: { x: number; y: number; r: number }[],
    noReflect: number,
  ) {
    this.masks = new Masks(data);
    // a few tuft shapes would be nicer, but one shape turned and scaled per instance reads as a meadow already
    this.grass = this.layer(tuftGeometry(7, 0.6, 7), plantMaterial("meadow"), 10000, noReflect);
    this.flowers = this.layer(flowerGeometry(), plantMaterial("flower"), 2200, noReflect);
  }

  private layer(base: THREE.BufferGeometry, mat: THREE.Material, cap: number, noReflect: number): Layer {
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    for (const [name, a] of Object.entries(base.attributes)) geo.setAttribute(name, a);
    const buf = new THREE.InstancedInterleavedBuffer(new Float32Array(cap * 5), 5, 1);
    buf.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("i_pos", new THREE.InterleavedBufferAttribute(buf, 3, 0));
    geo.setAttribute("i_rs", new THREE.InterleavedBufferAttribute(buf, 2, 3));
    geo.instanceCount = 0;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.layers.set(noReflect);
    mesh.name = "world:meadow";
    this.group.add(mesh);
    return { mesh, geo, buf, cap };
  }

  /** Regrow round the camera when it has moved far enough. */
  update(camera: THREE.Vector3) {
    if (this.last.distanceTo(new THREE.Vector2(camera.x, camera.y)) < STEP) return;
    this.last.set(camera.x, camera.y);
    this.fill(camera);
  }

  private fill(cam: THREE.Vector3) {
    const g = this.grass.buf.array as Float32Array;
    const f = this.flowers.buf.array as Float32Array;
    let ng = 0;
    let nf = 0;
    const i0 = Math.floor((cam.x - RADIUS) / CELL);
    const i1 = Math.ceil((cam.x + RADIUS) / CELL);
    const j0 = Math.floor((cam.y - RADIUS) / CELL);
    const j1 = Math.ceil((cam.y + RADIUS) / CELL);
    // nearby blockers only (houses, trunks, towers)
    const near = this.blocked.filter((b) => Math.hypot(b.x - cam.x, b.y - cam.y) < RADIUS + b.r + 2);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const h0 = hash(i, j, 1);
        const x = (i + hash(i, j, 2)) * CELL;
        const y = (j + hash(i, j, 3)) * CELL;
        const dist = Math.hypot(x - cam.x, y - cam.y);
        if (dist > RADIUS) continue;
        // thinning with distance: all of them close in, a third at the rim
        const keep = 1 - 0.7 * Math.min(1, Math.max(0, (dist - 10) / (RADIUS - 10)));
        if (h0 > keep) continue;
        const bad = this.masks.at(x, y);
        if (bad > 0.35) continue;
        const z = this.ground.at(x, y);
        if (z < 0.2) continue;
        let inside = false;
        for (const b of near) {
          if ((x - b.x) ** 2 + (y - b.y) ** 2 < (b.r + 0.4) ** 2) {
            inside = true;
            break;
          }
        }
        if (inside) continue;
        // shrink to nothing over the last metres, and where the ground is turning bare
        const edge = 1 - Math.min(1, Math.max(0, (dist - (RADIUS - 6)) / 6));
        const lush = 1 - Math.min(1, bad / 0.35);
        const scale = (0.75 + 0.55 * hash(i, j, 4)) * edge * (0.45 + 0.55 * lush);
        if (scale < 0.05) continue;
        const yaw = hash(i, j, 5) * Math.PI * 2;
        const flower = hash(i, j, 6) < 0.09 && dist < 24;
        if (flower && nf < this.flowers.cap) {
          const o = nf++ * 5;
          f[o] = x;
          f[o + 1] = y;
          f[o + 2] = z - 0.02;
          f[o + 3] = yaw;
          f[o + 4] = scale * (0.9 + 0.5 * hash(i, j, 7));
        } else if (ng < this.grass.cap) {
          const o = ng++ * 5;
          g[o] = x;
          g[o + 1] = y;
          g[o + 2] = z - 0.04;
          g[o + 3] = yaw;
          g[o + 4] = scale;
        }
      }
    }
    this.grass.geo.instanceCount = ng;
    this.flowers.geo.instanceCount = nf;
    this.grass.buf.needsUpdate = true;
    this.flowers.buf.needsUpdate = true;
  }
}
