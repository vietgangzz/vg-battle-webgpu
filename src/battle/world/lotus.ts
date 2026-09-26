/**
 * The lotus of Sen Bão (the lotus tempest): where SORA lands, a great pink
 * lotus of light opens on the ground (two rings of cupped petals and a golden
 * heart, growing out of nothing, turning slowly as it opens, then laying its
 * petals flat and fading), and a whirl of loose petals spirals up and out of
 * it. Two draws: the flower's petals and the flying ones, both instanced.
 */
import * as TSL from "three/tsl";
import * as THREE from "three/webgpu";

/** petals in the outer and inner rings of the flower, and loose petals in the whirl */
const OUTER = 10;
const INNER = 8;
const LOOSE = 36;
/** seconds the flower lives */
const LIFE = 2.3;

/**
 * One petal along +y from its base at the origin: pointed, widest past its
 * middle, cupped across and curling up toward the tip.
 */
function petalGeometry() {
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
      pos.push(v * w, u, 0.3 * v * v * (0.25 + u) * w + 0.22 * u * u);
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

/** Petal light: pearl white at the base to hot pink at the tip, brighter at the edges, over the bloom's threshold. */
type Fade = ReturnType<typeof uniformFade>;
const uniformFade = () => TSL.uniform(0).setGroup(TSL.renderGroup);

function petalMaterial(fade: Fade, strength: number) {
  const m = new THREE.MeshBasicNodeMaterial();
  const uv = TSL.uv();
  const tip = TSL.smoothstep(0.15, 1.0, uv.y);
  const edge = uv.x.sub(0.5).abs().mul(2).pow(3);
  // pink through and through: blush at the base, deep rose at the tip, the rims lit
  const base = TSL.mix(TSL.vec3(1, 0.62, 0.8), TSL.vec3(0.98, 0.16, 0.52), tip);
  const col = base.mul(TSL.float(strength).add(edge.mul(0.55)).add(tip.mul(0.25)));
  m.colorNode = TSL.vec4(col, fade);
  m.transparent = true;
  m.depthWrite = false;
  m.side = THREE.DoubleSide;
  m.fog = false;
  return m;
}

const M = new THREE.Matrix4();
const M2 = new THREE.Matrix4();
const P = new THREE.Vector3();
const Q = new THREE.Quaternion();
const S = new THREE.Vector3();
const E = new THREE.Euler();

const ease = (t: number) => 1 - (1 - t) ** 3;
const back = (t: number) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2;

export class LotusBloom {
  readonly group = new THREE.Group();
  private readonly flower: THREE.InstancedMesh;
  private readonly loose: THREE.InstancedMesh;
  private readonly heart: THREE.Mesh;
  private readonly fade = uniformFade();
  private readonly looseFade = uniformFade();
  private readonly at = new THREE.Vector3();
  private t = LIFE;
  private readonly seeds = Array.from({ length: LOOSE }, (_, i) => ({
    a: (i / LOOSE) * Math.PI * 2 + Math.sin(i * 12.9898) * 0.4,
    speed: 3.2 + ((i * 7) % 5) * 0.9,
    lift: 2.2 + ((i * 3) % 4) * 0.8,
    spin: 3 + (i % 5),
    size: 0.28 + ((i * 11) % 7) * 0.035,
  }));

  constructor() {
    const geo = petalGeometry();
    this.flower = new THREE.InstancedMesh(geo, petalMaterial(this.fade, 0.95), OUTER + INNER);
    this.loose = new THREE.InstancedMesh(geo, petalMaterial(this.looseFade, 1.2), LOOSE);
    const hm = new THREE.MeshBasicNodeMaterial();
    hm.colorNode = TSL.vec4(TSL.vec3(1, 0.82, 0.3).mul(2.2), this.fade);
    hm.transparent = true;
    hm.depthWrite = false;
    hm.fog = false;
    this.heart = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 10), hm);
    this.heart.scale.set(1, 1, 0.45);
    for (const o of [this.flower, this.loose]) {
      o.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      o.frustumCulled = false;
    }
    for (const o of [this.flower, this.heart, this.loose]) {
      o.renderOrder = 6;
      this.group.add(o);
    }
    this.group.visible = false;
  }

  /** Open the lotus at `at` on the ground (height `ground`). */
  bloom(at: THREE.Vector3, ground: number) {
    this.at.set(at.x, at.y, ground + 0.08);
    this.t = 0;
    this.group.visible = true;
  }

  update(dt: number) {
    if (this.t >= LIFE) return;
    this.t = Math.min(LIFE, this.t + dt);
    const t = this.t;
    if (t >= LIFE) {
      this.group.visible = false;
      return;
    }
    const size = 2.6 * back(Math.min(1, t / 0.4));
    const open = ease(Math.min(1, t / 0.7));
    // at the end the petals lie down and the light goes
    const settle = Math.max(0, (t - 1.4) / (LIFE - 1.4));
    this.fade.value = Math.min(1, t / 0.08) * (1 - settle ** 1.5);
    const turn = t * 0.7;
    const layer = (n: number, from: number, closed: number, opened: number, scale: number, offset: number) => {
      for (let k = 0; k < n; k++) {
        const lift = THREE.MathUtils.lerp(closed, opened, open) * (1 - settle * 0.6);
        E.set(lift, 0, turn + offset + (k / n) * Math.PI * 2 - Math.PI / 2, "ZXY");
        Q.setFromEuler(E);
        M.compose(this.at, Q, S.setScalar(size * scale));
        this.flower.setMatrixAt(from + k, M);
      }
    };
    // lift angles are from the ground (radians): a bud at first, then open wide
    layer(OUTER, 0, 1.3, 0.3, 1, 0);
    layer(INNER, OUTER, 1.45, 0.75, 0.72, Math.PI / INNER);
    this.flower.instanceMatrix.needsUpdate = true;
    this.heart.position.copy(this.at).setZ(this.at.z + 0.18 * size);
    this.heart.scale.set(size * 0.7, size * 0.7, size * 0.3);

    // the loose petals: out and up in a spiral, tumbling, then drifting down
    this.looseFade.value = Math.min(1, t / 0.1) * Math.max(0, 1 - t / LIFE) ** 0.8;
    for (let i = 0; i < LOOSE; i++) {
      const s = this.seeds[i];
      const a = s.a + t * 1.6;
      const r = 0.6 + s.speed * ease(Math.min(1, t / 1.6)) * 1.6;
      P.set(this.at.x + Math.cos(a) * r, this.at.y + Math.sin(a) * r, this.at.z + 0.3 + s.lift * t - 1.1 * t * t);
      E.set(t * s.spin, t * s.spin * 0.7, a, "XYZ");
      Q.setFromEuler(E);
      M2.compose(P, Q, S.setScalar(s.size));
      this.loose.setMatrixAt(i, M2);
    }
    this.loose.instanceMatrix.needsUpdate = true;
  }

  hide() {
    this.t = LIFE;
    this.group.visible = false;
  }
}
