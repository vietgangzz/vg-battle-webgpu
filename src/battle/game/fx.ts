/**
 * The film's effects as replayable clips.
 *
 * Every ring, spark burst, sword crescent, flare and flash light in the film is
 * already a set of per-frame tracks placed where the film's fighters stood. A
 * clip names those channels, the film frames they play over, and the fighter
 * pose they were placed around (the anchor). Firing a clip replays its frames
 * from the start, moved from the anchor to wherever the game needs it, so every
 * hit in the game lands with the film's own effect, timing and hit-stop.
 */
import * as THREE from "three/webgpu";

import type { ChannelSet, FilmScene } from "../runtime/scene";

export interface ClipDef {
  /** film frames the clip plays (inclusive) */
  from: number;
  to: number;
  /** the frame of the blow itself (hit tests and hit-stop line up with it) */
  impact: number;
  /** film root the effects were placed around: position (m) and yaw (degrees, 0 faces -Y) */
  anchor: { pos: [number, number, number]; yaw: number };
  channels: string[];
  /** also replays the compositor knobs (invert, flash, streaks, lens) over its frames */
  post?: boolean;
  /** stays on its last frame until released (the shattered ground of the ultimate) */
  hold?: boolean;
}

/** The pierce's shattered ground: rings of slabs, 6/11/16/21/26 per ring (vfx/big.slabs). */
const SLABS = [6, 11, 16, 21, 26].flatMap((n, ring) => Array.from({ length: n }, (_, i) => `slab_${ring}_${i}`));

/**
 * Film frames (24 fps) and placements from battle/choreo.py and fx_timeline.py.
 * Swings are anchored on the attacker's root; hits on the fighter struck (facing
 * the attacker), so sparks and halos land on whoever takes the blow.
 */
export const CLIPS = {
  // dashes: the ground ring and dust at take-off, the glowing streak along the path
  dashSora: {
    from: 103,
    to: 140,
    impact: 107,
    anchor: { pos: [0, -7.2, 0], yaw: 180 },
    channels: ["dash_ring_sora", "dash_dust_sora", "dash_streak_sora"],
  },
  dashKage: {
    from: 103,
    to: 140,
    impact: 107,
    anchor: { pos: [0, 7.2, 0], yaw: 0 },
    channels: ["dash_ring_kage", "dash_dust_kage", "dash_streak_kage"],
  },
  // the clash (a parry): rings, sparks both ways, the flare, the grind, the inverted frames
  clash: {
    from: 126,
    to: 176,
    impact: 130,
    anchor: { pos: [0, 0, 0], yaw: 180 },
    channels: [
      "clash_ring0",
      "clash_ring1",
      "clash_ring2",
      "clash_air",
      "clash_sparks",
      "clash_sparks_r",
      "clash_sparks_c",
      "grind",
      "clash_flare",
      "clash_light",
      "cr_clash_k",
      "cr_clash_s",
    ],
    post: true,
  },
  // SORA's spin slash (E1)
  spin: { from: 150, to: 170, impact: 157, anchor: { pos: [-0.2, -1.0, 0], yaw: 170 }, channels: ["cr_e1", "cr_e1b"] },
  spinHit: { from: 157, to: 176, impact: 157, anchor: { pos: [0.15, 1.15, 0], yaw: 0 }, channels: ["hit1_sparks", "hit1_light", "halo_e1"] },
  // KAGE's diagonal overhead (E2)
  diagonal: { from: 162, to: 182, impact: 168, anchor: { pos: [0, 0.96, 0], yaw: -5 }, channels: ["cr_e2"] },
  diagonalHit: { from: 168, to: 186, impact: 168, anchor: { pos: [0, -1.15, 0], yaw: 185 }, channels: ["hit2_sparks", "hit2_light", "halo_e2"] },
  // the X (E3): SORA's rising cut, KAGE's falling cut
  rising: { from: 174, to: 192, impact: 180, anchor: { pos: [0, -1.0, 0], yaw: 180 }, channels: ["cr_e3s"] },
  falling: { from: 174, to: 192, impact: 180, anchor: { pos: [0, 1.0, 0], yaw: 0 }, channels: ["cr_e3k"] },
  risingHit: { from: 180, to: 194, impact: 180, anchor: { pos: [0, 1.0, 0], yaw: 0 }, channels: ["hit3_sparks", "hit3_light"] },
  fallingHit: { from: 180, to: 194, impact: 180, anchor: { pos: [0, -1.0, 0], yaw: 180 }, channels: ["hit3_sparks", "hit3_light"] },
  // SORA's thrust (E4): the long stab streak
  thrust: { from: 187, to: 204, impact: 193, anchor: { pos: [0.1, -0.76, 0], yaw: 188 }, channels: ["cr_e4"] },
  thrustHit: { from: 193, to: 206, impact: 193, anchor: { pos: [-0.1, 1.15, 0], yaw: 0 }, channels: ["hit4_sparks", "hit4_light", "halo_e4"] },
  // KAGE's slam and the ground wave racing out of it
  slam: {
    from: 199,
    to: 236,
    impact: 205,
    anchor: { pos: [0, 0.95, 0], yaw: 0 },
    channels: ["cr_slam", "smash_ring", "smash_sparks", "smash_flare", "smash_light", "wave0", "wave1", "wave_scar"],
    post: true,
  },
  waveHit: { from: 209, to: 226, impact: 210, anchor: { pos: [0, -3.4, 0], yaw: 180 }, channels: ["halo_wave", "wave_hit_sparks", "wave_light"] },
  // blasted back: sparks off the dragged blade and a glowing furrow
  skid: { from: 210, to: 240, impact: 211, anchor: { pos: [0, -3.9, 0], yaw: 180 }, channels: ["skid_sparks", "furrow"] },
  // SORA's leap: the take-off ring, rocks and sparks (11.72 s)
  leap: { from: 278, to: 300, impact: 281, anchor: { pos: [0, -10, 0], yaw: 180 }, channels: ["leap_ring", "leap_rocks", "leap_sparks"] },
  // the ultimate: the heaven pierce and the ground shattering around it (13.9 s),
  // held just before the film's silence turns the world black and white
  pierce: {
    from: 326,
    to: 364,
    impact: 334,
    anchor: { pos: [0, 0.3, 0], yaw: 180 },
    channels: [
      "heaven_beam",
      "pierce_ring0",
      "pierce_ring1",
      "pierce_ring2",
      "pierce_sparks",
      "pierce_debris",
      "pierce_flare",
      "pierce_light",
      "pierce_pit",
      ...SLABS,
    ],
    post: true,
    hold: true,
  },
} satisfies Record<string, ClipDef>;

