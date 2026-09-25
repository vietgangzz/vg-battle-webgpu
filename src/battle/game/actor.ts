/**
 * Anyone on the field: SORA, KAGE, and KAGE's shadow clones. Where they stand
 * (and how high they are in a jump), what they are doing, and the pose that
 * results. Moves play keyed pose tracks (moves.ts); between moves the stance
 * is procedural: breathing when still, a hopping run when moving, leaning into
 * the direction of travel, arcing through the air in a jump.
 */
import * as THREE from "three/webgpu";

import type { FilmScene } from "../runtime/scene";
import { DASH, DOWN, GETUP, type MoveDef } from "./moves";
import * as P from "./pose";
import { type Pose, PoseTrack } from "./pose";
import { FighterRig, type Who } from "./rig";
import { Tails } from "./tails";

export type Kind = "hero" | "boss" | "shade" | "brute";

interface Spec {
  who: Who;
  clone: boolean;
  scale: number;
  hp: number;
  speed: number;
  /** body radius at scale 1 (m), for crowding and hits */
  radius: number;
  /** shrugs off flinches (only heavy blows move it) */
  heavy: boolean;
}

export const SPECS: Record<Kind, Spec> = {
  hero: { who: "sora", clone: false, scale: 1, hp: 120, speed: 3.8, radius: 0.55, heavy: false },
  boss: { who: "kage", clone: false, scale: 1, hp: 280, speed: 3.4, radius: 0.55, heavy: false },
  shade: { who: "kage", clone: true, scale: 0.72, hp: 30, speed: 2.7, radius: 0.55, heavy: false },
  brute: { who: "kage", clone: true, scale: 1.25, hp: 90, speed: 2.0, radius: 0.55, heavy: true },
};

const DEG = Math.PI / 180;
const GRAVITY = 24;
const JUMP_SPEED = 9.2;
const GUARD_SLOW = 0.4;
/** the gap a lunge closes to before the blow lands, at scale 1 */
const STRIKE_GAP = 2.05;
const GHOSTS = 3;
/** seconds between afterimages (the film's 3 frames) */
const GHOST_LAG = 3 / 24;

const V = new THREE.Vector3();
const V2 = new THREE.Vector3();

export const forwardOf = (yaw: number, out = new THREE.Vector3()) => out.set(Math.sin(yaw * DEG), -Math.cos(yaw * DEG), 0);
/** Yaw (degrees) that faces along `dir` (xy). */
export const yawOf = (dir: THREE.Vector3 | THREE.Vector2) => Math.atan2(dir.x, -dir.y) / DEG;
export const wrapDeg = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;

export interface Action {
  def: MoveDef;
  track: PoseTrack;
  t: number;
  startPos: THREE.Vector3;
  startYaw: number;
  /** extra travel toward the opponent, eased in until the impact */
  lunge: THREE.Vector3;
  /** hits already resolved (by index) */
  done: Set<number>;
  /** fighters already struck by this move (a sweep strikes each once) */
  struck: Set<Actor>;
}

let ids = 0;

export class Actor {
  readonly id = ids++;
  readonly spec: Spec;
  readonly rig: FighterRig;
  readonly tails: Tails | null;
  /** ground position; z is the height of a jump */
  readonly pos = new THREE.Vector3();
  vz = 0;
  yaw = 0;
  scale: number;
  hp: number;
  maxHp: number;
  pose: Pose = P.IDLE;
  action: Action | null = null;
  /** world-space wish direction and strength (0..1), from the stick or the AI */
  readonly wish = new THREE.Vector2();
  guardHeld = false;
  guardSince = -1;
  /** combo position and when the chain window closes */
  comboStep = 0;
  comboUntil = 0;
  /** out of the fight (knocked out, or broken and waiting for the finisher) */
  down = false;
  /** thrown into the air by a launch: no control until it lands */
  juggled = false;
  /** a shadow dissolving after its defeat (seconds since), then gone */
  vanish = -1;
  dead = false;
  /** who this one is fighting */
  target: Actor | null = null;
  ghostOn = 0;
  private run = 0;
  private runPhase = 0;
  private stanceT = 0;
  private readonly lean = new THREE.Vector2();
  private readonly history: { m: THREE.Matrix4; t: number }[] = [];
  private readonly ghosts: { obj: THREE.Mesh; i: { value: number } }[] = [];

