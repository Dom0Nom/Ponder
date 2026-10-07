import { capabilitiesOf, catalog, type Capabilities, type ReasoningLevel, type Verbosity } from "./catalog";
import type { CallOptionInput } from "./model";
import { cachedOpenRouterModel } from "./openrouter";
import type { OpenRouterModel, Provider } from "../types";

export interface ModelControls {
  reasoning?: ReasoningLevel;
  verbosity?: Verbosity;
  temperature?: number;
}

export const controlsKey = (providerId: string, model: string) => `${providerId}:${model}`;

/** OpenRouter lists what each model accepts; map that onto the controls the menu can show. */
export function openRouterCapabilities(model: OpenRouterModel): Capabilities {
  const base = catalog.openrouter.capabilities;
  const params = model.supportedParameters;
  const reasons = params.includes("reasoning") || params.includes("reasoning_effort");
  return {
    ...base,
    reasoningToggle: reasons,
    thinkingToggle: reasons,
    reasoningLevels: params.includes("reasoning_effort") ? base.reasoningLevels : null,
    temperature: params.includes("temperature"),
  };
}

/** What the chosen model supports: OpenRouter's per-model parameters when known, else the provider catalog. */
export function modelCapabilities(provider: Provider, modelId?: string): Capabilities {
  if (provider.type === "openrouter" && modelId) {
    const m = cachedOpenRouterModel(modelId);
    if (m) return openRouterCapabilities(m);
  }
  return capabilitiesOf(provider);
}

/**
 * Stored controls for a model with defaults filled in. Models with a thinking switch default to
 * reasoning off; values the model can't take are dropped.
 */
export function resolveControls(provider: Provider, stored?: ModelControls, caps: Capabilities = capabilitiesOf(provider)): CallOptionInput {
  const out: CallOptionInput = { ...stored };
  if (out.reasoning === undefined && caps.reasoningToggle) out.reasoning = "none";
  if (!caps.reasoningLevels && !caps.reasoningToggle && !caps.thinkingToggle) delete out.reasoning;
  if (!caps.temperature) delete out.temperature;
  if (!caps.verbosity) delete out.verbosity;
  return out;
}

/** Model id without its vendor prefix, e.g. "anthropic/claude-haiku-4.5" -> "claude-haiku-4.5". */
export const modelLabel = (modelId: string) => modelId.slice(modelId.lastIndexOf("/") + 1);

/** Short effort text for the model button: the chosen level's label, "Thinking" for a bare switch, or nothing. */
export function effortLabel(provider: Provider, stored?: ModelControls, caps: Capabilities = capabilitiesOf(provider)): string {
  const { reasoning } = resolveControls(provider, stored, caps);
  const level = caps.reasoningLevels?.find((l) => l.value === reasoning);
  if (level) return level.label;
  if ((caps.reasoningToggle || caps.thinkingToggle) && reasoning && reasoning !== "none") return "Thinking";
  return "";
}

/** Whether the thinking switch is on. Providers without levels store "medium" as the on value. */
export function thinkingOn(provider: Provider, stored?: ModelControls, caps: Capabilities = capabilitiesOf(provider)): boolean {
  const { reasoning } = resolveControls(provider, stored, caps);
  return reasoning !== "none";
}
