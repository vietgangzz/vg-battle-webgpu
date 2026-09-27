/**
 * The valley's animated enemies: Meshy's rigged characters, exported by
 * vg-showcase-demo/world/creatures.py (manifest gen/creatures.json, one blob
 * per creature in assets/creatures/).
 *
 * Space: Z up, metres, feet at the origin, the front looking down -Y (the
 * world's hero pieces use the same convention), so a creature facing world
 * angle `a` (radians, 0 = +X) has root.rotation.z = a + PI / 2.
 *
 * Blob layout per creature (offsets in the manifest entry, bytes):
 *   attrs.position f32x3, attrs.normal f32x3, attrs.uv f32x2, attrs.skinWeight f32x4,
 *   skinIndex u16x4, index u32, tex sRGB RGB bytes (rows bottom-up),
 *   rest: per bone 10 f32 (local t xyz, q xyzw, s xyz),
 *   inverseBind: per bone 16 f32 column-major,
 *   clips.<name>: frames x bones x 10 f32 local TRS sampled at clips.<name>.fps.
 * Bones are named "b<i>" here (parents before children); the Meshy names are in the manifest.
 *
 * Usage:
 *   const model = new CreatureModel(entry, blob);          // once per kind
 *   const c = new Creature(model);                          // per enemy
 *   scene.add(c.root); c.root.position.set(x, y, z); c.face(angle);
 *   c.play("walk"); await c.once("attack"); c.flash(1);     // c.update(dt) every frame
 */
import * as t3 from "@typegpu/three";
import * as TSL from "three/tsl";
import * as THREE from "three/webgpu";
import { d, std } from "typegpu";

import { ENV_U, fog } from "../game/shading";
import { diffuse } from "../runtime/lighting";

const U = ENV_U;

export interface CreatureClip {
  o: number;
  frames: number;
  fps: number;
  duration: number;
  loop: boolean;
  /** seconds into the clip when the blow lands (attacks) */
  impact?: number;
}

export interface CreatureEntry {
  file: string;
  height: number;
  glow: number;
  count: number;
  attrs: Record<"position" | "normal" | "uv" | "skinWeight", { o: number; w: number }>;
  skinIndex: { o: number };
  index: { o: number; n: number };
  tex?: { o: number; w: number; h: number };
  bones: { name: string; parent: number }[];
  rest: { o: number };
  inverseBind: { o: number };
  hand: number;
  head: number;
  clips: Record<string, CreatureClip>;
}

export interface CreatureManifest {
  version: number;
  creatures: Record<string, CreatureEntry>;
}

// ---------------------------------------------------------------- the look
/**
 * The painted texture under the valley's light, in the same soft two-band
 * toon as the hero pieces; hot colours (crimson eyes, ember cracks) glow past
 * the bloom threshold; a per-creature flash (object.userData.flash, 0..1)
 * turns it white-hot when struck, and an ember (object.userData.ember, 0..1)
 * sets it glowing red from the edges in (a boss winding up, or in a rage).
 */
function creatureMaterial(tex: THREE.Texture, glow: number) {
  const albedo = t3.fromTSL(TSL.texture(tex, TSL.uv()), d.vec4f);
  const flashNode = TSL.uniform(0).onObjectUpdate(({ object }) => (object?.userData.flash as number | undefined) ?? 0);
  const flash = t3.fromTSL(flashNode, d.f32);
  const emberNode = TSL.uniform(0).onObjectUpdate(({ object }) => (object?.userData.ember as number | undefined) ?? 0);
  const ember = t3.fromTSL(emberNode, d.f32);
  const m = new THREE.MeshBasicNodeMaterial();
  m.colorNode = t3.toTSL(() => {
    "use gpu";
    const pw = t3.positionWorld.$;
    const n = std.normalize(t3.normalWorld.$);
    const v = std.normalize(std.sub(t3.cameraPosition.$, pw));
    const e = diffuse(pw, n, true);
    const lum = e.x * 0.2126 + e.y * 0.7152 + e.z * 0.0722;
    const k = std.smoothstep(0.05, 0.2, lum) * 0.55 + std.smoothstep(0.2, 0.32, lum) * 0.45;
    const base = albedo.$.xyz;
    const lit = std.mul(base, 1.08);
    const shade = std.mul(std.mul(base, U.skyHorizon.$), 0.5);
    let c = std.add(std.mix(shade, lit, k), std.mul(std.mul(e, base), 0.08));
    // a cool rim so they read against the grass
    const rim = std.smoothstep(0.6, 0.95, 1 - std.abs(std.dot(n, v)));
    c = std.add(c, std.mul(U.skyHorizon.$, rim * 0.18));
    // what burns in the paint: saturated reds and oranges well brighter than the rest
    const hot = std.saturate((base.x - std.max(base.y, base.z) * 1.15) * 4 - 1.2) * std.smoothstep(0.35, 0.6, base.x) * glow;
    c = std.add(c, std.mul(base, hot * 3.2));
    // the ember: a red heat, strongest at the silhouette, past the bloom threshold
    c = std.add(c, std.mul(d.vec3f(1.9, 0.03, 0.06), ember.$ * (0.15 + rim * 2.2)));
    c = std.mix(c, d.vec3f(1.6, 1.5, 1.4), flash.$ * 0.85);
    return d.vec4f(fog(c, pw), 1);
  }) as THREE.NodeMaterial["colorNode"];
  m.fog = false;
  return m;
}

