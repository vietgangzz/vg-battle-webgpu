/**
 * The Ninh Bình valley in the scene: terrain, karst, built pieces, the river's
 * water, and every plant as instanced chunks that are drawn only when near
 * enough to matter. Also the ground's height and what cannot be walked through.
 */
import * as t3 from "@typegpu/three";
import * as TSL from "three/tsl";
import * as THREE from "three/webgpu";
import { d } from "typegpu";

import { water } from "../game/shading";
import type { FilmScene } from "../runtime/scene";
import { Heightfield, type WorldData, type WorldMesh, type WorldTexture } from "./data";
import { Meadow } from "./grass";
import { haloMaterial, heroMaterial, karstMaterial, lampMaterial, type PlantLook, plantMaterial, propMaterial, terrainMaterial } from "./shaders";

/** Plants that only matter up close (and never in the water's reflection). */
const NEAR: Record<string, number> = { grass: 45, rice: 80, reed: 70, shrub: 110, lotus: 90, karstShrub: 400, boulder: 140, tree0: 180, tree1: 180, tree2: 180, bamboo: 120, banana: 90 };
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
/**
 * Meshy pieces are merged per 48 m cell; small things are drawn only this near
 * (m), and only the big ones are mirrored in the river.
 */
const HERO_NEAR: Record<string, number> = {
  lily_pads: 70,
  water_jars: 50,
  bamboo_fence: 70,
  incense_burner: 70,
  cattail_reeds: 80,
  lotus_cluster: 90,
  stone_lantern: 90,
  village_well: 90,
  nghe_statue: 90,
  water_buffalo: 110,
  haystack: 130,
  areca_palm: 160,
  bamboo_clump: 180,
  farmer_hut: 220,
  // the river's edge: close-up detail
  shore_stones: 60,
  bank_reeds: 70,
  river_rocks: 90,
  tre_grove: 200,
};
const HERO_REFLECT = new Set(["pagoda_hall", "tam_quan_gate", "bell_tower", "village_house", "banyan_shrine", "boat_pier", "sampan", "village_gate", "thuy_dinh"]);

export class World {
  readonly group = new THREE.Group();
  readonly ground: Heightfield;
  private readonly chunks: { mesh: THREE.Mesh; center: THREE.Vector3; radius: number; near: number }[] = [];
  /** lantern halos, drawn only near the camera and once the day turns (each is a draw call) */
  private readonly halos: THREE.Sprite[] = [];
  /** 0 = morning .. 1 = dusk (set by the valley's day) */
  evening = 0;
  /** one texture and one material per Meshy piece, however many cells use them (by blob offset) */
  private readonly heroMats = new Map<number, THREE.Material>();
  /** the dense grass and flowers round the camera (the scattered grass tufts are left out for it) */
  private readonly meadow: Meadow;

