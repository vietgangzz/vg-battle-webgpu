/**
 * Ninh Bình in the soft light of a spring morning: a pale blue sky with high
 * drifting cloud, a warm low sun raking across the valley, mist lying in the
 * river bends and softening the far towers.
 */
import type { Look } from "../game/stage";

const n = (x: number, y: number, z: number): [number, number, number] => {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
};

export const MORNING: Look = {
  skyTop: [0.15, 0.3, 0.55],
  skyHorizon: [0.78, 0.8, 0.74],
  skyBelow: [0.36, 0.42, 0.38],
  sunDir: n(-0.55, 0.45, 0.42),
  sunColor: [1, 0.86, 0.66],
  sunSize: 1.4,
  cloudTint: [1, 0.97, 0.92],
  cloudCover: 0.38,
  fogColor: [0.7, 0.76, 0.74],
  fogDensity: 0.0038,
  fogHeight: 7,
  waterDeep: [0.02, 0.1, 0.08],
  waterShallow: [0.1, 0.3, 0.24],
  key: { dir: n(-0.55, 0.45, 0.62), color: [1, 0.9, 0.74], strength: 3.4 },
  fill: { dir: n(0.5, -0.6, 0.4), color: [0.6, 0.75, 1], strength: 0.9 },
  ambient: [0.05, 0.06, 0.065],
};
