/**
 * The Blender compositor (lib/post.py) as a TSL render pipeline, in the same order
 * (after laying the low-resolution volumes over the scene):
 * bloom wide -> bloom tight -> star streaks -> exposure -> lens distortion +
 * dispersion -> saturation -> impact invert -> flash -> vignette -> FXAA.
 * (The film's scope letterbox is left out: the app plays edge to edge.)
 * Every keyed knob reads its film track. Depth of field (EEVEE's, so before
 * the compositor), the star streaks and the unfold's progressive blur are
 * separate output variants, switched in only for the frames that use them.
 */
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { dof } from "three/addons/tsl/display/DepthOfFieldNode.js";
import { fxaa } from "three/addons/tsl/display/FXAANode.js";
import { gaussianBlur } from "three/addons/tsl/display/GaussianBlurNode.js";
import * as THREE from "three/webgpu";

import type { Film, Track } from "./film";
import type { FilmScene } from "./scene";
import { T } from "./tsl";

/** A compositor node (see tsl.ts for why these are untyped). */
type N = ReturnType<typeof T.float>;

/** Look constants matched by eye against the Blender render. */
export const LOOK = {
  // three's bloom sums five mips (weights 1 .. 0.2, about 3 in total); Blender's
  // glare strengths are 0.16 and 0.3, so they are divided by that sum here
  bloomWide: { strength: 0.16 / 3, radius: 0.62, threshold: 1.3 },
  bloomTight: { strength: 0.3 / 3, radius: 0.45, threshold: 2.0 },
  streakThreshold: 4.0,
  streakGain: 0.6,
  /** circle of confusion on a 36 mm sensor, metres */
  coc: 3e-5,
};

interface Knob {
  u: N;
  track?: Track;
}

export class Post {
  readonly pipeline: THREE.RenderPipeline;
  private readonly knobs: Knob[] = [];
  /** the unfold slash: a lime seam down the hinge line (0 = off) */
  private readonly seam = T.uniform(0.0);
  /** the unfold's progressive blur: the newly opened outer edges resolve last (0 = off) */
  private readonly unfoldBlur = T.uniform(0.0);
  private readonly focus = T.uniform(3.0);
  private readonly range = T.uniform(1.0);
  private readonly bokeh = T.uniform(1.0);
  /** output graphs by variant: DOF on/off x star streaks on/off (each costs passes only when used) */
  private readonly variants = new Map<string, N>();
  private readonly build: (dof: boolean, streak: boolean, blur: boolean) => N;
  private variant = "";
  private readonly streakKnob: Knob;
  private readonly renderer: THREE.WebGPURenderer;
  private renderScale = 1;
  private readonly size = new THREE.Vector2();

