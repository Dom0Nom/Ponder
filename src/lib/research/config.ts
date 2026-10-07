import { api } from "../ipc";
import { NoModelError, type ResolvedModel } from "../chat/llm";
import { loadOpenRouterModels } from "../providers/openrouter";
import { callOptions, createLanguageModel, resolveModel } from "../providers/model";
import type { ModelRef, Space } from "../types";
import { DEFAULT_RESEARCH_SYSTEM_PROMPT } from "./prompts";

export const RESEARCH_MODEL_KEY = "researchModel";
export const RESEARCH_PROMPT_KEY = "researchSystemPrompt";

export function researchSettings(settings: Record<string, unknown> | undefined) {
  const prompt = settings?.[RESEARCH_PROMPT_KEY];
  const custom = typeof prompt === "string" && prompt.trim() !== "" && prompt !== DEFAULT_RESEARCH_SYSTEM_PROMPT;
  return {
    model: (settings?.[RESEARCH_MODEL_KEY] as ModelRef | null | undefined) ?? null,
    systemPrompt: custom ? (prompt as string) : DEFAULT_RESEARCH_SYSTEM_PROMPT,
    customPrompt: custom,
  };
}

/** Research model if set and still available, else the space/app chat model. */
export async function resolveResearch(
  space?: Pick<Space, "modelOverride"> | null,
): Promise<{ llm: ResolvedModel; systemPrompt: string }> {
  const [providers, settings] = await Promise.all([api.listProviders(), api.getSettings()]);
  const cfg = researchSettings(settings);
  const research = cfg.model && providers.some((p) => p.id === cfg.model!.providerId) ? cfg.model : null;
  const picked = resolveModel(
    (settings.defaultModel as ModelRef | undefined) ?? null,
    research ?? space?.modelOverride ?? null,
    providers,
  );
  if (!picked) throw new NoModelError();
  if (picked.provider.type === "openrouter") await loadOpenRouterModels().catch(() => undefined);
  return {
    systemPrompt: cfg.systemPrompt,
    llm: {
      provider: picked.provider,
      modelId: picked.modelId,
      model: createLanguageModel(picked.provider, picked.modelId),
      options: (o) => callOptions(picked.provider, picked.modelId, o),
    },
  };
}
