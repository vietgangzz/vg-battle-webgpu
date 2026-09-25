/**
 * Builds the three.js scene from the exported film and poses it at any frame.
 *
 * Coordinates stay in Blender's Z-up world: matrices are copied as-is, and a
 * Blender camera already looks down its local -Z with +Y up, like three's.
 */
import * as t3 from "@typegpu/three";
import * as THREE from "three/webgpu";
import * as TSL from "three/tsl";
import { d } from "typegpu";

import { MATERIALS, world as worldFn } from "../gen/materials";
import { PARTICLES } from "../gen/particles";
import * as B from "./blender";
import type { Film, MeshMeta, ObjectMeta, Track, XfMeta } from "./film";
import { MAX_POINTS, MAX_SUNS, rig, scatter } from "./lighting";
import {
  buildParticles,
  buildSurface,
  buildVolume,
  buildWorld,
  type BuildEnv,
  type BuiltMaterial,
  type ParamBinding,
  type ScalarUniform,
} from "./materials";
import type { Accessor, MatInputs } from "./shader-inputs";

export interface Quality {
  /** ray-march steps through the fog and the maelstrom glow */
  volumeSteps: number;
  /** resolution of the volume pass relative to the screen (EEVEE's volumes are low-res too) */
  volumeScale: number;
  /** fBm octave cap inside volumes */
  volumeOctaves: number;
  /** planar ground reflection resolution (0 disables) */
  reflectionScale: number;
  /** fBm octave cap on surfaces */
  maxOctaves: number;
}

export const DEFAULT_QUALITY: Quality = {
  volumeSteps: 16,
  volumeScale: 0.5,
  volumeOctaves: 2,
  reflectionScale: 0.5,
  maxOctaves: 8,
};

/** How the 16:9 film frame maps onto an arbitrary screen. */
export interface Framing {
  /** screen aspect (w / h) */
  aspect: number;
  /** aspect of the region that must always stay visible (4:3 keeps the action on unfolded phones) */
  safeAspect: number;
}

export const FILM_ASPECT = 16 / 9;

class Xf {
  readonly p: Track;
  readonly q: Track;
  readonly s: Track;
  private readonly a = [0, 0, 0, 0];

  constructor(film: Film, m: XfMeta) {
    this.p = film.track(m.p);
    this.q = film.track(m.q);
    this.s = film.track(m.s);
  }

  get animated() {
    return !(this.p.constant && this.q.constant && this.s.constant);
  }

  compose(frame: number, out: THREE.Matrix4) {
    const a = this.a;
    this.p.read(frame, a);
    V1.set(a[0], a[1], a[2]);
    this.q.read(frame, a);
    Q1.set(a[0], a[1], a[2], a[3]).normalize();
    this.s.read(frame, a);
    V2.set(a[0], a[1], a[2]);
    return out.compose(V1, Q1, V2);
  }
}

const V1 = new THREE.Vector3();
const V2 = new THREE.Vector3();
const Q1 = new THREE.Quaternion();
const M1 = new THREE.Matrix4();

interface Placed {
  obj: THREE.Object3D;
  xf: Xf;
  vis?: Track;
  /** drawn only while one of these is non-zero (every material is provably blank at 0) */
  gates?: ScalarUniform[];
  overlay?: boolean;
  deform?: { data: Float32Array; frames: number; verts: number; attr: THREE.BufferAttribute; geo: THREE.BufferGeometry };
}

interface LightEntry {
  xf: Xf;
  energy: Track;
  color: THREE.Color;
  slot: number;
  /** point lights: radius^2 and EEVEE volume factor */
  soft: number;
  vol: number;
}

interface Bound {
  node: ScalarUniform;
  track: Track;
}

