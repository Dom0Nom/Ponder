import { s } from "../../lib/strings";
import { useFocusStore } from "./focusStore";

/** True while a low-energy (review-only) focus session runs in this space. */
export function useLowEnergy(spaceId: string | undefined): { active: boolean; reason: string | undefined } {
  const active = useFocusStore(
    (st) => !!st.state && st.state.energy === "low" && !!spaceId && st.state.spaceId === spaceId,
  );
  return { active, reason: active ? s.focus.lowEnergy.disabledReason : undefined };
}
