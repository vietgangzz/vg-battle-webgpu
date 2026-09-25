import { setAudioModeAsync, useAudioPlayer } from "expo-audio";
import { useKeepAwake } from "expo-keep-awake";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, type LayoutChangeEvent, PixelRatio, Pressable, StyleSheet, Text, View } from "react-native";
import { Canvas, type CanvasRef } from "react-native-webgpu";

import { FilmPlayer } from "@/battle/runtime/player";
import { EndCard, END_CARD_SECONDS } from "@/components/end-card";

const SFX = require("../../assets/film/sfx.m4a");
/** audio and picture may drift this far apart before the picture snaps to the audio */
const RESYNC = 0.06;

type Phase = "loading" | "playing" | "card" | "done" | "error";

/**
 * The whole showcase on one full-screen canvas: the real-time film, its
 * soundtrack as the master clock, then the vgang end card. Tap to replay.
 */
export function BattleView() {
  useKeepAwake();
  const ref = useRef<CanvasRef>(null);
  const player = useRef<FilmPlayer | null>(null);
  const size = useRef({ width: 0, height: 0 });
  const clock = useRef({ start: 0, running: false });
  const [phase, setPhase] = useState<Phase>("loading");
  const [stage, setStage] = useState("");
  const [cardKey, setCardKey] = useState(0);
  const audio = useAudioPlayer(SFX);

  const start = useCallback(() => {
    clock.current = { start: performance.now() / 1000, running: true };
    audio.seekTo(0);
    audio.play();
    setCardKey((k) => k + 1);
    setPhase("playing");
  }, [audio]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    size.current = { width, height };
    player.current?.setSize(width, height, PixelRatio.get());
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
          const c = clock.current;
          if (!c.running) return;
          let t = performance.now() / 1000 - c.start;
          // the soundtrack is the master clock: pull the picture back onto it when they drift
          if (audio.playing && Math.abs(audio.currentTime - t) > RESYNC) {
            c.start = performance.now() / 1000 - audio.currentTime;
            t = audio.currentTime;
          }
          p.render(Math.min(t, p.duration));
          if (t >= p.duration) {
            c.running = false;
            setPhase("card");
          }
        });
        start();
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
    // the player is created once per mount; `start` and `audio` are stable for its lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase !== "card") return;
    const id = setTimeout(() => setPhase("done"), END_CARD_SECONDS * 1000);
    return () => clearTimeout(id);
  }, [phase]);

  return (
    <View style={styles.root} onLayout={onLayout}>
      <Canvas ref={ref} style={StyleSheet.absoluteFill} />
      {(phase === "card" || phase === "done") && <EndCard key={cardKey} />}
      {phase === "loading" && (
        <View style={[styles.center, { pointerEvents: "none" }]}>
          <ActivityIndicator color="#D5F64B" />
          <Text style={styles.hint}>{stage}</Text>
        </View>
      )}
      {phase === "error" && (
        <View style={styles.center}>
          <Text style={styles.hint}>WebGPU is not available on this device.</Text>
        </View>
      )}
      {phase === "done" && <Pressable style={StyleSheet.absoluteFill} onPress={start} accessibilityLabel="Replay" />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  center: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", gap: 12 },
  hint: { color: "#F5F3E8", opacity: 0.6, fontSize: 13, letterSpacing: 1 },
});
