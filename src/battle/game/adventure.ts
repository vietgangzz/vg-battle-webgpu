/**
 * The game: SORA crosses the Crimson Plain. Walk the road, get ambushed by
 * KAGE's shadow clones (the road seals until every wave is down), gather their
 * energy, break through the shadow gate, then face KAGE himself at the heart
 * of the plain. Break him, and the finisher is the film's own finale.
 *
 * Runs a fixed 60 Hz simulation (hit-stops freeze it, a killing blow slows it)
 * and renders through the film player's scene and compositor: the fighters are
 * the film's rigs, every effect is a film clip replayed where it lands.
 */
import * as THREE from "three/webgpu";

import type { FilmPlayer } from "../runtime/player";
import { Actor, type Kind, yawOf } from "./actor";
import { BossBrain, type Brain, BruteBrain, type Orders, ShadeBrain, Tokens } from "./ai";
import { FIGHT_TAN_V, type Shot, StageCamera } from "./camera";
import { AMBIENT_FRAME, FxDirector } from "./fx";
import {
  BLOCKED,
  BOSS_ENTRY,
  BRUTE_SLAM,
  FINISH_WINDUP,
  FLINCH,
  type HitSpec,
  KAGE_COMBO,
  KAGE_MOVES,
  type MoveDef,
  PARRY,
  SHADE_CUT,
  SKID,
  SORA_COMBO,
  SORA_MOVES,
  SPAWN,
  STAGGER,
} from "./moves";
import { Barrier, makeProp, Orbs } from "./props";
import { LANE, STAGE_1, type StageDef } from "./stage";

export type Phase = "title" | "explore" | "ambush" | "bossIntro" | "boss" | "broken" | "windup" | "finisher" | "results" | "defeat";

export interface Results {
  time: number;
  maxCombo: number;
  kos: number;
  damage: number;
  rank: "S" | "A" | "B" | "C";
}

export interface HudState {
  phase: Phase;
  hp: number;
  maxHp: number;
  boss: { hp: number; max: number } | null;
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
}

export type SoundName = "swing" | "hit" | "heavy" | "block" | "clash" | "slam" | "wave" | "dash" | "down";

export interface GameEvents {
  hud?: (s: HudState) => void;
  meters?: (m: Meters) => void;
  sound?: (name: SoundName) => void;
  /** the finisher cut-in starts: its soundtrack begins at this film time (s) */
  finisher?: (filmSeconds: number) => void;
}

