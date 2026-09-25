import { useEffect, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withDelay, withSpring } from "react-native-reanimated";

import type { Results } from "@/battle/game/adventure";

import { textShadow } from "./hud";
import { LittleGiant } from "./icons";
import { CRIMSON, INK, IVORY, LIME, ORANGE, UI_FONT } from "./theme";

const RANK_COLOR = { S: LIME, A: IVORY, B: ORANGE, C: CRIMSON };

function Button({ label, onPress, primary }: { label: string; onPress: () => void; primary?: boolean }) {
  const s = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => s.set(withSpring(0.94, { damping: 12, stiffness: 400 }))}
      onPressOut={() => s.set(withSpring(1, { damping: 12, stiffness: 400 }))}
    >
      <Animated.View style={[styles.button, primary ? styles.primary : styles.secondary, style]}>
        <Text style={[styles.buttonText, primary && styles.primaryText]}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}

function Scrim({ children, tint = "rgba(10,12,14,0.72)" }: { children: ReactNode; tint?: string }) {
  return (
    <Animated.View entering={FadeIn.duration(260)} style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: tint }]}>
      {children}
    </Animated.View>
  );
}

/** STAGE CLEAR: the rank stamps down, then the numbers roll in. */
export function ResultsCard({ results, onAgain }: { results: Results; onAgain: () => void }) {
  const stamp = useSharedValue(0);
  useEffect(() => {
    stamp.value = withDelay(500, withSpring(1, { damping: 10, stiffness: 160 }));
  }, [stamp]);
  const rank = useAnimatedStyle(() => ({
    opacity: Math.min(stamp.value * 2, 1),
    transform: [{ scale: 2.4 - 1.4 * stamp.value }, { rotate: `${(1 - stamp.value) * -18}deg` }],
  }));
  const m = Math.floor(results.time / 60);
  const s = Math.floor(results.time % 60);
  const rows: [string, string][] = [
    ["TIME", `${m}:${String(s).padStart(2, "0")}`],
    ["MAX COMBO", `${results.maxCombo}`],
    ["K.O.", `${results.kos}`],
    ["DAMAGE TAKEN", `${Math.round(results.damage)}`],
  ];
  return (
    <Scrim>
      <Animated.View entering={FadeInDown.duration(420).easing(Easing.out(Easing.cubic))} style={styles.card}>
        <Text style={styles.kicker}>STAGE 1 · CRIMSON PLAIN</Text>
        <Text style={[styles.title, { color: LIME }]}>STAGE CLEAR</Text>
        <View style={styles.rankRow}>
          <Animated.Text style={[styles.rank, { color: RANK_COLOR[results.rank] }, rank]}>{results.rank}</Animated.Text>
          <View style={styles.stats}>
            {rows.map(([k, v], i) => (
              <Animated.View key={k} entering={FadeInDown.delay(700 + i * 110).duration(320)} style={styles.statRow}>
                <Text style={styles.statKey}>{k}</Text>
                <Text style={styles.statVal}>{v}</Text>
              </Animated.View>
            ))}
          </View>
        </View>
        <Animated.View entering={FadeIn.delay(1300).duration(400)} style={styles.actions}>
          <Button label="PLAY AGAIN" onPress={onAgain} primary />
        </Animated.View>
      </Animated.View>
    </Scrim>
  );
}

/** Down: try the arena again, or the whole road. */
export function DefeatCard({ onRetry, onRestart }: { onRetry: () => void; onRestart: () => void }) {
  return (
    <Scrim tint="rgba(30,4,6,0.66)">
      <Animated.View entering={FadeInDown.delay(900).duration(420)} style={styles.card}>
        <LittleGiant size={46} body="#1B1F24" eyes={CRIMSON} />
        <Text style={[styles.title, { color: CRIMSON, marginTop: 10 }]}>DEFEATED</Text>
        <Text style={styles.line}>The shadow holds the plain. For now.</Text>
        <View style={styles.actions}>
          <Button label="RETRY" onPress={onRetry} primary />
          <Button label="RESTART" onPress={onRestart} />
        </View>
      </Animated.View>
    </Scrim>
  );
}

export function PauseCard({ onResume, onRestart }: { onResume: () => void; onRestart: () => void }) {
  return (
    <Scrim>
      <View style={styles.card}>
        <LittleGiant size={46} />
        <Text style={[styles.title, { marginTop: 10 }]}>PAUSED</Text>
        <View style={styles.legend}>
          {[
            ["SLASH", "combo: spin · rising · thrust"],
            ["JUMP + SLASH", "the descending cut"],
            ["DASH", "untouchable while it lasts"],
            ["GUARD", "raise it just in time to parry"],
            ["STREAK", "run straight through them"],
            ["ULT", "heaven pierce, when the ring is full"],
          ].map(([k, v]) => (
            <View key={k} style={styles.legendRow}>
              <Text style={styles.legendKey}>{k}</Text>
              <Text style={styles.legendVal}>{v}</Text>
            </View>
          ))}
        </View>
        <View style={styles.actions}>
          <Button label="RESUME" onPress={onResume} primary />
          <Button label="RESTART" onPress={onRestart} />
        </View>
      </View>
    </Scrim>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },
  card: { alignItems: "center", paddingHorizontal: 28, maxWidth: 420, width: "100%" },
  kicker: { color: IVORY, opacity: 0.6, fontFamily: UI_FONT, fontSize: 10, letterSpacing: 5 },
  title: { color: IVORY, fontFamily: UI_FONT, fontSize: 38, letterSpacing: 10, marginTop: 6, transform: [{ skewX: "-8deg" }], ...textShadow },
  line: { color: IVORY, opacity: 0.7, fontFamily: UI_FONT, fontSize: 12, letterSpacing: 1, marginTop: 8 },
  rankRow: { flexDirection: "row", alignItems: "center", gap: 26, marginTop: 22 },
  rank: { fontFamily: UI_FONT, fontSize: 112, lineHeight: 118, transform: [{ skewX: "-10deg" }], ...textShadow },
  stats: { gap: 8, minWidth: 170 },
  statRow: { flexDirection: "row", justifyContent: "space-between", gap: 18, borderBottomWidth: 1, borderBottomColor: "rgba(245,243,232,0.14)", paddingBottom: 6 },
  statKey: { color: IVORY, opacity: 0.6, fontFamily: UI_FONT, fontSize: 10, letterSpacing: 3 },
  statVal: { color: IVORY, fontFamily: UI_FONT, fontSize: 14, letterSpacing: 1 },
  actions: { flexDirection: "row", gap: 12, marginTop: 28 },
  button: { paddingHorizontal: 26, paddingVertical: 13, borderRadius: 26, borderWidth: 1.5 },
  primary: { backgroundColor: LIME, borderColor: LIME },
  secondary: { backgroundColor: "rgba(18,22,25,0.5)", borderColor: "rgba(245,243,232,0.45)" },
  buttonText: { color: IVORY, fontFamily: UI_FONT, fontSize: 12, letterSpacing: 4 },
  primaryText: { color: INK },
  legend: { marginTop: 18, gap: 7, alignSelf: "stretch" },
  legendRow: { flexDirection: "row", gap: 12 },
  legendKey: { color: LIME, fontFamily: UI_FONT, fontSize: 10, letterSpacing: 2, width: 104, textAlign: "right" },
  legendVal: { color: IVORY, opacity: 0.8, fontFamily: UI_FONT, fontSize: 11, flex: 1 },
});