  constructor(
    fs: FilmScene,
    readonly kind: Kind,
  ) {
    this.spec = SPECS[kind];
    this.scale = this.spec.scale;
    this.hp = this.maxHp = this.spec.hp;
    this.rig = new FighterRig(fs, this.spec.who, this.spec.clone);
    this.tails = this.spec.clone ? null : new Tails(fs, this.spec.who);
    if (!this.spec.clone) {
      const who = this.spec.who;
      for (let k = 1; k <= GHOSTS; k++) {
        this.ghosts.push({ obj: fs.object(`${who}_ghost${k}`), i: fs.drive(`${who}_ghost${k}_mat.I`) });
      }
    }
  }

  /** Film objects this actor poses itself (the clones own theirs outright). */
  get objects() {
    return [...this.rig.names, ...(this.tails?.names ?? []), ...this.ghosts.map((g) => g.obj.name)];
  }

  get radius() {
    return this.spec.radius * this.scale;
  }

  get forward() {
    return forwardOf(this.yaw);
  }

  get busy() {
    return !!this.action;
  }

  get airborne() {
    return this.pos.z > 0.001 || this.vz > 0;
  }

  get alive() {
    return !this.dead && this.vanish < 0 && this.hp > 0;
  }

  /** Winding up a blow (what a guard reacts to). */
  get attacking() {
    const a = this.action;
    return !!a && !!a.def.impact && !!a.def.hits && a.t < a.def.impact;
  }

  get invulnerable() {
    const a = this.action;
    const w = a?.def.invuln;
    return !!w && a!.t >= w[0] && a!.t < w[1];
  }

  /** The move currently playing, by name. */
  doing(name: string) {
    return this.action?.def.name === name;
  }

  place(pos: THREE.Vector3, yaw: number) {
    this.pos.copy(pos).setZ(0);
    this.vz = 0;
    this.yaw = yaw;
    this.action = null;
    this.pose = P.IDLE;
    this.hp = this.maxHp;
    this.down = this.juggled = this.dead = false;
    this.vanish = -1;
    this.scale = this.spec.scale;
    this.comboStep = 0;
    this.history.length = 0;
    this.ghostOn = 0;
    this.rig.apply(this);
    this.rig.setVisible(true);
    if (this.tails) {
      this.tails.reset(this.rig.body.matrix);
      this.tails.write();
    }
  }

  /** Take it off the field. */
  remove() {
    this.dead = true;
    this.rig.setVisible(false);
    for (const g of this.ghosts) g.obj.visible = false;
  }

  /**
   * Start a move. The target is faced and, for a lunge, closed on so the blow
   * lands at striking distance. `dir` points a dash.
   */
  play(def: MoveDef, target: Actor | null, dir?: THREE.Vector3 | THREE.Vector2) {
    if (dir && (dir.x || dir.y)) this.yaw = yawOf(dir);
    else if (target) this.yaw = yawOf(V.subVectors(target.pos, this.pos));
    const track = new PoseTrack([{ t: 0, pose: this.pose, ease: "snap" }, ...def.keys]);
    const act: Action = {
      def,
      track,
      t: 0,
      startPos: this.pos.clone(),
      startYaw: this.yaw,
      lunge: new THREE.Vector3(),
      done: new Set(),
      struck: new Set(),
    };
    if (def.lunge && target && def.impact) {
      const to = V.subVectors(target.pos, this.pos).setZ(0);
      const dist = to.length();
      // how far the move itself travels forward by the impact
      const own = -track.at(def.impact).at[1] * this.scale;
      const gap = THREE.MathUtils.clamp(dist - (STRIKE_GAP * (this.scale + target.scale)) / 2 - own, -0.6, 1.8);
      if (dist < 5.5) act.lunge.copy(to).normalize().multiplyScalar(gap);
    }
    this.action = act;
    this.stanceT = 0;
    return act;
  }

