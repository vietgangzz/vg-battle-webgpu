import { setAudioModeAsync, useAudioPlayer } from "expo-audio";
import { useFonts } from "expo-font";
import * as Haptics from "expo-haptics";
import { useKeepAwake } from "expo-keep-awake";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, type LayoutChangeEvent, PixelRatio, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Canvas, type CanvasRef } from "react-native-webgpu";

import { Adventure, BAR_SLOTS, type HudState, type Pop, type SoundName } from "@/battle/game/adventure";
import { STAGES } from "@/battle/game/stage";
import { FilmPlayer } from "@/battle/runtime/player";
import type { WorldManifest } from "@/battle/world/data";
import { Explore, type ExploreHud as ExploreHudState } from "@/battle/world/explore";
import { loadWorld } from "@/battle/world/load-world";
import { loadCreatures } from "@/battle/world/load-creatures";
import { Controls } from "@/components/game/controls";
import { ExploreHud } from "@/components/game/explore-hud";
import { Hud } from "@/components/game/hud";
import { MainMenu, SettingsSheet, StageSelect } from "@/components/game/menu";
import { DefeatCard, PauseCard, ResultsCard, ValleyCard } from "@/components/game/overlays";
import { useSave } from "@/components/game/save";
import { useSfx } from "@/components/game/sfx";

const SOUNDTRACK = require("../../assets/film/sfx.m4a");
/** the film behind the menu: the standoff, back and forth (frames 16 .. 58) */
const MENU_FRAMES: [number, number] = [16, 58];

type Mode = "idle" | "menu" | "game" | "explore";
type MenuPage = "home" | "stages";

const EMPTY_HUD: HudState = {
  phase: "title",
  stage: 0,
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
  hint: "",
  marks: [],
  results: null,
};

const HAPTIC: Partial<Record<SoundName, () => void>> = {
  hit: () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  block: () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft),
  heavy: () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  wave: () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
  slam: () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
  clash: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  down: () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid),
};

/**
 * The game on one full-screen canvas: the title screen over the film's
 * standoff, then the stages.
 */
/**
 * The game draws at most 2 device pixels per point: on a 3x phone the third
 * pixel costs more than half the frame for detail no one sees in motion
 * (the film route keeps full resolution).
 */
const gamePixelRatio = () => Math.min(PixelRatio.get(), 2);

