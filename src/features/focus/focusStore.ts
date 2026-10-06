import { create } from "zustand";
import type { FocusState } from "../../lib/types";

interface FocusStore {
  state: FocusState | null;
  /** true while a break overlay blocks the app */
  breakLocked: boolean;
  setState: (s: FocusState | null) => void;
}

export const useFocusStore = create<FocusStore>((set) => ({
  state: null,
  breakLocked: false,
  setState: (state) =>
    set({
      state,
      breakLocked: !!state && (state.phase === "break" || state.phase === "longBreak") && state.pauseReason !== "needApp",
    }),
}));
