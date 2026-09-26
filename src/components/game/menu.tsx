import { useMemo, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeInDown, FadeInRight, FadeOut, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";

import { STAGES, type StageDef } from "@/battle/game/stage";

import { textShadow } from "./hud";
import type { Save, Settings } from "./save";
import { CRIMSON, INK, IVORY, LIME, ORANGE, UI_FONT } from "./theme";

const LOCKUP = require("../../../assets/brand/lockup.png");
const RANK_COLOR: Record<string, string> = { S: LIME, A: IVORY, B: ORANGE, C: CRIMSON };

export function PressButton({ label, onPress, primary, small }: { label: string; onPress: () => void; primary?: boolean; small?: boolean }) {
  const s = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <Pressable onPress={onPress} onPressIn={() => s.set(withSpring(0.94, { damping: 12, stiffness: 400 }))} onPressOut={() => s.set(withSpring(1, { damping: 12, stiffness: 400 }))}>
      <Animated.View style={[styles.button, primary ? styles.primary : styles.secondary, small && styles.small, style]}>
        <Text style={[styles.buttonText, primary && styles.primaryText, small && styles.smallText]}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}

/** The title screen, over the film's standoff. */
export function MainMenu({ onExplore, onStages, onSettings }: { onExplore: () => void; onStages: () => void; onSettings: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Animated.View entering={FadeIn.duration(600)} exiting={FadeOut.duration(250)} style={StyleSheet.absoluteFill}>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <LinearGradient id="menuShade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={INK} stopOpacity={0.2} />
            <Stop offset="0.55" stopColor={INK} stopOpacity={0.05} />
            <Stop offset="1" stopColor={INK} stopOpacity={0.9} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill="url(#menuShade)" />
      </Svg>
      <View style={[styles.menuBody, { paddingBottom: insets.bottom + 36 }]}>
        <Animated.View entering={FadeInDown.delay(150).duration(600)} style={styles.titleBlock}>
          <Image source={LOCKUP} style={styles.lockup} resizeMode="contain" />
          <Text style={styles.title}>LITTLE GIANT</Text>
          <Text style={styles.tagline}>A JOURNEY ACROSS VIETNAM</Text>
        </Animated.View>
        <Animated.View entering={FadeInDown.delay(450).duration(500)} style={styles.menuButtons}>
          <PressButton label="EXPLORE NINH BÌNH" onPress={onExplore} primary />
          <View style={styles.row}>
            <PressButton label="CHALLENGE" onPress={onStages} />
            <PressButton label="SETTINGS" onPress={onSettings} />
          </View>
        </Animated.View>
      </View>
      <Text style={[styles.footer, { bottom: insets.bottom + 10 }]}>vgang.studio</Text>
    </Animated.View>
  );
}

/** Pick a stage: one illustrated card per landscape, locked until the one before is won. */
export function StageSelect({ save, onPick, onBack }: { save: Save; onPick: (i: number) => void; onBack: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Animated.View entering={FadeIn.duration(300)} exiting={FadeOut.duration(200)} style={[StyleSheet.absoluteFill, styles.selectRoot]}>
      <View style={[styles.selectHead, { paddingTop: insets.top + 18 }]}>
        <Pressable onPress={onBack} hitSlop={12} style={styles.back}>
          <Text style={styles.backText}>‹  BACK</Text>
        </Pressable>
        <Text style={styles.selectTitle}>SELECT STAGE</Text>
        <Text style={styles.selectSub}>From Tràng An to the Shadow Realm</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cards} decelerationRate="fast" snapToInterval={CARD_W + 16}>
        {STAGES.map((s, i) => (
          <Animated.View key={s.id} entering={FadeInRight.delay(100 + i * 90).duration(420)}>
            <StageCard stage={s} index={i} locked={i > save.unlocked} rank={save.best[s.id]} onPress={() => onPick(i)} />
          </Animated.View>
        ))}
      </ScrollView>
    </Animated.View>
  );
}

const CARD_W = 236;
const CARD_H = 330;
const ART_H = 180;

