import { generateText } from "ai";
import { extractJson } from "../chat/json";
import type { ResolvedModel } from "../chat/llm";
import type { ErrorType, PracticeItem, PracticeKind } from "../types";
import { difficultyFor, LEVEL_WORDS, levelFor } from "./irt";
import { numbersMatch, parseNumber } from "./grade";
import { sameStep, type LadderProblem } from "./ladder";
import { languageInstruction } from "../i18n/language";
import { s } from "../strings";

export interface TopicSpec {
  key: string;
  title: string;
  description: string;
}

export type NewItem = Omit<PracticeItem, "id" | "createdAt">;

const ask = async (llm: ResolvedModel, prompt: string, signal?: AbortSignal) =>
  (await generateText({ model: llm.model, prompt, abortSignal: signal, ...llm.options({ thinking: false }) })).text;

export function parseProblem(text: string, topicKey: string, level: number, parentId: string | null = null): NewItem {
  const o = extractJson<Record<string, unknown>>(text);
  if (!o || typeof o !== "object") throw new Error(s.failures.theModelDidnTReturn6);
  const kind = (["mcq", "numeric", "short"].includes(String(o.kind)) ? o.kind : "short") as PracticeKind;
  const question = String(o.question ?? "").trim();
  const solution = String(o.solution ?? "").trim();
  let answer = String(o.answer ?? "").trim();
  let options: string[] | null = null;
  if (kind === "mcq") {
    options = Array.isArray(o.options) ? o.options.map(String).map((x) => x.trim()).filter(Boolean) : [];
    const idx = Number(o.answer);
    if (options.length < 2 || new Set(options).size !== options.length) throw new Error(s.failures.theModelSOptionsWere);
    if (Number.isInteger(idx) && idx >= 0 && idx < options.length) answer = String(idx);
    else {
      const byText = options.indexOf(answer);
      if (byText < 0) throw new Error(s.failures.theModelSAnswerWasn);
      answer = String(byText);
    }
  }
  if (kind === "numeric" && parseNumber(answer) == null) throw new Error(s.failures.theModelSNumericAnswer);
  if (!question || !answer || !solution) throw new Error(s.failures.theModelSProblemWas);
  const hint = String(o.hint ?? "").trim() || null;
  const lvl = Number(o.level);
  return {
    topicKey,
    kind,
    question,
    options,
    answer,
    solution,
    difficulty: difficultyFor(Number.isInteger(lvl) && lvl >= 1 && lvl <= 5 ? lvl : level),
    parentId,
    hint,
  };
}

const FORMAT =
  'Return JSON only: {"kind": "numeric" | "mcq" | "short", "question": "…", "options": ["…"] (mcq only, 4 options), "answer": "number for numeric, option index for mcq, short model answer for short", "solution": "worked solution in Markdown, LaTeX in $…$", "hint": "one sentence that nudges toward the method without giving the answer", "level": 1-5}';

export async function generateProblem(
  llm: ResolvedModel,
  opts: { topic: TopicSpec; level: number; context?: string; avoid?: string[]; language?: string | null; signal?: AbortSignal },
): Promise<NewItem> {
  const prompt = [
    `Write ONE practice problem on "${opts.topic.title}" (${opts.topic.description}) at difficulty ${opts.level}/5: ${LEVEL_WORDS[opts.level]}.`,
    "Prefer a numeric answer when the topic allows it, multiple choice for concepts, short answer otherwise. The problem must have one clearly correct answer and must not need a picture.",
    "Ask exactly one question. Harder means deeper reasoning, not more text, extra conditions or several sub-questions. Keep it under 80 words.",
    opts.context ? `Base it on this material:\n"""\n${opts.context.slice(0, 6000)}\n"""` : "",
    opts.avoid?.length ? `Make it different from these recent problems:\n${opts.avoid.slice(0, 10).map((q) => `- ${q}`).join("\n")}` : "",
    languageInstruction(opts.language),
    FORMAT,
  ]
    .filter(Boolean)
    .join("\n\n");
  return checked(llm, prompt, (text) => parseProblem(text, opts.topic.key, opts.level), opts.signal);
}

export type VariationMode = "same" | "easier" | "harder";

/** "More like this": same skill and structure, new numbers or context. */
export async function generateVariation(llm: ResolvedModel, item: PracticeItem, mode: VariationMode, signal?: AbortSignal): Promise<NewItem> {
  const level = Math.max(1, Math.min(5, levelFor(item.difficulty) + (mode === "harder" ? 1 : mode === "easier" ? -1 : 0)));
  const prompt = [
    `Here is a practice problem:\n"""\n${item.question}\n"""\nIts solution:\n"""\n${item.solution}\n"""`,
    `Write ONE new problem that practises exactly the same skill${mode === "same" ? " at the same difficulty" : mode === "harder" ? ", one step harder" : ", one step easier"} (difficulty ${level}/5), with different numbers or context. Keep the same answer type (${item.kind}) and the same language.`,
    FORMAT,
  ].join("\n\n");
  return checked(llm, prompt, (text) => parseProblem(text, item.topicKey, level, item.id), signal);
}

