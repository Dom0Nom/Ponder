import { controlsKey, modelCapabilities, sanitizeControls, type ModelControls } from "../providers/controls";
import { useUi } from "../../stores/ui";
import type { ResolvedModel } from "./llm";

/** The learner's saved controls for the model that will answer, minus anything that model doesn't offer. */
export function storedControls(llm: ResolvedModel): ModelControls {
  const stored = useUi.getState().modelControls[controlsKey(llm.provider.id, llm.modelId)];
  return sanitizeControls(modelCapabilities(llm.provider, llm.modelId), stored);
}