  dash(dir: THREE.Vector3 | THREE.Vector2) {
    return this.play(DASH, null, dir);
  }

  jump() {
    if (this.airborne || this.busy || this.down) return false;
    this.vz = JUMP_SPEED;
    return true;
  }

  /** Thrown up by a launch: helpless until it lands. */
  launch(speed: number, from: Actor) {
    this.action = null;
    this.juggled = true;
    this.vz = Math.max(this.vz, speed);
    this.yaw = yawOf(V.subVectors(from.pos, this.pos));
    this.pose = P.STRUCK;
  }

  /** Down for good (or broken, for KAGE): kneel, and for a shadow, dissolve. */
  defeat(from: Actor | null) {
    this.down = true;
    this.guardHeld = false;
    if (!this.juggled) this.play(DOWN, from);
    if (this.spec.clone) this.vanish = 0;
  }

  /** Advance by dt (seconds of fight time; 0 during a hit-stop). */
  update(dt: number, time: number) {
    const a = this.action;
    const scripted = !!a && !a.def.air && !this.juggled;
    if (a) {
      a.t += dt;
      const s = a.track.at(a.t);
      this.pose = s.pose;
      const c = Math.cos(a.startYaw * DEG) * this.scale;
      const sn = Math.sin(a.startYaw * DEG) * this.scale;
      const lungeK = a.def.impact ? P.EASES.smooth(a.t / a.def.impact) : 0;
      this.pos.x = a.startPos.x + c * s.at[0] - sn * s.at[1] + a.lunge.x * lungeK;
      this.pos.y = a.startPos.y + sn * s.at[0] + c * s.at[1] + a.lunge.y * lungeK;
      if (scripted) {
        this.pos.z = s.at[2] * this.scale;
        this.vz = 0;
      }
      this.yaw = a.startYaw + s.yaw;
      if (a.def.air && a.def.impact !== undefined && a.t - dt < a.def.impact && a.t >= a.def.impact) this.vz = -a.def.air.plunge;
      const g = a.def.ghosts;
      this.ghostOn = g && a.t >= g[0] && a.t < g[1] ? 1 : Math.max(0, this.ghostOn - dt * 6);
      if (a.t >= a.track.duration) {
        this.action = null;
        this.stanceT = 0;
      }
    } else if (!this.down) {
      this.stance(dt);
      this.ghostOn = Math.max(0, this.ghostOn - dt * 6);
    }
    if (!scripted) this.fall(dt);
    if (this.vanish >= 0 && dt > 0) {
      this.vanish += dt;
      // sink and shrink into the ground once the knee has touched down
      const k = THREE.MathUtils.clamp((this.vanish - 0.9) / 0.4, 0, 1);
      this.scale = this.spec.scale * (1 - k * k);
      if (k >= 1) this.remove();
    }
    if (this.dead) return;
    this.rig.apply(this);
    this.recordGhost(time);
    if (this.tails) {
      this.tails.step(this.rig.body.matrix, dt, time);
      this.tails.write();
    }
  }

  /** Gravity: jumps, launches, the air cut's plunge. */
  private fall(dt: number) {
    if (!this.airborne) return;
    this.vz -= GRAVITY * dt;
    this.pos.z += this.vz * dt;
    if (this.juggled) this.pose = P.blend(P.STRUCK, P.pose(P.STRUCK, { lean: -40, squash: 1.2 }), THREE.MathUtils.clamp(-this.vz / 8, 0, 1));
    if (this.pos.z > 0) return;
    // landed
    this.pos.z = 0;
    this.vz = 0;
    if (this.juggled) {
      this.juggled = false;
      if (this.down) {
        if (this.spec.clone) this.vanish = Math.max(this.vanish, 0.6);
        this.pose = P.KNEEL;
      } else this.play(GETUP, null);
    } else if (!this.action) {
      // a landing squash, eased back out by the stance
      this.pose = P.pose(P.LAND, { twist: 0, blade: this.pose.blade, edge: this.pose.edge });
      this.stanceT = 0;
    }
  }

