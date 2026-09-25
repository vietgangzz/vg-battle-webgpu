import { useEffect, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from "react-native-svg";

import type { HudState } from "@/battle/game/adventure";

import { ChevronIcon, LittleGiant, PauseIcon } from "./icons";
import { CRIMSON, INK, IVORY, LIME, ORANGE, UI_FONT } from "./theme";

/**
 * Everything drawn over the fight: SORA's medallion with health and energy,
 * KAGE's bar when he is in the arena, the wave count, the combo counter, the
 * big words, the way-ahead arrow and the pause button.
 */
export function Hud({
  state,
  energy,
  combo,
  onPause,
}: {
  state: HudState;
  energy: SharedValue<number>;
  combo: SharedValue<number>;
  onPause: () => void;
}) {
  const insets = useSafeAreaInsets();
  const top = Math.max(insets.top, 16) + 10;
  const playing = state.phase !== "finisher" && state.phase !== "results";
  return (
    <View style={[StyleSheet.absoluteFill, { pointerEvents: "box-none" }]}>
      {playing && (
        <>
          <PlayerPanel hp={state.hp} max={state.maxHp} energy={energy} ready={state.ultReady} top={top} left={Math.max(insets.left, 14) + 6} />
          {state.boss && <BossBar hp={state.boss.hp} max={state.boss.max} top={top + 78} />}
          {!!state.wave && <WavePill text={state.wave} top={top + 4} />}
          <Combo count={state.combo} timer={combo} />
          {state.go && <GoArrow />}
          <Pressable onPress={onPause} hitSlop={14} style={[styles.pause, { top, right: Math.max(insets.right, 14) + 6 }]}>
            <PauseIcon />
          </Pressable>
        </>
      )}
      <Banner text={state.banner} sub={state.sub} />
    </View>
  );
}

// ---------------------------------------------------------------- SORA
function PlayerPanel({ hp, max, energy, ready, top, left }: { hp: number; max: number; energy: SharedValue<number>; ready: boolean; top: number; left: number }) {
  const frac = Math.max(0, hp / max);
  const hurt = useSharedValue(0);
  const last = useRef(hp);
  useEffect(() => {
    if (hp < last.current) hurt.value = withSequence(withTiming(1, { duration: 60 }), withTiming(0, { duration: 420 }));
    last.current = hp;
  }, [hp, hurt]);
  const shake = useAnimatedStyle(() => ({ transform: [{ translateX: Math.sin(hurt.value * 40) * 4 * hurt.value }] }));
  const flash = useAnimatedStyle(() => ({ opacity: hurt.value * 0.8 }));
  const energyStyle = useAnimatedStyle(() => ({ width: `${Math.round(energy.value * 100)}%` }));
  const glow = useSharedValue(0);
  useEffect(() => {
    glow.value = ready ? withRepeat(withSequence(withTiming(1, { duration: 520 }), withTiming(0.2, { duration: 520 })), -1) : withTiming(0);
  }, [ready, glow]);
  const readyStyle = useAnimatedStyle(() => ({ opacity: glow.value }));

  return (
    <Animated.View style={[styles.panel, { top, left, pointerEvents: "none" }, shake]}>
      <View style={styles.medallion}>
        <Svg width={62} height={62} style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id="medal" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#262C31" />
              <Stop offset="1" stopColor={INK} />
            </LinearGradient>
          </Defs>
          <Circle cx={31} cy={31} r={29} fill="url(#medal)" stroke={LIME} strokeWidth={2} />
          <Circle cx={31} cy={31} r={25} fill="none" stroke={IVORY} strokeOpacity={0.15} strokeWidth={1} />
        </Svg>
        <LittleGiant size={40} />
        <Animated.View style={[styles.medalFlash, flash]} />
      </View>
      <View style={styles.bars}>
        <View style={styles.nameRow}>
          <Text style={styles.name}>SORA</Text>
          <Text style={styles.hpText}>
            {Math.max(0, hp)}
            <Text style={styles.hpMax}> / {max}</Text>
          </Text>
        </View>
        <SlantBar frac={frac} color={frac > 0.3 ? LIME : ORANGE} width={188} height={12} />
        <View style={styles.energyTrack}>
          <Animated.View style={[styles.energyFill, energyStyle, { backgroundColor: ready ? LIME : ORANGE }]} />
          {Array.from({ length: 4 }, (_, i) => (
            <View key={i} style={[styles.energyTick, { left: `${(i + 1) * 20}%` }]} />
          ))}
        </View>
        <Animated.Text style={[styles.ready, readyStyle]}>ULTIMATE READY</Animated.Text>
      </View>
    </Animated.View>
  );
}

/** A health bar cut on the slant, with the lost chunk lingering in ivory before it drains. */
function SlantBar({ frac, color, width, height, flip }: { frac: number; color: string; width: number; height: number; flip?: boolean }) {
  const f = useSharedValue(frac);
  const lag = useSharedValue(frac);
  useEffect(() => {
    f.value = withTiming(frac, { duration: 110 });
    lag.value = withDelay(420, withTiming(frac, { duration: 480, easing: Easing.out(Easing.quad) }));
  }, [frac, f, lag]);
  const fill = useAnimatedStyle(() => ({ width: `${f.value * 100}%` }));
  const ghost = useAnimatedStyle(() => ({ width: `${lag.value * 100}%` }));
  return (
    <View style={[styles.slant, { width, height, transform: [{ skewX: flip ? "20deg" : "-20deg" }, ...(flip ? [{ scaleX: -1 }] : [])] }]}>
      <Animated.View style={[styles.slantGhost, ghost]} />
      <Animated.View style={[styles.slantFill, { backgroundColor: color }, fill]}>
        <View style={styles.slantShine} />
      </Animated.View>
      {Array.from({ length: 9 }, (_, i) => (
        <View key={i} style={[styles.slantTick, { left: `${(i + 1) * 10}%` }]} />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- KAGE
function BossBar({ hp, max, top }: { hp: number; max: number; top: number }) {
  const enter = useSharedValue(0);
  useEffect(() => {
    enter.value = withTiming(1, { duration: 500, easing: Easing.out(Easing.cubic) });
  }, [enter]);
  const style = useAnimatedStyle(() => ({ opacity: enter.value, transform: [{ translateY: (1 - enter.value) * -14 }] }));
  return (
    <Animated.View style={[styles.boss, { top, pointerEvents: "none" }, style]}>
      <View style={styles.bossHead}>
        <LittleGiant size={22} body="#1B1F24" eyes={CRIMSON} />
        <Text style={styles.bossName}>KAGE</Text>
        <Text style={styles.bossTitle}>THE SHADOW</Text>
      </View>
      <View style={styles.bossRow}>
        <View style={styles.diamond} />
        <SlantBar frac={Math.max(0, hp / max)} color={CRIMSON} width={260} height={10} flip />
        <View style={styles.diamond} />
      </View>
    </Animated.View>
  );
}

function WavePill({ text, top }: { text: string; top: number }) {
  return (
    <View style={[styles.wave, { top: top + 44, pointerEvents: "none" }]}>
      <View style={styles.waveDot} />
      <Text style={styles.waveText}>{text}</Text>
    </View>
  );
}

// ---------------------------------------------------------------- combo
function Combo({ count, timer }: { count: number; timer: SharedValue<number> }) {
  const pop = useSharedValue(0);
  useEffect(() => {
    if (count >= 2) {
      pop.value = 1;
      pop.value = withSpring(0, { damping: 9, stiffness: 320 });
    }
  }, [count, pop]);
  const num = useAnimatedStyle(() => ({ transform: [{ scale: 1 + pop.value * 0.45 }, { skewX: "-10deg" }] }));
  const bar = useAnimatedStyle(() => ({ width: `${timer.value * 100}%` }));
  if (count < 2) return null;
  const hot = count >= 20 ? CRIMSON : count >= 10 ? ORANGE : LIME;
  return (
    <View style={[styles.combo, { pointerEvents: "none" }]}>
      <Animated.Text style={[styles.comboNum, { color: hot }, num]}>{count}</Animated.Text>
      <Text style={styles.comboLabel}>HITS</Text>
      <View style={styles.comboTrack}>
        <Animated.View style={[styles.comboFill, { backgroundColor: hot }, bar]} />
      </View>
      {count >= 10 && <Text style={[styles.comboPraise, { color: hot }]}>{count >= 30 ? "UNSTOPPABLE" : count >= 20 ? "SAVAGE" : "GREAT"}</Text>}
    </View>
  );
}

// ---------------------------------------------------------------- words
function Banner({ text, sub }: { text: string; sub: string }) {
  const slide = useSharedValue(0);
  const underline = useSharedValue(0);
  const shown = useRef("");
  useEffect(() => {
    if (!text) {
      shown.current = "";
      slide.value = withTiming(0, { duration: 200 });
      return;
    }
    if (text === shown.current) return;
    shown.current = text;
    slide.value = 0;
    underline.value = 0;
    slide.value = withSpring(1, { damping: 14, stiffness: 170 });
    underline.value = withDelay(120, withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) }));
  }, [text, slide, underline]);
  const style = useAnimatedStyle(() => ({
    opacity: Math.min(slide.value * 1.4, 1),
    transform: [{ translateX: (1 - slide.value) * 70 }, { skewX: "-8deg" }, { scale: 1.25 - 0.25 * slide.value }],
  }));
  const line = useAnimatedStyle(() => ({ transform: [{ scaleX: underline.value }], opacity: slide.value }));
  const big = ["STAGE CLEAR", "DEFEATED", "KAGE", "FINISH HIM"].includes(text);
  const color = text === "DEFEATED" || text === "KAGE" ? CRIMSON : ["FINISH HIM", "STAGE CLEAR", "CLEAR", "HEAVEN PIERCE"].includes(text) ? LIME : IVORY;
  return (
    <View style={[styles.bannerWrap, { pointerEvents: "none" }]}>
      <Animated.View style={[styles.bannerBox, style]}>
        {!!sub && <Text style={styles.bannerSub}>{sub}</Text>}
        <Text style={[styles.banner, big && styles.bannerBig, { color }]}>{text}</Text>
        <Animated.View style={[styles.bannerLine, { backgroundColor: color }, line]} />
      </Animated.View>
    </View>
  );
}

function GoArrow() {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [t]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: t.value * 12 }], opacity: 0.6 + 0.4 * t.value }));
  return (
    <Animated.View style={[styles.go, { pointerEvents: "none" }, style]}>
      <Text style={styles.goText}>GO</Text>
      <ChevronIcon />
      <View style={styles.goSecond}>
        <ChevronIcon />
      </View>
    </Animated.View>
  );
}

