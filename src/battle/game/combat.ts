/**
 * The fighting itself, shared by the stage roads and the open valley: the
 * player's buttons turned into moves, the others' orders, every blow landed
 * (guard, parry, crit, launch, knockback), hit-stops and slow motion, energy,
 * the combo counter, and the numbers that pop off each hit.
 *
 * The host (a stage or the world) says who can be struck and what a knockout
 * means; everything else is here.
 */
import * as THREE from "three/webgpu";

import { type Actor, yawOf } from "./actor";
import type { Orders } from "./ai";
import type { FxDirector } from "./fx";
import {
  BLOCKED,
  BOLT_HIT,
  CAST,
  BRUTE_SLAM,
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
  STAGGER,
} from "./moves";

export type SoundName = "swing" | "hit" | "heavy" | "block" | "clash" | "slam" | "wave" | "dash" | "down";

export interface Pop {
  id: number;
  /** screen fractions */
  x: number;
  y: number;
  value: number;
  kind: "hit" | "crit" | "block" | "hurt" | "parry" | "xp";
}

export interface CombatHost {
  /** who `me` can strike */
  targets(me: Actor): Actor[];
  /** someone's health ran out */
  knockOut(f: Actor, by: Actor): void;
  /** a world point on screen (fractions), or null behind the camera */
  project(p: THREE.Vector3): { x: number; y: number } | null;
  shake(amount: number): void;
  sound(name: SoundName): void;
  pop(p: Pop): void;
  /** the ultimate's shatter landed at `at` */
  ultimate?(at: Actor): void;
  /** a ranged cast reached its release: throw the bolt */
  shoot?(me: Actor): void;
}

export const ENERGY_MAX = 100;
export const SKILL_COOLDOWN = 5;
export const COMBO_WINDOW = 2.2;
export const SHOOT_COOLDOWN = 0.65;
const PARRY_WINDOW = 0.22;

const V = new THREE.Vector3();
const V2 = new THREE.Vector3();

export class Combat {
  /** fight clock (stops in hit-stops) */
  time = 0;
  freeze = 0;
  slow = 0;
  energy = 0;
  combo = 0;
  /** how long hit-stops last relative to the film's (the host may shorten them) */
  stopScale = 1;
  comboT = 0;
  skillCooldown = 0;
  shootCooldown = 0;
  dashCooldown = 0;
  stats = { maxCombo: 0, kos: 0, damage: 0 };
  private popId = 0;
  /** button presses waiting to be used (fight-clock deadline) */
  readonly buffer = { attack: -1, jump: -1, dash: -1, skill: -1, ult: -1, finish: -1, shoot: -1 };

  constructor(
    private readonly fx: FxDirector,
    private readonly host: CombatHost,
  ) {}

  reset(keepProgress = false) {
    this.time = 0;
    this.freeze = this.slow = 0;
    this.combo = 0;
    this.skillCooldown = this.dashCooldown = this.shootCooldown = 0;
    for (const k of Object.keys(this.buffer) as (keyof typeof this.buffer)[]) this.buffer[k] = -1;
    if (!keepProgress) {
      this.energy = 0;
      this.stats = { maxCombo: 0, kos: 0, damage: 0 };
    }
  }

  press(button: keyof Combat["buffer"]) {
    const window = { attack: 0.3, jump: 0.15, dash: 0.2, skill: 0.25, ult: 0.25, finish: 0.5, shoot: 0.25 }[button];
    this.buffer[button] = this.time + window;
  }

  /** Advance the fight clock: hit-stops freeze it, a killing blow slows it. Returns this step's fight dt. */
  advance(DT: number) {
    const stopped = this.freeze > 0;
    if (stopped) this.freeze -= DT;
    if (this.slow > 0) this.slow -= DT;
    const dt = stopped ? 0 : this.slow > 0 ? DT * 0.35 : DT;
    this.time += dt;
    if (this.combo > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.combo = 0;
    }
    this.skillCooldown = Math.max(0, this.skillCooldown - dt);
    this.shootCooldown = Math.max(0, this.shootCooldown - dt);
    this.dashCooldown -= dt;
    return dt;
  }

