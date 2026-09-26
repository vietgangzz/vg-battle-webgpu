/**
 * SKILLS: where SORA spends the points her levels earn. Six cards, each a
 * skill with its glyph, what its ranks give now and at the next rank, five
 * pips, and the button that buys the next rank. The game waits while it is
 * open.
 */
import { memo, type ReactElement, useEffect } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Animated, { FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming, ZoomIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

import { RANK_MAX, type Ranks, SKILLS, type SkillId } from "@/battle/world/skills";

import { CrescentGlyph, type GlyphProps, LotusGlyph, SlashGlyph, SprintGlyph, StreakGlyph } from "./skill-icons";
import { GOLD, INK, IVORY, LIME, UI_FONT } from "./theme";

/** a heart, for vitality */
function HeartGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Path d="M32 56 C14 42 6 32 6 21 C6 12 13 6 21 6 C26 6 30 9 32 13 C34 9 38 6 43 6 C51 6 58 12 58 21 C58 32 50 42 32 56 Z" fill={color} />
      <Path d="M18 16 C14 18 12 22 13 26" stroke="#FFFFFF" strokeWidth={4} strokeLinecap="round" opacity={0.7} fill="none" />
    </Svg>
  );
}

const LOOK: Record<SkillId, { color: string; Glyph: (p: GlyphProps) => ReactElement }> = {
  blade: { color: LIME, Glyph: SlashGlyph },
  streak: { color: "#3CE8B0", Glyph: StreakGlyph },
  bolt: { color: "#58D6FF", Glyph: CrescentGlyph },
  lotus: { color: "#FFC94A", Glyph: LotusGlyph },
  vitality: { color: "#FF6B7A", Glyph: HeartGlyph },
  wind: { color: "#FFB45A", Glyph: SprintGlyph },
};

export function SkillSheet({ ranks, points, level, onSpend, onClose }: { ranks: Ranks; points: number; level: number; onSpend: (id: SkillId) => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const side = Math.max(insets.left, insets.right, 20) + 8;
  const cols = width > 700 ? 3 : 2;
  const cardW = Math.min(260, (width - side * 2 - (cols - 1) * 12) / cols);
  return (
    <Animated.View entering={FadeIn.duration(220)} style={[StyleSheet.absoluteFill, styles.scrim]}>
      <View style={[styles.head, { paddingHorizontal: side, paddingTop: Math.max(insets.top, 14) + 6 }]}>
        <View>
          <Text style={styles.kicker}>SORA · LEVEL {level}</Text>
          <Text style={styles.title}>SKILLS</Text>
        </View>
        <PointsPill points={points} />
        <Pressable onPress={onClose} hitSlop={14} style={styles.close}>
          <Svg width={16} height={16} viewBox="0 0 16 16">
            <Path d="M3 3 L13 13 M13 3 L3 13" stroke={IVORY} strokeWidth={2.2} strokeLinecap="round" />
          </Svg>
        </Pressable>
      </View>
      <View style={[styles.grid, { paddingHorizontal: side, width: cardW * cols + (cols - 1) * 12 + side * 2 }]}>
        {SKILLS.map((s, i) => (
          <Animated.View key={s.id} entering={FadeInDown.delay(40 * i).duration(280)}>
            <SkillCard id={s.id} rank={ranks[s.id]} canSpend={points > 0 && ranks[s.id] < RANK_MAX} width={cardW} onSpend={onSpend} />
          </Animated.View>
        ))}
      </View>
      <Text style={styles.foot}>A point every level, and one more every fifth. Ranks stay with SORA.</Text>
    </Animated.View>
  );
}

/** How many points wait, glinting while there are any. */
function PointsPill({ points }: { points: number }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = points > 0 ? withRepeat(withSequence(withTiming(1, { duration: 700 }), withTiming(0, { duration: 700 })), -1) : withTiming(0);
  }, [points, p]);
  const glow = useAnimatedStyle(() => ({ shadowOpacity: 0.35 + p.value * 0.55, transform: [{ scale: 1 + p.value * 0.04 }] }));
  return (
    <Animated.View style={[styles.pill, points > 0 ? styles.pillOn : styles.pillOff, glow]}>
      <Text style={[styles.pillNum, points > 0 && { color: INK }]}>{points}</Text>
      <Text style={[styles.pillText, points > 0 && { color: INK }]}>{points === 1 ? "POINT" : "POINTS"}</Text>
    </Animated.View>
  );
}

