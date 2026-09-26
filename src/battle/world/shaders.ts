/**
 * The valley's shaders, painted in the film's toon language under the shared
 * light rig and the stage's air (ENV):
 *
 *  terrain  lush grass in two greens, worn dirt paths, dark wet banks, stone on
 *           the steeps, and flooded paddies that mirror the sky
 *  karst    pale limestone streaked by rain, hung with jungle
 *  foliage  soft cel-shaded crowns that glow when backlit, swaying in the wind
 *  blades   grass, reeds and rice: dark roots to sunlit tips, bending in gusts
 *  prop     built pieces, banded from their vertex colour
 *  lamp     lantern silk, flames and incense: well past the bloom threshold,
 *           breathing like a flame, so they glow through the morning haze
 *  hero     the Meshy pieces (pagoda, gate, houses, boats, guardians): their
 *           painted texture under the same light, in softer bands
 *
 * Instanced plants read rows of (x, y, z, yaw, scale) and are placed, turned
 * and blown in the vertex stage; everything fades into the height fog.
 */
import * as t3 from "@typegpu/three";
import * as TSL from "three/tsl";
import * as THREE from "three/webgpu";
import { d, std } from "typegpu";

import { ENV_U, fog } from "../game/shading";
import * as B from "../runtime/blender";
import { diffuse } from "../runtime/lighting";

const U = ENV_U;

/** Gusts rolling across the valley. */
export const WIND = { strength: t3.uniform(1, d.f32) };
/** Where SORA is (her chest): what stands between her and the lens dissolves. */
export const FOCUS = t3.uniform(new THREE.Vector3(0, 0, -1000), d.vec3f);
/** How hard the lanterns burn (they come up as the day goes down). */
export const LAMP = { strength: t3.uniform(1, d.f32) };

/** 0 / 0.55 / 1 toon bands on the lit irradiance (mascot.toon). */
const bands = (e: d.v3f) => {
  "use gpu";
  const lum = e.x * 0.2126 + e.y * 0.7152 + e.z * 0.0722;
  return std.select(std.select(d.f32(1), d.f32(0.6), lum < 0.24), d.f32(0.12), lum < 0.07);
};

const facing = (n: d.v3f, v: d.v3f) => {
  "use gpu";
  return 1 - std.abs(std.dot(n, v));
};

function material(color: () => d.v4f, opts: { side?: THREE.Side; position?: () => d.v3f } = {}) {
  const m = new THREE.MeshBasicNodeMaterial();
  m.colorNode = t3.toTSL(color) as THREE.NodeMaterial["colorNode"];
  if (opts.position) m.positionNode = t3.toTSL(opts.position) as THREE.NodeMaterial["positionNode"];
  m.side = opts.side ?? THREE.FrontSide;
  m.fog = false;
  return m;
}

// ---------------------------------------------------------------- the valley floor
const GRASS_A = d.vec3f(0.11, 0.27, 0.05);
const GRASS_B = d.vec3f(0.19, 0.34, 0.07);
/** sun-dried patches in the lawn */
const GRASS_DRY = d.vec3f(0.3, 0.34, 0.12);
const GRASS_SHADE = d.vec3f(0.025, 0.07, 0.035);
const DIRT = d.vec3f(0.32, 0.22, 0.12);
const DIRT_SHADE = d.vec3f(0.09, 0.055, 0.035);
const MUD = d.vec3f(0.12, 0.1, 0.05);
const ROCK = d.vec3f(0.3, 0.29, 0.27);
const ROCK_SHADE = d.vec3f(0.08, 0.08, 0.09);
const PADDY = d.vec3f(0.12, 0.2, 0.12);

