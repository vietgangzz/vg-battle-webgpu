/**
 * The showcase demo (?demo=1): about forty seconds of play for a screen
 * recording, driven by two programmed thumbs. The left one works the stick
 * (steering SORA down the towpath and over the bridge, turned to the camera's
 * heading as a player's thumb would be), the right one holds sprint, drags the
 * camera round and taps the attacks, the Heaven Pierce and the lotus tempest.
 * The touches go through the controls themselves (see Synth) and are drawn as
 * fingertips (see Fingers), so the picture is what a hand playing it shows.
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
  /** the right thumb taps a button: over to it, press, lift */
  const tap = (t: number, id: ButtonId) => {
    at(t - 0.14, () => {
      rShow(true);
      glide(button(id), 0.12);
    });
    at(t, () => {
      const p = button(id);
      env.synth.current?.down("R", p.x, p.y);
      env.fingers.current?.press(R);
    });
    at(t + 0.1, () => env.synth.current?.up("R"));
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
  /** the right thumb drags across the free right side of the screen: the camera turns */
  const drag = (t: number, secs: number, from: P, to: P) => {
    at(t - 0.2, () => {
      rShow(true);
      glide(from, 0.18);
    });
    at(t, () => {
      env.synth.current?.down("R", from.x, from.y);
      glide(to, secs, true);
    });
    at(t + secs, () => env.synth.current?.up("R"));
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
  // the title: the camera swings round her
  drag(2.2, 1.6, { x: W * 0.7, y: H * 0.42 }, { x: W * 0.6, y: H * 0.44 });
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
    for (const k of [7.4, 7.75, 8.1]) tap(t + k, "attack");
    at(t + 8.4, () => env.game()?.charge(2));
    drag(t + 8.7, 0.8, { x: W * 0.64, y: H * 0.36 }, { x: W * 0.56, y: H * 0.38 });
    tap(t + 9.8, "ult");
    drag(t + 11.6, 1.6, { x: W * 0.58, y: H * 0.34 }, { x: W * 0.68, y: H * 0.33 });
    at(t + 14.2, () => {
      chase = false;
      lLift();
      env.game()?.demoCalm();
    });
    at(t + 14.6, () => {
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
    aim(t + 0.3, 3.8, THUY_DINH, 0.18);
    at(t + 6.2, () => {
      rShow(false);
    });
    at(t + 6.8, () => {
      stop();
      env.done?.();
    });
  }

  /** while running: sprint for four seconds, rest the stamina with a look round, sprint again */
  const runHands = (t: number) => {
    if (runT < 0) return;
    const k = t - runT;
    const beats = [
      { at: 0.4, act: () => hold(now() + 0.05, now() + 4.2, "sprint") },
      { at: 4.8, act: () => drag(now() + 0.05, 1.4, { x: W * 0.62, y: H * 0.36 }, { x: W * 0.74, y: H * 0.34 }) },
      { at: 6.6, act: () => hold(now() + 0.05, now() + 3.6, "sprint") },
      { at: 10.6, act: () => drag(now() + 0.05, 1.2, { x: W * 0.7, y: H * 0.36 }, { x: W * 0.62, y: H * 0.37 }) },
      { at: 12.2, act: () => hold(now() + 0.05, now() + 3, "sprint") },
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
      if (chase) {
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
      // a thumb eases toward where it wants to be
      knob = { x: knob.x + (want.x - knob.x) * 0.22, y: knob.y + (want.y - knob.y) * 0.22 };
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
