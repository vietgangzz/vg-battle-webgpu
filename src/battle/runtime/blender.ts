/**
 * Blender shader-node semantics as TypeGPU functions ("use gpu" -> WGSL).
 *
 * The generated materials (gen/materials.ts) call these so edge cases match
 * Blender: safe divide/power/sqrt, floored modulo, clamped smoothstep
 * map-range, and the Noise Texture's fBm Perlin noise (Perlin gradients,
 * Blender's scaling and fBm normalisation; PCG cell hashes) with real loops,
 * so each noise is one small WGSL function instead of an unrolled graph.
 *
 * Literal note: TypeGPU types `1.0` as an integer, so float constants that
 * happen to be whole numbers are written as d.f32(...).
 */
import { d, std, tgpu } from "typegpu";

/**
 * Upper bounds on fBm detail (Blender's own detail is used when lower): for
 * surfaces, and for noise inside ray-marched volumes (sampled per step).
 * Read when shaders resolve, so set them before materials are built.
 */
export const quality = { maxOctaves: 8, volumeOctaves: 2 };

// ------------------------------------------------------------------ shared data
export const VolSample = d.struct({
  density: d.f32,
  albedo: d.vec3f,
  emission: d.vec3f,
  aniso: d.f32,
});

export const GnOut = d.struct({
  pos: d.vec3f,
  dir: d.vec3f,
  scale: d.vec3f,
  dead: d.f32,
  age: d.f32,
  pseed: d.f32,
});

// ------------------------------------------------------------------ conversions
export const luma = (c: d.v3f) => {
  "use gpu";
  return std.dot(c, d.vec3f(0.2126, 0.7152, 0.0722));
};

export const avg3 = (v: d.v3f) => {
  "use gpu";
  return (v.x + v.y + v.z) / 3;
};

// ------------------------------------------------------------------ math node
export const div = (a: number, b: number) => {
  "use gpu";
  return std.select(a / b, d.f32(0), b === 0);
};

export const pow = (a: number, b: number) => {
  "use gpu";
  const mag = std.pow(std.abs(a), b);
  if (a >= 0) {
    return mag;
  }
  // negative base: defined only for whole exponents, sign from their parity
  if (std.fract(b) !== 0) {
    return d.f32(0);
  }
  return std.select(mag, -mag, std.abs(b) % 2 === 1);
};

export const sqrt = (a: number) => {
  "use gpu";
  return std.select(d.f32(0), std.sqrt(std.max(a, 0)), a > 0);
};

export const inverseSqrt = (a: number) => {
  "use gpu";
  return std.select(d.f32(0), std.inverseSqrt(std.max(a, 1e-30)), a > 0);
};

export const log = (a: number, b: number) => {
  "use gpu";
  if (a > 0 && b > 0) {
    return std.log(a) / std.log(b);
  }
  return d.f32(0);
};

export const lt = (a: number, b: number) => {
  "use gpu";
  return std.select(d.f32(0), d.f32(1), a < b);
};

export const gt = (a: number, b: number) => {
  "use gpu";
  return std.select(d.f32(0), d.f32(1), a > b);
};

export const fract = (a: number) => {
  "use gpu";
  return a - std.floor(a);
};

export const round = (a: number) => {
  "use gpu";
  return std.floor(a + 0.5);
};

/** Math MODULO: truncated, like C fmodf */
export const fmod = (a: number, b: number) => {
  "use gpu";
  return std.select(a - std.trunc(a / b) * b, d.f32(0), b === 0);
};

export const floorMod = (a: number, b: number) => {
  "use gpu";
  return std.select(a - std.floor(a / b) * b, d.f32(0), b === 0);
};

export const snap = (a: number, b: number) => {
  "use gpu";
  return std.select(std.floor(a / b) * b, d.f32(0), b === 0);
};

export const pingpong = (a: number, b: number) => {
  "use gpu";
  if (b === 0) {
    return d.f32(0);
  }
  return std.abs(fract((a - b) / (b * 2)) * b * 2 - b);
};

