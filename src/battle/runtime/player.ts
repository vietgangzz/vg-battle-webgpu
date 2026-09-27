/**
 * Owns the renderer, the posed scene and the compositor for one canvas.
 * The caller supplies time (the audio clock); the player turns it into a film
 * frame, poses everything, renders and presents.
 *
 * Performance: every pipeline is compiled and every post variant rendered
 * during load (no hitch at the first cut to a new effect), and the scene pass
 * resolution follows the measured frame time so the film holds its frame rate
 * on whatever GPU it lands on, while the canvas stays at the display's native
 * size.
 */
import * as THREE from "three/webgpu";

import { makeWebGPURenderer } from "@/lib/make-webgpu-renderer";

import type { Film } from "./film";
import { loadFilm } from "./load-film";
import { Post } from "./post";
import { DEFAULT_QUALITY, FilmScene, type Framing, type Quality } from "./scene";

export interface PlayerOptions {
  quality?: Partial<Quality>;
  /** region of the 16:9 film that always stays on screen */
  safeAspect?: number;
  /** target frame interval in ms (60 fps; 120 Hz screens show each frame twice) */
  frameBudget?: number;
  /** each step as it begins, and how far through it is (0..1) where it can say */
  onProgress?: (stage: string, fraction?: number) => void;
}

/** First frame after the film's opening fade from black: the intro idles here and the film resumes from it. */
const INTRO_FRAME = 16;