const DT = 1 / 60;
/** the film's finale, from SORA's crouch to the end of the aftermath */
const FINALE_FROM = 268;
const FINALE_TO = 540;
/** film frame 16: where the folded intro leaves off */
const OPENING_FRAME = 16;
const PARRY_WINDOW = 0.22;
const BROKEN_SECONDS = 9;
const COMBO_WINDOW = 2.2;
const SKILL_COOLDOWN = 5;
const ENERGY_MAX = 100;
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
  readonly boss: Actor;
  readonly fx: FxDirector;
  readonly camera = new StageCamera();
  private readonly foes: Foe[] = [];
  private readonly bossBrain = new BossBrain();
  private readonly tokens = new Tokens(2);
  private readonly orbs = new Orbs();
  private readonly barrier = new Barrier();
  private readonly props = new THREE.Group();
  private readonly stage: StageDef = STAGE_1;
  phase: Phase = "title";
  private time = 0;
  private phaseT = 0;
  private freeze = 0;
  private slow = 0;
  private acc = 0;
  private last = -1;
  // input
  readonly stick = new THREE.Vector2();
  guard = false;
  private buffer = { attack: -1, jump: -1, dash: -1, skill: -1, ult: -1, finish: -1 };
  private dashCooldown = 0;
  private skillCooldown = 0;
  // progress
  private arena = -1;
  private wave = 0;
  private waveT = 0;
  private pending: { kind: Kind; x: number; y: number; at: number }[] = [];
  private cleared = new Set<number>();
  private energy = 0;
  private combo = 0;
  private comboT = 0;
  private stats = { maxCombo: 0, kos: 0, damage: 0, start: 0 };
  private ultUntil = -1;
  private finaleStart = 0;
  private readonly postFrames: number[] = [];
  private later: { at: number; run: () => void }[] = [];
  private readonly filmCam = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
  private readonly externals: string[];
  private readonly motesTime;
  private readonly cloud;
  private hud: HudState;
  private hudKey = "";
  private readonly meters: Meters = { energy: 0, skill: 0, combo: 0 };

  constructor(
    readonly player: FilmPlayer,
    private readonly events: GameEvents = {},
  ) {
    const fs = player.fs;
    this.hero = new Actor(fs, "hero");
    this.boss = new Actor(fs, "boss");
    for (let i = 0; i < SHADES; i++) this.foes.push({ actor: new Actor(fs, "shade"), brain: new ShadeBrain(11 + i * 7), active: false });
    for (let i = 0; i < BRUTES; i++) this.foes.push({ actor: new Actor(fs, "brute"), brain: new BruteBrain(5 + i * 3), active: false });
    for (const f of this.foes) f.actor.remove();
    this.fx = new FxDirector(fs);
    this.externals = [...this.hero.objects, ...this.boss.objects];
    this.motesTime = fs.drive("motes.Time", false);
    this.cloud = fs.drive("world.cloud_w", false);
    for (const def of this.stage.props) this.props.add(makeProp(def));
    this.props.visible = false;
    fs.scene.add(this.props, this.orbs.group, this.barrier.group);
    this.hud = this.blankHud();
  }

  // ---------------------------------------------------------------- input
  attack() {
    this.buffer.attack = this.time + 0.3;
  }
  jump() {
    this.buffer.jump = this.time + 0.15;
  }
  dash() {
    this.buffer.dash = this.time + 0.2;
  }
  skill() {
    this.buffer.skill = this.time + 0.25;
  }
  ult() {
    this.buffer.ult = this.time + 0.25;
  }
  finish() {
    this.buffer.finish = this.time + 0.5;
  }
  setStick(x: number, y: number) {
    this.stick.set(x, y);
  }
  setGuard(held: boolean) {
    this.guard = held;
  }

  // ---------------------------------------------------------------- flow
  /** Take over from the film at its opening frame and start the stage (or retry the current arena). */
  start(retry = false) {
    const fs = this.player.fs;
    fs.setExternal(this.externals, true);
    fs.drive("motes.Time", true);
    fs.drive("world.cloud_w", true);
    fs.blobSource = (out) => this.blobs(out);
    this.props.visible = true;
    this.fx.clear();
    this.orbs.clear();
    this.tokens.clear();
    for (const f of this.foes) {
      f.active = false;
      f.actor.remove();
    }
    this.boss.remove();
    const arena = retry && this.arena >= 0 ? this.stage.arenas[this.arena] : null;
    const x = arena ? arena.from - 3 : this.stage.start;
    this.hero.place(V.set(x, 0, 0), -90);
    this.hero.target = null;
    this.camera.reset();
    this.pending = [];
    this.barrier.seal(null);
    if (!retry) {
      this.arena = -1;
      this.cleared.clear();
      this.energy = 0;
      this.stats = { maxCombo: 0, kos: 0, damage: 0, start: 0 };
    } else {
      this.arena = -1;
    }
    this.combo = 0;
    this.skillCooldown = 0;
    this.time = 0;
    this.freeze = this.slow = this.acc = 0;
    this.last = -1;
    this.ultUntil = -1;
    this.later = [];
    this.finaleStart = -1;
    for (const k of Object.keys(this.buffer) as (keyof typeof this.buffer)[]) this.buffer[k] = -1;
    this.setPhase("title");
    this.say(retry ? "RETRY" : this.stage.name, retry ? "" : this.stage.subtitle);
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
    const stopped = this.freeze > 0;
    if (stopped) this.freeze -= DT;
    // a killing blow plays out slowly
    if (this.slow > 0) this.slow -= DT;
    const dt = stopped ? 0 : this.slow > 0 ? DT * 0.35 : DT;
    this.time += dt;
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

    this.resolve(hero);
    if (!this.boss.dead) this.resolve(this.boss);
    for (const f of this.foes) if (f.active) this.resolve(f.actor);
    this.constrain();

    // pickups, walls, combo clock, cooldowns
    const got = this.orbs.update(dt || DT * 0.2, hero.pos);
    if (got) this.gainEnergy(got * 4);
    this.barrier.update(DT);
    if (this.combo > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.combo = 0;
    }
    this.skillCooldown = Math.max(0, this.skillCooldown - dt);
    this.dashCooldown -= dt;
    if (this.ultUntil > 0 && this.time > this.ultUntil) {
      this.fx.release("pierce");
      this.ultUntil = -1;
    }
    this.fx.update(this.time);
    this.meters.energy = this.energy / ENERGY_MAX;
    this.meters.skill = this.skillCooldown / SKILL_COOLDOWN;
    this.meters.combo = this.combo > 1 ? Math.max(0, this.comboT / COMBO_WINDOW) : 0;
    this.events.meters?.(this.meters);
    this.sync();
  }

  /** The stage's script: title, the road, ambushes, the boss, the end. */
  private flow(dt: number) {
    const hero = this.hero;
    switch (this.phase) {
      case "title":
        if (this.phaseT > 2.2) {
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
      this.boss.place(V.set(a.to - 4, 0, 0), 90);
      this.boss.play(BOSS_ENTRY, this.hero);
      this.boss.target = this.hero;
      // he drops out of the sky and lands in a crouch: the ground rings
      this.after(0.55, () => {
        this.fx.fire("dashKage", this.time, this.boss.pos, this.boss.yaw, 0.05);
        this.hitStop(3, 0.3);
        this.sound("slam");
      });
      this.say("KAGE", "THE SHADOW");
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

    const free = !hero.busy;
    const guard = this.guard && free && !hero.airborne;
    if (guard && !hero.guardHeld) hero.guardSince = this.time;
    hero.guardHeld = guard;
    const b = this.buffer;
    const t = this.time;
    const a = hero.action;
    const foe = hero.target ?? (this.boss.alive && !this.boss.dead ? this.boss : null);

    if (this.phase === "broken" && b.finish >= t) {
      b.finish = -1;
      hero.play(FINISH_WINDUP, this.boss);
      this.setPhase("windup");
      this.say("");
      return;
    }
    if (b.ult >= t && this.energy >= ENERGY_MAX && (free || (a && a.def.impact !== undefined && a.t > a.def.impact))) {
      b.ult = -1;
      this.energy = 0;
      this.startMove(hero, foe, SORA_MOVES.pierce);
      this.say("HEAVEN PIERCE", "");
      return;
    }
    if (b.skill >= t && this.skillCooldown <= 0 && (free || (a && a.def.impact !== undefined && a.t > a.def.impact))) {
      b.skill = -1;
      this.skillCooldown = SKILL_COOLDOWN;
      const dir = hero.wish.lengthSq() > 0.04 ? V.set(hero.wish.x, hero.wish.y, 0) : null;
      this.startMove(hero, dir ? null : foe, SORA_MOVES.streak, dir?.clone());
      return;
    }
    if (b.jump >= t && free && !hero.airborne) {
      b.jump = -1;
      if (hero.jump()) this.sound("dash");
      return;
    }
    if (b.dash >= t && this.dashCooldown <= 0) {
      const cancel = free || (a && a.def.impact !== undefined && a.def.name !== "dash" && a.t > a.def.impact + 0.08);
      if (cancel && !["flinch", "skid", "stagger", "getup"].includes(a?.def.name ?? "") && !hero.airborne) {
        const dir = hero.wish.lengthSq() > 0.04 ? V.set(hero.wish.x, hero.wish.y, 0) : hero.forward;
        this.startMove(hero, null, undefined, dir.clone());
        b.dash = -1;
        this.dashCooldown = 0.45;
        return;
      }
    }
    if (b.attack >= t) {
      let next: MoveDef | null = null;
      if (hero.airborne && free) next = SORA_MOVES.airCut;
      else if (!a) next = SORA_COMBO[t < hero.comboUntil ? hero.comboStep : 0];
      else if (a.def.name === "dash" && a.t > 0.22) next = SORA_MOVES.thrust;
      else if (a.def.chain !== undefined && a.t >= a.def.chain) next = SORA_COMBO[hero.comboStep];
      if (next) {
        this.startMove(hero, foe, next);
        const i = SORA_COMBO.indexOf(next);
        if (i >= 0) {
          hero.comboStep = (i + 1) % SORA_COMBO.length;
          hero.comboUntil = t + next.keys[next.keys.length - 1].t + 0.35;
        }
        b.attack = -1;
      }
    }
  }

  // ---------------------------------------------------------------- the others
  private think(dt: number) {
    const hero = this.hero;
    for (const f of this.foes) {
      if (!f.active || f.actor.dead) continue;
      this.obey(f.actor, f.brain.update(dt, this.time, f.actor, hero, this.tokens));
    }
    if (this.phase === "boss" && !this.boss.dead) this.obey(this.boss, this.bossBrain.update(dt, this.time, this.boss, hero));
  }

  private obey(me: Actor, o: Orders) {
    if (me.busy || me.down || me.juggled) return;
    const hero = this.hero;
    if (o.dash) this.startMove(me, null, undefined, o.dash);
    else if (o.slam) this.startMove(me, hero, me.kind === "brute" ? BRUTE_SLAM : KAGE_MOVES.slam);
    else if (o.attack) {
      if (me.kind === "shade") this.startMove(me, hero, SHADE_CUT);
      else {
        const step = this.time < me.comboUntil ? me.comboStep : 0;
        const def = KAGE_COMBO[step];
        this.startMove(me, hero, def);
        me.comboStep = (step + 1) % KAGE_COMBO.length;
        me.comboUntil = this.time + def.keys[def.keys.length - 1].t + 0.4;
      }
    }
  }

  /** Start a move and its effects, placed where the fighter will be at the impact. */
  private startMove(me: Actor, foe: Actor | null, def?: MoveDef, dashDir?: THREE.Vector3) {
    me.guardHeld = false;
    if (!def) {
      const act = me.dash(dashDir!);
      this.fx.fire(me.spec.who === "sora" ? "dashSora" : "dashKage", this.time, me.pos, me.yaw, act.def.impact);
      this.sound("dash");
      return;
    }
    const act = me.play(def, foe, dashDir);
    if (def.impact !== undefined) {
      const s = act.track.at(def.impact);
      const c = Math.cos((act.startYaw * Math.PI) / 180) * me.scale;
      const sn = Math.sin((act.startYaw * Math.PI) / 180) * me.scale;
      V.set(act.startPos.x + c * s.at[0] - sn * s.at[1] + act.lunge.x, act.startPos.y + sn * s.at[0] + c * s.at[1] + act.lunge.y, 0);
      if (def.swing) this.fx.fire(def.swing, this.time, V, act.startYaw + s.yaw, def.impact);
      for (const clip of def.also ?? []) this.fx.fire(clip, this.time, clip === "dashSora" ? me.pos : V, act.startYaw, clip === "leap" ? 0.3 : def.impact);
    }
    this.sound(def.name === "slam" || def.name === "bruteSlam" ? "slam" : def.name === "pierce" ? "dash" : "swing");
  }

  /** Land `me`'s blows that are due. */
  private resolve(me: Actor) {
    const a = me.action;
    if (!a?.def.hits || a.def.impact === undefined || me.dead) return;
    a.def.hits.forEach((hit, i) => {
      if (a.done.has(i) || a.t < a.def.impact! + (hit.delay ?? 0)) return;
      a.done.add(i);
      if (a.def.name === "pierce") this.ultImpact(me);
      const targets = me === this.hero ? this.targets() : [this.hero];
      let first = true;
      for (const t of targets) {
        if (a.struck.has(t)) continue;
        if (this.strike(me, t, hit, first)) {
          a.struck.add(t);
          first = false;
        }
      }
    });
  }

  private targets() {
    const out: Actor[] = [];
    for (const f of this.foes) if (f.active && f.actor.alive) out.push(f.actor);
    if (!this.boss.dead && this.boss.alive && (this.phase === "boss" || this.phase === "bossIntro")) out.push(this.boss);
    return out;
  }

  /** One blow on one fighter. Returns whether it connected. */
  private strike(me: Actor, foe: Actor, hit: HitSpec, fxOn: boolean) {
    if (foe.down || foe.invulnerable || foe.dead) return false;
    const to = V.subVectors(foe.pos, me.pos).setZ(0);
    const dist = to.length() - foe.radius * 0.5;
    const reach = hit.range * Math.max(me.scale, 0.85);
    if (dist > reach || (hit.min !== undefined && dist < hit.min)) return false;
    // height: a grounded sweep misses someone high in a jump
    if (Math.abs(foe.pos.z - me.pos.z) > 1.8 + (hit.kind === "launch" ? 1 : 0)) return false;
    const ang = (Math.acos(THREE.MathUtils.clamp(me.forward.dot(to.normalize()), -1, 1)) * 180) / Math.PI;
    if (ang > hit.arc) return false;
    const faceYaw = yawOf(V2.subVectors(me.pos, foe.pos));
    const facing = Math.abs(((foe.yaw - faceYaw + 540) % 360) - 180) < 100;
    const heroHit = foe === this.hero;

    if (foe.guardHeld && facing && !foe.airborne) {
      if (this.time - foe.guardSince < PARRY_WINDOW && hit.delay === undefined) {
        // parried: the clash, full screen
        const s = heroHit ? foe : me;
        const k = heroHit ? me : foe;
        const mid = V.copy(s.pos).lerp(k.pos, 0.5);
        this.fx.fire("clash", this.time, mid, yawOf(V2.subVectors(k.pos, s.pos)));
        me.play(STAGGER, foe);
        foe.play(PARRY, me);
        this.hitStop(4, 0.18);
        this.sound("clash");
        if (heroHit) this.gainEnergy(15);
        return true;
      }
      foe.hp = Math.max(1, foe.hp - hit.damage * 0.12);
      foe.play(BLOCKED, me);
      if (fxOn) this.fx.fire(hit.clip, this.time, foe.pos, faceYaw);
      this.hitStop(2, 0.05);
      this.sound("block");
      return true;
    }

    foe.hp = Math.max(0, foe.hp - hit.damage);
    foe.guardHeld = false;
    if (fxOn) this.fx.fire(hit.clip, this.time, foe.pos, faceYaw);
    if (heroHit) {
      this.stats.damage += hit.damage;
      this.gainEnergy(3);
      this.combo = 0;
    } else {
      this.combo++;
      this.comboT = COMBO_WINDOW;
      this.stats.maxCombo = Math.max(this.stats.maxCombo, this.combo);
      this.gainEnergy(hit.gain ?? 5);
    }
    const heavyBody = foe.spec.heavy && hit.kind !== "heavy";
    if (hit.kind === "launch" && !heavyBody && foe.kind !== "boss") {
      foe.launch(foe.hp <= 0 ? 8.5 : 7.2, me);
      this.hitStop(2, 0.1);
      this.sound("heavy");
    } else if (hit.kind === "heavy" || (hit.kind === "launch" && !heavyBody)) {
      foe.play(SKID, me);
      if (heroHit) this.fx.fire("skid", this.time, foe.pos, faceYaw, 0.05);
      this.hitStop(3, 0.14);
      this.sound(hit.clip === "waveHit" ? "wave" : "heavy");
    } else {
      if (!heavyBody) foe.play(FLINCH, me);
      this.hitStop(2, 0.08);
      this.sound("hit");
    }
    if (foe.hp <= 0) this.knockOut(foe, me);
    return true;
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
    if (f === this.boss) {
      f.defeat(by);
      this.slow = 0.6;
      this.setPhase("broken");
      this.say("FINISH HIM", "");
      return;
    }
    this.stats.kos++;
    f.defeat(by);
    this.orbs.spawn(f.pos, f.kind === "brute" ? 7 : 3);
    // the last of a wave falls slowly
    const left = this.foes.filter((x) => x.active && x.actor.alive).length + this.pending.length;
    if (left === 0) this.slow = 0.45;
  }

  /** The ultimate lands: the ground shatters under everyone near. */
  private ultImpact(me: Actor) {
    this.fx.fire("pierce", this.time, me.pos, me.yaw);
    this.ultUntil = this.time + 6;
    this.hitStop(4, 0.35);
    this.sound("clash");
    this.sound("slam");
  }

  private hitStop(frames24: number, shake: number) {
    this.freeze = Math.max(this.freeze, frames24 / 24);
    this.camera.shake(shake);
  }

  private gainEnergy(n: number) {
    this.energy = Math.min(ENERGY_MAX, this.energy + n);
  }

  private nearestFoe(within: number) {
    let best: Actor | null = null;
    let bd = within;
    const cands = this.targets();
    for (const a of cands) {
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
    const a = this.arena >= 0 && (this.phase === "ambush" || this.phase === "boss" || this.phase === "bossIntro" || this.phase === "broken") ? this.stage.arenas[this.arena] : null;
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

  // ---------------------------------------------------------------- drawing
  private shot(): Shot {
    const hero = this.hero;
    const a = this.arena >= 0 ? this.stage.arenas[this.arena] : null;
    if (a && (this.phase === "bossIntro" || this.phase === "boss" || this.phase === "broken" || this.phase === "windup")) {
      const b = this.boss;
      const sep = Math.abs(b.pos.x - hero.pos.x);
      return { focusX: (hero.pos.x + b.pos.x) / 2, focusY: (hero.pos.y + b.pos.y) / 2, width: THREE.MathUtils.clamp(sep + 7, 12, 17), clamp: [a.from, a.to] };
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
    fs.pose(this.fx.frames, this.fx.offsets);
    player.post.update(AMBIENT_FRAME, this.fx.postFrames(this.postFrames));

    this.camera.update(DT, this.shot(), framing.aspect);
    if (this.phase === "title" && this.phaseT < 1.6) {
      // from the film's opening camera onto the road
      const tanFilm = fs.filmCamera(OPENING_FRAME, framing, this.filmCam);
      const k = smooth(Math.min(this.phaseT / 1.6, 1));
      V.copy(this.filmCam.position).lerp(this.camera.position, k);
      const tanV = Math.exp(THREE.MathUtils.lerp(Math.log(tanFilm), Math.log(FIGHT_TAN_V), k));
      fs.setCamera(V, this.camera.target, tanV, framing);
      Q.copy(this.filmCam.quaternion).slerp(fs.camera.quaternion, k);
      fs.camera.quaternion.copy(Q);
      fs.camera.updateMatrixWorld(true);
    } else {
      fs.setCamera(this.camera.position, this.camera.target, FIGHT_TAN_V, framing);
    }
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
      const time = this.time;
      const rank = rankOf(time, this.stats.maxCombo, this.stats.damage);
      this.hud.results = { time, maxCombo: this.stats.maxCombo, kos: this.stats.kos + 1, damage: this.stats.damage, rank };
      this.phase = "results";
      this.say("STAGE CLEAR", "");
    }
    return this.player.renderPosed(() => {
      this.player.fs.update(frame, this.player.view);
      this.player.post.update(frame);
    }, now);
  }

  // ---------------------------------------------------------------- hud
  private blankHud(): HudState {
    return {
      phase: "title",
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
      results: null,
    };
  }

  private say(banner: string, sub = "") {
    this.hud.banner = banner;
    this.hud.sub = sub;
  }

  private sync() {
    const h = this.hud;
    h.phase = this.phase;
    h.hp = Math.ceil(this.hero.hp);
    h.maxHp = this.hero.maxHp;
    const showBoss = this.phase === "bossIntro" || this.phase === "boss" || this.phase === "broken" || this.phase === "windup";
    h.boss = showBoss ? { hp: Math.ceil(this.boss.hp), max: this.boss.maxHp } : null;
    h.combo = this.combo;
    const next = this.stage.arenas.findIndex((_, k) => !this.cleared.has(k));
    h.go = this.phase === "explore" && next >= 0 && this.phaseT > 1.2;
    const a = this.arena >= 0 ? this.stage.arenas[this.arena] : null;
    h.wave = this.phase === "ambush" && a ? `WAVE ${this.wave + 1}/${a.waves.length}` : "";
    h.ultReady = this.energy >= ENERGY_MAX;
    h.finishable = this.phase === "broken";
    // transient banners clear themselves
    if (h.banner && ["CLEAR", "AMBUSH", "SHADOW GATE", "HEAVEN PIERCE", "RETRY"].includes(h.banner) && this.phaseT > 1.6) this.say("");
    if (h.banner.startsWith("WAVE") && this.waveT > 1.4) this.say("");
    const key = JSON.stringify(h);
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.events.hud?.({ ...h, boss: h.boss && { ...h.boss }, results: h.results && { ...h.results } });
  }

  private sound(name: SoundName) {
    this.events.sound?.(name);
  }

  /** The finale's film time, for keeping its soundtrack in step. */
  get finaleSeconds() {
    return this.phase === "finisher" ? FINALE_FROM / 24 + Math.max(0, this.phaseT - this.finaleStart) : 0;
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