export const atan2 = (y: number, x: number) => {
  "use gpu";
  return std.atan2(y, x);
};

export const asin = (a: number) => {
  "use gpu";
  return std.asin(std.clamp(a, -1, 1));
};

export const acos = (a: number) => {
  "use gpu";
  return std.acos(std.clamp(a, -1, 1));
};

export const madd = (a: number, b: number, c: number) => {
  "use gpu";
  return a * b + c;
};

export const compare = (a: number, b: number, eps: number) => {
  "use gpu";
  return std.select(d.f32(0), d.f32(1), std.abs(a - b) <= std.max(eps, 1e-5));
};

export const smoothMin = (a: number, b: number, k: number) => {
  "use gpu";
  if (k <= 0) {
    return std.min(a, b);
  }
  const h = std.max(k - std.abs(a - b), 0) / k;
  return std.min(a, b) - (h * h * h * k) / 6;
};

export const smoothMax = (a: number, b: number, k: number) => {
  "use gpu";
  return -smoothMin(-a, -b, k);
};

/** Blender's wrapf(value, max, min) */
export const wrap = (v: number, hi: number, lo: number) => {
  "use gpu";
  const range = hi - lo;
  if (range === 0) {
    return lo;
  }
  return v - range * std.floor((v - lo) / range);
};

// ------------------------------------------------------------------ vector math node
export const vdiv = (a: d.v3f, b: d.v3f) => {
  "use gpu";
  return d.vec3f(div(a.x, b.x), div(a.y, b.y), div(a.z, b.z));
};

export const vfmod = (a: d.v3f, b: d.v3f) => {
  "use gpu";
  return d.vec3f(fmod(a.x, b.x), fmod(a.y, b.y), fmod(a.z, b.z));
};

export const vpow = (a: d.v3f, b: d.v3f) => {
  "use gpu";
  return d.vec3f(pow(a.x, b.x), pow(a.y, b.y), pow(a.z, b.z));
};

export const vsnap = (a: d.v3f, b: d.v3f) => {
  "use gpu";
  return d.vec3f(snap(a.x, b.x), snap(a.y, b.y), snap(a.z, b.z));
};

export const vfract = (a: d.v3f) => {
  "use gpu";
  return std.sub(a, std.floor(a));
};

export const normalize = (v: d.v3f) => {
  "use gpu";
  const l = std.length(v);
  if (l > 0) {
    return std.div(v, l);
  }
  return d.vec3f();
};

export const project = (a: d.v3f, b: d.v3f) => {
  "use gpu";
  const bb = std.dot(b, b);
  if (bb > 0) {
    return std.mul(b, std.dot(a, b) / bb);
  }
  return d.vec3f();
};

export const reflect = (a: d.v3f, b: d.v3f) => {
  "use gpu";
  const n = normalize(b);
  return std.sub(a, std.mul(n, std.dot(n, a) * 2));
};

// ------------------------------------------------------------------ map range / clamp / mix
const factor = (v: number, a: number, b: number) => {
  "use gpu";
  return std.select((v - a) / (b - a), d.f32(0), a === b);
};

export const mapLinear = (v: number, a: number, b: number, c: number, e: number) => {
  "use gpu";
  return c + factor(v, a, b) * (e - c);
};

export const mapLinearClamped = (v: number, a: number, b: number, c: number, e: number) => {
  "use gpu";
  return std.clamp(c + factor(v, a, b) * (e - c), std.min(c, e), std.max(c, e));
};

export const mapSmooth = (v: number, a: number, b: number, c: number, e: number) => {
  "use gpu";
  const f = std.clamp(factor(v, a, b), 0, 1);
  return c + f * f * (3 - 2 * f) * (e - c);
};

export const mapSmoother = (v: number, a: number, b: number, c: number, e: number) => {
  "use gpu";
  const f = std.clamp(factor(v, a, b), 0, 1);
  return c + f * f * f * (f * (f * 6 - 15) + 10) * (e - c);
};

