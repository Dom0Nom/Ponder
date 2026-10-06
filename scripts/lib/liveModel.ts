import { callOptions, createLanguageModel } from "../../src/lib/providers/model";
import type { ResolvedModel } from "../../src/lib/chat/llm";
import type { Provider } from "../../src/lib/types";

/**
 * A model for live scripts. With OPENROUTER_API_KEY set it uses OpenRouter (the key is added to
 * the request here, standing in for the Rust proxy); otherwise LM Studio.
 */
export function liveModel(modelId?: string): ResolvedModel {
  const key = process.env.OPENROUTER_API_KEY;
  const provider: Provider = key
    ? { id: "live-openrouter", type: "openrouter", kind: "apiKey", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", config: {}, createdAt: 0 }
    : { id: "live-lmstudio", type: "lmstudio", kind: "local", name: "LM Studio", baseUrl: process.env.LMSTUDIO_URL ?? "http://192.168.1.20:1234/v1", config: {}, createdAt: 0 };
  const id = modelId ?? (key ? "deepseek/deepseek-v4.1-flash" : "qwen3.5-9b");
  const fetchWithKey: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    if (key) headers.set("Authorization", `Bearer ${key}`);
    return fetch(input, { ...init, headers });
  };
  return {
    provider,
    modelId: id,
    model: createLanguageModel(provider, id, { fetch: fetchWithKey as typeof fetch }),
    options: (o) => callOptions(provider, o),
  };
}

/** A vision-capable model for live scripts. VISION_MODEL overrides; the OpenRouter default is a cheap Gemini. */
export function liveVisionModel(modelId?: string): ResolvedModel {
  const id = modelId ?? process.env.VISION_MODEL ?? (process.env.OPENROUTER_API_KEY ? "google/gemini-3.5-flash-lite" : undefined);
  return liveModel(id);
}
