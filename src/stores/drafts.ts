import { create } from "zustand";

interface DraftState {
  /** composer text per chat (`new:<spaceId>` before a chat exists); kept while switching chats */
  drafts: Record<string, string>;
  setDraftText: (key: string, text: string | ((cur: string) => string)) => void;
}

export const useDrafts = create<DraftState>((set) => ({
  drafts: {},
  setDraftText: (key, text) =>
    set((st) => {
      const next = typeof text === "function" ? text(st.drafts[key] ?? "") : text;
      const drafts = { ...st.drafts };
      if (next) drafts[key] = next;
      else delete drafts[key];
      return { drafts };
    }),
}));
