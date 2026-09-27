/**
 * The showcase demo (?demo=1): about a minute of play for a screen recording
 * (cut down to a reel), driven by two programmed thumbs. The left one works
 * the stick (steering SORA down the towpath, over the bridge and up to the
 * pagoda, turned to the camera's heading as a player's thumb would be), the
 * right one holds sprint, turns the camera and taps the attacks, the Heaven
 * Pierce and, against the tiger lord, the lotus tempest; when he swings, it
 * dashes her out of the way. The touches go through the controls themselves
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
/** the thủy đình, out in the river east of the bridge: the last shot looks across to it */
const THUY_DINH: P = { x: 12, y: -7.5 };
/** the foot of the pagoda's stairs: the reel cuts to her here, running up them to the tiger lord's courtyard (the lens behind her over the open steps) */
const PAGODA_STAIRS: P = { x: 48, y: 62 };
/** on over the top and down the far side */
const ACROSS: P[] = [
  { x: -22.8, y: -1 },
  { x: -22.5, y: 4 },
];

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
  /** at the pagoda: the left thumb walks her up to `pagoda` until the tiger lord is out, then takes her to him */
  let pagoda: P | null = null;
  let lordOut = false;
  // a dash out of the way of his swing: which side, which way (on the ground), until when, and when the next may go
  let dodgeSide = 1;
  let dodgeDir: P = { x: 0, y: 0 };
  let dodgeUntil = 0;
  let dodgeReady = 0;
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
      env.synth.current?.down("R", p.x, p.y);
      env.fingers.current?.press(R);
    });
    at(t2, () => env.synth.current?.up("R"));
  };
  /** the right thumb drags the camera round until it looks toward `target` (turned `lead` radians to its left,
   * so the target sits to the right of SORA): the length of the drag is worked out when it begins */
  const aim = (t: number, secs: number, target: P, lead: number) => {
    const from: P = { x: W * 0.62, y: H * 0.3 };
    at(t - 0.2, () => {
      rShow(true);
      glide(from, 0.18);
    });
    at(t, () => {
      const g = env.game();
      if (!g) return;
      const h = g.hero.pos;
      const want = Math.atan2(target.y - h.y, target.x - h.x) + lead;
      let turn = want - g.camera.heading();
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      // the camera turns 0.0085 rad a point of drag, the other way to the thumb
      const dx = Math.max(-W * 0.55, Math.min(W * 0.35, -turn / 0.0085));
      env.synth.current?.down("R", from.x, from.y);
      glide({ x: from.x + dx, y: from.y + H * 0.04 }, secs, true);
    });
    at(t + secs, () => env.synth.current?.up("R"));
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
    for (const k of [0.8, 1.15, 1.5, 1.85]) tap(t + k, "attack");
    tap(t + 2.3, "dash");
    for (const k of [2.8, 3.15]) tap(t + k, "attack");
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

  // ---------------------------------------------------------------- over the bridge, the camera round to its side
  function outro() {
    runT = -1;
    const t = now();
    env.synth.current?.up("R");
    // she walks on over the top while the right thumb swings the camera slowly round to look down across
    // her and the river at the thủy đình (the lens is raised on the bridge)
    route = [...ACROSS];
    arrived = lLift;
    aim(t + 0.6, 4.4, THUY_DINH, 0.18);
    at(t + 5.4, () => rShow(false));
    at(t + 5.8, toPagoda);
  }

  // ---------------------------------------------------------------- the pagoda: the tiger lord (the reel cuts to here)
  function toPagoda() {
    lLift();
    env.synth.current?.up("R");
    const g = env.game();
    if (!g) return;
    pagoda = g.demoToPagoda(PAGODA_STAIRS.x, PAGODA_STAIRS.y, 1000);
    route = [];
    arrived = null;
    at(now() + 0.35, lPress);
  }

  /** He is out and fighting (his roar done): she goes in with kiếm khí, the blade, and when he is worn down, the lotus tempest. */
  function lordFight() {
    const t = now();
    const g = env.game;
    const near = (m: number) => () => {
      const lord = g()?.demoLord();
      const h = g()?.hero.pos;
      return !!lord && !!h && Math.hypot(lord.pos.x - h.x, lord.pos.y - h.y) < m;
    };
    const far = (m: number) => () => !near(m)();
    tap(t + 0.3, "shoot");
    hold(t + 0.75, t + 2.0, "sprint");
    for (const k of [2.1, 2.45, 2.8, 3.6, 3.95, 4.3]) tap(t + k, "attack", near(4));
    // (worn to half, he roars in a rage: sooner than the blows alone would take him there)
    at(t + 4.6, () => {
      const lord = g()?.demoLord();
      if (lord && lord.hp > lord.maxHp * 0.5) g()?.demoWear(lord.maxHp * 0.49);
    });
    tap(t + 5.2, "shoot", far(4));
    for (const k of [5.9, 6.25, 6.6, 7.3, 7.65, 8.0]) tap(t + k, "attack", near(4));
    at(t + 8.4, () => g()?.charge(2));
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
    ult(t + 9.0, 8);
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
      const lord = pagoda ? g.demoLord() : null;
      if (lord && !lordOut) {
        lordOut = true;
        lordFight();
      }
      if (lord) {
        const dx = hero.x - lord.pos.x;
        const dy = hero.y - lord.pos.y;
        const d = Math.hypot(dx, dy) || 1;
        // he swings: off to one side and a little back, out of the blow's arc, with a dash
        if (lord.attacking && d < 5.5 && t >= dodgeReady) {
          dodgeSide = -dodgeSide;
          const ax = dx / d;
          const ay = dy / d;
          dodgeDir = { x: ax * 0.45 - ay * 0.9 * dodgeSide, y: ay * 0.45 + ax * 0.9 * dodgeSide };
          dodgeUntil = t + 0.45;
          dodgeReady = t + 1.3;
          tap(t + 0.12, "dash");
        }
        if (t < dodgeUntil) {
          goal = { x: hero.x + dodgeDir.x * 4, y: hero.y + dodgeDir.y * 4 };
          ease = 0.4;
        } else if (d > 2.9) goal = lord.pos;
      } else if (pagoda) {
        // up the approach until he steps out (then she stops for his roar)
        if (!lordOut && Math.hypot(pagoda.x - hero.x, pagoda.y - hero.y) > 17.3) goal = pagoda;
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
