import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type GestureResponderEvent, type LayoutChangeEvent, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  type SharedValue,
  useAnimatedProps,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Defs, LinearGradient, Path, RadialGradient, Stop } from "react-native-svg";

import { SKILL_COOLDOWN } from "@/battle/game/combat";

import { CrescentGlyph, type GlyphProps, GustGlyph, LotusGlyph, RiseGlyph, ShieldGlyph, SlashGlyph, SprintGlyph, StreakGlyph } from "./skill-icons";
import { CRIMSON, INK, IVORY, LIME, UI_FONT } from "./theme";

const ACircle = Animated.createAnimatedComponent(Circle);
const AnimatedText = Animated.createAnimatedComponent(TextInput);

/** What the controls drive (the game). */
export interface Pad {
  setStick(x: number, y: number): void;
  setGuard(held: boolean): void;
  attack(): void;
  jump(): void;
  dash(): void;
  skill(): void;
  ult(): void;
  finish(): void;
  /** throw kiếm khí (the valley has it; the stage roads do not) */
  shoot?(): void;
  /** sprint while held (the valley) */
  setSprint?(held: boolean): void;
  /** turn the camera (a drag on the right side, off the buttons), in points */
  look?(dx: number, dy: number): void;
}

export type ButtonId = "attack" | "jump" | "dash" | "guard" | "skill" | "ult" | "finish" | "shoot" | "sprint";

interface Button {
  id: ButtonId;
  /** offset from the attack button's centre (pt) and radius */
  dx: number;
  dy: number;
  r: number;
}


/**
 * The thumb cluster, laid out the way the big mobile action games do: the
 * attack in the corner and two even arcs round it. The near arc holds what the
 * thumb reaches for most (dash, the skill, jump, sprint); the far arc the
 * deliberate ones (guard, kiếm khí, and the ultimate at the top). Offsets
 * (points) from the attack button's centre.
 */
const CLUSTER: Button[] = [
  { id: "attack", dx: 0, dy: 0, r: 42 },
  { id: "dash", dx: -97.9, dy: 3.4, r: 27 },
  { id: "skill", dx: -84.1, dy: -61.1, r: 31 },
  { id: "jump", dx: -27.0, dy: -94.2, r: 27 },
  { id: "sprint", dx: 36.0, dy: -89.0, r: 25 },
  { id: "guard", dx: -176.3, dy: -24.8, r: 25 },
  { id: "shoot", dx: -141.8, dy: -110.8, r: 29 },
  { id: "ult", dx: -69.7, dy: -172.5, r: 35 },
];
const FINISH: Button = { id: "finish", dx: -146.5, dy: -217.2, r: 46 };
/** attack button centre from the bottom-right corner */
const ANCHOR = { right: 70, bottom: 64 };

const STICK_R = 58;
const KNOB_R = 24;
/** the stick may be grabbed anywhere in this share of the screen (left, lower) */
const STICK_ZONE = { x: 0.45, y: 0.3 };
/** how long the controls stay bright after the last touch (ms) */
const WAKE_MS = 2200;

/**
 * Multi-touch controls on one surface: a floating stick anywhere on the lower
 * left, the action buttons on the right. Every finger is tracked by its touch
 * id, in screen coordinates, so moving and striking work at the same time and
 * nothing drifts when the stick moves. Left alone, everything fades back so
 * the valley shows through.
 */
/**
 * Memoised: it re-renders only when its own inputs change (the ultimate
 * becoming ready, the finisher), never for the HUD's every hit and number.
 */