export type ClipName = keyof typeof CLIPS;

/** Film frame everything idles at between effects (all effects off, blades lit). */
export const AMBIENT_FRAME = 100;

const MAX_SLOTS = 12;
const DEG = Math.PI / 180;
const M = new THREE.Matrix4();

interface Playing {
  def: ClipDef;
  set: ChannelSet;
  start: number;
  slot: number;
}

export class FxDirector {
  /** per group: the film frame to sample (group 0 = ambient) */
  readonly frames = new Float32Array(MAX_SLOTS + 1);
  /** per group: film anchor -> game placement (null = as filmed) */
  readonly offsets: (THREE.Matrix4 | null)[] = [null];
  private readonly sets = new Map<ClipName, ChannelSet>();
  private playing: Playing[] = [];
  private readonly mats = Array.from({ length: MAX_SLOTS + 1 }, () => new THREE.Matrix4());

  constructor(private readonly fs: FilmScene) {
    for (const name of Object.keys(CLIPS) as ClipName[]) this.sets.set(name, fs.channels(CLIPS[name].channels));
    this.frames[0] = AMBIENT_FRAME;
    for (let i = 1; i <= MAX_SLOTS; i++) this.offsets.push(null);
  }

  /**
   * Play a clip at `now` (seconds), relocated so its anchor lands on `pos`
   * facing `yaw` (degrees). Returns seconds from now until its impact frame.
   */
  fire(name: ClipName, now: number, pos: THREE.Vector3, yaw: number, lead = 0) {
    const def = CLIPS[name] as ClipDef;
    // a channel plays one clip at a time: the newest takes it over
    this.playing = this.playing.filter((p) => p.def !== def);
    const used = new Set(this.playing.map((p) => p.slot));
    let slot = 1;
    while (used.has(slot) && slot < MAX_SLOTS) slot++;
    if (used.has(slot)) {
      this.playing.shift();
      slot = 1;
    }
    const a = def.anchor;
    // offset = placement * inverse(anchor)
    const off = this.mats[slot].makeRotationZ(yaw * DEG).setPosition(pos);
    M.makeRotationZ(a.yaw * DEG).setPosition(a.pos[0], a.pos[1], a.pos[2]).invert();
    off.multiply(M);
    this.offsets[slot] = off;
    // start `lead` seconds before the impact frame, so the blow lands on time
    const startFrame = Math.max(def.from, def.impact - lead * 24);
    this.playing.push({ def, set: this.sets.get(name)!, start: now - (startFrame - def.from) / 24, slot });
    return (def.impact - startFrame) / 24;
  }

  /** Advance to `now`: every playing clip's channels at its frame, the rest ambient. */
  update(now: number) {
    this.fs.resetGroups();
    this.playing = this.playing.filter((p) => p.def.hold || (now - p.start) * 24 + p.def.from <= p.def.to);
    for (const p of this.playing) {
      this.frames[p.slot] = Math.min(p.def.from + (now - p.start) * 24, p.def.to);
      this.fs.setGroup(p.set, p.slot);
    }
  }

  /** Stop a held clip (its channels go back to rest). */
  release(name: ClipName) {
    const def = CLIPS[name] as ClipDef;
    this.playing = this.playing.filter((p) => p.def !== def);
  }

  /** Film frames of the playing clips that drive the compositor. */
  postFrames(out: number[]) {
    out.length = 0;
    // a held clip's compositor beat is over once it rests on its last frame
    for (const p of this.playing) if (p.def.post && this.frames[p.slot] < p.def.to) out.push(this.frames[p.slot]);
    return out;
  }

  clear() {
    this.playing = [];
  }
}
