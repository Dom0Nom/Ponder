import type { ErrorType } from "../types";

export type PatternId = "misread" | "slip" | "concept" | "time" | "trap" | "other";
export const PATTERN_ORDER: PatternId[] = ["concept", "misread", "slip", "trap", "time", "other"];

const OF_ERROR: Record<ErrorType, PatternId> = {
  concept: "concept",
  procedure: "concept",
  vocabulary: "concept",
  misread: "misread",
  arithmetic: "slip",
  sign: "slip",
  units: "slip",
  careless: "slip",
  other: "other",
};

export interface Wrong {
  id: string;
  question: string;
  given: string | null;
  correct: string;
  topic: string | null;
  errorType: ErrorType | null;
}

export interface Pattern {
  id: PatternId;
  count: number;
  topics: string[];
  examples: Wrong[];
}

function topTopics(list: Wrong[]): string[] {
  const n = new Map<string, number>();
  for (const w of list) if (w.topic) n.set(w.topic, (n.get(w.topic) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t);
}

/** Groups tagged wrong answers by kind of error, largest group first. Untagged answers are left out. */
export function groupPatterns(wrong: Wrong[], maxExamples = 3): Pattern[] {
  const by = new Map<PatternId, Wrong[]>();
  for (const w of wrong) {
    const id = w.errorType ? OF_ERROR[w.errorType] : null;
    if (id) by.set(id, [...(by.get(id) ?? []), w]);
  }
  return [...by]
    .map(([id, list]) => ({ id, count: list.length, topics: topTopics(list), examples: list.slice(0, maxExamples) }))
    .sort((a, b) => b.count - a.count || PATTERN_ORDER.indexOf(a.id) - PATTERN_ORDER.indexOf(b.id));
}

export interface ExamItem {
  id: string;
  question: string;
  options: string[];
  answer: number;
  given: number | null;
  topic: string;
  topicWeak: boolean;
}

/**
 * Patterns from one exam without model tagging: unanswered questions are time, wrong answers in a
 * weak topic are a missing concept, the rest are likely traps.
 */
export function examPatterns(items: ExamItem[], maxExamples = 3): Pattern[] {
  const wrong = items.filter((i) => i.given !== i.answer);
  const toWrong = (i: ExamItem): Wrong => ({
    id: i.id,
    question: i.question,
    given: i.given != null && i.given >= 0 ? i.options[i.given] : null,
    correct: i.options[i.answer],
    topic: i.topic,
    errorType: null,
  });
  const groups: [PatternId, ExamItem[]][] = [
    ["time", wrong.filter((i) => i.given == null || i.given < 0)],
    ["concept", wrong.filter((i) => i.given != null && i.given >= 0 && i.topicWeak)],
    ["trap", wrong.filter((i) => i.given != null && i.given >= 0 && !i.topicWeak)],
  ];
  return groups
    .filter(([, list]) => list.length)
    .map(([id, list]) => {
      const w = list.map(toWrong);
      return { id, count: w.length, topics: topTopics(w), examples: w.slice(0, maxExamples) };
    })
    .sort((a, b) => b.count - a.count || PATTERN_ORDER.indexOf(a.id) - PATTERN_ORDER.indexOf(b.id));
}
