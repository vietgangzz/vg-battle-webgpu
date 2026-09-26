/**
 * Small things on the field: the energy orbs defeated shadows leave behind,
 * the barrier walls that seal an ambush, and the lock-on ring under SORA's
 * target.
 */
import * as t3 from "@typegpu/three";
import * as THREE from "three/webgpu";
import { d, std } from "typegpu";

import type { Actor } from "./actor";
import type { Materials } from "./shading";

const LIME = d.vec3f(0.66, 0.92, 0.07);

/** Energy orbs: small lime suns that drift up, then fly into SORA. */
export class Orbs {
  readonly group = new THREE.Group();
  private readonly items: { mesh: THREE.Mesh; vel: THREE.Vector3; age: number; live: boolean }[] = [];

  constructor(mats: Materials, count = 32) {
    const geo = new THREE.IcosahedronGeometry(0.11, 2);
    const mat = mats.get("lime");
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      this.group.add(mesh);
      this.items.push({ mesh, vel: new THREE.Vector3(), age: 0, live: false });
    }
  }

  /** Burst `n` orbs from a point. */
  spawn(at: THREE.Vector3, n: number) {
    for (const it of this.items) {
      if (n <= 0) break;
      if (it.live) continue;
      n--;
      it.live = true;
      it.age = 0;
      it.mesh.visible = true;
      it.mesh.position.set(at.x, at.y, 0.7);
      const a = Math.random() * Math.PI * 2;
      it.vel.set(Math.cos(a) * 2.2, Math.sin(a) * 2.2, 3.5 + Math.random() * 2);
    }
  }

  /** Drift, then home in on `to`; returns how many were collected this step. */
  update(dt: number, to: THREE.Vector3) {
    let got = 0;
    const target = new THREE.Vector3(to.x, to.y, to.z + 0.7);
    for (const it of this.items) {
      if (!it.live) continue;
      it.age += dt;
      const p = it.mesh.position;
      if (it.age < 0.45) {
        it.vel.z -= 9 * dt;
        it.vel.multiplyScalar(Math.exp(-2 * dt));
      } else {
        const dir = target.clone().sub(p);
        const dist = dir.length();
        if (dist < 0.35) {
          it.live = false;
          it.mesh.visible = false;
          got++;
          continue;
        }
        it.vel.lerp(dir.multiplyScalar((6 + it.age * 14) / dist), 1 - Math.exp(-8 * dt));
      }
      p.addScaledVector(it.vel, dt);
      it.mesh.scale.setScalar(1 + 0.25 * Math.sin(it.age * 18));
    }
    return got;
  }

  clear() {
    for (const it of this.items) {
      it.live = false;
      it.mesh.visible = false;
    }
  }
}

/**
 * The ambush walls: sheets of rising lime light across the road at both ends of
 * an arena, fading in when it seals and out when it is cleared.
 */
export class Barrier {
  readonly group = new THREE.Group();
  private readonly strength = t3.uniform(0, d.f32);
  private target = 0;
  private level = 0;

  constructor() {
    const strength = this.strength;
    const m = new THREE.MeshBasicNodeMaterial();
    m.colorNode = t3.toTSL(() => {
      "use gpu";
      const p = t3.positionLocal.$;
      const t = t3.time.$;
      // x across the road, z up the wall (0..1)
      const h = std.saturate(p.z);
      const stripes = std.pow(std.abs(std.sin(p.x * 3.1 + p.z * 1.4 - t * 2.3)), 12);
      const scan = std.pow(std.fract(p.z * 0.7 - t * 0.9), 6);
      const edge = std.smoothstep(0.9, 1, std.abs(p.x) / 4.2);
      const fade = (1 - h) * (1 - h);
      const k = (0.16 + stripes * 0.7 + scan * 0.9 + edge * 0.8) * fade * strength.$;
      return d.vec4f(std.mul(LIME, k * 3), 1);
    }) as THREE.NodeMaterial["colorNode"];
    m.transparent = true;
    m.depthWrite = false;
    m.side = THREE.DoubleSide;
    m.blending = THREE.AdditiveBlending;
    m.fog = false;
    const geo = new THREE.PlaneGeometry(8.4, 1, 24, 8);
    geo.translate(0, 0.5, 0).rotateX(Math.PI / 2);
    for (let i = 0; i < 2; i++) {
      const wall = new THREE.Mesh(geo, m);
      // the plane spans x: turn it to cross the road (world y)
      wall.rotation.z = Math.PI / 2;
      wall.scale.set(1, 1, 4.2);
      this.group.add(wall);
    }
    this.group.visible = false;
  }

  /** Seal the stretch of road between x0 and x1 (or open it with null). */
  seal(span: [number, number] | null) {
    this.target = span ? 1 : 0;
    if (!span) return;
    this.group.children.forEach((w, i) => w.position.set(i === 0 ? span[0] : span[1], 0, 0));
  }

  update(dt: number) {
    this.level = THREE.MathUtils.damp(this.level, this.target, 5, dt);
    (this.strength.node as unknown as { value: number }).value = this.level;
    this.group.visible = this.level > 0.01;
  }
}

/** The lock-on ring: a thin lime circle turning under SORA's target. */
export class TargetRing {
  readonly mesh: THREE.Mesh;
  private shown = 0;
  private spin = 0;

  constructor(mats: Materials) {
    const geo = new THREE.RingGeometry(0.72, 0.8, 48, 1, 0, Math.PI * 1.7);
    const tick = new THREE.RingGeometry(0.86, 0.9, 48, 1, Math.PI * 1.8, Math.PI * 0.15);
    this.mesh = new THREE.Mesh(geo, mats.get("lime"));
    this.mesh.add(new THREE.Mesh(tick, mats.get("lime")));
    this.mesh.visible = false;
  }

  update(dt: number, target: Actor | null) {
    this.shown = THREE.MathUtils.damp(this.shown, target && !target.down ? 1 : 0, 12, dt);
    this.spin += dt * 1.6;
    this.mesh.visible = this.shown > 0.02;
    if (!target) return;
    const s = target.scale * (0.8 + 0.2 * this.shown);
    this.mesh.position.set(target.pos.x, target.pos.y, target.groundZ + 0.05);
    this.mesh.rotation.set(0, 0, this.spin);
    this.mesh.scale.setScalar(s);
  }
}
