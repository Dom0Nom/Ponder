import { describe, expect, it } from "vitest";
import type { FocusState } from "../../lib/types";
import { popKeyOf } from "./timer";

const st = (over: Partial<FocusState>) => ({ sessionId: "s1", phase: "work", block: 1, elapsedMs: 0, remainingMs: 1500_000, ...over }) as FocusState;

describe("popKeyOf", () => {
  it("does not change as time passes", () => {
    expect(popKeyOf(st({ remainingMs: 1499_000, elapsedMs: 1000 }))).toBe(popKeyOf(st({})));
  });
  it("changes on a new phase, block or session", () => {
    const base = popKeyOf(st({}));
    expect(popKeyOf(st({ phase: "break" }))).not.toBe(base);
    expect(popKeyOf(st({ block: 2 }))).not.toBe(base);
    expect(popKeyOf(st({ sessionId: "s2" }))).not.toBe(base);
    expect(popKeyOf(null)).toBe("idle");
  });
});
