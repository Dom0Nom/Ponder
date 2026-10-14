import { generateNoThinking } from "../steps/check";
import { s } from "../strings";
import type { ResolvedModel } from "../chat/llm";
import type { SnipImage } from "../types";
import type { ImageInput } from "../steps/vision";
import { DATE_MEDIUM, formatDate } from "../i18n/format";

export const SNIP_SOURCE_PROMPT = [
  "Describe this screenshot as study material so it can be searched later.",
  "Start with one short line that works as a title (no Markdown, no quotes).",
  "Then transcribe all readable text exactly, and describe diagrams, charts and formulas in plain sentences (formulas in LaTeX with $ signs).",
  "Write nothing else: no preface, no commentary.",
].join("\n");

export function imageFromSnip(snip: SnipImage): ImageInput {
  return { data: snip.data, mediaType: snip.mediaType };
}

export function snipPreviewUrl(snip: SnipImage): string {
  return `data:${snip.mediaType};base64,${snip.data}`;
}

/** Splits the model's description into a source title (first line) and the full text. */
export function parseSnipSource(text: string, now = new Date()): { title: string; body: string } {
  const body = text.trim();
  const first = body
    .split("\n")
    .map((l) => l.replace(/^#{1,6}\s+/, "").replace(/^["'“”]+|["'“”]+$/g, "").trim())
    .find(Boolean);
  const date = formatDate(now, DATE_MEDIUM);
  const title = first && first.length <= 80 ? first : s.ask.sourceTitleFallback(date);
  return { title, body };
}

/** Has a vision model transcribe and describe the screenshot so it can be saved as a text source. */
export async function describeSnip(llm: ResolvedModel, image: ImageInput, opts: { signal?: AbortSignal } = {}) {
  const text = await generateNoThinking(llm, {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: SNIP_SOURCE_PROMPT },
          { type: "file", data: image.data, mediaType: image.mediaType },
        ],
      },
    ],
    abortSignal: opts.signal,
  });
  if (!text.trim()) throw new Error(s.steps.nothingRead);
  return parseSnipSource(text);
}
