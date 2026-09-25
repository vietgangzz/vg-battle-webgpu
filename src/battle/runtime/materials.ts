/**
 * Turns the generated TypeGPU shader factories into three.js node materials.
 *
 * One Blender material = one three material; its animated Value nodes become
 * uniforms the player writes every frame. Surfaces are unlit MeshBasic
 * materials whose colour is the whole Blender closure (emission + our own
 * lighting), blended premultiplied: out = color + dst * transp. Volumes are
 * ray-marched inside their bounding box in their own low-resolution pass,
 * clipped against the opaque scene's depth.
 * Particles are one instanced draw each; the compiled geometry-node motion
 * places every instance in the vertex shader.
 *
 * All shader bodies here and in gen/ are TypeGPU "use gpu" functions, plugged
 * into three with @typegpu/three's toTSL.
 */
import * as t3 from "@typegpu/three";
import * as THREE from "three/webgpu";
import * as TSL from "three/tsl";
import { d, std } from "typegpu";

import type * as B from "./blender";
import type { Accessor, GnInputs, MatInputs } from "./shader-inputs";

export interface MaterialDef {
  fn: string;
  blend: "opaque" | "blend" | "volume";
  cull: boolean;
  method: string;
  params: Record<string, { d: number; t?: string }>;
  instanced?: boolean;
  /** a parameter at which 0 provably zeroes this (blended) material: skip the draw then */
  gate?: string | null;
}

/** The part of a three.js scalar uniform node the player writes. */
export interface ScalarUniform {
  value: number;
}

/** A uniform the player drives from a track (or leaves at its default). */
export interface ParamBinding {
  name: string;
  node: ScalarUniform;
  track?: string;
}

export interface BuildEnv {
  /** planar ground reflection, sharp and blurred */
  reflection: [Accessor<d.Vec3f>, Accessor<d.Vec3f>] | null;
  /** the opaque scene's view-space z at this pixel (volumes stop there) */
  sceneViewZ: Accessor<d.F32>;
  quality: { volumeSteps: number };
}

export interface BuiltMaterial {
  material: THREE.NodeMaterial;
  params: ParamBinding[];
}

type SurfaceFn = () => d.v4f;
type VolumeFn = (p: d.v3f) => d.Infer<typeof B.VolSample>;
type MotionFn = () => d.Infer<typeof B.GnOut>;

/** toTSL's node, typed for a material's colour slot */
const asColor = (n: unknown) => n as THREE.NodeMaterial["colorNode"];

const zero = () => {
  "use gpu";
  return d.f32(0);
};

const black = t3.fromTSL(TSL.vec3(0), d.vec3f);

const meshNormalWorld = () => {
  "use gpu";
  return d.vec3f(t3.normalWorld.$);
};

const meshNormalView = () => {
  "use gpu";
  return d.vec3f(t3.normalView.$);
};

interface Overrides {
  inst?: (name: string) => () => number;
  normalWorld?: () => d.v3f;
  normalView?: () => d.v3f;
}

function inputs(def: MaterialDef, env: BuildEnv, params: ParamBinding[], o: Overrides = {}): MatInputs {
  return {
    p: (name, fallback) => {
      const meta = def.params[name];
      const acc = t3.uniform(meta?.d ?? fallback, d.f32);
      params.push({ name, node: acc.node as unknown as ScalarUniform, track: meta?.t });
      return acc;
    },
    attr: (name) => t3.attribute(name, d.f32),
    inst: o.inst ?? (() => zero),
    reflection: (level) => env.reflection?.[level] ?? black,
    normalWorld: o.normalWorld ?? meshNormalWorld,
    normalView: o.normalView ?? meshNormalView,
  };
}

function applyBlend(m: THREE.NodeMaterial, def: MaterialDef) {
  m.side = def.cull ? THREE.FrontSide : THREE.DoubleSide;
  m.fog = false;
  if (def.blend === "opaque") return;
  m.transparent = true;
  m.depthWrite = false;
  m.premultipliedAlpha = false;
  m.blending = THREE.CustomBlending;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.OneFactor;
  m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
}

