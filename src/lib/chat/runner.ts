import { streamText, type ModelMessage } from "ai";
import { api } from "../ipc";
import { s } from "../strings";
import { queryClient, qk } from "../queries";
import type { Citation, FocusState, Message, MessageMeta, NewMessage, MessagePatch, SearchHit, Space, TutorStyle } from "../types";
import type { ImageInput } from "../steps/vision";
import { useChatStream } from "../../stores/chatStream";
import { hitsToCitations } from "./citations";
import { extractFollowUps } from "./followUps";
import { ThinkingTimer } from "./thinking";
import type { ModelControls } from "../providers/controls";
import { extractMemories, isKnownFact } from "./memory";
import { buildSystemPrompt, historyMessages, threadTitleFrom, type Passage } from "./context";
import { resolveChatModel, type ResolvedModel } from "./llm";

export interface TurnInput {
  space: Space;
  threadId: string;
  tutorStyle: TutorStyle;
  /** legacy on/off switch; `controls` supersedes it */
  thinking?: boolean;
  controls?: ModelControls;
  focus: FocusState | null;
  /** what the learner typed; omitted for study-buddy turns */
  userText?: string;
  /** retrieval query when there's no user text */
  query?: string;
  /** extra system instructions (study buddy) */
  instruction?: string;
  meta?: MessageMeta;
  llm?: ResolvedModel;
  /** extra system context, e.g. the chapter being studied */
  systemExtra?: string;
  /** false when retrying: the user message is already saved */
  persistUser?: boolean;
  /** a screenshot or photo sent along with `userText` (needs a vision-capable model) */
  image?: ImageInput;
  /** spoken conversation: short answers written to be read aloud */
  voice?: boolean;
  /** keep the exchange in memory only; nothing is written to the thread */
  ephemeral?: boolean;
  /** the assistant row as soon as retrieval is done and streaming starts */
  onStart?: (assistant: Message) => void;
}

interface MessageStore {
  listMessages: (threadId: string) => Promise<Message[]>;
  addMessage: (m: NewMessage) => Promise<Message>;
  updateMessage: (id: string, patch: MessagePatch) => Promise<Message>;
}

const persistentStore: MessageStore = {
  listMessages: (t) => api.listMessages(t),
  addMessage: (m) => api.addMessage(m),
  updateMessage: (id, p) => api.updateMessage(id, p),
};

/** Messages that live only in this window; used by the ask-anything overlay until "Open in Ponder". */
export function memoryStore(): MessageStore {
  const rows = new Map<string, Message>();
  return {
    listMessages: async () => [],
    addMessage: async (m) => {
      const row: Message = {
        id: crypto.randomUUID(),
        threadId: m.threadId,
        role: m.role,
        content: m.content ?? "",
        reasoning: m.reasoning ?? null,
        citations: m.citations ?? null,
        meta: m.meta ?? null,
        status: m.status ?? "complete",
        error: null,
        createdAt: Date.now(),
      };
      rows.set(row.id, row);
      return row;
    },
    updateMessage: async (id, p) => {
      const row = rows.get(id);
      if (!row) throw new Error("message not found");
      const next = { ...row, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) } as Message;
      rows.set(id, next);
      return next;
    },
  };
}

export function userContent(text: string, image?: ImageInput): ModelMessage["content"] {
  if (!image) return text;
  return [
    { type: "text", text },
    { type: "file", data: image.data, mediaType: image.mediaType },
  ];
}

const PERSIST_EVERY_MS = 1500;

async function retrieve(spaceId: string, query: string): Promise<SearchHit[]> {
  if (!query.trim()) return [];
  return api.searchChunks(spaceId, query, 8);
}

export function passagesFrom(hits: SearchHit[]): Passage[] {
  return hits.map((h, i) => ({ n: i + 1, sourceTitle: h.sourceTitle, page: h.page, text: h.text }));
}

/**
 * Runs one assistant turn: saves the user message, retrieves passages, streams the answer into
 * the chat stream store and persists it. Returns the final assistant message.
 */
