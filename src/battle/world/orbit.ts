/**
 * The explorer's camera: over SORA's shoulder, turned by the player's thumb,
 * drifting back behind her as she runs, pulled out to frame a fight, and
 * never sinking into the hillside.
 */
import * as THREE from "three/webgpu";

import type { Actor } from "../game/actor";

const DEG = Math.PI / 180;

export class OrbitCamera {
  readonly position = new THREE.Vector3();
  readonly target = new THREE.Vector3();
  /** around the vertical (radians; the camera looks along +x at 0) */
  yaw = 0;
  /** above the horizon (radians) */
  pitch = 16 * DEG;
  private dist = 7.5;
  private lastLook = -10;
  private shakeAmp = 0;
  private shakeT = 0;
  private readonly focus = new THREE.Vector3();
  private placed = false;

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

  update(dt: number, now: number, hero: Actor, foe: Actor | null, ground: (x: number, y: number) => number) {
    // the point we look at: SORA, or between her and whoever she is fighting
    const want = new THREE.Vector3(hero.pos.x, hero.pos.y, hero.pos.z + 1.35);
    let wantDist = 7.5;
    if (foe && !foe.dead) {
      const mid = new THREE.Vector3().lerpVectors(hero.pos, foe.pos, 0.35);
      want.set(mid.x, mid.y, want.z);
      wantDist = THREE.MathUtils.clamp(6.5 + hero.pos.distanceTo(foe.pos) * 0.5, 7.5, 12) * (0.8 + 0.2 * foe.scale);
    }
    if (!this.placed) {
      this.focus.copy(want);
      this.placed = true;
    }
    this.focus.lerp(want, 1 - Math.exp(-dt * 8));
    this.dist = THREE.MathUtils.damp(this.dist, wantDist, 3, dt);

    // left alone, the camera swings round behind her as she runs
    const moving = hero.wish.lengthSq() > 0.05;
    if (now - this.lastLook > 1.6 && moving && !foe) {
      const behind = Math.atan2(hero.wish.y, hero.wish.x);
      let d = behind - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * (1 - Math.exp(-dt * 1.2)) * Math.min(1, hero.wish.length());
    }

    const cp = Math.cos(this.pitch);
    this.position.set(
      this.focus.x - Math.cos(this.yaw) * cp * this.dist,
      this.focus.y - Math.sin(this.yaw) * cp * this.dist,
      this.focus.z + Math.sin(this.pitch) * this.dist,
    );
    // keep clear of the ground
    const floor = ground(this.position.x, this.position.y) + 0.8;
    if (this.position.z < floor) this.position.z = floor;
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

  shake(amount: number) {
    this.shakeAmp = Math.max(this.shakeAmp, amount);
  }

  /** Behind SORA, facing where she faces. */
  reset(hero: Actor) {
    this.yaw = Math.atan2(hero.forward.y, hero.forward.x);
    this.pitch = 16 * DEG;
    this.placed = false;
  }
}
