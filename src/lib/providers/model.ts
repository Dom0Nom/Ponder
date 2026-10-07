import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createXai } from "@ai-sdk/xai";
import type { LanguageModel } from "ai";
import type { ModelRef, Provider } from "../types";
import { baseUrlOf, catalog, capabilitiesOf, pickDefaultModel, type ReasoningLevel, type Verbosity } from "./catalog";
import { createProxyFetch } from "./proxyFetch";

export type ChatModel = Exclude<LanguageModel, string>;

/** Placeholder; Rust strips it and injects the real key/token for the provider's own base URL. */
export const PROXY_API_KEY = "injected-by-app";

const CHATGPT_UNSUPPORTED = [
  "temperature",
  "max_output_tokens",
  "top_p",
  "top_logprobs",
  "metadata",
  "user",
  "safety_identifier",
  "truncation",
  "background",
  "previous_response_id",
  "max_tool_calls",
  "prompt_cache_retention",
];

/** Enforces the ChatGPT plan preview limits on every Responses API body. */
export function chatgptFetch(inner: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init && typeof init.body === "string") {
      try {
        const body = JSON.parse(init.body) as Record<string, unknown>;
        for (const k of CHATGPT_UNSUPPORTED) delete body[k];
        body.store = false;
        init = { ...init, body: JSON.stringify(body) };
      } catch {
        /* not JSON: send as is */
      }
    }
    return inner(input, init);
  }) as typeof fetch;
}

export interface ModelFactoryOptions {
  /** Override the transport (scripts/tests). Defaults to the Rust proxy. */
  fetch?: typeof fetch;
}

export function createLanguageModel(provider: Provider, modelId: string, opts: ModelFactoryOptions = {}): ChatModel {
  const entry = catalog[provider.type];
  if (!entry) throw new Error(`Unknown provider type ${provider.type}`);
  const baseURL = baseUrlOf(provider);
  if (!baseURL) throw new Error(`${provider.name} has no base URL`);
  const fetch = opts.fetch ?? createProxyFetch(provider.id);
  const apiKey = PROXY_API_KEY;

  switch (entry.sdk) {
    case "anthropic":
      return createAnthropic({ baseURL, apiKey, fetch })(modelId);
    case "openai":
      return createOpenAI({ baseURL, apiKey, fetch }).responses(modelId);
    case "chatgpt":
      return createOpenAI({ baseURL, apiKey, fetch: chatgptFetch(fetch) }).responses(modelId);
    case "google":
      return createGoogleGenerativeAI({ baseURL, apiKey, fetch })(modelId);
    case "xai":
      return createXai({ baseURL, apiKey, fetch })(modelId);
    case "openai-compatible":
      return createOpenAICompatible({ name: provider.type, baseURL, apiKey, fetch, includeUsage: true }).chatModel(modelId);
  }
}

export interface CallOptionInput {
  /** false turns reasoning off where the provider supports it; true/undefined keeps the model default */
  thinking?: boolean;
  reasoning?: ReasoningLevel;
  verbosity?: Verbosity;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface CallOptions {
  reasoning?: ReasoningLevel;
  temperature?: number;
  maxOutputTokens?: number;
  providerOptions?: Record<string, Record<string, string | number | boolean | null>>;
}

/** Extra `streamText` options for a provider. Never adds a token limit on its own. */
export function callOptions(provider: Provider, input: CallOptionInput = {}): CallOptions {
  const caps = capabilitiesOf(provider);
  const out: CallOptions = {};
  const lv = input.reasoning;
  if (lv && (caps.reasoningLevels?.some((l) => l.value === lv) || (lv === "none" && caps.thinkingToggle))) {
    out.reasoning = lv;
  }
  if (input.thinking === false && caps.reasoningToggle) out.reasoning = "none";
  if (input.verbosity && caps.verbosity) out.providerOptions = { openai: { textVerbosity: input.verbosity } };
  if (input.temperature != null && caps.temperature) out.temperature = input.temperature;
  if (input.maxOutputTokens != null && caps.maxOutputTokens) out.maxOutputTokens = input.maxOutputTokens;
  if (provider.type === "chatgpt-oauth") out.providerOptions = { openai: { ...out.providerOptions?.openai, store: false } };
  return out;
}

// ---------- model lists + connection test ----------

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const j = JSON.parse(text);
    const msg = j?.error?.message ?? j?.error ?? j?.message;
    if (typeof msg === "string" && msg) return `${res.status}: ${msg}`;
  } catch {
    /* not JSON */
  }
  return `${res.status}: ${text.slice(0, 200) || res.statusText || "request failed"}`;
}

async function getJson(fetchFn: typeof fetch, url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetchFn(url, { method: "GET", headers: { accept: "application/json", ...headers } });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/** Model ids the provider offers, sorted. */
export async function listModels(provider: Provider, opts: ModelFactoryOptions = {}): Promise<string[]> {
  const fetchFn = opts.fetch ?? createProxyFetch(provider.id);
  const base = baseUrlOf(provider);
  if (!base) throw new Error(`${provider.name} has no base URL`);
  let ids: string[];
  if (provider.type === "anthropic") {
    const j = (await getJson(fetchFn, `${base}/models?limit=1000`, { "anthropic-version": "2023-06-01" })) as {
      data?: { id: string }[];
    };
    ids = (j.data ?? []).map((m) => m.id);
  } else if (provider.type === "google") {
    const j = (await getJson(fetchFn, `${base}/models?pageSize=1000`)) as {
      models?: { name: string; supportedGenerationMethods?: string[] }[];
    };
    ids = (j.models ?? [])
      .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes("generateContent"))
      .map((m) => m.name.replace(/^models\//, ""));
  } else {
    const j = (await getJson(fetchFn, `${base}/models`)) as { data?: { id: string }[]; models?: { name: string }[] };
    ids = j.data ? j.data.map((m) => m.id) : (j.models ?? []).map((m) => m.name);
  }
  return [...new Set(ids.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export interface ConnectionResult {
  models: string[];
  defaultModel: string | undefined;
}

/** Lists models to prove the base URL and credential work. */
export async function testConnection(provider: Provider, opts: ModelFactoryOptions = {}): Promise<ConnectionResult> {
  const models = await listModels(provider, opts);
  if (models.length === 0) throw new Error("Connected, but the server reported no models");
  return { models, defaultModel: pickDefaultModel(models, provider.config.defaultModel) };
}

// ---------- model resolution ----------

export interface ResolvedModel {
  provider: Provider;
  modelId: string;
}

function lookup(ref: ModelRef | null | undefined, providers: Provider[]): ResolvedModel | null {
  if (!ref?.providerId || !ref.model?.trim()) return null;
  const provider = providers.find((p) => p.id === ref.providerId);
  return provider ? { provider, modelId: ref.model.trim() } : null;
}

/** Space override wins, then the app default, then the first provider that has a model. */
export function resolveModel(
  settingsDefault: ModelRef | null | undefined,
  spaceOverride: ModelRef | null | undefined,
  providers: Provider[],
): ResolvedModel | null {
  const hit = lookup(spaceOverride, providers) ?? lookup(settingsDefault, providers);
  if (hit) return hit;
  for (const provider of providers) {
    const modelId = provider.config.defaultModel || pickDefaultModel(provider.config.models ?? []);
    if (modelId) return { provider, modelId };
  }
  return null;
}
