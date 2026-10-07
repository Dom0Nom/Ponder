import { api } from "../ipc";
import type { OpenRouterModel } from "../types";

/** Model authors offered as filters, in display order. `id` is the vendor prefix of an OpenRouter model id. */
export const OPENROUTER_AUTHORS = [
  { id: "anthropic", label: "Anthropic" },
  { id: "openai", label: "OpenAI" },
  { id: "google", label: "Google" },
  { id: "deepseek", label: "DeepSeek" },
  { id: "meta-llama", label: "Meta" },
  { id: "mistralai", label: "Mistral" },
  { id: "x-ai", label: "xAI" },
  { id: "qwen", label: "Qwen" },
] as const;

/** Current flagship and fast/cheap model per major author. Shown when present in the fetched list. */
export const RECOMMENDED_MODELS = [
  "anthropic/claude-opus-5.5",
  "anthropic/claude-sonnet-5.5",
  "anthropic/claude-haiku-5.5",
  "openai/gpt-6.1-sol",
  "openai/gpt-6-luna",
  "google/gemini-3.1-pro-preview",
  "google/gemini-3.8-flash",
  "deepseek/deepseek-v4-pro",
  "deepseek/deepseek-v4.1-flash",
  "x-ai/grok-4.7",
  "mistralai/mistral-large-4-0",
  "mistralai/mistral-small-2603",
  "qwen/qwen3.8-max-0902",
  "qwen/qwen3.8-flash",
  "meta-llama/llama-4-maverick",
] as const;

export const SEARCH_LIMIT = 50;

export const authorOf = (modelId: string) => (modelId.includes("/") ? modelId.slice(0, modelId.indexOf("/")) : "");

export function authorLabel(authorId: string): string {
  return OPENROUTER_AUTHORS.find((a) => a.id === authorId)?.label ?? authorId;
}

/** The curated list restricted to models OpenRouter currently serves, in curated order. */
export function recommendedModels(list: OpenRouterModel[], author?: string): OpenRouterModel[] {
  const byId = new Map(list.map((m) => [m.id, m]));
  return RECOMMENDED_MODELS.flatMap((id) => {
    const m = byId.get(id);
    return m && (!author || authorOf(id) === author) ? [m] : [];
  });
}

/** Every whitespace-separated term must appear in the id or name. Newest first; name-prefix matches ahead of the rest. */
export function searchModels(list: OpenRouterModel[], query: string, author?: string | null): OpenRouterModel[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = list.filter((m) => {
    if (m.id.endsWith(":batch")) return false;
    if (author && authorOf(m.id) !== author) return false;
    const hay = `${m.id} ${m.name}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
  const first = terms[0];
  const rank = (m: OpenRouterModel) =>
    first && (m.id.slice(m.id.indexOf("/") + 1).toLowerCase().startsWith(first) || m.id.toLowerCase().startsWith(first)) ? 0 : 1;
  return hits.sort((a, b) => rank(a) - rank(b) || (b.created ?? 0) - (a.created ?? 0) || a.id.localeCompare(b.id));
}

let cache: Map<string, OpenRouterModel> | null = null;
let inflight: Promise<OpenRouterModel[]> | null = null;

export const cachedOpenRouterModel = (id: string) => cache?.get(id);

export function setOpenRouterModels(list: OpenRouterModel[]) {
  cache = new Map(list.map((m) => [m.id, m]));
}

/** Loads the list through the backend (which caches on disk) and remembers it for synchronous capability lookups. */
export function loadOpenRouterModels(force = false): Promise<OpenRouterModel[]> {
  if (!force && cache) return Promise.resolve([...cache.values()]);
  inflight ??= api
    .listOpenrouterModels(force)
    .then((c) => {
      setOpenRouterModels(c.models);
      return c.models;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
