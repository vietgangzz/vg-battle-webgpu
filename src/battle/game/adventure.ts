/**
 * The game: SORA's journey across Vietnam to the crimson plain. Each stage is
 * a road: walk it, get ambushed by KAGE's shadow clones (the road seals until
 * every wave is down), gather their energy, break through the gate, and face
 * the stage's boss — the Shadow General, or at the end KAGE himself, whose
 * finisher is the film's own finale.
 *
 * Runs a fixed 60 Hz simulation (hit-stops freeze it, a killing blow slows it)
 * and renders through the film player's scene and compositor: the fighters are
 * the film's rigs, every effect is a film clip replayed where it lands.
 */
import * as THREE from "three/webgpu";

import type { FilmPlayer } from "../runtime/player";
import { Actor, type Kind, yawOf } from "./actor";
import { BossBrain, type Brain, BruteBrain, ShadeBrain, Tokens } from "./ai";
import { FIGHT_TAN_V, type Shot, StageCamera } from "./camera";
import { applyLook } from "./environment";
import { COMBO_WINDOW, Combat, ENERGY_MAX, type Pop, SKILL_COOLDOWN, type SoundName } from "./combat";
import { AMBIENT_FRAME, FxDirector } from "./fx";
import { BOSS_ENTRY, FINISH_WINDUP, SPAWN, STAGGER } from "./moves";
import { Barrier, Orbs, TargetRing } from "./pickups";
import { buildScenery, Fleet } from "./scenery";
import { Materials } from "./shading";
import { LANE, STAGES, type StageDef } from "./stage";

export type Phase = "title" | "explore" | "ambush" | "bossIntro" | "boss" | "broken" | "windup" | "finisher" | "clear" | "results" | "defeat";

export interface Results {
  stage: number;
  time: number;
  maxCombo: number;
  kos: number;
  damage: number;
  rank: "S" | "A" | "B" | "C";
}

export interface HudState {
  phase: Phase;
  stage: number;
  hp: number;
  maxHp: number;
  boss: { hp: number; max: number; name: string; title: string } | null;
  /** big words across the middle, and a line under them */
  banner: string;
  sub: string;
  combo: number;
  /** the way ahead is open: show the GO arrow */
  go: boolean;
  /** "WAVE 1/2" while sealed in */
  wave: string;
  ultReady: boolean;
  finishable: boolean;
  /** a tip for a first-time player */
  hint: string;
  /** where the arenas sit along the road (0..1), for the progress bar */
  marks: number[];
  results: Results | null;
}

/** Continuous readings for the overlay (written every frame, no re-render). */
export interface Meters {
  /** 0..1 */
  energy: number;
  /** 0 = ready, 1 = just used */
  skill: number;
  /** 0..1 left on the combo timer */
  combo: number;
  /** SORA's way along the road, 0..1 */
  progress: number;
  /** enemy health bars: x, y (screen fractions), health 0..1, opacity, per slot */
  bars: number[];
}

export type { Pop, SoundName } from "./combat";

export interface GameEvents {
  hud?: (s: HudState) => void;
  meters?: (m: Meters) => void;
  sound?: (name: SoundName) => void;
  /** a number popping off a blow */
  pop?: (p: Pop) => void;
  /** the finisher cut-in starts: its soundtrack begins at this film time (s) */
  finisher?: (filmSeconds: number) => void;
}

export const BAR_SLOTS = 8;
const DT = 1 / 60;
/** the film's finale, from SORA's crouch to the end of the aftermath */
const FINALE_FROM = 268;
const FINALE_TO = 540;
/** film frame 16: where the folded intro leaves off */
const OPENING_FRAME = 16;
const BROKEN_SECONDS = 9;
const SHADES = 6;
const BRUTES = 2;

const V = new THREE.Vector3();
const V2 = new THREE.Vector3();
const Q = new THREE.Quaternion();

interface Foe {
  actor: Actor;
  brain: Brain;
  active: boolean;
}

