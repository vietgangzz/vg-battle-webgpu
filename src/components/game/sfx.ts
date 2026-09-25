import { type AudioPlayer, createAudioPlayer } from "expo-audio";
import { useEffect, useMemo } from "react";

import type { SoundName } from "@/battle/game/adventure";

// made with the film's own sound design (tools/make-sfx.py)
const SOURCES: Record<SoundName, number> = {
  swing: require("../../../assets/sfx/swing.m4a"),
  hit: require("../../../assets/sfx/hit.m4a"),
  heavy: require("../../../assets/sfx/heavy.m4a"),
  block: require("../../../assets/sfx/block.m4a"),
  clash: require("../../../assets/sfx/clash.m4a"),
  slam: require("../../../assets/sfx/slam.m4a"),
  wave: require("../../../assets/sfx/wave.m4a"),
  dash: require("../../../assets/sfx/dash.m4a"),
  down: require("../../../assets/sfx/down.m4a"),
};

/** voices per sound, so quick repeats overlap instead of cutting each other off */
const VOICES = 3;

interface Voice {
  player: AudioPlayer;
  busy: boolean;
}

/**
 * One-shot effects with no seek on the hot path: each voice rewinds itself
 * when it finishes, so the next play starts at once.
 */
export function useSfx() {
  const bank = useMemo(() => {
    const voices = new Map<SoundName, Voice[]>();
    for (const [name, src] of Object.entries(SOURCES) as [SoundName, number][]) {
      voices.set(
        name,
        Array.from({ length: VOICES }, () => {
          const v: Voice = { player: createAudioPlayer(src), busy: false };
          v.player.addListener("playbackStatusUpdate", (s) => {
            if (s.didJustFinish) {
              v.busy = false;
              void v.player.seekTo(0);
            }
          });
          return v;
        }),
      );
    }
    return voices;
  }, []);

  useEffect(
    () => () => {
      for (const vs of bank.values()) for (const v of vs) v.player.remove();
    },
    [bank],
  );

  return useMemo(
    () => ({
      play(name: SoundName) {
        const vs = bank.get(name);
        if (!vs) return;
        // a free voice, else steal the oldest
        const v = vs.find((x) => !x.busy) ?? vs[0];
        if (v.busy) {
          void v.player.seekTo(0);
        }
        v.busy = true;
        v.player.play();
        vs.push(vs.splice(vs.indexOf(v), 1)[0]);
      },
    }),
    [bank],
  );
}
