import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createXai } from "@ai-sdk/xai";
import { generateText, type LanguageModel, type ToolSet } from "ai";
import { baseUrlOf } from "../providers/catalog";
import { PROXY_API_KEY } from "../providers/model";
import { createProxyFetch } from "../providers/proxyFetch";
import type { Provider } from "../types";
import { modelSearchPrompt } from "./reportPrompts";
import type { SearchResult } from "./search";
import { s } from "../../lib/strings";

const SDK_SEARCH_TYPES = ["openai", "anthropic", "google", "xai"];

/** Providers whose own web search the app can call. OpenRouter goes through its `:online` plugin. */
export function supportsModelSearch(provider: Pick<Provider, "type">): boolean {
  return provider.type === "openrouter" || SDK_SEARCH_TYPES.includes(provider.type);
}

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

/** Cited pages from an OpenRouter chat completion (`message.annotations` of type url_citation). */
export function parseOpenRouterCitations(data: unknown): SearchResult[] {
  const annotations = (data as { choices?: { message?: { annotations?: unknown } }[] } | null)?.choices?.[0]?.message?.annotations;
  if (!Array.isArray(annotations)) return [];
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const a of annotations as { type?: string; url_citation?: { url?: string; title?: string; content?: string } }[]) {
    const c = a?.type === "url_citation" ? a.url_citation : undefined;
    if (!c?.url || !/^https?:\/\//i.test(c.url) || seen.has(c.url)) continue;
    seen.add(c.url);
    out.push({ title: c.title?.trim() || host(c.url), url: c.url, snippet: (c.content ?? "").replace(/\s+/g, " ").trim().slice(0, 300), engine: "model" });
  }
  return out;
}

/** URL sources from an AI SDK result (`result.sources`), as provider web-search tools report them. */
export function sourcesToResults(sources: readonly { sourceType?: string; url?: string; title?: string }[] | undefined): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const s of sources ?? []) {
    if (s.sourceType !== "url" || !s.url || !/^https?:\/\//i.test(s.url) || seen.has(s.url)) continue;
    seen.add(s.url);
    out.push({ title: s.title?.trim() || host(s.url), url: s.url, snippet: "", engine: "model" });
  }
  return out;
}

async function viaOpenRouter(provider: Pick<Provider, "type" | "baseUrl">, modelId: string, q: string, fetchFn: typeof fetch, signal?: AbortSignal) {
  const res = await fetchFn(`${baseUrlOf(provider)}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal,
    body: JSON.stringify({
      model: `${modelId.replace(/:online$/, "")}:online`,
      messages: [{ role: "user", content: modelSearchPrompt(q) }],
      max_tokens: 1200,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(s.failures.webSearchFailed(res.status, text.slice(0, 160)));
  return parseOpenRouterCitations(JSON.parse(text));
}

function sdkSearch(provider: Provider, modelId: string, fetchFn: typeof fetch): { model: LanguageModel; tools: ToolSet } {
  const opts = { baseURL: baseUrlOf(provider), apiKey: PROXY_API_KEY, fetch: fetchFn };
  switch (provider.type) {
    case "openai": {
      const p = createOpenAI(opts);
      return { model: p.responses(modelId), tools: { web_search: p.tools.webSearch({}) } };
    }
    case "anthropic": {
      const p = createAnthropic(opts);
      return { model: p(modelId), tools: { web_search: p.tools.webSearch_20250305({ maxUses: 3 }) } };
    }
    case "google": {
      const p = createGoogleGenerativeAI(opts);
      return { model: p(modelId), tools: { google_search: p.tools.googleSearch({}) } };
    }
    case "xai": {
      const p = createXai(opts);
      return { model: p(modelId), tools: { web_search: p.tools.webSearch() } };
    }
    default:
      throw new Error(`${provider.type} has no built-in web search`);
  }
}

/** A search function backed by the research model's own web search, or null when the provider has none. */
export function createModelSearch(
  provider: Provider,
  modelId: string,
  opts: { fetch?: typeof fetch; signal?: AbortSignal } = {},
): ((q: string) => Promise<SearchResult[]>) | null {
  if (!supportsModelSearch(provider)) return null;
  const fetchFn = opts.fetch ?? createProxyFetch(provider.id);
  if (provider.type === "openrouter") return (q) => viaOpenRouter(provider, modelId, q, fetchFn, opts.signal);
  return async (q) => {
    const { model, tools } = sdkSearch(provider, modelId, fetchFn);
    const r = await generateText({ model, tools, prompt: modelSearchPrompt(q), abortSignal: opts.signal });
    return sourcesToResults(r.sources as never);
  };
}