  /** Between moves: face the target, run with the stick, breathe; arc through a jump. */
  private stance(dt: number) {
    this.stanceT += dt;
    const target = this.target?.alive ? this.target : null;
    const speed = this.spec.speed * (this.guardHeld ? GUARD_SLOW : 1) * (this.airborne ? 0.85 : 1);
    const mag = Math.min(this.wish.length(), 1);
    this.pos.x += this.wish.x * speed * dt;
    this.pos.y += this.wish.y * speed * dt;

    // face the target when it is near, else where we are going
    let want = this.yaw;
    if (target && this.pos.distanceTo(target.pos) < 9) want = yawOf(V.subVectors(target.pos, this.pos));
    else if (mag > 0.2) want = yawOf(this.wish);
    const diff = wrapDeg(want - this.yaw);
    this.yaw += THREE.MathUtils.clamp(diff, -720 * dt, 720 * dt);

    this.run = THREE.MathUtils.damp(this.run, this.airborne ? 0 : mag, 12, dt);
    this.runPhase += dt * (5.5 + 3 * mag);
    // travel in the fighter's own frame: forward and sideways
    const f = forwardOf(this.yaw, V2);
    const fw = this.wish.x * f.x + this.wish.y * f.y;
    const side = this.wish.x * -f.y + this.wish.y * f.x;
    this.lean.x = THREE.MathUtils.damp(this.lean.x, fw, 10, dt);
    this.lean.y = THREE.MathUtils.damp(this.lean.y, side, 10, dt);

    const close = target ? THREE.MathUtils.clamp((7 - this.pos.distanceTo(target.pos)) / 3, 0, 1) : 0.3;
    const breathe = 0.5 + 0.5 * Math.sin((this.stanceT * 2 * Math.PI) / 1.3);
    let base = P.blend(P.blend(P.IDLE, P.BREATHE, breathe), P.READY, close);
    if (this.run > 0.01) {
      const hop = Math.abs(Math.sin(this.runPhase));
      const runPose = P.pose(P.blend(P.READY, P.DASH, 0.35), { hop: 0.16 * hop, squash: 0.86 + 0.16 * hop });
      base = P.blend(base, runPose, this.run);
    }
    if (this.airborne) {
      // rising: stretched and reaching; falling: tucked, blade ready
      const k = THREE.MathUtils.clamp(0.5 - this.vz / 14, 0, 1);
      base = P.blend(P.pose(P.LEAP, { squash: 1.22 }), P.pose(P.AIR_DN_W, { hop: 0 }), k);
    }
    if (this.guardHeld) base = P.blend(base, P.GUARD, 0.9);
    base.lean += 16 * this.lean.x * this.run;
    base.roll += -12 * this.lean.y * this.run;
    // ease out of the last move's final pose
    const k = Math.min(this.stanceT / 0.18, 1);
    this.pose = k < 1 ? P.blend(this.pose, base, 1 - Math.pow(1 - k, 2) * 0.85) : base;
  }

  private recordGhost(time: number) {
    if (!this.ghosts.length) return;
    const h = this.history;
    const last = h[h.length - 1];
    if (!last || time - last.t >= 1 / 60) {
      const m = h.length > 40 ? h.shift()!.m : new THREE.Matrix4();
      h.push({ m: m.copy(this.rig.body.matrix), t: time });
    }
    for (let k = 0; k < this.ghosts.length; k++) {
      const g = this.ghosts[k];
      const intensity = this.ghostOn * (1 - k / GHOSTS) * 0.9;
      g.i.value = intensity;
      g.obj.visible = intensity > 0.01;
      if (!g.obj.visible) continue;
      const want = time - (k + 1) * GHOST_LAG;
      let src = h[0];
      for (const e of h) if (e.t <= want) src = e;
      g.obj.matrix.copy(src.m);
    }
  }
}
