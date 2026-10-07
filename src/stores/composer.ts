import { create } from "zustand";

/** Lets other parts of the chat (suggested follow-ups) send text through the composer. */
export const useComposer = create<{ sendText: ((text: string) => void) | null; register: (fn: ((text: string) => void) | null) => void }>((set) => ({
  sendText: null,
  register: (sendText) => set({ sendText }),
}));
