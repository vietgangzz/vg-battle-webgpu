/**
 * The cost of a fight (headless, Dawn): SORA beside a wild pack, slashing,
 * casting and throwing kiếm khí for several seconds while each frame's CPU and
 * GPU time is measured, against the same seconds spent just walking.
 *
 *   node tools/run.mjs tools/fight-profile.ts --pack 4
 */
import { readFileSync } from "node:fs";

import { setup } from "./dawn";

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const packIndex = Number(arg("--pack", "4"));
const env = await setup(Number(arg("--w", "1280")), Number(arg("--h", "720")));
const { THREE, fs, post, framing, tick, renderer } = env;
const { WorldData } = await import("../src/battle/world/data");
const { Explore } = await import("../src/battle/world/explore");
const { PACKS } = await import("../src/battle/world/monsters");
const { buildCreatures } = await import("../src/battle/world/creature");

const manifest = JSON.parse(readFileSync("src/battle/gen/world-ninh-binh.json", "utf8"));
const bin = readFileSync("assets/world/ninh-binh.bin");
const data = new WorldData(manifest, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
const cman = JSON.parse(readFileSync("src/battle/gen/creatures.json", "utf8"));
const cblobs: Record<string, ArrayBuffer> = {};
for (const name of Object.keys(cman.creatures)) {
  const b = readFileSync(`assets/creatures/${name}.bin`);
  cblobs[name] = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}
let pops = 0;
const player = {
  fs,
  post,
  view: framing,
  pace() {
    return 1;
  },
  renderPosed(pose: () => void) {
    tick();
    pose();
    post.render();
    return true;
  },
};
if (process.argv.includes("--fill")) {
  const { Meadow } = await import("../src/battle/world/grass");
  const proto = Meadow.prototype as unknown as { fill: (c: unknown) => void };
  const orig = proto.fill;
  proto.fill = function (c: unknown) {
    const t = performance.now();
    orig.call(this, c);
    console.log(`  meadow fill ${(performance.now() - t).toFixed(1)} ms`);
  };
}
const game = new Explore(player as never, data, { pop: () => pops++ }, buildCreatures(cman, cblobs));
game.start(true);
await game.warm((o) => renderer.compileAsync(o, fs.camera, fs.scene));
await renderer.compileAsync(fs.scene, fs.camera);
let t = 3;
for (let i = 0; i < 180; i++) game.frame((t += 1 / 60) * 1000);
const pack = PACKS[packIndex];
game.hero.place(new THREE.Vector3(pack.x - 9, pack.y, 0), 90);

const measure = async (label: string, seconds: number, act: (i: number) => void) => {
  const cpu: number[] = [];
  const gpu: number[] = [];
  const draws: number[] = [];
  renderer.info.autoReset = false;
  for (let i = 0; i < seconds * 60; i++) {
    act(i);
    renderer.info.reset();
    const c0 = performance.now();
    game.frame((t += 1 / 60) * 1000);
    const c1 = performance.now();
    draws.push(renderer.info.render.drawCalls);
    if (renderer.info.render.drawCalls > 260 && process.argv.includes("--spikes")) {
      const vis: string[] = [];
      fs.scene.traverseVisible((o) => {
        if ((o as { isMesh?: boolean }).isMesh && o.parent === fs.scene && !o.name.startsWith("world")) vis.push(o.name || o.type);
      });
      console.log(`  frame ${i}: ${renderer.info.render.drawCalls} draws, cpu ${(performance.now() - c0).toFixed(1)}ms; top-level visible: ${vis.join(" ")}`);
    }
    await env.device.queue.onSubmittedWorkDone();
    cpu.push(c1 - c0);
    if (process.argv.includes("--slow") && c1 - c0 > 16) console.log(`  slow ${label} frame ${i}: ${(c1 - c0).toFixed(1)} ms, ${renderer.info.render.drawCalls} draws`);
    gpu.push(performance.now() - c1);
  }
  const avg = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
  const p95 = (a: number[]) => [...a].sort((p, q) => p - q)[Math.floor(a.length * 0.95)];
  console.log(
    `${label}: cpu avg ${avg(cpu).toFixed(2)} p95 ${p95(cpu).toFixed(2)} max ${Math.max(...cpu).toFixed(1)} | gpu-wait avg ${avg(gpu).toFixed(2)} p95 ${p95(gpu).toFixed(2)} | draws avg ${avg(draws).toFixed(0)} max ${Math.max(...draws)}`,
  );
};
// one frame's draws, pass by pass (--passes)
if (process.argv.includes("--passes")) {
  const r = renderer as unknown as { render: (s: unknown, c: unknown) => unknown; getRenderTarget: () => { width: number; height: number; texture?: { name?: string } } | null };
  const orig = r.render.bind(r);
  const rows: string[] = [];
  r.render = (sc: unknown, c: unknown) => {
    const before = renderer.info.render.drawCalls;
    const out = orig(sc, c);
    const rt = r.getRenderTarget();
    const o = sc as { name?: string; type?: string; isQuadMesh?: boolean; children?: unknown[] };
    rows.push(`${String(renderer.info.render.drawCalls - before).padStart(4)}  ${o.type ?? "?"}:${o.name || ""}  rt ${rt ? `${rt.width}x${rt.height}` : "screen"}`);
    return out;
  };
  // every object drawn, by name, with its pass depth (reflection draws nest inside the main pass)
  const ro = renderer as unknown as { renderObject: (...a: unknown[]) => unknown };
  const origRO = ro.renderObject.bind(ro);
  const drawn = new Map<string, number>();
  ro.renderObject = (...a: unknown[]) => {
    const o = a[0] as { name?: string; parent?: { name?: string }; isInstancedMesh?: boolean };
    const rt = r.getRenderTarget();
    const oo = o as { type?: string; material?: { type?: string; name?: string }; geometry?: { type?: string; attributes?: Record<string, { count: number }> }; parent?: { name?: string; type?: string; parent?: { name?: string; type?: string } } };
    const anon = `?${oo.type}/${oo.material?.type}/${oo.geometry?.type}:${oo.geometry?.attributes?.position?.count}<${oo.parent?.type}:${oo.parent?.parent?.name ?? ""}`;
    const key = `${rt ? rt.width : "scr"} ${(o.name || o.parent?.name || anon).replace(/@.*/, "@")}`;
    drawn.set(key, (drawn.get(key) ?? 0) + 1);
    return origRO(...a);
  };
  renderer.info.autoReset = false;
  renderer.info.reset();
  game.frame((t += 1 / 60) * 1000);
  ro.renderObject = origRO;
  console.log(rows.join("\n"));
  console.log([...drawn].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${String(v).padStart(3)} ${k}`).join("\n"));
  const byMat = new Map<string, number>();
  fs.scene.traverseVisible((o) => {
    const m = o as { isMesh?: boolean; isInstancedMesh?: boolean; material?: unknown; name?: string; parent?: { name?: string } };
    if (!m.isMesh) return;
    const key = `${m.parent?.name || "-"}/${(m.name || "").replace(/[0-9@,:]+.*/, "")}`;
    byMat.set(key, (byMat.get(key) ?? 0) + 1);
  });
  console.log([...byMat].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => `${v} ${k}`).join("\n"));
  r.render = orig;
}
if (process.argv.includes("--tree")) {
  let all = 0;
  let auto = 0;
  const top = new Map<string, number>();
  fs.scene.traverse((o) => {
    all++;
    if (o.matrixAutoUpdate) auto++;
    let p = o;
    while (p.parent && p.parent !== fs.scene) p = p.parent;
    const k = `${p.name || p.type}`;
    top.set(k, (top.get(k) ?? 0) + 1);
  });
  console.log(`objects ${all}, auto-updating ${auto}, scene auto ${fs.scene.matrixAutoUpdate}`);
  console.log([...top].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${v} ${k}`).join("\n"));
}
// walk in: they notice, close in
await measure("approach", 3, () => game.setStick(0, 0.8));
game.setStick(0, 0);
// fight: slash in a rhythm, the skill, kiếm khí, the ultimate when it is ready
await measure("fight", 8, (i) => {
  if (i % 18 === 0) game.attack();
  if (i % 90 === 30) game.skill();
  if (i % 50 === 10) game.shoot();
  if (i % 120 === 60) game.ult();
  if (i % 70 === 40) game.dash();
});
await measure("after", 3, () => game.setStick(0.3, 0));
/** What one frame draws, by object (the reflection's draws counted apart). */
const census = () => {
  const ro = renderer as unknown as { renderObject: (...a: unknown[]) => unknown; getRenderTarget: () => { width: number } | null };
  const orig = ro.renderObject.bind(ro);
  const drawn = new Map<string, number>();
  ro.renderObject = (...a: unknown[]) => {
    const o = a[0] as { name?: string; type?: string; parent?: { name?: string; type?: string } };
    const rt = ro.getRenderTarget();
    const key = `${rt ? rt.width : "scr"} ${(o.name || `${o.type}<${o.parent?.name || o.parent?.type}`).replace(/@.*/, "@")}`;
    drawn.set(key, (drawn.get(key) ?? 0) + 1);
    return orig(...a);
  };
  game.frame((t += 1 / 60) * 1000);
  ro.renderObject = orig;
  const rows = [...drawn].sort((a, b) => b[1] - a[1]);
  console.log(`census: ${rows.reduce((p, r) => p + r[1], 0)} draws\n` + rows.slice(0, 40).map(([k, v]) => `${String(v).padStart(3)} ${k}`).join("\n"));
};
// a crowd: several packs on her at once, fought by the benchmark's own hands (--crowd N)
const crowd = Number(arg("--crowd", "0"));
if (crowd) {
  game.brawl(crowd);
  let peak = 0;
  await measure(`crowd x${crowd}`, 12, () => {
    const alive = (game as unknown as { monsters: { alive: boolean }[] }).monsters.filter((m) => m.alive).length;
    peak = Math.max(peak, alive);
  });
  console.log(`crowd peak ${peak} monsters alive at once`);
  if (process.argv.includes("--census")) census();
}
console.log(`pops ${pops}, level ${game.level}`);
process.exit(0);
