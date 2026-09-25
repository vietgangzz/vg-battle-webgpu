import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type GestureResponderEvent, type LayoutChangeEvent, StyleSheet, Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  type SharedValue,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Defs, G, Line, Path, RadialGradient, Stop } from "react-native-svg";

import { BladeIcon, BloomIcon, DashIcon, GuardIcon, JumpIcon, StreakIcon } from "./icons";
import { INK, IVORY, LIME, ORANGE, UI_FONT } from "./theme";

const ACircle = Animated.createAnimatedComponent(Circle);

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
}

export type ButtonId = "attack" | "jump" | "dash" | "guard" | "skill" | "ult" | "finish";

interface Button {
  id: ButtonId;
  /** offset from the attack button's centre (pt) and radius */
  dx: number;
  dy: number;
  r: number;
}

/** The thumb cluster around the big SLASH button, bottom right. */
const CLUSTER: Button[] = [
  { id: "attack", dx: 0, dy: 0, r: 46 },
  { id: "dash", dx: -100, dy: 18, r: 30 },
  { id: "jump", dx: -80, dy: -66, r: 30 },
  { id: "skill", dx: -10, dy: -104, r: 31 },
  { id: "guard", dx: -178, dy: 30, r: 26 },
  { id: "ult", dx: -122, dy: -150, r: 36 },
];
const FINISH: Button = { id: "finish", dx: -150, dy: -255, r: 58 };
/** attack button centre from the bottom-right corner */
const ANCHOR = { right: 96, bottom: 100 };

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
  const origin = useRef({ x: 0, y: 0 });
  const held = useRef(new Map<string, ButtonId>());
  const [pressed, setPressed] = useState<Partial<Record<ButtonId, boolean>>>({});
  const [size, setSize] = useState({ width: 0, height: 0 });

  const home = useMemo(() => ({ x: 44 + STICK_R + insets.left, y: size.height - 44 - STICK_R - insets.bottom }), [size.height, insets]);
  const baseX = useSharedValue(0);
  const baseY = useSharedValue(0);
  const knobX = useSharedValue(0);
  const knobY = useSharedValue(0);
  const active = useSharedValue(0);

  const buttons = useMemo(() => {
    const cx = size.width - ANCHOR.right - insets.right;
    const cy = size.height - ANCHOR.bottom - insets.bottom;
    const list = finishable ? [...CLUSTER, FINISH] : CLUSTER;
    return list.map((b) => ({ ...b, r: b.r * scale, x: cx + b.dx * scale, y: cy + b.dy * scale }));
  }, [size, insets, finishable, scale]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ width, height });
    frame.current = { ...frame.current, width, height };
    // where this surface sits on screen: touches are read in screen (page) coordinates
    view.current?.measureInWindow((x, y) => (frame.current = { ...frame.current, x, y }));
    baseX.value = 44 + STICK_R + insets.left;
    baseY.value = height - 44 - STICK_R - insets.bottom;
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
      <Stick baseX={baseX} baseY={baseY} knobX={knobX} knobY={knobY} active={active} />
      {buttons.map((b) => (
        <SkillButton key={b.id} b={b} down={!!pressed[b.id]} energy={energy} skill={skill} ultReady={ultReady} />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- the stick
function Stick({
  baseX,
  baseY,
  knobX,
  knobY,
  active,
}: Record<"baseX" | "baseY" | "knobX" | "knobY" | "active", SharedValue<number>>) {
  const S = STICK_R * 2 + 24;
  const c = S / 2;
  const base = useAnimatedStyle(() => ({
    left: baseX.value - S / 2,
    top: baseY.value - S / 2,
    opacity: 0.5 + 0.5 * active.value,
    transform: [{ scale: 0.94 + 0.06 * active.value }],
  }));
  const knob = useAnimatedStyle(() => ({
    transform: [{ translateX: knobX.value }, { translateY: knobY.value }, { scale: 1 + 0.08 * active.value }],
  }));
  // the rim lights up on the side being pushed
  const wedge = useAnimatedStyle(() => {
    const mag = Math.min(Math.hypot(knobX.value, knobY.value) / STICK_R, 1);
    const angle = Math.atan2(knobY.value, knobX.value);
    return { opacity: mag * active.value, transform: [{ rotate: `${angle}rad` }] };
  });
  return (
    <Animated.View style={[{ position: "absolute", width: S, height: S, pointerEvents: "none" }, base]}>
      <Svg width={S} height={S}>
        <Defs>
          <RadialGradient id="stickBase" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={INK} stopOpacity={0.15} />
            <Stop offset="0.8" stopColor={INK} stopOpacity={0.5} />
            <Stop offset="1" stopColor={INK} stopOpacity={0.6} />
          </RadialGradient>
        </Defs>
        <Circle cx={c} cy={c} r={STICK_R} fill="url(#stickBase)" stroke={IVORY} strokeOpacity={0.4} strokeWidth={1.5} />
        <Circle cx={c} cy={c} r={STICK_R - 9} fill="none" stroke={IVORY} strokeOpacity={0.12} strokeWidth={1} />
        <G>
          {Array.from({ length: 16 }, (_, i) => {
            const a = (i / 16) * Math.PI * 2;
            const r0 = STICK_R + 4;
            const r1 = STICK_R + (i % 4 === 0 ? 11 : 7);
            return (
              <Line
                key={i}
                x1={c + Math.cos(a) * r0}
                y1={c + Math.sin(a) * r0}
                x2={c + Math.cos(a) * r1}
                y2={c + Math.sin(a) * r1}
                stroke={IVORY}
                strokeOpacity={i % 4 === 0 ? 0.55 : 0.25}
                strokeWidth={i % 4 === 0 ? 2 : 1.2}
                strokeLinecap="round"
              />
            );
          })}
        </G>
      </Svg>
      <Animated.View style={[StyleSheet.absoluteFill, wedge]}>
        <Svg width={S} height={S}>
          <Path d={arc(c, c, STICK_R - 1, -0.55, 0.55)} stroke={LIME} strokeWidth={4} strokeLinecap="round" fill="none" />
        </Svg>
      </Animated.View>
      <Animated.View style={[styles.knob, { left: c - KNOB_R, top: c - KNOB_R }, knob]}>
        <Svg width={KNOB_R * 2} height={KNOB_R * 2}>
          <Defs>
            <RadialGradient id="knob" cx="38%" cy="32%" r="75%">
              <Stop offset="0" stopColor="#F4FFC2" />
              <Stop offset="0.45" stopColor={LIME} />
              <Stop offset="1" stopColor="#7FA41A" />
            </RadialGradient>
          </Defs>
          <Circle cx={KNOB_R} cy={KNOB_R} r={KNOB_R - 1} fill="url(#knob)" />
          <Circle cx={KNOB_R} cy={KNOB_R} r={KNOB_R - 8} fill="none" stroke={INK} strokeOpacity={0.18} strokeWidth={1.5} />
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
const ICONS: Record<ButtonId, (ready: boolean) => ReactNode> = {
  attack: () => <BladeIcon size={40} />,
  jump: () => <JumpIcon />,
  dash: () => <DashIcon />,
  guard: () => <GuardIcon />,
  skill: () => <StreakIcon />,
  ult: (ready) => <BloomIcon size={34} color={ready ? LIME : IVORY} />,
  finish: () => <BloomIcon size={50} color={INK} />,
};

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
  const S = b.r * 2 + 16;
  const c = S / 2;
  const ring = b.r + 3;
  const circ = 2 * Math.PI * ring;
  const press = useSharedValue(0);
  const pulse = useSharedValue(0);
  const glowing = (b.id === "ult" && ultReady) || b.id === "finish";

  useEffect(() => {
    press.value = withSpring(down ? 1 : 0, { damping: 12, stiffness: 420 });
  }, [down, press]);
  useEffect(() => {
    if (glowing) pulse.value = withRepeat(withSequence(withTiming(1, { duration: 620 }), withTiming(0, { duration: 620 })), -1);
    else {
      cancelAnimation(pulse);
      pulse.value = withTiming(0, { duration: 200 });
    }
  }, [glowing, pulse]);

  const halo = useAnimatedStyle(() => ({ opacity: pulse.value * 0.8, transform: [{ scale: 1 + 0.14 * pulse.value }] }));
  const body = useAnimatedStyle(() => ({ transform: [{ scale: 1 - 0.1 * press.value }] }));
  const fill = useAnimatedStyle(() => ({ opacity: press.value }));
  // cooldown sweep (skill) and charge ring (ultimate)
  const cooldown = useAnimatedProps(() => ({ strokeDashoffset: circ * (1 - skill.value) }));
  const charge = useAnimatedProps(() => ({ strokeDashoffset: circ * (1 - energy.value) }));
  const isSkill = b.id === "skill";
  const dim = useAnimatedStyle(() => ({ opacity: isSkill && skill.value > 0 ? 0.45 : 1 }));

  const finish = b.id === "finish";
  const accent = finish ? LIME : b.id === "ult" ? (ultReady ? LIME : ORANGE) : IVORY;
  const label = finish ? "FINISH" : b.id === "ult" ? (ultReady ? "READY" : "ULT") : isSkill ? "STREAK" : "";

  return (
    <Animated.View style={[{ position: "absolute", left: b.x - c, top: b.y - c, width: S, height: S, pointerEvents: "none" }, body]}>
      <Animated.View style={[StyleSheet.absoluteFill, halo]}>
        <Svg width={S} height={S}>
          <Circle cx={c} cy={c} r={b.r + 7} fill={LIME} opacity={0.4} />
        </Svg>
      </Animated.View>
      <Svg width={S} height={S} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id={`btn-${b.id}`} cx="50%" cy="38%" r="62%">
            <Stop offset="0" stopColor={finish ? "#F4FFC2" : "#2C333A"} stopOpacity={finish ? 1 : 0.78} />
            <Stop offset="1" stopColor={finish ? LIME : INK} stopOpacity={finish ? 1 : 0.72} />
          </RadialGradient>
        </Defs>
        <Circle cx={c} cy={c} r={b.r} fill={`url(#btn-${b.id})`} stroke={accent} strokeOpacity={finish ? 1 : 0.55} strokeWidth={1.6} />
        {b.id === "attack" && <Circle cx={c} cy={c} r={b.r - 7} fill="none" stroke={IVORY} strokeOpacity={0.16} strokeWidth={1} />}
        {isSkill && (
          <ACircle
            cx={c}
            cy={c}
            r={ring}
            fill="none"
            stroke={INK}
            strokeOpacity={0.85}
            strokeWidth={5}
            strokeDasharray={`${circ} ${circ}`}
            animatedProps={cooldown}
            transform={`rotate(-90 ${c} ${c})`}
          />
        )}
        {b.id === "ult" && (
          <>
            <Circle cx={c} cy={c} r={ring} fill="none" stroke={IVORY} strokeOpacity={0.14} strokeWidth={4} />
            <ACircle
              cx={c}
              cy={c}
              r={ring}
              fill="none"
              stroke={ultReady ? LIME : ORANGE}
              strokeWidth={4}
              strokeLinecap="round"
              strokeDasharray={`${circ} ${circ}`}
              animatedProps={charge}
              transform={`rotate(-90 ${c} ${c})`}
            />
          </>
        )}
      </Svg>
      <Animated.View style={[styles.pressFill, { left: 8, top: 8, width: b.r * 2, height: b.r * 2, borderRadius: b.r }, fill]} />
      <Animated.View style={[StyleSheet.absoluteFill, styles.center, dim]}>
        {ICONS[b.id](ultReady)}
        {!!label && <Text style={[styles.label, finish && styles.finishLabel, b.id === "ult" && ultReady && styles.readyLabel]}>{label}</Text>}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  knob: { position: "absolute", width: KNOB_R * 2, height: KNOB_R * 2 },
  center: { alignItems: "center", justifyContent: "center" },
  pressFill: { position: "absolute", backgroundColor: "rgba(213,246,75,0.35)" },
  label: { position: "absolute", bottom: 6, color: IVORY, fontFamily: UI_FONT, fontSize: 8, letterSpacing: 1.6, opacity: 0.85 },
  finishLabel: { position: "relative", bottom: 0, marginTop: 2, color: INK, fontSize: 12, letterSpacing: 3, opacity: 1 },
  readyLabel: { color: LIME, opacity: 1 },
});
