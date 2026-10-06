import { describe, expect, it } from "vitest";
import { buildSystemPrompt, describeFocus, historyMessages, threadTitleFrom } from "./context";
import type { FocusState, Message } from "../types";

const focus: FocusState = {
  sessionId: "s",
  spaceId: "sp",
  technique: "pomodoro",
  goal: "Chapter 3",
  phase: "work",
  block: 2,
  phaseStartedAt: 0,
  phaseDurationMs: 25 * 60000,
  elapsedMs: 21 * 60000,
  remainingMs: 4 * 60000,
  paused: false,
  pauseReason: null,
  pauseCount: 1,
  needAppCount: 2,
  totalFocusMs: 46 * 60000,
  totalBreakMs: 5 * 60000,
  checkInMins: 15,
  now: 0,
};

describe("context assembly", () => {
  it("numbers passages, asks for citations and tags general knowledge", () => {
    const p = buildSystemPrompt({
      space: { name: "Biology", strictGrounding: false },
      tutorStyle: "socratic",
      passages: [{ n: 1, sourceTitle: "Ch. 3", page: 12, text: "Chlorophyll absorbs light." }],
      focus: null,
      now: 0,
      sourceCount: 1,
    });
    expect(p).toContain('"Biology"');
    expect(p).toContain("[1] (Ch. 3, p. 12)\nChlorophyll absorbs light.");
    expect(p).toContain("Socratic");
    expect(p).toContain("{{general}}");
    expect(p).not.toContain("Focus session:");
  });

  it("strict mode forbids general knowledge", () => {
    const p = buildSystemPrompt({
      space: { name: "B", strictGrounding: true },
      tutorStyle: "direct",
      passages: [],
      focus: null,
      now: 0,
      sourceCount: 3,
    });
    expect(p).toContain("Strict mode");
    expect(p).toContain("No passage in the learner's sources matched");
    expect(p).not.toContain("wrap every such part");
  });

  it("includes timer state, break time and need-app pauses", () => {
    const d = describeFocus(focus, new Date("2026-10-06T14:00:00").getTime())!;
    expect(d).toContain("focus block 2");
    expect(d).toContain("4 min left until a break at 14:04");
    expect(d).toContain("Fit your answer into the time left");
    expect(d).toContain("2 break(s)");
    expect(describeFocus(null, 0)).toBeNull();
  });

  it("builds history without failed turns or markers", () => {
    const m = (role: Message["role"], content: string, status: Message["status"] = "complete"): Message => ({
      id: content,
      threadId: "t",
      role,
      content,
      reasoning: null,
      citations: null,
      meta: null,
      status,
      error: null,
      createdAt: 0,
    });
    const h = historyMessages([
      m("user", "Q1"),
      m("assistant", "A {{general}}x{{/general}}"),
      m("assistant", "broken", "error"),
      m("buddy", "Check-in"),
    ]);
    expect(h).toEqual([
      { role: "user", content: "Q1" },
      { role: "assistant", content: "A x" },
      { role: "assistant", content: "(Study buddy note: Check-in)" },
    ]);
  });

  it("makes short thread titles", () => {
    expect(threadTitleFrom("  What   is photosynthesis?  ")).toBe("What is photosynthesis?");
    expect(threadTitleFrom("x".repeat(100)).length).toBe(58);
  });
});
