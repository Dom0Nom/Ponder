import anthropic from "../../assets/providers/anthropic.png";
import deepseek from "../../assets/providers/deepseek.png";
import google from "../../assets/providers/google.png";
import groq from "../../assets/providers/groq.png";
import llamacpp from "../../assets/providers/llamacpp.png";
import lmstudio from "../../assets/providers/lmstudio.png";
import meta from "../../assets/providers/meta.svg";
import mistral from "../../assets/providers/mistral.png";
import ollama from "../../assets/providers/ollama.png";
import openai from "../../assets/providers/openai.png";
import openrouter from "../../assets/providers/openrouter.png";
import qwen from "../../assets/providers/qwen.png";
import xai from "../../assets/providers/xai.png";
import type { ProviderType } from "../types";

const byType: Partial<Record<ProviderType, string>> = {
  openrouter,
  lmstudio,
  ollama,
  llamacpp,
  anthropic,
  openai,
  google,
  xai,
  groq,
  mistral,
  deepseek,
  "chatgpt-oauth": openai,
  "xai-oauth": xai,
};

/** OpenRouter model authors (the vendor prefix of a model id). */
const byAuthor: Record<string, string> = {
  anthropic,
  openai,
  google,
  deepseek,
  "meta-llama": meta,
  mistralai: mistral,
  "x-ai": xai,
  qwen,
  groq,
};

export const providerIconUrl = (type: ProviderType): string | undefined => byType[type];
export const authorIconUrl = (author: string): string | undefined => byAuthor[author];
