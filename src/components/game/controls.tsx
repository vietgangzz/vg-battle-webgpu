import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type GestureResponderEvent, type LayoutChangeEvent, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  type SharedValue,
  useAnimatedProps,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Defs, Ellipse, G, Line, LinearGradient, Path, RadialGradient, Stop } from "react-native-svg";

import { SKILL_COOLDOWN } from "@/battle/game/combat";

import { BladeIcon, BloomIcon, DashIcon, GuardIcon, JumpIcon, StreakIcon } from "./icons";
import { INK, IVORY, LIME, ORANGE, UI_FONT } from "./theme";

const ACircle = Animated.createAnimatedComponent(Circle);
const AnimatedText = Animated.createAnimatedComponent(TextInput);
/** the guard's colour: the jade of the river */
const JADE = "#7FE0C8";

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
  /** turn the camera (a drag on the right side, off the buttons), in points */
  look?(dx: number, dy: number): void;
}

export type ButtonId = "attack" | "jump" | "dash" | "guard" | "skill" | "ult" | "finish";

interface Button {
  id: ButtonId;
  /** offset from the attack button's centre (pt) and radius */
  dx: number;
  dy: number;
  r: number;
}

/**
 * The thumb cluster: the big SLASH at the corner, the quick moves on an arc
 * around it (dash, jump, the skill), the ultimate and the guard further out
 * where a deliberate reach finds them.
 */
const CLUSTER: Button[] = [
  { id: "attack", dx: 0, dy: 0, r: 46 },
  { id: "dash", dx: -98, dy: 12, r: 29 },
  { id: "jump", dx: -78, dy: -62, r: 29 },
  { id: "skill", dx: -14, dy: -100, r: 33 },
  { id: "ult", dx: -104, dy: -146, r: 37 },
  { id: "guard", dx: -176, dy: 22, r: 27 },
];
const FINISH: Button = { id: "finish", dx: -160, dy: -262, r: 56 };
/** attack button centre from the bottom-right corner */
const ANCHOR = { right: 88, bottom: 96 };

const STICK_R = 62;
const KNOB_R = 27;
/** the stick may be grabbed anywhere in this share of the screen (left, lower) */
const STICK_ZONE = { x: 0.5, y: 0.3 };

/**
 * Multi-touch controls on one surface: a floating stick anywhere on the lower
 * left, the skill cluster on the right. Every finger is tracked by its touch
 * id, in screen coordinates, so moving and striking work at the same time and
 * nothing drifts when the stick moves.
 */