function StageCard({ stage, index, locked, rank, onPress }: { stage: StageDef; index: number; locked: boolean; rank?: string; onPress: () => void }) {
  const s = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <Pressable
      disabled={locked}
      onPress={onPress}
      onPressIn={() => s.set(withSpring(0.96, { damping: 12, stiffness: 380 }))}
      onPressOut={() => s.set(withSpring(1, { damping: 12, stiffness: 380 }))}
    >
      <Animated.View style={[styles.card, style]}>
        <Landscape stage={stage} />
        <View style={styles.cardBody}>
          <Text style={styles.cardKicker}>STAGE {index + 1} · {stage.region.toUpperCase()}</Text>
          <Text style={styles.cardName} numberOfLines={2}>
            {stage.name}
          </Text>
          <Text style={styles.cardBlurb} numberOfLines={3}>
            {stage.blurb}
          </Text>
        </View>
        {rank && (
          <View style={[styles.rankBadge, { borderColor: RANK_COLOR[rank] }]}>
            <Text style={[styles.rankText, { color: RANK_COLOR[rank] }]}>{rank}</Text>
          </View>
        )}
        {locked && (
          <View style={styles.locked}>
            <Svg width={30} height={30} viewBox="0 0 48 48">
              <Rect x={11} y={21} width={26} height={20} rx={4} fill={IVORY} />
              <Path d="M16 21 V15 A8 8 0 0 1 32 15 V21" stroke={IVORY} strokeWidth={4} fill="none" />
            </Svg>
            <Text style={styles.lockedText}>WIN STAGE {index} TO OPEN</Text>
          </View>
        )}
      </Animated.View>
    </Pressable>
  );
}