export const clampMinMax = (v: number, lo: number, hi: number) => {
  "use gpu";
  return std.min(std.max(v, lo), hi);
};

export const clampRange = (v: number, lo: number, hi: number) => {
  "use gpu";
  return std.clamp(v, std.min(lo, hi), std.max(lo, hi));
};

export const screen = (a: d.v3f, b: d.v3f, fac: number) => {
  "use gpu";
  const k = std.add(d.vec3f(1 - fac), std.mul(std.sub(d.vec3f(1), b), fac));
  return std.sub(d.vec3f(1), std.mul(k, std.sub(d.vec3f(1), a)));
};

// ------------------------------------------------------------------ hashing
// PCG3D / PCG4D (Jarzynski & Olano, "Hash Functions for GPU Rendering", JCGT 2020).
// Blender hashes cells with Jenkins' lookup3; pcg gives the same statistics
// (uniform bits, no visible lattice) for a fraction of the ALU, and a noise
// cell's pattern is not something anyone can compare by eye.

/** Three well-mixed u32s from a 3D cell. */
export const pcg3 = tgpu.fn(
  [d.u32, d.u32, d.u32],
  d.vec3u,
)((kx, ky, kz) => {
  "use gpu";
  let x = kx * 1664525 + 1013904223;
  let y = ky * 1664525 + 1013904223;
  let z = kz * 1664525 + 1013904223;
  x += y * z;
  y += z * x;
  z += x * y;
  x ^= x >>> 16;
  y ^= y >>> 16;
  z ^= z >>> 16;
  x += y * z;
  y += z * x;
  z += x * y;
  return d.vec3u(x, y, z);
});

/** Four well-mixed u32s from a 4D cell. */
export const pcg4 = tgpu.fn(
  [d.u32, d.u32, d.u32, d.u32],
  d.vec4u,
)((kx, ky, kz, kw) => {
  "use gpu";
  let x = kx * 1664525 + 1013904223;
  let y = ky * 1664525 + 1013904223;
  let z = kz * 1664525 + 1013904223;
  let w = kw * 1664525 + 1013904223;
  x += y * w;
  y += z * x;
  z += x * y;
  w += y * z;
  x ^= x >>> 16;
  y ^= y >>> 16;
  z ^= z >>> 16;
  w ^= w >>> 16;
  x += y * w;
  y += z * x;
  z += x * y;
  w += y * z;
  return d.vec4u(x, y, z, w);
});

export const hash3 = (kx: number, ky: number, kz: number) => {
  "use gpu";
  return pcg3(kx, ky, kz).x;
};

export const hash4 = (kx: number, ky: number, kz: number, kw: number) => {
  "use gpu";
  return pcg4(kx, ky, kz, kw).x;
};

const toUnit = (h: number) => {
  "use gpu";
  return d.f32(h) / 4294967295.0;
};

/** floor(x) as a bit-preserving uint (negative cells wrap like C's int -> uint cast) */
const cell = (x: number) => {
  "use gpu";
  return d.u32(d.i32(std.floor(x)));
};

// ------------------------------------------------------------------ Perlin noise
const fade = (t: number) => {
  "use gpu";
  return t * t * t * (t * (t * 6 - 15) + 10);
};

const negIf = (v: number, h: number, bit: number) => {
  "use gpu";
  return std.select(v, -v, (h & d.u32(bit)) !== 0);
};

const grad3 = (hash: number, x: number, y: number, z: number) => {
  "use gpu";
  const h = hash & 15;
  const u = std.select(y, x, h < 8);
  const vt = std.select(z, x, h === 12 || h === 14);
  const v = std.select(vt, y, h < 4);
  return negIf(u, h, 1) + negIf(v, h, 2);
};

const grad4 = (hash: number, x: number, y: number, z: number, w: number) => {
  "use gpu";
  const h = hash & 31;
  const u = std.select(y, x, h < 24);
  const v = std.select(z, y, h < 16);
  const s = std.select(w, z, h < 8);
  return negIf(u, h, 1) + negIf(v, h, 2) + negIf(s, h, 4);
};

