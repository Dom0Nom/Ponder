import { describe, expect, it, vi } from "vitest";
import type { InboxItem } from "./types";

const pending: InboxItem[] = [];
vi.mock("./ipc", () => ({
  api: {
    inboxPending: vi.fn(async () => pending.filter((i) => i.status === "pending")),
    inboxFinish: vi.fn(async (id: string, _r: string | null, error: string | null) => {
      const it = pending.find((i) => i.id === id)!;
      it.status = error ? "error" : "done";
    }),
    importText: vi.fn(async (_s: string, title: string) => {
      if (title === "first") pending.push(item("late"));
      if (title === "bad") throw new Error("broke");
      return { id: `src-${title}`, title };
    }),
  },
}));

import { drainInbox } from "./inbox";

function item(title: string): InboxItem {
  return { id: title, spaceId: "s", kind: "text", title, body: "b", target: null, useAsSource: false, status: "pending", error: null, resultId: null, createdAt: 0 };
}

describe("drainInbox", () => {
  it("also imports items queued while it runs, and tries each item once", async () => {
    pending.push(item("first"), item("bad"));
    const r = await drainInbox();
    expect(r.added.map((a) => a.title)).toEqual(["first", "late"]);
    expect(r.failed.map((f) => f.item.title)).toEqual(["bad"]);
  });
});
