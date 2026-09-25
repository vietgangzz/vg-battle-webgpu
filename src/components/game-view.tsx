import { setAudioModeAsync, useAudioPlayer } from "expo-audio";
import { useFonts } from "expo-font";
import { useKeepAwake } from "expo-keep-awake";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, type LayoutChangeEvent, PixelRatio, StyleSheet, Text, View } from "react-native";
import { useSharedValue } from "react-native-reanimated";
import { Canvas, type CanvasRef } from "react-native-webgpu";

import { Adventure, type HudState } from "@/battle/game/adventure";
import { FilmPlayer } from "@/battle/runtime/player";
import { Controls } from "@/components/game/controls";
import { Hud } from "@/components/game/hud";
import { DefeatCard, PauseCard, ResultsCard } from "@/components/game/overlays";
import { useSfx } from "@/components/game/sfx";
import { StandbyCard } from "@/components/standby-card";

const SOUNDTRACK = require("../../assets/film/sfx.m4a");
/** a screen narrower than this (width / height) is the folded outer display */
const FOLDED_ASPECT = 0.58;
/** the unfold: camera pull-back from the hero onto the road */
const OPEN_SECONDS = 1.4;
/** launched already open: the intro holds this long, then opens on its own */
const OPEN_INTRO_SECONDS = 10;
const SIM_FOLDED_ASPECT = 0.46;

type Mode = "idle" | "standby" | "opening" | "game";

const isFolded = (w: number, h: number) => w > 0 && h > 0 && w / h < FOLDED_ASPECT;

const EMPTY_HUD: HudState = {
  phase: "title",
  hp: 1,
  maxHp: 1,
  boss: null,
  banner: "",
  sub: "",
  combo: 0,
  go: false,
  wave: "",
  ultReady: false,
  finishable: false,
  results: null,
};

/**
 * The game on one full-screen canvas. Folded: the intro, the hero idling in the
 * film's world. Unfolding opens straight onto the road (a camera pull-back, the
 * lime seam and a progressive blur); folding again pauses back to the intro.
 */
