import { generateText } from "ai";
import type { ResolvedModel } from "../chat/llm";
import type { Source, SpaceCurriculum, Thread } from "../types";

export const DEFAULT_RESEARCH_SYSTEM_PROMPT = `You are a research assistant that finds study sources for a learner.
Prefer free, trustworthy learning material: textbooks, encyclopedias, university pages and peer-reviewed papers. Avoid content farms, forums and ads.
Search with a mix of general and specific queries.
Judge every page against the learner's exact question. A page that only shares words with the question is not relevant, however rigorous it is.
Be strict about relevance and honest about credibility.`;

export interface SpaceContext {
  name: string;
  curriculum?: Pick<SpaceCurriculum, "title" | "topics"> | null;
  sources?: Pick<Source, "title">[];
  threads?: Pick<Thread, "title">[];
}

const list = (items: string[]) => items.map((t) => `- ${t}`).join("\n");

export function buildQueryPrompt(ctx: SpaceContext): string {
  const parts = [`Study space: "${ctx.name}"`];
  if (ctx.curriculum) {
    const topics = ctx.curriculum.topics.slice(0, 12).map((t) => t.title);
    parts.push(`Curriculum: ${ctx.curriculum.title}${topics.length ? `\nTopics:\n${list(topics)}` : ""}`);
  }
  const sources = (ctx.sources ?? []).slice(0, 20).map((x) => x.title);
  if (sources.length) parts.push(`Sources already added:\n${list(sources)}`);
  const threads = (ctx.threads ?? [])
    .filter((t) => t.title.trim())
    .slice(0, 5)
    .map((t) => t.title);
  if (threads.length) parts.push(`Recent chats:\n${list(threads)}`);
  parts.push(
    `Write one or two short lines (at most 30 words) saying what this learner should find new study sources about. Infer the subject from the space name, curriculum and existing sources, and ask for material that adds to them instead of repeating them. Write in the language of the space name and titles. Return only that text, no quotes.`,
  );
  return parts.join("\n\n");
}

export function cleanQuery(text: string, fallback: string): string {
  const t = text
    .replace(/^["'“”«»\s]+|["'“”«»\s]+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 300);
  return t || fallback;
}

export async function generateResearchQuery(
  ctx: SpaceContext,
  deps: { llm: ResolvedModel; systemPrompt?: string; signal?: AbortSignal },
): Promise<string> {
  const r = await generateText({
    model: deps.llm.model,
    system: deps.systemPrompt?.trim() || DEFAULT_RESEARCH_SYSTEM_PROMPT,
    prompt: buildQueryPrompt(ctx),
    abortSignal: deps.signal,
    ...deps.llm.options({ thinking: false }),
  });
  return cleanQuery(r.text, ctx.name);
}

/** Changes whenever the space's name, curriculum, source list or research model changes. */
export function contextKey(ctx: SpaceContext, modelKey: string): string {
  return JSON.stringify([ctx.name, ctx.curriculum?.title ?? "", (ctx.sources ?? []).map((x) => x.title), modelKey]);
}

const cache = new Map<string, { key: string; query: string }>();
export const queryCache = {
  get: (spaceId: string, key: string) => (cache.get(spaceId)?.key === key ? cache.get(spaceId)!.query : null),
  set: (spaceId: string, key: string, query: string) => void cache.set(spaceId, { key, query }),
  clear: () => cache.clear(),
};

const inflight = new Map<string, Promise<string>>();
/** One generation per space and context, even when the panel remounts mid-request. */
export function sharedQuery(spaceId: string, key: string, make: () => Promise<string>): Promise<string> {
  const id = `${spaceId}\u001f${key}`;
  let p = inflight.get(id);
  if (!p) {
    p = make().finally(() => inflight.delete(id));
    inflight.set(id, p);
  }
  return p;
}
