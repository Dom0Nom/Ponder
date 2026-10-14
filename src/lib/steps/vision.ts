import { extractJson } from "../chat/json";
import { generateNoThinking } from "./check";
import { resolveChatModel, NoModelError, type ResolvedModel } from "../chat/llm";
import { api } from "../ipc";
import { capabilitiesOf } from "../providers/catalog";
import { callOptions, createLanguageModel } from "../providers/model";
import { s } from "../strings";
import type { ModelRef, Provider, Space } from "../types";

export const VISION_SETTING = "visionModel";

export interface Transcription {
  problem: string;
  steps: string[];
}

export interface ImageInput {
  /** base64 (no data: prefix) or raw bytes */
  data: string | Uint8Array;
  mediaType: string;
}

const VISION_HINT = /gpt-4o|gpt-4\.1|gpt-5|o3|o4|claude|gemini|gemma-3|vision|-vl|vl-|llava|pixtral|grok-4|grok-2-vision|llama-4|mistral-(small|medium)|minicpm|moondream|qwen.*vl|qwen3\.5|kimi-k2|glm-4\.[56]v/i;

/** Best guess whether a model reads images: provider capability or a known vision model name. */
export function looksVisionCapable(provider: Pick<Provider, "type">, modelId: string): boolean {
  return capabilitiesOf(provider).images || VISION_HINT.test(modelId);
}

/** The model picked for photos in settings, else the space's chat model. */
export async function resolveVisionModel(space?: Pick<Space, "modelOverride"> | null): Promise<ResolvedModel> {
  const [providers, settings] = await Promise.all([api.listProviders(), api.getSettings()]);
  const ref = settings[VISION_SETTING] as ModelRef | undefined;
  const provider = ref?.model ? providers.find((p) => p.id === ref.providerId) : undefined;
  if (provider && ref) {
    return {
      provider,
      modelId: ref.model,
      model: createLanguageModel(provider, ref.model),
      options: (o) => callOptions(provider, ref.model, o),
    };
  }
  return resolveChatModel(space);
}

export function parseTranscription(text: string): Transcription {
  const raw = extractJson<unknown>(text);
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(raw) ? raw : (obj.steps ?? obj.lines);
  if (!Array.isArray(list)) throw new Error(s.steps.nothingRead);
  const steps = list
    .map((x) => (typeof x === "string" ? x : x && typeof x === "object" ? ((x as Record<string, unknown>).latex ?? (x as Record<string, unknown>).text) : ""))
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean);
  if (!steps.length) throw new Error(s.steps.nothingRead);
  return { problem: typeof obj.problem === "string" ? obj.problem.trim() : "", steps };
}

export const TRANSCRIBE_PROMPT = [
  "Transcribe the handwritten math work in this image.",
  "Copy exactly what is written, including any mistakes: never correct, finish or simplify anything.",
  "Each line of work becomes one step, written in LaTeX without $ signs (e.g. 2(x-3)+4=10, \\frac{x}{2}=3). Skip crossed-out lines and doodles.",
  'If the task itself is written at the top (e.g. "Solve 2x+1=5"), put it in "problem", not in steps.',
  'Return JSON only: {"problem":"… or empty","steps":["…","…"]}',
].join("\n");

/** Reads handwritten steps from a photo with a vision-capable model. */
export async function transcribeSteps(llm: ResolvedModel, image: ImageInput, opts: { signal?: AbortSignal; prompt?: string } = {}): Promise<Transcription> {
  const text = await generateNoThinking(llm, {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: opts.prompt ?? TRANSCRIBE_PROMPT },
          { type: "file", data: image.data, mediaType: image.mediaType },
        ],
      },
    ],
    abortSignal: opts.signal,
  });
  return parseTranscription(text);
}

export { NoModelError };