  constructor(
    readonly data: WorldData,
    fs: FilmScene,
  ) {
    const m = data.manifest;
    this.ground = new Heightfield(data);
    const geos = m.meshes.map((me) => this.geometry(me));

    for (const s of m.statics) {
      let mat: THREE.Material;
      if (s.kind === "terrain") mat = terrainMaterial(m.water);
      else if (s.kind === "karst") mat = karstMaterial();
      else if (s.kind === "glow") mat = lampMaterial();
      else if (s.kind === "hero" && s.tex) {
        const tex = s.tex;
        // one material per texture, however many cells share it
        const key = tex.levels ? tex.levels[0][0] : tex.o!;
        mat = this.heroMats.get(key) ?? heroMaterial(this.texture(tex));
        this.heroMats.set(key, mat);
      } else mat = propMaterial();
      const mesh = new THREE.Mesh(geos[s.mesh], mat);
      mesh.name = `world:${s.name}`;
      mesh.frustumCulled = s.kind !== "terrain";
      if (s.kind === "hero") {
        const kind = s.name.slice(5).split("@")[0];
        if (!HERO_REFLECT.has(kind)) mesh.layers.set(NO_REFLECT);
        const near = HERO_NEAR[kind];
        if (near !== undefined) {
          const sphere = geos[s.mesh].boundingSphere!;
          this.chunks.push({ mesh, center: sphere.center.clone(), radius: sphere.radius, near });
        }
      }
      // the lanterns burn on in the river's mirror only as halos
      if (s.kind === "glow") mesh.layers.set(NO_REFLECT);
      this.group.add(mesh);
    }

    // the river: one sheet of water at its level, mirroring the valley; it reads the ground's height
    // under it, so it knows its depth (clear shallows, foam at the bank)
    const w = new THREE.Mesh(new THREE.PlaneGeometry(m.size * 2.2, m.size * 2.2), water(fs.reflection, this.groundTexture(data), m.water));
    w.position.z = m.water - 0.02;
    w.name = "world:water";
    this.group.add(w);

    // (no mist sheets: a flat layer of haze cut every trunk and cliff across at its height; the air's
    // own height fog carries the morning)

    // the glow round every lantern and flame
    const halo = { silk: haloMaterial([1, 0.3, 0.1], 3.2), flame: haloMaterial([1, 0.62, 0.25], 2.6) };
    for (const [x, y, z, kind] of m.halos ?? []) {
      const sp = new THREE.Sprite(halo[kind]);
      sp.position.set(x, y, z);
      sp.scale.setScalar(kind === "silk" ? 2.4 : 1.8);
      sp.renderOrder = 6;
      sp.name = "world:halo";
      this.group.add(sp);
      this.halos.push(sp);
    }

    const mats = new Map<string, THREE.Material>();
    this.meadow = new Meadow(data, this.ground, m.colliders, NO_REFLECT);
    this.group.add(this.meadow.group);

    for (const inst of m.instances) {
      if (inst.name === "grass") continue;
      const look = LOOK[inst.name] ?? "shrub";
      const near = NEAR[inst.name] ?? 240;
      // one draw per kind across the whole valley: the GPU drops what is far (plantMaterial's `near`);
      // chunked, the JS thread paid for every chunk's draw, eighty of them
      const key = `${look}@${near}`;
      let mat = mats.get(key);
      if (!mat) {
        mat = plantMaterial(look, near);
        mats.set(key, mat);
      }
      const base = geos[inst.mesh];
      const rows = new Float32Array(inst.chunks.reduce((n, c) => n + c.n, 0) * 5);
      let at = 0;
      for (const c of inst.chunks) {
        rows.set(data.f32(c.o, c.n * 5), at);
        at += c.n * 5;
      }
      const geo = new THREE.InstancedBufferGeometry();
      geo.index = base.index;
      for (const [name, a] of Object.entries(base.attributes)) geo.setAttribute(name, a);
      const buf = new THREE.InstancedInterleavedBuffer(rows, 5, 1);
      geo.setAttribute("i_pos", new THREE.InterleavedBufferAttribute(buf, 3, 0));
      geo.setAttribute("i_rs", new THREE.InterleavedBufferAttribute(buf, 2, 3));
      geo.instanceCount = rows.length / 5;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `world:${inst.name}`;
      mesh.frustumCulled = false;
      // the river mirrors the karst towers and their greenery, not every tree and bush (a second pass over them all costs too much)
      if (inst.name !== "karstShrub") mesh.layers.set(NO_REFLECT);
      this.group.add(mesh);
    }
    // the Meshy pieces placed many times over (bamboo, rocks, reeds, lotus): instanced per cell
    const M4 = new THREE.Matrix4();
    const Q4 = new THREE.Quaternion();
    const P4 = new THREE.Vector3();
    const S4 = new THREE.Vector3();
    const Z4 = new THREE.Vector3(0, 0, 1);
    for (const hi of m.heroInstances ?? []) {
      // every copy of a kind in one draw; the GPU shrinks away the far ones (heroMaterial's `near`)
      const near = HERO_NEAR[hi.name] ?? 240;
      const mat = heroMaterial(this.texture(hi.tex), near);
      const n = hi.chunks.reduce((k, c) => k + c.n, 0);
      const geo = geos[hi.mesh].clone();
      const centers = new Float32Array(n * 3);
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      let i = 0;
      for (const c of hi.chunks) {
        const rows = data.f32(c.o, c.n * 5);
        for (let k = 0; k < c.n; k++, i++) {
          const r = k * 5;
          P4.set(rows[r], rows[r + 1], rows[r + 2]);
          Q4.setFromAxisAngle(Z4, rows[r + 3]);
          S4.setScalar(rows[r + 4]);
          mesh.setMatrixAt(i, M4.compose(P4, Q4, S4));
          centers.set([P4.x, P4.y, P4.z], i * 3);
        }
      }
      geo.setAttribute("i_center", new THREE.InstancedBufferAttribute(centers, 3));
      mesh.name = `world:hero:${hi.name}`;
      mesh.frustumCulled = false;
      if (!HERO_REFLECT.has(hi.name)) mesh.layers.set(NO_REFLECT);
      this.group.add(mesh);
    }
    fs.camera.layers.enable(NO_REFLECT);
    this.group.visible = false;
    fs.scene.add(this.group);
    // nothing built here ever moves: its matrices are worked out once, not on every pass
    this.group.updateMatrixWorld(true);
    this.group.matrixAutoUpdate = false;
    for (const c of this.group.children) {
      c.traverse((o) => {
        o.matrixAutoUpdate = false;
      });
      this.frozen.add(c);
    }
  }

