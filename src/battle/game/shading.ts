/**
 * Shading for everything the game builds itself, in the film's own language:
 * the Little Giants' three-band toon ramp under the shared light rig, ink
 * outlines from an inverted hull, plus what the film never needed: a sky with
 * a sun and drifting clouds, height fog that melts far mountains into the air,
 * jade water that mirrors the world, and a sea of clouds.
 *
 * Every stage's look is a handful of uniforms (ENV) the stage writes once, so
 * all stages share the same compiled pipelines.
 */
import * as t3 from "@typegpu/three";
import * as THREE from "three/webgpu";
import * as TSL from "three/tsl";
import { d, std } from "typegpu";

import * as B from "../runtime/blender";
import { diffuse } from "../runtime/lighting";
import type { Accessor } from "../runtime/shader-inputs";

export type RGB = [number, number, number];

/** The current stage's air, sky and water. */
export const ENV = {
  fogColor: new THREE.Vector3(0.5, 0.6, 0.62),
  skyTop: new THREE.Vector3(0.2, 0.35, 0.55),
  skyHorizon: new THREE.Vector3(0.7, 0.75, 0.72),
  skyBelow: new THREE.Vector3(0.3, 0.36, 0.34),
  sunDir: new THREE.Vector3(-0.3, 0.6, 0.5).normalize(),
  sunColor: new THREE.Vector3(1, 0.9, 0.75),
  cloudTint: new THREE.Vector3(0.95, 0.93, 0.9),
  waterDeep: new THREE.Vector3(0.02, 0.12, 0.1),
  waterShallow: new THREE.Vector3(0.1, 0.35, 0.28),
  cloudSeaLit: new THREE.Vector3(1, 0.9, 0.85),
  cloudSeaShade: new THREE.Vector3(0.45, 0.5, 0.65),
};
const scalar = { fogDensity: 0.012, fogHeight: 7, cloudCover: 0.45, sunSize: 1, stars: 0 };
type Scalar = keyof typeof scalar;

const U = {
  fogColor: t3.uniform(ENV.fogColor, d.vec3f),
  skyTop: t3.uniform(ENV.skyTop, d.vec3f),
  skyHorizon: t3.uniform(ENV.skyHorizon, d.vec3f),
  skyBelow: t3.uniform(ENV.skyBelow, d.vec3f),
  sunDir: t3.uniform(ENV.sunDir, d.vec3f),
  sunColor: t3.uniform(ENV.sunColor, d.vec3f),
  cloudTint: t3.uniform(ENV.cloudTint, d.vec3f),
  waterDeep: t3.uniform(ENV.waterDeep, d.vec3f),
  waterShallow: t3.uniform(ENV.waterShallow, d.vec3f),
  cloudSeaLit: t3.uniform(ENV.cloudSeaLit, d.vec3f),
  cloudSeaShade: t3.uniform(ENV.cloudSeaShade, d.vec3f),
  fogDensity: t3.uniform(scalar.fogDensity, d.f32),
  fogHeight: t3.uniform(scalar.fogHeight, d.f32),
  cloudCover: t3.uniform(scalar.cloudCover, d.f32),
  sunSize: t3.uniform(scalar.sunSize, d.f32),
  stars: t3.uniform(scalar.stars, d.f32),
};

export function setScalar(name: Scalar, v: number) {
  (U[name].node as unknown as { value: number }).value = v;
}

/** Height fog: thicker low down, so valleys fill with mist and far peaks fade into the sky. */
export const fog = (col: d.v3f, pw: d.v3f) => {
  "use gpu";
  const cam = t3.cameraPosition.$;
  // clear air around the fight; the mist gathers with distance and low over the water
  const dist = std.max(std.length(std.sub(pw, cam)) - 18, 0);
  const h = std.max(pw.z + 2, 0);
  const dens = U.fogDensity.$ * (0.35 + std.exp(-h / U.fogHeight.$) * 1.3);
  const k = std.saturate(1 - std.exp(-dist * dens)) * 0.92;
  return std.mix(col, U.fogColor.$, k);
};

// ---------------------------------------------------------------- materials

export interface Palette {
  base: RGB;
  shade: RGB;
  rim: RGB;
  rimK: number;
  /** blotchy variation over the surface (0 = flat colour), for stone and leaves */
  mottle?: number;
  /** receives the fighters' blob shadows (the ground they stand on) */
  blob?: boolean;
  /** fades into the fog (everything but the film's own crimson plain props) */
  fogged?: boolean;
}

