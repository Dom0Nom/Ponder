import { generateText } from "ai";
import { extractJson } from "../chat/json";
import type { ResolvedModel } from "../chat/llm";
import { s } from "../strings";
import type { CalcCheck } from "./verify";

export interface StepVerdict {
  /** 0-based index into `steps` */
  index: number;
  ok: boolean;
  /** what is wrong, without giving the answer away */
  issue?: string;
  /** a nudge towards the fix */
  hint?: string;
  /** the corrected step (shown only on request) */
  fix?: string;
  /** "calc": decided by the numeric check, overriding the model */
  checkedBy: "calc" | "model";
}

export interface StepCheckResult {
  verdicts: StepVerdict[];
  firstWrong: number | null;
  finalCorrect: boolean | null;
  summary: string;
}

export interface StepCheckInput {
  problem: string;
  steps: string[];
  expectedAnswer?: string;
}

export interface ModelVerdicts {
  verdicts: Map<number, { ok: boolean; issue?: string; hint?: string; fix?: string }>;
  finalCorrect: boolean | null;
  summary: string;
}

function asBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (/^(true|yes|ok|correct|right|valid|richtig)$/.test(t)) return true;
    if (/^(false|no|wrong|incorrect|invalid|error|mistake|falsch)$/.test(t)) return false;
  }
  return null;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** Reads the model's grading. Accepts an array or {steps|verdicts}, 1-based "step"/"index", loose booleans. */
export function parseModelVerdicts(text: string, count: number): ModelVerdicts | null {
  const raw = extractJson<unknown>(text);
  if (!raw || typeof raw !== "object") return null;
  const obj = Array.isArray(raw) ? {} : (raw as Record<string, unknown>);
  const list = Array.isArray(raw) ? raw : (obj.steps ?? obj.verdicts ?? obj.results);
  if (!Array.isArray(list)) return null;
  const verdicts = new Map<number, { ok: boolean; issue?: string; hint?: string; fix?: string }>();
  list.forEach((item, pos) => {
    if (!item || typeof item !== "object") return;
    const it = item as Record<string, unknown>;
    const n = Number(it.step ?? it.index ?? it.n ?? pos + 1);
    const index = Number.isInteger(n) ? n - 1 : pos;
    if (index < 0 || index >= count || verdicts.has(index)) return;
    const ok = asBool(it.ok ?? it.correct ?? it.valid ?? it.verdict);
    if (ok == null) return;
    verdicts.set(index, {
      ok,
      issue: ok ? undefined : str(it.issue ?? it.error ?? it.problem ?? it.explanation),
      hint: ok ? undefined : str(it.hint),
      fix: ok ? undefined : str(it.fix ?? it.correction ?? it.corrected),
    });
  });
  if (!verdicts.size) return null;
  return { verdicts, finalCorrect: asBool(obj.finalCorrect ?? obj.final_correct ?? obj.final), summary: str(obj.summary) ?? "" };
}

function calcIssue(c: CalcCheck & { status: "wrong" }, fmt: (x: number) => string): string {
  if (c.kind === "value") {
    const at = Object.entries(c.at)
      .map(([k, v]) => `${k} = ${fmt(v)}`)
      .join(", ");
    return s.steps.calcValue(at || "these numbers", c.before == null ? "?" : fmt(c.before), c.after == null ? "?" : fmt(c.after));
  }
  if (c.solution == null) return s.steps.calcChanged;
  const sol = `${c.var ?? "x"} = ${fmt(c.solution)}`;
  return c.solvesBefore ? s.steps.calcLost(sol) : s.steps.calcGained(sol);
}

/** Model verdicts, overridden wherever the calculation proved a step right or wrong. */
export function mergeVerdicts(
  count: number,
  model: ModelVerdicts | null,
  calc: CalcCheck[],
  fmt: (x: number) => string = String,
): StepVerdict[] {
  return Array.from({ length: count }, (_, index) => {
    const m = model?.verdicts.get(index);
    const c = calc[index];
    if (c?.status === "wrong") {
      return {
        index,
        ok: false,
        issue: (m && !m.ok && m.issue) || calcIssue(c, fmt),
        hint: (m && !m.ok && m.hint) || s.steps.calcHint,
        fix: m && !m.ok ? m.fix : undefined,
        checkedBy: "calc",
      };
    }
    if (c?.status === "right") return { index, ok: true, checkedBy: "calc" };
    return { index, ok: m?.ok ?? true, issue: m?.issue, hint: m?.hint, fix: m?.fix, checkedBy: "model" };
  });
}