export const Controls = memo(function Controls({
  pad,
  energy,
  skill,
  ultReady,
  finishable,
  size: scale = 1,
  onPress,
  shot,
  stamina,
  winded,
}: {
  pad: Pad;
  energy: SharedValue<number>;
  skill: SharedValue<number>;
  /** kiếm khí cooldown (0..1), when the pad can shoot */
  shot?: SharedValue<number>;
  /** sprint stamina (0..1) and whether it is spent, when the pad can sprint */
  stamina?: SharedValue<number>;
  winded?: SharedValue<number>;
  ultReady: boolean;
  finishable: boolean;
  /** control size setting (0.85 / 1 / 1.15) */
  size?: number;
  /** each button press, for haptics */
  onPress?: (id: ButtonId) => void;
}) {
  const insets = useSafeAreaInsets();
  const frame = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const view = useRef<View>(null);
  const stickTouch = useRef<string | null>(null);
  const lookTouch = useRef<{ id: string; x: number; y: number } | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const held = useRef(new Map<string, ButtonId>());
  const [pressed, setPressed] = useState<Partial<Record<ButtonId, boolean>>>({});
  const [size, setSize] = useState({ width: 0, height: 0 });

  const upright = size.height > size.width;
  // held upright, a side inset belongs to a camera cut-out at the top, not to the thumbs down here
  const sideL = upright ? Math.min(insets.left, 8) : insets.left;
  const sideR = upright ? Math.min(insets.right, 8) : insets.right;
  const home = useMemo(() => ({ x: 40 + STICK_R + sideL, y: size.height - 40 - STICK_R - insets.bottom }), [size.height, insets.bottom, sideL]);
  const baseX = useSharedValue(0);
  const baseY = useSharedValue(0);
  const knobX = useSharedValue(0);
  const knobY = useSharedValue(0);
  const active = useSharedValue(0);
  const awake = useSharedValue(0);

  const buttons = useMemo(() => {
    // narrow screens pull the cluster in, so it never reaches the stick
    const fit = Math.min(1, Math.max(0.74, size.width / 620));
    const k = scale * fit;
    const cx = size.width - ANCHOR.right * fit - sideR;
    const cy = size.height - ANCHOR.bottom * fit - insets.bottom;
    const cluster = CLUSTER.filter((b) => (b.id !== "shoot" || !!pad.shoot) && (b.id !== "sprint" || !!pad.setSprint));
    const list = finishable ? [...cluster, FINISH] : cluster;
    return list.map((b) => ({ ...b, r: b.r * k, x: cx + b.dx * k, y: cy + b.dy * k }));
  }, [size, insets.bottom, sideR, finishable, scale, pad]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ width, height });
    frame.current = { ...frame.current, width, height };
    // where this surface sits on screen: touches are read in screen (page) coordinates
    view.current?.measureInWindow((x, y) => (frame.current = { ...frame.current, x, y }));
    const left = height > width ? Math.min(insets.left, 8) : insets.left;
    baseX.value = 40 + STICK_R + left;
    baseY.value = height - 40 - STICK_R - insets.bottom;
  };

  const local = (t: { pageX: number; pageY: number }) => ({ x: t.pageX - frame.current.x, y: t.pageY - frame.current.y });

  const hitButton = useCallback(
    (x: number, y: number) => {
      let best: ButtonId | null = null;
      let bestD = Infinity;
      for (const b of buttons) {
        const d = Math.hypot(x - b.x, y - b.y);
        // generous: a thumb lands near, not on; the closest wins
        if (d < b.r + 14 && d < bestD) {
          best = b.id;
          bestD = d;
        }
      }
      return best;
    },
    [buttons],
  );

  const syncPressed = () => {
    const now = new Set(held.current.values());
    setPressed(Object.fromEntries([...now].map((id) => [id, true])));
    pad.setGuard(now.has("guard"));
    pad.setSprint?.(now.has("sprint"));
  };

  const wake = (touching: boolean) => {
    cancelAnimation(awake);
    awake.value = touching ? withTiming(1, { duration: 120 }) : withDelay(WAKE_MS, withTiming(0, { duration: 700 }));
  };

  const onStart = (e: GestureResponderEvent) => {
    wake(true);
    for (const t of e.nativeEvent.changedTouches) {
      const id = String(t.identifier);
      const { x, y } = local(t);
      const b = hitButton(x, y);
      if (b) {
        held.current.set(id, b);
        onPress?.(b);
        if (b === "attack") pad.attack();
        else if (b === "jump") pad.jump();
        else if (b === "dash") pad.dash();
        else if (b === "skill") pad.skill();
        else if (b === "ult") pad.ult();
        else if (b === "finish") pad.finish();
        else if (b === "shoot") pad.shoot?.();
        continue;
      }
      const { width, height } = frame.current;
      // the right side, off the buttons: turn the camera
      if (pad.look && lookTouch.current === null && x >= width * STICK_ZONE.x) {
        lookTouch.current = { id, x, y };
        continue;
      }
      if (stickTouch.current === null && x < width * STICK_ZONE.x && y > height * STICK_ZONE.y) {
        stickTouch.current = id;
        origin.current = { x, y };
        baseX.value = x;
        baseY.value = y;
        knobX.value = 0;
        knobY.value = 0;
        active.value = withTiming(1, { duration: 90 });
      }
    }
    syncPressed();
  };

  const onMove = (e: GestureResponderEvent) => {
    for (const t of e.nativeEvent.changedTouches) {
      const lk = lookTouch.current;
      if (lk && String(t.identifier) === lk.id) {
        const { x, y } = local(t);
        pad.look?.(x - lk.x, y - lk.y);
        lk.x = x;
        lk.y = y;
        continue;
      }
      if (String(t.identifier) !== stickTouch.current) continue;
      const { x, y } = local(t);
      let dx = x - origin.current.x;
      let dy = y - origin.current.y;
      const len = Math.hypot(dx, dy);
      if (len > STICK_R) {
        // the base follows a thumb that runs past the rim, so turning back is instant
        const over = len - STICK_R;
        origin.current.x += (dx / len) * over;
        origin.current.y += (dy / len) * over;
        baseX.value = origin.current.x;
        baseY.value = origin.current.y;
        dx = (dx / len) * STICK_R;
        dy = (dy / len) * STICK_R;
      }
      knobX.value = dx;
      knobY.value = dy;
      const mag = Math.min(Math.hypot(dx, dy) / STICK_R, 1);
      // a small dead zone, then full range
      const k = mag < 0.12 ? 0 : (mag - 0.12) / 0.88 / Math.max(mag, 1e-3);
      pad.setStick((dx / STICK_R) * k, (-dy / STICK_R) * k);
    }
  };

  const onEnd = (e: GestureResponderEvent) => {
    for (const t of e.nativeEvent.changedTouches) {
      const id = String(t.identifier);
      if (lookTouch.current?.id === id) lookTouch.current = null;
      if (id === stickTouch.current) {
        stickTouch.current = null;
        pad.setStick(0, 0);
        knobX.value = withSpring(0, { damping: 16, stiffness: 280 });
        knobY.value = withSpring(0, { damping: 16, stiffness: 280 });
        active.value = withTiming(0, { duration: 260 });
        // drift back home
        baseX.value = withTiming(home.x, { duration: 280 });
        baseY.value = withTiming(home.y, { duration: 280 });
      }
      held.current.delete(id);
    }
    if (e.nativeEvent.touches.length === 0) wake(false);
    syncPressed();
  };

  // resting, the buttons sit back; touched, they come forward
  const cluster = useAnimatedStyle(() => ({ opacity: 0.62 + 0.38 * awake.value }));

  return (
    <View
      ref={view}
      style={StyleSheet.absoluteFill}
      onLayout={onLayout}
      onTouchStart={onStart}
      onTouchMove={onMove}
      onTouchEnd={onEnd}
      onTouchCancel={onEnd}
    >
      <Stick baseX={baseX} baseY={baseY} knobX={knobX} knobY={knobY} active={active} />
      <Animated.View style={[StyleSheet.absoluteFill, { pointerEvents: "none" }, cluster]}>
        {buttons.map((b) => (
          <ActionButton
            key={b.id}
            b={b}
            down={!!pressed[b.id]}
            energy={b.id === "sprint" && stamina ? stamina : energy}
            skill={b.id === "shoot" && shot ? shot : skill}
            winded={winded}
            ultReady={ultReady}
          />
        ))}
      </Animated.View>
    </View>
  );
});

