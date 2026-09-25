/**
 * The stage camera: a 2.5D side view that runs along the road with SORA,
 * looking a little ahead of where she faces, held inside an arena while it is
 * sealed, pulled back to frame a duel, with a kick of shake on every blow.
 */
import * as THREE from "three/webgpu";

/** vertical half-FOV tangent (about 36 degrees) */
export const FIGHT_TAN_V = 0.33;

export interface Shot {
  /** what to keep in frame (world x), and how wide (m) */
  focusX: number;
  focusY: number;
  width: number;
  /** keep the frame's centre between these x (a sealed arena), if set */
  clamp?: [number, number] | null;
}

export class StageCamera {
  readonly position = new THREE.Vector3();
  readonly target = new THREE.Vector3();
  private readonly wantPos = new THREE.Vector3();
  private readonly wantTarget = new THREE.Vector3();
  private shakeAmp = 0;
  private shakeT = 0;
  private placed = false;
  private width = 13;

  private frame(shot: Shot, aspect: number) {
    this.width = THREE.MathUtils.damp(this.width, shot.width, 3, 1 / 60);
    // the width we must see, and on a tall screen, enough height too
    const tanH = FIGHT_TAN_V * aspect;
    const dist = THREE.MathUtils.clamp(Math.max(this.width / 2 / tanH, 6.5 / FIGHT_TAN_V / 2), 8, 26);
    let x = shot.focusX;
    if (shot.clamp) {
      const half = Math.max(0, (shot.clamp[1] - shot.clamp[0]) / 2 - this.width / 2);
      const mid = (shot.clamp[0] + shot.clamp[1]) / 2;
      x = THREE.MathUtils.clamp(x, mid - half, mid + half);
    }
    const y = shot.focusY * 0.5;
    // from the near side of the road, raised, tipped down onto the fighters
    this.wantTarget.set(x, y + 0.6, 0.85);
    this.wantPos.set(x, y - dist * 0.94, 1.4 + dist * 0.34);
  }

  update(dt: number, shot: Shot, aspect: number) {
    this.frame(shot, aspect);
    if (!this.placed) this.snap();
    else {
      this.position.lerp(this.wantPos, 1 - Math.exp(-dt * 4.5));
      this.target.lerp(this.wantTarget, 1 - Math.exp(-dt * 6));
    }
    this.shakeT += dt;
    this.shakeAmp *= Math.exp(-dt * 9);
    if (this.shakeAmp > 1e-3) {
      const s = this.shakeAmp;
      this.target.x += Math.sin(this.shakeT * 83) * s;
      this.target.y += Math.cos(this.shakeT * 71) * s;
      this.target.z += Math.sin(this.shakeT * 97 + 1) * s;
    }
  }

  /** Jump straight to the wanted framing. */
  snap() {
    this.position.copy(this.wantPos);
    this.target.copy(this.wantTarget);
    this.placed = true;
  }

  shake(amount: number) {
    this.shakeAmp = Math.max(this.shakeAmp, amount);
  }

  reset(width = 13) {
    this.placed = false;
    this.shakeAmp = 0;
    this.width = width;
  }
}
