import { api } from "../ipc";
import { resolveChatModel } from "../chat/llm";
import type { InlinePracticeMeta, PracticeItem } from "../types";
import { levelFor, targetDifficulty } from "./irt";
import { generateProblem, type TopicSpec } from "./problems";

export const INLINE_TOTAL = 3;

export type InlineResult = InlinePracticeMeta["results"][number];

export function inlineTopic(threadTitle: string, description: string): TopicSpec {
  const title = threadTitle.trim() || description;
  return { key: `free:${title.slice(0, 80)}`, title, description: description || title };
}

export function setResult(meta: InlinePracticeMeta, index: number, result: InlineResult): InlinePracticeMeta {
  const results = [...meta.results];
  results[index] = result;
  return { ...meta, results };
}

export function advance(meta: InlinePracticeMeta): InlinePracticeMeta {
  return { ...meta, index: Math.min(meta.index + 1, meta.total) };
}

export const isDone = (meta: InlinePracticeMeta) => meta.index >= meta.total;
export const rightCount = (meta: InlinePracticeMeta) => meta.results.filter((r) => r === "right").length;

/** Splits a question into prose and display-math parts; display math gets its own box. */
export function splitDisplayMath(question: string): { kind: "text" | "math"; text: string }[] {
  const out: { kind: "text" | "math"; text: string }[] = [];
  let last = 0;
  for (const m of question.matchAll(/\$\$([\s\S]+?)\$\$/g)) {
    const before = question.slice(last, m.index).trim();
    if (before) out.push({ kind: "text", text: before });
    out.push({ kind: "math", text: m[0] });
    last = m.index! + m[0].length;
  }
  const rest = question.slice(last).trim();
  if (rest) out.push({ kind: "text", text: rest });
  return out.length ? out : [{ kind: "text", text: question }];
}

/** Writes and stores one problem for an inline practice card, based on the answer it follows. */
export async function makeInlineProblem(opts: {
  spaceId: string;
  space: (Parameters<typeof resolveChatModel>[0] & { language?: string | null }) | null | undefined;
  topic: TopicSpec;
  context: string;
}): Promise<PracticeItem> {
  const llm = await resolveChatModel(opts.space);
  const [ability, avoid] = await Promise.all([
    api.abilityGet(opts.spaceId, opts.topic.key),
    api.practiceRecent(opts.spaceId, opts.topic.key, 10),
  ]);
  const item = await generateProblem(llm, {
    topic: opts.topic,
    level: levelFor(targetDifficulty(ability?.theta ?? 0)),
    context: opts.context,
    avoid,
    language: opts.space?.language,
  });
  return api.practiceItemAdd(opts.spaceId, item);
}

/** First sentence of a worked solution, for the one-line detail in the result bar. */
export function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const m = flat.match(/^.*?[.!?](?=\s|$)/);
  return (m ? m[0] : flat).slice(0, 220);
}
