export const RUNGS = 4;
export type Rung = 0 | 1 | 2 | 3;

export interface LadderProblem {
  question: string;
  /** the full worked solution, one short step per entry */
  steps: string[];
  answer: string;
}

/** Worked, last steps blank, most steps blank, cold. A correct answer moves up; a miss steps down once. */
export function nextRung(rung: Rung, correct: boolean): Rung {
  return Math.max(0, Math.min(RUNGS - 1, rung + (correct ? 1 : -1))) as Rung;
}

/** Indices of the steps the learner fills in at this rung. */
export function blanksFor(rung: Rung, stepCount: number): number[] {
  const all = Array.from({ length: stepCount }, (_, i) => i);
  if (rung === 0 || stepCount === 0) return [];
  if (rung === 1) return all.slice(Math.max(1, stepCount - Math.max(1, Math.floor(stepCount / 3))));
  if (rung === 2) return all.slice(stepCount > 1 ? 1 : 0);
  return all;
}

const norm = (t: string) =>
  t
    .toLowerCase()
    .replace(/\$/g, "")
    .replace(/\\cdot|\\times|×|·/g, "*")
    .replace(/[\s,]+/g, "")
    .replace(/\.$/, "");

export const sameStep = (expected: string, given: string) => norm(expected) === norm(given);

export function blankOutcome(results: boolean[]): boolean {
  return results.length > 0 && results.every(Boolean);
}
