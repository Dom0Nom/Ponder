import { generateText } from "ai";
import type { ResolvedModel } from "../chat/llm";

export const SUMMARY_SYSTEM = "You write short, plain summaries of study material. Reply in the language of the material.";

export function summaryPrompt(title: string, text: string): string {
  const excerpt = text.length > 9000 ? `${text.slice(0, 6000)}\n…\n${text.slice(-2500)}` : text;
  return `Summarize this source in 2–3 sentences for a learner: what it covers and what it's useful for. No preamble.\n\nTitle: ${title}\n\n${excerpt}`;
}

export async function summarizeText(llm: ResolvedModel, title: string, text: string, signal?: AbortSignal): Promise<string> {
  const r = await generateText({
    model: llm.model,
    ...llm.options({ thinking: false }),
    system: SUMMARY_SYSTEM,
    prompt: summaryPrompt(title, text),
    abortSignal: signal,
  });
  return r.text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}
