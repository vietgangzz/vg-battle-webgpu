/**
 * The showcase demo (?demo=1): about a minute of play for a screen recording
 * (cut down to a reel), driven by two programmed thumbs. The left one works
 * the stick (steering SORA down the towpath and over the bridge, turned to
 * the camera's heading as a player's thumb would be), the right one holds
 * sprint and plays every skill she has: the blade's combo, the sword streak,
 * a jump and an air cut, kiếm khí, the dash, the Heaven Pierce and, against
 * the tiger lord (who meets her off the bridge), the lotus tempest; when he
 * swings, it either dashes her out of the way or parries him (the guard
 * pressed just before the blow lands, which staggers even him). The touches go through the controls themselves
 * (see Synth) and are drawn as fingertips (see Fingers), so the picture is
 * what a hand playing it shows.
 */
import type { Explore } from "@/battle/world/explore";

import type { ButtonId, Synth } from "./controls";
import type { FingerApi } from "./fingers";

export interface DemoEnv {
  game: () => Explore | null;
  synth: { current: Synth | null };
  fingers: { current: FingerApi | null };
  /** the window's size in points */
  window: { width: number; height: number };
  /** the main menu's explore button, in points */
  menuButton: { x: number; y: number };
  /** into the valley (the menu's button), `then` once SORA is there */
  explore(then: () => void): void;
  done?(): void;
}

type P = { x: number; y: number };
const L = 0;
const R = 1;
/** from where the valley starts (the village) past the village shrine, down the towpath to the bank by the bridge */
const TO_FIGHT: P[] = [
  { x: -97, y: -29 },
  { x: -90, y: -16 },
  { x: -78, y: -13.5 },
  { x: -66, y: -14 },
  { x: -52, y: -18 },
  { x: -42, y: -22 },
];
/** round to the bridge's south end and onto it along its line, up to the top of its arch (checked with tools/route-check.ts) */
const TO_BRIDGE: P[] = [
  { x: -33, y: -24.5 },
  { x: -27, y: -25.5 },
  { x: -24.25, y: -25.5 },
  { x: -24.05, y: -22.5 },
  { x: -23.6, y: -14 },
  { x: -23.2, y: -8 },
];
/** on over the top, down the far side (the deck ends at y 6) and out onto the open grass past it, where the tiger lord meets her (checked with tools/route-check.ts and tools/demo-boss-check.ts) */
const ACROSS: P[] = [
  { x: -22.8, y: -1 },
  { x: -22.5, y: 4 },
  { x: -22.6, y: 8.5 },
  { x: -27, y: 11 },
];
/** where the tiger lord bars her way: up the grass strip along the north bank, west of the bridge; and the dry ground they fight on (the river to the south, the flooded terraces from y 18) */
const LORD_AT: P = { x: -36, y: 13.5 };
const ARENA = { x0: -42, x1: -26, y0: 8.5, y1: 16.2 };
/** the lens looks north-west to north-east over them (it stands over the open river, the terraces behind them): bamboo and reeds crowd the bank either side */
const ARENA_LENS: [number, number] = [60, 125];

