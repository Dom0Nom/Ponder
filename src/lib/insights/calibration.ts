import type { AttemptRow } from "../types";

export interface TopicCalibration {
  topicKey: string;
  answered: number;
  sureN: number;
  sureRight: number;
  /** share of "Sure" answers that were right, or null without any */
  sureAccuracy: number | null;
  overconfident: boolean;
}

export const OVERCONFIDENT_BELOW = 0.7;
export const MIN_SURE = 3;

type Row = Pick<AttemptRow, "topicKey" | "correct" | "confidence">;

export function calibration(attempts: Row[]): TopicCalibration[] {
  const by = new Map<string, { answered: number; sureN: number; sureRight: number }>();
  for (const a of attempts) {
    if (a.confidence == null) continue;
    const e = by.get(a.topicKey) ?? { answered: 0, sureN: 0, sureRight: 0 };
    e.answered++;
    if (a.confidence === 2) {
      e.sureN++;
      if (a.correct) e.sureRight++;
    }
    by.set(a.topicKey, e);
  }
  return [...by]
    .map(([topicKey, e]) => {
      const sureAccuracy = e.sureN ? e.sureRight / e.sureN : null;
      return { topicKey, ...e, sureAccuracy, overconfident: e.sureN >= MIN_SURE && sureAccuracy! < OVERCONFIDENT_BELOW };
    })
    .sort((a, b) => Number(b.overconfident) - Number(a.overconfident) || (a.sureAccuracy ?? 2) - (b.sureAccuracy ?? 2));
}

export const overconfidentTopics = (attempts: Row[]) =>
  calibration(attempts)
    .filter((c) => c.overconfident)
    .map((c) => c.topicKey);
