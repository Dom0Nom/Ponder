import { describe, expect, it, vi } from "vitest";
import type { OpenRouterModel, Provider, ProviderType } from "../types";

vi.mock("../ipc", () => ({ api: { listOpenrouterModels: vi.fn() } }));

import { openRouterFixture } from "../../test/openrouterFixture";
import { catalog } from "./catalog";
import { modelCapabilities, sanitizeControls, temperatureAvailable } from "./controls";
import { callOptions } from "./model";
import { parseClaude, type ModelCaps } from "./modelCaps";

const prov = (type: ProviderType): Provider => ({ id: type, type, kind: catalog[type].kind, name: type, baseUrl: null, config: {}, createdAt: 0 });
const or = (id: string): OpenRouterModel => {
  const m = openRouterFixture.find((x) => x.id === id);
  if (!m) throw new Error(`fixture lacks ${id}`);
  return m;
};
const caps = (type: ProviderType, model: string) => modelCapabilities(prov(type), model, type === "openrouter" ? or(model) : undefined);
const brief = (c: ModelCaps) => ({
  effort: c.effort ? { values: c.effort.options.map((o) => o.value), default: c.effort.default } : null,
  thinking: c.thinking ? { default: c.thinking.default, offMax: c.thinking.offMaxEffort ?? null } : null,
  temperature: !!c.temperature,
  verbosity: !!c.verbosity,
});
const FIVE = ["low", "medium", "high", "xhigh", "max"];