export function GameView() {
  useKeepAwake();
  const [fontsLoaded] = useFonts({ ManropeSemiBold: require("../../assets/fonts/Manrope-SemiBold.ttf") });
  const ref = useRef<CanvasRef>(null);
  const player = useRef<FilmPlayer | null>(null);
  const game = useRef<Adventure | null>(null);
  const size = useRef({ width: 0, height: 0 });
  const mode = useRef<Mode>("idle");
  const paused = useRef(false);
  const clock = useRef({ standbyStart: 0, openStart: 0 });
  const [view, setView] = useState<Mode | "loading" | "error">("loading");
  const [stage, setStage] = useState("");
  const [hud, setHud] = useState<HudState>(EMPTY_HUD);
  const [simFold, setSimFold] = useState(false);
  const [folded, setFolded] = useState(false);
  const [pausedView, setPausedView] = useState(false);
  /** the game, once built (for the controls) */
  const [pad, setPad] = useState<Adventure | null>(null);
  const energy = useSharedValue(0);
  const skill = useSharedValue(0);
  const combo = useSharedValue(0);
  const soundtrack = useAudioPlayer(SOUNDTRACK);
  const sfx = useSfx();

  const setMode = (m: Mode) => {
    mode.current = m;
    setView(m);
  };

  const setPaused = (p: boolean) => {
    paused.current = p;
    setPausedView(p);
  };

  const standby = useCallback(() => {
    soundtrack.pause();
    setPaused(false);
    clock.current.standbyStart = performance.now() / 1000;
    setMode("standby");
  }, [soundtrack]);

  const open = useCallback(() => {
    if (mode.current !== "standby") return;
    clock.current.openStart = performance.now() / 1000;
    setMode("opening");
  }, []);

  const startGame = useCallback(() => {
    player.current?.endStandby();
    soundtrack.pause();
    game.current?.start();
    setMode("game");
  }, [soundtrack]);

  // already open at launch: the intro holds, then opens on its own
  useEffect(() => {
    if (view !== "standby" || folded) return;
    const id = setTimeout(open, OPEN_INTRO_SECONDS * 1000);
    return () => clearTimeout(id);
  }, [view, folded, open]);

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const { width, height } = e.nativeEvent.layout;
      const wasFolded = isFolded(size.current.width, size.current.height);
      size.current = { width, height };
      const nowFolded = isFolded(width, height);
      setFolded(nowFolded);
      player.current?.setSize(width, height, PixelRatio.get());
      if (mode.current === "standby" || mode.current === "opening") player.current?.redraw();
      if (wasFolded && !nowFolded) open();
      // folded mid-game: back to the intro
      if (!wasFolded && nowFolded && mode.current === "game") standby();
    },
    [open, standby],
  );

  useEffect(() => {
    void setAudioModeAsync({ playsInSilentMode: true });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const context = ref.current?.getContext("webgpu");
        if (!context) return;
        const { width, height } = size.current.width ? size.current : { width: 1, height: 1 };
        const p = await FilmPlayer.create(context, { width, height, pixelRatio: PixelRatio.get() }, { onProgress: setStage });
        if (cancelled) {
          p.dispose();
          return;
        }
        player.current = p;
        if (size.current.width) p.setSize(size.current.width, size.current.height, PixelRatio.get());
        game.current = new Adventure(p, {
          hud: setHud,
          sound: sfx.play,
          meters: (m) => {
            energy.value = m.energy;
            skill.value = m.skill;
            combo.value = m.combo;
          },
          finisher: (at) => {
            soundtrack.seekTo(at);
            soundtrack.play();
          },
        });
        setPad(game.current);
        p.renderer.setAnimationLoop(() => {
          const now = performance.now();
          const c = clock.current;
          const s = now / 1000;
          if (mode.current === "standby") {
            p.standby(s - c.standbyStart, 0);
          } else if (mode.current === "opening") {
            const o = (s - c.openStart) / OPEN_SECONDS;
            if (o >= 1) startGame();
            else p.standby(s - c.standbyStart, o);
          } else if (mode.current === "game" && !paused.current) {
            game.current?.frame(now);
          }
        });
        standby();
      } catch (err) {
        console.error("[game]", err);
        if (!cancelled) setView("error");
      }
    })();
    return () => {
      cancelled = true;
      player.current?.dispose();
      player.current = null;
    };
    // the player is created once per mount; the callbacks it uses are stable for its lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // stage clear: let the finale's soundtrack ring out, then stop it
  useEffect(() => {
    if (hud.phase !== "results") return;
    const id = setTimeout(() => soundtrack.pause(), 3000);
    return () => clearTimeout(id);
  }, [hud.phase, soundtrack]);

  const restart = useCallback(
    (retry: boolean) => {
      soundtrack.pause();
      setPaused(false);
      game.current?.start(retry);
    },
    [soundtrack],
  );

  // ---- dev: fold / unfold the simulator (it has one display) and reach the game from the debugger
  useEffect(() => {
    if (!__DEV__) return;
    (globalThis as { __game?: object }).__game = {
      fold: () => {
        setSimFold(true);
        standby();
      },
      unfold: () => setSimFold(false),
      open,
      game: () => game.current,
      player: () => player.current,
      mode: () => mode.current,
    };
  }, [standby, open]);

  const playing = view === "game" && fontsLoaded && pad;
  const live = ["explore", "ambush", "boss", "broken", "bossIntro"].includes(hud.phase);
  return (
    <View style={styles.root}>
      <View style={simFold ? styles.simFolded : styles.fill} onLayout={onLayout}>
        <Canvas ref={ref} style={StyleSheet.absoluteFill} />
      </View>
      <StandbyCard visible={view === "standby"} />
      {playing && (
        <>
          <Hud state={hud} energy={energy} combo={combo} onPause={() => setPaused(true)} />
          {live && !pausedView && <Controls pad={pad} energy={energy} skill={skill} ultReady={hud.ultReady} finishable={hud.finishable} />}
          {hud.phase === "results" && hud.results && <ResultsCard results={hud.results} onAgain={() => restart(false)} />}
          {hud.phase === "defeat" && <DefeatCard onRetry={() => restart(true)} onRestart={() => restart(false)} />}
          {pausedView && <PauseCard onResume={() => setPaused(false)} onRestart={() => restart(false)} />}
        </>
      )}
      {view === "loading" && (
        // opaque: the warm-up renders every shot once and must not flash on screen
        <View style={[styles.center, styles.cover, { pointerEvents: "none" }]}>
          <ActivityIndicator color="#D5F64B" />
          <Text style={styles.hint}>{stage}</Text>
        </View>
      )}
      {view === "error" && (
        <View style={styles.center}>
          <Text style={styles.hint}>WebGPU is not available on this device.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000", alignItems: "center" },
  fill: { ...StyleSheet.absoluteFill },
  simFolded: { height: "100%", aspectRatio: SIM_FOLDED_ASPECT },
  center: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", gap: 12 },
  cover: { backgroundColor: "#000" },
  hint: { color: "#F5F3E8", opacity: 0.6, fontSize: 13, letterSpacing: 1 },
});
