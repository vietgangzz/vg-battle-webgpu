/**
 * The explorer's camera: over SORA's shoulder, turned by the player's thumb,
 * drifting back behind her as she runs, pulled out to frame a fight, and
 * never sinking into the hillside.
 */
import * as THREE from "three/webgpu";

import type { Actor } from "../game/actor";

const DEG = Math.PI / 180;
const SWING = new THREE.Vector3();

/** raised (see OrbitCamera.high), the lens looks down on her at least this steeply */
const HIGH_PITCH = 33 * DEG;
/** in a fight the lens stands back and looks down on the field at least this steeply: the whole scrap in view, not her back */
const FIGHT_PITCH = 25 * DEG;
/** how far off to the side her foe may be before the fight lens comes round toward him */
const FIGHT_SLACK = 18 * DEG;

export class OrbitCamera {
  readonly position = new THREE.Vector3();
  readonly target = new THREE.Vector3();
  /** around the vertical (radians; the camera looks along +x at 0) */
  yaw = 0;
  /** above the horizon (radians) */
  pitch = 16 * DEG;
  private dist = 8.6;
  /** 0..1: how hard SORA is sprinting (the camera eases back and follows closer behind) */
  sprint = 0;
  /** how far the view is clear of walls behind her (0..1 of dist), eased back out */
  private clear = 1;
  private lastLook = -10;
  private shakeAmp = 0;
  private shakeT = 0;
  private readonly focus = new THREE.Vector3();
  private placed = false;
  /** the floor under the lens, eased (see update) */
  private floorZ = -Infinity;
  /** 0..1: how far the lens is raised to look down on her (on the bridge: from its own height the railings hid her) */
  high = 0;
  private highNow = 0;
  /** 0..1: how far into its fight framing the lens is (eased in and out) */
  private fightNow = 0;

