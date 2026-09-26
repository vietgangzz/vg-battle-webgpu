/**
 * The valley's wild monsters: Meshy-made, skinned and animated creatures
 * (creature.ts) that roam in packs and fight SORA with the same combat as
 * everyone else.
 *
 *  golem        a stone guardian: slow, heavy blows, shrugs off light hits
 *  river_demon  a jade river demon: a trident up close, water orbs from afar
 *  tiger        Ông Ba Mươi, the tiger lord at the pagoda: the valley's boss
 *  tiger_guard  his soldiers, in indigo, barely taller than SORA: quick claws, the odd slam
 *  tiger_brute  his white tigers, in jade: heavy, a slam that shakes the ground
 *
 * A Monster wears the same face to combat.ts as a fighter (position, yaw,
 * health, reactions, defeat), so blades, kiếm khí, crits, guards and parries
 * all apply unchanged; its body is a Creature and its mind is here.
 */
import * as TSL from "three/tsl";
import * as THREE from "three/webgpu";

import { type Actor, forwardOf, type Kind, yawOf } from "../game/actor";
import type { Tokens } from "../game/ai";
import type { Combat } from "../game/combat";
import type { HitSpec, MoveDef } from "../game/moves";
import { glow } from "../game/shading";
import { Creature, type CreatureModel } from "./creature";

export type MonsterKind = "golem" | "river_demon" | "tiger" | "tiger_guard" | "tiger_brute";

interface Spec {
  /** health at level 1, and what combat treats it as (a heavy body shrugs off light blows) */
  hp: number;
  as: Kind;
  heavy: boolean;
  radius: number;
  walk: number;
  run: number;
  /** melee reach (m), the blows it throws (clip, speed, hit, and a ring over the ground where it lands), and the pause between */
  reach: number;
  attacks: { clip: string; speed: number; hit: HitSpec; quake?: number }[];
  cooldown: [number, number];
  /** a thrown water orb: from how far, how often */
  cast?: { min: number; max: number; every: number; speed: number; hit: HitSpec };
  xp: number;
  /** how long a flinch holds it (s) */
  stun: number;
  runClip: string;
  runSpeed: number;
  /** a boss: it roars as it arrives and again in a rage at half health, and only a parry makes it flinch */
  boss?: boolean;
}

/** The tiger lord's roar: a blast of air that throws SORA back if she stands close. */
const ROAR: HitSpec = { range: 99, arc: 180, damage: 4, kind: "heavy", clip: "waveHit" };
const ROAR_REACH = 6;
const ROAR_SPEED = 1.3;

