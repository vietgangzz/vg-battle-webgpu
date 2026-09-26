/**
 * Real shadows from the sun for what moves (SORA, the monsters, the
 * fighters): each frame they are drawn once more, depth only, from the sun
 * into a small shadow map that follows SORA; the valley's own shaders (ground,
 * lawn, plants, the Meshy pieces) look it up and fall into their shade band
 * where it says something stands between them and the sun.
 *
 * One extra pass of a dozen draws: the casters carry layer CASTER, and the
 * shadow camera sees nothing else (no sky, no world, no effects).
 */
import * as t3 from "@typegpu/three";
import * as TSL from "three/tsl";
import * as THREE from "three/webgpu";
import { d } from "typegpu";

/** the layer of everything that casts (added to its own) */
export const CASTER = 2;
/** shadow map size (texels) and the ground it covers round SORA (m, half width) */
const SIZE = 1024;
const REACH = 16;
/** how far up the sun the shadow camera stands */
const BACK = 40;

const depth = new THREE.DepthTexture(SIZE, SIZE);
const matrix = TSL.uniform(new THREE.Matrix4()).setGroup(TSL.renderGroup);
const strength = TSL.uniform(0).setGroup(TSL.renderGroup);

/**
 * How lit by the sun this fragment is (1 = in the open, 0 = in a caster's
 * shadow), softened over a few texels. Outside the map, or when shadows are
 * off, 1.
 */
function sunLitNode() {
  const sc = matrix.mul(TSL.vec4(TSL.positionWorld, 1));
  const uv = TSL.vec2(sc.x.mul(0.5).add(0.5), sc.y.mul(-0.5).add(0.5));
  const z = sc.z.sub(0.0015);
  const texel = 1.4 / SIZE;
  const taps: [number, number][] = [
    [0, 0],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [0.7, 0.7],
    [-0.7, 0.7],
    [0.7, -0.7],
    [-0.7, -0.7],
  ];
  const lit = taps
    .map(([x, y]) => TSL.step(z, TSL.texture(depth, uv.add(TSL.vec2(x * texel, y * texel))).x))
    .reduce((a, b) => a.add(b))
    .div(taps.length);
  const inside = TSL.step(0.001, uv.x)
    .mul(TSL.step(uv.x, 0.999))
    .mul(TSL.step(0.001, uv.y))
    .mul(TSL.step(uv.y, 0.999))
    .mul(TSL.step(0, sc.z))
    .mul(TSL.step(sc.z, 1));
  return TSL.mix(TSL.float(1), lit, inside.mul(strength));
}

/** The sun's light at this fragment (0..1), for the valley's TypeGPU shaders. */
export const SUN_LIT = t3.fromTSL(sunLitNode(), d.f32);

const V = new THREE.Vector3();
const UP = new THREE.Vector3(0, 0, 1);
const snap = new THREE.Vector3();

export class SunShadow {
  private readonly target = new THREE.RenderTarget(SIZE, SIZE, { depthTexture: depth });
  private readonly cam = new THREE.OrthographicCamera(-REACH, REACH, REACH, -REACH, 1, BACK * 2);
  private readonly override = new THREE.MeshBasicNodeMaterial();

  constructor() {
    this.cam.layers.set(CASTER);
    this.cam.up.copy(UP);
    // WebGPU's depth range (0..1), from the start: the matrix is read before the first render
    this.cam.coordinateSystem = THREE.WebGPUCoordinateSystem;
    this.cam.updateProjectionMatrix();
    this.override.colorNode = TSL.vec4(0, 0, 0, 1);
    this.override.side = THREE.DoubleSide;
  }

  /** Mark an object (and all under it) as casting. */
  static cast(o: THREE.Object3D) {
    o.traverse((c) => c.layers.enable(CASTER));
  }

  /** Shadows on (1) or off (0), and how dark (0..1). */
  set strength(v: number) {
    strength.value = v;
  }

  get strength() {
    return strength.value as number;
  }

  /**
   * Draw the casters from the sun (`sunDir` points toward the sun), centred on
   * `focus`. The map is moved in whole texels so the shadows do not crawl.
   */
  render(renderer: THREE.WebGPURenderer, scene: THREE.Scene, focus: THREE.Vector3, sunDir: THREE.Vector3) {
    if (strength.value <= 0) return;
    const dir = V.copy(sunDir).normalize();
    // a low sun would stretch the map across the valley: never lower than 20 degrees
    if (dir.z < 0.34) dir.setZ(0.34).normalize();
    const cam = this.cam;
    cam.position.copy(focus).addScaledVector(dir, BACK);
    cam.lookAt(focus);
    cam.updateMatrixWorld(true);
    // snap the focus to the texel grid, in the light's own frame
    const unit = (REACH * 2) / SIZE;
    snap.copy(focus).applyMatrix4(cam.matrixWorldInverse);
    const dx = snap.x - Math.round(snap.x / unit) * unit;
    const dy = snap.y - Math.round(snap.y / unit) * unit;
    cam.translateX(-dx);
    cam.translateY(-dy);
    cam.updateMatrixWorld(true);
    (matrix.value as THREE.Matrix4).multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);

    const bg = scene.backgroundNode;
    const was = renderer.getRenderTarget();
    scene.backgroundNode = null;
    scene.overrideMaterial = this.override;
    renderer.setRenderTarget(this.target);
    renderer.render(scene, cam);
    renderer.setRenderTarget(was);
    scene.overrideMaterial = null;
    scene.backgroundNode = bg;
  }
}
