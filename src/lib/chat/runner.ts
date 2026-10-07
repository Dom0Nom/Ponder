import { streamText, type ModelMessage } from "ai";
import { api } from "../ipc";
import { s } from "../strings";
import { queryClient, qk } from "../queries";
import type { Citation, FocusState, Message, MessageMeta, SearchHit, Space, TutorStyle } from "../types";
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
  const invalidate = () => queryClient.invalidateQueries({ queryKey: qk.messages(threadId) });

  let prior = await api.listMessages(threadId);
  if (input.persistUser === false) {
    const last = prior[prior.length - 1];
    if (last?.role === "user") prior = prior.slice(0, -1);
  } else if (input.userText) {
    await api.addMessage({ threadId, role: "user", content: input.userText });
    if (!prior.some((m) => m.role === "user")) {
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

  const assistant = await api.addMessage({
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

  const memory = await api.listMemory().catch(() => []);
  const system = buildSystemPrompt({
    memory: memory.map((m) => m.text),
    extraInstructions: input.systemExtra,
    space,
    tutorStyle: input.tutorStyle,
    passages: passagesFrom(hits),
    focus: input.focus,
    now: Date.now(),
    sourceCount: sources.filter((s) => s.status === "ready").length || space.sourceCount,
  });
  const history = historyMessages(prior) as ModelMessage[];
  const messages: ModelMessage[] = [...history];
  if (input.userText) messages.push({ role: "user", content: input.userText });
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
      useChatStream.getState().update(assistant.id, { content, reasoning });
      if (Date.now() - lastPersist > PERSIST_EVERY_MS) {
        lastPersist = Date.now();
        api.updateMessage(assistant.id, { content, reasoning }).catch(() => {});
      }
    }
  } catch (e) {
    if (!controller.signal.aborted) error = describeError(e);
  }

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
  const final = await api.updateMessage(assistant.id, {
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
  queryClient.invalidateQueries({ queryKey: qk.threads(space.id) });
  return final;
}

export function describeError(e: unknown): string {
  const err = e as { message?: string; statusCode?: number; responseBody?: string; cause?: unknown };
  let msg = err?.message ?? String(e);
  const cause = (err?.cause as { message?: string } | undefined)?.message;
  if (msg === "Failed to process successful response") msg = cause ? s.chat.streamBroke(cause) : s.chat.streamBroke("");
  if (err?.statusCode === 401 || err?.statusCode === 403) msg = `The provider rejected the request (${err.statusCode}). Check the API key or sign-in in Settings.`;
  else if (err?.statusCode === 404) msg = `The model wasn't found (${err.statusCode}). Pick another model in Settings.`;
  else if (err?.statusCode === 429) msg = "Rate limit or quota reached at the provider. Try again in a moment.";
  else if (/fetch|network|connect|ECONNREFUSED|timed out/i.test(msg)) msg = `Couldn't reach the model server: ${msg}`;
  return msg;
}
