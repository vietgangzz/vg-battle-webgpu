/**
 * Shared Node + Dawn setup for the tools: a WebGPU device, an offscreen
 * target posing as the canvas, the app's renderer, film, scene and compositor,
 * compiled and warmed up exactly like the app does it.
 */
import { readFileSync } from "node:fs";
import { create, globals } from "webgpu";

Object.assign(globalThis, globals);
const g = globalThis as Record<string, unknown>;
g.self ??= globalThis;
g.requestAnimationFrame ??= (cb: (t: number) => void) => setTimeout(() => cb(performance.now()), 16);
g.cancelAnimationFrame ??= (id: number) => clearTimeout(id);

const gpu = create([]);
Object.defineProperty(globalThis, "navigator", { value: { gpu, userAgent: "node" }, configurable: true });

export async function setup(W: number, H: number) {
  const THREE = await import("three/webgpu");
  const { Film } = await import("../src/battle/runtime/film");
  const { FilmScene, DEFAULT_QUALITY } = await import("../src/battle/runtime/scene");
  const { Post } = await import("../src/battle/runtime/post");

  const manifest = JSON.parse(readFileSync("src/battle/gen/film.json", "utf8"));
  const bin = readFileSync("assets/film/film.bin");
  const film = new Film(manifest, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
  const adapter = await gpu.requestAdapter();
  const device = await adapter!.requestDevice({
    requiredLimits: { maxColorAttachmentBytesPerSample: adapter!.limits.maxColorAttachmentBytesPerSample },
  });
  device.addEventListener("uncapturederror", (e: Event) => console.error("[gpu]", (e as unknown as { error: Error }).error.message));
  const format = gpu.getPreferredCanvasFormat();
  const target = device.createTexture({
    size: [W, H],
    format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING,
  });
  const canvas = { width: W, height: H, style: {}, addEventListener() {}, removeEventListener() {} };
  const context = {
    canvas,
    configure() {},
    unconfigure() {},
    getConfiguration() {
      return { device, format };
    },
    getCurrentTexture: () => target,
  };
  const renderer = new THREE.WebGPURenderer({
    canvas: canvas as unknown as HTMLCanvasElement,
    context: context as unknown as GPUCanvasContext,
    device,
    antialias: false,
  });
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  await renderer.init();
  const fs = new FilmScene(film, DEFAULT_QUALITY);
  const post = new Post(renderer, fs, film);
  const framing = { aspect: W / H, safeAspect: 4 / 3 };
  const restore = fs.showAll();
  fs.update(0, framing);
  await renderer.compileAsync(fs.scene, fs.camera);
  await renderer.compileAsync(fs.volumes, fs.camera);
  restore();
  const tick = () => (renderer as unknown as { _nodes: { nodeFrame: { update(): void } } })._nodes.nodeFrame.update();
  for (const [f] of film.manifest.cuts) {
    tick();
    fs.update(f, framing);
    post.update(f);
    post.render();
  }
  post.warmVariants();
  await device.queue.onSubmittedWorkDone();

  const bytesPerRow = Math.ceil((W * 4) / 256) * 256;
  const readback = device.createBuffer({ size: bytesPerRow * H, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  /** Read the target back as tightly packed BGRA/RGBA rows. */
  const grab = async () => {
    const enc = device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow }, [W, H]);
    device.queue.submit([enc.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(readback.getMappedRange());
    const rows = Buffer.alloc(W * H * 4);
    for (let y = 0; y < H; y++) rows.set(src.subarray(y * bytesPerRow, y * bytesPerRow + W * 4), y * W * 4);
    readback.unmap();
    return rows;
  };
  return { THREE, film, fs, post, renderer, device, framing, tick, grab, ext: format === "bgra8unorm" ? "bgra" : "rgba" };
}