/** Signed 3D Perlin noise with Blender's scale (about -1..1). */
export const snoise3 = tgpu.fn(
  [d.vec3f],
  d.f32,
)((p) => {
  "use gpu";
  const fl = std.floor(p);
  const f = std.sub(p, fl);
  const X = cell(fl.x);
  const Y = cell(fl.y);
  const Z = cell(fl.z);
  const X1 = X + 1;
  const Y1 = Y + 1;
  const Z1 = Z + 1;
  const gx = f.x - 1;
  const gy = f.y - 1;
  const gz = f.z - 1;
  const u = fade(f.x);
  const v = fade(f.y);
  const w = fade(f.z);
  const a = std.mix(grad3(hash3(X, Y, Z), f.x, f.y, f.z), grad3(hash3(X1, Y, Z), gx, f.y, f.z), u);
  const b = std.mix(grad3(hash3(X, Y1, Z), f.x, gy, f.z), grad3(hash3(X1, Y1, Z), gx, gy, f.z), u);
  const c = std.mix(grad3(hash3(X, Y, Z1), f.x, f.y, gz), grad3(hash3(X1, Y, Z1), gx, f.y, gz), u);
  const e = std.mix(grad3(hash3(X, Y1, Z1), f.x, gy, gz), grad3(hash3(X1, Y1, Z1), gx, gy, gz), u);
  return std.mix(std.mix(a, b, v), std.mix(c, e, v), w) * 0.982;
});

/** One w-slice of the 4D Perlin cell (a trilinear blend of 8 gradient corners). */
const slice4 = (X: number, Y: number, Z: number, W: number, f: d.v4f, g: d.v4f, fw: number, u: number, v: number, t: number) => {
  "use gpu";
  const a = std.mix(grad4(hash4(X, Y, Z, W), f.x, f.y, f.z, fw), grad4(hash4(X + 1, Y, Z, W), g.x, f.y, f.z, fw), u);
  const b = std.mix(grad4(hash4(X, Y + 1, Z, W), f.x, g.y, f.z, fw), grad4(hash4(X + 1, Y + 1, Z, W), g.x, g.y, f.z, fw), u);
  const c = std.mix(grad4(hash4(X, Y, Z + 1, W), f.x, f.y, g.z, fw), grad4(hash4(X + 1, Y, Z + 1, W), g.x, f.y, g.z, fw), u);
  const e = std.mix(
    grad4(hash4(X, Y + 1, Z + 1, W), f.x, g.y, g.z, fw),
    grad4(hash4(X + 1, Y + 1, Z + 1, W), g.x, g.y, g.z, fw),
    u,
  );
  return std.mix(std.mix(a, b, v), std.mix(c, e, v), t);
};

/** Signed 4D Perlin noise with Blender's scale. */
export const snoise4 = tgpu.fn(
  [d.vec4f],
  d.f32,
)((p) => {
  "use gpu";
  const fl = std.floor(p);
  const f = std.sub(p, fl);
  const g = std.sub(f, d.vec4f(1));
  const X = cell(fl.x);
  const Y = cell(fl.y);
  const Z = cell(fl.z);
  const W = cell(fl.w);
  const u = fade(f.x);
  const v = fade(f.y);
  const t = fade(f.z);
  const s0 = slice4(X, Y, Z, W, f, g, f.w, u, v, t);
  const s1 = slice4(X, Y, Z, W + 1, f, g, g.w, u, v, t);
  return std.mix(s0, s1, fade(f.w)) * 0.8344;
});

