import type { ModelMessage, SystemModelMessage, ToolSet } from "ai";
import { api } from "../ipc";
import type { ResolvedModel } from "../chat/llm";
import type { Citation, Message, Source, SourceOutline, Thread } from "../types";
import { splitBudget, withConversationUsed, LARGE_CONTEXT_SOURCES, type Budget } from "./budget";
import { compactThread } from "./compact";
import { fitHistory, type HistoryMessage } from "./history";
import { planSearch, resolveSections, type SearchPlan } from "./plan";
import { gatherPassages, numberRanges, passageCitations, renderPassages, type ContextPassage } from "./retrieve";
import { buildSourceMap, makeHandles, type Handles } from "./sourceMap";
import { countTokens, loadTokenizer, messageTokens } from "./tokens";
import { PassageBook, sourceTools, TOOL_INSTRUCTION, type ToolEnv } from "./tools";
import { estimateCost, modelLimits, type ModelLimits } from "./window";
import { cachedOpenRouterModel } from "../providers/openrouter";

export class ContextOverflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContextOverflowError";
  }
}

export type ContextPhase = "compact" | "plan" | "search";

export interface ContextStats {
  window: number;
  cap: number;
  capped: boolean;
  billing: ModelLimits["billing"];
  /** prompt tokens sent (system + conversation + passages + message) */
  used: number;
  system: number;
  map: number;
  mapLevel: string;
  conversation: { used: number; budget: number; summarized: boolean };
  passages: number;
  passageTokens: number;
  full: string[];
  summaryOnly: string[];
  /** titles cut with a truncation notice */
  truncated: string[];
  whole: string[];
  queries: string[];
  answerReserve: number;
  /** USD for the prompt plus a full answer; null when unknown, 0 for free/local */
  cost: number | null;
}

export interface SpaceSources {
  sources: Source[];
  outlines: Map<string, SourceOutline>;
}

const outlineCache = new Map<string, { at: number; key: string; outlines: Map<string, SourceOutline> }>();

/** Ready sources and their outlines; outlines are cached until the source list changes. */
export async function loadSpaceSources(spaceId: string): Promise<SpaceSources> {
  const sources = (await api.listSources(spaceId)).filter((s) => s.status === "ready");
  const key = sources.map((s) => `${s.id}:${s.updatedAt}`).join(",");
  const hit = outlineCache.get(spaceId);
  if (hit && hit.key === key && Date.now() - hit.at < 10 * 60_000) return { sources, outlines: hit.outlines };
  const list = await api.sourceOutlines(spaceId).catch(() => [] as SourceOutline[]);
  const outlines = new Map(list.map((o) => [o.sourceId, o]));
  outlineCache.set(spaceId, { at: Date.now(), key, outlines });
  return { sources, outlines };
}