export function firstWrongOf(verdicts: StepVerdict[]): number | null {
  return verdicts.find((v) => !v.ok)?.index ?? null;
}

function calcNotes(calc: CalcCheck[]): string {
  const lines = calc.flatMap((c, i) =>
    c.status === "wrong"
      ? [`- Step ${i + 1} is NOT equivalent to the line before it.`]
      : c.status === "right"
        ? [`- Step ${i + 1} is equivalent to the line before it.`]
        : [],
  );
  return lines.length ? `A calculator already checked some steps (trust it):\n${lines.join("\n")}` : "";
}

export function stepCheckPrompt(input: StepCheckInput, calc: CalcCheck[]): string {
  return [
    "You check a learner's worked math solution step by step.",
    `PROBLEM:\n${input.problem.trim() || "(not given; infer it from the first step)"}`,
    input.expectedAnswer?.trim() ? `EXPECTED FINAL ANSWER: ${input.expectedAnswer.trim()}` : "",
    `STEPS:\n${input.steps.map((t, i) => `${i + 1}. ${t}`).join("\n")}`,
    calcNotes(calc),
    [
      "Rules:",
      "- Judge each step as a move from the step before it (step 1 from the problem). A step is ok if it follows correctly, even if it isn't the final answer yet.",
      "- After a wrong step, judge later steps against the learner's own previous line (don't mark them wrong just because they inherit the earlier mistake).",
      "- For a wrong step: issue = one short sentence naming the exact mistake; hint = a nudge towards the next move; fix = the corrected version of that line in LaTeX.",
      "- The learner sees issue and hint first, so they must NOT contain the corrected line, the correct result or the final answer. Only fix may.",
      '- Example for a wrong step "$3x = 12 \\to x = 36$": issue "Multiplied by 3 instead of dividing." hint "What undoes multiplying $x$ by 3?" — not "should be $x = 4$".',
      "- Use LaTeX inside $…$ for math in issue and hint. Write in the language of the problem.",
    ].join("\n"),
    'Return JSON only: {"steps":[{"step":1,"ok":true},{"step":2,"ok":false,"issue":"…","hint":"…","fix":"…"}],"finalCorrect":true|false|null,"summary":"one sentence"}',
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** generateText with reasoning off, retried with the model default when the endpoint requires reasoning. */
export async function generateNoThinking(
  llm: ResolvedModel,
  args: Omit<Parameters<typeof generateText>[0], "model">,
): Promise<string> {
  try {
    return (await generateText({ ...args, model: llm.model, ...llm.options({ thinking: false }) } as Parameters<typeof generateText>[0])).text;
  } catch (e) {
    if (!/reasoning is mandatory|cannot be disabled|reasoning.*(required|not supported)/i.test(String((e as Error)?.message ?? e))) throw e;
    return (await generateText({ ...args, model: llm.model, ...llm.options({ thinking: true }) } as Parameters<typeof generateText>[0])).text;
  }
}

/** Grades each step with the model; mathjs overrides the model wherever it can decide. */
export async function checkSteps(
  llm: ResolvedModel,
  input: StepCheckInput,
  opts: { signal?: AbortSignal } = {},
): Promise<StepCheckResult> {
  const steps = input.steps.map((x) => x.trim()).filter(Boolean);
  if (!steps.length) throw new Error(s.steps.needSteps);
  const v = await import("./verify");
  const calc = await (await import("./sympyCheck")).sympyVerify(input.problem, steps, v.verifySteps(input.problem, steps));
  const final = v.verifyFinal(input.problem, steps, input.expectedAnswer);
  const clean = { ...input, steps };

  let model: ModelVerdicts | null = null;
  let failure: unknown = null;
  try {
    const text = await generateNoThinking(llm, { prompt: stepCheckPrompt(clean, calc), abortSignal: opts.signal });
    model = parseModelVerdicts(text, steps.length);
    if (!model) failure = new Error(s.steps.unreadable);
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    failure = e;
  }
  // the calculation alone is enough when it decided every step
  if (!model && !calc.every((c) => c.status !== "undecided")) throw failure;

  const verdicts = mergeVerdicts(steps.length, model, calc, v.formatNumber);
  const firstWrong = firstWrongOf(verdicts);
  const modelFirst = model ? firstWrongOf(mergeVerdicts(steps.length, model, [])) : undefined;
  const summary =
    model?.summary && modelFirst === firstWrong
      ? model.summary
      : firstWrong == null
        ? s.steps.calcAllGood
        : s.steps.calcSummary(firstWrong + 1);
  return { verdicts, firstWrong, finalCorrect: final ?? model?.finalCorrect ?? null, summary };
}