/** A surface material from a generated factory. */
export function buildSurface(
  name: string,
  def: MaterialDef,
  factory: (m: MatInputs) => unknown,
  env: BuildEnv,
  overrides: Overrides = {},
): BuiltMaterial {
  const params: ParamBinding[] = [];
  const shade = factory(inputs(def, env, params, overrides)) as SurfaceFn;
  const opaque = def.blend === "opaque";
  const m = new THREE.MeshBasicNodeMaterial();
  m.name = name;
  m.colorNode = asColor(t3.toTSL(() => {
    "use gpu";
    const o = shade();
    const c = std.max(o.xyz, d.vec3f());
    if (opaque) {
      return d.vec4f(c, 1);
    }
    return d.vec4f(c, std.saturate(1 - o.w));
  }));
  applyBlend(m, def);
  return { material: m, params };
}

/** World background from the generated world factory. */
export function buildWorld(def: MaterialDef, factory: (m: MatInputs) => unknown, env: BuildEnv) {
  const params: ParamBinding[] = [];
  const shade = factory(inputs(def, env, params)) as SurfaceFn;
  const node = t3.toTSL(() => {
    "use gpu";
    return d.vec4f(shade().xyz, 1);
  });
  return { node, params };
}

/**
 * Ray-marched volume inside the mesh's local bounding box: emission-absorption
 * with single scattering from every light, integrated per step analytically.
 */
export function buildVolume(
  name: string,
  def: MaterialDef,
  factory: (m: MatInputs) => unknown,
  env: BuildEnv,
  bbox: number[],
  scatter: (p: d.v3f, rd: d.v3f, g: number) => d.v3f,
): BuiltMaterial {
  const params: ParamBinding[] = [];
  const sample = factory(inputs(def, env, params)) as VolumeFn;
  const bmin = d.vec3f(bbox[0], bbox[1], bbox[2]);
  const bmax = d.vec3f(bbox[3], bbox[4], bbox[5]);
  const steps = env.quality.volumeSteps;
  const sceneViewZ = env.sceneViewZ;
  const m = new THREE.MeshBasicNodeMaterial();
  m.name = name;
  m.colorNode = asColor(t3.toTSL(() => {
    "use gpu";
    const world = t3.modelWorldMatrix.$;
    const inv = t3.modelWorldMatrixInverse.$;
    const ro = std.mul(inv, d.vec4f(t3.cameraPosition.$, 1)).xyz;
    const pe = std.mul(inv, d.vec4f(t3.positionWorld.$, 1)).xyz;
    const rd = std.normalize(std.sub(pe, ro));
    // slab intersection with the object-space box
    const t0 = std.div(std.sub(bmin, ro), rd);
    const t1 = std.div(std.sub(bmax, ro), rd);
    const tmin = std.min(t0, t1);
    const tmax = std.max(t0, t1);
    const tNear = std.max(std.max(std.max(tmin.x, tmin.y), tmin.z), 0);
    const worldPerObj = std.length(std.mul(world, d.vec4f(rd, 0)).xyz);
    // stop at the opaque scene: view depth -> distance along this ray -> object units
    const viewDir = std.normalize(t3.positionView.$);
    const sceneDist = -sceneViewZ.$ / std.max(-viewDir.z, 1e-4);
    const tFar = std.min(std.min(std.min(tmax.x, tmax.y), tmax.z), sceneDist / worldPerObj);
    const dt = std.max(tFar - tNear, 0) / steps;
    const sc = t3.screenCoordinate.$;
    const jitter = std.fract(52.9829189 * std.fract(0.06711056 * sc.x + 0.00583715 * sc.y));
    const rdW = std.normalize(std.mul(world, d.vec4f(rd, 0)).xyz);
    const ds = dt * worldPerObj;
    let acc = d.vec3f();
    let trans = d.f32(1);
    for (let i = 0; i < steps; i++) {
      const p = std.add(ro, std.mul(rd, tNear + (d.f32(i) + jitter) * dt));
      const s = sample(p);
      const sigma = std.max(s.density, 0);
      if (sigma > 0 || s.emission.x + s.emission.y + s.emission.z > 0) {
        const pw = std.mul(world, d.vec4f(p, 1)).xyz;
        const src = std.add(std.mul(std.mul(s.albedo, scatter(pw, rdW, s.aniso)), sigma), s.emission);
        const ti = std.exp(-sigma * ds);
        // integral of src * exp(-sigma s) over the step
        const w = std.select(ds, (1 - ti) / std.max(sigma, 1e-6), sigma > 1e-6);
        acc = std.add(acc, std.mul(src, w * trans));
        trans *= ti;
      }
    }
    return d.vec4f(acc, 1 - trans);
  }));
  m.side = THREE.BackSide;
  m.transparent = true;
  m.depthWrite = false;
  m.depthTest = false;
  m.premultipliedAlpha = false;
  m.blending = THREE.CustomBlending;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.fog = false;
  return { material: m, params };
}

