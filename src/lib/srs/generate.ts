import { generateText } from "ai";
import { extractJson } from "../chat/json";
import type { ResolvedModel } from "../chat/llm";
import type { NewCard, SearchHit } from "../types";

export interface Passage {
  sourceId: string;
  sourceTitle: string;
  text: string;
  start: number;
  end: number;
}

export function hitsToPassages(hits: SearchHit[]): Passage[] {
  return hits.map((h) => ({ sourceId: h.sourceId, sourceTitle: h.sourceTitle, text: h.text, start: h.start, end: h.end }));
}

/** Locates a short quote inside a passage so the card can point at the exact words. */
export function locateQuote(p: Passage, quote: string | undefined): { start: number; end: number } {
  const q = quote?.trim();
  if (q && q.length >= 8) {
    const i = p.text.indexOf(q);
    if (i >= 0) return { start: p.start + i, end: p.start + i + q.length };
    const lower = p.text.toLowerCase().indexOf(q.toLowerCase().slice(0, 60));
    if (lower >= 0) return { start: p.start + lower, end: p.start + Math.min(p.text.length, lower + q.length) };
  }
  return { start: p.start, end: p.end };
}

interface RawCard {
  type?: string;
  front?: string;
  back?: string;
  text?: string;
  passage?: number;
  quote?: string;
}

export function parseCards(text: string, passages: Passage[]): NewCard[] {
  const raw = extractJson<unknown>(text);
  const list = (Array.isArray(raw) ? raw : (raw as { cards?: unknown[] } | null)?.cards) as RawCard[] | undefined;
  if (!Array.isArray(list)) throw new Error("The model didn't return usable cards. Try again.");
  const seen = new Set<string>();
  const out: NewCard[] = [];
  for (const c of list) {
    if (!c || typeof c !== "object") continue;
    const p = passages[(Number(c.passage) || 1) - 1];
    const cloze = c.type === "cloze" && typeof c.text === "string" && /\{\{c\d+::.+?\}\}/.test(c.text);
    const front = cloze ? c.text!.trim() : String(c.front ?? "").trim();
    const back = cloze ? "" : String(c.back ?? "").trim();
    if (!front || (!cloze && !back)) continue;
    const key = front.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const loc = p ? locateQuote(p, c.quote) : null;
    out.push({
      kind: cloze ? "cloze" : "basic",
      front,
      back,
      sourceId: p?.sourceId ?? null,
      chunkStart: loc?.start ?? null,
      chunkEnd: loc?.end ?? null,
      origin: "generated",
    });
  }
  if (!out.length) throw new Error("No usable cards came back. Try again or pick other sources.");
  return out;
}

export async function generateCards(
  llm: ResolvedModel,
  passages: Passage[],
  opts: { count: number; focus?: string; existingFronts?: string[]; signal?: AbortSignal; only?: "cloze" },
): Promise<NewCard[]> {
  const listing = passages.map((p, i) => `[${i + 1}] (${p.sourceTitle})\n${p.text}`).join("\n\n");
  const prompt = [
    `Make ${opts.count} flashcards for a learner from the passages below${opts.focus ? `, focused on: ${opts.focus}` : ""}.`,
    opts.only === "cloze"
      ? "Make only cloze cards: {\"type\":\"cloze\",\"text\":a sentence with the key term as {{c1::term}}}."
      : "Mix two types: question/answer cards ({\"type\":\"basic\",\"front\":question,\"back\":short answer}) and cloze cards ({\"type\":\"cloze\",\"text\":a sentence with the key term as {{c1::term}}}).",
    "Rules: one fact per card; answers short; test understanding, not trivia like page numbers; only use facts that the passages state; write in the passages' language.",
    "For every card give the passage number it comes from and a short exact quote (5–20 words) from that passage that supports it.",
    opts.existingFronts?.length ? `Don't repeat these existing cards:\n${opts.existingFronts.slice(0, 40).map((f) => `- ${f}`).join("\n")}` : "",
    `PASSAGES:\n${listing}`,
    'Return JSON only: [{"type":"basic","front":"…","back":"…","passage":1,"quote":"…"},{"type":"cloze","text":"… {{c1::…}} …","passage":2,"quote":"…"}]',
  ]
    .filter(Boolean)
    .join("\n\n");
  const r = await generateText({ model: llm.model, prompt, abortSignal: opts.signal, ...llm.options({ thinking: false }) });
  const cards = parseCards(r.text, passages);
  return (opts.only === "cloze" ? cards.filter((c) => c.kind === "cloze") : cards).slice(0, opts.count);
}
