/**
 * Kiếm khí: crescents of sword light SORA throws from a flick of her blade.
 *
 * Each bolt is a glowing lime crescent (HDR, so it blooms) with a soft halo
 * and a fading wake of smaller crescents behind it. It flies level over the
 * ground, bends a little toward the locked-on foe, passes through up to three
 * foes, and bursts in a ring of light when it is spent or strikes something
 * solid.
 */
import * as TSL from "three/tsl";
import * as THREE from "three/webgpu";

import type { Actor } from "../game/actor";
import { glow } from "../game/shading";

const SPEED = 27;
const LIFE = 1.05;
const TURN = 3.2;
const PIERCE = 3;
const HEIGHT = 1.0;
const WAKE = 5;
/** thrown ones at a time, plus the lotus tempest's two rings */
const MAX = 28;
const BURSTS = 10;

const LIME: [number, number, number] = [0.72, 1, 0.22];
/** the lotus tempest's light */
export const LOTUS_PINK: [number, number, number] = [1, 0.36, 0.74];

/** A flat crescent in its own XY plane, bulging toward +y (the way it flies). */
function crescent(radius: number, width: number, span: number) {
  const pos: number[] = [];
  const idx: number[] = [];
  const N = 18;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const a = (t - 0.5) * span;
    const w = width * Math.sin(Math.PI * t) ** 0.7;
    const ox = Math.sin(a) * radius;
    const oy = Math.cos(a) * radius - radius;
    const ix = Math.sin(a) * (radius - w);
    const iy = Math.cos(a) * (radius - w) - radius;
    pos.push(ox, oy, 0, ix, iy, 0);
    if (i < N) {
      const k = i * 2;
      idx.push(k, k + 1, k + 3, k, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A soft additive disc (for halos and bursts); `ring` hollows it into a ring. */
function softMaterial(color: [number, number, number], strength: number, ring = false) {
  const m = new THREE.SpriteNodeMaterial();
  const fade = TSL.uniform(1);
  const tint = TSL.uniform(new THREE.Color(...color)).setGroup(TSL.renderGroup);
  const r = TSL.uv().sub(0.5).length().mul(2);
  const shape = ring
    ? TSL.smoothstep(0.55, 0.82, r).mul(TSL.smoothstep(1.0, 0.84, r))
    : TSL.float(1).sub(r).clamp(0, 1).pow(2.2);
  m.colorNode = TSL.vec4(tint.mul(strength), shape.mul(fade));
  m.transparent = true;
  m.depthWrite = false;
  // a glow is light in the air, not a card standing in the world: tested against the ground, a
  // billboard sunk halfway into it was cut off along a hard straight line
  m.depthTest = false;
  m.blending = THREE.AdditiveBlending;
  m.fog = false;
  return { m, fade, tint };
}

/** A ring of light lying flat on the ground (the level-up's and the tempest's shockwave). */
function groundRingMaterial() {
  const m = new THREE.MeshBasicNodeMaterial();
  const fade = TSL.uniform(0).setGroup(TSL.renderGroup);
  const tint = TSL.uniform(new THREE.Color(...LIME)).setGroup(TSL.renderGroup);
  const r = TSL.uv().sub(0.5).length().mul(2);
  // a bright rim with a soft glow trailing inside it
  const rim = TSL.smoothstep(0.78, 0.93, r).mul(TSL.smoothstep(1.0, 0.94, r));
  const inner = TSL.smoothstep(0.2, 0.9, r).mul(TSL.smoothstep(1.0, 0.9, r)).mul(0.35);
  m.colorNode = TSL.vec4(tint.mul(3.4), rim.add(inner).mul(fade));
  m.transparent = true;
  m.depthWrite = false;
  m.blending = THREE.AdditiveBlending;
  m.side = THREE.DoubleSide;
  m.fog = false;
  return { m, fade, tint };
}

interface Bolt {
  live: boolean;
  t: number;
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  target: Actor | null;
  struck: Set<Actor>;
  body: THREE.Mesh;
  halo: THREE.Sprite;
  wake: THREE.Mesh[];
  trail: THREE.Vector3[];
  /** one of the tempest's rings: larger, heavier, no wake (a ring of twenty would be a hundred draws) */
  heavy: boolean;
}

/** A column of light rising from the feet (the level-up), soft at the sides and the top. */
function beamMaterial() {
  const m = new THREE.SpriteNodeMaterial();
  const fade = TSL.uniform(0);
  const tint = TSL.uniform(new THREE.Color(...LIME)).setGroup(TSL.renderGroup);
  const uv = TSL.uv();
  const side = TSL.float(1).sub(uv.x.sub(0.5).abs().mul(2)).clamp(0, 1).pow(2.5);
  const up = TSL.smoothstep(0.0, 0.12, uv.y).mul(TSL.float(1).sub(uv.y).pow(1.4));
  m.colorNode = TSL.vec4(tint.mul(3.2), side.mul(up).mul(fade));
  m.transparent = true;
  m.depthWrite = false;
  m.blending = THREE.AdditiveBlending;
  m.fog = false;
  return { m, fade, tint };
}

interface Burst {
  t: number;
  sprite: THREE.Sprite;
  flash: THREE.Sprite;
  fade: ReturnType<typeof TSL.uniform>;
  flashFade: ReturnType<typeof TSL.uniform>;
  tint: ReturnType<typeof TSL.uniform>;
}

const V = new THREE.Vector3();
const UP = new THREE.Vector3(0, 0, 1);
const M = new THREE.Matrix4();
const SIDE = new THREE.Vector3();

export class Bolts {
  readonly group = new THREE.Group();
  private readonly bolts: Bolt[] = [];
  private readonly bursts: Burst[] = [];
  private readonly rings: { t: number; size: number; mesh: THREE.Mesh; fade: ReturnType<typeof TSL.uniform>; tint: ReturnType<typeof TSL.uniform> }[] = [];
  private readonly beam: { sprite: THREE.Sprite; fade: ReturnType<typeof TSL.uniform>; tint: ReturnType<typeof TSL.uniform>; t: number };
  /** the thrown kiếm khí's look, and the tempest's pink one */
  private readonly looks: { core: THREE.Material; halo: THREE.Material }[] = [];

  constructor(
    private readonly ground: (x: number, y: number) => number,
    private readonly solid: (p: THREE.Vector3) => boolean,
  ) {
    const geo = crescent(0.95, 0.26, Math.PI * 0.78);
    const core = glow(LIME, 6, false);
    core.side = THREE.DoubleSide;
    // the wake: smaller, dimmer crescents
    const wakeMats = Array.from({ length: WAKE }, (_, i) => {
      const m = glow(LIME, 3.6 * (1 - i / WAKE) ** 1.5, false);
      m.side = THREE.DoubleSide;
      m.transparent = true;
      m.blending = THREE.AdditiveBlending;
      m.depthWrite = false;
      return m;
    });
    const halo = softMaterial(LIME, 2.2).m;
    const pinkCore = glow(LOTUS_PINK, 6, false);
    pinkCore.side = THREE.DoubleSide;
    this.looks.push({ core, halo }, { core: pinkCore, halo: softMaterial(LOTUS_PINK, 2.4).m });
    for (let i = 0; i < MAX; i++) {
      const body = new THREE.Mesh(geo, core);
      const h = new THREE.Sprite(halo);
      h.scale.setScalar(2.6);
      const wake = wakeMats.map((m, k) => {
        const w = new THREE.Mesh(geo, m);
        w.scale.setScalar(0.9 - k * 0.12);
        return w;
      });
      for (const o of [body, h, ...wake]) {
        o.visible = false;
        o.frustumCulled = false;
        this.group.add(o);
      }
      this.bolts.push({ live: false, t: 0, pos: new THREE.Vector3(), dir: new THREE.Vector3(), target: null, struck: new Set(), body, halo: h, wake, trail: [], heavy: false });
    }
    const bm = beamMaterial();
    const beam = new THREE.Sprite(bm.m);
    beam.center.set(0.5, 0);
    beam.visible = false;
    this.group.add(beam);
    this.beam = { sprite: beam, fade: bm.fade, tint: bm.tint, t: 1 };
    for (let i = 0; i < BURSTS; i++) {
      const ring = softMaterial(LIME, 3.2, true);
      const flash = softMaterial([1, 1, 0.85], 3.5);
      const sprite = new THREE.Sprite(ring.m);
      const fl = new THREE.Sprite(flash.m);
      sprite.visible = fl.visible = false;
      this.group.add(sprite, fl);
      this.bursts.push({ t: 1, sprite, flash: fl, fade: ring.fade, flashFade: flash.fade, tint: ring.tint });
    }
    const flat = new THREE.PlaneGeometry(2, 2);
    for (let i = 0; i < 4; i++) {
      const gm = groundRingMaterial();
      const mesh = new THREE.Mesh(flat, gm.m);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.rings.push({ t: 1, size: 1, mesh, fade: gm.fade, tint: gm.tint });
    }
  }

  /** Throw a bolt from `from` along `dir` (xy), bending toward `target` if given; `heavy`: one of the tempest's. */
  fire(from: THREE.Vector3, dir: THREE.Vector3, target: Actor | null, heavy = false) {
    const b = this.bolts.find((x) => !x.live) ?? this.bolts[0];
    b.live = true;
    b.t = 0;
    b.heavy = heavy;
    const look = this.looks[heavy ? 1 : 0];
    b.body.material = look.core;
    b.halo.material = look.halo as THREE.SpriteMaterial;
    b.body.scale.setScalar(heavy ? 1.45 : 1);
    b.halo.scale.setScalar(heavy ? 3.0 : 2.6);
    b.pos.set(from.x, from.y, this.ground(from.x, from.y) + HEIGHT).addScaledVector(V.copy(dir).setZ(0).normalize(), 0.9);
    b.dir.copy(dir).setZ(0).normalize();
    b.target = target;
    b.struck.clear();
    b.trail = [];
    this.place(b);
  }

  /** Fly every bolt; `hit` is called once per foe a bolt passes through (with whether it is a tempest's). */
  update(dt: number, foes: Actor[], hit: (foe: Actor, at: THREE.Vector3, heavy: boolean) => void) {
    for (const b of this.bolts) {
      if (!b.live) continue;
      b.t += dt;
      // bend toward the target, never more than TURN rad/s
      const tg = b.target;
      if (tg && tg.alive) {
        V.set(tg.pos.x - b.pos.x, tg.pos.y - b.pos.y, 0).normalize();
        const want = Math.atan2(V.y, V.x);
        const have = Math.atan2(b.dir.y, b.dir.x);
        let d = want - have;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        const a = have + THREE.MathUtils.clamp(d, -TURN * dt, TURN * dt);
        b.dir.set(Math.cos(a), Math.sin(a), 0);
      }
      // the path behind, newest first (reusing the oldest point's vector)
      const keep = WAKE * 2 + 1;
      const p = b.trail.length >= keep ? b.trail.pop()!.copy(b.pos) : b.pos.clone();
      b.trail.unshift(p);
      b.pos.addScaledVector(b.dir, SPEED * dt);
      // skim the ground: rise over a hill, settle into a hollow
      const gz = this.ground(b.pos.x, b.pos.y) + HEIGHT;
      b.pos.z += (Math.max(gz, b.pos.z - 0.6 * dt * SPEED) - b.pos.z) * Math.min(1, dt * 10);
      if (b.pos.z < gz - 0.3) b.pos.z = gz - 0.3;
      for (const f of foes) {
        if (b.struck.has(f) || !f.alive) continue;
        const dx = f.pos.x - b.pos.x;
        const dy = f.pos.y - b.pos.y;
        const reach = 0.95 + f.radius;
        if (dx * dx + dy * dy > reach * reach) continue;
        if (Math.abs(f.pos.z + 0.9 * f.scale - b.pos.z) > 1.7 * Math.max(1, f.scale)) continue;
        b.struck.add(f);
        hit(f, V.set(f.pos.x, f.pos.y, b.pos.z), b.heavy);
        this.burst(b.pos, 1.6, b.heavy);
        if (b.struck.size >= (b.heavy ? 5 : PIERCE)) {
          this.spend(b);
          break;
        }
      }
      if (!b.live) continue;
      if (b.t > LIFE || this.solid(b.pos)) {
        this.burst(b.pos, 2.2, b.heavy);
        this.spend(b);
        continue;
      }
      this.place(b);
    }
    const bm = this.beam;
    if (bm.t < 1) {
      bm.t = Math.min(1, bm.t + dt / 1.3);
      const rise = 1 - (1 - Math.min(1, bm.t * 3)) ** 3;
      bm.sprite.scale.set(1.8 + 0.8 * bm.t, 9 * rise, 1);
      bm.fade.value = bm.t < 0.2 ? bm.t / 0.2 : (1 - bm.t) / 0.8;
      if (bm.t >= 1) bm.sprite.visible = false;
    }
    for (const g of this.rings) {
      if (g.t >= 1) continue;
      g.t = Math.min(1, g.t + dt / 0.55);
      const e = 1 - (1 - g.t) ** 3;
      g.mesh.scale.setScalar(0.4 + g.size * e);
      g.fade.value = (1 - g.t) ** 1.4;
      if (g.t >= 1) g.mesh.visible = false;
    }
    for (const u of this.bursts) {
      if (u.t >= 1) continue;
      u.t = Math.min(1, u.t + dt / 0.42);
      const e = 1 - (1 - u.t) ** 3;
      u.sprite.scale.setScalar(0.6 + 3.4 * e * (u.sprite.userData.size as number));
      u.fade.value = (1 - u.t) ** 1.5;
      // the flash stays a flash: a big ring does not make a sun
      u.flash.scale.setScalar(2.4 * Math.min(u.sprite.userData.size as number, 1.6) * (1 - u.t * 0.6));
      u.flashFade.value = Math.max(0, 1 - u.t * 2.2);
      if (u.t >= 1) u.sprite.visible = u.flash.visible = false;
    }
  }

  /** The level-up: a pillar of light and rings of it spreading from the feet. */
  flare(at: THREE.Vector3, ground: number, pink = false) {
    const b = this.beam;
    b.t = 0;
    (b.tint.value as THREE.Color).setRGB(...(pink ? LOTUS_PINK : LIME));
    b.sprite.position.set(at.x, at.y, ground);
    b.sprite.visible = true;
    this.groundRing(V.set(at.x, at.y, ground), 7, pink);
    this.burst(V.set(at.x, at.y, ground + 1.2), 4, pink);
  }

  clear() {
    this.beam.t = 1;
    this.beam.sprite.visible = false;
    for (const b of this.bolts) this.spend(b);
    for (const u of this.bursts) {
      u.t = 1;
      u.sprite.visible = u.flash.visible = false;
    }
    for (const g of this.rings) {
      g.t = 1;
      g.mesh.visible = false;
    }
  }

  /** A ring of light spreading from `at` (the tempest's pink ones as she springs and lands). */
  ring(at: THREE.Vector3, size: number, pink = false) {
    this.burst(at, size, pink);
  }

  /** A ring of light spreading flat over the ground from `at` (on the ground), `size` metres out. */
  groundRing(at: THREE.Vector3, size: number, pink = false) {
    const g = this.rings.find((x) => x.t >= 1) ?? this.rings[0];
    g.t = 0;
    g.size = size;
    (g.tint.value as THREE.Color).setRGB(...(pink ? LOTUS_PINK : LIME));
    // a hand above the grass, so it lies over the lawn rather than in it
    g.mesh.position.set(at.x, at.y, at.z + 0.18);
    g.mesh.scale.setScalar(0.4);
    g.mesh.visible = true;
  }

  private burst(at: THREE.Vector3, size: number, pink = false) {
    const u = this.bursts.find((x) => x.t >= 1) ?? this.bursts[0];
    u.t = 0;
    (u.tint.value as THREE.Color).setRGB(...(pink ? LOTUS_PINK : LIME));
    u.sprite.userData.size = size / 2;
    u.sprite.position.copy(at);
    u.flash.position.copy(at);
    u.sprite.visible = u.flash.visible = true;
  }

  private spend(b: Bolt) {
    b.live = false;
    b.body.visible = b.halo.visible = false;
    for (const w of b.wake) w.visible = false;
  }

  /** Lay the crescent across the flight, tipped a little, and string the wake along the path behind. */
  private place(b: Bolt) {
    const orient = (o: THREE.Object3D, p: THREE.Vector3, dir: THREE.Vector3) => {
      o.position.copy(p);
      // local +y along the flight, local z up (the crescent lies flat), then a slight roll for style
      M.makeBasis(SIDE.crossVectors(dir, UP).normalize(), dir, UP);
      o.quaternion.setFromRotationMatrix(M);
      o.rotateY(0.35);
      o.visible = true;
    };
    orient(b.body, b.pos, b.dir);
    b.halo.position.copy(b.pos);
    b.halo.visible = true;
    b.wake.forEach((w, k) => {
      const p = b.trail[(k + 1) * 2 - 1];
      if (!p || b.heavy) {
        w.visible = false;
        return;
      }
      orient(w, p, b.dir);
    });
  }
}
