import { generateText } from "ai";
import type { ResolvedModel } from "../chat/llm";
import type { QuizQuestion, TopicRef } from "../types";
import { parseQuiz, shuffleOptions } from "../placement/logic";
import { batches, distribute, type ExamFormat, type ExamSection } from "./formats";
import { languageInstruction } from "../i18n/language";
import { s } from "../strings";

export function examQuestionPrompt(format: ExamFormat, section: ExamSection, batch: { topic: TopicRef; n: number }[], avoid: string[] = [], language?: string | null): string {
  const total = batch.reduce((n, b) => n + b.n, 0);
  return [
    `Write multiple-choice questions for a timed ${format.title} ${section.title} practice test.`,
    `Topics (exactly this many questions per topic, ${total} in total):`,
    batch.map((b) => `- id "${b.topic.id}": ${b.topic.title} (${b.topic.description}): ${b.n}`).join("\n"),
    `Match the real ${format.title} test's difficulty and style: mostly medium, some hard, applied to realistic situations. Where the real test gives a short passage, quote, table or scenario, include it in the question text (under 120 words; tables in Markdown; math in LaTeX inside $…$).`,
    section.calculator ? "A scientific calculator is allowed, so numbers may need one." : "No calculator is allowed, so keep any arithmetic simple.",
    `Each question has exactly 4 options and one correct answer (0-based index). Wrong options are plausible mistakes, not jokes. The explanation is one sentence on why the answer is right, and ${languageInstruction(language)} Questions must be answerable without a picture. Avoid 'all of the above'.`,
    avoid.length ? `Don't repeat these questions:\n${avoid.slice(-20).map((q) => `- ${q.slice(0, 100)}`).join("\n")}` : "",
    'Return JSON only: [{"topicId": "…", "question": "…", "options": ["…","…","…","…"], "answer": 0, "explanation": "…"}]',
  ]
    .filter(Boolean)
    .join("\n\n");
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

async function runBatch(
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
  return capByQuota(parseQuiz(r.text, [...quota.keys()]), quota).map((q) => shuffleOptions(q));
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
  opts: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void; language?: string | null } = {},
): Promise<QuizQuestion[]> {
  const plan = distribute(topics, count);
  const jobs = batches(plan);
  const results: QuizQuestion[][] = new Array(jobs.length);
  let done = 0;
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++;
      results[i] = await runBatch(llm, format, section, jobs[i], [], opts.signal, opts.language).catch((e) => {
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
      const more = await runBatch(llm, format, section, b, all.map((q) => q.question), opts.signal, opts.language).catch((e) => {
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
