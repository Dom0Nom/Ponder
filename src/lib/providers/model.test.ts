import { describe, expect, it, vi } from "vitest";
import type { Provider, ProviderType } from "../types";

const calls = vi.hoisted(() => ({ list: [] as { providerId: string | null | undefined; url: string; init?: RequestInit }[] }));

vi.mock("./proxyFetch", () => ({
  createProxyFetch: (providerId?: string | null) =>
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.list.push({ providerId, url: String(input), init });
      throw new Error("recorded");
    }) as typeof fetch,
}));

import { callOptions, createLanguageModel, listModels, resolveModel, chatgptFetch } from "./model";
import { catalog, offersTemperature } from "./catalog";
import { controlsKey, effortLabel, modelLabel, resolveControls, thinkingOn } from "./controls";

function prov(type: ProviderType, extra: Partial<Provider> = {}): Provider {
  return {
    id: `id-${type}`,
    type,
    kind: catalog[type].kind,
    name: type,
    baseUrl: null,
    config: {},
    createdAt: 0,
    ...extra,
  };
}

async function firstRequest(p: Provider, model = "m") {
  calls.list = [];
  const lm = createLanguageModel(p, model) as unknown as {
    provider: string;
    modelId: string;
    doStream: (o: unknown) => Promise<unknown>;
  };
  await lm
    .doStream({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }], temperature: 0.3, maxOutputTokens: 100 })
    .catch(() => {});
  const c = calls.list[0];
  return { lm, url: c?.url, providerId: c?.providerId, body: c?.init?.body ? JSON.parse(String(c.init.body)) : null, init: c?.init };
}

describe("createLanguageModel", () => {
  it("uses openai-compatible for LM Studio with its base URL and the proxy", async () => {
    const r = await firstRequest(prov("lmstudio", { baseUrl: "http://192.168.1.20:1234/v1/" }), "qwen3.5-9b");
    expect(r.lm.provider).toContain("lmstudio");
    expect(r.url).toBe("http://192.168.1.20:1234/v1/chat/completions");
    expect(r.providerId).toBe("id-lmstudio");
    expect(r.body.model).toBe("qwen3.5-9b");
    expect(r.body.stream_options).toEqual({ include_usage: true });
  });

  it("defaults local base URLs", async () => {
    expect((await firstRequest(prov("lmstudio"))).url).toBe("http://localhost:1234/v1/chat/completions");
    expect((await firstRequest(prov("ollama"))).url).toBe("http://localhost:11434/v1/chat/completions");
  });

  it.each([
    ["anthropic", "anthropic", "https://api.anthropic.com/v1/messages"],
    ["openai", "openai", "https://api.openai.com/v1/responses"],
    ["xai", "xai", "https://api.x.ai/v1/responses"],
    ["xai-oauth", "xai", "https://api.x.ai/v1/responses"],
    ["groq", "groq", "https://api.groq.com/openai/v1/chat/completions"],
    ["openrouter", "openrouter", "https://openrouter.ai/api/v1/chat/completions"],
    ["deepseek", "deepseek", "https://api.deepseek.com/v1/chat/completions"],
    ["mistral", "mistral", "https://api.mistral.ai/v1/chat/completions"],
  ] as const)("%s → %s SDK at %s", async (type, sdk, url) => {
    const r = await firstRequest(prov(type));
    expect(r.lm.provider).toContain(sdk);
    expect(r.url).toBe(url);
    expect(r.providerId).toBe(`id-${type}`);
  });

  it("google uses the Gemini API", async () => {
    const r = await firstRequest(prov("google"), "gemini-2.5-flash");
    expect(r.lm.provider).toContain("google");
    expect(r.url).toMatch(/^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-2\.5-flash:streamGenerateContent/);
  });

  it("ignores a stored base URL for fixed cloud providers", async () => {
    expect((await firstRequest(prov("anthropic", { baseUrl: "https://evil.example/v1" }))).url).toBe(
      "https://api.anthropic.com/v1/messages",
    );
  });

  it("ChatGPT OAuth uses the Responses API with store false and no temperature/max tokens", async () => {
    const r = await firstRequest(prov("chatgpt-oauth"), "gpt-5");
    expect(r.lm.provider).toContain("openai");
    expect(r.url).toBe("https://api.openai.com/v1/responses");
    expect(r.body.store).toBe(false);
    expect(r.body.stream).toBe(true);
    expect(r.body).not.toHaveProperty("temperature");
    expect(r.body).not.toHaveProperty("max_output_tokens");
  });

  it("openai-compatible requires a base URL", () => {
    expect(() => createLanguageModel(prov("openai-compatible"), "m")).toThrow(/base URL/);
  });
});

