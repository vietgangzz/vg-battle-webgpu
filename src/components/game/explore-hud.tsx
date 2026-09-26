import { memo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import Animated, {
  FadeInDown,
  FadeOut,
  type SharedValue,
  useAnimatedProps,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

import type { Pop } from "@/battle/game/combat";
import type { ExploreHud as HudState } from "@/battle/world/explore";

import { Banner, BossBar, Combo, DamagePop, LowHealth, Markers, PlayerPanel } from "./hud";
import { PauseIcon } from "./icons";
import { GOLD, IVORY, LIME, UI_FONT } from "./theme";

/** Everything over the valley: SORA, the boss, the way to go, what is left to do, the news. */
export function ExploreHud({
  state,
  energy,
  combo,
  bars,
  levels,
  pops,
  onPopDone,
  onPause,
  fps,
  waypoint,
  points,
  onSkills,
}: {
  state: HudState;
  energy: SharedValue<number>;
  combo: SharedValue<number>;
  bars: SharedValue<number[]>;
  levels: SharedValue<number[]>;
  pops: Pop[];
  onPopDone: (id: number) => void;
  onPause: () => void;
  /** frames per second actually delivered (shown small by the pause button) */
  fps?: string;
  /** where the current objective is (see ExploreMeters.waypoint) */
  waypoint: SharedValue<number[]>;
  /** skill points waiting to be spent */
  points: number;
  /** open the skills (the portrait) */
  onSkills: () => void;
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
          <Markers bars={bars} levels={levels} />
          <Waypoint way={waypoint} />
          {pops.map((p) => (
            <DamagePop key={p.id} pop={p} onDone={onPopDone} />
          ))}
          <PlayerPanel
            hp={state.hp}
            max={state.maxHp}
            energy={energy}
            ready={state.ultReady}
            top={top}
            left={left}
            level={state.level}
            xp={state.xp}
            xpNext={state.xpNext}
            points={points}
            onPortrait={onSkills}
          />
          {state.boss && <BossBar hp={state.boss.hp} max={state.boss.max} name={state.boss.name} title={state.boss.title} top={top + 78} />}
          {/* the boss's bar takes the top of the screen; the tracker steps aside for the fight */}
          {!state.boss && <Quests o={state.objectives} top={top + 108} left={left} way={waypoint} />}
          <Combo count={state.combo} timer={combo} />
          {!!state.toast && <Toast text={state.toast} top={landscape ? top + 4 : top + 190} />}
          {!!fps && <Text style={[styles.fps, { top: top + 12, right: right + 50 }]}>{fps}</Text>}
          <Pressable onPress={onPause} hitSlop={14} style={[styles.pause, { top, right }]}>
            <PauseIcon />
          </Pressable>
        </>
      )}
      <Banner text={state.banner} sub={state.sub} />
    </View>
  );
}

/** which waypoint kind each tracker line is (the spirits have none: they are found, not sought) */
const ROW_KIND = [0, 1, -1, 2];

/** The quest tracker: what is left in the valley, under SORA's portrait. The tab folds it away. */
const Quests = memo(
  function Quests({ o, top, left, way }: { o: HudState["objectives"]; top: number; left: number; way: SharedValue<number[]> }) {
  const [open, setOpen] = useState(true);
  const rows: [string, string, boolean][] = [
    ["Light the shrines", `${o.shrines[0]}/${o.shrines[1]}`, o.shrines[0] === o.shrines[1]],
    ["Clear shadow camps", `${o.camps[0]}/${o.camps[1]}`, o.camps[0] === o.camps[1]],
    ["Lotus spirits", `${o.spirits[0]}/${o.spirits[1]}`, o.spirits[0] === o.spirits[1]],
    ["Shadow General · pagoda", o.boss ? "!" : "", false],
  ];
  // the first thing not yet done is the one to chase
  const current = rows.findIndex(([, , done]) => !done);
  return (
    <View style={[styles.quests, !open && styles.questsClosed, { top, left, pointerEvents: "box-none" }]}>
      <Pressable onPress={() => setOpen((v) => !v)} hitSlop={12} style={styles.questHead}>
        <View style={styles.questHeadBar} />
        <Text style={styles.questTitle}>QUESTS</Text>
        <Svg width={12} height={12} viewBox="0 0 12 12" style={{ marginLeft: "auto", transform: [{ rotate: open ? "0deg" : "-90deg" }] }}>
          <Path d="M2 4 L6 8 L10 4" stroke={LIME} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </Svg>
      </Pressable>
      {open &&
        rows.map(([k, v, done], i) => (
          <View key={k} style={[styles.questRow, i === current && styles.questCurrent, { pointerEvents: "none" }]}>
            <View style={[styles.questDot, done && styles.questDone, i === current && styles.questDotCurrent]} />
            <Text style={[styles.questText, done && styles.questTextDone, i === current && styles.questTextCurrent]} numberOfLines={1}>
              {k}
            </Text>
            {!done && ROW_KIND[i] >= 0 && <QuestDistance way={way} kind={ROW_KIND[i]} />}
            <Text style={[styles.questCount, done && styles.questTextDone]}>{v}</Text>
          </View>
        ))}
    </View>
  );
  },
  // redrawn only when a count moves, not for every hit and point of health
  (a, b) =>
    a.top === b.top &&
    a.left === b.left &&
    a.o.boss === b.o.boss &&
    a.o.shrines[0] === b.o.shrines[0] &&
    a.o.camps[0] === b.o.camps[0] &&
    a.o.spirits[0] === b.o.spirits[0],
);