/** Last `{"answer": …}` in a worked solution; earlier braces may be LaTeX. */
export function parseSolvedAnswer(text: string): string | null {
  const all = [...text.replace(/<think>[\s\S]*?<\/think>/g, "").matchAll(/\{\s*"answer"\s*:\s*("(?:[^"\\]|\\.)*"|-?[\d.,]+)\s*\}/g)];
  const last = all.at(-1)?.[1];
  if (last == null) return null;
  try {
    return String(last.startsWith('"') ? JSON.parse(last) : last).trim();
  } catch {
    return null;
  }
}

export function answersAgree(item: Pick<PracticeItem, "kind" | "answer" | "options">, solved: string): boolean {
  if (item.kind === "numeric") {
    const a = parseNumber(item.answer);
    const b = parseNumber(solved);
    return a != null && b != null && numbersMatch(a, b);
  }
  if (item.kind === "mcq") {
    const idx = Number(solved);
    if (Number.isInteger(idx)) return idx === Number(item.answer);
    return solved.toLowerCase() === item.options?.[Number(item.answer)]?.toLowerCase();
  }
  return true;
}

async function solveIndependently(llm: ResolvedModel, item: NewItem, signal?: AbortSignal): Promise<string | null> {
  const opts = item.kind === "mcq" ? `\nOptions:\n${item.options!.map((o, i) => `${i}: ${o}`).join("\n")}` : "";
  const want = item.kind === "mcq" ? "the index of the correct option" : "the final number only, no units";
  const text = await ask(
    llm,
    `Solve this problem carefully, step by step. Check each calculation.\n"""\n${item.question}${opts}\n"""\nEnd with one line of JSON: {"answer": ${want}}`,
    signal,
  );
  return parseSolvedAnswer(text);
}

/** Generated answers are wrong often enough that each problem is re-solved without its answer; disagreements are regenerated. */
async function checked(llm: ResolvedModel, prompt: string, parse: (text: string) => NewItem, signal?: AbortSignal): Promise<NewItem> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const item = parse(await ask(llm, prompt, signal));
      if (item.kind === "short") return item;
      const solved = await solveIndependently(llm, item, signal);
      if (solved == null || answersAgree(item, solved)) return item;
      lastError = new Error(s.failures.theModelSAnswerDidn);
    } catch (e) {
      if (signal?.aborted) throw e;
      lastError = e;
    }
  }
  throw lastError;
}

export interface Grade {
  correct: boolean;
  feedback: string | null;
}

export async function gradeResponse(llm: ResolvedModel, item: PracticeItem, response: string, signal?: AbortSignal): Promise<Grade> {
  if (item.kind === "mcq") return { correct: response === item.answer, feedback: null };
  if (item.kind === "numeric") {
    const given = parseNumber(response);
    const expected = parseNumber(item.answer);
    if (given == null) return { correct: false, feedback: "That isn't a number I can read. Write just the number, like 12, 3/4 or 2.5." };
    return { correct: expected != null && numbersMatch(given, expected), feedback: null };
  }
  const text = await ask(
    llm,
    [
      `Grade a learner's short answer. Be fair: accept equivalent wording and spelling slips, reject wrong or incomplete facts.`,
      `Question: ${item.question}`,
      `Model answer: ${item.answer}`,
      `Learner's answer: ${response}`,
      "Feedback: at most two plain sentences to the learner, in the language of the question. If wrong, say what is missing or wrong; no praise phrases.",
      'Return JSON only: {"correct": true|false, "feedback": "…"}',
    ].join("\n"),
    signal,
  );
  const o = extractJson<{ correct?: unknown; feedback?: unknown }>(text);
  if (!o || typeof o.correct !== "boolean") throw new Error(s.failures.theAnswerCouldnTBe);
  return { correct: o.correct, feedback: typeof o.feedback === "string" ? o.feedback : null };
}

export const ERROR_TYPES: ErrorType[] = ["concept", "procedure", "arithmetic", "sign", "misread", "units", "careless", "vocabulary", "other"];

