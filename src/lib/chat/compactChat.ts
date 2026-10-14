import { api } from "../ipc";
import { queryClient, qk } from "../queries";
import type { Space, Thread } from "../types";
import { compactThread } from "../context/compact";
import { modelLimits } from "../context/window";
import { resolveChatModel, resolveHelperModel } from "./llm";
import { useChatStream } from "../../stores/chatStream";

/** `/compact [focus]` and "Compact chat": summarizes all but the last turns now. Null when there was nothing to compact. */
export async function compactChat(spaceOrId: Space | string, threadId: string, focus?: string): Promise<Thread | null> {
  const space = typeof spaceOrId === "string" ? await api.getSpace(spaceOrId) : spaceOrId;
  const stream = useChatStream.getState();
  stream.setPhase(threadId, "compact");
  try {
    const [thread, messages, chat] = await Promise.all([api.getThread(threadId), api.listMessages(threadId), resolveChatModel(space)]);
    const helper = await resolveHelperModel(space, chat);
    const limits = await modelLimits(helper.provider, helper.modelId).catch(() => null);
    const next = await compactThread({
      thread,
      messages,
      llm: helper,
      focus: focus?.trim() || undefined,
      partTokens: limits ? Math.min(60_000, Math.floor(limits.window / 2)) : 30_000,
    });
    if (next) {
      queryClient.invalidateQueries({ queryKey: qk.threads(space.id) });
    }
    return next;
  } finally {
    useChatStream.getState().setPhase(threadId, null);
  }
}

/** "/compact keep the formulas" → "keep the formulas"; null when the text isn't the command. */
export function parseCompactCommand(text: string): { focus: string } | null {
  const m = /^\/compact(?:\s+([\s\S]*))?$/i.exec(text.trim());
  return m ? { focus: (m[1] ?? "").trim() } : null;
}
