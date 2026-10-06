import type { Provider, ProviderKind, ProviderType } from "../types";

export interface Capabilities {
  webSearch: "builtin" | "none";
  tts: boolean;
  images: boolean;
  temperature: boolean;
  maxOutputTokens: boolean;
  /** `reasoning: "none"` reliably turns thinking off */
  reasoningToggle: boolean;
  embeddings: boolean;
}

export type SdkKind = "anthropic" | "openai" | "google" | "xai" | "chatgpt" | "openai-compatible";

export interface CatalogEntry {
  type: ProviderType;
  label: string;
  kind: ProviderKind;
  sdk: SdkKind;
  defaultBaseUrl: string;
  /** base URL shown and editable in the add dialog */
  baseUrlEditable: boolean;
  needsKey: boolean;
  docsUrl: string;
  capabilities: Capabilities;
}

const cloud = (c: Partial<Capabilities> = {}): Capabilities => ({
  webSearch: "none",
  tts: false,
  images: false,
  temperature: true,
  maxOutputTokens: true,
  reasoningToggle: false,
  embeddings: false,
  ...c,
});

export const catalog: Record<ProviderType, CatalogEntry> = {
  anthropic: {
    type: "anthropic",
    label: "Anthropic (Claude)",
    kind: "apiKey",
    sdk: "anthropic",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    baseUrlEditable: false,
    needsKey: true,
    docsUrl: "https://console.anthropic.com/settings/keys",
    capabilities: cloud({ webSearch: "builtin" }),
  },
  openai: {
    type: "openai",
    label: "OpenAI",
    kind: "apiKey",
    sdk: "openai",
    defaultBaseUrl: "https://api.openai.com/v1",
    baseUrlEditable: false,
    needsKey: true,
    docsUrl: "https://platform.openai.com/api-keys",
    capabilities: cloud({ webSearch: "builtin", tts: true, images: true, embeddings: true }),
  },
  google: {
    type: "google",
    label: "Google Gemini",
    kind: "apiKey",
    sdk: "google",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    baseUrlEditable: false,
    needsKey: true,
    docsUrl: "https://aistudio.google.com/apikey",
    capabilities: cloud({ webSearch: "builtin", tts: true, images: true, embeddings: true }),
  },
  openrouter: {
    type: "openrouter",
    label: "OpenRouter",
    kind: "apiKey",
    sdk: "openai-compatible",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    baseUrlEditable: false,
    needsKey: true,
    docsUrl: "https://openrouter.ai/keys",
    capabilities: cloud({ webSearch: "builtin" }),
  },
  xai: {
    type: "xai",
    label: "xAI (Grok)",
    kind: "apiKey",
    sdk: "xai",
    defaultBaseUrl: "https://api.x.ai/v1",
    baseUrlEditable: false,
    needsKey: true,
    docsUrl: "https://console.x.ai",
    capabilities: cloud({ webSearch: "builtin", tts: true, images: true }),
  },
  groq: {
    type: "groq",
    label: "Groq",
    kind: "apiKey",
    sdk: "openai-compatible",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    baseUrlEditable: false,
    needsKey: true,
    docsUrl: "https://console.groq.com/keys",
    capabilities: cloud(),
  },
  mistral: {
    type: "mistral",
    label: "Mistral",
    kind: "apiKey",
    sdk: "openai-compatible",
    defaultBaseUrl: "https://api.mistral.ai/v1",
    baseUrlEditable: false,
    needsKey: true,
    docsUrl: "https://console.mistral.ai/api-keys",
    capabilities: cloud({ embeddings: true }),
  },
  deepseek: {
    type: "deepseek",
    label: "DeepSeek",
    kind: "apiKey",
    sdk: "openai-compatible",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    baseUrlEditable: false,
    needsKey: true,
    docsUrl: "https://platform.deepseek.com/api_keys",
    capabilities: cloud(),
  },
  "openai-compatible": {
    type: "openai-compatible",
    label: "OpenAI-compatible",
    kind: "apiKey",
    sdk: "openai-compatible",
    defaultBaseUrl: "",
    baseUrlEditable: true,
    needsKey: false,
    docsUrl: "https://platform.openai.com/docs/api-reference/chat",
    capabilities: cloud(),
  },
  lmstudio: {
    type: "lmstudio",
    label: "LM Studio",
    kind: "local",
    sdk: "openai-compatible",
    defaultBaseUrl: "http://localhost:1234/v1",
    baseUrlEditable: true,
    needsKey: false,
    docsUrl: "https://lmstudio.ai/docs/app/api",
    capabilities: cloud({ reasoningToggle: true, embeddings: true }),
  },
  ollama: {
    type: "ollama",
    label: "Ollama",
    kind: "local",
    sdk: "openai-compatible",
    defaultBaseUrl: "http://localhost:11434/v1",
    baseUrlEditable: true,
    needsKey: false,
    docsUrl: "https://docs.ollama.com/api/openai-compatibility",
    capabilities: cloud({ reasoningToggle: true, embeddings: true }),
  },
  llamacpp: {
    type: "llamacpp",
    label: "llama.cpp server",
    kind: "local",
    sdk: "openai-compatible",
    defaultBaseUrl: "http://localhost:8080/v1",
    baseUrlEditable: true,
    needsKey: false,
    docsUrl: "https://github.com/ggml-org/llama.cpp/tree/master/tools/server",
    capabilities: cloud({ embeddings: true }),
  },
  "chatgpt-oauth": {
    type: "chatgpt-oauth",
    label: "ChatGPT (sign in)",
    kind: "oauth",
    sdk: "chatgpt",
    defaultBaseUrl: "https://api.openai.com/v1",
    baseUrlEditable: false,
    needsKey: false,
    docsUrl: "https://developers.openai.com/siwc/token-sharing-open-source/sign-in",
    // preview limits: Responses API only, no temperature / max_output_tokens / images / audio
    capabilities: cloud({ webSearch: "builtin", temperature: false, maxOutputTokens: false }),
  },
  "xai-oauth": {
    type: "xai-oauth",
    label: "Grok (sign in)",
    kind: "oauth",
    sdk: "xai",
    defaultBaseUrl: "https://api.x.ai/v1",
    baseUrlEditable: false,
    needsKey: false,
    docsUrl: "https://x.ai/grok",
    capabilities: cloud({ webSearch: "builtin", tts: true, images: true }),
  },
};