describe("chatgptFetch", () => {
  it("rewrites JSON bodies", async () => {
    const inner = vi.fn(async () => new Response("ok"));
    await chatgptFetch(inner as unknown as typeof fetch)("https://api.openai.com/v1/responses", {
      method: "POST",
      body: JSON.stringify({ model: "m", temperature: 1, max_output_tokens: 5, store: true, previous_response_id: "x" }),
    });
    const sent = JSON.parse(String((inner.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(sent).toEqual({ model: "m", store: false });
  });
});

describe("callOptions", () => {
  it("turns reasoning off for LM Studio when thinking is off", () => {
    expect(callOptions(prov("lmstudio"), { thinking: false })).toEqual({ reasoning: "none" });
    expect(callOptions(prov("lmstudio"), { thinking: true })).toEqual({});
    expect(callOptions(prov("ollama"), { thinking: false }).reasoning).toBe("none");
  });

  it("does not send reasoning none to providers without the toggle", () => {
    expect(callOptions(prov("anthropic"), { thinking: false }).reasoning).toBeUndefined();
  });

  it("omits temperature and max tokens for ChatGPT OAuth and forces store false", () => {
    const o = callOptions(prov("chatgpt-oauth"), { thinking: false, temperature: 0.2, maxOutputTokens: 4000 });
    expect(o.temperature).toBeUndefined();
    expect(o.maxOutputTokens).toBeUndefined();
    expect(o.providerOptions).toEqual({ openai: { store: false } });
  });

  it("passes temperature through where supported and never adds a token limit", () => {
    expect(callOptions(prov("openai"), { temperature: 0.2 })).toEqual({ temperature: 0.2 });
    expect(callOptions(prov("lmstudio"), {})).toEqual({});
  });
});

describe("model controls", () => {
  const eff = (t: ProviderType, reasoning: Parameters<typeof callOptions>[1] extends infer I ? (I extends { reasoning?: infer R } ? R : never) : never) =>
    callOptions(prov(t), { reasoning }).reasoning;

  it("anthropic: low to Max, plus off via the thinking toggle", () => {
    expect(catalog.anthropic.capabilities.reasoningLevels?.map((l) => l.label)).toEqual(["Low", "Medium", "High", "Max"]);
    expect(catalog.anthropic.capabilities.reasoningLabel).toBe("Effort");
    expect(eff("anthropic", "xhigh")).toBe("xhigh");
    expect(eff("anthropic", "none")).toBe("none");
    expect(eff("anthropic", "minimal")).toBeUndefined();
  });

  it("openai and chatgpt-oauth: minimal to high with verbosity", () => {
    for (const t of ["openai", "chatgpt-oauth"] as const) {
      expect(catalog[t].capabilities.reasoningLevels?.map((l) => l.value)).toEqual(["minimal", "low", "medium", "high"]);
      expect(eff(t, "minimal")).toBe("minimal");
      expect(eff(t, "xhigh")).toBeUndefined();
      expect(eff(t, "none")).toBeUndefined();
    }
    expect(callOptions(prov("openai"), { verbosity: "low" }).providerOptions).toEqual({ openai: { textVerbosity: "low" } });
    expect(callOptions(prov("chatgpt-oauth"), { verbosity: "high" }).providerOptions).toEqual({
      openai: { textVerbosity: "high", store: false },
    });
    expect(callOptions(prov("anthropic"), { verbosity: "low" }).providerOptions).toBeUndefined();
  });

  it("google: off, low, medium, high", () => {
    expect(catalog.google.capabilities.reasoningLevels?.map((l) => l.label)).toEqual(["Off", "Low", "Medium", "High"]);
    expect(catalog.google.capabilities.reasoningLabel).toBe("Thinking");
    expect(eff("google", "none")).toBe("none");
    expect(eff("google", "high")).toBe("high");
  });

  it("xai and xai-oauth: low and high only", () => {
    for (const t of ["xai", "xai-oauth"] as const) {
      expect(eff(t, "high")).toBe("high");
      expect(eff(t, "medium")).toBeUndefined();
    }
  });

  it("openrouter: three levels and the thinking toggle", () => {
    expect(eff("openrouter", "medium")).toBe("medium");
    expect(eff("openrouter", "none")).toBe("none");
    expect(eff("openrouter", "xhigh")).toBeUndefined();
  });

  it("local providers: toggle only, no levels", () => {
    for (const t of ["lmstudio", "ollama"] as const) {
      expect(catalog[t].capabilities.reasoningLevels).toBeNull();
      expect(eff(t, "none")).toBe("none");
      expect(eff(t, "high")).toBeUndefined();
    }
  });

  it("groq, mistral, deepseek, openai-compatible, llamacpp: no reasoning control", () => {
    for (const t of ["groq", "mistral", "deepseek", "openai-compatible", "llamacpp"] as const) {
      expect(catalog[t].capabilities.reasoningLevels).toBeNull();
      expect(eff(t, "none")).toBeUndefined();
      expect(eff(t, "high")).toBeUndefined();
    }
  });

  it("offers temperature only on openai-compatible endpoints that accept it", () => {
    expect(offersTemperature(prov("openrouter"))).toBe(true);
    expect(offersTemperature(prov("groq"))).toBe(true);
    expect(offersTemperature(prov("anthropic"))).toBe(false);
    expect(offersTemperature(prov("chatgpt-oauth"))).toBe(false);
  });

  it("defaults thinking off only for toggle providers", () => {
    expect(resolveControls(prov("lmstudio"))).toEqual({ reasoning: "none" });
    expect(resolveControls(prov("openrouter"), { reasoning: "high" })).toEqual({ reasoning: "high" });
    expect(resolveControls(prov("anthropic"))).toEqual({});
    expect(controlsKey("p", "m")).toBe("p:m");
  });
});

describe("listModels", () => {
  it("parses OpenAI-style, Anthropic and Gemini lists", async () => {
    const respond = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    const oa = respond({ data: [{ id: "b" }, { id: "a" }, { id: "a" }] });
    expect(await listModels(prov("lmstudio"), { fetch: oa as unknown as typeof fetch })).toEqual(["a", "b"]);
    expect((oa.mock.calls[0] as unknown as [string])[0]).toBe("http://localhost:1234/v1/models");

    const an = respond({ data: [{ id: "claude-x" }] });
    expect(await listModels(prov("anthropic"), { fetch: an as unknown as typeof fetch })).toEqual(["claude-x"]);
    const anInit = (an.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((anInit.headers as Record<string, string>)["anthropic-version"]).toBe("2023-06-01");

    const g = respond({
      models: [
        { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] },
        { name: "models/embedding-001", supportedGenerationMethods: ["embedContent"] },
      ],
    });
    expect(await listModels(prov("google"), { fetch: g as unknown as typeof fetch })).toEqual(["gemini-2.5-flash"]);
  });

  it("surfaces API error messages", async () => {
    const bad = vi.fn(async () => new Response(JSON.stringify({ error: { message: "Invalid API key" } }), { status: 401 }));
    await expect(listModels(prov("openai"), { fetch: bad as unknown as typeof fetch })).rejects.toThrow("401: Invalid API key");
  });
});

describe("resolveModel", () => {
  const a = prov("lmstudio", { id: "a", config: { models: ["text-embedding-x", "qwen"], defaultModel: undefined } });
  const b = prov("openai", { id: "b", config: { defaultModel: "gpt-x" } });
  const providers = [a, b];

  it("space override wins", () => {
    expect(resolveModel({ providerId: "a", model: "m1" }, { providerId: "b", model: "m2" }, providers)).toEqual({
      provider: b,
      modelId: "m2",
    });
  });

  it("falls back to the app default when the override is missing or stale", () => {
    expect(resolveModel({ providerId: "a", model: "m1" }, null, providers)?.modelId).toBe("m1");
    expect(resolveModel({ providerId: "a", model: "m1" }, { providerId: "gone", model: "x" }, providers)?.modelId).toBe("m1");
  });

  it("falls back to the first provider's default model, skipping embeddings", () => {
    expect(resolveModel(null, null, providers)).toEqual({ provider: a, modelId: "qwen" });
    expect(resolveModel({ providerId: "gone", model: "x" }, undefined, [b])).toEqual({ provider: b, modelId: "gpt-x" });
  });

  it("returns null without usable providers", () => {
    expect(resolveModel(null, null, [])).toBeNull();
    expect(resolveModel(null, null, [prov("openai", { config: {} })])).toBeNull();
  });
});

describe("model button labels", () => {
  it("drops the vendor prefix", () => {
    expect(modelLabel("anthropic/claude-haiku-4.5")).toBe("claude-haiku-4.5");
    expect(modelLabel("qwen3.5-9b")).toBe("qwen3.5-9b");
  });

  it("shows the chosen level", () => {
    expect(effortLabel(prov("openai"), { reasoning: "high" })).toBe("High");
    expect(effortLabel(prov("openai"))).toBe("");
    expect(effortLabel(prov("anthropic"), { reasoning: "xhigh" })).toBe("Max");
  });

  it("shows Thinking for a bare switch and nothing when off", () => {
    expect(effortLabel(prov("lmstudio"))).toBe("");
    expect(effortLabel(prov("lmstudio"), { reasoning: "medium" })).toBe("Thinking");
    expect(thinkingOn(prov("lmstudio"))).toBe(false);
    expect(thinkingOn(prov("lmstudio"), { reasoning: "medium" })).toBe(true);
    expect(thinkingOn(prov("anthropic"))).toBe(true);
  });
});