export async function classifyError(llm: ResolvedModel, item: { question: string; answer: string; solution?: string }, response: string, signal?: AbortSignal): Promise<{ errorType: ErrorType; note: string | null }> {
  const text = await ask(
    llm,
    [
      "A learner got a problem wrong. Classify the most likely mistake as exactly one of:",
      "concept (misunderstood the idea), procedure (wrong method or steps), arithmetic (calculation slip), sign (sign/negative error), misread (misread the question), units (unit or conversion error), careless (copying/rounding slip), vocabulary (didn't know a term), other.",
      `Question: ${item.question}`,
      `Correct answer: ${item.answer}`,
      item.solution ? `Solution: ${item.solution}` : "",
      `Learner's answer: ${response}`,
      'Return JSON only: {"errorType": "…", "note": "one short sentence on what went wrong"}',
    ]
      .filter(Boolean)
      .join("\n"),
    signal,
  );
  const o = extractJson<{ errorType?: unknown; note?: unknown }>(text);
  const errorType = ERROR_TYPES.includes(o?.errorType as ErrorType) ? (o!.errorType as ErrorType) : "other";
  return { errorType, note: typeof o?.note === "string" ? o.note : null };
}

export function parseLadderProblem(text: string): LadderProblem {
  const o = extractJson<{ question?: unknown; steps?: unknown; answer?: unknown }>(text);
  const steps = Array.isArray(o?.steps) ? o.steps.map((x) => String(x).trim()).filter(Boolean) : [];
  const question = String(o?.question ?? "").trim();
  const answer = String(o?.answer ?? "").trim();
  if (!question || !answer || steps.length < 2) throw new Error(s.ladder.badProblem);
  return { question, steps: steps.slice(0, 8), answer };
}

const LADDER_FORMAT = 'Return JSON only: {"question": "…", "steps": ["each step of the solution, one short line, LaTeX in $…$"], "answer": "the final answer, short", "level": 1-5}';

/** `like` is the previous rung's problem: the next one keeps its structure and changes the numbers or context. */
export async function generateLadderProblem(
  llm: ResolvedModel,
  opts: { topic: TopicSpec; rung: number; like?: LadderProblem; level?: number; language?: string | null; signal?: AbortSignal },
): Promise<LadderProblem> {
  const prompt = [
    `Write ONE worked example problem on "${opts.topic.title}" (${opts.topic.description}) at difficulty ${opts.level ?? 2}/5, for the ladder step ${opts.rung}.`,
    "The solution is 3 to 5 short steps; the last step states the final result. One clearly correct answer, no picture needed, under 60 words.",
    opts.like
      ? `Make it near-identical in structure to this problem, with different numbers or context:\n"""\n${opts.like.question}\n"""\nIts steps:\n${opts.like.steps.map((x, i) => `${i + 1}. ${x}`).join("\n")}`
      : "",
    languageInstruction(opts.language),
    LADDER_FORMAT,
  ]
    .filter(Boolean)
    .join("\n\n");
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return parseLadderProblem(await ask(llm, prompt, opts.signal));
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      lastError = e;
    }
  }
  throw lastError;
}

/** One verdict per blank, in order. Exact matches are accepted without the model. */
export async function gradeBlanks(
  llm: ResolvedModel,
  problem: LadderProblem,
  blanks: { index: number; response: string }[],
  signal?: AbortSignal,
): Promise<boolean[]> {
  const pending = blanks.filter((b) => !sameStep(problem.steps[b.index], b.response));
  const verdict = new Map<number, boolean>();
  if (pending.length) {
    const text = await ask(
      llm,
      [
        "Grade a learner's filled-in steps of a worked solution. A step is correct if it says the same thing as the model step (equivalent wording or algebra is fine); wrong or missing content is incorrect.",
        `Problem: ${problem.question}`,
        `Model solution:\n${problem.steps.map((x, i) => `${i + 1}. ${x}`).join("\n")}`,
        ...pending.map((b, k) => `BLANK ${k + 1} (model step ${b.index + 1}): ${b.response.trim() || "(empty)"}`),
        'Return JSON only: {"results": [true|false, …]} with one entry per BLANK, in order.',
      ].join("\n\n"),
      signal,
    );
    const o = extractJson<{ results?: unknown }>(text);
    if (!o || !Array.isArray(o.results)) throw new Error(s.failures.theAnswerCouldnTBe);
    const res = o.results as unknown[];
    pending.forEach((b, k) => verdict.set(b.index, res[k] === true));
  }
  return blanks.map((b) => verdict.get(b.index) ?? true);
}

/** Grades the cold rung's final answer the same way ordinary practice does. */
export function ladderAsItem(p: LadderProblem, topicKey: string): PracticeItem {
  return {
    id: "ladder",
    topicKey,
    kind: parseNumber(p.answer) != null ? "numeric" : "short",
    question: p.question,
    options: null,
    answer: p.answer,
    solution: p.steps.join("\n"),
    difficulty: 0,
    parentId: null,
    hint: null,
    createdAt: 0,
  } as PracticeItem;
}
