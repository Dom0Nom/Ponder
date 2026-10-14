import { skillPercent } from "./irt";

export const MIXED_KEY = "mixed";

export interface MixCandidate {
  key: string;
  weight: number;
}

/** Weak, unpractised and due topics weigh more; every topic keeps a base chance. */
export function mixWeight(ability: { theta: number; n: number } | undefined, due: boolean): number {
  const weak = ability && ability.n > 0 ? 1 - skillPercent(ability.theta) / 100 : 0.6;
  return 1 + weak * 2 + (due ? 2 : 0);
}

/** Picks a topic by weight; never the previous one unless it is the only candidate. */
export function pickTopic(candidates: MixCandidate[], last: string | null, rng: () => number = Math.random): string | null {
  if (!candidates.length) return null;
  const pool = candidates.length > 1 ? candidates.filter((c) => c.key !== last) : candidates;
  const total = pool.reduce((n, c) => n + c.weight, 0);
  let r = rng() * total;
  for (const c of pool) {
    r -= c.weight;
    if (r < 0) return c.key;
  }
  return pool[pool.length - 1].key;
}