export function terrainMaterial() {
  const wet = t3.attribute("wet", d.f32);
  const path = t3.attribute("path", d.f32);
  const rock = t3.attribute("rock", d.f32);
  const field = t3.attribute("field", d.f32);
  const tone = t3.attribute("tone", d.f32);
  return material(() => {
    "use gpu";
    const pw = t3.positionWorld.$;
    const n = std.normalize(t3.normalWorld.$);
    const v = std.normalize(std.sub(t3.cameraPosition.$, pw));
    const e = diffuse(pw, n, true);
    const k = bands(e);
    // grass: two greens drifting over the fields, a finer mottle
    const macro = B.noise3(d.vec3f(pw.x * 0.018, pw.y * 0.018, 0), d.f32(1), d.f32(3), 0.5, d.f32(2), d.f32(0));
    const fine = B.noise3(d.vec3f(pw.x * 0.35, pw.y * 0.35, 0), d.f32(1), d.f32(2), 0.5, d.f32(2), d.f32(0));
    let lit = std.mix(GRASS_A, GRASS_B, std.saturate(macro * 1.4 - 0.2 + (tone.$ - 0.5) * 0.6));
    // a lawn up close: drier patches, clumps, a wind-combed grain and a fine speckle, fading with distance
    const near = 1 - std.smoothstep(18, 45, std.length(std.sub(t3.cameraPosition.$, pw)));
    const dry = std.smoothstep(0.58, 0.72, B.noise3(d.vec3f(pw.x * 0.11, pw.y * 0.11, 3), d.f32(1), d.f32(3), 0.5, d.f32(2), d.f32(0)));
    lit = std.mix(lit, GRASS_DRY, dry * 0.45);
    const clump = B.noise3(d.vec3f(pw.x * 1.3, pw.y * 1.3, 7), d.f32(1), d.f32(2), 0.5, d.f32(2), d.f32(0));
    const grain = B.noise3(d.vec3f(pw.x * 2.6 + pw.y * 0.9, pw.y * 7.5, 11), d.f32(1), d.f32(1), 0.5, d.f32(2), d.f32(0));
    const speck = B.whiteNoise(std.floor(d.vec3f(pw.x * 16, pw.y * 16, 0)));
    lit = std.mul(lit, 0.88 + 0.24 * fine + near * ((clump - 0.5) * 0.28 + (grain - 0.5) * 0.18 + (speck - 0.5) * 0.12));
    let shade = d.vec3f(GRASS_SHADE);
    // dirt paths, stony at their centre
    const p = std.smoothstep(0.2, 0.75, path.$ + (fine - 0.5) * 0.3);
    lit = std.mix(lit, std.mul(DIRT, 0.85 + 0.35 * fine), p);
    shade = std.mix(shade, DIRT_SHADE, p);
    // steep ground: bare stone
    const r = std.smoothstep(0.3, 0.8, rock.$ + (fine - 0.5) * 0.3);
    lit = std.mix(lit, ROCK, r);
    shade = std.mix(shade, ROCK_SHADE, r);
    // wet banks: darker, richer
    const w = std.saturate(wet.$ * (1 - field.$));
    lit = std.mix(lit, std.mul(MUD, 1.2), w * 0.7);
    shade = std.mix(shade, std.mul(MUD, 0.4), w * 0.7);
    let col = std.add(std.mix(shade, lit, k), std.mul(std.mul(e, lit), 0.08));
    // flooded paddies: a still mirror of the sky, tinted by the young rice
    const f = std.smoothstep(0.5, 0.9, field.$);
    if (f > 0) {
      const fres = std.pow(1 - std.saturate(v.z), 3);
      const sky = std.mix(U.skyTop.$, U.skyHorizon.$, fres);
      const ripple = B.noise3(d.vec3f(pw.x * 1.4, pw.y * 1.4, t3.time.$ * 0.25), d.f32(1), d.f32(2), 0.5, d.f32(2), d.f32(0));
      const mirror = std.mix(std.mul(PADDY, 0.9 + 0.4 * e.x), std.mul(sky, 0.85 + 0.15 * ripple), 0.35 + fres * 0.55);
      const glint = std.pow(std.saturate(std.dot(std.reflect(std.neg(v), d.vec3f(0, 0, 1)), U.sunDir.$)), 90) * 2.5;
      col = std.mix(col, std.add(mirror, std.mul(U.sunColor.$, glint)), f);
    }
    return d.vec4f(fog(col, pw), 1);
  });
}

// ---------------------------------------------------------------- karst
const LIME_LIT = d.vec3f(0.44, 0.41, 0.36);
const LIME_SHADE = d.vec3f(0.11, 0.11, 0.12);
const JUNGLE_LIT = d.vec3f(0.08, 0.24, 0.06);
const JUNGLE_SHADE = d.vec3f(0.015, 0.05, 0.03);

