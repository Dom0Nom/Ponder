import type { OpenRouterModel, OpenRouterReasoning } from "../lib/types";

const REASON_EFFORT = ["reasoning", "reasoning_effort", "include_reasoning", "temperature"];
const REASON_ONLY = ["reasoning", "include_reasoning", "temperature"];
const PLAIN = ["temperature"];

const rs = (supportedEfforts: string[] | null, defaultEffort: string | null, mandatory = false, defaultEnabled: boolean | null = null): OpenRouterReasoning => ({
  mandatory,
  supportedEfforts,
  defaultEffort,
  defaultEnabled,
  supportsMaxTokens: false,
});

const m = (id: string, name: string, supportedParameters: string[], created: number, reasoning: OpenRouterReasoning | null = null): OpenRouterModel => ({
  id,
  name,
  contextLength: 128000,
  supportedParameters,
  created,
  reasoning,
});

const FIVE = ["max", "xhigh", "high", "medium", "low"];

export const openRouterFixture: OpenRouterModel[] = [
  m("anthropic/claude-opus-5.5", "Anthropic: Claude Opus 5.5", REASON_EFFORT, 1790094732, rs(FIVE, "high", true)),
  m("anthropic/claude-sonnet-5.5", "Anthropic: Claude Sonnet 5.5", REASON_EFFORT, 1790618686, rs(FIVE, "high", true)),
  m("anthropic/claude-haiku-5.5", "Anthropic: Claude Haiku 5.5", REASON_EFFORT, 1791397883, rs(FIVE, "medium")),
  m("anthropic/claude-haiku-4.5", "Anthropic: Claude Haiku 4.5", REASON_ONLY, 1760000000, rs(null, null)),
  m("openai/gpt-6.1-sol", "OpenAI: GPT-6.1 Sol", ["reasoning", "reasoning_effort", "include_reasoning", "verbosity"], 1790702882, rs(FIVE, "medium", true, true)),
  m("openai/gpt-6-luna", "OpenAI: GPT-6 Luna", ["reasoning", "reasoning_effort", "include_reasoning", "verbosity"], 1790100786, rs([...FIVE, "none"], "medium", false, true)),
  m("openai/gpt-5.4-mini", "OpenAI: GPT-5.4 Mini", ["reasoning", "reasoning_effort", "include_reasoning", "verbosity"], 1780000000),
  m("openai/gpt-4o-mini", "OpenAI: GPT-4o Mini", PLAIN, 1721260800),
  m("google/gemini-3.1-pro-preview", "Google: Gemini 3.1 Pro Preview", REASON_ONLY, 1785000000),
  m("google/gemini-3.8-flash", "Google: Gemini 3.8 Flash", REASON_EFFORT, 1788362056, rs(["high", "medium", "low"], "medium", true, true)),
  m("google/gemma-3-27b-it", "Google: Gemma 3 27B", PLAIN, 1741000000),
  m("deepseek/deepseek-v4-pro", "DeepSeek: DeepSeek V4 Pro", REASON_EFFORT, 1777000679, rs(["xhigh", "high"], "high")),
  m("deepseek/deepseek-v4.1-flash", "DeepSeek: DeepSeek V4.1 Flash", REASON_EFFORT, 1789021285, rs(["max", "high", "low"], "high", false, true)),
  m("xiaomi/mimo-v2.6-pro", "Xiaomi: MiMo V2.6 Pro", REASON_ONLY, 1789000000),
  m("meta-llama/llama-4-maverick", "Meta: Llama 4 Maverick", PLAIN, 1743881822),
  m("meta-llama/llama-3.3-70b-instruct", "Meta: Llama 3.3 70B Instruct", PLAIN, 1733506137),
  m("mistralai/mistral-large-4-0", "Mistral: Mistral Large 4", REASON_EFFORT, 1791294122, rs(["high", "none"], "high", false, true)),
  m("mistralai/mistral-small-2603", "Mistral: Mistral Small 2603", REASON_EFFORT, 1773695685),
  m("x-ai/grok-4.7", "xAI: Grok 4.7", REASON_EFFORT, 1790007541, rs(["xhigh", "high", "medium", "low"], "high", true, true)),
  m("qwen/qwen3.8-max-0902", "Qwen: Qwen3.8 Max", REASON_EFFORT, 1788469704),
  m("qwen/qwen3.8-flash", "Qwen: Qwen3.8 Flash", REASON_ONLY, 1787773060, { ...rs(null, null, false, true), supportsMaxTokens: true }),
  m("cohere/command-a", "Cohere: Command A", PLAIN, 1741700000),
  m("nvidia/nemotron-ultra", "NVIDIA: Nemotron Ultra", PLAIN, 1750000000),
];
