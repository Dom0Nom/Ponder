import type { OpenRouterModel, Provider } from "../types";
import { cachedOpenRouterModel } from "./openrouter";
import { effortRank, resolveModelCaps, type Effort, type ModelCaps, type Verbosity } from "./modelCaps";

export interface ModelControls {
  effort?: Effort;
  thinking?: boolean;
  verbosity?: Verbosity;
  temperature?: number;
}

export const controlsKey = (providerId: string, model: string) => `${providerId}:${model}`;

/** What the chosen model supports; OpenRouter models use the endpoint's own parameter list once it is loaded. */
export function modelCapabilities(provider: Pick<Provider, "type">, modelId: string, orModel?: OpenRouterModel): ModelCaps {
  return resolveModelCaps(provider, modelId, orModel ?? (provider.type === "openrouter" ? cachedOpenRouterModel(modelId) : undefined));
}

/** Stored controls with every value the model doesn't offer dropped. No defaults are filled in: unset means the model's own default. */
export function sanitizeControls(caps: ModelCaps, stored?: ModelControls): ModelControls {
  const out: ModelControls = {};
  if (!stored) return out;
  if (stored.effort && caps.effort?.options.some((o) => o.value === stored.effort)) out.effort = stored.effort;
  if (typeof stored.thinking === "boolean" && caps.thinking) out.thinking = stored.thinking;
  if (stored.verbosity && caps.verbosity?.options.some((o) => o.value === stored.verbosity)) out.verbosity = stored.verbosity;
  if (stored.temperature != null && caps.temperature?.presets.includes(stored.temperature)) out.temperature = stored.temperature;
  return out;
}

export const effectiveEffort = (caps: ModelCaps, stored?: ModelControls): Effort | undefined =>
  (stored?.effort ?? caps.effort?.default) || undefined;

export const effectiveThinking = (caps: ModelCaps, stored?: ModelControls): boolean => stored?.thinking ?? caps.thinking?.default ?? true;

/** The thinking switch can't go off at this effort (the model rejects the combination). */
export function thinkingOffBlocked(caps: ModelCaps, stored?: ModelControls): boolean {
  const limit = caps.thinking?.offMaxEffort;
  const e = effectiveEffort(caps, stored);
  return !!limit && !!e && effortRank(e) > effortRank(limit);
}

/** Whether sampling controls apply right now: not while a thinking mode that forbids them is active. */
export function temperatureAvailable(caps: ModelCaps, stored?: ModelControls): boolean {
  const t = caps.temperature;
  if (!t) return false;
  if (!t.offWhenThinking) return true;
  if (caps.thinking) return !effectiveThinking(caps, stored);
  return effectiveEffort(caps, stored) === "none";
}

/** Model id without its vendor prefix, e.g. "anthropic/claude-haiku-4.5" -> "claude-haiku-4.5". */
export const modelLabel = (modelId: string) => modelId.slice(modelId.lastIndexOf("/") + 1);

/** Short effort text for the model button: the learner's chosen level, or nothing. */
export function effortLabel(caps: ModelCaps, stored?: ModelControls): string {
  const e = sanitizeControls(caps, stored).effort;
  return caps.effort?.options.find((o) => o.value === e)?.label ?? "";
}
