/**
 * Rasch (1PL) model with an Elo-style online update. θ = learner ability, b = item difficulty,
 * both on the logit scale. Items are picked so the learner succeeds about 70% of the time.
 */
export const TARGET_SUCCESS = 0.7;
export const LEVEL_STEP = 1.2;

export const pCorrect = (theta: number, b: number) => 1 / (1 + Math.exp(-(theta - b)));

/** Large steps while little is known, smaller ones as answers accumulate. */
export const stepSize = (n: number) => Math.max(0.2, 1.2 / (1 + 0.25 * n));

export function updateTheta(theta: number, b: number, correct: boolean, n: number): number {
  const next = theta + stepSize(n) * ((correct ? 1 : 0) - pCorrect(theta, b));
  return Math.max(-4, Math.min(4, next));
}

/** Difficulty where P(correct) = TARGET_SUCCESS. */
export const targetDifficulty = (theta: number) => theta - Math.log(TARGET_SUCCESS / (1 - TARGET_SUCCESS));

/** 1 (very easy) … 5 (very hard), the scale the model writes problems on. */
export const levelFor = (b: number) => Math.max(1, Math.min(5, Math.round(b / LEVEL_STEP + 3)));
export const difficultyFor = (level: number) => (level - 3) * LEVEL_STEP;

export const LEVEL_WORDS = [
  "",
  "very easy (one step, basic recall)",
  "easy (one or two steps)",
  "medium (two or three steps)",
  "hard (three or four steps, or a common trap)",
  "very hard (exam-level, needs real understanding, still at most five steps)",
];

/** Same thresholds as placement levels, so practice keeps the learning plan current. */
export function levelFromTheta(theta: number, n: number): "unknown" | "weak" | "ok" | "strong" {
  if (n < 3) return "unknown";
  if (theta < -0.5) return "weak";
  if (theta < 1) return "ok";
  return "strong";
}

/** 0–100 for display. */
export const skillPercent = (theta: number) => Math.round(pCorrect(theta, 0) * 100);
