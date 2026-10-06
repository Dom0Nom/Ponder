import { streamText, type ModelMessage } from "ai";
import { api } from "../ipc";
import { queryClient, qk } from "../queries";
import type { Message, ModelRef, Space } from "../types";
import { useChatStream } from "../../stores/chatStream";
import { buildSystemPrompt, historyMessages } from "./context";
import { describeError } from "./runner";
import { resolveChatModel } from "./llm";
import { extractMemories } from "./memory";

/**
 * Asks another model the same question with the same passages and history, and stores the reply
 * as a message linked to the original answer.
 */
export async function secondOpinion(space: Space, original: Message, model: ModelRef): Promise<Message> {
  const llm = await resolveChatModel({ modelOverride: model });
  const all = await api.listMessages(original.threadId);
  const idx = all.findIndex((m) => m.id === original.id);
  const before = all.slice(0, idx);
  const lastUser = [...before].reverse().find((m) => m.role === "user");
  if (!lastUser) throw new Error("There's no question to ask again.");
  const priorTurns = before.slice(0, before.lastIndexOf(lastUser));
  const citations = original.citations ?? [];
  const memory = await api.listMemory().catch(() => []);

  const system = buildSystemPrompt({
    space,
    tutorStyle: original.meta?.tutorStyle ?? space.tutorStyle,
    passages: citations.map((c) => ({ n: c.n, sourceTitle: c.sourceTitle, page: c.page, text: c.text ?? c.snippet })),
    focus: null,
    now: Date.now(),
    sourceCount: space.sourceCount,
    memory: memory.map((m) => m.text),
  });
  const messages: ModelMessage[] = [...(historyMessages(priorTurns) as ModelMessage[]), { role: "user", content: lastUser.content }];

  const msg = await api.addMessage({
    threadId: original.threadId,
    role: "assistant",
    citations,
    status: "streaming",
    meta: { secondOpinionOf: original.id, model, tutorStyle: original.meta?.tutorStyle },
  });
  queryClient.invalidateQueries({ queryKey: qk.messages(original.threadId) });

  const controller = new AbortController();
  // keyed by the second-opinion message so it doesn't block the main thread's composer
  useChatStream.getState().start(`second:${msg.id}`, msg.id, controller);
  let content = "";
  let reasoning = "";
  let error: string | null = null;
  try {
    const result = streamText({ model: llm.model, system, messages, abortSignal: controller.signal, ...llm.options({ thinking: false }) });
    for await (const part of result.stream) {
      if (part.type === "text-delta") content += part.text;
      else if (part.type === "reasoning-delta") reasoning += part.text;
      else if (part.type === "error") throw part.error;
      else continue;
      useChatStream.getState().update(msg.id, { content, reasoning });
    }
  } catch (e) {
    if (!controller.signal.aborted) error = describeError(e);
  }
  const final = await api.updateMessage(msg.id, {
    content: extractMemories(content).clean,
    reasoning,
    status: error ? "error" : "complete",
    error: error ?? undefined,
  });
  useChatStream.getState().finish(`second:${msg.id}`, msg.id);
  queryClient.invalidateQueries({ queryKey: qk.messages(original.threadId) });
  return final;
}
