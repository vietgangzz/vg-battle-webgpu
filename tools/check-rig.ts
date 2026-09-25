/**
 * Checks the game's rig against the film: poses a fighter with a film pose and
 * compares every part's world matrix to the exported track at that frame.
 *
 *   node tools/run.mjs tools/check-rig.ts
 */
import { readFileSync } from "node:fs";
import * as THREE from "three/webgpu";

import { Film } from "../src/battle/runtime/film";
import { FilmScene } from "../src/battle/runtime/scene";
import { FighterRig, type Who } from "../src/battle/game/rig";
import * as P from "../src/battle/game/pose";

const manifest = JSON.parse(readFileSync("src/battle/gen/film.json", "utf8"));
const bin = readFileSync("assets/film/film.bin");
const film = new Film(manifest, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
const fs = new FilmScene(film);

const cases: { who: Who; frame: number; pos: [number, number, number]; yaw: number; pose: P.Pose }[] = [
  { who: "sora", frame: 0, pos: [0, -7, 0], yaw: 180, pose: P.IDLE },
  { who: "kage", frame: 0, pos: [0, 7, 0], yaw: 0, pose: P.IDLE },
  // 5.40 s snaps to the clash pose and holds it until 5.58 s
  { who: "kage", frame: 132, pos: [0, 1.05, 0], yaw: 0, pose: P.CLASH_K },
  { who: "sora", frame: 132, pos: [0, -1.05, 0], yaw: 180, pose: P.CLASH_S },
  // 6.75 s: spin slash ends, held H_SLASH (twist 0) until 7.0 s snaps toward PARRY
  { who: "sora", frame: 162.5, pos: [-0.2, -1.0, 0], yaw: 170, pose: P.pose(P.H_SLASH, { twist: 0 }) },
];

let worst = 0;
for (const c of cases) {
  const rig = new FighterRig(fs, c.who);
  rig.apply({ pos: new THREE.Vector3(...c.pos), yaw: c.yaw, pose: c.pose });
  for (const name of rig.names) {
    const want = fs.filmed(name, c.frame);
    const got = fs.object(name).matrix;
    let err = 0;
    for (let i = 0; i < 16; i++) err = Math.max(err, Math.abs(want.elements[i] - got.elements[i]));
    worst = Math.max(worst, err);
    console.log(`${c.who}@${c.frame} ${name.padEnd(14)} max |diff| ${err.toExponential(2)}`);
  }
}
console.log("worst", worst.toExponential(2));
process.exit(worst < 2e-3 ? 0 : 1);