// ---------------------------------------------------------------- the stick
/**
 * A floating stick: a thin ring and a soft knob. Untouched it is a faint
 * ghost where the thumb rests; under the thumb it comes up bright, and the
 * rim lights on the side being pushed.
 */
function Stick({
  baseX,
  baseY,
  knobX,
  knobY,
  active,
}: Record<"baseX" | "baseY" | "knobX" | "knobY" | "active", SharedValue<number>>) {
  const S = STICK_R * 2 + 16;
  const c = S / 2;
  const base = useAnimatedStyle(() => ({
    left: baseX.value - S / 2,
    top: baseY.value - S / 2,
    opacity: 0.28 + 0.72 * active.value,
    transform: [{ scale: 0.92 + 0.08 * active.value }],
  }));
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: knobX.value }, { translateY: knobY.value }] }));
  const wedge = useAnimatedStyle(() => {
    const mag = Math.min(Math.hypot(knobX.value, knobY.value) / STICK_R, 1);
    return { opacity: mag * active.value, transform: [{ rotate: `${Math.atan2(knobY.value, knobX.value)}rad` }] };
  });

  return (
    <Animated.View style={[{ position: "absolute", width: S, height: S, pointerEvents: "none" }, base]}>
      <Svg width={S} height={S}>
        <Circle cx={c} cy={c} r={STICK_R} fill="rgba(10,12,14,0.22)" stroke={IVORY} strokeOpacity={0.55} strokeWidth={1.5} />
        <Circle cx={c} cy={c} r={STICK_R * 0.5} fill="none" stroke={IVORY} strokeOpacity={0.12} strokeWidth={1} />
      </Svg>
      <Animated.View style={[StyleSheet.absoluteFill, wedge]}>
        <Svg width={S} height={S}>
          <Path d={arc(c, c, STICK_R, -0.5, 0.5)} stroke={LIME} strokeWidth={3} strokeLinecap="round" fill="none" />
        </Svg>
      </Animated.View>
      <Animated.View style={[styles.knob, { left: c - KNOB_R, top: c - KNOB_R }, knob]}>
        <Svg width={KNOB_R * 2} height={KNOB_R * 2}>
          <Circle cx={KNOB_R} cy={KNOB_R} r={KNOB_R - 1} fill={IVORY} fillOpacity={0.88} />
          <Circle cx={KNOB_R} cy={KNOB_R} r={KNOB_R - 7} fill="none" stroke={INK} strokeOpacity={0.12} strokeWidth={1.2} />
        </Svg>
      </Animated.View>
    </Animated.View>
  );
}

