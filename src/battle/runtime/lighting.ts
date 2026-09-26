/**
 * Scene lighting as uniforms, evaluated inside our own shaders (TypeGPU).
 *
 * Blender units carry over directly: a sun's strength is irradiance (W/m^2);
 * a point light of power P gives irradiance P / (4 pi d^2). A white Lambert
 * surface then leaves E / pi. The toon ramps in the materials were tuned
 * against those numbers in EEVEE, so they need no retuning here.
 *
 * Shadows are not shadow-mapped. The only shadows that read in the film are
 * the two Little Giants on the ground, so ground surfaces get soft blob shadows
 * projected along each sun from the body centres; everything else is lit
 * unshadowed (toon ramps on convex blobs barely self-shadow).
 *
 * The light rig is one set of uniforms shared by every material; lights at
 * zero energy (the impact flashes, most of the time) are skipped per pixel.
 */
import * as t3 from "@typegpu/three";
import * as THREE from "three/webgpu";
import { d, std } from "typegpu";
import { shared } from "./shared";

export const MAX_SUNS = 4;
export const MAX_POINTS = 16;
export const MAX_BLOBS = 8;

const vec4s = (n: number) => Array.from({ length: n }, () => new THREE.Vector4());

/** CPU side of the rig: write these every frame. */
export const rig = {
  /** xyz = direction toward the sun */
  sunDir: vec4s(MAX_SUNS),
  /** rgb = colour * strength */
  sunRad: vec4s(MAX_SUNS),
  /** xyz = position, w = radius^2 (softens 1/d^2 like Blender's sphere lights) */
  ptPos: vec4s(MAX_POINTS),
  /** rgb = colour * power / (4 pi), w = EEVEE's volume factor */
  ptRad: vec4s(MAX_POINTS),
  /** xyz = occluder centre, w = radius (0 disables) */
  blobs: vec4s(MAX_BLOBS),
  ambient: new THREE.Vector3(0.02, 0.009, 0.009),
};

const U = {
  sunDir: t3.uniformArray(rig.sunDir, d.vec4f),
  sunRad: t3.uniformArray(rig.sunRad, d.vec4f),
  ptPos: t3.uniformArray(rig.ptPos, d.vec4f),
  ptRad: t3.uniformArray(rig.ptRad, d.vec4f),
  blobs: t3.uniformArray(rig.blobs, d.vec4f),
  ambient: shared(rig.ambient, d.vec3f),
};

const INV_PI = 1 / Math.PI;

/** Soft blob shadow on a ground point from both bodies for one sun (1 = lit). */
const blobShadow = (p: d.v3f, L: d.v3f) => {
  "use gpu";
  let lit = d.f32(1);
  for (let i = 0; i < MAX_BLOBS; i++) {
    const b = U.blobs.$[i];
    if (b.w > 0) {
      const h = b.z - p.z;
      // where the body centre falls along the sun onto this point's height
      const s = std.sub(b.xyz, std.mul(L, h / std.max(L.z, 0.05)));
      const dist = std.length(std.sub(p.xy, s.xy));
      const soft = b.w * (1 + h * 0.25);
      const shade = std.smoothstep(soft, b.w * 0.3, dist) * (1 - std.smoothstep(0, 4, h));
      lit *= 1 - shade * 0.85;
    }
  }
  return lit;
};

/** Irradiance from every light on a white Lambert surface, / pi, plus ambient. */
export const diffuse = (p: d.v3f, n: d.v3f, blob: boolean) => {
  "use gpu";
  let e = d.vec3f();
  for (let i = 0; i < MAX_SUNS; i++) {
    const rad = U.sunRad.$[i].xyz;
    if (rad.x + rad.y + rad.z > 0) {
      const L = U.sunDir.$[i].xyz;
      let k = std.max(std.dot(n, L), 0);
      if (blob) {
        k *= blobShadow(p, L);
      }
      e = std.add(e, std.mul(rad, k));
    }
  }
  for (let i = 0; i < MAX_POINTS; i++) {
    const rad = U.ptRad.$[i].xyz;
    if (rad.x + rad.y + rad.z > 0) {
      const lp = U.ptPos.$[i];
      const dv = std.sub(lp.xyz, p);
      const d2 = std.dot(dv, dv) + lp.w;
      const k = std.max(std.dot(n, std.mul(dv, std.inverseSqrt(d2))), 0) / d2;
      e = std.add(e, std.mul(rad, k));
    }
  }
  return std.add(std.mul(e, INV_PI), U.ambient.$);
};