/** Three-band cel shading (battle/lib/mascot.toon), with mottling and fog. */
export function toon(p: Palette) {
  const Bc = d.vec3f(...p.base);
  const S = d.vec3f(...p.shade);
  const R = d.vec3f(...p.rim);
  const rimK = p.rimK;
  const mottle = p.mottle ?? 0;
  const blob = !!p.blob;
  const fogged = p.fogged ?? true;
  const m = new THREE.MeshBasicNodeMaterial();
  m.colorNode = t3.toTSL(() => {
    "use gpu";
    const n = std.normalize(t3.normalWorld.$);
    const pw = t3.positionWorld.$;
    const v = std.normalize(std.sub(t3.cameraPosition.$, pw));
    const e = diffuse(pw, n, blob);
    const lum = e.x * 0.2126 + e.y * 0.7152 + e.z * 0.0722;
    const band = std.select(std.select(d.f32(1), d.f32(0.55), lum < 0.22), d.f32(0), lum < 0.06);
    let base = d.vec3f(Bc);
    let shade = d.vec3f(S);
    if (mottle > 0) {
      const k = B.noise3(pw, 0.45, 3, 0.55, 2, 0);
      const f = 1 - mottle + mottle * 1.6 * k;
      base = std.mul(base, f);
      shade = std.mul(shade, f);
    }
    let col = std.add(std.mix(shade, base, band), std.mul(std.mul(e, base), 0.1));
    const facing = 1 - std.abs(std.dot(n, v));
    col = std.add(col, std.mul(R, std.smoothstep(0.72, 0.93, facing) * rimK));
    if (fogged) {
      col = fog(col, pw);
    }
    return d.vec4f(col, 1);
  }) as THREE.NodeMaterial["colorNode"];
  m.fog = false;
  return m;
}

/** Light-emitting surface, bright enough for the bloom to take (fogged like the rest). */
export function glow(c: RGB, strength: number, fogged = true) {
  const col = d.vec3f(c[0] * strength, c[1] * strength, c[2] * strength);
  const m = new THREE.MeshBasicNodeMaterial();
  m.colorNode = t3.toTSL(() => {
    "use gpu";
    if (fogged) {
      return d.vec4f(fog(col, t3.positionWorld.$), 1);
    }
    return d.vec4f(col, 1);
  }) as THREE.NodeMaterial["colorNode"];
  m.fog = false;
  return m;
}

/** Ink outline: the back faces pushed out along the normals, drawn black. */
export function hull(thickness: number) {
  const m = new THREE.MeshBasicNodeMaterial();
  m.colorNode = TSL.vec4(0, 0, 0, 1);
  m.positionNode = TSL.positionLocal.add(TSL.normalLocal.mul(thickness));
  m.side = THREE.BackSide;
  m.fog = false;
  return m;
}

/** The sky: a graded dome, a sun with its glow, clouds drifting on a high plane, the horizon lost in haze. */
export function skyNode() {
  return t3.toTSL(() => {
    "use gpu";
    const dir = std.normalize(t3.positionWorldDirection.$);
    const z = dir.z;
    const t = t3.time.$;
    let col = std.mix(U.skyHorizon.$, U.skyTop.$, std.pow(std.saturate(z), 0.5));
    col = std.mix(col, U.skyBelow.$, std.saturate(-z * 5));
    // the sun and its halo
    const sd = std.saturate(std.dot(dir, U.sunDir.$));
    const disc = std.smoothstep(1 - 0.00045 * U.sunSize.$, 1 - 0.00025 * U.sunSize.$, sd);
    col = std.add(col, std.mul(U.sunColor.$, std.pow(sd, 6) * 0.35 + std.pow(sd, 64) * 0.5 + disc * 5));
    // stars, for the dawn sky
    if (U.stars.$ > 0) {
      const s = B.whiteNoise(std.floor(std.mul(dir, 260)));
      col = std.add(col, d.vec3f(std.step(0.996, s) * U.stars.$ * std.saturate(z * 3)));
    }
    // clouds on a plane high above: dir / z, drifting
    const plane = std.div(dir.xy, std.max(z, 0.04) + 0.08);
    const q = d.vec3f(plane.x * 0.55 + t * 0.012, plane.y * 0.55 + t * 0.004, t * 0.01);
    const n = B.noise3(q, 1, 5, 0.55, 2, 0.4);
    const cover = U.cloudCover.$;
    const c = std.smoothstep(1 - cover, 1.2 - cover, n) * std.smoothstep(0.0, 0.18, z);
    const lit = std.saturate(0.55 + std.dot(dir, U.sunDir.$) * 0.45);
    const cloud = std.mix(std.mul(U.cloudTint.$, 0.62), std.add(U.cloudTint.$, std.mul(U.sunColor.$, 0.25)), lit);
    col = std.mix(col, cloud, c * 0.9);
    // the horizon melts into the fog colour
    col = std.mix(col, U.fogColor.$, std.pow(1 - std.abs(z), 10) * 0.8);
    return d.vec4f(col, 1);
  });
}