/** Normalised fBm (Blender Noise Texture with normalize on). */
export const fbm3 = tgpu.fn(
  [d.vec3f, d.f32, d.f32, d.f32],
  d.f32,
)((p, detailIn, rough, lac) => {
  "use gpu";
  const detail = std.clamp(detailIn, 0, quality.maxOctaves);
  const r = std.clamp(rough, 0, 1);
  let fscale = d.f32(1);
  let amp = d.f32(1);
  let maxamp = d.f32(0);
  let sum = d.f32(0);
  const octaves = d.i32(detail);
  for (let i = 0; i <= octaves; i++) {
    sum += snoise3(std.mul(p, fscale)) * amp;
    maxamp += amp;
    amp *= r;
    fscale *= lac;
  }
  const rmd = detail - std.floor(detail);
  const base = (0.5 * sum) / maxamp + 0.5;
  if (rmd > 0) {
    const sum2 = sum + snoise3(std.mul(p, fscale)) * amp;
    return std.mix(base, (0.5 * sum2) / (maxamp + amp) + 0.5, rmd);
  }
  return base;
});

export const fbm4 = tgpu.fn(
  [d.vec4f, d.f32, d.f32, d.f32],
  d.f32,
)((p, detailIn, rough, lac) => {
  "use gpu";
  const detail = std.clamp(detailIn, 0, quality.maxOctaves);
  const r = std.clamp(rough, 0, 1);
  let fscale = d.f32(1);
  let amp = d.f32(1);
  let maxamp = d.f32(0);
  let sum = d.f32(0);
  const octaves = d.i32(detail);
  for (let i = 0; i <= octaves; i++) {
    sum += snoise4(std.mul(p, fscale)) * amp;
    maxamp += amp;
    amp *= r;
    fscale *= lac;
  }
  const rmd = detail - std.floor(detail);
  const base = (0.5 * sum) / maxamp + 0.5;
  if (rmd > 0) {
    const sum2 = sum + snoise4(std.mul(p, fscale)) * amp;
    return std.mix(base, (0.5 * sum2) / (maxamp + amp) + 0.5, rmd);
  }
  return base;
});

const O0 = d.vec4f(141.7, 122.3, 188.9, 107.1);
const O1 = d.vec4f(173.2, 131.9, 156.4, 119.8);
const O2 = d.vec4f(112.6, 197.5, 144.1, 162.7);
const O3 = d.vec4f(185.3, 104.8, 129.6, 151.2);
const O4 = d.vec4f(158.1, 176.4, 113.7, 139.5);

/** Noise Texture node (3D), Fac output. */
export const noise3 = (vec: d.v3f, scale: number, detail: number, rough: number, lac: number, distortion: number) => {
  "use gpu";
  let p = std.mul(vec, scale);
  if (distortion !== 0) {
    const dv = d.vec3f(snoise3(std.add(p, O0.xyz)), snoise3(std.add(p, O1.xyz)), snoise3(std.add(p, O2.xyz)));
    p = std.add(p, std.mul(dv, distortion));
  }
  return fbm3(p, detail, rough, lac);
};

/** Noise Texture node (4D), Fac output. */
export const noise4 = (vec: d.v3f, w: number, scale: number, detail: number, rough: number, lac: number, distortion: number) => {
  "use gpu";
  let p = std.mul(d.vec4f(vec, w), scale);
  if (distortion !== 0) {
    const dv = d.vec4f(snoise4(std.add(p, O0)), snoise4(std.add(p, O1)), snoise4(std.add(p, O2)), snoise4(std.add(p, O3)));
    p = std.add(p, std.mul(dv, distortion));
  }
  return fbm4(p, detail, rough, lac);
};

/** Noise Texture node (3D), Color output. */
export const noise3Color = (vec: d.v3f, scale: number, detail: number, rough: number, lac: number, distortion: number) => {
  "use gpu";
  const p = std.mul(vec, scale);
  return d.vec3f(
    noise3(vec, scale, detail, rough, lac, distortion),
    fbm3(std.add(p, O3.xyz), detail, rough, lac),
    fbm3(std.add(p, O4.xyz), detail, rough, lac),
  );
};

/** Noise Texture node (4D), Color output. */
export const noise4Color = (vec: d.v3f, w: number, scale: number, detail: number, rough: number, lac: number, distortion: number) => {
  "use gpu";
  const p = std.mul(d.vec4f(vec, w), scale);
  return d.vec3f(
    noise4(vec, w, scale, detail, rough, lac, distortion),
    fbm4(std.add(p, O3), detail, rough, lac),
    fbm4(std.add(p, O4), detail, rough, lac),
  );
};

