/**
 * Puts a stage's look on the scene: its sky, sun, fog and water uniforms, the
 * light rig relit for day, and the film's own ground, fog volume and motes
 * hidden (or all of the film's world back, for the crimson plain).
 */
import type * as THREE from "three/webgpu";

import type { FilmScene } from "../runtime/scene";
import { ENV, setScalar, skyNode } from "./shading";
import type { Look } from "./stage";

/** Film objects that belong to the crimson plain only. */
const FILM_WORLD = ["ground", "haze", "motes"];

let sky: THREE.Scene["backgroundNode"] = null;

export function applyLook(fs: FilmScene, look: Look) {
  if (look.film) {
    fs.scene.backgroundNode = fs.filmBackground;
    fs.lightOverride = null;
    fs.setExternal(FILM_WORLD, false);
    return;
  }
  sky ??= skyNode() as unknown as THREE.Scene["backgroundNode"];
  fs.scene.backgroundNode = sky;
  fs.setExternal(FILM_WORLD, true);
  for (const name of FILM_WORLD) fs.object(name).visible = false;

  ENV.skyTop.set(...look.skyTop);
  ENV.skyHorizon.set(...look.skyHorizon);
  ENV.skyBelow.set(...look.skyBelow);
  ENV.sunDir.set(...look.sunDir).normalize();
  ENV.sunColor.set(...look.sunColor);
  ENV.cloudTint.set(...look.cloudTint);
  ENV.fogColor.set(...look.fogColor);
  if (look.waterDeep) ENV.waterDeep.set(...look.waterDeep);
  if (look.waterShallow) ENV.waterShallow.set(...look.waterShallow);
  if (look.cloudSeaLit) ENV.cloudSeaLit.set(...look.cloudSeaLit);
  if (look.cloudSeaShade) ENV.cloudSeaShade.set(...look.cloudSeaShade);
  setScalar("fogDensity", look.fogDensity);
  setScalar("fogHeight", look.fogHeight);
  setScalar("cloudCover", look.cloudCover);
  setScalar("sunSize", look.sunSize ?? 1);
  setScalar("stars", look.stars ?? 0);

  // day light: the key sun, a cool fill from the camera side, the ambient; the film's flashes stay
  const { key, fill, ambient } = look;
  fs.lightOverride = (r) => {
    const n = (v: number[]) => Math.hypot(v[0], v[1], v[2]) || 1;
    r.sunDir[0].set(key.dir[0] / n(key.dir), key.dir[1] / n(key.dir), key.dir[2] / n(key.dir), 0);
    r.sunRad[0].set(key.color[0] * key.strength, key.color[1] * key.strength, key.color[2] * key.strength, 0);
    r.sunDir[1].set(fill.dir[0] / n(fill.dir), fill.dir[1] / n(fill.dir), fill.dir[2] / n(fill.dir), 0);
    r.sunRad[1].set(fill.color[0] * fill.strength, fill.color[1] * fill.strength, fill.color[2] * fill.strength, 0);
    for (let i = 2; i < r.sunRad.length; i++) r.sunRad[i].set(0, 0, 0, 0);
    r.ambient.set(ambient[0], ambient[1], ambient[2]);
  };
}
