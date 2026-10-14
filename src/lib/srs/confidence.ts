import type { Confidence } from "../types";

export const CONFIDENCE_KEYS: Record<string, Confidence> = { g: 0, u: 1, s: 2 };

/** A right answer that was a guess is weak evidence of memory: cap the rating at Hard. */
export function confidenceRating(rating: number, confidence: Confidence | null): number {
  if (confidence === 0 && rating >= 3) return 2;
  return rating;
}

/** A wrong "Sure" comes back within the session instead of waiting out the lapse interval. */
export function confidenceDue(due: number, rating: number, confidence: Confidence | null, now: number): number {
  return confidence === 2 && rating === 1 ? Math.min(due, now + 60_000) : due;
}
