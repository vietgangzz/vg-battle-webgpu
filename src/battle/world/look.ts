/**
 * Ninh Bình's day. It opens in the soft light of a spring morning (a pale
 * blue sky, high drifting cloud, a warm low sun raking across the valley,
 * mist in the river bends) and, as SORA lights the shrines and clears the
 * camps, the sun sinks to a golden dusk over the karsts: the sky turns amber
 * and violet, the haze warms, and the lanterns come into their own.
 */
import type { Look } from "../game/stage";

const n = (x: number, y: number, z: number): [number, number, number] => {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
};

export const MORNING: Look = {
  skyTop: [0.05, 0.25, 0.72],
  skyHorizon: [0.6, 0.78, 0.95],
  skyBelow: [0.3, 0.4, 0.36],
  sunDir: n(-0.55, 0.45, 0.5),
  sunColor: [1, 0.93, 0.8],
  sunSize: 1.4,
  cloudTint: [1, 1, 1],
  cloudCover: 0.5,
  fogColor: [0.64, 0.77, 0.92],
  fogDensity: 0.0014,
  fogHeight: 14,
  waterDeep: [0.02, 0.1, 0.12],
  waterShallow: [0.1, 0.34, 0.32],
  key: { dir: n(-0.55, 0.45, 0.7), color: [1, 0.95, 0.82], strength: 3.9 },
  fill: { dir: n(0.5, -0.6, 0.4), color: [0.55, 0.72, 1], strength: 1.0 },
  ambient: [0.06, 0.07, 0.08],
};

export const DUSK: Look = {
  skyTop: [0.13, 0.12, 0.3],
  skyHorizon: [1.0, 0.62, 0.38],
  skyBelow: [0.3, 0.22, 0.24],
  sunDir: n(-0.75, 0.5, 0.1),
  sunColor: [1, 0.55, 0.28],
  sunSize: 2.2,
  cloudTint: [1, 0.66, 0.52],
  cloudCover: 0.46,
  fogColor: [0.86, 0.6, 0.46],
  fogDensity: 0.0048,
  fogHeight: 9,
  waterDeep: [0.05, 0.05, 0.09],
  waterShallow: [0.3, 0.2, 0.18],
  key: { dir: n(-0.75, 0.5, 0.22), color: [1, 0.58, 0.32], strength: 1.75 },
  fill: { dir: n(0.5, -0.6, 0.4), color: [0.45, 0.45, 0.9], strength: 0.55 },
  ambient: [0.035, 0.03, 0.05],
};

const mix3 = (a: number[], b: number[], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mix1 = (a: number, b: number, t: number) => a + (b - a) * t;

/** A look between two others (t = 0: a, 1: b). */
export function mixLook(a: Look, b: Look, t: number): Look {
  const light = (x: Look["key"], y: Look["key"]) => ({ dir: mix3(x.dir, y.dir, t), color: mix3(x.color, y.color, t), strength: mix1(x.strength, y.strength, t) });
  return {
    skyTop: mix3(a.skyTop, b.skyTop, t),
    skyHorizon: mix3(a.skyHorizon, b.skyHorizon, t),
    skyBelow: mix3(a.skyBelow, b.skyBelow, t),
    sunDir: mix3(a.sunDir, b.sunDir, t),
    sunColor: mix3(a.sunColor, b.sunColor, t),
    sunSize: mix1(a.sunSize ?? 1, b.sunSize ?? 1, t),
    cloudTint: mix3(a.cloudTint, b.cloudTint, t),
    cloudCover: mix1(a.cloudCover, b.cloudCover, t),
    fogColor: mix3(a.fogColor, b.fogColor, t),
    fogDensity: mix1(a.fogDensity, b.fogDensity, t),
    fogHeight: mix1(a.fogHeight, b.fogHeight, t),
    waterDeep: mix3(a.waterDeep ?? [0, 0, 0], b.waterDeep ?? [0, 0, 0], t),
    waterShallow: mix3(a.waterShallow ?? [0, 0, 0], b.waterShallow ?? [0, 0, 0], t),
    key: light(a.key, b.key),
    fill: light(a.fill, b.fill),
    ambient: mix3(a.ambient, b.ambient, t),
  };
}
