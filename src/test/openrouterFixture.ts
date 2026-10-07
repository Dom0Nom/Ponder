import type { OpenRouterModel } from "../lib/types";

const REASON_EFFORT = ["reasoning", "reasoning_effort", "include_reasoning", "temperature"];
const REASON_ONLY = ["reasoning", "include_reasoning", "temperature"];
const PLAIN = ["temperature"];

const m = (id: string, name: string, supportedParameters: string[], created: number): OpenRouterModel => ({
  id,
  name,
  contextLength: 128000,
  supportedParameters,
  created,
});

export const openRouterFixture: OpenRouterModel[] = [
  m("anthropic/claude-opus-5.5", "Anthropic: Claude Opus 5.5", REASON_ONLY, 1790094732),
  m("anthropic/claude-sonnet-5.5", "Anthropic: Claude Sonnet 5.5", REASON_ONLY, 1790618686),
  m("anthropic/claude-haiku-5.5", "Anthropic: Claude Haiku 5.5", REASON_ONLY, 1791397883),
  m("anthropic/claude-haiku-4.5", "Anthropic: Claude Haiku 4.5", REASON_ONLY, 1760000000),
  m("openai/gpt-6.1-sol", "OpenAI: GPT-6.1 Sol", ["reasoning", "reasoning_effort", "include_reasoning", "verbosity"], 1790702882),
  m("openai/gpt-6-luna", "OpenAI: GPT-6 Luna", ["reasoning", "reasoning_effort", "include_reasoning", "verbosity"], 1790100786),
  m("openai/gpt-5.4-mini", "OpenAI: GPT-5.4 Mini", ["reasoning", "reasoning_effort", "include_reasoning", "verbosity"], 1780000000),
  m("openai/gpt-4o-mini", "OpenAI: GPT-4o Mini", PLAIN, 1721260800),
  m("google/gemini-3.1-pro-preview", "Google: Gemini 3.1 Pro Preview", REASON_ONLY, 1785000000),
  m("google/gemini-3.8-flash", "Google: Gemini 3.8 Flash", REASON_ONLY, 1788362056),
  m("google/gemma-3-27b-it", "Google: Gemma 3 27B", PLAIN, 1741000000),
  m("deepseek/deepseek-v4-pro", "DeepSeek: DeepSeek V4 Pro", REASON_EFFORT, 1777000679),
  m("deepseek/deepseek-v4.1-flash", "DeepSeek: DeepSeek V4.1 Flash", REASON_EFFORT, 1789021285),
  m("meta-llama/llama-4-maverick", "Meta: Llama 4 Maverick", PLAIN, 1743881822),
  m("meta-llama/llama-3.3-70b-instruct", "Meta: Llama 3.3 70B Instruct", PLAIN, 1733506137),
  m("mistralai/mistral-large-4-0", "Mistral: Mistral Large 4", REASON_EFFORT, 1791294122),
  m("mistralai/mistral-small-2603", "Mistral: Mistral Small 2603", REASON_EFFORT, 1773695685),
  m("x-ai/grok-4.7", "xAI: Grok 4.7", REASON_EFFORT, 1790007541),
  m("qwen/qwen3.8-max-0902", "Qwen: Qwen3.8 Max", REASON_EFFORT, 1788469704),
  m("qwen/qwen3.8-flash", "Qwen: Qwen3.8 Flash", REASON_ONLY, 1787773060),
  m("cohere/command-a", "Cohere: Command A", PLAIN, 1741700000),
  m("nvidia/nemotron-ultra", "NVIDIA: Nemotron Ultra", PLAIN, 1750000000),
];
