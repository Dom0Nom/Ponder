import type { ModelRef } from "../../lib/types";

/** Select a provider + model. `allowDefault` adds "App default" (value null). */
export function ModelPicker(_props: {
  value: ModelRef | null;
  onChange: (v: ModelRef | null) => void;
  allowDefault?: boolean;
}) {
  return null;
}
