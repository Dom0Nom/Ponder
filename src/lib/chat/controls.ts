import { controlsKey, modelCapabilities, resolveControls, type ModelControls } from "../providers/controls";
import { useUi } from "../../stores/ui";
import type { ResolvedModel } from "./llm";

/** The learner's saved reasoning/verbosity/temperature for the model that will answer, defaults filled in. */
export function storedControls(llm: ResolvedModel): ModelControls {
  const stored = useUi.getState().modelControls[controlsKey(llm.provider.id, llm.modelId)];
  const { reasoning, verbosity, temperature } = resolveControls(llm.provider, stored, modelCapabilities(llm.provider, llm.modelId));
  return { reasoning, verbosity, temperature };
}
