import { describe, expect, it } from "vitest";
import { initialBuddyState, stepBuddy, type BuddyState } from "./engine";
import type { FocusState } from "../types";

const MIN = 60_000;

function st(p: Partial<FocusState>): FocusState {
  return {
    sessionId: "s1",
    spaceId: "sp",
    technique: "pomodoro",
    goal: null,
    phase: "work",
    block: 1,
    phaseStartedAt: 0,
    phaseDurationMs: 25 * MIN,
    elapsedMs: 0,
    remainingMs: 25 * MIN,
    paused: false,
    pauseReason: null,
    pauseCount: 0,
    needAppCount: 0,
    totalFocusMs: 0,
    totalBreakMs: 0,
    checkInMins: 10,
    now: 0,
    ...p,
  };
}

function run(seq: (FocusState | null)[], start: BuddyState = { ...initialBuddyState, initialized: true }) {
  let state = start;
  const kinds: string[] = [];
  for (const s of seq) {
    const r = stepBuddy(state, s);
    state = r.state;
    kinds.push(...r.events.map((e) => e.kind));
  }
  return { kinds, state };
}

const at = (elapsedMin: number, extra: Partial<FocusState> = {}) =>
  st({ elapsedMs: elapsedMin * MIN, remainingMs: (25 - elapsedMin) * MIN, ...extra });

describe("study buddy engine", () => {
  it("announces start, check-ins, recall, quiz, post-break and summary in order", () => {
    const { kinds } = run([
      null,
      at(0),
      at(5),
      at(10),
      at(10.02),
      at(20),
      at(22),
      at(23),
      st({ phase: "break", phaseDurationMs: 5 * MIN, elapsedMs: 0, remainingMs: 5 * MIN }),
      st({ phase: "break", phaseDurationMs: 5 * MIN, elapsedMs: 2 * MIN, remainingMs: 3 * MIN }),
      st({ phase: "work", block: 2, elapsedMs: 0, remainingMs: 25 * MIN }),
      null,
    ]);
    expect(kinds).toEqual([
      "session-start",
      "check-in",
      "check-in",
      "recall",
      "block-quiz",
      "post-break",
      "session-summary",
    ]);
  });

  it("does not re-announce anything right after a UI reload", () => {
    const { kinds } = run([at(14), at(14.1), at(15)], initialBuddyState);
    expect(kinds).toEqual([]);
  });

  it("re-arms check-ins and recall for each block", () => {
    const { kinds } = run([
      at(0),
      at(23),
      st({ phase: "break", phaseDurationMs: 5 * MIN, remainingMs: 5 * MIN }),
      st({ phase: "work", block: 2, elapsedMs: 10 * MIN, remainingMs: 15 * MIN }),
      st({ phase: "work", block: 2, elapsedMs: 23 * MIN, remainingMs: 2 * MIN }),
    ]);
    expect(kinds).toEqual(["session-start", "recall", "block-quiz", "post-break", "check-in", "recall"]);
  });

  it("stays quiet while paused and skips check-ins in the last minutes", () => {
    const { kinds } = run([at(0), at(10, { paused: true, pauseReason: "user" }), at(21.5)]);
    // the 10-minute check-in never fired while paused; at 21.5 min we're inside the quiet window
    expect(kinds).toEqual(["session-start"]);
  });

  it("skips recall for short blocks and handles flowtime", () => {
    const short = run([st({ phaseDurationMs: 5 * MIN, remainingMs: 5 * MIN }), st({ phaseDurationMs: 5 * MIN, elapsedMs: 3 * MIN, remainingMs: 2 * MIN })]);
    expect(short.kinds).toEqual(["session-start"]);
    const flow = run([
      st({ technique: "flowtime", phaseDurationMs: null, remainingMs: null }),
      st({ technique: "flowtime", phaseDurationMs: null, remainingMs: null, elapsedMs: 31 * MIN }),
    ]);
    expect(flow.kinds).toEqual(["session-start", "check-in"]);
  });

  it("emits a summary when a new session replaces an old one", () => {
    const { kinds } = run([at(3), st({ sessionId: "s2" })]);
    expect(kinds).toEqual(["session-start", "session-summary", "session-start"]);
  });
});
