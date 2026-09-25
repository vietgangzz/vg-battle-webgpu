/**
 * The journey: three of Vietnam's great landscapes, then the crimson plain.
 *
 * 1. Tràng An (Ninh Bình): a towpath along a jade river between karst towers.
 * 2. Vịnh Hạ Long: a boardwalk through a floating village, islets at sunset.
 * 3. Fansipan: the ridge path above a sea of clouds at dawn.
 * 4. The Crimson Plain: the film's own world, where KAGE waits.
 *
 * Every stage runs along the same road (world x, -58 -> 9, lane |y| < LANE)
 * with two ambush arenas and a boss arena at the end; the camera looks from
 * the near side (-y), so the backdrop lives on the far side (+y).
 */
import type { Kind } from "./actor";
import { type Backdrop, type PropDef, scatter, type Terrain } from "./scenery";
import type { RGB } from "./shading";

export const LANE = 3.6;

export interface Spawn {
  kind: "shade" | "brute";
  /** metres from the arena's centre along the road, and across it */
  dx: number;
  y: number;
  /** seconds into the wave */
  at?: number;
}

export interface Arena {
  /** where the road seals (world x of the two walls) */
  from: number;
  to: number;
  /** SORA crossing this x triggers the ambush */
  trigger: number;
  waves: Spawn[][];
  /** the boss arena: the stage's boss, not waves */
  boss?: boolean;
  title?: string;
}

/** Sun, sky, fog and water for a stage (all in linear light). */
export interface Look {
  /** the film's own night sky and ground (the crimson plain) */
  film?: boolean;
  skyTop: RGB;
  skyHorizon: RGB;
  skyBelow: RGB;
  /** toward the sun */
  sunDir: RGB;
  sunColor: RGB;
  sunSize?: number;
  cloudTint: RGB;
  cloudCover: number;
  stars?: number;
  fogColor: RGB;
  fogDensity: number;
  fogHeight: number;
  waterDeep?: RGB;
  waterShallow?: RGB;
  cloudSeaLit?: RGB;
  cloudSeaShade?: RGB;
  /** the light rig: key sun (irradiance), fill from the camera side, ambient */
  key: { dir: RGB; color: RGB; strength: number };
  fill: { dir: RGB; color: RGB; strength: number };
  ambient: RGB;
}

export interface StageDef {
  id: string;
  name: string;
  /** where it is, in Vietnamese */
  region: string;
  /** one line for the stage card */
  blurb: string;
  look: Look;
  terrain: Terrain;
  backdrop: Backdrop;
  props: PropDef[];
  fleet?: { kind: "sampan" | "junk"; x: number; y: number; rot?: number; drift?: number }[];
  start: number;
  end: number;
  arenas: Arena[];
  boss: Extract<Kind, "boss" | "captain">;
  bossName: string;
  bossTitle: string;
  /** colours for the stage card: sky top, horizon, three mountain layers */
  card: { sky: [string, string]; layers: [string, string, string]; sun: string };
  /** first-time tips, shown as SORA reaches each x */
  hints?: { x: number; text: string }[];
}

const shade = (dx: number, y: number, at = 0): Spawn => ({ kind: "shade", dx, y, at });
const brute = (dx: number, y: number, at = 0): Spawn => ({ kind: "brute", dx, y, at });

/** The shared road layout: two ambushes, a boss arena behind a gate. */
const road = (a: Spawn[][], b: Spawn[][], titles: [string, string]): Arena[] => [
  { from: -46, to: -32, trigger: -42, title: titles[0], waves: a },
  { from: -27, to: -12, trigger: -23, title: titles[1], waves: b },
  { from: -8, to: 8, trigger: -6.5, boss: true, waves: [] },
];

const up = (x: number, y: number, z: number): RGB => {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
};