export function karstMaterial() {
  const veg = t3.attribute("veg", d.f32);
  const streak = t3.attribute("streak", d.f32);
  return material(() => {
    "use gpu";
    const pw = t3.positionWorld.$;
    const n = std.normalize(t3.normalWorld.$);
    const v = std.normalize(std.sub(t3.cameraPosition.$, pw));
    const e = diffuse(pw, n, false);
    const k = bands(e);
    // rain streaks run down the bare faces; lichen blotches
    const s = std.smoothstep(0.45, 0.8, streak.$);
    const blotch = B.noise3(std.mul(pw, 0.12), d.f32(1), d.f32(3), 0.55, d.f32(2), d.f32(0));
    const rockLit = std.mul(LIME_LIT, (1 - s * 0.45) * (0.8 + 0.35 * blotch));
    const rockShade = std.mul(LIME_SHADE, 1 - s * 0.3);
    // jungle: patchy edges, a darker mottle within
    const leafy = B.noise3(std.mul(pw, 0.35), d.f32(1), d.f32(3), 0.55, d.f32(2), d.f32(0));
    const g = std.smoothstep(0.35, 0.65, veg.$ + (leafy - 0.5) * 0.5);
    const jl = std.mul(JUNGLE_LIT, 0.75 + 0.6 * leafy);
    const lit = std.mix(rockLit, jl, g);
    const shade = std.mix(rockShade, JUNGLE_SHADE, g);
    let col = std.add(std.mix(shade, lit, k), std.mul(std.mul(e, lit), 0.06));
    col = std.add(col, std.mul(U.sunColor.$, std.smoothstep(0.7, 0.95, facing(n, v)) * 0.12 * (1 - g)));
    return d.vec4f(fog(col, pw), 1);
  });
}

// ---------------------------------------------------------------- instanced plants
/** Per-instance placement: rows of (x, y, z, yaw, scale) as two attributes. */
const inst = () => ({ pos: t3.attribute("i_pos", d.vec3f), rs: t3.attribute("i_rs", d.vec2f) });

const rotZ = (v: d.v3f, yaw: number) => {
  "use gpu";
  const c = std.cos(yaw);
  const s = std.sin(yaw);
  return d.vec3f(c * v.x - s * v.y, s * v.x + c * v.y, v.z);
};

/** Where the wind pushes a vertex (world units), given the instance's root and how free the vertex is. */
const gust = (root: d.v3f, sway: number, scale: number, amount: number) => {
  "use gpu";
  const t = t3.time.$;
  const phase = root.x * 0.11 + root.y * 0.07;
  const big = std.sin(t * 1.3 + phase) * 0.6 + std.sin(t * 0.47 + phase * 0.5) * 0.4;
  const flutter = std.sin(t * 5.1 + root.x * 1.7 + root.y * 1.3) * 0.18;
  const push = (big + flutter) * sway * amount * scale * WIND.strength.$;
  return d.vec3f(push * 0.9, push * 0.45, -std.abs(push) * 0.25);
};

const PETAL = d.vec3f(0.95, 0.42, 0.58);
const STONE = d.vec3f(0.34, 0.33, 0.31);

export type PlantLook = "tree" | "bamboo" | "banana" | "shrub" | "grass" | "rice" | "reed" | "lotus" | "rock" | "meadow" | "flower";

const PLANTS: Record<
  PlantLook,
  { lit: [number, number, number]; lit2: [number, number, number]; shade: [number, number, number]; wind: number; tip?: [number, number, number]; bark?: [number, number, number] }
