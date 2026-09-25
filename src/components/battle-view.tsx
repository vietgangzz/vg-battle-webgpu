import { setAudioModeAsync, useAudioPlayer } from "expo-audio";
import { useKeepAwake } from "expo-keep-awake";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, type LayoutChangeEvent, PixelRatio, StyleSheet, Text, View } from "react-native";
import { Canvas, type CanvasRef } from "react-native-webgpu";

import { FilmPlayer } from "@/battle/runtime/player";
import { EndCard, END_CARD_SECONDS } from "@/components/end-card";
import { StandbyCard } from "@/components/standby-card";

const SFX = require("../../assets/film/sfx.m4a");
/** audio and picture may drift this far apart before the picture snaps to the audio */
const RESYNC = 0.06;
/** a screen narrower than this (width / height) is the folded outer display */
const FOLDED_ASPECT = 0.58;
/** the unfold: camera pull-back from the hero to the film's opening frame */
const OPEN_SECONDS = 1.4;
/** launched already open: the intro holds this long, then opens on its own */
const OPEN_INTRO_SECONDS = 10;
/** dev fold simulation: the outer display's aspect */
const SIM_FOLDED_ASPECT = 0.46;

type Phase = "loading" | "standby" | "opening" | "playing" | "card" | "done" | "error";
type Mode = "idle" | "standby" | "opening" | "film";

const isFolded = (w: number, h: number) => w > 0 && h > 0 && w / h < FOLDED_ASPECT;

/**
 * The whole showcase on one full-screen canvas.
 *
 * It always opens on the intro: the hero in the opening shot's world. The battle
 * waits for the phone to unfold (already open at launch, it waits a moment):
 * the camera pulls back to the film's first frame as a lime seam cuts down the
 * hinge and a progressive blur resolves from the edges, then the film plays on
 * from there with its soundtrack as the master clock, ends on the vgang card,
 * and returns to the intro.
 */
export function BattleView() {
  useKeepAwake();
  const ref = useRef<CanvasRef>(null);
  const player = useRef<FilmPlayer | null>(null);
  const size = useRef({ width: 0, height: 0 });
  const mode = useRef<Mode>("idle");
  const clock = useRef({ start: 0, seeking: false, seekTo: 0, standbyStart: 0, openStart: 0 });
  const [phase, setPhase] = useState<Phase>("loading");
  const [stage, setStage] = useState("");
  const [cardKey, setCardKey] = useState(0);
  const [simFold, setSimFold] = useState(false);
  /** the outer (folded) display is showing */
  const [folded, setFolded] = useState(false);
  const audio = useAudioPlayer(SFX);

  /** Play the film from `offset` seconds, audio in step. */
  const startFilm = useCallback(
    (offset: number) => {
      // seekTo is asynchronous: until the audio reports it, don't sync the picture to it
      clock.current.start = performance.now() / 1000 - offset;
      clock.current.seeking = true;
      clock.current.seekTo = offset;
      audio.seekTo(offset);
      audio.play();
      player.current?.endStandby();
      mode.current = "film";
      setCardKey((k) => k + 1);
      setPhase("playing");
    },
    [audio],
  );

  const startStandby = useCallback(() => {
    audio.pause();
    clock.current.standbyStart = performance.now() / 1000;
    mode.current = "standby";
    setPhase("standby");
  }, [audio]);

  /** From the top: always the intro; the battle waits for the phone to open. */
  const begin = useCallback(() => {
    setFolded(isFolded(size.current.width, size.current.height));
    startStandby();
  }, [startStandby]);


  /** Leave the intro: pull back into the film's opening frame. */
  const open = useCallback(() => {
    if (mode.current !== "standby") return;
    clock.current.openStart = performance.now() / 1000;
    mode.current = "opening";
    setPhase("opening");
  }, []);

  // already open: the intro holds briefly, then plays the unfold on its own
  useEffect(() => {
    if (phase !== "standby" || folded) return;
    const id = setTimeout(open, OPEN_INTRO_SECONDS * 1000);
    return () => clearTimeout(id);
  }, [phase, folded, open]);

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const { width, height } = e.nativeEvent.layout;
      const wasFolded = isFolded(size.current.width, size.current.height);
      size.current = { width, height };
      setFolded(isFolded(width, height));
      player.current?.setSize(width, height, PixelRatio.get());
      // repaint at the new size in the same pass, before the next vsync shows a stretched frame
      if (mode.current !== "idle") player.current?.redraw();
      // the phone just opened while the intro was waiting
      if (wasFolded && !isFolded(width, height)) open();
    },
    [open],
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
        p.renderer.setAnimationLoop(() => {
          const now = performance.now() / 1000;
          const c = clock.current;
          if (mode.current === "standby") {
            p.standby(now - c.standbyStart, 0);
            return;
          }
          if (mode.current === "opening") {
            const open = (now - c.openStart) / OPEN_SECONDS;
            if (open >= 1) startFilm(p.introSeconds);
            else p.standby(now - c.standbyStart, open);
            return;
          }
          if (mode.current !== "film") return;
          let t = now - c.start;
          // the audio has landed on the seek once it reports a time at (or just past) the target
          if (c.seeking && audio.currentTime >= c.seekTo - 0.02 && audio.currentTime < t + 1) c.seeking = false;
          // the soundtrack is the master clock: pull the picture back onto it when they drift
          if (!c.seeking && audio.playing && Math.abs(audio.currentTime - t) > RESYNC) {
            c.start = now - audio.currentTime;
            t = audio.currentTime;
          }
          p.render(Math.min(t, p.duration));
          if (t >= p.duration) {
            mode.current = "idle";
            setPhase("card");
          }
        });
        begin();
      } catch (err) {
        console.error("[battle]", err);
        if (!cancelled) setPhase("error");
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

  // after the card, back to the intro (the next unfold plays it again)
  useEffect(() => {
    if (phase !== "card") return;
    const id = setTimeout(() => {
      setPhase("done");
      begin();
    }, END_CARD_SECONDS * 1000);
    return () => clearTimeout(id);
  }, [phase, begin]);

  // ---- dev: fold / unfold the simulator (it has one display): `__battle.fold()`, `__battle.unfold()`
  useEffect(() => {
    if (!__DEV__) return;
    (globalThis as { __battle?: object }).__battle = {
      fold: () => {
        setSimFold(true);
        startStandby();
      },
      unfold: () => setSimFold(false),
      player: () => player.current,
      mode: () => mode.current,
      open,
    };
  }, [startStandby, open]);

  return (
    <View style={styles.root}>
      <View style={simFold ? styles.simFolded : styles.fill} onLayout={onLayout}>
        <Canvas ref={ref} style={StyleSheet.absoluteFill} />
      </View>
      <StandbyCard visible={phase === "standby"} />

      {(phase === "card" || phase === "done") && <EndCard key={cardKey} />}
      {phase === "loading" && (
        // opaque: the warm-up renders every shot once and must not flash on screen
        <View style={[styles.center, styles.cover, { pointerEvents: "none" }]}>
          <ActivityIndicator color="#D5F64B" />
          <Text style={styles.hint}>{stage}</Text>
        </View>
      )}
      {phase === "error" && (
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