export class FilmScene {
  readonly scene = new THREE.Scene();
  /** fog + maelstrom glow, ray-marched at reduced resolution */
  readonly volumes = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(35, FILM_ASPECT, 0.05, 2000);
  /**
   * Render targets, drawn explicitly in order each frame (scene, then volumes,
   * then the compositor): the volumes read the scene's depth, the compositor both.
   */
  readonly sceneTarget = new THREE.RenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    depthTexture: new THREE.DepthTexture(1, 1),
  });
  readonly volumeTarget = new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType });
  /** the scene's view-space z at the current screen position */
  readonly sceneViewZ = TSL.perspectiveDepthToViewZ(
    TSL.texture(this.sceneTarget.depthTexture!, TSL.screenUV).x,
    TSL.cameraNear,
    TSL.cameraFar,
  );
  /** active camera's DOF (null when the shot has none) */
  dof: { focus: number; fstop: number } | null = null;
  /** vertical scale of the film frame on screen (1 = film fills the height) */
  filmHeightOnScreen = 1;

  private readonly placed: Placed[] = [];
  private readonly bound: Bound[] = [];
  private readonly suns: LightEntry[] = [];
  private readonly points: LightEntry[] = [];
  private readonly cams: { xf: Xf; lens: Track; sensor: number; clip: [number, number]; focus?: Track; fstop: number }[] = [];
  private readonly cuts: [number, number][];
  private readonly blobs: { xf: Xf; slot: number }[] = [];
  private readonly ambientBase = new THREE.Vector3(0.02, 0.009, 0.009);
  private skyGain?: Track;
  private skyFlash?: Track;
  private readonly overlayScale = new THREE.Vector3(1, 1, 1);

  constructor(
    readonly film: Film,
    readonly quality: Quality = DEFAULT_QUALITY,
  ) {
    B.quality.maxOctaves = quality.maxOctaves;
    B.quality.volumeOctaves = quality.volumeOctaves;
    const man = film.manifest;
    this.cuts = man.cuts;
    this.camera.up.set(0, 0, 1);

    // the wet ground mirrors the scene; roughness picks between a sharp and a blurred mip
    let reflection: BuildEnv["reflection"] = null;
    if (quality.reflectionScale > 0) {
      const r = TSL.reflector({ resolutionScale: quality.reflectionScale, generateMipmaps: true });
      this.scene.add(r.target);
      reflection = [t3.fromTSL(r.level(TSL.float(0)).rgb, d.vec3f), t3.fromTSL(r.level(TSL.float(5)).rgb, d.vec3f)];
    }
    const env: BuildEnv = {
      reflection,
      sceneViewZ: t3.fromTSL(this.sceneViewZ, d.f32),
      quality: { volumeSteps: quality.volumeSteps },
    };

    // ---- world
    const w = buildWorld({ fn: "world", blend: "opaque", cull: false, method: "", params: man.world.params }, worldFn, env);
    this.scene.backgroundNode = w.node;
    this.bind(w.params);
    const wg = man.world.params.sky_gain?.t;
    const wf = man.world.params.sky_flash?.t;
    if (wg) this.skyGain = film.track(wg);
    if (wf) this.skyFlash = film.track(wf);

    // ---- surfaces
    const geos = man.meshes.map((m) => this.geometry(m));
    const mats = new Map<string, BuiltMaterial>();
    const surface = (name: string) => {
      let b = mats.get(name);
      if (!b) {
        const def = man.materials[name];
        b = buildSurface(name, def, factoryOf(def.fn), env);
        mats.set(name, b);
        this.bind(b.params);
      }
      return b;
    };
    const t0 = performance.now();
    for (const om of man.objects) this.addObject(om, geos[om.mesh], man.meshes[om.mesh], surface, env);
    console.log("[film] surfaces", mats.size, Math.round(performance.now() - t0), "ms");

    // ---- particles
    for (const pm of man.particles) {
      if (!pm.shape) continue;
      const def = man.materials[pm.shape.mat];
      const inputs: Record<string, Accessor<d.F32>> = {};
      for (const [k, key] of Object.entries(pm.inputs)) {
        const tr = film.track(key);
        const u = t3.uniform(tr.value(0), d.f32);
        inputs[k] = u;
        if (!tr.constant) this.bound.push({ node: u.node as unknown as ScalarUniform, track: tr });
      }
      const built = buildParticles(pm.shape.mat + "@" + pm.name, def, factoryOf(def.fn), PARTICLES[pm.group], inputs, env);
      this.bind(built.params);
      const geo = new THREE.InstancedBufferGeometry();
      const shape = this.geometry(pm.shape.mesh);
      geo.setIndex(shape.index);
      for (const [n, a] of Object.entries(shape.attributes)) geo.setAttribute(n, a);
      for (const [n, a] of Object.entries(pm.attrs)) {
        geo.setAttribute("i_" + n, new THREE.InstancedBufferAttribute(film.f32(a.o, pm.count * a.w), a.w));
      }
      geo.instanceCount = pm.count;
      const mesh = new THREE.Mesh(geo, built.material);
      mesh.name = pm.name;
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      this.scene.add(mesh);
      this.placed.push({ obj: mesh, xf: new Xf(film, pm.xf) });
    }

    // ---- lights
    for (const lm of man.lights) {
      const entry = {
        xf: new Xf(film, lm.xf),
        energy: film.track(lm.energy),
        color: new THREE.Color(...(lm.color as [number, number, number])),
        slot: 0,
        soft: 0,
        vol: 1,
      };
      if (lm.type === "SUN") {
        if (this.suns.length >= MAX_SUNS) continue;
        entry.slot = this.suns.length;
        this.suns.push(entry);
      } else {
        if (this.points.length >= MAX_POINTS) continue;
        entry.slot = this.points.length;
        entry.soft = Math.max(lm.radius * lm.radius, 0.0025);
        entry.vol = lm.volume;
        this.points.push(entry);
      }
    }

    // ---- cameras
    for (const cm of man.cameras) {
      this.cams.push({
        xf: new Xf(film, cm.xf),
        lens: film.track(cm.lens),
        sensor: cm.sensor,
        clip: cm.clip,
        focus: cm.dof ? film.track(cm.dof.focus) : undefined,
        fstop: cm.dof?.fstop ?? 0,
      });
    }

    // ---- blob shadow casters: the two Little Giants
    ["sora_body", "kage_body"].forEach((name, slot) => {
      const om = man.objects.find((o) => o.name === name);
      if (om) this.blobs.push({ xf: new Xf(film, om.xf), slot });
    });
  }

  private bind(params: ParamBinding[]) {
    for (const p of params) {
      if (!p.track) continue;
      const tr = this.film.track(p.track);
      p.node.value = tr.value(0);
      if (!tr.constant) this.bound.push({ node: p.node, track: tr });
    }
  }

  private geometry(m: MeshMeta) {
    const g = new THREE.BufferGeometry();
    for (const [name, a] of Object.entries(m.attrs)) {
      g.setAttribute(name, new THREE.BufferAttribute(this.film.f32(a.o, m.count * a.w), a.w));
    }
    g.setIndex(new THREE.BufferAttribute(this.film.u32(m.index.o, m.index.n), 1));
    const [x0, y0, z0, x1, y1, z1] = m.bbox;
    g.boundingBox = new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    return g;
  }

  private addObject(
    om: ObjectMeta,
    base: THREE.BufferGeometry,
    mm: MeshMeta,
    surface: (name: string) => BuiltMaterial,
    env: BuildEnv,
  ) {
    const man = this.film.manifest;
    // share vertex data, own the material groups (ghost copies of a body differ only in material)
    const geo = new THREE.BufferGeometry();
    for (const [n, a] of Object.entries(base.attributes)) geo.setAttribute(n, a);
    geo.setIndex(base.index);
    geo.boundingBox = base.boundingBox;
    geo.boundingSphere = base.boundingSphere;

    const materials: THREE.Material[] = [];
    const gates: ScalarUniform[] = [];
    let gated = true;
    let volume = false;
    om.groups.forEach((g, i) => {
      const def = man.materials[g.mat];
      if (def.blend === "volume") {
        const b = buildVolume(g.mat + "@" + om.name, def, factoryOf(def.fn), env, mm.bbox, scatter);
        this.bind(b.params);
        materials.push(b.material);
        volume = true;
      } else {
        const b = surface(g.mat);
        materials.push(b.material);
        const gate = def.gate ? b.params.find((p) => p.name === def.gate) : undefined;
        if (gate) gates.push(gate.node);
        else gated = false;
      }
      geo.addGroup(g.start, g.count, i);
    });

    let deform: Placed["deform"];
    if (om.deform) {
      const pos = (base.getAttribute("position") as THREE.BufferAttribute).clone();
      pos.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute("position", pos);
      const nrm = (base.getAttribute("normal") as THREE.BufferAttribute).clone();
      nrm.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute("normal", nrm);
      deform = {
        data: this.film.f32(om.deform.o, om.deform.n * om.deform.verts * 3),
        frames: om.deform.n,
        verts: om.deform.verts,
        attr: pos,
        geo,
      };
    }

    const mesh = new THREE.Mesh(geo, materials.length === 1 ? materials[0] : materials);
    mesh.name = om.name;
    mesh.matrixAutoUpdate = false;
    // deforming tails move outside their frame-0 bounds; the ground is always in view
    mesh.frustumCulled = !om.deform && om.name !== "ground";
    (volume ? this.volumes : this.scene).add(mesh);
    this.placed.push({
      obj: mesh,
      xf: new Xf(this.film, om.xf),
      vis: this.film.track(om.vis),
      gates: gated && gates.length ? gates : undefined,
      overlay: !!om.overlay,
      deform,
    });
  }

  /** Active camera index at a frame (last cut at or before it). */
  private camAt(frame: number) {
    let idx = this.cuts[0]?.[1] ?? 0;
    for (const [f, c] of this.cuts) {
      if (f <= frame) idx = c;
      else break;
    }
    return idx;
  }

  /** Pose everything at a fractional film frame. */
  update(frame: number, framing: Framing) {
    // camera first: overlays glued to it need this frame's field of view
    this.updateCamera(frame, framing);

    for (const b of this.bound) b.node.value = b.track.value(frame);
    for (const p of this.placed) {
      p.xf.compose(frame, p.obj.matrix);
      if (p.overlay) p.obj.matrix.scale(this.overlayScale);
      if (p.vis) p.obj.visible = p.vis.value(frame) > 0.5;
      if (p.gates && p.obj.visible) p.obj.visible = p.gates.some((g) => g.value !== 0);
      if (p.deform && p.obj.visible) this.deform(p.deform, frame);
    }

    for (const s of this.suns) {
      s.xf.compose(frame, M1);
      // a Blender sun shines along its local -Z; store the direction toward the light
      V1.setFromMatrixColumn(M1, 2).normalize();
      rig.sunDir[s.slot].set(V1.x, V1.y, V1.z, 0);
      const e = s.energy.value(frame);
      rig.sunRad[s.slot].set(s.color.r * e, s.color.g * e, s.color.b * e, 0);
    }
    for (const pt of this.points) {
      pt.xf.compose(frame, M1);
      V1.setFromMatrixPosition(M1);
      rig.ptPos[pt.slot].set(V1.x, V1.y, V1.z, pt.soft);
      const e = pt.energy.value(frame) / (4 * Math.PI);
      rig.ptRad[pt.slot].set(pt.color.r * e, pt.color.g * e, pt.color.b * e, pt.vol);
    }
    for (const b of this.blobs) {
      b.xf.compose(frame, M1);
      V1.set(0, 0, 0.6).applyMatrix4(M1);
      rig.blobs[b.slot].set(V1.x, V1.y, V1.z, 0.55);
    }
    const gain = this.skyGain ? this.skyGain.value(frame) : 1;
    const flash = this.skyFlash ? this.skyFlash.value(frame) : 0;
    rig.ambient.copy(this.ambientBase).multiplyScalar(gain).addScalar(flash * 0.15);
  }

  private updateCamera(frame: number, framing: Framing) {
    const c = this.cams[this.camAt(Math.floor(frame + 1e-4))];
    c.xf.compose(frame, M1);
    M1.decompose(V1, Q1, V2);
    this.camera.position.copy(V1);
    this.camera.quaternion.copy(Q1);
    // Blender: horizontal sensor fit on a 16:9 frame
    const tanH = c.sensor / 2 / c.lens.value(frame);
    const tanVFilm = tanH / FILM_ASPECT;
    // keep the safe region fully visible, extend the view to fill the rest of the screen
    const tanV = tanVFilm * Math.max(1, framing.safeAspect / framing.aspect);
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(tanV));
    this.camera.aspect = framing.aspect;
    this.camera.near = c.clip[0];
    this.camera.far = c.clip[1];
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
    this.filmHeightOnScreen = tanVFilm / tanV;
    // camera-glued overlays were framed for the film; stretch them to the screen
    const tanHScreen = tanV * framing.aspect;
    this.overlayScale.set(Math.max(1, tanHScreen / tanH), Math.max(1, tanV / tanVFilm), 1);
    this.dof = c.focus ? { focus: c.focus.value(frame), fstop: c.fstop } : null;
  }

  private deform(d: NonNullable<Placed["deform"]>, frame: number) {
    const f = Math.min(Math.max(frame, 0), d.frames - 1);
    const i0 = Math.floor(f);
    const i1 = Math.min(i0 + 1, d.frames - 1);
    const t = f - i0;
    const n = d.verts * 3;
    const out = d.attr.array as Float32Array;
    const a0 = i0 * n;
    const a1 = i1 * n;
    for (let k = 0; k < n; k++) out[k] = d.data[a0 + k] + (d.data[a1 + k] - d.data[a0 + k]) * t;
    d.attr.needsUpdate = true;
    d.geo.computeVertexNormals();
  }

  /** Make every object visible once so the renderer can compile all pipelines up front. */
  showAll() {
    const was = this.placed.map((p) => p.obj.visible);
    for (const p of this.placed) p.obj.visible = true;
    return () => this.placed.forEach((p, i) => (p.obj.visible = was[i]));
  }
}

function factoryOf(name: string): (m: MatInputs) => unknown {
  const fn = MATERIALS[name];
  if (!fn) throw new Error(`[film] material function ${name} missing`);
  return fn;
}
