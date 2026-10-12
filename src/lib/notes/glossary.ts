import { generateText } from "ai";
import { extractJson } from "../chat/json";
import type { ResolvedModel } from "../chat/llm";
import type { GlossaryEntry } from "../types";

export const MAX_TERMS = 15;
const MAX_CHARS = 14_000;

/** Short stable hash of the text a cached result was made from. */
export function textHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${h.toString(16)}-${text.length}`;
}

/** Long texts are sampled from four spread-out slices so the glossary covers the whole thing. */
export function glossarySample(text: string): string {
  if (text.length <= MAX_CHARS) return text;
  const slice = Math.floor(MAX_CHARS / 4);
  return [0, 1, 2, 3]
    .map((i) => {
      const from = Math.floor(((text.length - slice) * i) / 3);
      return text.slice(from, from + slice);
    })
    .join("\n\n…\n\n");
}

export function glossaryPrompt(text: string): string {
  return [
    "Extract a glossary of the key terms from the text below, for a learner who will study this text.",
    `TEXT:\n"""\n${glossarySample(text)}\n"""`,
    [
      `Pick up to ${MAX_TERMS} terms that matter for understanding the text. Each term must appear in the text word for word.`,
      "Write each definition as one plain sentence under 30 words, using only what the text says or directly implies. Never add outside facts.",
      "Write in the text's language. If the text has no terms worth defining, return an empty list.",
    ].join("\n"),
    'Return JSON only: {"terms":[{"term":"…","definition":"…"}]}',
  ].join("\n\n");
}

/** Keeps entries that are well formed and whose term occurs in the text; null when the reply isn't usable JSON. */
export function parseGlossary(reply: string, text: string): GlossaryEntry[] | null {
  const raw = extractJson<unknown>(reply);
  const list = Array.isArray(raw) ? raw : (raw as { terms?: unknown } | null)?.terms;
  if (!Array.isArray(list)) return null;
  const lower = text.toLowerCase();
  const seen = new Set<string>();
  const out: GlossaryEntry[] = [];
  for (const e of list) {
    if (!e || typeof e !== "object") continue;
    const term = String((e as { term?: unknown }).term ?? "").trim();
    const definition = String((e as { definition?: unknown }).definition ?? "").trim();
    const key = term.toLowerCase();
    if (!term || term.length > 80 || !definition || definition.length > 400 || seen.has(key) || !lower.includes(key)) continue;
    seen.add(key);
    out.push({ term, definition });
    if (out.length === MAX_TERMS) break;
  }
  return out;
}

/** Retries once when the reply doesn't parse or nothing grounded survives. */
export async function generateGlossary(llm: ResolvedModel, text: string, signal?: AbortSignal): Promise<GlossaryEntry[]> {
  const prompt = glossaryPrompt(text);
  let last: GlossaryEntry[] | null = null;
  for (let i = 0; i < 2; i++) {
    const r = await generateText({ model: llm.model, prompt, abortSignal: signal, ...llm.options({ thinking: false }) });
    last = parseGlossary(r.text, text);
    if (last?.length) return last;
  }
  if (last) return last;
  throw new Error("The model didn't return a usable glossary.");
}
