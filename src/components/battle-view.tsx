import { setAudioModeAsync, useAudioPlayer } from "expo-audio";
import { useKeepAwake } from "expo-keep-awake";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, type LayoutChangeEvent, PixelRatio, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
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
/** dev fold simulation: the outer display's aspect */
const SIM_FOLDED_ASPECT = 0.46;

type Phase = "loading" | "standby" | "opening" | "playing" | "card" | "done" | "error";
type Mode = "idle" | "standby" | "opening" | "film";

const isFolded = (w: number, h: number) => w > 0 && h > 0 && w / h < FOLDED_ASPECT;

/**
 * The whole showcase on one full-screen canvas.
 *
 * Folded (the outer display): an intro idles on the hero in the opening shot's
 * world. Unfolding the phone pulls the camera back to the film's first frame
 * and cuts a lime seam down the hinge, then the film plays on from there with
 * its soundtrack as the master clock, and ends on the vgang card. Opened
 * already at launch, the film starts straight away. Tap to replay.
 */
export function BattleView() {
  useKeepAwake();
  const ref = useRef<CanvasRef>(null);
  const player = useRef<FilmPlayer | null>(null);
  const size = useRef({ width: 0, height: 0 });
  const mode = useRef<Mode>("idle");
  const clock = useRef({ start: 0, seeking: false, standbyStart: 0, openStart: 0 });
  const [phase, setPhase] = useState<Phase>("loading");
  const [stage, setStage] = useState("");
  const [cardKey, setCardKey] = useState(0);
  const [simFold, setSimFold] = useState(false);
  /** dev: the black half-panels sliding away while the simulated phone opens (0 = off) */
  const [doorGap, setDoorGap] = useState(0);
  const audio = useAudioPlayer(SFX);

  /** Play the film from `offset` seconds, audio in step. */
  const startFilm = useCallback(
    (offset: number) => {
      // seekTo is asynchronous: until the audio reports it, don't sync the picture to it
      clock.current.start = performance.now() / 1000 - offset;
      clock.current.seeking = true;
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

  /** From the top: the intro while folded, the film straight away when open. */
  const begin = useCallback(() => {
    const { width, height } = size.current;
    if (isFolded(width, height)) startStandby();
    else startFilm(0);
  }, [startFilm, startStandby]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    size.current = { width, height };
    player.current?.setSize(width, height, PixelRatio.get());
    // the phone opened while the intro was waiting: pull back into the film
    if (mode.current === "standby" && !isFolded(width, height)) {
      clock.current.openStart = performance.now() / 1000;
      mode.current = "opening";
      setPhase("opening");
    }
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
          if (c.seeking && Math.abs(audio.currentTime - t) < 1) c.seeking = false;
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

  useEffect(() => {
    if (phase !== "card") return;
    const id = setTimeout(() => setPhase("done"), END_CARD_SECONDS * 1000);
    return () => clearTimeout(id);
  }, [phase]);

  // ---- dev: fold / unfold the simulator (it has one display): `__battle.fold()`, `__battle.unfold()`
  const doors = useSharedValue(0);
  useEffect(() => {
    if (!__DEV__) return;
    (globalThis as { __battle?: object }).__battle = {
      fold: () => {
        doors.value = 0;
        setSimFold(true);
        startStandby();
      },
      unfold: () => {
        // the panels slide open like the halves of the phone, over the full-size picture
        setDoorGap(size.current.height * SIM_FOLDED_ASPECT);
        doors.value = 0;
        doors.value = withTiming(1, { duration: 450, easing: Easing.out(Easing.cubic) }, (done) => {
          if (done) runOnJS(setDoorGap)(0);
        });
        setSimFold(false);
      },
      player: () => player.current,
    };
  }, [doors, startStandby]);
  const doorLeft = useAnimatedStyle(() => ({ transform: [{ translateX: `${-doors.value * 100}%` }] }));
  const doorRight = useAnimatedStyle(() => ({ transform: [{ translateX: `${doors.value * 100}%` }] }));

  return (
    <View style={styles.root}>
      <View style={simFold ? styles.simFolded : styles.fill} onLayout={onLayout}>
        <Canvas ref={ref} style={StyleSheet.absoluteFill} />
      </View>
      {__DEV__ && doorGap > 0 && (
        <View style={[StyleSheet.absoluteFill, styles.doors, { pointerEvents: "none" }]}>
          <Animated.View style={[styles.door, doorLeft]} />
          <View style={{ width: doorGap }} />
          <Animated.View style={[styles.door, doorRight]} />
        </View>
      )}
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
      {phase === "done" && <Pressable style={StyleSheet.absoluteFill} onPress={begin} accessibilityLabel="Replay" />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000", alignItems: "center" },
  fill: { ...StyleSheet.absoluteFill },
  simFolded: { height: "100%", aspectRatio: SIM_FOLDED_ASPECT },
  doors: { flexDirection: "row" },
  door: { flex: 1, backgroundColor: "#000" },
  center: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", gap: 12 },
  cover: { backgroundColor: "#000" },
  hint: { color: "#F5F3E8", opacity: 0.6, fontSize: 13, letterSpacing: 1 },
});