> = {
  tree: { lit: [0.12, 0.34, 0.06], lit2: [0.22, 0.42, 0.06], shade: [0.02, 0.07, 0.035], wind: 0.25 },
  shrub: { lit: [0.1, 0.3, 0.05], lit2: [0.18, 0.36, 0.05], shade: [0.02, 0.06, 0.03], wind: 0.12 },
  bamboo: { lit: [0.22, 0.42, 0.08], lit2: [0.3, 0.48, 0.1], shade: [0.04, 0.09, 0.03], wind: 0.6, bark: [0.36, 0.44, 0.12] },
  banana: { lit: [0.22, 0.48, 0.08], lit2: [0.3, 0.52, 0.1], shade: [0.04, 0.1, 0.03], wind: 0.35 },
  grass: { lit: [0.1, 0.26, 0.04], lit2: [0.2, 0.4, 0.06], shade: [0.03, 0.08, 0.03], wind: 0.35, tip: [0.45, 0.55, 0.16] },
  rice: { lit: [0.18, 0.38, 0.06], lit2: [0.28, 0.46, 0.08], shade: [0.04, 0.1, 0.03], wind: 0.3, tip: [0.62, 0.66, 0.2] },
  reed: { lit: [0.2, 0.3, 0.08], lit2: [0.3, 0.36, 0.1], shade: [0.05, 0.08, 0.03], wind: 0.5, tip: [0.55, 0.5, 0.3] },
  lotus: { lit: [0.1, 0.32, 0.08], lit2: [0.14, 0.36, 0.08], shade: [0.03, 0.09, 0.03], wind: 0.05 },
  rock: { lit: [0.34, 0.33, 0.31], lit2: [0.28, 0.3, 0.22], shade: [0.08, 0.08, 0.09], wind: 0 },
  // the meadow round the player: deep roots, sunlit yellow-green tips
  // the lawn's fuzz: the ground's own greens, tips a touch lighter
  meadow: { lit: [0.11, 0.28, 0.05], lit2: [0.19, 0.35, 0.07], shade: [0.03, 0.075, 0.035], wind: 0.22, tip: [0.32, 0.46, 0.13] },
  flower: { lit: [0.12, 0.34, 0.05], lit2: [0.18, 0.4, 0.05], shade: [0.03, 0.09, 0.03], wind: 0.45 },
};
/** wild flowers: white daisies, violets, buttercups, a few pinks */
const FLOWERS = [d.vec3f(0.95, 0.95, 0.9), d.vec3f(0.58, 0.42, 0.95), d.vec3f(1.0, 0.82, 0.25), d.vec3f(0.98, 0.52, 0.7)];
/** the odd tree in bloom: peach blossom pink, crape-myrtle violet (hoa đào, bằng lăng) */
const BLOSSOM = d.vec3f(0.98, 0.55, 0.72);
const BLOSSOM2 = d.vec3f(0.7, 0.5, 0.95);

/** One material per plant look: placed per instance, blown, toon-lit, backlit leaves glow. */
export function plantMaterial(look: PlantLook) {
  const p = PLANTS[look];
  const lit1 = d.vec3f(...p.lit);
  const lit2 = d.vec3f(...p.lit2);
  const shadeC = d.vec3f(...p.shade);
  const tipC = d.vec3f(...(p.tip ?? p.lit2));
  const barkC = d.vec3f(...(p.bark ?? [0.16, 0.09, 0.05]));
  const barkShade = std.mul(barkC, 0.25);
  const hasTip = !!p.tip;
  const windAmt = p.wind;
  const isRock = look === "rock";
  const isFlower = look === "flower";
  const isTree = look === "tree";
  const { pos, rs } = inst();
  const leaf = t3.attribute("leaf", d.f32);
  const ao = t3.attribute("ao", d.f32);
  const sway = t3.attribute("sway", d.f32);

  const placePlant = () => {
    "use gpu";
    const root = pos.$;
    const yaw = rs.$.x;
    const s = rs.$.y;
    const local = rotZ(std.mul(t3.positionGeometry.$, s), yaw);
    return std.add(std.add(root, local), gust(root, sway.$, s, d.f32(windAmt)));
  };
  const shadePlant = () => {
    "use gpu";
    const root = pos.$;
    const n = std.normalize(rotZ(t3.normalGeometry.$, rs.$.x));
    const pw = t3.positionWorld.$;
    // right in front of the camera, leaves dissolve (an ordered dither) instead of filling the screen
    const near = std.length(std.sub(t3.cameraPosition.$, pw));
    const sc = t3.screenCoordinate.$;
    const dither = std.fract(52.9829189 * std.fract(0.06711056 * sc.x + 0.00583715 * sc.y));
    if (std.smoothstep(1.8, 4.2, near) < dither) {
      std.discard();
    }
    const v = std.normalize(std.sub(t3.cameraPosition.$, pw));
    const e = diffuse(pw, n, false);
    const k = bands(e);
    // each instance its own green; the wood, the flowers, the stone
    const hue = B.whiteNoise(std.floor(root));
    let lit = std.mix(lit1, lit2, hue);
    let shade = d.vec3f(shadeC);
    if (isRock) {
      // moss on top
      const moss = std.smoothstep(0.4, 0.8, n.z + (hue - 0.5) * 0.4);
      lit = std.mix(STONE, d.vec3f(0.16, 0.28, 0.08), moss);
      shade = d.vec3f(0.07, 0.075, 0.08);
    } else {
      const wood = std.smoothstep(0.5, 0.0, leaf.$);
      lit = std.mix(lit, barkC, wood);
      shade = std.mix(shade, barkShade, wood);
      if (isTree) {
        // one tree in eight is in flower
        const pick = B.whiteNoise(std.add(std.floor(root), d.vec3f(3.1, 1.7, 0)));
        const tint = std.select(BLOSSOM, BLOSSOM2, pick > 0.94);
        const bloom = std.step(0.875, pick) * (1 - wood);
        lit = std.mix(lit, tint, bloom);
        shade = std.mix(shade, std.mul(tint, 0.32), bloom);
      }
      let petal = d.vec3f(PETAL);
      if (isFlower) {
        const pick = B.whiteNoise(std.add(std.floor(std.mul(root, 3)), d.vec3f(5.3, 2.9, 0)));
        petal = std.select(std.select(std.select(FLOWERS[0], FLOWERS[1], pick > 0.45), FLOWERS[2], pick > 0.72), FLOWERS[3], pick > 0.9);
      }
      const flower = std.smoothstep(1.5, 1.9, leaf.$);
      lit = std.mix(lit, petal, flower);
      shade = std.mix(shade, std.mul(petal, 0.4), flower);
      if (hasTip) {
        lit = std.mix(lit, tipC, std.smoothstep(0.45, 1.0, sway.$));
      }
    }
    // inside the crown it is dark; the skin catches the light
    const occl = 0.45 + 0.55 * ao.$;
    let col = std.mul(std.add(std.mix(shade, lit, k), std.mul(std.mul(e, lit), 0.06)), occl);
    // backlight: leaves glow when the sun is behind them
    const back = std.pow(std.saturate(std.dot(std.neg(v), U.sunDir.$)), 3) * std.saturate(leaf.$) * 0.45;
    col = std.add(col, std.mul(std.mul(U.sunColor.$, lit), back * 2));
    // a soft sky rim
    col = std.add(col, std.mul(U.skyHorizon.$, std.smoothstep(0.65, 0.95, facing(n, v)) * 0.12 * occl));
    return d.vec4f(fog(col, pw), 1);
  };
  return material(shadePlant, { position: placePlant, side: THREE.DoubleSide });
}

