import { beforeEach, describe, expect, it, vi } from "vitest";
import { streamText } from "ai";
import type { Provider, ProxyEvent } from "../types";

const h = vi.hoisted(() => ({ httpStream: vi.fn(), httpAbort: vi.fn() }));

vi.mock("../ipc", () => {
  class Channel<T> {
    onmessage: (m: T) => void = () => {};
  }
  return { api: { httpStream: h.httpStream, httpAbort: h.httpAbort }, Channel };
});

import { createLanguageModel } from "./model";
import { describeError } from "../chat/runner";

type Step = { wait?: number; ev: ProxyEvent };

function openaiEvent(content: string) {
  return `data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`;
}
const FINISH = `data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;

/** Cuts `body` into pieces of `size` characters (through JSON and multi-byte characters). */
function pieces(body: string, size: number): Step[] {
  const chars = Array.from(body);
  const out: Step[] = [];
  for (let i = 0; i < chars.length; i += size) out.push({ ev: { type: "chunk", data: chars.slice(i, i + size).join("") } });
  return out;
}

function script(steps: Step[]) {
  h.httpStream.mockImplementation(async (_req: unknown, ch: { onmessage: (e: ProxyEvent) => void }) => {
    for (const st of [{ ev: { type: "head", status: 200, headers: { "content-type": "text/event-stream" } } } as Step, ...steps]) {
      if (st.wait) await new Promise((r) => setTimeout(r, st.wait));
      else await Promise.resolve();
      ch.onmessage(st.ev);
    }
  });
}

const provider: Provider = {
  id: "p",
  type: "openai-compatible",
  kind: "apiKey",
  name: "Mock",
  baseUrl: "http://127.0.0.1:18765/v1",
  config: {},
  createdAt: 0,
} as unknown as Provider;

async function collect() {
  const result = streamText({ model: createLanguageModel(provider, "m"), prompt: "hi" });
  let text = "";
  let error: unknown = null;
  try {
    for await (const part of result.stream) {
      if (part.type === "text-delta") text += part.text;
      if (part.type === "error") error = part.error;
    }
  } catch (e) {
    error = e;
  }
  return { text, error };
}

const ANSWER = ["Lichtenergie ", "wird zu ", "chemischer Energie — ", "O₂ entsteht 🌱. ", "$6CO_2$ fertig."];

beforeEach(() => {
  h.httpStream.mockReset();
  h.httpAbort.mockReset().mockResolvedValue(undefined);
});

describe("streaming through the proxy fetch and the AI SDK", () => {
  it("reassembles events cut through JSON and characters", async () => {
    script([...pieces(ANSWER.map(openaiEvent).join("") + FINISH, 7), { ev: { type: "end" } }]);
    const { text, error } = await collect();
    expect(error).toBeNull();
    expect(text).toBe(ANSWER.join(""));
  });

  it("survives a pause with keep-alive comments mid-answer", async () => {
    const first = ANSWER.slice(0, 2).map(openaiEvent).join("");
    const rest = ANSWER.slice(2).map(openaiEvent).join("") + FINISH;
    script([
      ...pieces(first, 11),
      { wait: 120, ev: { type: "chunk", data: ": OPENROUTER PROCESSING\n\n" } },
      { wait: 120, ev: { type: "chunk", data: ": OPENROUTER PROCESSING\n\n" } },
      ...pieces(rest, 11),
      { ev: { type: "end" } },
    ]);
    const { text, error } = await collect();
    expect(error).toBeNull();
    expect(text).toBe(ANSWER.join(""));
  });

  it("keeps the partial answer and names the cause when the connection drops", async () => {
    script([
      ...pieces(ANSWER.slice(0, 3).map(openaiEvent).join(""), 9),
      { ev: { type: "error", message: "The connection to openrouter.ai closed before the answer finished (unexpected EOF)" } },
    ]);
    const { text, error } = await collect();
    expect(text).toBe(ANSWER.slice(0, 3).join(""));
    expect(error).not.toBeNull();
    const msg = describeError(error);
    expect(msg).toContain("closed before the answer finished");
    expect(msg).not.toBe("Failed to process successful response");
  });
});