function texture(u8: Uint8Array, w: number, h: number) {
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0, j = 0; i < u8.length; i += 3, j += 4) {
    rgba[j] = u8[i];
    rgba[j + 1] = u8[i + 1];
    rgba[j + 2] = u8[i + 2];
    rgba[j + 3] = 255;
  }
  const tex = new THREE.DataTexture(rgba, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  // rows run bottom-up, as Blender's UVs do
  tex.flipY = false;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------- the kind
/** One kind of creature, built once: geometry, texture, material, bind pose, clips. */
export class CreatureModel {
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
  readonly clips = new Map<string, THREE.AnimationClip>();
  readonly inverseBind: THREE.Matrix4[];
  /** per bone rest local TRS */
  readonly rest: Float32Array;

  constructor(
    readonly name: string,
    readonly entry: CreatureEntry,
    blob: ArrayBuffer,
  ) {
    const e = entry;
    const f32 = (o: number, n: number) => new Float32Array(blob, o, n);
    const g = new THREE.BufferGeometry();
    for (const k of ["position", "normal", "uv", "skinWeight"] as const) {
      const a = e.attrs[k];
      g.setAttribute(k, new THREE.BufferAttribute(f32(a.o, e.count * a.w), a.w));
    }
    g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Uint16Array(blob, e.skinIndex.o, e.count * 4), 4));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(blob, e.index.o, e.index.n), 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    this.geometry = g;

    const tex = e.tex ? texture(new Uint8Array(blob, e.tex.o, e.tex.w * e.tex.h * 3), e.tex.w, e.tex.h) : null;
    this.material = tex ? creatureMaterial(tex, e.glow) : new THREE.MeshBasicNodeMaterial({ color: 0x777777 });

    const nb = e.bones.length;
    this.rest = f32(e.rest.o, nb * 10);
    const ib = f32(e.inverseBind.o, nb * 16);
    this.inverseBind = e.bones.map((_, i) => new THREE.Matrix4().fromArray(ib, i * 16));

    for (const [clipName, c] of Object.entries(e.clips)) {
      const data = f32(c.o, c.frames * nb * 10);
      const times = new Float32Array(c.frames);
      for (let f = 0; f < c.frames; f++) times[f] = Math.min(f / c.fps, c.duration);
      const tracks: THREE.KeyframeTrack[] = [];
      for (let b = 0; b < nb; b++) {
        const T = new Float32Array(c.frames * 3);
        const Q = new Float32Array(c.frames * 4);
        const S = new Float32Array(c.frames * 3);
        let scaled = false;
        for (let f = 0; f < c.frames; f++) {
          const o = (f * nb + b) * 10;
          T.set(data.subarray(o, o + 3), f * 3);
          Q.set(data.subarray(o + 3, o + 7), f * 4);
          S.set(data.subarray(o + 7, o + 10), f * 3);
          if (Math.abs(S[f * 3] - S[0]) > 1e-3) scaled = true;
        }
        tracks.push(new THREE.VectorKeyframeTrack(`b${b}.position`, times, T));
        tracks.push(new THREE.QuaternionKeyframeTrack(`b${b}.quaternion`, times, Q));
        if (scaled) tracks.push(new THREE.VectorKeyframeTrack(`b${b}.scale`, times, S));
      }
      this.clips.set(clipName, new THREE.AnimationClip(clipName, c.duration, tracks));
    }
  }

  clip(name: string) {
    return this.entry.clips[name];
  }
}

// ---------------------------------------------------------------- one of them
export interface PlayOptions {
  loop?: boolean;
  /** crossfade seconds */
  fade?: number;
  speed?: number;
}