  constructor(
    renderer: THREE.WebGPURenderer,
    private readonly fs: FilmScene,
    film: Film,
  ) {
    const post = film.manifest.post;
    const knob = (key: string, def: number) => {
      const tr = post[key] ? film.track(post[key]) : undefined;
      const k: Knob = { u: T.uniform(tr ? tr.value(0) : def), track: tr };
      this.knobs.push(k);
      return k.u;
    };
    const streaks = knob("streaks.Strength", 0);
    const exposure = knob("exposure.Exposure", 0);
    const distortion = knob("lens.Distortion", 0);
    const dispersion = knob("lens.Dispersion", 0.012);
    const saturation = knob("grade.Saturation", 1.08);
    const impact = knob("impact.Factor", 0);
    const flash = knob("flash.Factor", 0);
    const vignette = knob("vignette", 0.55);

    // targets clear to transparent black: where no volume is drawn its alpha must be 0
    // (the final output forces alpha to 1)
    renderer.setClearAlpha(0);
    this.renderer = renderer;
    const viewZ = fs.sceneViewZ;
    // volumes ray-march at reduced resolution, then sit on the scene premultiplied
    const sceneColor = T.texture(fs.sceneTarget.texture, T.screenUV);
    const vol = T.texture(fs.volumeTarget.texture, T.screenUV);
    const color = T.vec4(T.add(T.mul(sceneColor.rgb, T.sub(1.0, vol.a)), vol.rgb), 1.0);

    const chain = (base: N, withStreaks: boolean, withBlur: boolean) => {
      // ---- glare
      // Blender's glare blooms only what exceeds the threshold (the excess, not the whole pixel)
      const bw = LOOK.bloomWide;
      const c1 = T.add(base, bloom(highlights(base, bw.threshold), bw.strength, bw.radius, 0));
      const bt = LOOK.bloomTight;
      const c2 = T.add(c1, bloom(highlights(c1, bt.threshold), bt.strength, bt.radius, 0));
      const c3 = withStreaks ? T.add(c2, T.mul(starStreaks(c2, LOOK.streakThreshold), T.mul(streaks, LOOK.streakGain))) : c2;
      // ---- exposure
      const c4 = T.mul(c3, T.exp2(exposure));
      // ---- lens: barrel distortion with per-channel dispersion (Blender Lens Distortion, Fit on)
      const c5 = lens(T.convertToTexture(c4), distortion, dispersion);
      // ---- grade, invert, flash
      const c6 = T.saturation(c5, saturation);
      const c7 = T.mix(c6, T.sub(1.0, c6), impact);
      const flashCol = T.vec3(1.0, 0.95, 0.9);
      const c8 = T.sub(1.0, T.mul(T.add(T.sub(1.0, flash), T.mul(flash, T.sub(1.0, flashCol))), T.sub(1.0, c7)));
      // ---- vignette: soft ellipse (Blender: 1.25 x 1.1 mask blurred 320 px)
      const e = T.length(T.div(T.sub(T.screenUV, 0.5), T.vec2(0.625, 0.55)));
      const mask = T.smoothstep(1.27, 0.73, e);
      const c9 = T.mul(c8, T.add(T.mul(mask, vignette), T.sub(1.0, vignette)));
      // the unfold slash: a thin hot core and a soft halo along the hinge (screen centre)
      const dx = T.abs(T.sub(T.screenUV.x, 0.5));
      const core = T.exp(T.negate(T.div(T.mul(dx, T.screenSize.x), T.mul(T.screenDPR, 1.2))));
      const halo = T.exp(T.negate(T.div(dx, 0.035)));
      const seamGlow = T.mul(T.add(T.mul(core, 4.0), T.mul(halo, 0.18)), this.seam);
      let c9s: N = T.add(c9, T.mul(T.vec3(0.66, 0.92, 0.07), seamGlow));
      if (withBlur) c9s = progressiveBlur(c9s, this.unfoldBlur);
      // antialiasing on the finished (display-range) image
      const c10 = T.vec4(fxaa(T.vec4(T.clamp(c9s, 0.0, 1.0), 1.0))).rgb;
      return T.vec4(c10, 1.0);
    };

    this.streakKnob = this.knobs[0];
    this.build = (withDof, withStreaks, withBlur) =>
      chain(withDof ? dof(color, viewZ, this.focus, this.range, this.bokeh) : color, withStreaks, withBlur);
    this.pipeline = new THREE.RenderPipeline(renderer, this.output(false, false, false));

  }

  /** Read this frame's knobs; switch DOF on the shots that use it. */
  update(frame: number) {
    for (const k of this.knobs) if (k.track) k.u.value = k.track.value(frame);

    const d = this.fs.dof;
    if (d) {
      const f = 0.035;
      const s = Math.max(d.focus, 0.1);
      this.focus.value = s;
      // distance from the focal plane where blur saturates, from the thin-lens CoC
      this.range.value = Math.max((s * s * d.fstop * LOOK.coc) / (f * f), 0.05);
      this.bokeh.value = THREE.MathUtils.clamp(2.8 / d.fstop, 0.5, 2.5);
    }
    this.select(!!d, this.streakKnob.u.value > 0, this.unfoldBlur.value > 0.001);
  }

  private output(withDof: boolean, withStreaks: boolean, withBlur: boolean) {
    const key = `${withDof}|${withStreaks}|${withBlur}`;
    let node = this.variants.get(key);
    if (!node) {
      node = this.build(withDof, withStreaks, withBlur);
      this.variants.set(key, node);
    }
    return node;
  }

  private select(withDof: boolean, withStreaks: boolean, withBlur: boolean) {
    const key = `${withDof}|${withStreaks}|${withBlur}`;
    if (key === this.variant) return;
    this.variant = key;
    this.pipeline.outputNode = this.output(withDof, withStreaks, withBlur);
    this.pipeline.needsUpdate = true;
  }

  render() {
    const r = this.renderer;
    this.fitTargets();
    r.setRenderTarget(this.fs.sceneTarget);
    r.render(this.fs.scene, this.fs.camera);
    r.setRenderTarget(this.fs.volumeTarget);
    r.render(this.fs.volumes, this.fs.camera);
    r.setRenderTarget(null);
    this.pipeline.render();
  }

