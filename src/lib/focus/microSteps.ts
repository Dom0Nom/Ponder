import { generateText } from "ai";
import { extractJson } from "../chat/json";
import type { ResolvedModel } from "../chat/llm";
import { api } from "../ipc";
import type { NewMicroStep } from "../types";
import { s } from "../strings";

export const MIN_STEP_MINUTES = 2;
export const MAX_STEP_MINUTES = 5;
export const MAX_STEPS = 8;
const MAX_TEXT = 200;

export interface MicroStepInput {
  goal: string;
  spaceName?: string | null;
  sourceTitles?: string[];
  level?: string | null;
}

/** Pure: turns the model's reply into 1..MAX_STEPS clean steps with minutes clamped to 2-5. */
export function parseMicroSteps(raw: string): NewMicroStep[] {
  const parsed = extractJson<unknown>(raw);
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { steps?: unknown }).steps)
      ? (parsed as { steps: unknown[] }).steps
      : [];
  const out: NewMicroStep[] = [];
  for (const item of list) {
    const obj = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
    const rawText = typeof item === "string" ? item : (obj?.text ?? obj?.step);
    if (typeof rawText !== "string") continue;
    const text = rawText.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
    if (!text) continue;
    const m = Number(obj?.minutes);
    const minutes = Number.isFinite(m) ? Math.min(MAX_STEP_MINUTES, Math.max(MIN_STEP_MINUTES, Math.round(m))) : 3;
    out.push({ text, minutes });
    if (out.length >= MAX_STEPS) break;
  }
  return out;
}

export function microStepPrompt(input: MicroStepInput): string {
  const ctx = [
    input.spaceName ? `Study space: ${input.spaceName}` : "",
    input.sourceTitles?.length ? `Material the learner has: ${input.sourceTitles.slice(0, 5).join("; ")}` : "",
    input.level ? `Learner's level: ${input.level}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return `Break this goal into micro-steps for a learner who struggles to get started.

Goal: ${input.goal.trim()}
${ctx}

Write 4 to 7 steps. Rules:
- Each step is one tiny physical action the learner can do in 2 to 5 minutes (open, find, read, write, say, copy, try).
- Step 1 must be almost trivially easy, such as opening a specific file or page. Use the material above when it fits, otherwise something generic like "Open your notes".
- Be concrete: name the page, the exercise, the word count. No vague steps like "understand" or "review the topic".
- Every step must move the goal forward. No busywork like writing a word several times, decorating notes or rituals.
- Steps build on each other and end with a small check, like writing two sentences from memory.
- Write the steps in the same language as the goal. Keep each under 12 words.
Return JSON only: [{"text": "...", "minutes": 2}, ...]`;
}

export async function generateMicroSteps(
  llm: ResolvedModel,
  input: MicroStepInput,
  signal?: AbortSignal,
): Promise<NewMicroStep[]> {
  const r = await generateText({
    model: llm.model,
    prompt: microStepPrompt(input),
    abortSignal: signal,
    ...llm.options({ thinking: false }),
  });
  const steps = parseMicroSteps(r.text);
  if (!steps.length) throw new Error(s.failures.theModelDidnTReturn4);
  return steps;
}

/** First unfinished step for a space, for the study buddy's check-in. */
export async function currentStepText(spaceId: string | null): Promise<string | null> {
  const steps = await api.microStepsList(spaceId);
  return steps.find((x) => !x.done)?.text ?? null;
}