  gainEnergy(n: number) {
    this.energy = Math.min(ENERGY_MAX, this.energy + n * this.heroBoost.energy);
  }

  /**
   * The player's upgrades (the valley's skill ranks; all 1 on the stage
   * roads): damage by kind of blow, the skill and kiếm khí cooldowns, and how
   * fast the ultimate charges.
   */
  heroBoost = { blade: 1, streak: 1, bolt: 1, lotus: 1, skillCooldown: 1, shootCooldown: 1, energy: 1 };

  /** A blow's upgrade: kiếm khí, the streak, the ultimate, or the blade's combo. */
  private boostOf(me: Actor, hit: HitSpec) {
    const b = this.heroBoost;
    if (hit === BOLT_HIT) return b.bolt;
    const name = me.action?.def.name;
    return name === "streak" ? b.streak : name === "pierce" ? b.lotus : b.blade;
  }

  hitStop(frames24: number, shake: number) {
    this.freeze = Math.max(this.freeze, (frames24 / 24) * this.stopScale);
    this.host.shake(shake);
  }

  // ---------------------------------------------------------------- the player
  /**
   * The player's buttons: ultimate, skill, jump, dash, the combo. `foe` is who
   * a blow turns to face (the lock-on); returns the move started, if any.
   */
  control(hero: Actor, guard: boolean, foe: Actor | null): string | null {
    if (hero.down) return null;
    const free = !hero.busy;
    const held = guard && free && !hero.airborne;
    if (held && !hero.guardHeld) hero.guardSince = this.time;
    hero.guardHeld = held;
    const b = this.buffer;
    const t = this.time;
    const a = hero.action;
    const recovering = !!a && a.def.impact !== undefined && a.t > a.def.impact;

    if (b.ult >= t && this.energy >= ENERGY_MAX && (free || recovering)) {
      b.ult = -1;
      this.energy = 0;
      this.startMove(hero, foe, SORA_MOVES.pierce);
      return "ult";
    }
    if (b.skill >= t && this.skillCooldown <= 0 && (free || recovering)) {
      b.skill = -1;
      this.skillCooldown = SKILL_COOLDOWN * this.heroBoost.skillCooldown;
      const dir = hero.wish.lengthSq() > 0.04 ? V.set(hero.wish.x, hero.wish.y, 0) : null;
      this.startMove(hero, dir ? null : foe, SORA_MOVES.streak, dir?.clone());
      return "skill";
    }
    if (b.shoot >= t && this.shootCooldown <= 0 && (free || recovering) && !hero.airborne) {
      b.shoot = -1;
      this.shootCooldown = SHOOT_COOLDOWN * this.heroBoost.shootCooldown;
      // square up to the target (or keep facing where she runs), then flick the blade
      if (foe) hero.yaw = yawOf(V.subVectors(foe.pos, hero.pos).setZ(0));
      else if (hero.wish.lengthSq() > 0.04) hero.yaw = yawOf(V.set(hero.wish.x, hero.wish.y, 0));
      this.startMove(hero, null, CAST);
      return "shoot";
    }
    if (b.jump >= t && free && !hero.airborne) {
      b.jump = -1;
      if (hero.jump()) this.host.sound("dash");
      return "jump";
    }
    if (b.dash >= t && this.dashCooldown <= 0) {
      const cancel = free || (recovering && a!.def.name !== "dash");
      if (cancel && !["flinch", "skid", "stagger", "getup"].includes(a?.def.name ?? "") && !hero.airborne) {
        const dir = hero.wish.lengthSq() > 0.04 ? V.set(hero.wish.x, hero.wish.y, 0) : hero.forward;
        this.startMove(hero, null, undefined, dir.clone());
        b.dash = -1;
        this.dashCooldown = 0.45;
        return "dash";
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
        return next.name;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- the others
  /** Carry out an AI's orders against `foe`. */
  obey(me: Actor, o: Orders, foe: Actor) {
    if (me.busy || me.down || me.juggled) return;
    if (o.dash) this.startMove(me, null, undefined, o.dash);
    else if (o.slam) this.startMove(me, foe, me.kind === "boss" ? KAGE_MOVES.slam : BRUTE_SLAM);
    else if (o.attack) {
      if (me.kind === "shade") this.startMove(me, foe, SHADE_CUT);
      else {
        const step = this.time < me.comboUntil ? me.comboStep : 0;
        const def = KAGE_COMBO[step];
        this.startMove(me, foe, def);
        me.comboStep = (step + 1) % KAGE_COMBO.length;
        me.comboUntil = this.time + def.keys[def.keys.length - 1].t + 0.4;
      }
    }
  }

  /** Start a move and its effects, placed where the fighter will be at the impact. */
  startMove(me: Actor, foe: Actor | null, def?: MoveDef, dashDir?: THREE.Vector3) {
    me.guardHeld = false;
    if (!def) {
      const act = me.dash(dashDir!);
      this.fx.fire(me.spec.who === "sora" ? "dashSora" : "dashKage", this.time, me.pos, me.yaw, act.def.impact);
      this.host.sound("dash");
      return;
    }
    const act = me.play(def, foe, dashDir);
    if (def.impact !== undefined) {
      const s = act.track.at(def.impact);
      const c = Math.cos((act.startYaw * Math.PI) / 180) * me.scale;
      const sn = Math.sin((act.startYaw * Math.PI) / 180) * me.scale;
      V.set(act.startPos.x + c * s.at[0] - sn * s.at[1] + act.lunge.x, act.startPos.y + sn * s.at[0] + c * s.at[1] + act.lunge.y, me.groundZ);
      if (def.swing) this.fx.fire(def.swing, this.time, V, act.startYaw + s.yaw, def.impact);
      for (const clip of def.also ?? []) this.fx.fire(clip, this.time, clip === "dashSora" ? me.pos : V, act.startYaw, clip === "leap" ? 0.3 : def.impact);
    }
    this.host.sound(def.name === "slam" || def.name === "bruteSlam" ? "slam" : def.name === "pierce" ? "dash" : "swing");
  }

  /** Land `me`'s blows that are due. */
  resolve(me: Actor) {
    const a = me.action;
    if (a?.def === CAST && a.t >= CAST.impact! && !a.done.has(-1)) {
      a.done.add(-1);
      this.host.shoot?.(me);
    }
    if (!a?.def.hits || a.def.impact === undefined || me.dead) return;
    a.def.hits.forEach((hit, i) => {
      if (a.done.has(i) || a.t < a.def.impact! + (hit.delay ?? 0)) return;
      a.done.add(i);
      if (a.def.name === "pierce") this.ultImpact(me);
      let first = true;
      for (const t of this.host.targets(me)) {
        if (a.struck.has(t)) continue;
        if (this.strike(me, t, hit, first)) {
          a.struck.add(t);
          first = false;
        }
      }
    });
  }

  /** A blow that arrives from afar (a thrown bolt): lands on `foe` wherever it stands. */
  blast(me: Actor, foe: Actor, hit: HitSpec) {
    return this.strike(me, foe, hit, true, true);
  }

  /** One blow on one fighter. Returns whether it connected. */
  private strike(me: Actor, foe: Actor, hit: HitSpec, fxOn: boolean, aimed = false) {
    if (foe.down || foe.invulnerable || foe.dead) return false;
    const to = V.subVectors(foe.pos, me.pos).setZ(0);
    if (!aimed) {
      const dist = to.length() - foe.radius * 0.5;
      const reach = hit.range * Math.max(me.scale, 0.85);
      if (dist > reach || (hit.min !== undefined && dist < hit.min)) return false;
      // height: a grounded sweep misses someone high in a jump
      if (Math.abs(foe.pos.z - foe.groundZ - (me.pos.z - me.groundZ)) > 1.8 + (hit.kind === "launch" ? 1 : 0)) return false;
      const ang = (Math.acos(THREE.MathUtils.clamp(me.forward.dot(to.normalize()), -1, 1)) * 180) / Math.PI;
      if (ang > hit.arc) return false;
    }
    const faceYaw = yawOf(V2.subVectors(me.pos, foe.pos));
    const facing = Math.abs(((foe.yaw - faceYaw + 540) % 360) - 180) < 100;
    const heroHit = foe.kind === "hero";
    // bigger fighters hit harder
    const damage = hit.damage * me.power * (me.kind === "captain" ? 1.25 : me.kind === "hero" ? this.boostOf(me, hit) : 1);
    const at = V2.set(foe.pos.x, foe.pos.y, foe.groundZ);

    if (foe.guardHeld && facing && !foe.airborne) {
      if (this.time - foe.guardSince < PARRY_WINDOW && hit.delay === undefined) {
        // parried: the clash, full screen
        const s = heroHit ? foe : me;
        const k = heroHit ? me : foe;
        const mid = V.copy(s.pos).lerp(k.pos, 0.5).setZ(s.groundZ);
        this.fx.fire("clash", this.time, mid, yawOf(new THREE.Vector3().subVectors(k.pos, s.pos)));
        me.play(STAGGER, foe);
        foe.play(PARRY, me);
        this.hitStop(4, 0.18);
        this.host.sound("clash");
        this.popAt(foe, 0, "parry");
        if (heroHit) this.gainEnergy(15);
        return true;
      }
      const chip = damage * 0.12;
      foe.hp = Math.max(1, foe.hp - chip);
      foe.play(BLOCKED, me);
      if (fxOn) this.fx.fire(hit.clip, this.time, at, faceYaw);
      this.hitStop(2, 0.05);
      this.host.sound("block");
      this.popAt(foe, chip, "block");
      return true;
    }

    // a blow from behind, or on a fighter in the air, lands harder
    const crit = !heroHit && (!facing || foe.airborne);
    const dealt = damage * (crit ? 1.5 : 1);
    foe.hp = Math.max(0, foe.hp - dealt);
    foe.guardHeld = false;
    this.popAt(foe, dealt, heroHit ? "hurt" : crit ? "crit" : "hit");
    if (fxOn) this.fx.fire(hit.clip, this.time, at, faceYaw);
    if (heroHit) {
      this.stats.damage += dealt;
      this.gainEnergy(3);
      this.combo = 0;
    } else {
      this.combo++;
      this.comboT = COMBO_WINDOW;
      this.stats.maxCombo = Math.max(this.stats.maxCombo, this.combo);
      this.gainEnergy(hit.gain ?? 5);
    }
    const heavyBody = foe.spec.heavy && hit.kind !== "heavy";
    const bossy = foe.kind === "boss" || foe.kind === "captain";
    if (hit.kind === "launch" && !heavyBody && !bossy) {
      foe.launch(foe.hp <= 0 ? 8.5 : 7.2, me);
      this.hitStop(2, 0.1);
      this.host.sound("heavy");
    } else if (hit.kind === "heavy" || (hit.kind === "launch" && !heavyBody)) {
      foe.play(SKID, me);
      if (heroHit) this.fx.fire("skid", this.time, at, faceYaw, 0.05);
      this.hitStop(3, 0.14);
      this.host.sound(hit.clip === "waveHit" ? "wave" : "heavy");
    } else {
      if (!heavyBody) foe.play(FLINCH, me);
      this.hitStop(2, 0.08);
      this.host.sound("hit");
    }
    if (foe.hp <= 0) this.host.knockOut(foe, me);
    return true;
  }

  /** The ultimate lands: the ground shatters under everyone near. */
  private ultImpact(me: Actor) {
    this.fx.fire("pierce", this.time, V.set(me.pos.x, me.pos.y, me.groundZ), me.yaw);
    this.hitStop(4, 0.35);
    this.host.sound("clash");
    this.host.sound("slam");
    this.host.ultimate?.(me);
  }

  private popAt(a: Actor, value: number, kind: Pop["kind"]) {
    const s = this.host.project(V.set(a.pos.x, a.pos.y, a.pos.z + 1.35 * a.scale));
    if (s) this.host.pop({ id: this.popId++, x: s.x, y: s.y, value: Math.round(value), kind });
  }
}
