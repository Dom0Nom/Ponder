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
