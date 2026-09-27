/**
 * Exploring the Ninh Bình valley. SORA is free to go anywhere: along the
 * towpath, over the stone bridge, up through the rice terraces to the pagoda.
 * The tiger lord's camps lie in wait (walk into one and it wakes, wave on
 * wave); wayside shrines, once lit, are where she wakes if she falls; lotus
 * spirits drift in hidden corners; Ông Ba Mươi, the tiger lord, holds the
 * pagoda courtyard. (Without the creature models, KAGE's shadows stand in for
 * his soldiers and the Shadow General for him.)
 *
 * Same fighters, moves, effects and combat as the stage roads (combat.ts);
 * the ground is the valley's terrain, the camera orbits under the thumb.
 *
 * It is also a small RPG: wild shadows roam the valley in packs, stronger
 * the deeper in they lurk; every knockout is experience, and levels make SORA
 * tougher and her blade heavier. Besides the blade she throws kiếm khí,
 * crescents of sword light, at range.
 */
import * as THREE from "three/webgpu";

import { Actor, type Kind, yawOf } from "../game/actor";
import { BossBrain, type Brain, BruteBrain, rng, ShadeBrain, Tokens } from "../game/ai";
import { COMBO_WINDOW, Combat, ENERGY_MAX, type Pop, SHOOT_COOLDOWN, SKILL_COOLDOWN, type SoundName } from "../game/combat";
import { applyLook } from "../game/environment";
import { restyleSora, setLineWidth } from "../game/mascot";
import { AMBIENT_FRAME, FxDirector } from "../game/fx";
import { BOLT_HIT, BOSS_ENTRY, SPAWN, TEMPEST_BOLT } from "../game/moves";
import { Orbs, TargetRing } from "../game/pickups";
import { ENV_U, Materials } from "../game/shading";
import type { FilmPlayer } from "../runtime/player";
import { Bolts } from "./bolts";
import type { CreatureModel } from "./creature";
import { Monster, type MonsterKind, PACKS, WaterOrbs } from "./monsters";
import type { WorldData } from "./data";
import { DUSK, MORNING, mixLook } from "./look";
import { Guide, type GroundQuery } from "./guide";
import { LotusBloom } from "./lotus";
import { CASTER, SunShadow } from "./sun-shadow";
import { FOCUS, LAMP, SHADOWS } from "./shaders";
import { OrbitCamera } from "./orbit";
import { boosts, cleanRanks, NO_RANKS, pointsEarned, type Ranks } from "./skills";
import { NO_REFLECT, World } from "./world";

export type ExplorePhase = "title" | "roam" | "camp" | "bossIntro" | "boss" | "clear" | "results" | "defeat";

export interface Objectives {
  shrines: [number, number];
  camps: [number, number];
  spirits: [number, number];
  boss: boolean;
  /** per shrine and per camp, in the manifest's order (for the map) */
  lit: boolean[];
  cleared: boolean[];
}

export interface ExploreHud {
  phase: ExplorePhase;
  hp: number;
  maxHp: number;
  boss: { hp: number; max: number; name: string; title: string } | null;
  banner: string;
  sub: string;
  combo: number;
  ultReady: boolean;
  /** two full charges: the lotus tempest */
  ult2Ready: boolean;
  /** a line of news: a shrine lit, a spirit found, a camp stirring */
  toast: string;
  objectives: Objectives;
  results: { time: number; maxCombo: number; kos: number; damage: number; spirits: number; rank: "S" | "A" | "B" | "C" } | null;
  /** SORA's level and her experience toward the next */
  level: number;
  xp: number;
  xpNext: number;
}

export interface ExploreMeters {
  energy: number;
  skill: number;
  /** the kiếm khí's cooldown (1 = just thrown) */
  shot: number;
  /** stamina for sprinting (1 = full), and whether it is spent (recovering) */
  stamina: number;
  winded: number;
  combo: number;
  /** enemy health bars: x, y (screen fractions), health 0..1, opacity, per slot */
  bars: number[];
  /** each bar's fighter level (0 = none) */
  levels: number[];
  /**
   * the way to the current objective: screen x, y (fractions), shown (0/1),
   * on screen (1) or pinned to the edge (0), distance (m), the edge arrow's
   * angle (radians, screen space, 0 = right), and what it is (0 shrine, 1 camp, 2 the General)
   */
  waypoint: number[];
  /** for the map: SORA's x, y and heading, the camera's heading (radians) */
  map: [number, number, number, number];
}

export interface ExploreEvents {
  hud?: (s: ExploreHud) => void;
  meters?: (m: ExploreMeters) => void;
  sound?: (name: SoundName) => void;
  pop?: (p: Pop) => void;
  /** SORA levelled up, or gained experience (to keep) */
  progress?: (level: number, xp: number, levelled: boolean) => void;
}

const DT = 1 / 60;
const SHADES = 10;
const BRUTES = 3;
const BAR_SLOTS = 8;
const CAMP_WAKE = 15;
const CAMP_LEASH = 34;

const V = new THREE.Vector3();
const V2 = new THREE.Vector3();
/** scratch for move(), kept apart from V/V2 (the actors' own updates use those through callbacks) */
const MOVE_A = new THREE.Vector3();
const WAY = new THREE.Vector3();
const GQ = new THREE.Vector3();
const MOVE_B = new THREE.Vector3();

interface Foe {
  actor: Actor;
  brain: Brain;
  active: boolean;
  camp: number;
}

const PACK_WAKE = 38;
const PACK_SLEEP = 62;
const PACK_AGGRO = 16;
const PACK_LEASH = 28;
const PACK_RESPAWN = 45;
const LEVEL_MAX = 30;
/** experience for a knockout, before the foe's level */
const XP: Record<Kind, number> = { hero: 0, shade: 10, brute: 26, captain: 160, boss: 160 };
/** experience from one level to the next */
export const xpNeed = (level: number) => Math.round(40 * level ** 1.55);

interface Pack {
  x: number;
  y: number;
  level: number;
  kinds: MonsterKind[];
  state: "asleep" | "out" | "gone";
  t: number;
}
/** the tiger lord's slams and roars ring the ground in amber */
const QUAKE: [number, number, number] = [1.6, 0.75, 0.2];
/** how many of each monster the valley can have out at once (the tiger lord's soldiers serve the packs and the camps) */
const HERD: Partial<Record<MonsterKind, number>> = { goblin: 8, gremlin: 8, dwarf: 3, river_demon: 5, golem: 3, tiger: 1 };
/** who answers a camp's call for a shadow (goblins and gremlins, turn about) or a brute */
const SOLDIER: Partial<Record<Kind, MonsterKind[]>> = { shade: ["goblin", "gremlin"], brute: ["dwarf"] };

interface Camp {
  x: number;
  y: number;
  z: number;
  waves: number;
  wave: number;
  state: "idle" | "active" | "cleared";
  pending: { kind: Kind; x: number; y: number; at: number }[];
  t: number;
}

export class Explore {
  readonly world: World;
  readonly hero: Actor;
  readonly boss: Actor;
  /** the tiger lord (when the creature models are loaded): the boss in the General's place */
  private readonly tiger: Monster | null = null;
  readonly fx: FxDirector;
  readonly camera = new OrbitCamera();
  readonly combat: Combat;
  private readonly foes: Foe[] = [];
  private readonly bossBrain = new BossBrain(23);
  private readonly tokens = new Tokens(2);
  private readonly mats: Materials;
  private readonly orbs: Orbs;
  private readonly ring: TargetRing;
  private readonly camps: Camp[];
  private readonly packs: Pack[];
  readonly bolts: Bolts;
  level = 1;
  xp = 0;
  /** sprinting: the button held, stamina left, spent (until it recovers), rest since the last sprint */
  private sprintHeld = false;
  private stamina = 100;
  private winded = false;
  private rested = 0;
  private sprintFx = 0;
  private readonly wanderRng = rng(77);
  private readonly monsters: Monster[] = [];
  private readonly waterOrbs = new WaterOrbs();
  /** the way to the next objective, drawn in the valley */
  private readonly guide = new Guide(NO_REFLECT);
  /** the lotus the tempest opens where she lands */
  private readonly lotus = new LotusBloom();
  /** real shadows from the sun for SORA, the monsters and the fighters */
  private readonly sunShadow = new SunShadow();
  private readonly groundQuery: GroundQuery = {
    height: (x, y) => this.world.ground.at(x, y),
    // the river (the paddies' shallow water is walked through)
    blocked: (x, y, z) => z < 0.02 || this.world.solidAt(GQ.set(x, y, z)),
  };
  private readonly shrines: { x: number; y: number; z: number; lit: boolean; lamp: THREE.Mesh }[];
  private readonly spirits: { mesh: THREE.Mesh; home: THREE.Vector3; found: boolean }[] = [];
  private readonly checkpoint = new THREE.Vector3();
  private checkpointYaw = 0;
  phase: ExplorePhase = "title";
  private phaseT = 0;
  private clock = 0;
  private toastUntil = 0;
  private later: { at: number; run: () => void }[] = [];
  readonly stick = new THREE.Vector2();
  guard = false;
  private readonly postFrames: number[] = [];
  private readonly externals: string[];
  private readonly motesTime;
  private readonly cloud;
  private hud: ExploreHud;
  private hudKey = "";
  private readonly meters: ExploreMeters = {
    energy: 0,
    skill: 0,
    shot: 0,
    stamina: 1,
    winded: 0,
    combo: 0,
    bars: new Array(BAR_SLOTS * 4).fill(0),
    levels: new Array(BAR_SLOTS).fill(0),
    waypoint: [0, 0, 0, 0, 0, 0, 0],
    map: [0, 0, 0, 0],
  };