// ---------------------------------------------------------------- 1. Tràng An
const TRANG_AN: StageDef = {
  id: "trang-an",
  name: "TRÀNG AN",
  region: "Ninh Bình",
  blurb: "A jade river between karst towers. The shadows wait in the reeds.",
  look: {
    skyTop: [0.16, 0.34, 0.58],
    skyHorizon: [0.72, 0.8, 0.78],
    skyBelow: [0.3, 0.4, 0.38],
    sunDir: up(-0.35, 0.8, 0.5),
    sunColor: [1, 0.92, 0.78],
    cloudTint: [0.95, 0.96, 0.95],
    cloudCover: 0.42,
    fogColor: [0.62, 0.72, 0.7],
    fogDensity: 0.0075,
    fogHeight: 6,
    waterDeep: [0.015, 0.1, 0.075],
    waterShallow: [0.08, 0.3, 0.22],
    key: { dir: up(-0.4, -0.55, 0.75), color: [1, 0.95, 0.85], strength: 3.2 },
    fill: { dir: up(0.5, -0.8, 0.3), color: [0.7, 0.85, 1], strength: 0.9 },
    ambient: [0.05, 0.06, 0.06],
  },
  terrain: { kind: "river" },
  backdrop: {},
  props: [
    // the karst towers: a far forest of them, and a few giants close across the river
    ...scatter("karst", 34, [-150, 70], [45, 170], 11, { h: 45, r: 11 }),
    ...scatter("karst", 10, [-110, 40], [22, 42], 23, { h: 30, r: 8 }),
    { kind: "karst", x: -48, y: 16, h: 26, r: 7, seed: 5 },
    { kind: "karst", x: -20, y: 18, h: 34, r: 8, seed: 9 },
    { kind: "karst", x: 6, y: 17, h: 30, r: 9, seed: 13 },
    // the bank
    ...scatter("bamboo", 7, [-62, 12], [5.6, 7.5], 31),
    ...scatter("tree", 4, [-60, 10], [6.6, 8.2], 41),
    ...scatter("lotus", 7, [-64, 14], [8.5, 13], 43),
    ...scatter("mossRock", 6, [-62, 12], [5.2, 6.5], 47),
    { kind: "lanternPole", x: -52, y: 4.9 },
    { kind: "lanternPole", x: -36, y: 4.9 },
    { kind: "lanternPole", x: -26, y: 4.9 },
    { kind: "lanternPole", x: -14, y: 4.9 },
    // the gate onto the ambush road, and the temple gate before the boss
    { kind: "pagodaGate", x: -44, y: 6.4, scale: 1.05 },
    { kind: "pagodaGate", x: -1, y: 7.2, scale: 1.4 },
    { kind: "stupa", x: 4, y: 7.5 },
  ],
  fleet: [
    { kind: "sampan", x: -50, y: 10, rot: 8, drift: 0.25 },
    { kind: "sampan", x: -30, y: 12.5, rot: -12, drift: -0.2 },
    { kind: "sampan", x: -8, y: 11, rot: 4, drift: 0.18 },
    { kind: "sampan", x: 14, y: 14, rot: 170, drift: -0.3 },
  ],
  start: -58,
  end: 9,
  arenas: road(
    [[shade(4.5, 1.2), shade(5.5, -1.4)], [shade(5, 0), shade(-5.5, 1.5, 0.4), shade(5.8, -2, 0.8)]],
    [[shade(5, 1.6), shade(5.5, -1.2), shade(-5, 0, 0.5)], [brute(5.5, 0), shade(-5, 1.8, 0.6)]],
    ["AMBUSH", "RIVER GATE"],
  ),
  boss: "captain",
  bossName: "HẮC TƯỚNG",
  bossTitle: "SHADOW GENERAL",
  card: { sky: ["#3A6FA0", "#C9DCD6"], layers: ["#8FB3A8", "#4F7F64", "#1F4A30"], sun: "#FFF1C9" },
  hints: [
    { x: -56, text: "Kéo joystick để di chuyển" },
    { x: -49, text: "Bấm SLASH liên tục: chém xoay · hất tung · đâm" },
    { x: -34, text: "JUMP rồi SLASH để bổ từ trên xuống" },
    { x: -30, text: "Giữ GUARD đúng lúc để phản đòn" },
    { x: -24, text: "STREAK lao xuyên qua cả hàng địch" },
    { x: -12, text: "Nhặt năng lượng · đầy vòng thì bấm ULT" },
  ],
};

