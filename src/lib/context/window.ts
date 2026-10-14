import type { OpenRouterModel, Provider } from "../types";
import { baseUrlOf } from "../providers/catalog";
import { loadOpenRouterModels } from "../providers/openrouter";
import { createProxyFetch } from "../providers/proxyFetch";

/** Who pays per token: only "paid" models are held to the context cost cap. */
export type Billing = "paid" | "subscription" | "free" | "local";

export interface ModelLimits {
  /** context window in tokens (prompt + answer) */
  window: number;
  /** most tokens one answer may have */
  maxOutput: number;
  /** USD per token, when known */
  pricing: { prompt: number; completion: number; cacheRead: number | null } | null;
  billing: Billing;
  /** where `window` came from */
  from: "catalog" | "table" | "server" | "default";
}

export const LOCAL_DEFAULT_WINDOW = 8192;
const CLOUD_DEFAULT_WINDOW = 128_000;

/** Known windows for direct provider APIs, first match wins. */
const TABLE: [RegExp, number, number][] = [
  [/claude.*\[1m\]|claude-(sonnet|opus)-(5|4[.-]6|4[.-]7)/i, 1_000_000, 64_000],
  [/claude/i, 200_000, 64_000],
  [/gpt-4\.1/i, 1_047_576, 32_768],
  [/gpt-5|codex/i, 400_000, 128_000],
  [/\bo[34](-|$)/i, 200_000, 100_000],
  [/gpt-4o|gpt-4-turbo/i, 128_000, 16_384],
  [/gemini/i, 1_048_576, 65_536],
  [/grok-4|grok-code/i, 256_000, 64_000],
  [/grok/i, 131_072, 16_384],
  [/deepseek/i, 128_000, 8_192],
  [/mistral-large|magistral|mistral-medium/i, 128_000, 16_384],
  [/llama-?3|llama-4|qwen|kimi|glm/i, 131_072, 8_192],
];

const LOCAL_TYPES = new Set(["lmstudio", "ollama", "llamacpp"]);
const AUTHOR: Partial<Record<Provider["type"], string>> = {
  anthropic: "anthropic",
  openai: "openai",
  google: "google",
  xai: "x-ai",
  deepseek: "deepseek",
  mistral: "mistralai",
  "chatgpt-oauth": "openai",
  "xai-oauth": "x-ai",
};

const norm = (id: string) =>
  id
    .toLowerCase()
    .replace(/^.*\//, "")
    .replace(/-\d{8}$|-\d{4}-\d{2}-\d{2}$|-latest$/, "")
    .replace(/(\d)-(\d)/g, "$1.$2");

/** The OpenRouter entry for a model served by its maker's own API, matched on a normalized id. */
export function catalogMatch(provider: Pick<Provider, "type">, modelId: string, list: OpenRouterModel[]): OpenRouterModel | undefined {
  if (provider.type === "openrouter") return list.find((m) => m.id === modelId);
  const author = AUTHOR[provider.type];
  if (!author) return undefined;
  const want = norm(modelId);
  return list.find((m) => m.id.startsWith(`${author}/`) && norm(m.id) === want);
}

export function isLocalProvider(p: Pick<Provider, "type" | "kind" | "baseUrl">): boolean {
  if (p.kind === "local" || LOCAL_TYPES.has(p.type)) return true;
  if (p.type !== "openai-compatible") return false;
  try {
    const host = new URL(p.baseUrl ?? "").hostname;
    return /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)|\.local$/.test(host);
  } catch {
    return false;
  }
}

export function billingOf(p: Pick<Provider, "type" | "kind" | "baseUrl">, modelId: string, or?: OpenRouterModel): Billing {
  if (isLocalProvider(p)) return "local";
  if (p.kind === "oauth" || p.type === "chatgpt-oauth" || p.type === "xai-oauth") return "subscription";
  if (modelId.endsWith(":free")) return "free";
  if (or?.pricing && or.pricing.prompt === 0 && or.pricing.completion === 0) return "free";
  return "paid";
}

