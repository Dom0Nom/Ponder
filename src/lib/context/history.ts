import type { Message, Thread } from "../types";
import { messageTokens } from "./tokens";

export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

/** Turns kept word for word when the rest is summarized. */
export const KEEP_TURNS = 3;
/** Auto-compaction starts when the conversation fills this share of its budget. */
export const COMPACT_AT = 0.8;

/** Messages the model sees: no failed or empty turns, no second opinions, no answer markers. */
export function usableMessages(messages: Message[]): Message[] {
  return messages.filter(
    (m) =>
      (m.role === "user" || m.role === "assistant" || m.role === "buddy") &&
      m.status !== "error" &&
      !m.meta?.secondOpinionOf &&
      m.content.trim(),
  );
}

export function toHistory(m: Message): HistoryMessage {
  return {
    role: m.role === "user" ? "user" : "assistant",
    content:
      m.role === "buddy"
        ? `(Study buddy note: ${m.content})`
        : m.content.replaceAll("{{general}}", "").replaceAll("{{/general}}", ""),
  };
}

export const summaryMessage = (summary: string): HistoryMessage => ({
  role: "user",
  content: `[Summary of the earlier part of this conversation, written when it grew long. The original messages are still in the chat but not repeated here.]\n${summary}`,
});

export interface FittedHistory {
  messages: HistoryMessage[];
  tokens: number;
  /** whether a stored summary stands in for earlier messages */
  summarized: boolean;
  /** messages after the summary (or all), oldest first */
  live: Message[];
  /** over COMPACT_AT of the budget and enough turns to summarize */
  shouldCompact: boolean;
  /** doesn't fit even after everything possible; the turn can't be sent as is */
  overflow: boolean;
}

/**
 * The whole conversation since the last summary, as long as it fits. Nothing is dropped: when it
 * doesn't fit, `shouldCompact` or `overflow` says so and the caller compacts or tells the learner.
 */
export function fitHistory(messages: Message[], thread: Pick<Thread, "summary" | "summaryUntil" | "autoCompact"> | null, budget: number): FittedHistory {
  const usable = usableMessages(messages);
  const until = thread?.summary ? (thread.summaryUntil ?? -Infinity) : -Infinity;
  const live = usable.filter((m) => m.createdAt > until);
  const out: HistoryMessage[] = [];
  if (thread?.summary) out.push(summaryMessage(thread.summary));
  for (const m of live) {
    const h = toHistory(m);
    const prev = out[out.length - 1];
    // a summary followed by a user turn reads as one user message
    if (prev && prev.role === "user" && h.role === "user" && out.length === 1 && thread?.summary) prev.content += `\n\n${h.content}`;
    else out.push(h);
  }
  const tokens = out.reduce((n, m) => n + messageTokens(m.content), 0);
  const compactable = live.length > KEEP_TURNS * 2;
  const auto = thread?.autoCompact !== false;
  return {
    messages: out,
    tokens,
    summarized: !!thread?.summary,
    live,
    shouldCompact: auto && compactable && tokens > budget * COMPACT_AT,
    overflow: tokens > budget && (!auto || !compactable),
  };
}

/** Where a compaction cuts: everything up to (and including) the returned message is summarized. */
export function compactionCut(live: Message[], keepTurns = KEEP_TURNS): Message | null {
  const userIdx = live.map((m, i) => (m.role === "user" ? i : -1)).filter((i) => i >= 0);
  if (userIdx.length <= keepTurns) {
    // few learner turns but long answers: keep only the last exchange
    if (live.length <= 2) return null;
    return live[live.length - 3] ?? null;
  }
  const firstKept = userIdx[userIdx.length - keepTurns];
  return firstKept > 0 ? live[firstKept - 1] : null;
}
