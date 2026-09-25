/**
 * The move list. Every move is keyed with the film's own poses and timing
 * (battle/choreo.py), relative to the fighter: `at` is the root's travel in
 * character space (-y = forward, +z = up), times are seconds from the move's
 * start. `impact` is when the blade lands; the swing clip is fired so its film
 * impact frame lines up with it.
 */
import type { ClipName } from "./fx";
import * as P from "./pose";
import type { Key, Vec3 } from "./pose";

export interface HitSpec {
  /** reach from the attacker's root (m) and half-angle of the arc in front (degrees) */
  range: number;
  arc: number;
  damage: number;
  /** light: flinch; heavy: knocked back with a skid; launch: thrown up */
  kind: "light" | "heavy" | "launch";
  /** where the struck fighter's effects play */
  clip: ClipName;
  /** lands this long after `impact` (a travelling strike: the ground wave) */
  delay?: number;
  /** hits only beyond this distance */
  min?: number;
  /** energy the attacker gains per fighter struck */
  gain?: number;
}

export interface MoveDef {
  name: string;
  keys: Key[];
  /** the blade lands (s) */
  impact?: number;
  swing?: ClipName;
  /** extra clips fired at the start, lined up on their own impact frame with this move's `impact` */
  also?: ClipName[];
  hits?: HitSpec[];
  /** from here on the next attack may be chained (s) */
  chain?: number;
  /** turn to face the opponent and close the gap before the blow */
  lunge?: boolean;
  /** afterimage ghosts on over this window (s) */
  ghosts?: [number, number];
  /** untouchable over this window (s) */
  invuln?: [number, number];
  /** played in the air: gravity keeps pulling, and this downward speed is set at the impact (m/s) */
  air?: { plunge: number };
}

const fwd = (m: number, up = 0): Vec3 => [0, -m, up];

// ---------------------------------------------------------------- SORA
/** E1: the full-body spin slash, left -> front -> right (choreo.spin_keys, 6.3 -> 6.75 s). */
const spinKeys = (): Key[] => {
  const keys: Key[] = [{ t: 0.06, pose: P.spinPose(0, 70, -290), ease: "snap" }];
  for (let i = 1; i <= 6; i++) keys.push({ t: 0.06 + (0.26 * i) / 6, pose: P.spinPose(i / 6, 70, -290), ease: "lin" });
  keys.push({ t: 0.5, pose: P.pose(P.H_SLASH, { twist: -360 }), ease: "out" });
  keys.push({ t: 0.51, pose: P.pose(P.H_SLASH, { twist: 0 }), ease: "hold" });
  keys.push({ t: 0.72, pose: P.READY, ease: "smooth" });
  return keys;
};