function arc(cx: number, cy: number, r: number, a0: number, a1: number) {
  const p = (a: number) => `${cx + Math.cos(a) * r} ${cy + Math.sin(a) * r}`;
  return `M ${p(a0)} A ${r} ${r} 0 0 1 ${p(a1)}`;
}

// ---------------------------------------------------------------- the buttons
/**
 * Each action's element: its colour runs through the rim, the inner glow,
 * the glyph and its charge or cooldown. The blade is the brand's lime; the
 * skills each have their own light.
 */
const ELEMENT: Record<ButtonId, { color: string; glyph: (p: GlyphProps) => ReactNode; scale: number }> = {
  attack: { color: LIME, glyph: (p) => <SlashGlyph {...p} />, scale: 1.05 },
  sprint: { color: "#FFB45A", glyph: (p) => <SprintGlyph {...p} />, scale: 0.95 },
  jump: { color: IVORY, glyph: (p) => <RiseGlyph {...p} />, scale: 0.95 },
  dash: { color: IVORY, glyph: (p) => <GustGlyph {...p} />, scale: 0.95 },
  skill: { color: "#3CE8B0", glyph: (p) => <StreakGlyph {...p} />, scale: 1 },
  shoot: { color: "#58D6FF", glyph: (p) => <CrescentGlyph {...p} />, scale: 1 },
  ult: { color: "#FFC94A", glyph: (p) => <LotusGlyph {...p} />, scale: 1.1 },
  guard: { color: "#7FB8FF", glyph: (p) => <ShieldGlyph {...p} />, scale: 0.95 },
  finish: { color: LIME, glyph: (p) => <LotusGlyph {...p} />, scale: 1 },
};
const DEEP = "#0A0F16";

