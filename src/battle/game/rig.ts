/**
 * Poses one Little Giant's parts from a pose, the way the film's rig does
 * (mascot.apply): root (position, yaw, size) -> body pivot (hop, lean/roll/
 * twist, squash) -> body, eyes, band; the hands hang off the root, the blade off
 * the right hand. The parts' rest relations are read back from the film's first
 * frame, so every fighter is the film's own meshes, exactly as built.
 *
 * The two heroes of the film pose its own objects; the shadow clones are new
 * meshes sharing the film's geometry and materials.
 */
import * as THREE from "three/webgpu";

import type { FilmScene } from "../runtime/scene";
import { IDLE, type Pose, type Vec3 } from "./pose";

export type Who = "sora" | "kage";

/** Where each fighter stands in the film's first frame (choreo.py). */
const FILM_START: Record<Who, { pos: Vec3; yaw: number }> = {
  sora: { pos: [0, -7, 0], yaw: 180 },
  kage: { pos: [0, 7, 0], yaw: 0 },
};

/** Blade lengths (m) and where the blade's base sits (battle/lib/track.py). */
const BLADE = { sora: 1.05, kage: 1.25, base: 0.09 };

const DEG = Math.PI / 180;
const V = new THREE.Vector3();
const V2 = new THREE.Vector3();
const Q = new THREE.Quaternion();
const E = new THREE.Euler(0, 0, 0, "ZYX");
const M = new THREE.Matrix4();
const M2 = new THREE.Matrix4();
const X = new THREE.Vector3();
const Y = new THREE.Vector3();
const Z = new THREE.Vector3();

/** Blade object is built along its local -Y; its edge faces local +Z (mascot._blade_quat). */
function bladeQuat(blade: Vec3, edge: Vec3, out: THREE.Quaternion) {
  const b = V.set(blade[0], blade[1], blade[2]).normalize();
  const e = Z.set(edge[0], edge[1], edge[2]);
  e.addScaledVector(b, -e.dot(b));
  if (e.lengthSq() < 1e-8) {
    // any perpendicular
    e.set(Math.abs(b.x) < 0.9 ? 1 : 0, Math.abs(b.x) < 0.9 ? 0 : 1, 0);
    e.addScaledVector(b, -e.dot(b));
  }
  e.normalize();
  Y.copy(b).negate();
  X.crossVectors(Y, e);
  M2.makeBasis(X, Y, e);
  return out.setFromRotationMatrix(M2);
}

export interface RigState {
  /** ground position; z is the height of a jump */
  pos: THREE.Vector3;
  /** degrees; 0 faces world -Y */
  yaw: number;
  pose: Pose;
  /** overall size (1 = as filmed) */
  scale?: number;
}

const PART_NAMES = ["body", "hand_r", "hand_l", "blade", "eye0", "eye1", "band"] as const;

export class FighterRig {
  readonly body: THREE.Mesh;
  readonly parts: THREE.Mesh[];
  /** the film objects this rig poses (empty for clones, which are not in the film) */
  readonly names: string[];
  private readonly attached: { obj: THREE.Mesh; local: THREE.Matrix4 }[] = [];
  private readonly handR: THREE.Mesh;
  private readonly handL: THREE.Mesh;
  private readonly blade: THREE.Mesh;
  private readonly bladeLocal = new THREE.Matrix4();
  private readonly bodyLocal = new THREE.Matrix4();
  private readonly handScale = new THREE.Vector3(1, 1, 1);
  readonly root = new THREE.Matrix4();

  /**
   * `clone`: build new meshes from the film's (shared geometry and materials)
   * and add them to the scene, instead of taking over the film's own objects.
   */
  constructor(
    fs: FilmScene,
    readonly who: Who,
    clone = false,
  ) {
    const n = (s: string) => `${who}_${s}`;
    const meshes = PART_NAMES.map((p) => {
      const src = fs.object(n(p));
      if (!clone) return src;
      const m = new THREE.Mesh(src.geometry, src.material);
      m.name = `${n(p)}#clone`;
      m.matrixAutoUpdate = false;
      m.frustumCulled = false;
      m.visible = false;
      fs.scene.add(m);
      return m;
    });
    const [body, handR, handL, blade, eye0, eye1, band] = meshes;
    this.body = body;
    this.handR = handR;
    this.handL = handL;
    this.blade = blade;
    this.parts = meshes;
    this.names = clone ? [] : PART_NAMES.map(n);

    // rest relations from the film's first frame, posed with the film's opening pose
    const start = FILM_START[who];
    const pivot = this.pivotMatrix({ pos: new THREE.Vector3(...start.pos), yaw: start.yaw, pose: IDLE }, new THREE.Matrix4());
    const body0 = fs.filmed(n("body"), 0);
    this.bodyLocal.copy(pivot).invert().multiply(body0);
    const bodyInv = body0.clone().invert();
    const attached: [string, THREE.Mesh][] = [
      ["eye0", eye0],
      ["eye1", eye1],
      ["band", band],
    ];
    for (const [name, obj] of attached) this.attached.push({ obj, local: bodyInv.clone().multiply(fs.filmed(n(name), 0)) });
    const hand0 = fs.filmed(n("hand_r"), 0);
    this.bladeLocal.copy(hand0).invert().multiply(fs.filmed(n("blade"), 0));
    hand0.decompose(V, Q, this.handScale);
  }

  private rootMatrix(s: RigState, out: THREE.Matrix4) {
    const k = s.scale ?? 1;
    out.makeRotationZ(s.yaw * DEG);
    if (k !== 1) out.scale(V.setScalar(k));
    return out.setPosition(s.pos);
  }

  private pivotMatrix(s: RigState, out: THREE.Matrix4) {
    const p = s.pose;
    const sq = Math.max(0.4, p.squash);
    const w = 1 / Math.sqrt(sq);
    E.set(p.lean * DEG, p.roll * DEG, p.twist * DEG, "ZYX");
    Q.setFromEuler(E);
    out.compose(V.set(0, 0, p.hop), Q, V2.set(w, w, sq));
    return out.premultiply(this.rootMatrix(s, M));
  }

  /** Write every part's world matrix for this state. */
  apply(s: RigState) {
    this.rootMatrix(s, this.root);
    this.pivotMatrix(s, this.body.matrix).multiply(this.bodyLocal);
    for (const e of this.attached) e.obj.matrix.multiplyMatrices(this.body.matrix, e.local);
    const p = s.pose;
    bladeQuat(p.blade, p.edge, Q);
    this.handR.matrix.compose(V.set(p.hand_r[0], p.hand_r[1], p.hand_r[2]), Q, this.handScale).premultiply(this.root);
    this.handL.matrix.compose(V.set(p.hand_l[0], p.hand_l[1], p.hand_l[2]), Q.identity(), this.handScale).premultiply(this.root);
    this.blade.matrix.multiplyMatrices(this.handR.matrix, this.bladeLocal);
  }

  /** Blade base and tip in world space (for hit tests and trails). */
  bladeSegment(base: THREE.Vector3, tip: THREE.Vector3) {
    base.set(0, -BLADE.base, 0).applyMatrix4(this.blade.matrix);
    tip.set(0, -BLADE.base - BLADE[this.who], 0.04).applyMatrix4(this.blade.matrix);
    return this;
  }

  /** Body centre in world space. */
  center(out: THREE.Vector3) {
    return out.set(0, 0, 0.6).applyMatrix4(this.body.matrix);
  }

  setVisible(v: boolean) {
    for (const part of this.parts) part.visible = v;
  }
}
