/**
 * The way to the next objective, drawn in the valley itself so it moves with
 * the picture (a marker laid over the screen from the JS thread trails it by a
 * frame and shivers):
 *
 *  arrows  gold chevrons hovering over the ground ahead of SORA, streaming
 *          toward the objective, fading in at her feet and out ahead
 *  beacon  over the objective, a turning gold crystal above a pillar of light
 *          seen across the valley, and a ring pulsing out on the ground; it
 *          grows with distance so it never shrinks to a speck
 *
 * The colour tells what waits there: gold a shrine, ember a shadow camp,
 * crimson the Shadow General. Five draws in all, none of them in the river's
 * reflection.
 */
import * as TSL from "three/tsl";
import * as THREE from "three/webgpu";

/** chevrons in the stream, how far apart, and how fast they flow (m, m/s) */
const ARROWS = 7;
const SPACING = 2.8;
const FLOW = 2.6;
/** the stream starts this far ahead of her and reaches this far */
const NEAR = 3.2;
const FAR = NEAR + ARROWS * SPACING;
/** hovering just over the lawn's blade tips */
const HOVER = 0.5;

const KIND_COLORS: [number, number, number][] = [
  [1.0, 0.68, 0.12],
  [1.0, 0.4, 0.1],
  [1.0, 0.16, 0.22],
];
/** the chevrons lie on the ground (a hair of tilt toward the lens): arrows pointing the way, not up at the sky */
const TILT = 0.16;
/** laid flat they are drawn longer along the way and a little wider, so the low camera still reads them */
const LONG = 1.9;
const WIDE = 1.45;

export interface GroundQuery {
  height(x: number, y: number): number;
  /** somewhere she cannot walk (water, a wall): no arrow drawn there */
  blocked(x: number, y: number, z: number): boolean;
}

const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const Q2 = new THREE.Quaternion();
const P = new THREE.Vector3();
const S = new THREE.Vector3();
const N = new THREE.Vector3();
const UP = new THREE.Vector3(0, 0, 1);
const AY = new THREE.Vector3(0, 1, 0);
const C = new THREE.Color();

/** A flat chevron pointing along +x, long along the way (the low camera sees it foreshortened). */
function chevronGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0.62, 0);
  s.lineTo(-0.2, 0.62);
  s.lineTo(-0.62, 0.62);
  s.lineTo(0.12, 0);
  s.lineTo(-0.62, -0.62);
  s.lineTo(-0.2, -0.62);
  s.closePath();
  return new THREE.ShapeGeometry(s);
}

/** Glowing, additive, unfogged, never writing depth: light rather than a thing. */
function glow(color: THREE.Node, alpha: THREE.Node) {
  const m = new THREE.MeshBasicNodeMaterial();
  m.colorNode = TSL.vec4(color as never, alpha as never);
  m.transparent = true;
  m.depthWrite = false;
  m.blending = THREE.AdditiveBlending;
  m.side = THREE.DoubleSide;
  m.fog = false;
  return m;
}

export class Guide {
  readonly group = new THREE.Group();
  private readonly arrows: THREE.InstancedMesh;
  private readonly crystal: THREE.Mesh;
  private readonly pillar: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private readonly tint = TSL.uniform(new THREE.Color(...KIND_COLORS[0])).setGroup(TSL.renderGroup);
  private readonly pillarFade = TSL.uniform(0).setGroup(TSL.renderGroup);
  private readonly ringT = TSL.uniform(0).setGroup(TSL.renderGroup);
  private shown = 0;
  private arrowsShown = 0;
  private readonly goal = new THREE.Vector3();

  constructor(layer: number) {
    // chevrons: bright gold, each instance dimmed by its colour (the stream's fade)
    // brighter toward the tip
    const tip = TSL.positionLocal.x.add(0.62).div(1.24).clamp(0, 1);
    // (laid flat they are seen at a glancing angle over the grass: brighter than when they stood up)
    const am = glow(this.tint.mul(tip.mul(1.6).add(1.0)), TSL.float(1));
    this.arrows = new THREE.InstancedMesh(chevronGeometry(), am, ARROWS);
    this.arrows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < ARROWS; i++) this.arrows.setColorAt(i, C.setRGB(0, 0, 0));
    this.arrows.frustumCulled = false;

    // the crystal: an elongated octahedron, brighter at its facets' edges
    const cg = new THREE.OctahedronGeometry(0.42, 0);
    cg.scale(1, 1, 1.7);
    const facing = TSL.float(1).sub(TSL.normalView.z.abs());
    this.crystal = new THREE.Mesh(cg, glow(this.tint.mul(facing.mul(1.3).add(0.55)), TSL.float(1)));

    // the pillar: an open tube, bright at the foot, gone by the top
    const pg = new THREE.CylinderGeometry(0.28, 0.5, 1, 20, 1, true);
    pg.rotateX(Math.PI / 2);
    pg.translate(0, 0, 0.5);
    const up = TSL.positionLocal.z;
    // brightest down its middle, soft at its sides
    const edge = TSL.normalView.z.abs().mul(0.75).add(0.25);
    this.pillar = new THREE.Mesh(pg, glow(this.tint.mul(1.4), TSL.float(1).sub(up).pow(1.6).mul(edge).mul(this.pillarFade).mul(0.5)));

