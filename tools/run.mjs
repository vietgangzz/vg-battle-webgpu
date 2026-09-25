// Bundle a tools/*.ts entry with the TypeGPU plugin (same transform the app's Babel plugin does) and run it in Node.
import { build } from "esbuild";
import typegpu from "unplugin-typegpu/esbuild";
import { spawnSync } from "node:child_process";

// bare `three` (imported by three's addons) must be the WebGPU build, like the app's Metro resolver
const threeWebgpu = {
  name: "three-webgpu",
  setup(b) {
    b.onResolve({ filter: /^three$/ }, (a) => b.resolve("three/webgpu", { kind: a.kind, resolveDir: a.resolveDir }));
  },
};

const [entry, ...rest] = process.argv.slice(2);
const out = `tools/.out/${entry.replace(/.*\//, "").replace(/\.ts$/, ".mjs")}`;
await build({
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: out,
  external: ["webgpu"],
  plugins: [typegpu(), threeWebgpu],
  logLevel: "warning",
});
const r = spawnSync("node", [out, ...rest], { stdio: "inherit" });
process.exit(r.status ?? 1);