export function runDemo(env: DemoEnv) {
  const { width: W, height: H } = env.window;
  const t0 = performance.now();
  const now = () => (performance.now() - t0) / 1000;
  // what is due, and when (seconds from the start); each runs once, on the first frame at or after its time
  const steps: { at: number; run: () => void; done: boolean }[] = [];
  const at = (t: number, run: () => void) => steps.push({ at: t, run, done: false });
  // the right thumb's travel: from where it is to a point over `secs`, dragging (touch held) or not
  let rFrom: P = { x: W * 0.8, y: H * 0.95 };
  let rTo: P = rFrom;
  let rStart = 0;
  let rSecs = 0;
  let rDragging = false;
  let rPos: P = rFrom;
  // the left thumb: down on the stick, steering toward the next of `route`, or toward whoever SORA fights
  let route: P[] = [];
  let arrived: (() => void) | null = null;
  let lDown = false;
  /** the left thumb wants the stick (it goes down as soon as the controls are there to take it) */
  let lWant = false;
  let chase = false;
  /** the tiger lord has been called (off the bridge), and is out and fighting */
  let lordCalled = false;
  let lordOut = false;
  // a dash out of the way of his swing: which side, which way (on the ground), until when, and when the next may go
  let dodgeSide = 1;
  let dodgeDir: P = { x: 0, y: 0 };
  let dodgeUntil = 0;
  let dodgeReady = 0;
  /** his swings are met in turn with a dash out of the way and a parry; `parry` holds the guard for the one on its way */
  let parryNext = false;
  let swings = 0;
  let parrying = false;
  let knob: P = { x: 0, y: 0 };
  // what the right thumb does while SORA runs: sprint in bursts (her stamina lasts about five seconds), a drag of the camera between
  let runT = -1;
  let runBeat = 0;

  /** the controls as laid out (none until they are on screen and measured: a touch before then lands nowhere, or on the camera) */
  const layout = () => {
    const l = env.synth.current?.layout();
    return l && l.width > 0 && l.height > 0 && l.buttons.length ? l : undefined;
  };
  const button = (id: ButtonId): P => {
    const b = layout()?.buttons.find((x) => x.id === id);
    return b ? { x: b.x, y: b.y } : { x: W * 0.85, y: H * 0.85 };
  };
  const glide = (to: P, secs: number, drag = false) => {
    rFrom = rPos;
    rTo = to;
    rStart = now();
    rSecs = secs;
    rDragging = drag;
  };
  const rShow = (on: boolean) => env.fingers.current?.show(R, on);
  /** the right thumb taps a button: over to it, press, lift (only if `when` still holds as it sets off) */
  const tap = (t: number, id: ButtonId, when?: () => boolean) => {
    let go = true;
    at(t - 0.14, () => {
      go = !when || when();
      if (!go) return;
      rShow(true);
      glide(button(id), 0.12);
    });
    at(t, () => {
      if (!go) return;
      const p = button(id);
      env.synth.current?.up("R");
      env.synth.current?.down("R", p.x, p.y);
      env.fingers.current?.press(R);
    });
    at(t + 0.1, () => go && env.synth.current?.up("R"));
  };
  /** the right thumb holds a button from t to t2 */
  const hold = (t: number, t2: number, id: ButtonId) => {
    at(t - 0.16, () => {
      rShow(true);
      glide(button(id), 0.14);
    });
    at(t, () => {
      const p = button(id);
      env.synth.current?.up("R");
      env.synth.current?.down("R", p.x, p.y);
      env.fingers.current?.press(R);
    });
    at(t2, () => env.synth.current?.up("R"));
  };
  const lPress = () => {
    lWant = true;
    const l = layout();
    if (!l || lDown) return;
    lDown = true;
    knob = { x: 0, y: 0 };
    env.synth.current?.down("L", l.home.x, l.home.y);
    env.fingers.current?.place(L, l.home.x, l.home.y);
    env.fingers.current?.show(L, true);
  };
  const lLift = () => {
    lWant = false;
    if (!lDown) return;
    lDown = false;
    env.synth.current?.up("L");
    env.fingers.current?.show(L, false);
  };
  const go = (points: P[], then: () => void) => {
    route = [...points];
    arrived = then;
    lPress();
  };

  // ---------------------------------------------------------------- the menu: a thumb taps EXPLORE
  at(0.1, () => {
    env.fingers.current?.place(R, rPos.x, rPos.y);
    rShow(true);
    glide(env.menuButton, 0.8);
  });
  at(1.05, () => env.fingers.current?.press(R));
  at(1.2, () => {
    rShow(false);
    env.explore(() => env.game()?.demoSetup());
  });
  // ---------------------------------------------------------------- from the village down the towpath
  at(4.3, () => {
    runT = now();
    go(TO_FIGHT, fight);
  });

  // ---------------------------------------------------------------- the ambush, the Heaven Pierce, the lotus tempest
  function fight() {
    runT = -1;
    const t = now();
    lLift();
    env.synth.current?.up("R");
    env.game()?.brawl(2, false);
    at(t + 0.5, () => {
      chase = true;
      lPress();
    });
    for (const k of [0.8, 1.15, 1.5]) tap(t + k, "attack");
    tap(t + 2.0, "skill");
    // up, and a cut on the way down
    tap(t + 2.6, "jump");
    tap(t + 2.85, "attack");
    tap(t + 3.3, "dash");
    tap(t + 3.7, "shoot");
    at(t + 4.1, () => env.game()?.charge(1));
    tap(t + 4.7, "ult");
    at(t + 7.6, () => {
      chase = false;
      lLift();
      env.game()?.demoCalm();
    });
    at(t + 8.0, () => {
      runT = now();
      runBeat = 0;
      go(TO_BRIDGE, outro);
    });
  }

  // ---------------------------------------------------------------- over the bridge, and the tiger lord comes to meet her
  function outro() {
    runT = -1;
    const t = now();
    env.synth.current?.up("R");
    rShow(false);
    // she walks on over the top and down the far side (the lens raised on the bridge, left to follow her),
    // and as she steps off it the tiger lord bars her way
    route = [...ACROSS];
    arrived = callLord;
    at(t + 9, callLord);
  }

  function callLord() {
    if (lordCalled) return;
    lordCalled = true;
    route = [];
    arrived = null;
    env.game()?.demoLordAt(LORD_AT.x, LORD_AT.y, 1000, ARENA, ARENA_LENS);
  }

  /** He is out and fighting (his roar done): she goes in with kiếm khí, the blade, and when he is worn down, the lotus tempest. */
  function lordFight() {
    const t = now();
    lPress();
    const g = env.game;
    tap(t + 0.3, "shoot");
    hold(t + 0.75, t + 2.0, "sprint");
    // (worn to half, he roars in a rage: sooner than the blows alone would take him there)
    at(t + 7.4, () => {
      const lord = g()?.demoLord();
      if (lord && lord.hp > lord.maxHp * 0.5) g()?.demoWear(lord.maxHp * 0.49);
    });
    // the right thumb never rests: every third of a second it does what a player would there and then:
    // up close the blade (a sword streak when it is ready, now and then a jump and a cut on the way
    // down), from afar kiếm khí as she runs in; it holds only for his wind-up (the dash or the guard)
    let lastSkill = -10;
    let lastJump = 1;
    let lastShot = 0.3;
    const beat = () => {
      const k = now() - t;
      if (k > 13.3) return;
      at(now() + 0.33, beat);
      const lord = g()?.demoLord();
      const h = g()?.hero.pos;
      if (!lord || !h || now() < dodgeUntil || lord.attacking) return;
      const d = Math.hypot(lord.pos.x - h.x, lord.pos.y - h.y);
      if (d > 5.5) {
        if (k - lastShot > 1.4) {
          lastShot = k;
          tap(now() + 0.14, "shoot");
        }
        return;
      }
      if (k - lastSkill > 5.2) {
        lastSkill = k;
        tap(now() + 0.14, "skill");
      } else if (k - lastJump > 4 && d < 4) {
        lastJump = k;
        tap(now() + 0.14, "jump");
        tap(now() + 0.4, "attack");
      } else if (d < 4.2) tap(now() + 0.14, "attack");
    };
    at(t + 1.9, beat);
    at(t + 13.4, () => g()?.charge(2));
    // the lotus tempest (pressed again while she is still reeling from a blow and it will not go)
    const ult = (k: number, tries: number) => {
      tap(k, "ult");
      at(k + 0.4, () => {
        if (tries > 1 && g()?.demoCharged()) ult(now() + 0.05, tries - 1);
        else {
          rShow(false);
          at(now() + 3.4, () => {
            lLift();
            stop();
            env.done?.();
          });
        }
      });
    };
    ult(t + 14.0, 8);
  }

  /** while running: sprint for four seconds, let the stamina come back, sprint again (the camera left to follow her, as a player leaves it) */
  const runHands = (t: number) => {
    if (runT < 0) return;
    const k = t - runT;
    const beats = [
      { at: 0.4, act: () => hold(now() + 0.05, now() + 4.2, "sprint") },
      { at: 5.6, act: () => hold(now() + 0.05, now() + 3.8, "sprint") },
      { at: 10.4, act: () => hold(now() + 0.05, now() + 3.4, "sprint") },
    ];
    while (runBeat < beats.length && k >= beats[runBeat].at) beats[runBeat++].act();
  };

  let raf = 0;
  const frame = () => {
    const t = now();
    // (a step may schedule more: they are appended and run in this same pass when due)
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (s.done || s.at > t) continue;
      s.done = true;
      s.run();
    }
    if (lWant && !lDown) lPress();
    // (the right thumb's run-time moves wait for the left one to be on the stick)
    if (lDown) runHands(t);
    else if (runT >= 0) runT = t;
    // the right thumb's travel (a drag moves the touch with it)
    const u = rSecs > 0 ? Math.min(1, (t - rStart) / rSecs) : 1;
    const e = u * u * (3 - 2 * u);
    rPos = { x: rFrom.x + (rTo.x - rFrom.x) * e, y: rFrom.y + (rTo.y - rFrom.y) * e };
    env.fingers.current?.place(R, rPos.x, rPos.y);
    if (rDragging && u < 1) env.synth.current?.move("R", rPos.x, rPos.y);
    // the left thumb steers: toward the next point (or the foe), turned into the camera's frame
    const g = env.game();
    const l = layout();
    if (lDown && g && l) {
      let want = { x: 0, y: 0 };
      const hero = g.hero.pos;
      let goal: P | null = null;
      let ease = 0.1;
      const lord = lordCalled ? g.demoLord() : null;
      if (lord && !lordOut) {
        lordOut = true;
        lordFight();
      }
      if (lord) {
        const dx = hero.x - lord.pos.x;
        const dy = hero.y - lord.pos.y;
        const d = Math.hypot(dx, dy) || 1;
        // he swings: in turn, a dash off to one side and a little back, out of the blow's arc, or a parry
        if (lord.attacking && d < 5.5 && t >= dodgeReady) {
          dodgeReady = t + 1.3;
          // of every three swings she dashes out of one, parries one (if her hands are free: mid-move the
          // guard will not go up) and takes one: he is a lord, and he lands his blows
          swings++;
          parryNext = swings % 3 === 2 && !g.hero.busy;
          if (swings % 3 === 0) {
            // (taken)
          } else if (parryNext) {
            // she stands her ground, facing him, and waits for the blow
            parrying = true;
            g.demoHoldOff();
            dodgeUntil = t + 1.0;
          } else {
            dodgeSide = -dodgeSide;
            const ax = dx / d;
            const ay = dy / d;
            dodgeDir = { x: ax * 0.45 - ay * 0.9 * dodgeSide, y: ay * 0.45 + ax * 0.9 * dodgeSide };
            dodgeUntil = t + 0.45;
            tap(t + 0.12, "dash");
          }
        }
        // the guard goes up just before the blow lands (inside the parry's window), and comes down after
        if (parrying && lord.blowIn <= 0.17) {
          parrying = false;
          if (!g.hero.busy) hold(t + 0.02, t + 0.45, "guard");
          dodgeUntil = t + 0.55;
        } else if (parrying && !lord.attacking) parrying = false;
        if (parrying || (parryNext && t < dodgeUntil)) {
          // (standing still, facing him)
        } else if (t < dodgeUntil) {
          goal = { x: hero.x + dodgeDir.x * 4, y: hero.y + dodgeDir.y * 4 };
          ease = 0.4;
        } else if (d > 2.9) goal = lord.pos;
      } else if (lordCalled) {
        // (she stands for his roar)
      } else if (chase) {
        const foe = g.hero.target;
        if (foe && Math.hypot(foe.pos.x - hero.x, foe.pos.y - hero.y) > 2.6) goal = foe.pos;
      } else {
        while (route.length && Math.hypot(route[0].x - hero.x, route[0].y - hero.y) < 1.6) route.shift();
        goal = route[0] ?? null;
        if (!goal && arrived) {
          const then = arrived;
          arrived = null;
          then();
        }
      }
      if (goal) {
        const dx = goal.x - hero.x;
        const dy = goal.y - hero.y;
        const len = Math.hypot(dx, dy) || 1;
        const wx = dx / len;
        const wy = dy / len;
        const h = g.camera.heading();
        const fx = Math.cos(h);
        const fy = Math.sin(h);
        // the stick's axes: up is the camera's heading, right its right
        const sx = fy * wx - fx * wy;
        const sy = fx * wx + fy * wy;
        want = { x: sx * 50, y: -sy * 50 };
      }
      // a thumb eases toward where it wants to be (unhurried: she turns in curves, not snaps; a dodge is quick)
      knob = { x: knob.x + (want.x - knob.x) * ease, y: knob.y + (want.y - knob.y) * ease };
      if (lDown) {
        const px = l.home.x + knob.x;
        const py = l.home.y + knob.y;
        env.synth.current?.move("L", px, py);
        env.fingers.current?.place(L, px, py);
      }
    }
    raf = requestAnimationFrame(frame);
  };
  const stop = () => cancelAnimationFrame(raf);
  raf = requestAnimationFrame(frame);
  return stop;
}
