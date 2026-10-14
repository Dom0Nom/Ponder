import { generateText } from "ai";
import { api } from "../ipc";
import { resolveHelperModel, type ResolvedModel } from "../chat/llm";
import { numbersMatch, parseNumber } from "../practice/grade";
import type { QuizQuestion, Space } from "../types";

/** ok: solver agrees; wrong: solver picked another option; ambiguous: solver found two or more correct options; unknown: no usable answer, the question is kept */
export type Verdict = "ok" | "wrong" | "ambiguous" | "unknown";

export interface Solver {
  ask: (prompt: string, signal?: AbortSignal) => Promise<string>;
  /** a different model than the one that wrote the questions */
  separate: boolean;
}

export interface CheckStats {
  checked: number;
  replaced: number;
}

export const newStats = (): CheckStats => ({ checked: 0, replaced: 0 });

export const SETTING_KEY = "checkAnswerKeys";

/** Helper model if one is set and differs, else the writing model again at temperature 0. */
export function makeSolver(llm: ResolvedModel, helper?: ResolvedModel): Solver {
  const separate = !!helper && helper !== llm;
  const m = separate ? helper! : llm;
  const opts = separate ? { thinking: false } : { thinking: false, temperature: 0 };
  return {
    separate,
    ask: async (prompt, signal) => (await generateText({ model: m.model, prompt, abortSignal: signal, ...m.options(opts) })).text,
  };
}

/** null when Settings → Models → "Check answer keys" is off. */
export async function resolveSolver(llm: ResolvedModel, space?: Pick<Space, "modelOverride"> | null): Promise<Solver | null> {
  const settings = await api.getSettings();
  if (settings[SETTING_KEY] === false) return null;
  const helper = await resolveHelperModel(space ?? null, llm).catch(() => llm);
  return makeSolver(llm, helper);
}

const LETTERS = "ABCDEF";
const stripThinking = (t: string) => t.replace(/<think>[\s\S]*?<\/think>/g, "");

export function choicePrompt(question: string, options: string[]): string {
  return [
    "Solve this problem carefully, step by step, as if you were sitting the test. Check each calculation and each claim. You are not told the answer: decide for yourself.",
    `"""\n${question}\n"""`,
    `Options:\n${options.map((o, i) => `${LETTERS[i]}: ${o}`).join("\n")}`,
    "Then decide for each option whether it is correct. Normally exactly one is. If two or more are correct, list all of them; if none is correct, list none.",
    'End with one line of JSON: {"correct": ["B"]}',
  ].join("\n\n");
}

export function numberPrompt(question: string): string {
  return `Solve this problem carefully, step by step. Check each calculation.\n"""\n${question}\n"""\nEnd with one line of JSON: {"answer": the final number only, no units}`;
}

/** Last `{"correct": […]}` in a worked solution, as option indexes; null when there is none. */
export function parseChoices(text: string, count: number): number[] | null {
  const all = [...stripThinking(text).matchAll(/\{\s*"correct"\s*:\s*\[([^\]]*)\]\s*\}/g)];
  const body = all.at(-1)?.[1];
  if (body == null) return null;
  const out = new Set<number>();
  for (const raw of body.split(",")) {
    const v = raw.replace(/["'\s]/g, "").toUpperCase();
    if (!v) continue;
    const i = /^\d+$/.test(v) ? Number(v) : LETTERS.indexOf(v);
    if (i >= 0 && i < count) out.add(i);
  }
  return [...out].sort((a, b) => a - b);
}

/** Last `{"answer": …}` in a worked solution; earlier braces may be LaTeX. */
export function parseSolvedAnswer(text: string): string | null {
  const all = [...stripThinking(text).matchAll(/\{\s*"answer"\s*:\s*("(?:[^"\\]|\\.)*"|-?[\d.,]+)\s*\}/g)];
  const last = all.at(-1)?.[1];
  if (last == null) return null;
  try {
    return String(last.startsWith('"') ? JSON.parse(last) : last).trim();
  } catch {
    return null;
  }
}

export function choiceVerdict(chosen: number[] | null, key: number): Verdict {
  if (chosen == null) return "unknown";
  if (chosen.length >= 2) return "ambiguous";
  return chosen[0] === key ? "ok" : "wrong";
}

export function numberVerdict(solved: string | null, key: string): Verdict {
  if (solved == null) return "unknown";
  const a = parseNumber(key);
  const b = parseNumber(solved);
  if (a == null) return "unknown";
  return b != null && numbersMatch(a, b) ? "ok" : "wrong";
}

/** A solver that throws (offline, rate limit) must not block generation; only an abort propagates. */
async function guarded(signal: AbortSignal | undefined, fn: () => Promise<Verdict>): Promise<Verdict> {
  try {
    return await fn();
  } catch (e) {
    if (signal?.aborted) throw e;
    return "unknown";
  }
}

export const checkChoice = (solver: Solver, q: Pick<QuizQuestion, "question" | "options" | "answer">, signal?: AbortSignal) =>
  guarded(signal, async () => choiceVerdict(parseChoices(await solver.ask(choicePrompt(q.question, q.options), signal), q.options.length), q.answer));

export const checkNumber = (solver: Solver, q: { question: string; answer: string }, signal?: AbortSignal) =>
  guarded(signal, async () => numberVerdict(parseSolvedAnswer(await solver.ask(numberPrompt(q.question), signal)), q.answer));

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export function checkQuestions(solver: Solver, qs: QuizQuestion[], signal?: AbortSignal, stats?: CheckStats): Promise<Verdict[]> {
  return mapLimit(qs, 4, async (q) => {
    const v = await checkChoice(solver, q, signal);
    if (stats) stats.checked++;
    return v;
  });
}

const passes = (v: Verdict) => v === "ok" || v === "unknown";

/**
 * Solves every question blind. Questions the solver disagrees with, or finds two correct options in, are dropped and
 * written again once (`regenerate` gets them all in one call); the new ones are checked too and dropped if they fail.
 */
export async function repairQuestions<T extends QuizQuestion>(
  qs: T[],
  opts: { solver: Solver; regenerate: (bad: T[]) => Promise<T[]>; signal?: AbortSignal; stats?: CheckStats; onChecking?: (active: boolean) => void },
): Promise<T[]> {
  const { solver, signal, stats } = opts;
  opts.onChecking?.(true);
  try {
    const verdicts = await checkQuestions(solver, qs, signal, stats);
    const good = qs.filter((_, i) => passes(verdicts[i]));
    const bad = qs.filter((_, i) => !passes(verdicts[i]));
    if (!bad.length) return good;
    opts.onChecking?.(false);
    const fresh = await opts.regenerate(bad).catch((e) => {
      if (signal?.aborted) throw e;
      return [] as T[];
    });
    opts.onChecking?.(true);
    const again = await checkQuestions(solver, fresh, signal, stats);
    const kept = fresh.filter((_, i) => passes(again[i])).slice(0, bad.length);
    if (stats) stats.replaced += kept.length;
    return [...good, ...kept];
  } finally {
    opts.onChecking?.(false);
  }
}