/** GGX specular lobe (Smith-correlated visibility, Schlick Fresnel) times irradiance. */
const lobe = (n: d.v3f, v: d.v3f, l: d.v3f, rad: d.v3f, f0: d.v3f, a2: number) => {
  "use gpu";
  const h = std.normalize(std.add(l, v));
  const nl = std.max(std.dot(n, l), 0);
  const nv = std.max(std.dot(n, v), 1e-4);
  const nh = std.max(std.dot(n, h), 0);
  const vh = std.max(std.dot(v, h), 0);
  const dd = nh * nh * (a2 - 1) + 1;
  const D = a2 / (Math.PI * dd * dd);
  const gv = nl * std.sqrt(nv * nv * (1 - a2) + a2);
  const gl = nv * std.sqrt(nl * nl * (1 - a2) + a2);
  const vis = 0.5 / std.max(gv + gl, 1e-5);
  const F = std.add(f0, std.mul(std.sub(d.vec3f(1), f0), std.pow(1 - vh, 5)));
  return std.mul(std.mul(F, D * vis * nl), rad);
};

/**
 * Principled BSDF: Lambert diffuse + GGX specular, Blender's dielectric
 * F0 = 0.08 * specular level. `env` is reflected radiance (the planar
 * reflection on the ground) used when `useEnv`, else the ambient sky.
 */
export const pbr = (
  p: d.v3f,
  n: d.v3f,
  v: d.v3f,
  base: d.v3f,
  rough: number,
  spec: number,
  metal: number,
  env: d.v3f,
  useEnv: boolean,
  blob: boolean,
) => {
  "use gpu";
  const a = std.max(rough * rough, 0.002);
  const a2 = a * a;
  const f0 = std.mix(d.vec3f(spec * 0.08), base, metal);
  let s = d.vec3f();
  for (let i = 0; i < MAX_SUNS; i++) {
    const rad = U.sunRad.$[i].xyz;
    if (rad.x + rad.y + rad.z > 0) {
      const L = U.sunDir.$[i].xyz;
      let term = lobe(n, v, L, rad, f0, a2);
      if (blob) {
        term = std.mul(term, blobShadow(p, L));
      }
      s = std.add(s, term);
    }
  }
  for (let i = 0; i < MAX_POINTS; i++) {
    const rad = U.ptRad.$[i].xyz;
    if (rad.x + rad.y + rad.z > 0) {
      const lp = U.ptPos.$[i];
      const dv = std.sub(lp.xyz, p);
      const d2 = std.dot(dv, dv) + lp.w;
      s = std.add(s, lobe(n, v, std.mul(dv, std.inverseSqrt(d2)), std.div(rad, d2), f0, a2));
    }
  }
  // environment: Schlick with roughness
  const nv = std.max(std.dot(n, v), 1e-4);
  const fe = std.add(f0, std.mul(std.sub(std.max(d.vec3f(1 - rough), f0), f0), std.pow(1 - nv, 5)));
  const envCol = std.select(std.mul(U.ambient.$, Math.PI), env, useEnv);
  s = std.add(s, std.mul(fe, envCol));
  const kd = std.mul(base, 1 - metal);
  return std.add(std.mul(kd, diffuse(p, n, blob)), s);
};

/** In-scattered radiance at a volume sample (Henyey-Greenstein). rd = world ray direction. */
export const scatter = (p: d.v3f, rd: d.v3f, g: number) => {
  "use gpu";
  const gg = std.clamp(g, -0.95, 0.95);
  const k = (1 - gg * gg) / (4 * Math.PI);
  let e = d.vec3f(U.ambient.$);
  for (let i = 0; i < MAX_SUNS; i++) {
    const rad = U.sunRad.$[i].xyz;
    const c = std.dot(U.sunDir.$[i].xyz, rd);
    const hg = k / std.pow(std.max(1 + gg * gg - 2 * gg * c, 1e-4), 1.5);
    e = std.add(e, std.mul(rad, hg));
  }
  for (let i = 0; i < MAX_POINTS; i++) {
    const r = U.ptRad.$[i];
    if (r.x + r.y + r.z > 0) {
      const lp = U.ptPos.$[i];
      const dv = std.sub(lp.xyz, p);
      const d2 = std.dot(dv, dv) + lp.w;
      const c = std.dot(std.mul(dv, std.inverseSqrt(d2)), rd);
      const hg = k / std.pow(std.max(1 + gg * gg - 2 * gg * c, 1e-4), 1.5);
      e = std.add(e, std.mul(r.xyz, (r.w * hg) / d2));
    }
  }
  return e;
};
