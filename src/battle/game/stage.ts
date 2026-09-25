/**
 * Stage 1, the Crimson Plain: the film's world as a road. SORA walks it from
 * the west (world -x) toward the heart of the plain, where KAGE waits at the
 * spot the film's finale was shot (the origin), so the finisher cuts straight
 * into the film.
 *
 * The road runs along x; its lane is |y| < LANE. Arenas seal the road with
 * barriers until every wave in them is down.
 */
import type { Kind } from "./actor";
import type { PropDef } from "./props";

export const LANE = 3.6;

export interface Spawn {
  kind: Exclude<Kind, "hero" | "boss">;
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
  /** the boss arena: KAGE, not waves */
  boss?: boolean;
  title?: string;
}

export interface StageDef {
  name: string;
  subtitle: string;
  start: number;
  /** the road ends here (a soft wall) */
  end: number;
  arenas: Arena[];
  props: PropDef[];
}

const shade = (dx: number, y: number, at = 0): Spawn => ({ kind: "shade", dx, y, at });
const brute = (dx: number, y: number, at = 0): Spawn => ({ kind: "brute", dx, y, at });

export const STAGE_1: StageDef = {
  name: "CRIMSON PLAIN",
  subtitle: "STAGE 1",
  start: -58,
  end: 9,
  arenas: [
    {
      from: -46,
      to: -32,
      trigger: -42,
      title: "AMBUSH",
      waves: [
        [shade(4.5, 1.2), shade(5.5, -1.4)],
        [shade(5, 0), shade(-5.5, 1.5, 0.4), shade(5.8, -2, 0.8)],
      ],
    },
    {
      from: -27,
      to: -12,
      trigger: -23,
      title: "SHADOW GATE",
      waves: [
        [shade(5, 1.6), shade(5.5, -1.2), shade(-5, 0, 0.5)],
        [brute(5.5, 0), shade(-5, 1.8, 0.6), shade(-5.5, -1.6, 1.0)],
      ],
    },
    { from: -8, to: 8, trigger: -6.5, boss: true, waves: [] },
  ],
  props: [
    // the way in
    { kind: "torii", x: -54, y: 5.2 },
    { kind: "lantern", x: -56.5, y: -4.8 },
    { kind: "lantern", x: -51.5, y: -4.8 },
    { kind: "rock", x: -60, y: 7, seed: 3 },
    { kind: "rock", x: -48, y: 9, seed: 11, scale: 1.4 },
    { kind: "pillar", x: -50, y: 6.4, seed: 5 },
    // first ambush
    { kind: "redLantern", x: -46.5, y: 4.6 },
    { kind: "redLantern", x: -31.5, y: 4.6 },
    { kind: "shards", x: -39, y: 7.5, seed: 21 },
    { kind: "rock", x: -36, y: 8.5, seed: 17, scale: 1.2 },
    { kind: "pillar", x: -41, y: -6.8, seed: 9 },
    { kind: "rock", x: -35, y: -7.5, seed: 29, scale: 0.8 },
    // between
    { kind: "torii", x: -29.5, y: 5.2, scale: 0.85 },
    { kind: "lantern", x: -29.5, y: -4.8 },
    { kind: "shards", x: -26, y: 8.5, seed: 33 },
    // the shadow gate
    { kind: "pillar", x: -24, y: 6.2, seed: 13 },
    { kind: "pillar", x: -15, y: 6.2, seed: 19 },
    { kind: "redLantern", x: -27.5, y: -4.8 },
    { kind: "redLantern", x: -11.5, y: -4.8 },
    { kind: "rock", x: -19, y: 9.5, seed: 41, scale: 1.6 },
    { kind: "rock", x: -21, y: -7.5, seed: 43 },
    { kind: "shards", x: -17, y: 7.5, seed: 47 },
    // the heart of the plain: the great gate KAGE waits behind
    { kind: "greatTorii", x: -9.5, y: 0, rot: 90 },
    { kind: "redLantern", x: -10, y: 5.3 },
    { kind: "redLantern", x: -10, y: -5.3 },
    { kind: "rock", x: 6, y: 11, seed: 51, scale: 1.8 },
    { kind: "rock", x: -3, y: 12, seed: 53, scale: 1.5 },
    { kind: "pillar", x: 10.5, y: 5.5, seed: 57 },
    { kind: "pillar", x: 10.5, y: -5.5, seed: 59 },
  ],
};
