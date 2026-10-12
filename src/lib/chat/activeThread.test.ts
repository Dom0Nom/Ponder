import { describe, expect, it } from "vitest";
import type { Thread } from "../types";
import { pickActiveThread } from "./activeThread";
import { stripMarkers } from "./followUps";

const th = (id: string, updatedAt: number, pinned = false) => ({ id, updatedAt, pinned }) as Thread;

describe("pickActiveThread", () => {
  it("prefers the selected thread", () => {
    expect(pickActiveThread([th("a", 1), th("b", 2)], "a")?.id).toBe("a");
  });
  it("falls back to the newest, not the first (pinned) one", () => {
    expect(pickActiveThread([th("pinned", 1, true), th("new", 9)], undefined)?.id).toBe("new");
    expect(pickActiveThread([th("pinned", 1, true), th("new", 9)], "gone")?.id).toBe("new");
  });
  it("is undefined without threads", () => {
    expect(pickActiveThread([], undefined)).toBeUndefined();
    expect(pickActiveThread(undefined, "a")).toBeUndefined();
  });
});

describe("stripMarkers", () => {
  it("removes complete and partial follow-up and memory markers", () => {
    expect(stripMarkers("A {{followup: q?}}\n{{remember: x}}")).toBe("A");
    expect(stripMarkers("A\n{{followup: Why does")).toBe("A");
    expect(stripMarkers("A\n{{remem")).toBe("A");
  });
});