/** Limits without network access: catalog entry, then the table, then a default. */
export function limitsFrom(provider: Provider, modelId: string, or?: OpenRouterModel): ModelLimits {
  const billing = billingOf(provider, modelId, or);
  if (or?.contextLength) {
    return {
      window: or.contextLength,
      maxOutput: or.maxOutput ?? Math.min(32_768, Math.floor(or.contextLength / 4)),
      pricing: or.pricing ?? null,
      billing,
      from: "catalog",
    };
  }
  if (billing === "local") return { window: LOCAL_DEFAULT_WINDOW, maxOutput: 2048, pricing: null, billing, from: "default" };
  const row = TABLE.find(([re]) => re.test(modelId));
  if (row) return { window: row[1], maxOutput: row[2], pricing: null, billing, from: "table" };
  return { window: CLOUD_DEFAULT_WINDOW, maxOutput: 8192, pricing: null, billing, from: "default" };
}

/** What a local server says about a loaded model's window (LM Studio, Ollama); null if it doesn't say. */
export async function localWindow(provider: Provider, modelId: string, fetchFn: typeof fetch = createProxyFetch(provider.id)): Promise<number | null> {
  const root = baseUrlOf(provider).replace(/\/v1$/, "");
  const num = (v: unknown) => (typeof v === "number" && v > 0 ? v : null);
  try {
    if (provider.type === "ollama") {
      const r = await fetchFn(`${root}/api/show`, { method: "POST", body: JSON.stringify({ model: modelId }) });
      if (!r.ok) return null;
      const j = (await r.json()) as { parameters?: string; model_info?: Record<string, unknown> };
      const ctx = /num_ctx\s+(\d+)/.exec(j.parameters ?? "")?.[1];
      const trained = Object.entries(j.model_info ?? {}).find(([k]) => k.endsWith(".context_length"))?.[1];
      // without num_ctx Ollama serves 4096 tokens whatever the model was trained for
      return ctx ? Number(ctx) : num(trained) ? Math.min(num(trained)!, 4096) : null;
    }
    const r = await fetchFn(`${root}/api/v0/models/${encodeURIComponent(modelId)}`);
    if (!r.ok) return null;
    const j = (await r.json()) as { loaded_context_length?: number; max_context_length?: number };
    return num(j.loaded_context_length) ?? num(j.max_context_length);
  } catch {
    return null;
  }
}

const cache = new Map<string, { at: number; limits: ModelLimits }>();
const TTL = 10 * 60_000;

export async function modelLimits(provider: Provider, modelId: string): Promise<ModelLimits> {
  const key = `${provider.id}\u0000${modelId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.limits;
  let or: OpenRouterModel | undefined;
  if (!isLocalProvider(provider)) {
    const list = await loadOpenRouterModels().catch(() => [] as OpenRouterModel[]);
    or = catalogMatch(provider, modelId, list);
  }
  let limits = limitsFrom(provider, modelId, or);
  if (limits.billing === "local") {
    const w = await localWindow(provider, modelId);
    if (w) limits = { ...limits, window: w, maxOutput: Math.min(4096, Math.floor(w / 4)), from: "server" };
  }
  cache.set(key, { at: Date.now(), limits });
  return limits;
}

/** USD for a prompt + answer of this size; null when the price isn't known. */
export function estimateCost(limits: ModelLimits, promptTokens: number, answerTokens: number, cachedTokens = 0): number | null {
  if (limits.billing !== "paid") return limits.billing === "free" || limits.billing === "local" ? 0 : null;
  const p = limits.pricing;
  if (!p) return null;
  const cached = Math.min(cachedTokens, promptTokens);
  return (promptTokens - cached) * p.prompt + cached * (p.cacheRead ?? p.prompt) + answerTokens * p.completion;
}