const SPECS: Record<MonsterKind, Spec> = {
  golem: {
    hp: 120,
    as: "brute",
    heavy: true,
    radius: 0.85,
    walk: 1.1,
    run: 2.3,
    reach: 3.0,
    attacks: [
      { clip: "attack", speed: 1.25, hit: { range: 3.4, arc: 70, damage: 15, kind: "heavy", clip: "waveHit" } },
      { clip: "slam", speed: 1.35, hit: { range: 3.8, arc: 120, damage: 19, kind: "heavy", clip: "waveHit" } },
    ],
    cooldown: [1.6, 2.8],
    xp: 40,
    stun: 0.28,
    runClip: "walk",
    runSpeed: 1.6,
  },
  river_demon: {
    hp: 44,
    as: "shade",
    heavy: false,
    radius: 0.45,
    walk: 1.5,
    run: 4.0,
    reach: 2.4,
    attacks: [{ clip: "attack", speed: 1.8, hit: { range: 2.9, arc: 70, damage: 9, kind: "light", clip: "thrustHit" } }],
    cooldown: [1.2, 2.2],
    cast: { min: 6, max: 16, every: 3.2, speed: 15, hit: { range: 99, arc: 180, damage: 11, kind: "light", clip: "thrustHit" } },
    xp: 20,
    stun: 0.5,
    runClip: "run",
    runSpeed: 1.0,
  },
  tiger: {
    hp: 250,
    as: "brute",
    heavy: true,
    radius: 1.0,
    walk: 1.6,
    run: 4.4,
    reach: 3.2,
    attacks: [
      { clip: "attack", speed: 1.45, hit: { range: 3.4, arc: 80, damage: 12, kind: "heavy", clip: "diagonalHit" } },
      { clip: "slam", speed: 1.3, hit: { range: 4.6, arc: 180, damage: 16, kind: "heavy", clip: "waveHit" }, quake: 7 },
    ],
    cooldown: [1.1, 2.1],
    xp: 400,
    stun: 0.9,
    runClip: "run",
    runSpeed: 0.8,
    boss: true,
  },
  tiger_guard: {
    hp: 38,
    as: "shade",
    heavy: false,
    radius: 0.4,
    walk: 1.4,
    run: 4.3,
    reach: 2.2,
    attacks: [
      { clip: "attack", speed: 1.7, hit: { range: 2.6, arc: 75, damage: 8, kind: "light", clip: "diagonalHit" } },
      { clip: "attack", speed: 1.9, hit: { range: 2.6, arc: 75, damage: 8, kind: "light", clip: "fallingHit" } },
      { clip: "slam", speed: 1.6, hit: { range: 2.8, arc: 100, damage: 10, kind: "heavy", clip: "waveHit" } },
    ],
    cooldown: [0.9, 1.9],
    xp: 14,
    stun: 0.5,
    runClip: "run",
    runSpeed: 1.15,
  },
  tiger_brute: {
    hp: 100,
    as: "brute",
    heavy: true,
    radius: 0.62,
    walk: 1.2,
    run: 3.0,
    reach: 2.8,
    attacks: [
      { clip: "attack", speed: 1.35, hit: { range: 3.0, arc: 75, damage: 12, kind: "heavy", clip: "diagonalHit" } },
      { clip: "slam", speed: 1.35, hit: { range: 3.8, arc: 140, damage: 16, kind: "heavy", clip: "waveHit" }, quake: 4.5 },
    ],
    cooldown: [1.4, 2.6],
    xp: 32,
    stun: 0.3,
    runClip: "run",
    runSpeed: 0.95,
  },
};

const V = new THREE.Vector3();
const V2 = new THREE.Vector3();
let ids = 1000;

type State = "idle" | "wander" | "chase" | "attack" | "cast" | "stun" | "roar" | "dying" | "gone";

/** A red "!" that pops over a monster's head the moment it notices SORA. */
function alertMaterial() {
  const m = new THREE.SpriteNodeMaterial();
  const uv = TSL.uv();
  const x = uv.x.sub(0.5).abs();
  // the bar (tapering down) and the dot, soft-edged
  const bar = TSL.smoothstep(0.1, 0.06, x.sub(uv.y.sub(0.35).mul(0.08))).mul(TSL.smoothstep(0.33, 0.37, uv.y)).mul(TSL.smoothstep(0.97, 0.93, uv.y));
  const dot = TSL.smoothstep(0.1, 0.07, TSL.vec2(x, uv.y.sub(0.16)).length());
  const shape = bar.add(dot).clamp(0, 1);
  const edge = TSL.smoothstep(0.2, 0.12, x).mul(TSL.smoothstep(0.02, 0.06, uv.y)).mul(TSL.smoothstep(1, 0.95, uv.y)).sub(shape).clamp(0, 1);
  m.colorNode = TSL.vec4(TSL.vec3(3.2, 0.5, 0.25).mul(shape).add(TSL.vec3(0.05, 0.02, 0.02).mul(edge)), shape.add(edge.mul(0.85)).clamp(0, 1));
  m.transparent = true;
  m.depthWrite = false;
  m.fog = false;
  return m;
}
let ALERT: THREE.SpriteNodeMaterial | null = null;

