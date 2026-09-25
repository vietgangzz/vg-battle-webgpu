/**
 * Render film frames headless with Dawn (the WebGPU engine react-native-webgpu
 * ships on iOS/Android), using the app's own runtime: same generated shaders,
 * same scene, same compositor. For checking shaders compile, timing the
 * pipeline build, and comparing frames against the Blender render.
 *
 *   node tools/run.mjs tools/render-frames.ts --frames 10,130,334,430 --size 1280x720 --out tools/.out/frames
 *
 * Writes raw BGRA frames as <out>/f####.bgra plus a sizes file; convert with
 * tools/to-png.sh (ffmpeg).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { create, globals } from "webgpu";

Object.assign(globalThis, globals);
const g = globalThis as Record<string, unknown>;
g.self ??= globalThis;
g.requestAnimationFrame ??= (cb: (t: number) => void) => setTimeout(() => cb(performance.now()), 16);
g.cancelAnimationFrame ??= (id: number) => clearTimeout(id);

const gpu = create([]);
Object.defineProperty(globalThis, "navigator", { value: { gpu, userAgent: "node" }, configurable: true });

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const frames = arg("--frames", "10,130,334,430").split(",").map(Number);
const [W, H] = arg("--size", "1280x720").split("x").map(Number);
const out = arg("--out", "tools/.out/frames");
const safeAspect = Number(arg("--safe", String(4 / 3)));
/** skip the compositor: the scene straight to the screen (sRGB), for isolating shading from post */
const raw = process.argv.includes("--raw");
/** time every frame of the film back to back (GPU included) instead of writing images */
const bench = process.argv.includes("--bench");
const step = Number(arg("--step", "1"));
const quality = {
  ...(process.argv.includes("--novol") ? { volumeSteps: 0 } : {}),
  ...(process.argv.includes("--noreflect") ? { reflectionScale: 0 } : {}),
  ...(arg("--octaves", "") ? { maxOctaves: Number(arg("--octaves", "8")) } : {}),
  ...(arg("--vsteps", "") ? { volumeSteps: Number(arg("--vsteps", "24")) } : {}),
};

const THREE = await import("three/webgpu");
const { Film } = await import("../src/battle/runtime/film");
const { FilmScene, DEFAULT_QUALITY } = await import("../src/battle/runtime/scene");
const { Post } = await import("../src/battle/runtime/post");

const t0 = performance.now();
const log = (...a: unknown[]) => console.log(`[${String(Math.round(performance.now() - t0)).padStart(6)} ms]`, ...a);