export class Adventure {
  readonly hero: Actor;
  readonly kage: Actor;
  readonly captain: Actor;
  readonly fx: FxDirector;
  readonly camera = new StageCamera();
  private boss: Actor;
  private readonly foes: Foe[] = [];
  private readonly bossBrain = new BossBrain();
  private readonly captainBrain = new BossBrain(19);
  private readonly tokens = new Tokens(2);
  private readonly orbs: Orbs;
  private readonly barrier = new Barrier();
  private readonly ring: TargetRing;
  private readonly mats: Materials;
  private readonly sceneries = new Map<number, { group: THREE.Group; fleet: Fleet | null }>();
  stageIndex = 0;
  private stage: StageDef = STAGES[0];
  phase: Phase = "title";
  private phaseT = 0;
  private acc = 0;
  private last = -1;
  // input
  readonly stick = new THREE.Vector2();
  guard = false;
  // progress
  private arena = -1;
  private wave = 0;
  private waveT = 0;
  private pending: { kind: Kind; x: number; y: number; at: number }[] = [];
  private cleared = new Set<number>();
  private ultUntil = -1;
  private finaleStart = -1;
  private hintIndex = 0;
  private hintUntil = 0;
  private readonly postFrames: number[] = [];
  private readonly combat: Combat;
  private later: { at: number; run: () => void }[] = [];
  private readonly filmCam = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
  private readonly externals: string[];
  private readonly motesTime;
  private readonly cloud;
  private hud: HudState;
  private hudKey = "";
  private readonly meters: Meters = { energy: 0, skill: 0, combo: 0, progress: 0, bars: new Array(BAR_SLOTS * 4).fill(0) };

  constructor(
    readonly player: FilmPlayer,
    private readonly events: GameEvents = {},
  ) {
    const fs = player.fs;
    this.mats = new Materials(fs.reflection);
    this.hero = new Actor(fs, "hero");
    this.kage = new Actor(fs, "boss");
    this.captain = new Actor(fs, "captain");
    this.captain.remove();
    this.boss = this.kage;
    for (let i = 0; i < SHADES; i++) this.foes.push({ actor: new Actor(fs, "shade"), brain: new ShadeBrain(11 + i * 7), active: false });
    for (let i = 0; i < BRUTES; i++) this.foes.push({ actor: new Actor(fs, "brute"), brain: new BruteBrain(5 + i * 3), active: false });
    for (const f of this.foes) f.actor.remove();
    this.fx = new FxDirector(fs);
    this.combat = new Combat(this.fx, {
      targets: (me) => (me === this.hero ? this.targets() : [this.hero]),
      knockOut: (f, by) => this.knockOut(f, by),
      project: (p) => this.project(p, { x: 0, y: 0 }),
      shake: (n) => this.camera.shake(n),
      sound: (n) => this.sound(n),
      pop: (pp) => this.events.pop?.(pp),
      ultimate: () => {
        this.ultUntil = this.time + 6;
      },
    });
    this.externals = [...this.hero.objects, ...this.kage.objects];
    this.motesTime = fs.drive("motes.Time", false);
    this.cloud = fs.drive("world.cloud_w", false);
    this.orbs = new Orbs(this.mats);
    this.ring = new TargetRing(this.mats);
    fs.scene.add(this.orbs.group, this.barrier.group, this.ring.mesh);
    this.hud = this.blankHud();
  }

  /** Build every stage's scenery up front (and let the renderer compile it), so no stage hitches on entry. */
  async prepare(compile: (group: THREE.Object3D) => Promise<void>) {
    for (let i = 0; i < STAGES.length; i++) {
      const s = this.scenery(i);
      s.group.visible = true;
      await compile(s.group);
      s.group.visible = false;
    }
  }

  private scenery(i: number) {
    let s = this.sceneries.get(i);
    if (!s) {
      const def = STAGES[i];
      const group = buildScenery(this.mats, def.terrain, def.props, def.backdrop, [def.start, def.end]);
      const fleet = def.fleet ? new Fleet(this.mats, def.fleet) : null;
      if (fleet) group.add(fleet.group);
      group.visible = false;
      this.player.fs.scene.add(group);
      s = { group, fleet };
      this.sceneries.set(i, s);
    }
    return s;
  }