export async function runTurn(input: TurnInput): Promise<Message> {
  const { space, threadId } = input;
  const llm = input.llm ?? (await resolveChatModel(space));
  const store = input.ephemeral ? memoryStore() : persistentStore;
  const invalidate = () => {
    if (!input.ephemeral) queryClient.invalidateQueries({ queryKey: qk.messages(threadId) });
  };

  let prior = await store.listMessages(threadId);
  if (input.persistUser === false) {
    const last = prior[prior.length - 1];
    if (last?.role === "user") prior = prior.slice(0, -1);
  } else if (input.userText) {
    await store.addMessage({ threadId, role: "user", content: input.userText });
    if (!input.ephemeral && !prior.some((m) => m.role === "user")) {
      await api.renameThread(threadId, threadTitleFrom(input.userText)).catch(() => {});
      queryClient.invalidateQueries({ queryKey: qk.threads(space.id) });
    }
    invalidate();
  }

  let hits: SearchHit[] = [];
  let retrievalError: string | null = null;
  useChatStream.getState().setPhase(threadId, "search");
  try {
    hits = await retrieve(space.id, input.userText ?? input.query ?? "");
  } catch (e) {
    retrievalError = (e as Error).message;
  } finally {
    useChatStream.getState().setPhase(threadId, null);
  }
  const citations: Citation[] = hitsToCitations(hits);
  const sources = queryClient.getQueryData<{ status: string }[]>(qk.sources(space.id)) ?? [];

  const assistant = await store.addMessage({
    threadId,
    role: "assistant",
    content: "",
    citations,
    status: "streaming",
    meta: {
      ...input.meta,
      tutorStyle: input.tutorStyle,
      model: { providerId: llm.provider.id, model: llm.modelId },
      ...(input.thinking != null ? { thinking: input.thinking } : {}),
    },
  });
  invalidate();

  const controller = new AbortController();
  const stream = useChatStream.getState();
  stream.start(threadId, assistant.id, controller);
  input.onStart?.(assistant);

  const memory = await api.listMemory().catch(() => []);
  const system = buildSystemPrompt({
    memory: memory.map((m) => m.text),
    extraInstructions: input.systemExtra,
    voice: input.voice,
    space,
    tutorStyle: input.tutorStyle,
    passages: passagesFrom(hits),
    focus: input.focus,
    now: Date.now(),
    sourceCount: sources.filter((s) => s.status === "ready").length || space.sourceCount,
  });
  const history = historyMessages(prior) as ModelMessage[];
  const messages: ModelMessage[] = [...history];
  if (input.userText) messages.push({ role: "user", content: userContent(input.userText, input.image) } as ModelMessage);
  else
    messages.push({
      role: "user",
      content: `[Study buddy event, not typed by the learner] ${input.instruction ?? ""}`.trim(),
    });

  let content = "";
  let reasoning = "";
  const timer = new ThinkingTimer();
  let lastPersist = Date.now();
  let error: string | null = null;

  const paint = new FramePainter((c, r) => useChatStream.getState().update(assistant.id, { content: c, reasoning: r }));
  try {
    const result = streamText({
      model: llm.model,
      system,
      messages,
      abortSignal: controller.signal,
      ...llm.options({ ...(input.thinking != null ? { thinking: input.thinking } : {}), ...input.controls }),
    });
    for await (const part of result.stream) {
      if (part.type === "text-delta") {
        timer.text();
        content += part.text;
      } else if (part.type === "reasoning-delta") {
        timer.reasoning();
        reasoning += part.text;
      }
      else if (part.type === "error") throw part.error;
      else continue;
      paint.schedule(content, reasoning);
      if (Date.now() - lastPersist > PERSIST_EVERY_MS) {
        lastPersist = Date.now();
        store.updateMessage(assistant.id, { content, reasoning }).catch(() => {});
      }
    }
  } catch (e) {
    if (!controller.signal.aborted) error = describeError(e);
  }
  paint.flush();

  timer.finish();
  const stopped = controller.signal.aborted;
  const remembered: string[] = [];
  let followUps: string[] = [];
  if (!error && content) {
    const fu = extractFollowUps(content);
    content = fu.clean;
    if (!input.meta?.buddyKind) followUps = fu.followUps;
    const ex = extractMemories(content);
    content = ex.clean;
    const known = memory.map((m) => m.text);
    for (const fact of ex.memories) {
      if (isKnownFact(fact, known)) continue;
      try {
        await api.addMemory(fact, "tutor", space.id);
        remembered.push(fact);
      } catch {
        // a rejected memory (too long, empty) just isn't saved
      }
    }
    if (remembered.length) queryClient.invalidateQueries({ queryKey: qk.memory });
  }
  const final = await store.updateMessage(assistant.id, {
    content,
    reasoning,
    status: error ? "error" : "complete",
    error: error ?? undefined,
    meta: {
      ...assistant.meta,
      ...(stopped ? { stopped: true } : {}),
      ...(retrievalError ? { retrievalError } : {}),
      ...(remembered.length ? { remembered } : {}),
      ...(timer.thinkingMs ? { thinkingMs: timer.thinkingMs } : {}),
      ...(followUps.length ? { followUps } : {}),
    },
  });
  // swap in the final row before dropping live state, or the stale "streaming" row flashes as interrupted
  queryClient.setQueryData<Message[]>(qk.messages(threadId), (msgs) => msgs?.map((m) => (m.id === final.id ? final : m)));
  useChatStream.getState().finish(threadId, assistant.id);
  invalidate();
  if (!input.ephemeral) queryClient.invalidateQueries({ queryKey: qk.threads(space.id) });
  return final;
}

/**
 * Pushes streamed text to the UI at most once per frame. Deltas can arrive faster than a long
 * Markdown + KaTeX answer renders; rendering each one backs the stream up until it stalls and
 * then lands in one burst.
 */
export class FramePainter {
  private pending: [string, string] | null = null;
  private cancel: (() => void) | null = null;
  constructor(private readonly paint: (content: string, reasoning: string) => void) {}

  schedule(content: string, reasoning: string) {
    this.pending = [content, reasoning];
    if (this.cancel) return;
    const run = () => {
      this.cancel = null;
      this.flush();
    };
    if (typeof requestAnimationFrame === "function" && typeof document !== "undefined" && !document.hidden) {
      const id = requestAnimationFrame(run);
      this.cancel = () => cancelAnimationFrame(id);
    } else {
      const id = setTimeout(run, 50);
      this.cancel = () => clearTimeout(id);
    }
  }

  flush() {
    this.cancel?.();
    this.cancel = null;
    if (!this.pending) return;
    const [c, r] = this.pending;
    this.pending = null;
    this.paint(c, r);
  }
}

export function describeError(e: unknown): string {
  const err = e as { message?: string; statusCode?: number; responseBody?: string; cause?: unknown };
  let msg = err?.message ?? String(e);
  const cause = (err?.cause as { message?: string } | undefined)?.message;
  if (msg === "Failed to process successful response") return s.chat.streamBroke(cause ?? "");
  if (err?.statusCode === 401 || err?.statusCode === 403) msg = s.chat.rejected(err.statusCode);
  else if (err?.statusCode === 404) msg = s.chat.modelNotFound(err.statusCode);
  else if (err?.statusCode === 429) msg = s.chat.rateLimited;
  else if (/fetch|network|connect|ECONNREFUSED|timed out/i.test(msg)) msg = s.chat.unreachable(msg);
  return msg;
}