export const SORA_MOVES = {
  spin: {
    name: "spin",
    keys: spinKeys(),
    impact: 0.31,
    swing: "spin",
    hits: [{ range: 2.8, arc: 180, damage: 9, kind: "light", clip: "spinHit", gain: 6 }],
    chain: 0.36,
    lunge: true,
  },
  // E3: the rising cut (7.3 -> 7.85 s): throws light enemies into the air
  rising: {
    name: "rising",
    keys: [
      { t: 0.12, pose: P.AIR_UP_W, ease: "snap", at: fwd(0.05) },
      { t: 0.3, pose: P.AIR_UP, ease: "snap", at: fwd(0.15) },
      { t: 0.62, pose: P.pose(P.READY, { squash: 0.78 }), ease: "in", at: fwd(0.1) },
    ],
    impact: 0.3,
    swing: "rising",
    hits: [{ range: 2.8, arc: 70, damage: 10, kind: "launch", clip: "risingHit", gain: 7 }],
    chain: 0.34,
    lunge: true,
  },
  // E4: the thrust, then a hop back out of range (7.85 -> 8.5 s)
  thrust: {
    name: "thrust",
    keys: [
      { t: 0.14, pose: P.pose(P.READY, { squash: 0.78 }), ease: "in", at: fwd(-0.1) },
      { t: 0.34, pose: P.THRUST, ease: "snap", at: fwd(0.55) },
      { t: 0.6, pose: P.BACKSTEP, ease: "snap", at: fwd(-1.2) },
      { t: 0.82, pose: P.GUARD, ease: "out", at: fwd(-1.3) },
      { t: 1.0, pose: P.READY, ease: "smooth", at: fwd(-1.3) },
    ],
    impact: 0.34,
    swing: "thrust",
    hits: [{ range: 3.4, arc: 35, damage: 15, kind: "heavy", clip: "thrustHit", gain: 9 }],
    lunge: true,
    ghosts: [0.2, 0.5],
  },
  // in the air: the descending cut, driving her back down onto them
  airCut: {
    name: "airCut",
    keys: [
      { t: 0.08, pose: P.AIR_DN_W, ease: "snap" },
      { t: 0.22, pose: P.AIR_DN, ease: "snap" },
      { t: 0.5, pose: P.pose(P.LAND, { twist: 0 }), ease: "out" },
    ],
    impact: 0.22,
    swing: "rising",
    hits: [{ range: 2.9, arc: 80, damage: 12, kind: "heavy", clip: "risingHit", gain: 8 }],
    air: { plunge: 16 },
    ghosts: [0.1, 0.4],
  },
  // SKILL: the lime streak, a thrust that runs straight through everything in line
  streak: {
    name: "streak",
    keys: [
      { t: 0.12, pose: P.CROUCH_DASH, ease: "out", at: fwd(-0.25) },
      { t: 0.3, pose: P.THRUST, ease: "snap", at: fwd(3.6) },
      { t: 0.52, pose: P.pose(P.THRUST, { lean: 22 }), ease: "out", at: fwd(4.3) },
      { t: 0.85, pose: P.READY, ease: "smooth", at: fwd(4.3) },
    ],
    impact: 0.3,
    swing: "thrust",
    also: ["dashSora"],
    hits: [{ range: 5.2, arc: 28, damage: 24, kind: "heavy", clip: "thrustHit", gain: 4 }],
    ghosts: [0.12, 0.6],
    invuln: [0.1, 0.45],
  },
  // ULTIMATE: the heaven pierce (11.58 -> 13.9 s, shortened): leap, dive, the ground shatters
  pierce: {
    name: "pierce",
    keys: [
      { t: 0.2, pose: P.LEAP_CROUCH, ease: "out", at: fwd(0) },
      { t: 0.36, pose: P.LEAP, ease: "snap", at: fwd(0.4, 2.6) },
      { t: 0.7, pose: P.LEAP, ease: "out", at: fwd(1.6, 6.2) },
      { t: 0.86, pose: P.DIVE, ease: "snap", at: fwd(2.2, 5.4) },
      { t: 1.12, pose: P.pose(P.DIVE, { squash: 1.14, lean: 16 }), ease: "in", at: fwd(3.0, 0.2) },
      { t: 1.16, pose: P.LAND, ease: "snap", at: fwd(3.1, 0) },
      { t: 1.9, pose: P.LAND, ease: "hold", at: fwd(3.1, 0) },
      { t: 2.3, pose: P.STAND, ease: "back", at: fwd(3.1, 0) },
    ],
    impact: 1.12,
    also: ["leap"],
    hits: [{ range: 8.5, arc: 180, damage: 60, kind: "launch", clip: "spinHit" }],
    ghosts: [0.3, 1.14],
    invuln: [0, 2.3],
  },
} satisfies Record<string, MoveDef>;

/** SORA chains spin -> rising -> thrust. */
export const SORA_COMBO: MoveDef[] = [SORA_MOVES.spin, SORA_MOVES.rising, SORA_MOVES.thrust];

