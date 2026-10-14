import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createXai } from "@ai-sdk/xai";
import type { LanguageModel } from "ai";
import type { ModelRef, OpenRouterModel, Provider } from "../types";
import { baseUrlOf, capabilitiesOf, catalog, pickDefaultModel } from "./catalog";
import { effortRank, resolveModelCaps, type Effort, type Verbosity } from "./modelCaps";
import { cachedOpenRouterModel } from "./openrouter";
import { createProxyFetch } from "./proxyFetch";
import { s } from "../strings";

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
  /** false turns thinking off where the model allows it; true/undefined keeps the chosen or default state */
  thinking?: boolean;
  effort?: Effort;
  verbosity?: Verbosity;
  temperature?: number;
  maxOutputTokens?: number;
}

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export interface CallOptions {
  temperature?: number;
  maxOutputTokens?: number;
  providerOptions?: Record<string, Record<string, Json>>;
}

/** Thinking budget for older Claude models that only take a token budget. */
export const CLAUDE_BUDGET_TOKENS = 8000;

/**
 * Extra `streamText` options for a model: only what its capabilities accept, in the provider's own request shape.
 * Unset values are omitted so the model's default applies. Never adds a token limit on its own.
 */
export function callOptions(provider: Provider, modelId: string, input: CallOptionInput = {}, orModel?: OpenRouterModel): CallOptions {
  const caps = resolveModelCaps(provider, modelId, orModel ?? cachedOpenRouterModel(modelId));
  const out: CallOptions = {};
  const po: Record<string, Record<string, Json>> = {};

  let effort = caps.effort?.options.some((o) => o.value === input.effort) ? input.effort : undefined;
  let thinking = caps.thinking ? input.thinking : undefined;
  if (input.thinking === false && !caps.thinking && caps.effort?.options.some((o) => o.value === "none")) effort = "none";
  const offLimit = caps.thinking?.offMaxEffort;
  const shownEffort = effort ?? caps.effort?.default ?? undefined;
  if (thinking === false && offLimit && shownEffort && effortRank(shownEffort) > effortRank(offLimit)) thinking = undefined;

  const thinkingOn = caps.thinking ? (thinking ?? caps.thinking.default) : caps.effort?.options.some((o) => o.value === "none") ? shownEffort !== "none" : true;
  const verbosity = caps.verbosity?.options.some((o) => o.value === input.verbosity) ? input.verbosity : undefined;
  const wire = caps.wire;
  const key = wire.kind === "compat" || wire.kind === "openrouter" ? provider.type : wire.kind === "anthropic" ? "anthropic" : wire.kind;

  if (caps.temperature && input.temperature != null && !(caps.temperature.offWhenThinking && thinkingOn)) out.temperature = input.temperature;
  if (input.maxOutputTokens != null && capabilitiesOf(provider).maxOutputTokens) out.maxOutputTokens = input.maxOutputTokens;

  switch (wire.kind) {
    case "anthropic": {
      const o: Record<string, Json> = {};
      if (effort) o.effort = effort;
      if (thinking === false && wire.off) o.thinking = { type: wire.off };
      else if (thinking === true && wire.on === "adaptive") o.thinking = { type: "adaptive", display: "summarized" };
      else if (thinking === true && wire.on === "budget") o.thinking = { type: "enabled", budgetTokens: CLAUDE_BUDGET_TOKENS };
      if (Object.keys(o).length) po[key] = o;
      break;
    }
    case "openai": {
      const o: Record<string, Json> = {};
      if (effort) o.reasoningEffort = effort;
      if (verbosity) o.textVerbosity = verbosity;
      if (Object.keys(o).length) po[key] = o;
      break;
    }
    case "google": {
      if (wire.style === "level" && effort) po[key] = { thinkingConfig: { thinkingLevel: effort } };
      if (wire.style === "budget" && thinking === false) po[key] = { thinkingConfig: { thinkingBudget: 0 } };
      break;
    }
    case "xai":
      if (effort) po[key] = { reasoningEffort: effort };
      break;
    case "openrouter": {
      const o: Record<string, Json> = {};
      const reasoning: Record<string, Json> = {};
      if (effort) reasoning.effort = effort;
      if (thinking === false) reasoning.enabled = false;
      else if (thinking === true && !effort) reasoning.enabled = true;
      if (Object.keys(reasoning).length) o.reasoning = reasoning;
      if (verbosity) o.textVerbosity = verbosity;
      if (Object.keys(o).length) po[key] = o;
      break;
    }
    case "compat": {
      const o: Record<string, Json> = {};
      if (effort && wire.effort) o.reasoningEffort = effort;
      if (thinking === false) {
        if (wire.thinking === "reasoning_effort-none") o.reasoningEffort = "none";
        else if (wire.thinking === "deepseek") o.thinking = { type: "disabled" };
      }
      if (Object.keys(o).length) po[key] = o;
      break;
    }
    case "none":
      break;
  }
  if (provider.type === "chatgpt-oauth") po.openai = { ...po.openai, store: false };
  if (Object.keys(po).length) out.providerOptions = po;
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
  if (models.length === 0) throw new Error(s.failures.connectedButTheServerReported);
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
