/**
 * The Little Giant pose grammar, ported from the film's rig (battle/lib/mascot.py)
 * and its choreography (battle/choreo.py), so the game's moves are made of the
 * very poses the film was keyed with.
 *
 * Character space: faces -Y, left is +X, up +Z, origin at the bottom centre of
 * the body. Hands and blade are in root space (root = position + yaw only).
 */

export type Vec3 = readonly [number, number, number];

export interface Pose {
  /** pivot rotation in degrees: + lean tips the top toward the face */
  lean: number;
  roll: number;
  twist: number;
  /** vertical scale; width compensates to keep the volume */
  squash: number;
  /** extra lift of the body pivot (m) */
  hop: number;
  hand_r: Vec3;
  hand_l: Vec3;
  /** blade direction and the side its edge faces */
  blade: Vec3;
  edge: Vec3;
}

export const REST: Pose = {
  lean: 0,
  roll: 0,
  twist: 0,
  squash: 1,
  hop: 0,
  hand_r: [-0.55, -0.35, 0.62],
  hand_l: [0.6, -0.3, 0.55],
  blade: [0, -0.4, 1],
  edge: [0, -1, 0],
};

type PoseKeys = Partial<Pose> & { ray_kick?: number };

const P = (...parts: PoseKeys[]): Pose => {
  const out = { ...REST } as Pose & { ray_kick?: number };
  for (const p of parts) Object.assign(out, p);
  delete out.ray_kick;
  return out;
};

