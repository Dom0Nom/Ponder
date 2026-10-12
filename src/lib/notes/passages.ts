import { generateText } from "ai";
import type { ResolvedModel } from "../chat/llm";

export type ReadingLevel = "simpler" | "original" | "advanced";

export interface Passage {
  start: number;
  end: number;
  text: string;
}

const MAX = 900;

function splitLong(para: string, base: number, max: number): Passage[] {
  const out: Passage[] = [];
  let from = 0;
  while (from < para.length) {
    let to = Math.min(para.length, from + max);
    if (to < para.length) {
      let cut = -1;
      for (const m of para.slice(from, to).matchAll(/[.!?]\s/g)) cut = (m.index ?? 0) + 1;
      if (cut > max / 3) to = from + cut;
    }
    out.push({ start: base + from, end: base + to, text: para.slice(from, to) });
    from = to;
    while (from < para.length && /\s/.test(para[from])) from++;
  }
  return out;
}

/** Splits text into passages of whole paragraphs (long paragraphs at sentence ends); offsets index the original string. */
export function splitPassages(text: string, max = MAX): Passage[] {
  const parts: Passage[] = [];
  for (const m of text.matchAll(/[^\n]+(?:\n(?!\n)[^\n]+)*/g)) {
    const start = m.index ?? 0;
    if (m[0].length <= max * 1.5) parts.push({ start, end: start + m[0].length, text: m[0] });
    else parts.push(...splitLong(m[0], start, max));
  }
  const out: Passage[] = [];
  for (const p of parts) {
    const last = out.at(-1);
    if (last && p.end - last.start < max) out[out.length - 1] = { start: last.start, end: p.end, text: text.slice(last.start, p.end) };
    else out.push(p);
  }
  return out;
}

export type Rewritten = Exclude<ReadingLevel, "original">;

export const levelKind = (l: Rewritten) => `level:${l}`;
export const langKind = (language: string) => `lang:${language}`;

export function levelPrompt(level: Rewritten, passage: string): string {
  const how =
    level === "simpler"
      ? "Use short sentences and everyday words, and explain a technical term in a few words where it first appears."
      : "Use precise academic wording and keep technical terms; you may tighten loose phrasing.";
  return [
    `Rewrite the passage below at a ${level === "simpler" ? "simpler" : "more advanced"} reading level, for a learner reading it next to the original.`,
    `PASSAGE:\n"""\n${passage}\n"""`,
    [
      "Keep every fact, number, name and the order of ideas; add nothing the passage doesn't say; keep the passage's language and Markdown formatting.",
      how,
    ].join("\n"),
    "Return only the rewritten passage, without a title, quotes or comments.",
  ].join("\n\n");
}

export function translatePrompt(language: string, passage: string): string {
  return [
    `Translate the passage below into ${language}, for a learner reading it next to the original.`,
    `PASSAGE:\n"""\n${passage}\n"""`,
    "Keep every fact, number and name, the paragraph structure and any Markdown formatting. Leave names and quoted code as they are.",
    "Return only the translation, without a title, quotes or comments.",
  ].join("\n\n");
}

/** Strips code fences or wrapping quotes models sometimes add; empty string when nothing is left. */
export function cleanRewrite(reply: string): string {
  let t = reply.trim();
  const fence = t.match(/^```[a-z]*\n([\s\S]*?)\n```$/i);
  if (fence) t = fence[1].trim();
  t = t.replace(/^"""\s*([\s\S]*?)\s*"""$/, "$1").trim();
  return t;
}

/** Retries once on an empty reply. */
export async function rewritePassage(llm: ResolvedModel, prompt: string, signal?: AbortSignal): Promise<string> {
  for (let i = 0; i < 2; i++) {
    const r = await generateText({ model: llm.model, prompt, abortSignal: signal, ...llm.options({ thinking: false }) });
    const t = cleanRewrite(r.text);
    if (t) return t;
  }
  throw new Error("The model returned an empty rewrite.");
}

export const LANGUAGES = ["German", "Spanish", "French", "English", "Italian", "Portuguese", "Turkish", "Arabic"] as const;
