/**
 * The lotus of Sen Bão (the lotus tempest), where SORA lands: a lotus of
 * light rather than a solid flower.
 *
 *  sigil    a lotus mandala drawn in light flat on the ground (two rings of
 *           petal outlines and circles), spreading out from her feet and
 *           turning slowly as it fades
 *  petals   two rings of petals made of light round her (never through her):
 *           bright outlines and tips, a faint glassy fill, drawn additively;
 *           they rise out of the ground, open, and burn away from their tips
 *  flurry   real petals thrown off as it opens, falling as petals do: under
 *           gravity, held back by the air (so they drift down), fluttering and
 *           tumbling, and lying flat where they land before they fade
 *
 * Three draws: the sigil, the light petals (instanced), the flurry (instanced).
 */
import * as TSL from "three/tsl";
import * as THREE from "three/webgpu";

const OUTER = 10;
const INNER = 8;
const FLURRY = 44;
/** seconds the bloom lasts (the flurry may still be settling) */
const LIFE = 3.2;
/** metres: the petals' ring round her, and how far the sigil spreads */
const RING = 1.25;
const SIGIL = 5.2;

const G = 9.81;
/** the air's hold on a petal (1/s): it falls at about G / DRAG */
const DRAG = 2.2;

/**
 * One petal along +y from its base at the origin: pointed, widest past its
 * middle, cupped across and curling up toward the tip; uv.x runs across it,
 * uv.y along it.
 */