// ---------------------------------------------------------------- the film's poses (choreo.py)
export const IDLE = P({ squash: 1.0, lean: 4, hand_r: [-0.82, -0.42, 0.52], blade: [-0.25, -0.55, -0.8], edge: [0, -1, 0], hand_l: [0.84, -0.3, 0.5] });
export const BREATHE = P(IDLE, { squash: 0.97, hand_r: [-0.83, -0.42, 0.49], hand_l: [0.85, -0.3, 0.47] });
export const PRESENT = P({ squash: 1.02, lean: -4, hand_r: [-0.62, -0.72, 0.95], blade: [-0.45, -0.55, 0.72], edge: [0, -1, 0], hand_l: [0.8, -0.3, 0.5] });
export const READY = P({ squash: 0.9, lean: 12, hand_r: [-0.8, -0.35, 0.62], blade: [-0.35, 0.75, -0.55], edge: [0, 0, 1], hand_l: [0.8, -0.5, 0.62] });
export const CROUCH_DASH = P({ squash: 0.72, lean: 20, hand_r: [-0.8, -0.1, 0.5], blade: [-0.3, 0.9, -0.3], edge: [0, 0, 1], hand_l: [0.82, -0.3, 0.45] });
export const DASH = P({ squash: 0.82, lean: 34, hand_r: [-0.78, 0.55, 0.62], blade: [-0.2, 1.0, 0.1], edge: [0, 0, 1], hand_l: [0.8, 0.45, 0.55], hop: 0.12 });
export const JODAN = P({ squash: 1.18, lean: -10, hand_r: [-0.2, -0.3, 1.72], blade: [0.0, 0.75, 0.65], edge: [0, -1, 0], hand_l: [0.25, -0.35, 1.65], hop: 0.25 });
export const CLASH_K = P({ squash: 0.84, lean: 24, hand_r: [-0.12, -0.92, 1.0], blade: [0.3, -1.0, 0.32], edge: [0, 0, -1], hand_l: [0.25, -0.85, 0.95] });
export const CLASH_S = P({ squash: 0.86, lean: 22, hand_r: [-0.1, -0.92, 0.98], blade: [-0.3, -1.0, 0.42], edge: [0, 0, 1], hand_l: [0.2, -0.85, 0.92] });
export const BLOCK_R = P({ squash: 0.95, lean: 6, twist: 18, hand_r: [-0.72, -0.72, 0.85], blade: [0.05, -0.15, 1.0], edge: [-1, 0, 0], hand_l: [0.7, -0.5, 0.7] });
export const H_WIND = P({ squash: 1.05, lean: 6, twist: -40, hand_r: [0.75, 0.3, 0.85], blade: [0.8, 0.55, 0.1], edge: [0, 0, 1], hand_l: [0.6, -0.6, 0.8] });
export const H_SLASH = P({ squash: 0.88, lean: 16, twist: 40, hand_r: [-0.9, -0.75, 0.82], blade: [-1.0, -0.45, 0.05], edge: [0, 0, 1], hand_l: [0.75, 0.2, 0.75] });
export const PARRY = P({ squash: 0.92, lean: 8, hand_r: [-0.35, -0.85, 1.05], blade: [0.65, -0.25, 0.75], edge: [0, -1, 0], hand_l: [0.4, -0.8, 1.0] });
export const DIAG_UP = P({ squash: 1.12, lean: -6, twist: -25, hand_r: [0.5, -0.2, 1.5], blade: [0.55, 0.55, 0.7], edge: [0, -1, 0], hand_l: [0.7, -0.4, 1.2] });
export const DIAG_DN = P({ squash: 0.82, lean: 28, twist: 25, hand_r: [-0.75, -0.8, 0.5], blade: [-0.6, -0.55, -0.5], edge: [0, 0, -1], hand_l: [0.7, -0.3, 0.8] });
export const THRUST = P({ squash: 0.8, lean: 30, hand_r: [-0.1, -1.25, 0.8], blade: [0.0, -1.0, 0.05], edge: [0, 0, 1], hand_l: [0.8, 0.3, 0.6] });
export const DEFLECT = P({ squash: 0.9, lean: 8, twist: -20, hand_r: [0.4, -0.85, 0.9], blade: [0.9, -0.3, 0.45], edge: [0, -1, 0], hand_l: [0.8, -0.2, 0.7] });
export const SMASH = P({ squash: 0.7, lean: 32, hand_r: [0.0, -1.0, 0.42], blade: [0.0, -0.85, -0.55], edge: [0, 0, -1], hand_l: [0.2, -0.95, 0.4] });
export const GUARD = P({ squash: 0.8, lean: 18, hand_r: [-0.45, -0.85, 0.85], blade: [1.0, -0.05, 0.3], edge: [0, -1, 0], hand_l: [0.45, -0.85, 0.9] });
export const SKID = P({ squash: 0.74, lean: 24, hand_r: [-0.35, -0.95, 0.45], blade: [-0.15, -0.55, -0.82], edge: [0, -1, 0], hand_l: [0.8, -0.3, 0.3] });
export const WATCH = P({ squash: 1.02, lean: -4, hand_r: [-0.82, -0.3, 0.45], blade: [-0.3, -0.5, -0.8], edge: [0, -1, 0], hand_l: [0.84, -0.3, 0.48] });
export const PLANT = P({ squash: 0.9, lean: 10, hand_r: [-0.05, -0.95, 0.9], blade: [0.0, -0.12, -1.0], edge: [0, -1, 0], hand_l: [0.12, -0.95, 0.98] });
export const STRUCK = P({ squash: 1.12, lean: -18, hand_r: [-1.0, -0.1, 0.8], blade: [-0.5, -0.3, -0.8], edge: [0, -1, 0], hand_l: [1.0, -0.1, 0.85] });
export const KNEEL = P({ squash: 0.68, lean: 26, hand_r: [-0.6, -0.8, 0.55], blade: [0.0, -0.1, -1.0], edge: [0, -1, 0], hand_l: [0.7, -0.6, 0.3] });
export const LEAP_CROUCH = P({ squash: 0.55, lean: 6, hand_r: [-0.85, -0.2, 0.35], blade: [-0.3, 0.8, -0.4], edge: [0, 0, 1], hand_l: [0.85, -0.2, 0.3] });
export const LEAP = P({ squash: 1.18, lean: -4, hand_r: [-0.6, 0.2, 0.3], blade: [-0.1, 0.3, -1.0], edge: [0, -1, 0], hand_l: [0.6, 0.2, 0.3] });
/** the plunge: upright, both hands under the body driving the blade straight down */
export const DIVE = P({ squash: 1.08, lean: 22, hand_r: [0.0, -0.32, -0.28], blade: [0.0, -0.18, -1.0], edge: [0, -1, 0], hand_l: [0.14, -0.3, -0.2] });
export const LAND = P({ squash: 0.78, lean: 22, twist: 15, hand_r: [-1.35, 0.1, 0.6], blade: [-1.0, 0.35, -0.12], edge: [0, 0, 1], hand_l: [0.7, -0.75, 0.2] });
export const STAND = P({ squash: 1.0, lean: 0, twist: 0, hand_r: [-0.85, -0.25, 0.5], blade: [-0.3, 0.2, -1.0], edge: [0, -1, 0], hand_l: [0.84, -0.3, 0.5] });
export const AIR_UP_W = P({ squash: 1.15, lean: -4, hand_r: [-0.3, 0.55, 1.05], blade: [0.0, 0.6, -0.75], edge: [0, 0, -1], hand_l: [0.7, 0.1, 1.35], hop: 0.55 });
export const AIR_UP = P({ squash: 1.2, lean: 14, hand_r: [-0.3, -0.85, 1.95], blade: [0.0, -0.65, 0.75], edge: [0, 0, 1], hand_l: [0.75, 0.2, 1.4], hop: 0.95 });
export const AIR_DN_W = P({ squash: 1.2, lean: -10, hand_r: [-0.3, 0.2, 2.2], blade: [0.0, 0.55, 0.8], edge: [0, -1, 0], hand_l: [0.7, -0.2, 1.8], hop: 0.7 });
export const AIR_DN = P({ squash: 0.95, lean: 26, hand_r: [-0.3, -0.95, 1.05], blade: [0.0, -0.8, -0.55], edge: [0, 0, -1], hand_l: [0.7, -0.3, 1.2], hop: 0.95 });
export const BACKSTEP = P({ squash: 0.85, lean: -8, hand_r: [-0.7, -0.6, 0.7], blade: [0.6, -0.5, 0.6], edge: [0, -1, 0], hand_l: [0.7, -0.5, 0.75], hop: 0.35 });
export const SLAM_UP = P({ squash: 1.25, lean: -14, hand_r: [-0.15, 0.1, 2.05], blade: [0.0, 0.65, 0.7], edge: [0, -1, 0], hand_l: [0.2, 0.0, 2.0], hop: 0.8 });
export const SLAM = P({ squash: 0.62, lean: 34, hand_r: [0.0, -1.05, 0.38], blade: [0.0, -0.75, -0.66], edge: [0, 0, -1], hand_l: [0.2, -1.0, 0.36] });