// ---------------------------------------------------------------- KAGE and his shadows
export const KAGE_MOVES = {
  // E2: the diagonal overhead (6.84 -> 7.3 s)
  diagonal: {
    name: "diagonal",
    keys: [
      { t: 0.16, pose: P.DIAG_UP, ease: "snap", at: fwd(0.0) },
      { t: 0.32, pose: P.DIAG_DN, ease: "snap", at: fwd(0.25), yaw: -5 },
      { t: 0.66, pose: P.READY, ease: "smooth", at: fwd(0.15) },
    ],
    impact: 0.32,
    swing: "diagonal",
    hits: [{ range: 2.7, arc: 60, damage: 9, kind: "light", clip: "diagonalHit" }],
    chain: 0.38,
    lunge: true,
  },
  // E3: the leaping, descending cut (7.3 -> 7.78 s)
  falling: {
    name: "falling",
    keys: [
      { t: 0.16, pose: P.AIR_DN_W, ease: "snap", at: fwd(0.0) },
      { t: 0.34, pose: P.AIR_DN, ease: "snap", at: fwd(0.1) },
      { t: 0.66, pose: P.READY, ease: "in", at: fwd(0.0) },
    ],
    impact: 0.34,
    swing: "falling",
    hits: [{ range: 2.7, arc: 60, damage: 10, kind: "light", clip: "fallingHit" }],
    lunge: true,
  },
  // the slam and its ground wave (8.3 -> 9.25 s)
  slam: {
    name: "slam",
    keys: [
      { t: 0.3, pose: P.SLAM_UP, ease: "out", at: fwd(0.05) },
      { t: 0.55, pose: P.SLAM, ease: "snap", at: fwd(0.1) },
      { t: 0.75, pose: P.SLAM, ease: "hold", at: fwd(0.1) },
      { t: 1.25, pose: P.READY, ease: "smooth", at: fwd(0.1) },
    ],
    impact: 0.55,
    swing: "slam",
    hits: [
      { range: 2.3, arc: 50, damage: 14, kind: "heavy", clip: "waveHit" },
      // the wave covers 3.4 m in 0.18 s (8.56 -> 8.73 s)
      { range: 4.3, arc: 22, damage: 16, kind: "heavy", clip: "waveHit", delay: 0.18, min: 2.3 },
    ],
    ghosts: [0.3, 0.6],
  },
} satisfies Record<string, MoveDef>;

export const KAGE_COMBO: MoveDef[] = [KAGE_MOVES.diagonal, KAGE_MOVES.falling];

/** A shadow's single cut: telegraphed, slower than KAGE's own. */
export const SHADE_CUT: MoveDef = {
  name: "shadeCut",
  keys: [
    { t: 0.3, pose: P.DIAG_UP, ease: "out", at: fwd(-0.1) },
    { t: 0.44, pose: P.DIAG_DN, ease: "snap", at: fwd(0.35), yaw: -5 },
    { t: 0.85, pose: P.READY, ease: "smooth", at: fwd(0.25) },
  ],
  impact: 0.44,
  swing: "diagonal",
  hits: [{ range: 2.2, arc: 55, damage: 6, kind: "light", clip: "diagonalHit" }],
  lunge: true,
};

/** The brute's slam: the ground wave, a beat slower to read. */
export const BRUTE_SLAM: MoveDef = {
  ...KAGE_MOVES.slam,
  name: "bruteSlam",
  keys: [
    { t: 0.45, pose: P.SLAM_UP, ease: "out", at: fwd(0.05) },
    { t: 0.7, pose: P.SLAM, ease: "snap", at: fwd(0.1) },
    { t: 0.9, pose: P.SLAM, ease: "hold", at: fwd(0.1) },
    { t: 1.5, pose: P.READY, ease: "smooth", at: fwd(0.1) },
  ],
  impact: 0.7,
  hits: [
    { range: 2.6, arc: 50, damage: 11, kind: "heavy", clip: "waveHit" },
    { range: 4.6, arc: 22, damage: 12, kind: "heavy", clip: "waveHit", delay: 0.18, min: 2.6 },
  ],
};

// ---------------------------------------------------------------- shared
/** The dash (4.3 -> 5.05 s): crouch, launch, a long low glide. */
export const DASH: MoveDef = {
  name: "dash",
  keys: [
    { t: 0.08, pose: P.CROUCH_DASH, ease: "out", at: fwd(-0.15) },
    { t: 0.18, pose: P.DASH, ease: "snap", at: fwd(0.7) },
    { t: 0.48, pose: P.pose(P.DASH, { hop: 0.2 }), ease: "lin", at: fwd(4.0) },
    { t: 0.64, pose: P.READY, ease: "out", at: fwd(4.4) },
  ],
  impact: 0.18,
  ghosts: [0.14, 0.52],
  invuln: [0.08, 0.42],
};

/** Struck: flinch back (the film's STRUCK beat, 14.2 s). */
export const FLINCH: MoveDef = {
  name: "flinch",
  keys: [
    { t: 0.05, pose: P.STRUCK, ease: "snap", at: fwd(-0.35) },
    { t: 0.42, pose: P.READY, ease: "smooth", at: fwd(-0.55) },
  ],
};