  /** Keep the scene and volume targets at the drawing buffer size times their scales. */
  private fitTargets() {
    this.renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, Math.round(this.size.x * this.renderScale));
    const h = Math.max(1, Math.round(this.size.y * this.renderScale));
    const st = this.fs.sceneTarget;
    if (st.width !== w || st.height !== h) st.setSize(w, h);
    const vs = this.fs.quality.volumeScale;
    const vw = Math.max(1, Math.round(w * vs));
    const vh = Math.max(1, Math.round(h * vs));
    const vt = this.fs.volumeTarget;
    if (vt.width !== vw || vt.height !== vh) vt.setSize(vw, vh);
  }

  /** Render once with every output variant so none compiles mid-film. */
  warmVariants() {
    for (const withDof of [false, true]) {
      for (const withStreaks of [false, true]) {
        for (const withBlur of [false, true]) {
          this.select(withDof, withStreaks, withBlur);
          this.render();
        }
      }
    }
    this.variant = "";
  }

  /**
   * Resolution of the scene (and volume) passes relative to the canvas; the
   * compositor upsamples. The canvas itself stays at native size.
   */
  /** Intensity of the unfold slash down the hinge line. */
  setSeam(v: number) {
    this.seam.value = v;
  }

  /** Strength of the unfold's progressive blur (0 = sharp). */
  setUnfoldBlur(v: number) {
    this.unfoldBlur.value = v;
  }

  setRenderScale(scale: number) {
    this.renderScale = scale;
  }
}

/**
 * Progressive blur for the unfold: sharp along the hinge, rising to a heavy
 * blur at the outer edges (the halves of the screen that just opened), all
 * of it scaled by `amount` as the picture resolves.
 */
function progressiveBlur(input: N, amount: N) {
  const src = T.vec4(T.clamp(input, 0.0, 1.0), 1.0);
  const soft = T.vec4(gaussianBlur(src, null, 6, { resolutionScale: 0.5 })).rgb;
  const heavy = T.vec4(gaussianBlur(src, null, 16, { resolutionScale: 0.25 })).rgb;
  const k = T.mul(T.smoothstep(0.05, 0.48, T.abs(T.sub(T.screenUV.x, 0.5))), amount);
  const sharpToSoft = T.mix(T.vec3(src), soft, T.clamp(T.mul(k, 2.0), 0.0, 1.0));
  return T.mix(sharpToSoft, heavy, T.clamp(T.sub(T.mul(k, 2.0), 1.0), 0.0, 1.0));
}

/** The part of each pixel brighter than `threshold`, keeping its hue. */
function highlights(input: N, threshold: number) {
  const c = T.vec3(input);
  const lum = T.max(T.max(c.r, c.g), c.b);
  return T.vec4(T.mul(c, T.div(T.max(T.sub(lum, threshold), 0.0), T.max(lum, 1e-4))), 1.0);
}

/** Four-point star glare: bright pass at half resolution, smeared along both diagonals. */
function starStreaks(input: N, threshold: number) {
  const bright = T.rtt(highlights(input, threshold), null, null, { resolutionScale: 0.5, type: THREE.HalfFloatType });
  const texel = T.div(1.0, T.mul(T.screenSize, 0.5));
  const dirs = [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ];
  let sum: N = T.vec3(0.0);
  for (const [dx, dy] of dirs) {
    // taps spread out along the streak; each fades like Blender's 0.93 per iteration
    for (let k = 1; k <= 14; k++) {
      const w = Math.pow(0.93, k * 2) * 0.18;
      const reach = k * 1.5 + k * k * 0.35;
      const off = T.mul(T.vec2(dx * 0.7071, dy * 0.7071), T.mul(texel, reach));
      sum = T.add(sum, T.mul(bright.sample(T.add(T.screenUV, off)).rgb, w));
    }
  }
  return sum;
}

/** Radial lens distortion with RGB dispersion, scaled to fit the frame. */
function lens(tex: N, distortion: N, dispersion: N) {
  const d = T.sub(T.screenUV, 0.5);
  const r2 = T.dot(d, d);
  const channel = (i: number) => {
    const k = T.add(distortion, T.mul(dispersion, i * 0.5));
    const fit = T.div(1.0, T.add(1.0, T.mul(T.max(k, 0.0), 0.5)));
    return tex.sample(T.add(0.5, T.mul(d, T.mul(T.add(1.0, T.mul(k, r2)), fit))));
  };
  return T.vec3(channel(-1).r, channel(0).g, channel(1).b);
}