export const pose = P;

/** Whole-body spin slash (choreo.spin_keys): body twist and orbiting hands, a0 -> a1 degrees. */
export function spinPose(u: number, a0: number, a1: number): Pose {
  const a = ((a0 + (a1 - a0) * u) * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const rz = (v: Vec3): Vec3 => [c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]];
  return P({
    squash: 0.9 + 0.08 * Math.sin(Math.PI * u),
    lean: 14,
    twist: a0 + (a1 - a0) * u,
    hand_r: rz([-1.0, -0.2, 0.82]),
    blade: rz([-1.0, -0.12, 0.04]),
    edge: [0, 0, 1],
    hand_l: rz([0.8, 0.3, 0.7]),
  });
}

// ---------------------------------------------------------------- blending and eases (lib/core.py)
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const vmix = (a: Vec3, b: Vec3, t: number): Vec3 => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

export const EASES = {
  snap: (x: number) => {
    x = clamp01(x);
    return x >= 1 ? 1 : 1 - Math.pow(2, -10 * x);
  },
  smooth: (x: number) => {
    x = clamp01(x);
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  },
  lin: clamp01,
  out: (x: number) => 1 - Math.pow(1 - clamp01(x), 3),
  in: (x: number) => Math.pow(clamp01(x), 3),
  back: (x: number) => {
    x = clamp01(x);
    const s = 2.2;
    return 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2);
  },
  hold: (x: number) => (x < 1 ? 0 : 1),
};
export type Ease = keyof typeof EASES;