/**
 * Water: jade in the shallows, deep below, rippling, mirroring the world above
 * (the film's planar reflector), with the sun glinting off it.
 */
export function water(reflection: [Accessor<d.Vec3f>, Accessor<d.Vec3f>] | null) {
  const refl = reflection?.[0];
  // what the surface mirrors: the reflected world, or just the sky when reflections are off
  const mirrored = refl
    ? () => {
        "use gpu";
        return d.vec3f(refl.$);
      }
    : () => {
        "use gpu";
        return std.mul(U.skyHorizon.$, 0.9);
      };
  const m = new THREE.MeshBasicNodeMaterial();
  m.colorNode = t3.toTSL(() => {
    "use gpu";
    const pw = t3.positionWorld.$;
    const t = t3.time.$;
    const cam = t3.cameraPosition.$;
    const v = std.normalize(std.sub(cam, pw));
    // two crossing swells and a fine chop, as a normal
    const a = pw.x * 1.1 + pw.y * 0.35 + t * 1.3;
    const b = pw.y * 1.7 - pw.x * 0.5 - t * 0.9;
    const chop = B.noise3(d.vec3f(pw.x * 0.9, pw.y * 0.9, t * 0.35), 1, 2, 0.5, 2, 0) - 0.5;
    const n = std.normalize(d.vec3f(std.cos(a) * 0.05 + chop * 0.12, std.cos(b) * 0.06 + chop * 0.1, 1));
    const fres = 0.08 + 0.92 * std.pow(1 - std.saturate(std.dot(n, v)), 4);
    const depth = B.noise3(d.vec3f(pw.x * 0.04, pw.y * 0.04, 0), 1, 3, 0.5, 2, 0);
    let col = std.mix(U.waterDeep.$, U.waterShallow.$, std.saturate(depth * 1.2 - 0.1));
    col = std.mix(col, mirrored(), fres * 0.8);
    // sun glint
    const r = std.reflect(std.neg(v), n);
    const glint = std.pow(std.saturate(std.dot(r, U.sunDir.$)), 160) * 4;
    col = std.add(col, std.mul(U.sunColor.$, glint));
    return d.vec4f(fog(col, pw), 1);
  }) as THREE.NodeMaterial["colorNode"];
  m.fog = false;
  return m;
}

/** A sea of clouds far below the ridge: slow billows lit from the sun's side. */
export function cloudSea() {
  const m = new THREE.MeshBasicNodeMaterial();
  m.colorNode = t3.toTSL(() => {
    "use gpu";
    const pw = t3.positionWorld.$;
    const t = t3.time.$;
    const q = d.vec3f(pw.x * 0.035 + t * 0.01, pw.y * 0.035, t * 0.015);
    const n = B.noise3(q, 1, 5, 0.6, 2, 0.6);
    const lit = std.smoothstep(0.35, 0.75, n);
    const col = std.mix(U.cloudSeaShade.$, U.cloudSeaLit.$, lit);
    return d.vec4f(fog(col, pw), 1);
  }) as THREE.NodeMaterial["colorNode"];
  m.fog = false;
  return m;
}

// ---------------------------------------------------------------- the stages' palette

const WARM_RIM: RGB = [1, 0.93, 0.8];