/** One monster. The fields combat reads are named as on an Actor. */
export class Monster {
  readonly id = ids++;
  readonly body: Creature;
  readonly spec: Spec & { who: "kage"; clone: true; scale: number; speed: number };
  readonly pos = new THREE.Vector3();
  readonly wish = new THREE.Vector2();
  readonly home = new THREE.Vector3();
  yaw = 0;
  scale: number;
  hp: number;
  maxHp: number;
  level = 1;
  power = 1;
  groundZ = 0;
  down = false;
  dead = true;
  juggled = false;
  vanish = -1;
  guardHeld = false;
  guardSince = -1;
  action = null;
  target: Actor | null = null;
  /** has it noticed SORA */
  aggro = false;
  pack = -1;
  /** the shadow camp it was called to (-1: none) */
  camp = -1;
  /** a boss past half health: quicker, and its blows come sooner */
  raged = false;
  private state: State = "gone";
  private t = 0;
  private until = 0;
  private nextAttack = 0;
  private nextCast = 0;
  private blow: Spec["attacks"][number] | null = null;
  private landed = false;
  private push = new THREE.Vector2();
  private wanderTo: THREE.Vector2 | null = null;
  private readonly rand: () => number;
  /** flinches in quick succession, and super armour after too many (so a crowd can't be stun-locked forever) */
  private flinches = 0;
  private lastFlinch = -10;
  private armourUntil = -1;
  private clock = 0;
  /** held fast while chasing (s), and the sidestep round what holds it: time left, and which way */
  private stuckT = 0;
  private detourT = 0;
  private detourSide = 1;
  /** the "!" over its head when it first notices SORA */
  private readonly alert: THREE.Sprite;
  get alertSprite() {
    return this.alert;
  }
  private alertT = -1;
  private wasAggro = false;