  /** fight clock (stops in hit-stops) */
  private get time() {
    return this.combat.time;
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
  finish() {
    this.combat.press("finish");
  }
  setStick(x: number, y: number) {
    this.stick.set(x, y);
  }
  setGuard(held: boolean) {
    this.guard = held;
  }

  // ---------------------------------------------------------------- flow
  /** Start a stage from its beginning, or (retry) from the arena where SORA fell. */
  start(stageIndex = this.stageIndex, retry = false) {
    const fs = this.player.fs;
    const changed = stageIndex !== this.stageIndex || !retry;
    this.stageIndex = stageIndex;
    this.stage = STAGES[stageIndex];
    for (const [i, s] of this.sceneries) s.group.visible = i === stageIndex;
    this.scenery(stageIndex).group.visible = true;
    applyLook(fs, this.stage.look);
    fs.setExternal(this.externals, true);
    fs.drive("motes.Time", true);
    fs.drive("world.cloud_w", true);
    fs.blobSource = (out) => this.blobs(out);
    this.fx.clear();
    this.orbs.clear();
    this.tokens.clear();
    for (const f of this.foes) {
      f.active = false;
      f.actor.remove();
    }
    this.kage.remove();
    this.captain.remove();
    this.boss = this.stage.boss === "boss" ? this.kage : this.captain;
    const arena = retry && this.arena >= 0 ? this.stage.arenas[this.arena] : null;
    const x = arena ? arena.from - 3 : this.stage.start;
    this.hero.place(V.set(x, 0, 0), -90);
    this.hero.target = null;
    this.camera.reset();
    this.pending = [];
    this.barrier.seal(null);
    this.arena = -1;
    if (changed && !retry) {
      this.cleared.clear();
      this.hintIndex = 0;
    }
    this.combat.reset(!(changed && !retry));
    this.acc = 0;
    this.last = -1;
    this.ultUntil = -1;
    this.later = [];
    this.finaleStart = -1;
    this.hud.results = null;
    this.hud.hint = "";
    this.setPhase("title");
    this.say(retry ? "RETRY" : this.stage.name, retry ? "" : `STAGE ${stageIndex + 1} · ${this.stage.region.toUpperCase()}`);
  }

  private setPhase(p: Phase) {
    this.phase = p;
    this.phaseT = 0;
  }

  // ---------------------------------------------------------------- frame
  /** Advance the simulation to `now` (ms) and draw. */
  frame(now: number) {
    const s = now / 1000;
    if (this.last < 0) this.last = s;
    const wall = Math.min(s - this.last, 0.1);
    this.last = s;
    if (this.phase === "finisher" || (this.phase === "results" && this.finaleStart >= 0)) return this.drawFinale(wall, now);
    this.acc += wall;
    while (this.acc >= DT) {
      this.acc -= DT;
      this.step();
    }
    return this.player.renderPosed(() => this.pose(), now);
  }

  private step() {
    this.phaseT += DT;
    const dt = this.combat.advance(DT);
    const hero = this.hero;

    if (this.later.length) {
      const due = this.later.filter((l) => l.at <= this.time);
      this.later = this.later.filter((l) => l.at > this.time);
      for (const l of due) l.run();
    }
    this.flow(dt);
    const control = this.phase === "explore" || this.phase === "ambush" || this.phase === "boss" || this.phase === "broken";
    if (control && dt > 0) this.control();
    else if (!control) hero.wish.set(0, 0);

    // who fights whom
    hero.target = this.nearestFoe(7.5);
    for (const f of this.foes) if (f.active) f.actor.target = hero;
    this.boss.target = hero;
    if (dt > 0) this.think(dt);

    hero.update(dt, this.time);
    if (!this.boss.dead) this.boss.update(dt, this.time);
    for (const f of this.foes) if (f.active) f.actor.update(dt, this.time);

    this.combat.resolve(hero);
    if (!this.boss.dead) this.combat.resolve(this.boss);
    for (const f of this.foes) if (f.active) this.combat.resolve(f.actor);
    this.constrain();

    // pickups, walls, combo clock, cooldowns, tips
    const got = this.orbs.update(dt || DT * 0.2, hero.pos);
    if (got) this.combat.gainEnergy(got * 4);
    this.barrier.update(DT);
    this.ring.update(DT, hero.target);
    if (this.ultUntil > 0 && this.time > this.ultUntil) {
      this.fx.release("pierce");
      this.ultUntil = -1;
    }
    const hints = this.stage.hints;
    if (hints && this.hintIndex < hints.length && hero.pos.x >= hints[this.hintIndex].x && this.phase !== "title") {
      this.hud.hint = hints[this.hintIndex++].text;
      this.hintUntil = this.time + 4.5;
    }
    if (this.hud.hint && this.time > this.hintUntil) this.hud.hint = "";
    this.fx.update(this.time);
    const c = this.combat;
    this.meters.energy = c.energy / ENERGY_MAX;
    this.meters.skill = c.skillCooldown / SKILL_COOLDOWN;
    this.meters.combo = c.combo > 1 ? Math.max(0, c.comboT / COMBO_WINDOW) : 0;
    this.meters.progress = THREE.MathUtils.clamp((hero.pos.x - this.stage.start) / (this.stage.end - 1 - this.stage.start), 0, 1);
    this.sync();
  }

  /** The stage's script: title, the road, ambushes, the boss, the end. */
  private flow(dt: number) {
    const hero = this.hero;
    switch (this.phase) {
      case "title":
        if (this.phaseT > 2.4) {
          this.setPhase("explore");
          this.say("");
        }
        break;
      case "explore": {
        // the next arena springs its trap as SORA crosses into it
        const i = this.stage.arenas.findIndex((a, k) => !this.cleared.has(k) && hero.pos.x >= a.trigger);
        if (i >= 0) this.enterArena(i);
        break;
      }
      case "ambush":
        this.waveT += dt;
        this.spawnDue();
        if (!this.pending.length && this.foes.every((f) => !f.active || f.actor.dead || f.actor.vanish >= 0)) {
          const a = this.stage.arenas[this.arena];
          if (this.wave + 1 < a.waves.length) this.startWave(this.wave + 1);
          else this.clearArena();
        }
        break;
      case "bossIntro":
        if (this.phaseT > 2.8) {
          this.setPhase("boss");
          this.say("");
        }
        break;
      case "broken":
        if (this.phaseT > BROKEN_SECONDS) {
          // not finished in time: KAGE gets back up
          this.boss.down = false;
          this.boss.hp = this.boss.maxHp * 0.25;
          this.boss.play(STAGGER, hero);
          this.setPhase("boss");
          this.say("");
        }
        break;
      case "windup":
        if (this.phaseT > 0.42) this.startFinale();
        break;
      default:
        break;
    }
  }

  private enterArena(i: number) {
    const a = this.stage.arenas[i];
    this.arena = i;
    this.barrier.seal([a.from, a.to]);
    if (a.boss) {
      this.setPhase("bossIntro");
      const b = this.boss;
      b.place(V.set(a.to - 4, 0, 0), 90);
      b.play(BOSS_ENTRY, this.hero);
      b.target = this.hero;
      // he drops out of the sky and lands in a crouch: the ground rings
      this.after(0.55 * b.scale, () => {
        this.fx.fire("dashKage", this.time, b.pos, b.yaw, 0.05);
        this.combat.hitStop(3, 0.3 * b.scale);
        this.sound("slam");
      });
      this.say(this.stage.bossName, this.stage.bossTitle);
      return;
    }
    this.setPhase("ambush");
    this.say(a.title ?? "AMBUSH", "");
    this.startWave(0);
  }

  private startWave(w: number) {
    const a = this.stage.arenas[this.arena];
    this.wave = w;
    this.waveT = 0;
    const mid = (a.from + a.to) / 2;
    this.pending = a.waves[w].map((s) => ({ kind: s.kind, x: mid + s.dx, y: s.y, at: (s.at ?? 0) + (w ? 0.6 : 0.9) }));
    this.tokens.clear();
    if (w > 0) this.say(`WAVE ${w + 1}`, "");
  }

  private spawnDue() {
    this.pending = this.pending.filter((p) => {
      if (this.waveT < p.at) return true;
      const f = this.foes.find((x) => x.actor.kind === p.kind && (!x.active || x.actor.dead));
      if (!f) return true;
      f.active = true;
      const a = f.actor;
      a.place(V.set(p.x, p.y, 0), yawOf(V2.subVectors(this.hero.pos, V)));
      a.play(SPAWN, this.hero);
      this.fx.fire("dashKage", this.time, a.pos, a.yaw, 0.1);
      return false;
    });
  }

  private clearArena() {
    this.cleared.add(this.arena);
    this.barrier.seal(null);
    this.setPhase("explore");
    this.say("CLEAR", "");
    for (const f of this.foes) f.active = f.active && !f.actor.dead;
  }

  // ---------------------------------------------------------------- the player
  private control() {
    const hero = this.hero;
    const cam = this.camera;
    // stick: screen up = into the screen (along the road's depth), right = along the road
    const f = V.subVectors(cam.target, cam.position).setZ(0).normalize();
    const r = V2.set(f.y, -f.x, 0);
    hero.wish.set(f.x * this.stick.y + r.x * this.stick.x, f.y * this.stick.y + r.y * this.stick.x);
    if (hero.wish.length() > 1) hero.wish.normalize();
    if (hero.down) return;
    const c = this.combat;
    if (this.phase === "broken" && c.buffer.finish >= c.time) {
      c.buffer.finish = -1;
      hero.play(FINISH_WINDUP, this.boss);
      this.setPhase("windup");
      this.say("");
      return;
    }
    const foe = hero.target ?? (this.boss.alive && !this.boss.dead ? this.boss : null);
    if (c.control(hero, this.guard, foe) === "ult") this.say("HEAVEN PIERCE", "");
  }

  // ---------------------------------------------------------------- the others
  private think(dt: number) {
    const hero = this.hero;
    for (const f of this.foes) {
      if (!f.active || f.actor.dead) continue;
      this.combat.obey(f.actor, f.brain.update(dt, this.time, f.actor, hero, this.tokens), hero);
    }
    if (this.phase === "boss" && !this.boss.dead) {
      const brain = this.boss === this.kage ? this.bossBrain : this.captainBrain;
      this.combat.obey(this.boss, brain.update(dt, this.time, this.boss, hero), hero);
    }
  }

  private targets() {
    const out: Actor[] = [];
    for (const f of this.foes) if (f.active && f.actor.alive) out.push(f.actor);
    if (!this.boss.dead && this.boss.alive && (this.phase === "boss" || this.phase === "bossIntro")) out.push(this.boss);
    return out;
  }

  private knockOut(f: Actor, by: Actor) {
    this.sound("down");
    if (f === this.hero) {
      f.defeat(by);
      this.setPhase("defeat");
      this.barrier.seal(null);
      this.say("DEFEATED", "");
      return;
    }
    if (f === this.kage) {
      f.defeat(by);
      this.combat.slow = 0.6;
      this.setPhase("broken");
      this.say("FINISH HIM", "");
      return;
    }
    if (f === this.captain) {
      // the general falls: slow motion, a scatter of energy, the stage is won
      f.defeat(by);
      this.combat.slow = 1.1;
      this.combat.stats.kos++;
      this.orbs.spawn(f.pos, 10);
      this.barrier.seal(null);
      this.setPhase("clear");
      this.say("STAGE CLEAR", "");
      this.after(2.4, () => this.finishStage());
      return;
    }
    this.combat.stats.kos++;
    f.defeat(by);
    this.orbs.spawn(f.pos, f.kind === "brute" ? 7 : 3);
    // the last of a wave falls slowly
    const left = this.foes.filter((x) => x.active && x.actor.alive).length + this.pending.length;
    if (left === 0) this.combat.slow = 0.45;
  }

  /** The stage is won: tally it up. */
  private finishStage() {
    this.hud.results = {
      stage: this.stageIndex,
      time: this.time,
      maxCombo: this.combat.stats.maxCombo,
      kos: this.combat.stats.kos,
      damage: this.combat.stats.damage,
      rank: rankOf(this.time, this.combat.stats.maxCombo, this.combat.stats.damage),
    };
    this.setPhase("results");
    this.say("");
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

  /** Keep everyone on the road, inside a sealed arena, and out of each other. */
  private constrain() {
    const all = [this.hero, ...(this.boss.dead ? [] : [this.boss]), ...this.foes.filter((f) => f.active && !f.actor.dead).map((f) => f.actor)];
    const sealed = this.phase === "ambush" || this.phase === "boss" || this.phase === "bossIntro" || this.phase === "broken";
    const a = this.arena >= 0 && sealed ? this.stage.arenas[this.arena] : null;
    for (const f of all) {
      f.pos.y = THREE.MathUtils.clamp(f.pos.y, -LANE, LANE);
      const lo = a ? a.from + 0.7 : this.stage.start - 1;
      const hi = a ? a.to - 0.7 : this.stage.end;
      if (f.pos.x < lo || f.pos.x > hi) {
        const nx = THREE.MathUtils.clamp(f.pos.x, lo, hi);
        if (f.action) f.action.startPos.x += nx - f.pos.x;
        f.pos.x = nx;
      }
    }
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

  /** Blob shadows under everyone standing (the ground shader has room for eight). */
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
    while (n < out.length) out[n++].set(0, 0, 0, 0);
  }

  // ---------------------------------------------------------------- screen-space markers
  /** Where a world point lands on screen (fractions), or null behind the camera. */
  private project(p: THREE.Vector3, out: { x: number; y: number }) {
    V2.copy(p).project(this.player.fs.camera);
    if (V2.z > 1 || V2.z < -1) return null;
    out.x = (V2.x + 1) / 2;
    out.y = (1 - V2.y) / 2;
    return out;
  }

  /** Health bars over the shadows (the bosses have theirs up top). */
  private updateBars() {
    const bars = this.meters.bars;
    let slot = 0;
    const at = { x: 0, y: 0 };
    for (const f of this.foes) {
      if (slot >= BAR_SLOTS) break;
      const a = f.actor;
      if (!f.active || a.dead) continue;
      const hurt = a.hp < a.maxHp;
      const s = this.project(V.set(a.pos.x, a.pos.y, a.pos.z + 1.55 * a.scale), at);
      const k = slot * 4;
      bars[k] = s ? s.x : -1;
      bars[k + 1] = s ? s.y : -1;
      bars[k + 2] = Math.max(0, a.hp / a.maxHp);
      bars[k + 3] = s && a.vanish < 0 && hurt ? 1 : 0;
      slot++;
    }
    for (; slot < BAR_SLOTS; slot++) bars[slot * 4 + 3] = 0;
  }

  // ---------------------------------------------------------------- drawing
  private shot(): Shot {
    const hero = this.hero;
    const a = this.arena >= 0 ? this.stage.arenas[this.arena] : null;
    if (a?.boss && ["bossIntro", "boss", "broken", "windup", "clear"].includes(this.phase)) {
      const b = this.boss;
      const sep = Math.abs(b.pos.x - hero.pos.x);
      return { focusX: (hero.pos.x + b.pos.x) / 2, focusY: (hero.pos.y + b.pos.y) / 2, width: THREE.MathUtils.clamp(sep + 7 * b.scale, 12, 19), clamp: [a.from, a.to] };
    }
    const lead = hero.forward.x * 1.6;
    return {
      focusX: hero.pos.x + lead,
      focusY: hero.pos.y,
      width: this.phase === "ambush" ? 14 : 12.5,
      clamp: this.phase === "ambush" && a ? [a.from, a.to] : null,
    };
  }

  private pose() {
    const player = this.player;
    const fs = player.fs;
    const framing = player.view;
    this.motesTime.value = 3 + pingpong(this.time, 16);
    this.cloud.value = this.time * 0.05;
    this.sceneries.get(this.stageIndex)?.fleet?.update(this.time);
    fs.pose(this.fx.frames, this.fx.offsets);
    player.post.update(AMBIENT_FRAME, this.fx.postFrames(this.postFrames));

    this.camera.update(DT, this.shot(), framing.aspect);
    if (this.phase === "title" && this.phaseT < 1.8) {
      // from the film's opening camera onto the road
      const tanFilm = fs.filmCamera(OPENING_FRAME, framing, this.filmCam);
      const k = smooth(Math.min(this.phaseT / 1.8, 1));
      V.copy(this.filmCam.position).lerp(this.camera.position, k);
      const tanV = Math.exp(THREE.MathUtils.lerp(Math.log(tanFilm), Math.log(FIGHT_TAN_V), k));
      fs.setCamera(V, this.camera.target, tanV, framing);
      Q.copy(this.filmCam.quaternion).slerp(fs.camera.quaternion, k);
      fs.camera.quaternion.copy(Q);
      fs.camera.updateMatrixWorld(true);
    } else {
      fs.setCamera(this.camera.position, this.camera.target, FIGHT_TAN_V, framing);
    }
    this.updateBars();
    this.events.meters?.(this.meters);
  }

  private startFinale() {
    const fs = this.player.fs;
    fs.setExternal(this.externals, false);
    fs.drive("motes.Time", false);
    fs.drive("world.cloud_w", false);
    fs.blobSource = null;
    this.fx.clear();
    fs.resetGroups();
    this.orbs.clear();
    this.ring.update(1, null);
    this.barrier.seal(null);
    this.barrier.update(1);
    for (const f of this.foes) f.actor.remove();
    this.setPhase("finisher");
    this.finaleStart = -1;
    this.events.finisher?.(FINALE_FROM / 24);
  }

  private drawFinale(wall: number, now: number) {
    this.phaseT += wall;
    if (this.finaleStart < 0) this.finaleStart = this.phaseT;
    const frame = Math.min(FINALE_FROM + (this.phaseT - this.finaleStart) * 24, FINALE_TO);
    if (frame >= FINALE_TO && this.phase === "finisher") {
      this.combat.stats.kos++;
      this.finishStage();
      this.sync();
    }
    return this.player.renderPosed(() => {
      this.player.fs.update(frame, this.player.view);
      this.player.post.update(frame);
    }, now);
  }

  /** Hide the game's own scenery (back to the film's world, for the menu). */
  leave() {
    const fs = this.player.fs;
    for (const s of this.sceneries.values()) s.group.visible = false;
    applyLook(fs, STAGES[STAGES.length - 1].look);
    fs.setExternal(this.externals, false);
    fs.drive("motes.Time", false);
    fs.drive("world.cloud_w", false);
    fs.blobSource = null;
    this.fx.clear();
    fs.resetGroups();
    this.orbs.clear();
    this.ring.update(1, null);
    this.barrier.seal(null);
    this.barrier.update(1);
    for (const f of this.foes) f.actor.remove();
    this.captain.remove();
  }

  // ---------------------------------------------------------------- hud
  private blankHud(): HudState {
    return {
      phase: "title",
      stage: 0,
      hp: 0,
      maxHp: 1,
      boss: null,
      banner: "",
      sub: "",
      combo: 0,
      go: false,
      wave: "",
      ultReady: false,
      finishable: false,
      hint: "",
      marks: [],
      results: null,
    };
  }

  private say(banner: string, sub = "") {
    this.hud.banner = banner;
    this.hud.sub = sub;
  }

  private sync() {
    const h = this.hud;
    const st = this.stage;
    h.phase = this.phase;
    h.stage = this.stageIndex;
    h.hp = Math.ceil(this.hero.hp);
    h.maxHp = this.hero.maxHp;
    const showBoss = this.phase === "bossIntro" || this.phase === "boss" || this.phase === "broken" || (this.phase === "windup" && this.boss === this.kage);
    h.boss = showBoss ? { hp: Math.ceil(this.boss.hp), max: this.boss.maxHp, name: st.bossName, title: st.bossTitle } : null;
    h.combo = this.combat.combo;
    const next = st.arenas.findIndex((_, k) => !this.cleared.has(k));
    h.go = this.phase === "explore" && next >= 0 && this.phaseT > 1.2;
    const a = this.arena >= 0 ? st.arenas[this.arena] : null;
    h.wave = this.phase === "ambush" && a ? `WAVE ${this.wave + 1}/${a.waves.length}` : "";
    h.ultReady = this.combat.energy >= ENERGY_MAX;
    h.finishable = this.phase === "broken";
    h.marks = st.arenas.map((ar) => (ar.trigger - st.start) / (st.end - 1 - st.start));
    // transient banners clear themselves
    if (h.banner && ["CLEAR", "AMBUSH", "HEAVEN PIERCE", "RETRY", ...st.arenas.map((x) => x.title ?? "")].includes(h.banner) && this.phaseT > 1.6) this.say("");
    if (h.banner.startsWith("WAVE") && this.waveT > 1.4) this.say("");
    const key = JSON.stringify(h);
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.events.hud?.({ ...h, boss: h.boss && { ...h.boss }, results: h.results && { ...h.results }, marks: [...h.marks] });
  }

  private sound(name: SoundName) {
    this.events.sound?.(name);
  }

  /** Run `fn` after `delay` seconds of fight time. */
  private after(delay: number, fn: () => void) {
    this.later.push({ at: this.time + delay, run: fn });
  }
}

function rankOf(time: number, maxCombo: number, damage: number): Results["rank"] {
  let score = 0;
  score += time < 150 ? 3 : time < 220 ? 2 : time < 300 ? 1 : 0;
  score += maxCombo >= 25 ? 3 : maxCombo >= 15 ? 2 : maxCombo >= 8 ? 1 : 0;
  score += damage < 20 ? 3 : damage < 50 ? 2 : damage < 90 ? 1 : 0;
  return score >= 8 ? "S" : score >= 6 ? "A" : score >= 3 ? "B" : "C";
}

const smooth = (x: number) => x * x * (3 - 2 * x);
const pingpong = (x: number, len: number) => {
  const m = x % (2 * len);
  return m < len ? m : 2 * len - m;
};
