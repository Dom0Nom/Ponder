import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProxyEvent, ProxyRequest } from "../types";

const h = vi.hoisted(() => ({
  httpStream: vi.fn(),
  httpAbort: vi.fn(),
}));

vi.mock("../ipc", () => {
  class Channel<T> {
    onmessage: (m: T) => void = () => {};
  }
  return { api: { httpStream: h.httpStream, httpAbort: h.httpAbort }, Channel };
});

import { createProxyFetch } from "./proxyFetch";

type Ch = { onmessage: (e: ProxyEvent) => void };
let last: { req: ProxyRequest; ch: Ch } | null = null;

beforeEach(() => {
  h.httpStream.mockReset();
  h.httpAbort.mockReset().mockResolvedValue(undefined);
  last = null;
  h.httpStream.mockImplementation(async (req: ProxyRequest, ch: Ch) => {
    last = { req, ch };
  });
});

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("createProxyFetch", () => {
  it("streams chunk events into a Response body", async () => {
    const f = createProxyFetch("prov-1");
    const pending = f("http://localhost:1234/v1/chat/completions", {
      method: "POST",
      headers: new Headers({ "Content-Type": "application/json", Authorization: "Bearer dummy" }),
      body: JSON.stringify({ a: 1 }),
    });
    await tick();
    expect(last!.req).toMatchObject({
      url: "http://localhost:1234/v1/chat/completions",
      method: "POST",
      body: '{"a":1}',
      providerId: "prov-1",
    });
    expect(last!.req.headers["content-type"]).toBe("application/json");
    const ch = last!.ch;
    ch.onmessage({ type: "head", status: 200, headers: { "content-type": "text/event-stream" } });
    const res = await pending;
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    ch.onmessage({ type: "chunk", data: "data: hé" });
    ch.onmessage({ type: "chunk", data: "llo 🎉\n\n" });
    ch.onmessage({ type: "end" });
    expect(await res.text()).toBe("data: héllo 🎉\n\n");
  });

  it("accepts Request objects", async () => {
    const f = createProxyFetch();
    const pending = f(new Request("https://example.com/x", { method: "PUT", body: "hi", headers: { "x-a": "1" } }));
    await tick();
    expect(last!.req).toMatchObject({ method: "PUT", body: "hi", providerId: null });
    expect(last!.req.headers["x-a"]).toBe("1");
    last!.ch.onmessage({ type: "head", status: 204, headers: {} });
    const res = await pending;
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
  });

  it("rejects when an error arrives before head", async () => {
    const pending = createProxyFetch("p")("http://x/v1/models");
    await tick();
    last!.ch.onmessage({ type: "error", message: "Couldn't connect to x" });
    await expect(pending).rejects.toThrow("Couldn't connect to x");
  });

  it("rejects when the command itself fails", async () => {
    h.httpStream.mockRejectedValueOnce(new Error("boom"));
    await expect(createProxyFetch()("http://x/")).rejects.toThrow("boom");
  });

  it("errors the body stream when an error arrives after head", async () => {
    const pending = createProxyFetch()("http://x/");
    await tick();
    last!.ch.onmessage({ type: "head", status: 200, headers: {} });
    const res = await pending;
    last!.ch.onmessage({ type: "chunk", data: "part" });
    last!.ch.onmessage({ type: "error", message: "reset" });
    await expect(res.text()).rejects.toThrow("reset");
  });

  it("abort calls httpAbort and rejects with AbortError", async () => {
    const ac = new AbortController();
    const pending = createProxyFetch()("http://x/", { signal: ac.signal });
    await tick();
    const id = last!.req.id;
    ac.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(h.httpAbort).toHaveBeenCalledWith(id);
  });

  it("abort mid-stream errors the body and stops", async () => {
    const ac = new AbortController();
    const pending = createProxyFetch()("http://x/", { signal: ac.signal });
    await tick();
    last!.ch.onmessage({ type: "head", status: 200, headers: {} });
    const res = await pending;
    const reader = res.body!.getReader();
    last!.ch.onmessage({ type: "chunk", data: "a" });
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("a");
    ac.abort();
    await expect(reader.read()).rejects.toMatchObject({ name: "AbortError" });
    expect(h.httpAbort).toHaveBeenCalledTimes(1);
    last!.ch.onmessage({ type: "chunk", data: "ignored" });
  });

  it("does not start when the signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(createProxyFetch()("http://x/", { signal: ac.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(h.httpStream).not.toHaveBeenCalled();
  });
});
