import { useEffect, useRef } from "react";
import { create } from "zustand";
import { api } from "../../lib/ipc";
import { qk, queryClient } from "../../lib/queries";
import type { FocusState, FocusTransition } from "../../lib/types";

interface FocusStore {
  state: FocusState | null;
  /** first focus_state call finished */
  loaded: boolean;
  loadError: unknown;
  /** true while a break overlay blocks the app */
  breakLocked: boolean;
  parkingOpen: boolean;
  setState: (s: FocusState | null) => void;
  setParkingOpen: (o: boolean) => void;
}

/** "Forced breaks" setting; on unless switched off in Settings or during setup. */
export const forcedBreaks = () => {
  const v = queryClient.getQueryData<Record<string, unknown>>(qk.settings)?.["focus.forcedBreaks"] as { enabled?: boolean } | undefined;
  return v?.enabled !== false;
};

export const isBreakPhase = (s: FocusState | null) => !!s && (s.phase === "break" || s.phase === "longBreak");

export const useFocusStore = create<FocusStore>((set) => ({
  state: null,
  loaded: false,
  loadError: null,
  breakLocked: false,
  parkingOpen: false,
  setState: (state) => {
    const active = state && state.phase !== "done" ? state : null;
    set({
      state: active,
      loaded: true,
      loadError: null,
      breakLocked: isBreakPhase(active) && active!.pauseReason !== "needApp" && forcedBreaks(),
    });
  },
  setParkingOpen: (parkingOpen) => set({ parkingOpen }),
}));

/** Loads the backend timer state (restores the UI after a reload). */
export async function loadFocusState() {
  try {
    useFocusStore.getState().setState(await api.focusState());
  } catch (e) {
    useFocusStore.setState({ loadError: e, loaded: true });
    throw e;
  }
}

type TransitionListener = (t: FocusTransition) => void;
const transitionListeners = new Set<TransitionListener>();

export function emitFocusTransition(t: FocusTransition) {
  for (const l of transitionListeners) {
    try {
      l(t);
    } catch (e) {
      console.error("focus transition listener failed", e);
    }
  }
}

/** Subscribe to timer phase transitions (work → break, break → work, … → done). */
export function onFocusTransition(cb: TransitionListener): () => void {
  transitionListeners.add(cb);
  return () => transitionListeners.delete(cb);
}

/** React hook form of `onFocusTransition`; always calls the latest `cb`. */
export function useFocusTransitions(cb: TransitionListener) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => onFocusTransition((t) => ref.current(t)), []);
}
