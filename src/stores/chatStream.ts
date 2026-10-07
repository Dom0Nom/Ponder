import { create } from "zustand";

interface Live {
  content: string;
  reasoning: string;
}

interface ChatStreamState {
  live: Record<string, Live>;
  /** threadId → running generation */
  running: Record<string, { messageId: string; controller: AbortController }>;
  /** threadId → retrieval running before the answer starts */
  phase: Record<string, "search">;
  setPhase: (threadId: string, p: "search" | null) => void;
  start: (threadId: string, messageId: string, controller: AbortController) => void;
  update: (messageId: string, live: Live) => void;
  finish: (threadId: string, messageId: string) => void;
  stop: (threadId: string) => void;
}

export const useChatStream = create<ChatStreamState>((set, get) => ({
  live: {},
  running: {},
  phase: {},
  setPhase: (threadId, p) =>
    set((s) => {
      const phase = { ...s.phase };
      if (p) phase[threadId] = p;
      else delete phase[threadId];
      return { phase };
    }),
  start: (threadId, messageId, controller) =>
    set((s) => ({
      running: { ...s.running, [threadId]: { messageId, controller } },
      live: { ...s.live, [messageId]: { content: "", reasoning: "" } },
    })),
  update: (messageId, live) => set((s) => ({ live: { ...s.live, [messageId]: live } })),
  finish: (threadId, messageId) =>
    set((s) => {
      const running = { ...s.running };
      if (running[threadId]?.messageId === messageId) delete running[threadId];
      const live = { ...s.live };
      delete live[messageId];
      return { running, live };
    }),
  stop: (threadId) => get().running[threadId]?.controller.abort(),
}));