export const PAL = {
  // the crimson plain (the film's own night): no fog, red rims
  lacquer: { base: [0.5, 0.012, 0.02], shade: [0.12, 0, 0.005], rim: [1, 0.15, 0.08], rimK: 0.5 },
  ink: { base: [0.03, 0.032, 0.038], shade: [0.006, 0.006, 0.009], rim: [1, 0.12, 0.08], rimK: 1.2 },
  stone: { base: [0.11, 0.1, 0.105], shade: [0.022, 0.02, 0.024], rim: [1, 0.3, 0.24], rimK: 0.55, mottle: 0.4 },
  moss: { base: [0.2, 0.42, 0.04], shade: [0.03, 0.08, 0.01], rim: [1, 1, 0.8], rimK: 0.35 },
  // daylight Vietnam
  limestone: { base: [0.36, 0.35, 0.32], shade: [0.1, 0.1, 0.11], rim: WARM_RIM, rimK: 0.25, mottle: 0.5 },
  jungle: { base: [0.07, 0.2, 0.05], shade: [0.012, 0.045, 0.02], rim: [0.7, 1, 0.5], rimK: 0.25, mottle: 0.6 },
  grass: { base: [0.14, 0.32, 0.06], shade: [0.03, 0.08, 0.02], rim: WARM_RIM, rimK: 0.15, mottle: 0.45, blob: true },
  paving: { base: [0.3, 0.28, 0.25], shade: [0.08, 0.075, 0.07], rim: WARM_RIM, rimK: 0.1, mottle: 0.35, blob: true },
  deck: { base: [0.32, 0.17, 0.07], shade: [0.07, 0.035, 0.015], rim: WARM_RIM, rimK: 0.12, mottle: 0.3, blob: true },
  wood: { base: [0.22, 0.1, 0.04], shade: [0.05, 0.02, 0.01], rim: WARM_RIM, rimK: 0.2 },
  darkwood: { base: [0.07, 0.035, 0.02], shade: [0.015, 0.008, 0.005], rim: WARM_RIM, rimK: 0.2 },
  tile: { base: [0.38, 0.08, 0.035], shade: [0.09, 0.015, 0.008], rim: WARM_RIM, rimK: 0.25 },
  plaster: { base: [0.6, 0.56, 0.46], shade: [0.17, 0.15, 0.13], rim: WARM_RIM, rimK: 0.2 },
  gold: { base: [0.85, 0.52, 0.1], shade: [0.25, 0.1, 0.02], rim: [1, 0.95, 0.6], rimK: 0.6 },
  hat: { base: [0.72, 0.62, 0.38], shade: [0.2, 0.16, 0.08], rim: WARM_RIM, rimK: 0.3 },
  cloth: { base: [0.08, 0.1, 0.16], shade: [0.015, 0.02, 0.04], rim: WARM_RIM, rimK: 0.2 },
  sail: { base: [0.85, 0.28, 0.06], shade: [0.3, 0.06, 0.02], rim: [1, 0.8, 0.5], rimK: 0.3 },
  roofBlue: { base: [0.06, 0.2, 0.3], shade: [0.01, 0.04, 0.07], rim: WARM_RIM, rimK: 0.2 },
  bamboo: { base: [0.3, 0.42, 0.1], shade: [0.07, 0.11, 0.02], rim: [0.9, 1, 0.6], rimK: 0.25 },
  leaf: { base: [0.1, 0.3, 0.06], shade: [0.02, 0.07, 0.02], rim: [0.8, 1, 0.5], rimK: 0.3, mottle: 0.4 },
  pine: { base: [0.03, 0.14, 0.08], shade: [0.005, 0.03, 0.02], rim: [0.7, 0.9, 1], rimK: 0.25, mottle: 0.3 },
  lotusPad: { base: [0.08, 0.3, 0.07], shade: [0.02, 0.08, 0.02], rim: WARM_RIM, rimK: 0.2 },
  lotus: { base: [0.95, 0.4, 0.55], shade: [0.45, 0.1, 0.2], rim: [1, 0.9, 0.95], rimK: 0.4 },
  range1: { base: [0.18, 0.3, 0.32], shade: [0.07, 0.12, 0.16], rim: WARM_RIM, rimK: 0.15, mottle: 0.3 },
  range2: { base: [0.25, 0.35, 0.45], shade: [0.12, 0.17, 0.26], rim: WARM_RIM, rimK: 0.1 },
} satisfies Record<string, Palette>;

export type MatName = keyof typeof PAL | "red" | "lime" | "amber" | "outline" | "water" | "cloudSea";

const LIME: RGB = [0.66, 0.92, 0.07];
const RED: RGB = [1, 0.05, 0.04];
const AMBER: RGB = [1, 0.42, 0.08];

/** One material per name, built on first use and shared by every stage. */
export class Materials {
  private readonly cache = new Map<MatName, THREE.Material>();

  constructor(private readonly reflection: [Accessor<d.Vec3f>, Accessor<d.Vec3f>] | null) {}

  get(name: MatName): THREE.Material {
    let m = this.cache.get(name);
    if (m) return m;
    if (name === "red") m = glow(RED, 7);
    else if (name === "lime") m = glow(LIME, 7);
    else if (name === "amber") m = glow(AMBER, 5);
    else if (name === "outline") m = hull(0.025);
    else if (name === "water") m = water(this.reflection);
    else if (name === "cloudSea") m = cloudSea();
    else {
      const p = PAL[name] as Palette;
      // the crimson plain is the film's own night: its props keep clear of the day's fog
      const night = name === "lacquer" || name === "ink" || name === "stone" || name === "moss";
      m = toon({ ...p, fogged: !night });
    }
    // thin pieces (sails, lotus pads, far ranges) are seen from both sides
    if (name !== "outline") m.side = THREE.DoubleSide;
    this.cache.set(name, m);
    return m;
  }

  all() {
    return [...this.cache.values()];
  }
}