/**
 * One action button: a dark glass disc lit from inside by its element (a
 * soft inner glow and a bright rim), a gradient glyph with a halo, and
 * whatever it carries: the skill's cooldown sweep and seconds, the ultimate's
 * gold charge ring (then a burst of light when ready), the sprint's stamina.
 * Pressed, it sinks and flares; ready specials wear slowly turning arcs.
 */
const ActionButton = memo(function ActionButton({
  b,
  down,
  energy,
  skill,
  ultReady,
  winded,
}: {
  b: Button & { x: number; y: number };
  down: boolean;
  /** the ultimate's charge, or the sprint button's stamina */
  energy: SharedValue<number>;
  skill: SharedValue<number>;
  ultReady: boolean;
  winded?: SharedValue<number>;
}) {
  const r = b.r;
  const PAD = 14;
  const S = r * 2 + PAD * 2;
  const c = S / 2;
  const id = b.id;
  const el = ELEMENT[id];
  const color = el.color;
  const isSkill = id === "skill" || id === "shoot";
  const counts = id === "skill";
  const isUlt = id === "ult";
  const isSprint = id === "sprint";
  const finish = id === "finish";
  const solid = finish || (isUlt && ultReady);
  const gid = `b${id}`;

  const press = useSharedValue(0);
  const pulse = useSharedValue(0);
  const spin = useSharedValue(0);
  const ping = useSharedValue(0);

  useEffect(() => {
    press.value = withSpring(down ? 1 : 0, { damping: 14, stiffness: 520 });
  }, [down, press]);
  useEffect(() => {
    if (solid) {
      pulse.value = withRepeat(withSequence(withTiming(1, { duration: 700, easing: Easing.inOut(Easing.sin) }), withTiming(0, { duration: 700, easing: Easing.inOut(Easing.sin) })), -1);
    } else {
      cancelAnimation(pulse);
      pulse.value = withTiming(0, { duration: 200 });
    }
  }, [solid, pulse]);
  useEffect(() => {
    // the specials' arcs turn slowly, always
    if (isSkill || isUlt || finish) spin.value = withRepeat(withTiming(1, { duration: 9000, easing: Easing.linear }), -1);
  }, [isSkill, isUlt, finish, spin]);
  // the moment a skill comes back, it rings once
  useAnimatedReaction(
    () => (isSkill ? skill.value > 0 : false),
    (cooling, was) => {
      if (was && !cooling) ping.value = withSequence(withTiming(0, { duration: 0 }), withTiming(1, { duration: 520, easing: Easing.out(Easing.quad) }));
    },
  );

  const body = useAnimatedStyle(() => ({ transform: [{ scale: 1 - 0.08 * press.value }] }));
  const flare = useAnimatedStyle(() => ({ opacity: press.value * 0.4 }));
  const glow = useAnimatedStyle(() => ({ opacity: (solid ? 0.45 : 0) + 0.45 * pulse.value, transform: [{ scale: 1 + 0.12 * pulse.value }] }));
  const arcs = useAnimatedStyle(() => ({
    opacity: isSkill && skill.value > 0 ? 0.15 : 0.9,
    transform: [{ rotate: `${spin.value * 360}deg` }],
  }));
  const pingStyle = useAnimatedStyle(() => ({ opacity: (1 - ping.value) * (ping.value > 0 ? 1 : 0), transform: [{ scale: 1 + 0.4 * ping.value }] }));

  // skill cooldown: a shadow pie over the face, and the seconds left
  const pieR = r / 2;
  const pieC = 2 * Math.PI * pieR;
  const pie = useAnimatedProps(() => ({ strokeDashoffset: pieC * (1 - skill.value) }));
  const iconStyle = useAnimatedStyle(() => ({ opacity: isSkill && skill.value > 0 ? 0.35 : 1 }));
  const seconds = useAnimatedProps(() => {
    const t = skill.value * SKILL_COOLDOWN;
    return { text: t > 0 ? (t < 1 ? t.toFixed(1) : String(Math.ceil(t))) : "" } as never;
  });
  const secondsStyle = useAnimatedStyle(() => ({ opacity: isSkill && skill.value > 0 ? 1 : 0 }));

  // the ultimate's charge and the sprint's stamina, as rings round the rim
  const ring = r + 4.5;
  const ringC = 2 * Math.PI * ring;
  const charge = useAnimatedProps(() => ({ strokeDashoffset: ringC * (1 - energy.value) }));
  const breath = useAnimatedProps(() => ({ strokeDashoffset: ringC * (1 - energy.value), strokeOpacity: winded && winded.value > 0 ? 0 : 1 }));
  const gasp = useAnimatedProps(() => ({ strokeDashoffset: ringC * (1 - energy.value), strokeOpacity: winded && winded.value > 0 ? 1 : 0 }));

  const glyphSize = r * 1.28 * el.scale;

  return (
    <View style={{ position: "absolute", left: b.x - c, top: b.y - c, width: S, height: S }}>
      {/* the burst of light round a ready ultimate / the finisher */}
      <Animated.View style={[StyleSheet.absoluteFill, glow]}>
        <Svg width={S} height={S}>
          <Defs>
            <RadialGradient id={`${gid}burst`} cx="50%" cy="50%" r="50%">
              <Stop offset={String((r - 4) / c)} stopColor={color} stopOpacity={0.9} />
              <Stop offset="1" stopColor={color} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={c} cy={c} r={c} fill={`url(#${gid}burst)`} />
        </Svg>
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, body]}>
        <Svg width={S} height={S}>
          <Defs>
            <RadialGradient id={`${gid}face`} cx="50%" cy="38%" r="65%">
              <Stop offset="0" stopColor={solid ? "#FFFFFF" : "#1C2733"} stopOpacity={solid ? 1 : 0.82} />
              <Stop offset="0.7" stopColor={solid ? color : DEEP} stopOpacity={solid ? 1 : 0.8} />
              <Stop offset="1" stopColor={solid ? color : DEEP} stopOpacity={solid ? 1 : 0.9} />
            </RadialGradient>
            <RadialGradient id={`${gid}inner`} cx="50%" cy="50%" r="50%">
              <Stop offset="0.62" stopColor={color} stopOpacity={0} />
              <Stop offset="0.9" stopColor={color} stopOpacity={solid ? 0 : 0.34} />
              <Stop offset="1" stopColor={color} stopOpacity={solid ? 0 : 0.55} />
            </RadialGradient>
            <RadialGradient id={`${gid}halo`} cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={color} stopOpacity={solid ? 0 : 0.4} />
              <Stop offset="1" stopColor={color} stopOpacity={0} />
            </RadialGradient>
            <LinearGradient id={`${gid}gloss`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity={solid ? 0.55 : 0.2} />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
            </LinearGradient>
          </Defs>
          {/* shadow, face, the inner glow of the element, a bright rim */}
          <Circle cx={c} cy={c + 2.5} r={r + 1} fill="#000" opacity={0.28} />
          <Circle cx={c} cy={c} r={r} fill={`url(#${gid}face)`} />
          <Circle cx={c} cy={c} r={r} fill={`url(#${gid}inner)`} />
          <Circle cx={c} cy={c} r={r * 0.62} fill={`url(#${gid}halo)`} />
          <Circle cx={c} cy={c} r={r - 0.8} fill="none" stroke={color} strokeOpacity={solid ? 1 : 0.85} strokeWidth={1.6} />
          <Circle cx={c} cy={c} r={r - 4} fill="none" stroke="#FFFFFF" strokeOpacity={0.08} strokeWidth={1} />
          {isSkill && (
            <ACircle
              cx={c}
              cy={c}
              r={pieR}
              fill="none"
              stroke="#000"
              strokeOpacity={0.6}
              strokeWidth={r}
              strokeDasharray={`${pieC} ${pieC}`}
              animatedProps={pie}
              transform={`rotate(-90 ${c} ${c})`}
            />
          )}
          {(isUlt || isSprint) && (
            <Circle cx={c} cy={c} r={ring} fill="none" stroke={color} strokeOpacity={isUlt && ultReady ? 0 : 0.16} strokeWidth={3} />
          )}
          {isUlt && !ultReady && (
            <ACircle
              cx={c}
              cy={c}
              r={ring}
              fill="none"
              stroke={color}
              strokeWidth={3.4}
              strokeLinecap="round"
              strokeDasharray={`${ringC} ${ringC}`}
              animatedProps={charge}
              transform={`rotate(-90 ${c} ${c})`}
            />
          )}
          {isSprint && (
            <>
              <ACircle
                cx={c}
                cy={c}
                r={ring}
                fill="none"
                stroke={color}
                strokeWidth={3}
                strokeLinecap="round"
                strokeDasharray={`${ringC} ${ringC}`}
                animatedProps={breath}
                transform={`rotate(-90 ${c} ${c})`}
              />
              <ACircle
                cx={c}
                cy={c}
                r={ring}
                fill="none"
                stroke={CRIMSON}
                strokeWidth={3}
                strokeLinecap="round"
                strokeDasharray={`${ringC} ${ringC}`}
                animatedProps={gasp}
                transform={`rotate(-90 ${c} ${c})`}
              />
            </>
          )}
          {/* glass */}
          <Path
            d={`M ${c - r * 0.78} ${c - r * 0.08} A ${r} ${r} 0 0 1 ${c + r * 0.78} ${c - r * 0.08} Q ${c} ${c - r * 0.38} ${c - r * 0.78} ${c - r * 0.08} Z`}
            fill={`url(#${gid}gloss)`}
          />
        </Svg>
        {/* the specials' tech arcs, turning */}
        {(isSkill || isUlt || finish) && (
          <Animated.View style={[StyleSheet.absoluteFill, arcs]}>
            <Svg width={S} height={S}>
              {[0, 1, 2].map((k) => (
                <Path key={k} d={arc(c, c, r + 8, (k * 2 * Math.PI) / 3, (k * 2 * Math.PI) / 3 + 0.9)} stroke={color} strokeOpacity={0.75} strokeWidth={1.6} strokeLinecap="round" fill="none" />
              ))}
            </Svg>
          </Animated.View>
        )}
        {/* pressed: the element flares from within */}
        <Animated.View style={[styles.flare, { left: PAD, top: PAD, width: r * 2, height: r * 2, borderRadius: r, backgroundColor: color }, flare]} />
        <Animated.View style={[StyleSheet.absoluteFill, styles.center, iconStyle]}>{el.glyph({ size: glyphSize, color, ink: solid ? DEEP : undefined })}</Animated.View>
        {counts && (
          <Animated.View style={[StyleSheet.absoluteFill, styles.center, secondsStyle]}>
            <AnimatedText editable={false} underlineColorAndroid="transparent" style={[styles.seconds, { fontSize: r * 0.62 }]} animatedProps={seconds} defaultValue="" />
          </Animated.View>
        )}
        {finish && <Text style={styles.finishText}>FINISH</Text>}
      </Animated.View>
      {isSkill && (
        <Animated.View style={[StyleSheet.absoluteFill, pingStyle]}>
          <Svg width={S} height={S}>
            <Circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth={2.4} />
          </Svg>
        </Animated.View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  knob: { position: "absolute", width: KNOB_R * 2, height: KNOB_R * 2 },
  center: { alignItems: "center", justifyContent: "center" },
  flare: { position: "absolute", opacity: 0 },
  seconds: { color: IVORY, fontFamily: UI_FONT, textAlign: "center", padding: 0, textShadowColor: "rgba(0,0,0,0.8)", textShadowRadius: 5, textShadowOffset: { width: 0, height: 1 } },
  finishText: { position: "absolute", alignSelf: "center", bottom: 10, color: DEEP, fontFamily: UI_FONT, fontSize: 10, letterSpacing: 2 },
});
