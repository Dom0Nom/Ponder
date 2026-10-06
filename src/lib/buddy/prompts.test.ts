import { describe, expect, it } from "vitest";
import { buddyInstruction, buddyNote, hyperfocusNote } from "./prompts";
import type { FocusState } from "../types";

const base: FocusState = {
  sessionId: "s",
  spaceId: "sp",
  technique: "pomodoro",
  goal: "Chapter 3",
  phase: "work",
  block: 1,
  phaseStartedAt: 0,
  phaseDurationMs: 25 * 60000,
  elapsedMs: 0,
  remainingMs: 25 * 60000,
  paused: false,
  pauseReason: null,
  pauseCount: 0,
  needAppCount: 0,
  totalFocusMs: 0,
  totalBreakMs: 0,
  checkInMins: 10,
  now: 0,
};
const low: FocusState = { ...base, energy: "low" };
const ctx = (state: FocusState) => ({ state, previous: state, parking: [], needAppPauses: 0 });

describe("low-energy buddy instructions", () => {
  it("session start skips the 3-question check-in and stays review-only", () => {
    const normal = buddyInstruction("session-start", ctx(base));
    const lowText = buddyInstruction("session-start", ctx(low));
    expect(normal).toContain("3-question check-in");
    expect(lowText).not.toContain("energy level (1–5)");
    expect(lowText).toMatch(/review-only/);
    expect(lowText).toMatch(/No new material/);
  });

  it("block quiz is two easy recall questions", () => {
    expect(buddyInstruction("block-quiz", ctx(base))).toContain("3-question mini quiz");
    const t = buddyInstruction("block-quiz", ctx(low));
    expect(t).toContain("2-question");
    expect(t).toContain("EASY recall");
  });

  it("check-ins are gentler and the summary mentions the low-energy session", () => {
    expect(buddyInstruction("check-in", ctx(low))).toMatch(/gentle/i);
    expect(buddyInstruction("session-summary", ctx(low))).toContain("low-energy");
    expect(buddyInstruction("session-summary", ctx(base))).not.toContain("low-energy");
  });
});

describe("hyperfocus note", () => {
  const s = { ...base, elapsedMs: 90 * 60000 };
  it("uses a break-menu idea when there is one", () => {
    expect(hyperfocusNote(s, ["Drink a glass of water"], () => 0)).toBe(
      "90 min of focus. Time for a break? Drink a glass of water.",
    );
  });
  it("falls back to water and a stretch", () => {
    expect(hyperfocusNote(s, [])).toBe("90 min of focus. Time for water and a stretch?");
    expect(buddyNote("hyperfocus", s, null)).toContain("90 min of focus");
  });
});

describe("check-in with a micro-step", () => {
  it("mentions the current micro-step", () => {
    const text = buddyInstruction("check-in", { state: null, previous: null, parking: [], needAppPauses: 0, currentStep: "Open chapter 3" });
    expect(text).toContain('"Open chapter 3"');
  });
});