/** OpenRouter and the direct APIs that need explicit cache marks. */
function cacheOptions(llm: ResolvedModel): SystemModelMessage["providerOptions"] | undefined {
  const t = llm.provider.type;
  if (t === "anthropic") return { anthropic: { cacheControl: { type: "ephemeral" } } };
  if (t === "openrouter" && /^(anthropic|google)\//.test(llm.modelId)) return { openaiCompatible: { cache_control: { type: "ephemeral" } } };
  return undefined;
}

export function supportsTools(llm: Pick<ResolvedModel, "provider" | "modelId">): boolean {
  const t = llm.provider.type;
  if (t === "lmstudio" || t === "ollama" || t === "llamacpp" || t === "openai-compatible") return false;
  if (t === "openrouter") return cachedOpenRouterModel(llm.modelId)?.supportedParameters.includes("tools") ?? false;
  return true;
}

export interface BuildInput {
  spaceId: string;
  thread: Thread | null;
  /** earlier messages in the thread, oldest first */
  prior: Message[];
  /** what the learner just wrote (or the retrieval query for buddy turns) */
  latest: string;
  /** the message text sent to the model when it differs from `latest` (buddy events) */
  message?: string;
  llm: ResolvedModel;
  /** cheap model for summaries and search planning; defaults to `llm` */
  helper?: ResolvedModel;
  maxContext?: number | null;
  /** the system prompt for a given source context (from chat/context.ts) */
  instructions: (parts: { sourceMap: string; fullText: string; toolInstruction?: string }) => string;
  /** text placed before the learner's message (focus line, buddy event…) */
  preface?: string;
  /** read more with tools when the model supports them */
  tools?: boolean;
  /** skip search planning (voice turns, buddy events) */
  plan?: boolean;
  /** most tokens of retrieved passages (the model can read more with tools) */
  passageCap?: number;
  onPhase?: (p: ContextPhase | null) => void;
  onThread?: (t: Thread) => void;
  toolLabels?: ToolEnv["labels"];
  onActivity?: (label: string) => void;
  signal?: AbortSignal;
}

export interface BuiltContext {
  system: string | SystemModelMessage;
  history: HistoryMessage[];
  /** the learner's message with its passages, to send last */
  userText: string;
  citations: Citation[];
  book: PassageBook;
  tools: ToolSet | null;
  stats: ContextStats;
  budget: Budget;
  handles: Handles;
  thread: Thread | null;
  /** final citations after tools read more */
  finalCitations: () => Citation[];
}

const DEICTIC = /\b(it|that|this|these|those|they|them|he|she|why|how come|and|also|more|again|es|das|dies|diese|der|die|sie|warum|und|noch)\b/i;
const BROAD = /\b(compare|comparison|difference|summar|overview|all|list|explain .* and|chapter|section|vergleich|unterschied|zusammen|überblick|alle|kapitel|abschnitt)\w*/i;

/** Whether planning the search is worth a model call. */
export function wantsPlan(latest: string, history: HistoryMessage[]): boolean {
  if (history.length > 0 && (DEICTIC.test(latest) || latest.split(/\s+/).length < 12)) return true;
  return BROAD.test(latest) || latest.split(/\s+/).length > 25;
}

export async function buildContext(input: BuildInput): Promise<BuiltContext> {
  await loadTokenizer();
  const helper = input.helper ?? input.llm;
  const [limits, { sources, outlines }] = await Promise.all([modelLimits(input.llm.provider, input.llm.modelId), loadSpaceSources(input.spaceId)]);
  const enabled = sources.filter((s) => s.useInChat);
  const handles = makeHandles(enabled);
  const useTools = !!input.tools && supportsTools(input.llm);

  const baseSystem = input.instructions({ sourceMap: "", fullText: "", toolInstruction: useTools ? TOOL_INSTRUCTION : undefined });
  const said = input.message ?? input.latest;
  const fixed = countTokens(baseSystem) + messageTokens(said) + countTokens(input.preface ?? "");
  let budget = splitBudget({ limits, maxContext: input.maxContext, fixedTokens: fixed });

  let thread = input.thread;
  let hist = fitHistory(input.prior, thread, budget.conversation);
  if (hist.shouldCompact && thread) {
    input.onPhase?.("compact");
    try {
      const next = await compactThread({ thread, messages: input.prior, llm: helper, partTokens: Math.min(60_000, Math.floor(budget.cap / 2)), signal: input.signal });
      if (next) {
        thread = next;
        input.onThread?.(next);
        hist = fitHistory(input.prior, thread, budget.conversation);
      }
    } finally {
      input.onPhase?.(null);
    }
  }
  if (hist.tokens > budget.conversation) {
    if (hist.shouldCompact || hist.overflow || hist.tokens > budget.conversation + budget.sources * 0.5)
      throw new ContextOverflowError(
        thread?.autoCompact === false
          ? "This chat no longer fits the model's context. Turn compaction back on for this chat or pick a model with a larger context window."
          : "Even summarized, this chat doesn't fit the model's context. Pick a model with a larger context window or start a new chat.",
      );
  }
  budget = withConversationUsed(budget, hist.tokens);
  if (hist.tokens > budget.conversation) budget = { ...budget, sources: Math.max(0, budget.sources - (hist.tokens - budget.conversation)) };

  // source map: up to a quarter of the source budget
  const mapBudget = Math.min(40_000, Math.max(300, Math.floor(budget.sources * 0.25)));
  const map = enabled.length ? buildSourceMap(enabled, outlines, handles, mapBudget) : { text: "", tokens: 0, level: "titles", omitted: 0 };
  let left = Math.max(0, budget.sources - map.tokens);

  // "full text" sources go in the system prompt, numbered first, so the prefix stays stable
  const fullSources = enabled.filter((s) => s.contextMode === "full");
  const summaryOnly = enabled.filter((s) => s.contextMode === "summary");
  let full: ContextPassage[] = [];
  let fullTokens = 0;
  const truncated: string[] = [];
  if (fullSources.length && left > 500) {
    const res = await api.readSourceRanges(fullSources.map((s) => ({ sourceId: s.id, unit: "all" as const, maxChars: Math.round(left * 0.7 * 4) })));
    const n = numberRanges(
      res.flatMap((r) => (r.range ? [{ range: r.range, label: null, why: "full" as const }] : [])),
      Math.floor(left * 0.7),
    );
    full = n.passages;
    fullTokens = n.tokens;
    truncated.push(...n.truncated);
    left -= fullTokens;
  }

  const recent = hist.messages.slice(-6);
  let plan: SearchPlan = { query: input.latest, searches: [] };
  if (input.plan !== false && input.latest.trim() && wantsPlan(input.latest, recent)) {
    input.onPhase?.("plan");
    plan = await planSearch(helper, recent, input.latest, input.signal).catch(() => plan);
  }
  input.onPhase?.("search");
  const searchable = enabled.filter((s) => (s.contextMode ?? "auto") === "auto");
  const queries = [...new Set([plan.query, ...(plan.query !== input.latest ? [input.latest] : []), ...plan.searches].map((q) => q.trim()).filter(Boolean))];
  const sections = resolveSections(`${input.latest}\n${plan.query}`, searchable, outlines);
  const gathered = await gatherPassages({
    spaceId: input.spaceId,
    queries,
    sections,
    searchable,
    outlines,
    budget: Math.min(input.passageCap ?? Infinity, Math.floor(left * (useTools ? 0.75 : 1))),
    large: left >= LARGE_CONTEXT_SOURCES,
    startAt: (full[full.length - 1]?.n ?? 0) + 1,
  }).finally(() => input.onPhase?.(null));
  truncated.push(...gathered.truncated);

  const sourceMap = map.text;
  const fullText = full.length ? renderPassages(full) : "";
  const systemText = input.instructions({ sourceMap, fullText, toolInstruction: useTools ? TOOL_INSTRUCTION : undefined });
  const cache = cacheOptions(input.llm);
  const system: string | SystemModelMessage = cache ? { role: "system", content: systemText, providerOptions: cache } : systemText;

  const passageBlock = gathered.passages.length
    ? `Passages from my sources for this message:\n\n${renderPassages(gathered.passages)}\n\n---\n`
    : enabled.length
      ? "(No passage in my sources matched this message.)\n\n"
      : "";
  const userText = `${input.preface ? `${input.preface}\n\n` : ""}${passageBlock}${passageBlock ? "My message (answer this):\n" : ""}${said}`;

  const book = new PassageBook([...full, ...gathered.passages]);
  const readBudget = Math.max(0, Math.floor(left - gathered.tokens));
  const tools = useTools
    ? sourceTools({
        spaceId: input.spaceId,
        handles,
        outlines,
        book,
        readBudget,
        onActivity: input.onActivity ?? (() => {}),
        labels: input.toolLabels ?? {
          searching: (q) => `Searching for “${q}”`,
          reading: (t, w) => `Reading ${t}, ${w}`,
          outline: (t) => `Looking at the outline of ${t}`,
          listing: "Listing sources",
        },
      })
    : null;

  const systemTokens = countTokens(systemText);
  const used = systemTokens + hist.tokens + messageTokens(userText);
  const stats: ContextStats = {
    window: budget.window,
    cap: budget.cap,
    capped: budget.capped,
    billing: limits.billing,
    used,
    system: systemTokens - map.tokens - fullTokens,
    map: map.tokens,
    mapLevel: map.level,
    conversation: { used: hist.tokens, budget: budget.conversation, summarized: hist.summarized },
    passages: gathered.passages.length,
    passageTokens: gathered.tokens,
    full: fullSources.map((s) => s.title),
    summaryOnly: summaryOnly.map((s) => s.title),
    truncated: [...new Set(truncated)],
    whole: gathered.whole.map((id) => sources.find((s) => s.id === id)?.title ?? id),
    queries,
    answerReserve: budget.answer,
    cost: estimateCost(limits, used, Math.min(budget.answer, 1500)),
  };
  return {
    system,
    history: hist.messages,
    userText,
    citations: passageCitations(book.passages),
    book,
    tools,
    stats,
    budget,
    handles,
    thread,
    finalCitations: () => passageCitations(book.passages),
  };
}

/** The model messages for a built context: history, then the learner's message (with an optional image part). */
export function contextMessages(ctx: Pick<BuiltContext, "history" | "userText">, userContent?: ModelMessage["content"]): ModelMessage[] {
  return [...(ctx.history as ModelMessage[]), { role: "user", content: userContent ?? ctx.userText } as ModelMessage];
}
