import { describe, expect, it } from "vitest";
import { memoryStore, userContent } from "./runner";

describe("userContent", () => {
  it("is plain text without an image", () => {
    expect(userContent("hi")).toBe("hi");
  });
  it("adds the image as a file part after the text", () => {
    expect(userContent("hi", { data: "AAAA", mediaType: "image/png" })).toEqual([
      { type: "text", text: "hi" },
      { type: "file", data: "AAAA", mediaType: "image/png" },
    ]);
  });
});

describe("memoryStore", () => {
  it("keeps messages in memory and applies patches", async () => {
    const store = memoryStore();
    const m = await store.addMessage({ threadId: "t", role: "assistant", content: "", status: "streaming" });
    expect(m.status).toBe("streaming");
    const done = await store.updateMessage(m.id, { content: "answer", status: "complete", error: undefined });
    expect(done).toMatchObject({ id: m.id, content: "answer", status: "complete" });
    expect(await store.listMessages("t")).toEqual([]);
    await expect(store.updateMessage("missing", { content: "x" })).rejects.toThrow();
  });
});
