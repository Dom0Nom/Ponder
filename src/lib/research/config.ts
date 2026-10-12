import { api } from "../ipc";
import { NoModelError, type ResolvedModel } from "../chat/llm";
import { loadOpenRouterModels } from "../providers/openrouter";
import { callOptions, createLanguageModel, resolveModel } from "../providers/model";
import type { ModelRef, Space } from "../types";
import { DEFAULT_RESEARCH_SYSTEM_PROMPT } from "./prompts";
import {
  DEFAULT_SEARCH,
  FREE_ENGINES,
  KEYED_ENGINES,
  searchKeyId,
  type FreeEngine,
  type KeyedEngine,
  type SearchConfig,
} from "./search";
import { createModelSearch } from "./webSearch";

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

export const ENGINES_KEY = "researchEngines";
export const SEARXNG_KEY = "searxngUrl";

export interface EngineSettings {
  free: SearchConfig["free"];
  /** use the research model's own web search */
  modelSearch: boolean;
  searxngUrl: string;
}

export function engineSettings(settings: Record<string, unknown> | undefined): EngineSettings {
  const saved = (settings?.[ENGINES_KEY] ?? {}) as Partial<Record<FreeEngine | "modelSearch", unknown>>;
  const free = { ...DEFAULT_SEARCH.free };
  for (const id of FREE_ENGINES) if (typeof saved[id] === "boolean") free[id] = saved[id] as boolean;
  const url = settings?.[SEARXNG_KEY];
  return { free, modelSearch: saved.modelSearch === true, searxngUrl: typeof url === "string" ? url.trim() : "" };
}

export async function savedSearchKeys(): Promise<Record<KeyedEngine, boolean>> {
  const have = await Promise.all(KEYED_ENGINES.map((e) => api.hasSecret(searchKeyId(e)).catch(() => false)));
  return Object.fromEntries(KEYED_ENGINES.map((e, i) => [e, have[i]])) as Record<KeyedEngine, boolean>;
}

/** Engines the next run uses: enabled free ones, SearXNG with a URL, keyed ones with a saved key, the model's search when on and supported. */
export async function resolveSearchConfig(
  settings: Record<string, unknown> | undefined,
  llm: Pick<ResolvedModel, "provider" | "modelId">,
  signal?: AbortSignal,
): Promise<SearchConfig> {
  const cfg = engineSettings(settings);
  return {
    free: cfg.free,
    searxngUrl: cfg.searxngUrl,
    keys: await savedSearchKeys(),
    modelSearch: cfg.modelSearch ? (createModelSearch(llm.provider, llm.modelId, { signal }) ?? undefined) : undefined,
  };
}