// ---------------------------------------------------------------- built pieces
export function propMaterial() {
  const col = t3.attribute("col", d.vec3f);
  return material(() => {
    "use gpu";
    const pw = t3.positionWorld.$;
    const n = std.normalize(t3.normalWorld.$);
    const v = std.normalize(std.sub(t3.cameraPosition.$, pw));
    const e = diffuse(pw, n, true);
    const k = bands(e);
    const base = col.$;
    const grime = B.noise3(std.mul(pw, 0.8), d.f32(1), d.f32(3), 0.5, d.f32(2), d.f32(0));
    const lit = std.mul(base, 0.85 + 0.3 * grime);
    const shade = std.mul(base, 0.28);
    let c = std.add(std.mix(shade, lit, k), std.mul(std.mul(e, lit), 0.06));
    c = std.add(c, std.mul(U.skyHorizon.$, std.smoothstep(0.7, 0.95, facing(n, v)) * 0.1));
    return d.vec4f(fog(c, pw), 1);
  });
}

// ---------------------------------------------------------------- the hero pieces
/**
 * A painted model: its texture is the colour; the light still bands it like
 * everything else in the valley, only softer, so the painting keeps its detail.
 */
export function heroMaterial(tex: THREE.Texture) {
  const albedo = t3.fromTSL(TSL.texture(tex, TSL.uv()), d.vec4f);
  return material(() => {
    "use gpu";
    const pw = t3.positionWorld.$;
    const n = std.normalize(t3.normalWorld.$);
    const v = std.normalize(std.sub(t3.cameraPosition.$, pw));
    const e = diffuse(pw, n, true);
    const lum = e.x * 0.2126 + e.y * 0.7152 + e.z * 0.0722;
    // two soft bands instead of three hard ones
    const k = std.smoothstep(0.05, 0.2, lum) * 0.55 + std.smoothstep(0.2, 0.32, lum) * 0.45;
    // only what stands between the lens and SORA dissolves (an ordered dither), so she is never hidden;
    // everything else, however near, stays whole
    const cam = t3.cameraPosition.$;
    const seg = std.sub(FOCUS.$, cam);
    const len2 = std.max(std.dot(seg, seg), 1e-4);
    const along = std.dot(std.sub(pw, cam), seg) / len2;
    const closest = std.add(cam, std.mul(seg, std.clamp(along, 0, 1)));
    const off = std.length(std.sub(pw, closest));
    const blocking = std.smoothstep(0.05, 0.2, along) * (1 - std.smoothstep(0.85, 0.95, along)) * (1 - std.smoothstep(1.1, 1.9, off));
    const sc = t3.screenCoordinate.$;
    const dither = std.fract(52.9829189 * std.fract(0.06711056 * sc.x + 0.00583715 * sc.y));
    if (blocking * 0.85 > dither) {
      std.discard();
    }
    const base = albedo.$.xyz;
    const lit = std.mul(base, 1.08);
    const shade = std.mul(std.mul(base, U.skyHorizon.$), 0.5);
    let c = std.add(std.mix(shade, lit, k), std.mul(std.mul(e, base), 0.08));
    c = std.add(c, std.mul(U.skyHorizon.$, std.smoothstep(0.7, 0.95, facing(n, v)) * 0.08));
    return d.vec4f(fog(c, pw), 1);
  });
}