/** Align Rotation to Vector (X axis): a basis whose X follows `dir`. */
const alignX = (dir: d.v3f) => {
  "use gpu";
  const len = std.length(dir);
  const x = std.select(d.vec3f(1, 0, 0), std.div(dir, std.max(len, 1e-6)), len > 1e-6);
  const up = std.select(d.vec3f(0, 0, 1), d.vec3f(0, 1, 0), std.abs(x.z) > 0.999);
  const y = std.normalize(std.cross(up, x));
  return d.mat3x3f(x, y, std.cross(x, y));
};

/**
 * One instanced particle system: the instance shape is the geometry, the point
 * cloud's attributes are instanced attributes (prefixed "i_"), the compiled GN
 * motion places each instance; the shape's material reads the same motion's
 * age for its colour ramp.
 */
export function buildParticles(
  name: string,
  def: MaterialDef,
  factory: (m: MatInputs) => unknown,
  motionFactory: (g: GnInputs) => unknown,
  groupInputs: Record<string, Accessor<d.F32>>,
  env: BuildEnv,
): BuiltMaterial {
  const g: GnInputs = {
    i: (n) => groupInputs[n] ?? t3.uniform(0, d.f32),
    p0: t3.attribute("i_position", d.vec3f),
    af: (n) => t3.attribute("i_" + n, d.f32),
    av: (n) => t3.attribute("i_" + n, d.vec3f),
  };
  const motion = motionFactory(g) as MotionFn;
  const age = () => {
    "use gpu";
    return motion().age;
  };
  const pseed = () => {
    "use gpu";
    return motion().pseed;
  };
  // the shape's normals turn with the instance (rim-lit debris reads its facing ratio)
  const normalWorld = () => {
    "use gpu";
    const o = motion();
    const n = std.mul(alignX(o.dir), std.div(t3.normalGeometry.$, std.max(o.scale, d.vec3f(1e-6))));
    return std.normalize(std.mul(t3.modelNormalMatrix.$, std.normalize(n)));
  };
  const normalView = () => {
    "use gpu";
    return std.normalize(std.mul(t3.cameraViewMatrix.$, d.vec4f(normalWorld(), 0)).xyz);
  };
  const built = buildSurface(name, def, factory, env, {
    inst: (n) => (n === "pseed" ? pseed : age),
    normalWorld,
    normalView,
  });
  built.material.positionNode = t3.toTSL(() => {
    "use gpu";
    const o = motion();
    const alive = std.select(d.f32(1), d.f32(0), o.dead > 0.5);
    const local = std.mul(t3.positionGeometry.$, std.mul(o.scale, alive));
    return std.add(std.mul(alignX(o.dir), local), o.pos);
  });
  return built;
}