describe("model capabilities", () => {
  it("parses Claude ids from direct and OpenRouter spellings", () => {
    expect(parseClaude("claude-haiku-5-5")).toEqual({ family: "haiku", version: 5.5 });
    expect(parseClaude("anthropic/claude-haiku-5.5")).toEqual({ family: "haiku", version: 5.5 });
    expect(parseClaude("claude-sonnet-4-5-20250929")).toEqual({ family: "sonnet", version: 4.5 });
    expect(parseClaude("claude-sonnet-4-20250514")).toEqual({ family: "sonnet", version: 4 });
    expect(parseClaude("Sonnet 5.5")).toEqual({ family: "sonnet", version: 5.5 });
    expect(parseClaude("gpt-6")).toBeNull();
  });

  it.each([
    ["anthropic", "claude-haiku-5-5", { effort: { values: FIVE, default: "medium" }, thinking: { default: true, offMax: "high" }, temperature: false, verbosity: false }],
    ["anthropic", "claude-sonnet-5-5", { effort: { values: FIVE, default: "high" }, thinking: { default: true, offMax: "high" }, temperature: false, verbosity: false }],
    ["anthropic", "claude-opus-5-5", { effort: { values: FIVE, default: "medium" }, thinking: null, temperature: false, verbosity: false }],
    ["anthropic", "claude-fable-5-1", { effort: { values: FIVE, default: "high" }, thinking: null, temperature: false, verbosity: false }],
    ["anthropic", "claude-opus-4-7", { effort: { values: FIVE, default: "high" }, thinking: { default: false, offMax: null }, temperature: false, verbosity: false }],
    ["anthropic", "claude-sonnet-4-6", { effort: { values: ["low", "medium", "high", "max"], default: "high" }, thinking: { default: false, offMax: null }, temperature: true, verbosity: false }],
    ["anthropic", "claude-opus-4-5-20251101", { effort: { values: ["low", "medium", "high"], default: "high" }, thinking: { default: false, offMax: null }, temperature: true, verbosity: false }],
    ["anthropic", "claude-haiku-4-5", { effort: null, thinking: { default: false, offMax: null }, temperature: true, verbosity: false }],
    ["openai", "gpt-6.1-sol", { effort: { values: FIVE, default: "medium" }, thinking: null, temperature: false, verbosity: true }],
    ["openai", "gpt-6-luna", { effort: { values: ["none", ...FIVE], default: "medium" }, thinking: null, temperature: true, verbosity: true }],
    ["openai", "gpt-5-mini", { effort: { values: ["minimal", "low", "medium", "high"], default: "medium" }, thinking: null, temperature: false, verbosity: true }],
    ["openai", "gpt-4.1", { effort: null, thinking: null, temperature: true, verbosity: false }],
    ["google", "gemini-3.8-flash", { effort: { values: ["low", "medium", "high"], default: "medium" }, thinking: null, temperature: true, verbosity: false }],
    ["google", "gemini-3.5-flash", { effort: { values: ["minimal", "low", "medium", "high"], default: "medium" }, thinking: null, temperature: true, verbosity: false }],
    ["google", "gemini-2.5-flash", { effort: null, thinking: { default: true, offMax: null }, temperature: true, verbosity: false }],
    ["google", "gemini-2.5-pro", { effort: null, thinking: null, temperature: true, verbosity: false }],
    ["xai", "grok-4.7", { effort: { values: ["low", "medium", "high", "xhigh"], default: "high" }, thinking: null, temperature: true, verbosity: false }],
    ["deepseek", "deepseek-v4-flash", { effort: { values: ["low", "high", "max"], default: "high" }, thinking: { default: true, offMax: null }, temperature: true, verbosity: false }],
    ["lmstudio", "qwen3.5-9b", { effort: null, thinking: { default: true, offMax: null }, temperature: true, verbosity: false }],
    ["lmstudio", "llama-3.3-70b-instruct", { effort: null, thinking: null, temperature: true, verbosity: false }],
    ["ollama", "gpt-oss:20b", { effort: { values: ["low", "medium", "high"], default: "medium" }, thinking: null, temperature: true, verbosity: false }],
    ["llamacpp", "anything.gguf", { effort: null, thinking: null, temperature: true, verbosity: false }],
    ["anthropic", "some-new-model", { effort: null, thinking: null, temperature: false, verbosity: false }],
    ["openai-compatible", "mystery", { effort: null, thinking: null, temperature: true, verbosity: false }],
  ] as const)("%s / %s", (type, model, expected) => {
    expect(brief(caps(type, model))).toEqual(expected);
  });

  it("OpenRouter narrows family rules by what the endpoint reports", () => {
    const FIVE_DESC = FIVE;
    expect(brief(caps("openrouter", "anthropic/claude-haiku-5.5"))).toEqual({
      effort: { values: FIVE_DESC, default: "medium" },
      thinking: { default: true, offMax: "high" },
      temperature: false,
      verbosity: false,
    });
    // mandatory reasoning: no thinking switch, even where the direct API has one
    expect(brief(caps("openrouter", "anthropic/claude-sonnet-5.5")).thinking).toBeNull();
    expect(brief(caps("openrouter", "anthropic/claude-opus-5.5"))).toEqual({
      effort: { values: FIVE_DESC, default: "medium" },
      thinking: null,
      temperature: false,
      verbosity: false,
    });
    expect(brief(caps("openrouter", "deepseek/deepseek-v4.1-flash"))).toEqual({
      effort: { values: ["low", "high", "max"], default: "high" },
      thinking: { default: true, offMax: null },
      temperature: true,
      verbosity: false,
    });
    expect(brief(caps("openrouter", "openai/gpt-6-luna")).effort?.values).toEqual(["none", ...FIVE]);
    expect(brief(caps("openrouter", "openai/gpt-6.1-sol")).effort?.values).toEqual(FIVE);
    expect(brief(caps("openrouter", "google/gemini-3.8-flash")).effort?.values).toEqual(["low", "medium", "high"]);
  });

  it("OpenRouter models without the parameter get no control for it", () => {
    expect(brief(caps("openrouter", "meta-llama/llama-4-maverick"))).toEqual({ effort: null, thinking: null, temperature: true, verbosity: false });
    const toggleOnly = brief(caps("openrouter", "qwen/qwen3.8-flash"));
    expect(toggleOnly.effort).toBeNull();
    expect(toggleOnly.thinking).toEqual({ default: true, offMax: null });
    // Mistral reports only high/none: that is a switch, not a scale
    const mistral = brief(caps("openrouter", "mistralai/mistral-large-4-0"));
    expect(mistral.effort).toBeNull();
    expect(mistral.thinking).not.toBeNull();
    const noTemp = { ...or("meta-llama/llama-4-maverick"), supportedParameters: [] };
    expect(modelCapabilities(prov("openrouter"), noTemp.id, noTemp).temperature).toBeNull();
  });

  it("drops stored values the model doesn't offer", () => {
    const haiku = caps("openrouter", "anthropic/claude-haiku-5.5");
    expect(sanitizeControls(haiku, { effort: "xhigh", temperature: 0.3, verbosity: "low", thinking: false })).toEqual({ effort: "xhigh", thinking: false });
    const opus = caps("anthropic", "claude-opus-5-5");
    expect(sanitizeControls(opus, { effort: "minimal", thinking: false })).toEqual({});
    const lm = caps("lmstudio", "qwen3.5-9b");
    expect(sanitizeControls(lm, { effort: "high", thinking: false, temperature: 0.7 })).toEqual({ thinking: false, temperature: 0.7 });
    expect(sanitizeControls(lm, { temperature: 0.55 })).toEqual({});
  });

  it("hides temperature while a thinking mode that forbids it is active", () => {
    const old = caps("anthropic", "claude-sonnet-4-6");
    expect(temperatureAvailable(old, {})).toBe(true);
    expect(temperatureAvailable(old, { thinking: true })).toBe(false);
    const luna = caps("openai", "gpt-6-luna");
    expect(temperatureAvailable(luna, {})).toBe(false);
    expect(temperatureAvailable(luna, { effort: "none" })).toBe(true);
  });
});