  /** The world's own pieces, which stand still (see Explore.updateMatrices). */
  readonly frozen = new Set<THREE.Object3D>();

  /**
   * The ground's height as a texture over the valley (texel centres on the
   * heightfield's samples, filtered between them), read by the water.
   */
  private groundTexture(data: WorldData) {
    const hf = data.manifest.heightfield;
    const src = data.f32(hf.o, hf.n * hf.n);
    const half = new Uint16Array(src.length);
    for (let i = 0; i < src.length; i++) half[i] = THREE.DataUtils.toHalfFloat(src[i]);
    const tex = new THREE.DataTexture(half, hf.n, hf.n, THREE.RedFormat, THREE.HalfFloatType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    const span = hf.cell * hf.n;
    const uv = TSL.positionWorld.xy.sub(hf.x0 - hf.cell / 2).div(span);
    return t3.fromTSL(TSL.texture(tex, uv).r, d.f32);
  }

  /** A hero piece's painted texture: RGB rows from the blob, widened to RGBA, mipmapped. */
  private texture(t: WorldTexture): THREE.Texture {
    if (t.astc && t.levels && this.data.textures) {
      // ASTC, straight to the GPU: a 4K texture in a ninth of its raw size, every mip level made offline
      const blob = this.data.textures;
      const mipmaps = t.levels.map(([o, n, w, h]) => ({ data: new Uint8Array(blob, o, n), width: w, height: h }));
      const format = t.astc === 6 ? THREE.RGBA_ASTC_6x6_Format : t.astc === 8 ? THREE.RGBA_ASTC_8x8_Format : THREE.RGBA_ASTC_4x4_Format;
      const tex = new THREE.CompressedTexture(mipmaps as unknown as ImageData[], t.w, t.h, format);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.flipY = false;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = false;
      tex.anisotropy = 16;
      tex.needsUpdate = true;
      return tex;
    }
    const rgb = this.data.u8(t.o!, t.w * t.h * 3);
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
    // crisp at grazing angles (a roof, a boat seen along its length)
    tex.anisotropy = 16;
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
    this.meadow.update(camera);
    const lit = this.evening > 0.25;
    for (const h of this.halos) h.visible = lit && h.position.distanceToSquared(camera) < 75 * 75;
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

  /** Is this point inside something solid (a house, a tower's foot, the hall)? */
  solidAt(p: THREE.Vector3) {
    for (const c of this.data.manifest.colliders) {
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      if (dx * dx + dy * dy < c.r * c.r && p.z < this.ground.at(c.x, c.y) + 12) return true;
    }
    return false;
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
