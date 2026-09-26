/**
 * SORA's look in the game. The film lit the Little Giant with its own rig:
 * its toon bands read the light's intensity, and under the valley's strong
 * sun nearly all of the body falls in the lit band, with blotches wherever the
 * sculpt's small lumps turn away. In the game she is shaded by the sun's
 * direction on a smoothed, rounder normal, in the brand's two tones (the
 * film's own greens), with a clean highlight, a white rim on the lit side and
 * a lighter belly where the ground bounces light up, whatever the time of day.
 *
 * The ink line is the film's inverted hull, a fixed few millimetres thick:
 * from the game's camera it thins to a pixel or two and crawls as she moves.
 * Here it is pushed out with distance so it stays about the same width on
 * screen.
 */
import * as TSL from "three/tsl";
import * as THREE from "three/webgpu";

import type { FilmScene } from "../runtime/scene";
import { ENV_U } from "./shading";

/** the film's greens (m_sora_skin): shade and lit */
const SHADE = TSL.vec3(0.2, 0.42, 0.04);
const LIT = TSL.vec3(0.64, 0.9, 0.07);
/** outline width on screen, as a share of the view's height per metre of distance */
const LINE_K = TSL.uniform(0.0021).setGroup(TSL.renderGroup);

/**
 * The toon skin for one part of SORA. `centre` is where, in the part's own
 * space, its roundness is measured from (the body's middle; a hand's own).
 */
function skin(centre: [number, number, number]) {
  const m = new THREE.MeshBasicNodeMaterial();
  const c = TSL.modelWorldMatrix.mul(TSL.vec4(...centre, 1)).xyz;
  // a rounder normal: the sculpt's lumps smoothed toward the part's overall shape
  const round = TSL.positionWorld.sub(c).normalize();
  const n = TSL.mix(TSL.normalWorld.normalize(), round, 0.62).normalize();
  const l = ENV_U.sunDir.node.normalize();
  const v = TSL.cameraPosition.sub(TSL.positionWorld).normalize();
  const ndl = n.dot(l);
  // three tones like the film's (0 / 0.55 / 1), with crisp, slightly soft edges
  const level = TSL.smoothstep(-0.34, -0.28, ndl).mul(0.55).add(TSL.smoothstep(0.06, 0.12, ndl).mul(0.45));
  let col = TSL.mix(SHADE, LIT, level);
  // the ground's bounce lifts the shaded belly
  const belly = TSL.smoothstep(-0.05, -0.55, n.z).mul(TSL.float(1).sub(level));
  col = TSL.mix(col, TSL.mix(SHADE, LIT, 0.62), belly.mul(0.7));
  // tinted a little by the sun and the sky (warm at dusk)
  col = col.mul(TSL.mix(TSL.vec3(1, 1, 1), ENV_U.sunColor.node, 0.3)).add(ENV_U.skyHorizon.node.mul(0.035));
  // a clean highlight on the lit side
  const h = l.add(v).normalize();
  const spec = TSL.smoothstep(0.955, 0.97, n.dot(h)).mul(0.42);
  // a white rim where the lit side turns away
  const rim = TSL.smoothstep(0.7, 0.9, TSL.float(1).sub(n.dot(v).abs())).mul(TSL.smoothstep(-0.2, 0.3, ndl)).mul(0.4);
  col = col.add(TSL.vec3(1, 1, 0.85).mul(spec.add(rim)));
  m.colorNode = TSL.vec4(col, 1);
  m.fog = false;
  return m;
}

/** The ink line (the film's inverted hull), pushed out with distance to hold its width on screen. */
function line(baked: number) {
  const m = new THREE.MeshBasicNodeMaterial();
  m.colorNode = TSL.vec4(0.02, 0.025, 0.03, 1);
  const dist = TSL.cameraPosition.distance(TSL.positionWorld);
  // what the hull needs beyond what the film baked in (the shell's normals face inward)
  const extra = dist.mul(LINE_K).sub(baked).max(0);
  m.positionNode = TSL.positionLocal.sub(TSL.normalLocal.mul(extra));
  m.side = THREE.FrontSide;
  m.fog = false;
  return m;
}

/** Give SORA her game look (her meshes' skin and line; the film's own scene is another instance). */
export function restyleSora(fs: FilmScene) {
  const parts: [string, [number, number, number]][] = [
    ["sora_body", [0, 0, 0.62]],
    ["sora_hand_r", [0, 0, 0]],
    ["sora_hand_l", [0, 0, 0]],
  ];
  const ink = line(0.012);
  for (const [name, centre] of parts) {
    const mesh = fs.object(name);
    const mats = mesh.material as THREE.Material[];
    if (!Array.isArray(mats)) continue;
    mats[0] = skin(centre);
    if (mats[1]) mats[1] = ink;
  }
  const band = fs.object("sora_band");
  const bm = band.material as THREE.Material[];
  if (Array.isArray(bm) && bm[1]) bm[1] = ink;
  // the band in the head's space: the film's first frame places both
  const toBand = fs.filmed("sora_band", 0).invert().multiply(fs.filmed("sora_body", 0));
  thickenBand(band.geometry, fs.object("sora_body").geometry, toBand, 1.7);
}

const BINS = 48;

