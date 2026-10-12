import { extractJson } from "../chat/json";

export interface FeynmanMistake {
  said: string;
  correct: string;
}

export interface FeynmanFeedback {
  /** 1–5: how well a newcomer would understand the topic from this explanation alone */
  clarity: number;
  verdict: string;
  strengths: string[];
  gaps: string[];
  mistakes: FeynmanMistake[];
  jargon: string[];
  question: string;
}

export interface FeynmanTurn {
  explanation: string;
  /** the learner's answer to the previous turn's question, if any */
  answer?: string;
  feedback: FeynmanFeedback;
}

export interface FeynmanInput {
  topic: string;
  explanation: string;
  passages: { source: string; text: string }[];
  /** earlier rounds on the same topic, oldest first */
  history?: FeynmanTurn[];
  /** the learner's answer to the last question */
  answer?: string;
}

const MAX_HISTORY = 3;

/** First line is stable: the mock backend and the eval harness match it. */
export function feynmanPrompt(f: FeynmanInput): string {
  const material = f.passages.length
    ? `MATERIAL (the learner's own sources)\n"""\n${f.passages.map((p) => `[${p.source}] ${p.text}`).join("\n\n")}\n"""`
    : "There is no study material for this topic; judge against well-established textbook knowledge and say less rather than guess.";
  const earlier = (f.history ?? []).slice(-MAX_HISTORY).map(
    (t, i) =>
      `Round ${i + 1}\nExplanation: ${t.explanation}${t.answer ? `\nAnswer to the question before it: ${t.answer}` : ""}\nYour question then: ${t.feedback.question}`,
  );
  return [
    `A learner explains "${f.topic.trim()}" in their own words, Feynman style: as if teaching someone new to it.`,
    material,
    earlier.length ? `EARLIER ROUNDS\n"""\n${earlier.join("\n\n")}\n"""` : "",
    `EXPLANATION\n"""\n${f.explanation.trim()}\n"""`,
    f.answer?.trim() ? `THEIR ANSWER TO YOUR LAST QUESTION\n"""\n${f.answer.trim()}\n"""` : "",
    "Judge the explanation the way a good teacher would, against the material:",
    "- covered: first list every idea from the material the explanation already states, even in other words or in passing (short phrases).",
    "- clarity: 1–5, how well someone new to the topic would understand it from this explanation alone (5 = clear, correct and complete for its level).",
    "- verdict: one encouraging, honest sentence to the learner (\"you\").",
    "- strengths: 1–3 specific things they explained well (quote or name them).",
    "- gaps: 0–4 important ideas from the material they left out or only named without explaining. Each one short sentence. Only ideas that matter for understanding the topic, and never an idea that is in covered.",
    "- mistakes: statements that contradict the material, as {\"said\": their words, \"correct\": the right statement}. Never invent a mistake; an empty list is fine.",
    "- jargon: 0–4 technical terms they used without explaining them, exactly as they wrote them. A term counts as explained if they say what it is or what it does.",
    "- question: one short question a curious newcomer would ask next, aimed at the weakest spot. If they answered your last question, build on their answer.",
    "Write in the language of the explanation. No Markdown, no citations.",
    'Return JSON only:\n{"covered": ["…"], "clarity": 3, "verdict": "…", "strengths": ["…"], "gaps": ["…"], "mistakes": [{"said": "…", "correct": "…"}], "jargon": ["…"], "question": "…"}',
  ]
    .filter(Boolean)
    .join("\n\n");
}

const strs = (v: unknown, max: number) =>
  (Array.isArray(v) ? v : [])
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean)
    .slice(0, max);

export function parseFeynman(text: string): FeynmanFeedback | null {
  const raw = extractJson<Record<string, unknown>>(text);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const clarity = Math.round(Number(raw.clarity ?? raw.score));
  const verdict = typeof raw.verdict === "string" ? raw.verdict.trim() : "";
  const question = typeof raw.question === "string" ? raw.question.trim() : "";
  if (!Number.isFinite(clarity) || !verdict) return null;
  const mistakes = (Array.isArray(raw.mistakes) ? raw.mistakes : [])
    .map((m) => {
      const o = (m ?? {}) as Record<string, unknown>;
      const said = typeof o.said === "string" ? o.said.trim() : "";
      const correct = typeof o.correct === "string" ? o.correct.trim() : "";
      return said && correct ? { said, correct } : null;
    })
    .filter((m): m is FeynmanMistake => !!m)
    .slice(0, 5);
  return {
    clarity: Math.min(5, Math.max(1, clarity)),
    verdict,
    strengths: strs(raw.strengths, 3),
    gaps: strs(raw.gaps, 4),
    mistakes,
    jargon: strs(raw.jargon, 4),
    question,
  };
}

/** Words the learner wrote, for a rough "too short to judge" check before spending a model call. */
export const wordCount = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
export const MIN_WORDS = 12;