const manifest = JSON.parse(readFileSync("src/battle/gen/film.json", "utf8"));
const bin = readFileSync("assets/film/film.bin");
const film = new Film(manifest, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
log("film", film.manifest.frames, "frames");

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
// a canvas + context pair that renders into our texture
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
log("renderer", format);

const fs = new FilmScene(film, { ...DEFAULT_QUALITY, ...quality });
const post = new Post(renderer, fs, film);
const framing = { aspect: W / H, safeAspect };
log("scene built");

const restore = fs.showAll();
fs.update(frames[0], framing);
await renderer.compileAsync(fs.scene, fs.camera);
await renderer.compileAsync(fs.volumes, fs.camera);
restore();
log("pipelines compiled");
// same warm-up as the app: first frame of every shot, then every compositor variant
for (const [f] of film.manifest.cuts) {
  (renderer as unknown as { _nodes: { nodeFrame: { update(): void } } })._nodes.nodeFrame.update();
  fs.update(f, framing);
  post.update(f);
  post.render();
}
post.warmVariants();
await device.queue.onSubmittedWorkDone();
log("warmed up");

const standbyAt = arg("--standby", "");
if (standbyAt) {
  // the folded-screen intro at several unfold progress values (0 = folded, 1 = film frame 0)
  mkdirSync(out, { recursive: true });
  const bytesPerRow = Math.ceil((W * 4) / 256) * 256;
  const readback = device.createBuffer({ size: bytesPerRow * H, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  for (const open of standbyAt.split(",").map(Number)) {
    (renderer as unknown as { _nodes: { nodeFrame: { update(): void } } })._nodes.nodeFrame.update();
    const e = open < 0.5 ? 4 * open ** 3 : 1 - (-2 * open + 2) ** 3 / 2;
    fs.update(16, { ...framing, intro: 1 - e });
    post.update(16);
    post.setSeam(Math.sin(Math.PI * Math.min(open * 1.4, 1)) ** 2 * 1.5);
    post.setUnfoldBlur(open > 0 ? (1 - e) ** 1.3 : 0);
    post.render();
    const enc = device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow }, [W, H]);
    device.queue.submit([enc.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(readback.getMappedRange());
    const rows = Buffer.alloc(W * H * 4);
    for (let y = 0; y < H; y++) rows.set(src.subarray(y * bytesPerRow, y * bytesPerRow + W * 4), y * W * 4);
    readback.unmap();
    writeFileSync(`${out}/s${String(Math.round(open * 100)).padStart(3, "0")}.bgra`, rows);
  }
  writeFileSync(`${out}/size.txt`, `${W}x${H}\n`);
  log("standby frames written");
  process.exit(0);
}

const profileAt = arg("--profile", "");
if (profileAt) {
  // GPU cost of each visible object alone at one frame (scene pass only, 4 repeats, median)
  const f = Number(profileAt);
  const timeRender = async (scene: InstanceType<typeof THREE.Scene>) => {
    const ts: number[] = [];
    for (let k = 0; k < 5; k++) {
      (renderer as unknown as { _nodes: { nodeFrame: { update(): void } } })._nodes.nodeFrame.update();
      const t = performance.now();
      renderer.render(scene, fs.camera);
      await device.queue.onSubmittedWorkDone();
      if (k > 0) ts.push(performance.now() - t);
    }
    return ts.sort((a, b) => a - b)[2];
  };
  fs.update(f, framing);
  const all = [...fs.scene.children];
  const visible = all.filter((o) => o.visible);
  const empty = new THREE.Scene();
  const base = await timeRender(empty);
  const rows: [string, number][] = [];
  for (const o of visible) {
    const solo = new THREE.Scene();
    const parent = o.parent;
    solo.add(o);
    rows.push([o.name || o.type, (await timeRender(solo)) - base]);
    parent?.add(o);
  }
  const bg = new THREE.Scene();
  bg.backgroundNode = fs.scene.backgroundNode;
  rows.push(["(sky)", (await timeRender(bg)) - base]);
  rows.sort((a, b) => b[1] - a[1]);
  log(`profile frame ${f} ${W}x${H}, empty ${base.toFixed(1)} ms, whole scene ${(await timeRender(fs.scene)).toFixed(1)} ms`);
  for (const [n, t] of rows.slice(0, 15)) log(`  ${t.toFixed(1).padStart(6)} ms  ${n}`);
  process.exit(0);
}

if (bench) {
  const times: number[] = [];
  const cpu: number[] = [];
  const last = film.manifest.frames - 1;
  for (let f = 0; f <= last; f += step) {
    const t = performance.now();
    (renderer as unknown as { _nodes: { nodeFrame: { update(): void } } })._nodes.nodeFrame.update();
    fs.update(f, framing);
    if (raw) {
      renderer.render(fs.scene, fs.camera);
    } else {
      post.update(f);
      post.render();
    }
    cpu.push(performance.now() - t);
    await device.queue.onSubmittedWorkDone();
    times.push(performance.now() - t);
  }
  const sorted = [...times].sort((a, b) => a - b);
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))].toFixed(1);
  const worst = times.map((t, f) => [t, f]).sort((a, b) => b[0] - a[0]).slice(0, 5);
  log(`bench ${W}x${H}: median ${pct(0.5)} ms, p90 ${pct(0.9)} ms, p99 ${pct(0.99)} ms`);
  const cs = [...cpu].sort((a, b) => a - b);
  log(`  of which JS encode: median ${cs[Math.floor(cs.length / 2)].toFixed(1)} ms`);
  log("slowest frames", worst.map(([t, f]) => `${f}:${t.toFixed(0)}ms`).join(" "));
  process.exit(0);
}

mkdirSync(out, { recursive: true });
const bytesPerRow = Math.ceil((W * 4) / 256) * 256;
const readback = device.createBuffer({ size: bytesPerRow * H, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
for (const f of frames) {
  const t = performance.now();
  // three advances its node frame in the animation loop; we render back to back, so step it here
  (renderer as unknown as { _nodes: { nodeFrame: { update(): void } } })._nodes.nodeFrame.update();
  fs.update(f, framing);
  if (raw) {
    renderer.render(fs.scene, fs.camera);
  } else {
    post.update(f);
    post.render();
  }
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow }, [W, H]);
  device.queue.submit([enc.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const src = new Uint8Array(readback.getMappedRange());
  const rows = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) rows.set(src.subarray(y * bytesPerRow, y * bytesPerRow + W * 4), y * W * 4);
  readback.unmap();
  writeFileSync(`${out}/f${String(f).padStart(4, "0")}.${format === "bgra8unorm" ? "bgra" : "rgba"}`, rows);
  log("frame", f, Math.round(performance.now() - t), "ms");
}
writeFileSync(`${out}/size.txt`, `${W}x${H}\n`);
renderer.dispose();
process.exit(0);
