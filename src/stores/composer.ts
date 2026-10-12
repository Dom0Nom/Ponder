import { create } from "zustand";

interface ComposerState {
  /** Lets other parts of the chat (suggested follow-ups) send text through the composer. */
  sendText: ((text: string) => void) | null;
  register: (fn: ((text: string) => void) | null) => void;
  /** Text waiting to be placed (not sent) in a space's composer, e.g. from a ponder://ask link. */
  draft: { spaceId: string; text: string } | null;
  setDraft: (draft: { spaceId: string; text: string } | null) => void;
}

export const useComposer = create<ComposerState>((set) => ({
  sendText: null,
  register: (sendText) => set({ sendText }),
  draft: null,
  setDraft: (draft) => set({ draft }),
}));