/** Blasted: guard, skid far back on the blade, recover (8.73 -> 10.2 s). */
export const SKID: MoveDef = {
  name: "skid",
  keys: [
    { t: 0.05, pose: P.GUARD, ease: "snap", at: fwd(-0.3) },
    { t: 0.1, pose: P.SKID, ease: "snap", at: fwd(-0.6) },
    { t: 0.62, pose: P.SKID, ease: "out", at: fwd(-3.4) },
    { t: 1.1, pose: P.WATCH, ease: "back", at: fwd(-3.4) },
  ],
};

/** Parried: thrown off balance. */
export const STAGGER: MoveDef = {
  name: "stagger",
  keys: [
    { t: 0.06, pose: P.pose(P.STRUCK, { lean: -26 }), ease: "snap", at: fwd(-0.5) },
    { t: 0.5, pose: P.pose(P.STRUCK, { squash: 1.05 }), ease: "smooth", at: fwd(-0.7) },
    { t: 0.85, pose: P.READY, ease: "smooth", at: fwd(-0.7) },
  ],
};

/** Blocked a blow: a small push back in guard. */
export const BLOCKED: MoveDef = {
  name: "blocked",
  keys: [
    { t: 0.05, pose: P.pose(P.GUARD, { squash: 0.74 }), ease: "snap", at: fwd(-0.35) },
    { t: 0.3, pose: P.GUARD, ease: "smooth", at: fwd(-0.45) },
  ],
};

/** Parry: the blade snaps up to meet the blow. */
export const PARRY: MoveDef = {
  name: "parry",
  keys: [
    { t: 0.04, pose: P.CLASH_S, ease: "snap", at: fwd(0.1) },
    { t: 0.28, pose: P.CLASH_S, ease: "hold", at: fwd(0.1) },
    { t: 0.55, pose: P.READY, ease: "smooth", at: fwd(-0.2) },
  ],
};

/** Knocked flat after a launch or a heavy blow, then back up. */
export const GETUP: MoveDef = {
  name: "getup",
  keys: [
    { t: 0.05, pose: P.KNEEL, ease: "snap" },
    { t: 0.55, pose: P.KNEEL, ease: "hold" },
    { t: 0.85, pose: P.READY, ease: "back" },
  ],
};

/** Out of the fight: struck, then down on one knee (14.2 -> 18.1 s). */
export const DOWN: MoveDef = {
  name: "down",
  keys: [
    { t: 0.05, pose: P.STRUCK, ease: "snap", at: fwd(-0.4) },
    { t: 0.45, pose: P.STRUCK, ease: "out", at: fwd(-0.9) },
    { t: 1.1, pose: P.KNEEL, ease: "back", at: fwd(-0.9) },
  ],
};

/** SORA readies the finisher: the crouch before the leap (11.58 s). */
export const FINISH_WINDUP: MoveDef = {
  name: "windup",
  keys: [
    { t: 0.12, pose: P.WATCH, ease: "out" },
    { t: 0.4, pose: P.LEAP_CROUCH, ease: "out" },
  ],
};

/** KAGE arrives: a leap down into the arena, landing in a crouch, rising to the standoff. */
export const BOSS_ENTRY: MoveDef = {
  name: "entry",
  keys: [
    { t: 0.0, pose: P.DIVE, ease: "snap", at: [0, 0, 7] },
    { t: 0.55, pose: P.pose(P.DIVE, { squash: 1.14 }), ease: "in", at: [0, 0, 0] },
    { t: 0.6, pose: P.KNEEL, ease: "snap", at: [0, 0, 0] },
    { t: 1.4, pose: P.KNEEL, ease: "hold" },
    { t: 2.0, pose: P.PRESENT, ease: "back" },
    { t: 2.6, pose: P.READY, ease: "smooth" },
  ],
  invuln: [0, 2.6],
};

/** A shadow steps out of the dark: rising from a crouch. */
export const SPAWN: MoveDef = {
  name: "spawn",
  keys: [
    { t: 0.0, pose: P.pose(P.KNEEL, { squash: 0.45 }), ease: "snap" },
    { t: 0.35, pose: P.KNEEL, ease: "out" },
    { t: 0.7, pose: P.READY, ease: "back" },
  ],
  invuln: [0, 0.6],
};