/**
 * The headband as the film's close-ups show it: a bold strip, not a thread.
 * Its height is scaled about its middle (the ring is level in its own space),
 * and each vertex moved up or down also moves in or out with the head: the
 * head swells below the band and narrows above it, so a taller band simply
 * stretched would sink into it where it widens (the strip broke up along her
 * side). How the head's radius changes with height is fitted round the ring,
 * smoothly, from the head's own vertices.
 */
function thickenBand(geo: THREE.BufferGeometry, head: THREE.BufferGeometry, toBand: THREE.Matrix4, k: number) {
  if (geo.userData.thickened) return;
  geo.userData.thickened = true;
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  let cx = 0;
  let cy = 0;
  let z0 = Infinity;
  let z1 = -Infinity;
  let ring = 0;
  for (let i = 0; i < pos.count; i++) {
    cx += pos.getX(i);
    cy += pos.getY(i);
    z0 = Math.min(z0, pos.getZ(i));
    z1 = Math.max(z1, pos.getZ(i));
  }
  cx /= pos.count;
  cy /= pos.count;
  for (let i = 0; i < pos.count; i++) ring += Math.hypot(pos.getX(i) - cx, pos.getY(i) - cy) / pos.count;
  const mid = (z0 + z1) / 2;
  const reach = ((z1 - z0) / 2) * k + 0.04;
  // per angle round the ring: a straight-line fit of the head's radius against height, near the band
  const sums = Array.from({ length: BINS }, () => [0, 0, 0, 0, 0]);
  const hp = head.getAttribute("position") as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const angle = (x: number, y: number) => ((Math.atan2(y, x) + Math.PI) / (2 * Math.PI)) * BINS;
  for (let i = 0; i < hp.count; i++) {
    v.fromBufferAttribute(hp, i).applyMatrix4(toBand);
    const dz = v.z - mid;
    if (Math.abs(dz) > reach) continue;
    const x = v.x - cx;
    const y = v.y - cy;
    const r = Math.hypot(x, y);
    // the head's skin only (not the mouth's inside)
    if (r < ring * 0.6) continue;
    const b = sums[Math.floor(angle(x, y)) % BINS];
    b[0]++;
    b[1] += dz;
    b[2] += r;
    b[3] += dz * dz;
    b[4] += dz * r;
  }
  // the fit's slope and its radius at the band's middle height, per angle
  const fits = sums.map(([n, sz, sr, szz, szr]) => {
    const d = n * szz - sz * sz;
    if (n < 4 || d < 1e-9) return null;
    const slope = (n * szr - sz * sr) / d;
    return { slope, at: (sr - slope * sz) / n };
  });
  const fill = (vals: number[]) =>
    vals.map((s, i) => {
      if (!Number.isNaN(s)) return s;
      for (let d = 1; d < BINS / 2; d++) {
        const a = vals[(i + d) % BINS];
        const b = vals[(i - d + BINS) % BINS];
        if (!Number.isNaN(a) || !Number.isNaN(b)) return Number.isNaN(a) ? b : Number.isNaN(b) ? a : (a + b) / 2;
      }
      return 0;
    });
  const smooth = (vals: number[], passes: number) => {
    for (let p = 0; p < passes; p++) vals = vals.map((s, i) => (vals[(i + BINS - 1) % BINS] + 2 * s + vals[(i + 1) % BINS]) / 4);
    return vals;
  };
  const slope = smooth(fill(fits.map((f) => f?.slope ?? NaN)), 3);
  const surface = smooth(fill(fits.map((f) => f?.at ?? NaN)), 2);
  const lerp = (vals: number[], x: number, y: number) => {
    const t = angle(x, y) - 0.5;
    const i = Math.floor(t);
    const f = t - i;
    return vals[(i + BINS) % BINS] * (1 - f) + vals[(i + 1 + BINS) % BINS] * f;
  };
  // where the head's skin comes through the band (it does, along her left side), the band stands out
  // of it: per angle, its innermost vertex is kept a few millimetres clear, the whole strip moved with it
  const inner = new Array<number>(BINS).fill(Infinity);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) - cx;
    const y = pos.getY(i) - cy;
    const z = mid + (pos.getZ(i) - mid) * k;
    const clear = Math.hypot(x, y) + lerp(slope, x, y) * (z - pos.getZ(i)) - (lerp(surface, x, y) + lerp(slope, x, y) * (z - mid));
    const b = Math.floor(angle(x, y)) % BINS;
    inner[b] = Math.min(inner[b], clear);
  }
  let push = inner.map((c) => (Number.isFinite(c) ? Math.max(0, 0.005 - c) : 0));
  // widened, then eased, so the strip bends out smoothly rather than stepping
  push = push.map((_, i) => Math.max(push[(i + BINS - 1) % BINS], push[i], push[(i + 1) % BINS]));
  push = smooth(push, 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) - cx;
    const y = pos.getY(i) - cy;
    const z = pos.getZ(i);
    const nz = mid + (z - mid) * k;
    const r = Math.hypot(x, y);
    const nr = r + lerp(slope, x, y) * (nz - z) + lerp(push, x, y);
    pos.setXYZ(i, cx + (x / r) * nr, cy + (y / r) * nr, nz);
  }
  pos.needsUpdate = true;
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
}

/** Keep the line's on-screen width steady for this view (vertical tangent of half the field, drawing height in pixels). */
export function setLineWidth(tanHalf: number, heightPx: number, px = 2.6) {
  LINE_K.value = (px * 2 * tanHalf) / Math.max(1, heightPx);
}