export function GameView() {
  useKeepAwake();
  const [fontsLoaded] = useFonts({ ManropeSemiBold: require("../../assets/fonts/Manrope-SemiBold.ttf") });
  const ref = useRef<CanvasRef>(null);
  const player = useRef<FilmPlayer | null>(null);
  const game = useRef<Adventure | null>(null);
  const explore = useRef<Explore | null>(null);
  const size = useRef({ width: 0, height: 0 });
  const mode = useRef<Mode>("idle");
  const paused = useRef(false);
  const clock = useRef({ menuStart: 0 });
  const [view, setView] = useState<Mode | "loading" | "error">("loading");
  const [page, setPage] = useState<MenuPage>("home");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [stage, setStage] = useState("");
  const [hud, setHud] = useState<HudState>(EMPTY_HUD);
  const [pops, setPops] = useState<Pop[]>([]);
  const [pausedView, setPausedView] = useState(false);
  /** the game, once built (for the controls) */
  const [pad, setPad] = useState<Adventure | null>(null);
  const [roam, setRoam] = useState<{ game: Explore; manifest: WorldManifest } | null>(null);
  const [world, setWorld] = useState<ExploreHudState | null>(null);
  const [fps, setFps] = useState(0);
  const map = useSharedValue<number[]>([0, 0, 0, 0]);
  const energy = useSharedValue(0);
  const skill = useSharedValue(0);
  const shot = useSharedValue(0);
  const stamina = useSharedValue(1);
  const winded = useSharedValue(0);
  const levels = useSharedValue<number[]>(new Array(BAR_SLOTS).fill(0));
  const combo = useSharedValue(0);
  const progress = useSharedValue(0);
  const bars = useSharedValue<number[]>(new Array(BAR_SLOTS * 4).fill(0));
  const curtain = useSharedValue(0);
  const soundtrack = useAudioPlayer(SOUNDTRACK);
  const sfx = useSfx();
  const { save, record, setSettings, setHero } = useSave();
  const heroSave = useRef(save.hero);
  const settings = useRef(save.settings);
  useEffect(() => {
    settings.current = save.settings;
    heroSave.current = save.hero;
  }, [save.settings, save.hero]);

  // the frame rate actually delivered, twice a second, for the HUD's corner
  useEffect(() => {
    if (view !== "explore") return;
    const id = setInterval(() => setFps(player.current?.stats.fps ?? 0), 500);
    return () => clearInterval(id);
  }, [view]);

  const setMode = (m: Mode) => {
    mode.current = m;
    setView(m);
  };

  const setPaused = (p: boolean) => {
    paused.current = p;
    setPausedView(p);
  };

  /** Fade to black, run `fn`, fade back. */
  const cut = useCallback(
    (fn: () => void) => {
      curtain.set(withTiming(1, { duration: 260 }));
      setTimeout(() => {
        fn();
        curtain.set(withTiming(0, { duration: 420 }));
      }, 280);
    },
    [curtain],
  );

  const toMenu = useCallback(
    (fade = true) => {
      const go = () => {
        soundtrack.pause();
        setPaused(false);
        if (mode.current === "game") game.current?.leave();
        if (mode.current === "explore") explore.current?.leave();
        player.current?.endStandby();
        clock.current.menuStart = performance.now() / 1000;
        setPage("home");
        setMode("menu");
      };
      if (fade) cut(go);
      else go();
    },
    [soundtrack, cut],
  );

  const startStage = useCallback(
    (i: number, retry = false) => {
      cut(() => {
        soundtrack.pause();
        setPaused(false);
        setPops([]);
        // leaving the valley, or its title-screen flight
        if (mode.current === "explore" || mode.current === "menu") explore.current?.leave();
        game.current?.start(i, retry);
        setMode("game");
      });
    },
    [soundtrack, cut],
  );

  /** Into the valley (fresh), or back at the last lit shrine. */
  const startExplore = useCallback(
    (fresh = true) => {
      cut(() => {
        soundtrack.pause();
        setPaused(false);
        setPops([]);
        if (mode.current === "game") game.current?.leave();
        explore.current?.start(fresh);
        setMode("explore");
      });
    },
    [soundtrack, cut],
  );

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    size.current = { width, height };
    player.current?.setSize(width, height, gamePixelRatio());
  }, []);

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
        const p = await FilmPlayer.create(context, { width, height, pixelRatio: gamePixelRatio() }, { onProgress: setStage });
        if (cancelled) {
          p.dispose();
          return;
        }
        player.current = p;
        if (size.current.width) p.setSize(size.current.width, size.current.height, gamePixelRatio());
        const g = new Adventure(p, {
          hud: setHud,
          sound: (n) => {
            if (settings.current.sfx) sfx.play(n);
            if (settings.current.haptics) HAPTIC[n]?.();
          },
          pop: (pp) => setPops((list) => [...list.slice(-9), pp]),
          meters: (m) => {
            energy.value = m.energy;
            skill.value = m.skill;
            combo.value = m.combo;
            progress.value = m.progress;
            bars.value = [...m.bars];
          },
          finisher: (at) => {
            soundtrack.seekTo(at);
            soundtrack.play();
          },
        });
        // every stage's scenery, built and compiled now so no stage hitches on entry
        setStage("stages");
        await g.prepare((group) => p.renderer.compileAsync(group, p.fs.camera, p.fs.scene));
        game.current = g;
        setPad(g);
        setStage("world");
        const wd = await loadWorld();
        // the valley's monsters (the game still runs without them if they fail to load)
        const creatures = await loadCreatures().catch((e) => {
          console.warn("[game] creatures", e);
          return null;
        });
        const ex = new Explore(p, wd, {
          hud: setWorld,
          sound: (n) => {
            if (settings.current.sfx) sfx.play(n);
            if (settings.current.haptics) HAPTIC[n]?.();
          },
          pop: (pp) => setPops((list) => [...list.slice(-9), pp]),
          meters: (m) => {
            energy.value = m.energy;
            skill.value = m.skill;
            shot.value = m.shot;
            stamina.value = m.stamina;
            winded.value = m.winded;
            combo.value = m.combo;
            bars.value = [...m.bars];
            levels.value = [...m.levels];
            map.value = [...m.map];
          },
          progress: (level, xp, levelled) => {
            setHero(level, xp);
            if (levelled && settings.current.haptics) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          },
        }, creatures);
        ex.setProgress(heroSave.current.level, heroSave.current.xp);
        ex.world.group.visible = true;
        await p.renderer.compileAsync(ex.world.group, p.fs.camera, p.fs.scene);
        await ex.warm((o) => p.renderer.compileAsync(o, p.fs.camera, p.fs.scene));
        ex.world.group.visible = false;
        explore.current = ex;
        setRoam({ game: ex, manifest: wd.manifest });
        p.renderer.setAnimationLoop(() => {
          const now = performance.now();
          const c = clock.current;
          const s = now / 1000;
          if (mode.current === "menu") {
            // the valley at golden hour behind the title (the film's standoff until it has loaded)
            const ex = explore.current;
            if (ex) ex.backdrop(now);
            else {
              const [a, b] = MENU_FRAMES;
              const f = a + pingpong((s - c.menuStart) * 10, b - a);
              p.render(f / 24, now);
            }
          } else if (mode.current === "game" && !paused.current) {
            game.current?.frame(now);
          } else if (mode.current === "explore" && !paused.current) {
            explore.current?.frame(now);
          }
        });
        toMenu(false);
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

  // a stage won: keep the rank, open the next; let the finale's soundtrack ring out
  useEffect(() => {
    if (hud.phase !== "results" || !hud.results) return;
    record(hud.results);
    const id = setTimeout(() => soundtrack.pause(), 3000);
    return () => clearTimeout(id);
  }, [hud.phase, hud.results, record, soundtrack]);

  const popDone = useCallback((id: number) => setPops((list) => list.filter((p) => p.id !== id)), []);

  // ---- dev: fold / unfold the simulator (it has one display) and reach the game from the debugger
  useEffect(() => {
    if (!__DEV__) return;
    (globalThis as { __game?: object }).__game = {
      stage: (i: number) => startStage(i),
      explore: () => startExplore(true),
      world: () => explore.current,
      menu: () => toMenu(),
      game: () => game.current,
      player: () => player.current,
      mode: () => mode.current,
    };
  }, [startStage, startExplore, toMenu]);

  const curtainStyle = useAnimatedStyle(() => ({ opacity: curtain.value }));
  const ready = fontsLoaded && pad;
  const playing = view === "game" && ready;
  const live = ["explore", "ambush", "boss", "broken", "bossIntro"].includes(hud.phase);
  const next = hud.results && hud.results.stage + 1 < STAGES.length ? hud.results.stage + 1 : null;
  return (
    <View style={styles.root}>
      <View style={styles.fill} onLayout={onLayout}>
        <Canvas ref={ref} style={StyleSheet.absoluteFill} />
      </View>
      {view === "menu" && ready && page === "home" && (
        <MainMenu onExplore={() => startExplore(true)} onStages={() => setPage("stages")} onSettings={() => setSettingsOpen(true)} />
      )}
      {view === "menu" && ready && page === "stages" && <StageSelect save={save} onPick={(i) => startStage(i)} onBack={() => setPage("home")} />}
      {playing && (
        <>
          <Hud state={hud} energy={energy} combo={combo} progress={progress} bars={bars} pops={pops} onPopDone={popDone} onPause={() => setPaused(true)} />
          {live && !pausedView && (
            <Controls
              pad={pad}
              energy={energy}
              skill={skill}
              ultReady={hud.ultReady}
              finishable={hud.finishable}
              size={save.settings.buttons}
              onPress={() => save.settings.haptics && void Haptics.selectionAsync()}
            />
          )}
          {hud.phase === "results" && hud.results && (
            <ResultsCard
              results={hud.results}
              onNext={next !== null ? () => startStage(next) : null}
              onAgain={() => startStage(hud.results!.stage)}
              onMenu={() => toMenu()}
            />
          )}
          {hud.phase === "defeat" && <DefeatCard onRetry={() => startStage(hud.stage, true)} onRestart={() => startStage(hud.stage)} onMenu={() => toMenu()} />}
          {pausedView && <PauseCard onResume={() => setPaused(false)} onRestart={() => startStage(hud.stage)} onSettings={() => setSettingsOpen(true)} onMenu={() => toMenu()} />}
        </>
      )}
      {view === "explore" && ready && roam && world && (
        <>
          <ExploreHud
            state={world}
            manifest={roam.manifest}
            energy={energy}
            combo={combo}
            bars={bars}
            levels={levels}
            map={map}
            pops={pops}
            onPopDone={popDone}
            onPause={() => setPaused(true)}
            fps={fps}
          />
          {["roam", "camp", "boss", "bossIntro"].includes(world.phase) && !pausedView && (
            <Controls
              pad={roam.game}
              shot={shot}
              stamina={stamina}
              winded={winded}
              energy={energy}
              skill={skill}
              ultReady={world.ultReady}
              finishable={false}
              size={save.settings.buttons}
              onPress={() => save.settings.haptics && void Haptics.selectionAsync()}
            />
          )}
          {world.phase === "results" && world.results && <ValleyCard results={world.results} onAgain={() => startExplore(true)} onMenu={() => toMenu()} />}
          {world.phase === "defeat" && <DefeatCard onRetry={() => startExplore(false)} onRestart={() => startExplore(true)} onMenu={() => toMenu()} />}
          {pausedView && <PauseCard onResume={() => setPaused(false)} onRestart={() => startExplore(true)} onSettings={() => setSettingsOpen(true)} onMenu={() => toMenu()} />}
        </>
      )}
      {settingsOpen && <SettingsSheet settings={save.settings} onChange={setSettings} onClose={() => setSettingsOpen(false)} />}
      <Animated.View style={[StyleSheet.absoluteFill, styles.curtain, { pointerEvents: "none" }, curtainStyle]} />
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

const pingpong = (x: number, len: number) => {
  const m = x % (2 * len);
  return m < len ? m : 2 * len - m;
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000", alignItems: "center" },
  fill: { ...StyleSheet.absoluteFill },
  center: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", gap: 12 },
  cover: { backgroundColor: "#000" },
  curtain: { backgroundColor: "#000" },
  hint: { color: "#F5F3E8", opacity: 0.6, fontSize: 13, letterSpacing: 1 },
});