  /** A drag of the thumb: dx, dy in points. */
  look(dx: number, dy: number, now: number) {
    this.yaw -= dx * 0.0085;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.006, -8 * DEG, 62 * DEG);
    this.lastLook = now;
  }

  /** Where "forward" is for the stick (the camera's heading on the ground). */
  heading() {
    return this.yaw;
  }

  update(
    dt: number,
    now: number,
    hero: Actor,
    foe: Actor | null,
    ground: (x: number, y: number) => number,
    clearance?: (from: THREE.Vector3, to: THREE.Vector3) => number,
  ) {
    // the point we look at: SORA, or between her and whoever she is fighting
    const want = new THREE.Vector3(hero.pos.x, hero.pos.y, hero.pos.z + 1.35);
    let wantDist = 8.6 + 1.6 * this.sprint;
    const fighting = !!foe && !foe.dead;
    if (fighting) {
      const mid = new THREE.Vector3().lerpVectors(hero.pos, foe.pos, 0.35);
      want.set(mid.x, mid.y, want.z);
      // stood well back: her, the foes round her and the reach of her skills all in the picture (a big foe, further)
      wantDist = THREE.MathUtils.clamp(9.5 + hero.pos.distanceTo(foe.pos) * 0.5, 10.5, 15) * (0.85 + 0.15 * foe.scale);
    }
    this.fightNow = THREE.MathUtils.damp(this.fightNow, fighting ? 1 : 0, 1.6, dt);
    if (!this.placed) {
      this.focus.copy(want);
      this.placed = true;
    }
    this.focus.lerp(want, 1 - Math.exp(-dt * 8));
    // in a fight, left alone, the lens comes round behind her toward her foe, as a player keeps it: slowly,
    // and only for the part he has drifted more than a little off to the side (a dodge or a step round
    // him does not swing the picture); right on top of her, his bearing means nothing and is left
    if (fighting && now - this.lastLook > 1.2) {
      const dx = foe!.pos.x - hero.pos.x;
      const dy = foe!.pos.y - hero.pos.y;
      let d = Math.atan2(dy, dx) - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const over = Math.sign(d) * Math.max(0, Math.abs(d) - FIGHT_SLACK);
      const sure = THREE.MathUtils.clamp((Math.hypot(dx, dy) - 1.2) / 2, 0, 1);
      const to = this.yaw + over * (1 - Math.exp(-dt * 2)) * sure;
      // (never round behind a trunk or a wall: a turn that would put one between her and the lens is not made)
      if (!clearance || clearance(this.focus, this.placeAt(to, this.pitch, THREE.MathUtils.lerp(this.dist, wantDist, 0.5), SWING)) >= Math.min(0.95, this.clear)) this.yaw = to;
    }
    this.dist = THREE.MathUtils.damp(this.dist, wantDist, 3, dt);

    // left alone, the camera swings round behind her as she runs
    const moving = hero.wish.lengthSq() > 0.05;
    if (now - this.lastLook > (this.sprint > 0.5 ? 0.8 : 1.6) && moving && !foe) {
      const behind = Math.atan2(hero.wish.y, hero.wish.x);
      let d = behind - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * (1 - Math.exp(-dt * 1.2)) * Math.min(1, hero.wish.length());
    }

    this.highNow = THREE.MathUtils.damp(this.highNow, this.high, 2.2, dt);
    const lift = Math.max(this.highNow * Math.max(0, HIGH_PITCH - this.pitch), this.fightNow * Math.max(0, FIGHT_PITCH - this.pitch));
    const pitch = this.pitch + lift;
    const cp = Math.cos(pitch);
    this.position.set(
      this.focus.x - Math.cos(this.yaw) * cp * this.dist,
      this.focus.y - Math.sin(this.yaw) * cp * this.dist,
      this.focus.z + Math.sin(pitch) * this.dist,
    );
    // a wall between her and the lens: come in front of it (quickly), and ease back out once past
    if (clearance) {
      const t = clearance(this.focus, this.position);
      const want = Math.max(0.28, t);
      this.clear = want < this.clear ? THREE.MathUtils.damp(this.clear, want, 18, dt) : THREE.MathUtils.damp(this.clear, want, 2.5, dt);
      this.position.lerpVectors(this.focus, this.position, this.clear);
    }
    // keep clear of the ground: the floor under the lens follows the ground smoothly (up quickly, down
    // slowly), else swinging round over a riverbank, steps or a slope the picture jumped with every
    // change of height beneath it; it only stops hard just above the ground itself
    const g = ground(this.position.x, this.position.y);
    const floor = g + 0.8;
    if (!Number.isFinite(this.floorZ)) this.floorZ = floor;
    this.floorZ = THREE.MathUtils.damp(this.floorZ, floor, floor > this.floorZ ? 10 : 2.5, dt);
    this.position.z = Math.max(this.position.z, this.floorZ, g + 0.3);
    this.target.copy(this.focus);

    this.shakeT += dt;
    this.shakeAmp *= Math.exp(-dt * 9);
    if (this.shakeAmp > 1e-3) {
      const s = this.shakeAmp;
      this.target.x += Math.sin(this.shakeT * 83) * s;
      this.target.y += Math.cos(this.shakeT * 71) * s;
      this.target.z += Math.sin(this.shakeT * 97 + 1) * s;
    }
  }

  /** Where the lens would stand at `yaw`, `pitch`, `dist` from the focus (into `out`). */
  private placeAt(yaw: number, pitch: number, dist: number, out: THREE.Vector3) {
    const cp = Math.cos(pitch);
    return out.set(this.focus.x - Math.cos(yaw) * cp * dist, this.focus.y - Math.sin(yaw) * cp * dist, this.focus.z + Math.sin(pitch) * dist);
  }

  shake(amount: number) {
    this.shakeAmp = Math.max(this.shakeAmp, amount);
  }

  /** Behind SORA, facing where she faces. */
  reset(hero: Actor) {
    this.yaw = Math.atan2(hero.forward.y, hero.forward.x);
    this.pitch = 16 * DEG;
    this.placed = false;
    this.floorZ = -Infinity;
  }
}