  constructor(
    readonly kind: MonsterKind,
    model: CreatureModel,
    parent: THREE.Object3D,
    seed: number,
  ) {
    const s = SPECS[kind];
    this.body = new Creature(model);
    this.body.root.visible = false;
    parent.add(this.body.root);
    ALERT ??= alertMaterial();
    this.alert = new THREE.Sprite(ALERT);
    this.alert.center.set(0.5, 0);
    this.alert.visible = false;
    parent.add(this.alert);
    this.scale = model.entry.height / 1.5;
    this.spec = { ...s, who: "kage", clone: true, scale: this.scale, speed: s.run };
    this.hp = this.maxHp = s.hp;
    let a = seed >>> 0;
    this.rand = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** combat treats it as a shadow or a brute */
  get as(): Kind {
    return this.spec.as;
  }
  get radius() {
    return this.spec.radius;
  }
  get forward() {
    return forwardOf(this.yaw);
  }
  get busy() {
    return this.state === "attack" || this.state === "cast" || this.state === "stun" || this.state === "roar";
  }
  get airborne() {
    return false;
  }
  get alive() {
    return !this.dead && !this.down && this.hp > 0;
  }
  get invulnerable() {
    return this.state === "gone";
  }
  get attacking() {
    return this.state === "attack" && !this.landed;
  }
  get xp() {
    return this.spec.xp;
  }

  /** Stand it at (x, y) at `level`, unaware, facing `yaw` (degrees). */
  place(x: number, y: number, ground: number, level: number, yaw: number) {
    const s = SPECS[this.kind];
    this.level = level;
    this.maxHp = this.hp = Math.round(s.hp * (1 + 0.35 * (level - 1)));
    this.power = 1 + 0.14 * (level - 1);
    this.pos.set(x, y, ground);
    this.home.set(x, y, ground);
    this.groundZ = ground;
    this.yaw = yaw;
    this.down = this.dead = false;
    this.aggro = this.wasAggro = false;
    this.alertT = -1;
    this.alert.visible = false;
    this.raged = false;
    this.state = "idle";
    this.until = this.rand() * 2;
    this.wanderTo = null;
    this.push.set(0, 0);
    this.body.root.visible = true;
    this.body.root.position.copy(this.pos);
    this.body.play("idle", { fade: 0 });
    this.sync();
  }

  /** Called to the fight at once, already after SORA (a camp's soldier, or the boss: who arrives roaring). */
  wake(time: number) {
    this.aggro = this.wasAggro = true;
    this.nextAttack = time + 0.8;
    if (this.spec.boss) this.roar();
    else this.state = "chase";
  }

  /** Take it off the field. */
  remove() {
    this.dead = true;
    this.down = false;
    this.camp = -1;
    this.state = "gone";
    this.body.root.visible = false;
    this.alert.visible = false;
  }

  // ---------------------------------------------------------------- what combat does to it
  /** A reaction to a blow (the fighters' reaction moves, by name). */
  play(def: MoveDef, from: Actor | null) {
    if (this.down || this.dead) return;
    const heavy = this.spec.heavy;
    const name = def.name;
    // the blow pushes it back along the line from the striker
    if (from) {
      V.subVectors(this.pos, from.pos).setZ(0).normalize();
      const k = (name === "skid" ? (heavy ? 1.2 : 2.6) : name === "stagger" ? 1.2 : heavy ? 0.1 : 0.5) * (this.spec.boss ? 0.3 : 1);
      this.push.set(V.x * k * 6, V.y * k * 6);
    }
    this.body.flash(1);
    this.aggro = true;
    // a boss stands its ground (roaring, it can't be stopped at all); only a parry staggers it
    if (this.spec.boss && (name !== "stagger" || this.state === "roar")) return;
    // a heavy body only stops for a heavy blow or a parry
    if (heavy && name !== "skid" && name !== "stagger") return;
    // armoured up: it takes the blow and keeps coming (a parry still breaks it)
    if (this.clock < this.armourUntil && name !== "stagger") return;
    this.flinches = this.clock - this.lastFlinch < 1.6 ? this.flinches + 1 : 1;
    this.lastFlinch = this.clock;
    if (this.flinches >= 3) {
      this.armourUntil = this.clock + 1.6;
      this.flinches = 0;
      // it shakes the hit off and strikes back at once
      this.nextAttack = 0;
    }
    this.stun(name === "stagger" ? 1.1 : this.spec.stun);
  }

  launch(_speed: number, from: Actor) {
    this.play({ name: "skid", keys: [] }, from);
  }

  defeat(from: Actor | null) {
    this.down = true;
    this.hp = 0;
    this.state = "dying";
    this.t = 0;
    if (from) this.yaw = yawOf(V.subVectors(from.pos, this.pos).setZ(0));
    this.body.play("death", { loop: false, fade: 0.1 });
    this.body.flash(1);
  }

  private stun(seconds: number) {
    if (this.state === "dying") return;
    this.state = "stun";
    this.t = 0;
    this.until = seconds;
    this.blow = null;
    if (!this.body.play("hit", { loop: false, fade: 0.06, speed: 1.4 })) this.body.play("idle", { fade: 0.06, speed: 0.4 });
  }

  /** The boss's roar: it squares up, beats its chest and roars, and the air throws SORA back. */
  private roar() {
    this.state = "roar";
    this.t = 0;
    this.landed = false;
    this.blow = null;
    this.body.play("roar", { loop: false, fade: 0.15, speed: ROAR_SPEED });
  }

  // ---------------------------------------------------------------- its mind
  update(dt: number, time: number, hero: Actor, ctx: MonsterContext) {
    if (this.state === "gone") return;
    this.t += dt;
    this.clock += dt;
    this.body.update(dt);
    const s = SPECS[this.kind];
    if (this.state === "dying") {
      // lie still, then sink into the ground and go
      if (this.t > 2.6) this.body.root.position.z = this.groundZ - (this.t - 2.6) * 1.2;
      if (this.t > 3.6) this.remove();
      return;
    }
    // shoves from blows ease off
    if (this.push.lengthSq() > 1e-4) {
      this.pos.x += this.push.x * dt;
      this.pos.y += this.push.y * dt;
      this.push.multiplyScalar(Math.exp(-dt * 9));
    }
    // the moment it notices her: a "!" pops up, and it squares up for a beat before charging
    if (this.aggro && !this.wasAggro && this.state !== "stun") {
      this.alertT = 0;
      this.nextAttack = Math.max(this.nextAttack, time + 0.6);
      if (this.state === "idle" || this.state === "wander") this.state = "chase";
    }
    this.wasAggro = this.aggro;
    if (this.alertT >= 0) {
      this.alertT += dt;
      const pop = this.alertT < 0.15 ? this.alertT / 0.15 : 1;
      this.alert.visible = this.alertT < 1.3;
      this.alert.scale.set(0.55 * pop, 0.9 * pop, 1);
      this.alert.position.set(this.pos.x, this.pos.y, this.pos.z + this.body.model.entry.height + 0.35 + 0.1 * Math.sin(this.alertT * 12));
      if (this.alertT > 1.3) this.alertT = -1;
    }
    const toHero = V.subVectors(hero.pos, this.pos).setZ(0);
    const dist = toHero.length();
    let move = 0;

    switch (this.state) {
      case "idle":
      case "wander": {
        if (this.aggro) {
          this.state = "chase";
          break;
        }
        if (!this.wanderTo) {
          this.until -= dt;
          if (this.until <= 0) {
            const a = this.rand() * Math.PI * 2;
            const r = 1.5 + this.rand() * 5;
            this.wanderTo = new THREE.Vector2(this.home.x + Math.cos(a) * r, this.home.y + Math.sin(a) * r);
          }
        } else {
          V2.set(this.wanderTo.x - this.pos.x, this.wanderTo.y - this.pos.y, 0);
          const d = V2.length();
          if (d < 0.4) {
            this.wanderTo = null;
            this.until = 1.5 + this.rand() * 3;
          } else {
            this.turnTo(V2, dt, 4);
            move = s.walk;
          }
        }
        this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.05 * dt);
        this.anim(move > 0 ? "walk" : "idle", move > 0 ? 1 : 1);
        break;
      }
      case "chase": {
        if (!this.aggro) {
          this.state = "wander";
          this.wanderTo = new THREE.Vector2(this.home.x, this.home.y);
          break;
        }
        this.turnTo(toHero, dt, 7);
        if (s.boss && !this.raged && this.hp < this.maxHp * 0.5) {
          this.raged = true;
          this.roar();
          break;
        }
        const cast = s.cast;
        if (cast && dist > cast.min && dist < cast.max && time > this.nextCast && hero.hp > 0) {
          this.state = "cast";
          this.t = 0;
          this.landed = false;
          this.nextCast = time + cast.every * (0.8 + this.rand() * 0.5);
          this.body.play("cast", { loop: false, fade: 0.1, speed: 1.4 });
          break;
        }
        if (dist < s.reach && time > this.nextAttack && hero.hp > 0 && ctx.tokens.take(this.id)) {
          this.blow = s.attacks[Math.floor(this.rand() * s.attacks.length)];
          this.state = "attack";
          this.t = 0;
          this.landed = false;
          this.body.play(this.blow.clip, { loop: false, fade: 0.08, speed: this.blow.speed * this.fury });
          break;
        }
        // close in; hover just outside reach while waiting a turn
        const want = dist > s.reach * 0.8 ? s.run * this.fury : 0;
        move = dist > s.reach + 4 ? want : want * 0.6;
        this.anim(move > 0 ? s.runClip : "idle", move > s.walk * 1.3 ? s.runSpeed : 1);
        break;
      }
      case "attack": {
        const blow = this.blow!;
        const impact = (this.body.impact(blow.clip) ?? 0.5) / (blow.speed * this.fury);
        if (this.t < impact * 0.8) this.turnTo(toHero, dt, 5);
        if (!this.landed && this.t >= impact) {
          this.landed = true;
          const facing = this.forward.dot(V2.copy(toHero).normalize()) > Math.cos((blow.hit.arc * Math.PI) / 180);
          if (dist < blow.hit.range && facing) ctx.combat.blast(this as unknown as Actor, hero, blow.hit);
          ctx.shake(this.spec.heavy ? (s.boss ? 0.2 : 0.12) : 0.03);
          if (blow.quake) ctx.quake?.(V2.set(this.pos.x, this.pos.y, this.groundZ), blow.quake);
        }
        if (this.t > impact + (this.spec.heavy ? 0.7 : 0.45)) this.endAttack(time);
        break;
      }
      case "cast": {
        const cast = s.cast!;
        const impact = (this.body.impact("cast") ?? 0.6) / 1.4;
        this.turnTo(toHero, dt, 6);
        if (!this.landed && this.t >= impact) {
          this.landed = true;
          ctx.orbs.fire(this.body.hand(V2), hero, cast.speed, (h) => ctx.combat.blast(this as unknown as Actor, h, cast.hit));
        }
        if (this.t > impact + 0.5) this.endAttack(time);
        break;
      }
      case "roar": {
        const at = (this.body.impact("roar") ?? 1.6) / ROAR_SPEED;
        if (this.t < at) this.turnTo(toHero, dt, 3);
        if (!this.landed && this.t >= at) {
          this.landed = true;
          if (dist < ROAR_REACH && hero.hp > 0) ctx.combat.blast(this as unknown as Actor, hero, ROAR);
          ctx.shake(0.3);
          ctx.quake?.(V2.set(this.pos.x, this.pos.y, this.groundZ), 9);
        }
        if (this.t > at + 0.75) {
          this.state = "chase";
          this.nextAttack = time + 0.3;
        }
        break;
      }
      case "stun":
        if (this.t > this.until) {
          ctx.tokens.give(this.id);
          this.state = this.aggro ? "chase" : "idle";
        }
        break;
    }

    const x0 = this.pos.x;
    const y0 = this.pos.y;
    if (move > 0) {
      // walking round something in the way: it heads off to one side for a moment
      const f = this.detourT > 0 ? forwardOf(this.yaw + this.detourSide * 70, V2) : this.forward;
      this.detourT -= dt;
      this.pos.x += f.x * move * dt;
      this.pos.y += f.y * move * dt;
    }
    ctx.collide(this);
    // chasing her but held fast (a straight line into a post, an urn, a wall): step round it
    if (move > 0 && this.state === "chase") {
      const went = Math.hypot(this.pos.x - x0, this.pos.y - y0);
      this.stuckT = went < move * dt * 0.3 ? this.stuckT + dt : Math.max(0, this.stuckT - dt * 2);
      if (this.stuckT > 0.35 && this.detourT <= 0) {
        this.detourSide = this.rand() < 0.5 ? -1 : 1;
        this.detourT = 0.9;
        this.stuckT = 0;
      }
    }
    this.groundZ = ctx.ground(this.pos.x, this.pos.y);
    this.pos.z = this.groundZ;
    this.sync();
  }

