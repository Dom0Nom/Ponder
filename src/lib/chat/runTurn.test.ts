import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Message, MessagePatch, NewMessage } from "../types";

const h = vi.hoisted(() => ({
  parts: [] as { type: string; text?: string }[],
  rows: new Map<string, Record<string, unknown>>(),
  writes: [] as { content?: string; status?: string }[],
  failFinal: false,
  slowFirst: false,
  calls: 0,
}));

vi.mock("ai", () => ({
  streamText: () => ({
    stream: (async function* () {
      for (const p of h.parts) {
        yield p;
        await new Promise((r) => setTimeout(r, 5));
      }
    })(),
  }),
}));

vi.mock("../ipc", () => ({
  api: {
    listMessages: async () => [],
    addMessage: async (m: NewMessage) => {
      const row = { id: `m${h.rows.size + 1}`, ...m, error: null, createdAt: 0 };
      h.rows.set(row.id, row);
      return row;
    },
    updateMessage: async (id: string, patch: MessagePatch) => {
      h.calls++;
      const n = h.calls;
      if (h.slowFirst && n === 1) await new Promise((r) => setTimeout(r, 40));
      if (h.failFinal && patch.status && patch.status !== "streaming") throw new Error("disk full");
      h.writes.push({ content: patch.content, status: patch.status });
      const next = { ...h.rows.get(id), ...patch };
      h.rows.set(id, next);
      return next;
    },
    renameThread: async () => {},
    searchChunks: async () => [],
    searchManyChunks: async () => [],
    readSourceRanges: async () => [],
    listSources: async () => [],
    sourceOutlines: async () => [],
    getSettings: async () => ({}),
    getThread: async () => null,
    listProviders: async () => [],
    listOpenrouterModels: async () => ({ fetchedAt: 0, models: [] }),
    listMemory: async () => [],
    addMemory: async () => {},
  },
}));

import { discardThread } from "../../stores/chatStream";
import { useChatStream } from "../../stores/chatStream";
import { runTurn, TurnBusyError } from "./runner";

const llm = {
  provider: { id: "p" },
  modelId: "m",
  model: {},
  options: () => ({}),
} as never;
const space = { id: "s", sourceCount: 0, tutorStyle: "direct" } as never;
const base = (threadId: string) => ({ llm, space, threadId, tutorStyle: "direct" as const, focus: null, userText: "hi" });
const text = (t: string) => ({ type: "text-delta", text: t });

beforeEach(() => {
  h.parts = [text("Answer.")];
  h.rows.clear();
  h.writes = [];
  h.failFinal = false;
  h.slowFirst = false;
  h.calls = 0;
  useChatStream.setState({ running: {}, live: {}, pending: {}, phase: {} });
});

describe("runTurn", () => {
  it("refuses a second turn while one is pending in the same thread", async () => {
    const first = runTurn(base("t1"));
    await expect(runTurn(base("t1"))).rejects.toBeInstanceOf(TurnBusyError);
    await first;
    expect(useChatStream.getState().pending.t1).toBeUndefined();
    await expect(runTurn(base("t1"))).resolves.toBeTruthy();
  });

  it("always finishes the stream even when the final save throws", async () => {
    h.failFinal = true;
    await expect(runTurn(base("t2"))).rejects.toThrow("disk full");
    const st = useChatStream.getState();
    expect(st.running.t2).toBeUndefined();
    expect(st.pending.t2).toBeUndefined();
    expect(Object.keys(st.live)).toEqual([]);
  });

  it("drops half-written markers from the stored answer", async () => {
    h.parts = [text("Answer.\n\n{{followup: Why does"), text("")];
    const final = await runTurn(base("t3"));
    expect(final.content).toBe("Answer.");
    h.parts = [text("Part one {{remem")];
    expect((await runTurn(base("t4"))).content).toBe("Part one");
  });

  it("does not let a late periodic save overwrite the final answer", async () => {
    h.slowFirst = true;
    const now = Date.now();
    let tick = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now + tick++ * 2000);
    h.parts = [text("Draft {{followup: x?}}"), text(" more")];
    const final = await runTurn(base("t5"));
    vi.restoreAllMocks();
    await new Promise((r) => setTimeout(r, 80));
    expect(final.status).toBe("complete");
    expect(h.writes.at(-1)).toMatchObject({ status: "complete", content: "Draft  more" });
  });

  it("does not throw when the thread was deleted mid-stream", async () => {
    h.failFinal = true;
    h.parts = [text("a"), text("b"), text("c")];
    const turn = runTurn(base("t6"));
    await new Promise((r) => setTimeout(r, 8));
    discardThread("t6");
    const final: Message = await turn;
    expect(final.status).toBe("complete");
  });
});
