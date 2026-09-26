/**
 * The Ninh Bình valley in the scene: terrain, karst, built pieces, the river's
 * water, and every plant as instanced chunks that are drawn only when near
 * enough to matter. Also the ground's height and what cannot be walked through.
 */
import * as THREE from "three/webgpu";

import { water } from "../game/shading";
import type { FilmScene } from "../runtime/scene";
import { Heightfield, type WorldData, type WorldMesh } from "./data";
import { haloMaterial, heroMaterial, karstMaterial, lampMaterial, mistMaterial, type PlantLook, plantMaterial, propMaterial, terrainMaterial } from "./shaders";

/** Plants that only matter up close (and never in the water's reflection). */
const NEAR: Record<string, number> = { grass: 45, rice: 80, reed: 70, shrub: 110, lotus: 90, karstShrub: 400, boulder: 140 };
const LOOK: Record<string, PlantLook> = {
  tree0: "tree",
  tree1: "tree",
  tree2: "tree",
  shrub: "shrub",
  karstShrub: "shrub",
  bamboo: "bamboo",
  banana: "banana",
  grass: "grass",
  rice: "rice",
  reed: "reed",
  lotus: "lotus",
  boulder: "rock",
};
/** Layer the reflection camera does not see (grass and small plants). */
export const NO_REFLECT = 1;

export class World {
  readonly group = new THREE.Group();
  readonly ground: Heightfield;
  private readonly chunks: { mesh: THREE.Mesh; center: THREE.Vector3; radius: number; near: number }[] = [];

