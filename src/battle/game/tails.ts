/**
 * The hachimaki tails, simulated live: the film's verlet ribbons
 * (battle/lib/strands.py) stepped every game tick against the fighter's body,
 * written into the tails' own meshes.
 */
import * as THREE from "three/webgpu";

import type { FilmScene } from "../runtime/scene";
import type { Who } from "./rig";

const N = 12;
const GRAVITY = 9.8;
const WIND = new THREE.Vector3(2.2, 0.6, 0.3);
const DRAG = 1.1;

const V = new THREE.Vector3();
const A = new THREE.Vector3();
const D = new THREE.Vector3();
const S = new THREE.Vector3();
const T = new THREE.Vector3();
const ACC = new THREE.Vector3();

interface Strand {
  seg: number;
  width: (u: number) => number;
  /** body space */
  anchor: THREE.Vector3;
  dir: THREE.Vector3;
  side: THREE.Vector3;
  x: THREE.Vector3[];
  xp: THREE.Vector3[];
  last: THREE.Vector3;
  mesh: THREE.Mesh;
  /** mesh vertex -> (point, edge) */
  map: Int32Array;
  seed: number;
}

export class Tails {
  private readonly strands: Strand[] = [];
  readonly names: string[];

  constructor(fs: FilmScene, who: Who) {
    this.names = [`${who}_tail0`, `${who}_tail1`];
    const bodyInv = fs.filmed(`${who}_body`, 0).invert();
    this.names.forEach((name, k) => {
      const sx = k === 0 ? 1 : -1;
      const mesh = fs.object(name);
      const geo = mesh.geometry;
      const u = geo.getAttribute("u");
      const v = geo.getAttribute("v");
      const count = geo.getAttribute("position").count;
      const map = new Int32Array(count);
      for (let i = 0; i < count; i++) map[i] = Math.round(u.getX(i) * (N - 1)) * 2 + Math.round(v.getX(i));
      // the knot: the ribbon's first pair straddles it in the film's first frame
      const verts = fs.filmedVerts(name, 0);
      const knot = new THREE.Vector3();
      let m = 0;
      for (let i = 0; i < count; i++) {
        if (map[i] >> 1 !== 0) continue;
        knot.x += verts[i * 3];
        knot.y += verts[i * 3 + 1];
        knot.z += verts[i * 3 + 2];
        m++;
      }
      knot.divideScalar(m).applyMatrix4(bodyInv);
      const len = k === 0 ? 1.05 : 0.85;
      this.strands.push({
        seg: len / (N - 1),
        width: (t) => 0.07 * (1 - 0.45 * t),
        anchor: knot,
        dir: new THREE.Vector3(0.25 * sx, 1, -0.5).normalize(),
        side: new THREE.Vector3(1, 0, 0),
        x: Array.from({ length: N }, () => new THREE.Vector3()),
        xp: Array.from({ length: N }, () => new THREE.Vector3()),
        last: new THREE.Vector3(),
        mesh,
        map,
        seed: k * 3 + (who === "kage" ? 1 : 0),
      });
    });
  }

  /** Lay the tails straight out behind the knot (a fresh start or a teleport). */
  reset(body: THREE.Matrix4) {
    for (const s of this.strands) {
      this.frame(s, body);
      for (let i = 0; i < N; i++) {
        s.x[i].copy(A).addScaledVector(D, s.seg * i);
        s.xp[i].copy(s.x[i]);
      }
      s.last.copy(A);
    }
  }

  private frame(s: Strand, body: THREE.Matrix4) {
    A.copy(s.anchor).applyMatrix4(body);
    D.copy(s.dir).transformDirection(body);
    S.copy(s.side).transformDirection(body);
  }