// ---------------------------------------------------------------- 2. Hạ Long
const HA_LONG: StageDef = {
  id: "ha-long",
  name: "VỊNH HẠ LONG",
  region: "Quảng Ninh",
  blurb: "Sunset over the islets. The boardwalk through the floating village.",
  look: {
    skyTop: [0.1, 0.12, 0.32],
    skyHorizon: [1.0, 0.5, 0.26],
    skyBelow: [0.35, 0.2, 0.18],
    sunDir: up(0.35, 0.94, 0.07),
    sunColor: [1, 0.62, 0.3],
    sunSize: 2.2,
    cloudTint: [0.95, 0.62, 0.55],
    cloudCover: 0.5,
    fogColor: [0.85, 0.52, 0.38],
    fogDensity: 0.006,
    fogHeight: 9,
    waterDeep: [0.02, 0.05, 0.1],
    waterShallow: [0.08, 0.18, 0.24],
    key: { dir: up(0.3, 0.9, 0.35), color: [1, 0.62, 0.35], strength: 3.4 },
    fill: { dir: up(-0.3, -0.9, 0.35), color: [0.55, 0.6, 1], strength: 1.2 },
    ambient: [0.07, 0.05, 0.07],
  },
  terrain: { kind: "boardwalk" },
  backdrop: {},
  props: [
    ...scatter("islet", 40, [-190, 110], [50, 240], 51, { h: 26, r: 12 }),
    ...scatter("islet", 12, [-120, 50], [26, 48], 53, { h: 16, r: 8 }),
    // Hòn Trống Mái, the two kissing rocks
    { kind: "karst", x: -34, y: 30, h: 13, r: 2.6, seed: 71, rot: 20 },
    { kind: "karst", x: -31.5, y: 30.5, h: 11, r: 2.2, seed: 73, rot: -30 },
    // the floating village either side of the walk
    ...[-56, -44, -33, -21, -10, 2].map((x, i) => ({ kind: "floatingHouse" as const, x, y: 8.5 + (i % 2) * 2, seed: i * 7 + 1 })),
    ...[-58, -46, -34, -22, -10, 2].map((x) => ({ kind: "amberPole" as const, x, y: 4.3 })),
    { kind: "pagodaGate", x: -1, y: 7.4, scale: 1.3 },
  ],
  fleet: [
    { kind: "junk", x: -60, y: 24, rot: 6, drift: 0.35 },
    { kind: "junk", x: -20, y: 34, rot: -8, drift: 0.28 },
    { kind: "junk", x: 10, y: 22, rot: 176, drift: -0.3 },
    { kind: "sampan", x: -40, y: 13.5, rot: 20, drift: 0.2 },
    { kind: "sampan", x: -4, y: 14, rot: -10, drift: -0.15 },
  ],
  start: -58,
  end: 9,
  arenas: road(
    [[shade(4.5, 1.4), shade(5, -1.2), shade(-5, 0, 0.6)], [brute(5.5, 0), shade(-5, 1.6, 0.5), shade(5.8, -2, 0.9)]],
    [[shade(5, 1.6), shade(5.5, -1.4), shade(-5, 0.5, 0.4), shade(-5.6, -1.8, 0.8)], [brute(5.5, 1), brute(-5.5, -1, 0.7)]],
    ["AMBUSH", "FLOATING VILLAGE"],
  ),
  boss: "captain",
  bossName: "HẮC TƯỚNG",
  bossTitle: "LORD OF THE TIDE",
  card: { sky: ["#1D2350", "#FF8A4C"], layers: ["#B5586A", "#6B3350", "#2A1830"], sun: "#FFD08A" },
};

// ---------------------------------------------------------------- 3. Fansipan
const FANSIPAN: StageDef = {
  id: "fansipan",
  name: "TIÊN CẢNH FANSIPAN",
  region: "Lào Cai",
  blurb: "The roof of Indochina. A stone path above the sea of clouds, at dawn.",
  look: {
    skyTop: [0.08, 0.12, 0.34],
    skyHorizon: [1.0, 0.7, 0.55],
    skyBelow: [0.6, 0.5, 0.6],
    sunDir: up(-0.45, 0.88, 0.1),
    sunColor: [1, 0.78, 0.55],
    sunSize: 1.6,
    cloudTint: [1, 0.82, 0.78],
    cloudCover: 0.3,
    stars: 0.7,
    fogColor: [0.78, 0.66, 0.72],
    fogDensity: 0.005,
    fogHeight: 10,
    cloudSeaLit: [1.0, 0.86, 0.78],
    cloudSeaShade: [0.5, 0.46, 0.66],
    key: { dir: up(-0.45, 0.6, 0.45), color: [1, 0.8, 0.6], strength: 3.2 },
    fill: { dir: up(0.4, -0.85, 0.35), color: [0.6, 0.7, 1], strength: 1.1 },
    ambient: [0.06, 0.055, 0.075],
  },
  terrain: { kind: "ridge" },
  backdrop: {
    ranges: [
      { y: 220, h: 55, mat: "range2", seed: 3 },
      { y: 140, h: 38, mat: "range2", seed: 7, jag: 0.8 },
      { y: 80, h: 26, mat: "range1", seed: 11, jag: 1 },
    ],
  },
  props: [
    ...scatter("pine", 26, [-64, 14], [6.5, 14], 61),
    ...scatter("mossRock", 10, [-64, 14], [5.2, 9], 69),
    // peaks standing out of the sea of clouds
    ...scatter("karst", 10, [-150, 60], [40, 90], 73, { h: 30, r: 9, z: -9 }),
    ...[-56, -46, -32, -26, -12].map((x) => ({ kind: "stoneLanternAmber" as const, x, y: 4.8 })),
    { kind: "stupa", x: -40, y: 7.5, scale: 1.2 },
    { kind: "stupa", x: 5, y: 7, scale: 1.5 },
    { kind: "goldGate", x: -1, y: 7.4, scale: 1.2 },
  ],
  start: -58,
  end: 9,
  arenas: road(
    [[shade(4.5, 1.2), shade(5.5, -1.4), shade(-5, 0.2, 0.5)], [brute(5, 0), shade(-5.5, 1.5, 0.4), shade(5.8, -2, 0.8)]],
    [[shade(5, 1.6), shade(5.5, -1.2), shade(-5, 0, 0.3), shade(-5.5, 1.8, 0.7)], [brute(5.5, 1), brute(-5.5, -1, 0.5), shade(5, -2, 1)]],
    ["AMBUSH", "CLOUD GATE"],
  ),
  boss: "captain",
  bossName: "HẮC TƯỚNG",
  bossTitle: "KEEPER OF THE PEAK",
  card: { sky: ["#141E52", "#FFB38C"], layers: ["#9C8FB5", "#5E6395", "#2B3161"], sun: "#FFE3B8" },
};

