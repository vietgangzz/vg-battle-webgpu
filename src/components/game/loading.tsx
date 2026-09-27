/**
 * The first load: what is being done, how far along (n/100) and a bar filling
 * toward full. The bar and the count run on the UI thread, so they keep moving
 * while the JS thread is busy compiling; a step that cannot say how far it has
 * got creeps toward its end, and jumps on when the next begins.
 */
import React, { memo, useCallback, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import Animated, { Easing, type SharedValue, useAnimatedProps, useAnimatedStyle, useSharedValue, withSequence, withTiming } from "react-native-reanimated";

import { LittleGiant } from "./icons";
import { IVORY, LIME, UI_FONT } from "./theme";

/** each step: what it shows, its share of the bar (percent), and about how long it runs (s) */
const STEPS: Record<string, { label: string; from: number; to: number; secs: number }> = {
  renderer: { label: "Starting up", from: 0, to: 3, secs: 1 },
  film: { label: "Loading resources", from: 3, to: 14, secs: 3 },
  scene: { label: "Loading resources", from: 14, to: 17, secs: 1 },
  shaders: { label: "Compiling shaders", from: 17, to: 38, secs: 10 },
  "warm-up": { label: "Compiling shaders", from: 38, to: 48, secs: 5 },
  stages: { label: "Building the stages", from: 48, to: 58, secs: 5 },
  world: { label: "Loading the valley", from: 58, to: 70, secs: 5 },
  creatures: { label: "Loading the monsters", from: 70, to: 78, secs: 3 },
  valley: { label: "Compiling shaders", from: 78, to: 92, secs: 8 },
  warm: { label: "Warming up", from: 92, to: 99, secs: 4 },
};

/** The load's progress: `report(step, fraction?)` as each step begins (and moves on), `finish()` at the end. */
export function useLoadProgress() {
  const shown = useSharedValue(0);
  const [label, setLabel] = useState(STEPS.renderer.label);
  const at = useRef("");
  const report = useCallback(
    (step: string, fraction?: number) => {
      const s = STEPS[step];
      if (!s) return;
      if (step !== at.current) {
        at.current = step;
        setLabel(s.label);
      }
      const start = Math.max(shown.get(), s.from);
      shown.set(
        fraction === undefined
          ? withSequence(withTiming(start, { duration: 150 }), withTiming(s.from + (s.to - s.from) * 0.9, { duration: s.secs * 1000, easing: Easing.out(Easing.quad) }))
          : withTiming(Math.max(start, s.from + (s.to - s.from) * fraction), { duration: 200 }),
      );
    },
    [shown],
  );
  const finish = useCallback(() => {
    shown.set(withTiming(100, { duration: 200 }));
  }, [shown]);
  return { shown, label, report, finish };
}

const Count = Animated.createAnimatedComponent(TextInput);

export const LoadingScreen = memo(function LoadingScreen({ shown, label }: { shown: SharedValue<number>; label: string }) {
  const fill = useAnimatedStyle(() => ({ width: `${shown.value}%` }));
  const count = useAnimatedProps(() => ({ text: `${Math.floor(shown.value)}/100` }) as never);
  return (
    // opaque: the warm-up renders every shot once and must not flash on screen
    <View style={[styles.root, { pointerEvents: "none" }]}>
      <LittleGiant size={60} />
      <View style={styles.box}>
        <View style={styles.row}>
          <Text style={styles.label}>{label.toUpperCase()}</Text>
          <Count editable={false} underlineColorAndroid="transparent" style={styles.count} animatedProps={count} defaultValue="0/100" />
        </View>
        <View style={styles.track}>
          <Animated.View style={[styles.fill, fill]} />
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, backgroundColor: "#000", alignItems: "center", justifyContent: "center", gap: 22 },
  box: { width: 360, maxWidth: "70%", gap: 10 },
  row: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  label: { color: IVORY, opacity: 0.75, fontFamily: UI_FONT, fontSize: 12, letterSpacing: 2.5 },
  count: { color: LIME, fontFamily: UI_FONT, fontSize: 13, letterSpacing: 1, padding: 0, fontVariant: ["tabular-nums"], textAlign: "right", minWidth: 60 },
  track: { height: 6, borderRadius: 3, backgroundColor: "rgba(245,243,232,0.12)", overflow: "hidden" },
  fill: { height: "100%", borderRadius: 3, backgroundColor: LIME, shadowColor: LIME, shadowOpacity: 0.8, shadowRadius: 6 },
});
