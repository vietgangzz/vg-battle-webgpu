/**
 * Renders the valley's animated enemies (headless, Dawn): a lineup at rest,
 * then every creature at a moment of each clip (walk, the blow landing, the
 * hit, the fall), and a side view to check which way they face.
 *
 *   node tools/run.mjs tools/creature-shots.ts --size 1280x720
 *   ./tools/to-png.sh tools/.out/creatures
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { setup } from "./dawn";

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const [W, H] = arg("--size", "1280x720").split("x").map(Number);
const out = arg("--out", "tools/.out/creatures");
const env = await setup(W, H);
const { THREE, fs, post, framing, tick, grab, renderer } = env;
const { MORNING } = await import("../src/battle/world/look");
const { applyLook } = await import("../src/battle/game/environment");
const { Actor } = await import("../src/battle/game/actor");
const { CreatureModel, Creature } = await import("../src/battle/world/creature");

const manifest = JSON.parse(readFileSync("src/battle/gen/creatures.json", "utf8"));
applyLook(fs, MORNING);
// the film's own cast out of the way
const sora = new Actor(fs, "hero");
fs.setExternal(sora.objects, true);
for (const n of sora.objects) fs.object(n).visible = false;
const KAGE = ["kage_body", "kage_eye0", "kage_eye1", "kage_band", "kage_hand_r", "kage_hand_l", "kage_blade", "kage_tail0", "kage_tail1"];
fs.setExternal(KAGE, true);
for (const n of KAGE) fs.object(n).visible = false;

// a meadow floor to stand on
const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 48), new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(0.16, 0.36, 0.07) }));
fs.scene.add(ground);

const names = Object.keys(manifest.creatures);
const cast = names.map((name, i) => {
  const bin = readFileSync(`assets/creatures/${manifest.creatures[name].file}`);
  const model = new CreatureModel(name, manifest.creatures[name], bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
  const c = new Creature(model);
  c.root.position.set((i - (names.length - 1) / 2) * 2.3, 0, 0);
  // looking at the camera (which looks down +Y)
  c.face(-Math.PI / 2);
  fs.scene.add(c.root);
  console.log(name, "tris", model.geometry.index!.count / 3, "bones", model.entry.bones.length, "clips", [...model.clips.keys()].map((k) => `${k}:${model.clip(k).duration.toFixed(2)}${model.clip(k).impact !== undefined ? `@${model.clip(k).impact}` : ""}`).join(" "));
  return c;
});

/** Pose every creature at a moment of a clip: t = seconds, or a function of the clip. */
const pose = (clip: string, at: (c: InstanceType<typeof Creature>) => number) => {
  for (const c of cast) {
    const name = c.model.clips.has(clip) ? clip : "idle";
    c.mixer.stopAllAction();
    c.mixer.clipAction(c.model.clips.get(name)!).reset().play();
    c.mixer.setTime(Math.min(at(c), c.model.clip(name).duration - 1e-3));
  }
};

type Shot = { name: string; clip: string; at: (c: InstanceType<typeof Creature>) => number; eye: [number, number, number]; look: [number, number, number] };
const front: Pick<Shot, "eye" | "look"> = { eye: [0, -6.2, 1.7], look: [0, 0, 1.05] };
const side: Pick<Shot, "eye" | "look"> = { eye: [7.5, -1.5, 1.7], look: [0, 0, 1.05] };
const shots: Shot[] = [
  { name: "lineup", clip: "idle", at: () => 0.4, ...front },
  { name: "walk", clip: "walk", at: (c) => c.model.clip("walk").duration * 0.3, ...front },
  { name: "attack", clip: "attack", at: (c) => c.impact("attack") ?? 0.5, ...front },
  { name: "attack-side", clip: "attack", at: (c) => c.impact("attack") ?? 0.5, ...side },
  { name: "hit", clip: "hit", at: (c) => c.model.clip("hit").duration * 0.35, ...front },
  { name: "death", clip: "death", at: () => 99, ...front },
  { name: "run-side", clip: "run", at: (c) => c.model.clip("run").duration * 0.25, ...side },
  { name: "special", clip: "attack2", at: (c) => c.impact("attack2") ?? c.impact("slam") ?? c.impact("cast") ?? 0.6, ...front },
];

mkdirSync(out, { recursive: true });
fs.pose([100], [null]);
await renderer.compileAsync(fs.scene, fs.camera);
let i = 0;
for (const s of shots) {
  pose(s.clip, s.at);
  // the "special" shot: each its own signature move
  if (s.name === "special") {
    for (const c of cast) {
      const sig = ["attack2", "slam", "cast"].find((k) => c.model.clips.has(k)) ?? "attack";
      c.mixer.stopAllAction();
      c.mixer.clipAction(c.model.clips.get(sig)!).reset().play();
      c.mixer.setTime(c.impact(sig) ?? c.model.clip(sig).duration * 0.5);
    }
  }
  for (let k = 0; k < 3; k++) {
    tick();
    fs.pose([100], [null]);
    fs.setCamera(new THREE.Vector3(...s.eye), new THREE.Vector3(...s.look), 0.42, framing);
    post.update(100);
    post.render();
  }
  await env.device.queue.onSubmittedWorkDone();
  writeFileSync(`${out}/s${String(i++).padStart(2, "0")}.${env.ext}`, await grab());
  console.log("shot", s.name);
}
writeFileSync(`${out}/size.txt`, `${W}x${H}\n`);
process.exit(0);