/** Order of the "Add provider" grid. */
export const catalogOrder: ProviderType[] = [
  "lmstudio",
  "ollama",
  "llamacpp",
  "chatgpt-oauth",
  "xai-oauth",
  "anthropic",
  "openai",
  "google",
  "openrouter",
  "xai",
  "groq",
  "mistral",
  "deepseek",
  "openai-compatible",
];

export function entryFor(p: Pick<Provider, "type">): CatalogEntry {
  return catalog[p.type];
}

export function capabilitiesOf(p: Pick<Provider, "type">): Capabilities {
  return catalog[p.type].capabilities;
}

/** Base URL actually used for a provider, without a trailing slash. */
export function baseUrlOf(p: Pick<Provider, "type" | "baseUrl">): string {
  const entry = catalog[p.type];
  const url = (entry.baseUrlEditable && p.baseUrl?.trim()) || entry.defaultBaseUrl;
  return url.replace(/\/+$/, "");
}

const NON_CHAT = /(embed|embedding|whisper|tts|rerank|moderation|dall-e|image)/i;

/** Chat model to preselect: the configured default, else the first model that isn't an embedding/TTS model. */
export function pickDefaultModel(models: string[], current?: string | null): string | undefined {
  if (current && models.includes(current)) return current;
  return models.find((m) => !NON_CHAT.test(m)) ?? models[0];
}