// ---------------------------------------------------------------- lamps
/** Anything that burns: its vertex colour pushed far into HDR (the bloom's threshold is 1.3), flickering. */
export function lampMaterial() {
  const col = t3.attribute("col", d.vec3f);
  return material(() => {
    "use gpu";
    const pw = t3.positionWorld.$;
    const f = B.noise3(d.vec3f(pw.x * 0.9, pw.y * 0.9, t3.time.$ * 2.4), d.f32(1), d.f32(2), 0.5, d.f32(2), d.f32(0));
    // bright enough to bloom (threshold 1.3), not so bright the tone curve bleaches the silk white
    const k = (1.25 + 0.6 * f) * LAMP.strength.$;
    return d.vec4f(fog(std.mul(col.$, k), pw), 1);
  });
}

// ---------------------------------------------------------------- morning mist
/**
 * A sheet of morning mist at one height: drifting fbm, torn open in places,
 * thin where the camera stands and thickening with distance, so the karsts
 * stand in layers the way they do over Tràng An at dawn.
 */
export function mistMaterial(height: number, density: number) {
  const m = material(() => {
    "use gpu";
    const pw = t3.positionWorld.$;
    const t = t3.time.$;
    const drift = d.vec3f(pw.x * 0.012 + t * 0.006, pw.y * 0.012 - t * 0.004, height * 0.1);
    const n = B.noise3(drift, d.f32(1), d.f32(4), 0.55, d.f32(2), 0.3);
    const torn = std.smoothstep(0.42, 0.72, n);
    const dist = std.length(std.sub(t3.cameraPosition.$, pw));
    const far = std.smoothstep(14, 70, dist) * (1 - std.smoothstep(220, 320, dist));
    const a = torn * far * density;
    const c = std.mix(U.skyHorizon.$, d.vec3f(1, 1, 1), 0.35);
    return d.vec4f(c, a);
  });
  m.transparent = true;
  m.depthWrite = false;
  m.side = THREE.DoubleSide;
  return m;
}

// ---------------------------------------------------------------- lamp halos
/**
 * The soft light round a lantern: a camera-facing disc, bright at the heart
 * and falling off smoothly to nothing at its edge (never a hard rim), added
 * over the scene. It grows with the evening (LAMP) and fades with distance.
 */
export function haloMaterial(color: [number, number, number], brightness: number) {
  const m = new THREE.SpriteNodeMaterial();
  const r = TSL.uv().sub(0.5).length().mul(2);
  const core = TSL.float(1).sub(r).clamp(0, 1);
  // a tight hot centre on a wide soft skirt
  const fall = core.pow(3).mul(0.7).add(core.pow(8).mul(0.9));
  const dist = TSL.cameraPosition.sub(TSL.positionWorld).length();
  const fade = TSL.float(1).sub(TSL.smoothstep(45, 170, dist));
  const evening = LAMP.strength.node.sub(0.65).max(0.2);
  m.colorNode = TSL.vec4(TSL.vec3(...color).mul(evening.mul(brightness)), fall.mul(fade));
  m.transparent = true;
  m.depthWrite = false;
  m.blending = THREE.AdditiveBlending;
  m.fog = false;
  return m;
}
