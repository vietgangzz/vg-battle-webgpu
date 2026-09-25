// Resolve the Blender node library to WGSL and compile it with Dawn (the engine react-native-webgpu uses).
import { create, globals } from "webgpu";
import tgpu, { d } from "typegpu";

import * as B from "../src/battle/runtime/blender";

Object.assign(globalThis, globals);

const main = tgpu.fn([d.vec3f], d.vec4f)((p) => {
  "use gpu";
  const a = B.noise3(p, 2, 3, 0.5, 2, 0);
  const b = B.noise4(p, 0.3, 1.5, 5, 0.62, 2, 0.4);
  const c = B.voronoiEdge(p, 0.22, 1);
  const e = B.whiteNoise(p) + B.facing(0.3, 0.7) + B.fresnel(0.5, 0.4, true);
  const f = B.mapSmooth(a, 0.2, 0.8, 0, 1) + B.pow(b, 2.5) + B.div(c, 0);
  const g = B.noise3Color(p, 1, 2, 0.5, 2, 0);
  return d.vec4f(g.x + f + e, a, b, c);
});

const wgsl = tgpu.resolve([main]);
console.log(wgsl.split("\n").length, "lines of WGSL");
const gpu = create([]);
const device = await (await gpu.requestAdapter())!.requestDevice();
const mod = device.createShaderModule({ code: wgsl });
const info = await mod.getCompilationInfo();
for (const m of info.messages) console.log(m.type, m.lineNum, m.message);
console.log(info.messages.filter((m) => m.type === "error").length ? "FAIL" : "OK");
if (process.argv.includes("--print")) console.log(wgsl);
