/**
 * Where the valley's frame time goes: renders one busy view many times with
 * parts of the world switched off in turn and prints the average (headless, Dawn).
 *
 *   node tools/run.mjs tools/world-bench.ts --size 1280x720
 */
import { readFileSync } from "node:fs";

import { setup } from "./dawn";

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const [W, H] = arg("--size", "1280x720").split("x").map(Number);
const env = await setup(W, H);
const { THREE, fs, post, framing, tick, renderer } = env;
const { WorldData } = await import("../src/battle/world/data");
const { World } = await import("../src/battle/world/world");
const { MORNING } = await import("../src/battle/world/look");
const { applyLook } = await import("../src/battle/game/environment");

const manifest = JSON.parse(readFileSync("src/battle/gen/world-ninh-binh.json", "utf8"));
const bin = readFileSync("assets/world/ninh-binh.bin");
const data = new WorldData(manifest, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
const world = new World(data, fs);
world.group.visible = true;
applyLook(fs, MORNING);
post.setLite(true);
for (const n of ["kage_body", "kage_eye0", "kage_eye1", "kage_band", "kage_hand_r", "kage_hand_l", "kage_blade", "kage_tail0", "kage_tail1"]) fs.object(n).visible = false;

const views: Record<string, [[number, number, number], [number, number, number]]> = {
  village: [[-110, -44, 4], [-96, -30, 1.5]],
  river: [[-92, -12, 4], [-70, 6, 1]],
  pagoda: [[40, 52, 12], [66, 78, 12]],
};
const set = (pred: (o: THREE.Object3D) => boolean, on: boolean) => world.group.traverse((o) => pred(o) && (o.visible = on));
const configs: [string, (on: boolean) => void][] = [
  ["all", () => {}],
  ["-meadow", (on) => set((o) => o.name === "world:meadow", on)],
  ["-hero", (on) => set((o) => o.name.startsWith("world:hero:"), on)],
  ["-water/reflection", (on) => set((o) => o.name === "world:water", on)],
  ["-mist", (on) => set((o) => o.name === "world:mist", on)],
  ["-plants", (on) => set((o) => /^world:(tree|shrub|bamboo|banana|rice|reed|lotus|boulder|karstShrub)/.test(o.name), on)],
  ["-karst", (on) => set((o) => o.name === "world:karst", on)],
  [
    "-volumes",
    (on) => {
      const p = post as unknown as { render: () => void; __r?: () => void };
      if (!on) {
        p.__r = p.render;
        p.render = function (this: typeof post) {
          const self = this as unknown as { fitTargets(): void; renderer: typeof renderer; fs: typeof fs; pipeline: { render(): void } };
          self.fitTargets();
          self.renderer.setRenderTarget(self.fs.sceneTarget);
          self.renderer.render(self.fs.scene, self.fs.camera);
          self.renderer.setRenderTarget(null);
          self.pipeline.render();
        };
      } else if (p.__r) p.render = p.__r;
    },
  ],
  [
    "scene-only",
    (on) => {
      const p = post as unknown as { render: () => void; __r?: () => void };
      if (!on) {
        p.__r = p.render;
        p.render = () => {
          renderer.setRenderTarget(null);
          renderer.render(fs.scene, fs.camera);
        };
      } else if (p.__r) p.render = p.__r;
    },
  ],
];
fs.pose([100], [null]);
await renderer.compileAsync(fs.scene, fs.camera);
// draw calls, triangles and CPU time of one frame, per view
for (const [vname, [eye, at]] of Object.entries(views)) {
  world.update(new THREE.Vector3(...eye));
  fs.setCamera(new THREE.Vector3(...eye), new THREE.Vector3(...at), 0.42, framing);
  for (let i = 0; i < 3; i++) {
    tick();
    post.render();
    await env.device.queue.onSubmittedWorkDone();
  }
  renderer.info.reset();
  const c0 = performance.now();
  tick();
  post.render();
  const cpu = performance.now() - c0;
  await env.device.queue.onSubmittedWorkDone();
  const total = performance.now() - c0;
  const r = renderer.info.render as unknown as { calls: number; drawCalls?: number; triangles: number };
  console.log(`${vname} info: calls ${r.drawCalls ?? r.calls} tris ${r.triangles} cpu ${cpu.toFixed(1)}ms total ${total.toFixed(1)}ms`);
  const byKind = new Map<string, number>();
  world.group.traverseVisible((o) => {
    if (!(o as THREE.Mesh).isMesh && !(o as THREE.Sprite).isSprite) return;
    const k = o.name.replace(/@.*/, "").replace(/^world:hero:.*/, "world:hero");
    byKind.set(k, (byKind.get(k) ?? 0) + 1);
  });
  console.log(`${vname} visible: ` + [...byKind].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join(" "));
}
for (const [vname, [eye, at]] of Object.entries(views)) {
  const line: string[] = [];
  for (const [cname, toggle] of configs) {
    toggle(false);
    world.update(new THREE.Vector3(...eye));
    const frame = async () => {
      tick();
      fs.pose([100], [null]);
      fs.setCamera(new THREE.Vector3(...eye), new THREE.Vector3(...at), 0.42, framing);
      post.update(100);
      post.render();
      await env.device.queue.onSubmittedWorkDone();
    };
    for (let i = 0; i < 5; i++) await frame();
    const t0 = performance.now();
    const N = 20;
    for (let i = 0; i < N; i++) await frame();
    line.push(`${cname} ${((performance.now() - t0) / N).toFixed(1)}`);
    toggle(true);
  }
  console.log(`${vname}: ${line.join(" | ")}`);
}
process.exit(0);