// ------------------------------------------------------------------ voronoi / white noise
const cellJitter = (x: number, y: number, z: number) => {
  "use gpu";
  const h = pcg3(x, y, z);
  return d.vec3f(toUnit(h.x), toUnit(h.y), toUnit(h.z));
};

/** Voronoi Texture node, Distance to Edge (3D), two passes like Blender. */
export const voronoiEdge = tgpu.fn(
  [d.vec3f, d.f32, d.f32],
  d.f32,
)((vec, scale, randomness) => {
  "use gpu";
  const co = std.mul(vec, scale);
  const fl = std.floor(co);
  const local = std.sub(co, fl);
  const cx = cell(fl.x);
  const cy = cell(fl.y);
  const cz = cell(fl.z);
  let closest = d.vec3f();
  let minD = d.f32(8);
  for (let k = -1; k <= 1; k++) {
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const off = d.vec3f(d.f32(i), d.f32(j), d.f32(k));
        const jit = cellJitter(cx + d.u32(i), cy + d.u32(j), cz + d.u32(k));
        const toPoint = std.sub(std.add(off, std.mul(jit, randomness)), local);
        const dist = std.dot(toPoint, toPoint);
        if (dist < minD) {
          minD = dist;
          closest = d.vec3f(toPoint);
        }
      }
    }
  }
  let edge = d.f32(8);
  for (let k = -1; k <= 1; k++) {
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const off = d.vec3f(d.f32(i), d.f32(j), d.f32(k));
        const jit = cellJitter(cx + d.u32(i), cy + d.u32(j), cz + d.u32(k));
        const toPoint = std.sub(std.add(off, std.mul(jit, randomness)), local);
        const perp = std.sub(toPoint, closest);
        if (std.dot(perp, perp) > 0.0001) {
          edge = std.min(edge, std.dot(std.mul(std.add(closest, toPoint), 0.5), std.normalize(perp)));
        }
      }
    }
  }
  return edge;
});

export const whiteNoise = (vec: d.v3f) => {
  "use gpu";
  return toUnit(hash3(std.bitcastF32toU32(vec.x), std.bitcastF32toU32(vec.y), std.bitcastF32toU32(vec.z)));
};

export const whiteNoiseColor = (vec: d.v3f) => {
  "use gpu";
  const h = pcg3(std.bitcastF32toU32(vec.x), std.bitcastF32toU32(vec.y), std.bitcastF32toU32(vec.z));
  return d.vec3f(toUnit(h.x), toUnit(h.y), toUnit(h.z));
};

// ------------------------------------------------------------------ layer weight
const fresnelDielectric = (cosi: number, eta: number) => {
  "use gpu";
  const c = std.abs(cosi);
  const g2 = eta * eta - 1 + c * c;
  if (g2 <= 0) {
    return d.f32(1);
  }
  const g = std.sqrt(g2);
  const A = (g - c) / (g + c);
  const B = (c * (g + c) - 1) / (c * (g - c) + 1);
  return 0.5 * A * A * (1 + B * B);
};

/** Layer Weight node, Facing output. cosNI = dot(shading normal, view direction). */
export const facing = (blend: number, cosNI: number) => {
  "use gpu";
  const f = std.abs(cosNI);
  if (blend === 0.5) {
    return 1 - f;
  }
  const b = std.clamp(blend, 0, 0.99999);
  const e = std.select(0.5 / (1 - b), b * 2, b < 0.5);
  return 1 - std.pow(std.max(f, 1e-8), e);
};

/** Layer Weight node, Fresnel output. */
export const fresnel = (blend: number, cosNI: number, front: boolean) => {
  "use gpu";
  const eta = std.max(1 - blend, 1e-5);
  return fresnelDielectric(cosNI, std.select(eta, 1 / eta, front));
};
