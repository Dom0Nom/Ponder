import type { ModelLimits } from "./window";

/** Default for Settings → Models → "Max context per message" (paid API models only). */
export const DEFAULT_MAX_CONTEXT = 200_000;
/** Tokenizers differ between model families; keep this share of the window free. */
const MARGIN = 0.08;
/** Share of what's left after instructions and the answer that the conversation may use. */
const CONVERSATION_SHARE = 0.3;
/** Above this many source tokens, whole top-ranked sources go in instead of passages. */
export const LARGE_CONTEXT_SOURCES = 150_000;

export interface Budget {
  /** the model's full window */
  window: number;
  /** usable window after the cost cap */
  cap: number;
  capped: boolean;
  /** reserved for the answer */
  answer: number;
  /** instructions, memory, the learner's message */
  fixed: number;
  conversation: number;
  /** source map + full-text sources + passages */
  sources: number;
}

export interface BudgetInput {
  limits: ModelLimits;
  /** the cost cap setting; applies to paid models only */
  maxContext?: number | null;
  fixedTokens: number;
}

export function splitBudget({ limits, maxContext, fixedTokens }: BudgetInput): Budget {
  const window = Math.max(1024, limits.window);
  const limit = limits.billing === "paid" ? Math.max(8_000, maxContext ?? DEFAULT_MAX_CONTEXT) : Infinity;
  const cap = Math.min(window, limit);
  const answer = Math.round(Math.min(limits.maxOutput, Math.max(cap < 16_000 ? 768 : 2048, cap * 0.15), 32_000));
  const usable = Math.max(0, Math.floor(cap * (1 - MARGIN)) - answer - fixedTokens);
  const conversation = Math.max(Math.min(usable, 1_000), Math.floor(usable * CONVERSATION_SHARE));
  return {
    window,
    cap,
    capped: cap < window,
    answer,
    fixed: fixedTokens,
    conversation,
    sources: Math.max(0, usable - conversation),
  };
}

/** The conversation's unused share goes to sources. */
export function withConversationUsed(b: Budget, used: number): Budget {
  const spare = Math.max(0, b.conversation - used);
  return { ...b, sources: b.sources + spare };
}