export function Controls({
  pad,
  energy,
  skill,
  ultReady,
  finishable,
  size: scale = 1,
  onPress,
}: {
  pad: Pad;
  energy: SharedValue<number>;
  skill: SharedValue<number>;
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
  const homeLeft = upright ? Math.min(insets.left, 8) : insets.left;
  const home = useMemo(() => ({ x: 36 + STICK_R + homeLeft, y: size.height - 52 - STICK_R - insets.bottom }), [size.height, insets.bottom, homeLeft]);
  const baseX = useSharedValue(0);
  const baseY = useSharedValue(0);
  const knobX = useSharedValue(0);
  const knobY = useSharedValue(0);
  const active = useSharedValue(0);

  const { buttons, anchor } = useMemo(() => {
    // narrow screens (a phone held upright) pull the cluster in, so it never reaches the stick
    const fit = Math.min(1, Math.max(0.74, size.width / 620));
    const k = scale * fit;
    // held upright, a side inset belongs to a camera cut-out at the top, not to the thumbs down here
    const side = size.height > size.width ? Math.min(insets.right, 8) : insets.right;
    const cx = size.width - ANCHOR.right * fit - side;
    const cy = size.height - ANCHOR.bottom * fit - insets.bottom;
    const list = finishable ? [...CLUSTER, FINISH] : CLUSTER;
    return { buttons: list.map((b) => ({ ...b, r: b.r * k, x: cx + b.dx * k, y: cy + b.dy * k })), anchor: { x: cx, y: cy, k } };
  }, [size, insets, finishable, scale]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ width, height });
    frame.current = { ...frame.current, width, height };
    // where this surface sits on screen: touches are read in screen (page) coordinates
    view.current?.measureInWindow((x, y) => (frame.current = { ...frame.current, x, y }));
    const left = height > width ? Math.min(insets.left, 8) : insets.left;
    baseX.value = 36 + STICK_R + left;
    baseY.value = height - 52 - STICK_R - insets.bottom;
  };

  const local = (t: { pageX: number; pageY: number }) => ({ x: t.pageX - frame.current.x, y: t.pageY - frame.current.y });

  const hitButton = useCallback(
    (x: number, y: number) => {
      let best: ButtonId | null = null;
      let bestD = Infinity;
      for (const b of buttons) {
        const d = Math.hypot(x - b.x, y - b.y);
        // generous: a thumb lands near, not on; the closest wins
        if (d < b.r + 16 && d < bestD) {
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
  };

  const onStart = (e: GestureResponderEvent) => {
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
        knobX.value = withSpring(0, { damping: 14, stiffness: 260 });
        knobY.value = withSpring(0, { damping: 14, stiffness: 260 });
        active.value = withTiming(0, { duration: 220 });
        // drift back home
        baseX.value = withTiming(home.x, { duration: 260 });
        baseY.value = withTiming(home.y, { duration: 260 });
      }
      held.current.delete(id);
    }
    syncPressed();
  };

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
      {size.width > 0 && <Rail x={anchor.x} y={anchor.y} k={anchor.k} />}
      <Stick baseX={baseX} baseY={baseY} knobX={knobX} knobY={knobY} active={active} />
      {buttons.map((b) => (
        <SkillButton key={b.id} b={b} down={!!pressed[b.id]} energy={energy} skill={skill} ultReady={ultReady} />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- the rail
/**
 * A faint engraved arc behind the cluster, the buttons strung along it like
 * beads: it ties them into one instrument instead of loose circles.
 */
function Rail({ x, y, k }: { x: number; y: number; k: number }) {
  const R = 132 * k;
  const S = R * 2 + 40;
  const c = S / 2;
  // screen angles (y down): from just left of straight up, round anticlockwise to a little below the left
  const a0 = -Math.PI * 0.53;
  const sweep = Math.PI * 0.62;
  const ticks = 22;
  return (
    <View style={{ position: "absolute", left: x - c, top: y - c, width: S, height: S, pointerEvents: "none" }}>
      <Svg width={S} height={S}>
        <Defs>
          <LinearGradient id="rail" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={IVORY} stopOpacity={0} />
            <Stop offset="0.45" stopColor={IVORY} stopOpacity={0.22} />
            <Stop offset="1" stopColor={IVORY} stopOpacity={0.04} />
          </LinearGradient>
        </Defs>
        <Path d={arcCCW(c, c, R, a0, sweep)} stroke="url(#rail)" strokeWidth={1.4} fill="none" />
        <Path d={arcCCW(c, c, R + 6, a0 - 0.12, sweep - 0.3)} stroke={IVORY} strokeOpacity={0.07} strokeWidth={1} fill="none" strokeDasharray="2 6" />
        {Array.from({ length: ticks + 1 }, (_, i) => {
          const a = a0 - (sweep * i) / ticks;
          const major = i % 5 === 0;
          const r0 = R - (major ? 5 : 3);
          return (
            <Line
              key={i}
              x1={c + Math.cos(a) * r0}
              y1={c + Math.sin(a) * r0}
              x2={c + Math.cos(a) * R}
              y2={c + Math.sin(a) * R}
              stroke={major ? LIME : IVORY}
              strokeOpacity={major ? 0.45 : 0.18}
              strokeWidth={major ? 1.6 : 1}
            />
          );
        })}
      </Svg>
    </View>
  );
}

/** an arc from a0 turning anticlockwise on screen through `sweep` radians */
function arcCCW(cx: number, cy: number, r: number, a0: number, sweep: number) {
  const p = (a: number) => `${cx + Math.cos(a) * r} ${cy + Math.sin(a) * r}`;
  return `M ${p(a0)} A ${r} ${r} 0 ${sweep > Math.PI ? 1 : 0} 0 ${p(a0 - sweep)}`;
}

// ---------------------------------------------------------------- the stick
function Stick({
  baseX,
  baseY,
  knobX,
  knobY,
  active,
}: Record<"baseX" | "baseY" | "knobX" | "knobY" | "active", SharedValue<number>>) {
  const S = STICK_R * 2 + 36;
  const c = S / 2;
  const base = useAnimatedStyle(() => ({
    left: baseX.value - S / 2,
    top: baseY.value - S / 2,
    opacity: 0.62 + 0.38 * active.value,
    transform: [{ scale: 0.95 + 0.05 * active.value }],
  }));
  const knob = useAnimatedStyle(() => ({
    transform: [{ translateX: knobX.value }, { translateY: knobY.value }, { scale: 1 + 0.06 * active.value }],
  }));
  // the rim lights up on the side being pushed
  const wedge = useAnimatedStyle(() => {
    const mag = Math.min(Math.hypot(knobX.value, knobY.value) / STICK_R, 1);
    const angle = Math.atan2(knobY.value, knobX.value);
    return { opacity: mag * active.value, transform: [{ rotate: `${angle}rad` }] };
  });
  // pushed to the rim: SORA runs flat out, and the ring says so
  const sprint = useAnimatedStyle(() => {
    const mag = Math.min(Math.hypot(knobX.value, knobY.value) / STICK_R, 1);
    const on = Math.min(1, Math.max(0, (mag - 0.86) / 0.12)) * active.value;
    return { opacity: on, transform: [{ scale: 0.96 + 0.06 * on }] };
  });
  // the knob's shadow falls away from the push
  const knobShadow = useAnimatedStyle(() => ({
    transform: [{ translateX: knobX.value * 0.82 }, { translateY: knobY.value * 0.82 + 4 }],
    opacity: 0.35 + 0.2 * active.value,
  }));

  return (
    <Animated.View style={[{ position: "absolute", width: S, height: S, pointerEvents: "none" }, base]}>
      <Svg width={S} height={S}>
        <Defs>
          <RadialGradient id="stickBase" cx="50%" cy="46%" r="52%">
            <Stop offset="0" stopColor="#0B0E10" stopOpacity={0.08} />
            <Stop offset="0.62" stopColor="#0B0E10" stopOpacity={0.38} />
            <Stop offset="0.93" stopColor="#0B0E10" stopOpacity={0.62} />
            <Stop offset="1" stopColor="#0B0E10" stopOpacity={0.2} />
          </RadialGradient>
          <LinearGradient id="stickBezel" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={IVORY} stopOpacity={0.7} />
            <Stop offset="0.5" stopColor={IVORY} stopOpacity={0.22} />
            <Stop offset="1" stopColor={IVORY} stopOpacity={0.45} />
          </LinearGradient>
        </Defs>
        {/* soft drop shadow */}
        <Circle cx={c} cy={c + 3} r={STICK_R + 2} fill="#000" opacity={0.12} />
        <Circle cx={c} cy={c + 2} r={STICK_R + 1} fill="#000" opacity={0.1} />
        {/* the well */}
        <Circle cx={c} cy={c} r={STICK_R} fill="url(#stickBase)" />
        <Circle cx={c} cy={c} r={STICK_R} fill="none" stroke="url(#stickBezel)" strokeWidth={2} />
        <Circle cx={c} cy={c} r={STICK_R - 4} fill="none" stroke="#000" strokeOpacity={0.35} strokeWidth={2.5} />
        {/* engraved grid: two rings and the crosshair */}
        <Circle cx={c} cy={c} r={STICK_R * 0.64} fill="none" stroke={IVORY} strokeOpacity={0.1} strokeWidth={1} strokeDasharray="3 5" />
        <Circle cx={c} cy={c} r={STICK_R * 0.3} fill="none" stroke={IVORY} strokeOpacity={0.08} strokeWidth={1} />
        {[0, 1, 2, 3].map((q) => {
          const a = (q * Math.PI) / 2;
          return (
            <Line
              key={q}
              x1={c + Math.cos(a) * STICK_R * 0.34}
              y1={c + Math.sin(a) * STICK_R * 0.34}
              x2={c + Math.cos(a) * STICK_R * 0.6}
              y2={c + Math.sin(a) * STICK_R * 0.6}
              stroke={IVORY}
              strokeOpacity={0.1}
              strokeWidth={1}
            />
          );
        })}
        {/* the four direction chevrons */}
        {[0, 1, 2, 3].map((q) => {
          const r = STICK_R - 14;
          return (
            <G key={q} transform={`rotate(${q * 90 - 90} ${c} ${c})`}>
              <Path
                d={`M ${c + r - 4} ${c - 6} L ${c + r + 3} ${c} L ${c + r - 4} ${c + 6}`}
                stroke={IVORY}
                strokeOpacity={0.5}
                strokeWidth={2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </G>
          );
        })}
        {/* the outer scale */}
        {Array.from({ length: 32 }, (_, i) => {
          const a = (i / 32) * Math.PI * 2;
          const major = i % 8 === 0;
          const mid = i % 4 === 0;
          const r0 = STICK_R + 5;
          const r1 = STICK_R + (major ? 13 : mid ? 9 : 7);
          return (
            <Line
              key={i}
              x1={c + Math.cos(a) * r0}
              y1={c + Math.sin(a) * r0}
              x2={c + Math.cos(a) * r1}
              y2={c + Math.sin(a) * r1}
              stroke={major ? LIME : IVORY}
              strokeOpacity={major ? 0.75 : mid ? 0.4 : 0.18}
              strokeWidth={major ? 2.2 : 1.2}
              strokeLinecap="round"
            />
          );
        })}
      </Svg>
      {/* full-tilt ring */}
      <Animated.View style={[StyleSheet.absoluteFill, sprint]}>
        <Svg width={S} height={S}>
          <Circle cx={c} cy={c} r={STICK_R + 2} fill="none" stroke={LIME} strokeOpacity={0.35} strokeWidth={6} />
          <Circle cx={c} cy={c} r={STICK_R + 1} fill="none" stroke={LIME} strokeWidth={1.6} />
        </Svg>
      </Animated.View>
      {/* the lit side of the rim */}
      <Animated.View style={[StyleSheet.absoluteFill, wedge]}>
        <Svg width={S} height={S}>
          <Path d={arc(c, c, STICK_R - 1, -0.62, 0.62)} stroke={LIME} strokeOpacity={0.3} strokeWidth={9} strokeLinecap="round" fill="none" />
          <Path d={arc(c, c, STICK_R - 1, -0.5, 0.5)} stroke={LIME} strokeWidth={3.5} strokeLinecap="round" fill="none" />
          <Path d={`M ${c + STICK_R + 8} ${c - 6} L ${c + STICK_R + 15} ${c} L ${c + STICK_R + 8} ${c + 6}`} stroke={LIME} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </Svg>
      </Animated.View>
      {/* the knob */}
      <Animated.View style={[styles.knob, { left: c - KNOB_R, top: c - KNOB_R }, knobShadow]}>
        <Svg width={KNOB_R * 2} height={KNOB_R * 2}>
          <Circle cx={KNOB_R} cy={KNOB_R} r={KNOB_R - 1} fill="#000" opacity={0.55} />
        </Svg>
      </Animated.View>
      <Animated.View style={[styles.knob, { left: c - KNOB_R, top: c - KNOB_R }, knob]}>
        <Svg width={KNOB_R * 2} height={KNOB_R * 2}>
          <Defs>
            <RadialGradient id="knobFace" cx="40%" cy="34%" r="72%">
              <Stop offset="0" stopColor="#F7FFD2" />
              <Stop offset="0.38" stopColor={LIME} />
              <Stop offset="0.85" stopColor="#8DB41E" />
              <Stop offset="1" stopColor="#5E7A0E" />
            </RadialGradient>
            <LinearGradient id="knobShine" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.75} />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Circle cx={KNOB_R} cy={KNOB_R} r={KNOB_R - 1} fill="#3E520A" />
          <Circle cx={KNOB_R} cy={KNOB_R} r={KNOB_R - 2.6} fill="url(#knobFace)" />
          {/* grip: concentric grooves and a dimple */}
          <Circle cx={KNOB_R} cy={KNOB_R} r={KNOB_R - 7} fill="none" stroke={INK} strokeOpacity={0.2} strokeWidth={1.4} />
          <Circle cx={KNOB_R} cy={KNOB_R} r={KNOB_R - 7.8} fill="none" stroke="#FFFFFF" strokeOpacity={0.25} strokeWidth={0.8} />
          <Circle cx={KNOB_R} cy={KNOB_R} r={KNOB_R - 13} fill="none" stroke={INK} strokeOpacity={0.14} strokeWidth={1.2} />
          <Circle cx={KNOB_R} cy={KNOB_R} r={3} fill={INK} opacity={0.22} />
          <Ellipse cx={KNOB_R - 4} cy={KNOB_R - 9} rx={KNOB_R * 0.52} ry={KNOB_R * 0.28} fill="url(#knobShine)" />
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
/** Each button's colour and name. */
const LOOK: Record<ButtonId, { accent: string; label?: string; icon: (color: string, r: number) => ReactNode }> = {
  attack: { accent: LIME, icon: (c, r) => <BladeIcon size={r * 1.12} color={c} /> },
  jump: { accent: IVORY, label: "NHẢY", icon: (c, r) => <JumpIcon size={r * 0.95} color={c} /> },
  dash: { accent: IVORY, label: "LƯỚT", icon: (c, r) => <DashIcon size={r * 0.95} color={c} /> },
  guard: { accent: JADE, label: "ĐỠ", icon: (c, r) => <GuardIcon size={r * 0.95} color={c} /> },
  skill: { accent: LIME, label: "XUYÊN", icon: (c, r) => <StreakIcon size={r * 0.92} color={c} /> },
  ult: { accent: ORANGE, label: "TUYỆT KỸ", icon: (c, r) => <BloomIcon size={r * 1.4} color={c} /> },
  finish: { accent: LIME, label: "KẾT LIỄU", icon: (c, r) => <BloomIcon size={r * 1.3} color={c} /> },
};
/** room around a button for its halo, ripple and charge ring */
const PAD = 26;
const SEGMENTS = 20;

function SkillButton({
  b,
  down,
  energy,
  skill,
  ultReady,
}: {
  b: Button & { x: number; y: number };
  down: boolean;
  energy: SharedValue<number>;
  skill: SharedValue<number>;
  ultReady: boolean;
}) {
  const r = b.r;
  const S = r * 2 + PAD * 2;
  const c = S / 2;
  const id = b.id;
  const look = LOOK[id];
  const finish = id === "finish";
  const isSkill = id === "skill";
  const isUlt = id === "ult";
  const big = id === "attack" || finish;
  const ready = isUlt && ultReady;
  const accent = isUlt ? (ultReady ? LIME : ORANGE) : look.accent;
  const glowing = ready || finish;

  const press = useSharedValue(0);
  const ripple = useSharedValue(0);
  const pulse = useSharedValue(0);
  const spin = useSharedValue(0);
  const ping = useSharedValue(0);

  useEffect(() => {
    press.value = withSpring(down ? 1 : 0, { damping: 13, stiffness: 460 });
    if (down) ripple.value = withSequence(withTiming(0, { duration: 0 }), withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) }));
  }, [down, press, ripple]);
  useEffect(() => {
    if (glowing) {
      pulse.value = withRepeat(withSequence(withTiming(1, { duration: 700, easing: Easing.inOut(Easing.sin) }), withTiming(0, { duration: 700, easing: Easing.inOut(Easing.sin) })), -1);
      spin.value = 0;
      spin.value = withRepeat(withTiming(1, { duration: 6000, easing: Easing.linear }), -1);
    } else {
      cancelAnimation(pulse);
      cancelAnimation(spin);
      pulse.value = withTiming(0, { duration: 200 });
    }
  }, [glowing, pulse, spin]);
  // the moment the skill comes off cooldown, the button rings once
  useAnimatedReaction(
    () => (isSkill ? skill.value > 0 : false),
    (cooling, was) => {
      if (was && !cooling) ping.value = withSequence(withTiming(0, { duration: 0 }), withTiming(1, { duration: 560, easing: Easing.out(Easing.quad) }));
    },
  );

  const body = useAnimatedStyle(() => ({ transform: [{ scale: 1 - 0.09 * press.value }] }));
  const flash = useAnimatedStyle(() => ({ opacity: press.value * 0.9 }));
  const rippleStyle = useAnimatedStyle(() => ({ opacity: (1 - ripple.value) * 0.7 * (ripple.value > 0 ? 1 : 0), transform: [{ scale: 0.9 + 0.55 * ripple.value }] }));
  const pingStyle = useAnimatedStyle(() => ({ opacity: (1 - ping.value) * (ping.value > 0 ? 1 : 0), transform: [{ scale: 0.95 + 0.5 * ping.value }] }));
  const halo = useAnimatedStyle(() => ({ opacity: 0.35 + pulse.value * 0.55, transform: [{ scale: 1 + 0.08 * pulse.value }, { rotate: `${spin.value * 360}deg` }] }));
  const counter = useAnimatedStyle(() => ({ transform: [{ rotate: `${-spin.value * 540}deg` }] }));

  // skill: a pie of shadow sweeping off the face, and the seconds left
  const faceR = r - 5;
  const pieR = faceR / 2;
  const pieC = 2 * Math.PI * pieR;
  const pie = useAnimatedProps(() => ({ strokeDashoffset: pieC * (1 - skill.value) }));
  const iconDim = useAnimatedStyle(() => ({ opacity: isSkill && skill.value > 0 ? 0.35 : 1, transform: [{ scale: isSkill && skill.value > 0 ? 0.86 : 1 }] }));
  const seconds = useAnimatedProps(() => {
    const t = skill.value * SKILL_COOLDOWN;
    return { text: t > 0 ? (t < 1 ? t.toFixed(1) : String(Math.ceil(t))) : "" } as never;
  });
  const secondsStyle = useAnimatedStyle(() => ({ opacity: isSkill && skill.value > 0 ? 1 : 0 }));

  // ultimate: a segmented ring of charge, and the percentage under it
  const ring = r + 5;
  const ringC = 2 * Math.PI * ring;
  const charge = useAnimatedProps(() => ({ strokeDashoffset: ringC * (1 - energy.value) }));
  const percent = useAnimatedProps(() => ({ text: `${Math.floor(energy.value * 100)}%` }) as never);

  const face = finish ? ["#F7FFD2", LIME, "#7C9E16"] : ["#39424A", "#1B2126", "#0C0F11"];

  return (
    <View style={{ position: "absolute", left: b.x - c, top: b.y - c, width: S, height: S, pointerEvents: "none" }}>
      {/* the halo of a ready ultimate / the finisher: rays turning slowly */}
      {glowing && (
        <Animated.View style={[StyleSheet.absoluteFill, halo]}>
          <Svg width={S} height={S}>
            <Defs>
              <RadialGradient id={`halo-${id}`} cx="50%" cy="50%" r="50%">
                <Stop offset={String(r / (c + 0.01))} stopColor={LIME} stopOpacity={0.55} />
                <Stop offset="1" stopColor={LIME} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Circle cx={c} cy={c} r={c} fill={`url(#halo-${id})`} />
            {Array.from({ length: 12 }, (_, i) => {
              const a = (i / 12) * Math.PI * 2;
              const w = 0.09;
              const r0 = r + 3;
              const r1 = c - 2;
              return (
                <Path
                  key={i}
                  d={`M ${c + Math.cos(a - w) * r0} ${c + Math.sin(a - w) * r0} L ${c + Math.cos(a) * r1} ${c + Math.sin(a) * r1} L ${c + Math.cos(a + w) * r0} ${c + Math.sin(a + w) * r0} Z`}
                  fill={LIME}
                  opacity={i % 2 ? 0.28 : 0.5}
                />
              );
            })}
          </Svg>
        </Animated.View>
      )}
      {glowing && (
        <Animated.View style={[StyleSheet.absoluteFill, counter]}>
          <Svg width={S} height={S}>
            <Circle cx={c} cy={c} r={r + 10} fill="none" stroke={LIME} strokeOpacity={0.8} strokeWidth={1.4} strokeDasharray="10 7 2 7" />
          </Svg>
        </Animated.View>
      )}

      <Animated.View style={[StyleSheet.absoluteFill, body]}>
        <Svg width={S} height={S}>
          <Defs>
            <LinearGradient id={`bezel-${id}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={finish ? "#FFFFFF" : "#8C969D"} />
              <Stop offset="0.45" stopColor={finish ? LIME : "#3A4248"} />
              <Stop offset="1" stopColor={finish ? "#55700C" : "#0A0C0E"} />
            </LinearGradient>
            <RadialGradient id={`face-${id}`} cx="50%" cy="30%" r="75%">
              <Stop offset="0" stopColor={face[0]} stopOpacity={finish ? 1 : 0.9} />
              <Stop offset="0.6" stopColor={face[1]} stopOpacity={finish ? 1 : 0.86} />
              <Stop offset="1" stopColor={face[2]} stopOpacity={finish ? 1 : 0.9} />
            </RadialGradient>
            <LinearGradient id={`gloss-${id}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity={finish ? 0.7 : 0.26} />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
            </LinearGradient>
            <RadialGradient id={`iconGlow-${id}`} cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={accent} stopOpacity={finish ? 0 : 0.32} />
              <Stop offset="1" stopColor={accent} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          {/* drop shadow, stacked for softness */}
          <Circle cx={c} cy={c + 4} r={r + 1} fill="#000" opacity={0.14} />
          <Circle cx={c} cy={c + 2.5} r={r + 0.5} fill="#000" opacity={0.16} />
          {/* bezel, the dark lip inside it, then the face */}
          <Circle cx={c} cy={c} r={r} fill={`url(#bezel-${id})`} />
          <Circle cx={c} cy={c} r={r - 2.4} fill="#07090A" opacity={finish ? 0.25 : 0.85} />
          <Circle cx={c} cy={c} r={faceR} fill={`url(#face-${id})`} />
          <Circle cx={c} cy={c} r={faceR} fill={`url(#iconGlow-${id})`} />
          {/* the accent inlay */}
          <Circle cx={c} cy={c} r={faceR - 1.2} fill="none" stroke={accent} strokeOpacity={finish ? 0.5 : 0.55} strokeWidth={1.2} />
          {big && (
            <>
              <Circle cx={c} cy={c} r={faceR - 7} fill="none" stroke={finish ? INK : IVORY} strokeOpacity={0.14} strokeWidth={1} />
              {Array.from({ length: 36 }, (_, i) => {
                const a = (i / 36) * Math.PI * 2;
                const major = i % 9 === 0;
                const r0 = faceR - (major ? 7 : 4.5);
                return (
                  <Line
                    key={i}
                    x1={c + Math.cos(a) * r0}
                    y1={c + Math.sin(a) * r0}
                    x2={c + Math.cos(a) * (faceR - 2.2)}
                    y2={c + Math.sin(a) * (faceR - 2.2)}
                    stroke={finish ? INK : major ? LIME : IVORY}
                    strokeOpacity={major ? 0.8 : 0.2}
                    strokeWidth={major ? 2 : 1}
                  />
                );
              })}
            </>
          )}
          {!big && (
            // four studs on the bezel
            [0, 1, 2, 3].map((q) => {
              const a = Math.PI / 4 + (q * Math.PI) / 2;
              return <Circle key={q} cx={c + Math.cos(a) * (r - 1.2)} cy={c + Math.sin(a) * (r - 1.2)} r={1.3} fill={IVORY} opacity={0.5} />;
            })
          )}
          {/* ultimate: the charge track, the charge, and the cuts between segments */}
          {isUlt && (
            <>
              <Circle cx={c} cy={c} r={ring} fill="none" stroke="#000" strokeOpacity={0.3} strokeWidth={4.4} />
              <Circle cx={c} cy={c} r={ring} fill="none" stroke={accent} strokeOpacity={0.16} strokeWidth={3} />
              <ACircle
                cx={c}
                cy={c}
                r={ring}
                fill="none"
                stroke={accent}
                strokeWidth={3.4}
                strokeDasharray={`${ringC} ${ringC}`}
                animatedProps={charge}
                transform={`rotate(-90 ${c} ${c})`}
              />
              {Array.from({ length: SEGMENTS }, (_, i) => {
                const a = (i / SEGMENTS) * Math.PI * 2 - Math.PI / 2;
                return (
                  <Line
                    key={i}
                    x1={c + Math.cos(a) * (ring - 2.6)}
                    y1={c + Math.sin(a) * (ring - 2.6)}
                    x2={c + Math.cos(a) * (ring + 2.6)}
                    y2={c + Math.sin(a) * (ring + 2.6)}
                    stroke="#1B2126"
                    strokeWidth={1.4}
                  />
                );
              })}
            </>
          )}
          {/* skill: cooldown shadow sweeping the face */}
          {isSkill && (
            <ACircle
              cx={c}
              cy={c}
              r={pieR}
              fill="none"
              stroke="#000"
              strokeOpacity={0.62}
              strokeWidth={faceR}
              strokeDasharray={`${pieC} ${pieC}`}
              animatedProps={pie}
              transform={`rotate(-90 ${c} ${c})`}
            />
          )}
          {/* glass */}
          <Path
            d={`M ${c - faceR * 0.82} ${c - faceR * 0.12} A ${faceR} ${faceR} 0 0 1 ${c + faceR * 0.82} ${c - faceR * 0.12} Q ${c} ${c - faceR * 0.34} ${c - faceR * 0.82} ${c - faceR * 0.12} Z`}
            fill={`url(#gloss-${id})`}
          />
        </Svg>
        {/* pressed: the face lights from within */}
        <Animated.View
          style={[
            styles.flash,
            { left: c - faceR, top: c - faceR, width: faceR * 2, height: faceR * 2, borderRadius: faceR, backgroundColor: finish ? "rgba(255,255,255,0.45)" : `${accent}55` },
            flash,
          ]}
        />
        <Animated.View style={[StyleSheet.absoluteFill, styles.center, iconDim]}>
          {look.icon(finish ? INK : id === "attack" ? IVORY : ready ? LIME : isUlt ? IVORY : down ? accent : IVORY, big ? r * 0.95 : r)}
        </Animated.View>
        {isSkill && (
          <Animated.View style={[StyleSheet.absoluteFill, styles.center, secondsStyle]}>
            <AnimatedText editable={false} underlineColorAndroid="transparent" style={[styles.seconds, { fontSize: r * 0.62 }]} animatedProps={seconds} defaultValue="" />
          </Animated.View>
        )}
      </Animated.View>

      {/* ripple on press; a ring when the skill comes back */}
      <Animated.View style={[StyleSheet.absoluteFill, rippleStyle]}>
        <Svg width={S} height={S}>
          <Circle cx={c} cy={c} r={r} fill="none" stroke={accent} strokeWidth={2.4} />
        </Svg>
      </Animated.View>
      {isSkill && (
        <Animated.View style={[StyleSheet.absoluteFill, pingStyle]}>
          <Svg width={S} height={S}>
            <Circle cx={c} cy={c} r={r + 2} fill="none" stroke={LIME} strokeWidth={3} />
            <Circle cx={c} cy={c} r={r - 2} fill={LIME} opacity={0.18} />
          </Svg>
        </Animated.View>
      )}

      {/* the name plate, over the bottom rim */}
      {!!look.label && (isSkill || isUlt || finish) && (
        <View style={[styles.plate, { top: c + r - (finish ? 12 : 9) }, finish && styles.plateFinish, ready && styles.plateReady]}>
          {isUlt && !ultReady ? (
            <AnimatedText editable={false} underlineColorAndroid="transparent" style={[styles.plateText, { color: ORANGE }]} animatedProps={percent} defaultValue="0%" />
          ) : (
            <Text style={[styles.plateText, finish && styles.plateTextFinish, ready && { color: INK }]}>{look.label}</Text>
          )}
        </View>
      )}
      {!!look.label && !isSkill && !isUlt && !finish && <Text style={[styles.tag, { top: c + r - 1 }, down && { color: accent, opacity: 1 }]}>{look.label}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  knob: { position: "absolute", width: KNOB_R * 2, height: KNOB_R * 2 },
  center: { alignItems: "center", justifyContent: "center" },
  flash: { position: "absolute" },
  seconds: { color: IVORY, fontFamily: UI_FONT, textAlign: "center", padding: 0, textShadowColor: "rgba(0,0,0,0.8)", textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } },
  plate: {
    position: "absolute",
    alignSelf: "center",
    minWidth: 46,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: "rgba(10,12,14,0.9)",
    borderWidth: 1,
    borderColor: "rgba(245,243,232,0.35)",
    transform: [{ skewX: "-12deg" }],
  },
  plateFinish: { backgroundColor: INK, borderColor: LIME, paddingHorizontal: 12, paddingVertical: 3 },
  plateReady: { backgroundColor: LIME, borderColor: "#F7FFD2" },
  plateText: { color: IVORY, fontFamily: UI_FONT, fontSize: 9, letterSpacing: 1.6, textAlign: "center", padding: 0 },
  plateTextFinish: { color: LIME, fontSize: 12, letterSpacing: 3 },
  tag: {
    position: "absolute",
    alignSelf: "center",
    color: IVORY,
    opacity: 0.7,
    fontFamily: UI_FONT,
    fontSize: 8,
    letterSpacing: 1.4,
    textShadowColor: "rgba(0,0,0,0.85)",
    textShadowRadius: 4,
    textShadowOffset: { width: 0, height: 1 },
  },
});