// ---------------------------------------------------------------- 4. the crimson plain
const CRIMSON_PLAIN: StageDef = {
  id: "crimson-plain",
  name: "CRIMSON PLAIN",
  region: "Cõi Bóng",
  blurb: "The film's world. KAGE waits at the heart of the plain.",
  look: {
    film: true,
    skyTop: [0, 0, 0],
    skyHorizon: [0, 0, 0],
    skyBelow: [0, 0, 0],
    sunDir: [0, 0, 1],
    sunColor: [0, 0, 0],
    cloudTint: [0, 0, 0],
    cloudCover: 0,
    fogColor: [0, 0, 0],
    fogDensity: 0,
    fogHeight: 1,
    key: { dir: [0, 0, 1], color: [0, 0, 0], strength: 0 },
    fill: { dir: [0, 0, 1], color: [0, 0, 0], strength: 0 },
    ambient: [0, 0, 0],
  },
  terrain: { kind: "film" },
  backdrop: {},
  props: [
    { kind: "torii", x: -54, y: 5.2 },
    { kind: "lantern", x: -56.5, y: -4.8 },
    { kind: "lantern", x: -51.5, y: -4.8 },
    { kind: "rock", x: -60, y: 7, seed: 3 },
    { kind: "rock", x: -48, y: 9, seed: 11, scale: 1.4 },
    { kind: "pillar", x: -50, y: 6.4, seed: 5 },
    { kind: "redLantern", x: -46.5, y: 4.6 },
    { kind: "redLantern", x: -31.5, y: 4.6 },
    { kind: "shards", x: -39, y: 7.5, seed: 21 },
    { kind: "rock", x: -36, y: 8.5, seed: 17, scale: 1.2 },
    { kind: "torii", x: -29.5, y: 5.2, scale: 0.85 },
    { kind: "shards", x: -26, y: 8.5, seed: 33 },
    { kind: "pillar", x: -24, y: 6.2, seed: 13 },
    { kind: "pillar", x: -15, y: 6.2, seed: 19 },
    { kind: "redLantern", x: -27.5, y: -4.8 },
    { kind: "redLantern", x: -11.5, y: -4.8 },
    { kind: "rock", x: -19, y: 9.5, seed: 41, scale: 1.6 },
    { kind: "shards", x: -17, y: 7.5, seed: 47 },
    { kind: "greatTorii", x: -1, y: 7.5 },
    { kind: "redLantern", x: -10, y: 5.3 },
    { kind: "redLantern", x: -10, y: -5.3 },
    { kind: "rock", x: 6, y: 11, seed: 51, scale: 1.8 },
    { kind: "pillar", x: 10.5, y: 5.5, seed: 57 },
    { kind: "pillar", x: 10.5, y: -5.5, seed: 59 },
  ],
  start: -58,
  end: 9,
  arenas: road(
    [[shade(4.5, 1.2), shade(5.5, -1.4), shade(-5, 0, 0.4)], [shade(5, 0), shade(-5.5, 1.5, 0.4), shade(5.8, -2, 0.8), brute(-5.5, -1.5, 1.2)]],
    [[shade(5, 1.6), shade(5.5, -1.2), shade(-5, 0, 0.5), shade(-5.5, 1.8, 0.9)], [brute(5.5, 0), brute(-5, 1.8, 0.6), shade(-5.5, -1.6, 1.0)]],
    ["AMBUSH", "SHADOW GATE"],
  ),
  boss: "boss",
  bossName: "KAGE",
  bossTitle: "THE SHADOW",
  card: { sky: ["#0B0B10", "#6B1A16"], layers: ["#3A1312", "#22090A", "#0D0506"], sun: "#FF2A2F" },
};

export const STAGES: StageDef[] = [TRANG_AN, HA_LONG, FANSIPAN, CRIMSON_PLAIN];
