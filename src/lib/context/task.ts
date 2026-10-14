import type { ResolvedModel } from "../chat/llm";
import { loadSpaceSources } from "./build";
import { planSearch, resolveSections } from "./plan";
import { gatherPassages, renderPassages, type ContextPassage } from "./retrieve";
import { buildSourceMap, makeHandles } from "./sourceMap";
import { loadTokenizer } from "./tokens";
import { modelLimits } from "./window";

export interface TaskMaterial {
  passages: ContextPassage[];
  /** numbered passages, ready for a prompt */
  text: string;
  /** one line per source (summary-level) */
  map: string;
  /** titles in order of first appearance in `passages` */
  sources: string[];
  tokens: number;
}

export interface TaskInput {
  spaceId: string;
  /** what the output is about; empty = the whole space */
  topic?: string;
  /** used to plan sub-searches for broad topics and to size the budget */
  llm?: ResolvedModel;
  /** most source tokens to gather; the model's window lowers it further */
  maxTokens?: number;
  /** extra queries (e.g. topic descriptions) */
  queries?: string[];
}

/**
 * Source material for generated things (Studio outputs, worksheets, quizzes, cards, practice):
 * the sections a topic names, planned searches expanded to whole sections, and a short source map,
 * through the same retrieval as chat.
 */
export async function gatherForTask(t: TaskInput): Promise<TaskMaterial> {
  await loadTokenizer();
  const { sources, outlines } = await loadSpaceSources(t.spaceId);
  const usable = sources.filter((s) => s.useInChat && (s.contextMode ?? "auto") !== "summary");
  const enabled = sources.filter((s) => s.useInChat);
  let budget = t.maxTokens ?? 30_000;
  if (t.llm) {
    const limits = await modelLimits(t.llm.provider, t.llm.modelId).catch(() => null);
    if (limits) budget = Math.min(budget, Math.floor(limits.window * 0.45));
  }
  const topic = t.topic?.trim() ?? "";
  let queries = [topic, ...(t.queries ?? [])].filter(Boolean);
  if (topic && t.llm) {
    const plan = await planSearch(t.llm, [], `Material for: ${topic}`).catch(() => null);
    if (plan) queries = [...new Set([topic, plan.query, ...plan.searches, ...(t.queries ?? [])])];
  }
  if (!queries.length) {
    // no topic: one query per source summary theme keeps whole-space outputs broad
    queries = enabled
      .slice(0, 6)
      .map((s) => s.title)
      .filter(Boolean);
  }
  const handles = makeHandles(enabled);
  const map = buildSourceMap(enabled, outlines, handles, Math.floor(budget * 0.15));
  const g = await gatherPassages({
    spaceId: t.spaceId,
    queries,
    sections: topic ? resolveSections(topic, usable, outlines) : [],
    searchable: usable,
    outlines,
    budget: Math.max(500, budget - map.tokens),
    large: false,
  });
  const titles: string[] = [];
  for (const p of g.passages) if (!titles.includes(p.sourceTitle)) titles.push(p.sourceTitle);
  return { passages: g.passages, text: renderPassages(g.passages), map: map.text, sources: titles, tokens: g.tokens + map.tokens };
}
