import { generateText } from "ai";
import type { ResolvedModel } from "../chat/llm";
import type { QuizQuestion, TopicRef } from "../types";
import { parseQuiz, shuffleOptions } from "../placement/logic";
import { repairQuestions, type CheckStats, type Solver } from "../quality/answerCheck";
import { batches, distribute, partRanges, type ExamFormat, type ExamSection } from "./formats";
import { languageInstruction } from "../i18n/language";
import { parseQuestions, shuffleChoices } from "../questions/parse";
import { questionKindsPrompt } from "../questions/prompts";
import type { Question } from "../questions/types";
import { s } from "../strings";

export function examQuestionPrompt(format: ExamFormat, section: ExamSection, batch: { topic: TopicRef; n: number }[], avoid: string[] = [], language?: string | null): string {
  const total = batch.reduce((n, b) => n + b.n, 0);
  const rich = !!section.kinds && section.kinds.some((k) => k !== "mc");
  return [
    rich ? `Write questions of several kinds for a timed ${format.title} ${section.title} practice test.` : `Write multiple-choice questions for a timed ${format.title} ${section.title} practice test.`,
    `Topics (exactly this many questions per topic, ${total} in total):`,
    batch.map((b) => `- id "${b.topic.id}": ${b.topic.title} (${b.topic.description}): ${b.n}`).join("\n"),
    `Match the real ${format.title} test's difficulty and style: mostly medium, some hard, applied to realistic situations. Where the real test gives a short passage, quote, table or scenario, include it ${rich ? 'as the question\'s "stimulus"' : "in the question text"} (under 120 words; tables in Markdown; math in LaTeX inside $…$).`,
    section.calculator ? "A scientific calculator is allowed, so numbers may need one." : "No calculator is allowed, so keep any arithmetic simple.",
    rich
      ? `About half of the questions are "mc"; spread the rest over the other kinds, using each kind where the real test would. ${questionKindsPrompt(section.kinds!, { stimulus: true })}\nEvery question also has "topicId" (one of the ids above). Multiple choice has exactly 4 options and one correct answer (0-based index); wrong options are plausible mistakes, not jokes. ${languageInstruction(language)} Avoid 'all of the above'.`
      : `Each question has exactly 4 options and one correct answer (0-based index). Wrong options are plausible mistakes, not jokes. The explanation is one sentence on why the answer is right, and ${languageInstruction(language)} Questions must be answerable without a picture. Avoid 'all of the above'.`,
    avoid.length ? `Don't repeat these questions:\n${avoid.slice(-20).map((q) => `- ${q.slice(0, 100)}`).join("\n")}` : "",
    rich
      ? 'Return JSON only: [{"topicId": "…", "kind": "mc", "prompt": "…", "options": ["…","…","…","…"], "answer": 0, "explanation": "…"}, … other kinds as described]'
      : 'Return JSON only: [{"topicId": "…", "question": "…", "options": ["…","…","…","…"], "answer": 0, "explanation": "…"}]',
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** A rich question as the exam stores it: plain multiple choice stays in the old shape. */
export function toQuiz(q: Question): QuizQuestion {
  if (q.kind === "mc" && !q.stimulus) return { topicId: q.topicId ?? null, question: q.prompt, options: q.options, answer: q.answer, explanation: q.explanation ?? "" };
  return { topicId: q.topicId ?? null, question: q.prompt, options: [], answer: -1, explanation: q.explanation ?? "", rich: q };
}

/** Keeps at most `quota[topicId]` questions per topic, in order. */
export function capByQuota<T extends { topicId: string | null }>(qs: T[], quota: Map<string, number>): T[] {
  const seen = new Map<string, number>();
  return qs.filter((q) => {
    if (!q.topicId || !quota.has(q.topicId)) return false;
    const n = seen.get(q.topicId) ?? 0;
    seen.set(q.topicId, n + 1);
    return n < quota.get(q.topicId)!;
  });
}

export interface GenerateOptions {
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  /** when set, every question is solved blind and failures are rewritten once */
  solver?: Solver | null;
  stats?: CheckStats;
  /** "checking" while any batch is being solved, else "writing" */
  onPhase?: (phase: "writing" | "checking") => void;
  /** @internal shared between the parts of one section */
  active?: { checks: number };
  language?: string | null;
}

async function writeBatch(
  llm: ResolvedModel,
  format: ExamFormat,
  section: ExamSection,
  batch: { topic: TopicRef; n: number }[],
  avoid: string[],
  signal?: AbortSignal,
  language?: string | null,
): Promise<QuizQuestion[]> {
  const quota = new Map(batch.map((b) => [b.topic.id, b.n]));
  const r = await generateText({
    model: llm.model,
    prompt: examQuestionPrompt(format, section, batch, avoid, language),
    abortSignal: signal,
    ...llm.options({ thinking: false }),
  });
  if (section.kinds?.some((k) => k !== "mc")) {
    const qs = parseQuestions(r.text).map((q) => toQuiz(shuffleChoices(q)));
    if (!qs.length) throw new Error(s.failures.theModelDidnTReturn3);
    return capByQuota(qs, quota);
  }
  return capByQuota(parseQuiz(r.text, [...quota.keys()]), quota).map((q) => shuffleOptions(q));
}

async function runBatch(
  llm: ResolvedModel,
  format: ExamFormat,
  section: ExamSection,
  batch: { topic: TopicRef; n: number }[],
  avoid: string[],
  opts: GenerateOptions,
  checking: (d: number) => void,
): Promise<QuizQuestion[]> {
  const qs = await writeBatch(llm, format, section, batch, avoid, opts.signal, opts.language);
  if (!opts.solver) return qs;
  return repairQuestions(qs, {
    solver: opts.solver,
    signal: opts.signal,
    stats: opts.stats,
    onChecking: (active) => checking(active ? 1 : -1),
    regenerate: (bad) => {
      const per = new Map<string, number>();
      for (const q of bad) per.set(q.topicId!, (per.get(q.topicId!) ?? 0) + 1);
      const plan = batch.map((b) => ({ topic: b.topic, n: per.get(b.topic.id) ?? 0 })).filter((b) => b.n > 0);
      return writeBatch(llm, format, section, plan, [...avoid, ...qs.map((q) => q.question)], opts.signal, opts.language);
    },
  });
}

/**
 * Generates a section's questions in batches (3 at a time), then tops up once for any shortfall.
 * Throws only when nothing usable came back.
 */
export async function generateExamQuestions(
  llm: ResolvedModel,
  format: ExamFormat,
  section: ExamSection,
  topics: TopicRef[],
  count: number,
  opts: GenerateOptions = {},
): Promise<QuizQuestion[]> {
  const active = opts.active ?? { checks: 0 };
  const parts = partRanges(section.parts, section.calculator, count);
  if (parts.length > 1) {
    const done = parts.map(() => 0);
    const chunks = await Promise.all(
      parts.map((p, k) =>
        generateExamQuestions(llm, format, { ...section, parts: undefined, calculator: p.calculator }, topics, p.to - p.from, {
          ...opts,
          active,
          onProgress: (d) => {
            done[k] = d;
            opts.onProgress?.(done.reduce((a, b) => a + b, 0), count);
          },
        }),
      ),
    );
    return chunks.flat();
  }
  const checking = (d: number) => {
    active.checks += d;
    opts.onPhase?.(active.checks > 0 ? "checking" : "writing");
  };
  const plan = distribute(topics, count);
  const jobs = batches(plan);
  const results: QuizQuestion[][] = new Array(jobs.length);
  let done = 0;
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++;
      results[i] = await runBatch(llm, format, section, jobs[i], [], opts, checking).catch((e) => {
        if (opts.signal?.aborted) throw e;
        return [];
      });
      done += results[i].length;
      opts.onProgress?.(Math.min(done, count), count);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  let all = results.flat();
  if (all.length < count) {
    const have = new Map<string, number>();
    for (const q of all) have.set(q.topicId!, (have.get(q.topicId!) ?? 0) + 1);
    const missing = plan.map((p) => ({ topic: p.topic, n: p.n - (have.get(p.topic.id) ?? 0) })).filter((p) => p.n > 0);
    for (const b of batches(missing)) {
      const more = await runBatch(llm, format, section, b, all.map((q) => q.question), opts, checking).catch((e) => {
        if (opts.signal?.aborted) throw e;
        return [];
      });
      all = all.concat(more);
      opts.onProgress?.(Math.min(all.length, count), count);
    }
  }
  if (!all.length) throw new Error(s.failures.theModelDidnTReturn3);
  const order = new Map(topics.map((t, i) => [t.id, i]));
  return all.slice(0, count).sort((a, b) => (order.get(a.topicId!) ?? 0) - (order.get(b.topicId!) ?? 0));
}
