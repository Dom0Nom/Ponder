import { capabilitiesOf, type ReasoningLevel, type Verbosity } from "./catalog";
import type { CallOptionInput } from "./model";
import type { Provider } from "../types";

export interface ModelControls {
  reasoning?: ReasoningLevel;
  verbosity?: Verbosity;
  temperature?: number;
}

export const controlsKey = (providerId: string, model: string) => `${providerId}:${model}`;

/**
 * Stored controls for a model with defaults filled in. Providers with a thinking switch default to
 * reasoning off; everything else keeps the provider default.
 */
export function resolveControls(provider: Provider, stored?: ModelControls): CallOptionInput {
  const caps = capabilitiesOf(provider);
  const out: CallOptionInput = { ...stored };
  if (out.reasoning === undefined && caps.reasoningToggle) out.reasoning = "none";
  return out;
}

/** Model id without its vendor prefix, e.g. "anthropic/claude-haiku-4.5" -> "claude-haiku-4.5". */
export const modelLabel = (modelId: string) => modelId.slice(modelId.lastIndexOf("/") + 1);

/** Short effort text for the model button: the chosen level's label, "Thinking" for a bare switch, or nothing. */
export function effortLabel(provider: Provider, stored?: ModelControls): string {
  const caps = capabilitiesOf(provider);
  const { reasoning } = resolveControls(provider, stored);
  const level = caps.reasoningLevels?.find((l) => l.value === reasoning);
  if (level) return level.label;
  if ((caps.reasoningToggle || caps.thinkingToggle) && reasoning && reasoning !== "none") return "Thinking";
  return "";
}

/** Whether the thinking switch is on. Providers without levels store "medium" as the on value. */
export function thinkingOn(provider: Provider, stored?: ModelControls): boolean {
  const { reasoning } = resolveControls(provider, stored);
  return reasoning !== "none";
}