/** A creature in the scene: its own skeleton and mixer over the kind's shared geometry and material. */
export class Creature {
  readonly root = new THREE.Group();
  readonly mesh: THREE.SkinnedMesh;
  readonly bones: THREE.Bone[];
  readonly mixer: THREE.AnimationMixer;
  private current: THREE.AnimationAction | null = null;
  private currentName = "";
  private flashT = 0;

  constructor(readonly model: CreatureModel) {
    const e = model.entry;
    const r = model.rest;
    this.bones = e.bones.map((_, i) => {
      const b = new THREE.Bone();
      b.name = `b${i}`;
      b.position.set(r[i * 10], r[i * 10 + 1], r[i * 10 + 2]);
      b.quaternion.set(r[i * 10 + 3], r[i * 10 + 4], r[i * 10 + 5], r[i * 10 + 6]);
      b.scale.set(r[i * 10 + 7], r[i * 10 + 8], r[i * 10 + 9]);
      return b;
    });
    e.bones.forEach((bone, i) => (bone.parent < 0 ? this.root : this.bones[bone.parent]).add(this.bones[i]));
    this.mesh = new THREE.SkinnedMesh(model.geometry, model.material);
    this.mesh.frustumCulled = false;
    this.mesh.userData.flash = 0;
    this.root.add(this.mesh);
    // the bones and the mesh share the root, so the bind matrix is the identity in creature space
    this.mesh.bind(new THREE.Skeleton(this.bones, model.inverseBind), new THREE.Matrix4());
    this.mixer = new THREE.AnimationMixer(this.root);
    // every clip's action (and its bindings to the bones) made now, not on its first play mid-fight
    for (const clip of model.clips.values()) this.mixer.clipAction(clip);
    this.root.name = `creature:${model.name}`;
  }

  /** Turn to look along world angle `a` (radians, 0 = +X). */
  face(a: number) {
    this.root.rotation.z = a + Math.PI / 2;
  }

  get playing() {
    return this.currentName;
  }

  play(name: string, opts: PlayOptions = {}) {
    const clip = this.model.clips.get(name);
    if (!clip) return null;
    const def = this.model.clip(name);
    const loop = opts.loop ?? def.loop;
    const a = this.mixer.clipAction(clip);
    a.enabled = true;
    a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    a.clampWhenFinished = !loop;
    a.timeScale = opts.speed ?? 1;
    if (this.current !== a) {
      a.reset();
      a.play();
      if (this.current) a.crossFadeFrom(this.current, opts.fade ?? 0.18, false);
    } else if (!loop) {
      a.reset().play();
    }
    this.current = a;
    this.currentName = name;
    return a;
  }

  /** Play a clip once; resolves when it ends (or at once if it doesn't exist). */
  once(name: string, opts: Omit<PlayOptions, "loop"> = {}) {
    const a = this.play(name, { ...opts, loop: false });
    if (!a) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const done = (ev: { action: THREE.AnimationAction }) => {
        if (ev.action !== a) return;
        this.mixer.removeEventListener("finished", done as never);
        resolve();
      };
      this.mixer.addEventListener("finished", done as never);
    });
  }

  /** Where the blow lands in `name` (seconds), if it is an attack. */
  impact(name: string) {
    return this.model.clip(name)?.impact;
  }

  /** How hot the red ember glows (0..1): it eases toward this. */
  ember = 0;
  private emberNow = 0;

  /** Turn white-hot for a moment (0..1). */
  flash(amount = 1) {
    this.flashT = Math.max(this.flashT, amount);
  }

  /** The right hand (for thrown things and sparks) in world space. */
  hand(out = new THREE.Vector3()) {
    const i = this.model.entry.hand;
    return i >= 0 ? this.bones[i].getWorldPosition(out) : this.root.getWorldPosition(out).setZ(this.root.position.z + this.model.entry.height * 0.6);
  }

  update(dt: number) {
    this.mixer.update(dt);
    this.flashT = Math.max(0, this.flashT - dt * 6);
    this.mesh.userData.flash = this.flashT;
    this.emberNow += (this.ember - this.emberNow) * (1 - Math.exp(-dt * (this.ember > this.emberNow ? 14 : 4)));
    this.mesh.userData.ember = this.emberNow;
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    this.root.removeFromParent();
  }
}

/** Build every kind in the manifest from its blob. */
export function buildCreatures(manifest: CreatureManifest, blobs: Record<string, ArrayBuffer>) {
  const out = new Map<string, CreatureModel>();
  for (const [name, entry] of Object.entries(manifest.creatures)) {
    if (blobs[name]) out.set(name, new CreatureModel(name, entry, blobs[name]));
  }
  return out;
}