const AText = Animated.createAnimatedComponent(TextInput);
const SPRING = { damping: 22, stiffness: 190, mass: 0.7 };

/**
 * When the objective is off screen: a gold badge at the edge of the screen,
 * its arrow turned the way to go, with how far. On screen the beacon in the
 * valley marks it (drawn with the picture, so it never trails). The badge
 * glides on the UI thread: springs chase where the game puts it, so it moves
 * smoothly whatever the JS thread's timing.
 */
const Waypoint = memo(function Waypoint({ way }: { way: SharedValue<number[]> }) {
  const { width, height } = useWindowDimensions();
  // the arrow's angle unwrapped (so it turns the short way round), and sprung toward
  const goal = useSharedValue(0);
  const turned = useSharedValue(0);
  useAnimatedReaction(
    () => way.value[5],
    (a) => {
      const d = a - goal.value;
      goal.value += d - Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
      turned.value = withSpring(goal.value, SPRING);
    },
  );
  const box = useAnimatedStyle(() => {
    const w = way.value;
    const show = w[2] && !w[3] ? 1 : 0;
    return {
      opacity: withTiming(show, { duration: show ? 260 : 160 }),
      transform: [{ translateX: withSpring(w[0] * width - 36, SPRING) }, { translateY: withSpring(w[1] * height - 36, SPRING) }],
    };
  });
  const arrow = useAnimatedStyle(() => ({ transform: [{ rotate: `${turned.value}rad` }] }));
  const dist = useAnimatedProps(() => ({ text: `${Math.round(way.value[4])} m` }) as never);
  return (
    <Animated.View style={[styles.way, box]}>
      <View style={styles.wayBadge}>
        <Animated.View style={[StyleSheet.absoluteFill, arrow]}>
          <Svg width={72} height={72} viewBox="0 0 72 72">
            <Path d="M68 36 L52 25 L56 36 L52 47 Z" fill={GOLD} />
          </Svg>
        </Animated.View>
        <View style={styles.wayCore}>
          <Svg width={14} height={14} viewBox="0 0 14 14">
            <Path d="M7 0.5 L13.5 7 L7 13.5 L0.5 7 Z" fill={GOLD} />
          </Svg>
        </View>
      </View>
      <AText editable={false} underlineColorAndroid="transparent" style={styles.wayDist} animatedProps={dist} defaultValue="" />
    </Animated.View>
  );
});

/** How far to the objective, beside its line in the tracker (shown while it is the one the beacon marks). */
function QuestDistance({ way, kind }: { way: SharedValue<number[]>; kind: number }) {
  const props = useAnimatedProps(() => {
    const w = way.value;
    const mine = w[2] && Math.round(w[6]) === kind;
    return { text: mine ? `${Math.round(w[4])} m` : "" } as never;
  });
  return <AText editable={false} underlineColorAndroid="transparent" style={styles.questDist} animatedProps={props} defaultValue="" />;
}

const Toast = memo(function Toast({ text, top }: { text: string; top: number }) {
  return (
    <Animated.View key={text} entering={FadeInDown.duration(320)} exiting={FadeOut.duration(250)} style={[styles.toast, { top, pointerEvents: "none" }]}>
      <View style={styles.toastDot} />
      <Text style={styles.toastText}>{text}</Text>
    </Animated.View>
  );
});

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
  quests: { position: "absolute", width: 236, gap: 3, paddingVertical: 8, paddingRight: 10, borderTopRightRadius: 10, borderBottomRightRadius: 10, backgroundColor: "rgba(12,15,17,0.26)", borderLeftWidth: 2, borderLeftColor: LIME },
  questHead: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 3, paddingLeft: 9 },
  questsClosed: { width: 116, paddingBottom: 5 },
  way: { position: "absolute", left: 0, top: 0, width: 72, alignItems: "center", pointerEvents: "none" },
  wayBadge: { width: 72, height: 72, alignItems: "center", justifyContent: "center" },
  wayCore: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(12,15,17,0.62)",
    borderWidth: 1.5,
    borderColor: GOLD,
    shadowColor: GOLD,
    shadowOpacity: 0.7,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  wayDist: { width: 72, marginTop: -12, color: IVORY, fontFamily: UI_FONT, fontSize: 11, padding: 0, textAlign: "center", textShadowColor: "rgba(0,0,0,0.85)", textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } },
  questDist: { width: 40, color: GOLD, fontFamily: UI_FONT, fontSize: 10, padding: 0, textAlign: "right" },
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
  fps: {
    position: "absolute",
    color: IVORY,
    fontFamily: UI_FONT,
    fontSize: 10,
    letterSpacing: 1,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "rgba(10,12,14,0.55)",
    fontVariant: ["tabular-nums"],
    pointerEvents: "none",
  },
  toastDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: LIME },
  toastText: { color: IVORY, fontFamily: UI_FONT, fontSize: 13 },
});