  private endAttack(time: number) {
    const s = SPECS[this.kind];
    this.state = "chase";
    this.blow = null;
    this.nextAttack = time + (s.cooldown[0] + this.rand() * (s.cooldown[1] - s.cooldown[0])) / this.fury;
  }

  /** how much faster a raging boss moves and strikes */
  private get fury() {
    return this.raged ? 1.3 : 1;
  }

  private turnTo(dir: THREE.Vector3, dt: number, rate: number) {
    if (dir.lengthSq() < 1e-6) return;
    const want = yawOf(dir);
    let d = ((want - this.yaw + 540) % 360) - 180;
    d = THREE.MathUtils.clamp(d, -rate * 60 * dt, rate * 60 * dt);
    this.yaw += d;
  }

  private anim(name: string, speed: number) {
    if (this.body.playing !== name) this.body.play(name, { speed });
  }

  /** Put the body where the mind is. */
  private sync() {
    this.body.root.position.copy(this.pos);
    const f = this.forward;
    this.body.face(Math.atan2(f.y, f.x));
  }
}

export interface MonsterContext {
  combat: Combat;
  tokens: Tokens;
  orbs: WaterOrbs;
  shake(n: number): void;
  ground(x: number, y: number): number;
  collide(m: Monster): void;
  /** a slam or a roar: a ring over the ground at `at`, `size` metres out */
  quake?(at: THREE.Vector3, size: number): void;
}