    // the ring: a band expanding and fading on the ground, over and over
    const rg = new THREE.RingGeometry(0.86, 1, 48);
    this.ring = new THREE.Mesh(rg, glow(this.tint.mul(1.6), this.ringT.oneMinus().pow(1.5).mul(0.8)));

    for (const o of [this.arrows, this.crystal, this.pillar, this.ring]) {
      o.layers.set(layer);
      o.renderOrder = 5;
      this.group.add(o);
    }
    this.group.visible = false;
  }

  /**
   * One frame: `goal` is the objective (null for none), `kind` what it is,
   * `roaming` whether the arrows should run (not in a fight).
   */
  update(dt: number, time: number, hero: THREE.Vector3, goal: THREE.Vector3 | null, kind: number, roaming: boolean, ground: GroundQuery) {
    const want = goal ? 1 : 0;
    this.shown += (want - this.shown) * Math.min(1, dt * 3);
    if (goal) this.goal.copy(goal);
    this.group.visible = this.shown > 0.01;
    if (!this.group.visible) return;
    const g = this.goal;
    const [r, gg, b] = KIND_COLORS[kind] ?? KIND_COLORS[0];
    (this.tint.value as THREE.Color).setRGB(r, gg, b);
    const dx = g.x - hero.x;
    const dy = g.y - hero.y;
    const dist = Math.hypot(dx, dy);
    const base = ground.height(g.x, g.y);

    // the beacon, larger the farther off so it reads from across the valley
    const grow = Math.max(1, dist / 30);
    const bob = Math.sin(time * 2.1) * 0.18;
    this.crystal.position.set(g.x, g.y, base + 3.2 + bob + (grow - 1) * 1.5);
    this.crystal.rotation.set(0, 0, time * 1.4);
    this.crystal.scale.setScalar(grow * this.shown);
    // the pillar stands tall from afar and sinks away as she arrives
    const near = THREE.MathUtils.smoothstep(dist, 7, 18);
    this.pillarFade.value = near * this.shown;
    this.pillar.position.set(g.x, g.y, base);
    this.pillar.scale.set(grow, grow, 26 + dist * 0.12);
    this.pillar.visible = near > 0.01;
    const cycle = (time * 0.6) % 1;
    this.ringT.value = cycle;
    this.ring.position.set(g.x, g.y, base + 0.12);
    this.ring.scale.setScalar((0.6 + cycle * 2.2) * Math.max(1, grow * 0.7));

    // the stream: chevrons sliding from her feet toward the goal
    const on = roaming && dist > 6 ? 1 : 0;
    this.arrowsShown += (on - this.arrowsShown) * Math.min(1, dt * 4);
    this.arrows.visible = this.arrowsShown > 0.01;
    if (!this.arrows.visible) return;
    const ux = dx / dist;
    const uy = dy / dist;
    const yaw = Math.atan2(uy, ux);
    const slide = (time * FLOW) % SPACING;
    // the stream stops short of the goal
    const reach = Math.min(FAR, dist - 2.5);
    for (let i = 0; i < ARROWS; i++) {
      const d = NEAR + i * SPACING + slide;
      const x = hero.x + ux * d;
      const y = hero.y + uy * d;
      const h = ground.height(x, y);
      // fade in near her, out at the far end, and none over water or through walls
      let a = THREE.MathUtils.smoothstep(d, NEAR, NEAR + 1.6) * (1 - THREE.MathUtils.smoothstep(d, reach - 3.5, reach));
      if (d > reach || ground.blocked(x, y, h)) a = 0;
      a *= this.arrowsShown * this.shown;
      // lying along the slope of the ground under it
      const sx = ground.height(x + 0.5, y) - ground.height(x - 0.5, y);
      const sy = ground.height(x, y + 0.5) - ground.height(x, y - 0.5);
      N.set(-sx, -sy, 1).normalize();
      Q.setFromUnitVectors(UP, N).multiply(Q2.setFromAxisAngle(UP, yaw)).multiply(Q2.setFromAxisAngle(AY, -TILT));
      // a gentle ripple along the stream
      const lift = HOVER + Math.sin(time * 5 - i * 0.9) * 0.04;
      P.set(x, y, h + lift);
      const k = 0.7 + 0.3 * a;
      S.set(LONG * k, WIDE * k, 1);
      M.compose(P, Q, S);
      this.arrows.setMatrixAt(i, M);
      this.arrows.setColorAt(i, C.setRGB(a, a, a));
    }
    this.arrows.instanceMatrix.needsUpdate = true;
    if (this.arrows.instanceColor) this.arrows.instanceColor.needsUpdate = true;
  }

  hide() {
    this.shown = 0;
    this.arrowsShown = 0;
    this.group.visible = false;
  }
}