describe("request mapping", () => {
  const opts = (type: ProviderType, model: string, input: Parameters<typeof callOptions>[2]) =>
    callOptions(prov(type), model, input, type === "openrouter" ? or(model) : undefined);

  it("Anthropic direct: output_config.effort and thinking type", () => {
    expect(opts("anthropic", "claude-haiku-5-5", { effort: "low", thinking: false })).toEqual({
      providerOptions: { anthropic: { effort: "low", thinking: { type: "disabled" } } },
    });
    // off is rejected above high effort, so it isn't sent
    expect(opts("anthropic", "claude-haiku-5-5", { effort: "xhigh", thinking: false })).toEqual({ providerOptions: { anthropic: { effort: "xhigh" } } });
    expect(opts("anthropic", "claude-sonnet-5-5", { thinking: false })).toEqual({ providerOptions: { anthropic: { thinking: { type: "between_tools" } } } });
    expect(opts("anthropic", "claude-opus-5-5", { effort: "max", thinking: false, temperature: 0.2 })).toEqual({ providerOptions: { anthropic: { effort: "max" } } });
    expect(opts("anthropic", "claude-opus-4-8", { thinking: true })).toEqual({
      providerOptions: { anthropic: { thinking: { type: "adaptive", display: "summarized" } } },
    });
    expect(opts("anthropic", "claude-haiku-4-5", { thinking: true, temperature: 0.2 })).toEqual({
      providerOptions: { anthropic: { thinking: { type: "enabled", budgetTokens: 8000 } } },
    });
    expect(opts("anthropic", "claude-haiku-4-5", { temperature: 0.2 })).toEqual({ temperature: 0.2 });
    expect(opts("anthropic", "claude-opus-5-5", {})).toEqual({});
  });

  it("OpenAI: reasoning effort and verbosity; no temperature while reasoning", () => {
    expect(opts("openai", "gpt-6-luna", { effort: "low", verbosity: "low", temperature: 0.4 })).toEqual({
      providerOptions: { openai: { reasoningEffort: "low", textVerbosity: "low" } },
    });
    expect(opts("openai", "gpt-6-luna", { effort: "none", temperature: 0.4 })).toEqual({
      temperature: 0.4,
      providerOptions: { openai: { reasoningEffort: "none" } },
    });
    expect(opts("openai", "gpt-6-luna", { thinking: false })).toEqual({ providerOptions: { openai: { reasoningEffort: "none" } } });
    expect(opts("openai", "gpt-6.1-sol", { thinking: false })).toEqual({});
    expect(opts("openai", "gpt-4.1", { effort: "high", verbosity: "high" })).toEqual({});
  });

  it("Gemini: thinking level, or budget 0 to switch off", () => {
    expect(opts("google", "gemini-3.5-flash", { effort: "minimal" })).toEqual({ providerOptions: { google: { thinkingConfig: { thinkingLevel: "minimal" } } } });
    expect(opts("google", "gemini-3.8-flash", { effort: "minimal" })).toEqual({});
    expect(opts("google", "gemini-2.5-flash", { thinking: false })).toEqual({ providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } } });
  });

  it("xAI: reasoning effort", () => {
    expect(opts("xai", "grok-4.7", { effort: "xhigh" })).toEqual({ providerOptions: { xai: { reasoningEffort: "xhigh" } } });
    expect(opts("xai", "grok-4.7", { effort: "max" })).toEqual({});
  });

  it("DeepSeek direct: thinking object and reasoning effort", () => {
    expect(opts("deepseek", "deepseek-v4-flash", { effort: "max" })).toEqual({ providerOptions: { deepseek: { reasoningEffort: "max" } } });
    expect(opts("deepseek", "deepseek-v4-flash", { thinking: false, temperature: 0.3 })).toEqual({
      temperature: 0.3,
      providerOptions: { deepseek: { thinking: { type: "disabled" } } },
    });
    expect(opts("deepseek", "deepseek-v4-flash", { temperature: 0.3 })).toEqual({});
  });

  it("OpenRouter: reasoning object and verbosity", () => {
    expect(opts("openrouter", "anthropic/claude-haiku-5.5", { effort: "low" })).toEqual({ providerOptions: { openrouter: { reasoning: { effort: "low" } } } });
    expect(opts("openrouter", "anthropic/claude-haiku-5.5", { thinking: false })).toEqual({ providerOptions: { openrouter: { reasoning: { enabled: false } } } });
    expect(opts("openrouter", "anthropic/claude-opus-5.5", { thinking: false })).toEqual({});
    expect(opts("openrouter", "deepseek/deepseek-v4.1-flash", { thinking: false })).toEqual({ providerOptions: { openrouter: { reasoning: { enabled: false } } } });
    expect(opts("openrouter", "openai/gpt-6-luna", { effort: "low", verbosity: "high" })).toEqual({
      providerOptions: { openrouter: { reasoning: { effort: "low" }, textVerbosity: "high" } },
    });
    expect(opts("openrouter", "meta-llama/llama-4-maverick", { effort: "high", thinking: false, temperature: 0.3 })).toEqual({ temperature: 0.3 });
  });

  it("local servers: thinking off via reasoning_effort none, temperature passes", () => {
    expect(opts("lmstudio", "qwen3.5-9b", { thinking: false, temperature: 0.3 })).toEqual({
      temperature: 0.3,
      providerOptions: { lmstudio: { reasoningEffort: "none" } },
    });
    expect(opts("lmstudio", "qwen3.5-9b", { thinking: true })).toEqual({});
    expect(opts("lmstudio", "llama-3.3-70b-instruct", { thinking: false })).toEqual({});
    expect(opts("ollama", "gpt-oss:20b", { effort: "high" })).toEqual({ providerOptions: { ollama: { reasoningEffort: "high" } } });
  });

  it("Mistral and Groq: thinking switch and gpt-oss effort", () => {
    expect(opts("mistral", "mistral-small-latest", { thinking: false })).toEqual({ providerOptions: { mistral: { reasoningEffort: "none" } } });
    expect(opts("groq", "openai/gpt-oss-120b", { effort: "low" })).toEqual({ providerOptions: { groq: { reasoningEffort: "low" } } });
  });

  it("only adds a token limit when asked, and never for ChatGPT sign-in", () => {
    expect(opts("openai", "gpt-6-luna", { maxOutputTokens: 500 })).toEqual({ maxOutputTokens: 500 });
    expect(opts("chatgpt-oauth", "gpt-6-luna", { maxOutputTokens: 500 })).toEqual({ providerOptions: { openai: { store: false } } });
  });
});