const easeInOut = (x: number) => {
  const t = Math.min(Math.max(x, 0), 1);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

const pingpong = (x: number, len: number) => {
  const m = x % (2 * len);
  return m < len ? m : 2 * len - m;
};

/** Resolution of the scene passes adapts within these bounds (fraction of native). */
const MIN_SCALE = 0.6;
const MAX_SCALE = 1.0;

export class FilmPlayer {
  private framing: Framing = { aspect: 16 / 9, safeAspect: 4 / 3 };
  private scale = MAX_SCALE;
  /** resolution held (see lockScale) */
  private locked = false;
  /** the lowest the scene passes' resolution may go (see adaptScale) */
  private minScale = MIN_SCALE;
  private avgInterval = 0;
  private lastRender = 0;
  private settle = 0;
  private lastFrame = 0;
  /** CPU time spent posing and submitting a game frame (smoothed), in ms */
  private drawMs = 0;

  private constructor(
    private readonly context: GPUCanvasContext & { present: () => void },
    readonly renderer: THREE.WebGPURenderer,
    readonly film: Film,
    readonly fs: FilmScene,
    readonly post: Post,
    private readonly budget: number,
  ) {}

  static async create(
    context: GPUCanvasContext & { present: () => void },
    size: { width: number; height: number; pixelRatio: number },
    opts: PlayerOptions = {},
  ) {
    const step = opts.onProgress ?? (() => {});
    step("renderer");
    const renderer = makeWebGPURenderer(context);
    // Blender "Standard" view: no tone curve, just the sRGB transfer
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(size.pixelRatio);
    renderer.setSize(size.width, size.height, false);
    await renderer.init();

    step("film");
    const film = await loadFilm();

    step("scene");
    const fs = new FilmScene(film, { ...DEFAULT_QUALITY, ...opts.quality });
    const post = new Post(renderer, fs, film);
    const player = new FilmPlayer(context, renderer, film, fs, post, opts.frameBudget ?? 1000 / 60);
    player.framing = { aspect: size.width / size.height, safeAspect: opts.safeAspect ?? 4 / 3 };

    step("shaders");
    const restore = fs.showAll();
    fs.update(0, player.framing);
    await renderer.compileAsync(fs.scene, fs.camera);
    await renderer.compileAsync(fs.volumes, fs.camera);
    restore();

    // first frame of every shot, then each compositor variant: all pipelines now exist
    step("warm-up");
    const cuts = film.manifest.cuts;
    cuts.forEach(([frame], i) => {
      player.draw(frame);
      step("warm-up", (i + 1) / cuts.length);
    });
    post.warmVariants();
    return player;
  }

  /** How the film frame maps onto the screen right now. */
  get view(): Framing {
    return this.framing;
  }

  get duration() {
    return this.film.duration;
  }

  /** frame rate actually delivered and the scene resolution scale it settled on */
  get stats() {
    return { fps: this.avgInterval ? Math.round(1000 / this.avgInterval) : 0, scale: this.scale, drawMs: this.drawMs };
  }

  /** Resize to a new layout (fold/unfold, rotation). Sizes in points. */
  setSize(width: number, height: number, pixelRatio: number) {
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.framing = { ...this.framing, aspect: width / height };
  }

  /**
   * Render the film at `seconds` (clamped to the last frame). Returns false when
   * skipped to hold the frame budget (a 120 Hz display calls twice per frame).
   */
  render(seconds: number, now = performance.now()) {
    const since = now - this.lastRender;
    if (this.lastRender && since < this.budget * 0.9) return false;
    this.adapt(since);
    this.lastRender = now;
    const last = this.film.manifest.frames - 1;
    this.draw(Math.min(Math.max(seconds * this.film.fps, 0), last));
    return true;
  }

  /**
   * The folded-screen intro: the opening shot's world idling, close on the hero.
   * `open` (0..1, driven by the caller once the phone unfolds) pulls the camera
   * back to the film's first frame and cuts the lime seam down the hinge; at 1
   * the picture is exactly frame 0, so the film starts without a cut.
   */
  standby(seconds: number, open: number, now = performance.now()) {
    const since = now - this.lastRender;
    if (this.lastRender && since < this.budget * 0.9) return false;
    this.adapt(since);
    this.lastRender = now;
    const e = easeInOut(open);
    // a slow ping-pong through the standoff's first beats keeps the tails and motes alive
    const idle = pingpong(seconds * this.film.fps * 0.5, 36);
    this.framing = { ...this.framing, intro: 1 - e };
    this.post.setSeam(Math.pow(Math.sin(Math.PI * Math.min(open * 1.4, 1)), 2) * 1.5);
    // the opened edges start blurred and resolve as the camera settles
    this.post.setUnfoldBlur(open > 0 ? Math.pow(1 - e, 1.3) : 0);
    this.draw(INTRO_FRAME + idle * (1 - e));
    return true;
  }

  /** Where the film picks up after the intro (its fade-in from black is skipped). */
  get introSeconds() {
    return INTRO_FRAME / this.film.fps;
  }

  /** Leave the intro: the film owns the camera from here. */
  endStandby() {
    this.framing = { ...this.framing, intro: 0 };
    this.post.setSeam(0);
    this.post.setUnfoldBlur(0);
  }

  /**
   * Render a frame posed by the caller (the game): `pose` sets up the scene and
   * compositor, then the frame is drawn and presented under the same pacing and
   * dynamic resolution as the film.
   */
  renderPosed(pose: () => void, now = performance.now()) {
    const since = now - this.lastRender;
    if (this.lastRender && since < this.budget * 0.9) return false;
    this.adapt(since);
    this.lastRender = now;
    const t0 = performance.now();
    pose();
    this.post.render();
    this.context.present();
    this.drawMs = this.drawMs * 0.9 + (performance.now() - t0) * 0.1;
    return true;
  }

  /** Draw the current frame again right away (after a resize, so no stale or stretched frame shows). */
  redraw() {
    this.draw(this.lastFrame);
  }

  private draw(frame: number) {
    this.lastFrame = frame;
    this.fs.update(frame, this.framing);
    this.post.update(frame);
    this.post.render();
    this.context.present();
  }

  /**
   * For a game stepping at a fixed 60 Hz: how many steps to take before drawing
   * on this display callback, or 0 to skip it. Tying the steps to the frames
   * actually shown (one per frame at a steady 60) keeps motion even; stepping
   * off the wall clock instead leaves some frames with no step and others with
   * two, and everything judders (worst on 120 Hz screens).
   */
  pace(now: number) {
    if (this.lastRender && now - this.lastRender < this.budget * 0.9) return 0;
    const since = this.lastRender ? now - this.lastRender : this.budget;
    // at most two: when frames run late, more steps per frame would only make them later still
    return Math.min(2, Math.max(1, Math.round(since / this.budget)));
  }

  /** Hold the scene passes at one resolution. */
  lockScale(scale = 1) {
    this.locked = true;
    this.scale = scale;
    this.post.setRenderScale(scale);
  }

  /**
   * Let the scene passes' resolution follow the frame rate, from full down to
   * `min` of native: the game on a phone whose GPU runs short (a 16 Pro Max
   * drew the valley at 25 frames a second at full size), while a device with
   * room to spare stays sharp.
   */
  adaptScale(min: number) {
    this.locked = false;
    this.minScale = min;
  }

  /** Dynamic resolution: step the scene passes down when frames run late, back up when there is headroom. */
  private adapt(interval: number) {
    if (!this.lastRender || interval > 250) return;
    if (this.locked) {
      this.avgInterval = this.avgInterval ? this.avgInterval * 0.9 + interval * 0.1 : interval;
      return;
    }
    this.avgInterval = this.avgInterval ? this.avgInterval * 0.9 + interval * 0.1 : interval;
    if (--this.settle > 0) return;
    let next = this.scale;
    if (this.avgInterval > this.budget * 1.15) next = Math.max(this.minScale, this.scale - 0.05);
    // back up only with room to spare (a frame's own work well under the budget, where it is known):
    // on a display that holds frames to 60 the interval never shows headroom, and stepping up at every
    // on-time frame had the picture pulse softer and sharper as it stepped down again
    else if (this.avgInterval < this.budget * 1.02 && (!this.drawMs || this.drawMs < this.budget * 0.7)) next = Math.min(MAX_SCALE, this.scale + 0.025);
    if (next !== this.scale) {
      // let the average see the new cost before moving again (longer before going back up)
      this.settle = next < this.scale ? 20 : 60;
      this.scale = next;
      this.post.setRenderScale(next);
    }
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.renderer.dispose();
  }
}
