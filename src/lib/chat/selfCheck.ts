import { generateText } from "ai";
import type { Citation, ClaimVerdict, SelfCheck } from "../types";
import { extractJson } from "./json";
import type { ResolvedModel } from "./llm";

const VERDICTS: ClaimVerdict[] = ["supported", "partly", "unsupported", "contradicted"];

export function checkPrompt(answer: string, citations: Citation[]): string {
  const passages = citations.map((c) => `[${c.n}] ${c.text ?? c.snippet}`).join("\n\n");
  const clean = answer.replaceAll("{{general}}", "").replaceAll("{{/general}}", "");
  return [
    "You are a strict fact-checker for a study app. Check the ANSWER against the PASSAGES only, not against your own knowledge.",
    "Split the answer into its factual claims (skip greetings, questions and study tips). For each claim give a verdict:",
    '"supported" (a passage clearly says it), "partly" (a passage supports part of it), "unsupported" (no passage says it), "contradicted" (a passage says otherwise).',
    "List the passage numbers you used. Add a short note for anything not fully supported.",
    `PASSAGES:\n${passages || "(none)"}`,
    `ANSWER:\n${clean}`,
    'Return JSON only: [{"claim": "...", "verdict": "supported", "passages": [1], "note": "..."}]',
  ].join("\n\n");
}

export function parseCheck(text: string, known: number): SelfCheck["items"] {
  const raw = extractJson<unknown[]>(text);
  if (!Array.isArray(raw)) throw new Error("The checking model didn't return a usable result.");
  return raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => ({
      claim: String(x.claim ?? "").trim(),
      verdict: (VERDICTS.includes(x.verdict as ClaimVerdict) ? x.verdict : "unsupported") as ClaimVerdict,
      passages: Array.isArray(x.passages)
        ? x.passages.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= known)
        : [],
      note: typeof x.note === "string" && x.note.trim() ? x.note.trim() : undefined,
    }))
    .filter((x) => x.claim)
    .map((x) => (x.verdict === "supported" && x.passages.length === 0 ? { ...x, verdict: "unsupported" as const } : x));
}

export async function selfCheck(answer: string, citations: Citation[], llm: ResolvedModel, signal?: AbortSignal): Promise<SelfCheck> {
  const r = await generateText({
    model: llm.model,
    prompt: checkPrompt(answer, citations),
    abortSignal: signal,
    ...llm.options({ thinking: false }),
  });
  return {
    at: Date.now(),
    model: { providerId: llm.provider.id, model: llm.modelId },
    items: parseCheck(r.text, citations.length),
  };
}