// ---------------------------------------------------------------- the river demon's orbs
/** Jade water orbs thrown at SORA: they fly at her chest and burst on contact, or fall apart after a while. */
export class WaterOrbs {
  readonly group = new THREE.Group();
  private readonly orbs: { mesh: THREE.Mesh; halo: THREE.Sprite; live: boolean; t: number; vel: THREE.Vector3; target: Actor | null; hit: ((a: Actor) => void) | null }[] = [];

  constructor() {
    const core = glow([0.3, 1, 0.8], 4, false);
    const geo = new THREE.IcosahedronGeometry(0.22, 2);
    const halo = new THREE.SpriteNodeMaterial();
    const r = TSL.uv().sub(0.5).length().mul(2);
    halo.colorNode = TSL.vec4(TSL.vec3(0.3, 1, 0.8).mul(2), TSL.float(1).sub(r).clamp(0, 1).pow(2));
    halo.transparent = true;
    halo.depthWrite = false;
    // light in the air: never cut off where it meets the ground
    halo.depthTest = false;
    halo.blending = THREE.AdditiveBlending;
    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Mesh(geo, core);
      const h = new THREE.Sprite(halo);
      h.scale.setScalar(1.3);
      mesh.visible = h.visible = false;
      this.group.add(mesh, h);
      this.orbs.push({ mesh, halo: h, live: false, t: 0, vel: new THREE.Vector3(), target: null, hit: null });
    }
  }

  fire(from: THREE.Vector3, target: Actor, speed: number, hit: (a: Actor) => void) {
    const o = this.orbs.find((x) => !x.live) ?? this.orbs[0];
    o.live = true;
    o.t = 0;
    o.mesh.position.copy(from);
    o.target = target;
    o.hit = hit;
    V.set(target.pos.x, target.pos.y, target.pos.z + 1.0).sub(from).normalize().multiplyScalar(speed);
    o.vel.copy(V);
    o.mesh.visible = o.halo.visible = true;
  }

  update(dt: number) {
    for (const o of this.orbs) {
      if (!o.live) continue;
      o.t += dt;
      const tg = o.target;
      if (tg) {
        // a gentle pull toward her, so a sidestep still dodges it
        V.set(tg.pos.x, tg.pos.y, tg.pos.z + 1.0).sub(o.mesh.position);
        const d = V.length();
        o.vel.lerp(V.normalize().multiplyScalar(o.vel.length()), Math.min(1, dt * 1.2));
        if (d < 0.9 && tg.hp > 0) {
          o.hit?.(tg);
          o.live = false;
        }
      }
      o.mesh.position.addScaledVector(o.vel, dt);
      o.mesh.scale.setScalar(1 + 0.15 * Math.sin(o.t * 30));
      o.halo.position.copy(o.mesh.position);
      if (o.t > 2.2) o.live = false;
      if (!o.live) o.mesh.visible = o.halo.visible = false;
    }
  }

  clear() {
    for (const o of this.orbs) {
      o.live = false;
      o.mesh.visible = o.halo.visible = false;
    }
  }
}

