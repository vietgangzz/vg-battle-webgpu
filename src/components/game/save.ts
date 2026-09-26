import { File, Paths } from "expo-file-system";
import { useCallback, useState } from "react";

import type { Results } from "@/battle/game/adventure";
import { STAGES } from "@/battle/game/stage";

export interface Settings {
  sfx: boolean;
  haptics: boolean;
  /** control size: 0.85 / 1 / 1.15 */
  buttons: number;
}

export interface Save {
  /** stages 0 .. unlocked are open */
  unlocked: number;
  best: Record<string, Results["rank"]>;
  settings: Settings;
  /** SORA's level in the valley and her experience toward the next */
  hero: { level: number; xp: number };
}

const RANKS = ["C", "B", "A", "S"];
const EMPTY: Save = { unlocked: 0, best: {}, settings: { sfx: true, haptics: true, buttons: 1 }, hero: { level: 1, xp: 0 } };

const file = () => new File(Paths.document, "little-giant-save.json");

function load(): Save {
  try {
    const f = file();
    if (!f.exists) return EMPTY;
    const s = JSON.parse(f.textSync()) as Partial<Save>;
    return { ...EMPTY, ...s, settings: { ...EMPTY.settings, ...s.settings }, hero: { ...EMPTY.hero, ...s.hero } };
  } catch {
    return EMPTY;
  }
}

function store(s: Save) {
  try {
    const f = file();
    if (!f.exists) f.create();
    f.write(JSON.stringify(s));
  } catch {
    // progress simply won't persist this session
  }
}

/** Progress and settings, kept in the app's documents. */
export function useSave() {
  const [save, setSave] = useState<Save>(load);

  const update = useCallback((fn: (s: Save) => Save) => {
    setSave((prev) => {
      const next = fn(prev);
      store(next);
      return next;
    });
  }, []);

  /** A stage won: keep its best rank, open the next. */
  const record = useCallback(
    (r: Results) =>
      update((s) => {
        const id = STAGES[r.stage].id;
        const prev = s.best[id];
        const best = !prev || RANKS.indexOf(r.rank) > RANKS.indexOf(prev) ? r.rank : prev;
        return { ...s, best: { ...s.best, [id]: best }, unlocked: Math.max(s.unlocked, Math.min(r.stage + 1, STAGES.length - 1)) };
      }),
    [update],
  );

  const setSettings = useCallback((p: Partial<Settings>) => update((s) => ({ ...s, settings: { ...s.settings, ...p } })), [update]);

  /** SORA's level and experience (kept as she earns it). */
  const setHero = useCallback((level: number, xp: number) => update((s) => ({ ...s, hero: { level, xp } })), [update]);

  return { save, record, setSettings, setHero };
}
