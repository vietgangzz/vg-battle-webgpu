/**
 * SORA's skills in the valley: every level brings a point (and every fifth
 * level one more) to spend on six skills, five ranks each. Points are never
 * stored, only the ranks: what is free is what her level has earned less
 * what she has spent, so an older save simply finds its points waiting.
 */
export type SkillId = "blade" | "streak" | "bolt" | "lotus" | "vitality" | "wind";
export type Ranks = Record<SkillId, number>;

export const RANK_MAX = 5;
export const NO_RANKS: Ranks = { blade: 0, streak: 0, bolt: 0, lotus: 0, vitality: 0, wind: 0 };

export interface SkillDef {
  id: SkillId;
  name: string;
  /** what it is, in a few words */
  role: string;
  /** what `rank` ranks give */
  effect: (rank: number) => string;
}

export const SKILLS: SkillDef[] = [
  { id: "blade", name: "Blade Dance", role: "the slash combo", effect: (r) => `+${r * 8}% damage` },
  { id: "streak", name: "Streak", role: "the dash strike", effect: (r) => `+${r * 12}% damage · −${r * 6}% cooldown` },
  { id: "bolt", name: "Kiếm Khí", role: "the thrown sword light", effect: (r) => `+${r * 12}% damage · −${r * 5}% cooldown` },
  { id: "lotus", name: "Liên Hoa", role: "the ultimate", effect: (r) => `+${r * 12}% damage · +${r * 8}% energy` },
  { id: "vitality", name: "Vitality", role: "health", effect: (r) => `+${r * 12} max HP` },
  { id: "wind", name: "Wind Step", role: "the sprint", effect: (r) => `−${r * 10}% stamina use · +${r * 10}% recovery` },
];

/** points a level has earned: one a level, one more every fifth */
export const pointsEarned = (level: number) => Math.max(0, level - 1) + Math.floor(level / 5);

export const pointsSpent = (r: Ranks) => r.blade + r.streak + r.bolt + r.lotus + r.vitality + r.wind;

export const pointsFree = (level: number, r: Ranks) => Math.max(0, pointsEarned(level) - pointsSpent(r));

/** A save's ranks made whole and in range. */
export function cleanRanks(r: Partial<Ranks> | undefined): Ranks {
  const out = { ...NO_RANKS };
  for (const k of Object.keys(out) as SkillId[]) out[k] = Math.max(0, Math.min(RANK_MAX, Math.floor(r?.[k] ?? 0)));
  return out;
}

/** What the ranks do to the fight and to her. */
export function boosts(r: Ranks) {
  return {
    blade: 1 + 0.08 * r.blade,
    streak: 1 + 0.12 * r.streak,
    bolt: 1 + 0.12 * r.bolt,
    lotus: 1 + 0.12 * r.lotus,
    skillCooldown: 1 - 0.06 * r.streak,
    shootCooldown: 1 - 0.05 * r.bolt,
    energy: 1 + 0.08 * r.lotus,
    hp: 12 * r.vitality,
    drain: 1 - 0.1 * r.wind,
    regen: 1 + 0.1 * r.wind,
  };
}

export type Boosts = ReturnType<typeof boosts>;
