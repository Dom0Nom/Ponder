import { generateText } from "ai";
import { extractJson } from "../chat/json";
import type { ResolvedModel } from "../chat/llm";
import type { TopicRef } from "../types";

export function customCurriculumPrompt(text: string): string {
  return `Turn this syllabus or topic list into a study curriculum of 5 to 25 topics, in learning order, in the syllabus's language. Group related topics.\n\n"""\n${text.slice(0, 12000)}\n"""\n\nReturn JSON only: {"title": "…", "topics": [{"title": "…", "description": "a few keywords of what it covers", "group": "…"}]}`;
}

export function parseCustomCurriculum(text: string): { title: string | null; topics: TopicRef[] } {
  const parsed = extractJson<{ title?: string; topics?: { title?: string; description?: string; group?: string }[] }>(text);
  const topics: TopicRef[] = (parsed?.topics ?? [])
    .filter((t) => t?.title)
    .slice(0, 40)
    .map((t, i) => ({
      id: `custom.${i + 1}`,
      title: String(t.title).trim(),
      description: String(t.description ?? t.title).trim(),
      group: String(t.group ?? "Topics").trim(),
      prereqs: i > 0 ? [`custom.${i}`] : undefined,
    }));
  if (topics.length < 2) throw new Error("Couldn't find a topic list in that text.");
  return { title: parsed?.title?.trim() || null, topics };
}

export async function generateCustomCurriculum(llm: ResolvedModel, text: string, signal?: AbortSignal) {
  const r = await generateText({ model: llm.model, ...llm.options({ thinking: false }), prompt: customCurriculumPrompt(text), abortSignal: signal });
  return parseCustomCurriculum(r.text);
}