const SkillCard = memo(function SkillCard({ id, rank, canSpend, width, onSpend }: { id: SkillId; rank: number; canSpend: boolean; width: number; onSpend: (id: SkillId) => void }) {
  const def = SKILLS.find((s) => s.id === id)!;
  const { color, Glyph } = LOOK[id];
  const maxed = rank >= RANK_MAX;
  return (
    <View style={[styles.card, { width }, canSpend && { borderColor: `${color}88` }]}>
      <View style={[styles.glyph, { borderColor: color, shadowColor: color }]}>
        <Glyph size={30} color={color} />
      </View>
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {def.name}
        </Text>
        <Text style={styles.role} numberOfLines={1}>
          {def.role}
        </Text>
        <Text style={[styles.effect, { color: rank ? color : IVORY }, !rank && { opacity: 0.45 }]} numberOfLines={1}>
          {rank ? def.effect(rank) : "not yet learned"}
        </Text>
        {!maxed && (
          <Text style={styles.next} numberOfLines={1}>
            next: {def.effect(rank + 1)}
          </Text>
        )}
        <View style={styles.pips}>
          {Array.from({ length: RANK_MAX }, (_, i) =>
            i < rank ? (
              <Animated.View key={`on${i}`} entering={i === rank - 1 ? ZoomIn.springify().damping(12) : undefined} style={[styles.pip, { backgroundColor: color, borderColor: color }]} />
            ) : (
              <View key={`off${i}`} style={styles.pip} />
            ),
          )}
          {maxed && <Text style={[styles.max, { color }]}>MAX</Text>}
        </View>
      </View>
      {!maxed && (
        <Pressable onPress={() => onSpend(id)} disabled={!canSpend} hitSlop={10} style={[styles.plus, canSpend ? { backgroundColor: color, borderColor: color } : styles.plusOff]}>
          <Svg width={14} height={14} viewBox="0 0 14 14">
            <Path d="M7 1.5 V12.5 M1.5 7 H12.5" stroke={canSpend ? INK : IVORY} strokeWidth={2.4} strokeLinecap="round" opacity={canSpend ? 1 : 0.4} />
          </Svg>
        </Pressable>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  scrim: { backgroundColor: "rgba(8,10,12,0.82)", alignItems: "center" },
  head: { alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: 18, marginBottom: 12 },
  kicker: { color: IVORY, opacity: 0.55, fontFamily: UI_FONT, fontSize: 9, letterSpacing: 4 },
  title: { color: IVORY, fontFamily: UI_FONT, fontSize: 30, letterSpacing: 8, transform: [{ skewX: "-8deg" }] },
  close: {
    marginLeft: "auto",
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(18,22,25,0.6)",
    borderWidth: 1,
    borderColor: "rgba(245,243,232,0.35)",
  },
  pill: { flexDirection: "row", alignItems: "baseline", gap: 6, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, borderWidth: 1.5, shadowColor: GOLD, shadowRadius: 12, shadowOffset: { width: 0, height: 0 } },
  pillOn: { backgroundColor: GOLD, borderColor: "#FFF3C4" },
  pillOff: { backgroundColor: "rgba(18,22,25,0.6)", borderColor: "rgba(245,243,232,0.25)" },
  pillNum: { color: IVORY, fontFamily: UI_FONT, fontSize: 18 },
  pillText: { color: IVORY, fontFamily: UI_FONT, fontSize: 9, letterSpacing: 3 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12, justifyContent: "center" },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingLeft: 12,
    paddingRight: 10,
    borderRadius: 14,
    backgroundColor: "rgba(24,29,33,0.78)",
    borderWidth: 1,
    borderColor: "rgba(245,243,232,0.12)",
  },
  glyph: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    backgroundColor: "rgba(10,12,14,0.6)",
    shadowOpacity: 0.55,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  body: { flex: 1, gap: 2 },
  name: { color: IVORY, fontFamily: UI_FONT, fontSize: 14, letterSpacing: 0.5 },
  role: { color: IVORY, opacity: 0.5, fontFamily: UI_FONT, fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase" },
  effect: { fontFamily: UI_FONT, fontSize: 11, marginTop: 3 },
  next: { color: IVORY, opacity: 0.45, fontFamily: UI_FONT, fontSize: 10 },
  pips: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  pip: { width: 9, height: 9, transform: [{ rotate: "45deg" }], borderWidth: 1.2, borderColor: "rgba(245,243,232,0.35)" },
  max: { fontFamily: UI_FONT, fontSize: 9, letterSpacing: 2, marginLeft: 4 },
  plus: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", borderWidth: 1.5 },
  plusOff: { backgroundColor: "rgba(18,22,25,0.5)", borderColor: "rgba(245,243,232,0.2)" },
  foot: { color: IVORY, opacity: 0.4, fontFamily: UI_FONT, fontSize: 10, letterSpacing: 1, marginTop: 14 },
});