export function blend(a: Pose, b: Pose, t: number): Pose {
  return {
    lean: mix(a.lean, b.lean, t),
    roll: mix(a.roll, b.roll, t),
    twist: mix(a.twist, b.twist, t),
    squash: mix(a.squash, b.squash, t),
    hop: mix(a.hop, b.hop, t),
    hand_r: vmix(a.hand_r, b.hand_r, t),
    hand_l: vmix(a.hand_l, b.hand_l, t),
    blade: vmix(a.blade, b.blade, t),
    edge: vmix(a.edge, b.edge, t),
  };
}

const catmull = (p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, u: number): Vec3 => {
  const u2 = u * u;
  const u3 = u2 * u;
  const f = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
  return [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1]), f(p0[2], p1[2], p2[2], p3[2])];
};

/** A key: time (s), pose, the ease into it, and where the root has travelled (m, character space: -y = forward). */
export interface Key {
  t: number;
  pose: Pose;
  ease: Ease;
  /** root displacement from the move's start, in the character's space at the start */
  at?: Vec3;
  /** root yaw change from the move's start (degrees) */
  yaw?: number;
}

export interface Sample {
  pose: Pose;
  at: Vec3;
  yaw: number;
}

/**
 * Pose keys in seconds (mascot.Track): each segment eases with its end key's
 * curve, and the hands and blade travel on Catmull-Rom arcs through the keys.
 */
export class PoseTrack {
  readonly keys: Key[];

  constructor(keys: Key[]) {
    this.keys = [...keys].sort((a, b) => a.t - b.t);
  }

  get duration() {
    return this.keys[this.keys.length - 1].t;
  }

  at(t: number): Sample {
    const ks = this.keys;
    const first = ks[0];
    const last = ks[ks.length - 1];
    if (t <= first.t) return { pose: first.pose, at: first.at ?? ZERO, yaw: first.yaw ?? 0 };
    if (t >= last.t) return { pose: last.pose, at: last.at ?? ZERO, yaw: last.yaw ?? 0 };
    for (let i = 0; i < ks.length - 1; i++) {
      const k0 = ks[i];
      const k1 = ks[i + 1];
      if (t < k0.t || t >= k1.t) continue;
      const u = EASES[k1.ease]((t - k0.t) / (k1.t - k0.t));
      const out = blend(k0.pose, k1.pose, u);
      if (k1.ease !== "hold") {
        const pm = i > 0 ? ks[i - 1].pose : k0.pose;
        const pn = i + 2 < ks.length ? ks[i + 2].pose : k1.pose;
        out.hand_r = catmull(pm.hand_r, k0.pose.hand_r, k1.pose.hand_r, pn.hand_r, u);
        out.hand_l = catmull(pm.hand_l, k0.pose.hand_l, k1.pose.hand_l, pn.hand_l, u);
        out.blade = catmull(pm.blade, k0.pose.blade, k1.pose.blade, pn.blade, u);
      }
      return { pose: out, at: vmix(k0.at ?? ZERO, k1.at ?? ZERO, u), yaw: mix(k0.yaw ?? 0, k1.yaw ?? 0, u) };
    }
    return { pose: last.pose, at: last.at ?? ZERO, yaw: last.yaw ?? 0 };
  }
}

const ZERO: Vec3 = [0, 0, 0];
