import { scaledScore, type ExamFormat, type ExamTier } from "./formats";

export interface ScoreBand {
  low: number;
  high: number;
  tier: ExamTier | null;
  /** the range crosses a tier boundary */
  straddles: boolean;
}

const Z = 1.28;

export function tierFor(format: ExamFormat, scaled: number): ExamTier | null {
  let hit: ExamTier | null = null;
  for (const t of format.tiers ?? []) if (scaled >= t.min) hit = t;
  return hit;
}

/**
 * Range around the scaled score. The standard error of the share shrinks with the number of
 * questions and with the number of exam attempts the estimate rests on (this one counts).
 */
export function scoreBand(format: ExamFormat, share: number, questions: number, attempts = 1): ScoreBand | null {
  const mid = scaledScore(format, share);
  if (!format.scale || mid == null || questions <= 0) return null;
  const p = Math.min(1, Math.max(0, share));
  const se = Math.sqrt(Math.max(p * (1 - p), 0.05) / questions) / Math.sqrt(Math.max(attempts, 1));
  const low = Math.min(mid, scaledScore(format, p - Z * se)!);
  const high = Math.max(mid, scaledScore(format, p + Z * se)!);
  return { low, high, tier: tierFor(format, mid), straddles: tierFor(format, low)?.id !== tierFor(format, high)?.id };
}