  constructor(
    readonly player: FilmPlayer,
    data: WorldData,
    private readonly events: ExploreEvents = {},
    creatures: Map<string, CreatureModel> | null = null,
  ) {
    const fs = player.fs;
    this.world = new World(data, fs);
    const ground = (x: number, y: number) => this.world.ground.at(x, y);
    this.mats = new Materials(fs.reflection);
    this.hero = new Actor(fs, "hero");
    // SORA's game look (toon skin on the valley's sun, a steady ink line) and her headband streaming back
    restyleSora(fs);
    if (this.hero.tails) this.hero.tails.breeze = 1;
    this.boss = new Actor(fs, "captain");
    this.boss.remove();
    const foe = (kind: Kind, brain: Brain): Foe => ({ actor: new Actor(fs, kind), brain, active: false, camp: -1 });
    for (let i = 0; i < SHADES; i++) this.foes.push(foe("shade", new ShadeBrain(31 + i * 7)));
    for (let i = 0; i < BRUTES; i++) this.foes.push(foe("brute", new BruteBrain(9 + i * 3)));
    this.packs = PACKS.map((p) => ({ ...p, state: "asleep" as const, t: 0 }));
    for (const a of [this.hero, this.boss, ...this.foes.map((f) => f.actor)]) a.ground = ground;
    for (const f of this.foes) f.actor.remove();
    this.fx = new FxDirector(fs);
    this.combat = new Combat(this.fx, {
      targets: (me) => (me === this.hero ? this.targets() : [this.hero]),
      knockOut: (f, by) => this.knockOut(f, by),
      project: (p) => this.project(p),
      shake: (n) => this.camera.shake(n),
      sound: (n) => this.events.sound?.(n),
      pop: (p) => this.events.pop?.(p),
      // the shattered ground settles, then clears so the way stays open
      ultimate: () => this.after(3, () => this.fx.release("pierce")),
      shoot: (me) => this.throwBolt(me),
      tempest: (me) => this.tempest(me),
    });
    // the valley charges the ultimate twice over: the second full charge is the lotus tempest
    this.combat.energyCap = ENERGY_MAX * 2;
    // what casts a real shadow: SORA's parts (not her afterimages), the boss, the camps' fighters
    for (const a of [this.hero, this.boss, ...this.foes.map((f) => f.actor)])
      for (const p of a.rig.parts) if (!(a === this.hero && p.name === "sora_body")) SunShadow.cast(p);
    // SORA's body is 200k triangles: the sun's shadow map draws a plain egg of her size in its place
    // (a round jelly's shadow is an egg's; on the phone every one of those triangles was paid again)
    const body = this.hero.rig.parts.find((p) => p.name === "sora_body");
    if (body) {
      body.geometry.computeBoundingBox();
      const bb = body.geometry.boundingBox!;
      const egg = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 14), new THREE.MeshBasicNodeMaterial());
      bb.getCenter(egg.position);
      bb.getSize(egg.scale);
      egg.name = "sora_shadow";
      egg.layers.set(CASTER);
      body.add(egg);
    }
    for (const n of this.hero.objects) if (n.includes("tail")) SunShadow.cast(fs.object(n));
    this.bolts = new Bolts(
      (x, y) => this.world.ground.at(x, y),
      (p) => this.world.solidAt(p),
    );
    this.externals = this.hero.objects;
    this.motesTime = fs.drive("motes.Time", false);
    this.cloud = fs.drive("world.cloud_w", false);
    this.orbs = new Orbs(this.mats);
    this.ring = new TargetRing(this.mats);
    this.world.group.add(this.orbs.group, this.ring.mesh, this.bolts.group, this.waterOrbs.group, this.guide.group, this.lotus.group);
    // the wild monsters (when their models are loaded)
    if (creatures) {
      let seed = 5;
      for (const kind of Object.keys(HERD) as MonsterKind[]) {
        const model = creatures.get(kind);
        if (!model) continue;
        for (let i = 0; i < HERD[kind]!; i++) this.monsters.push(new Monster(kind, model, this.world.group, (seed += 7)));
      }
      for (const m of this.monsters) SunShadow.cast(m.body.root);
      this.tiger = this.monsters.find((m) => m.kind === "tiger") ?? null;
    }

    const m = data.manifest;
    this.camps = m.markers
      .filter((k) => k.type === "camp")
      .map((k) => ({ x: k.at[0], y: k.at[1], z: k.z, waves: k.waves ?? 2, wave: 0, state: "idle" as const, pending: [], t: 0 }));
    // the shrines' lamps: dark until lit
    const lampGeo = new THREE.IcosahedronGeometry(0.22, 2);
    this.shrines = m.markers
      .filter((k) => k.type === "shrine")
      .map((k) => {
        const lamp = new THREE.Mesh(lampGeo, this.mats.get("amber"));
        lamp.position.set(k.at[0], k.at[1] - 0.55, k.z + 1.25);
        lamp.visible = false;
        this.world.group.add(lamp);
        return { x: k.at[0], y: k.at[1], z: k.z, lit: false, lamp };
      });
    // lotus spirits: small pink lights drifting over their hiding places
    const spiritGeo = new THREE.IcosahedronGeometry(0.2, 2);
    const spiritMat = new THREE.MeshBasicNodeMaterial();
    spiritMat.color = new THREE.Color(4.5, 1.6, 2.4);
    spiritMat.fog = false;
    for (const s of m.spirits) {
      const mesh = new THREE.Mesh(spiritGeo, spiritMat);
      mesh.position.set(s.x, s.y, s.z);
      // a few pixels across the water: not worth a draw in the reflection
      mesh.layers.set(NO_REFLECT);
      this.world.group.add(mesh);
      this.spirits.push({ mesh, home: new THREE.Vector3(s.x, s.y, s.z), found: false });
    }
    this.hud = {
      phase: "title",
      hp: 0,
      maxHp: 1,
      boss: null,
      banner: "",
      sub: "",
      combo: 0,
      ultReady: false,
      ult2Ready: false,
      toast: "",
      objectives: { shrines: [0, 0], camps: [0, 0], spirits: [0, 0], boss: false, lit: [], cleared: [] },
      results: null,
      level: 1,
      xp: 0,
      xpNext: xpNeed(1),
    };
  }

  // ---------------------------------------------------------------- input
  attack() {
    this.combat.press("attack");
  }
  jump() {
    this.combat.press("jump");
  }
  dash() {
    this.combat.press("dash");
  }
  skill() {
    this.combat.press("skill");
  }
  ult() {
    this.combat.press("ult");
  }
  shoot() {
    this.combat.press("shoot");
  }
  setSprint(held: boolean) {
    this.sprintHeld = held;
  }
  finish() {}
  setStick(x: number, y: number) {
    this.stick.set(x, y);
  }
  setGuard(held: boolean) {
    this.guard = held;
  }
  look(dx: number, dy: number) {
    this.camera.look(dx, dy, this.clock);
  }

  // ---------------------------------------------------------------- flow
  /** Enter the valley (fresh, or back at the last lit shrine after a fall). */
  start(fresh = true) {
    this.backdropOn = false;
    const fs = this.player.fs;
    const m = this.world.data.manifest;
    this.world.group.visible = true;
    this.quietParticles(true);
    this.sunShadow.strength = 1;
    this.player.post.setLite(true);
    applyLook(fs, MORNING);
    this.shownDusk = -1;
    fs.setExternal(this.externals, true);
    fs.setExternal(["kage_body", "kage_eye0", "kage_eye1", "kage_band", "kage_hand_r", "kage_hand_l", "kage_blade", "kage_tail0", "kage_tail1", "kage_ghost1", "kage_ghost2", "kage_ghost3"], true);
    for (const n of ["kage_body", "kage_eye0", "kage_eye1", "kage_band", "kage_hand_r", "kage_hand_l", "kage_blade", "kage_tail0", "kage_tail1", "kage_ghost1", "kage_ghost2", "kage_ghost3"]) fs.object(n).visible = false;
    fs.drive("motes.Time", true);
    fs.drive("world.cloud_w", true);
    fs.blobSource = (out) => this.blobs(out);
    this.fx.clear();
    this.orbs.clear();
    this.bolts.clear();
    this.tokens.clear();
    for (const f of this.foes) {
      f.active = false;
      f.camp = -1;
      f.actor.remove();
    }
    for (const m of this.monsters) {
      m.remove();
      m.pack = -1;
    }
    this.waterOrbs.clear();
    for (const p of this.packs) {
      p.state = "asleep";
      p.t = 0;
    }
    this.boss.remove();
    this.applyLevel();
    // the valley's blows land with a shorter freeze than the stage roads' (it reads as lag on a fast screen)
    this.combat.stopScale = 0.65;
    this.stamina = 100;
    this.winded = this.sprintHeld = false;
    if (fresh) {
      const spawn = m.markers.find((k) => k.type === "spawn")!;
      this.checkpoint.set(spawn.at[0], spawn.at[1], 0);
      this.checkpointYaw = yawOf(new THREE.Vector2(Math.cos(((spawn.yaw ?? 0) * Math.PI) / 180), Math.sin(((spawn.yaw ?? 0) * Math.PI) / 180)));
      for (const c of this.camps) c.state = "idle";
      for (const s of this.shrines) {
        s.lit = false;
        s.lamp.visible = false;
      }
      for (const s of this.spirits) {
        s.found = false;
        s.mesh.visible = true;
      }
      this.hud.objectives.boss = false;
    }
    for (const c of this.camps) if (c.state === "active") c.state = "idle";
    // back from a fall: the General is waiting in his courtyard again
    this.hud.objectives.boss = false;
    this.hero.place(this.checkpoint, this.checkpointYaw);
    this.hero.target = null;
    this.combat.reset(!fresh);
    this.camera.reset(this.hero);
    this.later = [];
    this.hud.results = null;
    this.setPhase("title");
    this.say(fresh ? "NINH BÌNH" : "", fresh ? "TRÀNG AN · THE SHADOWED VALLEY" : "");
    if (fresh) this.toast(`Light the shrines · clear the camps · face ${this.tiger ? "the Tiger Lord" : "the Shadow General"} at the pagoda`, 6);
  }

  // ---------------------------------------------------------------- the title screen
  private backdropOn = false;
  /**
   * The title screen's backdrop: the valley itself at golden hour, the camera
   * drifting slowly round it, lanterns just lit. Draws a frame (at most the
   * frame budget allows); returns whether it did.
   */
  backdrop(now: number) {
    const fs = this.player.fs;
    const player = this.player;
    if (!this.backdropOn) {
      this.backdropOn = true;
      this.world.group.visible = true;
      this.quietParticles(true);
      player.post.setLite(true);
      fs.setExternal(this.externals, true);
      this.hero.remove();
      const kage = ["kage_body", "kage_eye0", "kage_eye1", "kage_band", "kage_hand_r", "kage_hand_l", "kage_blade", "kage_tail0", "kage_tail1", "kage_ghost1", "kage_ghost2", "kage_ghost3"];
      fs.setExternal(kage, true);
      for (const n of kage) fs.object(n).visible = false;
      fs.blobSource = (out) => {
        for (const o of out) o.set(0, 0, 0, 0);
      };
      this.fx.clear();
      this.bolts.clear();
      this.waterOrbs.clear();
      for (const m of this.monsters) m.remove();
      const look = 0.4;
      applyLook(fs, mixLook(MORNING, DUSK, look));
      LAMP.strength.node.value = 1 + 0.7 * look;
      this.world.evening = look;
      // no one to keep in view
      FOCUS.node.value.set(0, 0, -1000);
      for (const u of SHADOWS) (u.node.value as THREE.Vector4).w = 0;
      this.guide.hide();
      player.post.grade.saturation.value = 1.1;
      player.post.grade.contrast.value = 1.1;
      this.shownDusk = -1;
    }
    // from above the village, across the river to the pagoda hill and the towers behind it: a slow
    // drift of the lens and a lazy pan back and forth, like a camera on a crane at golden hour
    const t = now / 1000;
    const eye = V.set(-100 + 9 * Math.sin(t * 0.045), -64 + 7 * Math.cos(t * 0.037), 30 + 3 * Math.sin(t * 0.05));
    const at = V2.set(24 + 34 * Math.sin(t * 0.055), 46 + 10 * Math.cos(t * 0.043), 14);
    eye.z = Math.max(eye.z, this.world.ground.at(eye.x, eye.y) + 12);
    return player.renderPosed(() => {
      fs.pose(this.fx.frames, this.fx.offsets);
      player.post.update(AMBIENT_FRAME, []);
      this.cloud.value = (now / 1000) * 0.05;
      fs.setCamera(eye, at, Math.max(0.42, 0.46 / player.view.aspect), player.view);
      this.world.update(eye);
      this.updateMatrices();
    }, now);
  }

  /** Put the valley away (back to the film's world for the menu). */
  leave() {
    this.backdropOn = false;
    const fs = this.player.fs;
    this.world.group.visible = false;
    this.quietParticles(false);
    this.sunShadow.strength = 0;
    this.guide.hide();
    this.lotus.hide();
    // the film and the stages are graded as filmed, through the full chain
    this.player.post.setLite(false);
    this.player.post.grade.saturation.value = 1;
    this.player.post.grade.contrast.value = 1;
    fs.setExternal(this.externals, false);
    fs.setExternal(["kage_body", "kage_eye0", "kage_eye1", "kage_band", "kage_hand_r", "kage_hand_l", "kage_blade", "kage_tail0", "kage_tail1", "kage_ghost1", "kage_ghost2", "kage_ghost3"], false);
    fs.drive("motes.Time", false);
    fs.drive("world.cloud_w", false);
    fs.blobSource = null;
    this.fx.clear();
    this.bolts.clear();
    this.waterOrbs.clear();
    for (const m of this.monsters) m.remove();
    fs.resetGroups();
    for (const f of this.foes) f.actor.remove();
    this.boss.remove();
    this.ring.update(1, null);
  }

  private setPhase(p: ExplorePhase) {
    this.phase = p;
    this.phaseT = 0;
  }

  // ---------------------------------------------------------------- frame
  frame(now: number) {
    // as many 60 Hz steps as frames have passed since the last one shown (one, at a steady 60)
    const n = this.player.pace(now);
    if (n === 0) return false;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) this.step();
    this.stepMs = this.stepMs * 0.9 + (performance.now() - t0) * 0.1;
    return this.player.renderPosed(() => this.pose(), now);
  }

  /** CPU time spent stepping the simulation per frame (smoothed), in ms */
  stepMs = 0;

  private get time() {
    return this.combat.time;
  }

  private step() {
    this.phaseT += DT;
    this.clock += DT;
    const dt = this.combat.advance(DT);
    const hero = this.hero;
    if (this.later.length) {
      const due = this.later.filter((l) => l.at <= this.time);
      this.later = this.later.filter((l) => l.at > this.time);
      for (const l of due) l.run();
    }
    this.flow(dt);
    const control = this.phase === "roam" || this.phase === "camp" || this.phase === "boss";
    // the stick, relative to where the camera looks
    const yaw = this.camera.heading();
    const fx = Math.cos(yaw);
    const fy = Math.sin(yaw);
    if (control) {
      hero.wish.set(fx * this.stick.y + fy * this.stick.x, fy * this.stick.y - fx * this.stick.x);
      if (hero.wish.length() > 1) hero.wish.normalize();
    } else hero.wish.set(0, 0);

    this.sprint(control);
    hero.target = this.nearestFoe(8);
    if (control && dt > 0) {
      const move = this.combat.control(hero, this.guard, hero.target);
      if (move === "ult") this.say("HEAVEN PIERCE", "");
      else if (move === "ult2") {
        this.say("LOTUS TEMPEST", "SEN BÃO");
        // (the demo's tempest is the blow that fells the tiger lord)
        if (this.demo) {
          this.demoFinishing = true;
          this.demoWear(18);
        }
      }
    }
    for (const f of this.foes) if (f.active) f.actor.target = hero;
    this.boss.target = hero;
    if (dt > 0) {
      this.updatePacks(dt);
      this.autoBrawl(dt);
      for (const f of this.foes) {
        if (!f.active || f.actor.dead) continue;
        this.combat.obey(f.actor, f.brain.update(dt, this.time, f.actor, hero, this.tokens), hero);
      }
      const ctx = this.monsterCtx;
      for (const m of this.monsters) m.update(dt, this.time, hero, ctx);
      this.waterOrbs.update(dt);
      if (this.phase === "boss" && !this.boss.dead) this.combat.obey(this.boss, this.bossBrain.update(dt, this.time, this.boss, hero), hero);
    }

    this.move(hero, dt);
    if (!this.boss.dead) this.move(this.boss, dt);
    for (const f of this.foes) if (f.active) this.move(f.actor, dt);
    this.combat.resolve(hero);
    if (!this.boss.dead) this.combat.resolve(this.boss);
    for (const f of this.foes) if (f.active) this.combat.resolve(f.actor);
    this.separate();

    this.lotus.update(DT);
    this.bolts.update(dt, this.targets(), (foe, _at, heavy) => {
      (foe as unknown as Monster).aggro = true;
      this.combat.blast(this.hero, foe, heavy ? TEMPEST_BOLT : BOLT_HIT);
    });
    const got = this.orbs.update(dt || DT * 0.2, hero.pos);
    if (got) this.combat.gainEnergy(got * 4);
    this.ring.update(DT, hero.target);
    this.visit();
    this.fx.update(this.time);
    if (this.hud.toast && this.clock > this.toastUntil) this.hud.toast = "";
    const c = this.combat;
    this.meters.energy = c.energy / ENERGY_MAX;
    this.meters.skill = c.skillCooldown / (SKILL_COOLDOWN * c.heroBoost.skillCooldown);
    this.meters.shot = c.shootCooldown / (SHOOT_COOLDOWN * c.heroBoost.shootCooldown);
    this.meters.stamina = this.stamina / 100;
    this.meters.winded = this.winded ? 1 : 0;
    this.meters.combo = c.combo > 1 ? Math.max(0, c.comboT / COMBO_WINDOW) : 0;
    this.meters.map[0] = hero.pos.x;
    this.meters.map[1] = hero.pos.y;
    this.meters.map[2] = Math.atan2(hero.forward.y, hero.forward.x);
    this.meters.map[3] = this.camera.heading();
    this.sync();
  }

  /** Update a fighter and keep it out of solid things and deep water (a move in progress is shifted with it). */
  private move(a: Actor, dt: number) {
    const before = MOVE_A.copy(a.pos);
    a.update(dt, this.time);
    if (a.dead) return;
    const moved = MOVE_B.copy(a.pos);
    this.world.collide(a.pos, a.radius, before);
    if (a.action) a.action.startPos.add(moved.subVectors(a.pos, moved).setZ(0));
  }

  private flow(dt: number) {
    const hero = this.hero;
    switch (this.phase) {
      case "title":
        if (this.phaseT > 2.6) {
          this.setPhase("roam");
          this.say("");
        }
        break;
      case "roam": {
        // a camp wakes as SORA walks in
        const i = this.camps.findIndex((c) => c.state === "idle" && Math.hypot(hero.pos.x - c.x, hero.pos.y - c.y) < CAMP_WAKE);
        if (i >= 0) this.wakeCamp(i);
        const b = this.world.data.manifest.markers.find((k) => k.type === "boss")!;
        if (!this.hud.objectives.boss && Math.hypot(hero.pos.x - b.at[0], hero.pos.y - b.at[1]) < 17) this.wakeBoss();
        break;
      }
      case "camp": {
        const i = this.camps.findIndex((c) => c.state === "active");
        if (i < 0) {
          this.setPhase("roam");
          break;
        }
        const c = this.camps[i];
        c.t += dt;
        this.spawnDue(c, i);
        // ran away: the camp goes back to sleep
        if (Math.hypot(hero.pos.x - c.x, hero.pos.y - c.y) > CAMP_LEASH) {
          c.state = "idle";
          for (const f of this.foes) if (f.camp === i && f.active) {
            f.active = false;
            f.actor.remove();
          }
          for (const m of this.monsters) if (m.camp === i) m.remove();
          this.toast("The camp falls quiet again", 3);
          this.setPhase("roam");
          break;
        }
        if (
          !c.pending.length &&
          this.foes.every((f) => f.camp !== i || !f.active || f.actor.dead || f.actor.vanish >= 0) &&
          this.monsters.every((m) => m.camp !== i || m.down || m.dead)
        ) {
          if (c.wave + 1 < c.waves) this.startWave(c, c.wave + 1);
          else {
            c.state = "cleared";
            this.orbs.spawn(new THREE.Vector3(c.x, c.y, c.z), 8);
            this.say("CAMP CLEARED", "");
            this.after(1.8, () => this.say(""));
            this.setPhase("roam");
          }
        }
        break;
      }
      case "bossIntro":
        if (this.phaseT > 2.8) {
          this.setPhase("boss");
          this.say("");
        }
        break;
      default:
        break;
    }
  }

  private wakeCamp(i: number) {
    const c = this.camps[i];
    c.state = "active";
    this.setPhase("camp");
    this.say("AMBUSH", "");
    this.after(1.5, () => this.say(""));
    this.startWave(c, 0);
  }

  private startWave(c: Camp, w: number) {
    c.wave = w;
    c.t = 0;
    const n = 2 + w + (w === c.waves - 1 ? 0 : 0);
    const out: Camp["pending"] = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + w * 0.7;
      out.push({ kind: "shade", x: c.x + Math.cos(a) * 7, y: c.y + Math.sin(a) * 7, at: 0.5 + k * 0.35 });
    }
    if (w === c.waves - 1 && c.waves > 1) out.push({ kind: "brute", x: c.x, y: c.y + 6, at: 1.4 });
    c.pending = out;
    this.tokens.clear();
    if (w > 0) {
      this.say(`WAVE ${w + 1}`, "");
      this.after(1.3, () => this.say(""));
    }
  }

  /** soldiers called to the camps so far (goblins and gremlins answer turn about) */
  private called = 0;

  private spawnDue(c: Camp, camp: number) {
    const soldiers = this.monsters.some((m) => m.kind === "goblin");
    c.pending = c.pending.filter((p) => {
      if (c.t < p.at) return true;
      // the tiger lord's soldiers answer the call (waiting for one to come free if they are all out)
      if (soldiers) {
        const kinds = SOLDIER[p.kind] ?? [];
        const free = (k: MonsterKind) => this.monsters.find((x) => x.kind === k && x.dead && x.pack < 0 && x.camp < 0);
        const m = free(kinds[this.called++ % Math.max(1, kinds.length)]) ?? kinds.map(free).find((x) => x);
        if (!m) return true;
        m.place(p.x, p.y, this.world.ground.at(p.x, p.y), 2 + camp * 2, yawOf(V2.set(this.hero.pos.x - p.x, this.hero.pos.y - p.y, 0)));
        m.camp = camp;
        m.wake(this.time);
        this.fx.fire("dashKage", this.time, V.set(m.pos.x, m.pos.y, m.groundZ), m.yaw, 0.1);
        return false;
      }
      const f = this.foes.find((x) => x.actor.kind === p.kind && (!x.active || x.actor.dead));
      if (!f) return true;
      f.active = true;
      f.camp = camp;
      const a = f.actor;
      this.levelFoe(a, 2 + camp * 2);
      a.place(V.set(p.x, p.y, 0), yawOf(V2.subVectors(this.hero.pos, V)));
      a.play(SPAWN, this.hero);
      this.fx.fire("dashKage", this.time, V.set(a.pos.x, a.pos.y, a.groundZ), a.yaw, 0.1);
      return false;
    });
  }

  /** The lord steps out: in his courtyard, or (the demo) at `at`, facing `yaw` (degrees). */
  private wakeBoss(at?: { x: number; y: number; yaw: number }) {
    const b = this.world.data.manifest.markers.find((k) => k.type === "boss")!;
    this.hud.objectives.boss = true;
    this.setPhase("bossIntro");
    const tiger = this.tiger;
    if (tiger) {
      // Ông Ba Mươi steps out into his courtyard and roars
      const [x, y] = at ? [at.x, at.y] : b.at;
      tiger.place(x, y, this.world.ground.at(x, y), 6, at ? at.yaw : (b.yaw ?? 0));
      if (this.demoLordHp > 0) tiger.maxHp = tiger.hp = this.demoLordHp;
      tiger.wake(this.time);
      this.fx.fire("dashKage", this.time, V.set(tiger.pos.x, tiger.pos.y, tiger.groundZ), tiger.yaw, 0.05);
      this.say("TIGER LORD", "ÔNG BA MƯƠI · LORD OF THE PAGODA");
      return;
    }
    const boss = this.boss;
    this.levelFoe(boss, 6, 0.12, 0.1);
    boss.place(V.set(b.at[0], b.at[1], 0), b.yaw ?? 0);
    boss.play(BOSS_ENTRY, this.hero);
    this.after(0.55 * boss.scale, () => {
      this.fx.fire("dashKage", this.time, V.set(boss.pos.x, boss.pos.y, boss.groundZ), boss.yaw, 0.05);
      this.combat.hitStop(3, 0.3 * boss.scale);
      this.events.sound?.("slam");
    });
    this.say("SHADOW GENERAL", "HẮC TƯỚNG · LORD OF THE PAGODA");
  }

  /** Shrines to light and spirits to gather, as SORA passes by. */
  private visit() {
    const hero = this.hero;
    for (const s of this.shrines) {
      if (s.lit || Math.hypot(hero.pos.x - s.x, hero.pos.y - s.y) > 3.2) continue;
      s.lit = true;
      s.lamp.visible = true;
      this.checkpoint.set(s.x, s.y - 2.5, 0);
      this.checkpointYaw = hero.yaw;
      hero.hp = hero.maxHp;
      this.fx.fire("dashSora", this.time, V.set(s.x, s.y, s.z), 0, 0.05);
      this.toast("Shrine lit · health restored · new respawn point", 3.5);
      this.events.sound?.("clash");
    }
    const t = this.clock;
    for (const sp of this.spirits) {
      if (sp.found) continue;
      // past a few dozen metres a spirit is a speck: not drawn (each is a draw of its own)
      const far = Math.abs(sp.home.x - hero.pos.x) + Math.abs(sp.home.y - hero.pos.y) > 80;
      sp.mesh.visible = !far;
      if (far) continue;
      sp.mesh.position.set(sp.home.x + Math.sin(t * 0.9 + sp.home.y) * 0.3, sp.home.y + Math.cos(t * 0.7 + sp.home.x) * 0.3, sp.home.z + Math.sin(t * 1.7 + sp.home.x) * 0.25);
      sp.mesh.scale.setScalar(1 + 0.2 * Math.sin(t * 5 + sp.home.x));
      if (hero.pos.distanceTo(sp.mesh.position) < 1.8) {
        sp.found = true;
        sp.mesh.visible = false;
        this.combat.gainEnergy(20);
        const n = this.spirits.filter((x) => x.found).length;
        this.toast(`Lotus spirit ${n}/${this.spirits.length}`, 2.5);
        this.events.sound?.("block");
      }
    }
  }

  private knockOut(f: Actor, by: Actor) {
    // (in the demo nothing but the lotus tempest fells the tiger lord: before it, he hangs on)
    if (this.demo && f === this.lord && !this.demoFinishing) {
      f.hp = Math.max(1, f.maxHp * 0.06);
      return;
    }
    this.events.sound?.("down");
    if (f === this.hero) {
      f.defeat(by);
      this.setPhase("defeat");
      this.say("DEFEATED", "");
      return;
    }
    this.combat.stats.kos++;
    f.defeat(by);
    const m = f as unknown as Monster | Actor;
    const base = m instanceof Monster ? m.xp : XP[f.kind];
    this.gainXp(Math.round(base * (1 + 0.3 * (f.level - 1))), f);
    if (f === this.lord) {
      this.combat.slow = 1.1;
      this.orbs.spawn(f.pos, 10);
      this.setPhase("clear");
      this.say("VALLEY FREED", "NINH BÌNH");
      this.after(2.6, () => this.finishValley());
      return;
    }
    this.orbs.spawn(f.pos, (m instanceof Monster ? m.spec.heavy : f.kind === "brute") ? 7 : 3);
  }

  /** Who holds the pagoda: the tiger lord, or (without the creature models) the Shadow General. */
  private get lord(): Actor {
    return this.tiger ? (this.tiger as unknown as Actor) : this.boss;
  }

  /** The valley is freed: tally the journey. */
  private finishValley() {
    const c = this.combat;
    const spirits = this.spirits.filter((x) => x.found).length;
    let score = 0;
    score += this.clock < 420 ? 3 : this.clock < 600 ? 2 : 1;
    score += c.stats.maxCombo >= 25 ? 3 : c.stats.maxCombo >= 12 ? 2 : 1;
    score += c.stats.damage < 40 ? 3 : c.stats.damage < 100 ? 2 : 0;
    score += spirits >= 10 ? 2 : spirits >= 5 ? 1 : 0;
    this.hud.results = {
      time: this.clock,
      maxCombo: c.stats.maxCombo,
      kos: c.stats.kos,
      damage: c.stats.damage,
      spirits,
      rank: score >= 10 ? "S" : score >= 7 ? "A" : score >= 4 ? "B" : "C",
    };
    this.setPhase("results");
    this.say("");
  }

  private targets() {
    const out: Actor[] = [];
    for (const f of this.foes) if (f.active && f.actor.alive) out.push(f.actor);
    for (const m of this.monsters) if (m.alive) out.push(m as unknown as Actor);
    if (!this.boss.dead && this.boss.alive && (this.phase === "boss" || this.phase === "bossIntro")) out.push(this.boss);
    return out;
  }

  private nearestFoe(within: number) {
    let best: Actor | null = null;
    let bd = within;
    for (const a of this.targets()) {
      const d = a.pos.distanceTo(this.hero.pos);
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    return best;
  }

  private separate() {
    const all = [
      this.hero,
      ...(this.boss.dead ? [] : [this.boss]),
      ...this.foes.filter((f) => f.active && !f.actor.dead).map((f) => f.actor),
      ...this.monsters.filter((m) => m.alive && m.pos.distanceTo(this.hero.pos) < 25).map((m) => m as unknown as Actor),
    ];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const p = all[i];
        const q = all[j];
        if (p.down || q.down || p.airborne !== q.airborne) continue;
        V.subVectors(q.pos, p.pos).setZ(0);
        const d = V.length();
        const min = (p.radius + q.radius) * 1.1;
        if (d >= min || d < 1e-4) continue;
        V.multiplyScalar((min - d) / d / 2);
        p.pos.sub(V);
        q.pos.add(V);
        if (p.action) p.action.startPos.sub(V);
        if (q.action) q.action.startPos.add(V);
      }
    }
  }

  private blobs(out: THREE.Vector4[]) {
    let n = 0;
    const put = (a: Actor) => {
      if (n >= out.length || a.dead) return;
      a.rig.center(V);
      out[n++].set(V.x, V.y, V.z, 0.55 * a.scale);
    };
    put(this.hero);
    if (!this.boss.dead) put(this.boss);
    for (const f of this.foes) if (f.active) put(f.actor);
    // the monsters nearest SORA get the remaining shadows
    for (const m of this.monsters) {
      if (n >= out.length) break;
      if (m.dead || m.pos.distanceTo(this.hero.pos) > 30) continue;
      out[n++].set(m.pos.x, m.pos.y, m.pos.z + m.body.model.entry.height * 0.45, 0.42 * m.scale);
    }
    while (n < out.length) out[n++].set(0, 0, 0, 0);
  }

  private project(p: THREE.Vector3) {
    V2.copy(p).project(this.player.fs.camera);
    if (V2.z > 1 || V2.z < -1) return null;
    return { x: (V2.x + 1) / 2, y: (1 - V2.y) / 2 };
  }

  private updateBars() {
    const bars = this.meters.bars;
    let slot = 0;
    const put = (pos: THREE.Vector3, top: number, hp: number, max: number, level: number, show: boolean) => {
      if (slot >= BAR_SLOTS) return;
      const s = this.project(V.set(pos.x, pos.y, pos.z + top));
      const k = slot * 4;
      bars[k] = s ? s.x : -1;
      bars[k + 1] = s ? s.y : -1;
      bars[k + 2] = Math.max(0, hp / max);
      bars[k + 3] = s && show ? 1 : 0;
      this.meters.levels[slot] = level;
      slot++;
    };
    for (const f of this.foes) {
      const a = f.actor;
      if (!f.active || a.dead) continue;
      put(a.pos, 1.55 * a.scale, a.hp, a.maxHp, a.level, a.vanish < 0 && a.hp < a.maxHp);
    }
    // the wild monsters nearest SORA first; a bar shows once one has noticed her
    // (the boss has its own bar across the top)
    const near = this.monsters.filter((m) => m.alive && !m.spec.boss).sort((p, q) => p.pos.distanceToSquared(this.hero.pos) - q.pos.distanceToSquared(this.hero.pos));
    for (const m of near) put(m.pos, m.body.model.entry.height + 0.35, m.hp, m.maxHp, m.level, m.aggro && m.pos.distanceTo(this.hero.pos) < 30);
    for (; slot < BAR_SLOTS; slot++) bars[slot * 4 + 3] = 0;
  }

  // ---------------------------------------------------------------- drawing
  /** 0 = morning, 1 = dusk: where the valley's day stands, and what was last put on screen. */
  private dusk = 0;
  private shownDusk = -1;

  /** How far the day has gone: the shrines lit and camps cleared bring the evening on; the General comes at dusk. */
  private duskTarget() {
    if (["bossIntro", "boss", "clear", "results"].includes(this.phase)) return 1;
    const done = this.shrines.filter((s) => s.lit).length + this.camps.filter((c) => c.state === "cleared").length;
    return (0.8 * done) / Math.max(1, this.shrines.length + this.camps.length);
  }

  private daylight(dt: number, snap = false) {
    const target = this.duskTarget();
    this.dusk = snap ? target : this.dusk + (target - this.dusk) * (1 - Math.exp(-dt * 0.3));
    if (Math.abs(this.dusk - this.shownDusk) < 0.002) return;
    this.shownDusk = this.dusk;
    applyLook(this.player.fs, mixLook(MORNING, DUSK, this.dusk));
    // the valley is painted rich: fuller colour and a little more punch than the film
    this.player.post.grade.saturation.value = 1.12 - 0.05 * this.dusk;
    this.player.post.grade.contrast.value = 1.1;
    LAMP.strength.node.value = 1 + 0.7 * this.dusk;
    this.world.evening = this.dusk;
  }

  private pose() {
    const player = this.player;
    const fs = player.fs;
    this.daylight(DT);
    this.motesTime.value = 3 + (this.clock % 16);
    this.cloud.value = this.clock * 0.05;
    fs.pose(this.fx.frames, this.fx.offsets);
    player.post.update(AMBIENT_FRAME, this.fx.postFrames(this.postFrames));
    const foe = this.phase === "boss" || this.phase === "bossIntro" || this.phase === "clear" ? this.lord : this.hero.target;
    // on the bridge the lens rises to look down on her over the railings
    this.camera.high = this.world.onBridge(this.hero.pos.x, this.hero.pos.y) ? 1 : 0;
    this.camera.update(
      DT,
      this.clock,
      this.hero,
      foe,
      (x, y) => this.world.cameraFloor(x, y),
      (from, to) => this.world.clearance(from, to, 0.6),
    );
    // held upright the picture is narrow: widen the lens until it sees as far to the sides as it would lying down
    // a sprint widens the lens a touch: the speed reads in the edges of the frame
    const tanV = Math.max(0.42, 0.46 / player.view.aspect) * (1 + 0.09 * this.camera.sprint);
    fs.setCamera(this.camera.position, this.camera.target, tanV, player.view);
    setLineWidth(tanV, fs.sceneTarget.height);
    FOCUS.node.value.set(this.hero.pos.x, this.hero.pos.y, this.hero.pos.z + 0.8);
    this.world.update(this.camera.position);
    this.updateBars();
    this.updateWaypoint();
    this.updateShadows();
    this.updateMatrices();
    this.sunShadow.render(this.player.renderer, this.player.fs.scene, this.hero.pos, ENV_U.sunDir.node.value as THREE.Vector3);
    this.events.meters?.(this.meters);
  }

  private readonly shadowCast: { x: number; y: number; r: number; s: number; d: number }[] = Array.from({ length: 24 }, () => ({ x: 0, y: 0, r: 1, s: 0, d: 0 }));

  /**
   * Contact shadows: a soft dark pool on the ground under SORA and the
   * fighters nearest her, fainter the higher they leap (the valley's sun
   * casts no shadow maps; these keep everyone standing on the ground).
   */
  private updateShadows() {
    const hero = this.hero;
    const list = this.shadowCast;
    let n = 0;
    // each pool leans a little away from the sun, so it shows past the body that casts it
    const sun = ENV_U.sunDir.node.value as THREE.Vector3;
    const flat = Math.hypot(sun.x, sun.y) || 1;
    const lean = 0.3 * (1 - Math.min(1, Math.max(0, sun.z)));
    const add = (x: number, y: number, z: number, ground: number, r: number, s: number) => {
      if (n >= list.length) return;
      const lift = THREE.MathUtils.clamp((z - ground) / 2.5, 0, 0.85);
      const e = list[n++];
      e.x = x - (sun.x / flat) * lean * r;
      e.y = y - (sun.y / flat) * lean * r;
      e.r = r * (1 + lift * 0.3);
      e.s = s * (1 - lift);
      e.d = Math.hypot(x - hero.pos.x, y - hero.pos.y);
    };
    if (hero.alive || hero.hp > 0) add(hero.pos.x, hero.pos.y, hero.pos.z, hero.groundZ, 1.5, 0.62);
    for (const m of this.monsters) if (!m.dead && !m.down) add(m.pos.x, m.pos.y, m.pos.z, m.groundZ, m.radius * 2.4 + 0.45, 0.5);
    for (const f of this.foes) if (f.active && !f.actor.dead) add(f.actor.pos.x, f.actor.pos.y, f.actor.pos.z, f.actor.groundZ, 1.4, 0.5);
    if (!this.boss.dead && (this.phase === "boss" || this.phase === "bossIntro")) add(this.boss.pos.x, this.boss.pos.y, this.boss.pos.z, this.boss.groundZ, 1.8, 0.55);
    // SORA first, then the nearest
    const used = list.slice(0, n).sort((a, b) => a.d - b.d);
    for (let i = 0; i < SHADOWS.length; i++) {
      const u = SHADOWS[i].node.value as THREE.Vector4;
      const e = used[i];
      if (e && e.d < 40) u.set(e.x, e.y, e.r, e.s);
      else u.w = 0;
    }
  }

  /** The next thing to do, and where: the nearest unlit shrine, then the nearest camp, then the pagoda. */
  private objective(): { at: THREE.Vector3; kind: number } | null {
    const hero = this.hero.pos;
    const nearest = <T extends { x: number; y: number }>(list: T[]) =>
      list.reduce<T | null>((best, p) => (!best || Math.hypot(p.x - hero.x, p.y - hero.y) < Math.hypot(best.x - hero.x, best.y - hero.y) ? p : best), null);
    const shrine = nearest(this.shrines.filter((s) => !s.lit));
    if (shrine) return { at: WAY.set(shrine.x, shrine.y, shrine.z + 2.6), kind: 0 };
    const camp = nearest(this.camps.filter((c) => c.state !== "cleared"));
    if (camp) return { at: WAY.set(camp.x, camp.y, camp.z + 2.4), kind: 1 };
    const b = this.world.data.manifest.markers.find((k) => k.type === "boss");
    if (b && this.phase !== "clear" && this.phase !== "results") return { at: WAY.set(b.at[0], b.at[1], b.z + 3), kind: 2 };
    return null;
  }

  /** Where the objective marker goes: over the objective, or pinned to the screen's edge pointing toward it. */
  private updateWaypoint() {
    const w = this.meters.waypoint;
    const o = this.objective();
    const busy = this.phase === "camp" || this.phase === "boss" || this.phase === "bossIntro" || this.phase === "title";
    this.guide.update(DT, this.clock, this.hero.pos, o && !busy ? o.at : null, o?.kind ?? 0, this.phase === "roam", this.groundQuery);
    const dist = o ? Math.hypot(o.at.x - this.hero.pos.x, o.at.y - this.hero.pos.y) : 0;
    if (!o || busy || dist < 5) {
      w[2] = 0;
      return;
    }
    const cam = this.player.fs.camera;
    const c = V.copy(o.at).applyMatrix4(cam.matrixWorldInverse);
    const ndc = V2.copy(o.at).project(cam);
    const inFront = c.z < 0;
    const onScreen = inFront && Math.abs(ndc.x) < 0.86 && Math.abs(ndc.y) < 0.8;
    w[2] = 1;
    w[4] = dist;
    w[6] = o.kind;
    if (onScreen) {
      w[0] = (ndc.x + 1) / 2;
      w[1] = (1 - ndc.y) / 2;
      w[3] = 1;
      return;
    }
    // off screen: the direction in the camera's view (behind her it points down), pinned to an inset ellipse
    let ax = c.x;
    let ay = c.y;
    if (!inFront) ay = -Math.abs(ay) - Math.abs(c.z) * 0.5;
    const a = Math.atan2(ay, ax);
    w[0] = 0.5 + Math.cos(a) * 0.42;
    w[1] = 0.5 - Math.sin(a) * 0.36;
    w[3] = 0;
    w[5] = -a;
  }

  // ---------------------------------------------------------------- hud
  private bannerAt = 0;

  private say(banner: string, sub = "") {
    this.hud.banner = banner;
    this.hud.sub = sub;
    this.bannerAt = this.clock;
  }

  private toast(text: string, seconds: number) {
    this.hud.toast = text;
    this.toastUntil = this.clock + seconds;
  }

  private sync() {
    const h = this.hud;
    h.phase = this.phase;
    h.hp = Math.ceil(this.hero.hp);
    h.maxHp = this.hero.maxHp;
    const showBoss = this.phase === "bossIntro" || this.phase === "boss";
    const lord = this.lord;
    h.boss = showBoss
      ? { hp: Math.ceil(lord.hp), max: lord.maxHp, name: this.tiger ? "TIGER LORD" : "SHADOW GENERAL", title: this.tiger ? "ÔNG BA MƯƠI" : "HẮC TƯỚNG" }
      : null;
    h.combo = this.combat.combo;
    h.level = this.level;
    h.xp = this.xp;
    h.xpNext = xpNeed(this.level);
    h.ultReady = this.combat.energy >= ENERGY_MAX;
    h.ult2Ready = this.combat.energy >= ENERGY_MAX * 2;
    h.objectives.shrines = [this.shrines.filter((s) => s.lit).length, this.shrines.length];
    h.objectives.camps = [this.camps.filter((c) => c.state === "cleared").length, this.camps.length];
    h.objectives.spirits = [this.spirits.filter((s) => s.found).length, this.spirits.length];
    h.objectives.lit = this.shrines.map((s) => s.lit);
    h.objectives.cleared = this.camps.map((c) => c.state === "cleared");
    if (this.phase === "title" && this.phaseT > 2.4 && h.banner) this.say("");
    // one-off calls clear themselves
    if ((h.banner === "HEAVEN PIERCE" || h.banner === "LOTUS TEMPEST") && this.clock > this.bannerAt + 1.6) this.say("");
    const key = JSON.stringify(h);
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.events.hud?.({ ...h, boss: h.boss && { ...h.boss }, objectives: { ...h.objectives, lit: [...h.objectives.lit], cleared: [...h.objectives.cleared] }, results: h.results && { ...h.results } });
  }

  // ---------------------------------------------------------------- sprinting
  /**
   * The valley's pace: a roomier run than the stage roads, and a sprint while
   * the button is held that burns stamina (it refills after a short rest; run
   * it dry and she must catch her breath before sprinting again).
   */
  private sprint(control: boolean) {
    const hero = this.hero;
    const moving = control && hero.wish.length() > 0.3 && !hero.busy && !hero.airborne;
    const sprinting = this.sprintHeld && moving && !this.winded && this.stamina > 0;
    if (sprinting) {
      this.stamina = Math.max(0, this.stamina - 20 * this.boost.drain * DT);
      this.rested = 0;
      if (this.stamina <= 0) {
        this.winded = true;
        this.events.sound?.("down");
      }
      // a gust at her heels as the sprint starts, and again every so often
      this.sprintFx -= DT;
      if (this.sprintFx <= 0) {
        this.fx.fire("dashSora", this.time, V.set(hero.pos.x, hero.pos.y, hero.groundZ), hero.yaw, 0.02);
        this.sprintFx = 1.1;
      }
    } else {
      this.sprintFx = 0;
      this.rested += DT;
      if (this.rested > 0.6) this.stamina = Math.min(100, this.stamina + 32 * this.boost.regen * DT);
      if (this.winded && this.stamina >= 30) this.winded = false;
    }
    hero.speedMul = !control ? 1 : sprinting ? 2.0 : 1.18;
    this.camera.sprint += ((sprinting ? 1 : 0) - this.camera.sprint) * Math.min(1, DT * 3);
  }

  // ---------------------------------------------------------------- the ranged cast
  /** The flick reached its release: throw a crescent toward the locked-on foe, or the nearest one ahead. */
  /**
   * The lotus tempest at its height: a ring of ten crescents bursts out all
   * round her, a second, turned half a step, a beat later; then she lands in
   * a shock (the slam's ground wave, a pillar of light, the ground rings).
   */
  private tempest(me: Actor) {
    const ring = (turn: number) => {
      for (let k = 0; k < 10; k++) {
        const a = turn + (k / 10) * Math.PI * 2;
        this.bolts.fire(me.pos, V2.set(Math.cos(a), Math.sin(a), 0), null, true);
      }
      this.events.sound?.("wave");
      this.camera.shake(0.25);
    };
    const yaw = Math.atan2(me.forward.y, me.forward.x);
    // the spring: pink rings off the ground under her
    this.bolts.groundRing(V.set(me.pos.x, me.pos.y, me.groundZ), 5, true);
    ring(yaw);
    this.after(0.3, () => ring(yaw + Math.PI / 10));
    this.after(0.62, () => {
      const at = V.set(me.pos.x, me.pos.y, me.groundZ);
      this.bolts.flare(at, me.groundZ, true, false);
      // (the lotus's own sigil carries the landing: the shockwave ring would only wash it out)
      this.lotus.bloom(at, (x, y) => this.world.ground.at(x, y));
      this.combat.hitStop(5, 0.45);
      this.events.sound?.("slam");
      this.events.sound?.("clash");
    });
  }

  private throwBolt(me: Actor) {
    let target = me.target && me.target.alive ? me.target : null;
    if (!target) {
      let best = 30;
      for (const a of this.targets()) {
        const to = V.subVectors(a.pos, me.pos).setZ(0);
        const d = to.length();
        if (d < best && me.forward.dot(to.normalize()) > 0.55) {
          best = d;
          target = a;
        }
      }
    }
    const dir = target ? V2.subVectors(target.pos, me.pos).setZ(0).normalize() : me.forward.clone();
    this.bolts.fire(me.pos, dir, target);
    this.events.sound?.("wave");
  }

  /**
   * Compile, one at a time, what only appears mid-play (a monster of each
   * kind, the kiếm khí, the water orbs, the alert and the level-up flare), so
   * nothing stalls a frame the first time it shows. One at a time: things
   * sharing a texture must not be set up in parallel.
   */
  async warm(compile: (o: THREE.Object3D) => Promise<unknown>) {
    const group = this.world.group;
    const was = group.visible;
    group.visible = true;
    // the valley's scene pass is multisampled: every pipeline the film compiled for its own pass (its
    // effects above all) is compiled again for it, and the valley's own, so none compiles mid-fight
    const player = this.player;
    const lite = player.post.isLite;
    player.post.setLite(true);
    player.post.beginGamePass();
    const restore = player.fs.showAll();
    await compile(player.fs.scene);
    restore();
    player.post.endGamePass();
    if (!lite) player.post.setLite(false);
    const show = async (o: THREE.Object3D) => {
      const hidden: THREE.Object3D[] = [];
      o.traverse((c) => {
        if (!c.visible) {
          hidden.push(c);
          c.visible = true;
        }
      });
      await compile(o);
      for (const c of hidden) c.visible = false;
    };
    const kinds = new Set<string>();
    for (const m of this.monsters) {
      if (kinds.has(m.kind)) continue;
      kinds.add(m.kind);
      m.body.root.position.copy(this.hero.pos);
      await show(m.body.root);
      // and its shadow pass (a skinned caster needs its own), drawn once now rather than on its first appearance
      m.body.root.visible = true;
      m.body.root.updateMatrixWorld(true);
      const shadowWas = this.sunShadow.strength;
      this.sunShadow.strength = 1;
      this.sunShadow.render(this.player.renderer, this.player.fs.scene, this.hero.pos, ENV_U.sunDir.node.value as THREE.Vector3);
      this.sunShadow.strength = shadowWas;
      m.body.root.visible = false;
    }
    // then every monster at once, in the picture and in the shadow pass: each one's first draw sets up
    // its own GPU state (a pack appearing stalled a frame for it)
    const ring = V.copy(this.hero.pos);
    this.monsters.forEach((m, i) => {
      const a = (i / this.monsters.length) * Math.PI * 2;
      m.body.root.position.set(ring.x + Math.cos(a) * 4, ring.y + Math.sin(a) * 4, ring.z);
      m.body.root.visible = true;
      m.body.root.updateMatrixWorld(true);
    });
    const r = this.player.renderer;
    const shadowWas = this.sunShadow.strength;
    this.sunShadow.strength = 1;
    this.sunShadow.render(r, this.player.fs.scene, this.hero.pos, ENV_U.sunDir.node.value as THREE.Vector3);
    this.sunShadow.strength = shadowWas;
    const seen = this.world.group.visible;
    this.world.group.visible = true;
    this.player.post.setLite(true);
    this.player.post.beginGamePass();
    r.render(this.player.fs.scene, this.player.fs.camera);
    this.player.post.endGamePass();
    if (!lite) this.player.post.setLite(false);
    this.world.group.visible = seen;
    for (const m of this.monsters) m.body.root.visible = false;
    const alert = this.monsters[0]?.alertSprite;
    if (alert) await show(alert);
    await show(this.bolts.group);
    await show(this.waterOrbs.group);
    await show(this.guide.group);
    this.guide.hide();
    await show(this.lotus.group);
    this.lotus.hide();
    group.visible = was;
  }

  // ---------------------------------------------------------------- wild packs
  /** What the monsters need from the valley and the fight. */
  private readonly monsterCtx = {
    combat: null as unknown as Combat,
    tokens: this.tokens,
    orbs: this.waterOrbs,
    shake: (n: number) => this.camera.shake(n),
    ground: (x: number, y: number) => this.world.ground.at(x, y),
    collide: (m: Monster) => this.world.collide(m.pos, m.radius, V.copy(m.pos)),
    // a slam or a roar: an amber ring races out over the ground, and the thud
    quake: (at: THREE.Vector3, size: number) => {
      this.bolts.groundRing(at, size, false, QUAKE);
      this.events.sound?.("slam");
    },
  };

  private updatePacks(dt: number) {
    this.monsterCtx.combat = this.combat;
    if (this.phase !== "roam" && this.phase !== "camp" && this.phase !== "boss") return;
    const hero = this.hero;
    this.packs.forEach((p, i) => {
      const d = Math.hypot(hero.pos.x - p.x, hero.pos.y - p.y);
      if (p.state === "gone") {
        p.t -= dt;
        if (p.t <= 0 && d > PACK_WAKE + 8) p.state = "asleep";
        return;
      }
      if (p.state === "asleep") {
        // they appear a little beyond where they would notice her, so she sees them first
        if (d < PACK_WAKE && d > PACK_AGGRO + 3 && this.phase === "roam") this.spawnPack(i);
        return;
      }
      const members = this.monsters.filter((m) => m.pack === i);
      if (members.every((m) => !m.alive)) {
        // every one of them down: the pack is gone for a while (the bodies sink away on their own)
        if (members.every((m) => m.dead || m.down)) {
          p.state = "gone";
          p.t = PACK_RESPAWN;
          for (const m of members) m.pack = -1;
        }
        return;
      }
      const alive = members.filter((m) => m.alive);
      // one of them sees SORA or is struck: the whole pack turns on her
      if (alive.some((m) => m.aggro || m.hp < m.maxHp || m.pos.distanceTo(hero.pos) < PACK_AGGRO)) {
        if (!alive.every((m) => m.aggro)) this.events.sound?.("block");
        for (const m of alive) m.aggro = true;
      }
      // led too far from home: they give up and drift back, healing
      if (alive.some((m) => m.aggro) && d > PACK_LEASH + 8) for (const m of alive) m.aggro = false;
      if (d > PACK_SLEEP && alive.every((m) => !m.aggro)) {
        for (const m of members) {
          m.remove();
          m.pack = -1;
        }
        p.state = "asleep";
      }
    });
  }

  /**
   * The film's thirty-odd particle systems each cost a draw every frame (and
   * another in the river's reflection) even with nothing alive in them: in
   * the valley only the ones a playing clip drives are drawn, and no effect
   * is drawn in the reflection.
   */
  private quietParticles(on: boolean) {
    const fs = this.player.fs;
    fs.idleParticles = on ? new Set(["motes"]) : null;
    // the river mirrors the valley, SORA and the monsters; the film's effects (sparks, rings, the
    // ultimate's eighty rising slabs) are drawn once, not twice
    // (keeping whether it casts a shadow)
    for (const o of fs.placedObjects) {
      const casts = o.layers.isEnabled(CASTER);
      o.layers.set(on && !o.name.startsWith("sora_") ? NO_REFLECT : 0);
      if (casts) o.layers.enable(CASTER);
    }
    // the matrices are brought up to date once a frame here (updateMatrices), not by the renderer on every pass
    fs.scene.matrixWorldAutoUpdate = !on;
    // the mirror is redrawn every frame: kept one frame in two it slid against the moving camera on the
    // frames between, and the river flickered on the phone as SORA ran (the cost: a millisecond of the
    // CPU, and the mirror's triangles twice as often)
    fs.reflectEvery = 1;
  }

  /**
   * Every matrix in the scene, once a frame. Left to the renderer, the whole
   * scene (a thousand objects, most of them the world's, which never move)
   * would be walked and multiplied again for each pass that draws it: the
   * river's reflection as well as the picture. Hidden things are skipped:
   * anything shown this frame has been shown by now.
   */
  private updateMatrices() {
    const scene = this.player.fs.scene;
    const world = this.world;
    for (const c of scene.children) {
      if (!c.visible) continue;
      if (c !== world.group) c.updateMatrixWorld(true);
      else for (const w of c.children) if (w.visible && !world.frozen.has(w)) w.updateMatrixWorld(true);
    }
  }

  // ---------------------------------------------------------------- benchmark
  /** packs kept on SORA at once in the benchmark (0: off) */
  private brawling = 0;
  private brawlNext = 0;
  private brawlT = 0;

  // ---------------------------------------------------------------- the showcase demo (?demo=1)
  /** the showcase demo is running: SORA does not fall (a scripted run has to reach its end) */
  private demo = false;
  /** the tiger lord's health in the demo (0: the valley's own) */
  private demoLordHp = 0;
  /** the demo's lotus tempest is under way (the blow allowed to fell him) */
  private demoFinishing = false;

  /** The showcase demo sets out from where the valley starts; no camp springs an ambush on the way. */
  demoSetup() {
    this.demo = true;
    for (const c of this.camps) c.state = "cleared";
  }

  /**
   * The demo's tiger lord comes to SORA where she is (off the bridge): he
   * steps out `far` metres ahead of the lens, on dry open ground, facing her,
   * and roars; his health is `hp`, so the fight fits the reel.
   */
  demoLordNear(hp: number, far = 9) {
    const h = this.hero.pos;
    const ahead = this.camera.heading();
    const clear = (x: number, y: number) => {
      const z = this.world.ground.at(x, y);
      return z >= 0.25 && !this.world.solidAt(V.set(x, y, z));
    };
    // straight ahead if it is clear, else the nearest clear bearing either side (the river is close by)
    let x = h.x + Math.cos(ahead) * far;
    let y = h.y + Math.sin(ahead) * far;
    for (let k = 1; k <= 12 && !clear(x, y); k++) {
      const a = ahead + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.35;
      x = h.x + Math.cos(a) * far;
      y = h.y + Math.sin(a) * far;
    }
    this.demoLordHp = hp;
    this.wakeBoss({ x, y, yaw: (Math.atan2(h.y - y, h.x - x) * 180) / Math.PI });
  }

  /** The tiger lord, for the demo's thumbs: where he is, and whether a blow of his is on its way (null unless he is fighting). */
  demoLord(): { pos: THREE.Vector3; attacking: boolean; blowIn: number; hp: number; maxHp: number } | null {
    const t = this.tiger;
    return t && this.phase === "boss" && t.alive ? { pos: t.pos, attacking: t.attacking, blowIn: t.blowIn, hp: t.hp, maxHp: t.maxHp } : null;
  }

  /** The demo's thumb sees his wind-up and holds off: blows pressed a moment ago are not thrown after all (the guard can go up). */
  demoHoldOff() {
    const b = this.combat.buffer;
    b.attack = b.skill = b.shoot = b.jump = -1;
  }

  /** Whether the ultimate is still charged (the demo's thumb presses it again until it goes). */
  demoCharged() {
    return this.combat.energy >= ENERGY_MAX;
  }

  /** The tiger lord worn down to `hp` (no further): at half, he rages; the demo's lotus tempest fells him. */
  demoWear(hp: number) {
    const t = this.tiger;
    if (t?.alive) t.hp = Math.max(1, Math.min(t.hp, hp));
  }

  /** The ultimate charged once (the Heaven Pierce) or twice (the lotus tempest). */
  charge(times: 1 | 2) {
    this.combat.energy = ENERGY_MAX * times;
  }

  /** The fight is over: what is left of the packs goes quietly, and they stay away. */
  demoCalm() {
    this.brawl(0);
    for (const m of this.monsters) if (m.alive) m.remove();
    for (const p of this.packs) {
      p.state = "gone";
      p.t = 1e9;
    }
  }

  /**
   * Straight to the pagoda courtyard (opened with ?boss=1): SORA in front of
   * it, close enough that the tiger lord steps out as the title clears. With
   * `auto` (?boss=2) she fights him on her own, as in the benchmark.
   */
  toBoss(auto = false) {
    const b = this.world.data.manifest.markers.find((k) => k.type === "boss")!;
    const a = ((b.yaw ?? 0) * Math.PI) / 180;
    this.hero.place(V.set(b.at[0] + Math.cos(a) * 15, b.at[1] + Math.sin(a) * 15, 0), (b.yaw ?? 0) + 180);
    this.camera.reset(this.hero);
    this.duel = auto;
  }

  /** SORA fights the boss on her own (?boss=2) */
  private duel = false;

  /**
   * A repeatable fight for measuring frame rate (opened with ?brawl=1): pack
   * after pack is set down a few strides ahead of SORA, already hunting her,
   * and she fights them on her own: blades up close, kiếm khí from afar, the
   * ultimate whenever it is ready. `packs` of them at once (a crowd: 3 or 4).
   */
  brawl(packs = 1, auto = true) {
    this.brawling = Math.max(0, Math.min(5, Math.floor(packs)));
    this.brawlAuto = auto;
  }

  /** whether SORA fights on her own in the benchmark (off: only the packs are brought, for a scripted fight) */
  private brawlAuto = true;

  private autoBrawl(dt: number) {
    if (this.demo) this.hero.hp = Math.max(this.hero.hp, this.hero.maxHp * 0.5);
    if (this.duel && this.phase === "boss") {
      this.autopilot(dt);
      return;
    }
    if (!this.brawling || this.phase !== "roam") return;
    const hero = this.hero;
    // any pack still out but far off is sent home first: the fight is here
    for (const p of this.packs)
      if (p.state === "out" && Math.hypot(p.x - hero.pos.x, p.y - hero.pos.y) > 25) {
        for (const m of this.monsters) if (m.pack === this.packs.indexOf(p)) { m.remove(); m.pack = -1; }
        p.state = "asleep";
      }
    let out = this.packs.filter((p) => p.state === "out").length;
    for (let tries = 0; out < this.brawling && tries < this.packs.length; tries++) {
      const i = this.brawlNext++ % this.packs.length;
      const p = this.packs[i];
      if (p.state !== "asleep") continue;
      // round her, a few strides off, each pack from its own side
      const a = Math.atan2(hero.forward.y, hero.forward.x) + out * 2.1;
      p.x = hero.pos.x + Math.cos(a) * 9;
      p.y = hero.pos.y + Math.sin(a) * 9;
      this.spawnPack(i);
      if ((p.state as Pack["state"]) !== "out") continue;
      for (const m of this.monsters) if (m.pack === i) m.aggro = true;
      out++;
    }
    if (!this.brawlAuto) {
      hero.hp = Math.max(hero.hp, hero.maxHp * 0.5);
      return;
    }
    this.autopilot(dt);
  }

  /** The benchmark's hands: blades up close, kiếm khí from afar, the ultimate whenever it is ready. */
  private autopilot(dt: number) {
    const hero = this.hero;
    this.brawlT -= dt;
    if (this.brawlT > 0 || hero.hp <= 0) return;
    // she never falls in a benchmark
    hero.hp = Math.max(hero.hp, hero.maxHp * 0.5);
    let near = Infinity;
    for (const m of this.monsters) if (m.alive) near = Math.min(near, m.pos.distanceTo(hero.pos));
    if (this.combat.energy >= ENERGY_MAX * 2) this.ult();
    else if (near < 3.4) this.attack();
    else if (near < 30) this.shoot();
    this.brawlT = near < 3.4 ? 0.28 : 0.7;
  }

  private spawnPack(i: number) {
    const p = this.packs[i];
    const taken = new Set<Monster>();
    const picked = p.kinds.map((kind) => {
      const m = this.monsters.find((x) => x.kind === kind && x.dead && x.pack < 0 && !taken.has(x));
      if (m) taken.add(m);
      return m;
    });
    if (picked.some((m) => !m)) return;
    p.state = "out";
    picked.forEach((m, k) => {
      m = m!;
      const a = (k / picked.length) * Math.PI * 2 + i;
      let x = p.x + Math.cos(a) * 3.5;
      let y = p.y + Math.sin(a) * 3.5;
      // keep out of the water and out of walls
      for (let tries = 0; tries < 6 && (this.world.ground.at(x, y) < 0.25 || this.world.solidAt(V.set(x, y, this.world.ground.at(x, y)))); tries++) {
        x = p.x + Math.cos(a + tries) * (1.5 + tries);
        y = p.y + Math.sin(a + tries) * (1.5 + tries);
      }
      m.pack = i;
      m.place(x, y, this.world.ground.at(x, y), p.level + (m.kind === "golem" ? 1 : 0), this.wanderRng() * 360);
      this.fx.fire("dashKage", this.time, V.set(x, y, m.groundZ), m.yaw, 0.1);
    });
  }

  /** A foe's strength for its level (health grows faster than its blows). */
  private levelFoe(a: Actor, level: number, growth = 0.35, might = 0.14) {
    a.level = level;
    a.maxHp = Math.round(a.spec.hp * (1 + growth * (level - 1)));
    a.power = 1 + might * (level - 1);
  }

  // ---------------------------------------------------------------- skills
  private ranks: Ranks = { ...NO_RANKS };
  private boost = boosts(NO_RANKS);

  /** SORA's skill ranks (from the save, or just spent): their boosts take hold at once. */
  setRanks(r: Ranks) {
    this.ranks = cleanRanks(r);
    this.boost = boosts(this.ranks);
    const b = this.boost;
    this.combat.heroBoost = { blade: b.blade, streak: b.streak, bolt: b.bolt, lotus: b.lotus, skillCooldown: b.skillCooldown, shootCooldown: b.shootCooldown, energy: b.energy };
    // new vitality fills in at once
    const before = this.hero.maxHp;
    this.applyLevel();
    if (this.hero.hp > 0) this.hero.hp = Math.min(this.hero.maxHp, this.hero.hp + Math.max(0, this.hero.maxHp - before));
  }

  // ---------------------------------------------------------------- experience
  /** Where SORA's journey stands (from the save). */
  setProgress(level: number, xp: number) {
    this.level = THREE.MathUtils.clamp(Math.floor(level) || 1, 1, LEVEL_MAX);
    this.xp = Math.max(0, xp || 0);
    this.applyLevel();
  }

  private applyLevel() {
    const hero = this.hero;
    const L = this.level;
    hero.level = L;
    hero.maxHp = 120 + 14 * (L - 1) + this.boost.hp;
    hero.power = 1 + 0.1 * (L - 1);
    hero.hp = Math.min(hero.hp, hero.maxHp);
  }

  private gainXp(n: number, from: Actor) {
    if (this.level >= LEVEL_MAX) return;
    this.xp += n;
    const s = this.project(V.set(from.pos.x, from.pos.y, from.pos.z + 2.1 * from.scale));
    if (s) this.events.pop?.({ id: 1e6 + Math.floor(this.clock * 1000), x: s.x, y: s.y, value: n, kind: "xp" });
    let levelled = false;
    while (this.level < LEVEL_MAX && this.xp >= xpNeed(this.level)) {
      this.xp -= xpNeed(this.level);
      this.level++;
      levelled = true;
    }
    if (levelled) this.levelUp();
    this.events.progress?.(this.level, this.xp, levelled);
  }

  private levelUp() {
    const hero = this.hero;
    this.applyLevel();
    hero.hp = hero.maxHp;
    this.bolts.flare(hero.pos, this.world.ground.at(hero.pos.x, hero.pos.y));
    this.fx.fire("dashSora", this.time, V.set(hero.pos.x, hero.pos.y, hero.groundZ), hero.yaw, 0.05);
    this.combat.gainEnergy(25);
    this.events.sound?.("clash");
    const points = pointsEarned(this.level) - pointsEarned(this.level - 1);
    this.say("LEVEL UP", `Lv ${this.level} · +${points} skill point${points > 1 ? "s" : ""} · tap your portrait`);
    this.after(2.2, () => {
      if (this.hud.banner === "LEVEL UP") this.say("");
    });
  }

  private after(delay: number, fn: () => void) {
    this.later.push({ at: this.time + delay, run: fn });
  }
}