/** A stage's postcard: its sky, its sun and three layers of its hills, drawn from its palette. */
function Landscape({ stage }: { stage: StageDef }) {
  const { sky, sun } = stage.card;
  const paths = useMemo(() => {
    const W = CARD_W;
    const H = ART_H;
    const karst = (base: number, h: number, n: number, seed: number) => {
      let d = `M0 ${H} L0 ${base}`;
      let x = 0;
      for (let i = 0; i < n; i++) {
        const w = (W / n) * (0.7 + ((seed * (i + 3)) % 7) / 10);
        const top = base - h * (0.5 + (((seed + i * 5) % 9) / 9) * 0.6);
        d += ` L${x + w * 0.12} ${base} Q${x + w * 0.1} ${top} ${x + w * 0.5} ${top} Q${x + w * 0.9} ${top} ${x + w * 0.88} ${base}`;
        x += w;
      }
      return `${d} L${W} ${base} L${W} ${H} Z`;
    };
    const ridge = (base: number, h: number, n: number, seed: number) => {
      let d = `M0 ${H} L0 ${base}`;
      for (let i = 0; i <= n; i++) {
        const x = (W * i) / n;
        const y = base - h * (0.3 + (((seed + i * 7) % 11) / 11) * 0.7) * (i % 2 ? 1 : 0.55);
        d += ` L${x} ${y}`;
      }
      return `${d} L${W} ${H} Z`;
    };
    if (stage.id === "fansipan") return [ridge(110, 55, 8, 3), ridge(135, 45, 10, 5), ridge(160, 38, 7, 9)];
    if (stage.id === "crimson-plain") return [ridge(140, 8, 12, 2), ridge(150, 5, 9, 4), `M0 ${ART_H} L0 158 L${CARD_W} 158 L${CARD_W} ${ART_H} Z`];
    return [karst(118, 70, 6, 3), karst(140, 60, 5, 7), karst(162, 48, 4, 11)];
  }, [stage.id]);
  const water = stage.terrain.kind === "river" || stage.terrain.kind === "boardwalk";
  return (
    <Svg width={CARD_W} height={ART_H}>
      <Defs>
        <LinearGradient id={`sky-${stage.id}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={sky[0]} />
          <Stop offset="1" stopColor={sky[1]} />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={CARD_W} height={ART_H} fill={`url(#sky-${stage.id})`} />
      <Circle cx={stage.id === "fansipan" ? 60 : 160} cy={stage.id === "ha-long" ? 118 : 62} r={stage.id === "ha-long" ? 26 : 16} fill={sun} opacity={0.95} />
      {paths.map((d, i) => (
        <Path key={i} d={d} fill={stage.card.layers[i]} />
      ))}
      {water && <Rect x={0} y={166} width={CARD_W} height={14} fill={stage.card.layers[2]} opacity={0.85} />}
      {water && [0, 1, 2].map((k) => <Rect key={k} x={30 + k * 62} y={170 + (k % 2) * 4} width={26} height={1.5} fill={sun} opacity={0.5} />)}
      {stage.id === "crimson-plain" && (
        <Path d="M104 158 V120 M132 158 V120 M96 118 H140 M92 112 Q118 106 144 112" stroke="#0D0506" strokeWidth={5} fill="none" strokeLinecap="round" />
      )}
    </Svg>
  );
}

/** Sound, haptics and control size. */
export function SettingsSheet({ settings, onChange, onClose }: { settings: Settings; onChange: (p: Partial<Settings>) => void; onClose: () => void }) {
  const [s, setS] = useState(settings);
  const set = (p: Partial<Settings>) => {
    const next = { ...s, ...p };
    setS(next);
    onChange(p);
  };
  return (
    <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(180)} style={[StyleSheet.absoluteFill, styles.sheetScrim]}>
      <Animated.View entering={FadeInDown.duration(300)} style={styles.sheet}>
        <Text style={styles.sheetTitle}>SETTINGS</Text>
        <Toggle label="SOUND EFFECTS" on={s.sfx} onToggle={() => set({ sfx: !s.sfx })} />
        <Toggle label="HAPTICS" on={s.haptics} onToggle={() => set({ haptics: !s.haptics })} />
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>CONTROL SIZE</Text>
          <View style={styles.segment}>
            {[
              ["S", 0.85],
              ["M", 1],
              ["L", 1.15],
            ].map(([k, v]) => (
              <Pressable key={k} onPress={() => set({ buttons: v as number })} style={[styles.segItem, s.buttons === v && styles.segOn]}>
                <Text style={[styles.segText, s.buttons === v && styles.segTextOn]}>{k}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <View style={styles.sheetActions}>
          <PressButton label="DONE" onPress={onClose} primary />
        </View>
      </Animated.View>
    </Animated.View>
  );
}

function Toggle({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  const x = useSharedValue(on ? 1 : 0);
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: x.value * 20 }] }));
  return (
    <Pressable
      style={styles.settingRow}
      onPress={() => {
        x.set(withSpring(on ? 0 : 1, { damping: 14, stiffness: 300 }));
        onToggle();
      }}
    >
      <Text style={styles.settingLabel}>{label}</Text>
      <View style={[styles.switch, on && styles.switchOn]}>
        <Animated.View style={[styles.switchKnob, knob]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  menuBody: { flex: 1, justifyContent: "flex-end", alignItems: "center", paddingHorizontal: 24 },
  titleBlock: { alignItems: "center", marginBottom: 28 },
  lockup: { width: 180, height: 36, opacity: 0.95, marginBottom: 14 },
  title: { color: IVORY, fontFamily: UI_FONT, fontSize: 42, letterSpacing: 10, transform: [{ skewX: "-8deg" }], ...textShadow },
  // a darker, wider shadow than the rest: the line sits over a bright sky
  tagline: { color: LIME, fontFamily: UI_FONT, fontSize: 12, letterSpacing: 7, marginTop: 6, textShadowColor: "rgba(0,0,0,0.9)", textShadowRadius: 10, textShadowOffset: { width: 0, height: 1 } },
  menuButtons: { alignItems: "center", gap: 12 },
  row: { flexDirection: "row", gap: 12 },
  footer: { position: "absolute", alignSelf: "center", color: IVORY, opacity: 0.45, fontFamily: UI_FONT, fontSize: 10, letterSpacing: 3 },
  button: { paddingHorizontal: 26, paddingVertical: 14, borderRadius: 28, borderWidth: 1.5, alignItems: "center" },
  primary: { backgroundColor: LIME, borderColor: LIME, minWidth: 240 },
  secondary: { backgroundColor: "rgba(18,22,25,0.55)", borderColor: "rgba(245,243,232,0.45)", minWidth: 114 },
  small: { paddingHorizontal: 18, paddingVertical: 10, minWidth: 0 },
  buttonText: { color: IVORY, fontFamily: UI_FONT, fontSize: 12, letterSpacing: 4 },
  primaryText: { color: INK },
  smallText: { fontSize: 10, letterSpacing: 3 },
  selectRoot: { backgroundColor: "rgba(8,10,12,0.82)" },
  selectHead: { paddingHorizontal: 26, paddingBottom: 18 },
  back: { alignSelf: "flex-start", marginBottom: 14 },
  backText: { color: IVORY, opacity: 0.75, fontFamily: UI_FONT, fontSize: 12, letterSpacing: 3 },
  selectTitle: { color: IVORY, fontFamily: UI_FONT, fontSize: 30, letterSpacing: 8, transform: [{ skewX: "-8deg" }], ...textShadow },
  selectSub: { color: LIME, fontFamily: UI_FONT, fontSize: 12, letterSpacing: 2, marginTop: 4 },
  cards: { paddingHorizontal: 26, gap: 16, paddingBottom: 30 },
  card: { width: CARD_W, height: CARD_H, borderRadius: 18, overflow: "hidden", backgroundColor: "#15191D", borderWidth: 1, borderColor: "rgba(245,243,232,0.16)" },
  cardBody: { padding: 14, gap: 4 },
  cardKicker: { color: LIME, fontFamily: UI_FONT, fontSize: 9, letterSpacing: 2.5 },
  cardName: { color: IVORY, fontFamily: UI_FONT, fontSize: 19, letterSpacing: 2 },
  cardBlurb: { color: IVORY, opacity: 0.65, fontFamily: UI_FONT, fontSize: 11, lineHeight: 16 },
  rankBadge: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(18,22,25,0.7)",
  },
  rankText: { fontFamily: UI_FONT, fontSize: 20, transform: [{ skewX: "-8deg" }] },
  locked: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(8,10,12,0.72)", alignItems: "center", justifyContent: "center", gap: 10 },
  lockedText: { color: IVORY, opacity: 0.8, fontFamily: UI_FONT, fontSize: 10, letterSpacing: 2.5 },
  sheetScrim: { backgroundColor: "rgba(8,10,12,0.7)", alignItems: "center", justifyContent: "center" },
  sheet: { width: "86%", maxWidth: 380, borderRadius: 22, padding: 22, backgroundColor: "#15191D", borderWidth: 1, borderColor: "rgba(245,243,232,0.16)", gap: 6 },
  sheetTitle: { color: IVORY, fontFamily: UI_FONT, fontSize: 22, letterSpacing: 7, marginBottom: 10, transform: [{ skewX: "-8deg" }] },
  settingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "rgba(245,243,232,0.1)" },
  settingLabel: { color: IVORY, fontFamily: UI_FONT, fontSize: 11, letterSpacing: 3 },
  switch: { width: 46, height: 26, borderRadius: 13, backgroundColor: "rgba(245,243,232,0.18)", padding: 3 },
  switchOn: { backgroundColor: LIME },
  switchKnob: { width: 20, height: 20, borderRadius: 10, backgroundColor: IVORY },
  segment: { flexDirection: "row", borderRadius: 14, overflow: "hidden", borderWidth: 1, borderColor: "rgba(245,243,232,0.3)" },
  segItem: { paddingHorizontal: 14, paddingVertical: 6 },
  segOn: { backgroundColor: LIME },
  segText: { color: IVORY, fontFamily: UI_FONT, fontSize: 11 },
  segTextOn: { color: INK },
  sheetActions: { alignItems: "center", marginTop: 16 },
});
