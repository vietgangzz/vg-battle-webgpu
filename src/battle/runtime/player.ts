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
  onProgress?: (stage: string) => void;
}

/** Resolution of the scene passes adapts within these bounds (fraction of native). */
const MIN_SCALE = 0.6;
const MAX_SCALE = 1.0;

export class FilmPlayer {
  private framing: Framing = { aspect: 16 / 9, safeAspect: 4 / 3 };
  private scale = MAX_SCALE;
  private avgInterval = 0;
  private lastRender = 0;
  private settle = 0;

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
    for (const [frame] of film.manifest.cuts) player.draw(frame);
    post.warmVariants();
    return player;
  }

  get duration() {
    return this.film.duration;
  }

  /** frame rate actually delivered and the scene resolution scale it settled on */
  get stats() {
    return { fps: this.avgInterval ? Math.round(1000 / this.avgInterval) : 0, scale: this.scale };
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

  private draw(frame: number) {
    this.fs.update(frame, this.framing);
    this.post.update(frame);
    this.post.render();
    this.context.present();
  }

  /** Dynamic resolution: step the scene passes down when frames run late, back up when there is headroom. */
  private adapt(interval: number) {
    if (!this.lastRender || interval > 250) return;
    this.avgInterval = this.avgInterval ? this.avgInterval * 0.9 + interval * 0.1 : interval;
    if (--this.settle > 0) return;
    let next = this.scale;
    if (this.avgInterval > this.budget * 1.15) next = Math.max(MIN_SCALE, this.scale - 0.05);
    else if (this.avgInterval < this.budget * 1.02) next = Math.min(MAX_SCALE, this.scale + 0.025);
    if (next !== this.scale) {
      this.scale = next;
      this.post.setRenderScale(next);
      // let the average see the new cost before moving again
      this.settle = 20;
    }
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.renderer.dispose();
  }
}
