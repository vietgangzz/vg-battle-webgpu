import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Animated, { FadeInDown, FadeOut, type SharedValue, useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, G, Path, Polygon, Rect } from "react-native-svg";

import type { Pop } from "@/battle/game/combat";
import type { WorldManifest } from "@/battle/world/data";
import type { ExploreHud as HudState } from "@/battle/world/explore";

import { Banner, BossBar, Combo, DamagePop, LowHealth, Markers, PlayerPanel } from "./hud";
import { PauseIcon } from "./icons";
import { CRIMSON, INK, IVORY, LIME, ORANGE, UI_FONT } from "./theme";

/** Everything over the valley: SORA, the boss, the map, what is left to do, the news. */
export function ExploreHud({
  state,
  manifest,
  energy,
  combo,
  bars,
  map,
  pops,
  onPopDone,
  onPause,
}: {
  state: HudState;
  manifest: WorldManifest;
  energy: SharedValue<number>;
  combo: SharedValue<number>;
  bars: SharedValue<number[]>;
  map: SharedValue<number[]>;
  pops: Pop[];
  onPopDone: (id: number) => void;
  onPause: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  // lying down, the top centre between the portrait and the map is free for news
  const landscape = width > height;
  const top = Math.max(insets.top, 16) + 10;
  const right = Math.max(insets.right, 14) + 6;
  const left = Math.max(insets.left, 14) + 6;
  const playing = state.phase !== "results";
  return (
    <View style={[StyleSheet.absoluteFill, { pointerEvents: "box-none" }]}>
      {playing && (
        <>
          <LowHealth low={state.hp > 0 && state.hp / state.maxHp < 0.3} />
          <Markers bars={bars} />
          {pops.map((p) => (
            <DamagePop key={p.id} pop={p} onDone={onPopDone} />
          ))}
          <PlayerPanel hp={state.hp} max={state.maxHp} energy={energy} ready={state.ultReady} top={top} left={left} />
          {state.boss && <BossBar hp={state.boss.hp} max={state.boss.max} name={state.boss.name} title={state.boss.title} top={top + 78} />}
          <Minimap manifest={manifest} state={state} map={map} top={top + 50} right={right} />
          {/* the boss's bar takes the top of the screen; the tracker steps aside for the fight */}
          {!state.boss && <Quests state={state} top={top + 96} left={left} />}
          <Combo count={state.combo} timer={combo} />
          {!!state.toast && <Toast text={state.toast} top={landscape ? top + 4 : top + 50 + MAP + 70} />}
          <Pressable onPress={onPause} hitSlop={14} style={[styles.pause, { top, right }]}>
            <PauseIcon />
          </Pressable>
        </>
      )}
      <Banner text={state.banner} sub={state.sub} />
    </View>
  );
}

// ---------------------------------------------------------------- the map
const MAP = 116;
/** map pixels per metre */
const SCALE = 0.62;

/**
 * A round map that turns with the camera: the river, the paths, the village,
 * the pagoda, and what waits where. SORA is the arrow at its centre.
 */
function Minimap({ manifest, state, map, top, right }: { manifest: WorldManifest; state: HudState; map: SharedValue<number[]>; top: number; right: number }) {
  const size = manifest.size * SCALE;
  const half = size / 2;
  // world (x, y) -> map pixels (north up, before turning)
  const px = (x: number) => half + x * SCALE;
  const py = (y: number) => half - y * SCALE;
  const river = manifest.river.map(([x, y], i) => `${i ? "L" : "M"}${px(x)} ${py(y)}`).join(" ");
  const paths = manifest.paths.map((p) => p.map(([x, y], i) => `${i ? "L" : "M"}${px(x)} ${py(y)}`).join(" "));
  const [tx0, ty0, tx1, ty1] = manifest.terraces;
  const o = state.objectives;
  const shrines = manifest.markers.filter((m) => m.type === "shrine");
  const camps = manifest.markers.filter((m) => m.type === "camp");
  const boss = manifest.markers.find((m) => m.type === "boss");

  // turn and slide the map so SORA sits at the centre and the camera looks up:
  // screen = centre + R(q - P), with the layer's transform origin at its middle
  const layer = useAnimatedStyle(() => {
    const [x, y, , cam] = map.value;
    const theta = cam - Math.PI / 2;
    const dx = half - (half + x * SCALE);
    const dy = half - (half - y * SCALE);
    const c = Math.cos(theta);
    const sn = Math.sin(theta);
    return {
      transform: [{ translateX: MAP / 2 - half + c * dx - sn * dy }, { translateY: MAP / 2 - half + sn * dx + c * dy }, { rotate: `${theta}rad` }],
    };
  });
  const arrow = useAnimatedStyle(() => {
    const [, , heading, cam] = map.value;
    return { transform: [{ rotate: `${cam - heading}rad` }] };
  });

  return (
    <View style={[styles.map, { top, right }]}>
      <Animated.View style={[{ position: "absolute", left: 0, top: 0, width: size, height: size }, layer]}>
        <Svg width={size} height={size}>
          <Rect x={0} y={0} width={size} height={size} fill="#2F4A2A" />
          <Rect x={px(tx0)} y={py(ty1)} width={(tx1 - tx0) * SCALE} height={(ty1 - ty0) * SCALE} fill="#5B7F4E" opacity={0.7} />
          <Path d={river} stroke="#5FA7A0" strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          {paths.map((d, i) => (
            <Path key={i} d={d} stroke="#C9A877" strokeWidth={2} strokeDasharray="4 3" fill="none" />
          ))}
          <Circle cx={px(manifest.village[0])} cy={py(manifest.village[1])} r={manifest.village[2] * SCALE} fill="#8A6B4A" opacity={0.55} />
          <Circle cx={px(manifest.temple[0])} cy={py(manifest.temple[1])} r={11} fill="#7A5A3A" opacity={0.6} />
          {shrines.map((m, i) => (
            <Rect key={m.name} x={px(m.at[0]) - 3.5} y={py(m.at[1]) - 3.5} width={7} height={7} fill={o.lit[i] ? ORANGE : IVORY} opacity={0.95} transform={`rotate(45 ${px(m.at[0])} ${py(m.at[1])})`} />
          ))}
          {camps.map((m, i) => (
            <G key={m.name}>
              <Circle cx={px(m.at[0])} cy={py(m.at[1])} r={5} fill={o.cleared[i] ? "#6F7A6B" : CRIMSON} />
            </G>
          ))}
          {boss && <Polygon points={`${px(boss.at[0])},${py(boss.at[1]) - 7} ${px(boss.at[0]) + 6},${py(boss.at[1]) + 5} ${px(boss.at[0]) - 6},${py(boss.at[1]) + 5}`} fill={CRIMSON} stroke={IVORY} strokeWidth={1} />}
        </Svg>
      </Animated.View>
      <Animated.View style={[styles.arrow, arrow]}>
        <Svg width={20} height={20} viewBox="0 0 20 20">
          <Path d="M10 1 L17 17 L10 13 L3 17 Z" fill={LIME} stroke={INK} strokeWidth={1.4} strokeLinejoin="round" />
        </Svg>
      </Animated.View>
      <View style={styles.mapRing} />
    </View>
  );
}

/** The quest tracker: what is left in the valley, under SORA's portrait. */
function Quests({ state, top, left }: { state: HudState; top: number; left: number }) {
  const o = state.objectives;
  const rows: [string, string, boolean][] = [
    ["Thắp đền thờ", `${o.shrines[0]}/${o.shrines[1]}`, o.shrines[0] === o.shrines[1]],
    ["Dẹp trại bóng", `${o.camps[0]}/${o.camps[1]}`, o.camps[0] === o.camps[1]],
    ["Linh hồn sen", `${o.spirits[0]}/${o.spirits[1]}`, o.spirits[0] === o.spirits[1]],
    ["Hắc Tướng · chùa", o.boss ? "!" : "", false],
  ];
  // the first thing not yet done is the one to chase
  const current = rows.findIndex(([, , done]) => !done);
  return (
    <View style={[styles.quests, { top, left, pointerEvents: "none" }]}>
      <View style={styles.questHead}>
        <View style={styles.questHeadBar} />
        <Text style={styles.questTitle}>NHIỆM VỤ</Text>
      </View>
      {rows.map(([k, v, done], i) => (
        <View key={k} style={[styles.questRow, i === current && styles.questCurrent]}>
          <View style={[styles.questDot, done && styles.questDone, i === current && styles.questDotCurrent]} />
          <Text style={[styles.questText, done && styles.questTextDone, i === current && styles.questTextCurrent]}>{k}</Text>
          <Text style={[styles.questCount, done && styles.questTextDone]}>{v}</Text>
        </View>
      ))}
    </View>
  );
}

function Toast({ text, top }: { text: string; top: number }) {
  return (
    <Animated.View key={text} entering={FadeInDown.duration(320)} exiting={FadeOut.duration(250)} style={[styles.toast, { top, pointerEvents: "none" }]}>
      <View style={styles.toastDot} />
      <Text style={styles.toastText}>{text}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
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
  map: { position: "absolute", width: MAP, height: MAP, borderRadius: MAP / 2, overflow: "hidden", backgroundColor: "#2F4A2A" },
  mapRing: { ...StyleSheet.absoluteFill, borderRadius: MAP / 2, borderWidth: 2, borderColor: "rgba(245,243,232,0.55)" },
  arrow: { position: "absolute", left: MAP / 2 - 10, top: MAP / 2 - 10, width: 20, height: 20 },
  quests: { position: "absolute", width: 168, gap: 3, paddingVertical: 8, paddingRight: 10, borderTopRightRadius: 10, borderBottomRightRadius: 10, backgroundColor: "rgba(12,15,17,0.26)", borderLeftWidth: 2, borderLeftColor: LIME },
  questHead: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 3, paddingLeft: 9 },
  questHeadBar: { width: 10, height: 2, backgroundColor: LIME },
  questTitle: { color: LIME, fontFamily: UI_FONT, fontSize: 9, letterSpacing: 2.4 },
  questRow: { flexDirection: "row", alignItems: "center", gap: 7, paddingLeft: 10, paddingVertical: 2 },
  questCurrent: { backgroundColor: "rgba(213,246,75,0.1)" },
  questDot: { width: 7, height: 7, transform: [{ rotate: "45deg" }], borderWidth: 1.2, borderColor: IVORY, opacity: 0.7 },
  questDotCurrent: { borderColor: LIME, opacity: 1 },
  questDone: { backgroundColor: LIME, borderColor: LIME },
  questText: { flex: 1, color: IVORY, fontFamily: UI_FONT, fontSize: 11, textShadowColor: "rgba(0,0,0,0.7)", textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } },
  questTextCurrent: { color: "#FFFFFF" },
  questCount: { color: LIME, fontFamily: UI_FONT, fontSize: 11 },
  questTextDone: { opacity: 0.45 },
  toast: {
    position: "absolute",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: "rgba(18,22,25,0.72)",
    borderWidth: 1,
    borderColor: "rgba(213,246,75,0.55)",
    maxWidth: "46%",
  },
  toastDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: LIME },
  toastText: { color: IVORY, fontFamily: UI_FONT, fontSize: 13 },
});