function petalGeometry(cup = 1) {
  const U = 10;
  const V = 6;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= U; i++) {
    const u = i / U;
    const w = 0.4 * Math.sin(Math.PI * u ** 0.72) * (1 - 0.1 * u);
    for (let j = 0; j <= V; j++) {
      const v = (j / V) * 2 - 1;
      pos.push(v * w, u, cup * (0.3 * v * v * (0.25 + u) * w + 0.22 * u * u));
      uv.push(j / V, u);
    }
  }
  for (let i = 0; i < U; i++) {
    for (let j = 0; j < V; j++) {
      const a = i * (V + 1) + j;
      const b = a + V + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const uniform = (v: number) => TSL.uniform(v).setGroup(TSL.renderGroup);
type U = ReturnType<typeof uniform>;

const PINK = TSL.vec3(1.0, 0.34, 0.72);
const WHITE = TSL.vec3(1.0, 0.92, 0.97);

/** Light, added over the scene, never writing depth (it stands in front of nothing). */
function light(color: unknown, alpha: unknown) {
  const m = new THREE.MeshBasicNodeMaterial();
  m.colorNode = TSL.vec4(color as never, alpha as never);
  m.transparent = true;
  m.depthWrite = false;
  m.blending = THREE.AdditiveBlending;
  m.side = THREE.DoubleSide;
  m.fog = false;
  return m;
}

/** A petal of light: bright rim and tip, a vein down its middle, a faint glassy body; `burn` eats it from the tip down. */
function lightPetalMaterial(fade: U, burn: U) {
  const uv = TSL.uv();
  const edge = uv.x.sub(0.5).abs().mul(2);
  const rim = TSL.smoothstep(0.72, 1.0, edge);
  const tip = TSL.smoothstep(0.82, 1.0, uv.y);
  const vein = TSL.smoothstep(0.08, 0.0, edge).mul(uv.y.mul(0.6));
  const body = uv.y.mul(0.08).add(0.1);
  const shape = rim.add(tip.mul(0.8)).add(vein).add(body);
  // burning away from the tip: a bright front with nothing past it
  const cut = TSL.float(1).sub(burn.mul(1.15));
  const kept = TSL.smoothstep(cut, cut.sub(0.08), uv.y);
  const front = TSL.smoothstep(0.06, 0.0, uv.y.sub(cut).abs()).mul(TSL.step(0.01, burn).mul(0.5));
  const alpha = shape.mul(kept).add(front).mul(fade);
  return light(TSL.mix(WHITE, PINK, uv.y.mul(0.5).add(0.45)).mul(1.5), alpha);
}

/** The ground sigil: a lotus mandala of glowing lines in polar form, turned by `turn`. */
function sigilMaterial(fade: U, turn: U) {
  const p = TSL.uv().sub(0.5).mul(2);
  const r = p.length();
  const th = TSL.atan(p.y, p.x).add(turn);
  // the outline of a ring of `n` pointed petals, from r0 between them to r1 at their tips
  const petalEdge = (n: number, r0: number, r1: number, phase: number) => {
    const a = TSL.fract(th.div(Math.PI * 2).mul(n).add(phase)).mul(2).sub(1).abs();
    return TSL.float(1).sub(a).pow(1.6).mul(r1 - r0).add(r0);
  };
  const outerEdge = petalEdge(12, 0.5, 0.94, 0);
  const innerEdge = petalEdge(8, 0.28, 0.58, 0.5);
  const lines = TSL.exp(r.sub(outerEdge).abs().mul(-70))
    .add(TSL.exp(r.sub(innerEdge).abs().mul(-70)).mul(0.9))
    .add(TSL.exp(r.sub(0.2).abs().mul(-120)).mul(0.8))
    .add(TSL.exp(r.sub(0.985).abs().mul(-160)).mul(0.9));
  const fill = TSL.smoothstep(outerEdge, outerEdge.sub(0.05), r).mul(0.08).add(TSL.smoothstep(0.2, 0.0, r).mul(0.25));
  const inside = TSL.smoothstep(1.0, 0.97, r);
  return light(TSL.mix(WHITE, PINK, r.mul(0.5).add(0.5)).mul(1.6), lines.add(fill).mul(inside).mul(fade));
}

/** A real petal for the flurry: soft pink, lit a little by its facing. */
function flurryMaterial() {
  const m = new THREE.MeshBasicNodeMaterial();
  const uv = TSL.uv();
  const shade = TSL.normalView.z.abs().mul(0.35).add(0.75);
  m.colorNode = TSL.vec4(TSL.mix(TSL.vec3(1, 0.86, 0.92), TSL.vec3(0.96, 0.42, 0.66), uv.y).mul(shade), 1);
  m.side = THREE.DoubleSide;
  m.fog = false;
  return m;
}

interface Flake {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  axis: THREE.Vector3;
  angle: number;
  spin: number;
  phase: number;
  size: number;
  /** when it landed (s), -1 in flight, -2 not thrown */
  landed: number;
  yaw: number;
}

const M = new THREE.Matrix4();
const P = new THREE.Vector3();
const Q = new THREE.Quaternion();
const Q2 = new THREE.Quaternion();
const S = new THREE.Vector3();
const E = new THREE.Euler();
const Z = new THREE.Vector3(0, 0, 1);
const X = new THREE.Vector3(1, 0, 0);

const ease = (t: number) => 1 - (1 - t) ** 3;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

export class LotusBloom {
  readonly group = new THREE.Group();
  private readonly sigil: THREE.Mesh;
  private readonly petals: THREE.InstancedMesh;
  private readonly flurry: THREE.InstancedMesh;
  private readonly sigilFade = uniform(0);
  private readonly sigilTurn = uniform(0);
  private readonly petalFade = uniform(0);
  private readonly burn = uniform(0);
  private readonly at = new THREE.Vector3();
  private ground: (x: number, y: number) => number = () => 0;
  private t = LIFE;
  private thrown = false;
  private readonly flakes: Flake[] = Array.from({ length: FLURRY }, () => ({
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    axis: new THREE.Vector3(1, 0, 0),
    angle: 0,
    spin: 0,
    phase: 0,
    size: 0,
    landed: -2,
    yaw: 0,
  }));
  private seed = 11;

  constructor() {
    this.sigil = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), sigilMaterial(this.sigilFade, this.sigilTurn));
    this.petals = new THREE.InstancedMesh(petalGeometry(0.6), lightPetalMaterial(this.petalFade, this.burn), OUTER + INNER);
    this.flurry = new THREE.InstancedMesh(petalGeometry(1), flurryMaterial(), FLURRY);
    for (const o of [this.petals, this.flurry]) {
      o.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      o.frustumCulled = false;
    }
    this.sigil.frustumCulled = false;
    this.sigil.renderOrder = 5;
    this.petals.renderOrder = 6;
    this.group.add(this.sigil, this.petals, this.flurry);
    this.group.visible = false;
  }

  private rand() {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  /** Open the lotus at `at`, on the ground whose height `ground` gives. */
  bloom(at: THREE.Vector3, ground: (x: number, y: number) => number) {
    this.ground = ground;
    this.at.set(at.x, at.y, ground(at.x, at.y));
    this.t = 0;
    this.thrown = false;
    for (const f of this.flakes) f.landed = -2;
    this.group.visible = true;
  }

  /** Throw the flurry off the opening petals. */
  private throwFlurry() {
    this.thrown = true;
    for (const f of this.flakes) {
      const a = this.rand() * Math.PI * 2;
      const r = RING + 0.6 + this.rand() * 0.8;
      f.pos.set(this.at.x + Math.cos(a) * r, this.at.y + Math.sin(a) * r, this.at.z + 0.6 + this.rand() * 0.8);
      const out = 2.2 + this.rand() * 3.2;
      f.vel.set(Math.cos(a) * out, Math.sin(a) * out, 3.2 + this.rand() * 3.5);
      f.axis.set(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).normalize();
      f.angle = this.rand() * Math.PI * 2;
      f.spin = (this.rand() < 0.5 ? -1 : 1) * (4 + this.rand() * 6);
      f.phase = this.rand() * Math.PI * 2;
      f.size = 0.22 + this.rand() * 0.12;
      f.landed = -1;
      f.yaw = this.rand() * Math.PI * 2;
    }
  }

  update(dt: number) {
    if (this.t >= LIFE) return;
    this.t = Math.min(LIFE, this.t + dt);
    const t = this.t;
    if (t >= LIFE) {
      this.group.visible = false;
      return;
    }

    // ---- the sigil: out fast, turning, gone by two seconds
    const spread = ease(clamp01(t / 0.35));
    this.sigil.position.set(this.at.x, this.at.y, this.at.z + 0.07);
    this.sigil.scale.setScalar(Math.max(0.01, SIGIL * spread));
    this.sigilTurn.value = t * 0.6;
    this.sigilFade.value = clamp01(t / 0.08) * (1 - clamp01((t - 1.1) / 0.9));

    // ---- the petals of light: rise out of the ground, open, burn away from their tips
    const grow = ease(clamp01(t / 0.45));
    const open = ease(clamp01((t - 0.15) / 0.6));
    this.petalFade.value = clamp01(t / 0.12) * (1 - clamp01((t - 1.5) / 0.6));
    this.burn.value = clamp01((t - 1.05) / 0.85);
    const turn = t * 0.5;
    // lean: radians from upright (0) toward lying outward (pi/2); each petal's base on its ring, never through her
    const ring = (n: number, from: number, radius: number, closed: number, opened: number, size: number, offset: number) => {
      const lean = closed + (opened - closed) * open;
      const rr = radius * (0.85 + 0.15 * open);
      for (let k = 0; k < n; k++) {
        const a = turn + offset + (k / n) * Math.PI * 2;
        P.set(this.at.x + Math.cos(a) * rr, this.at.y + Math.sin(a) * rr, this.at.z + 0.05);
        // local +y (the petal's length) up, tipped outward by `lean`; local z (its cup) facing her
        E.set(Math.PI / 2 - lean, 0, a - Math.PI / 2, "ZXY");
        Q.setFromEuler(E);
        M.compose(P, Q, S.setScalar(Math.max(0.01, size * grow)));
        this.petals.setMatrixAt(from + k, M);
      }
    };
    ring(OUTER, 0, RING * 1.35, 0.15, 0.95, 2.4, 0);
    ring(INNER, OUTER, RING, 0.05, 0.55, 1.9, Math.PI / INNER);
    this.petals.instanceMatrix.needsUpdate = true;

    // ---- the flurry: real petals under gravity and the air's drag, fluttering down
    if (!this.thrown && t > 0.35) this.throwFlurry();
    const drag = Math.exp(-DRAG * dt);
    for (let i = 0; i < FLURRY; i++) {
      const f = this.flakes[i];
      let scale = 0;
      if (f.landed === -1) {
        // a petal is all surface: the air holds it back, and pushes it sideways as it rocks
        f.vel.z -= G * dt;
        f.vel.multiplyScalar(drag);
        const sway = Math.sin(t * 7 + f.phase) * 2.6 * dt;
        f.vel.x += sway * Math.cos(f.yaw);
        f.vel.y += sway * Math.sin(f.yaw);
        f.pos.addScaledVector(f.vel, dt);
        f.angle += f.spin * dt;
        const gz = this.ground(f.pos.x, f.pos.y) + 0.03;
        if (f.pos.z <= gz && f.vel.z < 0) {
          // landed: it settles flat where it fell
          f.pos.z = gz;
          f.landed = t;
        }
        scale = f.size;
        Q.setFromAxisAngle(f.axis, f.angle);
      } else if (f.landed >= 0) {
        const since = t - f.landed;
        scale = f.size * (1 - clamp01((since - 0.5) / 0.5));
        // lying on the ground, face up
        Q.setFromAxisAngle(Z, f.yaw).multiply(Q2.setFromAxisAngle(X, -Math.PI / 2));
      }
      M.compose(f.pos, Q, S.setScalar(Math.max(scale, 0.0001)));
      this.flurry.setMatrixAt(i, M);
    }
    this.flurry.instanceMatrix.needsUpdate = true;
  }

  hide() {
    this.t = LIFE;
    this.group.visible = false;
  }
}
