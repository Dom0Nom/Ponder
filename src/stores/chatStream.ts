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
  /** threadId → a turn that has begun but whose stream hasn't started yet */
  pending: Record<string, true>;
  setPending: (threadId: string, on: boolean) => void;
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
  pending: {},
  setPending: (threadId, on) =>
    set((s) => {
      const pending = { ...s.pending };
      if (on) pending[threadId] = true;
      else delete pending[threadId];
      return { pending };
    }),
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

const discarded = new Set<string>();

/** Marks a thread the learner deleted, so late writes from its stream aren't reported as errors. */
export function discardThread(threadId: string) {
  discarded.add(threadId);
  useChatStream.getState().stop(threadId);
}

export const undiscardThread = (threadId: string) => discarded.delete(threadId);

export const isDiscarded = (threadId: string) => discarded.has(threadId);