  constructor(
    readonly data: WorldData,
    fs: FilmScene,
  ) {
    const m = data.manifest;
    this.ground = new Heightfield(data);
    const geos = m.meshes.map((me) => this.geometry(me));

    for (const s of m.statics) {
      const mat =
        s.kind === "terrain"
          ? terrainMaterial()
          : s.kind === "karst"
            ? karstMaterial()
            : s.kind === "hero" && s.tex
              ? heroMaterial(this.texture(s.tex))
              : s.kind === "glow"
                ? lampMaterial()
                : propMaterial();
      const mesh = new THREE.Mesh(geos[s.mesh], mat);
      mesh.name = `world:${s.name}`;
      mesh.frustumCulled = s.kind !== "terrain";
      this.group.add(mesh);
    }

    // the river: one sheet of water at its level, mirroring the valley
    const w = new THREE.Mesh(new THREE.PlaneGeometry(m.size * 2.2, m.size * 2.2), water(fs.reflection));
    w.position.z = m.water - 0.02;
    w.name = "world:water";
    this.group.add(w);

    // morning mist: two thin sheets low over the valley floor, drawn after everything solid
    for (const [z, density] of [
      [1.6, 0.34],
      [4.5, 0.22],
    ] as const) {
      const mist = new THREE.Mesh(new THREE.PlaneGeometry(m.size * 1.6, m.size * 1.6), mistMaterial(z, density));
      mist.position.z = z;
      mist.renderOrder = 5;
      mist.name = "world:mist";
      mist.layers.set(NO_REFLECT);
      this.group.add(mist);
    }

    // the glow round every lantern and flame
    const halo = { silk: haloMaterial([1, 0.3, 0.1], 3.2), flame: haloMaterial([1, 0.62, 0.25], 2.6) };
    for (const [x, y, z, kind] of m.halos ?? []) {
      const sp = new THREE.Sprite(halo[kind]);
      sp.position.set(x, y, z);
      sp.scale.setScalar(kind === "silk" ? 2.4 : 1.8);
      sp.renderOrder = 6;
      sp.name = "world:halo";
      this.group.add(sp);
    }

    const mats = new Map<PlantLook, THREE.Material>();
    for (const inst of m.instances) {
      const look = LOOK[inst.name] ?? "shrub";
      let mat = mats.get(look);
      if (!mat) {
        mat = plantMaterial(look);
        mats.set(look, mat);
      }
      const base = geos[inst.mesh];
      const near = NEAR[inst.name] ?? 240;
      for (const c of inst.chunks) {
        const geo = new THREE.InstancedBufferGeometry();
        geo.index = base.index;
        for (const [name, a] of Object.entries(base.attributes)) geo.setAttribute(name, a);
        const buf = new THREE.InstancedInterleavedBuffer(data.f32(c.o, c.n * 5), 5, 1);
        geo.setAttribute("i_pos", new THREE.InterleavedBufferAttribute(buf, 3, 0));
        geo.setAttribute("i_rs", new THREE.InterleavedBufferAttribute(buf, 2, 3));
        geo.instanceCount = c.n;
        geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(...c.center), c.radius);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.name = `world:${inst.name}`;
        if (NEAR[inst.name] !== undefined && inst.name !== "karstShrub") mesh.layers.set(NO_REFLECT);
        this.group.add(mesh);
        this.chunks.push({ mesh, center: new THREE.Vector3(...c.center), radius: c.radius, near });
      }
    }
    fs.camera.layers.enable(NO_REFLECT);
    this.group.visible = false;
    fs.scene.add(this.group);
  }

  /** A hero piece's painted texture: RGB rows from the blob, widened to RGBA, mipmapped. */
  private texture(t: { o: number; w: number; h: number }) {
    const rgb = this.data.u8(t.o, t.w * t.h * 3);
    const rgba = new Uint8Array(t.w * t.h * 4);
    for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
      rgba[j] = rgb[i];
      rgba[j + 1] = rgb[i + 1];
      rgba[j + 2] = rgb[i + 2];
      rgba[j + 3] = 255;
    }
    const tex = new THREE.DataTexture(rgba, t.w, t.h, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.colorSpace = THREE.SRGBColorSpace;
    // rows run bottom-up, as Blender's UVs do
    tex.flipY = false;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
  }

  private geometry(me: WorldMesh) {
    const g = new THREE.BufferGeometry();
    for (const [name, a] of Object.entries(me.attrs)) {
      g.setAttribute(name, new THREE.BufferAttribute(this.data.f32(a.o, me.count * a.w), a.w));
    }
    g.setIndex(new THREE.BufferAttribute(this.data.u32(me.index.o, me.index.n), 1));
    const [x0, y0, z0, x1, y1, z1] = me.bbox;
    g.boundingBox = new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    return g;
  }

  /** Draw only the plant chunks near enough to the camera to be seen. */
  update(camera: THREE.Vector3) {
    for (const c of this.chunks) c.mesh.visible = c.center.distanceTo(camera) - c.radius < c.near;
  }

  /**
   * How far along the line from `from` to `to` (0..1) the view is clear of
   * anything solid, so the camera can come in front of a wall instead of
   * looking at its back.
   */
  clearance(from: THREE.Vector3, to: THREE.Vector3, pad: number) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-6) return 1;
    let t = 1;
    for (const c of this.data.manifest.colliders) {
      const r = c.r + pad;
      const fx = from.x - c.x;
      const fy = from.y - c.y;
      // |f + d t|^2 = r^2
      const b = fx * dx + fy * dy;
      const cc = fx * fx + fy * fy - r * r;
      if (cc < 0) continue; // the subject is inside it already: nothing sensible to do
      const disc = b * b - len2 * cc;
      if (disc < 0) continue;
      const hit = (-b - Math.sqrt(disc)) / len2;
      if (hit > 0 && hit < t) t = hit;
    }
    return t;
  }

  /** Push a point out of anything solid (karst feet, houses, the hall) and keep it out of deep water. */
  collide(p: THREE.Vector3, radius: number, from: THREE.Vector3) {
    for (const c of this.data.manifest.colliders) {
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      const d = Math.hypot(dx, dy);
      const min = c.r + radius;
      if (d < min && d > 1e-4) {
        p.x = c.x + (dx / d) * min;
        p.y = c.y + (dy / d) * min;
      }
    }
    // the river is too deep to wade: stay on the bank
    if (this.ground.at(p.x, p.y) < -0.35) {
      p.x = from.x;
      p.y = from.y;
    }
    const half = this.data.manifest.size / 2 - 22;
    p.x = Math.min(Math.max(p.x, -half), half);
    p.y = Math.min(Math.max(p.y, -half), half);
  }
}