  /** Step the cloth by `dt` seconds of story time (0 = frozen in a hit-stop), `t` = story clock. */
  step(body: THREE.Matrix4, dt: number, t: number, floor = 0, substeps = 2) {
    const chest = V.set(0, 0, 0.65).applyMatrix4(body).clone();
    const head = V.set(0, 0, 1.12).applyMatrix4(body).clone();
    for (const s of this.strands) {
      this.frame(s, body);
      const jump = A.distanceTo(s.last);
      if (jump > 1.2) {
        // a cut or teleport: carry the cloth along
        V.subVectors(A, s.last);
        for (let i = 0; i < N; i++) {
          s.x[i].add(V);
          s.xp[i].add(V);
        }
      }
      s.last.copy(A);
      if (dt <= 0) {
        s.x[0].copy(A);
        continue;
      }
      const h = dt / substeps;
      const damp = Math.exp(-DRAG * h);
      for (let k = 0; k < substeps; k++) {
        const tt = t + h * k;
        const gust = T.set(
          Math.sin(tt * 1.7 + s.seed) * 1.2 + Math.sin(tt * 4.3) * 0.6,
          Math.cos(tt * 2.1) * 0.8,
          Math.sin(tt * 3.1 + 1.0) * 0.5,
        );
        ACC.set(0, 0, -GRAVITY).add(WIND).add(gust);
        const { x, xp } = s;
        for (let i = 1; i < N; i++) {
          V.subVectors(x[i], xp[i]).multiplyScalar(damp);
          xp[i].copy(x[i]);
          const fl = (0.6 * i) / N;
          x[i].add(V);
          x[i].x += (ACC.x + Math.sin(tt * 13 + i * 1.3) * fl) * h * h;
          x[i].y += (ACC.y + Math.cos(tt * 11 + i * 0.9) * fl) * h * h;
          x[i].z += ACC.z * h * h;
        }
        x[0].copy(A);
        xp[0].copy(A);
        // root stiffness: the second point leaves the knot along the rest direction
        V.copy(A).addScaledVector(D, s.seg);
        x[1].lerp(V, 0.6);
        for (let it = 0; it < 8; it++) {
          for (let i = 0; i < N - 1; i++) {
            V.subVectors(x[i + 1], x[i]);
            const L = V.length() || 1e-6;
            V.multiplyScalar((L - s.seg) / L);
            if (i === 0) x[i + 1].sub(V);
            else {
              x[i].addScaledVector(V, 0.5);
              x[i + 1].addScaledVector(V, -0.5);
            }
          }
          for (let i = 0; i < N - 2; i++) {
            V.subVectors(x[i + 2], x[i]);
            const L = V.length() || 1e-6;
            const rest = s.seg * 1.9;
            if (L < rest) {
              V.multiplyScalar(((L - rest) / L) * 0.15);
              if (i > 0) x[i].addScaledVector(V, 0.5);
              x[i + 2].addScaledVector(V, -0.5);
            }
          }
          for (let i = 2; i < N; i++) {
            push(x[i], chest, 0.62);
            push(x[i], head, 0.45);
            if (x[i].z < floor + 0.03) x[i].z = floor + 0.03;
          }
        }
      }
    }
  }

  /** Write the ribbons into the meshes (parallel-transported side, tapering width). */
  write() {
    for (const s of this.strands) {
      const pos = s.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      const side = T.copy(S);
      const pairs: number[] = [];
      for (let i = 0; i < N; i++) {
        V.subVectors(s.x[Math.min(i + 1, N - 1)], s.x[Math.max(i - 1, 0)]);
        if (V.lengthSq() < 1e-12) V.set(0, 0, -1);
        V.normalize();
        side.addScaledVector(V, -side.dot(V));
        if (side.lengthSq() < 1e-8) side.set(V.y, -V.x, 0);
        side.normalize();
        const w = s.width(i / (N - 1)) * 0.5;
        const p = s.x[i];
        pairs.push(p.x - side.x * w, p.y - side.y * w, p.z - side.z * w, p.x + side.x * w, p.y + side.y * w, p.z + side.z * w);
      }
      for (let k = 0; k < s.map.length; k++) {
        const j = s.map[k] * 3;
        arr[k * 3] = pairs[j];
        arr[k * 3 + 1] = pairs[j + 1];
        arr[k * 3 + 2] = pairs[j + 2];
      }
      pos.needsUpdate = true;
      s.mesh.geometry.computeVertexNormals();
      s.mesh.matrix.identity();
      s.mesh.visible = true;
    }
  }
}

function push(p: THREE.Vector3, c: THREE.Vector3, r: number) {
  V.subVectors(p, c);
  const L = V.length();
  if (L < r && L > 1e-6) p.copy(c).addScaledVector(V, r / L);
}