// ---------------------------------------------------------------- packs
/**
 * Where the wild monsters lurk, how strong they are and who runs with them:
 * the tiger lord's soldiers in the fields near the village, demons along the
 * river, guardians with them deeper in, the strongest at the foot of the pagoda.
 */
export const PACKS: { x: number; y: number; level: number; kinds: MonsterKind[] }[] = [
  { x: -86, y: -52, level: 1, kinds: ["tiger_guard", "tiger_guard"] },
  { x: -72, y: -3, level: 1, kinds: ["tiger_guard", "river_demon"] },
  { x: -46, y: -46, level: 2, kinds: ["tiger_guard", "tiger_guard", "tiger_guard"] },
  { x: -8, y: -38, level: 2, kinds: ["river_demon", "river_demon"] },
  { x: 14, y: 8, level: 3, kinds: ["tiger_guard", "tiger_guard", "golem"] },
  { x: -46, y: 32, level: 3, kinds: ["river_demon", "tiger_guard", "tiger_guard"] },
  { x: -22, y: 64, level: 4, kinds: ["golem", "tiger_guard", "river_demon"] },
  { x: 46, y: 34, level: 5, kinds: ["tiger_guard", "tiger_guard", "river_demon", "golem"] },
  { x: 82, y: 8, level: 5, kinds: ["golem", "river_demon", "river_demon"] },
  { x: 16, y: 92, level: 6, kinds: ["golem", "golem", "tiger_guard", "tiger_guard"] },
];
