/**
 * The minds on the other side. Shadows circle and take turns (only a couple
 * may strike at once, so a crowd reads as a crowd, not a blender); the brute
 * lumbers in and throws the ground wave; KAGE closes in, strikes in pairs,
 * throws the wave from range and guards (sometimes parries) when SORA swings.
 * Reactions lag like a person's; everyone presses harder as they lose.
 */
import * as THREE from "three/webgpu";

import type { Actor } from "./actor";

export interface Orders {
  attack?: boolean;
  slam?: boolean;
  dash?: THREE.Vector3;
}

const V = new THREE.Vector3();

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Shared among a wave: how many may be winding up a blow at once. */
export class Tokens {
  private held = new Set<number>();
  constructor(private readonly max: number) {}

  take(id: number) {
    if (this.held.has(id)) return true;
    if (this.held.size >= this.max) return false;
    this.held.add(id);
    return true;
  }

  give(id: number) {
    this.held.delete(id);
  }

  clear() {
    this.held.clear();
  }
}

export interface Brain {
  update(dt: number, time: number, me: Actor, foe: Actor, tokens: Tokens): Orders;
}

/** Common footwork: close to `near`, back off inside `tooClose`, circle in between. */
function footwork(me: Actor, foe: Actor, near: number, tooClose: number, strafe: number, circle: number) {
  const to = V.subVectors(foe.pos, me.pos).setZ(0);
  const dist = to.length();
  to.divideScalar(Math.max(dist, 1e-3));
  const side = new THREE.Vector2(-to.y, to.x).multiplyScalar(strafe);
  if (dist > near) me.wish.set(to.x, to.y).multiplyScalar(dist > near + 3 ? 1 : 0.75).add(side.multiplyScalar(0.25));
  else if (dist < tooClose) me.wish.set(-to.x * 0.7, -to.y * 0.7);
  else me.wish.copy(side.multiplyScalar(circle));
  if (me.wish.length() > 1) me.wish.normalize();
  return dist;
}

export class ShadeBrain implements Brain {
  private think: number;
  private strafe: number;
  private strafeUntil = 0;
  /** stepping back to let another have a turn */
  private rest: number;
  private swings = 0;
  private readonly r: () => number;

  constructor(seed: number) {
    this.r = rng(seed);
    this.think = 0.5 + this.r() * 0.8;
    this.rest = this.r() * 1.5;
    this.strafe = this.r() < 0.5 ? -1 : 1;
  }

  update(dt: number, time: number, me: Actor, foe: Actor, tokens: Tokens): Orders {
    me.wish.set(0, 0);
    if (me.down || me.juggled || !foe.alive || foe.down) {
      tokens.give(me.id);
      return {};
    }
    // keep the turn through the swing
    if (me.busy) return {};
    if (time > this.strafeUntil) {
      this.strafe = this.r() < 0.5 ? -1 : 1;
      this.strafeUntil = time + 0.8 + this.r() * 1.6;
    }
    this.rest -= dt;
    if (this.rest > 0) tokens.give(me.id);
    const turn = this.rest <= 0 && tokens.take(me.id);
    // shadows without a turn hang back at the edge of reach
    const dist = footwork(me, foe, turn ? 2.1 : 3.9, 1.4, this.strafe, 0.45);
    this.think -= dt;
    if (!turn || this.think > 0 || dist > 2.6) return {};
    this.think = 0.35 + this.r() * 0.5;
    if (++this.swings >= (this.r() < 0.4 ? 2 : 1)) {
      this.swings = 0;
      this.rest = 1.4 + this.r() * 1.6;
    }
    return { attack: true };
  }
}

export class BruteBrain implements Brain {
  private think = 1.2;
  private readonly r: () => number;

  constructor(seed: number) {
    this.r = rng(seed);
  }

  update(dt: number, _time: number, me: Actor, foe: Actor): Orders {
    me.wish.set(0, 0);
    if (me.busy || me.down || me.juggled || !foe.alive || foe.down) return {};
    const dist = footwork(me, foe, 3.4, 2.0, 1, 0.2);
    this.think -= dt;
    if (this.think > 0 || dist > 4.6) return {};
    this.think = 2.4 + this.r() * 1.5;
    return { slam: true };
  }
}

export class BossBrain implements Brain {
  private think = 0.8;
  private strafe = 1;
  private strafeUntil = 0;
  private guardUntil = 0;
  private slamReady = 3;
  private reactAt = -1;
  private readonly r: () => number;

  constructor(seed = 7) {
    this.r = rng(seed);
  }

  update(dt: number, time: number, me: Actor, foe: Actor): Orders {
    const out: Orders = {};
    me.wish.set(0, 0);
    if (me.down || !foe.alive || foe.down || me.juggled) {
      me.guardHeld = false;
      return out;
    }
    const to = V.subVectors(foe.pos, me.pos).setZ(0);
    const dist = to.length();
    to.divideScalar(Math.max(dist, 1e-3));
    const rage = 1 + (1 - me.hp / me.maxHp) * 0.9;

    // see the swing coming: guard after a human reaction time
    if (foe.attacking && dist < 3.6 && this.reactAt < 0 && !me.busy) {
      this.reactAt = time + 0.12 + this.r() * 0.18;
      if (this.r() < 0.35) this.guardUntil = this.reactAt + 0.45;
    }
    if (!foe.attacking) this.reactAt = -1;
    const guarding = time >= this.reactAt && time < this.guardUntil && !me.busy;
    if (guarding && !me.guardHeld) me.guardSince = time;
    me.guardHeld = guarding;
    if (me.guardHeld) {
      me.wish.set(-to.x * 0.3, -to.y * 0.3);
      return out;
    }
    if (me.busy) return out;

    this.slamReady -= dt;
    this.think -= dt * rage;
    if (time > this.strafeUntil) {
      this.strafe = this.r() < 0.5 ? -1 : 1;
      this.strafeUntil = time + 0.8 + this.r() * 1.4;
    }
    footwork(me, foe, 3.0, 1.7, this.strafe, 0.55);
    if (this.think > 0) return out;
    const r = this.r();
    if (dist > 7 && r < 0.6) {
      out.dash = to.clone();
      this.think = 0.6;
    } else if (dist > 2.6 && dist < 4.3 && this.slamReady <= 0 && r < 0.4) {
      out.slam = true;
      this.slamReady = 4.5 + this.r() * 3;
      this.think = 1.4;
    } else if (dist < 3.3) {
      out.attack = true;
      // a second strike follows often
      this.think = this.r() < 0.6 * rage ? 0.35 : 0.9 + this.r() * 0.7;
    } else {
      this.think = 0.3;
    }
    return out;
  }
}