/** The slash under a title card, drawn in two strokes. */
export function Slash({ width = 220, color = LIME }: { width?: number; color?: string }) {
  return (
    <Svg width={width} height={14} viewBox="0 0 220 14">
      <Path d="M2 10 L218 3" stroke={color} strokeWidth={3} strokeLinecap="round" />
      <Path d="M30 13 L190 8" stroke={color} strokeOpacity={0.4} strokeWidth={1.5} strokeLinecap="round" />
    </Svg>
  );
}

export const textShadow = { textShadowColor: "rgba(0,0,0,0.65)", textShadowRadius: 12, textShadowOffset: { width: 0, height: 2 } };

const styles = StyleSheet.create({
  panel: { position: "absolute", flexDirection: "row", alignItems: "center", gap: 10 },
  medallion: { width: 62, height: 62, alignItems: "center", justifyContent: "center" },
  medalFlash: { position: "absolute", width: 58, height: 58, borderRadius: 29, backgroundColor: CRIMSON },
  bars: { gap: 5 },
  nameRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", width: 188 },
  name: { color: IVORY, fontFamily: UI_FONT, fontSize: 13, letterSpacing: 4, ...textShadow },
  hpText: { color: IVORY, fontFamily: UI_FONT, fontSize: 11, letterSpacing: 1, ...textShadow },
  hpMax: { opacity: 0.55, fontSize: 9 },
  slant: {
    backgroundColor: "rgba(18,22,25,0.6)",
    borderWidth: 1,
    borderColor: "rgba(245,243,232,0.35)",
    overflow: "hidden",
    borderRadius: 2,
  },
  slantFill: { position: "absolute", left: 0, top: 0, bottom: 0 },
  slantShine: { position: "absolute", left: 0, right: 0, top: 0, height: "40%", backgroundColor: "rgba(255,255,255,0.35)" },
  slantGhost: { position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: IVORY, opacity: 0.85 },
  slantTick: { position: "absolute", top: 0, bottom: 0, width: 1, backgroundColor: "rgba(18,22,25,0.45)" },
  energyTrack: {
    width: 150,
    height: 5,
    borderRadius: 3,
    backgroundColor: "rgba(18,22,25,0.6)",
    overflow: "hidden",
    transform: [{ skewX: "-20deg" }],
    marginLeft: -2,
  },
  energyFill: { position: "absolute", left: 0, top: 0, bottom: 0 },
  energyTick: { position: "absolute", top: 0, bottom: 0, width: 1.5, backgroundColor: "rgba(18,22,25,0.7)" },
  ready: { color: LIME, fontFamily: UI_FONT, fontSize: 8, letterSpacing: 2.5, ...textShadow },
  boss: { position: "absolute", left: 0, right: 0, alignItems: "center", gap: 6 },
  bossHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  bossName: { color: CRIMSON, fontFamily: UI_FONT, fontSize: 15, letterSpacing: 6, ...textShadow },
  bossTitle: { color: IVORY, opacity: 0.7, fontFamily: UI_FONT, fontSize: 9, letterSpacing: 3, ...textShadow },
  bossRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  diamond: { width: 8, height: 8, backgroundColor: CRIMSON, transform: [{ rotate: "45deg" }] },
  wave: {
    position: "absolute",
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: "rgba(18,22,25,0.55)",
    borderWidth: 1,
    borderColor: "rgba(255,42,47,0.55)",
  },
  waveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: CRIMSON },
  waveText: { color: IVORY, fontFamily: UI_FONT, fontSize: 10, letterSpacing: 3 },
  combo: { position: "absolute", right: 22, top: "30%", alignItems: "flex-end" },
  comboNum: { fontFamily: UI_FONT, fontSize: 54, lineHeight: 58, letterSpacing: -1, ...textShadow },
  comboLabel: { color: IVORY, fontFamily: UI_FONT, fontSize: 12, letterSpacing: 6, marginTop: -6, ...textShadow },
  comboTrack: { width: 84, height: 3, marginTop: 5, backgroundColor: "rgba(245,243,232,0.2)", borderRadius: 2, overflow: "hidden" },
  comboFill: { height: "100%" },
  comboPraise: { marginTop: 6, fontFamily: UI_FONT, fontSize: 11, letterSpacing: 4, ...textShadow },
  bannerWrap: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  bannerBox: { alignItems: "center" },
  bannerSub: { color: IVORY, opacity: 0.75, fontFamily: UI_FONT, fontSize: 12, letterSpacing: 8, marginBottom: 4, ...textShadow },
  banner: { fontFamily: UI_FONT, fontSize: 40, letterSpacing: 9, ...textShadow },
  bannerBig: { fontSize: 54, letterSpacing: 12 },
  bannerLine: { height: 3, width: "92%", marginTop: 6, borderRadius: 2 },
  go: { position: "absolute", right: 26, top: "44%", flexDirection: "row", alignItems: "center" },
  goText: { color: LIME, fontFamily: UI_FONT, fontSize: 22, letterSpacing: 5, marginRight: 4, ...textShadow },
  goSecond: { marginLeft: -14, opacity: 0.55 },
  pause: {
    position: "absolute",
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(18,22,25,0.55)",
    borderWidth: 1,
    borderColor: "rgba(245,243,232,0.35)",
  },
});
